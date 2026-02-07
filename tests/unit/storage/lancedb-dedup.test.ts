import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryRepository } from '../../../src/storage/lancedb';
import { hashContent } from '../../../src/indexer/hasher';

describe('MemoryRepository dedup', () => {
  let baseDir: string;
  let tempDir: string;
  let repository: MemoryRepository;
  let testCount = 0;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'lance-dedup-test-'));
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true });
  });

  beforeEach(async () => {
    tempDir = join(baseDir, `test-${++testCount}`);
    repository = new MemoryRepository(tempDir);
    await repository.connect();
  });

  afterEach(async () => {
    await repository?.disconnect();
  });

  it('add() with identical content twice returns same entry (same ID)', async () => {
    const content = 'Duplicate content for dedup testing';
    const first = await repository.add({ content });
    const second = await repository.add({ content });

    expect(first.id).toBe(second.id);
  });

  it('after adding duplicate, only 1 entry exists (not 2)', async () => {
    const content = 'Only one entry should exist for this content';
    await repository.add({ content });
    await repository.add({ content });

    const count = await repository.count();
    expect(count).toBe(1);
  });

  it('add() with different content creates two separate entries', async () => {
    const first = await repository.add({ content: 'First unique content' });
    const second = await repository.add({ content: 'Second unique content' });

    expect(first.id).not.toBe(second.id);

    const count = await repository.count();
    expect(count).toBe(2);
  });

  it('findByContentHash() returns null for unknown hash', async () => {
    const result = await repository.findByContentHash('0000000000000000000000000000000000000000000000000000000000000000');
    expect(result).toBeNull();
  });

  it('findByContentHash() returns correct entry for known hash', async () => {
    const content = 'Content with a known hash';
    const entry = await repository.add({ content });

    const hash = hashContent(content);
    const found = await repository.findByContentHash(hash);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
    expect(found!.content).toBe(content);
  });
});
