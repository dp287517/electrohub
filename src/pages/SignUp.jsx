// src/pages/SignUp.jsx
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import AuthCard from '../components/AuthCard.jsx';

export default function SignUp() {
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      site: form.get('site'),        // ✅ Le site choisi par l'utilisateur
      department: form.get('department')
    };
    try {
      const { token, user } = await post('/api/auth/signup', payload);
      localStorage.setItem('eh_token', token);
      localStorage.setItem('eh_user', JSON.stringify(user));  // ✅ Vrai user avec son site
      navigate('/dashboard');
    } catch (err) {
      alert('Sign up failed: ' + err.message);
    }
  }

  return (
    <AuthCard title="Create your account" subtitle="Join ElectroHub to streamline your electrical workflows.">
      <form className="space-y-5" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input className="input mt-1" id="name" name="name" type="text" placeholder="Jane Smith" required />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input mt-1" id="email" name="email" type="email" placeholder="you@company.com" required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="site">Site</label>
            <select id="site" name="site" className="input mt-1" required>
              <option value="">Select a site</option>
              <option>Nyon</option>
              <option>Levice</option>
              <option>Aprilia</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="department">Department</label>
            <select id="department" name="department" className="input mt-1" required>
              <option value="">Select a department</option>
              <option>Maintenance</option>
              <option>Utilities</option>
              <option>Projects</option>
              <option>HSE</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input mt-1" id="password" name="password" type="password" placeholder="••••••••" minLength={8} required />
        </div>
        <button className="btn btn-primary w-full" type="submit">Create account</button>
        <p className="text-sm text-gray-600">Already have an account? <Link to="/signin" className="text-brand-700">Sign in</Link></p>
      </form>
    </AuthCard>
  );
}
