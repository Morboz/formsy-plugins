---
name: formsy-context
description: Search and retrieve Formsy repository context — use context_search to find relevant code, context_read to retrieve source, and formsy_compile_repo to re-index after significant changes
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: code-context
  requires_plugin: "@formsy/plugin-opencode"
---

## What I do

- **Search** the Formsy context index for task-relevant code, symbols, tests, and prior observations using `context_search`
- **Read** indexed source content by path and optional line range using `context_read`
- **Re-compile** the repository into the Formsy context index using `formsy_compile_repo` (only needed after significant codebase changes)

## When to use me

Use this skill when you need to ground your work in the broader repository context — for example:

- Before making changes to understand how code is connected across files
- When searching for relevant symbols, tests, or patterns in a large codebase
- When the agent needs to retrieve source content by path without reading the full file from disk

## Prerequisites

**This skill requires the `@formsy/plugin-opencode` plugin to be installed and active.** If the tools `context_search`, `context_read`, or `formsy_compile_repo` are not available, stop and inform the user that the plugin must be installed first:

```
npm install @formsy/plugin-opencode
```

Then add it to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@formsy/plugin-opencode"]
}
```

Also ensure these environment variables are set:

- `FORMSY_GATEWAY_URL` — Formsy API gateway (e.g. `http://localhost:3001`)
- `FORMSY_API_KEY` — API key for authentication

Optional observability variables:

- `FORMSY_OBSERVABILITY_ENABLED` — enable task reporting (`true`/`false`)
- `FORMSY_OBSERVABILITY_URL` — observability endpoint
- `FORMSY_OBSERVABILITY_API_KEY` — observability API key

## How to use me

### Search for context

Use `context_search` to find code, symbols, tests, and observations relevant to your task. **No manual compile step is needed** — `context_search` automatically ensures the repository is compiled before querying (it checks the server for an existing compile, and triggers one if needed).

```
context_search({
  query: "how does authentication middleware validate tokens"
})
```

Required arguments:

- `query` — natural language search query describing what you need

Optional arguments:

- `repo_id` — override repository identifier
- `revision` — override revision
- `budget` — positive integer controlling result size (default: `4000`)
- `enable_profiling` — boolean, return profiling information
- `profiling_top_n` — positive integer, number of profiling results
- `metadata` — object with string keys for additional context
- `identity` — object for compile-identity tracking
- `grounding_phase` — string indicating the grounding phase
- `grounded_files` — array of file paths already grounded
- `test_failure_recovery` — boolean, set when recovering from test failures

Returns contextual text with metadata including `repoId`, `revision`, and correlation IDs.

### Read specific source content

When you know the exact file path and want to retrieve indexed source content, use `context_read`:

```
context_read({
  path: "src/middleware/auth.ts",
  start_line: 1,
  end_line: 50
})
```

Required arguments:

- `path` — repository-relative file path

Optional arguments:

- `repo_id` — override repository identifier
- `revision` — override revision
- `start_line` — positive integer, start of line range
- `end_line` — positive integer, end of line range
- `identity` — object for compile-identity tracking

Returns formatted source content with metadata including `path`, `repoId`, `revision`, and correlation IDs.

## Typical workflows

### New project onboarding

1. Call `context_search({ query: "project architecture and entry points" })` — the first search auto-compiles the repository
2. Call `context_read({ path: "<key-file>" })` on specific files of interest

### Feature implementation

1. Call `context_search({ query: "how does <feature-area> work" })` to understand existing patterns
2. Call `context_read({ path: "<relevant-file>" })` to examine specific implementations

### Debugging

1. Call `context_search({ query: "<error-message-or-behavior>", test_failure_recovery: true })` to find related code and prior fixes
2. Call `context_read({ path: "<suspect-file>", start_line: <N>, end_line: <M> })` to inspect the relevant section

## Notes

- `context_search` automatically ensures the repository is compiled — no manual `formsy_compile_repo` call needed before searching
- `formsy_compile_repo` skips test files and common non-source directories automatically
- `context_search` results include correlation IDs useful for debugging with the Formsy team
- If observability is enabled, tool usage is reported automatically — no manual action needed
- The `identity` parameter on `context_search` and `context_read` enables tracking of compile identity for consistent results across queries
