import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Indexer } from '../../src/indexer/orchestrator';
import { MemoryRepository } from '../../src/storage/lancedb';
import { MetaService } from '../../src/storage/meta';

describe('Indexer Integration', () => {
  let tempDir: string;
  let repository: MemoryRepository;
  let metaService: MetaService;
  let indexer: Indexer;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'indexer-test-'));

    // Create directory structure
    await mkdir(join(tempDir, '.claude', 'knowledge'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'memory', 'vectors'), { recursive: true });

    // Create test markdown file
    await writeFile(
      join(tempDir, '.claude', 'knowledge', 'test.md'),
      `### Authentication
JWT tokens are validated on each request.

### Database
PostgreSQL is the primary database.`
    );

    repository = new MemoryRepository(join(tempDir, '.claude', 'memory', 'vectors'));
    await repository.connect();

    metaService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));

    indexer = new Indexer({
      repository,
      metaService,
      knowledgeDir: join(tempDir, '.claude', 'knowledge'),
    });
  }, 120000);

  afterAll(async () => {
    await repository?.disconnect();
    await rm(tempDir, { recursive: true });
  });

  it('indexes markdown files', async () => {
    const result = await indexer.index({});
    expect(result.filesProcessed).toBe(1);
    expect(result.entriesCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('skips unchanged files on reindex', async () => {
    const result = await indexer.index({});
    expect(result.filesProcessed).toBe(0);
    expect(result.filesSkipped).toBe(1);
  });

  it('reindexes with force flag', async () => {
    const result = await indexer.index({ force: true });
    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
  });
});
