import { Link, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import AuthCard from '../components/AuthCard.jsx';

export default function SignIn() {
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('email');
    const password = form.get('password');
    try {
      const { token } = await post('/api/auth/signin', { email, password });
      localStorage.setItem('eh_token', token);
      // Demo user payload (replace when backend ready)
      localStorage.setItem('eh_user', JSON.stringify({ email, site: 'Nyon', department: 'Maintenance' }));
      navigate('/dashboard');
    } catch (err) {
      alert('Sign in failed: ' + err.message);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to access your dashboard.">
      <form className="space-y-5" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input mt-1" id="email" name="email" type="email" placeholder="you@company.com" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input mt-1" id="password" name="password" type="password" placeholder="••••••••" required />
        </div>
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" className="rounded" /> Remember me
          </label>
          <Link className="text-sm text-brand-700" to="/lost-password">Forgot password?</Link>
        </div>
        <button className="btn btn-primary w-full" type="submit">Sign in</button>
        <p className="text-sm text-gray-600">No account? <Link to="/signup" className="text-brand-700">Create one</Link></p>
      </form>
    </AuthCard>
  );
}
