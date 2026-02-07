import matter from 'gray-matter';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface ContentChunk {
  title: string;
  content: string;
}

export interface ChunkOptions {
  maxChunkSize?: number;
  overlapPercent?: number;
}

/**
 * Parse markdown file extracting frontmatter and content.
 */
export function parseMarkdown(markdown: string): ParsedMarkdown {
  const { data, content } = matter(markdown);
  return {
    frontmatter: data as Record<string, unknown>,
    content: content.trim(),
  };
}

/**
 * Resolve the second parameter of chunkByHeaders to a normalized ChunkOptions.
 * - number -> backward compat: { maxChunkSize: number, overlapPercent: 0 }
 * - ChunkOptions -> use values with defaults
 * - undefined -> defaults (maxChunkSize=2000, overlapPercent=15)
 */
function resolveChunkOptions(options?: ChunkOptions | number): Required<ChunkOptions> {
  if (typeof options === 'number') {
    return { maxChunkSize: options, overlapPercent: 0 };
  }
  return {
    maxChunkSize: options?.maxChunkSize ?? 2000,
    overlapPercent: options?.overlapPercent ?? 15,
  };
}

/**
 * Extract the tail portion of text for overlap, snapping to sentence boundaries.
 * Returns up to targetLength characters from the end, but snaps forward to the
 * start of the nearest complete sentence.
 */
export function extractOverlapTail(text: string, targetLength: number): string {
  if (targetLength <= 0 || text.length === 0) return '';
  if (targetLength >= text.length) return text;

  // Start from the rough cut point
  const cutPoint = text.length - targetLength;

  // Look for a sentence boundary (.!?) after the cut point to snap forward
  const sentenceEndRegex = /[.!?]\s+/g;
  let bestSnapPoint = cutPoint;
  let match: RegExpExecArray | null;

  // Find the first sentence boundary at or after the cut point
  sentenceEndRegex.lastIndex = cutPoint;
  match = sentenceEndRegex.exec(text);

  if (match !== null && match.index < text.length - 1) {
    // Snap to after the sentence-ending punctuation + whitespace
    bestSnapPoint = match.index + match[0].length;
  }

  // If snap point would consume the entire string, fall back to the raw cut
  if (bestSnapPoint >= text.length) {
    bestSnapPoint = cutPoint;
  }

  return text.slice(bestSnapPoint).trim();
}

/**
 * Apply overlap by prepending a tail from the previous chunk to each subsequent chunk.
 * The first chunk is never modified.
 */
export function applyOverlap(chunks: ContentChunk[], overlapPercent: number): ContentChunk[] {
  if (overlapPercent <= 0 || chunks.length <= 1) return chunks;

  const result: ContentChunk[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const prevContent = chunks[i - 1].content;
    const targetLength = Math.floor(prevContent.length * (overlapPercent / 100));
    const overlap = extractOverlapTail(prevContent, targetLength);

    if (overlap) {
      result.push({
        title: chunks[i].title,
        content: overlap + '\n\n' + chunks[i].content,
      });
    } else {
      result.push(chunks[i]);
    }
  }

  return result;
}

/**
 * Split content into chunks by H3 headers.
 * Accepts either a number (backward compat, no overlap) or ChunkOptions.
 */
export function chunkByHeaders(content: string, options?: ChunkOptions | number): ContentChunk[] {
  const { maxChunkSize, overlapPercent } = resolveChunkOptions(options);
  const h3Regex = /^###\s+(.+)$/gm;
  const chunks: ContentChunk[] = [];

  // Find all H3 headers
  const matches: Array<{ title: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = h3Regex.exec(content)) !== null) {
    matches.push({ title: match[1].trim(), index: match.index });
  }

  if (matches.length === 0) {
    // No H3 headers, treat entire content as one chunk
    const trimmed = content.trim();
    if (trimmed) {
      return applyOverlap(splitLongContent({ title: '', content: trimmed }, maxChunkSize), overlapPercent);
    }
    return [];
  }

  // Process each section
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = i < matches.length - 1 ? matches[i + 1].index : content.length;

    // Get content between this header and the next
    const headerLine = content.indexOf('\n', current.index);
    const sectionContent = content.slice(headerLine + 1, nextIndex).trim();

    if (sectionContent) {
      const sectionChunks = splitLongContent(
        { title: current.title, content: sectionContent },
        maxChunkSize
      );
      chunks.push(...sectionChunks);
    }
  }

  return applyOverlap(chunks, overlapPercent);
}

/**
 * Split a chunk that exceeds maxChunkSize at sentence boundaries.
 */
function splitLongContent(chunk: ContentChunk, maxChunkSize: number): ContentChunk[] {
  if (chunk.content.length <= maxChunkSize) {
    return [chunk];
  }

  const sentences = chunk.content.match(/[^.!?]+[.!?]+\s*/g) || [chunk.content];
  const chunks: ContentChunk[] = [];
  let currentContent = '';
  let partNumber = 1;

  for (const sentence of sentences) {
    if (currentContent.length + sentence.length > maxChunkSize && currentContent) {
      chunks.push({
        title: chunk.title ? `${chunk.title} (Part ${partNumber})` : '',
        content: currentContent.trim(),
      });
      currentContent = sentence;
      partNumber++;
    } else {
      currentContent += sentence;
    }
  }

  if (currentContent.trim()) {
    chunks.push({
      title: chunk.title ? `${chunk.title} (Part ${partNumber})` : '',
      content: currentContent.trim(),
    });
  }

  return chunks;
}
