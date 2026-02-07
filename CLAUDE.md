# Claude Memory

Local knowledge tier system for Claude Code - repository-specific semantic search with hybrid BM25 + vector retrieval.

## Architecture Overview

3-tier knowledge system:
1. **Rules** (auto-loaded): `CLAUDE.md`, `.claude/settings.json`
2. **Knowledge** (grep-searchable): `.claude/knowledge/*.md`
3. **Vector DB + FTS** (semantic + keyword search): `.claude/memory/vectors.lance` + `.claude/memory/fts.sqlite`

## Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Vector DB | LanceDB | File-based, no server, committed to repo |
| FTS | better-sqlite3 + FTS5 | BM25 keyword search with porter stemming |
| Embeddings | Transformers.js | Xenova/all-MiniLM-L6-v2, 384 dimensions |
| Search Fusion | RRF (k=60) | Reciprocal Rank Fusion for hybrid mode |
| MCP Server | @modelcontextprotocol/sdk | stdio transport, resources, prompts |
| CLI | Commander.js | Standard, well-documented |

## Key Patterns

### LanceDB Queries

CamelCase columns need double quotes in SQL filters:

```typescript
// CORRECT
table.filter(`"filePath" = '${escaped}'`)

// WRONG - silently fails
table.filter(`filePath = '${escaped}'`)
```

### Embedding Service

Always use singleton - model loading is slow:

```typescript
const service = await getEmbeddingService();
const vector = await service.embed(text);
```

### Hybrid Search

Three search modes available:

```typescript
const hybrid = new HybridSearch(repository, ftsStore, config);
await hybrid.search({ query: 'auth flow', mode: 'hybrid' }); // BM25 + vector + RRF
await hybrid.search({ query: 'auth flow', mode: 'keyword' }); // BM25 only
await hybrid.search({ query: 'auth flow', mode: 'vector' });  // vector only
```

### Config

Layered config: defaults -> `.claude/memory.config.json` -> env vars:

```typescript
const config = loadConfig(projectRoot);
// config.minScore, config.chunkOverlapPercent, config.defaultSearchMode
```

### Content Dedup

Chunks are content-addressed via SHA-256. Duplicate content is skipped on insert.

## Commands

```bash
npx claude-memory init                    # One-step setup (dirs + analyze + index + FTS)
npx claude-memory index                   # Re-index markdown files
npx claude-memory search "query"          # CLI search (default: hybrid)
npx claude-memory search "q" --mode keyword --format json
npx claude-memory serve                   # Start MCP server
npx claude-memory add                     # Add manual entry
```

## MCP Tools

- `memory_search` - Hybrid search (mode: vector/keyword/hybrid)
- `memory_add` - Add runtime discoveries (syncs to FTS)
- `memory_list` - List entries by category
- `memory_delete` - Remove entries (syncs to FTS)
- `memory_analyze` - Deep codebase analysis

## MCP Resources & Prompts

- `memory://{path}` - Direct access to knowledge files
- `query` prompt - Search strategy guide for agents

## Directory Structure

```
src/
  types/          # TypeScript interfaces (SearchMode, MemoryEntry)
  utils/          # Logger, errors, ID generation, config
  storage/        # LanceDB, FTS, hybrid search, embeddings, metadata
  indexer/        # Markdown parser (with overlap), directives, hasher
  server/         # MCP server, tools, resources, prompts
  cli/            # CLI commands, output formatters
```

## Testing

```bash
npm test          # Run all tests
npm run build     # Build ESM output
```

156 tests covering unit and integration scenarios.

## Security Notes

- All query inputs validated and escaped
- Path traversal protection in indexer and MCP resources (double-check: `..` rejection + startsWith gate)
- FTS uses parameterized queries (no SQL injection)
- No external API calls - runs fully local
- File-based DB committed to repo (no secrets in vectors)
