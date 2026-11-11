const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

for (const user of ['', 'admin']) {
  test(`production rejects changeme before opening the database (AUTH_USER=${user || 'empty'})`, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-startup-'));
    const dbPath = path.join(tmpDir, 'test.db');
    try {
      const result = spawnSync(process.execPath, ['src/server.js'], {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          AUTH_USER: user,
          AUTH_PASS: 'changeme',
          DB_PATH: dbPath,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /AUTH_PASS=changeme est interdit en production/);
      assert.equal(fs.existsSync(dbPath), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

for (const [nodeEnv, pass] of [
  ['development', 'changeme'],
  ['production', 'secret'],
]) {
  test(`config accepts ${nodeEnv} with ${pass === 'changeme' ? 'legacy' : 'custom'} password`, () => {
    const result = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: nodeEnv, AUTH_USER: 'admin', AUTH_PASS: pass },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const [user, pass] of [
  ['', ''],
  ['admin', ''],
  ['', 'secret'],
  ['admin', 'secret'],
]) {
  const authEnabled = !!(user && pass);
  test(`startup ${authEnabled ? 'does not warn' : 'warns'} with AUTH_USER=${user ? 'set' : 'empty'} and AUTH_PASS=${pass ? 'set' : 'empty'}`, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-startup-'));
    const script = `
      const config = require('./src/config');
      config.port = 0;
      config.dataDir = ${JSON.stringify(tmpDir)};
      require('./src/server').start();
    `;
    const child = spawn(process.execPath, ['-e', script], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        AUTH_USER: user,
        AUTH_PASS: pass,
        DB_PATH: path.join(tmpDir, 'test.db'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let started = false;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!started && stdout.includes('Spark running on port 0')) {
        started = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      assert.equal(started, true, stderr || stdout);
      assert.equal(code, 0, stderr || stdout);
      const logs = stdout.trim().split('\n').map(JSON.parse);
      const warnings = logs.filter((entry) => entry.level === 40);
      assert.equal(warnings.length, authEnabled ? 0 : 1);
      if (!authEnabled) {
        assert.match(warnings[0].msg, /Authentification désactivée.*AUTH_USER et AUTH_PASS/);
      }
    } finally {
      clearTimeout(timeout);
      child.kill('SIGKILL');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
