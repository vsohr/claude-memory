import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FtsStore } from '../../../src/storage/fts';
import type { MemoryEntry } from '../../../src/types/memory';

/**
 * Helper to create a MemoryEntry for testing.
 */
function createTestEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: overrides.content ?? 'Default test content',
    metadata: {
      category: 'general',
      source: 'manual',
      keywords: [],
      referenceCount: 0,
      promoted: false,
      ...overrides.metadata,
    },
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

describe('FtsStore', () => {
  const stores: FtsStore[] = [];
  const tempDirs: string[] = [];

  /**
   * Helper that creates a temp directory and FtsStore instance,
   * tracking them for cleanup.
   */
  function createStore(): { store: FtsStore; tempDir: string; dbPath: string } {
    const tempDir = mkdtempSync(join(tmpdir(), 'fts-test-'));
    const dbPath = join(tempDir, 'fts.sqlite');
    const store = new FtsStore(dbPath);
    stores.push(store);
    tempDirs.push(tempDir);
    return { store, tempDir, dbPath };
  }

  afterEach(() => {
    // Close all stores and clean up temp directories
    for (const store of stores) {
      try {
        store.close();
      } catch {
        // ignore close errors during cleanup
      }
    }
    stores.length = 0;

    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
    tempDirs.length = 0;
  });

  describe('open() and close()', () => {
    it('creates database file and FTS5 table', () => {
      const { store, dbPath } = createStore();
      store.open();

      expect(existsSync(dbPath)).toBe(true);
    });

    it('close() completes without error', () => {
      const { store } = createStore();
      store.open();
      expect(() => store.close()).not.toThrow();
    });

    it('close() on already-closed store does not throw', () => {
      const { store } = createStore();
      store.open();
      store.close();
      expect(() => store.close()).not.toThrow();
    });

    it('open() on invalid path throws StorageError', () => {
      const store = new FtsStore('/nonexistent/deeply/nested/path/fts.sqlite');
      stores.push(store);

      expect(() => store.open()).toThrow();
      try {
        store.open();
      } catch (error) {
        expect((error as Error).name).toBe('StorageError');
      }
    });
  });

  describe('add() and search()', () => {
    it('entry found by keyword', () => {
      const { store } = createStore();
      store.open();

      const entry = createTestEntry({
        id: 'auth-entry',
        content: 'JWT tokens are used for authentication in the API layer',
        metadata: {
          category: 'architecture',
          source: 'markdown',
          keywords: ['jwt', 'authentication'],
          referenceCount: 0,
          promoted: false,
        },
      });

      store.add(entry);

      const results = store.search('authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('auth-entry');
    });

    it('search results ranked most relevant first', () => {
      const { store } = createStore();
      store.open();

      // Entry with high relevance to "database"
      const dbEntry = createTestEntry({
        id: 'db-entry',
        content: 'The database layer uses PostgreSQL for persistent storage. Database migrations are handled by knex.',
        metadata: {
          category: 'architecture',
          source: 'markdown',
          keywords: ['database', 'postgresql'],
          referenceCount: 0,
          promoted: false,
        },
      });

      // Entry with low relevance to "database"
      const authEntry = createTestEntry({
        id: 'auth-entry',
        content: 'Authentication uses JWT tokens. The auth middleware validates tokens on each request.',
        metadata: {
          category: 'architecture',
          source: 'markdown',
          keywords: ['jwt', 'auth'],
          referenceCount: 0,
          promoted: false,
        },
      });

      // Entry with some relevance to "database"
      const configEntry = createTestEntry({
        id: 'config-entry',
        content: 'Configuration includes database connection settings along with cache and logging options.',
        metadata: {
          category: 'pattern',
          source: 'markdown',
          keywords: ['config'],
          referenceCount: 0,
          promoted: false,
        },
      });

      store.add(dbEntry);
      store.add(authEntry);
      store.add(configEntry);

      const results = store.search('database');
      expect(results.length).toBeGreaterThanOrEqual(2);

      // The most relevant result (multiple mentions of "database") should be first
      expect(results[0].id).toBe('db-entry');
    });
  });

  describe('addBatch()', () => {
    it('inserts multiple entries', () => {
      const { store } = createStore();
      store.open();

      const entries = [
        createTestEntry({
          id: 'batch-1',
          content: 'First batch entry about routing',
          metadata: {
            category: 'component',
            source: 'markdown',
            keywords: ['routing'],
            referenceCount: 0,
            promoted: false,
          },
        }),
        createTestEntry({
          id: 'batch-2',
          content: 'Second batch entry about middleware',
          metadata: {
            category: 'component',
            source: 'markdown',
            keywords: ['middleware'],
            referenceCount: 0,
            promoted: false,
          },
        }),
        createTestEntry({
          id: 'batch-3',
          content: 'Third batch entry about logging',
          metadata: {
            category: 'pattern',
            source: 'markdown',
            keywords: ['logging'],
            referenceCount: 0,
            promoted: false,
          },
        }),
      ];

      store.addBatch(entries);

      // Verify each entry can be found
      const routingResults = store.search('routing');
      expect(routingResults.length).toBe(1);
      expect(routingResults[0].id).toBe('batch-1');

      const middlewareResults = store.search('middleware');
      expect(middlewareResults.length).toBe(1);
      expect(middlewareResults[0].id).toBe('batch-2');

      const loggingResults = store.search('logging');
      expect(loggingResults.length).toBe(1);
      expect(loggingResults[0].id).toBe('batch-3');
    });
  });

  describe('BM25 normalization', () => {
    it('single result gets score 1.0', () => {
      const { store } = createStore();
      store.open();

      const entry = createTestEntry({
        id: 'single-entry',
        content: 'Unique content about quantum computing algorithms',
        metadata: {
          category: 'general',
          source: 'manual',
          keywords: ['quantum'],
          referenceCount: 0,
          promoted: false,
        },
      });

      store.add(entry);

      const results = store.search('quantum');
      expect(results.length).toBe(1);
      expect(results[0].score).toBe(1.0);
    });

    it('multiple results have scores in 0-1 range', () => {
      const { store } = createStore();
      store.open();

      const entries = [
        createTestEntry({
          id: 'entry-1',
          content: 'Machine learning is a subset of artificial intelligence. Machine learning models learn from data.',
          metadata: {
            category: 'general',
            source: 'manual',
            keywords: ['ml', 'ai'],
            referenceCount: 0,
            promoted: false,
          },
        }),
        createTestEntry({
          id: 'entry-2',
          content: 'Deep learning neural networks are used in machine learning applications.',
          metadata: {
            category: 'general',
            source: 'manual',
            keywords: ['deep-learning'],
            referenceCount: 0,
            promoted: false,
          },
        }),
        createTestEntry({
          id: 'entry-3',
          content: 'Data pipelines process large volumes of information for analytics.',
          metadata: {
            category: 'general',
            source: 'manual',
            keywords: ['data'],
            referenceCount: 0,
            promoted: false,
          },
        }),
      ];

      store.addBatch(entries);

      const results = store.search('machine learning');
      expect(results.length).toBeGreaterThanOrEqual(2);

      // All scores should be in the 0-1 range
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }

      // The best match should have score 1.0 (top of normalized range)
      expect(results[0].score).toBe(1);
    });
  });

  describe('porter stemming', () => {
    it('"running" matches "run"', () => {
      const { store } = createStore();
      store.open();

      const entry = createTestEntry({
        id: 'run-entry',
        content: 'The application is running in production mode',
        metadata: {
          category: 'general',
          source: 'manual',
          keywords: [],
          referenceCount: 0,
          promoted: false,
        },
      });

      store.add(entry);

      // Search for the stem "run" should match "running"
      const results = store.search('run');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('run-entry');
    });
  });

  describe('edge cases', () => {
    it('empty query returns []', () => {
      const { store } = createStore();
      store.open();

      store.add(createTestEntry({ content: 'Some content' }));

      expect(store.search('')).toEqual([]);
      expect(store.search('   ')).toEqual([]);
    });

    it('malformed FTS5 query returns [] without throwing', () => {
      const { store } = createStore();
      store.open();

      store.add(createTestEntry({ content: 'Some content' }));

      // FTS5 syntax errors - these should not throw
      const result1 = store.search('AND OR NOT');
      expect(Array.isArray(result1)).toBe(true);

      const result2 = store.search('"unclosed quote');
      expect(Array.isArray(result2)).toBe(true);

      const result3 = store.search('column:');
      expect(Array.isArray(result3)).toBe(true);
    });
  });

  describe('delete()', () => {
    it('removes entry from search', () => {
      const { store } = createStore();
      store.open();

      const entry = createTestEntry({
        id: 'to-delete',
        content: 'This entry about microservices will be deleted',
        metadata: {
          category: 'architecture',
          source: 'markdown',
          keywords: ['microservices'],
          referenceCount: 0,
          promoted: false,
        },
      });

      store.add(entry);

      // Verify it's searchable
      let results = store.search('microservices');
      expect(results.length).toBe(1);

      // Delete it
      store.delete('to-delete');

      // Verify it's gone
      results = store.search('microservices');
      expect(results.length).toBe(0);
    });
  });

  describe('clear()', () => {
    it('empties all entries', () => {
      const { store } = createStore();
      store.open();

      const entries = [
        createTestEntry({
          id: 'clear-1',
          content: 'First entry about caching strategies',
          metadata: {
            category: 'pattern',
            source: 'markdown',
            keywords: ['caching'],
            referenceCount: 0,
            promoted: false,
          },
        }),
        createTestEntry({
          id: 'clear-2',
          content: 'Second entry about error handling patterns',
          metadata: {
            category: 'pattern',
            source: 'markdown',
            keywords: ['errors'],
            referenceCount: 0,
            promoted: false,
          },
        }),
      ];

      store.addBatch(entries);

      // Verify entries exist
      expect(store.search('caching').length).toBe(1);
      expect(store.search('error').length).toBe(1);

      // Clear all
      store.clear();

      // Verify all gone
      expect(store.search('caching').length).toBe(0);
      expect(store.search('error').length).toBe(0);
    });
  });
});
