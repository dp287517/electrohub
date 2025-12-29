// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import NotificationProvider from './components/Notifications/NotificationProvider';
import { ProcedureCaptureProvider } from './contexts/ProcedureCaptureContext';
import ProcedureCaptureWidget from './components/Procedures/ProcedureCaptureWidget';

// Styles globaux de l'app
import './styles.css';

// Styles Leaflet (gestuelle mobile, overlays…)
import 'leaflet/dist/leaflet.css';

// Styles des marqueurs/UX plans
import './styles/doors-map.css';

// Notification styles
import './styles/notifications.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <NotificationProvider>
        <ProcedureCaptureProvider>
          <App />
          <ProcedureCaptureWidget />
        </ProcedureCaptureProvider>
      </NotificationProvider>
    </BrowserRouter>
  </React.StrictMode>
);
