import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, LayoutDashboard, Zap, Shield, Sparkles } from 'lucide-react';
import { ADMIN_EMAILS } from '../lib/permissions';
import { AnimatedAvatar } from './AIAvatar/AnimatedAvatar';
import AvatarChat from './AIAvatar/AvatarChat';
import AvatarSelector from './AIAvatar/AvatarSelector';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem('eh_token');
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // AI Avatar states
  const [avatarStyle, setAvatarStyle] = useState(() => {
    return localStorage.getItem('eh_avatar_style') || 'robot';
  });
  const [showChat, setShowChat] = useState(false);
  const [showAvatarSelector, setShowAvatarSelector] = useState(false);
  const [avatarHovered, setAvatarHovered] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Sauvegarder les préférences d'avatar
  useEffect(() => {
    localStorage.setItem('eh_avatar_style', avatarStyle);
  }, [avatarStyle]);

  const logout = () => {
    localStorage.removeItem('eh_token');
    localStorage.removeItem('eh_user');
    localStorage.removeItem('bubble_token');
    setMobileMenuOpen(false);
    navigate('/');
  };

  const handleAvatarSelect = (style) => {
    setAvatarStyle(style);
    setShowAvatarSelector(false);
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
        <div className="max-w-[95vw] mx-auto px-4 sm:px-6 lg:px-8">
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
                  {/* User Info + AI Avatar */}
                  <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 leading-tight">
                        {user?.name || 'User'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {user?.site || 'No site'}
                      </p>
                    </div>

                    {/* AI Avatar Button */}
                    <div
                      className="relative"
                      onMouseEnter={() => setAvatarHovered(true)}
                      onMouseLeave={() => setAvatarHovered(false)}
                    >
                      <button
                        onClick={() => setShowChat(true)}
                        className="relative group"
                        title="Parler à votre assistant IA"
                      >
                        <AnimatedAvatar
                          style={avatarStyle}
                          size="sm"
                          speaking={avatarHovered}
                          className="transition-transform group-hover:scale-110"
                        />
                        {/* Indicator badge */}
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                      </button>

                      {/* Tooltip on hover */}
                      {avatarHovered && (
                        <div className="absolute top-full right-0 mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3 h-3" />
                            <span>Cliquez pour parler à l'assistant</span>
                          </div>
                          <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 rotate-45" />
                        </div>
                      )}
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
              {/* AI Avatar in mobile */}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowChat(true);
                }}
                className="relative"
              >
                <AnimatedAvatar
                  style={avatarStyle}
                  size="md"
                  speaking={false}
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
              </button>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{user?.name}</p>
                <p className="text-sm text-gray-500">{user?.site || 'No site'} • {user?.department || 'No dept'}</p>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowChat(true);
                  }}
                  className="mt-1 text-xs text-brand-600 flex items-center gap-1 hover:underline"
                >
                  <Sparkles className="w-3 h-3" />
                  Parler à l'assistant
                </button>
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

      {/* AI Avatar Chat Modal */}
      <AvatarChat
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        avatarStyle={avatarStyle}
        onChangeAvatar={() => {
          setShowChat(false);
          setShowAvatarSelector(true);
        }}
      />

      {/* Avatar Selector Modal */}
      {showAvatarSelector && (
        <AvatarSelector
          currentStyle={avatarStyle}
          onSelect={handleAvatarSelect}
          onClose={() => setShowAvatarSelector(false)}
        />
      )}
    </>
  );
}
