#!/bin/sh
# Montage source en lecture seule ; compilation native et base de test jetables.
set -eu
image="${1:-node:26.13.1-alpine3.24}"
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_name="spark-deps-verify-$(date +%s)-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT HUP INT TERM
docker run --rm --name "$container_name" --network bridge \
  --mount "type=bind,src=$root_dir,dst=/src,readonly" "$image" sh -c '
  set -eu
  apk add --no-cache python3 make g++ iputils >/dev/null
  mkdir /work
  cd /work
  tar -C /src --exclude=node_modules --exclude=.git --exclude=".env*" --exclude=data -cf - . | tar xf -
  npm ci >/tmp/npm-ci.log 2>&1 || { cat /tmp/npm-ci.log; exit 1; }
  node -v
  npm run lint
  npm run format:check
  npm test >/tmp/tests.log 2>&1 || { cat /tmp/tests.log; exit 1; }
  tail -12 /tmp/tests.log
  if [ "$(node -p "process.versions.node.split(\".\")[0]")" = 26 ]; then
    node scripts/smoke-server.js
  fi
  '
