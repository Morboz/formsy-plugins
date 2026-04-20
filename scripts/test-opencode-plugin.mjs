import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/gateway/patch') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    requests.push(JSON.parse(body));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        patch: 'diff --git a/foo b/foo',
        case_id: 'django__django-16400',
      })
    );
  });
});

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

  const { FormsyOpenCodePlugin } = await import(
    '../packages/plugin-opencode/dist/index.js'
  );

  const hooks = await FormsyOpenCodePlugin({
    directory: process.cwd(),
    worktree: process.cwd(),
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

  assert.ok(hooks.tool?.formsy_generate_patch, 'tool should be registered');

  const result = await hooks.tool.formsy_generate_patch.execute(
    {
      type: 'swebench',
      case_id: 'django__django-16400',
      enable_w2: true,
      budget: {
        max_tokens: 20000,
        max_time_seconds: 900,
      },
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'test-agent',
      directory: process.cwd(),
      worktree: process.cwd(),
      abort: new AbortController().signal,
      metadata() {},
      ask() {
        throw new Error('ask should not be called');
      },
    }
  );

  assert.equal(requests.length, 1, 'tool should make exactly one request');
  assert.deepEqual(requests[0], {
    type: 'swebench',
    case_id: 'django__django-16400',
    enable_w2: true,
    budget: {
      max_tokens: 20000,
      max_time_seconds: 900,
    },
  });

  assert.equal(typeof result, 'string');
  assert.match(result, /diff --git a\/foo b\/foo/);
  assert.match(result, /"status": 200/);
  assert.match(
    result,
    new RegExp(`${process.env.FORMSY_GATEWAY_URL}/v1/gateway/patch`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );

  console.log('OpenCode plugin smoke test passed.');
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
