import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Zap, Recycle, Puzzle, TrendingUp, AlertTriangle, RefreshCw,
  GitBranch, CreditCard, Cog, Flame, Wrench, Users, MessageCircle,
  DoorOpen, BarChart3, ClipboardCheck, ChevronRight, Sparkles, Building,
  Calendar, ChevronDown, X, Check, Edit3, MapPin, Briefcase,
  Shield, Globe, Crown, Star, Battery, Database, Play, ArrowRight,
  Clock, CheckCircle, Target, Building2, Layers, Grid3X3
} from 'lucide-react';
import { getAllowedApps, ADMIN_EMAILS } from '../lib/permissions';
import { api } from '../lib/api';
import FloatingAssistant from '../components/AIAvatar/FloatingAssistant';
import StoryBrief from '../components/StoryBrief';

// Icon mapping for apps
const iconMap = {
  '⚡': Zap, '♻️': Recycle, '🧩': Puzzle, '📈': TrendingUp, '⚠️': AlertTriangle,
  '🔄': RefreshCw, '📐': GitBranch, '💳': CreditCard, '⚙️': Cog, '🧯': Flame,
  '🛠️': Wrench, '🤝': Users, '💬': MessageCircle, '🚪': DoorOpen, '📊': BarChart3,
  '📋': ClipboardCheck, '🔋': Battery, '🗄️': Database, '🔌': Zap,
};

// All apps with categories
const allApps = {
  electrical: [
    { id: 'switchboards', label: 'Tableaux', to: '/app/switchboards', icon: '⚡', color: 'from-amber-400 to-orange-500' },
    { id: 'vsd', label: 'VSD', to: '/app/vsd', icon: '⚙️', color: 'from-slate-400 to-gray-500' },
    { id: 'meca', label: 'Méca', to: '/app/meca', icon: '⚙️', color: 'from-zinc-400 to-stone-500' },
    { id: 'hv', label: 'Haute Tension', to: '/app/hv', icon: '⚡', color: 'from-yellow-400 to-amber-500' },
    { id: 'glo', label: 'GLO', to: '/app/glo', icon: '🔋', color: 'from-emerald-400 to-teal-500' },
    { id: 'mobile', label: 'Mobile', to: '/app/mobile-equipments', icon: '🔌', color: 'from-cyan-400 to-blue-500' },
    { id: 'datahub', label: 'DataHub', to: '/app/datahub', icon: '🗄️', color: 'from-indigo-400 to-purple-500' },
  ],
  analysis: [
    { id: 'obsolescence', label: 'Obsolescence', to: '/app/obsolescence', icon: '♻️', color: 'from-emerald-400 to-teal-500' },
    { id: 'selectivity', label: 'Sélectivité', to: '/app/selectivity', icon: '🧩', color: 'from-purple-400 to-indigo-500' },
    { id: 'fault-level', label: 'Icc', to: '/app/fault-level', icon: '📈', color: 'from-blue-400 to-cyan-500' },
    { id: 'arc-flash', label: 'Arc Flash', to: '/app/arc-flash', icon: '⚠️', color: 'from-red-400 to-rose-500' },
    { id: 'loopcalc', label: 'Boucle IS', to: '/app/loopcalc', icon: '🔄', color: 'from-sky-400 to-blue-500' },
  ],
  tools: [
    { id: 'controls', label: 'Contrôles', to: '/app/switchboard-controls', icon: '📋', color: 'from-blue-400 to-indigo-500' },
    { id: 'projects', label: 'Projets', to: '/app/projects', icon: '💳', color: 'from-green-400 to-emerald-500' },
    { id: 'atex', label: 'ATEX', to: '/app/atex', icon: '🧯', color: 'from-orange-400 to-red-500' },
    { id: 'doors', label: 'Portes Feu', to: '/app/doors', icon: '🚪', color: 'from-rose-400 to-pink-500' },
    { id: 'comp-ext', label: 'Contractors', to: '/app/comp-ext', icon: '🤝', color: 'from-teal-400 to-cyan-500' },
    { id: 'ask-veeva', label: 'Ask Veeva', to: '/app/ask-veeva', icon: '💬', color: 'from-violet-400 to-purple-500' },
    { id: 'dcf', label: 'DCF', to: '/app/dcf', icon: '📊', color: 'from-emerald-400 to-green-500' },
    { id: 'learn-ex', label: 'Formation', to: '/app/learn_ex', icon: '📊', color: 'from-amber-400 to-yellow-500' },
  ]
};

// Compact App Card
function AppCard({ label, to, icon, color, badge, navigate }) {
  const IconComponent = iconMap[icon] || Zap;

  return (
    <Link
      to={to}
      className="group relative bg-white rounded-xl p-3 shadow-sm hover:shadow-lg border border-gray-100 hover:border-gray-200 transition-all duration-300 hover:-translate-y-1"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-md group-hover:scale-110 transition-transform`}>
          <IconComponent size={18} />
        </div>
        <span className="font-medium text-gray-800 group-hover:text-gray-900 text-sm flex-1 truncate">
          {label}
        </span>
        {badge && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            badge.type === 'danger' ? 'bg-red-100 text-red-700' :
            badge.type === 'warning' ? 'bg-amber-100 text-amber-700' :
            'bg-blue-100 text-blue-700'
          }`}>
            {badge.value}
          </span>
        )}
        <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all" />
      </div>
    </Link>
  );
}

// Quick Stat Pill
function StatPill({ icon: Icon, value, label, color = 'blue', onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-${color}-50 hover:bg-${color}-100 transition-colors group`}
    >
      <Icon size={16} className={`text-${color}-500`} />
      <span className={`font-bold text-${color}-700`}>{value}</span>
      <span className="text-gray-500 text-sm hidden sm:inline">{label}</span>
    </button>
  );
}

// Role Badge component
function RoleBadge({ role }) {
  const config = {
    superadmin: { label: 'Super Admin', icon: Crown, color: 'from-amber-400 to-yellow-500', bg: 'bg-amber-50', text: 'text-amber-700' },
    admin: { label: 'Admin', icon: Shield, color: 'from-purple-400 to-indigo-500', bg: 'bg-purple-50', text: 'text-purple-700' },
    global: { label: 'Global', icon: Globe, color: 'from-emerald-400 to-teal-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    site: { label: 'Site', icon: MapPin, color: 'from-blue-400 to-cyan-500', bg: 'bg-blue-50', text: 'text-blue-700' },
  }[role] || { label: 'Site', icon: MapPin, color: 'from-blue-400 to-cyan-500', bg: 'bg-blue-50', text: 'text-blue-700' };

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${config.bg} ${config.text} text-xs font-medium`}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}

// Profile Modal
function ProfileModal({ user, departments, sites, onClose, onSave }) {
  const availableSites = sites || [];
  const availableDepts = departments || [];
  const [siteId, setSiteId] = useState(user?.site_id || availableSites.find(s => s.name === user?.site)?.id || null);
  const [departmentId, setDepartmentId] = useState(user?.department_id || availableDepts.find(d => d.name === user?.department)?.id || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('eh_token');
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: JSON.stringify({ department_id: departmentId, site_id: siteId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');

      const selectedDept = availableDepts.find(d => d.id === departmentId);
      const selectedSite = availableSites.find(s => s.id === siteId);
      if (data.jwt) localStorage.setItem('eh_token', data.jwt);

      onSave({
        ...user,
        department_id: departmentId,
        site_id: siteId,
        department: selectedDept?.name || user?.department,
        site: selectedSite?.name || user?.site,
      });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-scaleIn">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Mon Profil</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5 pb-4 border-b">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold">
            {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{user?.name || 'Unknown'}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site</label>
            <select
              value={siteId || ''}
              onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              <option value="">Sélectionner...</option>
              {availableSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Département</label>
            <select
              value={departmentId || ''}
              onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              <option value="">Sélectionner...</option>
              {availableDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Category Section
function AppSection({ title, apps, controlStats, navigate }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {apps.map((app) => (
          <AppCard
            key={app.id}
            {...app}
            navigate={navigate}
            badge={
              app.id === 'controls' && controlStats?.overdue > 0
                ? { type: 'danger', value: controlStats.overdue }
                : app.id === 'controls' && controlStats?.pending > 0
                ? { type: 'warning', value: controlStats.pending }
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState({});
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showStoryBrief, setShowStoryBrief] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [sites, setSites] = useState([]);
  const [controlStats, setControlStats] = useState({ overdue: 0, pending: 0, completed: 0 });
  const [briefData, setBriefData] = useState(null);

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setUser(storedUser);
    setTimeout(() => setMounted(true), 50);

    // Load data
    Promise.all([
      fetch('/api/departments').then(r => r.json()).catch(() => ({ departments: [] })),
      fetch('/api/sites').then(r => r.json()).catch(() => ({ sites: [] })),
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      api.switchboardControls.dashboard().catch(() => null)
    ]).then(([deptsRes, sitesRes, meRes, controlsRes]) => {
      setDepartments(deptsRes.departments || []);
      setSites(sitesRes.sites || []);

      if (meRes?.ok && meRes.user) {
        const currentUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
        const updatedUser = { ...currentUser, ...meRes.user };
        localStorage.setItem('eh_user', JSON.stringify(updatedUser));
        setUser(updatedUser);
      }

      if (controlsRes) {
        setControlStats({
          overdue: controlsRes.stats?.overdue || controlsRes.overdue_count || 0,
          pending: controlsRes.stats?.pending || controlsRes.pending_count || 0,
          completed: controlsRes.stats?.completed_this_week || 0
        });
      }
    });
  }, []);

  const site = user?.site || '';
  const userRole = user?.role || 'site';
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }, []);

  const currentDate = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  // Filter apps by permissions
  const allowedApps = useMemo(() => getAllowedApps(user?.email), [user?.email]);
  const filterApps = (apps) => apps.filter(app => allowedApps.some(a => a.route === app.to));

  const filteredElectrical = filterApps(allApps.electrical);
  const filteredAnalysis = filterApps(allApps.analysis);
  const filteredTools = filterApps(allApps.tools);

  // Add OIBT for Nyon
  const oibtApp = { id: 'oibt', label: 'OIBT', to: '/app/oibt', icon: '📋', color: 'from-indigo-400 to-blue-500' };
  if (site === 'Nyon' && allowedApps.some(a => a.id === 'oibt')) {
    filteredTools.push(oibtApp);
  }

  const totalApps = filteredElectrical.length + filteredAnalysis.length + filteredTools.length;

  const handleSaveProfile = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('eh_user', JSON.stringify(updatedUser));
    setShowProfileModal(false);
  };

  const getInitials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.2s ease-out; }
      `}</style>

      {/* Compact Header */}
      <header className="bg-gradient-to-r from-brand-600 via-brand-700 to-indigo-700 text-white">
        <div className={`max-w-6xl mx-auto px-4 py-6 transition-all duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center justify-between gap-4">
            {/* Left: User Info */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowProfileModal(true)}
                className="w-12 h-12 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-lg font-bold transition-colors"
              >
                {getInitials(user?.name)}
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold">{greeting}, {user?.name?.split(' ')[0] || 'Utilisateur'}</h1>
                  <RoleBadge role={userRole} />
                </div>
                <p className="text-white/70 text-sm flex items-center gap-1.5">
                  <Calendar size={12} />
                  {currentDate}
                  {site && (
                    <>
                      <span className="mx-1">•</span>
                      <MapPin size={12} />
                      {site}
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Right: Story Button */}
            <button
              onClick={() => setShowStoryBrief(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-xl transition-all hover:scale-105 group"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 flex items-center justify-center">
                <Play size={14} className="text-white fill-white" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium">Brief du matin</p>
                <p className="text-xs text-white/70">Vue immersive</p>
              </div>
              <ChevronRight size={16} className="text-white/50 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </header>

      {/* Quick Stats Bar */}
      <div className={`bg-white border-b shadow-sm transition-all duration-500 delay-100 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <StatPill
              icon={AlertTriangle}
              value={controlStats.overdue}
              label="en retard"
              color="red"
              onClick={() => navigate('/app/switchboard-controls?tab=overdue')}
            />
            <StatPill
              icon={Clock}
              value={controlStats.pending}
              label="à faire"
              color="amber"
              onClick={() => navigate('/app/switchboard-controls?tab=schedules')}
            />
            <StatPill
              icon={CheckCircle}
              value={controlStats.completed}
              label="cette semaine"
              color="emerald"
              onClick={() => navigate('/app/switchboard-controls')}
            />
            <div className="h-6 w-px bg-gray-200 mx-1" />
            <StatPill
              icon={Layers}
              value={totalApps}
              label="applications"
              color="blue"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className={`max-w-6xl mx-auto px-4 py-6 space-y-6 transition-all duration-500 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

        {/* Equipment Section */}
        {filteredElectrical.length > 0 && (
          <AppSection
            title="Équipements"
            apps={filteredElectrical}
            controlStats={controlStats}
            navigate={navigate}
          />
        )}

        {/* Analysis Section */}
        {filteredAnalysis.length > 0 && (
          <AppSection
            title="Analyses & Études"
            apps={filteredAnalysis}
            controlStats={controlStats}
            navigate={navigate}
          />
        )}

        {/* Tools Section */}
        {filteredTools.length > 0 && (
          <AppSection
            title="Outils & Utilitaires"
            apps={filteredTools}
            controlStats={controlStats}
            navigate={navigate}
          />
        )}

        {/* Footer */}
        <div className="pt-6 pb-8 text-center">
          <p className="text-gray-400 text-sm flex items-center justify-center gap-2">
            <Zap size={14} />
            ElectroHub — Gestion électrique centralisée
          </p>
        </div>
      </main>

      {/* Profile Modal */}
      {showProfileModal && (
        <ProfileModal
          user={user}
          departments={departments}
          sites={sites}
          onClose={() => setShowProfileModal(false)}
          onSave={handleSaveProfile}
        />
      )}

      {/* Story Brief */}
      {showStoryBrief && (
        <StoryBrief
          userName={user?.name?.split(' ')[0]}
          onClose={() => setShowStoryBrief(false)}
          autoPlay={true}
          slideDuration={6000}
        />
      )}

      {/* Floating Assistant - Mobile */}
      <div className="sm:hidden">
        <FloatingAssistant />
      </div>
    </div>
  );
}
