import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OpenCodeRuntime, normalizeRepoId } from './runtime.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

test('contextSearch posts Hermes-compatible query body and returns extra_context text', async () => {
  const calls: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
  const originalFetch = globalThis.fetch;
  process.env.FORMSY_GATEWAY_URL = 'http://formsy.test';
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers,
    });
    // compile/status returns empty object (no existing compile)
    // compile POST returns success
    // query POST returns search result
    const url = String(input);
    if (url.endsWith('/api/v1/compile/status')) {
      return jsonResponse({});
    }
    if (url.endsWith('/api/v1/compile')) {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({
      extra_context: 'focused repo context',
      observation_id: 'obs_123',
    });
  };

  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-'));
  try {
    const runtime = new OpenCodeRuntime();
    const result = await runtime.contextSearch({
      directory,
      repo_id: 'repo/example',
      revision: 'abc123',
      session_id: 'sess_1',
      query: 'Where is auth handled?',
      budget: 5000,
      enable_profiling: true,
      profiling_top_n: 8,
      metadata: { source: 'test' },
      identity: { user_id: 'user_1' },
    });

    assert.equal(result.output, 'focused repo context');

    // contextSearch calls: compileStatus, compile, then query
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'http://formsy.test/api/v1/compile/status');
    assert.equal(calls[1].url, 'http://formsy.test/api/v1/compile');
    assert.equal(calls[2].url, 'http://formsy.test/api/v1/query');

    // Verify the search query body
    assert.deepEqual(calls[2].body, {
      repo_id: 'repo/example',
      query: 'Where is auth handled?',
      revision: 'abc123',
      budget: 5000,
      enable_profiling: true,
      profiling_top_n: 8,
      metadata: { source: 'test', query_timeout_s: 90, fanout_timeout_s: 90 },
      identity: { user_id: 'user_1' },
    });
    assert.deepEqual(result.metadata, {
      endpoint: '/api/v1/query',
      repoId: 'repo/example',
      revision: 'abc123',
      directMatchFiles: [],
      bundlePrimaryFiles: [],
      bundleMustEdit: [],
      observation_id: 'obs_123',
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FORMSY_GATEWAY_URL;
    await rm(directory, { recursive: true, force: true });
  }
});

test('normalizeRepoId converts git remotes to provider slugs', () => {
  assert.equal(
    normalizeRepoId('https://github.com/django/django.git', '/tmp/django', '/tmp/django'),
    'django__django'
  );
  assert.equal(
    normalizeRepoId('git@github.com:django/django.git', '/tmp/django', '/tmp/django'),
    'django__django'
  );
  assert.equal(
    normalizeRepoId('https://example.com/custom/repo.git', '/tmp/custom', '/tmp/custom'),
    'custom__repo'
  );
  assert.equal(normalizeRepoId(undefined, '/tmp/custom', '/tmp/custom'), 'custom');
});

test('compileRepository submits all source files in one replace request', async () => {
  const calls: Array<{ url: string; body: { files: Array<{ path: string; content: string }> } }> = [];
  const originalFetch = globalThis.fetch;
  process.env.FORMSY_GATEWAY_URL = 'http://formsy.test';
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return jsonResponse({ ok: true });
  };

  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-'));
  try {
    await mkdir(path.join(directory, 'src'));
    await writeFile(path.join(directory, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(path.join(directory, 'src', 'b.ts'), 'export const b = 2;\n');
    await writeFile(path.join(directory, 'src', 'a.test.ts'), 'test("skip", () => undefined);\n');

    const runtime = new OpenCodeRuntime();
    const result = await runtime.compileRepository({
      directory,
      repo_id: 'repo/example',
      revision: 'abc123',
      enable_w2: true,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://formsy.test/api/v1/compile');
    assert.deepEqual(calls[0].body.files.map((file) => file.path), ['src/a.ts', 'src/b.ts']);
    assert.equal(calls[0].body.files[0].content, 'export const a = 1;\n');
    assert.equal(result.compiledFiles.length, 2);
    assert.deepEqual(result.failures, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FORMSY_GATEWAY_URL;
    await rm(directory, { recursive: true, force: true });
  }
});

test('contextRead posts Hermes-compatible read body and returns formatted source', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  process.env.FORMSY_GATEWAY_URL = 'http://formsy.test/';
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    return jsonResponse({
      path: 'src/auth.ts',
      content: 'export const ok = true;\n',
      start_line: 10,
      end_line: 10,
      trace_id: 'trace_456',
    });
  };

  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-'));
  try {
    const runtime = new OpenCodeRuntime();
    const result = await runtime.contextRead({
      directory,
      repo_id: 'repo/example',
      revision: 'abc123',
      session_id: 'sess_1',
      path: 'src/auth.ts',
      start_line: 10,
      end_line: 20,
      identity: { user_id: 'user_1' },
    });

    assert.equal(result.output, 'src/auth.ts:10-10\n\nexport const ok = true;\n');
    assert.equal(calls[0].url, 'http://formsy.test/api/v1/read');
    assert.deepEqual(calls[0].body, {
      repo_id: 'repo/example',
      revision: 'abc123',
      path: 'src/auth.ts',
      start_line: 10,
      end_line: 20,
      identity: { user_id: 'user_1' },
    });
    assert.deepEqual(result.metadata, {
      endpoint: '/api/v1/read',
      repoId: 'repo/example',
      revision: 'abc123',
      trace_id: 'trace_456',
      path: 'src/auth.ts',
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FORMSY_GATEWAY_URL;
    await rm(directory, { recursive: true, force: true });
  }
});

test('listSourceFiles excludes git worktree directories', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-'));
  try {
    // Create main source files
    await mkdir(path.join(directory, 'src'), { recursive: true });
    await writeFile(path.join(directory, 'src', 'main.ts'), 'export const main = 1;\n');

    // Create a worktree-like subdirectory with duplicate files
    await mkdir(path.join(directory, '.worktrees', 'fix-issue-10', 'src'), { recursive: true });
    await writeFile(path.join(directory, '.worktrees', 'fix-issue-10', 'src', 'main.ts'), 'export const main = 1;\n');

    const runtime = new OpenCodeRuntime();

    // Without worktreePaths, .worktrees is NOT in IGNORED_DIRECTORIES, so it would be walked
    // (unless we add it, but we rely on dynamic worktree detection instead)
    const allFiles = await runtime.listSourceFiles(directory);
    // .worktrees is not in IGNORED_DIRECTORIES, so without worktreePaths both files appear
    assert.ok(allFiles.length >= 2, 'should find files in both main and worktree dirs without exclusion');

    // With worktreePaths, the worktree directory should be excluded
    const worktreePath = path.join(directory, '.worktrees', 'fix-issue-10');
    const excludedFiles = await runtime.listSourceFiles(directory, undefined, undefined, [worktreePath]);
    const paths = excludedFiles.map(f => f.relativePath);
    assert.deepEqual(paths, ['src/main.ts'], 'should exclude worktree directory files');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resolveRepositoryContext includes worktreePaths from git', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'formsy-opencode-'));
  // Initialize a git repo so resolveRepositoryContext works
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('git', ['init'], { cwd: directory });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: directory });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: directory });

  try {
    const runtime = new OpenCodeRuntime();
    const context = await runtime.resolveRepositoryContext(directory);

    assert.equal(typeof context.repoId, 'string');
    assert.ok(context.repoId.length > 0);
    // No worktrees in a fresh repo, so worktreePaths should be empty
    assert.ok(Array.isArray(context.worktreePaths));
    assert.equal(context.worktreePaths.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
