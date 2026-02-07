import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridSearch } from '../../../src/storage/hybrid';
import type { HybridSearchOptions } from '../../../src/storage/hybrid';
import type { MemoryRepository } from '../../../src/storage/lancedb';
import type { FtsStore, FtsSearchResult } from '../../../src/storage/fts';
import type { MemoryConfigResolved } from '../../../src/utils/config';
import type { MemoryEntry, MemorySearchResult, MemoryCategory } from '../../../src/types/memory';

/**
 * Helper to create a MemoryEntry for testing.
 */
function createEntry(id: string, category: MemoryCategory = 'general'): MemoryEntry {
  return {
    id,
    content: `Content for ${id}`,
    metadata: {
      category,
      source: 'manual',
      keywords: [],
      referenceCount: 0,
      promoted: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Helper to create a MemorySearchResult (vector search result).
 */
function createSearchResult(id: string, score: number, category: MemoryCategory = 'general'): MemorySearchResult {
  return {
    entry: createEntry(id, category),
    score,
  };
}

/**
 * Default resolved config for testing.
 */
function createConfig(overrides: Partial<MemoryConfigResolved> = {}): MemoryConfigResolved {
  return {
    minScore: -0.5,
    chunkOverlapPercent: 15,
    chunkSize: 2000,
    defaultSearchMode: 'hybrid',
    ftsDbName: 'fts.sqlite',
    ...overrides,
  };
}

describe('HybridSearch', () => {
  let mockRepo: MemoryRepository;
  let mockFts: FtsStore;
  let config: MemoryConfigResolved;

  beforeEach(() => {
    mockRepo = {
      search: vi.fn<(query: string, limit?: number) => Promise<MemorySearchResult[]>>()
        .mockResolvedValue([]),
      get: vi.fn<(id: string) => Promise<MemoryEntry | null>>()
        .mockResolvedValue(null),
    } as unknown as MemoryRepository;

    mockFts = {
      search: vi.fn<(query: string, limit?: number) => FtsSearchResult[]>()
        .mockReturnValue([]),
    } as unknown as FtsStore;

    config = createConfig();
  });

  describe('vector mode', () => {
    it('delegates to repository.search()', async () => {
      const results = [
        createSearchResult('v1', 0.9),
        createSearchResult('v2', 0.7),
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(results);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'vector', limit: 5 });

      expect(mockRepo.search).toHaveBeenCalledWith('test', 5);
      expect(output).toHaveLength(2);
      expect(output[0].entry.id).toBe('v1');
      expect(output[1].entry.id).toBe('v2');
    });

    it('applies minScore filter from options', async () => {
      const results = [
        createSearchResult('v1', 0.9),
        createSearchResult('v2', 0.3),
        createSearchResult('v3', -0.1),
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(results);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'vector', minScore: 0.5 });

      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('v1');
    });

    it('applies minScore filter from config when not in options', async () => {
      const configWithHighMin = createConfig({ minScore: 0.6 });
      const results = [
        createSearchResult('v1', 0.9),
        createSearchResult('v2', 0.7),
        createSearchResult('v3', 0.3),
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(results);

      const hybrid = new HybridSearch(mockRepo, mockFts, configWithHighMin);
      const output = await hybrid.search({ query: 'test', mode: 'vector' });

      expect(output).toHaveLength(2);
      expect(output[0].entry.id).toBe('v1');
      expect(output[1].entry.id).toBe('v2');
    });

    it('filters by category', async () => {
      const results = [
        createSearchResult('v1', 0.9, 'architecture'),
        createSearchResult('v2', 0.8, 'pattern'),
        createSearchResult('v3', 0.7, 'architecture'),
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(results);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({
        query: 'test',
        mode: 'vector',
        category: 'architecture',
      });

      expect(output).toHaveLength(2);
      expect(output[0].entry.id).toBe('v1');
      expect(output[1].entry.id).toBe('v3');
    });
  });

  describe('keyword mode', () => {
    it('delegates to ftsStore.search() and fetches entries from repository', async () => {
      const ftsResults: FtsSearchResult[] = [
        { id: 'k1', score: 1.0 },
        { id: 'k2', score: 0.6 },
      ];
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const entry1 = createEntry('k1');
      const entry2 = createEntry('k2');
      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'k1') return entry1;
          if (id === 'k2') return entry2;
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'keyword', limit: 5 });

      expect(mockFts.search).toHaveBeenCalledWith('test', 5);
      expect(output).toHaveLength(2);
      expect(output[0].entry.id).toBe('k1');
      expect(output[0].score).toBe(1.0);
      expect(output[1].entry.id).toBe('k2');
      expect(output[1].score).toBe(0.6);
    });

    it('filters out null entries (FTS hit but missing from LanceDB)', async () => {
      const ftsResults: FtsSearchResult[] = [
        { id: 'k1', score: 1.0 },
        { id: 'k-missing', score: 0.8 },
        { id: 'k2', score: 0.6 },
      ];
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const entry1 = createEntry('k1');
      const entry2 = createEntry('k2');
      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'k1') return entry1;
          if (id === 'k2') return entry2;
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'keyword' });

      expect(output).toHaveLength(2);
      expect(output[0].entry.id).toBe('k1');
      expect(output[1].entry.id).toBe('k2');
    });

    it('filters by category', async () => {
      const ftsResults: FtsSearchResult[] = [
        { id: 'k1', score: 1.0 },
        { id: 'k2', score: 0.6 },
      ];
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'k1') return createEntry('k1', 'architecture');
          if (id === 'k2') return createEntry('k2', 'pattern');
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({
        query: 'test',
        mode: 'keyword',
        category: 'pattern',
      });

      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('k2');
    });
  });

  describe('hybrid mode', () => {
    it('runs both searches and fuses with RRF', async () => {
      const vectorResults = [
        createSearchResult('h1', 0.9),
        createSearchResult('h2', 0.7),
      ];
      const ftsResults: FtsSearchResult[] = [
        { id: 'h2', score: 1.0 },
        { id: 'h3', score: 0.6 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const entry3 = createEntry('h3');
      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'h3') return entry3;
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 10 });

      // h2 appears in both, should have highest combined RRF score
      expect(output.length).toBeGreaterThanOrEqual(2);
      expect(output[0].entry.id).toBe('h2');
    });

    it('over-fetches by factor of 3', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      await hybrid.search({ query: 'test', mode: 'hybrid', limit: 5 });

      expect(mockRepo.search).toHaveBeenCalledWith('test', 15);
      expect(mockFts.search).toHaveBeenCalledWith('test', 15);
    });

    it('fetches entry for keyword-only hits via repository.get()', async () => {
      const vectorResults: MemorySearchResult[] = [];
      const ftsResults: FtsSearchResult[] = [
        { id: 'fts-only', score: 1.0 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const entry = createEntry('fts-only');
      vi.mocked(mockRepo.get).mockResolvedValue(entry);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid' });

      expect(mockRepo.get).toHaveBeenCalledWith('fts-only');
      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('fts-only');
    });

    it('skips keyword-only hits when repository.get() returns null', async () => {
      const ftsResults: FtsSearchResult[] = [
        { id: 'ghost', score: 1.0 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);
      vi.mocked(mockRepo.get).mockResolvedValue(null);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid' });

      expect(output).toHaveLength(0);
    });

    it('applies category filter after fusion', async () => {
      const vectorResults = [
        createSearchResult('h1', 0.9, 'architecture'),
        createSearchResult('h2', 0.8, 'pattern'),
      ];
      const ftsResults: FtsSearchResult[] = [
        { id: 'h1', score: 1.0 },
        { id: 'h2', score: 0.8 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({
        query: 'test',
        mode: 'hybrid',
        category: 'architecture',
      });

      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('h1');
    });

    it('respects limit after fusion', async () => {
      const vectorResults = [
        createSearchResult('a', 0.9),
        createSearchResult('b', 0.8),
        createSearchResult('c', 0.7),
        createSearchResult('d', 0.6),
      ];
      const ftsResults: FtsSearchResult[] = [
        { id: 'a', score: 1.0 },
        { id: 'b', score: 0.8 },
        { id: 'c', score: 0.6 },
        { id: 'd', score: 0.4 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 2 });

      expect(output).toHaveLength(2);
    });
  });

  describe('RRF scoring', () => {
    it('rank 0 yields score 1/(K+1) = 1/61', async () => {
      const vectorResults = [createSearchResult('r0', 0.9)];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 10 });

      expect(output).toHaveLength(1);
      expect(output[0].score).toBeCloseTo(1 / 61, 10);
    });

    it('rank 1 yields score 1/(K+2) = 1/62', async () => {
      const vectorResults = [
        createSearchResult('r0', 0.9),
        createSearchResult('r1', 0.8),
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 10 });

      expect(output[1].score).toBeCloseTo(1 / 62, 10);
    });

    it('item in both lists gets summed RRF score higher than either individual', async () => {
      const vectorResults = [
        createSearchResult('both', 0.9),
        createSearchResult('vec-only', 0.8),
      ];
      const ftsResults: FtsSearchResult[] = [
        { id: 'both', score: 1.0 },
        { id: 'fts-only', score: 0.6 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const ftsOnlyEntry = createEntry('fts-only');
      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'fts-only') return ftsOnlyEntry;
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 10 });

      const bothResult = output.find(r => r.entry.id === 'both');
      const vecOnlyResult = output.find(r => r.entry.id === 'vec-only');
      const ftsOnlyResult = output.find(r => r.entry.id === 'fts-only');

      expect(bothResult).toBeDefined();
      expect(vecOnlyResult).toBeDefined();
      expect(ftsOnlyResult).toBeDefined();

      // 'both' has rank 0 in vector (1/61) + rank 0 in FTS (1/61) = 2/61
      const expectedBothScore = 1 / 61 + 1 / 61;
      expect(bothResult!.score).toBeCloseTo(expectedBothScore, 10);

      // 'both' score should be higher than any single-list item
      expect(bothResult!.score).toBeGreaterThan(vecOnlyResult!.score);
      expect(bothResult!.score).toBeGreaterThan(ftsOnlyResult!.score);
    });

    it('item in only one list gets single RRF contribution', async () => {
      const vectorResults = [
        createSearchResult('vec-only', 0.9),
      ];
      const ftsResults: FtsSearchResult[] = [
        { id: 'fts-only', score: 1.0 },
      ];
      vi.mocked(mockRepo.search).mockResolvedValue(vectorResults);
      vi.mocked(mockFts.search).mockReturnValue(ftsResults);

      const ftsOnlyEntry = createEntry('fts-only');
      vi.mocked(mockRepo.get)
        .mockImplementation(async (id: string) => {
          if (id === 'fts-only') return ftsOnlyEntry;
          return null;
        });

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid', limit: 10 });

      const vecOnly = output.find(r => r.entry.id === 'vec-only');
      const ftsOnly = output.find(r => r.entry.id === 'fts-only');

      // Both at rank 0 in their respective lists: 1/61
      expect(vecOnly!.score).toBeCloseTo(1 / 61, 10);
      expect(ftsOnly!.score).toBeCloseTo(1 / 61, 10);
    });
  });

  describe('empty results', () => {
    it('empty vector + non-empty FTS returns FTS-only items', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue([
        { id: 'fts1', score: 1.0 },
      ]);

      const entry = createEntry('fts1');
      vi.mocked(mockRepo.get).mockResolvedValue(entry);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid' });

      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('fts1');
    });

    it('empty FTS + non-empty vector returns vector-only items', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([
        createSearchResult('vec1', 0.9),
      ]);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid' });

      expect(output).toHaveLength(1);
      expect(output[0].entry.id).toBe('vec1');
    });

    it('both empty returns empty array', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      const output = await hybrid.search({ query: 'test', mode: 'hybrid' });

      expect(output).toEqual([]);
    });
  });

  describe('defaults', () => {
    it('default mode is hybrid from config', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      await hybrid.search({ query: 'test' });

      // In hybrid mode, both searches should be called
      expect(mockRepo.search).toHaveBeenCalled();
      expect(mockFts.search).toHaveBeenCalled();
    });

    it('default mode uses config.defaultSearchMode', async () => {
      const vectorConfig = createConfig({ defaultSearchMode: 'vector' });
      vi.mocked(mockRepo.search).mockResolvedValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, vectorConfig);
      await hybrid.search({ query: 'test' });

      // In vector-only mode, FTS should NOT be called
      expect(mockRepo.search).toHaveBeenCalled();
      expect(mockFts.search).not.toHaveBeenCalled();
    });

    it('default limit is 5', async () => {
      vi.mocked(mockRepo.search).mockResolvedValue([]);
      vi.mocked(mockFts.search).mockReturnValue([]);

      const hybrid = new HybridSearch(mockRepo, mockFts, config);
      await hybrid.search({ query: 'test', mode: 'vector' });

      expect(mockRepo.search).toHaveBeenCalledWith('test', 5);
    });
  });
});
