/**
 * Slash commands for Claude Code integration
 */

import { ClaudeCodePlugin } from './plugin.js';

export interface CommandContext {
  rootDir: string;
  currentFile?: string;
  openFiles?: string[];
}

/**
 * Command handler for /ccc commands
 */
export class CommandHandler {
  private plugin: ClaudeCodePlugin;

  constructor(context: CommandContext) {
    this.plugin = new ClaudeCodePlugin(context.rootDir);
  }

  /**
   * Handle /ccc status command
   */
  async handleStatus(): Promise<string> {
    const status = this.plugin.getStatus();

    return `
Formsy Plugin Status:
- Enabled: ${status.enabled ? '✓' : '✗'}
- Mode: ${status.mode}
- Project ID: ${status.projectId || 'not set'}
- API Key: ${status.hasApiKey ? 'configured' : 'missing'}
    `.trim();
  }

  /**
   * Handle /ccc on command
   */
  async handleOn(): Promise<string> {
    this.plugin.enable();
    return 'Formsy plugin enabled ✓';
  }

  /**
   * Handle /ccc off command
   */
  async handleOff(): Promise<string> {
    this.plugin.disable();
    return 'Formsy plugin disabled';
  }

  /**
   * Handle /ccc compile command
   */
  async handleCompile(options: {
    problemStatement: string;
    openFiles?: string[];
    cursorFile?: string;
  }): Promise<string> {
    try {
      const result = await this.plugin.compileContext(options);

      return `
Context compiled successfully!

Context ID: ${result.contextId}
Estimated saved turns: ${result.stats.estimatedSavedTurns}
Estimated tokens: ${result.stats.estimatedPromptTokens}
Compile time: ${result.stats.compileMs}ms

---

${result.promptBundle}
      `.trim();
    } catch (error) {
      return `Failed to compile context: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Handle /ccc mode command
   */
  async handleMode(mode: string): Promise<string> {
    const validModes = ['suggest', 'auto-augment', 'gateway'];

    if (!validModes.includes(mode)) {
      return `Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`;
    }

    this.plugin.setMode(mode as any);
    return `Mode set to: ${mode}`;
  }

  /**
   * Parse and execute command
   */
  async execute(command: string, args: string[]): Promise<string> {
    switch (command) {
      case 'status':
        return this.handleStatus();
      case 'on':
        return this.handleOn();
      case 'off':
        return this.handleOff();
      case 'mode':
        return this.handleMode(args[0] || '');
      case 'compile':
        return this.handleCompile({
          problemStatement: args.join(' '),
        });
      default:
        return `Unknown command: ${command}. Available: status, on, off, mode, compile`;
    }
  }
}
