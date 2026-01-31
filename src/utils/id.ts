import { randomUUID } from 'crypto';

/**
 * Generate a unique ID for memory entries.
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate a slug from text for file names.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
