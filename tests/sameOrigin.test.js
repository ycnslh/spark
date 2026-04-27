const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');
const { sameOrigin } = require('../src/middleware/sameOrigin');

function buildApp() {
  const app = express();
  app.post('/mut', sameOrigin(), (req, res) => res.json({ ok: true }));
  app.get('/mut', sameOrigin(), (req, res) => res.json({ ok: true }));
  return app;
}

test('rejects POST without Origin or Referer', async () => {
  const res = await request(buildApp()).post('/mut');
  assert.equal(res.status, 403);
});

test('accepts POST with matching Origin', async () => {
  const res = await request(buildApp())
    .post('/mut')
    .set('Origin', 'http://127.0.0.1')
    .set('Host', '127.0.0.1');
  assert.equal(res.status, 200);
});

test('rejects POST with cross-origin Origin', async () => {
  const res = await request(buildApp())
    .post('/mut')
    .set('Origin', 'http://evil.example')
    .set('Host', '127.0.0.1');
  assert.equal(res.status, 403);
});

test('accepts POST when Referer matches host', async () => {
  const res = await request(buildApp())
    .post('/mut')
    .set('Referer', 'http://127.0.0.1/somepage')
    .set('Host', '127.0.0.1');
  assert.equal(res.status, 200);
});

test('GET with Apple Shortcuts UA bypasses origin check', async () => {
  const res = await request(buildApp()).get('/mut').set('User-Agent', 'Shortcuts/1.0');
  assert.equal(res.status, 200);
});

test('GET without Shortcuts UA still requires Origin', async () => {
  const res = await request(buildApp()).get('/mut');
  assert.equal(res.status, 403);
});
