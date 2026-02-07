import * as lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import { getEmbeddingService } from './embeddings';
import { generateId } from '../utils/id';
import { hashContent } from '../indexer/hasher.js';
import { StorageError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemorySearchResult,
  MemoryCategory,
  MemoryMetadata,
} from '../types/memory';

const TABLE_NAME = 'memories';

// Input validation constants
const MAX_ID_LENGTH = 128;
const MAX_CATEGORY_LENGTH = 64;
const MAX_FILE_PATH_LENGTH = 1024;

// Valid category values for validation
const VALID_CATEGORIES: readonly string[] = [
  'architecture',
  'component',
  'domain',
  'pattern',
  'gotcha',
  'discovery',
  'general',
] as const;

/**
 * Escapes special characters in a string for safe use in LanceDB query expressions.
 * Uses single quotes for string values (SQL standard) and escapes single quotes by doubling them.
 */
function escapeQueryValue(value: string): string {
  // Escape backslashes first, then single quotes (doubled for SQL escaping)
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Validates and sanitizes an ID parameter.
 * @throws ValidationError if ID is invalid
 */
function validateId(id: string): string {
  if (typeof id !== 'string') {
    throw new ValidationError('ID must be a string', 'id', { code: 'INVALID_TYPE' });
  }
  if (id.length === 0) {
    throw new ValidationError('ID cannot be empty', 'id', { code: 'EMPTY_VALUE' });
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new ValidationError(
      `ID exceeds maximum length of ${MAX_ID_LENGTH} characters`,
      'id',
      { code: 'MAX_LENGTH_EXCEEDED' }
    );
  }
  return id;
}

/**
 * Validates a category parameter.
 * @throws ValidationError if category is invalid
 */
function validateCategory(category: string): MemoryCategory {
  if (typeof category !== 'string') {
    throw new ValidationError('Category must be a string', 'category', { code: 'INVALID_TYPE' });
  }
  if (category.length > MAX_CATEGORY_LENGTH) {
    throw new ValidationError(
      `Category exceeds maximum length of ${MAX_CATEGORY_LENGTH} characters`,
      'category',
      { code: 'MAX_LENGTH_EXCEEDED' }
    );
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ValidationError(
      `Invalid category: ${category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      'category',
      { code: 'INVALID_CATEGORY' }
    );
  }
  return category as MemoryCategory;
}

/**
 * Validates and sanitizes a file path parameter.
 * @throws ValidationError if file path is invalid
 */
function validateFilePath(filePath: string): string {
  if (typeof filePath !== 'string') {
    throw new ValidationError('File path must be a string', 'filePath', { code: 'INVALID_TYPE' });
  }
  if (filePath.length === 0) {
    throw new ValidationError('File path cannot be empty', 'filePath', { code: 'EMPTY_VALUE' });
  }
  if (filePath.length > MAX_FILE_PATH_LENGTH) {
    throw new ValidationError(
      `File path exceeds maximum length of ${MAX_FILE_PATH_LENGTH} characters`,
      'filePath',
      { code: 'MAX_LENGTH_EXCEEDED' }
    );
  }
  return filePath;
}

/**
 * Builds a safe WHERE clause for ID queries.
 * Uses single quotes for string values (SQL standard).
 * Column 'id' is lowercase so no quoting needed.
 */
function buildIdFilter(id: string): string {
  const validatedId = validateId(id);
  return `id = '${escapeQueryValue(validatedId)}'`;
}

/**
 * Builds a safe WHERE clause for category queries.
 * Uses single quotes for string values (SQL standard).
 * Column 'category' is lowercase so no quoting needed.
 */
function buildCategoryFilter(category: MemoryCategory): string {
  const validatedCategory = validateCategory(category);
  return `category = '${escapeQueryValue(validatedCategory)}'`;
}

/**
 * Builds a safe WHERE clause for file path queries.
 * Uses double-quoted column name for case-sensitivity (camelCase column).
 * Uses single quotes for string values (SQL standard).
 */
function buildFilePathFilter(filePath: string): string {
  const validatedFilePath = validateFilePath(filePath);
  return `"filePath" = '${escapeQueryValue(validatedFilePath)}'`;
}

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string;
  sectionTitle: string;
  keywords: string;
  referenceCount: number;
  promoted: boolean;
  promotedAt: string;
  createdAt: string;
  updatedAt: string;
  vector: number[];
  contentHash: string;
  [key: string]: unknown;
}

export class MemoryRepository {
  private dbPath: string;
  private connection: Connection | null = null;
  private table: Table | null = null;
  /** In-memory content hash cache for dedup (hash -> entry). Populated on query and add. */
  private hashCache: Map<string, MemoryEntry> = new Map();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await lancedb.connect(this.dbPath);

      const tableNames = await this.connection.tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        this.table = await this.connection.openTable(TABLE_NAME);
        await this.migrateSchema(this.table);
      }

      logger.debug(`Connected to LanceDB at ${this.dbPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(`Failed to connect to database: ${message}`, 'CONNECTION', {
        path: this.dbPath,
      });
    }
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    this.table = null;
    this.hashCache.clear();
  }

  isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * Migrate schema by adding missing columns to an existing table.
   * Currently checks for the contentHash column added in v0.2.0.
   */
  private async migrateSchema(table: Table): Promise<void> {
    try {
      // Probe for contentHash by running a small query with the column
      await table.query().select(['id', 'contentHash']).limit(1).toArray();
    } catch {
      // Column missing - add it with empty default
      logger.info('Migrating schema: adding contentHash column');
      await table.addColumns([{ name: 'contentHash', valueSql: "''" }]);
    }
  }

  private async ensureTable(): Promise<Table> {
    if (this.table) return this.table;
    if (!this.connection) {
      throw new StorageError('Database not connected', 'NOT_CONNECTED');
    }

    // Create table with a dummy row (LanceDB requires data to infer schema)
    const embeddingService = getEmbeddingService();
    const dummyVector = await embeddingService.embed('initialization');

    const initialRow: MemoryRow = {
      id: '__init__',
      content: '',
      category: 'general',
      source: 'manual',
      filePath: '',
      sectionTitle: '',
      keywords: '[]',
      referenceCount: 0,
      promoted: false,
      promotedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      vector: dummyVector,
      contentHash: '',
    };

    this.table = await this.connection.createTable(TABLE_NAME, [initialRow]);

    // Delete the initialization row
    // LanceDB uses DataFusion SQL which is case-insensitive for unquoted identifiers
    await this.table.delete("id = '__init__'");

    return this.table;
  }

  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      metadata: {
        category: row.category as MemoryCategory,
        source: row.source as MemoryMetadata['source'],
        filePath: row.filePath || undefined,
        sectionTitle: row.sectionTitle || undefined,
        keywords: JSON.parse(row.keywords) as string[],
        referenceCount: row.referenceCount,
        promoted: row.promoted,
        promotedAt: row.promotedAt || undefined,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async entryToRow(input: MemoryEntryInput, existingId?: string): Promise<MemoryRow> {
    const embeddingService = getEmbeddingService();
    const vector = await embeddingService.embed(input.content);
    const now = new Date().toISOString();

    return {
      id: existingId ?? generateId(),
      content: input.content,
      category: input.metadata?.category ?? 'general',
      source: input.metadata?.source ?? 'manual',
      filePath: input.metadata?.filePath ?? '',
      sectionTitle: input.metadata?.sectionTitle ?? '',
      keywords: JSON.stringify(input.metadata?.keywords ?? []),
      referenceCount: input.metadata?.referenceCount ?? 0,
      promoted: input.metadata?.promoted ?? false,
      promotedAt: input.metadata?.promotedAt ?? '',
      createdAt: now,
      updatedAt: now,
      vector,
      contentHash: hashContent(input.content),
    };
  }

  /**
   * Find an existing entry by its content hash.
   * Returns null if no entry with the given hash exists.
   *
   * Uses an in-memory cache first, then falls back to scanning
   * the table since LanceDB WHERE filters on recently added string
   * columns may not return results immediately.
   */
  async findByContentHash(hash: string): Promise<MemoryEntry | null> {
    // Check in-memory cache first (fast path)
    const cached = this.hashCache.get(hash);
    if (cached) return cached;

    // Fall back to scanning all rows and matching contentHash
    const table = await this.ensureTable();
    const rows = await table.query().toArray();

    for (const row of rows) {
      const memRow = row as unknown as MemoryRow;
      if (memRow.contentHash === hash) {
        const entry = this.rowToEntry(memRow);
        this.hashCache.set(hash, entry);
        return entry;
      }
    }

    return null;
  }

  async add(input: MemoryEntryInput): Promise<MemoryEntry> {
    const table = await this.ensureTable();

    // Dedup: check if identical content already exists
    const hash = hashContent(input.content);
    const existing = await this.findByContentHash(hash);
    if (existing) {
      logger.debug(`Duplicate content detected (hash=${hash.slice(0, 8)}...), returning existing entry ${existing.id}`);
      return existing;
    }

    const row = await this.entryToRow(input);
    await table.add([row]);
    const entry = this.rowToEntry(row);

    // Cache the new entry's hash for future dedup lookups
    this.hashCache.set(hash, entry);

    return entry;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const table = await this.ensureTable();
    const results = await table.query().where(buildIdFilter(id)).limit(1).toArray();

    if (results.length === 0) return null;
    return this.rowToEntry(results[0] as unknown as MemoryRow);
  }

  async delete(id: string): Promise<boolean> {
    const table = await this.ensureTable();
    const existing = await this.get(id);
    if (!existing) return false;

    await table.delete(buildIdFilter(id));
    return true;
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    const table = await this.ensureTable();
    const embeddingService = getEmbeddingService();
    const queryVector = await embeddingService.embed(query);

    const results = await table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map((row) => ({
      entry: this.rowToEntry(row as unknown as MemoryRow),
      score: 1 - (row._distance ?? 0), // Convert distance to similarity
    }));
  }

  async list(category?: MemoryCategory, limit = 50): Promise<MemoryEntry[]> {
    const table = await this.ensureTable();
    let query = table.query();

    if (category) {
      query = query.where(buildCategoryFilter(category));
    }

    const results = await query.limit(limit).toArray();
    return results.map((row) => this.rowToEntry(row as unknown as MemoryRow));
  }

  async count(category?: MemoryCategory): Promise<number> {
    const table = await this.ensureTable();
    let query = table.query();

    if (category) {
      query = query.where(buildCategoryFilter(category));
    }

    const results = await query.toArray();
    return results.length;
  }

  async incrementReferenceCount(id: string): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;

    // LanceDB doesn't support UPDATE, so we delete and re-add
    const table = await this.ensureTable();
    await table.delete(buildIdFilter(id));

    const updatedInput: MemoryEntryInput = {
      content: entry.content,
      metadata: {
        ...entry.metadata,
        referenceCount: entry.metadata.referenceCount + 1,
      },
    };

    const row = await this.entryToRow(updatedInput, id);
    row.createdAt = entry.createdAt; // Preserve original creation time
    await table.add([row]);
  }

  async deleteByFile(filePath: string): Promise<number> {
    const table = await this.ensureTable();
    const filter = buildFilePathFilter(filePath);
    const existing = await table.query().where(filter).toArray();

    if (existing.length > 0) {
      await table.delete(filter);
    }

    return existing.length;
  }

  async addBatch(entries: MemoryEntryInput[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const entry of entries) {
      const added = await this.add(entry);
      results.push(added);
    }
    return results;
  }
}
