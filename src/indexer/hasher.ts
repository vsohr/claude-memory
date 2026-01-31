import { createHash } from 'crypto';

/**
 * Generate a SHA-256 hash of content.
 * Normalizes line endings to ensure consistent hashes across platforms.
 */
export function hashContent(content: string): string {
  // Normalize line endings to LF
  const normalized = content.replace(/\r\n/g, '\n');

  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}
