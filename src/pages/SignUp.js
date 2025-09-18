import React, { useState } from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

const SignUp = () => {
  const [formData, setFormData] = useState({
    nom: '',
    email: '',
    password: '',
    site: '',
    departement: ''
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      if (response.ok) {
        alert('Inscription réussie !');
      } else {
        alert('Erreur : ' + data.error);
      }
    } catch (err) {
      alert('Erreur réseau : ' + err.message);
    }
  };

  return (
    <div>
      <Header />
      <main>
        <h2>Inscription</h2>
        <form onSubmit={handleSubmit}>
          <label>Nom:</label>
          <input type="text" name="nom" value={formData.nom} onChange={handleChange} required />
          <label>Email:</label>
          <input type="email" name="email" value={formData.email} onChange={handleChange} required />
          <label>Mot de passe:</label>
          <input type="password" name="password" value={formData.password} onChange={handleChange} required />
          <label>Site (ex: Nyon, Levice, Aprilia):</label>
          <input type="text" name="site" value={formData.site} onChange={handleChange} required />
          <label>Département:</label>
          <input type="text" name="departement" value={formData.departement} onChange={handleChange} required />
          <button type="submit">S'inscrire</button>
        </form>
      </main>
      <Footer />
    </div>
  );
};

export default SignUp;
