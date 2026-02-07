import { z } from 'zod';
import type { HybridSearch } from '../../storage/hybrid';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory, SearchMode } from '../../types/memory';

export const memorySearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(20).default(5),
  category: z
    .enum([
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ])
    .optional(),
  mode: z.enum(['vector', 'keyword', 'hybrid']).default('hybrid'),
});

export type MemorySearchInput = z.infer<typeof memorySearchSchema>;

export interface MemorySearchOutput {
  results: Array<{
    id: string;
    content: string;
    score: number;
    category: string;
    source: string;
    filePath?: string;
  }>;
  query: string;
  count: number;
  error?: string;
  code?: string;
}

export async function handleMemorySearch(
  input: { query: string; limit?: number; category?: string; mode?: SearchMode },
  hybridSearch: HybridSearch,
  repository?: MemoryRepository,
): Promise<MemorySearchOutput> {
  // Validate input
  if (!input.query || input.query.trim() === '') {
    return {
      results: [],
      query: '',
      count: 0,
      error: 'Query cannot be empty',
      code: 'INVALID_INPUT',
    };
  }

  const limit = input.limit ?? 5;
  const mode = input.mode ?? 'hybrid';
  const category = input.category as MemoryCategory | undefined;

  const searchResults = await hybridSearch.search({
    query: input.query,
    limit,
    mode,
    category,
  });

  // Increment reference counts for matched entries (non-blocking)
  if (repository) {
    for (const result of searchResults) {
      try {
        await repository.incrementReferenceCount(result.entry.id);
      } catch {
        // Reference count is best-effort, don't fail the search
      }
    }
  }

  return {
    results: searchResults.map((r) => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score,
      category: r.entry.metadata.category,
      source: r.entry.metadata.source,
      filePath: r.entry.metadata.filePath,
    })),
    query: input.query,
    count: searchResults.length,
  };
}

export const memorySearchToolDefinition = {
  name: 'memory_search',
  description:
    'Search project memory using semantic similarity. Returns relevant knowledge entries.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
        minLength: 1,
        maxLength: 500,
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 5, max: 20)',
        minimum: 1,
        maximum: 20,
        default: 5,
      },
      category: {
        type: 'string',
        description: 'Filter by category',
        enum: [
          'architecture',
          'component',
          'domain',
          'pattern',
          'gotcha',
          'discovery',
          'general',
        ],
      },
      mode: {
        type: 'string',
        description: 'Search mode: vector (semantic), keyword (BM25), or hybrid (both fused with RRF). Default: hybrid',
        enum: ['vector', 'keyword', 'hybrid'],
        default: 'hybrid',
      },
    },
    required: ['query'],
  },
};
