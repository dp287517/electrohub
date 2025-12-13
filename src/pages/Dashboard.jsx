import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Recycle, Puzzle, TrendingUp, AlertTriangle, RefreshCw,
  GitBranch, CreditCard, Cog, Flame, Wrench, Users, MessageCircle,
  DoorOpen, BarChart3, ClipboardCheck, ChevronRight, Sparkles, Building,
  Calendar, ChevronDown, Grid3X3, X, Check, Edit3, MapPin, Briefcase
} from 'lucide-react';

// Icon mapping for apps
const iconMap = {
  '⚡': Zap, '♻️': Recycle, '🧩': Puzzle, '📈': TrendingUp, '⚠️': AlertTriangle,
  '🔄': RefreshCw, '📐': GitBranch, '💳': CreditCard, '⚙️': Cog, '🧯': Flame,
  '🛠️': Wrench, '🤝': Users, '💬': MessageCircle, '🚪': DoorOpen, '📊': BarChart3,
  '📋': ClipboardCheck,
};

// Available sites and departments
const SITES = ['Nyon', 'Geneva', 'Lausanne', 'Zurich', 'Basel'];
const DEPARTMENTS = ['Maintenance', 'Engineering', 'Operations', 'Quality', 'Safety', 'IT'];

// Electrical Controls apps
const electricalApps = [
  { label: 'Electrical Switchboards', to: '/app/switchboards', description: 'Model boards by building/floor/room; manage devices & studies', icon: '⚡', color: 'from-amber-400 to-orange-500' },
  { label: 'Obsolescence', to: '/app/obsolescence', description: 'Lifecycles, replacements, criticality', icon: '♻️', color: 'from-emerald-400 to-teal-500' },
  { label: 'Selectivity', to: '/app/selectivity', description: 'Protection coordination & settings', icon: '🧩', color: 'from-purple-400 to-indigo-500' },
  { label: 'Fault Level Assessment', to: '/app/fault-level', description: 'Short-circuit & fault current studies', icon: '📈', color: 'from-blue-400 to-cyan-500' },
  { label: 'Arc Flash', to: '/app/arc-flash', description: 'Incident energy & PPE categories', icon: '⚠️', color: 'from-red-400 to-rose-500' },
  { label: 'Loop Calculation', to: '/app/loopcalc', description: 'Intrinsic safety loop calculations & compliance', icon: '🔄', color: 'from-sky-400 to-blue-500' },
  { label: 'High Voltage Equipment', to: '/app/hv', description: 'Manage HV cells, cables, transformers, busbars & analyses', icon: '⚡', color: 'from-yellow-400 to-amber-500' },
  { label: 'Diagram', to: '/app/diagram', description: 'Interactive LV/HV map with filters & statuses', icon: '📐', color: 'from-violet-400 to-purple-500' },
  { label: 'Project', to: '/app/projects', description: 'Financial project management: business case, PIP, WBS, offers', icon: '💳', color: 'from-green-400 to-emerald-500' },
  { label: 'Variable Speed Drives', to: '/app/vsd', description: 'VSD maintenance: frequency inverters, power ratings, checks', icon: '⚙️', color: 'from-slate-400 to-gray-500' },
  { label: 'Mechanical Equipments', to: '/app/meca', description: 'Maintenance of pumps, fans, motors & mechanical assets', icon: '⚙️', color: 'from-zinc-400 to-stone-500' },
];

// Other apps
const otherApps = [
  { label: 'ATEX', to: '/app/atex', description: 'Explosive atmospheres equipment management', icon: '🧯', color: 'from-orange-400 to-red-500' },
  { label: 'Maintenance Controls', to: '/app/controls', description: 'Follow-up of electrical equipment maintenance tasks', icon: '🛠️', color: 'from-blue-400 to-indigo-500' },
  { label: 'External Contractors', to: '/app/comp-ext', description: 'Vendors offers, JSA, prevention plan, access, visits', icon: '🤝', color: 'from-teal-400 to-cyan-500' },
  { label: 'Ask Veeva', to: '/app/ask-veeva', description: 'Upload documents, index them, and ask questions with AI', icon: '💬', color: 'from-violet-400 to-purple-500' },
  { label: 'Fire Doors', to: '/app/doors', description: 'Annual checks, QR codes, nonconformities & SAP follow-ups', icon: '🚪', color: 'from-rose-400 to-pink-500' },
  { label: 'Dcf', to: '/app/dcf', description: 'SAP Support', icon: '📊', color: 'from-emerald-400 to-green-500' },
  { label: 'Formation ATEX', to: '/app/learn_ex', description: 'Formation ATEX Niveau 0', icon: '📊', color: 'from-amber-400 to-yellow-500' },
];

// Enhanced App Card with staggered animation
function AppCard({ label, to, description, icon, color, index }) {
  const IconComponent = iconMap[icon] || Zap;

  return (
    <Link
      to={to}
      className="group relative bg-white rounded-2xl p-5 shadow-sm hover:shadow-2xl border border-gray-100 hover:border-transparent transition-all duration-500 hover:-translate-y-2 opacity-0 animate-slideUp"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'forwards' }}
    >
      {/* Hover glow effect */}
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity duration-500`} />

      <div className="relative flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
          <IconComponent size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 group-hover:text-brand-600 transition-colors truncate">
              {label}
            </h3>
            <ChevronRight size={18} className="text-gray-400 group-hover:text-brand-500 group-hover:translate-x-2 transition-all duration-300 flex-shrink-0" />
          </div>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2 group-hover:text-gray-600 transition-colors">{description}</p>
        </div>
      </div>
    </Link>
  );
}

// Section Header component
function SectionHeader({ icon: Icon, title, count, isOpen, onToggle, color }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg hover:border-gray-200 transition-all duration-300 group"
    >
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform`}>
          <Icon size={22} />
        </div>
        <div className="text-left">
          <h2 className="font-bold text-lg text-gray-900 group-hover:text-brand-700 transition-colors">{title}</h2>
          <p className="text-sm text-gray-500">{count} applications</p>
        </div>
      </div>
      <div className={`w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-brand-50 flex items-center justify-center transition-all duration-300 ${isOpen ? 'rotate-180 bg-brand-50' : ''}`}>
        <ChevronDown size={20} className={`text-gray-600 group-hover:text-brand-600 transition-colors ${isOpen ? 'text-brand-600' : ''}`} />
      </div>
    </button>
  );
}

// Profile Edit Modal
function ProfileModal({ user, onClose, onSave }) {
  const [site, setSite] = useState(user?.site || 'Nyon');
  const [department, setDepartment] = useState(user?.department || 'Maintenance');
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      onSave({ ...user, site, department });
      setSaving(false);
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Edit Profile</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Avatar */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-2xl font-bold shadow-xl">
            {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
          </div>
        </div>

        {/* Name (read-only) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
          <div className="px-4 py-3 bg-gray-50 rounded-xl text-gray-600">{user?.name || 'Unknown'}</div>
        </div>

        {/* Email (read-only) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
          <div className="px-4 py-3 bg-gray-50 rounded-xl text-gray-600 text-sm">{user?.email || 'No email'}</div>
        </div>

        {/* Site Select */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <MapPin size={16} />
            Site
          </label>
          <select
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none transition-all"
          >
            {SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Department Select */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Briefcase size={16} />
            Department
          </label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none transition-all"
          >
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg shadow-brand-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check size={18} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState({});
  const [showElectrical, setShowElectrical] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setUser(storedUser);

    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 18) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    // Trigger mount animations
    setTimeout(() => setMounted(true), 100);
  }, []);

  const site = user?.site || '';

  // OIBT card (only for Nyon site)
  const oibtCard = {
    label: 'OIBT',
    to: '/app/oibt',
    description: "Avis d'installation, protocoles de mesure, rapports & contrôles",
    icon: '📋',
    color: 'from-indigo-400 to-blue-500',
  };

  const visibleElectricalApps = site === 'Nyon' ? [...electricalApps, oibtCard] : electricalApps;

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const handleSaveProfile = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('eh_user', JSON.stringify(updatedUser));
    setShowProfileModal(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-slideUp { animation: slideUp 0.5s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-float-delayed { animation: float 6s ease-in-out 2s infinite; }
        .animate-pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
        .animate-shimmer {
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          background-size: 200% 100%;
          animation: shimmer 2s infinite;
        }
      `}</style>

      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-800">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-10 left-10 w-72 h-72 bg-white/10 rounded-full filter blur-3xl animate-pulse-glow" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-brand-300/20 rounded-full filter blur-3xl animate-pulse-glow" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-indigo-400/15 rounded-full filter blur-3xl animate-pulse-glow" style={{ animationDelay: '2s' }} />

          {/* Floating shapes */}
          <div className="absolute top-20 right-1/4 w-8 h-8 bg-white/20 rounded-lg animate-float" />
          <div className="absolute bottom-32 left-1/4 w-6 h-6 bg-white/15 rounded-full animate-float-delayed" />
          <div className="absolute top-1/3 right-20 w-4 h-4 bg-brand-300/30 rounded-full animate-float" style={{ animationDelay: '1s' }} />
        </div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

        <div className={`relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            {/* Welcome message */}
            <div className="flex items-center gap-5">
              <button
                onClick={() => setShowProfileModal(true)}
                className="relative group"
              >
                <div className="w-18 h-18 sm:w-24 sm:h-24 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white text-2xl sm:text-4xl font-bold shadow-xl group-hover:scale-105 group-hover:bg-white/30 transition-all duration-300">
                  {getInitials(user?.name)}
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:scale-110">
                  <Edit3 size={14} className="text-brand-600" />
                </div>
              </button>
              <div>
                <p className="text-brand-200 text-sm sm:text-base flex items-center gap-2">
                  <Sparkles size={16} className="text-yellow-300 animate-pulse" />
                  {greeting}
                </p>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mt-1">
                  {user?.name || 'Welcome back'}
                </h1>
                <p className="text-brand-200 mt-1 flex items-center gap-2">
                  <Calendar size={14} />
                  {currentDate}
                </p>
              </div>
            </div>

            {/* User info cards */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowProfileModal(true)}
                className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-5 py-4 min-w-[140px] hover:bg-white/20 hover:border-white/30 transition-all duration-300 group text-left"
              >
                <div className="flex items-center gap-2 text-brand-200 text-xs mb-1">
                  <Building size={14} />
                  Site
                  <Edit3 size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-white font-semibold">{site || '—'}</p>
              </button>
              <button
                onClick={() => setShowProfileModal(true)}
                className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-5 py-4 min-w-[140px] hover:bg-white/20 hover:border-white/30 transition-all duration-300 group text-left"
              >
                <div className="flex items-center gap-2 text-brand-200 text-xs mb-1">
                  <Users size={14} />
                  Department
                  <Edit3 size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-white font-semibold">{user?.department || '—'}</p>
              </button>
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-5 py-4 min-w-[140px]">
                <div className="flex items-center gap-2 text-brand-200 text-xs mb-1">
                  <Grid3X3 size={14} />
                  Total Apps
                </div>
                <p className="text-white font-semibold">{visibleElectricalApps.length + otherApps.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Wave decoration */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 100" className="w-full h-auto fill-gray-50" preserveAspectRatio="none">
            <path d="M0,50 C360,100 1080,0 1440,50 L1440,100 L0,100 Z" />
          </svg>
        </div>
      </div>

      {/* Main Content */}
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 -mt-4 relative z-10 transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
        {/* Utilities Section */}
        <div className="mb-6">
          <SectionHeader
            icon={Wrench}
            title="Utilities & Tools"
            count={otherApps.length}
            isOpen={showOther}
            onToggle={() => setShowOther(v => !v)}
            color="from-teal-500 to-cyan-600"
          />

          <div className={`overflow-hidden transition-all duration-500 ease-out ${showOther ? 'max-h-[2000px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {otherApps.map((app, index) => (
                <AppCard key={app.label} {...app} index={index} />
              ))}
            </div>
          </div>
        </div>

        {/* Electrical Controls Section */}
        <div className="mb-6">
          <SectionHeader
            icon={Zap}
            title="Electrical Controls"
            count={visibleElectricalApps.length}
            isOpen={showElectrical}
            onToggle={() => setShowElectrical(v => !v)}
            color="from-amber-500 to-orange-600"
          />

          <div className={`overflow-hidden transition-all duration-500 ease-out ${showElectrical ? 'max-h-[2000px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleElectricalApps.map((app, index) => (
                <AppCard key={app.label} {...app} index={index} />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`text-center py-10 transition-all duration-1000 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm border border-gray-100">
            <Zap size={16} className="text-brand-500" />
            <span className="text-gray-500 text-sm">ElectroHub — Your centralized electrical management platform</span>
          </div>
        </div>
      </div>

      {/* Profile Modal */}
      {showProfileModal && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfileModal(false)}
          onSave={handleSaveProfile}
        />
      )}
    </div>
  );
}
