import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemorySearch } from '../../../src/server/tools/memory-search';
import { MemoryRepository } from '../../../src/storage/lancedb';
import { FtsStore } from '../../../src/storage/fts';
import { HybridSearch } from '../../../src/storage/hybrid';
import { DEFAULTS } from '../../../src/utils/config';

describe('memory_search tool', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let ftsStore: FtsStore;
  let hybridSearch: HybridSearch;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'search-test-'));
    await mkdir(join(tempDir, 'vectors'), { recursive: true });

    repository = new MemoryRepository(join(tempDir, 'vectors'));
    await repository.connect();

    ftsStore = new FtsStore(join(tempDir, 'fts.sqlite'));
    ftsStore.open();

    hybridSearch = new HybridSearch(repository, ftsStore, DEFAULTS);

    // Add test data
    const entry1 = await repository.add({
      content: 'JWT tokens are used for authentication',
      metadata: { category: 'architecture' },
    });
    ftsStore.add(entry1);

    const entry2 = await repository.add({
      content: 'PostgreSQL is our primary database',
      metadata: { category: 'architecture' },
    });
    ftsStore.add(entry2);
  }, 120000);

  afterAll(async () => {
    ftsStore?.close();
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('returns matching results', async () => {
    const result = await handleMemorySearch(
      { query: 'how does authentication work' },
      hybridSearch
    );
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toContain('authentication');
  });

  it('respects limit parameter', async () => {
    const result = await handleMemorySearch(
      { query: 'database or authentication', limit: 1 },
      hybridSearch
    );
    expect(result.results).toHaveLength(1);
  });

  it('returns error for empty query', async () => {
    const result = await handleMemorySearch({ query: '' }, hybridSearch);
    expect(result.error).toBe('Query cannot be empty');
  });

  it('returns empty array for no matches', async () => {
    const result = await handleMemorySearch(
      { query: 'quantum physics relativity', mode: 'vector' },
      hybridSearch
    );
    expect(result.results).toEqual([]);
  });
});
