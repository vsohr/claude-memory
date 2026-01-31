import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';

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
  repository: MemoryRepository
): Promise<MemoryDeleteOutput> {
  const deleted = await repository.delete(input.id);

  if (deleted) {
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
