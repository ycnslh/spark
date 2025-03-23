const express = require('express');
const wol = require('wake_on_lan');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Chemin vers le fichier CSV
const devicesCsvPath = path.join(__dirname, 'devices.csv');

// Fonction de lecture du fichier CSV
function readDevices() {
  try {
    // Vérifie si le fichier existe, sinon crée un fichier avec des en-têtes
    if (!fs.existsSync(devicesCsvPath)) {
      fs.writeFileSync(devicesCsvPath, 'name,mac\n', 'utf8');
      return [];
    }
    
    const csvData = fs.readFileSync(devicesCsvPath, 'utf8');
    const devices = parse(csvData, { 
      columns: true, 
      skip_empty_lines: true,
      trim: true
    });
    return devices;
  } catch (error) {
    console.error('Erreur lors de la lecture du fichier CSV :', error);
    return [];
  }
}

// Fonction pour écrire dans le fichier CSV
function writeDevices(devices) {
  try {
    // Créer le contenu CSV
    let csvContent = 'name,mac\n';
    
    devices.forEach(device => {
      const name = device.name.replace(/,/g, ''); // Supprimer les virgules pour éviter les problèmes CSV
      csvContent += `${name},${device.mac}\n`;
    });
    
    // Écrire dans le fichier
    fs.writeFileSync(devicesCsvPath, csvContent, 'utf8');
    return true;
  } catch (error) {
    console.error('Erreur lors de l\'écriture dans le fichier CSV :', error);
    return false;
  }
}

// Route pour la page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour obtenir la liste des appareils
app.get('/api/devices', (req, res) => {
  const devices = readDevices();
  res.json(devices);
});

// Route pour ajouter un nouvel appareil
app.post('/api/devices', (req, res) => {
  const { name, mac } = req.body;
  
  // Validation des entrées
  if (!name || !mac) {
    return res.status(400).json({ success: false, message: 'Nom et adresse MAC requis' });
  }
  
  // Validation du format d'adresse MAC (format simple)
  const macRegex = /^([0-9A-Fa-f]{2}[:-]?){5}([0-9A-Fa-f]{2})$/;
  if (!macRegex.test(mac)) {
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
    return res.status(400).json({ success: false, message: 'Cette adresse MAC existe déjà' });
  }
  
  // Ajout du nouvel appareil
  devices.push({ name, mac: normalizedMac.replace(/(.{2})(?=.)/g, '$1:') });
  
  // Sauvegarde dans le fichier CSV
  if (writeDevices(devices)) {
    return res.json({ success: true, message: 'Appareil ajouté avec succès' });
  } else {
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde des données' });
  }
});

// Route pour supprimer un appareil
app.delete('/api/devices/:mac', (req, res) => {
  const { mac } = req.params;
  
  // Récupération des appareils existants
  const devices = readDevices();
  const normalizedMac = mac.replace(/[:-]/g, '').toLowerCase();
  
  // Filtrage pour exclure l'appareil à supprimer
  const updatedDevices = devices.filter(d => 
    d.mac.replace(/[:-]/g, '').toLowerCase() !== normalizedMac
  );
  
  // Vérification que l'appareil a été trouvé
  if (updatedDevices.length === devices.length) {
    return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
  }
  
  // Sauvegarde dans le fichier CSV
  if (writeDevices(updatedDevices)) {
    return res.json({ success: true, message: 'Appareil supprimé avec succès' });
  } else {
    return res.status(500).json({ success: false, message: 'Erreur lors de la sauvegarde des données' });
  }
});

// Route pour envoyer un paquet Wake-on-LAN (API JSON)
app.post('/api/wake/:mac', (req, res) => {
  const { mac } = req.params;
  
  if (!mac) {
    return res.status(400).json({ success: false, message: 'Adresse MAC requise' });
  }

  // Envoi du paquet magique
  wol.wake(mac, (error) => {
    if (error) {
      console.error('Erreur lors de l\'envoi du paquet WoL :', error);
      return res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi du paquet WoL' });
    }
    return res.json({ success: true, message: `Paquet WoL envoyé à ${mac}` });
  });
});

// Route GET pour réveiller un appareil avec juste l'URL (parfait pour les raccourcis)
app.get('/wake/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const devices = readDevices();
  
  // Recherche de l'appareil par son ID (nom) ou adresse MAC
  const device = devices.find(d => 
    d.name.toLowerCase() === deviceId.toLowerCase() || 
    d.mac.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === deviceId.toLowerCase()
  );
  
  if (!device) {
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
  
  // Envoi du paquet magique
  wol.wake(device.mac, (error) => {
    if (error) {
      console.error('Erreur lors de l\'envoi du paquet WoL :', error);
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

// Démarrage du serveur
app.listen(port, () => {
  console.log(`NetArise server running on port ${port}`);
});
