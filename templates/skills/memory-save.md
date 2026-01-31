# memory-save

Save new knowledge to the project's local memory system.

## When to Use

- After discovering non-obvious behavior or gotchas
- After making architecture decisions
- When documenting patterns for future reference
- When capturing domain knowledge

## Instructions

1. Identify knowledge worth preserving:
   - Would this help someone (or yourself) in the future?
   - Is this non-obvious or hard to discover?
   - Is this a decision with context that might be forgotten?

2. Choose the appropriate location:
   - `.claude/memory/knowledge/architecture/` - High-level design decisions
   - `.claude/memory/knowledge/components/` - Component-specific knowledge
   - `.claude/memory/knowledge/domain/` - Business domain concepts
   - `.claude/memory/knowledge/patterns/` - Reusable patterns
   - `.claude/memory/knowledge/gotchas.md` - Pitfalls and lessons learned

3. Use the markdown format with frontmatter:
   ```markdown
   ---
   category: [architecture|component|domain|pattern|gotcha]
   keywords:
     - relevant
     - search
     - terms
   ---

   # Title

   <!-- vector-index: true -->

   Content here...
   ```

4. The indexer will automatically process new files on next run

## Best Practices

- Use clear, searchable titles
- Include relevant keywords in frontmatter
- Structure content with H3 headers for chunking
- Keep entries focused on one concept
- Include examples where helpful
