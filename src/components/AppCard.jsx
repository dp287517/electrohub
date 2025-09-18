import { Link } from 'react-router-dom';

export default function AppCard({ label, to, description, icon }) {
  return (
    <Link to={to} className="block group card p-6 hover:-translate-y-0.5 transition-transform">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center text-brand-700 text-2xl">
          {icon || '⚡'}
        </div>
        <div>
          <div className="font-semibold text-lg group-hover:text-brand-700">{label}</div>
          <div className="text-gray-600 text-sm">{description}</div>
        </div>
      </div>
    </Link>
  );
}
