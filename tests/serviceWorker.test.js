const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const { createServiceWorkerHandler, PRECACHE_ASSETS } = require('../src/routes/serviceWorker');

const publicDir = path.resolve(__dirname, '../public');

function workerApp(dir) {
  const app = express();
  app.get('/sw.js', createServiceWorkerHandler(dir));
  return app;
}

function version(script) {
  return script.match(/spark-([a-f0-9]{16})/)[1];
}

test('sw.js substitutes markers, returns JavaScript with no-cache and has a stable version', async () => {
  const app = workerApp(publicDir);
  const first = await request(app).get('/sw.js').expect(200);
  const second = await request(app).get('/sw.js').expect(200);
  assert.match(first.headers['content-type'], /application\/javascript/);
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.doesNotMatch(first.text, /__SPARK_/);
  assert.equal(version(first.text), version(second.text));
  assert.equal(first.text, second.text);
  assert.equal(PRECACHE_ASSETS.includes('/'), false);
  assert.equal(PRECACHE_ASSETS.includes('/index.html'), false);
});

test('cache version reflects every precached asset and the worker source after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-sw-'));
  try {
    fs.cpSync(publicDir, dir, { recursive: true });
    const app = workerApp(dir);
    const original = await request(app).get('/sw.js');
    for (const asset of [...PRECACHE_ASSETS, '/sw.js']) {
      const file = path.join(dir, asset.slice(1));
      const content = fs.readFileSync(file);
      fs.appendFileSync(file, '\n/* changed */');
      // Running process keeps its startup snapshot; next process sees the change.
      assert.equal((await request(app).get('/sw.js')).text, original.text);
      const changed = await request(workerApp(dir)).get('/sw.js');
      assert.notEqual(version(changed.text), version(original.text), asset);
      fs.writeFileSync(file, content);
      assert.equal(
        version((await request(workerApp(dir)).get('/sw.js')).text),
        version(original.text)
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Express serves the generated worker behind auth and with the existing CSP', async () => {
  // Requiring the app opens no database; isolate any future DB access in /tmp.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-sw-server-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.AUTH_USER = 'sw-test';
  process.env.AUTH_PASS = 'sw-test-password';
  try {
    const { app } = require('../src/server');
    await request(app).get('/sw.js').expect(401);
    const res = await request(app).get('/sw.js').auth('sw-test', 'sw-test-password').expect(200);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.doesNotMatch(res.text, /__SPARK_/);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    const offline = await request(app).get('/offline.html').auth('sw-test', 'sw-test-password');
    assert.equal(offline.status, 200);
    assert.doesNotMatch(offline.text, /<script|\son\w+=|\sstyle=/i);
  } finally {
    require('../src/services/db').closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Exercise the actual served script with a small CacheStorage/event adapter.
async function workerHarness() {
  const script = (await request(workerApp(publicDir)).get('/sw.js')).text;
  const listeners = {};
  const stores = new Map();
  const keyOf = (req) =>
    new URL(typeof req === 'string' ? req : req.url, 'https://spark.test').href;
  const storage = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(req, res) {
          store.set(keyOf(req), res.clone());
        },
        async match(req) {
          return store.get(keyOf(req))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  let fetcher = async () => new Response('asset');
  let claimed = false;
  let skipped = false;
  vm.runInNewContext(script, {
    URL,
    caches: storage,
    fetch: (...args) => fetcher(...args),
    self: {
      location: { origin: 'https://spark.test' },
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      skipWaiting: async () => {
        skipped = true;
      },
      clients: {
        claim: async () => {
          claimed = true;
        },
      },
    },
  });
  return {
    stores,
    storage,
    cacheName: `spark-${version(script)}`,
    get claimed() {
      return claimed;
    },
    get skipped() {
      return skipped;
    },
    setFetch(fn) {
      fetcher = fn;
    },
    dispatch(name, pathname = '/', options = {}) {
      const pending = [];
      let response;
      listeners[name]({
        request: { url: new URL(pathname, 'https://spark.test').href, method: 'GET', ...options },
        waitUntil(promise) {
          pending.push(promise);
        },
        respondWith(promise) {
          response = promise;
        },
      });
      return { response, settled: () => Promise.all(pending) };
    },
  };
}

test('install precaches only static assets and activation purges old Spark caches', async () => {
  const worker = await workerHarness();
  await worker.storage.open('spark-v3');
  await worker.storage.open('another-app');
  await worker.dispatch('install').settled();
  assert.equal(worker.skipped, true);
  const keys = [...worker.stores.get(worker.cacheName).keys()].map((url) => new URL(url).pathname);
  assert.deepEqual(keys, PRECACHE_ASSETS);
  await worker.dispatch('activate').settled();
  assert.equal(worker.claimed, true);
  assert.deepEqual(await worker.storage.keys(), ['another-app', worker.cacheName]);
});

for (const response of [new Response('error', { status: 401 }), { ok: true, redirected: true }]) {
  test(`install rejects ${response.redirected ? 'redirected' : 'non-ok'} assets`, async () => {
    const worker = await workerHarness();
    worker.setFetch(async () => response);
    await assert.rejects(worker.dispatch('install').settled(), /Précache Spark indisponible/);
    assert.equal(worker.stores.size, 0);
    assert.equal(worker.skipped, false);
  });
}

test('navigations use network first, never cache HTML, and fall back to offline.html', async () => {
  const worker = await workerHarness();
  await worker.dispatch('install').settled();
  const cache = await worker.storage.open(worker.cacheName);
  await cache.put('/offline.html', new Response('hors ligne'));
  worker.setFetch(async () => new Response('page authentifiée'));
  assert.equal(
    await (await worker.dispatch('fetch', '/', { mode: 'navigate' }).response).text(),
    'page authentifiée'
  );
  assert.equal(await cache.match('/'), undefined);
  worker.setFetch(async () => new Response('non autorisé', { status: 401 }));
  assert.equal((await worker.dispatch('fetch', '/', { mode: 'navigate' }).response).status, 401);
  worker.setFetch(async () => {
    throw new Error('offline');
  });
  assert.equal(
    await (await worker.dispatch('fetch', '/', { mode: 'navigate' }).response).text(),
    'hors ligne'
  );
  assert.equal(await cache.match('/'), undefined);
});

test('static assets use stale-while-revalidate and reject non-ok or redirected cache writes', async () => {
  const worker = await workerHarness();
  const cache = await worker.storage.open(worker.cacheName);
  await cache.put('/style.css', new Response('old'));
  let release;
  worker.setFetch(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const event = worker.dispatch('fetch', '/style.css');
  assert.equal(await (await event.response).text(), 'old');
  release(new Response('new'));
  await event.settled();
  assert.equal(await (await cache.match('/style.css')).text(), 'new');
  for (const res of [new Response('error', { status: 500 }), { ok: true, redirected: true }]) {
    worker.setFetch(async () => res);
    const fetchEvent = worker.dispatch('fetch', '/style.css');
    await fetchEvent.response;
    await fetchEvent.settled();
    assert.equal(await (await cache.match('/style.css')).text(), 'new');
  }
  worker.setFetch(async () => {
    throw new Error('offline');
  });
  const offline = worker.dispatch('fetch', '/style.css');
  assert.equal(await (await offline.response).text(), 'new');
  await offline.settled();
});

test('API, wake, health, cross-origin, unknown files and writes bypass the worker', async () => {
  const worker = await workerHarness();
  let calls = 0;
  worker.setFetch(async () => {
    calls++;
    return new Response('unexpected');
  });
  for (const pathname of [
    '/api',
    '/api/devices',
    '/api/events',
    '/wake',
    '/wake/pc?token=secret',
    '/health',
    '/health/',
    '/index.html',
    '/unknown',
    '/sw.js',
    '/style.css?token=secret',
    'https://other.test/style.css',
  ]) {
    assert.equal(worker.dispatch('fetch', pathname).response, undefined, pathname);
  }
  assert.equal(worker.dispatch('fetch', '/style.css', { method: 'POST' }).response, undefined);
  assert.equal(calls, 0);
});
