# OpenCode Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal OpenCode native Formsy plugin that registers a `formsy_compile_context` custom tool and reuses the existing shared SDK and plugin utilities.

**Architecture:** Add a new monorepo package `packages/plugin-opencode` that exports an OpenCode plugin factory. The plugin will instantiate a small runtime wrapper around shared Formsy utilities and expose a single custom tool for manual context compilation. Documentation will show how to build and load the plugin in OpenCode.

**Tech Stack:** TypeScript, workspace packages, OpenCode plugin API, Turborepo

---

### Task 1: Create package skeleton

**Files:**
- Create: `packages/plugin-opencode/package.json`
- Create: `packages/plugin-opencode/tsconfig.json`
- Create: `packages/plugin-opencode/src/index.ts`
- Create: `packages/plugin-opencode/README.md`

- [ ] **Step 1: Write the failing build expectation**

Expected package shape:

```json
{
  "name": "@formsy/plugin-opencode",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

The package must depend on:

```json
{
  "@formsy/sdk-core": "workspace:*",
  "@formsy/plugin-core": "workspace:*"
}
```

- [ ] **Step 2: Add the package files**

`packages/plugin-opencode/package.json`

```json
{
  "name": "@formsy/plugin-opencode",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@formsy/sdk-core": "workspace:*",
    "@formsy/plugin-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

`packages/plugin-opencode/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../sdk-core" },
    { "path": "../plugin-core" }
  ]
}
```

`packages/plugin-opencode/src/index.ts`

```ts
export * from './plugin.js';
```

`packages/plugin-opencode/README.md`

Document package purpose, configuration, build, and OpenCode loading.

- [ ] **Step 3: Run package build to verify it fails for missing plugin implementation**

Run: `npm run build --workspace @formsy/plugin-opencode`

Expected: FAIL with a TypeScript module resolution error for `./plugin.js`

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-opencode/package.json packages/plugin-opencode/tsconfig.json packages/plugin-opencode/src/index.ts packages/plugin-opencode/README.md
git commit -m "chore: scaffold opencode plugin package"
```

### Task 2: Implement the OpenCode runtime wrapper

**Files:**
- Create: `packages/plugin-opencode/src/runtime.ts`
- Test: package build output from `packages/plugin-opencode`

- [ ] **Step 1: Write the failing test expectation**

The runtime wrapper must expose one method:

```ts
compileContext(options: {
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
}>
```

- [ ] **Step 2: Add the runtime implementation**

`packages/plugin-opencode/src/runtime.ts`

```ts
import { FormsyClient } from '@formsy/sdk-core';
import type { ContextCompileRequest, TaskMetadata } from '@formsy/sdk-core';
import {
  ConfigLoader,
  WorkspaceCollector,
  RepoDetector,
  PromptInjector,
} from '@formsy/plugin-core';
import type { PluginConfig } from '@formsy/plugin-core';

export interface CompileContextOptions {
  problemStatement: string;
  openFiles?: string[];
  changedFiles?: string[];
  cursorFile?: string;
  hints?: string;
  failingTests?: string[];
  passingTests?: string[];
  stackTrace?: string;
}

export interface CompileContextResult {
  contextId: string;
  promptBundle: string;
  stats: {
    estimatedSavedTurns: number;
    estimatedPromptTokens: number;
    compileMs: number;
  };
}

export class OpenCodeRuntime {
  private client: FormsyClient;
  private config: PluginConfig;
  private workspaceCollector: WorkspaceCollector;
  private repoDetector: RepoDetector;
  private promptInjector: PromptInjector;

  constructor(
    private rootDir: string,
    config?: Partial<PluginConfig>
  ) {
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

  async compileContext(
    options: CompileContextOptions
  ): Promise<CompileContextResult> {
    if (!this.config.enabled) {
      throw new Error('Formsy plugin is disabled');
    }

    const repo = this.repoDetector.detect();
    if (!repo) {
      throw new Error('Could not detect repository information');
    }

    const workspace = await this.workspaceCollector.collect({
      openFiles: options.openFiles,
      includeChanged: true,
      cursorFile: options.cursorFile,
    });

    const task: TaskMetadata = {
      type: 'bugfix',
      problem_statement: options.problemStatement,
      hints: options.hints,
      failing_tests: options.failingTests,
      passing_tests: options.passingTests,
      stack_trace: options.stackTrace,
    };

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

    return {
      contextId: response.context_id,
      promptBundle: this.promptInjector.formatForDisplay(response.prompt_bundle),
      stats: {
        estimatedSavedTurns: response.stats.estimated_saved_turns,
        estimatedPromptTokens: response.stats.estimated_prompt_tokens,
        compileMs: response.stats.compile_ms,
      },
    };
  }
}
```

- [ ] **Step 3: Run package build to verify it fails for missing plugin entrypoint**

Run: `npm run build --workspace @formsy/plugin-opencode`

Expected: FAIL with a TypeScript module resolution error because `src/plugin.ts` does not exist yet

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-opencode/src/runtime.ts
git commit -m "feat: add opencode runtime wrapper"
```

### Task 3: Implement the OpenCode plugin entrypoint

**Files:**
- Create: `packages/plugin-opencode/src/plugin.ts`
- Modify: `packages/plugin-opencode/src/index.ts`

- [ ] **Step 1: Write the failing build expectation**

The plugin entrypoint must:

- export a plugin factory
- register a custom tool named `formsy_compile_context`
- validate `problemStatement`
- call `OpenCodeRuntime.compileContext()`

- [ ] **Step 2: Add the plugin implementation**

`packages/plugin-opencode/src/plugin.ts`

Implement a thin OpenCode adapter using the documented plugin and tool API shape, with:

- `problemStatement` as required input
- all optional fields passed through unchanged
- structured JSON result from runtime

Also update `packages/plugin-opencode/src/index.ts` to export `runtime.js` if useful.

- [ ] **Step 3: Run package build to verify it passes**

Run: `npm run build --workspace @formsy/plugin-opencode`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-opencode/src/plugin.ts packages/plugin-opencode/src/index.ts
git commit -m "feat: add opencode plugin entrypoint"
```

### Task 4: Document usage and monorepo integration

**Files:**
- Modify: `packages/plugin-opencode/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write the documentation requirements**

The docs must include:

- what the package does
- how to build it
- how to add it to OpenCode
- environment variables
- example tool invocation

- [ ] **Step 2: Update the docs**

`packages/plugin-opencode/README.md`

Add a minimal usage guide with an example OpenCode plugin config entry.

`README.md`

Add `@formsy/plugin-opencode` to the package list and development structure.

- [ ] **Step 3: Run targeted verification**

Run: `npm run build --workspace @formsy/plugin-opencode`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-opencode/README.md README.md
git commit -m "docs: add opencode plugin usage"
```

### Task 5: Final verification

**Files:**
- Verify: `packages/plugin-opencode/**/*`
- Verify: `README.md`

- [ ] **Step 1: Run the package build**

Run: `npm run build --workspace @formsy/plugin-opencode`

Expected: PASS

- [ ] **Step 2: Run the full monorepo build if dependencies are installed**

Run: `npm run build`

Expected: PASS

- [ ] **Step 3: Review generated outputs**

Confirm:

- `packages/plugin-opencode/dist/` is created
- Type declarations are emitted
- no TypeScript errors remain

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-opencode README.md
git commit -m "feat: add minimal opencode plugin"
```
