import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';

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
    .action(async (options) => {
      const cwd = process.cwd();
      console.log('Initializing claude-memory...\n');

      const result = await initCommand(cwd, { force: options.force });

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

      console.log('\nInitialization complete!');
      console.log('Next steps:');
      console.log('  1. Add knowledge to .claude/knowledge/');
      console.log('  2. Run: npx claude-memory index');
      console.log('  3. Use memory_search in Claude Code');
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

  return program;
}
