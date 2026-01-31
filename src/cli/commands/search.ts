import { join } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb.js';

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
