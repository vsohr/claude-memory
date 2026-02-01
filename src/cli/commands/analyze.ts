import { readdir, readFile } from 'fs/promises';
import { join, extname, relative } from 'path';
import { existsSync } from 'fs';
import { MemoryRepository } from '../../storage/lancedb.js';
import { getEmbeddingService } from '../../storage/embeddings.js';
import type { MemoryEntryInput } from '../../types/memory.js';

export interface AnalyzeOptions {
  save?: boolean;
}

export interface AnalyzeResult {
  docsIndexed: number;
  exportsFound: number;
  routesFound: number;
  patternsFound: string[];
  saved: number;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'venv', '.venv', 'vendor', 'target', '.idea', '.vscode', 'coverage',
]);

export async function analyzeCommand(
  targetDir: string,
  options: AnalyzeOptions = {}
): Promise<AnalyzeResult> {
  const result: AnalyzeResult = {
    docsIndexed: 0,
    exportsFound: 0,
    routesFound: 0,
    patternsFound: [],
    saved: 0,
  };

  console.log('Analyzing repository (deep scan)...\n');

  const entries: MemoryEntryInput[] = [];

  // 1. Parse README and docs
  console.log('Scanning documentation...');
  const docEntries = await parseDocumentation(targetDir);
  entries.push(...docEntries);
  result.docsIndexed = docEntries.length;
  console.log(`  Found ${docEntries.length} documentation files`);

  // 2. Extract code structure
  console.log('Extracting code structure...');
  const codeEntries = await extractCodeStructure(targetDir);
  entries.push(...codeEntries);
  result.exportsFound = codeEntries.length;
  console.log(`  Found ${codeEntries.length} key code files`);

  // 3. Detect API routes
  console.log('Detecting API routes...');
  const routeEntries = await detectApiRoutes(targetDir);
  entries.push(...routeEntries);
  result.routesFound = routeEntries.length;
  console.log(`  Found ${routeEntries.length} route definitions`);

  // 4. Infer architecture patterns
  console.log('Inferring architecture patterns...');
  const patterns = await inferArchitecturePatterns(targetDir);
  result.patternsFound = patterns;
  if (patterns.length > 0) {
    const patternEntry: MemoryEntryInput = {
      content: `# Architecture Patterns\n\nDetected patterns in this codebase:\n\n${patterns.map(p => `- ${p}`).join('\n')}`,
      metadata: {
        category: 'architecture',
        source: 'discovery',
        keywords: ['architecture', 'patterns', 'structure'],
      },
    };
    entries.push(patternEntry);
    console.log(`  Detected: ${patterns.join(', ')}`);
  }

  // Save to memory
  if (options.save !== false && entries.length > 0) {
    const claudeDir = join(targetDir, '.claude');
    const vectorsDir = join(claudeDir, 'memory', 'vectors');

    if (existsSync(vectorsDir)) {
      console.log('\nSaving to memory...');

      const embeddingService = await getEmbeddingService();
      const repository = new MemoryRepository(vectorsDir, embeddingService);
      await repository.connect();

      for (const entry of entries) {
        await repository.add(entry);
        result.saved++;
      }

      console.log(`Saved ${result.saved} entries to memory.`);
    } else {
      console.log('\nRun "npx claude-memory init" first to enable saving.');
    }
  }

  console.log('\nAnalysis complete!');
  return result;
}

async function parseDocumentation(targetDir: string): Promise<MemoryEntryInput[]> {
  const entries: MemoryEntryInput[] = [];

  // Parse README files
  const readmeNames = ['README.md', 'readme.md', 'Readme.md', 'README.MD'];
  for (const name of readmeNames) {
    const readmePath = join(targetDir, name);
    if (existsSync(readmePath)) {
      try {
        const content = await readFile(readmePath, 'utf-8');
        if (content.trim().length > 50) {
          entries.push({
            content: `# Project README\n\n${content}`,
            metadata: {
              category: 'architecture',
              source: 'discovery',
              filePath: name,
              keywords: extractKeywordsFromMarkdown(content),
            },
          });
        }
      } catch {
        // Skip unreadable files
      }
      break;
    }
  }

  // Parse docs folder
  const docsPaths = ['docs', 'doc', 'documentation', 'wiki'];
  for (const docsPath of docsPaths) {
    const fullPath = join(targetDir, docsPath);
    if (existsSync(fullPath)) {
      const docFiles = await findMarkdownFiles(fullPath, targetDir);
      for (const file of docFiles.slice(0, 20)) { // Limit to 20 docs
        try {
          const content = await readFile(file, 'utf-8');
          if (content.trim().length > 100) {
            entries.push({
              content,
              metadata: {
                category: 'architecture',
                source: 'discovery',
                filePath: relative(targetDir, file),
                keywords: extractKeywordsFromMarkdown(content),
              },
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  return entries;
}

async function findMarkdownFiles(dir: string, rootDir: string, files: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await findMarkdownFiles(fullPath, rootDir, files);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return files;
}

function extractKeywordsFromMarkdown(content: string): string[] {
  const keywords: Set<string> = new Set();

  // Extract from headers
  const headers = content.match(/^#+\s+(.+)$/gm) || [];
  for (const header of headers) {
    const text = header.replace(/^#+\s+/, '').toLowerCase();
    text.split(/\s+/).forEach(w => {
      if (w.length > 3 && w.length < 20) keywords.add(w);
    });
  }

  // Extract code terms (backticked)
  const codeTerms = content.match(/`([^`]+)`/g) || [];
  for (const term of codeTerms) {
    const cleaned = term.replace(/`/g, '').toLowerCase();
    if (cleaned.length > 2 && cleaned.length < 30) keywords.add(cleaned);
  }

  return Array.from(keywords).slice(0, 10);
}

async function extractCodeStructure(targetDir: string): Promise<MemoryEntryInput[]> {
  const entries: MemoryEntryInput[] = [];
  const codeFiles = await findCodeFiles(targetDir, targetDir);

  // Group exports by file for key files only
  const keyFiles = identifyKeyFiles(codeFiles);

  for (const file of keyFiles.slice(0, 30)) { // Limit to 30 key files
    try {
      const content = await readFile(file, 'utf-8');
      const exports = extractExports(content, file);

      if (exports.length > 0) {
        const relPath = relative(targetDir, file);
        const exportList = exports.map(e => `- \`${e.name}\`: ${e.type}`).join('\n');

        entries.push({
          content: `# ${relPath}\n\nExported members:\n${exportList}`,
          metadata: {
            category: 'component',
            source: 'discovery',
            filePath: relPath,
            keywords: ['export', ...exports.map(e => e.name.toLowerCase())],
          },
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

async function findCodeFiles(dir: string, rootDir: string, files: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 8) return files;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await findCodeFiles(fullPath, rootDir, files, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return files;
}

function identifyKeyFiles(files: string[]): string[] {
  // Prioritize files that are likely important
  const priorities = [
    /index\.(ts|js|tsx|jsx)$/,
    /main\.(ts|js|py|go|rs)$/,
    /app\.(ts|js|tsx|jsx|py)$/,
    /server\.(ts|js)$/,
    /api\//,
    /routes?\//,
    /controllers?\//,
    /services?\//,
    /models?\//,
    /types?\.(ts|d\.ts)$/,
    /schema\.(ts|js|py)$/,
  ];

  const scored = files.map(file => {
    let score = 0;
    for (let i = 0; i < priorities.length; i++) {
      if (priorities[i].test(file)) {
        score = priorities.length - i;
        break;
      }
    }
    return { file, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .filter(f => f.score > 0)
    .map(f => f.file);
}

interface ExportInfo {
  name: string;
  type: string;
}

function extractExports(content: string, filePath: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const ext = extname(filePath);

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    // TypeScript/JavaScript exports
    const patterns = [
      { regex: /export\s+(?:async\s+)?function\s+(\w+)/g, type: 'function' },
      { regex: /export\s+const\s+(\w+)/g, type: 'const' },
      { regex: /export\s+class\s+(\w+)/g, type: 'class' },
      { regex: /export\s+interface\s+(\w+)/g, type: 'interface' },
      { regex: /export\s+type\s+(\w+)/g, type: 'type' },
      { regex: /export\s+enum\s+(\w+)/g, type: 'enum' },
      { regex: /export\s+default\s+(?:class|function)?\s*(\w+)?/g, type: 'default' },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1]) {
          exports.push({ name: match[1], type });
        }
      }
    }
  } else if (ext === '.py') {
    // Python - look for class and function definitions at module level
    const lines = content.split('\n');
    for (const line of lines) {
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) exports.push({ name: classMatch[1], type: 'class' });

      const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
      if (funcMatch && !funcMatch[1].startsWith('_')) {
        exports.push({ name: funcMatch[1], type: 'function' });
      }
    }
  } else if (ext === '.go') {
    // Go - exported names start with uppercase
    const patterns = [
      { regex: /^func\s+([A-Z]\w*)/gm, type: 'function' },
      { regex: /^type\s+([A-Z]\w*)\s+struct/gm, type: 'struct' },
      { regex: /^type\s+([A-Z]\w*)\s+interface/gm, type: 'interface' },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        exports.push({ name: match[1], type });
      }
    }
  }

  return exports;
}

async function detectApiRoutes(targetDir: string): Promise<MemoryEntryInput[]> {
  const entries: MemoryEntryInput[] = [];
  const codeFiles = await findCodeFiles(targetDir, targetDir);

  const routeFiles = codeFiles.filter(f =>
    /routes?|api|controllers?|endpoints?/i.test(f)
  );

  const allRoutes: Array<{ method: string; path: string; file: string }> = [];

  for (const file of routeFiles.slice(0, 20)) {
    try {
      const content = await readFile(file, 'utf-8');
      const routes = extractRoutes(content, file);
      allRoutes.push(...routes.map(r => ({ ...r, file: relative(targetDir, file) })));
    } catch {
      // Skip unreadable files
    }
  }

  if (allRoutes.length > 0) {
    // Group routes by file
    const byFile = new Map<string, typeof allRoutes>();
    for (const route of allRoutes) {
      const existing = byFile.get(route.file) || [];
      existing.push(route);
      byFile.set(route.file, existing);
    }

    for (const [file, routes] of byFile) {
      const routeList = routes
        .map(r => `- ${r.method.toUpperCase()} ${r.path}`)
        .join('\n');

      entries.push({
        content: `# API Routes: ${file}\n\n${routeList}`,
        metadata: {
          category: 'component',
          source: 'discovery',
          filePath: file,
          keywords: ['api', 'routes', 'endpoints', ...routes.map(r => r.method.toLowerCase())],
        },
      });
    }
  }

  return entries;
}

function extractRoutes(content: string, filePath: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const ext = extname(filePath);

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    // Express-style: app.get('/path', ...) or router.get('/path', ...)
    const expressPattern = /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;
    while ((match = expressPattern.exec(content)) !== null) {
      routes.push({ method: match[1], path: match[2] });
    }

    // Next.js App Router: export async function GET/POST/etc
    const nextPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g;
    while ((match = nextPattern.exec(content)) !== null) {
      // Infer path from file location
      const pathMatch = filePath.match(/app(.+?)\/route\.(ts|js)/);
      const path = pathMatch ? pathMatch[1].replace(/\\/g, '/') : '/';
      routes.push({ method: match[1], path });
    }

    // Fastify: fastify.get('/path', ...)
    const fastifyPattern = /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    while ((match = fastifyPattern.exec(content)) !== null) {
      routes.push({ method: match[1], path: match[2] });
    }
  } else if (ext === '.py') {
    // FastAPI: @app.get("/path") or @router.get("/path")
    const fastapiPattern = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;
    let match;
    while ((match = fastapiPattern.exec(content)) !== null) {
      routes.push({ method: match[1], path: match[2] });
    }

    // Flask: @app.route("/path", methods=["GET"])
    const flaskPattern = /@app\.route\s*\(\s*['"]([^'"]+)['"](?:.*?methods\s*=\s*\[['"](\w+)['"]\])?/gi;
    while ((match = flaskPattern.exec(content)) !== null) {
      routes.push({ method: match[2] || 'GET', path: match[1] });
    }
  } else if (ext === '.go') {
    // Go net/http or common routers
    const goPattern = /(?:Handle|HandleFunc|Get|Post|Put|Delete)\s*\(\s*["']([^"']+)["']/gi;
    let match;
    while ((match = goPattern.exec(content)) !== null) {
      routes.push({ method: 'handler', path: match[1] });
    }
  }

  return routes;
}

async function inferArchitecturePatterns(targetDir: string): Promise<string[]> {
  const patterns: string[] = [];

  try {
    const topLevel = await readdir(targetDir, { withFileTypes: true });
    const dirs = topLevel.filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'));
    const dirNames = new Set(dirs.map(d => d.name.toLowerCase()));

    // Detect common patterns
    if (dirNames.has('src')) {
      patterns.push('Source in /src directory');
    }

    if (dirNames.has('components') || await pathExists(join(targetDir, 'src', 'components'))) {
      patterns.push('Component-based architecture');
    }

    if ((dirNames.has('controllers') || await pathExists(join(targetDir, 'src', 'controllers'))) &&
        (dirNames.has('services') || await pathExists(join(targetDir, 'src', 'services')))) {
      patterns.push('Service-Controller pattern');
    }

    if (dirNames.has('models') || dirNames.has('entities') ||
        await pathExists(join(targetDir, 'src', 'models'))) {
      patterns.push('Model/Entity layer');
    }

    if (dirNames.has('repositories') || await pathExists(join(targetDir, 'src', 'repositories'))) {
      patterns.push('Repository pattern');
    }

    if (dirNames.has('hooks') || await pathExists(join(targetDir, 'src', 'hooks'))) {
      patterns.push('Custom React hooks');
    }

    if (dirNames.has('store') || dirNames.has('stores') ||
        await pathExists(join(targetDir, 'src', 'store'))) {
      patterns.push('State management (store)');
    }

    if (dirNames.has('utils') || dirNames.has('lib') || dirNames.has('helpers')) {
      patterns.push('Utility/helper modules');
    }

    if (dirNames.has('types') || await pathExists(join(targetDir, 'src', 'types'))) {
      patterns.push('Centralized type definitions');
    }

    if (dirNames.has('tests') || dirNames.has('__tests__') || dirNames.has('test')) {
      patterns.push('Dedicated test directory');
    }

    if (dirNames.has('api') || await pathExists(join(targetDir, 'src', 'api'))) {
      patterns.push('API layer separation');
    }

    if (dirNames.has('middleware') || await pathExists(join(targetDir, 'src', 'middleware'))) {
      patterns.push('Middleware pattern');
    }

    // Check for monorepo
    if (dirNames.has('packages') || dirNames.has('apps')) {
      patterns.push('Monorepo structure');
    }

    // Check for feature-based structure
    if (dirNames.has('features') || dirNames.has('modules')) {
      patterns.push('Feature/module-based organization');
    }

  } catch {
    // Skip on error
  }

  return patterns;
}

async function pathExists(path: string): Promise<boolean> {
  return existsSync(path);
}
