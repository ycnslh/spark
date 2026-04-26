# CLAUDE.md - Guide pour l'IA

## Description du projet

**Spark** est une application web permettant de réveiller des ordinateurs à distance via le protocole Wake-on-LAN (WoL). Elle tourne dans un conteneur Docker (typiquement sur un Raspberry Pi) et offre une interface PWA installable, des liens directs pour les raccourcis iOS, du monitoring online/offline et un historique des réveils.

> Note : le projet s'appelait "NetArise" à l'origine, renommé en "Spark" en avril 2026. Quelques anciens artefacts (notamment le dossier local `netarise/` et `devices.csv`) peuvent encore traîner pendant une phase de transition.

## Objectif éducatif

Ce projet est à but d'apprentissage. L'utilisateur souhaite comprendre et maîtriser les concepts suivants :

### Technologies utilisées

| Technologie | Emplacement | Rôle |
|-------------|-------------|------|
| **Node.js 22** | `src/` | Runtime JavaScript côté serveur (CommonJS) |
| **Express 4** | `src/server.js`, `src/routes/` | Framework web et API REST |
| **better-sqlite3** | `src/services/db.js`, `src/services/deviceStore.js` | Base SQLite synchrone |
| **Helmet + express-rate-limit** | `src/middleware/` | Sécurité (CSP, rate limiting) |
| **Vanilla JS modulaire** | `public/js/` | Frontend SPA (ES modules) |
| **PWA** | `public/manifest.webmanifest`, `public/sw.js` | Installable et fonctionne offline |
| **Docker multi-stage** | `Dockerfile`, `docker-compose.yml` | Build léger, user non-root, healthcheck |

### Concepts clés à explorer

1. **API REST** - Routes modulaires dans `src/routes/`
2. **Protocole UDP** - Paquets magiques WoL (port 9, broadcast 255.255.255.255)
3. **SQLite** - Schéma, migrations, requêtes préparées, transactions
4. **Sécurité web** - Basic Auth, échappement HTML, CSP, rate limiting
5. **Sondes réseau** - ICMP ping, TCP probe pour vérifier l'état d'un host
6. **PWA** - Service worker, manifest, installation
7. **Docker** - Multi-stage, volumes, healthcheck, network mode host
8. **Tests Node natifs** - `node --test` + `supertest`

## Structure du projet

```
spark/                              # (dossier local actuel: netarise/)
├── src/
│   ├── server.js                   # Bootstrap Express + lifecycle
│   ├── config.js                   # Variables d'env centralisées
│   ├── middleware/
│   │   ├── auth.js                 # Basic Auth (timing-safe)
│   │   └── rateLimit.js
│   ├── routes/
│   │   ├── devices.js              # CRUD + history
│   │   ├── wake.js                 # /api/wake et /wake/:id
│   │   ├── status.js               # /api/status (online/offline)
│   │   └── health.js               # /health (bypass auth)
│   ├── services/
│   │   ├── db.js                   # Connexion SQLite + schéma
│   │   ├── deviceStore.js          # Repository pattern
│   │   ├── wolSender.js            # Paquet magique + dgram
│   │   └── pinger.js               # ICMP + TCP probe
│   └── utils/
│       ├── logger.js, mac.js, html.js
├── public/
│   ├── index.html, style.css, icon.svg
│   ├── manifest.webmanifest, sw.js
│   └── js/{api,ui,app}.js
├── scripts/migrate-csv-to-sqlite.js
├── tests/                          # node --test
├── data/spark.db                   # Volume Docker
├── Dockerfile, docker-compose.yml
└── .env.example
```

## Points d'entrée principaux

- **Backend** : `src/server.js` — démarre sur `PORT` (défaut 3000, 8085 en Docker)
- **Frontend** : `public/index.html` + `public/js/app.js`
- **API endpoints** :
  - `GET /api/devices` — Liste
  - `POST /api/devices` — Ajout (body : `{ name, mac, description? }`)
  - `DELETE /api/devices/:mac`
  - `GET /api/devices/:id/history`
  - `GET /api/status` — online/offline (basé sur l'IP en description)
  - `POST /api/wake/:mac` — Réveil JSON
  - `GET /wake/:nom` — Réveil HTML (raccourcis iOS)
  - `GET /health` — Healthcheck (bypass auth)

## Commandes utiles

```bash
# Dev local
npm install
cp .env.example .env
npm start
npm test

# Migration depuis l'ancien CSV
npm run migrate

# Docker
docker-compose up -d --build
docker-compose logs -f spark
```

## Style de code

- **Backend** : CommonJS (`require`/`module.exports`)
- **Frontend** : ES modules (`import`/`export`), pas de framework
- **CSS** : variables CSS, Flexbox, Grid (pas de Tailwind/SCSS)
- **Logs** : format `[ISO timestamp] [LEVEL] message {meta}` sur stdout (Docker capture et fait la rotation)
- **Tests** : `node --test` natif + `supertest` (pas de Jest)

## Contexte d'apprentissage

Quand l'utilisateur pose des questions :
1. **Expliquer le "pourquoi"** avant le "comment"
2. **Proposer des exercices** pour mettre en pratique
3. **Faire des liens** entre les concepts (ex: UDP et WoL, ICMP et `child_process`)
4. **Encourager l'expérimentation** avec des suggestions de modifications
5. **Vulgariser** les concepts réseau si nécessaire

## Notes importantes

- Le mode réseau `host` est obligatoire pour le broadcast UDP (Docker bridge bloque le broadcast inter-VLAN)
- Les MAC sont stockées au format `aa:bb:cc:dd:ee:ff` après normalisation
- L'application est en français (interface et documentation)
- L'auth Basic est désactivée si `AUTH_USER`/`AUTH_PASS` sont vides (utile en dev)
- Si la `description` d'un appareil contient une IPv4, elle est utilisée pour le ping/probe — c'est comme ça qu'on détecte online/offline
