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
      { query: 'database or authentication', limit: 1 },
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
