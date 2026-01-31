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
export type { IndexerConfig, IndexOptions, IndexProgress, IndexResult, IndexError } from './indexer/orchestrator';
export { parseMarkdown, chunkByHeaders } from './indexer/parser';
export type { ParsedMarkdown, ContentChunk } from './indexer/parser';
export { parseDirectives } from './indexer/directives';
export type { DirectiveResult } from './indexer/directives';
export { hashContent } from './indexer/hasher';
