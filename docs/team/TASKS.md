# v0.2.0 Implementation Tasks

**Spec:** [SPEC.md](./SPEC.md) | **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)

**Constraint:** All 54 existing tests must pass after every milestone. All changes are additions to the existing v0.1.0 codebase.

---

## Milestone 1: Foundation (Config + Dependencies)

### Task 1.1: Add better-sqlite3 dependency and update build config
**Size:** S

**Files to modify:**
- `package.json`
- `tsup.config.ts`

**What to implement:**
- Add `better-sqlite3` to `dependencies`
- Add `@types/better-sqlite3` to `devDependencies`
- Bump version from `0.1.0` to `0.2.0` in `package.json`
- In `tsup.config.ts`, add `external: ['better-sqlite3']` to the config object so the native addon is not bundled
- Run `npm install` and verify clean install with no peer dep warnings

**Test file:** None (build verification only)

**Acceptance criteria:** `npm run build` succeeds with no errors. `import Database from 'better-sqlite3'` resolves. All 54 existing tests still pass.

---

### Task 1.2: Create config service with layered resolution
**Size:** M

**Files to create:**
- `src/utils/config.ts`

**Files to modify:**
- `src/utils/index.ts` (add re-export of `loadConfig` and config types)

**What to implement:**
- Define and export `SearchMode` type: `'vector' | 'keyword' | 'hybrid'`
- Define and export `MemoryConfigResolved` interface with fields: `minScore: number` (default -0.5), `chunkOverlapPercent: number` (default 15), `chunkSize: number` (default 2000), `defaultSearchMode: SearchMode` (default 'hybrid'), `ftsDbName: string` (default 'fts.sqlite')
- Define and export `MemoryConfigFile` interface (all fields optional, matches `MemoryConfigResolved` shape)
- Define `DEFAULTS` constant of type `MemoryConfigResolved` with all default values
- Define `ENV_MAP` record mapping env var names to config keys: `CLAUDE_MEMORY_MIN_SCORE` -> `minScore`, `CLAUDE_MEMORY_CHUNK_OVERLAP` -> `chunkOverlapPercent`, `CLAUDE_MEMORY_CHUNK_SIZE` -> `chunkSize`, `CLAUDE_MEMORY_SEARCH_MODE` -> `defaultSearchMode`
- Create `configFileSchema` using `zod`: `z.object({ minScore: z.number().min(-2).max(1).optional(), chunkOverlapPercent: z.number().int().min(0).max(50).optional(), chunkSize: z.number().int().min(100).max(10000).optional(), defaultSearchMode: z.enum(['vector','keyword','hybrid']).optional(), ftsDbName: z.string().min(1).max(100).optional() }).strict()`
- Implement `loadConfig(projectRoot: string): MemoryConfigResolved`:
  1. Start with `{ ...DEFAULTS }`
  2. Read `.claude/memory.config.json` if it exists (synchronous `readFileSync`), parse JSON, validate with zod schema, `Object.assign(config, parsed)` for valid values. On error, log warning via `logger.warn()` and continue with defaults.
  3. For each env var in `ENV_MAP`, if set, call `applyEnvOverride()` to parse and apply
  4. Return resolved config
- Implement `applyEnvOverride(config, key, value)`: switch on key, parse string to correct type, validate range, apply if valid, log warning if invalid

**Test file:** `tests/unit/utils/config.test.ts`

**Key test cases:**
- Returns all defaults when no config file exists and no env vars set
- Config file with `minScore: -0.3` overrides default -0.5
- Env var `CLAUDE_MEMORY_MIN_SCORE=-0.2` overrides config file value
- Invalid env value `CLAUDE_MEMORY_MIN_SCORE=abc` is ignored (default used)
- Config file with unknown key `{ "unknownKey": true }` is rejected by `.strict()`
- Config file with out-of-range value `{ "chunkOverlapPercent": 99 }` is rejected
- Missing config file (no `.claude/memory.config.json`) returns all defaults without error

**Acceptance criteria:** `loadConfig()` returns a fully resolved `MemoryConfigResolved` with correct priority: env var > config file > default. Invalid values at any layer are logged and skipped.

---

### Task 1.3: Add SearchMode type export to memory types
**Size:** S

**Files to modify:**
- `src/types/memory.ts`
- `src/types/index.ts`

**What to implement:**
- In `src/types/memory.ts`, add: `export type SearchMode = 'vector' | 'keyword' | 'hybrid';`
- Verify it is re-exported via `src/types/index.ts` (which does `export * from './memory'`)

Note: `SearchMode` is defined in both `src/types/memory.ts` (for type consumption across the codebase) and `src/utils/config.ts` (for use alongside the config interfaces). The `src/utils/config.ts` version imports from types to avoid duplication. Alternatively, define only in `src/types/memory.ts` and import everywhere else.

**Test file:** `tests/unit/types/memory.test.ts` (add one type-check assertion)

**Key test cases:**
- `SearchMode` type is importable and accepts 'vector', 'keyword', 'hybrid' values

**Acceptance criteria:** `SearchMode` is importable from both `src/types/memory` and the package root entry point.

---

## Milestone 2: FTS Store

### Task 2.1: Implement FtsStore class
**Size:** M

**Files to create:**
- `src/storage/fts.ts`

**Files to modify:**
- `src/storage/index.ts` (add re-export of `FtsStore`, `FtsSearchResult`, `FtsEntry`)

**What to implement:**

**Interfaces (in `src/storage/fts.ts`):**
```typescript
export interface FtsSearchResult {
  id: string;
  score: number; // BM25 normalized to 0-1
}

export interface FtsEntry {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string;
  sectionTitle: string;
  keywords: string; // space-separated
}
```

**FtsStore class:**
- `constructor(dbPath: string)`: store path, `db` starts as null
- `open()`: create SQLite database via `new Database(dbPath)`, enable WAL mode (`PRAGMA journal_mode=WAL`), create FTS5 virtual table:
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    id UNINDEXED,
    content,
    category,
    source,
    filePath,
    sectionTitle,
    keywords,
    tokenize = 'porter unicode61'
  );
  ```
  Throw `StorageError('Failed to open FTS database', 'FTS_OPEN')` on failure.
- `add(entry: MemoryEntry)`: convert via `entryToFtsRow()`, prepare and run INSERT statement
- `addBatch(entries: MemoryEntry[])`: prepare INSERT statement, wrap in `db.transaction()`, iterate and run for each entry
- `search(query: string, limit = 10): FtsSearchResult[]`:
  - If query is empty or blank, return `[]`
  - Execute: `SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`
  - Wrap in try/catch: on FTS5 syntax error, log warning, return `[]`
  - Pass results through `normalizeBm25Scores()`
- `delete(id: string)`: `DELETE FROM memory_fts WHERE id = ?`
- `clear()`: `DELETE FROM memory_fts`
- `close()`: call `db.close()`
- Private `entryToFtsRow(entry: MemoryEntry): FtsEntry`: map `entry.metadata.keywords.join(' ')` for keywords field, use `?? ''` for optional fields
- Private `normalizeBm25Scores(results)`: if empty, return `[]`; if all scores equal, return all with `score: 1.0`; otherwise compute `(maxScore - rank) / range` for each (inverts since BM25 rank is negative, more negative = more relevant)

**Test file:** `tests/unit/storage/fts.test.ts`

**Key test cases:**
- `open()` creates database file and FTS5 table at specified path
- `close()` completes without error
- `add()` + `search()`: inserted entry is found by content keyword
- `addBatch()` inserts multiple entries retrievable by search
- `search()` results are ranked (most relevant first, highest score)
- BM25 normalization: single result gets `score: 1.0`
- BM25 normalization: multiple results have scores spanning 0.0 to 1.0
- Porter stemming: searching "running" matches entry containing "run"
- Empty/blank query returns empty array
- Malformed FTS5 query (e.g., unbalanced quotes) returns empty array, does not throw
- `delete(id)` removes entry so it no longer appears in search
- `clear()` empties all entries (search returns nothing)
- `open()` on invalid path (e.g., directory) throws `StorageError`

**Acceptance criteria:** FTS5 keyword search works with BM25 ranking. Scores are normalized to 0-1. Malformed queries are handled gracefully (empty result, not exception). Batch insert uses a single transaction for performance.

---

## Milestone 3: Content Hash Dedup + Chunking Overlap

### Task 3.1: Add contentHash to LanceDB schema with dedup logic
**Size:** M

**Files to modify:**
- `src/storage/lancedb.ts`

**What to implement:**

1. **Add import:** `import { hashContent } from '../indexer/hasher';`

2. **Extend `MemoryRow` interface:** Add `contentHash: string` field (after `vector`)

3. **Update `ensureTable()` initial row:** Add `contentHash: ''` to the `initialRow` object

4. **Add `migrateSchema()` method:**
   ```typescript
   private async migrateSchema(table: Table): Promise<void> {
     const schema = await table.schema;
     const hasContentHash = schema.fields.some(f => f.name === 'contentHash');
     if (!hasContentHash) {
       logger.info('Migrating schema: adding contentHash column');
       await table.addColumns([{ name: 'contentHash', valueSql: "''" }]);
     }
   }
   ```
   Call this from `ensureTable()` right after `this.connection.openTable(TABLE_NAME)` (before returning the existing table).

5. **Update `entryToRow()`:** Add `contentHash: hashContent(input.content)` to the returned row

6. **Add `findByContentHash()` method:**
   ```typescript
   async findByContentHash(hash: string): Promise<MemoryEntry | null> {
     const table = await this.ensureTable();
     const results = await table.query()
       .where(`"contentHash" = '${escapeQueryValue(hash)}'`)
       .limit(1)
       .toArray();
     if (results.length === 0) return null;
     return this.rowToEntry(results[0] as unknown as MemoryRow);
   }
   ```

7. **Modify `add()` method:**
   ```typescript
   async add(input: MemoryEntryInput): Promise<MemoryEntry> {
     const contentHash = hashContent(input.content);
     const existing = await this.findByContentHash(contentHash);
     if (existing) {
       logger.debug(`Skipping duplicate content (hash: ${contentHash.slice(0, 8)}...)`);
       return existing;
     }
     const table = await this.ensureTable();
     const row = await this.entryToRow(input);
     await table.add([row]);
     return this.rowToEntry(row);
   }
   ```

**Test file:** `tests/unit/storage/lancedb-dedup.test.ts`

**Key test cases:**
- `add()` with identical content twice returns same entry (same ID) on second call
- After adding duplicate, `count()` shows only 1 entry (not 2)
- `add()` with different content creates two separate entries
- `findByContentHash()` returns null for a hash not in the DB
- `findByContentHash()` returns the correct entry for a known hash
- Schema migration: opening a table created without `contentHash` column adds the column via `migrateSchema()`

**Acceptance criteria:** Duplicate content is detected by SHA-256 hash and skipped. Re-indexing does not increase entry count. The `contentHash` column is auto-added to legacy tables.

---

### Task 3.2: Add chunking overlap to markdown parser
**Size:** M

**Files to modify:**
- `src/indexer/parser.ts`

**What to implement:**

1. **Export `ChunkOptions` interface:**
   ```typescript
   export interface ChunkOptions {
     maxChunkSize?: number;    // default: 2000
     overlapPercent?: number;  // default: 15, range: 0-50
   }
   ```

2. **Update `chunkByHeaders` signature** for backward compatibility:
   ```typescript
   export function chunkByHeaders(
     content: string,
     optionsOrMaxSize?: ChunkOptions | number,
   ): ContentChunk[]
   ```
   - If `optionsOrMaxSize` is a number, treat as `{ maxChunkSize: number, overlapPercent: 0 }`
   - If `optionsOrMaxSize` is a `ChunkOptions` object, use its values (defaults: maxChunkSize=2000, overlapPercent=15)
   - If undefined, use defaults (maxChunkSize=2000, overlapPercent=15)

3. **Extract current body** of `chunkByHeaders` into the same function (no rename needed -- just add the overlap post-processing step at the end, before the return)

4. **Add `applyOverlap()` function:**
   ```typescript
   function applyOverlap(chunks: ContentChunk[], overlapPercent: number): ContentChunk[] {
     if (overlapPercent === 0 || chunks.length <= 1) return chunks;
     const result: ContentChunk[] = [chunks[0]];
     for (let i = 1; i < chunks.length; i++) {
       const prevContent = chunks[i - 1].content;
       const overlapLength = Math.floor(prevContent.length * (overlapPercent / 100));
       const overlapText = extractOverlapTail(prevContent, overlapLength);
       result.push({
         title: chunks[i].title,
         content: overlapText ? overlapText + '\n\n' + chunks[i].content : chunks[i].content,
       });
     }
     return result;
   }
   ```

5. **Add `extractOverlapTail()` function:**
   ```typescript
   function extractOverlapTail(text: string, targetLength: number): string {
     if (targetLength <= 0) return '';
     const tail = text.slice(-targetLength);
     const boundaryMatch = tail.match(/^[^.!?\n]*[.!?\n]\s*/);
     if (boundaryMatch) {
       return tail.slice(boundaryMatch[0].length).trim();
     }
     return tail.trim();
   }
   ```

6. At the end of `chunkByHeaders`, before returning, call `return applyOverlap(chunks, overlapPercent);`

**Test file:** `tests/unit/indexer/parser-overlap.test.ts`

**Key test cases:**
- `chunkByHeaders(content, 2000)` (number param) produces identical output to v0.1.0 (overlapPercent=0 by default for number arg)
- `chunkByHeaders(content, { maxChunkSize: 2000, overlapPercent: 15 })` adds overlap to chunk 2+
- First chunk content is never modified by overlap
- Overlap text starts at a sentence boundary (not mid-sentence)
- Single-chunk input returns unchanged regardless of overlapPercent
- `chunkByHeaders(content, { maxChunkSize: 2000, overlapPercent: 0 })` produces no overlap
- `chunkByHeaders(content)` with no second arg defaults to overlapPercent=15
- When previous chunk is very short (overlap length rounds to 0), no overlap is added

**Acceptance criteria:** Chunking overlap is applied as a post-processing step. Backward compatibility is preserved for the `number` parameter form. Sentence boundary snapping prevents mid-sentence overlap starts.

---

### Task 3.3: Wire overlap config and FTS sync into indexer orchestrator
**Size:** S

**Files to modify:**
- `src/indexer/orchestrator.ts`

**What to implement:**

1. **Import FtsStore:** `import { FtsStore } from '../storage/fts';` (conditionally used)

2. **Extend `IndexerConfig`:** Add two optional fields:
   ```typescript
   chunkOverlapPercent?: number;  // default: 0 (backward compat)
   ftsStore?: FtsStore;           // optional FTS sync
   ```

3. **Store in constructor:**
   ```typescript
   private chunkOverlapPercent: number;
   private ftsStore: FtsStore | undefined;
   // In constructor:
   this.chunkOverlapPercent = config.chunkOverlapPercent ?? 0;
   this.ftsStore = config.ftsStore;
   ```

4. **Update `chunkByHeaders` call** in `index()` method (around line 121):
   Change: `const chunks = chunkByHeaders(parsed.content, this.chunkSize);`
   To: `const chunks = chunkByHeaders(parsed.content, { maxChunkSize: this.chunkSize, overlapPercent: this.chunkOverlapPercent });`

5. **Add FTS sync** after `await this.repository.add(entry)` (around line 147):
   ```typescript
   const addedEntry = await this.repository.add(entry);
   result.entriesCreated++;
   // Sync to FTS if available
   if (this.ftsStore) {
     try {
       this.ftsStore.add(addedEntry);
     } catch (ftsError) {
       logger.warn(`FTS sync failed for entry: ${(ftsError as Error).message}`);
     }
   }
   ```
   Note: `ftsStore.add()` expects a `MemoryEntry` (returned from `repository.add()`), not a `MemoryEntryInput`.

**Test file:** `tests/unit/indexer/orchestrator-overlap.test.ts`

**Key test cases:**
- When `chunkOverlapPercent` is set, indexer passes it through to `chunkByHeaders`
- When `ftsStore` is provided, `ftsStore.add()` is called for each indexed entry
- When `ftsStore.add()` throws, indexing continues (warning logged, no failure)
- When `ftsStore` is not provided, indexing works as before (no FTS calls)

**Acceptance criteria:** Overlap config flows from `IndexerConfig` through to the parser. FTS sync happens alongside LanceDB writes when configured. FTS failures do not break indexing.

---

## Milestone 4: Hybrid Search

### Task 4.1: Implement HybridSearch orchestrator
**Size:** M

**Files to create:**
- `src/storage/hybrid.ts`

**Files to modify:**
- `src/storage/index.ts` (add re-export of `HybridSearch`, `HybridSearchOptions`)
- `src/index.ts` (add export for `HybridSearch`, `HybridSearchOptions`)

**What to implement:**

**Interfaces:**
```typescript
export interface HybridSearchOptions {
  query: string;
  limit?: number;           // default: 5
  mode?: SearchMode;        // default: 'hybrid'
  category?: MemoryCategory;
  minScore?: number;        // override config threshold (vector mode only)
}
```

**Constants:**
```typescript
const RRF_K = 60;
const DEFAULT_OVER_FETCH_FACTOR = 3;
```

**HybridSearch class:**
- Constructor: `constructor(repository: MemoryRepository, ftsStore: FtsStore, config: MemoryConfigResolved)`
- `async search(options: HybridSearchOptions): Promise<MemorySearchResult[]>`:
  - Resolve mode from `options.mode ?? this.config.defaultSearchMode`
  - Resolve limit from `options.limit ?? 5`
  - Route to `searchVector()`, `searchKeyword()`, or `searchHybrid()` based on mode

- `private async searchVector(query, limit, minScore, category)`:
  1. `const results = await this.repository.search(query, limit)`
  2. Filter by `minScore` (from options or config): `results.filter(r => r.score >= minScore)`
  3. If category: filter by `r.entry.metadata.category === category`
  4. Return filtered results

- `private async searchKeyword(query, limit, category)`:
  1. `const ftsResults = this.ftsStore.search(query, limit)`
  2. For each result, fetch full entry via `this.repository.get(r.id)`
  3. Build `MemorySearchResult[]` with BM25 score
  4. Filter out nulls (entry not found in LanceDB)
  5. If category: post-filter
  6. Return results

- `private async searchHybrid(query, limit, minScore, category)`:
  1. `const overFetchLimit = limit * DEFAULT_OVER_FETCH_FACTOR`
  2. Run in parallel: `Promise.all([this.repository.search(query, overFetchLimit), Promise.resolve(this.ftsStore.search(query, overFetchLimit))])`
  3. Call `fuseWithRrf(vectorResults, ftsResults)`
  4. Sort by `rrfScore` descending
  5. For keyword-only hits (no `entry` loaded), fetch via `repository.get(id)`
  6. Build `MemorySearchResult[]`
  7. If category: post-filter
  8. Truncate to `limit`
  9. Return results

- `fuseWithRrf(vectorResults, bm25Results)` (private or module-level):
  - Create `Map<string, RankedItem>` keyed by entry ID
  - For each vector result at rank position `rank`: score = `1 / (RRF_K + rank + 1)`
  - For each BM25 result at rank position `rank`: score = `1 / (RRF_K + rank + 1)`. If ID already in map, add to existing `rrfScore`; otherwise create new entry
  - Return map values as array

**Test file:** `tests/unit/storage/hybrid.test.ts`

**Key test cases:**
- Vector mode: delegates to `repository.search()`, applies `minScore` filter, respects category filter
- Keyword mode: delegates to `ftsStore.search()`, fetches full entries from repository
- Hybrid mode: runs both searches, fuses with RRF
- RRF score calculation: rank 0 item gets `1/(60+0+1) = 1/61`, rank 1 gets `1/(60+1+1) = 1/62`
- Item in both lists gets summed RRF score (higher than either individual)
- Item in only one list gets single RRF contribution
- Category filter is applied after fusion (not before, which would distort ranks)
- Empty vector results + non-empty FTS results: returns FTS-only items
- Empty FTS results + non-empty vector results: returns vector-only items
- Both empty: returns empty array
- Limit is respected after fusion and filtering
- Default mode is 'hybrid' when options.mode is undefined

**Acceptance criteria:** All three modes produce correct results. RRF fusion merges duplicates with summed scores. Category filtering is post-fusion. The over-fetch strategy ensures enough candidates survive fusion.

---

## Milestone 5: MCP + CLI Updates

### Task 5.1: Create output formatters for CLI
**Size:** M

**Files to create:**
- `src/cli/formatters.ts`

**What to implement:**

**Types and interfaces:**
```typescript
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

**Helper function:**
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

**Factory:**
```typescript
export function createFormatter(format: OutputFormat): OutputFormatter
```
Throws `ValidationError` for unknown format.

**Formatter implementations (each as a class implementing `OutputFormatter`):**

- **TextFormatter:** Numbered list: `1. [0.85] filepath\n   content preview...\n` (matches current CLI style). On empty results: `No results found for: "query"`
- **JsonFormatter:** `JSON.stringify(toRows(results), null, 2)`. On empty: `[]`
- **CsvFormatter:** Header: `id,score,category,source,filePath,content`. Data rows with proper escaping: fields containing `,`, `"`, or `\n` are wrapped in double quotes; internal `"` doubled as `""`. On empty: header only.
- **MarkdownFormatter:** Table with columns `| Score | Category | Source | File | Content |`. Pipe chars in content escaped as `\|`. On empty: header + empty row indicator.
- **XmlFormatter:** `<?xml version="1.0" encoding="UTF-8"?>` declaration, `<searchResults query="...">` root element, `<result>` children with `<id>`, `<score>`, etc. Entity escaping: `&`->`&amp;`, `<`->`&lt;`, `>`->`&gt;`, `"`->`&quot;`, `'`->`&apos;`. On empty: root element with no children.

**Test file:** `tests/unit/cli/formatters.test.ts`

**Key test cases:**
- `createFormatter('text')` returns a formatter that produces numbered list output
- `createFormatter('json')` output parses as valid JSON array with correct field names
- `createFormatter('csv')` has header row with 6 columns
- CSV correctly escapes field containing a comma
- CSV correctly escapes field containing a double quote
- `createFormatter('md')` produces table with `| Score |` header
- Markdown escapes pipe `|` in content as `\|`
- `createFormatter('xml')` output starts with `<?xml` and contains `<searchResults`
- XML correctly escapes `&` and `<` in content
- All formats produce valid output for empty result set
- `createFormatter('invalid' as any)` throws `ValidationError`

**Acceptance criteria:** All five formatters produce correct, parseable output. Special characters are properly escaped in each format.

---

### Task 5.2: Add MCP resources and prompts to server
**Size:** M

**Files to modify:**
- `src/server/index.ts`

**What to implement:**

1. **Add imports from SDK types:**
   ```typescript
   import {
     ListResourceTemplatesRequestSchema,
     ReadResourceRequestSchema,
     ListPromptsRequestSchema,
     GetPromptRequestSchema,
   } from '@modelcontextprotocol/sdk/types.js';
   import { readFile } from 'fs/promises';
   ```

2. **Update server constructor** capabilities:
   ```typescript
   { capabilities: { tools: {}, resources: {}, prompts: {} } }
   ```

3. **Update version** from `'0.1.0'` to `'0.2.0'`

4. **Add `ftsPath?: string` to `ServerConfig`** with default derived from vectorsDir:
   ```typescript
   const ftsPath = config.ftsPath ?? join(config.vectorsDir, '..', 'fts.sqlite');
   ```

5. **Register resource template handler** in `setupHandlers()`:
   - `ListResourceTemplatesRequestSchema`: return `[{ uriTemplate: 'memory://{path}', name: 'Knowledge file', description: '...', mimeType: 'text/markdown' }]`

6. **Register resource read handler:**
   - Parse URI with regex `/^memory:\/\/(.+)$/`
   - Reject if path contains `..` or starts with `/` (throw Error)
   - Resolve full path: `join(projectRoot, '.claude', 'knowledge', requestedPath)`
   - Verify resolved path starts with knowledge dir (defense in depth)
   - Read file with `readFile(fullPath, 'utf-8')`
   - Return `{ contents: [{ uri, mimeType: 'text/markdown', text: content }] }`

7. **Register prompt list handler:**
   - Return `[{ name: 'query', description: 'Guide for searching project memory effectively', arguments: [{ name: 'topic', description: 'What you want to find information about', required: true }] }]`

8. **Register prompt get handler:**
   - If `name !== 'query'`, throw Error
   - Return message array with search strategy guide text explaining when to use keyword vs semantic vs hybrid

**Test file:** `tests/unit/server/mcp-resources.test.ts`

**Key test cases:**
- ListResourceTemplates returns template with `memory://{path}` URI
- ReadResource with valid path returns file content
- ReadResource with `..` in path throws error
- ReadResource with leading `/` in path throws error
- ReadResource with path that resolves outside knowledge dir throws error
- ReadResource for non-existent file throws appropriate error
- ListPrompts returns `query` prompt with `topic` argument
- GetPrompt `query` returns message with search strategy text
- GetPrompt with unknown name throws error

**Acceptance criteria:** MCP resource template exposes knowledge files with path traversal protection. Query prompt provides search strategy guidance.

---

### Task 5.3: Wire HybridSearch into MCP tools
**Size:** M

**Files to modify:**
- `src/server/index.ts`
- `src/server/tools/memory-search.ts`
- `src/server/tools/memory-add.ts`
- `src/server/tools/memory-delete.ts`

**What to implement:**

**In `src/server/tools/memory-search.ts`:**
- Add `mode` to `memorySearchSchema`: `mode: z.enum(['vector', 'keyword', 'hybrid']).default('hybrid')`
- Add `mode` property to `memorySearchToolDefinition.inputSchema.properties`:
  ```typescript
  mode: {
    type: 'string',
    description: 'Search mode: vector (semantic), keyword (BM25), or hybrid (both)',
    enum: ['vector', 'keyword', 'hybrid'],
    default: 'hybrid',
  }
  ```
- Update `handleMemorySearch` signature: add `hybridSearch: HybridSearch` parameter (second param), keep `repository: MemoryRepository` as third for backward compat or replace entirely
- Replace `repository.search()` call with `hybridSearch.search({ query: input.query, limit, mode: input.mode ?? 'hybrid', category: input.category as MemoryCategory })`
- Remove hardcoded `MIN_SIMILARITY_SCORE` constant (now handled inside HybridSearch via config)

**In `src/server/tools/memory-add.ts`:**
- Add optional `ftsStore?: FtsStore` as third parameter to `handleMemoryAdd`
- After `repository.add()` returns the entry, if ftsStore is provided:
  ```typescript
  if (ftsStore) {
    try { ftsStore.add(entry); } catch (e) { logger.warn(`FTS sync: ${(e as Error).message}`); }
  }
  ```

**In `src/server/tools/memory-delete.ts`:**
- Add optional `ftsStore?: FtsStore` as third parameter to `handleMemoryDelete`
- After `repository.delete()` returns true, if ftsStore is provided:
  ```typescript
  if (ftsStore) {
    try { ftsStore.delete(input.id); } catch (e) { logger.warn(`FTS sync: ${(e as Error).message}`); }
  }
  ```

**In `src/server/index.ts`:**
- Import `FtsStore` and `HybridSearch`
- Import `loadConfig`
- In constructor: instantiate `FtsStore` with derived ftsPath, instantiate `HybridSearch` with repository, ftsStore, and config
- In `start()`: call `this.ftsStore.open()` after repository connect
- In `stop()`: call `this.ftsStore.close()` before server close
- Update `memory_search` handler to pass `this.hybridSearch` to `handleMemorySearch`
- Update `memory_add` handler to pass `this.ftsStore` to `handleMemoryAdd`
- Update `memory_delete` handler to pass `this.ftsStore` to `handleMemoryDelete`
- Update `callTool()` test helper similarly

**Test file:** `tests/unit/server/memory-search.test.ts` (update existing tests, add new)

**Key test cases:**
- `memory_search` with `mode: 'keyword'` returns results from FTS
- `memory_search` with `mode: 'hybrid'` uses both search backends
- `memory_search` without `mode` defaults to 'hybrid'
- `memory_add` syncs new entry to FTS store when ftsStore available
- `memory_delete` syncs deletion to FTS store when ftsStore available
- FTS sync failure on add/delete does not cause tool to return error

**Acceptance criteria:** MCP search tool supports mode parameter. Add and delete tools keep FTS in sync. FTS failures are graceful.

---

### Task 5.4: Update CLI search with --mode and --format flags
**Size:** M

**Files to modify:**
- `src/cli/commands/search.ts`
- `bin/cli.ts`

**What to implement:**

**In `src/cli/commands/search.ts`:**
- Update `SearchCmdOptions`:
  ```typescript
  export interface SearchCmdOptions {
    limit?: number;
    json?: boolean;      // backward compat
    format?: OutputFormat;
    mode?: SearchMode;
  }
  ```
- Update `searchCommand()`:
  1. Load config: `const config = loadConfig(targetDir);`
  2. Open FTS store: `const ftsPath = join(targetDir, '.claude', 'memory', config.ftsDbName);` then open
  3. Create HybridSearch: `new HybridSearch(repository, ftsStore, config)`
  4. Determine search mode: `options.mode ?? config.defaultSearchMode`
  5. Call `hybridSearch.search({ query, limit, mode })`
  6. Determine output format: `options.format ?? (options.json ? 'json' : 'text')`
  7. Create formatter: `createFormatter(format)`
  8. Output: `console.log(formatter.format(results, query))`
  9. Close FTS store and disconnect repository

**In `bin/cli.ts`:**
- Add to search command:
  ```typescript
  .option('--mode <mode>', 'Search mode: vector, keyword, hybrid (default: hybrid)')
  .option('--format <format>', 'Output format: text, json, csv, md, xml (default: text)')
  ```
- Keep existing `--json` option

**Test file:** `tests/unit/cli/search-cmd.test.ts`

**Key test cases:**
- Default search mode comes from config (hybrid)
- `--mode keyword` routes to keyword search
- `--format json` produces JSON output
- `--format csv` produces CSV with headers
- `--json` flag maps to format json (backward compat)
- `--format` takes precedence over `--json` when both specified
- Missing FTS database does not crash (graceful degradation)

**Acceptance criteria:** CLI search supports `--mode` and `--format` flags. `--json` backward compat is maintained. Config-driven defaults are used.

---

### Task 5.5: Update index command with FTS rebuild and overlap
**Size:** S

**Files to modify:**
- `src/cli/commands/index-cmd.ts`

**What to implement:**
1. Import `loadConfig` and `FtsStore`
2. After creating repository and metaService, load config: `const config = loadConfig(targetDir);`
3. Open FTS store: `const ftsPath = join(targetDir, '.claude', 'memory', config.ftsDbName);`
4. Pass config values to indexer:
   ```typescript
   const indexer = new Indexer({
     repository, metaService, knowledgeDir,
     chunkSize: config.chunkSize,
     chunkOverlapPercent: config.chunkOverlapPercent,
     ftsStore,
   });
   ```
5. After indexing, rebuild FTS from all LanceDB entries:
   ```typescript
   console.log('\nRebuilding FTS index...');
   ftsStore.clear();
   const allEntries = await repository.list(undefined, 10000);
   ftsStore.addBatch(allEntries);
   console.log(`  FTS entries: ${allEntries.length}`);
   ftsStore.close();
   ```
6. Add FTS entry count to completion report

**Test file:** `tests/unit/cli/index-cmd.test.ts`

**Key test cases:**
- Index command creates FTS database file
- FTS entry count matches LanceDB entry count
- Config overlap percent is passed to indexer

**Acceptance criteria:** `npx claude-memory index` rebuilds FTS after vector indexing. Overlap is configurable.

---

### Task 5.6: Enhance init command with indexing and FTS phases
**Size:** M

**Files to modify:**
- `src/cli/commands/init.ts`

**What to implement:**

1. **Update interfaces:**
   ```typescript
   export interface InitOptions {
     force?: boolean;
     skipAnalyze?: boolean;
     skipIndex?: boolean;   // NEW
     skipFts?: boolean;     // NEW
   }

   export interface InitResult {
     created: string[];
     skipped: string[];
     errors: string[];
     analyzed: boolean;
     indexed: boolean;      // NEW
     ftsBuilt: boolean;     // NEW
   }
   ```

2. **Add imports:** `FtsStore`, `loadConfig`, `indexCommand`, `MemoryRepository`

3. **Phase 3 -- Knowledge Indexing** (after Phase 2 analyze):
   ```typescript
   if (!options.skipIndex) {
     const knowledgeDir = join(targetDir, '.claude', 'knowledge');
     if (existsSync(knowledgeDir)) {
       console.log('\nIndexing knowledge files...');
       await indexCommand(targetDir, {});
       result.indexed = true;
     }
   }
   ```

4. **Phase 4 -- FTS Build** (after Phase 3):
   ```typescript
   if (!options.skipFts) {
     console.log('\nBuilding FTS index...');
     const config = loadConfig(targetDir);
     const ftsPath = join(targetDir, '.claude', 'memory', config.ftsDbName);
     const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');
     const ftsStore = new FtsStore(ftsPath);
     ftsStore.open();
     ftsStore.clear();
     const repository = new MemoryRepository(vectorsDir);
     await repository.connect();
     const entries = await repository.list(undefined, 10000);
     ftsStore.addBatch(entries);
     console.log(`  FTS index: ${entries.length} entries`);
     ftsStore.close();
     await repository.disconnect();
     result.ftsBuilt = true;
   }
   ```

5. **Initialize result** with `indexed: false, ftsBuilt: false`

6. **Phase 5 -- Enhanced report:** Print summary including index count and FTS count

**Test file:** `tests/unit/cli/init-full.test.ts`

**Key test cases:**
- Full init flow creates `.claude/memory/fts.sqlite` file
- Re-running init does not create duplicate entries (content hash dedup)
- `skipFts: true` prevents FTS database creation
- `skipIndex: true` prevents knowledge indexing phase
- Init with no knowledge files still completes successfully

**Acceptance criteria:** `npx claude-memory init` is a complete one-step setup producing both vector and FTS indexes. Re-running is idempotent. Skip flags work.

---

### Task 5.7: Update package exports for v0.2.0
**Size:** S

**Files to modify:**
- `src/index.ts`

**What to implement:**
Add these exports after the existing ones:
```typescript
// FTS Store
export { FtsStore } from './storage/fts';
export type { FtsSearchResult, FtsEntry } from './storage/fts';

// Hybrid Search
export { HybridSearch } from './storage/hybrid';
export type { HybridSearchOptions } from './storage/hybrid';

// Config
export { loadConfig } from './utils/config';
export type { MemoryConfigResolved, MemoryConfigFile } from './utils/config';

// Formatters
export { createFormatter } from './cli/formatters';
export type { OutputFormat, OutputFormatter, SearchResultRow } from './cli/formatters';

// Updated parser types
export type { ChunkOptions } from './indexer/parser';
```

**Test file:** None (compilation verification)

**Acceptance criteria:** All new public APIs are importable from the package root. `npm run build` produces `.d.ts` files with all new type exports.

---

## Summary

| Milestone | Tasks | Estimated Time | New Files | Modified Files |
|-----------|-------|---------------|-----------|----------------|
| 1: Foundation | 1.1, 1.2, 1.3 | ~2h | `src/utils/config.ts` | `package.json`, `tsup.config.ts`, `src/utils/index.ts`, `src/types/memory.ts` |
| 2: FTS Store | 2.1 | ~1h | `src/storage/fts.ts` | `src/storage/index.ts` |
| 3: Dedup + Overlap | 3.1, 3.2, 3.3 | ~2.5h | None | `src/storage/lancedb.ts`, `src/indexer/parser.ts`, `src/indexer/orchestrator.ts` |
| 4: Hybrid Search | 4.1 | ~1h | `src/storage/hybrid.ts` | `src/storage/index.ts`, `src/index.ts` |
| 5: MCP + CLI | 5.1-5.7 | ~5h | `src/cli/formatters.ts` | `src/server/index.ts`, `src/server/tools/memory-search.ts`, `src/server/tools/memory-add.ts`, `src/server/tools/memory-delete.ts`, `src/cli/commands/search.ts`, `src/cli/commands/index-cmd.ts`, `src/cli/commands/init.ts`, `bin/cli.ts`, `src/index.ts` |

**New test files (10):**

| Test File | Task |
|-----------|------|
| `tests/unit/utils/config.test.ts` | 1.2 |
| `tests/unit/storage/fts.test.ts` | 2.1 |
| `tests/unit/storage/lancedb-dedup.test.ts` | 3.1 |
| `tests/unit/indexer/parser-overlap.test.ts` | 3.2 |
| `tests/unit/indexer/orchestrator-overlap.test.ts` | 3.3 |
| `tests/unit/storage/hybrid.test.ts` | 4.1 |
| `tests/unit/cli/formatters.test.ts` | 5.1 |
| `tests/unit/server/mcp-resources.test.ts` | 5.2 |
| `tests/unit/cli/search-cmd.test.ts` | 5.4 |
| `tests/unit/cli/init-full.test.ts` | 5.6 |

**Updated test files:**

| Test File | Task |
|-----------|------|
| `tests/unit/types/memory.test.ts` | 1.3 |
| `tests/unit/server/memory-search.test.ts` | 5.3 |
| `tests/unit/cli/index-cmd.test.ts` | 5.5 |

**Total: 15 tasks (6 S + 9 M), ~11.5h estimated**
