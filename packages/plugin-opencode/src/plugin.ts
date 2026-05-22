import { tool, type Plugin } from '@opencode-ai/plugin';
import { FormsyObservationReporter } from './observability.js';
import { OpenCodeRuntime } from './runtime.js';

const PLUGIN_MARKER = 'formsy-opencode-plugin@context-v2';

export const FormsyOpenCodePlugin: Plugin = async ({ directory, client }) => {
  const runtime = new OpenCodeRuntime();
  const observability = new FormsyObservationReporter({
    sourceName: 'opencode',
    repoId: process.env.FORMSY_REPO_ID || directory,
  });

  console.log(`[${PLUGIN_MARKER}] initialized for directory=${directory}`);

  await client.app.log({
    body: {
      service: 'formsy-opencode-plugin',
      level: 'info',
      message: `Initialized ${PLUGIN_MARKER}`,
      extra: {
        directory,
        gatewayUrl: process.env.FORMSY_GATEWAY_URL || 'http://localhost:3001',
        compilePath: '/api/v1/compile',
        searchPath: process.env.FORMSY_MEMORY_SEARCH_ENDPOINT || '/api/v1/query',
        readPath: '/api/v1/read',
        marker: PLUGIN_MARKER,
      },
    },
  });

  return {
    async 'chat.message'(input, output) {
      observability.onChatMessage({
        sessionID: input.sessionID,
        model: modelName(input.model),
        messageText: textFromParts(output.parts),
      });
    },
    async 'chat.params'(input) {
      observability.onModelRequest({
        sessionID: input.sessionID,
        model: modelName(input.model),
      });
    },
    async 'tool.execute.before'(input, output) {
      observability.onToolExecuteBefore({
        sessionID: input.sessionID,
        tool: input.tool,
        args: objectArgs(output.args),
      });
    },
    async 'tool.execute.after'(input, output) {
      observability.onToolExecuteAfter({
        sessionID: input.sessionID,
        tool: input.tool,
        args: objectArgs(input.args),
        output: {
          metadata: output.metadata,
          output: output.output,
        },
      });
      await observability.flush(input.sessionID, 'partial', 'running');
    },
    tool: {
      formsy_compile_repo: tool({
        description:
          'Scan the current repository source files, skip tests, and compile each file via the Formsy /api/v1/compile endpoint for context_search/context_read',
        args: {
          repo_id: tool.schema.string().optional(),
          revision: tool.schema.string().optional(),
          enable_w2: tool.schema.boolean().optional(),
          include: tool.schema.array(tool.schema.string()).optional(),
        },
        async execute(args, context) {
          const result = await runtime.compileRepository({
            directory: context.directory,
            repo_id: args.repo_id,
            revision: args.revision,
            enable_w2: args.enable_w2,
            include: args.include,
          });

          await client.app.log({
            body: {
              service: 'formsy-opencode-plugin',
              level: 'info',
              message: `${PLUGIN_MARKER} executing formsy_compile_repo`,
              extra: {
                repo_id: result.repoId,
                revision: result.revision,
                compiledFiles: result.compiledFiles.length,
                failures: result.failures.length,
              },
            },
          });

          return {
            output: JSON.stringify(
              {
                marker: PLUGIN_MARKER,
                upstreamUrl: result.upstreamUrl,
                status: result.status,
                repoId: result.repoId,
                revision: result.revision,
                compiledFiles: result.compiledFiles,
                skippedFiles: result.skippedFiles,
                failures: result.failures,
                data: result.data,
              },
              null,
              2
            ),
            metadata: {
              marker: PLUGIN_MARKER,
              endpoint: '/api/v1/compile',
              repoId: result.repoId,
              revision: result.revision,
              compiledFiles: result.compiledFiles.length,
              failures: result.failures.length,
            },
          };
        },
      }),
      context_search: tool({
        description:
          'Search Formsy repository context for task-relevant code, symbols, tests, and prior observations',
        args: {
          query: tool.schema.string(),
          repo_id: tool.schema.string().optional(),
          revision: tool.schema.string().optional(),
          budget: tool.schema.number().int().positive().optional(),
          enable_profiling: tool.schema.boolean().optional(),
          profiling_top_n: tool.schema.number().int().positive().optional(),
          metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
          identity: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
        },
        async execute(args, context) {
          const result = await runtime.contextSearch({
            directory: context.directory,
            query: args.query,
            repo_id: args.repo_id,
            revision: args.revision,
            session_id: context.sessionID,
            budget: args.budget,
            enable_profiling: args.enable_profiling,
            profiling_top_n: args.profiling_top_n,
            metadata: args.metadata,
            identity: args.identity,
          });

          await client.app.log({
            body: {
              service: 'formsy-opencode-plugin',
              level: 'info',
              message: `${PLUGIN_MARKER} executing context_search`,
              extra: {
                repo_id: result.metadata.repoId,
                revision: result.metadata.revision,
                budget: args.budget,
                endpoint: result.metadata.endpoint,
              },
            },
          });

          return result;
        },
      }),
      context_read: tool({
        description:
          'Read source content from the Formsy repository context store by path and optional line range',
        args: {
          path: tool.schema.string(),
          repo_id: tool.schema.string().optional(),
          revision: tool.schema.string().optional(),
          start_line: tool.schema.number().int().positive().optional(),
          end_line: tool.schema.number().int().positive().optional(),
          identity: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
        },
        async execute(args, context) {
          const result = await runtime.contextRead({
            directory: context.directory,
            path: args.path,
            repo_id: args.repo_id,
            revision: args.revision,
            session_id: context.sessionID,
            start_line: args.start_line,
            end_line: args.end_line,
            identity: args.identity,
          });

          await client.app.log({
            body: {
              service: 'formsy-opencode-plugin',
              level: 'info',
              message: `${PLUGIN_MARKER} executing context_read`,
              extra: {
                repo_id: result.metadata.repoId,
                revision: result.metadata.revision,
                path: result.metadata.path,
                endpoint: result.metadata.endpoint,
              },
            },
          });

          return result;
        },
      }),
    },
  };
};

export default FormsyOpenCodePlugin;

function objectArgs(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function textFromParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .map((part) => {
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function modelName(model: unknown): string {
  if (typeof model === 'string') return model;
  if (typeof model !== 'object' || model === null) return '';
  const record = model as Record<string, unknown>;
  const provider = typeof record.providerID === 'string' ? record.providerID : '';
  const modelId =
    typeof record.modelID === 'string'
      ? record.modelID
      : typeof record.id === 'string'
        ? record.id
        : '';
  return [provider, modelId].filter(Boolean).join('/');
}
