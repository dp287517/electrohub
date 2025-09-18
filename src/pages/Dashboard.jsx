import { Link } from 'react-router-dom';

export default function Dashboard(){
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Tableau de bord</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to="/app/atex" className="rounded-lg border border-gray-200 p-4 hover:shadow transition">
          <div className="text-lg font-medium">ATEX</div>
          <p className="text-sm text-gray-600 mt-1">
            Supervision, création, modification, import/export et analyses des équipements ATEX.
          </p>
        </Link>
      </div>
    </div>
  );
}
