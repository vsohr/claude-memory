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
