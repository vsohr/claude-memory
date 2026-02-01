import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryRepository } from '../storage/lancedb';
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
import { join } from 'path';

export interface ServerConfig {
  vectorsDir: string;
  projectRoot?: string; // If not provided, derived from vectorsDir
  testMode?: boolean;
}

export class MemoryServer {
  private server: Server;
  private repository: MemoryRepository;
  private config: ServerConfig;
  private projectRoot: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.repository = new MemoryRepository(config.vectorsDir);
    // Derive project root from vectorsDir: .claude/memory/vectors -> project root
    this.projectRoot = config.projectRoot || join(config.vectorsDir, '..', '..', '..');

    this.server = new Server(
      { name: 'claude-memory', version: '0.1.0' },
      { capabilities: { tools: {} } }
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
              args as { query: string; limit?: number; category?: string },
              this.repository
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              isError: !!result.error,
            };
          }
          case 'memory_add': {
            const result = await handleMemoryAdd(
              args as { content: string; category?: string; keywords?: string[] },
              this.repository
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
              this.repository
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
  }

  async start(): Promise<void> {
    await this.repository.connect();
    logger.info('Memory repository connected');

    if (!this.config.testMode) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('MCP server started');
    }
  }

  async stop(): Promise<void> {
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
          args as { query: string; limit?: number },
          this.repository
        );
      case 'memory_add':
        return handleMemoryAdd(
          args as { content: string; category?: string; keywords?: string[] },
          this.repository
        );
      case 'memory_list':
        return handleMemoryList(
          args as { category?: string; limit?: number },
          this.repository
        );
      case 'memory_delete':
        return handleMemoryDelete(args as { id: string }, this.repository);
      case 'memory_analyze':
        return handleMemoryAnalyze(args as { save?: boolean }, this.projectRoot);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
