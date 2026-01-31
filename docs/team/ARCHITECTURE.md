# Claude Memory - Architecture Design

**Status:** Ready for Implementation
**Version:** 1.0
**Author:** Senior Architect

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Runtime** | Node.js 20+ | LTS, ESM support, native TypeScript via tsx |
| **Language** | TypeScript 5.x | Strict typing, better tooling, matches spec's type focus |
| **Package Manager** | npm | Standard, no extra tooling required |
| **Vector Database** | LanceDB (@lancedb/lancedb) | File-based, no server, fast, embeddable, <100ms queries |
| **Embeddings** | Transformers.js (@huggingface/transformers) | Local ONNX, all-MiniLM-L6-v2, 384 dims, ~22MB |
| **MCP Server** | @modelcontextprotocol/sdk | Official SDK, StdioServerTransport for Claude Code |
| **CLI Framework** | Commander.js | Boring technology, well-documented, zero config |
| **Markdown Parsing** | marked + gray-matter | Lightweight, widely used, handles frontmatter |
| **Testing** | Vitest | Fast, ESM-native, TypeScript first, watch mode |
| **Linting** | ESLint + typescript-eslint | Industry standard, strict config |
| **Build** | tsup | Fast bundler, ESM/CJS dual output, zero config |

### Trade-off Analysis

**Embedding Approach: Transformers.js vs @lancedb/embeddings**
- `@lancedb/embeddings` offers tighter integration but is less documented
- Transformers.js is more widely used, better community support
- **Recommendation:** Transformers.js for reliability and debugging ease
- **Watch out for:** Model caching path differences across platforms

**CLI Framework: Commander vs yargs vs oclif**
- oclif is powerful but heavy for our needs
- yargs requires more boilerplate
- **Recommendation:** Commander.js - simple, declarative, 85 million weekly downloads
- **Watch out for:** Async command handlers need explicit error handling

---

## Project Structure

```
claude-memory/
├── package.json                 # Package manifest, bin entry, exports
├── tsconfig.json               # TypeScript configuration
├── vitest.config.ts            # Test configuration
├── .eslintrc.json              # Linting rules
├── .gitignore
├── README.md
│
├── bin/
│   └── cli.ts                  # CLI entry point (npx claude-memory)
│
├── src/
│   ├── index.ts                # Package exports
│   │
│   ├── server/                 # MCP Server (F1)
│   │   ├── index.ts            # Server setup and tool registration
│   │   ├── tools/
│   │   │   ├── memory-search.ts
│   │   │   ├── memory-add.ts
│   │   │   ├── memory-list.ts
│   │   │   └── memory-delete.ts
│   │   └── promotion.ts        # Auto-promote discoveries (F1.6)
│   │
│   ├── storage/                # Vector Database Layer
│   │   ├── index.ts            # Storage interface
│   │   ├── lancedb.ts          # LanceDB implementation
│   │   ├── embeddings.ts       # Transformers.js wrapper
│   │   └── meta.ts             # Metadata/hash tracking
│   │
│   ├── indexer/                # Markdown Indexer (F2)
│   │   ├── index.ts            # Main indexer orchestration
│   │   ├── parser.ts           # Markdown parsing, chunking
│   │   ├── directives.ts       # Parse vector-index, keywords
│   │   └── hasher.ts           # Content hashing for incremental
│   │
│   ├── analyzer/               # Codebase Analyzer (F7)
│   │   ├── index.ts            # Analyzer orchestration
│   │   ├── structure.ts        # Directory structure analysis
│   │   ├── languages.ts        # Language detection
│   │   ├── typescript.ts       # TS/JS specific analyzer
│   │   └── heuristics.ts       # Fallback heuristics
│   │
│   ├── cli/                    # CLI Commands (F5)
│   │   ├── index.ts            # Command registration
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── index.ts        # The 'index' command
│   │   │   ├── analyze.ts
│   │   │   ├── discover.ts
│   │   │   ├── add.ts
│   │   │   ├── promote.ts
│   │   │   └── search.ts
│   │   └── utils/
│   │       ├── output.ts       # Console formatting
│   │       └── progress.ts     # Progress bar
│   │
│   ├── hooks/                  # Git Hooks (F4)
│   │   ├── pre-commit.ts       # Hook logic
│   │   └── install.ts          # Hook installation
│   │
│   ├── config/                 # Configuration
│   │   ├── index.ts            # Config loading
│   │   ├── defaults.ts         # Default values
│   │   └── paths.ts            # Path resolution
│   │
│   ├── types/                  # TypeScript Types
│   │   ├── index.ts            # Re-exports
│   │   ├── memory.ts           # Memory entry types
│   │   ├── config.ts           # Configuration types
│   │   └── analyzer.ts         # Analyzer types
│   │
│   └── utils/                  # Shared Utilities
│       ├── errors.ts           # Custom error classes
│       ├── logger.ts           # Logging utility
│       ├── fs.ts               # File system helpers
│       └── id.ts               # UUID generation
│
├── templates/                  # Files copied on init (F6)
│   ├── knowledge/
│   │   ├── architecture/
│   │   │   └── .gitkeep
│   │   ├── components/
│   │   │   └── .gitkeep
│   │   ├── domain/
│   │   │   └── .gitkeep
│   │   ├── patterns/
│   │   │   └── .gitkeep
│   │   └── gotchas.md
│   ├── skills/
│   │   ├── memory-discover.md
│   │   ├── memory-query.md
│   │   └── memory-save.md
│   └── settings.json           # MCP registration template
│
├── tests/
│   ├── unit/
│   │   ├── storage/
│   │   │   ├── lancedb.test.ts
│   │   │   └── embeddings.test.ts
│   │   ├── indexer/
│   │   │   ├── parser.test.ts
│   │   │   └── directives.test.ts
│   │   ├── analyzer/
│   │   │   └── languages.test.ts
│   │   └── server/
│   │       └── tools.test.ts
│   ├── integration/
│   │   ├── indexer.test.ts
│   │   ├── server.test.ts
│   │   └── cli.test.ts
│   └── fixtures/
│       ├── markdown/
│       │   ├── simple.md
│       │   ├── with-directives.md
│       │   └── multi-section.md
│       └── projects/
│           ├── typescript/
│           └── python/
│
└── docs/
    ├── team/
    │   ├── SPEC.md
    │   └── ARCHITECTURE.md
    └── api/
        └── mcp-tools.md
```

---

## Data Models

### Core Memory Entry

```typescript
// src/types/memory.ts

/**
 * Valid categories for memory entries.
 * Used for filtering and organization.
 */
export type MemoryCategory =
  | 'architecture'
  | 'component'
  | 'domain'
  | 'pattern'
  | 'gotcha'
  | 'discovery'
  | 'general';

/**
 * Source of the memory entry.
 */
export type MemorySource =
  | 'markdown'    // Indexed from .claude/knowledge/
  | 'session'     // Added during Claude session
  | 'discovery'   // Auto-discovered from codebase
  | 'manual';     // Added via CLI

/**
 * Metadata attached to each memory entry.
 */
export interface MemoryMetadata {
  /** Entry category for filtering */
  category: MemoryCategory;

  /** How the entry was created */
  source: MemorySource;

  /** Original file path (if from markdown) */
  filePath?: string;

  /** Section header (if from markdown) */
  sectionTitle?: string;

  /** User-defined keywords for boosting */
  keywords: string[];

  /** Number of times entry matched in searches */
  referenceCount: number;

  /** Whether entry has been promoted to markdown */
  promoted: boolean;

  /** Timestamp of promotion */
  promotedAt?: string;
}

/**
 * A single memory entry stored in the vector database.
 */
export interface MemoryEntry {
  /** Unique identifier (UUID v4) */
  id: string;

  /** The actual content (max 10,000 chars) */
  content: string;

  /** Entry metadata */
  metadata: MemoryMetadata;

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** ISO 8601 last update timestamp */
  updatedAt: string;

  /** 384-dimension embedding vector (computed, not stored in input) */
  vector?: number[];
}

/**
 * Input for creating a new memory entry.
 */
export interface MemoryEntryInput {
  content: string;
  metadata?: Partial<MemoryMetadata>;
}

/**
 * Search result with relevance score.
 */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;  // 0-1, higher is more relevant
}
```

### LanceDB Schema

```typescript
// src/storage/lancedb.ts

import * as lancedb from '@lancedb/lancedb';

/**
 * LanceDB table schema for memory entries.
 * Vector column stores 384-dim embeddings.
 */
export const MEMORY_TABLE_SCHEMA = {
  id: 'string',
  content: 'string',
  category: 'string',
  source: 'string',
  filePath: 'string',          // nullable
  sectionTitle: 'string',      // nullable
  keywords: 'string',          // JSON array as string
  referenceCount: 'int32',
  promoted: 'boolean',
  promotedAt: 'string',        // nullable
  createdAt: 'string',
  updatedAt: 'string',
  vector: 'vector[384]',       // all-MiniLM-L6-v2 dimension
};

/**
 * Row type as stored in LanceDB (flattened metadata).
 */
export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string | null;
  sectionTitle: string | null;
  keywords: string;            // JSON stringified array
  referenceCount: number;
  promoted: boolean;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vector: number[];
}
```

### Indexer Metadata

```typescript
// src/storage/meta.ts

/**
 * Tracks file hashes for incremental indexing.
 * Stored at .claude/memory/meta.json
 */
export interface IndexerMeta {
  /** Schema version for migration */
  version: number;

  /** Last full index timestamp */
  lastIndexedAt: string;

  /** File path -> content hash mapping */
  fileHashes: Record<string, string>;

  /** Discovery state */
  discovery: {
    lastRunAt?: string;
    complete: boolean;
  };
}
```

### Configuration

```typescript
// src/types/config.ts

/**
 * Optional configuration stored at .claude/memory.config.json
 */
export interface MemoryConfig {
  /** Path to knowledge markdown files */
  knowledgeDir: string;        // default: '.claude/knowledge'

  /** Path to vector database files */
  vectorsDir: string;          // default: '.claude/memory/vectors'

  /** Max characters per chunk */
  chunkSize: number;           // default: 2000

  /** Embedding model name */
  model: string;               // default: 'Xenova/all-MiniLM-L6-v2'

  /** Directories to ignore in analysis */
  ignoredDirs: string[];       // default: ['node_modules', '.git', 'dist']

  /** Whether to show progress bars */
  showProgress: boolean;       // default: true
}

/**
 * Resolved paths for a host repository.
 */
export interface ResolvedPaths {
  root: string;                // Host repo root
  claudeDir: string;           // .claude/
  knowledgeDir: string;        // .claude/knowledge/
  memoryDir: string;           // .claude/memory/
  vectorsDir: string;          // .claude/memory/vectors/
  metaFile: string;            // .claude/memory/meta.json
  configFile: string;          // .claude/memory.config.json
}
```

### Analyzer Types

```typescript
// src/types/analyzer.ts

/**
 * Result of codebase structure analysis.
 */
export interface StructureAnalysis {
  /** Project root directory */
  root: string;

  /** Detected project name (from package.json or directory) */
  name: string;

  /** Language breakdown by file count */
  languages: LanguageBreakdown[];

  /** Identified source directories */
  sourceDirectories: string[];

  /** Identified entry points */
  entryPoints: string[];

  /** Total counts */
  stats: {
    directories: number;
    files: number;
    lines: number;
  };
}

export interface LanguageBreakdown {
  language: string;
  extension: string;
  fileCount: number;
  percentage: number;
}

/**
 * Deep analysis result (exports, patterns).
 */
export interface DeepAnalysis extends StructureAnalysis {
  /** Exported symbols from entry points */
  exports: ExportInfo[];

  /** Detected coding patterns */
  patterns: PatternInfo[];
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'const' | 'type' | 'interface';
  file: string;
}

export interface PatternInfo {
  pattern: string;          // e.g., 'Repository Pattern', 'camelCase naming'
  confidence: number;       // 0-1
  evidence: string[];       // File paths or snippets showing pattern
}
```

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLI (bin/cli.ts)                          │
│  Commands: init, index, analyze, discover, add, promote, search    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Indexer     │     │    Analyzer     │     │   MCP Server    │
│  (indexer/)   │     │   (analyzer/)   │     │   (server/)     │
│               │     │                 │     │                 │
│ - parser      │     │ - structure     │     │ - tools         │
│ - directives  │     │ - languages     │     │ - promotion     │
│ - hasher      │     │ - typescript    │     │                 │
│               │     │ - heuristics    │     │                 │
└───────┬───────┘     └────────┬────────┘     └────────┬────────┘
        │                      │                       │
        └──────────────────────┼───────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Storage        │
                    │    (storage/)       │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │   LanceDB     │  │
                    │  │  Repository   │  │
                    │  └───────┬───────┘  │
                    │          │          │
                    │  ┌───────▼───────┐  │
                    │  │  Embeddings   │  │
                    │  │ (Transformers)│  │
                    │  └───────────────┘  │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │     Meta      │  │
                    │  │ (meta.json)   │  │
                    │  └───────────────┘  │
                    └─────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   File System       │
                    │                     │
                    │ .claude/            │
                    │ ├── knowledge/      │
                    │ ├── memory/         │
                    │ │   ├── vectors/    │
                    │ │   └── meta.json   │
                    │ └── skills/         │
                    └─────────────────────┘
```

### Component Responsibilities

#### Storage Layer (`src/storage/`)

**LanceDB Repository** (`lancedb.ts`)
- Manages LanceDB connection lifecycle
- Implements CRUD operations for memory entries
- Converts between domain types and LanceDB rows
- Handles vector similarity search
- Singleton pattern for connection reuse

```typescript
export interface MemoryRepository {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // CRUD
  add(entry: MemoryEntryInput): Promise<MemoryEntry>;
  get(id: string): Promise<MemoryEntry | null>;
  update(id: string, updates: Partial<MemoryEntryInput>): Promise<MemoryEntry>;
  delete(id: string): Promise<boolean>;

  // Query
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  list(category?: MemoryCategory, limit?: number): Promise<MemoryEntry[]>;

  // Bulk operations
  addBatch(entries: MemoryEntryInput[]): Promise<MemoryEntry[]>;
  deleteByFile(filePath: string): Promise<number>;

  // Stats
  count(category?: MemoryCategory): Promise<number>;
  incrementReferenceCount(id: string): Promise<void>;
}
```

**Embeddings Service** (`embeddings.ts`)
- Manages Transformers.js pipeline lifecycle
- Singleton pattern with lazy initialization
- Handles model download progress
- Generates embeddings for text content

```typescript
export interface EmbeddingService {
  // Lifecycle
  initialize(): Promise<void>;
  isReady(): boolean;

  // Embedding generation
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;

  // Configuration
  getDimensions(): number;
  getModelName(): string;
}
```

**Meta Service** (`meta.ts`)
- Reads/writes `.claude/memory/meta.json`
- Tracks file content hashes
- Manages discovery state

```typescript
export interface MetaService {
  load(): Promise<IndexerMeta>;
  save(meta: IndexerMeta): Promise<void>;
  getFileHash(filePath: string): string | undefined;
  setFileHash(filePath: string, hash: string): void;
  clear(): Promise<void>;
}
```

#### Indexer (`src/indexer/`)

**Parser** (`parser.ts`)
- Parses markdown files using `marked`
- Extracts frontmatter using `gray-matter`
- Chunks content by H3 headers
- Handles sentence boundary splitting for oversized sections

**Directives** (`directives.ts`)
- Parses `<!-- vector-index: true/false -->`
- Parses `<!-- keywords: x, y, z -->`
- Returns structured directive info

**Hasher** (`hasher.ts`)
- Computes content hashes for change detection
- Uses fast SHA-256 implementation

**Indexer Orchestrator** (`index.ts`)
- Coordinates parsing, hashing, embedding, storage
- Implements incremental indexing logic
- Reports progress

```typescript
export interface Indexer {
  index(options: IndexOptions): Promise<IndexResult>;
}

export interface IndexOptions {
  force?: boolean;      // Ignore cache
  dryRun?: boolean;     // Don't persist
  onProgress?: (progress: IndexProgress) => void;
}

export interface IndexResult {
  filesProcessed: number;
  filesSkipped: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
  errors: IndexError[];
  durationMs: number;
}
```

#### Analyzer (`src/analyzer/`)

**Structure Analyzer** (`structure.ts`)
- Walks directory tree
- Identifies source directories
- Detects project type (from package.json, pyproject.toml, etc.)

**Language Detector** (`languages.ts`)
- Maps extensions to languages
- Calculates language percentages
- Handles unknown extensions

**TypeScript Analyzer** (`typescript.ts`)
- Parses TS/JS using TypeScript compiler API
- Extracts exports from entry points
- Identifies patterns (optional, for deep analysis)

**Heuristics** (`heuristics.ts`)
- Fallback analysis for unknown languages
- Naming convention detection
- Comment style detection

#### MCP Server (`src/server/`)

**Server Setup** (`index.ts`)
- Initializes MCP server with StdioServerTransport
- Registers all tools
- Handles server lifecycle

**Tools** (`tools/`)
- Each tool in separate file
- Validates input with Zod schemas
- Returns structured responses

#### CLI (`src/cli/`)

**Command Registration** (`index.ts`)
- Uses Commander.js to define commands
- Delegates to appropriate modules
- Handles global options (--json, --quiet)

---

## API Design (MCP Tools)

### Tool: memory_search

Semantic search over memory entries.

```typescript
// Schema
{
  name: 'memory_search',
  description: 'Search project memory using semantic similarity. Returns relevant knowledge entries.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
        minLength: 1,
        maxLength: 500
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 5, max: 20)',
        minimum: 1,
        maximum: 20,
        default: 5
      },
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: ['architecture', 'component', 'domain', 'pattern', 'gotcha', 'discovery', 'general']
      }
    },
    required: ['query']
  }
}

// Response
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      results: [
        {
          id: 'abc123',
          content: 'JWT tokens are validated on each request...',
          score: 0.89,
          category: 'architecture',
          source: 'markdown',
          filePath: '.claude/knowledge/architecture/auth.md'
        }
      ],
      query: 'authentication flow',
      count: 1
    })
  }]
}

// Error Response (empty query)
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      error: 'Query cannot be empty',
      code: 'INVALID_INPUT'
    })
  }],
  isError: true
}
```

### Tool: memory_add

Add new knowledge entry to memory.

```typescript
// Schema
{
  name: 'memory_add',
  description: 'Add a new knowledge entry to project memory.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The knowledge content to store',
        minLength: 1,
        maxLength: 10000
      },
      category: {
        type: 'string',
        description: 'Entry category (default: general)',
        enum: ['architecture', 'component', 'domain', 'pattern', 'gotcha', 'discovery', 'general'],
        default: 'general'
      },
      keywords: {
        type: 'array',
        description: 'Keywords for search boosting',
        items: { type: 'string' },
        maxItems: 10
      }
    },
    required: ['content']
  }
}

// Response
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: true,
      id: 'def456',
      message: 'Entry added to memory'
    })
  }]
}

// Error Response (content too long)
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      error: 'Content exceeds maximum length of 10,000 characters',
      code: 'CONTENT_TOO_LONG',
      maxLength: 10000,
      actualLength: 12345
    })
  }],
  isError: true
}
```

### Tool: memory_list

Browse memory entries by category.

```typescript
// Schema
{
  name: 'memory_list',
  description: 'List memory entries, optionally filtered by category.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (omit for all)',
        enum: ['architecture', 'component', 'domain', 'pattern', 'gotcha', 'discovery', 'general']
      },
      limit: {
        type: 'number',
        description: 'Maximum entries to return (default: 50)',
        minimum: 1,
        maximum: 100,
        default: 50
      }
    }
  }
}

// Response
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      entries: [
        {
          id: 'abc123',
          content: 'JWT tokens are validated...',
          category: 'architecture',
          createdAt: '2024-01-15T10:30:00Z'
        }
      ],
      count: 1,
      category: 'architecture'
    })
  }]
}
```

### Tool: memory_delete

Remove an entry from memory.

```typescript
// Schema
{
  name: 'memory_delete',
  description: 'Delete a memory entry by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to delete'
      }
    },
    required: ['id']
  }
}

// Response (success)
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      deleted: true,
      id: 'abc123'
    })
  }]
}

// Response (not found)
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      deleted: false,
      id: 'nonexistent',
      reason: 'Entry not found'
    })
  }]
}
```

---

## Error Handling Strategy

### Error Hierarchy

```typescript
// src/utils/errors.ts

/**
 * Base error for all claude-memory errors.
 * All errors are recoverable unless explicitly marked.
 */
export class MemoryError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    recoverable = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}

/**
 * Storage/database related errors.
 */
export class StorageError extends MemoryError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, `STORAGE_${code}`, true, context);
    this.name = 'StorageError';
  }
}

/**
 * Input validation errors (user error).
 */
export class ValidationError extends MemoryError {
  readonly field?: string;

  constructor(message: string, field?: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', true, { ...context, field });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Configuration errors.
 */
export class ConfigError extends MemoryError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', true, context);
    this.name = 'ConfigError';
  }
}

/**
 * File system operation errors.
 */
export class FileSystemError extends MemoryError {
  readonly path: string;

  constructor(message: string, path: string, context?: Record<string, unknown>) {
    super(message, 'FS_ERROR', true, { ...context, path });
    this.name = 'FileSystemError';
    this.path = path;
  }
}

/**
 * Embedding generation errors.
 */
export class EmbeddingError extends MemoryError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', true, context);
    this.name = 'EmbeddingError';
  }
}
```

### Error Handling Patterns

**1. Fail Fast with Context**
```typescript
// Good - actionable error with context
if (!content.trim()) {
  throw new ValidationError(
    'Content cannot be empty',
    'content',
    { receivedLength: content.length }
  );
}

// Bad - generic error
if (!content) throw new Error('Invalid content');
```

**2. Graceful Degradation**
```typescript
// For non-critical operations, log and continue
async function indexFiles(files: string[]): Promise<IndexResult> {
  const results: MemoryEntry[] = [];
  const errors: IndexError[] = [];

  for (const file of files) {
    try {
      const entry = await indexFile(file);
      results.push(entry);
    } catch (error) {
      // Log but continue with other files
      errors.push({
        file,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      logger.warn(`Failed to index ${file}: ${error}`);
    }
  }

  return { entries: results, errors };
}
```

**3. Error Boundary at MCP Layer**
```typescript
// All MCP tool handlers wrap in error boundary
async function handleToolCall<T>(
  handler: () => Promise<T>
): Promise<MCPToolResult> {
  try {
    const result = await handler();
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    const memoryError = error instanceof MemoryError
      ? error
      : new MemoryError(
          error instanceof Error ? error.message : 'Unknown error',
          'INTERNAL_ERROR'
        );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: memoryError.message,
          code: memoryError.code,
          recoverable: memoryError.recoverable,
        }),
      }],
      isError: true,
    };
  }
}
```

**4. User-Friendly CLI Errors**
```typescript
// CLI layer formats errors for humans
function formatError(error: unknown): string {
  if (error instanceof ValidationError) {
    return `Validation error: ${error.message}${
      error.field ? ` (field: ${error.field})` : ''
    }`;
  }
  if (error instanceof FileSystemError) {
    return `File system error: ${error.message}\n  Path: ${error.path}`;
  }
  if (error instanceof MemoryError) {
    return `Error [${error.code}]: ${error.message}`;
  }
  return `Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`;
}
```

### Error Codes Reference

| Code | Description | Recovery Action |
|------|-------------|-----------------|
| `VALIDATION_ERROR` | Invalid input | Fix input and retry |
| `STORAGE_CONNECTION` | Can't connect to LanceDB | Check .claude/memory/vectors/ exists |
| `STORAGE_CORRUPTED` | Database corrupted | Run `npx claude-memory index --force` |
| `STORAGE_WRITE` | Write operation failed | Check disk space, permissions |
| `CONFIG_ERROR` | Invalid configuration | Check .claude/memory.config.json |
| `FS_NOT_FOUND` | File/directory not found | Run `npx claude-memory init` |
| `FS_PERMISSION` | Permission denied | Check file permissions |
| `EMBEDDING_MODEL` | Model download failed | Check network, retry |
| `EMBEDDING_FAILED` | Embedding generation failed | Check content length |
| `INTERNAL_ERROR` | Unexpected error | Report bug |

---

## Testing Strategy

### Framework: Vitest

**Configuration** (`vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'node_modules',
        'tests',
        'dist',
        '**/*.d.ts',
      ],
    },
    testTimeout: 30000,  // Embedding tests may be slow first time
    hookTimeout: 60000,  // Model download in beforeAll
  },
});
```

### Test Pyramid

```
        ╱╲
       ╱  ╲
      ╱ E2E╲         10% - Critical paths only
     ╱──────╲
    ╱        ╲
   ╱Integration╲     20% - Component boundaries
  ╱────────────╲
 ╱              ╲
╱   Unit Tests   ╲   70% - Logic, pure functions
╱────────────────╲
```

### Unit Tests (70%)

Test pure functions and isolated logic.

```typescript
// tests/unit/indexer/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown, chunkByHeaders } from '../../../src/indexer/parser';

describe('parseMarkdown', () => {
  it('extracts frontmatter', () => {
    const md = `---
title: Test
---
# Content`;
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({ title: 'Test' });
  });

  it('handles missing frontmatter', () => {
    const md = '# Just content';
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({});
  });
});

describe('chunkByHeaders', () => {
  it('splits on H3 headers', () => {
    const content = `
### First Section
Content 1

### Second Section
Content 2`;
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('First Section');
    expect(chunks[1].title).toBe('Second Section');
  });

  it('treats entire file as one chunk when no H3', () => {
    const content = '# Title\nSome content without H3';
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(1);
  });

  it('splits oversized sections at sentence boundaries', () => {
    const longContent = 'Sentence one. '.repeat(500);  // > 2000 chars
    const chunks = chunkByHeaders(`### Long Section\n${longContent}`);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => {
      expect(chunk.content.length).toBeLessThanOrEqual(2000);
    });
  });
});
```

```typescript
// tests/unit/indexer/directives.test.ts
import { describe, it, expect } from 'vitest';
import { parseDirectives } from '../../../src/indexer/directives';

describe('parseDirectives', () => {
  it('parses vector-index: false', () => {
    const content = '<!-- vector-index: false -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(false);
  });

  it('defaults vector-index to true', () => {
    const content = '# No directive';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
  });

  it('parses keywords', () => {
    const content = '<!-- keywords: auth, jwt, security -->';
    const result = parseDirectives(content);
    expect(result.keywords).toEqual(['auth', 'jwt', 'security']);
  });

  it('handles malformed directives gracefully', () => {
    const content = '<!-- vector-index: maybe -->';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);  // Default
    expect(result.warnings).toContain('Invalid vector-index value: maybe');
  });
});
```

### Integration Tests (20%)

Test component interactions with real dependencies.

```typescript
// tests/integration/indexer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { Indexer } from '../../src/indexer';
import { MemoryRepository } from '../../src/storage/lancedb';

describe('Indexer Integration', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let indexer: Indexer;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'claude-memory-test-'));

    // Create test structure
    await mkdir(join(tempDir, '.claude', 'knowledge'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'memory', 'vectors'), { recursive: true });

    await writeFile(
      join(tempDir, '.claude', 'knowledge', 'test.md'),
      `### Authentication
JWT tokens are validated on each request.

### Database
PostgreSQL is the primary database.`
    );

    repository = new MemoryRepository(join(tempDir, '.claude', 'memory', 'vectors'));
    await repository.connect();

    indexer = new Indexer(repository, tempDir);
  });

  afterAll(async () => {
    await repository.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('indexes markdown files into vector database', async () => {
    const result = await indexer.index({});

    expect(result.filesProcessed).toBe(1);
    expect(result.entriesCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('skips unchanged files on reindex', async () => {
    const result = await indexer.index({});

    expect(result.filesProcessed).toBe(0);
    expect(result.filesSkipped).toBe(1);
  });

  it('reindexes with --force flag', async () => {
    const result = await indexer.index({ force: true });

    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
  });
});
```

```typescript
// tests/integration/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryServer } from '../../src/server';

describe('MCP Server Integration', () => {
  let server: MemoryServer;

  beforeAll(async () => {
    server = new MemoryServer({ testMode: true });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('handles memory_add and memory_search round-trip', async () => {
    // Add entry
    const addResult = await server.callTool('memory_add', {
      content: 'The API uses OAuth2 for authentication',
      category: 'architecture',
    });
    expect(addResult.success).toBe(true);

    // Search for it
    const searchResult = await server.callTool('memory_search', {
      query: 'OAuth authentication',
    });
    expect(searchResult.results).toHaveLength(1);
    expect(searchResult.results[0].content).toContain('OAuth2');
  });

  it('returns empty array for no matches', async () => {
    const result = await server.callTool('memory_search', {
      query: 'completely unrelated quantum physics',
    });
    expect(result.results).toEqual([]);
  });
});
```

### Property-Based Tests

For functions with strong invariants.

```typescript
// tests/unit/indexer/hasher.test.ts
import { describe, it, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { hashContent } from '../../../src/indexer/hasher';

describe('hashContent', () => {
  // Property: same input always produces same hash
  test.prop([fc.string()])('is deterministic', (content) => {
    expect(hashContent(content)).toBe(hashContent(content));
  });

  // Property: different inputs (usually) produce different hashes
  test.prop([fc.string(), fc.string()])('is collision resistant', (a, b) => {
    if (a !== b) {
      // Note: Not guaranteed, but extremely likely
      expect(hashContent(a)).not.toBe(hashContent(b));
    }
    return true;  // fc.pre alternative
  });

  // Property: hash length is consistent
  test.prop([fc.string()])('produces consistent length', (content) => {
    expect(hashContent(content).length).toBe(64);  // SHA-256 hex
  });
});
```

```typescript
// tests/unit/storage/embeddings.test.ts
import { describe } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { EmbeddingService } from '../../../src/storage/embeddings';

describe('EmbeddingService', () => {
  const service = new EmbeddingService();

  // Property: embeddings have correct dimension
  test.prop([fc.string({ minLength: 1, maxLength: 1000 })])(
    'produces 384-dim vectors',
    async (text) => {
      const embedding = await service.embed(text);
      expect(embedding).toHaveLength(384);
    }
  );

  // Property: similar texts have similar embeddings
  test.prop([fc.string({ minLength: 10, maxLength: 100 })])(
    'similar texts have high cosine similarity',
    async (text) => {
      const emb1 = await service.embed(text);
      const emb2 = await service.embed(text + '.');  // Slight variation
      const similarity = cosineSimilarity(emb1, emb2);
      expect(similarity).toBeGreaterThan(0.9);
    }
  );
});
```

### Test Commands

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific file
npm test -- tests/unit/indexer/parser.test.ts

# Run with verbose output
npm test -- --reporter=verbose
```

### Test Fixtures

Stored in `tests/fixtures/` for reusable test data:

```
tests/fixtures/
├── markdown/
│   ├── simple.md           # Basic markdown
│   ├── with-directives.md  # Has vector-index, keywords
│   ├── multi-section.md    # Multiple H3 sections
│   ├── oversized.md        # >2000 char sections
│   └── no-h3.md            # No H3 headers
└── projects/
    ├── typescript/         # Sample TS project
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    └── python/             # Sample Python project
        ├── pyproject.toml
        └── src/
```

---

## Implementation Notes

### Performance Considerations

1. **Lazy Embedding Loading**: Don't load Transformers.js until first embed call
2. **Connection Pooling**: Single LanceDB connection per process
3. **Batch Operations**: Use `addBatch` for bulk indexing
4. **Incremental Indexing**: Always check hashes before re-embedding

### Cross-Platform Compatibility

1. **Paths**: Use `path.join()` and `path.resolve()` everywhere
2. **Line Endings**: Normalize to LF before hashing
3. **File Encoding**: Assume UTF-8, handle BOM

### Security Considerations

1. **No Network Calls**: After model download, everything is local
2. **Path Traversal**: Validate all paths are within repo root
3. **Content Limits**: Enforce 10,000 char max to prevent DoS

---

*Architecture designed following boring technology principles. Ready for implementation.*
