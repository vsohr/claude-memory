import { z } from 'zod';
import type { MemoryRepository } from '../../storage/lancedb';
import type { FtsStore } from '../../storage/fts';
import type { MemoryCategory } from '../../types/memory';
import { logger } from '../../utils/logger';

const MAX_CONTENT_LENGTH = 10000;

export const memoryAddSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
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
    .default('general'),
  keywords: z.array(z.string()).max(10).optional(),
});

export type MemoryAddInput = z.infer<typeof memoryAddSchema>;

export interface MemoryAddOutput {
  success: boolean;
  id?: string;
  message?: string;
  error?: string;
  code?: string;
}

export async function handleMemoryAdd(
  input: { content: string; category?: string; keywords?: string[] },
  repository: MemoryRepository,
  ftsStore?: FtsStore
): Promise<MemoryAddOutput> {
  // Validate content
  if (!input.content || input.content.trim() === '') {
    return {
      success: false,
      error: 'Content is required',
      code: 'INVALID_INPUT',
    };
  }

  if (input.content.length > MAX_CONTENT_LENGTH) {
    return {
      success: false,
      error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`,
      code: 'CONTENT_TOO_LONG',
    };
  }

  // Validate category
  const validCategories = [
    'architecture',
    'component',
    'domain',
    'pattern',
    'gotcha',
    'discovery',
    'general',
  ];
  const category = validCategories.includes(input.category ?? '')
    ? (input.category as MemoryCategory)
    : 'general';

  const entry = await repository.add({
    content: input.content,
    metadata: {
      category,
      source: 'session',
      keywords: input.keywords ?? [],
    },
  });

  // Sync to FTS index if available
  if (ftsStore) {
    try {
      ftsStore.add(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`FTS sync failed for added entry ${entry.id}: ${message}`);
    }
  }

  return {
    success: true,
    id: entry.id,
    message: 'Entry added to memory',
  };
}

export const memoryAddToolDefinition = {
  name: 'memory_add',
  description: 'Add a new knowledge entry to project memory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string',
        description: 'The knowledge content to store',
        minLength: 1,
        maxLength: MAX_CONTENT_LENGTH,
      },
      category: {
        type: 'string',
        description: 'Entry category (default: general)',
        enum: [
          'architecture',
          'component',
          'domain',
          'pattern',
          'gotcha',
          'discovery',
          'general',
        ],
        default: 'general',
      },
      keywords: {
        type: 'array',
        description: 'Keywords for search boosting',
        items: { type: 'string' },
        maxItems: 10,
      },
    },
    required: ['content'],
  },
};
