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
import { logger } from '../utils/logger';

export interface ServerConfig {
  vectorsDir: string;
  testMode?: boolean;
}

export class MemoryServer {
  private server: Server;
  private repository: MemoryRepository;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.repository = new MemoryRepository(config.vectorsDir);

    this.server = new Server(
      { name: 'claude-memory', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [memorySearchToolDefinition],
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
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
