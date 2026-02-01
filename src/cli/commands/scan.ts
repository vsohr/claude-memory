import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, basename, relative } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb.js';
import { getEmbeddingService } from '../../storage/embeddings.js';
import type { MemoryEntryInput } from '../../types/memory.js';

export interface ScanOptions {
  save?: boolean;
  deep?: boolean;
}

export interface ScanResult {
  languages: Record<string, number>;
  structure: string[];
  entryPoints: string[];
  patterns: string[];
  discoveries: string[];
  saved: number;
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++', '.c': 'C', '.h': 'C/C++',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.ex': 'Elixir', '.exs': 'Elixir',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'venv', '.venv', 'vendor', 'target', '.idea', '.vscode', 'coverage',
]);

const ENTRY_POINT_PATTERNS = [
  'index.ts', 'index.js', 'main.ts', 'main.js', 'main.py', 'app.py',
  'main.go', 'main.rs', 'App.tsx', 'App.jsx', 'server.ts', 'server.js',
];

const CONFIG_FILES = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'requirements.txt', 'Gemfile', 'composer.json',
];

export async function scanCommand(
  targetDir: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const result: ScanResult = {
    languages: {},
    structure: [],
    entryPoints: [],
    patterns: [],
    discoveries: [],
    saved: 0,
  };

  console.log('Scanning repository...\n');

  // Scan directory structure
  await scanDirectory(targetDir, '', result, options.deep ?? false);

  // Detect project type from config files
  const projectType = await detectProjectType(targetDir);
  if (projectType) {
    result.discoveries.push(`Project type: ${projectType}`);
  }

  // Calculate language percentages
  const totalFiles = Object.values(result.languages).reduce((a, b) => a + b, 0);

  console.log('Languages:');
  const sortedLangs = Object.entries(result.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [lang, count] of sortedLangs) {
    const pct = ((count / totalFiles) * 100).toFixed(1);
    console.log(`  ${lang}: ${pct}% (${count} files)`);
  }

  console.log(`\nStructure: ${result.structure.length} directories`);

  if (result.entryPoints.length > 0) {
    console.log('\nEntry points:');
    result.entryPoints.slice(0, 5).forEach(ep => console.log(`  ${ep}`));
  }

  // Generate discoveries
  result.discoveries.push(
    `Repository has ${totalFiles} source files across ${result.structure.length} directories`,
    `Primary language: ${sortedLangs[0]?.[0] || 'Unknown'}`,
  );

  if (result.entryPoints.length > 0) {
    result.discoveries.push(`Entry points: ${result.entryPoints.slice(0, 3).join(', ')}`);
  }

  // Save to memory if requested
  if (options.save !== false) {
    const claudeDir = join(targetDir, '.claude');
    const vectorsDir = join(claudeDir, 'memory', 'vectors');

    if (existsSync(vectorsDir)) {
      console.log('\nSaving discoveries to memory...');

      const embeddingService = await getEmbeddingService();
      const repository = new MemoryRepository(vectorsDir, embeddingService);
      await repository.connect();

      // Create a summary entry
      const summaryContent = `# Repository Structure

## Overview
${result.discoveries.join('\n')}

## Languages
${sortedLangs.map(([l, c]) => `- ${l}: ${c} files`).join('\n')}

## Entry Points
${result.entryPoints.slice(0, 10).map(e => `- ${e}`).join('\n')}

## Key Directories
${result.structure.slice(0, 15).map(d => `- ${d}`).join('\n')}
`;

      const entry: MemoryEntryInput = {
        content: summaryContent,
        metadata: {
          category: 'architecture',
          source: 'discovery',
          keywords: ['structure', 'overview', 'architecture', ...sortedLangs.map(([l]) => l.toLowerCase())],
        },
      };

      await repository.add(entry);
      result.saved = 1;
      console.log('Saved repository overview to memory.');
    } else {
      console.log('\nRun "npx claude-memory init" first to enable saving.');
    }
  }

  return result;
}

async function scanDirectory(
  rootDir: string,
  currentPath: string,
  result: ScanResult,
  deep: boolean,
  depth = 0
): Promise<void> {
  if (depth > 10) return; // Prevent too deep recursion

  const fullPath = currentPath ? join(rootDir, currentPath) : rootDir;

  let entries;
  try {
    entries = await readdir(fullPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = currentPath ? join(currentPath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      if (depth < 3) {
        result.structure.push(entryPath);
      }

      await scanDirectory(rootDir, entryPath, result, deep, depth + 1);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      const lang = LANGUAGE_MAP[ext];

      if (lang) {
        result.languages[lang] = (result.languages[lang] || 0) + 1;
      }

      if (ENTRY_POINT_PATTERNS.includes(entry.name)) {
        result.entryPoints.push(entryPath);
      }
    }
  }
}

async function detectProjectType(targetDir: string): Promise<string | null> {
  for (const configFile of CONFIG_FILES) {
    const configPath = join(targetDir, configFile);
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, 'utf-8');

        if (configFile === 'package.json') {
          const pkg = JSON.parse(content);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          if (deps['next']) return 'Next.js application';
          if (deps['react']) return 'React application';
          if (deps['vue']) return 'Vue.js application';
          if (deps['express']) return 'Express.js server';
          if (deps['fastify']) return 'Fastify server';
          if (deps['@nestjs/core']) return 'NestJS application';
          return 'Node.js project';
        }

        if (configFile === 'pyproject.toml') {
          if (content.includes('fastapi')) return 'FastAPI application';
          if (content.includes('django')) return 'Django application';
          if (content.includes('flask')) return 'Flask application';
          return 'Python project';
        }

        if (configFile === 'Cargo.toml') return 'Rust project';
        if (configFile === 'go.mod') return 'Go project';

      } catch {
        continue;
      }
    }
  }
  return null;
}
