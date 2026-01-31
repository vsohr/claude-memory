import matter from 'gray-matter';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface ContentChunk {
  title: string;
  content: string;
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
 * Split content into chunks by H3 headers.
 */
export function chunkByHeaders(content: string, maxChunkSize = 2000): ContentChunk[] {
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
      return splitLongContent({ title: '', content: trimmed }, maxChunkSize);
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

  return chunks;
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
