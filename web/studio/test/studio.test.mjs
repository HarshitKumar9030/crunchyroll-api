import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { highlight } from '../highlight.mjs';

let child, origin;
before(async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, CRUNCHY_STUDIO_PORT: String(port), CRUNCHYROLL_COOKIE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Studio startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Studio exited: ${code}`)); });
    child.stdout.on('data', chunk => { if (String(chunk).includes('Crunchy API Studio:')) { clearTimeout(timeout); resolve(); } });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    const exit = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exit;
  }
});

test('static app serves its bundled entry, CSS, and security headers', async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /type="module" src="\/app.js"/);
  assert.equal((await fetch(`${origin}/styles.css`)).status, 200);
  const bundle = await (await fetch(`${origin}/app.js`)).text();
  assert.ok(bundle.length > 1000);
  assert.ok(!bundle.includes('from "./animations.jsx"'));
});
test('status reports configuration without credentials and disables caching', async () => {
  const response = await fetch(`${origin}/api/status`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { configured: false });
});
test('unconfigured account requests return a sanitized auth error', async () => {
  const response = await fetch(`${origin}/api/request?endpoint=watchlist`);
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.match(payload.error, /Authentication failed/);
  assert.ok(!JSON.stringify(payload).includes('etp_rt='));
});
test('unknown endpoints, methods, and paths are rejected', async () => {
  assert.equal((await fetch(`${origin}/api/request?endpoint=constructor`)).status, 400);
  assert.equal((await fetch(`${origin}/api/request?endpoint=arbitrary`)).status, 400);
  assert.equal((await fetch(`${origin}/api/request`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
});
test('cross-origin requests, hostile Host values, and cross-site fetches are rejected', async () => {
  for (const headers of [{ origin: 'https://example.com' }, { host: 'evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(`${origin}/api/status`, { headers }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
});
test('syntax highlighting handles TypeScript, JavaScript, JSON, shell, and hostile source text', () => {
  assert.match(highlight('const count: number = 1;', 'example.ts'), /hljs-keyword/);
  assert.match(highlight('const count = 1;', 'example.js'), /hljs-keyword/);
  assert.match(highlight('{"data": []}', 'response.json'), /hljs-attr/);
  assert.match(highlight('echo "hello"', 'terminal'), /hljs/);
  const hostile = highlight('const value = "</script><img src=x onerror=alert(1)>";');
  assert.ok(!hostile.includes('<img'));
  assert.ok(!hostile.includes('</script>'));
});
