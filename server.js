const express = require('express');
const wol = require('wake_on_lan');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Chemin vers le fichier CSV
const devicesCsvPath = path.join(__dirname, 'devices.csv');

// Configuration de logging
// S'assurer que le dossier de logs existe
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFilePath = path.join(logDir, 'netarise.log');

// Fonction pour logger les informations
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  // Log dans la console
  console.log(logMessage);
  
  // Log dans le fichier avec gestion d'erreur
  try {
    fs.appendFileSync(logFilePath, logMessage, { flag: 'a' });
  } catch (error) {
    console.error(`Erreur d'écriture dans le fichier de log: ${error.message}`);
  }
}

// Fonction de lecture du fichier CSV
function readDevices() {
  try {
    // Vérifie si le fichier existe, sinon crée un fichier avec des en-têtes
    if (!fs.existsSync(devicesCsvPath)) {
      log('Fichier devices.csv non trouvé, création d\'un nouveau fichier', 'WARN');
      fs.writeFileSync(devicesCsvPath, 'name,mac\n', 'utf8');
      return [];
    }
    
    const csvData = fs.readFileSync(devicesCsvPath, 'utf8');
    log(`Lecture du fichier CSV : ${csvData.length} octets`, 'DEBUG');
    
    const devices = parse(csvData, { 
      columns: true, 
      skip_empty_lines: true,
      trim: true
    });
    
    log(`${devices.length} appareils trouvés dans le fichier CSV`, 'INFO');
    return devices;
  } catch (error) {
    log(`Erreur lors de la lecture du fichier CSV : ${error.message}`, 'ERROR');
    log(error.stack, 'ERROR');
    return [];
  }
}

// Fonction pour écrire dans le fichier CSV
function writeDevices(devices) {
  try {
    // Vérifie si le chemin est un dossier
    const stats = fs.statSync(devicesCsvPath, { throwIfNoEntry: false });
    
    // Si c'est un dossier ou si le fichier n'existe pas
    if (!stats || stats.isDirectory()) {
      // Si c'est un dossier, supprimez-le d'abord
      if (stats && stats.isDirectory()) {
        log(`${devicesCsvPath} est un dossier, suppression...`, 'WARN');
        fs.rmdirSync(devicesCsvPath, { recursive: true });
      }
      
      // Assurez-vous que le répertoire parent existe
      const parentDir = path.dirname(devicesCsvPath);
      if (!fs.existsSync(parentDir)) {
        log(`Création du dossier parent ${parentDir}`, 'INFO');
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }
    
    // Créer le contenu CSV
    let csvContent = 'name,mac\n';
    
    devices.forEach(device => {
      const name = device.name.replace(/,/g, ''); // Supprimer les virgules pour éviter les problèmes CSV
      csvContent += `${name},${device.mac}\n`;
    });
    
    // Écrire dans le fichier
    log(`Écriture de ${devices.length} appareils dans le fichier CSV`, 'INFO');
    fs.writeFileSync(devicesCsvPath, csvContent, 'utf8');
    return true;
  } catch (error) {
    log(`Erreur lors de l'écriture dans le fichier CSV : ${error.message}`, 'ERROR');
    log(error.stack, 'ERROR');
    return false;
  }
}

// Fonction pour envoyer un paquet Wake-on-LAN
function sendWakeOnLanPacket(mac, callback) {
  // Normaliser l'adresse MAC (supprimer les séparateurs)
  const cleanMac = mac.replace(/[:-]/g, '').toLowerCase();
  
  log(`Tentative d'envoi de paquet WoL à ${mac}`, 'INFO');
  
  try {
    const dgram = require('dgram');
    
    // Formater l'adresse MAC en buffer hexadécimal
    const macBuffer = Buffer.from(cleanMac, 'hex');
    
    if (macBuffer.length !== 6) {
      log(`Adresse MAC invalide: ${mac}, longueur du buffer: ${macBuffer.length}`, 'ERROR');
      return callback(new Error('Format d\'adresse MAC invalide'));
    }
    
    // Création du paquet magique (6 octets de FF + MAC répétée 16 fois)
    const magicPacket = Buffer.alloc(6 + 16 * 6);
    
    // Remplir avec FF les 6 premiers octets
    magicPacket.fill(0xFF, 0, 6);
    
    // Répéter l'adresse MAC 16 fois
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6, 0, 6);
    }
    
    log(`Paquet magique créé (${magicPacket.length} octets)`, 'DEBUG');
    
    // Création d'un socket UDP
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    // Gérer les erreurs potentielles
    socket.on('error', (err) => {
      log(`Erreur de socket: ${err.message}`, 'ERROR');
      socket.close();
      return callback(err);
    });
    
    // Une fois que le socket est prêt
    socket.on('listening', () => {
      // Activer la diffusion
      socket.setBroadcast(true);
      
      // Envoyer à l'adresse de diffusion uniquement sur le port 9
      // (port 9 est généralement le plus utilisé pour le WoL)
      const broadcastAddress = '255.255.255.255';
      const wolPort = 9;
      
      socket.send(magicPacket, 0, magicPacket.length, wolPort, broadcastAddress, (err) => {
        socket.close();
        
        if (err) {
          log(`Erreur d'envoi sur port ${wolPort}: ${err.message}`, 'ERROR');
          return callback(err);
        }
        
        log(`Paquet WoL envoyé avec succès à ${mac}`, 'INFO');
        callback(null);
      });
    });
    
    // Lier le socket à n'importe quelle adresse sur un port aléatoire
    socket.bind({ address: '0.0.0.0', port: 0 });
    
  } catch (error) {
    log(`Exception lors de l'envoi du paquet WoL: ${error.message}`, 'ERROR');
    return callback(error);
  }
}

// Routes

// Route pour la page d'accueil
app.get('/', (req, res) => {
  log(`GET / - Requête de la page d'accueil depuis ${req.ip}`, 'INFO');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour obtenir la liste des appareils
app.get('/api/devices', (req, res) => {
  log(`GET /api/devices - Requête de la liste des appareils depuis ${req.ip}`, 'INFO');
  const devices = readDevices();
  res.json(devices);
});

// Route pour ajouter un nouvel appareil
app.post('/api/devices', (req, res) => {
  log(`POST /api/devices - Tentative d'ajout d'un appareil depuis ${req.ip}`, 'INFO');
  log(`Données reçues: ${JSON.stringify(req.body)}`, 'DEBUG');
  
  const { name, mac } = req.body;
  
  // Validation des entrées
  if (!name || !mac) {
    log('Validation échouée: nom ou adresse MAC manquant', 'WARN');
    return res.status(400).json({ success: false, message: 'Nom et adresse MAC requis' });
  }
  
  // Validation du format d'adresse MAC (format simple)
  const macRegex = /^([0-9A-Fa-f]{2}[:-]?){5}([0-9A-Fa-f]{2})$/;
  if (!macRegex.test(mac)) {
    log(`Validation échouée: format MAC invalide - ${mac}`, 'WARN');
    return res.status(400).json({ 
      success: false, 
      message: 'Format d\'adresse MAC invalide (utilisez le format XX:XX:XX:XX:XX:XX ou XXXXXXXXXXXX)' 
    });
  }
  
  // Récupération des appareils existants
  const devices = readDevices();
  
  // Vérification de l'unicité
  const normalizedMac = mac.replace(/[:-]/g, '').toLowerCase();
  if (devices.some(d => d.mac.replace(/[:-]/g, '').toLowerCase() === normalizedMac)) {
    log(`Validation échouée: adresse MAC déjà existante - ${mac}`, 'WARN');
    return res.status(400).json({ success: false, message: 'Cette adresse MAC existe déjà' });
  }
  
  // Ajout du nouvel appareil
  const formattedMac = normalizedMac.replace(/(.{2})(?=.)/g, '$1:');
  devices.push({ name, mac: formattedMac });
  
  // Sauvegarde dans le fichier CSV
  if (writeDevices(devices)) {
    log(`Appareil ajouté avec succès: ${name} (${formattedMac})`, 'INFO');
    return res.json({ success: true, message: 'Appareil ajouté avec succès' });
  } else {
    log(`Erreur lors de la sauvegarde du nouvel appareil: ${name} (${formattedMac})`, 'ERROR');
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde des données' });
  }
});

// Route pour supprimer un appareil
app.delete('/api/devices/:mac', (req, res) => {
  const { mac } = req.params;
  log(`DELETE /api/devices/${mac} - Tentative de suppression d'un appareil depuis ${req.ip}`, 'INFO');
  
  // Récupération des appareils existants
  const devices = readDevices();
  const normalizedMac = mac.replace(/[:-]/g, '').toLowerCase();
  
  // Filtrage pour exclure l'appareil à supprimer
  const updatedDevices = devices.filter(d => 
    d.mac.replace(/[:-]/g, '').toLowerCase() !== normalizedMac
  );
  
  // Vérification que l'appareil a été trouvé
  if (updatedDevices.length === devices.length) {
    log(`Appareil non trouvé pour la suppression: ${mac}`, 'WARN');
    return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
  }
  
  // Sauvegarde dans le fichier CSV
  if (writeDevices(updatedDevices)) {
    log(`Appareil supprimé avec succès: ${mac}`, 'INFO');
    return res.json({ success: true, message: 'Appareil supprimé avec succès' });
  } else {
    log(`Erreur lors de la suppression de l'appareil: ${mac}`, 'ERROR');
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde des données' });
  }
});

// Route pour envoyer un paquet Wake-on-LAN (API JSON)
app.post('/api/wake/:mac', (req, res) => {
  const { mac } = req.params;
  log(`POST /api/wake/${mac} - Tentative de réveil depuis ${req.ip}`, 'INFO');
  
  if (!mac) {
    log('Validation échouée: adresse MAC manquante', 'WARN');
    return res.status(400).json({ success: false, message: 'Adresse MAC requise' });
  }

  sendWakeOnLanPacket(mac, (error) => {
    if (error) {
      log(`Échec de l'envoi du paquet WoL: ${error.message}`, 'ERROR');
      return res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi du paquet WoL' });
    }
    // Suppression du log redondant ici
    return res.json({ success: true, message: `Paquet WoL envoyé à ${mac}` });
  });
});

// Route GET pour réveiller un appareil avec juste l'URL (parfait pour les raccourcis)
app.get('/wake/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  log(`GET /wake/${deviceId} - Tentative de réveil via URL depuis ${req.ip}`, 'INFO');
  
  const devices = readDevices();
  
  // Recherche de l'appareil par son ID (nom) ou adresse MAC
  const device = devices.find(d => 
    d.name.toLowerCase() === deviceId.toLowerCase() || 
    d.mac.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === deviceId.toLowerCase()
  );
  
  if (!device) {
    log(`Appareil non trouvé pour le réveil: ${deviceId}`, 'WARN');
    return res.status(404).send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Erreur</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            .error { color: red; margin: 20px 0; }
            .back { margin-top: 30px; }
          </style>
        </head>
        <body>
          <h1>Erreur</h1>
          <p class="error">Appareil "${deviceId}" non trouvé</p>
          <p class="back"><a href="/">Retour à la page d'accueil</a></p>
        </body>
      </html>
    `);
  }
  
  sendWakeOnLanPacket(device.mac, (error) => {
    if (error) {
      log(`Échec de l'envoi du paquet WoL pour l'appareil ${device.name}: ${error.message}`, 'ERROR');
      return res.status(500).send(`
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Erreur</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
              .error { color: red; margin: 20px 0; }
              .back { margin-top: 30px; }
            </style>
          </head>
          <body>
            <h1>Erreur</h1>
            <p class="error">Erreur lors de l'envoi du paquet Wake-on-LAN</p>
            <p class="back"><a href="/">Retour à la page d'accueil</a></p>
          </body>
        </html>
      `);
    }
    
    // Suppression du log redondant ici également
    // Réponse avec confirmation
    return res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Succès</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
            .success { color: green; margin: 20px 0; }
            .device-info { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px auto; max-width: 300px; }
            .back { margin-top: 30px; }
          </style>
        </head>
        <body>
          <h1>Succès</h1>
          <p class="success">Signal de réveil envoyé !</p>
          <div class="device-info">
            <p><strong>Appareil :</strong> ${device.name}</p>
            <p><strong>Adresse MAC :</strong> ${device.mac}</p>
          </div>
          <p class="back"><a href="/">Retour à la page d'accueil</a></p>
        </body>
      </html>
    `);
  });
});

// Création du fichier de log s'il n'existe pas
if (!fs.existsSync(logFilePath)) {
  try {
    fs.writeFileSync(logFilePath, `[${new Date().toISOString()}] [INFO] Démarrage des logs de NetArise\n`, { flag: 'w' });
  } catch (error) {
    console.error(`Impossible de créer le fichier de log: ${error.message}`);
  }
}

// Démarrage du serveur
app.listen(port, () => {
  log(`NetArise server running on port ${port}`, 'INFO');
  log(`Informations système: ${JSON.stringify({
    platform: process.platform,
    release: process.release,
    versions: process.versions,
    env: {
      NODE_ENV: process.env.NODE_ENV
    }
  })}`, 'INFO');
});