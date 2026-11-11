const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-scheduler-lifecycle-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
require('../src/config').dataDir = tmpDir;
const { getDb, closeDb } = require('../src/services/db');
const devices = require('../src/services/deviceStore');
const schedules = require('../src/services/scheduleStore');
const rootDir = path.resolve(__dirname, '..');
after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(
    `server démarre le scheduler et attend son envoi simulé sur ${signal}`,
    { timeout: 10_000 },
    async (t) => {
      getDb().exec('DELETE FROM devices');
      const device = devices.createDevice({ name: 'PC', mac: 'aa:bb:cc:dd:ee:01' });
      const schedule = schedules.createSchedule(device.id, { time: '08:30', days: [1] });
      closeDb();
      const child = spawn(
        process.execPath,
        [
          '-e',
          `
      const config = require('./src/config');
      config.port = 0;
      config.dataDir = ${JSON.stringify(tmpDir)};
      // Double installé avant le chargement du service partagé : aucun paquet réel.
      require('./src/services/wolSender').sendWakeOnLan = () => new Promise((resolve) => {
        process.send({ kind: 'sending' });
        process.once('message', () => resolve());
      });
      const moduleScheduler = require('./src/services/scheduler');
      const factory = moduleScheduler.createScheduler;
      moduleScheduler.createScheduler = (options) => {
        const scheduler = factory({ ...options, now: () => new Date('2026-11-09T08:30:00Z'), intervalMs: 10 });
        const stop = scheduler.stop;
        scheduler.stop = () => { process.send({ kind: 'stopping' }); return stop(); };
        return scheduler;
      };
      const server = require('./src/server').start();
      server.once('listening', () => process.send({ kind: 'listening' }));
    `,
        ],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            AUTH_USER: 'admin',
            AUTH_PASS: 'secret',
            SCHEDULER_ENABLED: 'true',
            SCHEDULER_TZ: 'UTC',
          },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        }
      );
      t.after(() => child.kill('SIGKILL'));
      const received = new EventEmitter();
      const seen = new Set();
      child.on('message', ({ kind }) => {
        seen.add(kind);
        received.emit(kind);
      });
      const waitFor = (kind) =>
        seen.has(kind)
          ? Promise.resolve()
          : once(received, kind, { signal: AbortSignal.timeout(5000) });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const exited = once(child, 'exit');
      await Promise.all([waitFor('sending'), waitFor('listening')]);
      child.kill(signal);
      await waitFor('stopping');
      assert.equal(child.exitCode, null, 'Le processus attend le réveil en vol');
      child.send({ kind: 'release' });
      const [code, exitSignal] = await exited;
      assert.equal(code, 0, stderr);
      assert.equal(exitSignal, null, stderr);
      assert.equal(schedules.findById(schedule.id).last_status, 'sent');
      const history = devices.getHistory(device.id);
      assert.equal(history.length, 1);
      assert.equal(history[0].triggered_by, `schedule:${schedule.id}`);
      closeDb();
    }
  );
}

test('configuration du scheduler : valeurs par défaut et variables d’environnement', () => {
  for (const [enabled, zone, expected] of [
    ['', '', { enabled: true }],
    ['false', 'Europe/Paris', { enabled: false, timeZone: 'Europe/Paris' }],
    ['true', ' Asia/Tokyo ', { enabled: true, timeZone: 'Asia/Tokyo' }],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['-e', "process.stdout.write(JSON.stringify(require('./src/config').scheduler))"],
      {
        cwd: rootDir,
        env: { ...process.env, SCHEDULER_ENABLED: enabled, SCHEDULER_TZ: zone },
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});
