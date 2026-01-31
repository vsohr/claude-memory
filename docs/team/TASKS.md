# Claude Memory Implementation Plan

> **For Claude:** Use executing-plans skill to implement this plan task-by-task.

**Goal:** Build an npm package that provides a 3-tier local knowledge system for Claude Code with semantic search via MCP server.

**Architecture:** TypeScript npm package with LanceDB for vector storage, Transformers.js for local embeddings, Commander.js CLI, and MCP server for Claude integration. Installs into host repos via `npx claude-memory init`.

**Tech Stack:** Node.js 20+, TypeScript 5.x, LanceDB, Transformers.js (all-MiniLM-L6-v2), @modelcontextprotocol/sdk, Commander.js, Vitest, tsup

**Risks:**
- Transformers.js model download on first run: Mitigate with progress indicator and offline detection
- LanceDB platform compatibility: Mitigate with integration tests on CI across platforms
- Large vector databases slow queries: Mitigate with incremental indexing and size warnings

---

## Milestone 1: Project Scaffold (Runnable Foundation)

### Task 1: Initialize npm package with TypeScript [S]

**Depends on:** None

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.eslintrc.json`

**Step 1: Create package.json**

```json
{
  "name": "claude-memory",
  "version": "0.1.0",
  "description": "Local knowledge tier system for Claude Code",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "claude-memory": "./dist/bin/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests --ext .ts",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["claude", "memory", "mcp", "knowledge", "semantic-search"],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "dist",
    "templates"
  ]
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.env.local
*.tgz
```

**Step 4: Create .eslintrc.json**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "error"
  },
  "ignorePatterns": ["dist", "node_modules", "*.js"]
}
```

**Step 5: Run npm install to verify package.json**

Run: `npm install`
Expected: No errors, node_modules created

**Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore .eslintrc.json
git commit -m "chore: initialize npm package with TypeScript config"
```

---

### Task 2: Add build tooling and test framework [S]

**Depends on:** Task 1

**Files:**
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add devDependencies)

**Step 1: Install dev dependencies**

Run: `npm install -D tsup vitest @vitest/coverage-v8 typescript @types/node @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint`
Expected: Dependencies added to package.json

**Step 2: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
});
```

**Step 3: Create vitest.config.ts**

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
      exclude: ['node_modules', 'tests', 'dist', '**/*.d.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
```

**Step 4: Verify build setup**

Run: `npm run build`
Expected: Error about missing entry files (expected at this point)

**Step 5: Commit**

```bash
git add tsup.config.ts vitest.config.ts package.json package-lock.json
git commit -m "chore: add tsup build and vitest test framework"
```

---

### Task 3: Create core type definitions [S]

**Depends on:** Task 2

**Files:**
- Create: `src/types/index.ts`
- Create: `src/types/memory.ts`
- Create: `src/types/config.ts`
- Create: `src/types/analyzer.ts`

**Step 1: Write the failing test**

Create `tests/unit/types/memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { MemoryEntry, MemoryCategory, MemoryMetadata } from '../../../src/types/memory';

describe('Memory Types', () => {
  it('MemoryEntry has required fields', () => {
    const entry: MemoryEntry = {
      id: 'test-id',
      content: 'Test content',
      metadata: {
        category: 'general',
        source: 'manual',
        keywords: [],
        referenceCount: 0,
        promoted: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(entry.id).toBe('test-id');
    expect(entry.metadata.category).toBe('general');
  });

  it('MemoryCategory includes all valid values', () => {
    const categories: MemoryCategory[] = [
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ];
    expect(categories).toHaveLength(7);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/types/memory.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/types/memory.ts**

```typescript
/**
 * Valid categories for memory entries.
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
export type MemorySource = 'markdown' | 'session' | 'discovery' | 'manual';

/**
 * Metadata attached to each memory entry.
 */
export interface MemoryMetadata {
  category: MemoryCategory;
  source: MemorySource;
  filePath?: string;
  sectionTitle?: string;
  keywords: string[];
  referenceCount: number;
  promoted: boolean;
  promotedAt?: string;
}

/**
 * A single memory entry stored in the vector database.
 */
export interface MemoryEntry {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: string;
  updatedAt: string;
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
  score: number;
}
```

**Step 4: Create src/types/config.ts**

```typescript
/**
 * Optional configuration stored at .claude/memory.config.json
 */
export interface MemoryConfig {
  knowledgeDir: string;
  vectorsDir: string;
  chunkSize: number;
  model: string;
  ignoredDirs: string[];
  showProgress: boolean;
}

/**
 * Resolved paths for a host repository.
 */
export interface ResolvedPaths {
  root: string;
  claudeDir: string;
  knowledgeDir: string;
  memoryDir: string;
  vectorsDir: string;
  metaFile: string;
  configFile: string;
}

/**
 * Indexer metadata for incremental indexing.
 */
export interface IndexerMeta {
  version: number;
  lastIndexedAt: string;
  fileHashes: Record<string, string>;
  discovery: {
    lastRunAt?: string;
    complete: boolean;
  };
}
```

**Step 5: Create src/types/analyzer.ts**

```typescript
/**
 * Language breakdown in analysis.
 */
export interface LanguageBreakdown {
  language: string;
  extension: string;
  fileCount: number;
  percentage: number;
}

/**
 * Result of codebase structure analysis.
 */
export interface StructureAnalysis {
  root: string;
  name: string;
  languages: LanguageBreakdown[];
  sourceDirectories: string[];
  entryPoints: string[];
  stats: {
    directories: number;
    files: number;
    lines: number;
  };
}

/**
 * Export information from code analysis.
 */
export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'const' | 'type' | 'interface';
  file: string;
}

/**
 * Detected pattern information.
 */
export interface PatternInfo {
  pattern: string;
  confidence: number;
  evidence: string[];
}

/**
 * Deep analysis result including exports and patterns.
 */
export interface DeepAnalysis extends StructureAnalysis {
  exports: ExportInfo[];
  patterns: PatternInfo[];
}
```

**Step 6: Create src/types/index.ts**

```typescript
export * from './memory';
export * from './config';
export * from './analyzer';
```

**Step 7: Run test to verify it passes**

Run: `npm test -- tests/unit/types/memory.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/types/ tests/unit/types/
git commit -m "feat: add core type definitions for memory, config, and analyzer"
```

---

### Task 4: Create utility modules [S]

**Depends on:** Task 3

**Files:**
- Create: `src/utils/errors.ts`
- Create: `src/utils/logger.ts`
- Create: `src/utils/id.ts`
- Create: `src/utils/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/utils/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  MemoryError,
  ValidationError,
  StorageError,
  ConfigError,
} from '../../../src/utils/errors';

describe('MemoryError', () => {
  it('has code and recoverable properties', () => {
    const error = new MemoryError('Test error', 'TEST_CODE', true, { foo: 'bar' });
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ foo: 'bar' });
  });
});

describe('ValidationError', () => {
  it('includes field information', () => {
    const error = new ValidationError('Invalid input', 'content');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('content');
  });
});

describe('StorageError', () => {
  it('prefixes code with STORAGE_', () => {
    const error = new StorageError('Connection failed', 'CONNECTION');
    expect(error.code).toBe('STORAGE_CONNECTION');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/utils/errors.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/utils/errors.ts**

```typescript
/**
 * Base error for all claude-memory errors.
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
 * Input validation errors.
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

**Step 4: Create src/utils/logger.ts**

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.prefix = options.prefix ?? '[claude-memory]';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, message: string): string {
    return `${this.prefix} ${level.toUpperCase()}: ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.format('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.format('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message), ...args);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger();
export { Logger };
```

**Step 5: Create src/utils/id.ts**

```typescript
import { randomUUID } from 'crypto';

/**
 * Generate a unique ID for memory entries.
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a slug from text for file names.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
```

**Step 6: Create src/utils/index.ts**

```typescript
export * from './errors';
export * from './logger';
export * from './id';
```

**Step 7: Run test to verify it passes**

Run: `npm test -- tests/unit/utils/errors.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/utils/ tests/unit/utils/
git commit -m "feat: add utility modules for errors, logging, and ID generation"
```

---

### Task 5: Create package entry point and verify build [S]

**Depends on:** Task 4

**Files:**
- Create: `src/index.ts`
- Create: `bin/cli.ts`

**Step 1: Create src/index.ts**

```typescript
// Core types
export * from './types';

// Utilities
export * from './utils';
```

**Step 2: Create bin/cli.ts**

```typescript
#!/usr/bin/env node

console.log('claude-memory CLI - v0.1.0');
console.log('Run "claude-memory --help" for usage information.');
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build completes, dist/ folder created with index.js, cli.js

**Step 4: Verify CLI is executable**

Run: `node dist/bin/cli.js`
Expected: Outputs version message

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/index.ts bin/cli.ts
git commit -m "feat: add package entry point and CLI stub"
```

---

## Milestone 2: Storage Layer

### Task 6: Create embedding service with Transformers.js [M]

**Depends on:** Task 5

**Files:**
- Create: `src/storage/embeddings.ts`
- Create: `src/storage/index.ts`
- Modify: `package.json` (add @huggingface/transformers)

**Step 1: Install dependencies**

Run: `npm install @huggingface/transformers`
Expected: Package added to dependencies

**Step 2: Write the failing test**

Create `tests/unit/storage/embeddings.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from '../../../src/storage/embeddings';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeAll(async () => {
    service = new EmbeddingService();
    await service.initialize();
  }, 120000); // Allow time for model download

  it('returns 384-dimension vectors', async () => {
    const embedding = await service.embed('Test content');
    expect(embedding).toHaveLength(384);
  });

  it('returns consistent embeddings for same input', async () => {
    const emb1 = await service.embed('Hello world');
    const emb2 = await service.embed('Hello world');
    expect(emb1).toEqual(emb2);
  });

  it('handles batch embedding', async () => {
    const texts = ['First text', 'Second text', 'Third text'];
    const embeddings = await service.embedBatch(texts);
    expect(embeddings).toHaveLength(3);
    embeddings.forEach((emb) => expect(emb).toHaveLength(384));
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/storage/embeddings.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Create src/storage/embeddings.ts**

```typescript
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EmbeddingError } from '../utils/errors';
import { logger } from '../utils/logger';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;

export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private initializing: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.loadPipeline();
    await this.initializing;
  }

  private async loadPipeline(): Promise<void> {
    try {
      logger.info(`Loading embedding model: ${MODEL_NAME}`);
      this.pipeline = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
      });
      logger.info('Embedding model loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`Failed to load embedding model: ${message}`, {
        model: MODEL_NAME,
      });
    }
  }

  isReady(): boolean {
    return this.pipeline !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipeline) {
      await this.initialize();
    }

    if (!this.pipeline) {
      throw new EmbeddingError('Embedding pipeline not initialized');
    }

    try {
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract the embedding array from the tensor output
      const embedding = Array.from(output.data as Float32Array);
      return embedding.slice(0, EMBEDDING_DIMENSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new EmbeddingError(`Failed to generate embedding: ${message}`, {
        textLength: text.length,
      });
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  getDimensions(): number {
    return EMBEDDING_DIMENSION;
  }

  getModelName(): string {
    return MODEL_NAME;
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}
```

**Step 5: Create src/storage/index.ts**

```typescript
export * from './embeddings';
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/unit/storage/embeddings.test.ts`
Expected: PASS (first run may take 1-2 minutes for model download)

**Step 7: Commit**

```bash
git add src/storage/ tests/unit/storage/ package.json package-lock.json
git commit -m "feat: add embedding service with Transformers.js"
```

---

### Task 7: Create LanceDB repository [M]

**Depends on:** Task 6

**Files:**
- Create: `src/storage/lancedb.ts`
- Modify: `src/storage/index.ts`
- Modify: `package.json` (add @lancedb/lancedb)

**Step 1: Install dependencies**

Run: `npm install @lancedb/lancedb`
Expected: Package added to dependencies

**Step 2: Write the failing test**

Create `tests/unit/storage/lancedb.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('MemoryRepository', () => {
  let tempDir: string;
  let repository: MemoryRepository;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lance-test-'));
  });

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  beforeEach(async () => {
    repository = new MemoryRepository(tempDir);
    await repository.connect();
  });

  it('connects to database', () => {
    expect(repository.isConnected()).toBe(true);
  });

  it('adds and retrieves entry', async () => {
    const entry = await repository.add({
      content: 'Test content about authentication',
      metadata: { category: 'architecture' },
    });

    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('Test content about authentication');

    const retrieved = await repository.get(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe('Test content about authentication');
  });

  it('searches by semantic similarity', async () => {
    await repository.add({
      content: 'JWT tokens are used for authentication',
      metadata: { category: 'architecture' },
    });

    const results = await repository.search('how does auth work', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain('authentication');
  });

  it('deletes entry', async () => {
    const entry = await repository.add({
      content: 'To be deleted',
    });

    const deleted = await repository.delete(entry.id);
    expect(deleted).toBe(true);

    const retrieved = await repository.get(entry.id);
    expect(retrieved).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/storage/lancedb.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Create src/storage/lancedb.ts**

```typescript
import * as lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import { getEmbeddingService } from './embeddings';
import { generateId } from '../utils/id';
import { StorageError } from '../utils/errors';
import { logger } from '../utils/logger';
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemorySearchResult,
  MemoryCategory,
  MemoryMetadata,
} from '../types/memory';

const TABLE_NAME = 'memories';

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string | null;
  sectionTitle: string | null;
  keywords: string;
  referenceCount: number;
  promoted: boolean;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vector: number[];
}

export class MemoryRepository {
  private dbPath: string;
  private connection: Connection | null = null;
  private table: Table | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await lancedb.connect(this.dbPath);

      const tableNames = await this.connection.tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        this.table = await this.connection.openTable(TABLE_NAME);
      }

      logger.debug(`Connected to LanceDB at ${this.dbPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(`Failed to connect to database: ${message}`, 'CONNECTION', {
        path: this.dbPath,
      });
    }
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    this.table = null;
  }

  isConnected(): boolean {
    return this.connection !== null;
  }

  private async ensureTable(): Promise<Table> {
    if (this.table) return this.table;
    if (!this.connection) {
      throw new StorageError('Database not connected', 'NOT_CONNECTED');
    }

    // Create table with a dummy row (LanceDB requires data to infer schema)
    const embeddingService = getEmbeddingService();
    const dummyVector = await embeddingService.embed('initialization');

    const initialRow: MemoryRow = {
      id: '__init__',
      content: '',
      category: 'general',
      source: 'manual',
      filePath: null,
      sectionTitle: null,
      keywords: '[]',
      referenceCount: 0,
      promoted: false,
      promotedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      vector: dummyVector,
    };

    this.table = await this.connection.createTable(TABLE_NAME, [initialRow]);

    // Delete the initialization row
    await this.table.delete('id = "__init__"');

    return this.table;
  }

  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      metadata: {
        category: row.category as MemoryCategory,
        source: row.source as MemoryMetadata['source'],
        filePath: row.filePath ?? undefined,
        sectionTitle: row.sectionTitle ?? undefined,
        keywords: JSON.parse(row.keywords) as string[],
        referenceCount: row.referenceCount,
        promoted: row.promoted,
        promotedAt: row.promotedAt ?? undefined,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async entryToRow(input: MemoryEntryInput, existingId?: string): Promise<MemoryRow> {
    const embeddingService = getEmbeddingService();
    const vector = await embeddingService.embed(input.content);
    const now = new Date().toISOString();

    return {
      id: existingId ?? generateId(),
      content: input.content,
      category: input.metadata?.category ?? 'general',
      source: input.metadata?.source ?? 'manual',
      filePath: input.metadata?.filePath ?? null,
      sectionTitle: input.metadata?.sectionTitle ?? null,
      keywords: JSON.stringify(input.metadata?.keywords ?? []),
      referenceCount: input.metadata?.referenceCount ?? 0,
      promoted: input.metadata?.promoted ?? false,
      promotedAt: input.metadata?.promotedAt ?? null,
      createdAt: now,
      updatedAt: now,
      vector,
    };
  }

  async add(input: MemoryEntryInput): Promise<MemoryEntry> {
    const table = await this.ensureTable();
    const row = await this.entryToRow(input);
    await table.add([row]);
    return this.rowToEntry(row);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const table = await this.ensureTable();
    const results = await table.query().where(`id = "${id}"`).limit(1).toArray();

    if (results.length === 0) return null;
    return this.rowToEntry(results[0] as unknown as MemoryRow);
  }

  async delete(id: string): Promise<boolean> {
    const table = await this.ensureTable();
    const existing = await this.get(id);
    if (!existing) return false;

    await table.delete(`id = "${id}"`);
    return true;
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    const table = await this.ensureTable();
    const embeddingService = getEmbeddingService();
    const queryVector = await embeddingService.embed(query);

    const results = await table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map((row) => ({
      entry: this.rowToEntry(row as unknown as MemoryRow),
      score: 1 - (row._distance ?? 0), // Convert distance to similarity
    }));
  }

  async list(category?: MemoryCategory, limit = 50): Promise<MemoryEntry[]> {
    const table = await this.ensureTable();
    let query = table.query();

    if (category) {
      query = query.where(`category = "${category}"`);
    }

    const results = await query.limit(limit).toArray();
    return results.map((row) => this.rowToEntry(row as unknown as MemoryRow));
  }

  async count(category?: MemoryCategory): Promise<number> {
    const table = await this.ensureTable();
    let query = table.query();

    if (category) {
      query = query.where(`category = "${category}"`);
    }

    const results = await query.toArray();
    return results.length;
  }

  async incrementReferenceCount(id: string): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;

    // LanceDB doesn't support UPDATE, so we delete and re-add
    const table = await this.ensureTable();
    await table.delete(`id = "${id}"`);

    const updatedInput: MemoryEntryInput = {
      content: entry.content,
      metadata: {
        ...entry.metadata,
        referenceCount: entry.metadata.referenceCount + 1,
      },
    };

    const row = await this.entryToRow(updatedInput, id);
    row.createdAt = entry.createdAt; // Preserve original creation time
    await table.add([row]);
  }

  async deleteByFile(filePath: string): Promise<number> {
    const table = await this.ensureTable();
    const existing = await table.query().where(`filePath = "${filePath}"`).toArray();

    if (existing.length > 0) {
      await table.delete(`filePath = "${filePath}"`);
    }

    return existing.length;
  }

  async addBatch(entries: MemoryEntryInput[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const entry of entries) {
      const added = await this.add(entry);
      results.push(added);
    }
    return results;
  }
}
```

**Step 5: Update src/storage/index.ts**

```typescript
export * from './embeddings';
export * from './lancedb';
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/unit/storage/lancedb.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/storage/ tests/unit/storage/lancedb.test.ts package.json package-lock.json
git commit -m "feat: add LanceDB memory repository with vector search"
```

---

### Task 8: Create metadata service [S]

**Depends on:** Task 7

**Files:**
- Create: `src/storage/meta.ts`
- Modify: `src/storage/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/storage/meta.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MetaService } from '../../../src/storage/meta';

describe('MetaService', () => {
  let tempDir: string;
  let metaService: MetaService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'meta-test-'));
    await mkdir(join(tempDir, '.claude', 'memory'), { recursive: true });
    metaService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('loads empty meta when file does not exist', async () => {
    const meta = await metaService.load();
    expect(meta.version).toBe(1);
    expect(meta.fileHashes).toEqual({});
  });

  it('saves and loads meta', async () => {
    const meta = await metaService.load();
    metaService.setFileHash('test.md', 'abc123');
    await metaService.save(meta);

    const newService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
    const loaded = await newService.load();
    expect(loaded.fileHashes['test.md']).toBe('abc123');
  });

  it('gets file hash', async () => {
    await metaService.load();
    metaService.setFileHash('file.md', 'hash123');
    expect(metaService.getFileHash('file.md')).toBe('hash123');
    expect(metaService.getFileHash('nonexistent.md')).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/storage/meta.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/storage/meta.ts**

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { FileSystemError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { IndexerMeta } from '../types/config';

const DEFAULT_META: IndexerMeta = {
  version: 1,
  lastIndexedAt: '',
  fileHashes: {},
  discovery: {
    complete: false,
  },
};

export class MetaService {
  private metaPath: string;
  private meta: IndexerMeta | null = null;

  constructor(metaPath: string) {
    this.metaPath = metaPath;
  }

  async load(): Promise<IndexerMeta> {
    if (this.meta) return this.meta;

    try {
      const content = await readFile(this.metaPath, 'utf-8');
      this.meta = JSON.parse(content) as IndexerMeta;
      return this.meta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('Meta file not found, using defaults');
        this.meta = { ...DEFAULT_META };
        return this.meta;
      }
      throw new FileSystemError(
        `Failed to read meta file: ${(error as Error).message}`,
        this.metaPath
      );
    }
  }

  async save(meta: IndexerMeta): Promise<void> {
    try {
      await mkdir(dirname(this.metaPath), { recursive: true });
      await writeFile(this.metaPath, JSON.stringify(meta, null, 2));
      this.meta = meta;
    } catch (error) {
      throw new FileSystemError(
        `Failed to write meta file: ${(error as Error).message}`,
        this.metaPath
      );
    }
  }

  getFileHash(filePath: string): string | undefined {
    return this.meta?.fileHashes[filePath];
  }

  setFileHash(filePath: string, hash: string): void {
    if (!this.meta) {
      this.meta = { ...DEFAULT_META };
    }
    this.meta.fileHashes[filePath] = hash;
  }

  removeFileHash(filePath: string): void {
    if (this.meta) {
      delete this.meta.fileHashes[filePath];
    }
  }

  async clear(): Promise<void> {
    this.meta = { ...DEFAULT_META };
    await this.save(this.meta);
  }

  updateLastIndexedAt(): void {
    if (this.meta) {
      this.meta.lastIndexedAt = new Date().toISOString();
    }
  }
}
```

**Step 4: Update src/storage/index.ts**

```typescript
export * from './embeddings';
export * from './lancedb';
export * from './meta';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/storage/meta.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/storage/meta.ts tests/unit/storage/meta.test.ts
git commit -m "feat: add metadata service for incremental indexing"
```

---

## Milestone 3: Markdown Indexer

### Task 9: Create markdown parser [M]

**Depends on:** Task 8

**Files:**
- Create: `src/indexer/parser.ts`
- Create: `src/indexer/index.ts`
- Modify: `package.json` (add marked, gray-matter)

**Step 1: Install dependencies**

Run: `npm install marked gray-matter`
Expected: Packages added to dependencies

**Step 2: Write the failing test**

Create `tests/unit/indexer/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdown, chunkByHeaders } from '../../../src/indexer/parser';

describe('parseMarkdown', () => {
  it('extracts frontmatter', () => {
    const md = `---
title: Test Doc
category: architecture
---
# Content here`;
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({ title: 'Test Doc', category: 'architecture' });
  });

  it('handles missing frontmatter', () => {
    const md = '# Just content\nSome text';
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toContain('Just content');
  });
});

describe('chunkByHeaders', () => {
  it('splits on H3 headers', () => {
    const content = `
### First Section
Content for first section.

### Second Section
Content for second section.
`;
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('First Section');
    expect(chunks[0].content).toContain('Content for first section');
    expect(chunks[1].title).toBe('Second Section');
  });

  it('returns single chunk when no H3 headers', () => {
    const content = '# Main Title\nSome content without H3 headers.';
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe('');
  });

  it('splits oversized sections at sentence boundaries', () => {
    const longSentence = 'This is a test sentence. ';
    const longContent = `### Long Section\n${longSentence.repeat(200)}`; // >2000 chars
    const chunks = chunkByHeaders(longContent, 500);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.content.length).toBeLessThanOrEqual(550); // Allow some buffer
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/indexer/parser.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Create src/indexer/parser.ts**

```typescript
import matter from 'gray-matter';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface ContentChunk {
  title: string;
  content: string;
}

/**
 * Parse markdown file extracting frontmatter and content.
 */
export function parseMarkdown(markdown: string): ParsedMarkdown {
  const { data, content } = matter(markdown);
  return {
    frontmatter: data as Record<string, unknown>,
    content: content.trim(),
  };
}

/**
 * Split content into chunks by H3 headers.
 */
export function chunkByHeaders(content: string, maxChunkSize = 2000): ContentChunk[] {
  const h3Regex = /^###\s+(.+)$/gm;
  const chunks: ContentChunk[] = [];

  let lastIndex = 0;
  let lastTitle = '';
  let match: RegExpExecArray | null;

  // Find all H3 headers
  const matches: Array<{ title: string; index: number }> = [];
  while ((match = h3Regex.exec(content)) !== null) {
    matches.push({ title: match[1].trim(), index: match.index });
  }

  if (matches.length === 0) {
    // No H3 headers, treat entire content as one chunk
    const trimmed = content.trim();
    if (trimmed) {
      return splitLongContent({ title: '', content: trimmed }, maxChunkSize);
    }
    return [];
  }

  // Process each section
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i < matches.length - 1 ? matches[i + 1].index : content.length;

    // Get content between this header and the next
    const headerLine = content.indexOf('\n', current.index);
    const sectionContent = content.slice(headerLine + 1, nextIndex).trim();

    if (sectionContent) {
      const sectionChunks = splitLongContent(
        { title: current.title, content: sectionContent },
        maxChunkSize
      );
      chunks.push(...sectionChunks);
    }
  }

  return chunks;
}

/**
 * Split a chunk that exceeds maxChunkSize at sentence boundaries.
 */
function splitLongContent(chunk: ContentChunk, maxChunkSize: number): ContentChunk[] {
  if (chunk.content.length <= maxChunkSize) {
    return [chunk];
  }

  const sentences = chunk.content.match(/[^.!?]+[.!?]+\s*/g) || [chunk.content];
  const chunks: ContentChunk[] = [];
  let currentContent = '';
  let partNumber = 1;

  for (const sentence of sentences) {
    if (currentContent.length + sentence.length > maxChunkSize && currentContent) {
      chunks.push({
        title: chunk.title ? `${chunk.title} (Part ${partNumber})` : '',
        content: currentContent.trim(),
      });
      currentContent = sentence;
      partNumber++;
    } else {
      currentContent += sentence;
    }
  }

  if (currentContent.trim()) {
    chunks.push({
      title: chunk.title ? `${chunk.title} (Part ${partNumber})` : '',
      content: currentContent.trim(),
    });
  }

  return chunks;
}
```

**Step 5: Create src/indexer/index.ts**

```typescript
export * from './parser';
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/unit/indexer/parser.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/indexer/ tests/unit/indexer/ package.json package-lock.json
git commit -m "feat: add markdown parser with header-based chunking"
```

---

### Task 10: Create directive parser [S]

**Depends on:** Task 9

**Files:**
- Create: `src/indexer/directives.ts`
- Modify: `src/indexer/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/indexer/directives.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDirectives } from '../../../src/indexer/directives';

describe('parseDirectives', () => {
  it('parses vector-index: false', () => {
    const content = '<!-- vector-index: false -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(false);
  });

  it('parses vector-index: true', () => {
    const content = '<!-- vector-index: true -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
  });

  it('defaults vector-index to true', () => {
    const content = '# No directive here';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
  });

  it('parses keywords', () => {
    const content = '<!-- keywords: auth, jwt, security -->\n# Content';
    const result = parseDirectives(content);
    expect(result.keywords).toEqual(['auth', 'jwt', 'security']);
  });

  it('handles empty keywords', () => {
    const content = '<!-- keywords: -->\n# Content';
    const result = parseDirectives(content);
    expect(result.keywords).toEqual([]);
  });

  it('handles malformed vector-index directive', () => {
    const content = '<!-- vector-index: maybe -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
    expect(result.warnings).toContain('Invalid vector-index value: maybe');
  });

  it('parses multiple directives', () => {
    const content = `<!-- vector-index: true -->
<!-- keywords: api, rest, http -->
# Content`;
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
    expect(result.keywords).toEqual(['api', 'rest', 'http']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/indexer/directives.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/indexer/directives.ts**

```typescript
export interface DirectiveResult {
  vectorIndex: boolean;
  keywords: string[];
  warnings: string[];
}

const VECTOR_INDEX_REGEX = /<!--\s*vector-index:\s*(\w+)\s*-->/i;
const KEYWORDS_REGEX = /<!--\s*keywords:\s*(.*?)\s*-->/i;

/**
 * Parse directives from markdown content.
 */
export function parseDirectives(content: string): DirectiveResult {
  const result: DirectiveResult = {
    vectorIndex: true,
    keywords: [],
    warnings: [],
  };

  // Parse vector-index directive
  const vectorMatch = VECTOR_INDEX_REGEX.exec(content);
  if (vectorMatch) {
    const value = vectorMatch[1].toLowerCase();
    if (value === 'true') {
      result.vectorIndex = true;
    } else if (value === 'false') {
      result.vectorIndex = false;
    } else {
      result.warnings.push(`Invalid vector-index value: ${vectorMatch[1]}`);
    }
  }

  // Parse keywords directive
  const keywordsMatch = KEYWORDS_REGEX.exec(content);
  if (keywordsMatch) {
    const keywordsStr = keywordsMatch[1].trim();
    if (keywordsStr) {
      result.keywords = keywordsStr
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);
    }
  }

  return result;
}
```

**Step 4: Update src/indexer/index.ts**

```typescript
export * from './parser';
export * from './directives';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/indexer/directives.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/indexer/directives.ts tests/unit/indexer/directives.test.ts
git commit -m "feat: add directive parser for vector-index and keywords"
```

---

### Task 11: Create content hasher [S]

**Depends on:** Task 10

**Files:**
- Create: `src/indexer/hasher.ts`
- Modify: `src/indexer/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/indexer/hasher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashContent } from '../../../src/indexer/hasher';

describe('hashContent', () => {
  it('produces consistent hash for same content', () => {
    const content = 'Test content';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', () => {
    const hash1 = hashContent('Content A');
    const hash2 = hashContent('Content B');
    expect(hash1).not.toBe(hash2);
  });

  it('produces 64-character hex string (SHA-256)', () => {
    const hash = hashContent('Any content');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('normalizes line endings before hashing', () => {
    const hashCRLF = hashContent('Line1\r\nLine2');
    const hashLF = hashContent('Line1\nLine2');
    expect(hashCRLF).toBe(hashLF);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/indexer/hasher.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/indexer/hasher.ts**

```typescript
import { createHash } from 'crypto';

/**
 * Generate a SHA-256 hash of content.
 * Normalizes line endings to ensure consistent hashes across platforms.
 */
export function hashContent(content: string): string {
  // Normalize line endings to LF
  const normalized = content.replace(/\r\n/g, '\n');

  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}
```

**Step 4: Update src/indexer/index.ts**

```typescript
export * from './parser';
export * from './directives';
export * from './hasher';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/indexer/hasher.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/indexer/hasher.ts tests/unit/indexer/hasher.test.ts
git commit -m "feat: add content hasher for incremental indexing"
```

---

### Task 12: Create indexer orchestrator [M]

**Depends on:** Task 11

**Files:**
- Create: `src/indexer/orchestrator.ts`
- Modify: `src/indexer/index.ts`

**Step 1: Write the failing test**

Create `tests/integration/indexer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Indexer } from '../../src/indexer/orchestrator';
import { MemoryRepository } from '../../src/storage/lancedb';
import { MetaService } from '../../src/storage/meta';

describe('Indexer Integration', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let metaService: MetaService;
  let indexer: Indexer;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'indexer-test-'));

    // Create directory structure
    await mkdir(join(tempDir, '.claude', 'knowledge'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'memory', 'vectors'), { recursive: true });

    // Create test markdown file
    await writeFile(
      join(tempDir, '.claude', 'knowledge', 'test.md'),
      `### Authentication
JWT tokens are validated on each request.

### Database
PostgreSQL is the primary database.`
    );

    repository = new MemoryRepository(join(tempDir, '.claude', 'memory', 'vectors'));
    await repository.connect();

    metaService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));

    indexer = new Indexer({
      repository,
      metaService,
      knowledgeDir: join(tempDir, '.claude', 'knowledge'),
    });
  }, 120000);

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('indexes markdown files', async () => {
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

  it('reindexes with force flag', async () => {
    const result = await indexer.index({ force: true });
    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/indexer.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/indexer/orchestrator.ts**

```typescript
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import { MemoryRepository } from '../storage/lancedb';
import { MetaService } from '../storage/meta';
import { parseMarkdown, chunkByHeaders } from './parser';
import { parseDirectives } from './directives';
import { hashContent } from './hasher';
import { logger } from '../utils/logger';
import type { MemoryEntryInput } from '../types/memory';

export interface IndexerConfig {
  repository: MemoryRepository;
  metaService: MetaService;
  knowledgeDir: string;
  chunkSize?: number;
}

export interface IndexOptions {
  force?: boolean;
  dryRun?: boolean;
  onProgress?: (progress: IndexProgress) => void;
}

export interface IndexProgress {
  current: number;
  total: number;
  file: string;
}

export interface IndexError {
  file: string;
  error: string;
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

export class Indexer {
  private repository: MemoryRepository;
  private metaService: MetaService;
  private knowledgeDir: string;
  private chunkSize: number;

  constructor(config: IndexerConfig) {
    this.repository = config.repository;
    this.metaService = config.metaService;
    this.knowledgeDir = config.knowledgeDir;
    this.chunkSize = config.chunkSize ?? 2000;
  }

  async index(options: IndexOptions = {}): Promise<IndexResult> {
    const startTime = Date.now();
    const result: IndexResult = {
      filesProcessed: 0,
      filesSkipped: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesDeleted: 0,
      errors: [],
      durationMs: 0,
    };

    // Load metadata
    const meta = await this.metaService.load();

    // Find all markdown files
    const files = await this.findMarkdownFiles(this.knowledgeDir);
    logger.info(`Found ${files.length} markdown files`);

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = relative(this.knowledgeDir, file);

      options.onProgress?.({
        current: i + 1,
        total: files.length,
        file: relativePath,
      });

      try {
        const content = await readFile(file, 'utf-8');
        const contentHash = hashContent(content);

        // Check if file has changed
        if (!options.force && meta.fileHashes[relativePath] === contentHash) {
          logger.debug(`Skipping unchanged: ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        // Parse directives
        const directives = parseDirectives(content);
        if (!directives.vectorIndex) {
          logger.debug(`Skipping (vector-index: false): ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        // Log warnings
        for (const warning of directives.warnings) {
          logger.warn(`${relativePath}: ${warning}`);
        }

        // Parse and chunk content
        const parsed = parseMarkdown(content);
        const chunks = chunkByHeaders(parsed.content, this.chunkSize);

        if (chunks.length === 0) {
          logger.warn(`Empty file: ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        if (!options.dryRun) {
          // Delete existing entries for this file
          const deleted = await this.repository.deleteByFile(relativePath);
          result.entriesDeleted += deleted;

          // Add new entries
          for (const chunk of chunks) {
            const entry: MemoryEntryInput = {
              content: chunk.content,
              metadata: {
                category: (parsed.frontmatter.category as string) ?? 'general',
                source: 'markdown',
                filePath: relativePath,
                sectionTitle: chunk.title || undefined,
                keywords: directives.keywords,
              },
            };
            await this.repository.add(entry);
            result.entriesCreated++;
          }

          // Update hash
          this.metaService.setFileHash(relativePath, contentHash);
        }

        result.filesProcessed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to index ${relativePath}: ${message}`);
        result.errors.push({ file: relativePath, error: message });
      }
    }

    // Save metadata
    if (!options.dryRun) {
      this.metaService.updateLastIndexedAt();
      await this.metaService.save(meta);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.findMarkdownFiles(fullPath);
          files.push(...subFiles);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !entry.name.startsWith('_')
        ) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`Could not read directory ${dir}: ${(error as Error).message}`);
    }

    return files;
  }
}
```

**Step 4: Update src/indexer/index.ts**

```typescript
export * from './parser';
export * from './directives';
export * from './hasher';
export * from './orchestrator';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/integration/indexer.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/indexer/orchestrator.ts tests/integration/indexer.test.ts
git commit -m "feat: add indexer orchestrator for markdown-to-vector sync"
```

---

## Milestone 4: MCP Server

### Task 13: Create MCP server with memory_search tool [M]

**Depends on:** Task 12

**Files:**
- Create: `src/server/index.ts`
- Create: `src/server/tools/memory-search.ts`
- Modify: `package.json` (add @modelcontextprotocol/sdk, zod)

**Step 1: Install dependencies**

Run: `npm install @modelcontextprotocol/sdk zod`
Expected: Packages added to dependencies

**Step 2: Write the failing test**

Create `tests/unit/server/memory-search.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemorySearch } from '../../../src/server/tools/memory-search';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_search tool', () => {
  let tempDir: string;
  let repository: MemoryRepository;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'search-test-'));
    await mkdir(join(tempDir, 'vectors'), { recursive: true });

    repository = new MemoryRepository(join(tempDir, 'vectors'));
    await repository.connect();

    // Add test data
    await repository.add({
      content: 'JWT tokens are used for authentication',
      metadata: { category: 'architecture' },
    });
    await repository.add({
      content: 'PostgreSQL is our primary database',
      metadata: { category: 'architecture' },
    });
  }, 120000);

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('returns matching results', async () => {
    const result = await handleMemorySearch(
      { query: 'how does authentication work' },
      repository
    );
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toContain('authentication');
  });

  it('respects limit parameter', async () => {
    const result = await handleMemorySearch(
      { query: 'architecture', limit: 1 },
      repository
    );
    expect(result.results).toHaveLength(1);
  });

  it('returns error for empty query', async () => {
    const result = await handleMemorySearch({ query: '' }, repository);
    expect(result.error).toBe('Query cannot be empty');
  });

  it('returns empty array for no matches', async () => {
    const result = await handleMemorySearch(
      { query: 'quantum physics relativity' },
      repository
    );
    expect(result.results).toEqual([]);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/server/memory-search.test.ts`
Expected: FAIL with "Cannot find module"

**Step 4: Create src/server/tools/memory-search.ts**

```typescript
import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

export const memorySearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(20).default(5),
  category: z
    .enum([
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ])
    .optional(),
});

export type MemorySearchInput = z.infer<typeof memorySearchSchema>;

export interface MemorySearchOutput {
  results: Array<{
    id: string;
    content: string;
    score: number;
    category: string;
    source: string;
    filePath?: string;
  }>;
  query: string;
  count: number;
  error?: string;
  code?: string;
}

export async function handleMemorySearch(
  input: { query: string; limit?: number; category?: string },
  repository: MemoryRepository
): Promise<MemorySearchOutput> {
  // Validate input
  if (!input.query || input.query.trim() === '') {
    return {
      results: [],
      query: '',
      count: 0,
      error: 'Query cannot be empty',
      code: 'INVALID_INPUT',
    };
  }

  const limit = input.limit ?? 5;
  const searchResults = await repository.search(input.query, limit);

  // Filter by category if specified
  let filteredResults = searchResults;
  if (input.category) {
    filteredResults = searchResults.filter(
      (r) => r.entry.metadata.category === input.category
    );
  }

  // Increment reference counts
  for (const result of filteredResults) {
    await repository.incrementReferenceCount(result.entry.id);
  }

  return {
    results: filteredResults.map((r) => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score,
      category: r.entry.metadata.category,
      source: r.entry.metadata.source,
      filePath: r.entry.metadata.filePath,
    })),
    query: input.query,
    count: filteredResults.length,
  };
}

export const memorySearchToolDefinition = {
  name: 'memory_search',
  description:
    'Search project memory using semantic similarity. Returns relevant knowledge entries.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
        minLength: 1,
        maxLength: 500,
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 5, max: 20)',
        minimum: 1,
        maximum: 20,
        default: 5,
      },
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: [
          'architecture',
          'component',
          'domain',
          'pattern',
          'gotcha',
          'discovery',
          'general',
        ],
      },
    },
    required: ['query'],
  },
};
```

**Step 5: Create src/server/index.ts**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryRepository } from '../storage/lancedb';
import {
  handleMemorySearch,
  memorySearchToolDefinition,
} from './tools/memory-search';
import { logger } from '../utils/logger';

export interface ServerConfig {
  vectorsDir: string;
  testMode?: boolean;
}

export class MemoryServer {
  private server: Server;
  private repository: MemoryRepository;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.repository = new MemoryRepository(config.vectorsDir);

    this.server = new Server(
      { name: 'claude-memory', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [memorySearchToolDefinition],
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'memory_search': {
            const result = await handleMemorySearch(
              args as { query: string; limit?: number; category?: string },
              this.repository
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !!result.error,
            };
          }
          default:
            return {
              content: [
                { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
              ],
              isError: true,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: message, code: 'INTERNAL_ERROR' }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async start(): Promise<void> {
    await this.repository.connect();
    logger.info('Memory repository connected');

    if (!this.config.testMode) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('MCP server started');
    }
  }

  async stop(): Promise<void> {
    await this.repository.disconnect();
    await this.server.close();
  }

  // For testing
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'memory_search':
        return handleMemorySearch(
          args as { query: string; limit?: number },
          this.repository
        );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/unit/server/memory-search.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/server/ tests/unit/server/ package.json package-lock.json
git commit -m "feat: add MCP server with memory_search tool"
```

---

### Task 14: Add memory_add tool [S]

**Depends on:** Task 13

**Files:**
- Create: `src/server/tools/memory-add.ts`
- Modify: `src/server/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/server/memory-add.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemoryAdd } from '../../../src/server/tools/memory-add';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_add tool', () => {
  let tempDir: string;
  let repository: MemoryRepository;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'add-test-'));
    await mkdir(join(tempDir, 'vectors'), { recursive: true });
  }, 120000);

  beforeEach(async () => {
    repository = new MemoryRepository(join(tempDir, 'vectors'));
    await repository.connect();
  });

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('adds entry with content and category', async () => {
    const result = await handleMemoryAdd(
      { content: 'Test content', category: 'architecture' },
      repository
    );
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('defaults category to general', async () => {
    const result = await handleMemoryAdd({ content: 'Test content' }, repository);
    expect(result.success).toBe(true);

    const entry = await repository.get(result.id!);
    expect(entry?.metadata.category).toBe('general');
  });

  it('returns error for empty content', async () => {
    const result = await handleMemoryAdd({ content: '' }, repository);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Content is required');
  });

  it('returns error for content exceeding limit', async () => {
    const longContent = 'x'.repeat(10001);
    const result = await handleMemoryAdd({ content: longContent }, repository);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds maximum length');
  });

  it('accepts keywords array', async () => {
    const result = await handleMemoryAdd(
      { content: 'Test', keywords: ['auth', 'jwt'] },
      repository
    );
    expect(result.success).toBe(true);

    const entry = await repository.get(result.id!);
    expect(entry?.metadata.keywords).toEqual(['auth', 'jwt']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/server/memory-add.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create src/server/tools/memory-add.ts**

```typescript
import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

const MAX_CONTENT_LENGTH = 10000;

export const memoryAddSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  category: z
    .enum([
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ])
    .default('general'),
  keywords: z.array(z.string()).max(10).optional(),
});

export type MemoryAddInput = z.infer<typeof memoryAddSchema>;

export interface MemoryAddOutput {
  success: boolean;
  id?: string;
  message?: string;
  error?: string;
  code?: string;
}

export async function handleMemoryAdd(
  input: { content: string; category?: string; keywords?: string[] },
  repository: MemoryRepository
): Promise<MemoryAddOutput> {
  // Validate content
  if (!input.content || input.content.trim() === '') {
    return {
      success: false,
      error: 'Content is required',
      code: 'INVALID_INPUT',
    };
  }

  if (input.content.length > MAX_CONTENT_LENGTH) {
    return {
      success: false,
      error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`,
      code: 'CONTENT_TOO_LONG',
    };
  }

  // Validate category
  const validCategories = [
    'architecture',
    'component',
    'domain',
    'pattern',
    'gotcha',
    'discovery',
    'general',
  ];
  const category = validCategories.includes(input.category ?? '')
    ? (input.category as MemoryCategory)
    : 'general';

  const entry = await repository.add({
    content: input.content,
    metadata: {
      category,
      source: 'session',
      keywords: input.keywords ?? [],
    },
  });

  return {
    success: true,
    id: entry.id,
    message: 'Entry added to memory',
  };
}

export const memoryAddToolDefinition = {
  name: 'memory_add',
  description: 'Add a new knowledge entry to project memory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description: 'The knowledge content to store',
        minLength: 1,
        maxLength: MAX_CONTENT_LENGTH,
      },
      category: {
        type: 'string',
        description: 'Entry category (default: general)',
        enum: [
          'architecture',
          'component',
          'domain',
          'pattern',
          'gotcha',
          'discovery',
          'general',
        ],
        default: 'general',
      },
      keywords: {
        type: 'array',
        description: 'Keywords for search boosting',
        items: { type: 'string' },
        maxItems: 10,
      },
    },
    required: ['content'],
  },
};
```

**Step 4: Update src/server/index.ts to include memory_add**

Add import and handler for memory_add tool (add to existing file).

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/server/memory-add.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/server/tools/memory-add.ts tests/unit/server/memory-add.test.ts src/server/index.ts
git commit -m "feat: add memory_add MCP tool"
```

---

### Task 15: Add memory_list tool [S]

**Depends on:** Task 14

**Files:**
- Create: `src/server/tools/memory-list.ts`
- Modify: `src/server/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/server/memory-list.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemoryList } from '../../../src/server/tools/memory-list';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_list tool', () => {
  let tempDir: string;
  let repository: MemoryRepository;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'list-test-'));
    await mkdir(join(tempDir, 'vectors'), { recursive: true });

    repository = new MemoryRepository(join(tempDir, 'vectors'));
    await repository.connect();

    await repository.add({
      content: 'Architecture content',
      metadata: { category: 'architecture' },
    });
    await repository.add({
      content: 'Pattern content',
      metadata: { category: 'pattern' },
    });
  }, 120000);

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('lists all entries without category filter', async () => {
    const result = await handleMemoryList({}, repository);
    expect(result.entries.length).toBe(2);
  });

  it('filters by category', async () => {
    const result = await handleMemoryList({ category: 'architecture' }, repository);
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].category).toBe('architecture');
  });

  it('respects limit parameter', async () => {
    const result = await handleMemoryList({ limit: 1 }, repository);
    expect(result.entries.length).toBe(1);
  });

  it('returns empty array for nonexistent category', async () => {
    const result = await handleMemoryList({ category: 'gotcha' }, repository);
    expect(result.entries).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/server/memory-list.test.ts`
Expected: FAIL

**Step 3: Create src/server/tools/memory-list.ts**

```typescript
import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

export const memoryListSchema = z.object({
  category: z
    .enum([
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ])
    .optional(),
  limit: z.number().min(1).max(100).default(50),
});

export type MemoryListInput = z.infer<typeof memoryListSchema>;

export interface MemoryListOutput {
  entries: Array<{
    id: string;
    content: string;
    category: string;
    createdAt: string;
  }>;
  count: number;
  category?: string;
}

export async function handleMemoryList(
  input: { category?: string; limit?: number },
  repository: MemoryRepository
): Promise<MemoryListOutput> {
  const limit = input.limit ?? 50;
  const category = input.category as MemoryCategory | undefined;

  const entries = await repository.list(category, limit);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      content: e.content,
      category: e.metadata.category,
      createdAt: e.createdAt,
    })),
    count: entries.length,
    category: input.category,
  };
}

export const memoryListToolDefinition = {
  name: 'memory_list',
  description: 'List memory entries, optionally filtered by category.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (omit for all)',
        enum: [
          'architecture',
          'component',
          'domain',
          'pattern',
          'gotcha',
          'discovery',
          'general',
        ],
      },
      limit: {
        type: 'number',
        description: 'Maximum entries to return (default: 50)',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
    },
  },
};
```

**Step 4: Update src/server/index.ts**

Add memory_list to handlers.

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/server/memory-list.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/server/tools/memory-list.ts tests/unit/server/memory-list.test.ts src/server/index.ts
git commit -m "feat: add memory_list MCP tool"
```

---

### Task 16: Add memory_delete tool [S]

**Depends on:** Task 15

**Files:**
- Create: `src/server/tools/memory-delete.ts`
- Modify: `src/server/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/server/memory-delete.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemoryDelete } from '../../../src/server/tools/memory-delete';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_delete tool', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let testEntryId: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'delete-test-'));
    await mkdir(join(tempDir, 'vectors'), { recursive: true });
  }, 120000);

  beforeEach(async () => {
    repository = new MemoryRepository(join(tempDir, 'vectors'));
    await repository.connect();

    const entry = await repository.add({ content: 'To be deleted' });
    testEntryId = entry.id;
  });

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('deletes existing entry', async () => {
    const result = await handleMemoryDelete({ id: testEntryId }, repository);
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(testEntryId);

    const entry = await repository.get(testEntryId);
    expect(entry).toBeNull();
  });

  it('returns not found for nonexistent entry', async () => {
    const result = await handleMemoryDelete({ id: 'nonexistent' }, repository);
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe('Entry not found');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/server/memory-delete.test.ts`
Expected: FAIL

**Step 3: Create src/server/tools/memory-delete.ts**

```typescript
import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';

export const memoryDeleteSchema = z.object({
  id: z.string().min(1),
});

export type MemoryDeleteInput = z.infer<typeof memoryDeleteSchema>;

export interface MemoryDeleteOutput {
  deleted: boolean;
  id: string;
  reason?: string;
}

export async function handleMemoryDelete(
  input: { id: string },
  repository: MemoryRepository
): Promise<MemoryDeleteOutput> {
  const deleted = await repository.delete(input.id);

  if (deleted) {
    return { deleted: true, id: input.id };
  }

  return {
    deleted: false,
    id: input.id,
    reason: 'Entry not found',
  };
}

export const memoryDeleteToolDefinition = {
  name: 'memory_delete',
  description: 'Delete a memory entry by ID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to delete',
      },
    },
    required: ['id'],
  },
};
```

**Step 4: Update src/server/index.ts**

Add memory_delete to handlers.

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/server/memory-delete.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/server/tools/memory-delete.ts tests/unit/server/memory-delete.test.ts src/server/index.ts
git commit -m "feat: add memory_delete MCP tool"
```

---

## Milestone 5: CLI Commands

### Task 17: Create CLI framework with init command [M]

**Depends on:** Task 16

**Files:**
- Modify: `bin/cli.ts`
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/init.ts`
- Modify: `package.json` (add commander)

**Step 1: Install dependencies**

Run: `npm install commander`
Expected: Package added

**Step 2: Create src/cli/commands/init.ts**

```typescript
import { mkdir, writeFile, copyFile, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { logger } from '../../utils/logger';

export interface InitOptions {
  force?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

export async function initCommand(
  targetDir: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const result: InitResult = { created: [], skipped: [], errors: [] };
  const claudeDir = join(targetDir, '.claude');

  // Create directory structure
  const dirs = [
    join(claudeDir, 'knowledge', 'architecture'),
    join(claudeDir, 'knowledge', 'components'),
    join(claudeDir, 'knowledge', 'domain'),
    join(claudeDir, 'knowledge', 'patterns'),
    join(claudeDir, 'memory', 'vectors'),
    join(claudeDir, 'skills'),
  ];

  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
      result.created.push(dir);
    } catch (error) {
      result.errors.push(`Failed to create ${dir}: ${(error as Error).message}`);
    }
  }

  // Create gotchas.md template
  const gotchasPath = join(claudeDir, 'knowledge', 'gotchas.md');
  if (!existsSync(gotchasPath) || options.force) {
    const gotchasContent = `# Gotchas and Known Issues

<!-- vector-index: true -->
<!-- keywords: gotcha, issue, known, bug -->

### Example Gotcha

Description of a non-obvious behavior or common mistake.

**Symptom:** What you observe when this happens.

**Cause:** Why this happens.

**Solution:** How to fix or avoid it.
`;
    await writeFile(gotchasPath, gotchasContent);
    result.created.push(gotchasPath);
  } else {
    result.skipped.push(gotchasPath);
  }

  // Create settings.json for MCP registration
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(settingsPath) || options.force) {
    const settings = {
      mcpServers: {
        'claude-memory': {
          command: 'npx',
          args: ['claude-memory', 'serve'],
        },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    result.created.push(settingsPath);
  } else {
    result.skipped.push(settingsPath);
  }

  return result;
}
```

**Step 3: Create src/cli/index.ts**

```typescript
import { Command } from 'commander';
import { initCommand } from './commands/init';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('claude-memory')
    .description('Local knowledge tier system for Claude Code')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize claude-memory in the current repository')
    .option('-f, --force', 'Overwrite existing files')
    .action(async (options) => {
      const cwd = process.cwd();
      console.log('Initializing claude-memory...\n');

      const result = await initCommand(cwd, { force: options.force });

      if (result.created.length > 0) {
        console.log('Created:');
        result.created.forEach((f) => console.log(`  + ${f}`));
      }

      if (result.skipped.length > 0) {
        console.log('\nSkipped (already exist):');
        result.skipped.forEach((f) => console.log(`  - ${f}`));
      }

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach((e) => console.log(`  ! ${e}`));
        process.exit(1);
      }

      console.log('\nInitialization complete!');
      console.log('Next steps:');
      console.log('  1. Add knowledge to .claude/knowledge/');
      console.log('  2. Run: npx claude-memory index');
      console.log('  3. Use memory_search in Claude Code');
    });

  return program;
}
```

**Step 4: Update bin/cli.ts**

```typescript
#!/usr/bin/env node

import { createCLI } from '../src/cli/index.js';

const program = createCLI();
program.parse();
```

**Step 5: Build and test CLI**

Run: `npm run build && node dist/bin/cli.js init --help`
Expected: Shows init command help

**Step 6: Commit**

```bash
git add bin/cli.ts src/cli/ package.json package-lock.json
git commit -m "feat: add CLI framework with init command"
```

---

### Task 18: Add index CLI command [S]

**Depends on:** Task 17

**Files:**
- Create: `src/cli/commands/index-cmd.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create src/cli/commands/index-cmd.ts**

```typescript
import { join } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb';
import { MetaService } from '../../storage/meta';
import { Indexer } from '../../indexer/orchestrator';

export interface IndexCmdOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function indexCommand(
  targetDir: string,
  options: IndexCmdOptions = {}
): Promise<void> {
  const knowledgeDir = join(targetDir, '.claude', 'knowledge');
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');
  const metaPath = join(targetDir, '.claude', 'memory', 'meta.json');

  if (!existsSync(knowledgeDir)) {
    console.error('Knowledge directory not found. Run "claude-memory init" first.');
    process.exit(1);
  }

  console.log('Indexing knowledge files...\n');

  const repository = new MemoryRepository(vectorsDir);
  await repository.connect();

  const metaService = new MetaService(metaPath);
  const indexer = new Indexer({ repository, metaService, knowledgeDir });

  const result = await indexer.index({
    force: options.force,
    dryRun: options.dryRun,
    onProgress: (progress) => {
      process.stdout.write(`\rProcessing: ${progress.current}/${progress.total} - ${progress.file}`);
    },
  });

  await repository.disconnect();

  console.log('\n\nIndexing complete!');
  console.log(`  Files processed: ${result.filesProcessed}`);
  console.log(`  Files skipped: ${result.filesSkipped}`);
  console.log(`  Entries created: ${result.entriesCreated}`);
  console.log(`  Duration: ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((e) => console.log(`  ! ${e.file}: ${e.error}`));
    process.exit(2);
  }
}
```

**Step 2: Update src/cli/index.ts**

Add index command:

```typescript
program
  .command('index')
  .description('Index markdown files to vector database')
  .option('-f, --force', 'Reindex all files (ignore cache)')
  .option('--dry-run', 'Show what would be indexed without indexing')
  .action(async (options) => {
    await indexCommand(process.cwd(), {
      force: options.force,
      dryRun: options.dryRun,
    });
  });
```

**Step 3: Build and test**

Run: `npm run build && node dist/bin/cli.js index --help`
Expected: Shows index command help

**Step 4: Commit**

```bash
git add src/cli/commands/index-cmd.ts src/cli/index.ts
git commit -m "feat: add index CLI command"
```

---

### Task 19: Add search CLI command [S]

**Depends on:** Task 18

**Files:**
- Create: `src/cli/commands/search.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create src/cli/commands/search.ts**

```typescript
import { join } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb';

export interface SearchCmdOptions {
  limit?: number;
  json?: boolean;
}

export async function searchCommand(
  query: string,
  targetDir: string,
  options: SearchCmdOptions = {}
): Promise<void> {
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');

  if (!existsSync(vectorsDir)) {
    console.error('Vector database not found. Run "claude-memory index" first.');
    process.exit(1);
  }

  const repository = new MemoryRepository(vectorsDir);
  await repository.connect();

  const limit = options.limit ?? 5;
  const results = await repository.search(query, limit);

  await repository.disconnect();

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No results found for: ${query}`);
    return;
  }

  console.log(`Results for: "${query}"\n`);
  results.forEach((r, i) => {
    const preview = r.entry.content.slice(0, 100).replace(/\n/g, ' ');
    console.log(`${i + 1}. [${r.score.toFixed(2)}] ${r.entry.metadata.filePath || 'manual entry'}`);
    console.log(`   ${preview}...`);
    console.log();
  });
}
```

**Step 2: Update src/cli/index.ts**

Add search command.

**Step 3: Build and test**

Run: `npm run build && node dist/bin/cli.js search --help`
Expected: Shows search command help

**Step 4: Commit**

```bash
git add src/cli/commands/search.ts src/cli/index.ts
git commit -m "feat: add search CLI command"
```

---

### Task 20: Add serve CLI command for MCP server [S]

**Depends on:** Task 19

**Files:**
- Create: `src/cli/commands/serve.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create src/cli/commands/serve.ts**

```typescript
import { join } from 'path';
import { MemoryServer } from '../../server';

export async function serveCommand(targetDir: string): Promise<void> {
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');

  const server = new MemoryServer({ vectorsDir });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}
```

**Step 2: Update src/cli/index.ts**

Add serve command.

**Step 3: Build and test**

Run: `npm run build && node dist/bin/cli.js serve --help`
Expected: Shows serve command help

**Step 4: Commit**

```bash
git add src/cli/commands/serve.ts src/cli/index.ts
git commit -m "feat: add serve CLI command for MCP server"
```

---

## Milestone 6: Templates and Final Integration

### Task 21: Create init templates [S]

**Depends on:** Task 20

**Files:**
- Create: `templates/knowledge/architecture/.gitkeep`
- Create: `templates/knowledge/components/.gitkeep`
- Create: `templates/knowledge/domain/.gitkeep`
- Create: `templates/knowledge/patterns/.gitkeep`
- Create: `templates/knowledge/gotchas.md`
- Create: `templates/skills/memory-discover.md`
- Create: `templates/skills/memory-query.md`
- Create: `templates/skills/memory-save.md`
- Create: `templates/settings.json`

**Step 1: Create template files**

Create directory structure and template files as specified in the architecture.

**Step 2: Update init command to copy templates**

Modify `src/cli/commands/init.ts` to copy from templates/ if available.

**Step 3: Build and test**

Run: `npm run build && node dist/bin/cli.js init` in a test directory.
Expected: Templates are copied correctly.

**Step 4: Commit**

```bash
git add templates/
git commit -m "feat: add init templates for knowledge, skills, and settings"
```

---

### Task 22: Update package exports and final integration [S]

**Depends on:** Task 21

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`

**Step 1: Update src/index.ts for complete exports**

```typescript
// Core types
export * from './types';

// Utilities
export * from './utils';

// Storage layer
export { MemoryRepository } from './storage/lancedb';
export { EmbeddingService, getEmbeddingService } from './storage/embeddings';
export { MetaService } from './storage/meta';

// Indexer
export { Indexer } from './indexer/orchestrator';
export { parseMarkdown, chunkByHeaders } from './indexer/parser';
export { parseDirectives } from './indexer/directives';
export { hashContent } from './indexer/hasher';

// Server
export { MemoryServer } from './server';
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Build final package**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat: finalize package exports and integration"
```

---

### Task 23: Add add CLI command [S]

**Depends on:** Task 22

**Files:**
- Create: `src/cli/commands/add.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create src/cli/commands/add.ts**

```typescript
import { join } from 'path';
import { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

export interface AddCmdOptions {
  category?: string;
}

const VALID_CATEGORIES: MemoryCategory[] = [
  'architecture',
  'component',
  'domain',
  'pattern',
  'gotcha',
  'discovery',
  'general',
];

export async function addCommand(
  content: string,
  targetDir: string,
  options: AddCmdOptions = {}
): Promise<void> {
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');

  const category = VALID_CATEGORIES.includes(options.category as MemoryCategory)
    ? (options.category as MemoryCategory)
    : 'general';

  const repository = new MemoryRepository(vectorsDir);
  await repository.connect();

  const entry = await repository.add({
    content,
    metadata: { category, source: 'manual' },
  });

  await repository.disconnect();

  console.log(`Entry added with ID: ${entry.id}`);
}
```

**Step 2: Update src/cli/index.ts**

Add add command.

**Step 3: Commit**

```bash
git add src/cli/commands/add.ts src/cli/index.ts
git commit -m "feat: add add CLI command for manual entries"
```

---

## Parallelizable Task Groups

The following tasks can be executed in parallel by separate subagents:

**Group A (after Task 5):**
- Task 6 (Embeddings) - no dependencies on other tasks
- Task 9 (Parser) - only needs basic types

**Group B (after Task 12):**
- Task 13-16 (MCP tools) can be developed in parallel once storage is ready

**Group C (after Task 16):**
- Task 17-20 (CLI commands) can be developed in parallel

---

## Dependency Graph

```
Task 1 (npm init)
    └── Task 2 (build tools)
        └── Task 3 (types)
            └── Task 4 (utils)
                └── Task 5 (entry point)
                    ├── Task 6 (embeddings)
                    │   └── Task 7 (lancedb)
                    │       └── Task 8 (meta)
                    │           └── Task 12 (indexer orchestrator)
                    │               └── Task 13 (MCP server)
                    │                   ├── Task 14 (memory_add)
                    │                   ├── Task 15 (memory_list)
                    │                   └── Task 16 (memory_delete)
                    │                       └── Task 17 (CLI init)
                    │                           ├── Task 18 (CLI index)
                    │                           ├── Task 19 (CLI search)
                    │                           ├── Task 20 (CLI serve)
                    │                           └── Task 23 (CLI add)
                    │                               └── Task 21 (templates)
                    │                                   └── Task 22 (final)
                    └── Task 9 (parser)
                        └── Task 10 (directives)
                            └── Task 11 (hasher)
```
