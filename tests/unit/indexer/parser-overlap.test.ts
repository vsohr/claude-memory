import { describe, it, expect } from 'vitest';
import { chunkByHeaders, extractOverlapTail, applyOverlap } from '../../../src/indexer/parser';
import type { ContentChunk } from '../../../src/indexer/parser';

describe('chunkByHeaders overlap', () => {
  const multiSectionContent = `
### First Section
First section has some content. It contains multiple sentences. This is the third sentence.

### Second Section
Second section also has content. It has details about topics. More sentences here.

### Third Section
Third section wraps things up. Final details are provided.
`;

  it('number param produces no overlap (backward compat)', () => {
    const chunks = chunkByHeaders(multiSectionContent, 2000);
    // With numeric param, overlapPercent=0, so no overlap
    expect(chunks).toHaveLength(3);
    // Second chunk should NOT contain content from the first chunk
    expect(chunks[1].content).not.toContain('First section');
    expect(chunks[1].content).toContain('Second section');
  });

  it('ChunkOptions with overlapPercent=15 adds overlap to chunk 2+', () => {
    const chunks = chunkByHeaders(multiSectionContent, {
      maxChunkSize: 2000,
      overlapPercent: 15,
    });
    expect(chunks.length).toBe(3);
    // First chunk is unmodified
    expect(chunks[0].content).not.toContain('Second section');
    // Second chunk should contain overlap from first chunk
    expect(chunks[1].content).toContain('Second section');
    // The overlap means some content from the first chunk should appear in the second
    // (since 15% of first chunk content is prepended)
    const firstContent = chunks[0].content;
    const secondContent = chunks[1].content;
    // The second chunk should be longer than it would be without overlap
    expect(secondContent.length).toBeGreaterThan(
      'Second section also has content. It has details about topics. More sentences here.'.length
    );
    // Verify some tail of first chunk appears in second chunk
    const overlapTail = extractOverlapTail(firstContent, Math.floor(firstContent.length * 0.15));
    if (overlapTail) {
      expect(secondContent).toContain(overlapTail);
    }
  });

  it('first chunk never modified', () => {
    const chunks = chunkByHeaders(multiSectionContent, {
      maxChunkSize: 2000,
      overlapPercent: 50,
    });
    // Even with 50% overlap, first chunk should be purely its own content
    expect(chunks[0].content).not.toContain('Second section');
    expect(chunks[0].content).not.toContain('Third section');
  });

  it('overlap snaps to sentence boundary', () => {
    // Use text with enough trailing sentences and spaces for the regex to find a boundary
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.';
    // Target ~20 chars from the end. cutPoint lands mid-word in "Fourth sentence."
    // The extractor should snap forward to the next sentence boundary.
    const overlap = extractOverlapTail(text, 20);
    expect(overlap.length).toBeGreaterThan(0);
    // The overlap should start at a sentence boundary (beginning of a full sentence)
    expect(overlap[0]).toMatch(/[A-Z]/);
  });

  it('single chunk unchanged regardless of overlapPercent', () => {
    const content = '# Title\nSingle chunk with no H3 headers.';
    const chunks = chunkByHeaders(content, { maxChunkSize: 2000, overlapPercent: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('# Title\nSingle chunk with no H3 headers.');
  });

  it('overlapPercent=0 produces no overlap', () => {
    const chunks = chunkByHeaders(multiSectionContent, {
      maxChunkSize: 2000,
      overlapPercent: 0,
    });
    expect(chunks).toHaveLength(3);
    // No overlap means second chunk has only its own content
    expect(chunks[1].content).not.toContain('First section');
  });

  it('no second arg defaults to overlapPercent=15', () => {
    const chunks = chunkByHeaders(multiSectionContent);
    expect(chunks.length).toBe(3);
    // With default 15% overlap, second chunk should have some overlap from first
    const firstContent = chunks[0].content;
    const overlapTail = extractOverlapTail(firstContent, Math.floor(firstContent.length * 0.15));
    if (overlapTail) {
      expect(chunks[1].content).toContain(overlapTail);
    }
  });
});

describe('extractOverlapTail', () => {
  it('returns empty string for targetLength=0', () => {
    expect(extractOverlapTail('Some text.', 0)).toBe('');
  });

  it('returns empty string for empty text', () => {
    expect(extractOverlapTail('', 10)).toBe('');
  });

  it('returns full text when targetLength >= text length', () => {
    const text = 'Short text.';
    expect(extractOverlapTail(text, 100)).toBe(text);
  });

  it('snaps to sentence boundary', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    // Requesting ~16 chars from the end would land in "Third sentence."
    const result = extractOverlapTail(text, 16);
    // Should snap to a sentence boundary
    expect(result).toBe('Third sentence.');
  });
});

describe('applyOverlap', () => {
  it('returns same chunks when overlapPercent is 0', () => {
    const chunks: ContentChunk[] = [
      { title: 'A', content: 'Content A.' },
      { title: 'B', content: 'Content B.' },
    ];
    const result = applyOverlap(chunks, 0);
    expect(result).toEqual(chunks);
  });

  it('returns same chunks when only one chunk', () => {
    const chunks: ContentChunk[] = [{ title: 'Only', content: 'Only content here.' }];
    const result = applyOverlap(chunks, 15);
    expect(result).toEqual(chunks);
  });

  it('does not modify first chunk', () => {
    const chunks: ContentChunk[] = [
      { title: 'First', content: 'First content. More first content. Even more first.' },
      { title: 'Second', content: 'Second content here.' },
    ];
    const result = applyOverlap(chunks, 30);
    expect(result[0].content).toBe('First content. More first content. Even more first.');
  });
});
