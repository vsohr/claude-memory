import type { MemorySearchResult } from '../types/memory.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Supported output formats for CLI results.
 */
export type OutputFormat = 'text' | 'json' | 'csv' | 'md' | 'xml';

/**
 * Flattened row for tabular/serialized output.
 */
export interface SearchResultRow {
  id: string;
  score: number;
  content: string;
  category: string;
  source: string;
  filePath: string;
}

/**
 * Formatter that converts search results into a specific output format.
 */
export interface OutputFormatter {
  format(results: MemorySearchResult[], query: string): string;
}

/**
 * Flatten MemorySearchResult[] into simple row objects for serialization.
 */
function toRows(results: MemorySearchResult[]): SearchResultRow[] {
  return results.map(r => ({
    id: r.entry.id,
    score: r.score,
    content: r.entry.content.slice(0, 200).replace(/\n/g, ' '),
    category: r.entry.metadata.category,
    source: r.entry.metadata.source,
    filePath: r.entry.metadata.filePath ?? '',
  }));
}

/**
 * Numbered text list output.
 */
class TextFormatter implements OutputFormatter {
  format(results: MemorySearchResult[], query: string): string {
    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }

    const rows = toRows(results);
    return rows
      .map((row, i) => {
        const num = i + 1;
        const scoreStr = row.score.toFixed(2);
        return `${num}. [${scoreStr}] ${row.filePath}\n   ${row.content}\n`;
      })
      .join('\n');
  }
}

/**
 * JSON array output.
 */
class JsonFormatter implements OutputFormatter {
  format(results: MemorySearchResult[]): string {
    if (results.length === 0) {
      return '[]';
    }
    return JSON.stringify(toRows(results), null, 2);
  }
}

/**
 * Escape a CSV field value. Fields containing commas, double quotes, or
 * newlines are wrapped in double quotes, with internal quotes doubled.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV output with header row.
 */
class CsvFormatter implements OutputFormatter {
  format(results: MemorySearchResult[]): string {
    const header = 'id,score,category,source,filePath,content';

    if (results.length === 0) {
      return header;
    }

    const rows = toRows(results);
    const lines = rows.map(row =>
      [
        escapeCsvField(row.id),
        escapeCsvField(row.score.toString()),
        escapeCsvField(row.category),
        escapeCsvField(row.source),
        escapeCsvField(row.filePath),
        escapeCsvField(row.content),
      ].join(',')
    );

    return [header, ...lines].join('\n');
  }
}

/**
 * Escape pipe characters in Markdown table cell content.
 */
function escapeMdPipe(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * Markdown table output.
 */
class MarkdownFormatter implements OutputFormatter {
  format(results: MemorySearchResult[]): string {
    const header = '| Score | Category | Source | File | Content |';
    const separator = '| --- | --- | --- | --- | --- |';

    if (results.length === 0) {
      return [header, separator, '| - | - | - | - | No results |'].join('\n');
    }

    const rows = toRows(results);
    const lines = rows.map(row =>
      `| ${row.score.toFixed(2)} | ${escapeMdPipe(row.category)} | ${escapeMdPipe(row.source)} | ${escapeMdPipe(row.filePath)} | ${escapeMdPipe(row.content)} |`
    );

    return [header, separator, ...lines].join('\n');
  }
}

/**
 * Escape XML special characters for safe inclusion in element text/attributes.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * XML output with proper entity escaping.
 */
class XmlFormatter implements OutputFormatter {
  format(results: MemorySearchResult[], query: string): string {
    const xmlDecl = '<?xml version="1.0" encoding="UTF-8"?>';

    if (results.length === 0) {
      return `${xmlDecl}\n<searchResults query="${escapeXml(query)}" />`;
    }

    const rows = toRows(results);
    const children = rows
      .map(row =>
        [
          '  <result>',
          `    <id>${escapeXml(row.id)}</id>`,
          `    <score>${row.score}</score>`,
          `    <category>${escapeXml(row.category)}</category>`,
          `    <source>${escapeXml(row.source)}</source>`,
          `    <filePath>${escapeXml(row.filePath)}</filePath>`,
          `    <content>${escapeXml(row.content)}</content>`,
          '  </result>',
        ].join('\n')
      )
      .join('\n');

    return `${xmlDecl}\n<searchResults query="${escapeXml(query)}">\n${children}\n</searchResults>`;
  }
}

const VALID_FORMATS: ReadonlySet<string> = new Set<string>([
  'text',
  'json',
  'csv',
  'md',
  'xml',
]);

/**
 * Create an OutputFormatter for the given format string.
 * Throws ValidationError for unknown formats.
 */
export function createFormatter(format: string): OutputFormatter {
  if (!VALID_FORMATS.has(format)) {
    throw new ValidationError(
      `Unknown output format: "${format}". Valid formats: text, json, csv, md, xml`,
      'format'
    );
  }

  switch (format as OutputFormat) {
    case 'text':
      return new TextFormatter();
    case 'json':
      return new JsonFormatter();
    case 'csv':
      return new CsvFormatter();
    case 'md':
      return new MarkdownFormatter();
    case 'xml':
      return new XmlFormatter();
  }
}
