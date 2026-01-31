import { join } from 'path';
import { MemoryRepository } from '../../storage/lancedb.js';
import type { MemoryCategory } from '../../types/memory.js';

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
