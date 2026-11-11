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
| **PWA**                         | `public/manifest.webmanifest`, `public/sw.js`       | Installable, page de repli hors ligne      |
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
  - `GET /api/events` — SSE authentifié : snapshot, status, remove, wake ; heartbeat 25 s
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
- Le frontend conserve seulement en mémoire le secret nouvellement créé, le masque après fermeture du panneau et propose copie/liste/révocation par appareil. Les données utilisateur sont affichées via `textContent` ; ne pas ajouter de script inline. Le cache PWA est versionné automatiquement par hash du contenu et ne stocke aucune réponse API, de réveil ou navigation authentifiée.

- SSE : `src/routes/events.js` expose `/api/events` derrière Basic Auth ; l’ancien `/api/status/stream` reste compatible (`change` au lieu de `status`). `SSE_MAX_CLIENTS` (défaut 20, entier positif) limite les deux routes ensemble, avec une réponse 503 française au-delà. Désactiver le buffering du reverse proxy (`proxy_buffering off` sous Nginx), respecter `X-Accel-Buffering: no` et un délai de lecture supérieur au heartbeat de 25 s.
- Le bus partagé `src/services/eventBus.js` transporte `wake` : `{type: 'wake', deviceId, state}` (`sent`, `confirmed`, `timeout`, `failed`). Les événements `change`/`remove` du poller sont reliés au flux sans modifier leur contrat ; la persistance de `ping_confirmed` reste identique. Sans adresse de sonde, seul `sent` est émis.
- `createEventsRouter` accepte `poller`, `bus`, `maxClients`, `heartbeatMs` pour les tests sans réseau. Un seul listener par source est partagé entre les clients ; la dernière fermeture retire les listeners et chaque fermeture annule son heartbeat. `closeAll()` ferme les flux avant `server.close()` sur SIGINT/SIGTERM ; les délais d’inactivité sont désactivés par flux.
- Le frontend EventSource utilise `/api/events`, reconnecte automatiquement, reprend le sondage pendant les erreurs et applique un nouveau snapshot à la reconnexion ; les réveils en attente sont resynchronisés via l’historique. Les messages français passent par `textContent` et `aria-live="polite"`. Le service worker `spark-<hash>` exclut toujours `/api/`, `/wake/` et `/health`, y compris SSE ; conserver la CSP sans script inline.

## Maintenance et durcissement (lot 6)

- Utiliser Node.js 22 pour toutes les commandes npm : si le Node système est différent, `npx --yes --package=node@22 --call "npm test"` (idem lint, format:check, audit). `better-sqlite3` est natif et doit correspondre à cette version.
- ESLint 9 : `eslint.config.js` (flat CommonJS), `@eslint/js` recommended, mêmes règles explicites qu'avant, globals Node pour backend/scripts/tests, navigateur pour modules frontend, service worker pour `public/sw.js`. Ne plus recréer `.eslintrc.json` ni `.eslintignore` ; les exclusions sont intégrées. Le worker fait désormais partie du lint.
- Dependabot : `.github/dependabot.yml`, npm/github-actions/docker hebdomadaires, groupes minor/patch. La CI vérifie l'audit de production au seuil high ; lancer aussi l'audit complet pour les outils dev. Ne pas utiliser `npm audit fix --force` sans examiner les ruptures.
- `src/routes/serviceWorker.js` expose une fabrique de handler appelée au chargement du serveur : lit `sw.js` et les seuls assets de `PRECACHE_ASSETS`, calcule SHA-256 tronqué à 16 caractères, remplace les marqueurs et sert un snapshot stable avec `Cache-Control: no-cache`. La route `/sw.js` précède `express.static`, après Basic Auth et sous Helmet. Ajouter chaque nouvel asset précaché dans cette liste et redémarrer après modification du contenu.
- SW : précache `offline.html` et assets statiques seulement, jamais `/` ni `index.html`. Assets en stale-while-revalidate ; navigations réseau d'abord puis page hors ligne en cas d'échec réseau, sans persistance du HTML. Aucune interception de `/api/`, `/wake/`, `/health`, des écritures, des autres origines ou fichiers inconnus. Ne jamais stocker de réponse non-ok ou redirigée, ni d'asset avec query string. Purger uniquement les anciens caches `spark-*` à l'activation. Page hors ligne française sans script/style inline, CSS existant ; réveils et gestion restent dépendants du réseau.
- Tests `tests/serviceWorker.test.js` : route réelle (auth, CSP, no-cache), version stable, invalidation pour chaque asset au redémarrage, précache, activation et stratégies via une VM Node et un adaptateur CacheStorage. Ce contrôle ne remplace pas un essai d'installation PWA sur téléphone.
- Docker : base Node 22 épinglée par version/digest multiarchitecture et installation verrouillée `npm ci --omit=dev`. Compose garde le volume `./data` et le réseau host pour WoL ; `read_only: true`, tmpfs `/tmp`, `cap_drop: ALL`, `cap_add: NET_RAW`, `security_opt: no-new-privileges:true`. Vérifier l'accès en écriture de l'utilisateur non-root au volume et le ping ICMP sur chaque hôte ; repli TCP si ICMP indisponible. Le test du lot 6 utilise exclusivement un conteneur bridge isolé et une base temporaire, jamais `docker compose up`.

## Réveils planifiés (lot 7)

- Migration SQLite cumulative `user_version=3` : `schedules` avec FK appareil `ON DELETE CASCADE`, `label`, `time` HH:MM, `days` texte CSV (0 dimanche à 6 samedi), `enabled` défaut 1, `last_run_at` UTC, `last_run_minute` locale, `last_status`, `created_at` ; `scheduler_settings` contient la clé `paused` persistante. Préserver la reprise v1 et les tokens v2 ; les tests historiques vérifient désormais la version cumulée 3.
- `src/services/scheduleStore.js` : repository, tableaux de jours / booléens en sortie API, stockage normalisé, plafond transactionnel de 20 par appareil, réservation atomique d’une minute avant tout envoi. La réservation vérifie aussi l’activation et la pause ; ne pas réinitialiser la clé lors d’un PATCH.
- `src/services/scheduler.js` : `createScheduler({now, intervalMs, timeZone, enabled, store, devices, wake, setIntervalFn, clearIntervalFn})`. `now()` retourne une Date ; défaut toutes les 30 s, fuseau `SCHEDULER_TZ` ou système via `Intl.DateTimeFormat`, `hourCycle=h23`. Un seul tick en vol, erreurs isolées, timer `unref`, `start()` idempotent avec tick initial, `stop()` annule le timer et attend les envois. `server.js` le démarre et l’arrête avant fermeture SQLite sur SIGINT/SIGTERM.
- `SCHEDULER_ENABLED=false` empêche toute exécution sans bloquer l’API. Aucun rattrapage des minutes manquées pendant arrêt/pause/tick occupé. Une reprise dans la minute prévue peut encore l’exécuter. Clé locale date+HH:MM persistée avant envoi : pas de doublon après redémarrage, ni pendant la minute répétée d’automne ; une heure inexistante au printemps est ignorée. Après crash entre réservation/envoi, un statut `running` peut rester sans nouvel essai dans la minute ; la prochaine échéance fonctionne. Pause/désactivation n’annulent pas un envoi déjà commencé.
- `performWake` est extrait sans changement de comportement dans `src/services/wakeService.js` et partagé avec les routes existantes. Le scheduler renseigne `triggered_by=schedule:<id>`, conserve le broadcast et la sonde par appareil, l’historique d’échec et les événements SSE `wake`. `last_status` vaut `running`, `sent` ou `failed` (résultat d’envoi, pas confirmation ping).
- `src/routes/schedules.js` : GET `/api/schedules`, POST `/api/devices/:id/schedules`, PATCH/DELETE `/api/schedules/:id`, GET/PUT `/api/schedules/state`. Basic Auth et gardes d’écriture existantes ; validation stricte des champs, heure 00:00–23:59, jours entiers uniques 0–6 non vides, libellé ≤60 caractères Unicode, booléens stricts. Le PATCH ne peut changer ni appareil ni état d’exécution ; erreurs françaises.
- UI dans les assets existants `index.html`, `js/app.js`, `js/api.js`, `style.css` : liste, formulaire, jours en cases, activation/suppression et pause clavier `role=switch` / `aria-checked`, messages `aria-live`, données utilisateur via `textContent`. La dernière tentative est affichée dans le fuseau navigateur. Rafraîchissement toutes les 30 s. Aucun script inline et aucune modification de CSP. Aucun nouvel asset : les JS/CSS modifiés sont déjà dans `PRECACHE_ASSETS`, donc le hash du lot 6 change automatiquement (test existant pour chaque asset).
- Tests `scheduleMigration`, `schedules`, `scheduler`, `schedulerLifecycle` : bases uniquement temporaires, horloges et timers injectés, `wolSender` et ping simulés avant chargement du service partagé ; incluent migration/idempotence, CRUD/auth/origine/cascade/plafond, pause, déduplication après réouverture de base, fuseau/jour/minuit et changements d’heure Paris 2026, échecs isolés, historique/SSE et arrêt. Ne jamais tester un vrai paquet WoL sur le LAN. Node 22 obligatoire : `npx --yes --package=node@22 --call "npm test"`, idem lint/format:check.
