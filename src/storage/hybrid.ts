import type { MemoryEntry, MemorySearchResult, MemoryCategory, SearchMode } from '../types/memory.js';
import type { MemoryRepository } from './lancedb.js';
import type { FtsStore, FtsSearchResult } from './fts.js';
import type { MemoryConfigResolved } from '../utils/config.js';

/**
 * Options for hybrid search queries.
 */
export interface HybridSearchOptions {
  query: string;
  limit?: number;
  mode?: SearchMode;
  category?: MemoryCategory;
  /** Override minimum similarity threshold (vector mode only). */
  minScore?: number;
}

/**
 * Internal ranked item used during RRF fusion.
 */
interface RankedItem {
  id: string;
  entry?: MemoryEntry;
  rrfScore: number;
}

/** Reciprocal Rank Fusion constant. */
const RRF_K = 60;

/** Over-fetch factor for hybrid mode to ensure enough candidates for fusion. */
const DEFAULT_OVER_FETCH_FACTOR = 3;

/**
 * Orchestrator that routes search queries to vector, keyword, or hybrid mode
 * and fuses results using Reciprocal Rank Fusion (RRF).
 */
export class HybridSearch {
  private repository: MemoryRepository;
  private ftsStore: FtsStore;
  private config: MemoryConfigResolved;

  constructor(
    repository: MemoryRepository,
    ftsStore: FtsStore,
    config: MemoryConfigResolved,
  ) {
    this.repository = repository;
    this.ftsStore = ftsStore;
    this.config = config;
  }

  /**
   * Execute a search query, routing to the appropriate strategy based on mode.
   */
  async search(options: HybridSearchOptions): Promise<MemorySearchResult[]> {
    const limit = options.limit ?? 5;
    const mode = options.mode ?? this.config.defaultSearchMode;
    const { query, category, minScore } = options;

    switch (mode) {
      case 'vector':
        return this.searchVector(query, limit, minScore, category);
      case 'keyword':
        return this.searchKeyword(query, limit, category);
      case 'hybrid':
        return this.searchHybrid(query, limit, minScore, category);
      default:
        return this.searchHybrid(query, limit, minScore, category);
    }
  }

  /**
   * Vector-only search using LanceDB embeddings.
   * Filters by minimum similarity score and optional category.
   */
  private async searchVector(
    query: string,
    limit: number,
    minScore: number | undefined,
    category: MemoryCategory | undefined,
  ): Promise<MemorySearchResult[]> {
    const results = await this.repository.search(query, limit);
    const threshold = minScore ?? this.config.minScore;

    let filtered = results.filter(r => r.score >= threshold);

    if (category) {
      filtered = filtered.filter(r => r.entry.metadata.category === category);
    }

    return filtered;
  }

  /**
   * Keyword-only search using FTS5 BM25 ranking.
   * Fetches full entries from LanceDB for each FTS hit.
   */
  private async searchKeyword(
    query: string,
    limit: number,
    category: MemoryCategory | undefined,
  ): Promise<MemorySearchResult[]> {
    const ftsResults = this.ftsStore.search(query, limit);

    const results: MemorySearchResult[] = [];
    for (const ftsResult of ftsResults) {
      const entry = await this.repository.get(ftsResult.id);
      if (entry === null) continue;

      if (category && entry.metadata.category !== category) continue;

      results.push({
        entry,
        score: ftsResult.score,
      });
    }

    return results;
  }

  /**
   * Hybrid search: run vector and keyword in parallel, fuse with RRF.
   */
  private async searchHybrid(
    query: string,
    limit: number,
    _minScore: number | undefined,
    category: MemoryCategory | undefined,
  ): Promise<MemorySearchResult[]> {
    const overFetchLimit = limit * DEFAULT_OVER_FETCH_FACTOR;

    const [vectorResults, ftsResults] = await Promise.all([
      this.repository.search(query, overFetchLimit),
      Promise.resolve(this.ftsStore.search(query, overFetchLimit)),
    ]);

    const ranked = this.fuseWithRrf(vectorResults, ftsResults);

    // Sort by RRF score descending
    ranked.sort((a, b) => b.rrfScore - a.rrfScore);

    // Fetch entries for keyword-only hits (no entry loaded from vector results)
    const results: MemorySearchResult[] = [];
    for (const item of ranked) {
      let entry = item.entry;
      if (!entry) {
        entry = await this.repository.get(item.id) ?? undefined;
        if (!entry) continue;
      }

      if (category && entry.metadata.category !== category) continue;

      results.push({
        entry,
        score: item.rrfScore,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Fuse vector and BM25 results using Reciprocal Rank Fusion.
   *
   * RRF score for each item = sum of 1 / (K + rank + 1) across result lists.
   * Items appearing in both lists get a higher combined score.
   */
  private fuseWithRrf(
    vectorResults: MemorySearchResult[],
    bm25Results: FtsSearchResult[],
  ): RankedItem[] {
    const map = new Map<string, RankedItem>();

    // Process vector results
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const result = vectorResults[rank];
      const rrfScore = 1 / (RRF_K + rank + 1);
      map.set(result.entry.id, {
        id: result.entry.id,
        entry: result.entry,
        rrfScore,
      });
    }

    // Process BM25 results
    for (let rank = 0; rank < bm25Results.length; rank++) {
      const result = bm25Results[rank];
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = map.get(result.id);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        map.set(result.id, {
          id: result.id,
          rrfScore,
        });
      }
    }

    return Array.from(map.values());
  }
}
