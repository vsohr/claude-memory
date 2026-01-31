import { describe, it, expect } from 'vitest';
import { parseMarkdown, chunkByHeaders } from '../../../src/indexer/parser';

describe('parseMarkdown', () => {
  it('extracts frontmatter', () => {
    const md = `---
title: Test Doc
category: architecture
---
# Content here`;
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({ title: 'Test Doc', category: 'architecture' });
  });

  it('handles missing frontmatter', () => {
    const md = '# Just content\nSome text';
    const result = parseMarkdown(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toContain('Just content');
  });
});

describe('chunkByHeaders', () => {
  it('splits on H3 headers', () => {
    const content = `
### First Section
Content for first section.

### Second Section
Content for second section.
`;
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].title).toBe('First Section');
    expect(chunks[0].content).toContain('Content for first section');
    expect(chunks[1].title).toBe('Second Section');
  });

  it('returns single chunk when no H3 headers', () => {
    const content = '# Main Title\nSome content without H3 headers.';
    const chunks = chunkByHeaders(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].title).toBe('');
  });

  it('splits oversized sections at sentence boundaries', () => {
    const longSentence = 'This is a test sentence. ';
    const longContent = `### Long Section\n${longSentence.repeat(200)}`; // >2000 chars
    const chunks = chunkByHeaders(longContent, 500);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.content.length).toBeLessThanOrEqual(550); // Allow some buffer
    });
  });
});
