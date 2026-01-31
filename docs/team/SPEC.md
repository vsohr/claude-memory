# Claude Memory - Local Knowledge Tier System

**Status:** Enriched (Ready for Implementation)
**Version:** 0.3

---

## Problem Statement

Claude Code loses context between sessions and lacks structured access to repository-specific knowledge. Developers repeatedly explain architecture, domain concepts, and patterns. There's no persistent, searchable memory layer that Claude can query efficiently.

## Target User

Developers using Claude Code who want:
- Persistent repository knowledge across sessions
- Fast retrieval of architecture decisions and patterns
- Automatic learning from debugging sessions
- Semantic search for conceptual questions

## Solution Overview

An **npm package** (`claude-memory`) that installs a 3-tier local knowledge system into any repository:

```bash
npm install claude-memory
npx claude-memory init
```

| Tier | Storage | Search Method | Use Case |
|------|---------|---------------|----------|
| 1 | `.claude/rules/` | Auto-loaded | Always-needed context |
| 2 | `.claude/knowledge/` | Grep (keyword) | Structured reference docs |
| 3 | Vector DB | Semantic (MCP) | Conceptual/fuzzy queries |

## Architecture Decision: NPM Package

This is a **blueprint repo** - the package gets installed into host repos:

```
claude-memory (this package)
├── src/                    # Package source
│   ├── server/            # MCP server
│   ├── indexer/           # Markdown -> vectors
│   ├── cli/               # CLI commands
│   └── init/              # Host repo setup
├── templates/             # Files copied to host repo
│   ├── skills/            # Memory skills
│   ├── knowledge/         # Example structure
│   └── hooks/             # Git hooks
└── bin/                   # CLI entry point

Host repo (after init)
├── .claude/
│   ├── memory/
│   │   ├── vectors/       # LanceDB files (committed)
│   │   └── meta.json      # Discovery state
│   ├── knowledge/         # Tier 2 markdown
│   ├── skills/            # Memory skills (copied)
│   └── settings.json      # MCP server registration
└── node_modules/
    └── claude-memory/     # MCP server runs from here
```

---

## Quality Bar

- **Reference products:** Obsidian (local-first knowledge), Raycast (fast retrieval)
- **Polish level:** MVP functional - works reliably, handles errors gracefully, minimal polish
- **Performance targets:**
  - MCP server startup: <2 seconds
  - Semantic search: <100ms for repos with <10,000 entries
  - Markdown indexing: <5 seconds for 100 files
  - CLI commands: <500ms response for non-indexing operations
- **Responsiveness:** CLI only (no GUI), works on Windows/macOS/Linux
- **Error experience:** All errors show actionable messages with fix suggestions

---

## Core Features

### F1: MCP Memory Server

TypeScript-based MCP server providing semantic search over local vectors.

#### Intent
- **User goal:** Query repository knowledge using natural language without knowing exact file locations
- **Feeling:** Confident that Claude has access to all relevant context; never repeating explanations
- **Anti-goals:** Should NOT become a general-purpose database; NOT a replacement for grep/file search

#### Sub-features

##### F1.1: LanceDB Storage
LanceDB storage with local ONNX embeddings via `@lancedb/embeddings`.

**Acceptance Criteria:**
- **Given** the MCP server starts
- **When** it initializes
- **Then** it connects to LanceDB at `.claude/memory/vectors/` within 2 seconds

- **Given** a vector entry is added
- **When** the entry is persisted
- **Then** it survives server restart without data loss

##### F1.2: memory_search Tool
Semantic search over memory entries.

**Acceptance Criteria:**
- **Given** memory contains indexed entries
- **When** `memory_search("authentication flow")` is called
- **Then** returns up to `limit` entries (default: 5) sorted by relevance score descending

- **Given** memory contains entries
- **When** `memory_search` is called with `limit: 10`
- **Then** returns at most 10 entries

- **Given** memory is empty or query has no matches
- **When** `memory_search` is called
- **Then** returns empty array (not null, not error)

- **Given** query is empty string
- **When** `memory_search("")` is called
- **Then** returns error with message "Query cannot be empty"

##### F1.3: memory_add Tool
Add knowledge entries to memory.

**Acceptance Criteria:**
- **Given** content and metadata are provided
- **When** `memory_add({ content: "...", metadata: { category: "architecture" }})` is called
- **Then** entry is persisted with auto-generated UUID and timestamp

- **Given** content exceeds 10,000 characters
- **When** `memory_add` is called
- **Then** returns error "Content exceeds maximum length of 10,000 characters"

- **Given** required `content` field is missing
- **When** `memory_add` is called with only metadata
- **Then** returns error "Content is required"

- **Given** metadata.category is not one of valid categories
- **When** `memory_add` is called
- **Then** defaults category to "general" and succeeds

**Valid categories:** architecture, component, domain, pattern, gotcha, discovery, general

##### F1.4: memory_list Tool
Browse memory entries by category.

**Acceptance Criteria:**
- **Given** memory contains entries in multiple categories
- **When** `memory_list("architecture")` is called
- **Then** returns only entries with category "architecture", sorted by created_at descending

- **Given** memory contains entries
- **When** `memory_list()` is called with no category
- **Then** returns all entries, sorted by created_at descending, limited to 50

- **Given** category does not exist or is empty
- **When** `memory_list("nonexistent")` is called
- **Then** returns empty array (not error)

##### F1.5: memory_delete Tool
Remove entry from memory.

**Acceptance Criteria:**
- **Given** entry with id "abc123" exists
- **When** `memory_delete("abc123")` is called
- **Then** entry is removed and returns `{ deleted: true, id: "abc123" }`

- **Given** entry with id does not exist
- **When** `memory_delete("nonexistent")` is called
- **Then** returns `{ deleted: false, id: "nonexistent", reason: "Entry not found" }`

##### F1.6: Auto-Promote Discoveries
Promote frequently-referenced discoveries to markdown files.

**Acceptance Criteria:**
- **Given** a discovery entry has been referenced 3+ times in the last 7 days
- **When** the hourly promotion check runs
- **Then** entry is written to `.claude/knowledge/{category}/{slug}.md`

- **Given** an entry is promoted
- **When** promotion completes
- **Then** entry metadata includes `promoted: true` and `promoted_at` timestamp

- **Given** an entry is already promoted
- **When** promotion check runs
- **Then** entry is skipped (no duplicate promotion)

**Reference tracking:** Each `memory_search` result hit increments `reference_count` for matched entries.

##### F1.7: Vector Storage Location
Store vectors in host repo's `.claude/memory/vectors/`.

**Acceptance Criteria:**
- **Given** MCP server is initialized in a host repo
- **When** it creates the vector database
- **Then** files are created under `{repo}/.claude/memory/vectors/`

- **Given** `.claude/memory/vectors/` does not exist
- **When** server starts
- **Then** directory is created automatically with proper permissions

#### Edge Cases
- **Empty database:** Search returns empty array; list returns empty array; delete returns not found
- **Corrupted database:** Server logs error, attempts recovery, falls back to fresh init if unrecoverable
- **Concurrent access:** LanceDB handles; server uses single writer pattern
- **Very long content:** Truncated at 10,000 chars with warning in response
- **Special characters in queries:** Passed to embedding model as-is; model handles gracefully

---

### F2: Markdown Indexer

Sync markdown files to vector database.

#### Intent
- **User goal:** Write knowledge in familiar markdown format and have it searchable semantically
- **Feeling:** Write once, find anywhere; documentation is alive and useful
- **Anti-goals:** NOT a markdown editor; NOT a documentation generator

#### Sub-features

##### F2.1: Parse Knowledge Directory
Parse all markdown files in `.claude/knowledge/**/*.md`.

**Acceptance Criteria:**
- **Given** `.claude/knowledge/` contains markdown files in subdirectories
- **When** indexer runs
- **Then** all `*.md` files are found recursively, excluding files starting with `_`

- **Given** `.claude/knowledge/` does not exist
- **When** indexer runs
- **Then** returns error "Knowledge directory not found. Run 'npx claude-memory init' first."

##### F2.2: Chunk by Headers
Each H3 header becomes a separate vector entry.

**Acceptance Criteria:**
- **Given** a markdown file with multiple H3 sections
- **When** indexer processes the file
- **Then** each H3 section (header + content until next H3/H2/H1) becomes one entry

- **Given** a markdown file with no H3 headers
- **When** indexer processes the file
- **Then** entire file content becomes one entry with title from filename

- **Given** a section exceeds 2,000 characters
- **When** indexer processes it
- **Then** content is split at sentence boundaries, each chunk <2,000 chars

##### F2.3: Vector Index Directive
Respect `<!-- vector-index: true/false -->` directive.

**Acceptance Criteria:**
- **Given** a file contains `<!-- vector-index: false -->`
- **When** indexer runs
- **Then** file is skipped entirely

- **Given** a file contains no directive
- **When** indexer runs
- **Then** file is indexed (default: true)

- **Given** directive is malformed (e.g., `<!-- vector-index: maybe -->`)
- **When** indexer runs
- **Then** logs warning and treats as true (indexes file)

##### F2.4: Keywords Directive
Extract `<!-- keywords: x, y, z -->` for metadata.

**Acceptance Criteria:**
- **Given** a section contains `<!-- keywords: auth, jwt, security -->`
- **When** indexer processes it
- **Then** entry metadata includes `keywords: ["auth", "jwt", "security"]`

- **Given** no keywords directive
- **When** indexer processes section
- **Then** entry metadata has empty keywords array

- **Given** keywords contain special characters
- **When** indexer processes
- **Then** keywords are trimmed and lowercased; special chars preserved

##### F2.5: Local ONNX Embeddings
Use LanceDB's built-in embeddings with ONNX runtime.

**Acceptance Criteria:**
- **Given** indexer runs for the first time
- **When** embedding model is not cached
- **Then** model is downloaded (~22MB) with progress indicator

- **Given** text needs embedding
- **When** embedding is generated
- **Then** produces 384-dimension vector using all-MiniLM-L6-v2

- **Given** embedding generation fails
- **When** error occurs
- **Then** logs error with file/section context and continues with remaining files

##### F2.6: Incremental Indexing
Skip unchanged files based on content hash.

**Acceptance Criteria:**
- **Given** `.claude/memory/meta.json` contains file hashes
- **When** indexer runs and file content unchanged
- **Then** file is skipped; log shows "Skipping unchanged: {filename}"

- **Given** file content has changed
- **When** indexer runs
- **Then** old entries for that file are removed; new entries added; hash updated

- **Given** `meta.json` is missing or corrupted
- **When** indexer runs
- **Then** performs full reindex; creates fresh `meta.json`

- **Given** `--force` flag is passed
- **When** indexer runs
- **Then** ignores hashes and reindexes all files

#### Edge Cases
- **Empty markdown file:** Skipped with warning "Empty file: {path}"
- **Binary file with .md extension:** Detected, skipped with warning
- **Very large file (>1MB):** Indexed but with warning; recommend splitting
- **Circular symlinks:** Detected and skipped
- **Permission denied:** Log error, continue with other files
- **Encoding issues:** Assume UTF-8; log warning for non-UTF-8 files

---

### F3: Skills Integration

Claude behavioral automation for memory operations.

#### Intent
- **User goal:** Memory operations happen automatically without manual invocation
- **Feeling:** Claude "just knows" about the codebase without being told
- **Anti-goals:** NOT chatbot personality; NOT autonomous agent behavior

#### Sub-features

##### F3.1: memory-discover Skill
Deep codebase exploration triggered by user request.

**Acceptance Criteria:**
- **Given** user invokes `/memory-discover` or asks Claude to learn the codebase
- **When** skill executes
- **Then** analyzes: folder structure, package.json, entry points, exports, patterns

- **Given** discovery runs
- **When** analysis completes
- **Then** findings are saved as discovery entries with category "discovery"

- **Given** codebase has >1000 files
- **When** discovery runs
- **Then** completes within 60 seconds, sampling representative files

- **Given** discovery is already in progress
- **When** user invokes again
- **Then** returns "Discovery already in progress" and current status

**Discovery depth:**
- Structure: folder tree, key directories identified
- Exports: public APIs from main entry points
- Patterns: coding conventions, naming patterns, architecture style

##### F3.2: memory-query Skill
Auto-search memory before answering architecture questions.

**Acceptance Criteria:**
- **Given** user asks "How does authentication work?"
- **When** skill triggers
- **Then** automatically calls `memory_search("authentication")` before responding

- **Given** memory search returns relevant results
- **When** Claude responds
- **Then** response incorporates memory context with citation "Based on project knowledge..."

- **Given** memory search returns no results
- **When** Claude responds
- **Then** responds normally without memory citation; does not mention empty search

**Trigger patterns:** Questions containing: "how does", "where is", "what is the", "architecture", "pattern", "why do we"

##### F3.3: memory-save Skill
Auto-save discoveries during debugging sessions.

**Acceptance Criteria:**
- **Given** Claude discovers non-obvious behavior during debugging
- **When** session contains "aha moment" (fix after investigation)
- **Then** offers to save discovery: "Would you like me to save this finding?"

- **Given** user confirms save
- **When** discovery is saved
- **Then** entry created with category "gotcha" and source "session"

- **Given** user declines save
- **When** response sent
- **Then** no entry created; no further prompts for same finding

**Aha moment detection:** Fix applied after 3+ failed attempts, or explicit "finally found it" language

#### Edge Cases
- **Discovery interrupted:** Partial results saved with `complete: false` flag
- **Memory full (>10,000 entries):** Warn user; suggest pruning old discoveries
- **Skill conflict:** memory-query and memory-discover both triggered; query takes precedence
- **Offline ONNX model not cached:** Discovery proceeds without embeddings; saves for later indexing

---

### F4: Automation Layer

Zero-touch sync and population.

#### Intent
- **User goal:** Memory stays current without manual intervention
- **Feeling:** Set up once, forget about it; always up to date
- **Anti-goals:** NOT blocking developer workflow; NOT modifying source code

#### Sub-features

##### F4.1: Pre-commit Hook
Sync markdown to vectors on commit.

**Acceptance Criteria:**
- **Given** git pre-commit hook is installed
- **When** user runs `git commit` and `.claude/knowledge/` files changed
- **Then** indexer runs before commit; output shown in terminal

- **Given** indexing succeeds
- **When** hook completes
- **Then** commit proceeds normally; vector changes included

- **Given** indexing fails
- **When** hook completes
- **Then** warning shown but commit NOT blocked; log saved to `.claude/memory/errors.log`

- **Given** no knowledge files changed in commit
- **When** hook runs
- **Then** hook exits immediately (no indexing)

##### F4.2: Post-install Discovery
First-run discovery on npm install.

**Acceptance Criteria:**
- **Given** `npx claude-memory init` completes
- **When** init finishes
- **Then** basic structure analysis runs (quick mode, <10 seconds)

- **Given** full discovery is desired
- **When** user runs `npx claude-memory discover`
- **Then** deep analysis runs (up to 60 seconds)

- **Given** postinstall in host repo runs
- **When** package installed as dependency
- **Then** only prompts "Run 'npx claude-memory init' to set up memory"

##### F4.3: Auto-Promote Discoveries
Promote frequently-referenced discoveries to markdown.

**Acceptance Criteria:**
- **Given** discovery entry has 3+ references in 7 days
- **When** hourly background check runs (if MCP server active)
- **Then** markdown file created at `.claude/knowledge/discoveries/{slug}.md`

- **Given** entry is promoted
- **When** markdown file is created
- **Then** includes frontmatter: `promoted_from: {entry_id}`, `promoted_at: {timestamp}`

- **Given** target file already exists
- **When** promotion runs
- **Then** skips with warning; does not overwrite

##### F4.4: Source Change Hook
Quick re-analysis on source changes.

**Acceptance Criteria:**
- **Given** files in `src/` or main source directory change
- **When** pre-commit hook runs
- **Then** updates structure cache in `.claude/memory/meta.json`

- **Given** quick analysis runs
- **When** analysis completes
- **Then** takes <5 seconds; only updates file tree and exports

- **Given** deep changes detected (new entry points, major refactor)
- **When** quick analysis runs
- **Then** logs suggestion: "Significant changes detected. Run 'npx claude-memory discover' for full analysis"

#### Edge Cases
- **Git not installed:** Hooks silently skipped; warning on init
- **Hook already exists:** Appends to existing hook; does not overwrite
- **Large commit (100+ files):** Quick analysis only; defers deep analysis
- **Concurrent commits:** Lock file prevents parallel indexing

---

### F5: CLI Commands

Package provides CLI via `npx claude-memory`:

#### Intent
- **User goal:** Quick commands for setup, debugging, and manual operations
- **Feeling:** Familiar CLI patterns; helpful error messages
- **Anti-goals:** NOT a REPL; NOT interactive prompts (except init)

#### Sub-features

##### F5.1: init Command
Set up host repo with memory infrastructure.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory init` in a repo
- **When** command executes
- **Then** creates `.claude/knowledge/`, `.claude/skills/`, copies templates

- **Given** `.claude/` directory already exists
- **When** init runs
- **Then** prompts "Existing .claude found. Merge templates? (y/N)" - only creates missing files

- **Given** init completes
- **When** setup done
- **Then** outputs checklist of created files and next steps

- **Given** not in a git repo
- **When** init runs
- **Then** warns "Not a git repo. Git hooks will not be installed." and continues

**Exit codes:** 0 = success, 1 = error

##### F5.2: index Command
Sync markdown to vectors.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory index`
- **When** command executes
- **Then** indexes all markdown in `.claude/knowledge/`; shows progress bar

- **Given** indexing completes
- **When** output shown
- **Then** displays: files processed, entries created, time elapsed

- **Given** `--force` flag passed
- **When** index runs
- **Then** ignores cache, reindexes all files

- **Given** `--dry-run` flag passed
- **When** index runs
- **Then** shows what would be indexed without actually indexing

**Exit codes:** 0 = success, 1 = error, 2 = warnings but completed

##### F5.3: analyze Command
Codebase structure scan.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory analyze`
- **When** command executes (default: quick)
- **Then** outputs folder structure, entry points, languages detected

- **Given** `--deep` flag passed
- **When** analyze runs
- **Then** includes exports analysis, pattern detection (up to 60s)

- **Given** `--quick` flag passed
- **When** analyze runs
- **Then** only folder structure and basic stats (<5s)

- **Given** `--json` flag passed
- **When** analyze completes
- **Then** outputs JSON instead of formatted text

**Output format (default):**
```
Project: my-app
Languages: TypeScript (85%), CSS (10%), JSON (5%)
Entry points: src/index.ts, src/cli.ts
Directories: 45 | Files: 312 | Lines: 28,450
```

##### F5.4: discover Command
Full discovery (skill equivalent from CLI).

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory discover`
- **When** command executes
- **Then** runs full discovery analysis and saves to memory

- **Given** discovery completes
- **When** output shown
- **Then** displays count of discoveries and categories found

- **Given** `--save` flag passed (default: true)
- **When** discovery completes
- **Then** saves findings to vector database

- **Given** `--no-save` flag passed
- **When** discovery completes
- **Then** only outputs findings without persisting

##### F5.5: add Command
Add memory entry manually.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory add "API uses JWT tokens" --category=architecture`
- **When** command executes
- **Then** creates entry with content and category; outputs entry ID

- **Given** content not provided
- **When** command runs
- **Then** opens $EDITOR for content input; saves on exit

- **Given** invalid category
- **When** command runs
- **Then** shows valid categories and prompts for selection

##### F5.6: promote Command
Promote discovery to markdown.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory promote abc123`
- **When** command executes and entry exists
- **Then** creates markdown file and marks entry as promoted

- **Given** entry already promoted
- **When** promote runs
- **Then** outputs "Entry already promoted to {path}"

- **Given** entry not found
- **When** promote runs
- **Then** outputs error "Entry not found: abc123" with exit code 1

##### F5.7: search Command
CLI search for debugging.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory search "authentication"`
- **When** command executes
- **Then** outputs top 5 results with scores, truncated content preview

- **Given** `--limit=N` flag passed
- **When** search runs
- **Then** returns up to N results

- **Given** no results found
- **When** search completes
- **Then** outputs "No results found for: {query}"

- **Given** `--json` flag passed
- **When** search completes
- **Then** outputs full JSON array of results

**Output format (default):**
```
1. [0.89] architecture/auth.md#jwt-flow
   JWT tokens are validated on each request using...

2. [0.82] discoveries/session-abc.md
   Authentication middleware checks Bearer token...
```

#### Edge Cases
- **No arguments:** Shows help with available commands
- **Unknown command:** "Unknown command: {cmd}. Run 'npx claude-memory --help'"
- **Ctrl+C during operation:** Graceful shutdown, partial state preserved
- **No TTY (piped input):** Skips interactive prompts, uses defaults

---

### F6: Init Templates

Files copied to host repo on `init`:

```
.claude/
├── knowledge/
│   ├── architecture/
│   │   └── .gitkeep
│   ├── components/
│   │   └── .gitkeep
│   ├── domain/
│   │   └── .gitkeep
│   ├── patterns/
│   │   └── .gitkeep
│   └── gotchas.md        # Template with format example
├── skills/
│   ├── memory-discover.md
│   ├── memory-query.md
│   └── memory-save.md
└── settings.json         # MCP server registration
```

#### Intent
- **User goal:** Start with sensible structure; know where to put knowledge
- **Feeling:** Guided setup; not starting from blank slate
- **Anti-goals:** NOT opinionated structure; should be customizable

#### Acceptance Criteria

- **Given** init runs
- **When** templates are copied
- **Then** all files from templates/ are copied preserving directory structure

- **Given** file already exists in target
- **When** init runs
- **Then** existing file is NOT overwritten; log shows "Skipping existing: {path}"

- **Given** gotchas.md template copied
- **When** user opens file
- **Then** contains example format with placeholder content and directives

- **Given** settings.json copied
- **When** file inspected
- **Then** contains MCP server registration pointing to node_modules/claude-memory

- **Given** skills copied
- **When** files inspected
- **Then** each skill has proper frontmatter and instructions

#### Edge Cases
- **Template file corrupted:** Logged and skipped
- **Disk full:** Fails fast with "Insufficient disk space"
- **Read-only directory:** Fails with "Cannot write to {path}: Permission denied"

---

### F7: Language Agnostic

Works with any programming language repository.

#### Intent
- **User goal:** Use memory system regardless of tech stack
- **Feeling:** Works the same whether it's Python, Rust, or mixed repo
- **Anti-goals:** NOT language-specific tooling; NOT linter/formatter

#### Sub-features

##### F7.1: Universal File Structure Analysis
Analyze any project's structure.

**Acceptance Criteria:**
- **Given** any repository with files and folders
- **When** structure analysis runs
- **Then** identifies: root, source directories, config files, documentation

- **Given** common directories (src/, lib/, app/, pkg/)
- **When** analysis runs
- **Then** identifies as source directories regardless of language

##### F7.2: Language Detection
Detect languages via file extensions.

**Acceptance Criteria:**
- **Given** repository with mixed file types
- **When** language detection runs
- **Then** reports percentage breakdown of languages by file count

- **Given** unknown extension
- **When** detection runs
- **Then** categorized as "Other" in breakdown

**Supported extensions (core):**
.ts, .tsx, .js, .jsx, .py, .go, .rs, .java, .kt, .swift, .c, .cpp, .h, .rb, .php, .cs, .fs, .scala, .clj, .ex, .exs, .hs, .ml, .lua, .sh, .bash, .zsh, .ps1, .r, .jl

##### F7.3: Language-Specific Analyzers (Plugin Architecture)
Extensible analyzers for deep language understanding.

**Acceptance Criteria:**
- **Given** analyzer for TypeScript exists
- **When** analyzing TypeScript project
- **Then** extracts: exports, types, function signatures

- **Given** no analyzer for language
- **When** analyzing that language
- **Then** falls back to universal heuristics

- **Given** custom analyzer at `.claude/analyzers/{lang}.js`
- **When** analysis runs
- **Then** custom analyzer is loaded and used

**Built-in analyzers (v1):** TypeScript/JavaScript only

##### F7.4: Fallback Heuristics
Default analysis for unknown languages.

**Acceptance Criteria:**
- **Given** unknown language project
- **When** analysis runs
- **Then** extracts: file tree, comment patterns, naming conventions

- **Given** file with no extension
- **When** analysis runs
- **Then** attempts shebang detection; otherwise treated as text

**Heuristics applied:**
- CamelCase vs snake_case detection
- Comment style (// vs # vs --)
- Entry point detection (main.*, index.*, app.*)

#### Edge Cases
- **Empty repository:** Returns minimal analysis with "No source files found"
- **Binary files only:** Skipped; analysis reports "No analyzable files"
- **Mixed language monorepo:** Each directory analyzed with appropriate analyzer
- **Vendored dependencies:** node_modules/, vendor/ excluded by default

---

## Non-Functional Requirements

### NF1: Local-Only

All data stays on local machine. No external API calls for embeddings or storage.

**Acceptance Criteria:**
- **Given** package is installed
- **When** any operation runs
- **Then** no network requests are made (except first-time model download)

- **Given** first-time model download needed
- **When** download occurs
- **Then** downloads from Hugging Face CDN; cached in node_modules

- **Given** network is unavailable
- **When** model already cached
- **Then** all operations work offline

### NF2: Low Token Overhead

MCP tool definitions should be minimal.

**Acceptance Criteria:**
- **Given** MCP server registers tools
- **When** tool definitions are serialized
- **Then** total definition size is <5,000 tokens

- **Given** tool descriptions
- **When** formatted for Claude
- **Then** each tool description is <200 tokens

### NF3: Fast Retrieval

Semantic search should be fast.

**Acceptance Criteria:**
- **Given** vector database with <10,000 entries
- **When** `memory_search` is called
- **Then** returns results in <100ms

- **Given** vector database with 10,000-50,000 entries
- **When** `memory_search` is called
- **Then** returns results in <500ms

- **Given** vector database with >50,000 entries
- **When** `memory_search` is called
- **Then** returns results in <2,000ms (with warning to prune)

### NF4: Portable

Vector DB files committed to host repo, work after clone.

**Acceptance Criteria:**
- **Given** repo with `.claude/memory/vectors/` is cloned
- **When** MCP server starts
- **Then** all existing memories are accessible

- **Given** vector files exceed 50MB
- **When** status checked
- **Then** CLI warns "Vector DB is large (>50MB). Consider pruning old entries."

- **Given** git LFS is available
- **When** vectors exceed 50MB
- **Then** CLI suggests "Consider using Git LFS for .claude/memory/vectors/"

### NF5: Rebuildable

Vectors can be regenerated from markdown.

**Acceptance Criteria:**
- **Given** `.claude/memory/vectors/` is deleted
- **When** `npx claude-memory index` runs
- **Then** vectors are fully rebuilt from `.claude/knowledge/`

- **Given** vectors rebuilt
- **When** compared to original
- **Then** search results are identical (deterministic embeddings)

### NF6: Zero Config for Common Cases

`npx claude-memory init` should just work.

**Acceptance Criteria:**
- **Given** user runs `npx claude-memory init` in any Node.js project
- **When** init completes
- **Then** memory system is fully functional without additional configuration

- **Given** advanced configuration needed
- **When** user creates `.claude/memory.config.json`
- **Then** config is respected for all operations

**Configuration options (optional):**
```json
{
  "knowledge_dir": ".claude/knowledge",
  "vectors_dir": ".claude/memory/vectors",
  "chunk_size": 2000,
  "model": "all-MiniLM-L6-v2",
  "ignored_dirs": ["node_modules", ".git", "dist"]
}
```

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding model | all-MiniLM-L6-v2 via Transformers.js | 22MB, local ONNX, 384 dims, fast |
| Vector storage | LanceDB | File-based, no server, fast |
| Distribution | npm package | Install into any repo |
| Vector commit | Always commit | Simpler, works after clone |
| Discovery depth | Deep (structure + exports + patterns) | User preference |
| Target repos | Any language | Universal tool |
| Default limit for search | 5 results | Balance relevance/noise |
| Max content size | 10,000 characters | Embedding model context limit |
| Chunk size | 2,000 characters | Optimal for embedding quality |
| Reference threshold for promotion | 3 references in 7 days | Avoid noise |

### Embedding Model Details

- **Model:** `Xenova/all-MiniLM-L6-v2` (ONNX format for Transformers.js)
- **Size:** ~22MB download, cached in node_modules
- **Dimensions:** 384
- **Max tokens:** 256 (sufficient for knowledge chunks)
- **Runtime:** ONNX Runtime via `@huggingface/transformers`
- **Memory:** ~100-200MB when loaded
- **Speed:** ~10-50ms per embedding on CPU

---

## Out of Scope (v1)

The following are explicitly NOT part of this version:

- **Cloud sync of memories** - Local-only is a core principle
- **Multi-repo memory sharing** - Each repo has isolated memory
- **GUI for memory management** - CLI only for v1
- **Integration with other AI tools (Cursor, Copilot)** - Claude Code focus only
- **Web-based memory browser** - Terminal/MCP interface only
- **Real-time collaborative editing** - Single-user tool
- **Memory encryption** - Files are plaintext markdown/vectors
- **Memory versioning/history** - Git provides this via committed vectors
- **Natural language commands in CLI** - Standard CLI syntax only
- **Automatic knowledge extraction from code comments** - Manual or skill-triggered only
- **Memory analytics/dashboards** - Simple counts only
- **Custom embedding models** - Single model for simplicity
- **Memory import/export formats** - Git clone is the export mechanism

---

## Glossary

| Term | Definition |
|------|------------|
| **Entry** | Single unit of knowledge in the vector database |
| **Discovery** | Auto-generated entry from codebase analysis |
| **Promotion** | Converting a discovery to a permanent markdown file |
| **Chunk** | Segment of markdown content sized for embedding |
| **Reference** | When a search query matches an entry |
| **Host repo** | Repository where claude-memory is installed |
| **Skill** | Claude behavioral automation script |

---

*Enriched by Product Owner. Ready for implementation.*
