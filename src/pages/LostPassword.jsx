import { Link } from 'react-router-dom';
import { post } from '../lib/api.js';
import AuthCard from '../components/AuthCard.jsx';

export default function LostPassword() {
  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('email');
    try {
      await post('/api/auth/lost-password', { email });
      alert('If the email exists, a reset link has been sent.');
    } catch (err) {
      alert('Request failed: ' + err.message);
    }
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email, and we’ll send you a reset link.">
      <form className="space-y-5" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input mt-1" id="email" name="email" type="email" placeholder="you@company.com" required />
        </div>
        <button className="btn btn-primary w-full" type="submit">Send reset link</button>
        <p className="text-sm text-gray-600">Remembered? <Link to="/signin" className="text-brand-700">Back to sign in</Link></p>
      </form>
    </AuthCard>
  );
}
