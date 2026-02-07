import { mkdir, writeFile, readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { analyzeCommand } from './analyze.js';
import { indexCommand } from './index-cmd.js';
import { FtsStore } from '../../storage/fts.js';
import { loadConfig } from '../../utils/config.js';
import { MemoryRepository } from '../../storage/lancedb.js';

export interface InitOptions {
  force?: boolean;
  skipAnalyze?: boolean;
  skipIndex?: boolean;
  skipFts?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
  analyzed: boolean;
  indexed: boolean;
  ftsBuilt: boolean;
}

export async function initCommand(
  targetDir: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const result: InitResult = {
    created: [],
    skipped: [],
    errors: [],
    analyzed: false,
    indexed: false,
    ftsBuilt: false,
  };
  const claudeDir = join(targetDir, '.claude');

  // Phase 1: Create directory structure
  const dirs = [
    join(claudeDir, 'knowledge', 'architecture'),
    join(claudeDir, 'knowledge', 'components'),
    join(claudeDir, 'knowledge', 'domain'),
    join(claudeDir, 'knowledge', 'patterns'),
    join(claudeDir, 'memory', 'vectors'),
    join(claudeDir, 'skills'),
    join(claudeDir, 'hooks'),
  ];

  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
      result.created.push(dir);
    } catch (error) {
      result.errors.push(`Failed to create ${dir}: ${(error as Error).message}`);
    }
  }

  // Create gotchas.md template
  const gotchasPath = join(claudeDir, 'knowledge', 'gotchas.md');
  if (!existsSync(gotchasPath) || options.force) {
    const gotchasContent = `# Gotchas and Known Issues

<!-- vector-index: true -->
<!-- keywords: gotcha, issue, known, bug -->

### Example Gotcha

Description of a non-obvious behavior or common mistake.

**Symptom:** What you observe when this happens.

**Cause:** Why this happens.

**Solution:** How to fix or avoid it.
`;
    await writeFile(gotchasPath, gotchasContent);
    result.created.push(gotchasPath);
  } else {
    result.skipped.push(gotchasPath);
  }

  // Create .mcp.json at project root for MCP server registration
  const mcpJsonPath = join(targetDir, '.mcp.json');
  if (!existsSync(mcpJsonPath) || options.force) {
    const mcpConfig = {
      mcpServers: {
        'claude-memory': {
          type: 'stdio',
          command: 'npx',
          args: ['claude-memory', 'serve'],
        },
      },
    };
    await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
    result.created.push(mcpJsonPath);
  } else {
    result.skipped.push(mcpJsonPath);
  }

  // Create settings.json for hooks only
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(settingsPath) || options.force) {
    const settings = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'node .claude/hooks/memory-search.js',
                timeout: 30,
              },
            ],
          },
        ],
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    result.created.push(settingsPath);
  } else {
    result.skipped.push(settingsPath);
  }

  // Create memory-search hook for auto-search on prompts
  const hookPath = join(claudeDir, 'hooks', 'memory-search.js');
  if (!existsSync(hookPath) || options.force) {
    const hookContent = `#!/usr/bin/env node
/**
 * Auto-search project memory on prompt submission.
 * Claude Code passes JSON on stdin with { prompt, cwd, session_id, ... }
 * Output to stdout is added to Claude's context.
 */
const { execSync } = require('child_process');
const fs = require('fs');

// Read JSON input from Claude Code
let input;
try {
  const raw = fs.readFileSync(0, 'utf-8');
  input = JSON.parse(raw);
} catch (e) {
  process.exit(0);
}

const prompt = input.prompt || '';

// Skip short prompts or commands
if (prompt.length < 10 || prompt.startsWith('/')) {
  process.exit(0);
}

const stopWords = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'how', 'what', 'where',
  'when', 'why', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'it',
  'to', 'for', 'in', 'on', 'at', 'of', 'with', 'and', 'or', 'but',
  'please', 'help', 'me', 'want', 'need', 'know', 'tell', 'about', 'project'
]);

const words = prompt.toLowerCase().replace(/[^\\w\\s]/g, '').split(/\\s+/)
  .filter(w => w.length > 2 && !stopWords.has(w));

if (words.length === 0) process.exit(0);

const query = words.slice(0, 5).join(' ');

try {
  const result = execSync(\`npx claude-memory search "\${query}" --limit 3 --json\`, {
    encoding: 'utf-8', timeout: 20000, cwd: input.cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const jsonMatch = result.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/);
  if (!jsonMatch) process.exit(0);

  const entries = JSON.parse(jsonMatch[0]);
  const good = entries.filter(e => e.score > -0.2);

  if (good.length > 0) {
    console.log('');
    console.log('**Project memory context:**');
    good.slice(0, 2).forEach(e => {
      const title = e.entry.metadata.sectionTitle || e.entry.metadata.filePath;
      const preview = e.entry.content.replace(/\\n/g, ' ').slice(0, 120);
      console.log(\`- [\${title}] \${preview}...\`);
    });
    console.log('');
  }
} catch (err) {
  process.exit(0);
}
`;
    await writeFile(hookPath, hookContent);
    result.created.push(hookPath);
  } else {
    result.skipped.push(hookPath);
  }

  // Update .gitignore to only ignore settings.local.json
  await updateGitignore(targetDir, result);

  // Phase 2: Run deep analysis and save to memory
  if (!options.skipAnalyze) {
    try {
      console.log('');
      await analyzeCommand(targetDir, { save: true });
      result.analyzed = true;
    } catch (error) {
      result.errors.push(`Analysis failed: ${(error as Error).message}`);
    }
  }

  // Phase 3: Knowledge indexing
  if (!options.skipIndex) {
    const knowledgeDir = join(targetDir, '.claude', 'knowledge');
    if (existsSync(knowledgeDir)) {
      try {
        console.log('\nIndexing knowledge files...');
        await indexCommand(targetDir, { force: options.force });
        result.indexed = true;
      } catch (error) {
        result.errors.push(`Indexing failed: ${(error as Error).message}`);
      }
    }
  }

  // Phase 4: FTS build
  if (!options.skipFts) {
    try {
      const config = loadConfig(targetDir);
      const ftsPath = join(targetDir, '.claude', 'memory', config.ftsDbName);
      const ftsStore = new FtsStore(ftsPath);
      ftsStore.open();
      ftsStore.clear();

      const vectorsDir = join(targetDir, '.claude', 'memory', 'vectors');
      const repository = new MemoryRepository(vectorsDir);
      await repository.connect();

      const entries = await repository.list(undefined, 10000);
      ftsStore.addBatch(entries);
      console.log(`  FTS index: ${entries.length} entries`);

      ftsStore.close();
      await repository.disconnect();
      result.ftsBuilt = true;
    } catch (error) {
      result.errors.push(`FTS build failed: ${(error as Error).message}`);
    }
  }

  return result;
}

async function updateGitignore(targetDir: string, result: InitResult): Promise<void> {
  const gitignorePath = join(targetDir, '.gitignore');
  const ignoreEntry = '.claude/settings.local.json';

  try {
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf-8');
      const lines = content.split('\n');

      // Check if .claude/ is fully ignored
      const claudeIgnoreIndex = lines.findIndex(l => l.trim() === '.claude/' || l.trim() === '.claude');

      if (claudeIgnoreIndex !== -1) {
        // Replace broad .claude/ ignore with specific settings.local.json
        lines[claudeIgnoreIndex] = ignoreEntry;
        await writeFile(gitignorePath, lines.join('\n'));
        result.created.push(`${gitignorePath} (updated: .claude/ → ${ignoreEntry})`);
      } else if (!lines.some(l => l.trim() === ignoreEntry)) {
        // Add settings.local.json if not present
        await appendFile(gitignorePath, `\n# Claude Code local settings\n${ignoreEntry}\n`);
        result.created.push(`${gitignorePath} (added ${ignoreEntry})`);
      }
    } else {
      // Create new .gitignore
      await writeFile(gitignorePath, `# Claude Code local settings\n${ignoreEntry}\n`);
      result.created.push(gitignorePath);
    }
  } catch (error) {
    result.errors.push(`Failed to update .gitignore: ${(error as Error).message}`);
  }
}
