# Formsy Plugin Monorepo

A Vercel-style monorepo for Formsy coding context compiler plugins and SDKs.

## Architecture

This monorepo follows the design principles outlined in `coding-context-cloud-architecture.md`:

- **Thin plugins** that collect local context and call cloud APIs
- **Provider adapters** for different LLM providers
- **Clean separation** between internal engine and external product APIs
- **First-class artifacts** with versioning and caching

## Packages

### Core Packages

- **`@formsy/sdk-core`** - Core TypeScript SDK with types and client
- **`@formsy/plugin-core`** - Shared plugin utilities (workspace collector, config, prompt injector)

### Plugins

- **`@formsy/plugin-claude-code`** - Claude Code integration plugin
- **`@formsy/plugin-opencode`** - OpenCode native plugin with a custom context compilation tool

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Build all packages
npm run build
```

### Development

```bash
# Watch mode for all packages
npm run dev
```

## Plugin Usage

### Claude Code Plugin

```typescript
import { ClaudeCodePlugin } from '@formsy/plugin-claude-code';

// Initialize plugin
const plugin = new ClaudeCodePlugin(process.cwd(), {
  apiKey: process.env.FORMSY_API_KEY,
  projectId: 'my-project',
  enabled: true,
  mode: 'auto-augment',
});

// Compile context for a bug fix
const result = await plugin.compileContext({
  problemStatement: 'Username validator allows trailing newlines',
  openFiles: ['src/validators.ts'],
  cursorFile: 'src/validators.ts',
  failingTests: ['tests/validators.test.ts::test_username_rejects_newline'],
});

console.log('Context ID:', result.contextId);
console.log('Estimated saved turns:', result.stats.estimatedSavedTurns);
console.log('Compiled context:', result.promptBundle);
```

### Slash Commands

The Claude Code plugin supports the following slash commands:

- `/ccc status` - Show plugin status
- `/ccc on` - Enable the plugin
- `/ccc off` - Disable the plugin
- `/ccc mode <suggest|auto-augment|gateway>` - Set operating mode
- `/ccc compile <problem>` - Compile context for a problem

## Configuration

Create a `.formsy.json` file in your project root:

```json
{
  "apiKey": "your-api-key",
  "projectId": "your-project-id",
  "enabled": true,
  "mode": "auto-augment",
  "maxContextTokens": 12000,
  "retentionPolicy": "standard"
}
```

Or use environment variables:

```bash
export FORMSY_API_KEY=your-api-key
export FORMSY_PROJECT_ID=your-project-id
export FORMSY_BASE_URL=https://api.formsy.ai
export FORMSY_ENABLED=true
```

## Operating Modes

### 1. Suggest Mode
Plugin compiles context and shows it to the user for manual injection.

### 2. Auto-Augment Mode (Default)
Plugin automatically augments agent messages with compiled context.

### 3. Gateway Mode
Plugin routes all requests through Formsy's managed gateway with context compilation and model routing.

## Architecture Highlights

### Workspace Collection
- Automatically detects git repository info
- Collects open files, changed files, and cursor position
- Respects `.gitignore` and size limits
- Filters out node_modules, build artifacts, etc.

### Context Injection
- Three injection modes: augment, replace, prepend
- Smart message merging
- Preserves conversation context

### Configuration Management
- Environment variables
- Config file (`.formsy.json`)
- Runtime overrides
- Sensible defaults

## Development

### Project Structure

```
formsy-plugin/
├── packages/
│   ├── sdk-core/           # Core SDK and types
│   ├── plugin-core/        # Shared plugin utilities
│   ├── plugin-claude-code/ # Claude Code plugin
│   └── plugin-opencode/    # OpenCode plugin
├── package.json           # Root package.json
├── turbo.json            # Turborepo config
└── tsconfig.json         # Base TypeScript config
```

### Adding a New Plugin

1. Create a new package in `packages/plugin-<name>/`
2. Add dependency on `@formsy/plugin-core`
3. Implement plugin-specific integration logic
4. Export plugin class and commands

### Building

```bash
# Build all packages
npm run build

# Build specific package
cd packages/plugin-claude-code
npm run build
```

## Next Steps

- [ ] Implement OpenClaw plugin
- [ ] Add Python SDK
- [ ] Add more provider adapters (OpenAI, OpenRouter, etc.)
- [ ] Add comprehensive tests
- [ ] Add documentation site

## License

See LICENSE file.
