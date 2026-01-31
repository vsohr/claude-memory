import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemoryDelete } from '../../../src/server/tools/memory-delete';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_delete tool', () => {
  let baseDir: string;
  let tempDir: string;
  let repository: MemoryRepository;
  let testEntryId: string;
  let testCount = 0;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'delete-test-'));
  }, 120000);

  beforeEach(async () => {
    tempDir = join(baseDir, `test-${++testCount}`);
    await mkdir(tempDir, { recursive: true });
    repository = new MemoryRepository(tempDir);
    await repository.connect();

    const entry = await repository.add({ content: 'To be deleted' });
    testEntryId = entry.id;
  });

  afterAll(async () => {
    await repository?.disconnect();
    await rm(baseDir, { recursive: true });
  });

  it('deletes existing entry', async () => {
    const result = await handleMemoryDelete({ id: testEntryId }, repository);
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(testEntryId);

    const entry = await repository.get(testEntryId);
    expect(entry).toBeNull();
  });

  it('returns not found for nonexistent entry', async () => {
    const result = await handleMemoryDelete({ id: 'nonexistent' }, repository);
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe('Entry not found');
  });
});
