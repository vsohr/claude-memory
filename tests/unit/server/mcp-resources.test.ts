import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryServer } from '../../../src/server/index';

describe('MCP resources and prompts', () => {
  let tempDir: string;
  let server: MemoryServer;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-resources-test-'));

    const projectRoot = tempDir;
    const vectorsDir = join(projectRoot, '.claude', 'memory', 'vectors');
    const ftsPath = join(projectRoot, '.claude', 'memory', 'fts.sqlite');
    const knowledgeDir = join(projectRoot, '.claude', 'knowledge');

    await mkdir(vectorsDir, { recursive: true });
    await mkdir(knowledgeDir, { recursive: true });

    // Create test knowledge files
    await writeFile(
      join(knowledgeDir, 'architecture.md'),
      '# Architecture\n\nSystem uses microservices.'
    );

    await mkdir(join(knowledgeDir, 'subdir'), { recursive: true });
    await writeFile(
      join(knowledgeDir, 'subdir', 'nested.md'),
      '# Nested\n\nNested content here.'
    );

    server = new MemoryServer({
      vectorsDir,
      projectRoot,
      ftsPath,
      testMode: true,
    });
    await server.start();
  }, 120000);

  afterAll(async () => {
    await server?.stop();
    await rm(tempDir, { recursive: true });
  });

  describe('ListResourceTemplates', () => {
    it('returns memory:// template', async () => {
      const result = await server.listResourceTemplates();
      expect(result.resourceTemplates).toHaveLength(1);
      expect(result.resourceTemplates[0].uriTemplate).toBe('memory://{path}');
      expect(result.resourceTemplates[0].name).toBe('Knowledge File');
      expect(result.resourceTemplates[0].mimeType).toBe('text/markdown');
    });
  });

  describe('ReadResource', () => {
    it('returns content for valid path', async () => {
      const result = await server.readResource('memory://architecture.md');
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('memory://architecture.md');
      expect(result.contents[0].mimeType).toBe('text/markdown');
      expect(result.contents[0].text).toContain('System uses microservices');
    });

    it('returns content for nested path', async () => {
      const result = await server.readResource('memory://subdir/nested.md');
      expect(result.contents[0].text).toContain('Nested content here');
    });

    it('throws for path with ..', async () => {
      await expect(
        server.readResource('memory://../../../etc/passwd')
      ).rejects.toThrow('Path traversal not allowed');
    });

    it('throws for path with / prefix', async () => {
      await expect(
        server.readResource('memory:///etc/passwd')
      ).rejects.toThrow('Absolute paths not allowed');
    });

    it('throws for nonexistent file', async () => {
      await expect(
        server.readResource('memory://nonexistent.md')
      ).rejects.toThrow();
    });
  });

  describe('ListPrompts', () => {
    it('returns query prompt', async () => {
      const result = await server.listPrompts();
      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0].name).toBe('query');
      expect(result.prompts[0].description).toContain('Search strategy');
    });
  });

  describe('GetPrompt', () => {
    it('returns strategy text for query prompt', async () => {
      const result = await server.getPrompt('query', { topic: 'authentication' });
      expect(result.description).toContain('Search strategy');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('authentication');
      expect(result.messages[0].content.text).toContain('hybrid');
      expect(result.messages[0].content.text).toContain('vector');
      expect(result.messages[0].content.text).toContain('keyword');
    });

    it('throws for unknown prompt name', async () => {
      await expect(
        server.getPrompt('nonexistent')
      ).rejects.toThrow('Unknown prompt: nonexistent');
    });
  });
});
