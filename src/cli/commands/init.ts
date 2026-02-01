import { mkdir, writeFile, readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { scanCommand } from './scan.js';

export interface InitOptions {
  force?: boolean;
  skipScan?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
  scanned: boolean;
}

export async function initCommand(
  targetDir: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const result: InitResult = { created: [], skipped: [], errors: [], scanned: false };
  const claudeDir = join(targetDir, '.claude');

  // Create directory structure
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

  // Create settings.json for MCP registration
  const settingsPath = join(claudeDir, 'settings.json');
  if (!existsSync(settingsPath) || options.force) {
    const settings = {
      mcpServers: {
        'claude-memory': {
          command: 'npx',
          args: ['claude-memory', 'serve'],
        },
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
 * Extracts keywords and shows relevant context.
 */
const { execSync } = require('child_process');
const fs = require('fs');

let prompt = '';
try {
  prompt = fs.readFileSync(0, 'utf-8').trim();
} catch (e) {
  process.exit(0);
}

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
    encoding: 'utf-8', timeout: 20000, cwd: process.cwd(),
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

  // Run repo scan and save to memory
  if (!options.skipScan) {
    try {
      console.log('');
      await scanCommand(targetDir, { save: true });
      result.scanned = true;
    } catch (error) {
      result.errors.push(`Scan failed: ${(error as Error).message}`);
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
