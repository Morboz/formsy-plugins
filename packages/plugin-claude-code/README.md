# Claude Code Plugin

Formsy plugin for Claude Code integration.

## Installation

```bash
npm install @formsy/plugin-claude-code
```

## Quick Start

```typescript
import { ClaudeCodePlugin } from '@formsy/plugin-claude-code';

const plugin = new ClaudeCodePlugin(process.cwd(), {
  apiKey: process.env.FORMSY_API_KEY,
  projectId: 'my-project',
});

const result = await plugin.compileContext({
  problemStatement: 'Fix the bug in validators.ts',
  openFiles: ['src/validators.ts'],
  cursorFile: 'src/validators.ts',
});

console.log(result.promptBundle);
```

## Configuration

### Environment Variables

```bash
FORMSY_API_KEY=your-api-key
FORMSY_PROJECT_ID=your-project-id
FORMSY_BASE_URL=https://api.formsy.ai
FORMSY_ENABLED=true
```

### Config File

Create `.formsy.json` in your project root:

```json
{
  "apiKey": "your-api-key",
  "projectId": "your-project-id",
  "enabled": true,
  "mode": "auto-augment",
  "maxContextTokens": 12000
}
```

## Slash Commands

- `/ccc status` - Show plugin status
- `/ccc on` - Enable plugin
- `/ccc off` - Disable plugin
- `/ccc mode <mode>` - Set mode (suggest, auto-augment, gateway)
- `/ccc compile <problem>` - Compile context

## Operating Modes

### Suggest Mode
Shows compiled context to user for manual review.

### Auto-Augment Mode (Default)
Automatically injects context into agent messages.

### Gateway Mode
Routes requests through Formsy's managed gateway.

## API

### ClaudeCodePlugin

```typescript
class ClaudeCodePlugin {
  constructor(rootDir: string, config?: Partial<PluginConfig>);

  compileContext(options: CompileOptions): Promise<CompileResult>;
  getStatus(): PluginStatus;
  enable(): void;
  disable(): void;
  setMode(mode: 'suggest' | 'auto-augment' | 'gateway'): void;
}
```

### CommandHandler

```typescript
class CommandHandler {
  constructor(context: CommandContext);

  execute(command: string, args: string[]): Promise<string>;
}
```

## Examples

See `examples/` directory for complete examples:

- `basic-usage.ts` - Basic plugin usage
- `commands.ts` - Slash commands usage

## License

See LICENSE file.
