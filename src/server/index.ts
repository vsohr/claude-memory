/**
 * Memory Server - MCP server for claude-memory
 *
 * This is a stub implementation. The full MCP server will be implemented
 * in a separate milestone (Tasks 13-16).
 */

export interface MemoryServerOptions {
  vectorsDir: string;
}

export class MemoryServer {
  private options: MemoryServerOptions;
  private running = false;

  constructor(options: MemoryServerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running');
    }

    this.running = true;
    console.log(`Memory server started (vectors: ${this.options.vectorsDir})`);
    console.log('MCP server running on stdio transport');
    console.log('Press Ctrl+C to stop');

    // Keep the process alive until stopped
    await new Promise<void>((resolve) => {
      const checkRunning = (): void => {
        if (!this.running) {
          resolve();
        } else {
          setTimeout(checkRunning, 100);
        }
      };
      checkRunning();
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    console.log('\nMemory server stopped');
  }
}
