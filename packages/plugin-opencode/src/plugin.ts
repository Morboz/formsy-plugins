import { tool, type Plugin } from '@opencode-ai/plugin';
import { OpenCodeRuntime } from './runtime.js';

const PLUGIN_MARKER = 'formsy-opencode-plugin@compile-query-v1';

export const FormsyOpenCodePlugin: Plugin = async ({ directory, client }) => {
  const runtime = new OpenCodeRuntime();

  console.log(`[${PLUGIN_MARKER}] initialized for directory=${directory}`);

  await client.app.log({
    body: {
      service: 'formsy-opencode-plugin',
      level: 'info',
      message: `Initialized ${PLUGIN_MARKER}`,
      extra: {
        directory,
        gatewayUrl: process.env.FORMSY_GATEWAY_URL || 'http://localhost:3001',
        compilePath: '/v1/gateway/compile',
        queryPath: '/v1/gateway/query',
        marker: PLUGIN_MARKER,
      },
    },
  });

  return {
    tool: {
      formsy_compile_repo: tool({
        description:
          'Scan the current repository source files, skip tests, and compile each file via the Formsy gateway /compile endpoint',
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

          return JSON.stringify(
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
          );
        },
      }),
      formsy_query_context: tool({
        description:
          'Query the repository semantic index via the Formsy gateway /query endpoint for task-relevant context',
        args: {
          query: tool.schema.string(),
          repo_id: tool.schema.string().optional(),
          revision: tool.schema.string().optional(),
          budget: tool.schema.number().int().positive().optional(),
          metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
        },
        async execute(args, context) {
          if (!args.query.trim()) {
            throw new Error('query is required');
          }

          const result = await runtime.queryRepository({
            directory: context.directory,
            query: args.query,
            repo_id: args.repo_id,
            revision: args.revision,
            budget: args.budget,
            metadata: args.metadata,
          });

          await client.app.log({
            body: {
              service: 'formsy-opencode-plugin',
              level: 'info',
              message: `${PLUGIN_MARKER} executing formsy_query_context`,
              extra: {
                repo_id: result.repoId,
                revision: result.revision,
                budget: args.budget,
              },
            },
          });

          if (
            typeof result.data === 'object' &&
            result.data !== null &&
            'extra_context' in result.data &&
            typeof result.data.extra_context === 'string'
          ) {
            return result.data.extra_context;
          }

          return JSON.stringify(result.data, null, 2);
        },
      }),
    },
  };
};

export default FormsyOpenCodePlugin;
