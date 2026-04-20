# OpenCode Plugin

Formsy native plugin for OpenCode.

## What It Does

This package adds one OpenCode custom tool, `formsy_generate_patch`, that forwards a request to the gateway service `/patch` endpoint.

The tool is a thin wrapper around:

- `POST http://localhost:3001/v1/gateway/patch` by default
- or `POST $FORMSY_GATEWAY_URL/v1/gateway/patch` if you override the gateway URL

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

## Tool

### `formsy_generate_patch`

Arguments:

- `type` required literal `swebench`
- `case_id` required string
- `stop_after` optional string
- `enable_w2` optional boolean
- `budget` optional object
  - `max_tokens` optional integer
  - `max_time_seconds` optional integer

Returns:

- response body from the gateway `/patch` endpoint
- metadata with `upstreamUrl`, `status`, and raw response

Example usage inside OpenCode:

```txt
Use the formsy_generate_patch tool with:
type: "swebench"
case_id: "django__django-14999"
enable_w2: true
budget:
  max_tokens: 20000
  max_time_seconds: 900
```
