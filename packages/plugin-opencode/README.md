# OpenCode Plugin

Formsy native plugin for OpenCode.

## What It Does

This package adds current Formsy context tools for OpenCode:

- `context_search` queries the Formsy repository context index through `/api/v1/query`
- `context_read` reads indexed source content by path through `/api/v1/read`
- `formsy_compile_repo` scans the current repository, skips tests, and submits source files to `/api/v1/compile`

It also registers OpenCode lifecycle hooks for Formsy observability. The reporter submits task-level counters, hashed file paths, server correlation IDs, and redacted command/task summaries. It does not submit prompts, source content, diffs, or shell output.

## Installation

```bash
npm install @formsy/plugin-opencode
```

Add it to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@formsy/plugin-opencode"]
}
```

For local development, run this from the project where you launch OpenCode:

```bash
npm --prefix /Users/xx/software/wanggen/plugins run build --workspace @formsy/plugin-opencode && mkdir -p .opencode/plugins && ln -sf /Users/xx/software/wanggen/plugins/packages/plugin-opencode/dist/index.js .opencode/plugins/formsy-opencode.js
```

## Configuration

Runtime API:

```bash
FORMSY_GATEWAY_URL=http://localhost:3001
FORMSY_API_KEY=fsy_test_key_dev_only_12345678
FORMSY_MEMORY_SEARCH_ENDPOINT=/api/v1/query
FORMSY_TIMEOUT_S=120
FORMSY_REQUEST_TIMEOUT_S=300
```

| Variable | Default | Description |
|---|---|---|
| `FORMSY_GATEWAY_URL` | `http://localhost:3001` | Gateway server URL for compile, query, and read endpoints |
| `FORMSY_API_KEY` | — | Bearer token for gateway authentication |
| `FORMSY_MEMORY_SEARCH_ENDPOINT` | `/api/v1/query` | Search endpoint path (must start with `/`) |
| `FORMSY_TIMEOUT_S` | `120` | Server-side query timeout budget (seconds). The plugin sends `query_timeout_s` and `fanout_timeout_s` hints to the gateway, computed as `min(timeoutS − 10, 90)`. Increase this if context searches on large repos time out on the server side. |
| `FORMSY_REQUEST_TIMEOUT_S` | `300` | Client-side HTTP request timeout (seconds). Applies to all gateway requests including compile, query, read, and compile/status. Increase this for large repos where compilation takes longer. |

Observability:

```bash
FORMSY_OBSERVABILITY_ENABLED=true
FORMSY_OBSERVABILITY_URL=http://127.0.0.1:8000
FORMSY_OBSERVABILITY_TASK_REPORT_ENDPOINT=/v1/observations/task_reports
FORMSY_OBSERVABILITY_SPOOL_DIR=~/.opencode/formsy-observability
FORMSY_OBSERVABILITY_API_KEY=...
```

If observability submission fails, reports are written as JSONL under the spool directory.


```bash
export FORMSY_GATEWAY_URL=http://localhost:8000
export FORMSY_API_KEY=fsy_test_key_dev_only_12345678
export FORMSY_MEMORY_SEARCH_ENDPOINT=/api/v1/query

export FORMSY_OBSERVABILITY_ENABLED=true
export FORMSY_OBSERVABILITY_URL=http://127.0.0.1:8000
export FORMSY_OBSERVABILITY_TASK_REPORT_ENDPOINT=/v1/observations/task_reports
export FORMSY_OBSERVABILITY_SPOOL_DIR=~/.opencode/formsy-observability
export FORMSY_OBSERVABILITY_API_KEY=fsy_test_key_dev_only_12345678
export FORMSY_OBSERVABILITY_TIMEOUT_MS=2000
```

## Tools

### `context_search`

Arguments:

- `query` required string
- `repo_id` optional string override
- `revision` optional string override
- `budget` optional positive integer, default `4000`
- `enable_profiling` optional boolean
- `profiling_top_n` optional positive integer
- `metadata` optional object
- `identity` optional object

Returns the upstream `extra_context` or `memory_block` text with metadata such as `repoId`, `revision`, and correlation IDs.

### `context_read`

Arguments:

- `path` required repository path
- `repo_id` optional string override
- `revision` optional string override
- `start_line` optional positive integer
- `end_line` optional positive integer
- `identity` optional object

Returns formatted source content with metadata such as `path`, `repoId`, `revision`, and correlation IDs.

### `formsy_compile_repo`

Arguments:

- `repo_id` optional string override
- `revision` optional string override
- `enable_w2` optional boolean
- `include` optional string array for path substring filtering

Defaults:

- `repo_id` prefers `git remote.origin.url`, then falls back to the local repo name
- `revision` prefers `git rev-parse HEAD`
- source scanning skips test files and common directories such as `node_modules`, `dist`, `build`, `.git`, `.claude`, `.worktrees`
- git worktree directories are dynamically detected and excluded to prevent duplicate compilation

## Build And Test

```bash
npm run build --workspace @formsy/plugin-opencode
npm run test --workspace @formsy/plugin-opencode
```
