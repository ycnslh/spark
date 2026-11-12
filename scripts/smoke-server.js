#!/usr/bin/env node
// Vrai serveur, sockets HTTP/UDP locales, SQLite jetable et limiteurs de production.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-smoke-'));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    AUTH_USER: 'smoke',
    AUTH_PASS: 'isolated-smoke-secret',
    PORT: '0',
    DB_PATH: path.join(dir, 'smoke.db'),
    WOL_BROADCAST: '127.0.0.1',
    WOL_ALL_INTERFACES: 'false',
    WOL_REPEAT_DELAY_MS: '0',
    SCHEDULER_ENABLED: 'false',
    TRUST_PROXY: 'loopback',
    WAKE_RATE_LIMIT: '2',
    AUTH_RATE_LIMIT: '5',
    LOG_LEVEL: 'info',
  };
  delete env.RATE_LIMIT_DISABLED;
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const config = require('./src/config');
       config.port = 0;
       config.dataDir = ${JSON.stringify(dir)};
       const server = require('./src/server').start();
       server.once('listening', () => process.send(server.address().port));`,
    ],
    { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  );
  let logs = '';
  child.stdout.on('data', (chunk) => (logs += chunk));
  child.stderr.on('data', (chunk) => (logs += chunk));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
  try {
    const port = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Démarrage échoué (${code}): ${logs}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const auth = `Basic ${Buffer.from(`${env.AUTH_USER}:${env.AUTH_PASS}`).toString('base64')}`;
    async function call(method, route, expected, body, extra = {}) {
      const headers = {
        Authorization: auth,
        Origin: base,
        'X-Forwarded-For': '198.51.100.10',
        ...extra,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + route, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      const text = await response.text();
      assert.equal(response.status, expected, `${method} ${route.split('?')[0]}: ${text}`);
      const json = response.headers.get('content-type')?.includes('application/json');
      return { response, body: json ? JSON.parse(text) : text };
    }
    await call('GET', '/health', 200, undefined, { Authorization: '' });
    const index = await call('GET', '/', 200);
    assert.match(index.body, /<!doctype html>/i);
    const moduleScript = await call('GET', '/js/app.js', 200);
    assert.match(moduleScript.response.headers.get('content-type'), /text\/javascript/);
    const sw = await call('GET', '/sw.js', 200);
    assert.equal(sw.response.headers.get('cache-control'), 'no-cache');
    assert.match(sw.response.headers.get('content-type'), /javascript/);
    console.log('OK health, statique / et service worker');

    const mac = '02:00:00:00:00:01';
    const created = await call('POST', '/api/devices', 201, { name: 'smoke', mac });
    const id = created.body.device.id;
    assert.equal((await call('GET', '/api/devices', 200)).body.length, 1);
    await call('PATCH', `/api/devices/${id}`, 200, { description: 'smoke temporaire' });
    const tag = (await call('POST', '/api/tags', 201, { name: 'smoke', color: '#123456' })).body
      .tag;
    await call('GET', '/api/tags', 200);
    await call('PUT', `/api/devices/${id}/tags`, 200, { tagIds: [tag.id] });
    const exported = (await call('GET', '/api/export', 200)).body;
    assert.equal(exported.devices[0].tags[0], 'smoke');
    assert.equal('tokens' in exported.devices[0], false);
    const imported = await call('POST', '/api/import', 200, {
      version: 1,
      devices: [{ name: 'imported', mac: '02:00:00:00:00:02' }],
    });
    assert.equal(imported.body.stats.devices, 1);
    console.log('OK appareils CRUD, tags, import/export');

    const token = (await call('POST', `/api/devices/${id}/tokens`, 201, { label: 'smoke' })).body;
    assert.equal((await call('GET', `/api/devices/${id}/tokens`, 200)).body.length, 1);
    await call('POST', `/api/wake/${mac}`, 200);
    await call('GET', `/wake/${mac}?token=${token.token}`, 200, undefined, {
      Authorization: '',
      Origin: '',
    });
    const limited = await call('GET', `/wake/${mac}?token=${token.token}`, 429, undefined, {
      Authorization: '',
    });
    assert.ok(limited.response.headers.has('ratelimit-limit'));
    const history = (await call('GET', `/api/devices/${id}/history`, 200)).body;
    assert.equal(history.length, 2);
    assert.ok(history.some((entry) => entry.triggered_by === 'token:smoke'));
    await call('DELETE', `/api/devices/${id}/tokens/${token.id}`, 200);
    await call('GET', `/wake/${mac}?token=${token.token}`, 401);
    console.log('OK tokens, POST/GET wake UDP loopback, historique et limiteur wake 429');

    const schedule = (
      await call('POST', `/api/devices/${id}/schedules`, 201, { time: '08:00', days: [1, 2] })
    ).body.schedule;
    await call('GET', '/api/schedules', 200);
    await call('PATCH', `/api/schedules/${schedule.id}`, 200, { enabled: false });
    await call('GET', '/api/schedules/state', 200);
    assert.equal(
      (await call('PUT', '/api/schedules/state', 200, { paused: true })).body.paused,
      true
    );
    await call('DELETE', `/api/schedules/${schedule.id}`, 200);
    await call('GET', '/api/status', 200);
    await call('POST', `/api/status/${id}/refresh`, 200, undefined, {
      'X-Forwarded-For': '198.51.100.11',
    });

    const abort = new AbortController();
    const stream = await fetch(base + '/api/events', {
      headers: { Authorization: auth },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    assert.equal(stream.headers.get('x-accel-buffering'), 'no');
    const reader = stream.body.getReader();
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.match(frame, /event: snapshot/);
    await reader.cancel();
    abort.abort();
    console.log('OK planifications, statut, SSE snapshot et fermeture');

    await call('GET', '/unknown/deep/route', 404, undefined, {
      'X-Forwarded-For': '198.51.100.12',
    });
    const badJson = await fetch(base + '/api/import', {
      method: 'POST',
      headers: { Authorization: auth, Origin: base, 'Content-Type': 'application/json' },
      body: '{',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(badJson.status, 500);
    assert.deepEqual(await badJson.json(), { success: false, message: 'Erreur interne' });
    console.log('OK 404 et gestionnaire réel d’erreur JSON (500 historique conservé)');

    for (let i = 0; i < 30; i++) {
      await call(
        'POST',
        `/api/devices/${id}/tokens`,
        201,
        {},
        {
          'X-Forwarded-For': '198.51.100.30',
        }
      );
    }
    await call(
      'POST',
      `/api/devices/${id}/tokens`,
      429,
      {},
      {
        'X-Forwarded-For': '198.51.100.30',
      }
    );
    for (let i = 0; i < 5; i++) {
      await call('GET', '/api/devices', 401, undefined, {
        Authorization: '',
        'X-Forwarded-For': '198.51.100.40',
      });
    }
    await call('GET', '/api/devices', 429, undefined, {
      Authorization: '',
      'X-Forwarded-For': '198.51.100.40',
    });
    await call('DELETE', `/api/devices/${mac}`, 200);
    await call('DELETE', '/api/devices/02:00:00:00:00:02', 200);
    await call('DELETE', `/api/tags/${tag.id}`, 200);
    assert.deepEqual((await call('GET', '/api/devices', 200)).body, []);
    assert.equal(
      logs.includes(token.token),
      false,
      'Le secret ne doit pas apparaître dans les logs'
    );
    console.log('OK limiteurs écriture/auth 429, suppression SQLite et secrets masqués');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGTERM');
      const [code] = await closed;
      assert.equal(code, 0, logs);
    }
    clearTimeout(timeout);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
