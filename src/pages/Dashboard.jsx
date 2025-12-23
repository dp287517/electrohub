import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Zap, Recycle, Puzzle, TrendingUp, AlertTriangle, RefreshCw,
  CreditCard, Cog, Flame, Wrench, Users, MessageCircle,
  DoorOpen, BarChart3, ClipboardCheck, ChevronRight, Sparkles,
  Calendar, X, MapPin, Briefcase, Shield, Globe, Crown, Battery, Database,
  Play, Clock, CheckCircle, ChevronDown, Building2, Layers, Activity,
  PieChart, TrendingDown, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { getAllowedApps } from '../lib/permissions';
import { api } from '../lib/api';
import WeatherBackground from '../components/WeatherBackground';
import FloatingAssistant from '../components/AIAvatar/FloatingAssistant';
import StoryBrief from '../components/StoryBrief';
import { aiAssistant } from '../lib/ai-assistant';

// Chart colors
const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  purple: '#8b5cf6',
  pink: '#ec4899',
  cyan: '#06b6d4',
  slate: '#64748b'
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

// Icon mapping
const iconMap = {
  '⚡': Zap, '♻️': Recycle, '🧩': Puzzle, '📈': TrendingUp, '⚠️': AlertTriangle,
  '🔄': RefreshCw, '💳': CreditCard, '⚙️': Cog, '🧯': Flame,
  '🛠️': Wrench, '🤝': Users, '💬': MessageCircle, '🚪': DoorOpen, '📊': BarChart3,
  '📋': ClipboardCheck, '🔋': Battery, '🗄️': Database, '🔌': Zap,
};

// All apps
const allApps = {
  equipment: [
    { id: 'switchboards', label: 'Tableaux Élec.', to: '/app/switchboards', icon: '⚡', color: 'from-amber-400 to-orange-500', desc: 'Gestion tableaux' },
    { id: 'vsd', label: 'VSD', to: '/app/vsd', icon: '⚙️', color: 'from-slate-400 to-gray-600', desc: 'Variateurs' },
    { id: 'meca', label: 'Mécanique', to: '/app/meca', icon: '⚙️', color: 'from-zinc-400 to-stone-600', desc: 'Équipements méca' },
    { id: 'hv', label: 'Haute Tension', to: '/app/hv', icon: '⚡', color: 'from-yellow-400 to-amber-600', desc: 'Équip. HT' },
    { id: 'glo', label: 'GLO', to: '/app/glo', icon: '🔋', color: 'from-emerald-400 to-teal-600', desc: 'UPS, batteries' },
    { id: 'mobile', label: 'Mobile', to: '/app/mobile-equipments', icon: '🔌', color: 'from-cyan-400 to-blue-600', desc: 'Équip. mobiles' },
    { id: 'datahub', label: 'DataHub', to: '/app/datahub', icon: '🗄️', color: 'from-indigo-400 to-purple-600', desc: 'Données custom' },
  ],
  analysis: [
    { id: 'obsolescence', label: 'Obsolescence', to: '/app/obsolescence', icon: '♻️', color: 'from-emerald-400 to-teal-600' },
    { id: 'selectivity', label: 'Sélectivité', to: '/app/selectivity', icon: '🧩', color: 'from-purple-400 to-indigo-600' },
    { id: 'fault-level', label: 'Icc', to: '/app/fault-level', icon: '📈', color: 'from-blue-400 to-cyan-600' },
    { id: 'arc-flash', label: 'Arc Flash', to: '/app/arc-flash', icon: '⚠️', color: 'from-red-400 to-rose-600' },
    { id: 'loopcalc', label: 'Boucle IS', to: '/app/loopcalc', icon: '🔄', color: 'from-sky-400 to-blue-600' },
  ],
  tools: [
    { id: 'controls', label: 'Contrôles', to: '/app/switchboard-controls', icon: '📋', color: 'from-blue-400 to-indigo-600' },
    { id: 'projects', label: 'Projets', to: '/app/projects', icon: '💳', color: 'from-green-400 to-emerald-600' },
    { id: 'atex', label: 'ATEX', to: '/app/atex', icon: '🧯', color: 'from-orange-400 to-red-600' },
    { id: 'doors', label: 'Portes Feu', to: '/app/doors', icon: '🚪', color: 'from-rose-400 to-pink-600' },
    { id: 'comp-ext', label: 'Contractors', to: '/app/comp-ext', icon: '🤝', color: 'from-teal-400 to-cyan-600' },
    { id: 'ask-veeva', label: 'Ask Veeva', to: '/app/ask-veeva', icon: '💬', color: 'from-violet-400 to-purple-600' },
    { id: 'dcf', label: 'DCF', to: '/app/dcf', icon: '📊', color: 'from-emerald-400 to-green-600' },
    { id: 'learn-ex', label: 'Formation', to: '/app/learn_ex', icon: '📊', color: 'from-amber-400 to-yellow-600' },
  ]
};

// Animated number counter
function AnimatedNumber({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = parseInt(value) || 0;
    if (start === end) return;
    const timer = setInterval(() => {
      start += Math.ceil(end / 20);
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, duration / 20);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <span>{display}</span>;
}

// Stat Card with animation
function StatCard({ icon: Icon, value, label, trend, trendValue, color, onClick, delay = 0 }) {
  const isPositive = trend === 'up';
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <button
      onClick={onClick}
      className="group relative bg-white rounded-2xl p-4 shadow-sm hover:shadow-xl border border-gray-100 transition-all duration-500 hover:-translate-y-1 text-left w-full overflow-hidden animate-fadeIn"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${color} opacity-5 rounded-full -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-700`} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg`}>
            <Icon size={20} className="text-white" />
          </div>
          {trend && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
              isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
            }`}>
              <TrendIcon size={12} />
              {trendValue}
            </div>
          )}
        </div>
        <p className="text-3xl font-bold text-gray-900 mb-1">
          <AnimatedNumber value={value} />
        </p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </button>
  );
}

// Mini Chart Card
function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

// App Card - Compact
function AppCard({ label, to, icon, color, badge }) {
  const IconComponent = iconMap[icon] || Zap;
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 bg-white rounded-xl p-3 shadow-sm hover:shadow-lg border border-gray-100 transition-all duration-300 hover:-translate-y-0.5"
    >
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform`}>
        <IconComponent size={18} />
      </div>
      <span className="font-medium text-gray-800 text-sm flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 animate-pulse">
          {badge}
        </span>
      )}
      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all" />
    </Link>
  );
}

// Role Badge
function RoleBadge({ role }) {
  const cfg = {
    superadmin: { icon: Crown, bg: 'bg-amber-100', text: 'text-amber-700', label: 'Super Admin' },
    admin: { icon: Shield, bg: 'bg-purple-100', text: 'text-purple-700', label: 'Admin' },
    global: { icon: Globe, bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Global' },
    site: { icon: MapPin, bg: 'bg-blue-100', text: 'text-blue-700', label: 'Site' },
  }[role] || { icon: MapPin, bg: 'bg-blue-100', text: 'text-blue-700', label: 'Site' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} text-xs font-medium`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

// Profile Modal
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
        ...user,
        site_id: siteId, department_id: deptId,
        site: sites?.find(s => s.id === siteId)?.name,
        department: departments?.find(d => d.id === deptId)?.name
      });
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-scaleIn">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Mon Profil</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="flex items-center gap-3 mb-5 pb-4 border-b">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
            {user?.name?.charAt(0) || '?'}
          </div>
          <div>
            <p className="font-semibold">{user?.name}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>
        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium mb-1.5">Site</label>
            <select value={siteId || ''} onChange={e => setSiteId(+e.target.value || null)}
              className="w-full px-3 py-2.5 rounded-lg border focus:ring-2 focus:ring-blue-500">
              <option value="">Sélectionner...</option>
              {sites?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Département</label>
            <select value={deptId || ''} onChange={e => setDeptId(+e.target.value || null)}
              className="w-full px-3 py-2.5 rounded-lg border focus:ring-2 focus:ring-blue-500">
              <option value="">Sélectionner...</option>
              {departments?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border hover:bg-gray-50">Annuler</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Custom Tooltip for charts
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white px-3 py-2 rounded-lg shadow-lg border text-sm">
      <p className="font-medium text-gray-900">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

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
  const [historicalData, setHistoricalData] = useState([]);
  const [equipmentData, setEquipmentData] = useState([]);
  const [showAllApps, setShowAllApps] = useState(false);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setUser(stored);
    setTimeout(() => setMounted(true), 50);

    // Load all data
    Promise.all([
      fetch('/api/departments').then(r => r.json()).catch(() => ({})),
      fetch('/api/sites').then(r => r.json()).catch(() => ({})),
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      api.switchboardControls.dashboard().catch(() => null),
      aiAssistant.getMorningBrief().catch(() => null),
      aiAssistant.getHistoricalStats(14).catch(() => null)
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
        // Equipment distribution for pie chart
        if (brief.charts?.equipmentDistribution) {
          setEquipmentData(brief.charts.equipmentDistribution.map((d, i) => ({
            name: d.name, value: d.value, color: PIE_COLORS[i % PIE_COLORS.length]
          })));
        }
      }

      // Historical data for area chart
      if (historical?.labels && historical?.datasets) {
        const data = historical.labels.slice(-7).map((label, i) => ({
          name: new Date(label).toLocaleDateString('fr-FR', { weekday: 'short' }),
          completed: historical.datasets.controlsCompleted?.[i] || 0,
          nc: historical.datasets.ncCreated?.[i] || 0
        }));
        setHistoricalData(data);
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

  // Add OIBT for Nyon
  if (site === 'Nyon' && allowedApps.some(a => a.id === 'oibt')) {
    tools.push({ id: 'oibt', label: 'OIBT', to: '/app/oibt', icon: '📋', color: 'from-indigo-400 to-blue-600' });
  }

  const allFilteredApps = [...equipment, ...analysis, ...tools];
  const healthScore = briefData?.healthScore || 85;

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; opacity: 0; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
        .animate-pulse-ring { animation: pulse-ring 2s ease-out infinite; }
      `}</style>

      {/* Hero with Weather */}
      <WeatherBackground site={site}>
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 transition-all duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* User Info */}
            <div className="flex items-center gap-4">
              <button onClick={() => setShowProfile(true)}
                className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white text-xl font-bold hover:bg-white/30 transition-all hover:scale-105 shadow-xl">
                {user?.name?.charAt(0) || '?'}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center">
                  <CheckCircle size={10} className="text-white" />
                </div>
              </button>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold text-white drop-shadow-lg">
                    {greeting}, {user?.name?.split(' ')[0] || 'Utilisateur'}
                  </h1>
                  <RoleBadge role={role} />
                </div>
                <p className="text-white/80 text-sm flex items-center gap-2 mt-1">
                  <Calendar size={14} />
                  {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {site && <><span className="mx-1">•</span><MapPin size={14} />{site}</>}
                </p>
              </div>
            </div>

            {/* Story Button */}
            <button onClick={() => setShowStory(true)}
              className="group flex items-center gap-3 px-5 py-3 bg-white/20 backdrop-blur-md border border-white/30 rounded-2xl hover:bg-white/30 transition-all hover:scale-105 shadow-xl">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl animate-pulse-ring" />
                <div className="relative w-10 h-10 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center">
                  <Play size={16} className="text-white fill-white ml-0.5" />
                </div>
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Brief du matin</p>
                <p className="text-white/70 text-xs">Voir la story</p>
              </div>
              <ChevronRight size={18} className="text-white/60 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </WeatherBackground>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 -mt-6 relative z-10 pb-8">

        {/* Stats Grid */}
        <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <StatCard
            icon={AlertTriangle}
            value={stats.overdue}
            label="Contrôles en retard"
            color="from-red-400 to-rose-600"
            onClick={() => navigate('/app/switchboard-controls?tab=overdue')}
            delay={100}
          />
          <StatCard
            icon={Clock}
            value={stats.pending}
            label="À planifier"
            color="from-amber-400 to-orange-600"
            onClick={() => navigate('/app/switchboard-controls?tab=schedules')}
            delay={200}
          />
          <StatCard
            icon={CheckCircle}
            value={stats.completed}
            label="Complétés (semaine)"
            trend="up" trendValue="+12%"
            color="from-emerald-400 to-teal-600"
            onClick={() => navigate('/app/switchboard-controls')}
            delay={300}
          />
          <StatCard
            icon={Activity}
            value={healthScore}
            label="Score de santé"
            color="from-blue-400 to-indigo-600"
            onClick={() => setShowStory(true)}
            delay={400}
          />
        </div>

        {/* Charts Row */}
        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          {/* Area Chart - Trend */}
          <ChartCard title="Activité des 7 derniers jours" className="lg:col-span-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={COLORS.success} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorNc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.danger} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={COLORS.danger} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="completed" name="Complétés" stroke={COLORS.success} fill="url(#colorCompleted)" strokeWidth={2} />
                  <Area type="monotone" dataKey="nc" name="NC créées" stroke={COLORS.danger} fill="url(#colorNc)" strokeWidth={2} strokeDasharray="5 5" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 rounded" />Contrôles complétés</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 rounded border-dashed" style={{ borderStyle: 'dashed' }} />NC créées</span>
            </div>
          </ChartCard>

          {/* Pie Chart - Equipment */}
          <ChartCard title="Répartition équipements">
            <div className="h-48 flex items-center justify-center">
              {equipmentData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={equipmentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {equipmentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </RechartsPie>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-400 text-sm">Chargement...</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 justify-center">
              {equipmentData.slice(0, 4).map((d, i) => (
                <span key={i} className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </span>
              ))}
            </div>
          </ChartCard>
        </div>

        {/* Apps Section */}
        <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Layers size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Mes Applications</h2>
                <p className="text-sm text-gray-500">{allFilteredApps.length} apps disponibles</p>
              </div>
            </div>
            <button
              onClick={() => setShowAllApps(!showAllApps)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showAllApps ? 'Réduire' : 'Voir tout'}
              <ChevronDown size={16} className={`transition-transform ${showAllApps ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Quick Access - Always visible */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
            {(showAllApps ? allFilteredApps : allFilteredApps.slice(0, 10)).map(app => (
              <AppCard
                key={app.id}
                {...app}
                badge={app.id === 'controls' ? stats.overdue : 0}
              />
            ))}
          </div>

          {/* Collapsed sections when expanded */}
          {showAllApps && (
            <div className="mt-6 pt-6 border-t space-y-4">
              {equipment.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Équipements</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {equipment.map(a => <AppCard key={a.id} {...a} />)}
                  </div>
                </div>
              )}
              {analysis.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Analyses</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {analysis.map(a => <AppCard key={a.id} {...a} />)}
                  </div>
                </div>
              )}
              {tools.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Outils</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {tools.map(a => <AppCard key={a.id} {...a} badge={a.id === 'controls' ? stats.overdue : 0} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm flex items-center justify-center gap-2">
            <Zap size={14} className="text-blue-500" />
            ElectroHub — Votre plateforme de gestion électrique
          </p>
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
