import { describe, it, expect } from 'vitest';
import type { MemoryEntry, MemoryCategory, MemoryMetadata } from '../../../src/types/memory';

describe('Memory Types', () => {
  it('MemoryEntry has required fields', () => {
    const entry: MemoryEntry = {
      id: 'test-id',
      content: 'Test content',
      metadata: {
        category: 'general',
        source: 'manual',
        keywords: [],
        referenceCount: 0,
        promoted: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(entry.id).toBe('test-id');
    expect(entry.metadata.category).toBe('general');
  });

  it('MemoryCategory includes all valid values', () => {
    const categories: MemoryCategory[] = [
      'architecture',
      'component',
      'domain',
      'pattern',
      'gotcha',
      'discovery',
      'general',
    ];
    expect(categories).toHaveLength(7);
  });
});
