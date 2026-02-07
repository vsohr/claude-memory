# Claude Memory v0.2.0 — Hybrid Search & Quality Improvements

**Status:** Approved
**Version:** 0.2.0

---

## Problem Statement

Vector-only search misses exact keyword matches. Re-indexing creates duplicates. Chunk boundaries lose context. Search quality is not configurable. Setup requires multiple commands.

## Target User

Developers using Claude Code who want persistent, searchable project knowledge with one-step setup.

## Core Constraint: One-Step Install

`npx claude-memory init` does everything — creates directories, analyzes codebase, indexes markdown, builds FTS index, registers MCP server. Repo is fully searchable immediately after one command.

---

## Features

### F1: One-Step Install (Enhancement)
**What:** `npx claude-memory init` creates all infrastructure AND indexes everything in one pass.
**Acceptance Criteria:**
- Given a fresh repo, when running `npx claude-memory init`, then directories, configs, hooks, vector index, AND FTS index are all created
- Given init completes, when running `npx claude-memory search "any query"`, then hybrid search returns results immediately
- Given a repo with existing `.claude/` setup, when running init, then only missing pieces are created (idempotent)

### F2: BM25 Full-Text Search Layer
**What:** SQLite FTS5-based keyword search alongside LanceDB vectors.
**Acceptance Criteria:**
- Given indexed content, when searching with exact keywords, then BM25 returns matching documents ranked by relevance
- Given the FTS database, then it uses SQLite FTS5 with porter tokenizer at `.claude/memory/fts.sqlite`
- Given BM25 raw scores, then they are normalized to 0-1 range
- Given the FTS store, then it supports add, search, delete, and clear operations
- Given the FTS store, then it indexes content, category, source, filePath, sectionTitle, and keywords

### F3: Hybrid Search with RRF Fusion
**What:** Combine BM25 + vector results using Reciprocal Rank Fusion.
**Acceptance Criteria:**
- Given a query in hybrid mode, then both BM25 and vector search run and results are fused via RRF
- Given RRF fusion, then score formula is `1 / (k + rank)` with k=60, summed for items appearing in both lists
- Given duplicate results from both sources, then they are merged (not duplicated) with combined scores
- Given the MCP memory_search tool, then it accepts a `mode` parameter: "vector" | "keyword" | "hybrid" (default: "hybrid")
- Given the CLI search command, then it accepts a `--mode` flag with the same options

### F4: Content-Addressable Deduplication
**What:** Hash chunks before inserting to prevent duplicates.
**Acceptance Criteria:**
- Given a chunk of content, then SHA-256 of normalized content is used as identity
- Given a chunk that already exists (same hash), when re-indexing, then it is skipped
- Given the LanceDB schema, then it includes a `contentHash` field
- Given re-indexing the same files, then entry count does not increase

### F5: Chunking with Overlap
**What:** Add configurable overlap between consecutive chunks.
**Acceptance Criteria:**
- Given consecutive chunks, then the last 15% of chunk N is prepended to chunk N+1
- Given the overlap percentage, then it defaults to 15% and is configurable (0-50%)
- Given overlap of 0%, then behavior matches current (backward compatible)
- Given H3 header splits and long content splits, then overlap is applied to both

### F6: Configurable Similarity Threshold
**What:** Make the -0.5 threshold configurable.
**Acceptance Criteria:**
- Given `.claude/memory.config.json` with `minScore`, then that value is used
- Given env var `CLAUDE_MEMORY_MIN_SCORE`, then it overrides config file
- Given neither, then default -0.5 is used
- Priority: env var > config file > default

### F7: MCP Resources and Prompts
**What:** Resource templates and query guide for MCP server.
**Acceptance Criteria:**
- Given the MCP server, then it exposes a `memory://{path}` resource template
- Given a valid path, then the raw markdown content is returned
- Given the MCP server, then it exposes a `query` prompt explaining search strategies
- Given the prompt, then it explains when to use keyword vs semantic vs hybrid

### F8: Output Format Options
**What:** Multiple output formats for CLI search.
**Acceptance Criteria:**
- Given CLI search, then `--format` accepts: text (default), json, csv, md, xml
- Given any format, then output includes: score, content snippet, source file, category
- Given `--format json`, then output is valid JSON array
- Given `--format csv`, then output has header row with proper escaping
- Given `--format md`, then output is a markdown table
- Given `--format xml`, then output is valid XML with proper entity escaping

---

## Technical Constraints

- Node.js runtime (no Bun)
- LanceDB for vector storage (existing)
- Transformers.js for embeddings (existing, no additional ML models)
- better-sqlite3 for SQLite/FTS5
- All 54 existing tests must pass
- New tests for all new functionality
- ESM output, TypeScript strict mode
- Max 800 lines per file, max 50 lines per function

## Out of Scope → FUTURE.md

- Watch mode for auto-indexing
- Multi-repo namespace support
- Custom embedding models
- Query expansion / LLM reranking (would need local models)
