// Core types
export * from './types';

// Utilities
export * from './utils';

// Storage layer
export { MemoryRepository } from './storage/lancedb';
export { EmbeddingService, getEmbeddingService } from './storage/embeddings';
export { MetaService } from './storage/meta';

// FTS Store
export { FtsStore } from './storage/fts';
export type { FtsSearchResult, FtsEntry } from './storage/fts';

// Hybrid Search
export { HybridSearch } from './storage/hybrid';
export type { HybridSearchOptions } from './storage/hybrid';

// Config (also re-exported via ./utils, explicit for clarity)
export { loadConfig } from './utils/config';
export type { MemoryConfigResolved, MemoryConfigFile } from './utils/config';

// Formatters
export { createFormatter } from './cli/formatters';
export type { OutputFormat, OutputFormatter, SearchResultRow } from './cli/formatters';

// Indexer
export { Indexer } from './indexer/orchestrator';
export type { IndexerConfig, IndexOptions, IndexProgress, IndexResult, IndexError } from './indexer/orchestrator';
export { parseMarkdown, chunkByHeaders } from './indexer/parser';
export type { ParsedMarkdown, ContentChunk, ChunkOptions } from './indexer/parser';
export { parseDirectives } from './indexer/directives';
export type { DirectiveResult } from './indexer/directives';
export { hashContent } from './indexer/hasher';
