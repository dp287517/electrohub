const express = require('express');
const path = require('path');
const { testConnection } = require('./src/utils/db');  // Import du fichier DB

const app = express();

// Middleware pour servir les fichiers statiques React (après build)
app.use(express.static(path.join(__dirname, 'build')));

// Route pour toutes les pages (SPA React)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Test de connexion à la DB au démarrage
const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Serveur démarré sur le port ${port}`);
  await testConnection();  // Teste la connexion Neon
});
