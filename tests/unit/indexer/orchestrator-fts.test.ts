import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Indexer } from '../../../src/indexer/orchestrator';
import { MemoryRepository } from '../../../src/storage/lancedb';
import { MetaService } from '../../../src/storage/meta';
import type { FtsStore } from '../../../src/storage/fts';
import type { MemoryEntry } from '../../../src/types/memory';

/**
 * Create a minimal mock FtsStore that tracks calls to add().
 */
function createMockFtsStore(options?: { throwOnAdd?: boolean }): FtsStore & { addCalls: MemoryEntry[] } {
  const addCalls: MemoryEntry[] = [];

  return {
    addCalls,
    add(entry: MemoryEntry): void {
      if (options?.throwOnAdd) {
        throw new Error('FTS add simulated failure');
      }
      addCalls.push(entry);
    },
    // Stub remaining FtsStore methods (not exercised in these tests)
    open: vi.fn(),
    close: vi.fn(),
    search: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
    clear: vi.fn(),
    addBatch: vi.fn(),
  } as unknown as FtsStore & { addCalls: MemoryEntry[] };
}

describe('Indexer with FtsStore', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let metaService: MetaService;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'indexer-fts-test-'));

    // Create directory structure
    await mkdir(join(tempDir, '.claude', 'knowledge'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'memory', 'vectors'), { recursive: true });

    // Create test markdown file with two sections
    await writeFile(
      join(tempDir, '.claude', 'knowledge', 'test.md'),
      `### Auth
JWT tokens are validated on each request.

### Database
PostgreSQL is the primary database.`
    );

    repository = new MemoryRepository(join(tempDir, '.claude', 'memory', 'vectors'));
    await repository.connect();

    metaService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
  }, 120000);

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('when ftsStore provided, ftsStore.add() called for each entry', async () => {
    const mockFts = createMockFtsStore();
    const indexer = new Indexer({
      repository,
      metaService,
      knowledgeDir: join(tempDir, '.claude', 'knowledge'),
      ftsStore: mockFts,
    });

    const result = await indexer.index({ force: true });
    expect(result.filesProcessed).toBe(1);
    expect(result.entriesCreated).toBe(2);
    // FTS add() should have been called once per entry
    expect(mockFts.addCalls).toHaveLength(2);
    expect(mockFts.addCalls[0].content).toContain('JWT');
    expect(mockFts.addCalls[1].content).toContain('PostgreSQL');
  });

  it('when ftsStore.add() throws, indexing continues', async () => {
    const mockFts = createMockFtsStore({ throwOnAdd: true });
    const indexer = new Indexer({
      repository,
      metaService,
      knowledgeDir: join(tempDir, '.claude', 'knowledge'),
      ftsStore: mockFts,
    });

    const result = await indexer.index({ force: true });
    // Indexing should still succeed despite FTS errors
    expect(result.filesProcessed).toBe(1);
    expect(result.entriesCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('when ftsStore not provided, works as before', async () => {
    const indexer = new Indexer({
      repository,
      metaService,
      knowledgeDir: join(tempDir, '.claude', 'knowledge'),
      // No ftsStore
    });

    const result = await indexer.index({ force: true });
    expect(result.filesProcessed).toBe(1);
    expect(result.entriesCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });
});
