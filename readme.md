# NetArise

NetArise est une application web légère permettant de réveiller à distance des ordinateurs via le protocole Wake-on-LAN (WoL). Conçue pour fonctionner dans un conteneur Docker sur un Raspberry Pi, elle offre une interface web simple et des liens directs parfaits pour créer des raccourcis iPhone.

## Fonctionnalités

- Interface web responsive accessible depuis n'importe quel navigateur
- Gestion simple des appareils (ajout, suppression)
- Envoi optimisé de paquets Wake-on-LAN
- Liens directs pour créer des raccourcis sur iPhone ou tout autre appareil
- Logs détaillés pour le suivi et le dépannage
- Déploiement facile avec Docker

## Prérequis

- Un Raspberry Pi (ou tout autre serveur Linux) avec Docker et Docker Compose installés
- Une connexion réseau à votre réseau local
- Des appareils cibles avec Wake-on-LAN activé dans le BIOS/UEFI

## Installation

1. Clonez ce dépôt sur votre Raspberry Pi :
   ```bash
   git clone https://github.com/votre-username/netarise.git
   cd netarise
   ```

2. Créez les dossiers nécessaires :
   ```bash
   mkdir -p logs
   touch devices.csv
   ```

3. Construisez et démarrez le conteneur Docker :
   ```bash
   docker-compose up -d
   ```

4. Accédez à l'interface web :
   ```
   http://[adresse-ip-raspberry]:8085
   ```

## Configuration

### Docker Compose

Le fichier `docker-compose.yml` configure le conteneur et utilise le mode réseau "host" pour permettre l'envoi de paquets de diffusion :

```yaml
version: '3'

services:
  wol-web:
    build: .
    container_name: netarise
    restart: on-failure
    network_mode: "host"  # Utilise directement les interfaces réseau de l'hôte
    volumes:
      - ./devices.csv:/app/devices.csv
      - ./logs:/app/logs
    environment:
      - PORT=8085
```

### Configuration de Wake-on-LAN sur Windows

Pour que vos ordinateurs Windows répondent aux paquets Wake-on-LAN, configurez les éléments suivants :

1. **Dans le BIOS/UEFI** :
   - Activez l'option "Wake-on-LAN", "Remote Wake Up" ou similaire

2. **Dans Windows** :
   - Ouvrez le Gestionnaire de périphériques
   - Développez "Cartes réseau"
   - Sélectionnez votre carte réseau → Propriétés
   - Dans l'onglet "Gestion de l'alimentation", cochez "Autoriser ce périphérique à sortir l'ordinateur du mode veille"
   - Dans l'onglet "Avancé", activez les options "Wake on Magic Packet" si disponible

3. **Désactivez le démarrage rapide de Windows** :
   - Panneau de configuration → Options d'alimentation
   - "Choisir l'action des boutons d'alimentation"
   - "Modifier des paramètres actuellement non disponibles"
   - Décochez "Activer le démarrage rapide"

## Utilisation

### Ajouter des appareils

1. Accédez à l'interface web.
2. Cliquez sur "Ajouter un appareil".
3. Saisissez un nom pour l'appareil et son adresse MAC.
4. Cliquez sur "Ajouter".

### Réveiller un appareil

#### Depuis l'interface web

1. Dans la liste des appareils, cliquez sur le bouton "Réveiller" de l'appareil souhaité.

#### Depuis un raccourci iPhone

1. Dans l'application NetArise, section "Liens directs pour raccourcis", copiez l'URL de l'appareil souhaité.
2. Sur votre iPhone, ouvrez l'app "Raccourcis".
3. Créez un nouveau raccourci :
   - Appuyez sur "+" pour ajouter une action
   - Choisissez "Obtenir le contenu de l'URL"
   - Collez l'URL copiée
   - Donnez un nom à votre raccourci
4. Ajoutez le raccourci à votre écran d'accueil ou aux widgets.
5. Vous pouvez également l'activer via Siri en disant "Hé Siri, [Nom du raccourci]".

## Logs et dépannage

Les logs sont enregistrés dans le dossier `logs/netarise.log`. Consultez-les pour voir l'activité et identifier les problèmes potentiels :

```bash
cat logs/netarise.log
```

Pour voir les logs du conteneur en temps réel :

```bash
docker-compose logs -f
```

## Architecture technique

NetArise utilise :
- Node.js et Express pour le serveur web
- Une implémentation directe de socket UDP pour les paquets Wake-on-LAN
- Un stockage simple en CSV pour la liste des appareils
- Docker avec mode réseau "host" pour l'accès direct aux interfaces réseau

## Mises à jour

Pour mettre à jour NetArise :

1. Arrêtez le conteneur :
   ```bash
   docker-compose down
   ```

2. Tirez les dernières modifications :
   ```bash
   git pull
   ```

3. Reconstruisez et redémarrez :
   ```bash
   docker-compose build
   docker-compose up -d
   ```

## Licence

Ce projet est sous licence MIT.