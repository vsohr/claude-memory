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
