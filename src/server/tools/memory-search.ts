import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

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

// Minimum similarity score to include in results.
// Score is calculated as 1 - distance. For dissimilar vectors, this can be negative.
// We filter out strongly dissimilar results (score < -0.5).
const MIN_SIMILARITY_SCORE = -0.5;

export async function handleMemorySearch(
  input: { query: string; limit?: number; category?: string },
  repository: MemoryRepository
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
  const searchResults = await repository.search(input.query, limit);

  // Filter out low-scoring results
  let filteredResults = searchResults.filter((r) => r.score >= MIN_SIMILARITY_SCORE);

  // Filter by category if specified
  if (input.category) {
    filteredResults = filteredResults.filter(
      (r) => r.entry.metadata.category === input.category
    );
  }

  // Increment reference counts
  for (const result of filteredResults) {
    await repository.incrementReferenceCount(result.entry.id);
  }

  return {
    results: filteredResults.map((r) => ({
      id: r.entry.id,
      content: r.entry.content,
      score: r.score,
      category: r.entry.metadata.category,
      source: r.entry.metadata.source,
      filePath: r.entry.metadata.filePath,
    })),
    query: input.query,
    count: filteredResults.length,
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
    },
    required: ['query'],
  },
};
