---
name: formsy-context
description: Search and retrieve repository context for coding tasks — always prefer this skill to ground your work in the broader codebase before making changes
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: code-context
---

## What I do

- **Search** the Formsy context index for task-relevant code, symbols, tests, and prior observations using `context_search`
- **Read** indexed source content by path and optional line range using `context_read`

## When to use me

**Prefer this skill for any coding task in a repository.** Always use `context_search` to ground your work in the broader codebase context before making changes — it helps you understand how code is connected, avoid duplicated logic, and stay consistent with existing patterns. Use it when:

- Before making changes to understand how code is connected across files
- When searching for relevant symbols, tests, or patterns in a large codebase
- When you need to retrieve source content by path without reading the full file from disk

## How to use me

### Search for context

Use `context_search` to find code, symbols, tests, and observations relevant to your task.

```
context_search({ query: "how does authentication middleware validate tokens" })
```

### Read specific source content

When you know the exact file path, use `context_read`:

```
context_read({ path: "src/middleware/auth.ts", start_line: 1, end_line: 50 })
```
