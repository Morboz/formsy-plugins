import { tool, type Plugin } from '@opencode-ai/plugin';
import { OpenCodeRuntime } from './runtime.js';

const PLUGIN_MARKER = 'formsy-opencode-plugin@patch-v2';

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
        patchPath: '/v1/gateway/patch',
        marker: PLUGIN_MARKER,
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

          console.log(`[${PLUGIN_MARKER}] formsy_generate_patch case_id=${args.case_id}`);

          await client.app.log({
            body: {
              service: 'formsy-opencode-plugin',
              level: 'info',
              message: `${PLUGIN_MARKER} executing formsy_generate_patch`,
              extra: {
                case_id: args.case_id,
                type: args.type,
              },
            },
          });

          const result = await runtime.generatePatch({
            type: args.type,
            case_id: args.case_id,
            stop_after: args.stop_after,
            enable_w2: args.enable_w2,
            budget: args.budget,
          });

          return [
            `[${PLUGIN_MARKER}]`,
            `upstreamUrl: ${result.upstreamUrl}`,
            `status: ${result.status}`,
            '',
            JSON.stringify(result.data, null, 2),
          ].join('\n');
        },
      }),
    },
  };
};

export default FormsyOpenCodePlugin;
