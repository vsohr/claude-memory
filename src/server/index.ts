import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join, resolve, normalize } from 'path';
import { MemoryRepository } from '../storage/lancedb';
import { FtsStore } from '../storage/fts';
import { HybridSearch } from '../storage/hybrid';
import { loadConfig } from '../utils/config';
import {
  handleMemorySearch,
  memorySearchToolDefinition,
} from './tools/memory-search';
import {
  handleMemoryAdd,
  memoryAddToolDefinition,
} from './tools/memory-add';
import {
  handleMemoryList,
  memoryListToolDefinition,
} from './tools/memory-list';
import {
  handleMemoryDelete,
  memoryDeleteToolDefinition,
} from './tools/memory-delete';
import {
  handleMemoryAnalyze,
  memoryAnalyzeToolDefinition,
} from './tools/memory-analyze';
import { logger } from '../utils/logger';

export interface ServerConfig {
  vectorsDir: string;
  projectRoot?: string; // If not provided, derived from vectorsDir
  ftsPath?: string; // If not provided, derived from vectorsDir
  testMode?: boolean;
}

export class MemoryServer {
  private server: Server;
  private repository: MemoryRepository;
  private ftsStore: FtsStore;
  private hybridSearch: HybridSearch;
  private config: ServerConfig;
  private projectRoot: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.repository = new MemoryRepository(config.vectorsDir);
    // Derive project root from vectorsDir: .claude/memory/vectors -> project root
    this.projectRoot = config.projectRoot || join(config.vectorsDir, '..', '..', '..');

    // Derive FTS path from vectorsDir sibling or explicit config
    const ftsPath = config.ftsPath || join(config.vectorsDir, '..', 'fts.sqlite');
    this.ftsStore = new FtsStore(ftsPath);

    // Load config and create HybridSearch orchestrator
    const memoryConfig = loadConfig(this.projectRoot);
    this.hybridSearch = new HybridSearch(this.repository, this.ftsStore, memoryConfig);

    this.server = new Server(
      { name: 'claude-memory', version: '0.2.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        memorySearchToolDefinition,
        memoryAddToolDefinition,
        memoryListToolDefinition,
        memoryDeleteToolDefinition,
        memoryAnalyzeToolDefinition,
      ],
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'memory_search': {
            const result = await handleMemorySearch(
              args as { query: string; limit?: number; category?: string; mode?: 'vector' | 'keyword' | 'hybrid' },
              this.hybridSearch
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !!result.error,
            };
          }
          case 'memory_add': {
            const result = await handleMemoryAdd(
              args as { content: string; category?: string; keywords?: string[] },
              this.repository,
              this.ftsStore
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !result.success,
            };
          }
          case 'memory_list': {
            const result = await handleMemoryList(
              args as { category?: string; limit?: number },
              this.repository
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: false,
            };
          }
          case 'memory_delete': {
            const result = await handleMemoryDelete(
              args as { id: string },
              this.repository,
              this.ftsStore
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !result.deleted,
            };
          }
          case 'memory_analyze': {
            const result = await handleMemoryAnalyze(
              args as { save?: boolean },
              this.projectRoot
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !result.success,
            };
          }
          default:
            return {
              content: [
                { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
              ],
              isError: true,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: message, code: 'INTERNAL_ERROR' }),
            },
          ],
          isError: true,
        };
      }
    });

    // List resource templates
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: 'memory://{path}',
          name: 'Knowledge File',
          description: 'Read a knowledge file from .claude/knowledge/ by path',
          mimeType: 'text/markdown',
        },
      ],
    }));

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const match = uri.match(/^memory:\/\/(.+)$/);
      if (!match) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const requestedPath = match[1];

      // Security: reject path traversal
      if (requestedPath.includes('..')) {
        throw new Error('Path traversal not allowed');
      }

      // Security: reject absolute paths
      if (requestedPath.startsWith('/')) {
        throw new Error('Absolute paths not allowed');
      }

      const knowledgeDir = resolve(this.projectRoot, '.claude', 'knowledge');
      const resolvedPath = resolve(knowledgeDir, requestedPath);

      // Verify resolved path is within knowledge directory
      if (!resolvedPath.startsWith(knowledgeDir)) {
        throw new Error('Path traversal not allowed');
      }

      const contents = await readFile(resolvedPath, 'utf-8');

      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: contents,
          },
        ],
      };
    });

    // List prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'query',
          description: 'Search strategy guide for querying project memory effectively',
          arguments: [
            {
              name: 'topic',
              description: 'The topic you want to search for',
              required: true,
            },
          ],
        },
      ],
    }));

    // Get prompt
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;

      if (name !== 'query') {
        throw new Error(`Unknown prompt: ${name}`);
      }

      const topic = request.params.arguments?.topic ?? 'general';

      return {
        description: 'Search strategy guide for querying project memory',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                `Search strategy for: "${topic}"`,
                '',
                'Available search modes:',
                '- **hybrid** (default): Combines vector semantic search with BM25 keyword search using Reciprocal Rank Fusion. Best for most queries.',
                '- **vector**: Pure semantic similarity search. Best for conceptual/natural language queries.',
                '- **keyword**: Pure BM25 text matching. Best for exact terms, error messages, or code identifiers.',
                '',
                'Tips:',
                '1. Start with hybrid mode (default) for balanced results',
                '2. Use keyword mode for exact error messages or specific function names',
                '3. Use vector mode for broad conceptual questions',
                '4. Filter by category to narrow results (architecture, component, domain, pattern, gotcha, discovery, general)',
                '5. Increase limit if you need more context',
              ].join('\n'),
            },
          },
        ],
      };
    });
  }

  async start(): Promise<void> {
    await this.repository.connect();
    logger.info('Memory repository connected');

    this.ftsStore.open();
    logger.info('FTS store opened');

    if (!this.config.testMode) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('MCP server started');
    }
  }

  async stop(): Promise<void> {
    this.ftsStore.close();
    await this.repository.disconnect();
    await this.server.close();
  }

  // For testing
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (name) {
      case 'memory_search':
        return handleMemorySearch(
          args as { query: string; limit?: number; mode?: 'vector' | 'keyword' | 'hybrid' },
          this.hybridSearch
        );
      case 'memory_add':
        return handleMemoryAdd(
          args as { content: string; category?: string; keywords?: string[] },
          this.repository,
          this.ftsStore
        );
      case 'memory_list':
        return handleMemoryList(
          args as { category?: string; limit?: number },
          this.repository
        );
      case 'memory_delete':
        return handleMemoryDelete(
          args as { id: string },
          this.repository,
          this.ftsStore
        );
      case 'memory_analyze':
        return handleMemoryAnalyze(args as { save?: boolean }, this.projectRoot);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // For testing: list resource templates
  async listResourceTemplates(): Promise<{ resourceTemplates: Array<{ uriTemplate: string; name: string; description: string; mimeType: string }> }> {
    return {
      resourceTemplates: [
        {
          uriTemplate: 'memory://{path}',
          name: 'Knowledge File',
          description: 'Read a knowledge file from .claude/knowledge/ by path',
          mimeType: 'text/markdown',
        },
      ],
    };
  }

  // For testing: read a resource by URI
  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    const match = uri.match(/^memory:\/\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

    const requestedPath = match[1];

    // Security: reject path traversal
    if (requestedPath.includes('..')) {
      throw new Error('Path traversal not allowed');
    }

    // Security: reject absolute paths
    if (requestedPath.startsWith('/')) {
      throw new Error('Absolute paths not allowed');
    }

    const knowledgeDir = resolve(this.projectRoot, '.claude', 'knowledge');
    const resolvedPath = resolve(knowledgeDir, requestedPath);

    // Verify resolved path is within knowledge directory
    if (!resolvedPath.startsWith(knowledgeDir)) {
      throw new Error('Path traversal not allowed');
    }

    const contents = await readFile(resolvedPath, 'utf-8');

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: contents,
        },
      ],
    };
  }

  // For testing: list prompts
  async listPrompts(): Promise<{ prompts: Array<{ name: string; description: string }> }> {
    return {
      prompts: [
        {
          name: 'query',
          description: 'Search strategy guide for querying project memory effectively',
        },
      ],
    };
  }

  // For testing: get a prompt by name
  async getPrompt(name: string, args?: Record<string, string>): Promise<{ description: string; messages: Array<{ role: string; content: { type: string; text: string } }> }> {
    if (name !== 'query') {
      throw new Error(`Unknown prompt: ${name}`);
    }

    const topic = args?.topic ?? 'general';

    return {
      description: 'Search strategy guide for querying project memory',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Search strategy for: "${topic}"`,
              '',
              'Available search modes:',
              '- **hybrid** (default): Combines vector semantic search with BM25 keyword search using Reciprocal Rank Fusion. Best for most queries.',
              '- **vector**: Pure semantic similarity search. Best for conceptual/natural language queries.',
              '- **keyword**: Pure BM25 text matching. Best for exact terms, error messages, or code identifiers.',
              '',
              'Tips:',
              '1. Start with hybrid mode (default) for balanced results',
              '2. Use keyword mode for exact error messages or specific function names',
              '3. Use vector mode for broad conceptual questions',
              '4. Filter by category to narrow results (architecture, component, domain, pattern, gotcha, discovery, general)',
              '5. Increase limit if you need more context',
            ].join('\n'),
          },
        },
      ],
    };
  }
}
