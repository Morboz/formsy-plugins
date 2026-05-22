import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FormsyObservationReporter } from './observability.js';

test('reporter aggregates tool counters and redacts task/test summaries', async () => {
  const reports: unknown[] = [];
  const reporter = new FormsyObservationReporter({
    enabled: true,
    workspaceId: 'workspace_1',
    repoId: 'repo/example',
    revision: 'abc123',
    sourceName: 'opencode',
    submit: async (body) => {
      reports.push(body);
    },
  });

  reporter.onChatMessage({
    sessionID: 'sess_1',
    model: 'openai/gpt-5',
    messageText: 'Fix API_KEY=secret-value in auth flow with Bearer abcdefghijklmnopqrstuvwxyz123456',
  });
  reporter.onModelRequest({
    sessionID: 'sess_1',
    model: 'openai/gpt-5',
  });
  reporter.onToolExecuteBefore({
    sessionID: 'sess_1',
    tool: 'context_search',
    args: { query: 'auth' },
  });
  reporter.onToolExecuteAfter({
    sessionID: 'sess_1',
    tool: 'context_search',
    args: { query: 'auth' },
    output: { metadata: { observation_id: 'obs_1', accepted_targets: ['src/auth.ts'] } },
  });
  reporter.onToolExecuteBefore({
    sessionID: 'sess_1',
    tool: 'context_read',
    args: { path: 'src/auth.ts' },
  });
  reporter.onToolExecuteBefore({
    sessionID: 'sess_1',
    tool: 'bash',
    args: { command: 'npm test -- --runInBand' },
  });
  reporter.onToolExecuteBefore({
    sessionID: 'sess_1',
    tool: 'edit',
    args: { file_path: 'src/auth.ts' },
  });

  const report = await reporter.flush('sess_1', 'partial', 'running');

  assert.equal(reports.length, 1);
  assert.equal(report.counters.turn_count, 1);
  assert.equal(report.counters.model_turn_count, 1);
  assert.equal(report.counters.context_search_count, 1);
  assert.equal(report.counters.context_read_count, 1);
  assert.equal(report.counters.shell_fallback_count, 1);
  assert.equal(report.counters.test_command_count, 1);
  assert.equal(report.counters.file_edit_count, 1);
  assert.equal(report.observed_behavior.first_test_command_kind, 'javascript');
  assert.equal(report.task.case_id.includes('secret-value'), false);
  assert.equal(report.task.case_id.includes('Bearer abc'), false);
  assert.deepEqual(report.server_correlation.used_observation_ids, ['obs_1']);
  assert.equal(report.privacy.contains_prompt, false);
  assert.equal(report.privacy.contains_source, false);
  assert.equal(report.privacy.contains_diff, false);
  assert.equal(report.privacy.contains_shell_output, false);
});

test('reporter spools reports when submit fails', async () => {
  const spoolDir = await mkdtemp(path.join(tmpdir(), 'formsy-observability-'));
  try {
    const reporter = new FormsyObservationReporter({
      enabled: true,
      workspaceId: 'workspace_1',
      repoId: 'repo/example',
      sourceName: 'opencode',
      spoolDir,
      submit: async () => {
        throw new Error('offline');
      },
    });

    reporter.onChatMessage({ sessionID: 'sess_2', messageText: 'Implement context read' });
    const report = await reporter.flush('sess_2', 'final', 'completed');
    const today = new Date().toISOString().slice(0, 10);
    const spooled = await readFile(
      path.join(spoolDir, 'task-reports', today, `task-reports-${today}.jsonl`),
      'utf8'
    );

    assert.equal(JSON.parse(spooled.trim()).report_id, report.report_id);
  } finally {
    await rm(spoolDir, { recursive: true, force: true });
  }
});

test('reporter times out slow observability submissions and spools', async () => {
  const originalFetch = globalThis.fetch;
  const spoolDir = await mkdtemp(path.join(tmpdir(), 'formsy-observability-'));
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });

  try {
    const reporter = new FormsyObservationReporter({
      enabled: true,
      workspaceId: 'workspace_1',
      repoId: 'repo/example',
      sourceName: 'opencode',
      spoolDir,
      timeoutMs: 1,
    });

    reporter.onChatMessage({ sessionID: 'sess_timeout', messageText: 'Implement timeout' });
    const report = await reporter.flush('sess_timeout', 'partial', 'running');
    const today = new Date().toISOString().slice(0, 10);
    const spooled = await readFile(
      path.join(spoolDir, 'task-reports', today, `task-reports-${today}.jsonl`),
      'utf8'
    );

    assert.equal(JSON.parse(spooled.trim()).report_id, report.report_id);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(spoolDir, { recursive: true, force: true });
  }
});
