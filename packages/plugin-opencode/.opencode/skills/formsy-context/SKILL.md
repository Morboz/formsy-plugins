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
- **Re-compile** the repository into the Formsy context index using `formsy_compile_repo` (only needed after significant codebase changes)

## When to use me

**Prefer this skill for any coding task in a repository.** Always use `context_search` to ground your work in the broader codebase context before making changes — it helps you understand how code is connected, avoid duplicated logic, and stay consistent with existing patterns. Use it when:

- Before making changes to understand how code is connected across files
- When searching for relevant symbols, tests, or patterns in a large codebase
- When you need to retrieve source content by path without reading the full file from disk

## Prerequisites

This skill requires the `@formsy/plugin-opencode` plugin to be installed and active. If the tools are not available, inform the user that the plugin must be installed first.

Required environment variables:

- `FORMSY_GATEWAY_URL` — Formsy API gateway (e.g. `http://localhost:3001`)
- `FORMSY_API_KEY` — API key for authentication

## How to use me

### Search for context

Use `context_search` to find code, symbols, tests, and observations relevant to your task. **No manual compile step is needed** — `context_search` automatically ensures the repository is compiled before querying.

```
context_search({ query: "how does authentication middleware validate tokens" })
```

Optional arguments: `repo_id`, `revision`, `budget` (default 4000), `enable_profiling`, `profiling_top_n`, `metadata`, `identity`, `grounding_phase`, `grounded_files`, `test_failure_recovery`.

### Read specific source content

When you know the exact file path, use `context_read`:

```
context_read({ path: "src/middleware/auth.ts", start_line: 1, end_line: 50 })
```

Optional arguments: `repo_id`, `revision`, `start_line`, `end_line`, `identity`.

## Typical workflows

- **New project onboarding**: `context_search({ query: "project architecture and entry points" })` → `context_read({ path: "<key-file>" })`
- **Feature implementation**: `context_search({ query: "how does <feature-area> work" })` → `context_read({ path: "<relevant-file>" })`
- **Debugging**: `context_search({ query: "<error-message>", test_failure_recovery: true })` → `context_read({ path: "<suspect-file>", start_line: N, end_line: M })`

## Notes

- `context_search` automatically ensures the repository is compiled — no manual `formsy_compile_repo` call needed before searching
- `formsy_compile_repo` skips test files and common non-source directories automatically
- The `identity` parameter on `context_search` and `context_read` enables tracking of compile identity for consistent results across queries
- If observability is enabled (`FORMSY_OBSERVABILITY_ENABLED`), tool usage is reported automatically
