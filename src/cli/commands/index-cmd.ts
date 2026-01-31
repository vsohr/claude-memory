import { join } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb.js';
import { MetaService } from '../../storage/meta.js';
import { Indexer } from '../../indexer/orchestrator.js';

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
