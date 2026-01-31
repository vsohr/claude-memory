import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { searchCommand } from './commands/search.js';
import { serveCommand } from './commands/serve.js';
import { addCommand } from './commands/add.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('claude-memory')
    .description('Local knowledge tier system for Claude Code')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize claude-memory in the current repository')
    .option('-f, --force', 'Overwrite existing files')
    .option('--skip-index', 'Skip initial indexing')
    .action(async (options) => {
      const cwd = process.cwd();
      console.log('Initializing claude-memory...\n');

      const result = await initCommand(cwd, {
        force: options.force,
        skipIndex: options.skipIndex,
      });

      if (result.created.length > 0) {
        console.log('Created:');
        result.created.forEach((f) => console.log(`  + ${f}`));
      }

      if (result.skipped.length > 0) {
        console.log('\nSkipped (already exist):');
        result.skipped.forEach((f) => console.log(`  - ${f}`));
      }

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach((e) => console.log(`  ! ${e}`));
        process.exit(1);
      }

      if (result.indexed) {
        console.log('\nIndexed knowledge files.');
      }

      console.log('\nReady! Add knowledge to .claude/knowledge/ and commit.');
    });

  program
    .command('index')
    .description('Index markdown files to vector database')
    .option('-f, --force', 'Reindex all files (ignore cache)')
    .option('--dry-run', 'Show what would be indexed without indexing')
    .action(async (options) => {
      await indexCommand(process.cwd(), {
        force: options.force,
        dryRun: options.dryRun,
      });
    });

  program
    .command('search <query>')
    .description('Search the memory database')
    .option('-l, --limit <number>', 'Number of results to return', '5')
    .option('--json', 'Output results as JSON')
    .action(async (query, options) => {
      const limit = parseInt(options.limit, 10);
      await searchCommand(query, process.cwd(), {
        limit: Number.isNaN(limit) ? 5 : limit,
        json: options.json,
      });
    });

  program
    .command('serve')
    .description('Start the MCP server for Claude Code integration')
    .action(async () => {
      await serveCommand(process.cwd());
    });

  program
    .command('add <content>')
    .description('Add a manual memory entry')
    .option('-c, --category <category>', 'Category for the entry (architecture, component, domain, pattern, gotcha, discovery, general)', 'general')
    .action(async (content, options) => {
      await addCommand(content, process.cwd(), {
        category: options.category,
      });
    });

  return program;
}
