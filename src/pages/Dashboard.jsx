import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, Recycle, Puzzle, TrendingUp, AlertTriangle, RefreshCw,
  HighVoltage, GitBranch, CreditCard, Settings, Cog, Flame,
  Wrench, Users, MessageCircle, DoorOpen, BarChart3, GraduationCap,
  ClipboardCheck, ChevronRight, Sparkles, Building, Calendar,
  ChevronDown, ChevronUp, Grid3X3
} from 'lucide-react';

// Icon mapping for apps
const iconMap = {
  '⚡': Zap,
  '♻️': Recycle,
  '🧩': Puzzle,
  '📈': TrendingUp,
  '⚠️': AlertTriangle,
  '🔄': RefreshCw,
  '📐': GitBranch,
  '💳': CreditCard,
  '⚙️': Cog,
  '🧯': Flame,
  '🛠️': Wrench,
  '🤝': Users,
  '💬': MessageCircle,
  '🚪': DoorOpen,
  '📊': BarChart3,
  '📋': ClipboardCheck,
};

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

// Enhanced App Card
function AppCard({ label, to, description, icon, color }) {
  const IconComponent = iconMap[icon] || Zap;

  return (
    <Link
      to={to}
      className="group relative bg-white rounded-2xl p-5 shadow-sm hover:shadow-xl border border-gray-100 hover:border-gray-200 transition-all duration-300 hover:-translate-y-1"
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
          <IconComponent size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 group-hover:text-brand-600 transition-colors truncate">
              {label}
            </h3>
            <ChevronRight size={18} className="text-gray-400 group-hover:text-brand-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
          </div>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{description}</p>
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
      className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-md`}>
          <Icon size={20} />
        </div>
        <div className="text-left">
          <h2 className="font-bold text-lg text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">{count} applications</p>
        </div>
      </div>
      <div className={`w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center transition-all ${isOpen ? 'rotate-180' : ''}`}>
        <ChevronDown size={18} className="text-gray-600" />
      </div>
    </button>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState({});
  const [showElectrical, setShowElectrical] = useState(false);
  const [showOther, setShowOther] = useState(true);
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setUser(storedUser);

    // Dynamic greeting based on time
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 18) setGreeting('Good afternoon');
    else setGreeting('Good evening');
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

  // Get initials for avatar
  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  // Get current date formatted
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-800">
        {/* Animated background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-72 h-72 bg-white rounded-full filter blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand-300 rounded-full filter blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-400 rounded-full filter blur-3xl animate-pulse delay-500" />
        </div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            {/* Welcome message */}
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white text-2xl sm:text-3xl font-bold shadow-xl">
                {getInitials(user?.name)}
              </div>
              <div>
                <p className="text-brand-200 text-sm sm:text-base flex items-center gap-2">
                  <Sparkles size={16} className="text-yellow-300" />
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
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 min-w-[140px]">
                <div className="flex items-center gap-2 text-brand-200 text-xs mb-1">
                  <Building size={14} />
                  Site
                </div>
                <p className="text-white font-semibold">{site || '—'}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 min-w-[140px]">
                <div className="flex items-center gap-2 text-brand-200 text-xs mb-1">
                  <Users size={14} />
                  Department
                </div>
                <p className="text-white font-semibold">{user?.department || '—'}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-3 min-w-[140px]">
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
          <svg viewBox="0 0 1440 100" className="w-full h-auto fill-gray-50">
            <path d="M0,50 C360,100 1080,0 1440,50 L1440,100 L0,100 Z" />
          </svg>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 -mt-4 relative z-10">
        {/* Quick Access Section */}
        <div className="mb-8">
          <SectionHeader
            icon={Wrench}
            title="Utilities & Tools"
            count={otherApps.length}
            isOpen={showOther}
            onToggle={() => setShowOther(v => !v)}
            color="from-teal-500 to-cyan-600"
          />

          {showOther && (
            <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
              {otherApps.map(app => (
                <AppCard key={app.label} {...app} />
              ))}
            </div>
          )}
        </div>

        {/* Electrical Controls Section */}
        <div className="mb-8">
          <SectionHeader
            icon={Zap}
            title="Electrical Controls"
            count={visibleElectricalApps.length}
            isOpen={showElectrical}
            onToggle={() => setShowElectrical(v => !v)}
            color="from-amber-500 to-orange-600"
          />

          {showElectrical && (
            <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn">
              {visibleElectricalApps.map(app => (
                <AppCard key={app.label} {...app} />
              ))}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="text-center py-8 text-gray-400 text-sm">
          <p>ElectroHub — Your centralized electrical management platform</p>
        </div>
      </div>
    </div>
  );
}
