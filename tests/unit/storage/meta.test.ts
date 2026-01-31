import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MetaService } from '../../../src/storage/meta';

describe('MetaService', () => {
  let tempDir: string;
  let metaService: MetaService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'meta-test-'));
    await mkdir(join(tempDir, '.claude', 'memory'), { recursive: true });
    metaService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('loads empty meta when file does not exist', async () => {
    const meta = await metaService.load();
    expect(meta.version).toBe(1);
    expect(meta.fileHashes).toEqual({});
  });

  it('saves and loads meta', async () => {
    const meta = await metaService.load();
    metaService.setFileHash('test.md', 'abc123');
    await metaService.save(meta);

    const newService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
    const loaded = await newService.load();
    expect(loaded.fileHashes['test.md']).toBe('abc123');
  });

  it('gets file hash', async () => {
    await metaService.load();
    metaService.setFileHash('file.md', 'hash123');
    expect(metaService.getFileHash('file.md')).toBe('hash123');
    expect(metaService.getFileHash('nonexistent.md')).toBeUndefined();
  });

  it('removes file hash', async () => {
    await metaService.load();
    metaService.setFileHash('file.md', 'hash123');
    expect(metaService.getFileHash('file.md')).toBe('hash123');
    metaService.removeFileHash('file.md');
    expect(metaService.getFileHash('file.md')).toBeUndefined();
  });

  it('clears all metadata', async () => {
    await metaService.load();
    metaService.setFileHash('file1.md', 'hash1');
    metaService.setFileHash('file2.md', 'hash2');
    await metaService.clear();

    const meta = await metaService.load();
    expect(meta.fileHashes).toEqual({});
    expect(meta.version).toBe(1);
  });

  it('updates lastIndexedAt timestamp', async () => {
    await metaService.load();
    const before = new Date().toISOString();
    metaService.updateLastIndexedAt();
    const meta = await metaService.load();

    expect(meta.lastIndexedAt).toBeDefined();
    expect(new Date(meta.lastIndexedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
  });

  it('tracks discovery status', async () => {
    await metaService.load();
    expect(metaService.isDiscovered()).toBe(false);

    metaService.setDiscovered(true);
    expect(metaService.isDiscovered()).toBe(true);

    await metaService.save(await metaService.load());

    const newService = new MetaService(join(tempDir, '.claude', 'memory', 'meta.json'));
    await newService.load();
    expect(newService.isDiscovered()).toBe(true);
  });

  it('sets discovery timestamp when marking as discovered', async () => {
    await metaService.load();
    const before = new Date().toISOString();
    metaService.setDiscovered(true);
    const meta = await metaService.load();

    expect(meta.discovery.lastRunAt).toBeDefined();
    expect(new Date(meta.discovery.lastRunAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
  });
});
