import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { analyzeCommand } from '../../cli/commands/analyze.js';

export const memoryAnalyzeToolDefinition: Tool = {
  name: 'memory_analyze',
  description:
    'Deep analysis of the repository: extracts documentation, code structure (exports, classes, interfaces), API routes, and architecture patterns. Saves findings to memory for semantic search. Use this when first working with a codebase or when you need comprehensive understanding.',
  inputSchema: {
    type: 'object',
    properties: {
      save: {
        type: 'boolean',
        description: 'Whether to save findings to memory (default: true)',
        default: true,
      },
    },
    required: [],
  },
};

export interface AnalyzeArgs {
  save?: boolean;
}

export interface AnalyzeResult {
  success: boolean;
  docsIndexed: number;
  exportsFound: number;
  routesFound: number;
  patternsFound: string[];
  entriesSaved: number;
  error?: string;
}

export async function handleMemoryAnalyze(
  args: AnalyzeArgs,
  targetDir: string
): Promise<AnalyzeResult> {
  try {
    const result = await analyzeCommand(targetDir, {
      save: args.save !== false,
    });

    return {
      success: true,
      docsIndexed: result.docsIndexed,
      exportsFound: result.exportsFound,
      routesFound: result.routesFound,
      patternsFound: result.patternsFound,
      entriesSaved: result.saved,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      docsIndexed: 0,
      exportsFound: 0,
      routesFound: 0,
      patternsFound: [],
      entriesSaved: 0,
      error: message,
    };
  }
}
