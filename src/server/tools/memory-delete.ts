import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { FtsStore } from '../../storage/fts';
import { logger } from '../../utils/logger';

export const memoryDeleteSchema = z.object({
  id: z.string().min(1),
});

export type MemoryDeleteInput = z.infer<typeof memoryDeleteSchema>;

export interface MemoryDeleteOutput {
  deleted: boolean;
  id: string;
  reason?: string;
}

export async function handleMemoryDelete(
  input: { id: string },
  repository: MemoryRepository,
  ftsStore?: FtsStore
): Promise<MemoryDeleteOutput> {
  const deleted = await repository.delete(input.id);

  if (deleted) {
    // Sync deletion to FTS index if available
    if (ftsStore) {
      try {
        ftsStore.delete(input.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`FTS sync failed for deleted entry ${input.id}: ${message}`);
      }
    }

    return { deleted: true, id: input.id };
  }

  return {
    deleted: false,
    id: input.id,
    reason: 'Entry not found',
  };
}

export const memoryDeleteToolDefinition = {
  name: 'memory_delete',
  description: 'Delete a memory entry by ID.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'Entry ID to delete',
      },
    },
    required: ['id'],
  },
};
