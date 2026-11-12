# Mise à jour des dépendances Spark — 12 novembre 2026

Base : `main` au commit `4782ef0`, branche `ycnslh/spark-dernieres-versions`.
Travail limité à ce worktree ; aucun push, merge, déploiement, changement de `.env`
ou de `data/`. Aucun worker auxiliaire. Les sources et guides de migration ont été
lus avant les mises à jour majeures ; chaque majeure a été testée avant la suivante.

## Versions npm

Chaque dernière version a été interrogée avec `npm view <paquet> version`.
« Avant » indique la plage et, entre parenthèses, la version du lockfile initial.
Les versions finales du lockfile correspondent exactement aux planchers indiqués.

| Dépendance         | Avant              | Après    |
| ------------------ | ------------------ | -------- |
| better-sqlite3     | ^13.1.1 (13.1.1)   | ^13.1.1  |
| express            | ^4.21.0 (4.22.3)   | ^5.3.0   |
| express-rate-limit | ^8.7.4 (8.7.4)     | ^8.7.4   |
| helmet             | ^8.0.0 (8.3.0)     | ^8.3.0   |
| pino               | ^9.5.0 (9.14.0)    | ^10.4.0  |
| @eslint/js         | ^10.0.1 (10.0.1)   | ^10.0.1  |
| csv-parse (dev)    | ^5.5.6 (5.6.0)     | ^7.0.3   |
| eslint             | ^10.14.0 (10.14.0) | ^10.14.0 |
| globals            | ^17.14.0 (17.14.0) | ^17.14.0 |
| pino-pretty        | ^13.2.0 (13.2.0)   | ^13.2.0  |
| prettier           | ^3.3.0 (3.10.0)    | ^3.10.1  |
| supertest          | ^7.0.0 (7.3.2)     | ^7.3.2   |

`npm ls --depth=0` dans le conteneur Node 26 confirme ces douze versions installées.
`npm outdated` n'affiche rien et termine avec le code **0** après `npm ci`.

## Docker et CI

| Élément                     | Avant                                                                   | Après / vérification                                                    |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Base des deux stages Docker | node:26.13.0-alpine                                                     | node:26.13.1-alpine3.24                                                 |
| Digest de base              | sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 | sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 |
| actions/checkout            | @v7                                                                     | @v7 conservé : dernière release v7.0.1                                  |
| actions/setup-node          | @v7                                                                     | @v7 conservé : dernière release v7.1.0                                  |

La liste Docker Hub a été consultée puis la référence exacte résolue par :

```bash
docker pull node:26.13.1-alpine3.24
docker image inspect node:26.13.1-alpine3.24 --format '{{json .RepoDigests}}'
```

Résultat réel : `node@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5`.
Les [releases checkout](https://github.com/actions/checkout/releases/latest) et
[setup-node](https://github.com/actions/setup-node/releases/latest) ont été vérifiées
via l'API GitHub. `.github/workflows/ci.yml` était déjà sur les dernières majeures,
avec la matrice 22/24/26 : aucune modification nécessaire.

## Commits

| Commit  | Contenu                                                                  |
| ------- | ------------------------------------------------------------------------ |
| fc6a7ac | chore(deps): migrer Express vers 5.3 et vérifier les contrats HTTP       |
| b83d3ae | chore(deps): passer Pino à 10.4 et vérifier la redaction                 |
| d080669 | chore(deps): migrer csv-parse vers 6 et tester la reprise CSV            |
| 23d0c20 | chore(deps): achever la migration csv-parse en 7.0.3                     |
| 8ac740f | chore(deps): relever le plancher de Helmet à 8.3.0                       |
| 7518ce6 | chore(deps): actualiser Prettier et Supertest et documenter les versions |
| 2898a1e | chore(deps): épingler Node 26.13.1 Alpine 3.24 au digest vérifié         |
| 8a6d347 | fix: stabiliser la fermeture du logger dev avec SQLite sous Node 26      |

Le commit de clôture ajoute les scripts de vérification et ce rapport ; son identifiant
est disponible avec `git log --oneline 4782ef0..HEAD`.

## Comportements et migrations

- [Express 5](https://expressjs.com/en/guide/migrating-5/) : path-to-regexp 8 et jokers
  nommés `/*splat` / `/{*splat}` vérifiés. Les routes Spark n'utilisent aucun joker
  ancien ni méthode retirée. Les tableaux de chemins `app.use` des planifications
  préservent paramètres et gardes d'écriture.
- `req.query` est un getter avec parseur simple ; `Object.hasOwn` était déjà utilisé
  dans `wakeTokenAuth`. Aucun middleware ne réaffecte query. Les paramètres token
  répétés, structurés et les clés de prototype ne donnent aucun accès.
- Sans parseur applicable, `req.body` peut être absent ; les gardes existantes le
  traitent. Les rejets async atteignent désormais le gestionnaire global 500 JSON.
  Un test provoque une exception dans le vrai handler async `/api/status` et vérifie
  ce contrat, sans ajouter de route de diagnostic en production.
- Les routes inconnues restent en 404 HTML après Basic Auth. Health reste public,
  la reconnaissance du token précède Basic, `/sw.js` précède static, et les fichiers
  cachés restent ignorés. Les scripts statiques sont désormais servis en
  `text/javascript` ; le service worker garde son type explicite. Trust proxy,
  Helmet, les limiteurs, la fermeture et les délais SSE restent inchangés.
- [Pino 10](https://github.com/pinojs/pino/releases/tag/v10.0.0) retire Node 18,
  déjà exclu par Spark. Les options et
  [hooks.logMethod](https://github.com/pinojs/pino/blob/v10.4.0/docs/api.md#logmethod)
  utilisés restent compatibles. La redaction récursive avant sérialisation, les
  erreurs, enfants et le transport pretty passent les tests. Le flux de développement a été corrigé après découverte
  d’un crash de fermeture (voir ci-dessous).
- [Changelog csv-parse](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md) :
  étapes 5 → 6.2.1 → 7.0.3 testées séparément. L'API CommonJS
  [csv-parse/sync](https://csv.js.org/parse/api/sync/) et les options du script de
  migration restent compatibles. La 7.0.0 est décrite comme majeure accidentelle ;
  la 7.0.2 corrige le remplacement de prototype via les colonnes.

Les assertions historiques n'ont pas été affaiblies. Dix tests
supplémentaires portent sur Express 5, le transport Pino et la migration CSV réelle.
Le comportement historique du JSON malformé reste **500** via le gestionnaire global
(il ne devient pas 400 dans cette mission).

## Commandes et résultats réels

Toutes les installations natives ont eu lieu dans des conteneurs bridge avec
python3, make et g++. Aucun `npm ci` n'a été exécuté sur l'hôte sans compilateur.
Les sources étaient montées en lecture seule puis copiées dans le conteneur en
excluant `.env*`, `data/`, `.git` et `node_modules`.

| Runtime réel             | npm ci | lint | format:check | npm test         |
| ------------------------ | ------ | ---- | ------------ | ---------------- |
| Node 22.23.5 Alpine      | OK     | OK   | OK           | 168/168, 0 échec |
| Node 24.22.3 Alpine      | OK     | OK   | OK           | 168/168, 0 échec |
| Node 26.13.1 Alpine 3.24 | OK     | OK   | OK           | 168/168, 0 échec |

Les étapes Express, Pino, CSV 6 et CSV 7 ont respectivement passé **163**, **164**,
**167** et **167** tests sous Node 26 avant le commit correspondant.

```bash
sh scripts/verify-in-docker.sh node:22-alpine
sh scripts/verify-in-docker.sh node:24-alpine
sh scripts/verify-in-docker.sh node:26.13.1-alpine3.24
sh scripts/verify-image-in-docker.sh
```

Le script Node 26 exécute aussi `node scripts/smoke-server.js` avec le vrai `start()`
du serveur sur port dynamique (`config.port=0`), SQLite jetable, production et aucun
`RATE_LIMIT_DISABLED`. Les trois limiteurs sont actifs : wake 2 puis 429, écritures
30 puis 429, échecs auth 5 puis 429. Des IP documentaires distinctes via un proxy de
test loopback isolent les compteurs. Chaque famille de routes a été exercée :

- `/`, module JS statique, `/sw.js`, `/health` public ;
- appareils ajout/liste/modification/suppression, tags et association ;
- import JSON vers SQLite et export avec tags, sans tokens ;
- tokens création/liste/révocation, réveils POST et GET avec token et origine absente ;
- historique de deux envois UDP réels vers **127.0.0.1 uniquement** ;
- planifications CRUD et pause, status/refresh ;
- `/api/events` avec lecture d'un vrai snapshot SSE et fermeture ;
- route inconnue 404 et JSON malformé dans le vrai gestionnaire d'erreur ;
- absence du token secret dans les logs du processus, arrêt propre du serveur.

La vraie image a été construite puis lancée en bridge avec port publié éphémère,
`read-only`, tmpfs `/tmp`, `cap-drop ALL`, `cap-add NET_RAW` et
`no-new-privileges:true`. L'inspection confirme l'utilisateur `app` et ces options.
Résultats : `/health` 200, création d'appareil 201, base `/tmp/spark.db` relue via
une seconde connexion, intégrité SQLite `ok`, journal WAL et utilisateur non-root.
Le healthcheck Docker du premier conteneur est aussi devenu `healthy`.

## Audit et limites

| Commande             | Résultat                       | Code |
| -------------------- | ------------------------------ | ---- |
| npm outdated         | aucune ligne                   | 0    |
| npm audit --omit=dev | 0 vulnérabilité                | 0    |
| npm audit            | 4 alertes modérées, toutes dev | 1    |

L'alerte restante est
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249),
déni de service potentiel par amplification de globparts dans minimatch.
Plage affectée : `>=7.0.0 <11.0.1` ; installé : **10.2.6**. Propagation précise :

| Paquet signalé par npm audit | Version | Cause                                       |
| ---------------------------- | ------- | ------------------------------------------- |
| minimatch                    | 10.2.6  | vulnérabilité directe                       |
| @eslint/config-array         | 0.23.5  | dépend de minimatch ^10.2.4                 |
| eslint                       | 10.14.0 | dépend de minimatch ^10.2.6 et config-array |
| @eslint/js                   | 10.0.1  | propagation via son peer ESLint             |

La dernière version 10.x publiée de minimatch est 10.2.6. Le correctif 11.x sort
des plages déclarées par ESLint ; l'audit propose ESLint **9.39.5** avec `--force`,
ce qui contredirait la demande de dernières majeures. Aucune rétrogradation ni
override majeur non supporté n'a été imposé. Refaire l'audit après publication
d'une correction compatible et mettre à jour le lockfile dans un commit séparé.

Les tests ne valident ni le broadcast WoL du LAN, ni une base de production,
ni le rendu physique iPhone, ni l'exécution GitHub Actions distante. Le test de
l'image utilise une base tmpfs jetable, pas le volume de production. Le script CSV
reste dev-only : installer les dépendances dev pour migrer un ancien CSV avant
de construire l'image production.

## Reprise et preuves

Relancer les quatre commandes de vérification ci-dessus ; elles créent et suppriment
leurs propres conteneurs `spark-*`, sans `docker compose up` ni réseau host. Le script
d'image supprime aussi son tag `spark-deps-test-*`. Les caches et images préexistants
sont préservés. Pour les audits, exécuter `npm outdated`, `npm audit` et
`npm audit --omit=dev` dans une copie installée en conteneur, après `npm ci`.

Les journaux de cette session restent hors Git dans `/tmp/` :
`spark-express5-f1d038.log`, `spark-pino10-f1d038.log`, `spark-csv6-f1d038.log`,
`spark-csv7-f1d038.log`, `spark-final22-f1d038.log`, `spark-final24-f1d038.log`,
`spark-final26-f1d038.log`, `spark-audits-f1d038.log`, `spark-build-f1d038.log`,
`spark-runtime-f1d038.log` et `spark-image-final-f1d038.log`.

Vérification finale : `git diff --check` passe ; aucun conteneur ou tag d'image
`spark-*` ne reste après nettoyage. Le tag précis de base ajouté pendant la mission
a aussi été retiré, en conservant l'image Node 26 déjà présente et les caches utiles.
Les builds ont été vérifiés sur l'architecture hôte **x86_64**, pas sur ARM.
Aucun déploiement n'est nécessaire pour examiner ces commits.

## Crash de fermeture découvert et corrigé

Une vérification finale a effectivement échoué sous Node 26 : les huit assertions
`deviceStore` étaient vertes, puis le processus enfant est mort avec **SIGSEGV**.
La sortie TAP confirme le signal, sans assertion SQLite en échec. Le scénario a été
reproduit avec le logger pretty en worker sous Pino **10.4.0**, puis sous Pino
**9.14.0** installé uniquement dans `/tmp` du conteneur ; c'est donc aussi observable
avec l'ancienne majeure. En mode production sans transport worker, 30 répétitions
ont réussi. La cause native exacte n'a pas été déterminée.

Le correctif applicatif remplace seulement le transport pretty de développement
par le [flux direct officiel](https://github.com/pinojs/pino-pretty#usage-as-a-stream)
avec `sync: true`. Il évite le worker et termine les écritures avant la sortie ;
le format, les niveaux et le hook de redaction sont conservés. Le seul changement
observable ajouté est une écriture synchrone des logs dev ; les logs JSON production
restent identiques. Aucune assertion n'a été retirée et les logs dev restent actifs.

Après correction : 30/30 répétitions du même fichier `deviceStore`, puis un nouveau
test vérifiant dix processus courts avec SQLite réelle, fermeture propre et
redaction des secrets. Les matrices finales comprennent **168 tests**. Les journaux
supplémentaires sont `/tmp/spark-final26-transient-f1d038.log`,
`/tmp/spark-device-repeat-f1d038.log`, `/tmp/spark-device-pino9-f1d038.log`,
`/tmp/spark-device-production-f1d038.log` et `/tmp/spark-logger-fix-f1d038.log`.
