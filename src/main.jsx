// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';

// Styles globaux de l’app
import './styles.css';

// ✅ Styles Leaflet (gestuelle mobile, overlays…)
import 'leaflet/dist/leaflet.css';

// ✅ Styles des marqueurs/UX plans (que tu viens de créer)
import './styles/doors-map.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
