# claude-memory

Local knowledge tier system for Claude Code. Repository-specific semantic search that runs entirely on your machine.

## What it does

Claude Code loses context between sessions. This package gives Claude persistent, searchable memory for your repository:

- **Tier 1: Rules** — Auto-loaded `CLAUDE.md` and settings
- **Tier 2: Knowledge** — Grep-searchable markdown in `.claude/knowledge/`
- **Tier 3: Vectors** — Semantic search via local embeddings

Everything stays local. No API calls. Vectors commit to your repo.

## Installation

```bash
npm install claude-memory
```

## Quick Start

```bash
# Initialize in your repo
npx claude-memory init

# Add knowledge files to .claude/knowledge/
# Then index them
npx claude-memory index

# Test search
npx claude-memory search "authentication"

# Start MCP server for Claude Code
npx claude-memory serve
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Set up `.claude/` directory with templates |
| `index` | Index markdown files to vector database |
| `search <query>` | Search the memory database |
| `serve` | Start MCP server for Claude Code |
| `add <content>` | Add a manual memory entry |

### Options

```bash
# Force reindex all files
npx claude-memory index --force

# Dry run (show what would be indexed)
npx claude-memory index --dry-run

# Search with custom limit
npx claude-memory search "auth" --limit 10

# Output as JSON
npx claude-memory search "auth" --json

# Add with category
npx claude-memory add "API uses JWT" --category architecture
```

## MCP Tools

When running via `npx claude-memory serve`, these tools are available to Claude:

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across knowledge |
| `memory_add` | Add runtime discoveries |
| `memory_list` | List entries by category |
| `memory_delete` | Remove entries |

### Claude Code Integration

After `init`, a `.mcp.json` file is created at your project root with the MCP server registration:

```json
{
  "mcpServers": {
    "claude-memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["claude-memory", "serve"]
    }
  }
}
```

Additionally, `.claude/settings.json` includes a hook for automatic memory search on prompts.

## Writing Knowledge

Create markdown files in `.claude/knowledge/`:

```
.claude/knowledge/
├── architecture/
│   └── auth.md
├── components/
│   └── api-client.md
└── gotchas.md
```

### Directives

Control indexing with HTML comments:

```markdown
<!-- vector-index: true -->
<!-- keywords: auth, jwt, security -->

# Authentication

Content here gets indexed...
```

- `vector-index: false` — Skip this file
- `keywords: x, y, z` — Add searchable keywords

### Chunking

Content is chunked by H3 headers. Each `###` section becomes a separate vector entry:

```markdown
# Auth System

## Overview

### JWT Flow
This section becomes one entry...

### Session Management
This section becomes another entry...
```

## Categories

Entries are organized by category:

- `architecture` — System design, data flow
- `component` — Individual modules/services
- `domain` — Business logic, terminology
- `pattern` — Coding conventions, best practices
- `gotcha` — Non-obvious behaviors, pitfalls
- `discovery` — Runtime findings
- `general` — Everything else

## How It Works

```
Markdown files → Parser → Chunks → Embeddings → LanceDB
                           ↓
                    MCP Server ← Claude Code
```

- **Embeddings**: Transformers.js with `all-MiniLM-L6-v2` (384 dimensions, ~22MB)
- **Vector DB**: LanceDB (file-based, no server process)
- **Chunking**: H3 headers, max 2000 chars per chunk
- **Incremental**: SHA-256 content hashing skips unchanged files

## Project Structure

```
your-project/
├── .mcp.json           # MCP server registration (Claude Code)
└── .claude/
    ├── knowledge/      # Your markdown files (Tier 2)
    │   ├── architecture/
    │   ├── components/
    │   └── ...
    ├── memory/
    │   ├── vectors/    # LanceDB files (Tier 3)
    │   └── meta.json   # Index metadata
    ├── hooks/          # Auto-search hook
    ├── skills/         # Claude automation (optional)
    └── settings.json   # Hooks configuration
```

## Configuration

Optional `.claude/memory.config.json`:

```json
{
  "knowledge_dir": ".claude/knowledge",
  "vectors_dir": ".claude/memory/vectors",
  "chunk_size": 2000,
  "ignored_dirs": ["node_modules", ".git", "dist"]
}
```

## Performance

| Operation | Target |
|-----------|--------|
| MCP server startup | <2 seconds |
| Semantic search (<10k entries) | <100ms |
| Index 100 files | <5 seconds |

## Requirements

- Node.js 20+
- ~100-200MB RAM when embedding model loaded
- ~22MB disk for model cache

## License

MIT
