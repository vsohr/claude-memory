import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { logger } from './logger';
import type { SearchMode } from '../types/memory';

export type { SearchMode } from '../types/memory';

/**
 * Fully resolved configuration with all defaults applied.
 */
export interface MemoryConfigResolved {
  /** Minimum similarity score for vector search results. Default: -0.5 */
  minScore: number;

  /** Chunk overlap percentage (0-50). Default: 15 */
  chunkOverlapPercent: number;

  /** Maximum chunk size in characters. Default: 2000 */
  chunkSize: number;

  /** Default search mode. Default: 'hybrid' */
  defaultSearchMode: SearchMode;

  /** FTS database filename within .claude/memory/. Default: 'fts.sqlite' */
  ftsDbName: string;
}

/**
 * Shape of .claude/memory.config.json on disk. All fields optional.
 */
export interface MemoryConfigFile {
  minScore?: number;
  chunkOverlapPercent?: number;
  chunkSize?: number;
  defaultSearchMode?: string;
  ftsDbName?: string;
}

/** Default configuration values. */
export const DEFAULTS: MemoryConfigResolved = {
  minScore: -0.5,
  chunkOverlapPercent: 15,
  chunkSize: 2000,
  defaultSearchMode: 'hybrid',
  ftsDbName: 'fts.sqlite',
};

/** Mapping from environment variable names to config keys. */
export const ENV_MAP: Record<string, keyof MemoryConfigResolved> = {
  CLAUDE_MEMORY_MIN_SCORE: 'minScore',
  CLAUDE_MEMORY_CHUNK_OVERLAP: 'chunkOverlapPercent',
  CLAUDE_MEMORY_CHUNK_SIZE: 'chunkSize',
  CLAUDE_MEMORY_SEARCH_MODE: 'defaultSearchMode',
};

/** Zod schema for validating the config file contents. */
const configFileSchema = z.object({
  minScore: z.number().min(-2).max(1).optional(),
  chunkOverlapPercent: z.number().int().min(0).max(50).optional(),
  chunkSize: z.number().int().min(100).max(10000).optional(),
  defaultSearchMode: z.enum(['vector', 'keyword', 'hybrid']).optional(),
  ftsDbName: z.string().min(1).max(100).optional(),
}).strict();

/**
 * Parse and apply a single environment variable override to the config.
 * Invalid values are logged as warnings and ignored.
 */
function applyEnvOverride(
  config: MemoryConfigResolved,
  key: keyof MemoryConfigResolved,
  value: string,
): void {
  switch (key) {
    case 'minScore': {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= -2 && num <= 1) {
        config.minScore = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_MIN_SCORE: "${value}" (expected number -2 to 1)`);
      }
      break;
    }
    case 'chunkOverlapPercent': {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        config.chunkOverlapPercent = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_CHUNK_OVERLAP: "${value}" (expected integer 0-50)`);
      }
      break;
    }
    case 'chunkSize': {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 100 && num <= 10000) {
        config.chunkSize = num;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_CHUNK_SIZE: "${value}" (expected integer 100-10000)`);
      }
      break;
    }
    case 'defaultSearchMode': {
      if (['vector', 'keyword', 'hybrid'].includes(value)) {
        config.defaultSearchMode = value as SearchMode;
      } else {
        logger.warn(`Invalid CLAUDE_MEMORY_SEARCH_MODE: "${value}" (expected vector|keyword|hybrid)`);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Load configuration with three-layer resolution:
 * 1. Defaults
 * 2. Config file (.claude/memory.config.json) overrides defaults
 * 3. Environment variables override config file
 *
 * Invalid values at any layer are logged as warnings and skipped.
 */
export function loadConfig(projectRoot: string): MemoryConfigResolved {
  const config: MemoryConfigResolved = { ...DEFAULTS };

  // Layer 2: config file overrides
  const configPath = join(projectRoot, '.claude', 'memory.config.json');
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = configFileSchema.parse(JSON.parse(raw));
      Object.assign(config, parsed);
    } catch (error) {
      logger.warn(`Invalid config file at ${configPath}: ${(error as Error).message}`);
    }
  }

  // Layer 3: env var overrides (highest priority)
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      applyEnvOverride(config, configKey, envValue);
    }
  }

  return config;
}
