import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import AuthCard from '../components/AuthCard.jsx';

export default function SignIn() {
  const navigate = useNavigate();
  const [showExternal, setShowExternal] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('email');
    const password = form.get('password');
    try {
      const { token } = await post('/api/auth/signin', { email, password });
      localStorage.setItem('eh_token', token);
      localStorage.setItem(
        'eh_user',
        JSON.stringify({ email, site: 'Nyon', department: 'Maintenance' })
      );
      navigate('/dashboard');
    } catch (err) {
      alert('Sign in failed: ' + err.message);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to access your dashboard.">
      <form className="space-y-5" onSubmit={onSubmit}>
        {/* Ligne "External company" */}
        <div
          className="flex items-center justify-between cursor-pointer select-none border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition"
          onClick={() => setShowExternal(!showExternal)}
        >
          <span className="font-medium text-gray-700">External company</span>
          <span
            className={`transform transition-transform duration-200 ${
              showExternal ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
        </div>

        {/* Champs Email / Password */}
        {showExternal && (
          <div className="space-y-4 mt-3 animate-fade-in">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                className="input mt-1 w-full"
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                className="input mt-1 w-full"
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" className="rounded" /> Remember me
            </div>

            <button className="btn btn-primary w-full" type="submit">
              Sign in
            </button>
          </div>
        )}

        {/* Bouton Return */}
        <div className="mt-6">
          <a
            href="https://haleon-tool.io"
            className="block text-center w-full py-3 rounded-xl font-medium border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
          >
            Return to haleon-tool
          </a>
        </div>
      </form>
    </AuthCard>
  );
}
