import { tool, type Plugin } from '@opencode-ai/plugin';
import { OpenCodeRuntime } from './runtime.js';

export const FormsyOpenCodePlugin: Plugin = async ({ directory, client }) => {
  const runtime = new OpenCodeRuntime();

  await client.app.log({
    body: {
      service: 'formsy-opencode-plugin',
      level: 'info',
      message: 'Initialized Formsy OpenCode plugin',
      extra: {
        directory,
        gatewayUrl: process.env.FORMSY_GATEWAY_URL || 'http://localhost:3001',
      },
    },
  });

  return {
    tool: {
      formsy_generate_patch: tool({
        description: 'Generate a SWE-bench patch via the Formsy gateway /patch endpoint',
        args: {
          type: tool.schema.literal('swebench'),
          case_id: tool.schema.string(),
          stop_after: tool.schema.string().optional(),
          enable_w2: tool.schema.boolean().optional(),
          budget: tool.schema
            .object({
              max_tokens: tool.schema.number().int().optional(),
              max_time_seconds: tool.schema.number().int().optional(),
            })
            .optional(),
        },
        async execute(args) {
          if (!args.case_id.trim()) {
            throw new Error('case_id is required');
          }

          const result = await runtime.generatePatch({
            type: args.type,
            case_id: args.case_id,
            stop_after: args.stop_after,
            enable_w2: args.enable_w2,
            budget: args.budget,
          });

          return {
            output: JSON.stringify(result.data, null, 2),
            metadata: {
              upstreamUrl: result.upstreamUrl,
              status: result.status,
              response: result.data,
            },
          };
        },
      }),
    },
  };
};

export default FormsyOpenCodePlugin;
