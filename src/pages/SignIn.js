import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

const SignIn = () => {
  return (
    <div>
      <Header />
      <main>
        <h2>Connexion</h2>
        <form>
          <label>Email:</label>
          <input type="email" />
          <label>Mot de passe:</label>
          <input type="password" />
          <button type="submit">Se connecter</button>
        </form>
      </main>
      <Footer />
    </div>
  );
};

export default SignIn;
