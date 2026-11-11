# Spark

Spark est une application web légère qui permet de réveiller des ordinateurs à distance via le protocole Wake-on-LAN (WoL). Conçue pour tourner dans un conteneur Docker (typiquement sur un Raspberry Pi), elle propose une interface PWA installable sur mobile et des liens directs parfaits pour les raccourcis iOS.

## Fonctionnalités

- Interface web responsive, installable comme PWA avec page de repli hors ligne
- Gestion des appareils (ajout, modification, suppression, IP et description séparées)
- Envoi de paquets Wake-on-LAN (broadcast UDP port 9)
- Statut online/offline en temps réel via ping ICMP / TCP probe (si une IP est configurée)
- Historique des réveils par appareil avec confirmation post-ping
- Liens secrets par appareil (`/wake/<nom>?token=…`) pour raccourcis iPhone / Siri
- Authentification Basic optionnelle, rate-limit, CSP via Helmet
- Stockage SQLite, logs Docker avec rotation automatique

## Prérequis

- Docker et Docker Compose
- Un réseau local où le broadcast UDP fonctionne (mode `network: host` indispensable)
- Des appareils cibles avec Wake-on-LAN activé dans le BIOS/UEFI

## Installation

```bash
git clone https://github.com/ycnslh/spark.git
cd spark

# Crée ton .env (au minimum les credentials)
cp .env.example .env
# édite .env

docker-compose up -d --build
```

Puis ouvre `http://<ip-de-ton-serveur>:8085` (port défini par `PORT` dans `.env`).

## Configuration

Toutes les options sont dans [.env.example](.env.example) :

| Variable              | Défaut | Rôle                                                              |
| --------------------- | ------ | ----------------------------------------------------------------- |
| `PORT`                | `8085` | Port d'écoute                                                     |
| `LOG_LEVEL`           | `info` | `debug` / `info` / `warn` / `error`                               |
| `AUTH_USER`           | (vide) | Utilisateur Basic Auth — si vide, auth désactivée                 |
| `AUTH_PASS`           | (vide) | Mot de passe Basic Auth                                           |
| `TRUST_PROXY`         | `0`    | Proxies de confiance pour les en-têtes transmis                   |
| `SSE_MAX_CLIENTS`     | `20`   | Connexions SSE simultanées (entier strictement positif)           |
| `WAKE_RATE_LIMIT`     | `10`   | Nombre max de réveils par minute par IP                           |
| `WOL_BROADCAST`       | (vide) | Adresse cible unique, prioritaire sur la détection des interfaces |
| `WOL_ALL_INTERFACES`  | `true` | Ajouter les broadcasts des interfaces IPv4 non internes           |
| `WOL_REPEAT_DELAY_MS` | `2000` | Délai du second envoi en arrière-plan (ms), `0` le désactive      |
| `WOL_PORT`            | `9`    | Port UDP des paquets WoL                                          |

L'authentification est désactivée dès que `AUTH_USER` ou `AUTH_PASS` est vide ; Spark journalise alors un avertissement au démarrage. Configure les deux valeurs pour protéger l'accès. Avec `NODE_ENV=production`, le mot de passe `changeme` empêche le démarrage.

Par défaut, Spark envoie le paquet magique aux broadcasts dirigés de chaque interface IPv4 non interne (calculés à partir de l'adresse et du masque), ainsi qu'à `255.255.255.255`, sans doublons. Avec `WOL_ALL_INTERFACES=false`, seul `255.255.255.255` est utilisé. Si `WOL_BROADCAST` est défini (par exemple `192.168.1.255`), cette adresse devient la seule cible, quelle que soit la valeur de `WOL_ALL_INTERFACES`. Ces réglages sont globaux pour tous les appareils.

Un broadcast IPv4 renseigné dans les options avancées d'un appareil remplace ces réglages globaux pour cet appareil uniquement, y compris pour le second envoi.

Le premier envoi réussit dès lors qu'au moins une cible accepte l'envoi UDP ; cela ne garantit pas que l'appareil s'est réveillé. Après ce premier envoi, Spark programme un second envoi après `WOL_REPEAT_DELAY_MS`, sans retarder la réponse HTTP ni la faire échouer. Ses résultats et les erreurs par cible sont journalisés au niveau `debug`. Utilise `WOL_REPEAT_DELAY_MS=0` pour désactiver cette répétition.

## Reverse proxy HTTPS

Pour un accès via un nom de domaine, configure un reverse proxy (par exemple Nginx ou Caddy) qui termine HTTPS et transmet les requêtes vers `http://127.0.0.1:8085` (ou le port configuré). Utilise HTTPS avec Basic Auth, car les identifiants sont simplement encodés en base64.

Le proxy doit conserver l'en-tête `Host` d'origine et remplacer les en-têtes `X-Forwarded-Proto` et `X-Forwarded-For` par le protocole et l'adresse du client. Cela permet notamment à la vérification d'origine et aux limites par IP de fonctionner derrière HTTPS.

`TRUST_PROXY=0` reste adapté à un accès direct. Avec un proxy sur la même machine, utilise `TRUST_PROXY=loopback`. `TRUST_PROXY=1` convient si toutes les requêtes passent par exactement un proxy ; limite alors l'accès direct au port Spark au seul proxy. Adapte cette valeur à la topologie réelle pour que les clients ne puissent pas imposer leurs propres en-têtes transmis.

Le flux `GET /api/events` utilise Server-Sent Events (SSE), sous la même Basic Auth que l’API. Il envoie un événement `snapshot` initial (`[{id, online}]`), puis `status` (`{id, online}`), `remove` (`{id}`) et `wake` (`{type: "wake", deviceId, state}` ; états `sent`, `confirmed`, `timeout`, `failed`). Un commentaire heartbeat maintient la connexion toutes les 25 secondes. Le plafond global `SSE_MAX_CLIENTS=20` inclut l’ancien endpoint compatible `/api/status/stream` ; au-delà, le serveur répond 503. À l’arrêt, les flux sont fermés avant le serveur HTTP.

Désactive le buffering du reverse proxy pour `/api/events` (Nginx : `proxy_buffering off;`, Spark envoie aussi `X-Accel-Buffering: no`) et prévois un délai de lecture supérieur à 25 secondes. Le navigateur reprend automatiquement le sondage toutes les 30 secondes en cas de coupure, puis resynchronise les statuts à la reconnexion SSE. Les API, dont ce flux, sont exclues du cache du service worker.

## Migration depuis l'ancienne version (CSV)

Si tu viens d'une ancienne installation NetArise avec `devices.csv` :

```bash
npm install
npm run migrate
```

La commande `npm run migrate` exécute `scripts/migrate-csv-to-sqlite.js`. Elle nécessite une installation complète avec les dépendances de développement (`npm install`, ou `npm install --include=dev` si `NODE_ENV=production`), car `csv-parse` est une dépendance de développement. Une installation avec `npm install --omit=dev` ne suffit pas pour cette migration.

Le script lit `devices.csv` et insère les appareils dans `data/spark.db`. Les doublons sont ignorés. Tu peux ensuite supprimer `devices.csv`.

## Configuration du Wake-on-LAN sur Windows

1. **BIOS/UEFI** : activer "Wake-on-LAN", "Power on by PCI-E" ou similaire.
2. **Gestionnaire de périphériques** → carte réseau → onglet "Gestion de l'alimentation" : cocher _"Autoriser ce périphérique à sortir l'ordinateur du mode veille"_ et _"Autoriser uniquement un Magic Packet"_.
3. **Démarrage rapide** : Panneau de configuration → Options d'alimentation → décocher _"Activer le démarrage rapide"_ (sinon Windows hiberne au lieu de s'éteindre, et le WoL ne fonctionne pas après un shutdown).

## Utilisation

### Ajouter un appareil

1. Bouton "Ajouter un appareil"
2. Saisis nom, MAC (format libre — `XX:XX:XX:XX:XX:XX` ou `XXXXXXXXXXXX`) et optionnellement une adresse IPv4 dans le champ IP.
3. Spark utilise cette IP pour vérifier l'état online/offline et confirmer les réveils. Le ping ICMP est essayé d'abord ; en cas d'échec, les sondes TCP sont lancées en parallèle sur 22, 3389, 445 et 80, et s'arrêtent au premier succès. Un port de sonde configuré (entier de 1 à 65535) remplace cette liste.
4. Dans les options réseau avancées, renseigne éventuellement le broadcast IPv4 propre à l'appareil ou conserve un host de secours (IPv4, IPv6 ou nom d'hôte). Le bouton crayon permet de modifier ces champs ensuite ; laisse un champ vide pour l'effacer.

L'ordre de résolution est : IP explicite, host existant, puis première IPv4 valide dans la description. Au premier démarrage après mise à jour, Spark ajoute automatiquement les colonnes `ip`, `broadcast` et `probe_port` à SQLite et copie la première IPv4 valide des anciennes descriptions vers `ip`, sans modifier les descriptions. Cette migration s'exécute une seule fois ; effacer une IP plus tard ne relance pas cette copie. Les anciens exports JSON restent importables ; les nouveaux exports incluent les trois champs.

### Raccourcis iPhone

Chaque token autorise uniquement le réveil de l'appareil auquel il appartient. Tu peux créer plusieurs tokens par appareil (par exemple un par téléphone), les nommer, consulter leur dernière utilisation et les révoquer séparément.

1. Connecte-toi à Spark avec tes identifiants habituels et ouvre **Raccourcis iPhone — tokens** dans la fiche de l'appareil.
2. Saisis éventuellement un libellé puis clique sur **Créer un token**.
3. Copie immédiatement l'URL avec token dans **Liens directs pour raccourcis**. Le token et son URL ne sont affichés qu'à la création, jusqu'à la fermeture du panneau, au masquage ou au rechargement ; ils ne seront pas récupérables ensuite. Crée un nouveau token si tu les perds et révoque l'ancien.
4. Dans l'app **Raccourcis** sur iPhone, crée un raccourci avec l'action **Obtenir le contenu de l'URL**, colle cette URL et conserve la méthode **GET**. Aucun en-tête Authorization n'est nécessaire.
5. Donne un nom au raccourci et ajoute-le à l'écran d'accueil ou utilise Siri.

Utilise **HTTPS** : le token est un secret transmis dans l'URL, et toute personne qui possède ce lien peut réveiller cet appareil. Ne partage pas ce lien publiquement. Spark masque les query strings dans ses logs applicatifs et envoie `Referrer-Policy: no-referrer`, mais les logs d'un reverse proxy peuvent contenir l'URL complète : configure leur masquage ou désactive la journalisation de ces URL. L'historique de navigation et le raccourci lui-même peuvent aussi conserver le lien.

Pour couper un accès, clique sur **Révoquer** dans la fiche de l'appareil ; supprimer l'appareil supprime aussi ses tokens. La liste affiche seulement le libellé, les dates et l'état, jamais le secret. Un renommage conserve la validité des URL générées, qui utilisent la MAC.

**Migration depuis l'ancienne méthode :** crée un token pour chaque appareil, remplace l'ancienne URL du raccourci par le lien secret et supprime son ancien en-tête Authorization. L'exception fondée sur le User-Agent `Shortcuts` a été retirée : sans token, `GET /wake/:nom` exige désormais une origine (`Origin` ou `Referer`) valide, ainsi que Basic Auth lorsque configurée. Les anciens raccourcis avec Basic Auth seul et sans origine doivent donc être mis à jour.

La migration SQLite vers `user_version=2` crée automatiquement la table des tokens, sans relancer la reprise des IP du lot précédent. Les secrets sont générés aléatoirement (32 octets) et seuls leurs hash SHA-256 sont stockés.

## Logs

Les logs vont sur `stdout`/`stderr` du conteneur, Docker se charge de la rotation (10 Mo × 5 fichiers).

```bash
docker-compose logs -f spark              # live
docker-compose logs --tail=200 spark      # historique
docker-compose logs spark 1>/dev/null     # seulement WARN/ERROR
```

## Endpoints API

| Méthode | Route                              | Description                                                                               |
| ------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| GET     | `/api/devices`                     | Liste les appareils                                                                       |
| POST    | `/api/devices`                     | Ajoute un appareil — `{ name, mac, description?, host?, ip?, broadcast?, probe_port? }`   |
| PATCH   | `/api/devices/:id`                 | Modifie nom, description, host et champs réseau ; `null` efface un champ réseau optionnel |
| DELETE  | `/api/devices/:mac`                | Supprime un appareil                                                                      |
| POST    | `/api/devices/:id/tokens`          | Crée `{label?}` et retourne `{id, token, url}` une seule fois                             |
| GET     | `/api/devices/:id/tokens`          | Liste les métadonnées des tokens, sans secret                                             |
| DELETE  | `/api/devices/:id/tokens/:tokenId` | Révoque un token de cet appareil                                                          |
| GET     | `/api/devices/:id/history`         | 20 derniers réveils                                                                       |
| GET     | `/api/events`                      | Flux SSE authentifié de statut et de réveil                                               |
| GET     | `/api/status`                      | Statut online/offline via IP, host ou ancienne description                                |
| POST    | `/api/wake/:mac`                   | Réveille un appareil (réponse JSON)                                                       |
| GET     | `/wake/:nom`                       | Réveille un appareil ; token valide de cet appareil ou Basic + origine                    |
| GET     | `/health`                          | Healthcheck (bypass auth)                                                                 |

## Architecture

```
spark/
├── src/
│   ├── server.js              # bootstrap Express
│   ├── config.js              # variables d'env centralisées
│   ├── middleware/            # auth, rate limit
│   ├── routes/                # devices, wake, status, health
│   ├── services/              # db, deviceStore, wolSender, pinger
│   └── utils/                 # logger, mac, html
├── public/                    # PWA: index.html, style.css, js/, sw.js, manifest
├── scripts/migrate-csv-to-sqlite.js
├── tests/                     # node --test
├── data/spark.db              # DB SQLite (volume Docker)
├── Dockerfile                 # multi-stage, user non-root, tini
└── docker-compose.yml
```

Les routes de gestion des tokens suivent les mêmes protections Basic Auth et gardes d'écriture que les appareils (Basic désactivée seulement si les identifiants ne sont pas configurés). Un token ne donne accès à aucune autre API. Seul `GET /wake/:nom?token=…` contourne Basic et l'origine pour l'appareil correspondant (nom, MAC ou id) ; les tokens invalides, révoqués ou d'un autre appareil renvoient le même 401 et comptent dans le limiteur d'échecs d'authentification. Le limiteur de réveil reste actif.

Stack : Node.js 22, Express 4, better-sqlite3, Helmet, express-rate-limit. Aucun framework côté frontend (vanilla JS modulaire + service worker).

## Développement

```bash
npm install
cp .env.example .env
npm start                  # dev local
npm test                   # tests (node --test, supertest)
npm run lint               # ESLint 9, configuration flat
npm run format:check       # Prettier
```

Utilise Node.js 22 pour le développement et les dépendances natives SQLite. Si le Node par défaut est différent, lance les commandes via `npx --yes --package=node@22 --call "npm test"` (idem pour `npm run lint`, `npm run format:check` et `npm audit`). Après un changement de version Node, réinstalle les dépendances natives avec cette version.

ESLint 9 utilise `eslint.config.js` : règles recommandées et règles du projet, backend/scripts/tests en CommonJS Node, `public/js/` en modules navigateur et `public/sw.js` en environnement service worker. Les exclusions `node_modules`, `data` et `coverage` sont dans cette configuration. Voir le [guide de migration ESLint](https://eslint.org/docs/latest/use/configure/migration-guide).

## Cache PWA et mode hors ligne

`GET /sw.js` est servi par Express avant les fichiers statiques, sous la même authentification et CSP (`script-src 'self'`). Il porte `Cache-Control: no-cache`. Au démarrage, le serveur calcule un SHA-256 tronqué à 16 caractères à partir du worker et du contenu des fichiers précachés ; aucun numéro de cache n'est à maintenir à la main. Redémarre Spark après une modification des assets. La liste est centralisée dans `src/routes/serviceWorker.js` : y ajouter les futurs fichiers statiques à précacher.

Seuls `offline.html`, les CSS, l'icône, le manifest et les modules JS sont précachés. Les assets utilisent stale-while-revalidate : réponse du cache puis mise à jour en arrière-plan. Les navigations passent d'abord par le réseau et affichent `offline.html` si le réseau échoue ; aucune page authentifiée (`/` et `index.html` compris) n'est enregistrée. `/api/` (dont SSE), `/wake/` et `/health` contournent entièrement le worker. Les réponses non réussies ou redirigées, les autres origines et les URL d'assets avec query string ne sont jamais mises en cache. À l'activation, les anciens caches `spark-*` sont supprimés.

La page hors ligne est en français, utilise le CSS existant et ne contient aucun script inline. Le serveur doit avoir été visité en ligne pour installer ce cache ; la gestion et le réveil des appareils nécessitent le réseau. Les mises à jour du worker suivent le cycle du navigateur ; HTTPS (ou localhost) est nécessaire à son enregistrement.

## Docker durci

L'image utilise Node 22 épinglé par version et digest multiarchitecture, un utilisateur non-root et `npm ci --omit=dev`. Compose conserve `./data:/app/data` comme seul stockage persistant : système racine en lecture seule, `/tmp` en tmpfs, toutes les capabilities retirées sauf `NET_RAW` pour ICMP, et `no-new-privileges:true` pour bloquer l'élévation de privilèges. Le dossier `./data` doit être accessible en écriture par l'utilisateur `app` de l'image ; ne change pas les droits d'une base existante sans vérifier son propriétaire.

Le mode réseau host de Compose sert au broadcast WoL sur le réseau local. Les tests isolés peuvent tourner en bridge avec un port publié et un volume temporaire ; ils ne valident pas le broadcast sur le LAN. ICMP dépend aussi du noyau et des permissions des sockets ping ; les sondes TCP restent disponibles en repli.

## Mises à jour

Dependabot vérifie chaque semaine npm, les GitHub Actions et l'image Docker ; les mises à jour mineures/patch sont regroupées par écosystème. La CI exécute `npm audit --omit=dev --audit-level=high` en plus du lint, du formatage et des tests. Examiner les changements majeurs séparément et relancer `npm audit` complet pour les outils de développement.

Sauvegarde `data/spark.db` avant toute mise à jour, avec une sauvegarde SQLite cohérente (API de sauvegarde SQLite, ou application arrêtée). La migration automatique doit être validée sur une copie de ta base avant une mise à jour en production.

```bash
git pull
docker-compose up -d --build
```

## Licence

MIT
