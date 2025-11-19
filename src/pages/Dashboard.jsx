// src/pages/Dashboard.jsx
import { useState } from 'react';
import AppCard from '../components/AppCard.jsx';

// 👉 Groupe "Electrical Controls"
const electricalApps = [
  { label: 'Electrical Switchboards', to: '/app/switchboards', description: 'Model boards by building/floor/room; manage devices & studies', icon: '⚡' },
  { label: 'Obsolescence', to: '/app/obsolescence', description: 'Lifecycles, replacements, criticality', icon: '♻️' },
  { label: 'Selectivity', to: '/app/selectivity', description: 'Protection coordination & settings', icon: '🧩' },
  { label: 'Fault Level Assessment', to: '/app/fault-level', description: 'Short-circuit & fault current studies', icon: '📈' },
  { label: 'Arc Flash', to: '/app/arc-flash', description: 'Incident energy & PPE categories', icon: '⚠️' },
  { label: 'Loop Calculation', to: '/app/loopcalc', description: 'Intrinsic safety loop calculations & compliance', icon: '🔄' },
  { label: 'High Voltage Equipment', to: '/app/hv', description: 'Manage HV cells, cables, transformers, busbars & analyses', icon: '⚡' },
  { label: 'Diagram', to: '/app/diagram', description: 'Interactive LV/HV map with filters & statuses (arc flash, fault level, selectivity)', icon: '📐' },
  {
    label: 'Project',
    to: '/app/projects',
    description: 'Financial project management: business case, PIP, WBS, offers, orders, invoices, KPIs & AI',
    icon: '💳'
  },
  {
    label: 'Variable Speed Drives',
    to: '/app/vsd',
    description: 'VSD maintenance: frequency inverters, power ratings, checks & compliance',
    icon: '⚙️'
  },
];

// 👉 Autres apps visibles en direct sur le dashboard
const otherApps = [
  { label: 'ATEX', to: '/app/atex', description: 'Explosive atmospheres equipment management', icon: '🧯' },
  { label: 'Maintenance Controls', to: '/app/controls', description: 'Follow-up of electrical equipment maintenance tasks', icon: '🛠️' },
  {
    label: 'External Contractors',
    to: '/app/comp-ext',
    description: 'Vendors offers, JSA, prevention plan, access, visits, SAP WO & attachments',
    icon: '🤝'
  },
  {
    label: 'Ask Veeva',
    to: '/app/ask-veeva',
    description: 'Upload documents or ZIP files, index them, and ask any question across your library with AI.',
    icon: '💬'
  },
  {
    label: 'Fire Doors',
    to: '/app/doors',
    description: 'Annual checks, QR codes, nonconformities & SAP follow-ups',
    icon: '🚪'
  },
];

export default function Dashboard() {
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const site = user?.site || '';

  // Carte OIBT (visible uniquement pour le site Nyon, et intégrée dans Electrical Controls)
  const oibtCard = {
    label: 'OIBT',
    to: '/app/oibt',
    description: "Avis d'installation, protocoles de mesure, rapports & contrôles périodiques",
    icon: '📋',
  };

  // 👉 on ajoute OIBT uniquement pour Nyon dans le groupe électrique
  const visibleElectricalApps =
    site === 'Nyon' ? [...electricalApps, oibtCard] : electricalApps;

  const [showElectricalControls, setShowElectricalControls] = useState(false);

  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600">
            Welcome{user?.name ? `, ${user.name}` : ''}! Access your tools below.
          </p>
        </div>
        <div className="card px-4 py-3">
          <div className="text-sm text-gray-700">
            <span className="font-medium">Site:</span> {site || '—'}
          </div>
          <div className="text-sm text-gray-700">
            <span className="font-medium">Department:</span> {user?.department || '—'}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 👉 Card maîtresse Electrical Controls */}
        <button
          type="button"
          onClick={() => setShowElectricalControls(v => !v)}
          className="card text-left px-4 py-5 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <h2 className="text-xl font-semibold">Electrical Controls</h2>
            </div>
            <span className="text-sm text-gray-500">
              {showElectricalControls ? 'Hide' : 'Show'}
            </span>
          </div>
          <p className="text-sm text-gray-600">
            All electrical apps: boards, studies, projects, OIBT…
          </p>
        </button>

        {/* 👉 Les autres apps restent comme avant */}
        {otherApps.map(a => (
          <AppCard key={a.label} {...a} />
        ))}

        {/* 👉 Sous-cards affichées seulement si on a cliqué sur Electrical Controls */}
        {showElectricalControls &&
          visibleElectricalApps.map(a => (
            <AppCard key={a.label} {...a} />
          ))}
      </div>
    </section>
  );
}
