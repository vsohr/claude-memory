import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('MemoryRepository', () => {
  let baseDir: string;
  let tempDir: string;
  let repository: MemoryRepository;
  let testCount = 0;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'lance-test-'));
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true });
  });

  beforeEach(async () => {
    // Create unique directory for each test to avoid stale data issues
    tempDir = join(baseDir, `test-${++testCount}`);
    repository = new MemoryRepository(tempDir);
    await repository.connect();
  });

  afterEach(async () => {
    await repository?.disconnect();
  });

  it('connects to database', () => {
    expect(repository.isConnected()).toBe(true);
  });

  it('adds and retrieves entry', async () => {
    const entry = await repository.add({
      content: 'Test content about authentication',
      metadata: { category: 'architecture' },
    });

    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('Test content about authentication');

    const retrieved = await repository.get(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe('Test content about authentication');
  });

  it('searches by semantic similarity', async () => {
    await repository.add({
      content: 'JWT tokens are used for authentication',
      metadata: { category: 'architecture' },
    });

    const results = await repository.search('how does auth work', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain('authentication');
  });

  it('deletes entry', async () => {
    const entry = await repository.add({
      content: 'To be deleted',
    });

    const deleted = await repository.delete(entry.id);
    expect(deleted).toBe(true);

    const retrieved = await repository.get(entry.id);
    expect(retrieved).toBeNull();
  });
});
