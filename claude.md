# CLAUDE.md - Guide pour l'IA

## Description du projet

**Spark** est une application web permettant de réveiller des ordinateurs à distance via le protocole Wake-on-LAN (WoL). Elle tourne dans un conteneur Docker (typiquement sur un Raspberry Pi) et offre une interface PWA installable, des liens directs pour les raccourcis iOS, du monitoring online/offline et un historique des réveils.

> Note : le projet s'appelait "NetArise" à l'origine, renommé en "Spark" en avril 2026. L'ancien fichier `devices.csv` peut encore être présent avant sa migration vers SQLite.

## Objectif éducatif

Ce projet est à but d'apprentissage. L'utilisateur souhaite comprendre et maîtriser les concepts suivants :

### Technologies utilisées

| Technologie                     | Emplacement                                         | Rôle                                       |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| **Node.js 22**                  | `src/`                                              | Runtime JavaScript côté serveur (CommonJS) |
| **Express 4**                   | `src/server.js`, `src/routes/`                      | Framework web et API REST                  |
| **better-sqlite3**              | `src/services/db.js`, `src/services/deviceStore.js` | Base SQLite synchrone                      |
| **Helmet + express-rate-limit** | `src/middleware/`                                   | Sécurité (CSP, rate limiting)              |
| **Vanilla JS modulaire**        | `public/js/`                                        | Frontend SPA (ES modules)                  |
| **PWA**                         | `public/manifest.webmanifest`, `public/sw.js`       | Installable et fonctionne offline          |
| **Docker multi-stage**          | `Dockerfile`, `docker-compose.yml`                  | Build léger, user non-root, healthcheck    |

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
spark/
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
│   │   ├── tokenStore.js           # Secrets de réveil : génération, hash, révocation
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
  - `POST /api/devices` — Ajout (body : `{ name, mac, description?, host?, ip?, broadcast?, probe_port? }`)
  - `PATCH /api/devices/:id` — Modification du nom, de la description, du host et des champs réseau
  - `DELETE /api/devices/:mac`
  - `POST /api/devices/:id/tokens` — `{label?}` (max 60 caractères), retourne `{id, token, url}` une seule fois
  - `GET /api/devices/:id/tokens` — Métadonnées seulement, jamais de secret ni hash
  - `DELETE /api/devices/:id/tokens/:tokenId` — Révocation propre à cet appareil
  - `GET /api/devices/:id/history`
  - `GET /api/status` — online/offline (IP explicite, host, puis IPv4 en description)
  - `POST /api/wake/:mac` — Réveil JSON
  - `GET /wake/:nom?token=…` — Réveil HTML sans Basic ni origine seulement avec un token actif du bon appareil (nom, MAC ou id)
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
- Le champ `ip` IPv4 est prioritaire pour le ping/probe, suivi du `host` existant puis de la première IPv4 valide en description. La migration SQLite version 1 ajoute `ip`, `broadcast`, `probe_port` et reprend une fois les IP des anciennes descriptions sans les modifier.
- `probe_port` limite les sondes TCP à un port ; sinon 22/3389/445/80 sont sondés en parallèle après échec ICMP. Le `broadcast` de l'appareil remplace les cibles WoL globales.
- Sauvegarder `data/spark.db` de façon cohérente avant mise à jour ; les tests de migration utilisent une base temporaire, pas une base de production.

- La migration SQLite version 2 crée `wake_tokens` : `id`, `device_id` (FK `devices` avec `ON DELETE CASCADE`), `label`, `token_hash` (SHA-256 hex unique), `created_at`, `last_used_at`, `revoked_at`. `foreign_keys` reste activé ; le backfill des IP version 1 ne se répète pas.
- `tokenStore.js` génère 32 octets via `crypto.randomBytes(32).toString('base64url')` ; seul le hash persiste. Les tokens ne font pas partie des exports JSON et sont supprimés avec l'appareil. Ne jamais journaliser un token ou une URL complète contenant une query string.
- L'ordre des middlewares est important : `/health` public, limiteur d'échecs d'auth, reconnaissance du token sur le seul GET `/wake/:deviceId`, puis Basic Auth (sauf identité token validée). Un token ne donne accès à aucune autre route ; HEAD ne bénéficie pas du contournement. 401 identique pour token invalide, révoqué ou d'un autre appareil.
- Le limiteur de réveil s'applique aux tokens ; `last_used_at` est mis à jour pour un réveil autorisé et l'historique contient `triggered_by=token:<label ou id>`, y compris si l'envoi UDP échoue.
- L'exception User-Agent `Shortcuts` a été supprimée de `sameOrigin` : sans token, même les raccourcis doivent fournir une origine valide et Basic Auth si activée. Les écritures de gestion des tokens conservent les gardes existantes.
- Le logger masque les query strings, y compris dans les erreurs, ainsi que les champs sensibles. Helmet conserve `Referrer-Policy: no-referrer` et la CSP existante. HTTPS est recommandé et les logs du reverse proxy sont à configurer séparément.
- Le frontend conserve seulement en mémoire le secret nouvellement créé, le masque après fermeture du panneau et propose copie/liste/révocation par appareil. Les données utilisateur sont affichées via `textContent` ; ne pas ajouter de script inline. Le cache PWA version 2 distribue la nouvelle interface sans y stocker les réponses API ou de réveil.
