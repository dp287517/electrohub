import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

const Index = () => {
  return (
    <div>
      <Header />
      <main>
        <h2>Bienvenue sur Electrohub</h2>
        <p>Tableau de bord pour gérer vos équipements ATEX et tableaux électriques.</p>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
