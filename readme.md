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
git clone https://github.com/soulkill3r/Spark.git spark
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
| `WAKE_RATE_LIMIT` | `10`   | Nombre max de réveils par minute par IP           |

## Migration depuis l'ancienne version (CSV)

Si tu viens d'une ancienne installation NetArise avec `devices.csv` :

```bash
npm install
npm run migrate
```

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
