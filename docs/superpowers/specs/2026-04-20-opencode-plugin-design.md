# OpenCode Plugin Design

## Goal

Create a minimal viable OpenCode native plugin for Formsy that can be loaded by OpenCode and manually invoked to compile coding context through the existing Formsy cloud API.

The first release will prove the end-to-end path:

- OpenCode loads the plugin
- the plugin exposes one custom tool
- the tool reuses existing Formsy workspace and API logic
- the tool returns a compiled prompt bundle and stats

## Scope

### In Scope

- Add a new package at `packages/plugin-opencode`
- Implement an OpenCode native plugin entrypoint
- Register a custom tool named `formsy_compile_context`
- Reuse `@formsy/plugin-core` and `@formsy/sdk-core`
- Support the existing Formsy config and environment variable flow
- Document how to build and load the plugin in OpenCode

### Out of Scope

- Automatic prompt augmentation
- Session hooks beyond what is required for plugin initialization
- Permission interception
- Auth UX beyond existing API key configuration
- Runtime model routing or gateway behavior

## Recommended Approach

### Option 1: Custom tool plugin

Expose one OpenCode custom tool that accepts task input, compiles Formsy context, and returns structured output.

Pros:

- Smallest useful feature
- Easy to validate in OpenCode
- Clear mapping from existing `ClaudeCodePlugin.compileContext()` behavior
- Leaves room for future automatic augmentation

Cons:

- User must invoke the tool manually

### Option 2: Prompt hook plugin

Attach to prompt lifecycle hooks and inject compiled context automatically.

Pros:

- Better UX once stable

Cons:

- Harder to control and debug
- Higher regression risk in a first release

### Option 3: Skeleton-only plugin

Only prove plugin loading without Formsy compilation.

Pros:

- Lowest build risk

Cons:

- Too little product value

### Chosen Approach

Use Option 1.

## Architecture

### Package layout

Create `packages/plugin-opencode` with:

- `src/index.ts` for public exports
- `src/plugin.ts` for the OpenCode plugin factory
- `README.md` for installation and usage
- `package.json` and `tsconfig.json` matching the monorepo pattern

### Runtime flow

1. OpenCode loads the plugin entrypoint.
2. The plugin initializes using the current project directory from OpenCode context.
3. The plugin registers a custom tool `formsy_compile_context`.
4. The tool validates input and constructs the same compile request shape already used by the Claude Code package.
5. Shared utilities detect repo metadata, collect workspace context, and call the Formsy API.
6. The tool returns structured data including:
   - `contextId`
   - `promptBundle`
   - `stats`

### Shared code reuse

The OpenCode plugin should reuse:

- `ConfigLoader` from `@formsy/plugin-core`
- `WorkspaceCollector` from `@formsy/plugin-core`
- `RepoDetector` from `@formsy/plugin-core`
- `PromptInjector` from `@formsy/plugin-core`
- `FormsyClient` and shared request types from `@formsy/sdk-core`

The first implementation should avoid refactoring shared packages unless OpenCode integration exposes a genuine mismatch.

## Tool Contract

### Tool name

`formsy_compile_context`

### Input

- `problemStatement` required string
- `openFiles` optional string array
- `changedFiles` optional string array
- `cursorFile` optional string
- `hints` optional string
- `failingTests` optional string array
- `passingTests` optional string array
- `stackTrace` optional string

### Output

- `contextId` string
- `promptBundle` string
- `stats.estimatedSavedTurns` number
- `stats.estimatedPromptTokens` number
- `stats.compileMs` number

### Error handling

Return clear errors for:

- missing API key or invalid configuration
- repository detection failure
- disabled plugin state
- upstream API failures

The first release should prefer direct, actionable error messages over abstraction.

## Configuration

The plugin should use the same Formsy configuration behavior already established in shared code:

- `.formsy.json`
- `FORMSY_API_KEY`
- `FORMSY_PROJECT_ID`
- `FORMSY_BASE_URL`
- `FORMSY_ENABLED`

No OpenCode-specific config file is required for the first release beyond standard plugin loading.

## Testing

The first release should validate:

- TypeScript package builds successfully
- exported plugin entrypoint has the expected shape
- tool registration code compiles cleanly

If practical with low effort, add a focused unit test for input-to-output wiring. If test infrastructure cost is disproportionate, rely on build verification for the first slice and add runtime examples in the README.

## Documentation

Document:

- package purpose
- build command
- local loading in OpenCode
- npm-style loading target for future publishing
- example tool invocation
- required environment variables

## Risks

### OpenCode API mismatch

Risk: the exact plugin typing or tool helper shape may differ from assumptions.

Mitigation: align implementation to the current OpenCode plugin documentation and keep the adapter layer thin.

### Over-coupling to Claude Code package

Risk: copying Claude Code assumptions into OpenCode-specific behavior.

Mitigation: only reuse shared core utilities, not Claude-specific command abstractions.

### Incomplete validation path

Risk: build passes but runtime loading still fails.

Mitigation: document a concrete local OpenCode loading path and keep exported surface minimal.
