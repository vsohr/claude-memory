import { describe, it, expect } from 'vitest';
import { hashContent } from '../../../src/indexer/hasher';

describe('hashContent', () => {
  it('produces consistent hash for same content', () => {
    const content = 'Test content';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', () => {
    const hash1 = hashContent('Content A');
    const hash2 = hashContent('Content B');
    expect(hash1).not.toBe(hash2);
  });

  it('produces 64-character hex string (SHA-256)', () => {
    const hash = hashContent('Any content');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('normalizes line endings before hashing', () => {
    const hashCRLF = hashContent('Line1\r\nLine2');
    const hashLF = hashContent('Line1\nLine2');
    expect(hashCRLF).toBe(hashLF);
  });
});
