import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const compileRequests = [];
const queryRequests = [];

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    const parsed = JSON.parse(body);

    if (req.url === '/v1/gateway/compile') {
      compileRequests.push(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, compiled: parsed.files[0].path }));
      return;
    }

    if (req.url === '/v1/gateway/query') {
      queryRequests.push(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          repo_id: 'django',
          extra_context: '### django/contrib/auth/management/__init__.py:38-111\n```python\ncreate_permissions(...)\n```',
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
});

async function runGit(args, cwd) {
  await execFileAsync('git', args, { cwd });
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock gateway address');
  }

  process.env.FORMSY_GATEWAY_URL = `http://127.0.0.1:${address.port}`;

  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-plugin-test-'));
  await mkdir(path.join(repoDir, 'src'), { recursive: true });
  await mkdir(path.join(repoDir, 'tests'), { recursive: true });
  await mkdir(path.join(repoDir, 'node_modules', 'ignored'), { recursive: true });

  await writeFile(
    path.join(repoDir, 'src', 'index.ts'),
    'export const value = 1;\n'
  );
  await writeFile(
    path.join(repoDir, 'src', 'util.js'),
    'export function add(a, b) { return a + b; }\n'
  );
  await writeFile(
    path.join(repoDir, 'src', 'util.test.ts'),
    'it("works", () => {});\n'
  );
  await writeFile(
    path.join(repoDir, 'tests', 'app.spec.ts'),
    'it("works", () => {});\n'
  );
  await writeFile(
    path.join(repoDir, 'node_modules', 'ignored', 'vendor.js'),
    'module.exports = {};\n'
  );

  await runGit(['init'], repoDir);
  await runGit(['config', 'user.email', 'test@example.com'], repoDir);
  await runGit(['config', 'user.name', 'Plugin Test'], repoDir);
  await runGit(['remote', 'add', 'origin', 'git@github.com:formsy-ai/sample-repo.git'], repoDir);
  await runGit(['add', '.'], repoDir);
  await runGit(['commit', '-m', 'initial'], repoDir);

  const { FormsyOpenCodePlugin } = await import(
    '../packages/plugin-opencode/dist/index.js'
  );

  const hooks = await FormsyOpenCodePlugin({
    directory: repoDir,
    worktree: repoDir,
    project: {},
    serverUrl: new URL(process.env.FORMSY_GATEWAY_URL),
    experimental_workspace: {
      register() {},
    },
    $: {},
    client: {
      app: {
        async log() {},
      },
    },
  });

  assert.ok(hooks.tool?.formsy_compile_repo, 'compile tool should be registered');
  assert.ok(hooks.tool?.formsy_query_context, 'query tool should be registered');

  const compileResult = await hooks.tool.formsy_compile_repo.execute(
    {
      enable_w2: true,
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'test-agent',
      directory: repoDir,
      worktree: repoDir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        throw new Error('ask should not be called');
      },
    }
  );

  assert.equal(compileRequests.length, 2, 'only non-test source files should compile');
  assert.deepEqual(
    compileRequests.map((request) => request.files[0].path).sort(),
    ['src/index.ts', 'src/util.js']
  );
  assert.equal(
    compileRequests[0].repo_id,
    'git@github.com:formsy-ai/sample-repo.git'
  );
  assert.equal(compileRequests[0].enable_w2, true);
  assert.equal(typeof compileRequests[0].revision, 'string');
  assert.equal(compileRequests[0].files[0].is_test, false);

  assert.equal(typeof compileResult, 'string');
  assert.match(compileResult, /compiledFiles/);
  assert.match(compileResult, /src\/index\.ts/);

  const queryResult = await hooks.tool.formsy_query_context.execute(
    {
      query: 'Find code related to value export',
      budget: 1234,
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'test-agent',
      directory: repoDir,
      worktree: repoDir,
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        throw new Error('ask should not be called');
      },
    }
  );

  assert.equal(queryRequests.length, 1, 'query tool should make one request');
  assert.equal(queryRequests[0].repo_id, 'git@github.com:formsy-ai/sample-repo.git');
  assert.equal(queryRequests[0].query, 'Find code related to value export');
  assert.equal(queryRequests[0].budget, 1234);
  assert.equal(typeof queryRequests[0].revision, 'string');

  assert.equal(typeof queryResult, 'string');
  assert.equal(
    queryResult,
    '### django/contrib/auth/management/__init__.py:38-111\n```python\ncreate_permissions(...)\n```'
  );

  console.log('OpenCode plugin smoke test passed.');
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
