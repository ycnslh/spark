const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');

function buildApp(user, pass) {
  process.env.AUTH_USER = user;
  process.env.AUTH_PASS = pass;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/middleware/auth')];
  const { basicAuth } = require('../src/middleware/auth');
  const app = express();
  app.use(basicAuth);
  app.get('/protected', (req, res) => res.json({ user: req.authUser || null }));
  return app;
}

test('basicAuth bypasses when credentials not configured', async () => {
  const app = buildApp('', '');
  const res = await request(app).get('/protected');
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
});

test('basicAuth challenges without header', async () => {
  const app = buildApp('admin', 'secret');
  const res = await request(app).get('/protected');
  assert.equal(res.status, 401);
  assert.match(res.headers['www-authenticate'], /Basic realm/);
});

test('basicAuth accepts correct credentials', async () => {
  const app = buildApp('admin', 'secret');
  const token = Buffer.from('admin:secret').toString('base64');
  const res = await request(app).get('/protected').set('Authorization', `Basic ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user, 'admin');
});

test('basicAuth rejects wrong password', async () => {
  const app = buildApp('admin', 'secret');
  const token = Buffer.from('admin:wrong').toString('base64');
  const res = await request(app).get('/protected').set('Authorization', `Basic ${token}`);
  assert.equal(res.status, 401);
});

test('basicAuth rejects malformed header', async () => {
  const app = buildApp('admin', 'secret');
  const res = await request(app).get('/protected').set('Authorization', 'Bearer xyz');
  assert.equal(res.status, 401);
});
