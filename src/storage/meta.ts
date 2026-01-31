import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { FileSystemError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { IndexerMeta } from '../types/config';

const DEFAULT_META: IndexerMeta = {
  version: 1,
  lastIndexedAt: '',
  fileHashes: {},
  discovery: {
    complete: false,
  },
};

/**
 * Service for managing indexer metadata, including file hashes
 * for incremental indexing and discovery status tracking.
 */
export class MetaService {
  private metaPath: string;
  private meta: IndexerMeta | null = null;

  constructor(metaPath: string) {
    this.metaPath = metaPath;
  }

  /**
   * Load metadata from disk. Returns cached meta if already loaded.
   * Creates default metadata if file doesn't exist.
   */
  async load(): Promise<IndexerMeta> {
    if (this.meta) return this.meta;

    try {
      const content = await readFile(this.metaPath, 'utf-8');
      this.meta = JSON.parse(content) as IndexerMeta;
      return this.meta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('Meta file not found, using defaults');
        this.meta = { ...DEFAULT_META, fileHashes: {}, discovery: { ...DEFAULT_META.discovery } };
        return this.meta;
      }
      throw new FileSystemError(
        `Failed to read meta file: ${(error as Error).message}`,
        this.metaPath
      );
    }
  }

  /**
   * Save metadata to disk. Creates parent directories if needed.
   */
  async save(meta: IndexerMeta): Promise<void> {
    try {
      await mkdir(dirname(this.metaPath), { recursive: true });
      await writeFile(this.metaPath, JSON.stringify(meta, null, 2));
      this.meta = meta;
    } catch (error) {
      throw new FileSystemError(
        `Failed to write meta file: ${(error as Error).message}`,
        this.metaPath
      );
    }
  }

  /**
   * Get the stored hash for a file path.
   * Returns undefined if the file hasn't been indexed.
   */
  getFileHash(filePath: string): string | undefined {
    return this.meta?.fileHashes[filePath];
  }

  /**
   * Set the hash for a file path.
   * Used to track which files have been indexed and detect changes.
   */
  setFileHash(filePath: string, hash: string): void {
    if (!this.meta) {
      this.meta = { ...DEFAULT_META, fileHashes: {}, discovery: { ...DEFAULT_META.discovery } };
    }
    this.meta.fileHashes[filePath] = hash;
  }

  /**
   * Remove the hash for a file path.
   * Used when a file is deleted or needs re-indexing.
   */
  removeFileHash(filePath: string): void {
    if (this.meta) {
      delete this.meta.fileHashes[filePath];
    }
  }

  /**
   * Clear all metadata and save to disk.
   * Resets to default state.
   */
  async clear(): Promise<void> {
    this.meta = { ...DEFAULT_META, fileHashes: {}, discovery: { ...DEFAULT_META.discovery } };
    await this.save(this.meta);
  }

  /**
   * Update the lastIndexedAt timestamp to current time.
   */
  updateLastIndexedAt(): void {
    if (this.meta) {
      this.meta.lastIndexedAt = new Date().toISOString();
    }
  }

  /**
   * Check if discovery has been completed.
   */
  isDiscovered(): boolean {
    return this.meta?.discovery.complete ?? false;
  }

  /**
   * Set the discovery completion status.
   * When set to true, also updates the lastRunAt timestamp.
   */
  setDiscovered(complete: boolean): void {
    if (!this.meta) {
      this.meta = { ...DEFAULT_META, fileHashes: {}, discovery: { ...DEFAULT_META.discovery } };
    }
    this.meta.discovery.complete = complete;
    if (complete) {
      this.meta.discovery.lastRunAt = new Date().toISOString();
    }
  }
}
