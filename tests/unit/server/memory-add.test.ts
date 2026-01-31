import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleMemoryAdd } from '../../../src/server/tools/memory-add';
import { MemoryRepository } from '../../../src/storage/lancedb';

describe('memory_add tool', () => {
  let baseDir: string;
  let tempDir: string;
  let repository: MemoryRepository;
  let testCount = 0;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'add-test-'));
  }, 120000);

  beforeEach(async () => {
    tempDir = join(baseDir, `test-${++testCount}`);
    await mkdir(tempDir, { recursive: true });
    repository = new MemoryRepository(tempDir);
    await repository.connect();
  });

  afterAll(async () => {
    await repository?.disconnect();
    await rm(baseDir, { recursive: true });
  });

  it('adds entry with content and category', async () => {
    const result = await handleMemoryAdd(
      { content: 'Test content', category: 'architecture' },
      repository
    );
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('defaults category to general', async () => {
    const result = await handleMemoryAdd({ content: 'Test content' }, repository);
    expect(result.success).toBe(true);

    const entry = await repository.get(result.id!);
    expect(entry?.metadata.category).toBe('general');
  });

  it('returns error for empty content', async () => {
    const result = await handleMemoryAdd({ content: '' }, repository);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Content is required');
  });

  it('returns error for content exceeding limit', async () => {
    const longContent = 'x'.repeat(10001);
    const result = await handleMemoryAdd({ content: longContent }, repository);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds maximum length');
  });

  it('accepts keywords array', async () => {
    const result = await handleMemoryAdd(
      { content: 'Test', keywords: ['auth', 'jwt'] },
      repository
    );
    expect(result.success).toBe(true);

    const entry = await repository.get(result.id!);
    expect(entry?.metadata.keywords).toEqual(['auth', 'jwt']);
  });
});
