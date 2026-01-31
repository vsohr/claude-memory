import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { MemoryCategory } from '../../types/memory';

export const memoryListSchema = z.object({
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
  limit: z.number().min(1).max(100).default(50),
});

export type MemoryListInput = z.infer<typeof memoryListSchema>;

export interface MemoryListOutput {
  entries: Array<{
    id: string;
    content: string;
    category: string;
    createdAt: string;
  }>;
  count: number;
  category?: string;
}

export async function handleMemoryList(
  input: { category?: string; limit?: number },
  repository: MemoryRepository
): Promise<MemoryListOutput> {
  const limit = input.limit ?? 50;
  const category = input.category as MemoryCategory | undefined;

  const entries = await repository.list(category, limit);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      content: e.content,
      category: e.metadata.category,
      createdAt: e.createdAt,
    })),
    count: entries.length,
    category: input.category,
  };
}

export const memoryListToolDefinition = {
  name: 'memory_list',
  description: 'List memory entries, optionally filtered by category.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (omit for all)',
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
      limit: {
        type: 'number',
        description: 'Maximum entries to return (default: 50)',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
    },
  },
};
