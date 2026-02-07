import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, DEFAULTS } from '../../../src/utils/config';
import type { MemoryConfigResolved } from '../../../src/utils/config';

// Mock the logger to capture warnings
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../../../src/utils/logger';

describe('loadConfig', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `claude-memory-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Clear all env vars before each test
    delete process.env.CLAUDE_MEMORY_MIN_SCORE;
    delete process.env.CLAUDE_MEMORY_CHUNK_OVERLAP;
    delete process.env.CLAUDE_MEMORY_CHUNK_SIZE;
    delete process.env.CLAUDE_MEMORY_SEARCH_MODE;

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup
    delete process.env.CLAUDE_MEMORY_MIN_SCORE;
    delete process.env.CLAUDE_MEMORY_CHUNK_OVERLAP;
    delete process.env.CLAUDE_MEMORY_CHUNK_SIZE;
    delete process.env.CLAUDE_MEMORY_SEARCH_MODE;

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function writeConfigFile(config: Record<string, unknown>): void {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'memory.config.json'), JSON.stringify(config));
  }

  it('returns all defaults when no config file exists and no env vars set', () => {
    const config = loadConfig(testDir);

    expect(config).toEqual<MemoryConfigResolved>({
      minScore: -0.5,
      chunkOverlapPercent: 15,
      chunkSize: 2000,
      defaultSearchMode: 'hybrid',
      ftsDbName: 'fts.sqlite',
    });
  });

  it('missing config file is not an error and returns defaults', () => {
    const config = loadConfig(testDir);

    expect(config).toEqual(DEFAULTS);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('config file overrides defaults', () => {
    writeConfigFile({ minScore: -0.3 });

    const config = loadConfig(testDir);

    expect(config.minScore).toBe(-0.3);
    // Other values remain at defaults
    expect(config.chunkOverlapPercent).toBe(15);
    expect(config.chunkSize).toBe(2000);
    expect(config.defaultSearchMode).toBe('hybrid');
    expect(config.ftsDbName).toBe('fts.sqlite');
  });

  it('config file can override multiple fields', () => {
    writeConfigFile({
      minScore: -0.1,
      chunkSize: 3000,
      defaultSearchMode: 'vector',
      ftsDbName: 'custom.sqlite',
    });

    const config = loadConfig(testDir);

    expect(config.minScore).toBe(-0.1);
    expect(config.chunkSize).toBe(3000);
    expect(config.defaultSearchMode).toBe('vector');
    expect(config.ftsDbName).toBe('custom.sqlite');
    expect(config.chunkOverlapPercent).toBe(15); // default
  });

  it('env var overrides config file value', () => {
    writeConfigFile({ minScore: -0.3 });
    process.env.CLAUDE_MEMORY_MIN_SCORE = '-0.2';

    const config = loadConfig(testDir);

    expect(config.minScore).toBe(-0.2);
  });

  it('env var overrides default when no config file', () => {
    process.env.CLAUDE_MEMORY_CHUNK_SIZE = '4000';

    const config = loadConfig(testDir);

    expect(config.chunkSize).toBe(4000);
  });

  it('CLAUDE_MEMORY_CHUNK_OVERLAP env var applies correctly', () => {
    process.env.CLAUDE_MEMORY_CHUNK_OVERLAP = '25';

    const config = loadConfig(testDir);

    expect(config.chunkOverlapPercent).toBe(25);
  });

  it('CLAUDE_MEMORY_SEARCH_MODE env var applies correctly', () => {
    process.env.CLAUDE_MEMORY_SEARCH_MODE = 'keyword';

    const config = loadConfig(testDir);

    expect(config.defaultSearchMode).toBe('keyword');
  });

  it('invalid env value CLAUDE_MEMORY_MIN_SCORE=abc is ignored with warning', () => {
    process.env.CLAUDE_MEMORY_MIN_SCORE = 'abc';

    const config = loadConfig(testDir);

    expect(config.minScore).toBe(-0.5); // default preserved
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid CLAUDE_MEMORY_MIN_SCORE')
    );
  });

  it('invalid env value CLAUDE_MEMORY_CHUNK_OVERLAP=abc is ignored with warning', () => {
    process.env.CLAUDE_MEMORY_CHUNK_OVERLAP = 'abc';

    const config = loadConfig(testDir);

    expect(config.chunkOverlapPercent).toBe(15);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid CLAUDE_MEMORY_CHUNK_OVERLAP')
    );
  });

  it('out-of-range env value CLAUDE_MEMORY_MIN_SCORE=5 is ignored', () => {
    process.env.CLAUDE_MEMORY_MIN_SCORE = '5';

    const config = loadConfig(testDir);

    expect(config.minScore).toBe(-0.5);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('out-of-range env value CLAUDE_MEMORY_CHUNK_OVERLAP=99 is ignored', () => {
    process.env.CLAUDE_MEMORY_CHUNK_OVERLAP = '99';

    const config = loadConfig(testDir);

    expect(config.chunkOverlapPercent).toBe(15);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('out-of-range env value CLAUDE_MEMORY_CHUNK_SIZE=50 is ignored', () => {
    process.env.CLAUDE_MEMORY_CHUNK_SIZE = '50';

    const config = loadConfig(testDir);

    expect(config.chunkSize).toBe(2000);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('invalid CLAUDE_MEMORY_SEARCH_MODE value is ignored', () => {
    process.env.CLAUDE_MEMORY_SEARCH_MODE = 'invalid-mode';

    const config = loadConfig(testDir);

    expect(config.defaultSearchMode).toBe('hybrid');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid CLAUDE_MEMORY_SEARCH_MODE')
    );
  });

  it('config file with unknown key is rejected by .strict()', () => {
    writeConfigFile({ unknownKey: true });

    const config = loadConfig(testDir);

    // Should fall back to defaults since the file is invalid
    expect(config.minScore).toBe(-0.5);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid config file')
    );
  });

  it('config file with out-of-range value is rejected', () => {
    writeConfigFile({ chunkOverlapPercent: 99 });

    const config = loadConfig(testDir);

    // Should fall back to defaults since the file is invalid
    expect(config.chunkOverlapPercent).toBe(15);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid config file')
    );
  });

  it('config file with invalid JSON logs warning and uses defaults', () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'memory.config.json'), '{ invalid json }');

    const config = loadConfig(testDir);

    expect(config).toEqual(DEFAULTS);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid config file')
    );
  });

  it('priority order: env var > config file > default', () => {
    writeConfigFile({ minScore: -0.3, chunkSize: 3000 });
    process.env.CLAUDE_MEMORY_MIN_SCORE = '-0.1';

    const config = loadConfig(testDir);

    // Env var wins over config file
    expect(config.minScore).toBe(-0.1);
    // Config file wins over default
    expect(config.chunkSize).toBe(3000);
    // Default used when no override
    expect(config.chunkOverlapPercent).toBe(15);
  });
});
