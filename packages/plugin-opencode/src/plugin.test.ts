import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FormsyOpenCodePlugin } from './plugin.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('plugin exposes current Formsy tools without legacy query tool', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-plugin-'));
  try {
    const hooks = await FormsyOpenCodePlugin({
      directory,
      worktree: directory,
      project: {} as never,
      client: { app: { log: async () => undefined } } as never,
      experimental_workspace: { register: () => undefined },
      serverUrl: new URL('http://opencode.test'),
      $: {} as never,
    });

    assert.deepEqual(Object.keys(hooks.tool ?? {}).sort(), [
      'context_read',
      'context_search',
      'formsy_compile_repo',
    ]);
    assert.equal(hooks.tool?.formsy_query_context, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('context_search tool delegates to runtime and returns tool metadata', async () => {
  const originalFetch = globalThis.fetch;
  process.env.FORMSY_GATEWAY_URL = 'http://formsy.test';
  globalThis.fetch = async () => jsonResponse({
    extra_context: 'context from server',
    observation_id: 'obs_tool',
  });

  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-plugin-'));
  try {
    const hooks = await FormsyOpenCodePlugin({
      directory,
      worktree: directory,
      project: {} as never,
      client: { app: { log: async () => undefined } } as never,
      experimental_workspace: { register: () => undefined },
      serverUrl: new URL('http://opencode.test'),
      $: {} as never,
    });

    const result = await hooks.tool?.context_search.execute(
      {
        query: 'Find auth',
        repo_id: 'repo/example',
        revision: 'abc123',
      },
      {
        directory,
        worktree: directory,
        sessionID: 'sess_1',
        messageID: 'msg_1',
        agent: 'build',
        abort: new AbortController().signal,
        metadata: () => undefined,
        ask: (() => undefined) as never,
      }
    );

    assert.deepEqual(result, {
      output: 'context from server',
      metadata: {
        endpoint: '/api/v1/query',
        repoId: 'repo/example',
        revision: 'abc123',
        directMatchFiles: [],
        bundlePrimaryFiles: [],
        bundleMustEdit: [],
        observation_id: 'obs_tool',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FORMSY_GATEWAY_URL;
    await rm(directory, { recursive: true, force: true });
  }
});

test('plugin hooks submit redacted observability reports', async () => {
  const originalFetch = globalThis.fetch;
  const submissions: unknown[] = [];
  process.env.FORMSY_OBSERVABILITY_ENABLED = 'true';
  process.env.FORMSY_OBSERVABILITY_URL = 'http://observe.test';
  globalThis.fetch = async (_input, init) => {
    submissions.push(JSON.parse(String(init?.body)));
    return jsonResponse({ ok: true });
  };

  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-plugin-'));
  try {
    const hooks = await FormsyOpenCodePlugin({
      directory,
      worktree: directory,
      project: {} as never,
      client: { app: { log: async () => undefined } } as never,
      experimental_workspace: { register: () => undefined },
      serverUrl: new URL('http://opencode.test'),
      $: {} as never,
    });

    await hooks['chat.message']?.(
      {
        sessionID: 'sess_obs',
        model: { providerID: 'openai', modelID: 'gpt-5' },
      } as never,
      {
        message: {} as never,
        parts: [{ type: 'text', text: 'Fix TOKEN=secret-value in auth' }] as never,
      }
    );
    await hooks['chat.params']?.(
      {
        sessionID: 'sess_obs',
        agent: 'build',
        model: { id: 'gpt-5' },
        provider: {} as never,
        message: {} as never,
      } as never,
      {} as never
    );
    await hooks['tool.execute.before']?.(
      {
        sessionID: 'sess_obs',
        tool: 'context_search',
        callID: 'call_1',
      },
      { args: { query: 'auth' } }
    );
    await hooks['tool.execute.after']?.(
      {
        sessionID: 'sess_obs',
        tool: 'context_search',
        callID: 'call_1',
        args: { query: 'auth' },
      },
      {
        title: 'context_search',
        output: JSON.stringify({ metadata: { observation_id: 'obs_hook' } }),
        metadata: { observation_id: 'obs_hook' },
      }
    );

    assert.equal(submissions.length, 1);
    const body = submissions[0] as {
      reports: Array<{
        task: { case_id: string };
        counters: { context_search_count: number; model_turn_count: number };
        server_correlation: { used_observation_ids: string[] };
        privacy: { contains_prompt: boolean };
      }>;
    };
    assert.equal(body.reports[0].counters.context_search_count, 1);
    assert.equal(body.reports[0].counters.model_turn_count, 1);
    assert.equal(body.reports[0].task.case_id.includes('secret-value'), false);
    assert.deepEqual(body.reports[0].server_correlation.used_observation_ids, ['obs_hook']);
    assert.equal(body.reports[0].privacy.contains_prompt, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FORMSY_OBSERVABILITY_ENABLED;
    delete process.env.FORMSY_OBSERVABILITY_URL;
    await rm(directory, { recursive: true, force: true });
  }
});
