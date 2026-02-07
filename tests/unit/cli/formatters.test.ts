import { describe, it, expect } from 'vitest';
import { createFormatter } from '../../../src/cli/formatters';
import { ValidationError } from '../../../src/utils/errors';
import type { MemorySearchResult } from '../../../src/types/memory';
import type { MemoryCategory, MemorySource } from '../../../src/types/memory';

function makeMockResults(): MemorySearchResult[] {
  return [
    {
      entry: {
        id: 'test-1',
        content: 'Test content here',
        metadata: {
          category: 'architecture' as MemoryCategory,
          source: 'markdown' as MemorySource,
          filePath: 'test/path.md',
          sectionTitle: 'Test Section',
          keywords: ['test'],
          referenceCount: 0,
          promoted: false,
          promotedAt: '',
        },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
      score: 0.85,
    },
  ];
}

describe('createFormatter', () => {
  describe('text format', () => {
    it('produces numbered list', () => {
      const formatter = createFormatter('text');
      const output = formatter.format(makeMockResults(), 'test query');

      expect(output).toContain('1.');
      expect(output).toContain('[0.85]');
      expect(output).toContain('test/path.md');
      expect(output).toContain('Test content here');
    });

    it('handles empty results', () => {
      const formatter = createFormatter('text');
      const output = formatter.format([], 'test query');

      expect(output).toBe('No results found for: "test query"');
    });
  });

  describe('json format', () => {
    it('output parses as valid JSON array with correct fields', () => {
      const formatter = createFormatter('json');
      const output = formatter.format(makeMockResults(), 'test query');
      const parsed = JSON.parse(output) as unknown[];

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);

      const first = parsed[0] as Record<string, unknown>;
      expect(first).toHaveProperty('id', 'test-1');
      expect(first).toHaveProperty('score', 0.85);
      expect(first).toHaveProperty('content', 'Test content here');
      expect(first).toHaveProperty('category', 'architecture');
      expect(first).toHaveProperty('source', 'markdown');
      expect(first).toHaveProperty('filePath', 'test/path.md');
    });

    it('handles empty results', () => {
      const formatter = createFormatter('json');
      const output = formatter.format([], 'test query');

      expect(output).toBe('[]');
      expect(JSON.parse(output)).toEqual([]);
    });
  });

  describe('csv format', () => {
    it('has header row with 6 columns', () => {
      const formatter = createFormatter('csv');
      const output = formatter.format(makeMockResults(), 'test query');
      const lines = output.split('\n');
      const headerColumns = lines[0].split(',');

      expect(headerColumns).toHaveLength(6);
      expect(lines[0]).toBe('id,score,category,source,filePath,content');
    });

    it('escapes comma in field', () => {
      const results = makeMockResults();
      results[0].entry.content = 'has, a comma';

      const formatter = createFormatter('csv');
      const output = formatter.format(results, 'test query');

      expect(output).toContain('"has, a comma"');
    });

    it('escapes double quote in field', () => {
      const results = makeMockResults();
      results[0].entry.content = 'has "quotes" inside';

      const formatter = createFormatter('csv');
      const output = formatter.format(results, 'test query');

      expect(output).toContain('"has ""quotes"" inside"');
    });

    it('handles empty results', () => {
      const formatter = createFormatter('csv');
      const output = formatter.format([], 'test query');

      expect(output).toBe('id,score,category,source,filePath,content');
    });
  });

  describe('md format', () => {
    it('produces table with | Score | header', () => {
      const formatter = createFormatter('md');
      const output = formatter.format(makeMockResults(), 'test query');

      expect(output).toContain('| Score |');
      expect(output).toContain('| --- |');
      expect(output).toContain('| 0.85 |');
    });

    it('escapes pipe in content', () => {
      const results = makeMockResults();
      results[0].entry.content = 'value | other';

      const formatter = createFormatter('md');
      const output = formatter.format(results, 'test query');

      expect(output).toContain('value \\| other');
    });

    it('handles empty results', () => {
      const formatter = createFormatter('md');
      const output = formatter.format([], 'test query');

      expect(output).toContain('| Score |');
      expect(output).toContain('| - | - | - | - | No results |');
    });
  });

  describe('xml format', () => {
    it('starts with <?xml and has <searchResults', () => {
      const formatter = createFormatter('xml');
      const output = formatter.format(makeMockResults(), 'test query');

      expect(output).toMatch(/^<\?xml/);
      expect(output).toContain('<searchResults');
      expect(output).toContain('<result>');
      expect(output).toContain('<id>test-1</id>');
    });

    it('escapes & and < in content', () => {
      const results = makeMockResults();
      results[0].entry.content = 'a < b & c > d';

      const formatter = createFormatter('xml');
      const output = formatter.format(results, 'test query');

      expect(output).toContain('a &lt; b &amp; c &gt; d');
    });

    it('handles empty results', () => {
      const formatter = createFormatter('xml');
      const output = formatter.format([], 'test query');

      expect(output).toMatch(/^<\?xml/);
      expect(output).toContain('<searchResults');
      expect(output).not.toContain('<result>');
    });
  });

  describe('invalid format', () => {
    it('throws ValidationError', () => {
      expect(() => createFormatter('invalid')).toThrow(ValidationError);
    });
  });
});
