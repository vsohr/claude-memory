# Claude Memory v0.2.0 -- Architecture Design

**Status:** Ready for Implementation
**Spec:** [SPEC.md](./SPEC.md)
**Previous:** v0.1.0 architecture is fully implemented. This document describes additions for v0.2.0.

---

## Overview

v0.2.0 adds hybrid search (BM25 + vector + RRF fusion), content-addressable deduplication, chunking overlap, configurable thresholds, MCP resources/prompts, output formatters, and one-step init.

All designs build on the existing v0.1.0 codebase. Existing interfaces (`MemoryEntry`, `MemorySearchResult`, `MemoryRepository`) are extended, not replaced. All 54 existing tests must continue to pass.

---

## New Components

### 1. FTS Store (`src/storage/fts.ts`)

SQLite FTS5 wrapper for BM25 keyword search. Stores the full-text index at `.claude/memory/fts.sqlite`.

**Dependency:** `better-sqlite3` (synchronous API, native ESM support, no server process).

#### Interface

```typescript
import type { MemoryEntry } from '../types/memory';

export interface FtsSearchResult {
  id: string;
  score: number; // BM25 score normalized to 0-1
}

export interface FtsEntry {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string;
  sectionTitle: string;
  keywords: string; // space-separated for FTS tokenization
}

export class FtsStore {
  constructor(dbPath: string);

  /** Open or create the SQLite database and FTS5 virtual table. */
  open(): void;

  /** Insert an entry into the FTS index. Converts MemoryEntry to FtsEntry internally. */
  add(entry: MemoryEntry): void;

  /** Insert multiple entries in a single transaction for performance. */
  addBatch(entries: MemoryEntry[]): void;

  /** Search using BM25 ranking. Returns IDs and normalized scores. */
  search(query: string, limit?: number): FtsSearchResult[];

  /** Delete an entry by ID. */
  delete(id: string): void;

  /** Drop all rows. Used during re-indexing. */
  clear(): void;

  /** Close the database connection. */
  close(): void;
}
```

#### Schema Design

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id UNINDEXED,         -- stored but not tokenized, used for joining
  content,              -- main searchable text
  category,             -- category label
  source,               -- source label
  filePath,             -- file path tokens
  sectionTitle,         -- section title tokens
  keywords,             -- space-separated keyword tokens
  tokenize = 'porter unicode61'
);
```

The `id` column is marked `UNINDEXED` so it is stored but not tokenized -- it is only used for joining results back to LanceDB entries. All other columns participate in BM25 ranking. The `porter` tokenizer handles stemming (e.g., "running" matches "run"). The `unicode61` tokenizer handles Unicode normalization.

#### BM25 Score Normalization

FTS5's `bm25()` function returns negative values where lower (more negative) means more relevant. To normalize to a 0-1 range within each result set:

```typescript
function normalizeBm25Scores(results: RawFtsResult[]): FtsSearchResult[] {
  if (results.length === 0) return [];

  const scores = results.map(r => r.rank);
  const minScore = Math.min(...scores); // most relevant (most negative)
  const maxScore = Math.max(...scores); // least relevant (least negative)
  const range = maxScore - minScore;

  // All scores equal: assign 1.0 to all
  if (range === 0) {
    return results.map(r => ({ id: r.id, score: 1.0 }));
  }

  return results.map(r => ({
    id: r.id,
    // Invert: most negative raw score becomes highest normalized score
    score: (maxScore - r.rank) / range,
  }));
}
```

This normalization is relative within the result set. A score of 1.0 means "best match in this batch", not an absolute quality measure. This is acceptable because BM25 scores are only used for ranking within the FTS results; the RRF fusion in `HybridSearch` uses rank positions, not raw scores.

#### Conversion from MemoryEntry

```typescript
private entryToFtsRow(entry: MemoryEntry): FtsEntry {
  return {
    id: entry.id,
    content: entry.content,
    category: entry.metadata.category,
    source: entry.metadata.source,
    filePath: entry.metadata.filePath ?? '',
    sectionTitle: entry.metadata.sectionTitle ?? '',
    keywords: entry.metadata.keywords.join(' '),
  };
}
```

Note: `keywords` is stored as a space-separated string (not JSON array) so that FTS5 tokenizes each keyword individually.

#### Error Handling

- `open()` throws `StorageError` with code `STORAGE_FTS_OPEN` if SQLite cannot be opened.
- `search()` returns an empty array on query parse errors (FTS5 syntax errors from malformed user input) and logs a warning. It does not throw, because a failed keyword search should not prevent vector search from returning results.
- All write operations (`add`, `addBatch`, `delete`, `clear`) throw `StorageError` on failure.

#### Transaction Batching

`addBatch` wraps inserts in a single SQLite transaction for performance. This is critical during init and re-indexing when hundreds of entries may be inserted:

```typescript
addBatch(entries: MemoryEntry[]): void {
  const insert = this.db.prepare(
    `INSERT INTO memory_fts(id, content, category, source, filePath, sectionTitle, keywords)
     VALUES (@id, @content, @category, @source, @filePath, @sectionTitle, @keywords)`
  );

  const batchInsert = this.db.transaction((rows: FtsEntry[]) => {
    for (const row of rows) {
      insert.run(row);
    }
  });

  batchInsert(entries.map(e => this.entryToFtsRow(e)));
}
```

---

### 2. Hybrid Search Service (`src/storage/hybrid.ts`)

Orchestrates vector search, keyword search, or both with Reciprocal Rank Fusion (RRF).

#### Interface

```typescript
import type { MemorySearchResult, MemoryCategory } from '../types/memory';

export type SearchMode = 'vector' | 'keyword' | 'hybrid';

export interface HybridSearchOptions {
  query: string;
  limit?: number;            // default: 5
  mode?: SearchMode;         // default: 'hybrid'
  category?: MemoryCategory;
  minScore?: number;         // override config threshold
}

export class HybridSearch {
  constructor(
    repository: MemoryRepository,
    ftsStore: FtsStore,
    config: MemoryConfigResolved,
  );

  async search(options: HybridSearchOptions): Promise<MemorySearchResult[]>;
}
```

#### Search Flow by Mode

**`vector` mode:**
1. Delegate to `repository.search(query, limit)`.
2. Apply min-score filter from config (default -0.5).
3. Apply optional category filter.
4. Return results.

**`keyword` mode:**
1. Call `ftsStore.search(query, limit)`.
2. For each result ID, fetch the full `MemoryEntry` from LanceDB via `repository.get(id)`.
3. Build `MemorySearchResult[]` using the normalized BM25 score.
4. Apply optional category filter.
5. Return results.

**`hybrid` mode (default):**
1. Run vector and keyword searches in parallel using `Promise.all`:
   - `repository.search(query, overFetchLimit)` where `overFetchLimit = limit * 3`
   - `ftsStore.search(query, overFetchLimit)` (synchronous, wrapped in Promise)
2. Apply RRF fusion to merge ranked lists.
3. Deduplicate by entry ID -- entries appearing in both lists get combined RRF scores.
4. Sort by fused score descending.
5. Fetch full `MemoryEntry` for any keyword-only results not already loaded via `repository.get(id)`.
6. Truncate to requested `limit`.
7. Apply optional category filter.

The over-fetch factor of 3x ensures enough candidates survive fusion and filtering. If `limit=5`, we fetch 15 candidates from each source, fuse them, then trim to 5.

#### RRF Fusion Algorithm

Reciprocal Rank Fusion (Cormack et al., 2009) with k=60:

```typescript
const RRF_K = 60;

interface RankedItem {
  id: string;
  entry?: MemoryEntry;
  vectorScore?: number;  // original vector similarity score
  bm25Score?: number;    // normalized BM25 score
  rrfScore: number;      // fused RRF score
}

function fuseWithRrf(
  vectorResults: MemorySearchResult[],
  bm25Results: FtsSearchResult[],
): RankedItem[] {
  const merged = new Map<string, RankedItem>();

  // Score vector results by rank position
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const r = vectorResults[rank];
    merged.set(r.entry.id, {
      id: r.entry.id,
      entry: r.entry,
      vectorScore: r.score,
      rrfScore: 1 / (RRF_K + rank + 1),
    });
  }

  // Score BM25 results by rank position and merge
  for (let rank = 0; rank < bm25Results.length; rank++) {
    const r = bm25Results[rank];
    const existing = merged.get(r.id);
    const rrfContribution = 1 / (RRF_K + rank + 1);

    if (existing) {
      // Entry appears in both lists: sum the RRF contributions
      existing.bm25Score = r.score;
      existing.rrfScore += rrfContribution;
    } else {
      // Entry only in BM25 results
      merged.set(r.id, {
        id: r.id,
        bm25Score: r.score,
        rrfScore: rrfContribution,
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
```

**Why RRF over weighted linear combination:**
- RRF is rank-based, so it handles the scale mismatch between vector similarity scores (-1 to 1) and BM25 scores (normalized 0-1) without manual weight tuning.
- Items appearing in both lists naturally get boosted because their rank contributions are summed.
- The k=60 constant dampens extreme rank positions, preventing the top-1 result from dominating.

#### Category Filtering

Category is applied as a post-filter after fusion, not before. Pre-filtering would distort rank positions and produce incorrect RRF scores. The filter operates on the final `MemoryEntry.metadata.category`.

#### Score Semantics

The `MemorySearchResult.score` field carries different meanings per mode:
- **vector mode:** cosine similarity (range roughly -1 to 1, typically 0 to 1 for meaningful matches).
- **keyword mode:** normalized BM25 (0-1 within result set).
- **hybrid mode:** RRF score (sum of `1/(k+rank)` contributions, range 0 to ~0.033).

Consumers should treat scores as relative rankings within a single result set, not as absolute quality measures. The `minScore` threshold only applies in vector mode (where it filters by cosine similarity). In keyword and hybrid modes, there is no min-score filtering because the scores have different semantics.

---

### 3. Config Service (`src/utils/config.ts`)

Centralized, type-safe configuration with layered resolution: defaults -> config file -> environment variables.

#### Interface

```typescript
import type { SearchMode } from '../storage/hybrid';

export interface MemoryConfigResolved {
  /** Minimum similarity score for vector search results. Default: -0.5 */
  minScore: number;

  /** Chunk overlap percentage (0-50). Default: 15 */
  chunkOverlapPercent: number;

  /** Maximum chunk size in characters. Default: 2000 */
  chunkSize: number;

  /** Default search mode. Default: 'hybrid' */
  defaultSearchMode: SearchMode;

  /** FTS database filename within .claude/memory/. Default: 'fts.sqlite' */
  ftsDbName: string;
}

/** Shape of .claude/memory.config.json on disk. All fields optional. */
export interface MemoryConfigFile {
  minScore?: number;
  chunkOverlapPercent?: number;
  chunkSize?: number;
  defaultSearchMode?: string;
  ftsDbName?: string;
}
```

#### Resolution Logic

```typescript
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { logger } from './logger';

const DEFAULTS: MemoryConfigResolved = {
  minScore: -0.5,
  chunkOverlapPercent: 15,
  chunkSize: 2000,
  defaultSearchMode: 'hybrid',
  ftsDbName: 'fts.sqlite',
};

const ENV_MAP: Record<string, keyof MemoryConfigResolved> = {
  CLAUDE_MEMORY_MIN_SCORE: 'minScore',
  CLAUDE_MEMORY_CHUNK_OVERLAP: 'chunkOverlapPercent',
  CLAUDE_MEMORY_CHUNK_SIZE: 'chunkSize',
  CLAUDE_MEMORY_SEARCH_MODE: 'defaultSearchMode',
};

export function loadConfig(projectRoot: string): MemoryConfigResolved {
  // Start with defaults
  const config: MemoryConfigResolved = { ...DEFAULTS };

  // Layer 2: config file overrides
  const configPath = join(projectRoot, '.claude', 'memory.config.json');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = configFileSchema.parse(JSON.parse(raw));
      Object.assign(config, parsed);
    } catch (error) {
      logger.warn(`Invalid config file at ${configPath}: ${(error as Error).message}`);
    }
  }

  // Layer 3: env var overrides (highest priority)
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      applyEnvOverride(config, configKey, envValue);
    }
  }

  return config;
}
```

Resolution priority (highest wins): **env var > config file > default**.

The function uses synchronous `readFileSync` because the config file is small and this avoids async contagion at startup. Config is loaded once and passed as a dependency to components.

#### Validation Schema

```typescript
const configFileSchema = z.object({
  minScore: z.number().min(-2).max(1).optional(),
  chunkOverlapPercent: z.number().int().min(0).max(50).optional(),
  chunkSize: z.number().int().min(100).max(10000).optional(),
  defaultSearchMode: z.enum(['vector', 'keyword', 'hybrid']).optional(),
  ftsDbName: z.string().min(1).max(100).optional(),
}).strict();
```

The `.strict()` rejects unknown keys so typos are caught early (e.g., `min_score` instead of `minScore` produces a clear error).

#### Env Var Parsing

```typescript
function applyEnvOverride(
  config: MemoryConfigResolved,
  key: keyof MemoryConfigResolved,
  value: string,
): void {
  switch (key) {
    case 'minScore': {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= -2 && num <= 1) {
        config.minScore = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_MIN_SCORE: "${value}" (expected number -2 to 1)`);
      }
      break;
    }
    case 'chunkOverlapPercent': {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        config.chunkOverlapPercent = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_CHUNK_OVERLAP: "${value}" (expected integer 0-50)`);
      }
      break;
    }
    case 'chunkSize': {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 100 && num <= 10000) {
        config.chunkSize = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_CHUNK_SIZE: "${value}" (expected integer 100-10000)`);
      }
      break;
    }
    case 'defaultSearchMode': {
      if (['vector', 'keyword', 'hybrid'].includes(value)) {
        config.defaultSearchMode = value as SearchMode;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_SEARCH_MODE: "${value}" (expected vector|keyword|hybrid)`);
      }
      break;
    }
    default:
      break;
  }
}
```

Invalid env values log a warning and are ignored (fall through to config file or default). This prevents a typo in an env var from crashing the process.

---

### 4. Content Hash in LanceDB Schema

Add a `contentHash` field to `MemoryRow` for content-addressable deduplication.

#### Schema Change

In `src/storage/lancedb.ts`, extend the existing `MemoryRow` interface:

```typescript
interface MemoryRow {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string;
  sectionTitle: string;
  keywords: string;
  referenceCount: number;
  promoted: boolean;
  promotedAt: string;
  createdAt: string;
  updatedAt: string;
  vector: number[];
  contentHash: string;    // NEW: SHA-256 of normalized content
  [key: string]: unknown;
}
```

The `contentHash` is computed using the existing `hashContent()` function from `src/indexer/hasher.ts` (SHA-256 of LF-normalized content).

#### Deduplication Check

Add a `findByContentHash` method to `MemoryRepository`:

```typescript
async findByContentHash(hash: string): Promise<MemoryEntry | null> {
  const table = await this.ensureTable();
  const results = await table
    .query()
    .where(`"contentHash" = '${escapeQueryValue(hash)}'`)
    .limit(1)
    .toArray();

  if (results.length === 0) return null;
  return this.rowToEntry(results[0] as unknown as MemoryRow);
}
```

Note the double-quoted `"contentHash"` column name -- this is required for camelCase columns in LanceDB's DataFusion SQL dialect, as documented in the project CLAUDE.md.

#### Deduplication in the Add Path

Modify `MemoryRepository.add()` to check for duplicates before inserting:

```typescript
async add(input: MemoryEntryInput): Promise<MemoryEntry> {
  const contentHash = hashContent(input.content);

  // Check for existing entry with same content
  const existing = await this.findByContentHash(contentHash);
  if (existing) {
    logger.debug(`Skipping duplicate content (hash: ${contentHash.slice(0, 8)}...)`);
    return existing;
  }

  const table = await this.ensureTable();
  const row = await this.entryToRow(input);
  row.contentHash = contentHash;
  await table.add([row]);
  return this.rowToEntry(row);
}
```

This provides dedup at the storage level. Even if the orchestrator's file-hash check does not catch a duplicate (e.g., same content in different files, or manual `memory_add` with repeated content), the content hash prevents duplicate vector entries.

#### Update to entryToRow

```typescript
private async entryToRow(input: MemoryEntryInput, existingId?: string): Promise<MemoryRow> {
  const embeddingService = getEmbeddingService();
  const vector = await embeddingService.embed(input.content);
  const now = new Date().toISOString();

  return {
    id: existingId ?? generateId(),
    content: input.content,
    category: input.metadata?.category ?? 'general',
    source: input.metadata?.source ?? 'manual',
    filePath: input.metadata?.filePath ?? '',
    sectionTitle: input.metadata?.sectionTitle ?? '',
    keywords: JSON.stringify(input.metadata?.keywords ?? []),
    referenceCount: input.metadata?.referenceCount ?? 0,
    promoted: input.metadata?.promoted ?? false,
    promotedAt: input.metadata?.promotedAt ?? '',
    createdAt: now,
    updatedAt: now,
    vector,
    contentHash: hashContent(input.content),  // NEW
  };
}
```

#### Update to ensureTable Initialization Row

The dummy row used to create the table schema must also include the new column:

```typescript
const initialRow: MemoryRow = {
  // ... existing fields ...
  contentHash: '',  // NEW
};
```

#### Migration Strategy for Existing Databases

Existing v0.1.0 databases lack the `contentHash` column. The migration is lazy and non-destructive:

1. **Detection:** After opening an existing table in `ensureTable()`, inspect the schema for the `contentHash` field.
2. **Add column:** If missing, use LanceDB's `table.addColumns()` with a default empty string value.
3. **Backfill on next force-index:** Running `npx claude-memory index --force` will delete and re-add all entries, populating `contentHash` values. No separate migration command is needed.

```typescript
private async migrateSchema(table: Table): Promise<void> {
  const schema = await table.schema;
  const hasContentHash = schema.fields.some(f => f.name === 'contentHash');

  if (!hasContentHash) {
    logger.info('Migrating schema: adding contentHash column');
    await table.addColumns([{
      name: 'contentHash',
      valueSql: "''",
    }]);
  }
}
```

Call `migrateSchema()` from `ensureTable()` after opening an existing table, before returning it.

---

### 5. Chunking Overlap (`src/indexer/parser.ts` changes)

Add configurable overlap between consecutive chunks to preserve context at chunk boundaries.

#### Design Rationale

When content is split into chunks, information at the boundary between two chunks may be lost because neither chunk has enough surrounding context for a meaningful embedding. Adding overlap -- repeating the tail of chunk N at the start of chunk N+1 -- mitigates this by ensuring boundary content appears in two chunks.

#### Overlap Mechanism

Overlap is applied **after** chunking, not during. The existing chunking logic (`chunkByHeaders` and `splitLongContent`) remains structurally unchanged. A new post-processing step adds overlap text:

```typescript
export interface ChunkOptions {
  maxChunkSize?: number;     // default: 2000
  overlapPercent?: number;   // default: 15, range: 0-50
}
```

#### Backward Compatibility

The existing function signature `chunkByHeaders(content: string, maxChunkSize?: number)` must continue to work. The second parameter is overloaded:

```typescript
export function chunkByHeaders(
  content: string,
  optionsOrMaxSize?: ChunkOptions | number,
): ContentChunk[] {
  const options: ChunkOptions =
    typeof optionsOrMaxSize === 'number'
      ? { maxChunkSize: optionsOrMaxSize, overlapPercent: 0 }
      : optionsOrMaxSize ?? {};

  const maxChunkSize = options.maxChunkSize ?? 2000;
  const overlapPercent = options.overlapPercent ?? 15;

  // Existing chunking logic (renamed to internal function)
  const rawChunks = chunkByHeadersInternal(content, maxChunkSize);

  // Apply overlap post-processing
  return applyOverlap(rawChunks, overlapPercent);
}
```

When a plain number is passed, overlap defaults to 0%, exactly matching v0.1.0 behavior. When `ChunkOptions` is passed without `overlapPercent`, it defaults to 15%.

#### Overlap Application

```typescript
function applyOverlap(
  chunks: ContentChunk[],
  overlapPercent: number,
): ContentChunk[] {
  if (overlapPercent === 0 || chunks.length <= 1) return chunks;

  const result: ContentChunk[] = [chunks[0]]; // First chunk has no predecessor

  for (let i = 1; i < chunks.length; i++) {
    const prevContent = chunks[i - 1].content;
    const overlapLength = Math.floor(prevContent.length * (overlapPercent / 100));

    // Extract tail of previous chunk, snapping to sentence boundary
    const overlapText = extractOverlapTail(prevContent, overlapLength);

    result.push({
      title: chunks[i].title,
      content: overlapText
        ? overlapText + '\n\n' + chunks[i].content
        : chunks[i].content,
    });
  }

  return result;
}
```

#### Sentence Boundary Snapping

The overlap tail is trimmed to a sentence or newline boundary so chunks do not start mid-sentence:

```typescript
function extractOverlapTail(text: string, targetLength: number): string {
  if (targetLength <= 0) return '';

  const tail = text.slice(-targetLength);

  // Find the first sentence or newline boundary in the tail
  // to avoid starting mid-sentence
  const boundaryMatch = tail.match(/^[^.!?\n]*[.!?\n]\s*/);
  if (boundaryMatch) {
    return tail.slice(boundaryMatch[0].length).trim();
  }

  // No boundary found: use the full tail
  return tail.trim();
}
```

#### Interaction with Content Hashing

Overlapped chunks have different content from non-overlapped chunks (because overlap text is prepended). This means:
- `contentHash` values will differ for overlapped vs. non-overlapped versions of the same source chunk.
- If `overlapPercent` changes between index runs, `index --force` is needed to recompute all entries.
- This is correct and expected: different content should produce different hashes and embeddings.

#### Integration with Orchestrator

The `Indexer` in `src/indexer/orchestrator.ts` passes the configured overlap percentage:

```typescript
const chunks = chunkByHeaders(parsed.content, {
  maxChunkSize: this.chunkSize,
  overlapPercent: this.config.chunkOverlapPercent,
});
```

The `IndexerConfig` interface gains a reference to `MemoryConfigResolved` (or just the relevant fields):

```typescript
export interface IndexerConfig {
  repository: MemoryRepository;
  metaService: MetaService;
  knowledgeDir: string;
  chunkSize?: number;
  chunkOverlapPercent?: number;  // NEW
  ftsStore?: FtsStore;           // NEW: for FTS sync during indexing
}
```

---

### 6. MCP Resources & Prompts (`src/server/index.ts` changes)

Add MCP resource templates and prompt definitions to the server.

#### Capability Registration

Update the server constructor to declare resource and prompt capabilities:

```typescript
this.server = new Server(
  { name: 'claude-memory', version: '0.2.0' },
  {
    capabilities: {
      tools: {},
      resources: {},   // NEW
      prompts: {},     // NEW
    },
  }
);
```

#### Resource Template: `memory://{path}`

Exposes raw markdown content from the `.claude/knowledge/` directory.

```typescript
import {
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
```

**List resource templates handler:**

```typescript
this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: 'memory://{path}',
      name: 'Knowledge file',
      description: 'Raw markdown content from the .claude/knowledge/ directory',
      mimeType: 'text/markdown',
    },
  ],
}));
```

**Read resource handler:**

```typescript
this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^memory:\/\/(.+)$/);

  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const requestedPath = match[1];

  // Security: reject path traversal attempts
  if (requestedPath.includes('..') || requestedPath.startsWith('/')) {
    throw new Error('Invalid path: directory traversal not allowed');
  }

  const knowledgeDir = join(this.projectRoot, '.claude', 'knowledge');
  const fullPath = join(knowledgeDir, requestedPath);

  // Security: verify resolved path is still within knowledge dir
  if (!fullPath.startsWith(knowledgeDir)) {
    throw new Error('Invalid path: outside knowledge directory');
  }

  const content = await readFile(fullPath, 'utf-8');

  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: content,
      },
    ],
  };
});
```

The double path traversal check (rejecting `..` in the input AND verifying the resolved path) provides defense in depth against path traversal attacks.

#### Prompt: `query`

A prompt that teaches the LLM client effective search strategies:

```typescript
this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'query',
      description: 'Guide for searching project memory effectively',
      arguments: [
        {
          name: 'topic',
          description: 'What you want to find information about',
          required: true,
        },
      ],
    },
  ],
}));

this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== 'query') {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }

  const topic = request.params.arguments?.topic ?? 'general';

  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Search project memory for information about: ${topic}`,
            '',
            'Search strategy guide:',
            '- Use "hybrid" mode (default) for best results -- combines semantic and keyword matching.',
            '- Use "keyword" mode when searching for exact terms, function names, or error messages.',
            '- Use "vector" mode when searching for concepts or paraphrased ideas.',
            '',
            'Tips:',
            '- Be specific: "LanceDB query filter syntax" beats "database".',
            '- Include technical terms: "FTS5 porter tokenizer" beats "text search".',
            '- Filter by category when appropriate: architecture, component, domain, pattern, gotcha, discovery.',
          ].join('\n'),
        },
      },
    ],
  };
});
```

#### ServerConfig Update

```typescript
export interface ServerConfig {
  vectorsDir: string;
  ftsPath?: string;          // NEW: path to fts.sqlite
  projectRoot?: string;
  testMode?: boolean;
}
```

The server constructor derives `ftsPath` from config if not provided:

```typescript
const ftsPath = config.ftsPath ?? join(config.vectorsDir, '..', 'fts.sqlite');
```

---

### 7. Output Formatters (`src/cli/formatters.ts`)

Pluggable output formatting for CLI search results.

#### Formatter Interface

```typescript
import type { MemorySearchResult } from '../types/memory';

export type OutputFormat = 'text' | 'json' | 'csv' | 'md' | 'xml';

export interface SearchResultRow {
  id: string;
  score: number;
  content: string;
  category: string;
  source: string;
  filePath: string;
}

export interface OutputFormatter {
  format(results: MemorySearchResult[], query: string): string;
}
```

#### Factory Function

```typescript
export function createFormatter(format: OutputFormat): OutputFormatter {
  switch (format) {
    case 'text': return new TextFormatter();
    case 'json': return new JsonFormatter();
    case 'csv':  return new CsvFormatter();
    case 'md':   return new MarkdownFormatter();
    case 'xml':  return new XmlFormatter();
    default:
      throw new ValidationError(`Unknown output format: ${format}`, 'format');
  }
}
```

#### Conversion Helper

All formatters first convert `MemorySearchResult[]` to a flat `SearchResultRow[]` for uniform handling:

```typescript
function toRows(results: MemorySearchResult[]): SearchResultRow[] {
  return results.map(r => ({
    id: r.entry.id,
    score: r.score,
    content: r.entry.content.slice(0, 200).replace(/\n/g, ' '),
    category: r.entry.metadata.category,
    source: r.entry.metadata.source,
    filePath: r.entry.metadata.filePath ?? '',
  }));
}
```

#### Implementations

**TextFormatter** (default -- matches current CLI output style):

```
Results for: "query"

1. [0.85] .claude/knowledge/architecture/overview.md
   Architecture uses a 3-tier knowledge system with rules, knowledge, and vector DB layers...

2. [0.72] .claude/knowledge/patterns/lancedb.md
   CamelCase columns need double quotes in SQL filters...
```

**JsonFormatter:**

Outputs a valid JSON array. Uses `JSON.stringify(rows, null, 2)`. This replaces the current `--json` flag behavior.

**CsvFormatter:**

```csv
id,score,category,source,filePath,content
abc-123,0.85,architecture,markdown,.claude/knowledge/architecture/overview.md,"Architecture uses a 3-tier..."
```

Escaping rules: fields containing commas, double quotes, or newlines are wrapped in double quotes. Internal double quotes are doubled (`""`). Newlines in content are replaced with spaces.

**MarkdownFormatter:**

```markdown
| Score | Category | Source | File | Content |
|-------|----------|--------|------|---------|
| 0.85 | architecture | markdown | overview.md | Architecture uses a 3-tier... |
```

Pipe characters (`|`) in content are escaped as `\|`.

**XmlFormatter:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<searchResults query="query">
  <result>
    <id>abc-123</id>
    <score>0.85</score>
    <category>architecture</category>
    <source>markdown</source>
    <filePath>.claude/knowledge/architecture/overview.md</filePath>
    <content>Architecture uses a 3-tier...</content>
  </result>
</searchResults>
```

XML entity escaping: `&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;`, `"` -> `&quot;`, `'` -> `&apos;`.

#### Integration with Search Command

The search CLI command gains `--format` and `--mode` options:

```typescript
export interface SearchCmdOptions {
  limit?: number;
  format?: OutputFormat;    // replaces the boolean `json` flag
  mode?: SearchMode;        // vector | keyword | hybrid
}
```

The old `--json` flag is kept as an alias for `--format json` for backward compatibility. When both `--json` and `--format` are specified, `--format` takes precedence.

---

### 8. Init Command Enhancement (`src/cli/commands/init.ts` changes)

The init command becomes a complete one-step flow: create infrastructure, analyze, index, and build FTS.

#### Enhanced Flow

```
Phase 1: Create directories and templates    (existing, unchanged)
Phase 2: Run deep analysis                   (existing, already called)
Phase 3: Run knowledge indexing              (NEW)
Phase 4: Build FTS index                     (NEW)
Phase 5: Report completion                   (enhanced)
```

```typescript
export interface InitOptions {
  force?: boolean;
  skipAnalyze?: boolean;
  skipIndex?: boolean;    // NEW
  skipFts?: boolean;      // NEW
}

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
  analyzed: boolean;
  indexed: boolean;       // NEW
  ftsBuilt: boolean;      // NEW
}
```

#### Phase 3: Knowledge Indexing

After analysis completes (which saves entries to LanceDB), run the knowledge indexer to process `.claude/knowledge/*.md` files:

```typescript
// Phase 3: Index knowledge files
if (!options.skipIndex) {
  const knowledgeDir = join(targetDir, '.claude', 'knowledge');
  if (existsSync(knowledgeDir)) {
    console.log('\nIndexing knowledge files...');
    // Reuse the existing indexCommand logic
    await indexCommand(targetDir, {});
    result.indexed = true;
  }
}
```

#### Phase 4: Build FTS Index

After all entries are in LanceDB (from both analysis and indexing), build the FTS index from all entries:

```typescript
async function buildFtsIndex(targetDir: string): Promise<number> {
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');
  const ftsPath = join(targetDir, '.claude', 'memory', 'fts.sqlite');

  const repository = new MemoryRepository(vectorsDir);
  await repository.connect();

  const ftsStore = new FtsStore(ftsPath);
  ftsStore.open();
  ftsStore.clear(); // Start fresh -- idempotent

  // Fetch all entries from LanceDB
  const entries = await repository.list(undefined, 10000);

  // Batch insert into FTS (single transaction)
  ftsStore.addBatch(entries);

  const count = entries.length;
  ftsStore.close();
  await repository.disconnect();

  console.log(`  FTS index built with ${count} entries`);
  return count;
}
```

#### Idempotency Guarantees

Each phase checks preconditions and is safe to re-run:
- **Phase 1:** `mkdir({ recursive: true })` is a no-op if directories exist. Templates check `existsSync` before writing.
- **Phase 2:** Analyze always writes new entries (dedup handled at storage level via content hash).
- **Phase 3:** Index uses file-hash comparison to skip unchanged files. Content-hash dedup catches remaining duplicates.
- **Phase 4:** FTS build calls `clear()` then re-inserts, so it always reflects current LanceDB state.

#### Completion Report

```
Initialization complete!
  Directories created: 7
  Templates written: 4
  Analysis: 15 entries saved
  Knowledge indexed: 8 entries
  FTS index: 23 entries
  Ready for search!
```

---

## Modified Files Summary

| File | Changes |
|------|---------|
| **`package.json`** | Add `better-sqlite3` to dependencies, `@types/better-sqlite3` to devDependencies. Bump version to `0.2.0`. |
| **`tsup.config.ts`** | Add `better-sqlite3` to `external` array (native addon must not be bundled). |
| **`src/index.ts`** | Add exports: `FtsStore`, `HybridSearch`, `loadConfig`, `createFormatter`, new type exports. |
| **`src/types/memory.ts`** | Add `SearchMode` type export. Existing interfaces unchanged. |
| **`src/types/config.ts`** | Add `MemoryConfigResolved` and `MemoryConfigFile` interfaces alongside existing types. |
| **`src/storage/lancedb.ts`** | Add `contentHash: string` to `MemoryRow`. Add `findByContentHash()` method. Modify `add()` for dedup check. Add `migrateSchema()` called from `ensureTable()`. Update `entryToRow()` to compute and include `contentHash`. Update initialization row to include `contentHash: ''`. |
| **`src/storage/fts.ts`** | **NEW FILE.** `FtsStore` class: FTS5 virtual table management, BM25 search with score normalization, batch insert with transactions. |
| **`src/storage/hybrid.ts`** | **NEW FILE.** `HybridSearch` class: search mode routing, parallel vector+keyword execution, RRF fusion, dedup by entry ID, category post-filtering. |
| **`src/storage/embeddings.ts`** | No changes. |
| **`src/storage/meta.ts`** | No changes. |
| **`src/indexer/parser.ts`** | Change `chunkByHeaders` signature to accept `ChunkOptions | number` (backward compatible). Add `ChunkOptions` interface export. Extract existing logic into `chunkByHeadersInternal`. Add `applyOverlap()` and `extractOverlapTail()` helper functions. |
| **`src/indexer/orchestrator.ts`** | Accept `chunkOverlapPercent` and `ftsStore` in `IndexerConfig`. Pass overlap config to `chunkByHeaders`. After adding each entry to LanceDB, also call `ftsStore.add()` to sync the FTS index. |
| **`src/indexer/hasher.ts`** | No changes. Reused by both orchestrator and `MemoryRepository.add()`. |
| **`src/indexer/directives.ts`** | No changes. |
| **`src/server/index.ts`** | Update capabilities to include `resources: {}` and `prompts: {}`. Add resource template and prompt handlers. Inject `HybridSearch` instead of using `MemoryRepository.search()` directly. Add `ftsPath` to `ServerConfig`. Update version to `0.2.0`. |
| **`src/server/tools/memory-search.ts`** | Replace `repository.search()` with `hybridSearch.search()`. Add `mode` parameter (`"vector" | "keyword" | "hybrid"`) to zod schema and MCP tool definition. Read `minScore` from config instead of hardcoded `-0.5` constant. |
| **`src/server/tools/memory-add.ts`** | After adding to LanceDB, also call `ftsStore.add(entry)` to sync FTS. Accept `FtsStore` parameter. |
| **`src/server/tools/memory-delete.ts`** | After deleting from LanceDB, also call `ftsStore.delete(id)` to sync FTS. Accept `FtsStore` parameter. |
| **`src/server/tools/memory-list.ts`** | No changes. |
| **`src/server/tools/memory-analyze.ts`** | No changes. |
| **`src/cli/formatters.ts`** | **NEW FILE.** `OutputFormatter` interface, `OutputFormat` type, factory function, five formatter implementations (text, json, csv, md, xml), escaping utilities. |
| **`src/cli/commands/search.ts`** | Replace `MemoryRepository.search()` with `HybridSearch.search()`. Add `--mode` and `--format` flags. Use `createFormatter()` for output. Load config via `loadConfig()`. Keep `--json` as alias for `--format json`. |
| **`src/cli/commands/init.ts`** | Add Phase 3 (knowledge indexing) and Phase 4 (FTS build). Update `InitResult` with `indexed` and `ftsBuilt` fields. Add `skipIndex` and `skipFts` to `InitOptions`. |
| **`src/cli/commands/index-cmd.ts`** | After LanceDB indexing, rebuild FTS index from indexed entries. Load config for overlap settings. Pass `ftsStore` and `chunkOverlapPercent` to indexer. |
| **`src/cli/commands/analyze.ts`** | No changes. |
| **`src/utils/config.ts`** | **NEW FILE.** `loadConfig()` function, config file schema validation, env var parsing, defaults. |
| **`src/utils/errors.ts`** | No changes. Existing `StorageError` and `ConfigError` classes are sufficient. |
| **`src/utils/logger.ts`** | No changes. |
| **`src/utils/id.ts`** | No changes. |

---

## New Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| `better-sqlite3` | dependency | Synchronous SQLite3 driver for FTS5 virtual tables |
| `@types/better-sqlite3` | devDependency | TypeScript type definitions |

**Why better-sqlite3:**
- Synchronous API avoids async complexity for a local file database. All FTS operations are CPU-bound and fast (sub-millisecond for typical queries), so blocking is acceptable.
- Full FTS5 support out of the box (compiled with `-DSQLITE_ENABLE_FTS5`).
- ESM compatible with Node 20+.
- No external server process -- file-based, matching LanceDB's philosophy.
- Well-maintained, widely used (~4M weekly npm downloads).

**Native module considerations:**
- `better-sqlite3` includes a native C++ addon compiled at install time via `node-gyp` or prebuild.
- `tsup.config.ts` must mark it as `external` so it is not bundled into the dist output.
- The `package.json` `files` array already includes only `dist` and `templates`, so the native module is resolved from `node_modules` at runtime (standard npm behavior).

---

## Data Flow Diagrams

### Hybrid Search Flow

```
User Query ("how does auth work?", mode=hybrid, limit=5)
    |
    v
HybridSearch.search()
    |
    |  overFetchLimit = limit * 3 = 15
    |
    +-- [Promise.all] ----------------------------+
    |                                              |
    v                                              v
MemoryRepository.search(query, 15)           FtsStore.search(query, 15)
    |                                              |
    v                                              v
EmbeddingService.embed(query)               SQLite FTS5 MATCH query
    |                                              |
    v                                              v
LanceDB vectorSearch()                      bm25() ranked results
    |                                              |
    v                                              v
MemorySearchResult[]                        FtsSearchResult[]
(id, entry, vectorScore)                    (id, normalizedBm25Score)
    |                                              |
    +---------- fuseWithRrf() --------------------+
    |
    v
RankedItem[]
    |  - entries in both lists get summed RRF scores
    |  - sorted by rrfScore descending
    |
    v
Fetch full MemoryEntry for keyword-only hits
    |  (via repository.get(id) for items without entry loaded)
    |
    v
Apply category filter (if specified)
    |
    v
Truncate to limit (5)
    |
    v
MemorySearchResult[] (final output)
```

### Init Command Flow

```
npx claude-memory init
    |
    v
Phase 1: Create Infrastructure
    |-- mkdir .claude/knowledge/{architecture,components,domain,patterns}
    |-- mkdir .claude/memory/vectors
    |-- mkdir .claude/{skills,hooks}
    |-- write gotchas.md template
    |-- write .mcp.json (MCP server registration)
    |-- write settings.json (hooks config)
    |-- write memory-search.js hook
    |-- update .gitignore
    |
    v
Phase 2: Deep Analysis (analyzeCommand)
    |-- Scan documentation (README.md, docs/*.md)
    |-- Extract code structure (exports, types)
    |-- Detect API routes
    |-- Infer architecture patterns
    |-- Save all entries to LanceDB (with content-hash dedup)
    |
    v
Phase 3: Knowledge Indexing (indexCommand)      <-- NEW
    |-- Find .md files in .claude/knowledge/
    |-- Parse frontmatter and directives
    |-- Chunk by H3 headers with overlap (15% default)
    |-- Compute content hashes (dedup at storage level)
    |-- Embed and store in LanceDB
    |
    v
Phase 4: FTS Index Build                        <-- NEW
    |-- Open/create .claude/memory/fts.sqlite
    |-- Clear existing FTS entries
    |-- Fetch all entries from LanceDB
    |-- Batch insert into FTS5 virtual table (single transaction)
    |-- Close database
    |
    v
Phase 5: Report Completion
    |-- Directories created: N
    |-- Files analyzed: N
    |-- Knowledge entries indexed: N
    |-- FTS entries built: N
    |-- "Ready for search!"
```

### Indexing Data Flow (with FTS sync)

```
.claude/knowledge/*.md files
    |
    v
Indexer.index()
    |
    v
For each .md file:
    |-- readFile(filePath)
    |-- hashContent(fileContent) --> compare with meta.json fileHashes
    |   |-- unchanged and not --force? --> skip file
    |
    |-- parseDirectives(fileContent)
    |   |-- vector-index: false? --> skip file
    |
    |-- parseMarkdown(fileContent) --> { frontmatter, content }
    |
    |-- chunkByHeaders(content, { maxChunkSize, overlapPercent })
    |   |-- split by ### headers
    |   |-- splitLongContent at sentence boundaries
    |   |-- applyOverlap: prepend tail of previous chunk (15% default)
    |   --> ContentChunk[]
    |
    v
For each chunk:
    |-- Build MemoryEntryInput { content, metadata }
    |
    |-- repository.add(input)
    |   |-- hashContent(chunk.content) --> contentHash
    |   |-- findByContentHash(contentHash) --> duplicate? skip.
    |   |-- embed(content) --> 384-dim vector
    |   |-- LanceDB table.add([row])
    |   --> MemoryEntry (with id)
    |
    |-- ftsStore.add(entry)            <-- NEW: sync to FTS
    |   |-- Convert MemoryEntry to FtsEntry
    |   |-- SQLite INSERT INTO memory_fts
    |
    v
Update meta.json with new file hashes
```

---

## Testing Strategy

Each new component gets its own test file. All 54 existing tests must continue to pass.

| Component | Test File | Key Test Cases |
|-----------|-----------|----------------|
| FtsStore | `tests/storage/fts.test.ts` | open/close lifecycle, add/search/delete, batch insert, BM25 normalization (min=1.0, max=0.0 for equal scores), porter stemming ("running" matches "run"), empty query returns empty, special characters in query do not throw, clear removes all entries |
| HybridSearch | `tests/storage/hybrid.test.ts` | vector-only mode delegates to repository, keyword-only mode delegates to FTS, hybrid mode runs both in parallel, RRF score calculation matches formula, duplicate entries merged (not doubled), category filter applied after fusion, empty results from one source do not break fusion |
| Config | `tests/utils/config.test.ts` | returns defaults when no file/env, file overrides defaults, env overrides file, invalid env values ignored with warning, invalid file values rejected, `.strict()` catches unknown keys, missing config file is not an error |
| Overlap | `tests/indexer/parser-overlap.test.ts` | `overlapPercent=0` matches v0.1.0 output exactly, `overlapPercent=15` adds overlap to chunks 2+, chunk 1 is never modified, sentence boundary snapping works, single chunk is returned unchanged, number parameter backward compat works |
| Formatters | `tests/cli/formatters.test.ts` | each format produces non-empty output, JSON output parses as valid JSON array, CSV has header row and correct column count, CSV escapes commas and quotes, markdown table has correct column headers, XML is well-formed, empty results produce appropriate empty output |
| Content hash dedup | `tests/storage/lancedb-dedup.test.ts` | `add()` with duplicate content returns existing entry (not new), `add()` with different content creates new entry, returned entry from dedup has original ID, migration adds contentHash column to existing table |
| Init flow | `tests/cli/init-full.test.ts` | full flow creates FTS index file, idempotent re-run does not duplicate entries, `skipFts` flag prevents FTS build, `skipIndex` flag prevents knowledge indexing |
