# Spark

Spark est une application web légère qui permet de réveiller des ordinateurs à distance via le protocole Wake-on-LAN (WoL). Conçue pour tourner dans un conteneur Docker (typiquement sur un Raspberry Pi), elle propose une interface PWA installable sur mobile et des liens directs parfaits pour les raccourcis iOS.

## Fonctionnalités

- Interface web responsive, installable comme PWA
- Gestion des appareils (ajout, suppression, description / IP)
- Envoi de paquets Wake-on-LAN (broadcast UDP port 9)
- Statut online/offline en temps réel via ping ICMP / TCP probe (si une IP est configurée)
- Historique des réveils par appareil avec confirmation post-ping
- Liens directs (`/wake/<nom>`) pour raccourcis iPhone / Siri
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

| Variable          | Défaut | Rôle                                              |
| ----------------- | ------ | ------------------------------------------------- |
| `PORT`            | `8085` | Port d'écoute                                     |
| `LOG_LEVEL`       | `info` | `debug` / `info` / `warn` / `error`               |
| `AUTH_USER`       | (vide) | Utilisateur Basic Auth — si vide, auth désactivée |
| `AUTH_PASS`       | (vide) | Mot de passe Basic Auth                           |
| `TRUST_PROXY`     | `0`    | Proxies de confiance pour les en-têtes transmis   |
| `WAKE_RATE_LIMIT` | `10`   | Nombre max de réveils par minute par IP           |

L'authentification est désactivée dès que `AUTH_USER` ou `AUTH_PASS` est vide ; Spark journalise alors un avertissement au démarrage. Configure les deux valeurs pour protéger l'accès. Avec `NODE_ENV=production`, le mot de passe `changeme` empêche le démarrage.

## Reverse proxy HTTPS

Pour un accès via un nom de domaine, configure un reverse proxy (par exemple Nginx ou Caddy) qui termine HTTPS et transmet les requêtes vers `http://127.0.0.1:8085` (ou le port configuré). Utilise HTTPS avec Basic Auth, car les identifiants sont simplement encodés en base64.

Le proxy doit conserver l'en-tête `Host` d'origine et remplacer les en-têtes `X-Forwarded-Proto` et `X-Forwarded-For` par le protocole et l'adresse du client. Cela permet notamment à la vérification d'origine et aux limites par IP de fonctionner derrière HTTPS.

`TRUST_PROXY=0` reste adapté à un accès direct. Avec un proxy sur la même machine, utilise `TRUST_PROXY=loopback`. `TRUST_PROXY=1` convient si toutes les requêtes passent par exactement un proxy ; limite alors l'accès direct au port Spark au seul proxy. Adapte cette valeur à la topologie réelle pour que les clients ne puissent pas imposer leurs propres en-têtes transmis.

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
2. Saisis nom, MAC (format libre — `XX:XX:XX:XX:XX:XX` ou `XXXXXXXXXXXX`) et optionnellement une IP en description.
3. Si tu mets une IP, Spark va l'utiliser pour vérifier l'état online/offline et confirmer les réveils via ping/TCP probe.

### Raccourcis iPhone

Récupère le lien direct dans la section _"Liens directs pour raccourcis"_ puis :

1. App **Raccourcis** → "+"
2. Ajouter une action **"Obtenir le contenu de l'URL"** → coller l'URL.
3. Donner un nom au raccourci.
4. Ajouter à l'écran d'accueil ou activer via Siri.

Si tu as activé l'auth, ajoute les credentials dans le raccourci via _"Show More"_ → en-tête `Authorization: Basic <base64(user:pass)>`.

## Logs

Les logs vont sur `stdout`/`stderr` du conteneur, Docker se charge de la rotation (10 Mo × 5 fichiers).

```bash
docker-compose logs -f spark              # live
docker-compose logs --tail=200 spark      # historique
docker-compose logs spark 1>/dev/null     # seulement WARN/ERROR
```

## Endpoints API

| Méthode | Route                      | Description                                           |
| ------- | -------------------------- | ----------------------------------------------------- |
| GET     | `/api/devices`             | Liste les appareils                                   |
| POST    | `/api/devices`             | Ajoute un appareil — `{ name, mac, description? }`    |
| DELETE  | `/api/devices/:mac`        | Supprime un appareil                                  |
| GET     | `/api/devices/:id/history` | 20 derniers réveils                                   |
| GET     | `/api/status`              | Statut online/offline (basé sur l'IP en description)  |
| POST    | `/api/wake/:mac`           | Réveille un appareil (réponse JSON)                   |
| GET     | `/wake/:nom`               | Réveille un appareil (réponse HTML, idéal raccourcis) |
| GET     | `/health`                  | Healthcheck (bypass auth)                             |

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

Stack : Node.js 22, Express 4, better-sqlite3, Helmet, express-rate-limit. Aucun framework côté frontend (vanilla JS modulaire + service worker).

## Développement

```bash
npm install
cp .env.example .env
npm start                  # dev local
npm test                   # tests (node --test, supertest)
```

## Mises à jour

```bash
git pull
docker-compose up -d --build
```

## Licence

MIT
