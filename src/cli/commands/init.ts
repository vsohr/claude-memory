import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface InitOptions {
  force?: boolean;
}

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

export async function initCommand(
  targetDir: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const result: InitResult = { created: [], skipped: [], errors: [] };
  const claudeDir = join(targetDir, '.claude');

  // Create directory structure
  const dirs = [
    join(claudeDir, 'knowledge', 'architecture'),
    join(claudeDir, 'knowledge', 'components'),
    join(claudeDir, 'knowledge', 'domain'),
    join(claudeDir, 'knowledge', 'patterns'),
    join(claudeDir, 'memory', 'vectors'),
    join(claudeDir, 'skills'),
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

  return result;
}
