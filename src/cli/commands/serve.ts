import { join } from 'path';
import { MemoryServer } from '../../server/index.js';

export async function serveCommand(targetDir: string): Promise<void> {
  const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');

  const server = new MemoryServer({ vectorsDir });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}
