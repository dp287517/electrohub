import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, LayoutDashboard, Zap, Shield } from 'lucide-react';
import { ADMIN_EMAILS } from '../lib/permissions';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem('eh_token');
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const logout = () => {
    localStorage.removeItem('eh_token');
    localStorage.removeItem('eh_user');
    localStorage.removeItem('bubble_token');
    setMobileMenuOpen(false);
    navigate('/');
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const NavLink = ({ to, children, icon: Icon, onClick }) => {
    const isActive = pathname === to || (to !== '/' && pathname.startsWith(to));
    return (
      <Link
        to={to}
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all duration-200 ${
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        {Icon && <Icon size={18} />}
        {children}
      </Link>
    );
  };

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-xl shadow-lg shadow-gray-900/5'
            : 'bg-white/80 backdrop-blur-md'
        } border-b border-gray-100/80`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link
              to={token ? "/dashboard" : "/"}
              className="flex items-center gap-2.5 group"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/25 group-hover:shadow-brand-500/40 transition-shadow">
                <Zap size={20} className="text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                ElectroHub
              </span>
            </Link>

            {/* Desktop Navigation */}
            {token && (
              <nav className="hidden md:flex items-center gap-1">
                <NavLink to="/dashboard" icon={LayoutDashboard}>Dashboard</NavLink>
                {isAdmin && (
                  <NavLink to="/admin" icon={Shield}>Admin</NavLink>
                )}
              </nav>
            )}

            {/* Desktop Right Section */}
            <div className="hidden md:flex items-center gap-3">
              {token ? (
                <>
                  {/* User Info */}
                  <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 leading-tight">
                        {user?.name || 'User'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {user?.site || 'No site'}
                      </p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-semibold text-sm shadow-md shadow-brand-500/20">
                      {getInitials(user?.name)}
                    </div>
                  </div>

                  {/* Logout Button */}
                  <button
                    onClick={logout}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <LogOut size={18} />
                    <span>Log out</span>
                  </button>
                </>
              ) : (
                <Link
                  to="/signin"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40"
                >
                  Sign in
                </Link>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Panel */}
      <div
        className={`fixed top-16 right-0 w-full sm:w-80 bg-white shadow-2xl z-50 md:hidden transition-all duration-300 ease-out ${
          mobileMenuOpen
            ? 'translate-x-0 opacity-100'
            : 'translate-x-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="p-4 space-y-2">
          {token && user?.name && (
            <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-brand-50 to-blue-50 rounded-2xl mb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-semibold shadow-md">
                {getInitials(user?.name)}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{user?.name}</p>
                <p className="text-sm text-gray-500">{user?.site || 'No site'} • {user?.department || 'No dept'}</p>
              </div>
            </div>
          )}

          {token && (
            <>
              <NavLink to="/dashboard" icon={LayoutDashboard} onClick={() => setMobileMenuOpen(false)}>
                Dashboard
              </NavLink>
              {isAdmin && (
                <NavLink to="/admin" icon={Shield} onClick={() => setMobileMenuOpen(false)}>
                  Admin Panel
                </NavLink>
              )}
            </>
          )}

          <div className="pt-4 mt-4 border-t border-gray-100">
            {token ? (
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
              >
                <LogOut size={18} />
                Log out
              </button>
            ) : (
              <Link
                to="/signin"
                onClick={() => setMobileMenuOpen(false)}
                className="block w-full text-center px-4 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium hover:from-brand-700 hover:to-brand-800 transition-all"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
