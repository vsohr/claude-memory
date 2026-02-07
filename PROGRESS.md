# Progress Tracking

## Current Phase
v0.2.0 Planning - COMPLETE

## v0.1.0 Status
- All 23 tasks implemented
- 54 tests passing across 13 test files
- Build successful (ESM output)
- Security review: PASSED

## v0.2.0 Planning Status

### Documents Completed
- [x] SPEC.md - Feature requirements for hybrid search, dedup, overlap, config, formatters, MCP resources
- [x] ARCHITECTURE.md - Detailed component designs with interfaces, algorithms, data flows
- [x] TASKS.md - 15 implementation tasks across 5 milestones (6 S + 9 M, ~11.5h est.)

### Milestone Overview
1. **Foundation** (Tasks 1.1-1.3): better-sqlite3 dep, config service, SearchMode type
2. **FTS Store** (Task 2.1): SQLite FTS5 wrapper with BM25 normalization
3. **Dedup + Overlap** (Tasks 3.1-3.3): contentHash in LanceDB, chunk overlap in parser, orchestrator wiring
4. **Hybrid Search** (Task 4.1): HybridSearch orchestrator with RRF fusion
5. **MCP + CLI** (Tasks 5.1-5.7): formatters, MCP resources/prompts, --mode/--format flags, init enhancement, exports

### New Files to Create (4)
- `src/utils/config.ts`
- `src/storage/fts.ts`
- `src/storage/hybrid.ts`
- `src/cli/formatters.ts`

### New Test Files (10)
- `tests/unit/utils/config.test.ts`
- `tests/unit/storage/fts.test.ts`
- `tests/unit/storage/lancedb-dedup.test.ts`
- `tests/unit/indexer/parser-overlap.test.ts`
- `tests/unit/indexer/orchestrator-overlap.test.ts`
- `tests/unit/storage/hybrid.test.ts`
- `tests/unit/cli/formatters.test.ts`
- `tests/unit/server/mcp-resources.test.ts`
- `tests/unit/cli/search-cmd.test.ts`
- `tests/unit/cli/init-full.test.ts`

### Key Design Decisions
- SearchMode defined in `src/types/memory.ts`, imported elsewhere (avoids circular deps)
- FTS uses `better-sqlite3` synchronous API (marked external in tsup)
- RRF fusion with k=60, 3x over-fetch factor for hybrid mode
- Content dedup via SHA-256 hash at storage level (catches all paths)
- Chunking overlap as post-processing (backward compat via number param)
- Config priority: env var > config file > defaults (zod-validated)
- Category filtering is post-fusion in hybrid mode (preserves rank positions)
- FTS sync failures are warnings, not errors (vector search still works)

## v0.1.0 Key Decisions (Reference)
- Transformers.js with Xenova/all-MiniLM-L6-v2 model (384 dimensions)
- LanceDB for file-based vector storage (no server process)
- Commander.js for CLI (well-documented, stable)
- Vitest for testing (ESM-native)
- tsup for bundling (zero config)
- Singleton pattern for embedding service and LanceDB connection
- MIN_SIMILARITY_SCORE = -0.5 for search quality filtering
- MCP servers configured in `.mcp.json` at project root (not in settings.json)

## Next Steps
- [ ] Implement Milestone 1: Foundation (Tasks 1.1-1.3)
- [ ] Implement Milestone 2: FTS Store (Task 2.1)
- [ ] Implement Milestone 3: Dedup + Overlap (Tasks 3.1-3.3)
- [ ] Implement Milestone 4: Hybrid Search (Task 4.1)
- [ ] Implement Milestone 5: MCP + CLI (Tasks 5.1-5.7)
- [ ] Run full test suite (54 existing + new tests)
- [ ] Security review
- [ ] Ship decision
