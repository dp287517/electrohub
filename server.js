const express = require('express');
const cors = require('cors');
app.use(cors());
const path = require('path');
const { pool } = require('./src/utils/db');  // Import du pool

const app = express();

// Middleware pour parser le JSON
app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));

// Route pour l'inscription
app.post('/api/signup', async (req, res) => {
  const { nom, email, password, site, departement } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO users (nom, email, password, site, departement) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nom, email, password, site, departement]
    );
    res.status(201).json({ message: 'Utilisateur créé', user: result.rows[0] });
  } catch (err) {
    console.error('Erreur lors de l\'inscription :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour toutes les pages (SPA React)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Serveur démarré sur le port ${port}`);
  await require('./src/utils/db').testConnection();
});
