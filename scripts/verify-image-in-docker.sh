#!/bin/sh
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
image_name="spark-deps-test-$(date +%s)-$$"
container_name="$image_name-runtime"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker image rm "$image_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
docker build --pull=false --tag "$image_name" "$root_dir"
docker run -d --rm --name "$container_name" --network bridge \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --cap-add NET_RAW --security-opt no-new-privileges:true \
  --publish 127.0.0.1::3000 --env NODE_ENV=production --env PORT=3000 \
  --env DB_PATH=/tmp/spark.db --env AUTH_USER=smoke --env AUTH_PASS=isolated-smoke-secret \
  --env WOL_BROADCAST=127.0.0.1 --env WOL_ALL_INTERFACES=false \
  --env WOL_REPEAT_DELAY_MS=0 --env SCHEDULER_ENABLED=false "$image_name"
docker inspect "$container_name" --format \
  'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} network={{.HostConfig.NetworkMode}} tmpfs={{json .HostConfig.Tmpfs}} cap_drop={{json .HostConfig.CapDrop}} cap_add={{json .HostConfig.CapAdd}} security={{json .HostConfig.SecurityOpt}}'
docker exec -i "$container_name" node <<'JS'
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
(async () => {
  const base = 'http://127.0.0.1:3000';
  let health;
  for (let i = 0; i < 30; i++) {
    try {
      health = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(health?.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const response = await fetch(base + '/api/devices', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('smoke:isolated-smoke-secret').toString('base64'),
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'hardened', mac: '02:00:00:00:00:42' }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 201, await response.text());
  const db = new Database(process.env.DB_PATH, { readonly: true });
  assert.equal(db.prepare('SELECT name FROM devices').get().name, 'hardened');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  db.close();
  assert.notEqual(process.getuid(), 0);
  console.log('OK image durcie : /health 200, création 201, SQLite relue, intégrité ok, WAL, non-root');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
JS
