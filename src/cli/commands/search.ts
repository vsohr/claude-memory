import { join } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb.js';
import { HybridSearch } from '../../storage/hybrid.js';
import { FtsStore } from '../../storage/fts.js';
import { loadConfig } from '../../utils/config.js';
import { createFormatter } from '../formatters.js';
import type { OutputFormat } from '../formatters.js';
import type { SearchMode } from '../../types/memory.js';

export interface SearchCmdOptions {
  limit?: number;
  json?: boolean;
  format?: OutputFormat;
  mode?: SearchMode;
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

  const config = loadConfig(targetDir);

  const repository = new MemoryRepository(vectorsDir);
  await repository.connect();

  const ftsPath = join(targetDir, '.claude', 'memory', config.ftsDbName);
  const ftsStore = new FtsStore(ftsPath);
  ftsStore.open();

  const hybridSearch = new HybridSearch(repository, ftsStore, config);

  const limit = options.limit ?? 5;
  const results = await hybridSearch.search({
    query,
    limit,
    mode: options.mode ?? config.defaultSearchMode,
  });

  ftsStore.close();
  await repository.disconnect();

  const format: OutputFormat = options.format ?? (options.json ? 'json' : 'text');
  const formatter = createFormatter(format);
  console.log(formatter.format(results, query));
}
