import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { StorageError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { MemoryEntry } from '../types/memory';

/**
 * BM25 search result with normalized score.
 */
export interface FtsSearchResult {
  id: string;
  score: number; // BM25 score normalized to 0-1
}

/**
 * Row structure for the FTS5 virtual table.
 */
export interface FtsEntry {
  id: string;
  content: string;
  category: string;
  source: string;
  filePath: string;
  sectionTitle: string;
  keywords: string; // space-separated for FTS tokenization
}

/**
 * Raw result from FTS5 query before normalization.
 */
interface RawFtsResult {
  id: string;
  rank: number;
}

/**
 * Normalizes BM25 scores from FTS5 to 0-1 range.
 *
 * FTS5's bm25() returns negative values where lower (more negative) means
 * more relevant. This function inverts and normalizes within the result set.
 */
function normalizeBm25Scores(results: RawFtsResult[]): FtsSearchResult[] {
  if (results.length === 0) return [];

  // Use reduce instead of Math.min/max(...spread) to avoid stack overflow on large result sets
  let minScore = Infinity;
  let maxScore = -Infinity;
  for (const r of results) {
    if (r.rank < minScore) minScore = r.rank;
    if (r.rank > maxScore) maxScore = r.rank;
  }
  const range = maxScore - minScore;

  // All scores equal: assign 1.0 to all
  if (range === 0) {
    return results.map(r => ({ id: r.id, score: 1.0 }));
  }

  return results.map(r => ({
    id: r.id,
    // Invert: most negative raw score becomes highest normalized score
    score: (maxScore - r.rank) / range,
  }));
}

/**
 * SQLite FTS5 wrapper for BM25 keyword search.
 *
 * Stores the full-text index in a SQLite database file. Uses the porter
 * tokenizer for stemming and unicode61 for Unicode normalization.
 */
export class FtsStore {
  private dbPath: string;
  private db: BetterSqlite3.Database | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Open or create the SQLite database and FTS5 virtual table.
   * @throws StorageError if the database cannot be opened
   */
  open(): void {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          id UNINDEXED,
          content,
          category,
          source,
          filePath,
          sectionTitle,
          keywords,
          tokenize = 'porter unicode61'
        );
      `);

      logger.debug(`FTS store opened at ${this.dbPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(
        `Failed to open FTS database: ${message}`,
        'FTS_OPEN',
        { path: this.dbPath }
      );
    }
  }

  /**
   * Insert an entry into the FTS index.
   * Converts MemoryEntry to FtsEntry internally.
   */
  add(entry: MemoryEntry): void {
    this.ensureDb();
    const row = this.entryToFtsRow(entry);

    try {
      const stmt = this.db!.prepare(
        `INSERT INTO memory_fts(id, content, category, source, filePath, sectionTitle, keywords)
         VALUES (@id, @content, @category, @source, @filePath, @sectionTitle, @keywords)`
      );
      stmt.run(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(
        `Failed to add entry to FTS index: ${message}`,
        'FTS_ADD',
        { entryId: entry.id }
      );
    }
  }

  /**
   * Insert multiple entries in a single transaction for performance.
   */
  addBatch(entries: MemoryEntry[]): void {
    this.ensureDb();

    try {
      const insert = this.db!.prepare(
        `INSERT INTO memory_fts(id, content, category, source, filePath, sectionTitle, keywords)
         VALUES (@id, @content, @category, @source, @filePath, @sectionTitle, @keywords)`
      );

      const batchInsert = this.db!.transaction((rows: FtsEntry[]) => {
        for (const row of rows) {
          insert.run(row);
        }
      });

      batchInsert(entries.map(e => this.entryToFtsRow(e)));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(
        `Failed to batch add entries to FTS index: ${message}`,
        'FTS_ADD_BATCH',
        { count: entries.length }
      );
    }
  }

  /**
   * Search using BM25 ranking. Returns IDs and normalized scores.
   *
   * Empty/blank queries return an empty array.
   * FTS5 syntax errors (malformed queries) return an empty array with a warning log.
   */
  search(query: string, limit = 10): FtsSearchResult[] {
    this.ensureDb();

    // Empty or blank query returns empty results
    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      const stmt = this.db!.prepare(
        `SELECT id, rank FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`
      );
      const rawResults = stmt.all(query.trim(), limit) as RawFtsResult[];
      return normalizeBm25Scores(rawResults);
    } catch (error) {
      // FTS5 syntax errors from malformed user input: log warning and return empty
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`FTS search query error: ${message}`);
      return [];
    }
  }

  /**
   * Delete an entry by ID.
   */
  delete(id: string): void {
    this.ensureDb();

    try {
      const stmt = this.db!.prepare('DELETE FROM memory_fts WHERE id = ?');
      stmt.run(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(
        `Failed to delete entry from FTS index: ${message}`,
        'FTS_DELETE',
        { entryId: id }
      );
    }
  }

  /**
   * Drop all rows. Used during re-indexing.
   */
  clear(): void {
    this.ensureDb();

    try {
      this.db!.exec('DELETE FROM memory_fts');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new StorageError(
        `Failed to clear FTS index: ${message}`,
        'FTS_CLEAR'
      );
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Convert a MemoryEntry to an FtsEntry for storage in the FTS5 table.
   */
  private entryToFtsRow(entry: MemoryEntry): FtsEntry {
    return {
      id: entry.id,
      content: entry.content,
      category: entry.metadata.category,
      source: entry.metadata.source,
      filePath: entry.metadata.filePath ?? '',
      sectionTitle: entry.metadata.sectionTitle ?? '',
      keywords: entry.metadata.keywords.join(' '),
    };
  }

  /**
   * Ensure the database is open before operations.
   * @throws StorageError if the database is not open
   */
  private ensureDb(): void {
    if (!this.db) {
      throw new StorageError(
        'FTS database not open. Call open() first.',
        'FTS_NOT_OPEN'
      );
    }
  }
}
