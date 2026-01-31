# memory-query

Query the project's local memory for specific information.

## When to Use

- When you need specific context about how something works
- When implementing a feature that may have established patterns
- When debugging an issue that may have known gotchas

## Instructions

1. Formulate a specific query about what you need to know
2. Use the `memory_search` MCP tool with your query
3. Review the results and extract relevant context
4. Apply the knowledge to your current task

## Query Strategies

### By Category

- Architecture: "how is the [subsystem] architected"
- Components: "what does [component] do"
- Domain: "[domain term] meaning"
- Patterns: "how to implement [pattern]"
- Gotchas: "known issues with [feature]"

### By Intent

- Understanding: "explain [concept]"
- Implementation: "how to [action]"
- Troubleshooting: "why does [behavior] happen"

## Example Usage

```
Query: "authentication flow"
Result: Knowledge about how auth is implemented, tokens, sessions, etc.

Query: "database connection gotchas"
Result: Known issues and workarounds for DB connections
```
