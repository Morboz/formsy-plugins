# OpenCode Plugin

Formsy native plugin for OpenCode.

## What It Does

This package adds two OpenCode custom tools:

- `formsy_compile_repo` scans the current repository, skips test files, and forwards one file at a time to the gateway `/compile` endpoint
- `formsy_query_context` sends a natural-language task query to the gateway `/query` endpoint to retrieve repository context

The tools are thin wrappers around:

- `POST http://localhost:3001/v1/gateway/compile` by default
- `POST http://localhost:3001/v1/gateway/query` by default
- or the same paths under `$FORMSY_GATEWAY_URL` if you override the gateway URL

## Installation

```bash
npm install @formsy/plugin-opencode
```

## Configuration

The plugin reads one environment variable:

```bash
FORMSY_GATEWAY_URL=http://localhost:3001
```

## Build

```bash
npm run build --workspace @formsy/plugin-opencode
```

## Load In OpenCode

For an npm-installed plugin, add it to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@formsy/plugin-opencode"]
}
```

For local testing, you can also copy the built plugin into `.opencode/plugins/` and export `FormsyOpenCodePlugin`.

## Tools

### `formsy_compile_repo`

Arguments:

- `repo_id` optional string override
- `revision` optional string override
- `enable_w2` optional boolean
- `include` optional string array for path substring filtering

Defaults:

- `repo_id` prefers `git remote.origin.url`, then falls back to the local repo name
- `revision` prefers `git rev-parse HEAD`
- source scanning skips test files and common directories such as `node_modules`, `dist`, `build`, `.git`

Returns:

- compile summary including `repoId`, `revision`, compiled file paths, skipped file paths, failures, and raw upstream response

Example usage inside OpenCode:

```txt
Use the formsy_compile_repo tool with:
enable_w2: true
```

### `formsy_query_context`

Arguments:

- `query` required string
- `repo_id` optional string override
- `revision` optional string override
- `budget` optional positive integer
- `metadata` optional object

Returns:

- query metadata plus the raw upstream `/query` response

Example usage inside OpenCode:

```txt
Use the formsy_query_context tool with:
query: "Find the modules responsible for authentication and request routing"
budget: 4000
```
