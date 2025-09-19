import AppCard from '../components/AppCard.jsx';

const apps = [
  { label: 'ATEX', to: '/app/atex', description: 'Explosive atmospheres equipment management', icon: '🧯' },
  { label: 'Obsolescence', to: '/app/obsolescence', description: 'Lifecycles, replacements, criticality', icon: '♻️' },
  { label: 'Selectivity', to: '/app/selectivity', description: 'Protection coordination & settings', icon: '🧩' },
  { label: 'Fault Level Assessment', to: '/app/fault-level', description: 'Short-circuit & fault current studies', icon: '📈' },
  { label: 'Arc Flash', to: '/app/arc-flash', description: 'Incident energy & PPE categories', icon: '⚠️' },
];

export default function Dashboard() {
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');

  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600">Welcome{user?.name ? `, ${user.name}` : ''}! Access your tools below.</p>
        </div>
        <div className="card px-4 py-3">
          <div className="text-sm text-gray-700"><span className="font-medium">Site:</span> {user.site || '—'}</div>
          <div className="text-sm text-gray-700"><span className="font-medium">Department:</span> {user.department || '—'}</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {apps.map(a => (
          <AppCard key={a.label} {...a} />
        ))}
      </div>

      <div className="mt-10 card p-6">
        <h2 className="text-xl font-semibold mb-2">Next steps</h2>
        <ol className="list-decimal ml-6 space-y-1 text-gray-700">
          <li>Implement Neon-backed auth (sites & departments attached to users).</li>
          <li>Create per-app routes (ATEX, Obsolescence, etc.) with data filtered by <em>site</em>.</li>
          <li>Integrate OpenAI assistants for guided forms & calculations.</li>
        </ol>
      </div>
    </section>
  );
}
