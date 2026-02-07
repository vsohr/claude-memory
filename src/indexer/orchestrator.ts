import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { MemoryRepository } from '../storage/lancedb';
import { MetaService } from '../storage/meta';
import type { FtsStore } from '../storage/fts';
import { parseMarkdown, chunkByHeaders } from './parser';
import type { ChunkOptions } from './parser';
import { parseDirectives } from './directives';
import { hashContent } from './hasher';
import { logger } from '../utils/logger';
import type { MemoryEntryInput, MemoryCategory } from '../types/memory';

export interface IndexerConfig {
  repository: MemoryRepository;
  metaService: MetaService;
  knowledgeDir: string;
  chunkSize?: number;
  chunkOverlapPercent?: number;
  ftsStore?: FtsStore;
}

export interface IndexOptions {
  force?: boolean;
  dryRun?: boolean;
  onProgress?: (progress: IndexProgress) => void;
}

export interface IndexProgress {
  current: number;
  total: number;
  file: string;
}

export interface IndexError {
  file: string;
  error: string;
}

export interface IndexResult {
  filesProcessed: number;
  filesSkipped: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesDeleted: number;
  errors: IndexError[];
  durationMs: number;
}

export class Indexer {
  private repository: MemoryRepository;
  private metaService: MetaService;
  private knowledgeDir: string;
  private chunkSize: number;
  private chunkOverlapPercent: number;
  private ftsStore?: FtsStore;

  constructor(config: IndexerConfig) {
    this.repository = config.repository;
    this.metaService = config.metaService;
    this.knowledgeDir = config.knowledgeDir;
    this.chunkSize = config.chunkSize ?? 2000;
    this.chunkOverlapPercent = config.chunkOverlapPercent ?? 15;
    this.ftsStore = config.ftsStore;
  }

  async index(options: IndexOptions = {}): Promise<IndexResult> {
    const startTime = Date.now();
    const result: IndexResult = {
      filesProcessed: 0,
      filesSkipped: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesDeleted: 0,
      errors: [],
      durationMs: 0,
    };

    // Load metadata
    const meta = await this.metaService.load();

    // Find all markdown files
    const files = await this.findMarkdownFiles(this.knowledgeDir);
    logger.info(`Found ${files.length} markdown files`);

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = relative(this.knowledgeDir, file);

      // Security: reject paths with directory traversal
      if (relativePath.includes('..')) {
        logger.warn(`Skipping path with traversal: ${relativePath}`);
        result.filesSkipped++;
        continue;
      }

      options.onProgress?.({
        current: i + 1,
        total: files.length,
        file: relativePath,
      });

      try {
        const content = await readFile(file, 'utf-8');
        const contentHash = hashContent(content);

        // Check if file has changed
        if (!options.force && meta.fileHashes[relativePath] === contentHash) {
          logger.debug(`Skipping unchanged: ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        // Parse directives
        const directives = parseDirectives(content);
        if (!directives.vectorIndex) {
          logger.debug(`Skipping (vector-index: false): ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        // Log warnings
        for (const warning of directives.warnings) {
          logger.warn(`${relativePath}: ${warning}`);
        }

        // Parse and chunk content
        const parsed = parseMarkdown(content);
        const chunkOptions: ChunkOptions = {
          maxChunkSize: this.chunkSize,
          overlapPercent: this.chunkOverlapPercent,
        };
        const chunks = chunkByHeaders(parsed.content, chunkOptions);

        if (chunks.length === 0) {
          logger.warn(`Empty file: ${relativePath}`);
          result.filesSkipped++;
          continue;
        }

        if (!options.dryRun) {
          // Delete existing entries for this file
          const deleted = await this.repository.deleteByFile(relativePath);
          result.entriesDeleted += deleted;

          // Add new entries
          for (const chunk of chunks) {
            const category = (parsed.frontmatter.category as MemoryCategory) ?? 'general';
            const entryInput: MemoryEntryInput = {
              content: chunk.content,
              metadata: {
                category,
                source: 'markdown',
                filePath: relativePath,
                sectionTitle: chunk.title || undefined,
                keywords: directives.keywords,
              },
            };
            const addedEntry = await this.repository.add(entryInput);
            result.entriesCreated++;

            // Sync to FTS index if available
            if (this.ftsStore) {
              try {
                this.ftsStore.add(addedEntry);
              } catch (ftsError) {
                const ftsMessage = ftsError instanceof Error ? ftsError.message : 'Unknown error';
                logger.warn(`FTS sync failed for entry ${addedEntry.id}: ${ftsMessage}`);
              }
            }
          }

          // Update hash
          this.metaService.setFileHash(relativePath, contentHash);
        }

        result.filesProcessed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to index ${relativePath}: ${message}`);
        result.errors.push({ file: relativePath, error: message });
      }
    }

    // Save metadata
    if (!options.dryRun) {
      this.metaService.updateLastIndexedAt();
      await this.metaService.save(meta);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.findMarkdownFiles(fullPath);
          files.push(...subFiles);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !entry.name.startsWith('_')
        ) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.warn(`Could not read directory ${dir}: ${(error as Error).message}`);
    }

    return files;
  }
}
