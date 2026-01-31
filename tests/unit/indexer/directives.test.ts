import { describe, it, expect } from 'vitest';
import { parseDirectives } from '../../../src/indexer/directives';

describe('parseDirectives', () => {
  it('parses vector-index: false', () => {
    const content = '<!-- vector-index: false -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(false);
  });

  it('parses vector-index: true', () => {
    const content = '<!-- vector-index: true -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
  });

  it('defaults vector-index to true', () => {
    const content = '# No directive here';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
  });

  it('parses keywords', () => {
    const content = '<!-- keywords: auth, jwt, security -->\n# Content';
    const result = parseDirectives(content);
    expect(result.keywords).toEqual(['auth', 'jwt', 'security']);
  });

  it('handles empty keywords', () => {
    const content = '<!-- keywords: -->\n# Content';
    const result = parseDirectives(content);
    expect(result.keywords).toEqual([]);
  });

  it('handles malformed vector-index directive', () => {
    const content = '<!-- vector-index: maybe -->\n# Content';
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
    expect(result.warnings).toContain('Invalid vector-index value: maybe');
  });

  it('parses multiple directives', () => {
    const content = `<!-- vector-index: true -->
<!-- keywords: api, rest, http -->
# Content`;
    const result = parseDirectives(content);
    expect(result.vectorIndex).toBe(true);
    expect(result.keywords).toEqual(['api', 'rest', 'http']);
  });
});
