import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem('eh_token');

  const logout = () => {
    localStorage.removeItem('eh_token');
    localStorage.removeItem('eh_user');
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
      <div className="container-narrow flex h-16 items-center justify-between">
        <Link to="/" className="font-semibold text-lg tracking-tight">ElectroHub</Link>
        <nav className="flex items-center gap-3">
          <Link to="/" className={`px-3 py-2 rounded-lg ${pathname==='/'?'bg-gray-100':''}`}>Home</Link>
          {token ? (
            <>
              <Link to="/dashboard" className={`px-3 py-2 rounded-lg ${pathname.startsWith('/dashboard')?'bg-gray-100':''}`}>Dashboard</Link>
              <button onClick={logout} className="btn btn-primary">Log out</button>
            </>
          ) : (
            <>
              <Link to="/signin" className="px-3 py-2 rounded-lg">Sign in</Link>
              <Link to="/signup" className="btn btn-primary">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
