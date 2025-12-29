import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Zap, Recycle, Puzzle, TrendingUp, AlertTriangle, RefreshCw,
  CreditCard, Cog, Flame, Wrench, Users, MessageCircle,
  DoorOpen, BarChart3, ClipboardCheck, ChevronRight, Sparkles,
  Calendar, X, MapPin, Briefcase, Shield, Globe, Crown, Battery, Database,
  Play, Clock, CheckCircle, ChevronDown, Building2, Layers, Activity,
  ArrowUpRight, ArrowDownRight, Zap as ZapIcon, Star, Bell
} from 'lucide-react';
import {
  AreaChart, Area, PieChart as RechartsPie, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { getAllowedApps } from '../lib/permissions';
import { api } from '../lib/api';
import WeatherBackground from '../components/WeatherBackground';
import FloatingAssistant from '../components/AIAvatar/FloatingAssistant';
import StoryBrief from '../components/StoryBrief';
import { aiAssistant } from '../lib/ai-assistant';
import NotificationCenter from '../components/NotificationCenter';

// Chart colors
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

// Icon mapping
const iconMap = {
  '⚡': Zap, '♻️': Recycle, '🧩': Puzzle, '📈': TrendingUp, '⚠️': AlertTriangle,
  '🔄': RefreshCw, '💳': CreditCard, '⚙️': Cog, '🧯': Flame,
  '🛠️': Wrench, '🤝': Users, '💬': MessageCircle, '🚪': DoorOpen, '📊': BarChart3,
  '📋': ClipboardCheck, '🔋': Battery, '🗄️': Database, '🔌': Zap,
};

// All apps with full names
const allApps = {
  equipment: [
    { id: 'switchboards', label: 'Tableaux Électriques', shortLabel: 'Tableaux', to: '/app/switchboards', icon: '⚡', color: 'from-amber-400 via-orange-500 to-red-500', glow: 'shadow-orange-500/30' },
    { id: 'vsd', label: 'Variateurs de Vitesse', shortLabel: 'VSD', to: '/app/vsd', icon: '⚙️', color: 'from-slate-400 via-gray-500 to-zinc-600', glow: 'shadow-gray-500/30' },
    { id: 'meca', label: 'Équipements Mécaniques', shortLabel: 'Mécanique', to: '/app/meca', icon: '⚙️', color: 'from-zinc-400 via-stone-500 to-neutral-600', glow: 'shadow-stone-500/30' },
    { id: 'hv', label: 'Haute Tension', shortLabel: 'HT', to: '/app/hv', icon: '⚡', color: 'from-yellow-400 via-amber-500 to-orange-600', glow: 'shadow-amber-500/30' },
    { id: 'glo', label: 'UPS & Batteries', shortLabel: 'GLO', to: '/app/glo', icon: '🔋', color: 'from-emerald-400 via-teal-500 to-cyan-600', glow: 'shadow-teal-500/30' },
    { id: 'mobile', label: 'Équipements Mobiles', shortLabel: 'Mobile', to: '/app/mobile-equipments', icon: '🔌', color: 'from-cyan-400 via-blue-500 to-indigo-600', glow: 'shadow-blue-500/30' },
    { id: 'datahub', label: 'DataHub Custom', shortLabel: 'DataHub', to: '/app/datahub', icon: '🗄️', color: 'from-indigo-400 via-purple-500 to-pink-600', glow: 'shadow-purple-500/30' },
  ],
  analysis: [
    { id: 'obsolescence', label: 'Obsolescence', shortLabel: 'Obsolescence', to: '/app/obsolescence', icon: '♻️', color: 'from-emerald-400 via-green-500 to-teal-600', glow: 'shadow-green-500/30' },
    { id: 'selectivity', label: 'Sélectivité', shortLabel: 'Sélectivité', to: '/app/selectivity', icon: '🧩', color: 'from-purple-400 via-violet-500 to-indigo-600', glow: 'shadow-violet-500/30' },
    { id: 'fault-level', label: 'Courant de Court-Circuit', shortLabel: 'Icc', to: '/app/fault-level', icon: '📈', color: 'from-blue-400 via-cyan-500 to-teal-600', glow: 'shadow-cyan-500/30' },
    { id: 'arc-flash', label: 'Arc Flash', shortLabel: 'Arc Flash', to: '/app/arc-flash', icon: '⚠️', color: 'from-red-400 via-rose-500 to-pink-600', glow: 'shadow-rose-500/30' },
    { id: 'loopcalc', label: 'Boucle Sécurité Intrinsèque', shortLabel: 'Boucle IS', to: '/app/loopcalc', icon: '🔄', color: 'from-sky-400 via-blue-500 to-indigo-600', glow: 'shadow-blue-500/30' },
  ],
  tools: [
    { id: 'controls', label: 'Contrôles Périodiques', shortLabel: 'Contrôles', to: '/app/switchboard-controls', icon: '📋', color: 'from-blue-400 via-indigo-500 to-purple-600', glow: 'shadow-indigo-500/30' },
    { id: 'projects', label: 'Gestion Projets', shortLabel: 'Projets', to: '/app/projects', icon: '💳', color: 'from-green-400 via-emerald-500 to-teal-600', glow: 'shadow-emerald-500/30' },
    { id: 'atex', label: 'Zones ATEX', shortLabel: 'ATEX', to: '/app/atex', icon: '🧯', color: 'from-orange-400 via-red-500 to-rose-600', glow: 'shadow-red-500/30' },
    { id: 'doors', label: 'Portes Coupe-Feu', shortLabel: 'Portes Feu', to: '/app/doors', icon: '🚪', color: 'from-rose-400 via-pink-500 to-fuchsia-600', glow: 'shadow-pink-500/30' },
    { id: 'comp-ext', label: 'Sous-Traitants', shortLabel: 'Contractors', to: '/app/comp-ext', icon: '🤝', color: 'from-teal-400 via-cyan-500 to-blue-600', glow: 'shadow-cyan-500/30' },
    { id: 'ask-veeva', label: 'Ask Veeva AI', shortLabel: 'Ask Veeva', to: '/app/ask-veeva', icon: '💬', color: 'from-violet-400 via-purple-500 to-fuchsia-600', glow: 'shadow-purple-500/30' },
    { id: 'dcf', label: 'Support SAP', shortLabel: 'DCF', to: '/app/dcf', icon: '📊', color: 'from-emerald-400 via-green-500 to-lime-600', glow: 'shadow-green-500/30' },
    { id: 'learn-ex', label: 'Formation ATEX', shortLabel: 'Formation', to: '/app/learn_ex', icon: '📊', color: 'from-amber-400 via-yellow-500 to-orange-600', glow: 'shadow-yellow-500/30' },
    { id: 'procedures', label: 'Procédures Opérationnelles', shortLabel: 'Procédures', to: '/app/procedures', icon: '📋', color: 'from-violet-400 via-purple-500 to-indigo-600', glow: 'shadow-violet-500/30' },
  ]
};

// Spectacular App Card - Full visibility on mobile
function AppCard({ label, shortLabel, to, icon, color, glow, badge, index = 0 }) {
  const IconComponent = iconMap[icon] || Zap;

  return (
    <Link
      to={to}
      className={`group relative overflow-hidden rounded-2xl transition-all duration-500 hover:scale-[1.02] active:scale-[0.98] animate-slideUp`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Glassmorphism background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-90`} />
      <div className="absolute inset-0 bg-white/10 backdrop-blur-sm" />

      {/* Animated glow on hover */}
      <div className={`absolute -inset-1 bg-gradient-to-r ${color} opacity-0 group-hover:opacity-50 blur-xl transition-opacity duration-500`} />

      {/* Shine effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
        <div className="absolute inset-0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative p-4 sm:p-5 flex flex-col items-center text-center min-h-[120px] sm:min-h-[140px] justify-center">
        {/* Icon with 3D effect */}
        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-3 shadow-lg ${glow} group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
          <IconComponent size={24} className="text-white drop-shadow-lg sm:w-7 sm:h-7" />
        </div>

        {/* Label - Full on mobile */}
        <h3 className="text-white font-bold text-sm sm:text-base leading-tight drop-shadow-lg">
          {label}
        </h3>

        {/* Badge */}
        {badge > 0 && (
          <div className="absolute top-2 right-2 px-2.5 py-1 bg-white rounded-full shadow-lg animate-bounce">
            <span className="text-xs font-bold text-red-600">{badge}</span>
          </div>
        )}

        {/* Arrow indicator */}
        <div className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-1">
          <ChevronRight size={14} className="text-white" />
        </div>
      </div>
    </Link>
  );
}

// Animated Stat Card with 3D effect
function StatCard({ icon: Icon, value, label, trend, trendValue, color, glow, onClick, index = 0 }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const end = parseInt(value) || 0;
    const duration = 1500;
    const steps = 30;
    const increment = end / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden bg-white rounded-2xl p-4 sm:p-5 shadow-lg hover:shadow-2xl ${glow} border border-gray-100/50 transition-all duration-500 hover:-translate-y-2 hover:rotate-1 text-left w-full animate-slideUp`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Background gradient on hover */}
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />

      {/* Floating particles effect */}
      <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
        <div className={`absolute w-2 h-2 rounded-full bg-gradient-to-r ${color} animate-float`} style={{ top: '20%', right: '30%' }} />
        <div className={`absolute w-1.5 h-1.5 rounded-full bg-gradient-to-r ${color} animate-float-delayed`} style={{ top: '50%', right: '20%' }} />
        <div className={`absolute w-1 h-1 rounded-full bg-gradient-to-r ${color} animate-float`} style={{ top: '70%', right: '40%' }} />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg ${glow} group-hover:scale-110 group-hover:rotate-6 transition-all duration-500`}>
            <Icon size={22} className="text-white sm:w-6 sm:h-6" />
          </div>
          {trend && (
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
              trend === 'up' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            } animate-pulse`}>
              {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {trendValue}
            </div>
          )}
        </div>

        <p className="text-3xl sm:text-4xl font-black text-gray-900 mb-1 tabular-nums">
          {count}
        </p>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
      </div>
    </button>
  );
}

// Mini Chart with animation
function MiniChart({ data, color }) {
  if (!data?.length) return <div className="h-16 flex items-center justify-center text-gray-300">—</div>;

  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${color})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Role Badge with glow
function RoleBadge({ role }) {
  const cfg = {
    superadmin: { icon: Crown, color: 'from-amber-400 to-yellow-500', text: 'Super Admin' },
    admin: { icon: Shield, color: 'from-purple-400 to-indigo-500', text: 'Admin' },
    global: { icon: Globe, color: 'from-emerald-400 to-teal-500', text: 'Global' },
    site: { icon: MapPin, color: 'from-blue-400 to-cyan-500', text: 'Site' },
  }[role] || { icon: MapPin, color: 'from-blue-400 to-cyan-500', text: 'Site' };

  const Icon = cfg.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r ${cfg.color} text-white text-xs font-bold shadow-lg`}>
      <Icon size={12} />
      {cfg.text}
    </span>
  );
}

// Profile Modal with glassmorphism
function ProfileModal({ user, departments, sites, onClose, onSave }) {
  const [siteId, setSiteId] = useState(user?.site_id || sites?.find(s => s.name === user?.site)?.id);
  const [deptId, setDeptId] = useState(user?.department_id || departments?.find(d => d.name === user?.department)?.id);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('eh_token');
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        credentials: 'include',
        body: JSON.stringify({ department_id: deptId, site_id: siteId })
      });
      const data = await res.json();
      if (data.jwt) localStorage.setItem('eh_token', data.jwt);
      onSave({
        ...user, site_id: siteId, department_id: deptId,
        site: sites?.find(s => s.id === siteId)?.name,
        department: departments?.find(d => d.id === deptId)?.name
      });
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-scaleIn border border-white/50">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl opacity-20 blur-xl" />

        <div className="relative">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-xl font-black text-gray-900">Mon Profil</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex items-center gap-4 mb-6 pb-5 border-b">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-black text-2xl shadow-xl">
              {user?.name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="font-bold text-lg text-gray-900">{user?.name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Site</label>
              <select value={siteId || ''} onChange={e => setSiteId(+e.target.value || null)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all font-medium">
                <option value="">Sélectionner...</option>
                {sites?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Département</label>
              <select value={deptId || ''} onChange={e => setDeptId(+e.target.value || null)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all font-medium">
                <option value="">Sélectionner...</option>
                {departments?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors">
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50">
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState({});
  const [showProfile, setShowProfile] = useState(false);
  const [showStory, setShowStory] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [sites, setSites] = useState([]);
  const [stats, setStats] = useState({ overdue: 0, pending: 0, completed: 0, total: 0 });
  const [briefData, setBriefData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [equipmentData, setEquipmentData] = useState([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setUser(stored);
    setTimeout(() => setMounted(true), 100);

    Promise.all([
      fetch('/api/departments').then(r => r.json()).catch(() => ({})),
      fetch('/api/sites').then(r => r.json()).catch(() => ({})),
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      api.switchboardControls.dashboard().catch(() => null),
      aiAssistant.getMorningBrief().catch(() => null),
      aiAssistant.getHistoricalStats(7).catch(() => null)
    ]).then(([depts, sitesRes, me, controls, brief, historical]) => {
      setDepartments(depts.departments || []);
      setSites(sitesRes.sites || []);

      if (me?.user) {
        const updated = { ...stored, ...me.user };
        localStorage.setItem('eh_user', JSON.stringify(updated));
        setUser(updated);
      }

      if (controls) {
        setStats({
          overdue: controls.stats?.overdue || controls.overdue_count || 0,
          pending: controls.stats?.pending || controls.pending_count || 0,
          completed: controls.stats?.completed_this_week || 0,
          total: controls.stats?.total || 0
        });
      }

      if (brief) {
        setBriefData(brief);
        if (brief.charts?.equipmentDistribution) {
          setEquipmentData(brief.charts.equipmentDistribution.map((d, i) => ({
            name: d.name, value: d.value, color: PIE_COLORS[i % PIE_COLORS.length]
          })));
        }
      }

      if (historical?.datasets?.controlsCompleted) {
        setChartData(historical.datasets.controlsCompleted.slice(-7).map((v, i) => ({ value: v })));
      }
    });
  }, []);

  const site = user?.site || '';
  const role = user?.role || 'site';
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  }, []);

  const allowedApps = useMemo(() => getAllowedApps(user?.email), [user?.email]);
  const filterApps = apps => apps.filter(a => allowedApps.some(x => x.route === a.to));

  const equipment = filterApps(allApps.equipment);
  const analysis = filterApps(allApps.analysis);
  const tools = filterApps(allApps.tools);

  if (site === 'Nyon' && allowedApps.some(a => a.id === 'oibt')) {
    tools.push({ id: 'oibt', label: 'Contrôles OIBT', shortLabel: 'OIBT', to: '/app/oibt', icon: '📋', color: 'from-indigo-400 via-blue-500 to-cyan-600', glow: 'shadow-blue-500/30' });
  }

  const allFilteredApps = [...equipment, ...analysis, ...tools];
  const healthScore = briefData?.healthScore || 85;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/30">
      {/* Spectacular CSS */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-slideUp {
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        .animate-scaleIn { animation: scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-float { animation: float 4s ease-in-out infinite; }
        .animate-float-delayed { animation: float-delayed 5s ease-in-out infinite 1s; }
        .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
      `}</style>

      {/* Hero with Weather */}
      <WeatherBackground site={site}>
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            {/* User greeting */}
            <div className="flex items-center gap-4">
              <button onClick={() => setShowProfile(true)}
                className="relative group w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/20 backdrop-blur-xl border-2 border-white/40 flex items-center justify-center text-white text-2xl sm:text-3xl font-black hover:bg-white/30 transition-all hover:scale-105 shadow-2xl">
                {user?.name?.charAt(0) || '?'}
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full border-3 border-white flex items-center justify-center shadow-lg">
                  <CheckCircle size={12} className="text-white" />
                </div>
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-2xl bg-white/30 opacity-0 group-hover:opacity-100 blur-xl transition-opacity" />
              </button>

              <div>
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h1 className="text-2xl sm:text-3xl font-black text-white drop-shadow-lg">
                    {greeting}, {user?.name?.split(' ')[0] || 'Utilisateur'}
                  </h1>
                  <RoleBadge role={role} />
                </div>
                <p className="text-white/80 text-sm sm:text-base flex items-center gap-2">
                  <Calendar size={16} />
                  {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {site && <><span className="mx-1">•</span><MapPin size={16} />{site}</>}
                </p>
              </div>
            </div>

            {/* Story Button - Spectacular */}
            <button onClick={() => setShowStory(true)}
              className="group relative overflow-hidden flex items-center gap-4 px-6 py-4 bg-white/20 backdrop-blur-xl border-2 border-white/40 rounded-2xl hover:bg-white/30 transition-all hover:scale-105 shadow-2xl">
              {/* Animated background */}
              <div className="absolute inset-0 bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />

              {/* Pulsing ring */}
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl animate-pulse-glow" />
                <div className="relative w-12 h-12 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/50">
                  <Play size={20} className="text-white fill-white ml-0.5" />
                </div>
              </div>

              <div className="text-left relative">
                <p className="text-white font-bold text-base sm:text-lg">Brief du matin</p>
                <p className="text-white/70 text-sm">Voir la story</p>
              </div>

              <ChevronRight size={24} className="text-white/60 group-hover:translate-x-2 transition-transform" />
            </button>
          </div>
        </div>
      </WeatherBackground>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 -mt-8 relative z-10 pb-10">

        {/* Stats Grid - Spectacular */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
          <StatCard
            icon={AlertTriangle}
            value={stats.overdue}
            label="En retard"
            color="from-red-400 via-rose-500 to-pink-600"
            glow="hover:shadow-rose-500/30"
            onClick={() => navigate('/app/switchboard-controls?tab=overdue')}
            index={0}
          />
          <StatCard
            icon={Clock}
            value={stats.pending}
            label="À planifier"
            color="from-amber-400 via-orange-500 to-red-600"
            glow="hover:shadow-orange-500/30"
            onClick={() => navigate('/app/switchboard-controls?tab=schedules')}
            index={1}
          />
          <StatCard
            icon={CheckCircle}
            value={stats.completed}
            label="Complétés"
            trend="up"
            trendValue="+12%"
            color="from-emerald-400 via-green-500 to-teal-600"
            glow="hover:shadow-emerald-500/30"
            onClick={() => navigate('/app/switchboard-controls')}
            index={2}
          />
          <StatCard
            icon={Activity}
            value={healthScore}
            label="Score santé"
            color="from-blue-400 via-indigo-500 to-purple-600"
            glow="hover:shadow-indigo-500/30"
            onClick={() => setShowStory(true)}
            index={3}
          />
        </div>

        {/* Notification Center Widget */}
        <div className="mb-8 animate-slideUp" style={{ animationDelay: '350ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-lg">
              <Bell size={20} className="text-white" />
            </div>
            <h2 className="text-xl font-black text-gray-900">Activité récente</h2>
          </div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <NotificationCenter compact maxItems={5} />
          </div>
        </div>

        {/* Apps Section - Full names visible */}
        <div className="space-y-8">
          {/* Equipment */}
          {equipment.length > 0 && (
            <section className="animate-slideUp" style={{ animationDelay: '400ms' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
                  <Zap size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-black text-gray-900">Équipements</h2>
                <span className="text-sm text-gray-400 font-medium">{equipment.length} apps</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {equipment.map((app, i) => (
                  <AppCard key={app.id} {...app} index={i} badge={app.id === 'switchboards' ? stats.overdue : 0} />
                ))}
              </div>
            </section>
          )}

          {/* Analysis */}
          {analysis.length > 0 && (
            <section className="animate-slideUp" style={{ animationDelay: '500ms' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center shadow-lg">
                  <BarChart3 size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-black text-gray-900">Analyses & Études</h2>
                <span className="text-sm text-gray-400 font-medium">{analysis.length} apps</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {analysis.map((app, i) => (
                  <AppCard key={app.id} {...app} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* Tools */}
          {tools.length > 0 && (
            <section className="animate-slideUp" style={{ animationDelay: '600ms' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-lg">
                  <Wrench size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-black text-gray-900">Outils & Utilitaires</h2>
                <span className="text-sm text-gray-400 font-medium">{tools.length} apps</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {tools.map((app, i) => (
                  <AppCard key={app.id} {...app} index={i} badge={app.id === 'controls' ? stats.overdue : 0} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-10 animate-slideUp" style={{ animationDelay: '700ms' }}>
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="text-gray-600 font-medium">ElectroHub — Gestion électrique centralisée</span>
          </div>
        </div>
      </main>

      {/* Modals */}
      {showProfile && (
        <ProfileModal
          user={user}
          departments={departments}
          sites={sites}
          onClose={() => setShowProfile(false)}
          onSave={(u) => { setUser(u); localStorage.setItem('eh_user', JSON.stringify(u)); setShowProfile(false); }}
        />
      )}

      {showStory && (
        <StoryBrief
          userName={user?.name?.split(' ')[0]}
          onClose={() => setShowStory(false)}
          autoPlay={true}
          slideDuration={6000}
        />
      )}

      {/* Mobile Assistant */}
      <div className="sm:hidden">
        <FloatingAssistant />
      </div>
    </div>
  );
}
