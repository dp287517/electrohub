// src/pages/Dashboard.jsx
import AppCard from '../components/AppCard.jsx';

const apps = [
  { label: 'Electrical Switchboards', to: '/app/switchboards', description: 'Model boards by building/floor/room; manage devices & studies', icon: '⚡' },
  { label: 'ATEX', to: '/app/atex', description: 'Explosive atmospheres equipment management', icon: '🧯' },
  { label: 'Obsolescence', to: '/app/obsolescence', description: 'Lifecycles, replacements, criticality', icon: '♻️' },
  { label: 'Selectivity', to: '/app/selectivity', description: 'Protection coordination & settings', icon: '🧩' },
  { label: 'Fault Level Assessment', to: '/app/fault-level', description: 'Short-circuit & fault current studies', icon: '📈' },
  { label: 'Arc Flash', to: '/app/arc-flash', description: 'Incident energy & PPE categories', icon: '⚠️' },
  { label: 'Loop Calculation', to: '/app/loopcalc', description: 'Intrinsic safety loop calculations & compliance', icon: '🔄' },
  { label: 'High Voltage Equipment', to: '/app/hv', description: 'Manage HV cells, cables, transformers, busbars & analyses', icon: '⚡' },
  { label: 'Diagram', to: '/app/diagram', description: 'Interactive LV/HV map with filters & statuses (arc flash, fault level, selectivity)', icon: '📐' },
  { label: 'Maintenance Controls', to: '/app/controls', description: 'Follow-up of electrical equipment maintenance tasks', icon: '🛠️' },
  {
    label: 'Project',
    to: '/app/projects',
    description: 'Financial project management: business case, PIP, WBS, offers, orders, invoices, KPIs & AI',
    icon: '💳'
  },
  // 👉 Nouveau : Prestataires externes
  {
    label: 'External Contractors',
    to: '/app/comp-ext',
    description: 'Vendors offers, JSA, prevention plan, access, visits, SAP WO & attachments',
    icon: '🤝'
  },
  // 👉 Nouveau : Ask Veeva (lecture et Q/R sur documents)
  {
    label: 'Ask Veeva',
    to: '/app/ask-veeva',
    description: 'Upload documents or ZIP files, index them, and ask any question across your library with AI.',
    icon: '💬'
  },
  // 👉 Nouveau : Fire Doors (portes coupe-feu)
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

  // Carte OIBT (visible uniquement pour le site Nyon)
  const oibtCard = {
    label: 'OIBT',
    to: '/app/oibt',
    description: "Avis d'installation, protocoles de mesure, rapports & contrôles périodiques",
    icon: '📋',
  };

  // Construire la liste visible selon le site
  const visibleApps = site === 'Nyon' ? [...apps, oibtCard] : apps;

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
        {visibleApps.map(a => (
          <AppCard key={a.label} {...a} />
        ))}
      </div>
    </section>
  );
}
