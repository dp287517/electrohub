import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

const SignUp = () => {
  return (
    <div>
      <Header />
      <main>
        <h2>Inscription</h2>
        <form>
          <label>Nom:</label>
          <input type="text" />
          <label>Email:</label>
          <input type="email" />
          <label>Mot de passe:</label>
          <input type="password" />
          <label>Site (ex: Nyon, Levice, Aprilia):</label>
          <input type="text" />
          <label>Département:</label>
          <input type="text" />
          <button type="submit">S'inscrire</button>
        </form>
      </main>
      <Footer />
    </div>
  );
};

export default SignUp;
