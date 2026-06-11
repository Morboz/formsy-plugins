# @formsy/plugin-opencode

Formsy native plugin for [OpenCode](https://opencode.ai).

## What It Does

- `context_search` — queries the Formsy repository context index
- `context_read` — reads indexed source content by path
- Formsy observability lifecycle hooks (task-level counters, hashed file paths, correlation IDs — no prompts, source, diffs, or shell output)

## Install

One command installs both the plugin and the `formsy-context` skill:

```bash
mkdir -p ~/.config/opencode/plugins ~/.config/opencode/skills && \
  curl -fsSL https://github.com/Morboz/formsy-plugins/releases/latest/download/plugin-opencode.js \
    -o ~/.config/opencode/plugins/plugin-opencode.js && \
  curl -fsSL https://github.com/Morboz/formsy-plugins/releases/latest/download/skills-formsy-context.tar.gz | \
    tar -xzf - -C ~/.config/opencode/skills
```

That's it. OpenCode automatically loads files in `~/.config/opencode/plugins/` and `~/.config/opencode/skills/` on startup.

## Configuration

```bash
export FORMSY_GATEWAY_URL=http://localhost:8000
export FORMSY_API_KEY=fsy_test_key_dev_only_12345678
export FORMSY_MEMORY_SEARCH_ENDPOINT=/api/v1/query
export FORMSY_REQUEST_TIMEOUT_S=300

export FORMSY_OBSERVABILITY_ENABLED=true
export FORMSY_OBSERVABILITY_URL=http://127.0.0.1:8000
export FORMSY_OBSERVABILITY_TASK_REPORT_ENDPOINT=/v1/observations/task_reports
export FORMSY_OBSERVABILITY_SPOOL_DIR=~/.opencode/formsy-observability
export FORMSY_OBSERVABILITY_API_KEY=fsy_test_key_dev_only_12345678
export FORMSY_OBSERVABILITY_TIMEOUT_MS=2000
```

## Tools

### `context_search`

- `query` required string
- `repo_id` optional string override
- `revision` optional string override
- `budget` optional positive integer, default `4000`
- `enable_profiling` optional boolean
- `profiling_top_n` optional positive integer
- `metadata` optional object
- `identity` optional object

### `context_read`

- `path` required repository path
- `repo_id` optional string override
- `revision` optional string override
- `start_line` optional positive integer
- `end_line` optional positive integer
- `identity` optional object

## Build & Test

```bash
npm run build --workspace @formsy/plugin-opencode
npm run test --workspace @formsy/plugin-opencode
```

## Release

Push a tag to trigger CI:

```bash
git tag plugin-opencode@0.2.0
git push origin plugin-opencode@0.2.0
```
