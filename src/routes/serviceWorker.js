const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PRECACHE_ASSETS = [
  '/offline.html',
  '/style.css',
  '/wake-page.css',
  '/icon.svg',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
];

// Snapshot au démarrage : aucune lecture disque ni recalcul par requête.
function createServiceWorkerHandler(publicDir) {
  const template = readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
  const hash = createHash('sha256').update(template);
  for (const asset of PRECACHE_ASSETS) {
    const content = readFileSync(path.join(publicDir, asset.slice(1)));
    hash.update(JSON.stringify([asset, content.length])).update(content);
  }
  const version = hash.digest('hex').slice(0, 16);
  const script = template
    .replace('__SPARK_CACHE_VERSION__', version)
    .replace('/* __SPARK_PRECACHE_ASSETS__ */ []', JSON.stringify(PRECACHE_ASSETS));

  return (_req, res) => {
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(script);
  };
}

module.exports = { createServiceWorkerHandler, PRECACHE_ASSETS };
