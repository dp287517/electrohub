const { Pool } = require('pg');

// Configuration du pool de connexions avec la chaîne DATABASE_URL depuis l'environnement
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false  // Pour Neon en production ; utilise un certificat pour plus de sécurité si besoin
  }
});

// Fonction pour tester la connexion
const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('Connexion réussie à la base de données Neon !');
    client.release();  // Libère le client pour réutilisation
  } catch (err) {
    console.error('Erreur de connexion à Neon :', err.stack);
  }
};

// Exemple de requête simple (pour tester)
const queryExample = async () => {
  try {
    const res = await pool.query('SELECT NOW()');  // Requête qui retourne la date actuelle
    console.log('Résultat de la requête :', res.rows[0]);
  } catch (err) {
    console.error('Erreur lors de la requête :', err.stack);
  }
};

// Export des fonctions pour utilisation dans d'autres fichiers
module.exports = { pool, testConnection, queryExample };
