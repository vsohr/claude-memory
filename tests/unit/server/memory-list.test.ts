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
