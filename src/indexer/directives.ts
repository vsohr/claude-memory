export interface DirectiveResult {
  vectorIndex: boolean;
  keywords: string[];
  warnings: string[];
}

const VECTOR_INDEX_REGEX = /<!--\s*vector-index:\s*(\w+)\s*-->/i;
const KEYWORDS_REGEX = /<!--\s*keywords:\s*(.*?)\s*-->/i;

/**
 * Parse directives from markdown content.
 */
export function parseDirectives(content: string): DirectiveResult {
  const result: DirectiveResult = {
    vectorIndex: true,
    keywords: [],
    warnings: [],
  };

  // Parse vector-index directive
  const vectorMatch = VECTOR_INDEX_REGEX.exec(content);
  if (vectorMatch) {
    const value = vectorMatch[1].toLowerCase();
    if (value === 'true') {
      result.vectorIndex = true;
    } else if (value === 'false') {
      result.vectorIndex = false;
    } else {
      result.warnings.push(`Invalid vector-index value: ${vectorMatch[1]}`);
    }
  }

  // Parse keywords directive
  const keywordsMatch = KEYWORDS_REGEX.exec(content);
  if (keywordsMatch) {
    const keywordsStr = keywordsMatch[1].trim();
    if (keywordsStr) {
      result.keywords = keywordsStr
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);
    }
  }

  return result;
}
