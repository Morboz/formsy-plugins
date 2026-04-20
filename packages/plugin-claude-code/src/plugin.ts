import { FormsyClient } from '@formsy/sdk-core';
import type { ContextCompileRequest, TaskMetadata } from '@formsy/sdk-core';
import {
  ConfigLoader,
  WorkspaceCollector,
  RepoDetector,
  PromptInjector,
} from '@formsy/plugin-core';
import type { PluginConfig } from '@formsy/plugin-core';

/**
 * Claude Code Plugin for Formsy
 *
 * Integrates Formsy's context compilation into Claude Code workflows
 */
export class ClaudeCodePlugin {
  private client: FormsyClient;
  private config: PluginConfig;
  private workspaceCollector: WorkspaceCollector;
  private repoDetector: RepoDetector;
  private promptInjector: PromptInjector;
  private rootDir: string;

  constructor(rootDir: string, config?: Partial<PluginConfig>) {
    this.rootDir = rootDir;
    this.config = ConfigLoader.load(config);

    if (!this.config.apiKey) {
      throw new Error(
        'Formsy API key not found. Set FORMSY_API_KEY environment variable or configure in .formsy.json'
      );
    }

    this.client = new FormsyClient({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      projectId: this.config.projectId,
    });

    this.workspaceCollector = new WorkspaceCollector({ rootDir });
    this.repoDetector = new RepoDetector(rootDir);
    this.promptInjector = new PromptInjector();
  }

  /**
   * Compile context for the current task
   */
  async compileContext(options: {
    problemStatement: string;
    openFiles?: string[];
    changedFiles?: string[];
    cursorFile?: string;
    hints?: string;
    failingTests?: string[];
    passingTests?: string[];
    stackTrace?: string;
  }): Promise<{
    contextId: string;
    promptBundle: string;
    stats: {
      estimatedSavedTurns: number;
      estimatedPromptTokens: number;
      compileMs: number;
    };
  }> {
    if (!this.config.enabled) {
      throw new Error('Formsy plugin is disabled');
    }

    // Detect repository
    const repo = this.repoDetector.detect();
    if (!repo) {
      throw new Error('Could not detect repository information');
    }

    // Collect workspace context
    const workspace = await this.workspaceCollector.collect({
      openFiles: options.openFiles,
      includeChanged: true,
      cursorFile: options.cursorFile,
    });

    // Build task metadata
    const task: TaskMetadata = {
      type: 'bugfix',
      problem_statement: options.problemStatement,
      hints: options.hints,
      failing_tests: options.failingTests,
      passing_tests: options.passingTests,
      stack_trace: options.stackTrace,
    };

    // Compile context
    const request: ContextCompileRequest = {
      project_id: this.config.projectId || 'default',
      repo,
      task,
      workspace,
      options: {
        max_context_tokens: this.config.maxContextTokens,
        include_patch_plan: true,
        include_raw_snippets: true,
        latency_tier: 'interactive',
      },
    };

    const response = await this.client.compileContext(request);

    // Format prompt bundle for display
    const promptBundle = this.promptInjector.formatForDisplay(
      response.prompt_bundle
    );

    return {
      contextId: response.context_id,
      promptBundle,
      stats: {
        estimatedSavedTurns: response.stats.estimated_saved_turns,
        estimatedPromptTokens: response.stats.estimated_prompt_tokens,
        compileMs: response.stats.compile_ms,
      },
    };
  }

  /**
   * Get plugin status
   */
  getStatus(): {
    enabled: boolean;
    mode: string;
    projectId?: string;
    hasApiKey: boolean;
  } {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      projectId: this.config.projectId,
      hasApiKey: !!this.config.apiKey,
    };
  }

  /**
   * Enable the plugin
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable the plugin
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Set operating mode
   */
  setMode(mode: 'suggest' | 'auto-augment' | 'gateway'): void {
    this.config.mode = mode;
  }
}
