# Claude Memory

Local knowledge tier system for Claude Code - repository-specific semantic search.

## Architecture Overview

3-tier knowledge system:
1. **Rules** (auto-loaded): `CLAUDE.md`, `.claude/settings.json`
2. **Knowledge** (grep-searchable): `.claude/knowledge/*.md`
3. **Vector DB** (semantic search): `.claude/memory/vectors.lance`

## Tech Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Vector DB | LanceDB | File-based, no server, committed to repo |
| Embeddings | Transformers.js | Xenova/all-MiniLM-L6-v2, 384 dimensions |
| MCP Server | @modelcontextprotocol/sdk | stdio transport |
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

### Search Quality

Filter by similarity threshold:

```typescript
const MIN_SIMILARITY_SCORE = -0.5;
results.filter(r => r._distance >= MIN_SIMILARITY_SCORE);
```

## Commands

```bash
npx claude-memory init      # Initialize in current repo
npx claude-memory index     # Index markdown files
npx claude-memory search    # CLI search
npx claude-memory serve     # Start MCP server
npx claude-memory add       # Add manual entry
```

## MCP Tools

- `memory_search` - Semantic search across knowledge
- `memory_add` - Add runtime discoveries
- `memory_list` - List entries by category
- `memory_delete` - Remove entries

## Directory Structure

```
src/
  types/          # TypeScript interfaces
  utils/          # Logger, errors, ID generation
  storage/        # LanceDB, embeddings, metadata
  indexer/        # Markdown parser, directives, hasher
  server/         # MCP server and tool handlers
  cli/            # CLI commands
```

## Testing

```bash
npm test          # Run all tests
npm run build     # Build ESM output
```

54 tests covering unit and integration scenarios.

## Security Notes

- All query inputs validated and escaped
- Path traversal protection in indexer
- No external API calls - runs fully local
- File-based DB committed to repo (no secrets in vectors)
