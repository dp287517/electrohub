import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, UserPlus, Users, Key, Trash2, Search, Plus, X, Check,
  Eye, EyeOff, Copy, RefreshCw, Building2, Mail, Lock, AlertTriangle,
  Globe, MapPin, Briefcase, Edit3, Save, AppWindow, CheckSquare,
  Square, ChevronDown, Sparkles, Database, Loader2, History, LogIn, LogOut,
  FileText, Settings, Upload, Image, Bot, Clock, UserCheck, UserX, Bug,
  Box, Package, ExternalLink, Palette, Ruler
} from 'lucide-react';
import { api } from '../lib/api.js';
import { ADMIN_EMAILS, ALL_APPS } from '../lib/permissions';

// API base URL
const API_BASE = '/api/admin';

// Helper to get fetch options with auth (cookies + header)
function getAuthOptions(extraOptions = {}) {
  const token = localStorage.getItem('eh_token');
  return {
    credentials: 'include', // Send cookies
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    },
    ...extraOptions
  };
}

// Countries with cities
const COUNTRIES = {
  'Switzerland': ['Nyon', 'Geneva', 'Lausanne', 'Zurich', 'Basel', 'Bern'],
  'France': ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Strasbourg'],
  'Germany': ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne', 'Stuttgart'],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow', 'Bristol'],
  'Italy': ['Milan', 'Rome', 'Turin', 'Florence', 'Naples', 'Bologna', 'Aprilia', 'Levice'],
  'Spain': ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Malaga'],
  'Belgium': ['Brussels', 'Antwerp', 'Ghent', 'Liège', 'Bruges'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  'Slovakia': ['Levice', 'Bratislava', 'Kosice'],
};

function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function TabButton({ active, onClick, icon: Icon, children, count }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-3 font-medium transition-all border-b-2 whitespace-nowrap ${active ? 'border-brand-600 text-brand-700 bg-brand-50' : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}>
      <Icon size={18} />{children}
      {count !== undefined && <span className={`px-2 py-0.5 text-xs rounded-full ${active ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{count}</span>}
    </button>
  );
}

function Modal({ title, icon: Icon, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl ${wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'} max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {Icon && <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center"><Icon size={20} className="text-white" /></div>}
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

function AppSelector({ selectedApps, onChange, showByDefault = false }) {
  const [showApps, setShowApps] = useState(showByDefault);
  const toggleApp = (appId) => onChange(selectedApps.includes(appId) ? selectedApps.filter(a => a !== appId) : [...selectedApps, appId]);
  const toggleCategory = (category) => {
    const ids = ALL_APPS.filter(a => a.category === category).map(a => a.id);
    onChange(ids.every(id => selectedApps.includes(id)) ? selectedApps.filter(id => !ids.includes(id)) : [...new Set([...selectedApps, ...ids])]);
  };

  return (
    <div>
      <button type="button" onClick={() => setShowApps(!showApps)} className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2"><AppWindow size={18} /><span className="font-medium">Application Access</span><span className="text-sm text-gray-500">({selectedApps.length}/{ALL_APPS.length})</span></div>
        <ChevronDown size={18} className={`transition-transform ${showApps ? 'rotate-180' : ''}`} />
      </button>
      {showApps && (
        <div className="mt-3 p-4 border border-gray-200 rounded-xl space-y-4">
          <div className="flex gap-2 mb-3">
            <button type="button" onClick={() => onChange(ALL_APPS.map(a => a.id))} className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-lg hover:bg-green-100">All</button>
            <button type="button" onClick={() => onChange([])} className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">None</button>
          </div>
          {['Electrical', 'Utilities'].map(cat => (
            <div key={cat}>
              <button type="button" onClick={() => toggleCategory(cat)} className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700 hover:text-brand-600">
                {ALL_APPS.filter(a => a.category === cat).every(a => selectedApps.includes(a.id)) ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}{cat}
              </button>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {ALL_APPS.filter(a => a.category === cat).map(app => (
                  <button key={app.id} type="button" onClick={() => toggleApp(app.id)}
                    className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${selectedApps.includes(app.id) ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-gray-50 text-gray-600 border border-gray-100 hover:bg-gray-100'}`}>
                    {selectedApps.includes(app.id) ? <CheckSquare size={14} /> : <Square size={14} />}<span>{app.icon}</span><span className="truncate">{app.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingSpinner({ text = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="text-brand-600 animate-spin" />
        <p className="text-gray-500">{text}</p>
      </div>
    </div>
  );
}

function ErrorMessage({ error, onRetry }) {
  return (
    <div className="text-center py-12">
      <AlertTriangle size={48} className="mx-auto text-red-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900">Error loading data</h3>
      <p className="text-gray-500 mt-1">{error}</p>
      {onRetry && <button onClick={onRetry} className="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">Retry</button>}
    </div>
  );
}

// ============== PENDING USERS TAB ==============
function PendingUsersTab({ sites, departments, onRefresh }) {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(null);
  const [validateModalUser, setValidateModalUser] = useState(null); // User being configured for validation
  const [debugEmail, setDebugEmail] = useState('');
  const [debugResult, setDebugResult] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const handleDebugUser = async () => {
    if (!debugEmail.trim()) return;
    setDebugLoading(true);
    setDebugResult(null);
    try {
      const response = await fetch(`${API_BASE}/users/debug/${encodeURIComponent(debugEmail.trim())}`, getAuthOptions());
      const data = await response.json();
      setDebugResult(data);
    } catch (err) {
      setDebugResult({ error: err.message, findings: ['Erreur lors du diagnostic'] });
    } finally {
      setDebugLoading(false);
    }
  };

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/users/pending`, getAuthOptions());
      const data = await response.json();
      setPendingUsers(data.users || []);
    } catch (err) {
      console.error('Error fetching pending users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleValidate = async (userId, allowed_apps = null, email = null, site_id = null, department_id = null, name = null) => {
    setValidating(userId);
    try {
      // If userId looks like an email (no numeric id), use email-based validation
      const isEmailId = userId && typeof userId === 'string' && userId.includes('@');
      const response = await fetch(`${API_BASE}/users/validate/${isEmailId ? 'by-email' : userId}`, {
        method: 'POST',
        ...getAuthOptions(),
        body: JSON.stringify({ allowed_apps, email: isEmailId ? userId : email, site_id, department_id, name })
      });
      if (!response.ok) throw new Error('Failed to validate user');
      setValidateModalUser(null);
      fetchPending();
      onRefresh();
    } catch (err) {
      alert('Error validating user: ' + err.message);
    } finally {
      setValidating(null);
    }
  };

  // Open validation modal instead of directly validating
  const openValidateModal = (user) => {
    setValidateModalUser(user);
  };

  const handleReject = async (userId, email = null) => {
    if (!confirm('Rejeter cet utilisateur ? Il sera marqué comme rejeté.')) return;
    setValidating(userId);
    try {
      // If userId looks like an email, use email-based rejection
      const isEmailId = userId && typeof userId === 'string' && userId.includes('@');
      const response = await fetch(`${API_BASE}/users/reject/${isEmailId ? 'by-email' : userId}`, {
        method: 'POST',
        ...getAuthOptions(),
        body: JSON.stringify({ email: isEmailId ? userId : email })
      });
      if (!response.ok) throw new Error('Failed to reject user');
      fetchPending();
    } catch (err) {
      alert('Error rejecting user: ' + err.message);
    } finally {
      setValidating(null);
    }
  };

  if (loading) return <LoadingSpinner text="Loading pending users..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Clock size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm text-amber-800 font-medium">Utilisateurs en attente de validation</p>
            <p className="text-sm text-amber-600 mt-1">
              Ces utilisateurs se sont connectés via haleon-tool.io mais n'ont pas encore été validés.
              Ils ne peuvent accéder à aucune application tant qu'ils ne sont pas validés.
            </p>
          </div>
        </div>
      </div>

      {/* Debug Tool */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bug size={18} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Diagnostic utilisateur</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Un utilisateur ne s'affiche pas dans la liste ? Entrez son email pour diagnostiquer le problème.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={debugEmail}
            onChange={(e) => setDebugEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDebugUser()}
            placeholder="email@haleon.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={handleDebugUser}
            disabled={debugLoading || !debugEmail.trim()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {debugLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Diagnostiquer
          </button>
        </div>

        {/* Debug Results */}
        {debugResult && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-gray-900">Résultat pour: {debugResult.email}</span>
              <button onClick={() => setDebugResult(null)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            {/* Findings */}
            <div className="space-y-2 mb-4">
              {debugResult.findings?.map((finding, idx) => (
                <p key={idx} className="text-sm text-gray-700">{finding}</p>
              ))}
            </div>

            {/* Recommendation */}
            {debugResult.recommendation && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800 font-medium">Recommandation:</p>
                <p className="text-sm text-blue-700 mt-1">{debugResult.recommendation}</p>
              </div>
            )}

            {/* Auth Audit Log */}
            {debugResult.auth_audit_log?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Historique des connexions (dernières 20):</p>
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-2 py-1 text-left">Date</th>
                        <th className="px-2 py-1 text-left">Action</th>
                        <th className="px-2 py-1 text-left">Succès</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debugResult.auth_audit_log.map((log, idx) => (
                        <tr key={idx} className="border-t border-gray-100">
                          <td className="px-2 py-1">{new Date(log.ts).toLocaleString('fr-FR')}</td>
                          <td className="px-2 py-1">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                              log.action === 'LOGIN' ? 'bg-green-100 text-green-700' :
                              log.action === 'LOGIN_PENDING' ? 'bg-amber-100 text-amber-700' :
                              log.action === 'NEW_USER_PENDING' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-2 py-1">{log.success ? '✓' : '✗'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tables Status */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="p-2 bg-white rounded border">
                <p className="text-xs font-medium text-gray-500">Table users</p>
                <p className="text-sm">
                  {debugResult.users_table ? (
                    <span className={debugResult.users_table.is_active ? 'text-green-600' : 'text-amber-600'}>
                      {debugResult.users_table.is_active ? '✓ Actif' : '⏳ Inactif'}
                    </span>
                  ) : (
                    <span className="text-gray-400">Non trouvé</span>
                  )}
                </p>
              </div>
              <div className="p-2 bg-white rounded border">
                <p className="text-xs font-medium text-gray-500">Table haleon_users</p>
                <p className="text-sm">
                  {debugResult.haleon_users_table ? (
                    <span className={debugResult.haleon_users_table.is_validated ? 'text-green-600' : 'text-amber-600'}>
                      {debugResult.haleon_users_table.is_validated ? '✓ Validé' : '⏳ Non validé'}
                    </span>
                  ) : (
                    <span className="text-gray-400">Non trouvé</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pending users list */}
      {pendingUsers.length === 0 ? (
        <div className="text-center py-16">
          <UserCheck size={48} className="mx-auto text-green-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Aucun utilisateur en attente</h3>
          <p className="text-gray-500 mt-1">Tous les utilisateurs ont été validés</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {pendingUsers.map(user => {
            // Use email as identifier for users from activity tables (no id)
            const uniqueId = user.id || user.email;
            return (
            <div key={uniqueId} className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="p-4 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                    <span className="text-lg font-bold text-amber-600">
                      {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 flex items-center gap-2">
                      {user.name || user.email?.split('@')[0]}
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-600 rounded-full flex items-center gap-1">
                        <Clock size={12} /> En attente
                      </span>
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-gray-400">
                        Première activité: {user.created_at ? new Date(user.created_at).toLocaleString('fr-FR') : 'N/A'}
                      </p>
                      {user.source && (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          via {user.source}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openValidateModal(user)}
                    disabled={validating === uniqueId}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {validating === uniqueId ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <UserCheck size={16} />
                    )}
                    Valider
                  </button>
                  <button
                    onClick={() => handleReject(uniqueId, user.email)}
                    disabled={validating === uniqueId}
                    className="flex items-center gap-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <UserX size={16} />
                    Rejeter
                  </button>
                </div>
              </div>
            </div>
          );})}
        </div>
      )}

      {/* Validation Modal */}
      {validateModalUser && (
        <ValidatePendingUserModal
          user={validateModalUser}
          sites={sites}
          departments={departments}
          onClose={() => setValidateModalUser(null)}
          onValidate={(config) => {
            const uniqueId = validateModalUser.id || validateModalUser.email;
            handleValidate(uniqueId, config.allowed_apps, validateModalUser.email, config.site_id, config.department_id, config.name);
          }}
          validating={validating === (validateModalUser.id || validateModalUser.email)}
        />
      )}
    </div>
  );
}

// ============== VALIDATE PENDING USER MODAL ==============
function ValidatePendingUserModal({ user, sites, departments, onClose, onValidate, validating }) {
  const [name, setName] = useState(user?.name || user?.email?.split('@')[0] || '');
  const [siteId, setSiteId] = useState(user?.site_id || sites[0]?.id || 1);
  const [departmentId, setDepartmentId] = useState(user?.department_id || null);
  const [selectedApps, setSelectedApps] = useState([]); // Start with NO apps selected

  const handleSubmit = (e) => {
    e.preventDefault();
    onValidate({
      name,
      site_id: siteId,
      department_id: departmentId,
      allowed_apps: selectedApps
    });
  };

  return (
    <Modal title="Valider l'utilisateur" icon={UserCheck} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* User info */}
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-xl font-bold text-green-600">
                {user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
            <div>
              <p className="font-medium text-gray-900">{user?.email}</p>
              <p className="text-sm text-green-600">Sera validé et pourra accéder aux apps sélectionnées</p>
            </div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom affiché</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500"
            placeholder="Nom de l'utilisateur"
          />
        </div>

        {/* Site & Department */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site</label>
            <select
              value={siteId || ''}
              onChange={(e) => setSiteId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500"
            >
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Département</label>
            <select
              value={departmentId || ''}
              onChange={(e) => setDepartmentId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500"
            >
              <option value="">-- Non assigné --</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        {/* App selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Applications autorisées</label>
          <p className="text-xs text-amber-600 mb-2">Sélectionnez les applications auxquelles cet utilisateur aura accès</p>
          <AppSelector selectedApps={selectedApps} onChange={setSelectedApps} />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={validating || selectedApps.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-colors disabled:opacity-50"
          >
            {validating ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
            Valider ({selectedApps.length} apps)
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============== HALEON USERS TAB ==============
function HaleonUsersTab({ haleonUsers, sites, departments, onRefresh, loading }) {
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = haleonUsers.filter(u => u.email?.toLowerCase().includes(searchQuery.toLowerCase()) || u.name?.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleSave = async (userData, isNew = false) => {
    setSaving(true);
    try {
      // For updates, use by-email endpoint since users can come from different tables
      const url = isNew ? `${API_BASE}/users/haleon` : `${API_BASE}/users/haleon/by-email`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        ...getAuthOptions(),
        body: JSON.stringify(userData)
      });

      if (!response.ok) throw new Error('Failed to save user');
      onRefresh();
      setShowAddModal(false);
      setEditingId(null);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await fetch(`${API_BASE}/users/haleon/${id}`, getAuthOptions({ method: 'DELETE' }));
      onRefresh();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) return <LoadingSpinner text="Loading Haleon users..." />;

  return (
    <div>
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
        <Sparkles size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-blue-800 font-medium">Haleon Users (via Bubble/haleon-tool.io)</p>
          <p className="text-sm text-blue-600 mt-1">Configure application access for Haleon employees. Users not listed here will have access to all applications by default.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search Haleon users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none" />
        </div>
        <button onClick={() => setShowAddModal(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-lg">
          <UserPlus size={20} />Add Haleon User
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16"><Sparkles size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-lg font-medium text-gray-900">No Haleon users configured</h3><p className="text-gray-500 mt-1">Add users to manage their app access</p></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(user => (
            <div key={user.id || user.email} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold">{user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}</div>
                  <div>
                    <p className="font-medium text-gray-900 flex items-center gap-2">{user.name || user.email?.split('@')[0]}<span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full">Haleon</span></p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {user.site_name && <span className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded-lg flex items-center gap-1"><MapPin size={12} />{user.site_name}</span>}
                  {user.department_name && <span className="text-xs px-2 py-1 bg-teal-50 text-teal-600 rounded-lg">{user.department_name}</span>}
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded-lg">{user.allowed_apps?.length ?? ALL_APPS.length} apps</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(user.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(user.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && <HaleonUserModal sites={sites} departments={departments} saving={saving} onClose={() => setShowAddModal(false)} onSave={(u) => handleSave(u, true)} />}
      {editingId && <HaleonUserModal user={haleonUsers.find(u => u.id === editingId)} sites={sites} departments={departments} saving={saving} onClose={() => setEditingId(null)} onSave={handleSave} />}
    </div>
  );
}

function HaleonUserModal({ user, sites, departments, saving, onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [siteId, setSiteId] = useState(user?.site_id || sites[0]?.id || 1);
  const [departmentId, setDepartmentId] = useState(user?.department_id || departments[0]?.id || null);
  const [selectedApps, setSelectedApps] = useState(user?.allowed_apps || ALL_APPS.map(a => a.id));

  return (
    <Modal title={user ? 'Edit Haleon User' : 'Add Haleon User'} icon={Sparkles} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; onSave({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], site_id: siteId, department_id: departmentId, allowed_apps: selectedApps }); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Mail size={14} />Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@haleon.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required disabled={!!user} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" /></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><MapPin size={14} />Site</label>
            <select value={siteId} onChange={(e) => setSiteId(Number(e.target.value))} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Briefcase size={14} />Department</label>
            <select value={departmentId || ''} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">
              <option value="">No department</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
        </div>
        <AppSelector selectedApps={selectedApps} onChange={setSelectedApps} showByDefault={true} />
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50" disabled={saving}>Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center justify-center gap-2" disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}{user ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============== EXTERNAL USERS TAB ==============
function ExternalUsersTab({ users, sites, companies, departments, onRefresh, loading }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPasswords, setNewPasswords] = useState({});

  const filtered = users.filter(u => {
    const matchesSearch = u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          u.company_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCompany = !companyFilter || u.company_id === Number(companyFilter);
    const matchesSite = !siteFilter || u.site_id === Number(siteFilter);
    return matchesSearch && matchesCompany && matchesSite;
  });

  const handleSave = async (userData, isNew = false) => {
    setSaving(true);
    try {
      const url = isNew ? `${API_BASE}/users/external` : `${API_BASE}/users/external/${editingId}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        ...getAuthOptions(),
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save user');
      }

      // Show password for new users
      if (isNew && userData.password) {
        const result = await response.json();
        setNewPasswords({ ...newPasswords, [result.id]: userData.password });
      }

      onRefresh();
      setShowCreate(false);
      setEditingId(null);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await fetch(`${API_BASE}/users/external/${id}`, getAuthOptions({ method: 'DELETE' }));
      onRefresh();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleResetPassword = async (id) => {
    const pwd = generatePassword();
    setSaving(true);
    try {
      await fetch(`${API_BASE}/users/external/${id}`, getAuthOptions({
        method: 'PUT',
        body: JSON.stringify({ password: pwd })
      }));
      setNewPasswords({ ...newPasswords, [id]: pwd });
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner text="Loading external users..." />;

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search external users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 outline-none" />
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl shadow-lg">
            <UserPlus size={20} />New External User
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="px-4 py-2 rounded-xl border border-gray-200 outline-none bg-white text-sm">
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="px-4 py-2 rounded-xl border border-gray-200 outline-none bg-white text-sm">
            <option value="">All Sites</option>
            {sites.filter(s => !companyFilter || s.company_id === Number(companyFilter)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {(companyFilter || siteFilter) && (
            <button onClick={() => { setCompanyFilter(''); setSiteFilter(''); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Clear filters</button>
          )}
          <span className="ml-auto text-sm text-gray-500">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16"><Users size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-lg font-medium">No external users</h3></div>
      ) : (
        <div className="space-y-3">
          {filtered.map(user => (
            <div key={user.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-semibold">{user.name?.[0]?.toUpperCase() || '?'}</div>
                  <div>
                    <p className="font-medium text-gray-900 flex items-center gap-2">{user.name || user.email}<span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full">External</span></p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {user.role && user.role !== 'site' && (
                    <span className={`text-xs px-2 py-1 rounded-lg flex items-center gap-1 font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                      user.role === 'global' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role === 'global' ? <Globe size={12} /> : <Shield size={12} />}
                      {user.role === 'global' ? 'Global' : user.role === 'admin' ? 'Admin' : user.role}
                    </span>
                  )}
                  {user.company_name && <span className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded-lg flex items-center gap-1"><Building2 size={12} />{user.company_name}</span>}
                  {(user.role === 'global' || user.role === 'admin') ? (
                    <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg flex items-center gap-1">
                      <Globe size={12} />Tous les sites
                    </span>
                  ) : user.site_name && (
                    <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg flex items-center gap-1">
                      <MapPin size={12} />{user.site_name}
                    </span>
                  )}
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded-lg">{user.allowed_apps?.length || 0} apps</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResetPassword(user.id)} className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg" title="Reset Password"><Key size={16} /></button>
                  <button onClick={() => setEditingId(user.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(user.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
              {newPasswords[user.id] && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <div><p className="text-sm text-green-800 font-medium">New password:</p><code className="text-sm font-mono">{newPasswords[user.id]}</code></div>
                  <button onClick={() => { navigator.clipboard.writeText(newPasswords[user.id]); setNewPasswords({ ...newPasswords, [user.id]: null }); }} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg flex items-center gap-1"><Copy size={14} />Copy</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <ExternalUserModal sites={sites} companies={companies} departments={departments} saving={saving} onClose={() => setShowCreate(false)} onSave={(u) => handleSave(u, true)} />}
      {editingId && <ExternalUserModal user={users.find(u => u.id === editingId)} sites={sites} companies={companies} departments={departments} saving={saving} onClose={() => setEditingId(null)} onSave={handleSave} />}
    </div>
  );
}

function ExternalUserModal({ user, sites, companies, departments, saving, onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [companyId, setCompanyId] = useState(user?.company_id || '');
  const [siteId, setSiteId] = useState(user?.site_id || sites[0]?.id || 1);
  const [departmentId, setDepartmentId] = useState(user?.department_id || departments[0]?.id || null);
  const [role, setRole] = useState(user?.role || 'site');
  const [password, setPassword] = useState(user ? '' : generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [selectedApps, setSelectedApps] = useState(user?.allowed_apps || []);

  // Count sites per company for global role info
  const companySites = companyId ? sites.filter(s => s.company_id === Number(companyId)) : sites;
  const isGlobalOrAdmin = role === 'global' || role === 'admin';

  return (
    <Modal title={user ? 'Modifier utilisateur externe' : 'Nouvel utilisateur externe'} icon={UserPlus} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; onSave({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], company_id: companyId || null, site_id: siteId, department_id: departmentId, role, password: password || undefined, allowed_apps: selectedApps }); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Mail size={14} />Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required disabled={!!user} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Nom</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jean Dupont" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" /></div>
        </div>

        {/* Role selection - prominent position with clear explanations */}
        <div className="p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-200">
          <label className="block text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Shield size={16} className="text-indigo-600" />
            Niveau d'accès
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            <button type="button" onClick={() => setRole('site')}
              className={`p-4 rounded-xl border-2 text-left transition-all ${role === 'site' ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${role === 'site' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <MapPin size={16} />
                </div>
                <span className={`font-semibold ${role === 'site' ? 'text-blue-700' : 'text-gray-700'}`}>Site</span>
              </div>
              <p className="text-xs text-gray-500">Accès limité à <strong>un seul site</strong></p>
            </button>
            <button type="button" onClick={() => setRole('global')}
              className={`p-4 rounded-xl border-2 text-left transition-all ${role === 'global' ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${role === 'global' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <Globe size={16} />
                </div>
                <span className={`font-semibold ${role === 'global' ? 'text-emerald-700' : 'text-gray-700'}`}>Global</span>
              </div>
              <p className="text-xs text-gray-500">Accès à <strong>tous les sites</strong> de la société</p>
            </button>
            <button type="button" onClick={() => setRole('admin')}
              className={`p-4 rounded-xl border-2 text-left transition-all ${role === 'admin' ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${role === 'admin' ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <Shield size={16} />
                </div>
                <span className={`font-semibold ${role === 'admin' ? 'text-purple-700' : 'text-gray-700'}`}>Admin</span>
              </div>
              <p className="text-xs text-gray-500"><strong>Gestion des utilisateurs</strong> + tous les sites</p>
            </button>
          </div>
          {isGlobalOrAdmin && companyId && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-700 text-sm">
              <Globe size={16} />
              <span>Cet utilisateur aura accès aux <strong>{companySites.length} sites</strong> de cette société</span>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Building2 size={14} />Société {isGlobalOrAdmin && <span className="text-xs text-gray-400">(obligatoire pour Global)</span>}</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')} className={`w-full px-4 py-2.5 rounded-xl border outline-none ${isGlobalOrAdmin && !companyId ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
              <option value="">Aucune société</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {isGlobalOrAdmin && !companyId && <p className="text-xs text-amber-600 mt-1">⚠️ Sélectionnez une société pour le rôle {role}</p>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><MapPin size={14} />{isGlobalOrAdmin ? 'Site par défaut' : 'Site'}</label>
            <select value={siteId} onChange={(e) => setSiteId(Number(e.target.value))} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">
              {sites.filter(s => !companyId || s.company_id === Number(companyId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {isGlobalOrAdmin && <p className="text-xs text-gray-400 mt-1">Site affiché par défaut au login</p>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Briefcase size={14} />Département</label>
            <select value={departmentId || ''} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">
              <option value="">Aucun département</option>
              {departments.filter(d => !siteId || d.site_id === siteId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
        </div>
        {!user && (
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Lock size={14} />Password</label>
            <div className="flex gap-2">
              <div className="flex-1 relative"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-200 outline-none font-mono" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              <button type="button" onClick={() => setPassword(generatePassword())} className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl"><RefreshCw size={18} /></button>
            </div></div>
        )}
        <AppSelector selectedApps={selectedApps} onChange={setSelectedApps} />
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50" disabled={saving}>Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 flex items-center justify-center gap-2" disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}{user ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============== COMPANIES TAB ==============
function CompaniesTab({ companies, onRefresh, loading }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = companies.filter(c => c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.country?.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleSave = async (companyData, isNew = false) => {
    setSaving(true);
    try {
      const url = isNew ? `${API_BASE}/companies` : `${API_BASE}/companies/${editingId}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, getAuthOptions({
        method,
        body: JSON.stringify(companyData)
      }));

      if (!response.ok) throw new Error('Failed to save company');
      onRefresh();
      setShowCreate(false);
      setEditingId(null);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this company?')) return;
    try {
      await fetch(`${API_BASE}/companies/${id}`, getAuthOptions({ method: 'DELETE' }));
      onRefresh();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) return <LoadingSpinner text="Loading companies..." />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search companies..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 outline-none" />
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl shadow-lg"><Plus size={20} />New Company</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16"><Building2 size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-lg font-medium">No companies yet</h3></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(company => (
            <div key={company.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-lg">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold ${company.is_internal ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-gradient-to-br from-purple-400 to-purple-600'}`}>{company.name?.[0]?.toUpperCase() || '?'}</div>
                <div className="flex gap-1">
                  {company.is_internal && <span className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded-full">Internal</span>}
                  <button onClick={() => setEditingId(company.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  {!company.is_internal && <button onClick={() => handleDelete(company.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{company.name}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500"><Globe size={14} />{company.country}<span className="text-gray-300">•</span><MapPin size={14} />{company.city}</div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CompanyModal saving={saving} onClose={() => setShowCreate(false)} onSave={(c) => handleSave(c, true)} />}
      {editingId && <CompanyModal company={companies.find(c => c.id === editingId)} saving={saving} onClose={() => setEditingId(null)} onSave={handleSave} />}
    </div>
  );
}

function CompanyModal({ company, saving, onClose, onSave }) {
  const [name, setName] = useState(company?.name || '');
  const [country, setCountry] = useState(company?.country || 'Switzerland');
  const [city, setCity] = useState(company?.city || 'Nyon');
  const [isInternal, setIsInternal] = useState(company?.is_internal || false);

  return (
    <Modal title={company ? 'Edit Company' : 'New Company'} icon={Building2} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onSave({ name, country, city, is_internal: isInternal }); }} className="space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Company Name *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Globe size={14} />Country</label>
            <select value={country} onChange={(e) => { setCountry(e.target.value); setCity(COUNTRIES[e.target.value]?.[0] || ''); }} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><MapPin size={14} />City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{(COUNTRIES[country] || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="is_internal" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
          <label htmlFor="is_internal" className="text-sm text-gray-700">Internal company (like Haleon)</label>
        </div>
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50" disabled={saving}>Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 flex items-center justify-center gap-2" disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}{company ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============== SITES TAB ==============
function SitesTab({ sites, onRefresh, loading }) {
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (siteData) => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/sites`, getAuthOptions({
        method: 'POST',
        body: JSON.stringify(siteData)
      }));

      if (!response.ok) throw new Error('Failed to create site');
      onRefresh();
      setShowCreate(false);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner text="Loading sites..." />;

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl shadow-lg"><Plus size={20} />New Site</button>
      </div>

      {sites.length === 0 ? (
        <div className="text-center py-16"><MapPin size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-lg font-medium">No sites yet</h3></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map(site => (
            <div key={site.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white"><MapPin size={18} /></div>
                <div>
                  <h3 className="font-semibold text-gray-900">{site.name}</h3>
                  <p className="text-sm text-gray-500">Code: {site.code}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Site" icon={MapPin} onClose={() => setShowCreate(false)}>
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); handleSave({ code: fd.get('code'), name: fd.get('name') }); }} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Site Code *</label>
              <input type="text" name="code" placeholder="NYO" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Site Name *</label>
              <input type="text" name="name" placeholder="Nyon" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50" disabled={saving}>Cancel</button>
              <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 flex items-center justify-center gap-2" disabled={saving}>
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ============== DEPARTMENTS TAB ==============
// ============== AUTH AUDIT TAB ==============
function AuthAuditTab() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ action: '', email: '', success: '' });
  const pageSize = 30;

  const fetchAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), pageSize: pageSize.toString() });
      if (filter.action) params.append('action', filter.action);
      if (filter.email) params.append('email', filter.email);
      if (filter.success !== '') params.append('success', filter.success);

      const [eventsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/auth-audit?${params}`, getAuthOptions()),
        fetch(`${API_BASE}/auth-audit/stats?days=7`, getAuthOptions())
      ]);

      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setEvents(data.data || []);
        setTotal(data.total || 0);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (err) {
      console.error('[AuthAudit] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { fetchAuditData(); }, [fetchAuditData]);

  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 text-green-600 mb-2"><LogIn size={18} /><span className="text-sm font-medium">Logins (7j)</span></div>
            <div className="text-2xl font-bold">{stats.global?.total_logins || 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 text-red-600 mb-2"><AlertTriangle size={18} /><span className="text-sm font-medium">Failed (7j)</span></div>
            <div className="text-2xl font-bold">{stats.global?.failed_logins || 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 text-orange-600 mb-2"><LogOut size={18} /><span className="text-sm font-medium">Logouts (7j)</span></div>
            <div className="text-2xl font-bold">{stats.global?.total_logouts || 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-2"><Users size={18} /><span className="text-sm font-medium">Unique Users</span></div>
            <div className="text-2xl font-bold">{stats.global?.unique_users || 0}</div>
          </div>
        </div>
      )}

      {/* Recent Failed (Security alert) */}
      {stats?.recentFailed?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2"><AlertTriangle size={18} />Failed Login Attempts (24h)</h3>
          <div className="space-y-2">
            {stats.recentFailed.slice(0, 5).map((f, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-white rounded-lg p-2">
                <span className="font-medium text-gray-800">{f.email || 'unknown'}</span>
                <span className="text-gray-500">{f.ip_address}</span>
                <span className="text-xs text-gray-400">{formatDate(f.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 mb-1 block">Email</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by email..."
                value={filter.email}
                onChange={(e) => { setFilter({ ...filter, email: e.target.value }); setPage(1); }}
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm"
              />
            </div>
          </div>
          <div className="w-40">
            <label className="text-xs text-gray-500 mb-1 block">Action</label>
            <select
              value={filter.action}
              onChange={(e) => { setFilter({ ...filter, action: e.target.value }); setPage(1); }}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            >
              <option value="">All</option>
              <option value="LOGIN">Login</option>
              <option value="LOGIN_FAILED">Failed</option>
              <option value="LOGOUT">Logout</option>
            </select>
          </div>
          <div className="w-32">
            <label className="text-xs text-gray-500 mb-1 block">Status</label>
            <select
              value={filter.success}
              onChange={(e) => { setFilter({ ...filter, success: e.target.value }); setPage(1); }}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            >
              <option value="">All</option>
              <option value="true">Success</option>
              <option value="false">Failed</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={fetchAuditData} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
              <RefreshCw size={16} />Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-gray-500"><History size={48} className="mx-auto text-gray-300 mb-4" /><p>No events found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Date/Time</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Company</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Site</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">IP</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(ev.ts)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        ev.action === 'LOGIN' ? 'bg-green-100 text-green-700' :
                        ev.action === 'LOGIN_FAILED' ? 'bg-red-100 text-red-700' :
                        ev.action === 'LOGOUT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {ev.action === 'LOGIN' && <LogIn size={12} />}
                        {ev.action === 'LOGIN_FAILED' && <AlertTriangle size={12} />}
                        {ev.action === 'LOGOUT' && <LogOut size={12} />}
                        {ev.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{ev.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{ev.user_name || '-'}</td>
                    <td className="px-4 py-3">
                      {ev.role && <span className={`px-2 py-0.5 rounded text-xs ${
                        ev.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                        ev.role === 'global' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>{ev.role}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{ev.company_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{ev.site_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{ev.ip_address || '-'}</td>
                    <td className="px-4 py-3">
                      {ev.success ? (
                        <span className="inline-flex items-center gap-1 text-green-600"><Check size={14} />OK</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600" title={ev.error_message}><X size={14} />Fail</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">{total} events</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-200 text-sm disabled:opacity-50"
              >Previous</button>
              <span className="px-3 py-1 text-sm text-gray-600">Page {page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 text-sm disabled:opacity-50"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DepartmentsTab({ departments, onRefresh, loading }) {
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (deptData) => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/departments`, getAuthOptions({
        method: 'POST',
        body: JSON.stringify(deptData)
      }));

      if (!response.ok) throw new Error('Failed to create department');
      onRefresh();
      setShowCreate(false);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner text="Loading departments..." />;

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl shadow-lg"><Plus size={20} />New Department</button>
      </div>

      {departments.length === 0 ? (
        <div className="text-center py-16"><Briefcase size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-lg font-medium">No departments yet</h3></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {departments.map((dept) => (
            <div key={dept.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3 hover:shadow-md">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-white"><Briefcase size={14} /></div>
              <div>
                <span className="font-medium text-gray-900">{dept.name}</span>
                <p className="text-xs text-gray-500">Code: {dept.code}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Department" icon={Briefcase} onClose={() => setShowCreate(false)}>
          <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); handleSave({ code: fd.get('code'), name: fd.get('name') }); }} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Department Code *</label>
              <input type="text" name="code" placeholder="MAINT" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Department Name *</label>
              <input type="text" name="name" placeholder="Maintenance" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50" disabled={saving}>Cancel</button>
              <button type="submit" className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 flex items-center justify-center gap-2" disabled={saving}>
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ============== VSD PLANS TAB ==============
function VsdPlansTab() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [previewPlan, setPreviewPlan] = useState(null);
  const zipInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  // Import api
  const fetchPlans = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/vsd/maps/listPlans', getAuthOptions());
      const data = await response.json();
      setPlans(data.plans || []);
    } catch (err) {
      console.error('Error fetching plans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, []);

  const handleZipUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('zip', file);
      const response = await fetch('/api/vsd/maps/uploadZip', {
        method: 'POST',
        ...getAuthOptions(),
        headers: {}, // Don't set Content-Type for FormData
        body: fd
      });
      const data = await response.json();
      if (data.ok) {
        setUploadResult({ success: true, message: `${data.imported?.length || 0} plan(s) importé(s) avec succès`, imported: data.imported });
        fetchPlans();
      } else {
        setUploadResult({ success: false, message: data.error || 'Erreur lors de l\'import' });
      }
    } catch (err) {
      setUploadResult({ success: false, message: err.message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const response = await fetch('/api/vsd/maps/uploadPdf', {
        method: 'POST',
        ...getAuthOptions(),
        headers: {}, // Don't set Content-Type for FormData
        body: fd
      });
      const data = await response.json();
      if (data.ok) {
        setUploadResult({ success: true, message: `Plan "${data.plan?.logical_name}" importé (v${data.plan?.version})`, imported: [data.plan] });
        fetchPlans();
      } else {
        setUploadResult({ success: false, message: data.error || 'Erreur lors de l\'import' });
      }
    } catch (err) {
      setUploadResult({ success: false, message: err.message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) return <LoadingSpinner text="Chargement des plans VSD..." />;

  return (
    <div className="space-y-6">
      {/* Header avec info */}
      <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
            <MapPin size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-emerald-900">Gestion des Plans</h3>
            <p className="text-sm text-emerald-700 mt-1">
              Importez vos plans PDF pour localiser vos équipements.
              Ces plans sont partagés entre tous les modules (VSD, MECA, GLO, Switchboard, Datahub, Mobile, HV).
              Les marqueurs existants sont automatiquement préservés lors des mises à jour.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus size={18} className="text-emerald-600" />
          Importer des plans
        </h3>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* ZIP Upload */}
          <div
            onClick={() => !uploading && zipInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              uploading ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50'
            }`}
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white">
              <Database size={24} />
            </div>
            <p className="font-medium text-gray-900">Import ZIP</p>
            <p className="text-sm text-gray-500 mt-1">Plusieurs plans PDF dans un fichier ZIP</p>
            <p className="text-xs text-gray-400 mt-2">Max 300 Mo</p>
            <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleZipUpload} disabled={uploading} />
          </div>

          {/* Single PDF Upload */}
          <div
            onClick={() => !uploading && pdfInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              uploading ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-blue-300 hover:border-blue-400 hover:bg-blue-50'
            }`}
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white">
              <Eye size={24} />
            </div>
            <p className="font-medium text-gray-900">Import PDF</p>
            <p className="text-sm text-gray-500 mt-1">Un seul fichier PDF</p>
            <p className="text-xs text-gray-400 mt-2">Max 100 Mo</p>
            <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} disabled={uploading} />
          </div>
        </div>

        {uploading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-emerald-600">
            <Loader2 size={18} className="animate-spin" />
            <span>Import en cours...</span>
          </div>
        )}

        {uploadResult && (
          <div className={`mt-4 p-4 rounded-xl flex items-start gap-3 ${
            uploadResult.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
          }`}>
            {uploadResult.success ? (
              <Check size={20} className="text-emerald-600 mt-0.5" />
            ) : (
              <AlertTriangle size={20} className="text-red-600 mt-0.5" />
            )}
            <div>
              <p className={`font-medium ${uploadResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
                {uploadResult.message}
              </p>
              {uploadResult.imported && uploadResult.imported.length > 0 && (
                <ul className="mt-2 text-sm text-emerald-700 space-y-1">
                  {uploadResult.imported.map((p, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {p.logical_name || p.filename} (v{p.version}, {p.page_count} page{p.page_count > 1 ? 's' : ''})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Plans List */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <MapPin size={18} className="text-emerald-600" />
            Plans disponibles ({plans.length})
          </h3>
          <button onClick={fetchPlans} className="p-2 hover:bg-gray-100 rounded-lg" title="Actualiser">
            <RefreshCw size={16} className="text-gray-500" />
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="p-12 text-center">
            <MapPin size={48} className="mx-auto text-gray-300 mb-4" />
            <h4 className="text-lg font-medium text-gray-900">Aucun plan disponible</h4>
            <p className="text-gray-500 mt-1">Importez un fichier ZIP ou PDF pour commencer</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {plans.map(plan => (
              <div key={plan.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  {/* Preview Thumbnail */}
                  <div
                    className="w-16 h-16 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-emerald-400 transition-all overflow-hidden"
                    onClick={() => setPreviewPlan(plan)}
                  >
                    <iframe
                      src={`/api/vsd/maps/planFile?logical_name=${encodeURIComponent(plan.logical_name)}&site=Default#page=1&view=FitH`}
                      className="w-full h-full border-0 pointer-events-none"
                      style={{ transform: 'scale(0.15)', transformOrigin: 'top left', width: '400%', height: '400%' }}
                    />
                  </div>

                  {/* Plan Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-medium text-gray-900 truncate">{plan.display_name || plan.logical_name}</h4>
                      <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full">v{plan.version}</span>
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">{plan.page_count || 1} page{(plan.page_count || 1) > 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{plan.filename}</p>
                    <p className="text-xs text-gray-400 mt-1">ID: {plan.logical_name}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewPlan(plan)}
                      className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg"
                      title="Prévisualiser"
                    >
                      <Eye size={18} />
                    </button>
                    <a
                      href={`/api/vsd/maps/planFile?logical_name=${encodeURIComponent(plan.logical_name)}&site=Default`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg"
                      title="Ouvrir dans un nouvel onglet"
                    >
                      <Globe size={18} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewPlan(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
                  <MapPin size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{previewPlan.display_name || previewPlan.logical_name}</h3>
                  <p className="text-sm text-gray-500">Version {previewPlan.version} - {previewPlan.page_count || 1} page(s)</p>
                </div>
              </div>
              <button onClick={() => setPreviewPlan(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={`/api/vsd/maps/planFile?logical_name=${encodeURIComponent(previewPlan.logical_name)}&site=Default`}
                className="w-full h-full min-h-[600px] border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== PLAN SCALE TAB ==============
// Configure the scale of plans for measurements
function PlanScaleTab() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scaleConfigs, setScaleConfigs] = useState({});
  const [editingPlan, setEditingPlan] = useState(null);
  const [scaleRatio, setScaleRatio] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch plans
  const fetchPlans = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/vsd/maps/listPlans', getAuthOptions());
      const data = await response.json();
      const plansList = data.plans || [];
      setPlans(plansList);

      // Fetch scale configs for all plans
      const configs = {};
      for (const plan of plansList) {
        try {
          const scaleRes = await fetch(`/api/measurements/scale/${plan.id}?page=0`, getAuthOptions());
          const scaleData = await scaleRes.json();
          if (scaleData.ok && scaleData.scale) {
            configs[plan.id] = scaleData.scale;
          }
        } catch {}
      }
      setScaleConfigs(configs);
    } catch (err) {
      console.error('Error fetching plans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, []);

  // Save scale from ratio
  // For architectural plans: 1:100 means 1cm on plan = 100cm real = 1m
  // PDF rendered at ~150 DPI: 1 inch = 150 pixels = 25.4mm
  // 1 pixel = 25.4/150 = 0.169mm = 0.000169m
  // At scale 1:X, 1 pixel represents 0.000169 * X meters
  const saveScaleFromRatio = async (plan, ratio) => {
    console.log('[PlanScaleTab] saveScaleFromRatio called', { plan: plan?.id, ratio });
    if (!plan || !ratio || ratio <= 0) {
      console.log('[PlanScaleTab] Invalid params, aborting');
      return;
    }

    setSaving(true);
    try {
      // Approximate: PDF at 150 DPI, 1 pixel on plan = (25.4/150) mm
      // At scale 1:ratio, real distance = pixel_mm * ratio / 1000 meters
      const pixelSizeMm = 25.4 / 150; // ~0.169 mm per pixel
      const metersPerPixel = (pixelSizeMm * ratio) / 1000;

      const payload = {
        planId: plan.id,
        pageIndex: 0,
        point1: { x: 0, y: 0 },
        point2: { x: 1, y: 0 },
        realDistanceMeters: metersPerPixel * 1000, // Distance for 1000 pixels
        imageWidth: 1000,
        imageHeight: 750,
        scaleRatio: ratio
      };
      console.log('[PlanScaleTab] Sending payload:', payload);

      const res = await fetch('/api/measurements/scale', {
        method: 'POST',
        ...getAuthOptions(),
        body: JSON.stringify(payload)
      });
      console.log('[PlanScaleTab] Response status:', res.status);

      const data = await res.json();
      console.log('[PlanScaleTab] Response data:', data);

      if (data.ok) {
        setScaleConfigs(prev => ({ ...prev, [plan.id]: { ...data.scale, scale_ratio: ratio } }));
        setEditingPlan(null);
        setScaleRatio('');
        console.log('[PlanScaleTab] Scale saved successfully');
      } else {
        console.error('[PlanScaleTab] Server returned error:', data.error);
        alert('Erreur: ' + (data.error || 'Erreur inconnue'));
      }
    } catch (err) {
      console.error('[PlanScaleTab] Error saving scale:', err);
      alert('Erreur réseau: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Get ratio from existing scale config
  const getRatioFromScale = (scaleConfig) => {
    if (scaleConfig?.scale_ratio) return scaleConfig.scale_ratio;
    if (scaleConfig?.scale_meters_per_pixel) {
      const pixelSizeMm = 25.4 / 150;
      const ratio = (parseFloat(scaleConfig.scale_meters_per_pixel) * 1000) / pixelSizeMm;
      return Math.round(ratio);
    }
    return null;
  };

  if (loading) return <LoadingSpinner text="Chargement des plans..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
            <Ruler size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">Configuration de l'echelle des plans</h3>
            <p className="text-sm text-amber-700 mt-1">
              Entrez l'echelle de chaque plan (ex: 1:100 pour un plan ou 1 cm = 1 m).
              Cette echelle permet ensuite de mesurer des distances et surfaces sur les cartes.
            </p>
          </div>
        </div>
      </div>

      {/* Plans List */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText size={18} className="text-amber-600" />
            Plans ({plans.length})
          </h3>
          <button onClick={fetchPlans} className="p-2 hover:bg-gray-100 rounded-lg" title="Actualiser">
            <RefreshCw size={16} className="text-gray-500" />
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={48} className="mx-auto text-gray-300 mb-4" />
            <h4 className="text-lg font-medium text-gray-900">Aucun plan disponible</h4>
            <p className="text-gray-500 mt-1">Importez des plans dans l'onglet "Plans" d'abord</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {plans.map(plan => {
              const scaleConfig = scaleConfigs[plan.id];
              const hasScale = !!scaleConfig;
              const existingRatio = getRatioFromScale(scaleConfig);
              const isEditing = editingPlan?.id === plan.id;

              return (
                <div key={plan.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    {/* Status indicator */}
                    <div className={`w-3 h-3 rounded-full ${hasScale ? 'bg-green-500' : 'bg-amber-500'}`} />

                    {/* Plan Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium text-gray-900 truncate">
                          {plan.display_name || plan.logical_name}
                        </h4>
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                          v{plan.version}
                        </span>
                        {hasScale ? (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                            <Check size={12} /> 1:{existingRatio || '?'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full flex items-center gap-1">
                            <AlertTriangle size={12} /> Non configure
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Edit Scale */}
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">1 :</span>
                        <input
                          type="number"
                          value={scaleRatio}
                          onChange={(e) => setScaleRatio(e.target.value)}
                          placeholder="100"
                          className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                          autoFocus
                        />
                        <button
                          onClick={() => saveScaleFromRatio(plan, parseFloat(scaleRatio))}
                          disabled={!scaleRatio || saving}
                          className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => { setEditingPlan(null); setScaleRatio(''); }}
                          className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingPlan(plan);
                          setScaleRatio(existingRatio?.toString() || '');
                        }}
                        className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                          hasScale
                            ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                      >
                        <Ruler size={16} />
                        {hasScale ? 'Modifier' : 'Configurer'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Help section */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <h4 className="font-medium text-blue-900 mb-2">Comment trouver l'echelle ?</h4>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li><strong>1:50</strong> - Plans de details (1 cm = 50 cm)</li>
          <li><strong>1:100</strong> - Plans d'etage standards (1 cm = 1 m)</li>
          <li><strong>1:200</strong> - Plans de batiment (1 cm = 2 m)</li>
          <li><strong>1:500</strong> - Plans de site (1 cm = 5 m)</li>
        </ul>
        <p className="text-xs text-blue-600 mt-2">
          L'echelle est generalement indiquee dans le cartouche du plan.
        </p>
      </div>
    </div>
  );
}

// ============== CUSTOM MODULES TAB ==============
// Allows admins to create dynamic pages without code changes
const ICON_OPTIONS = [
  { value: 'box', label: 'Box' },
  { value: 'package', label: 'Package' },
  { value: 'folder', label: 'Folder' },
  { value: 'server', label: 'Server' },
  { value: 'cpu', label: 'CPU' },
  { value: 'harddrive', label: 'Hard Drive' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'wifi', label: 'Wifi' },
  { value: 'zap', label: 'Zap' },
  { value: 'power', label: 'Power' },
  { value: 'battery', label: 'Battery' },
  { value: 'plug', label: 'Plug' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'factory', label: 'Factory' },
  { value: 'building', label: 'Building' },
  { value: 'home', label: 'Home' },
  { value: 'shield', label: 'Shield' },
  { value: 'flag', label: 'Flag' },
  { value: 'star', label: 'Star' },
  { value: 'clock', label: 'Clock' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'bell', label: 'Bell' },
  { value: 'user', label: 'User' },
  { value: 'users', label: 'Users' },
  { value: 'flame', label: 'Flame' },
  { value: 'droplet', label: 'Droplet' },
  { value: 'sun', label: 'Sun' },
  { value: 'cloud', label: 'Cloud' },
];

const COLOR_OPTIONS = [
  '#8b5cf6', // Violet
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#0ea5e9', // Sky
  '#06b6d4', // Cyan
  '#14b8a6', // Teal
  '#10b981', // Emerald
  '#22c55e', // Green
  '#84cc16', // Lime
  '#eab308', // Yellow
  '#f59e0b', // Amber
  '#f97316', // Orange
  '#ef4444', // Red
  '#ec4899', // Pink
  '#a855f7', // Purple
  '#6b7280', // Gray
];

function CustomModulesTab() {
  const navigate = useNavigate();
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingModule, setEditingModule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    icon: 'box',
    color: '#8b5cf6',
    description: '',
    agent_name: '',
    agent_emoji: '📦'
  });

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customModules.listAllModules();
      setModules(res.modules || []);
    } catch (e) {
      console.error('Error loading modules:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadModules(); }, [loadModules]);

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      await api.customModules.createModule({
        ...formData,
        agent_name: formData.agent_name || formData.name
      });
      setShowCreateModal(false);
      setFormData({ name: '', icon: 'box', color: '#8b5cf6', description: '', agent_name: '', agent_emoji: '📦' });
      await loadModules();
    } catch (e) {
      alert('Erreur: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingModule || !formData.name.trim()) return;
    setSaving(true);
    try {
      await api.customModules.updateModule(editingModule.slug, formData);
      setEditingModule(null);
      await loadModules();
    } catch (e) {
      alert('Erreur: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mod) => {
    if (!confirm(`Supprimer le module "${mod.name}" et toutes ses données ?`)) return;
    try {
      await api.customModules.deleteModule(mod.slug);
      await loadModules();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  const handleToggleActive = async (mod) => {
    try {
      await api.customModules.updateModule(mod.slug, { is_active: !mod.is_active });
      await loadModules();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  const openEdit = (mod) => {
    setFormData({
      name: mod.name,
      icon: mod.icon,
      color: mod.color,
      description: mod.description || '',
      agent_name: mod.agent_name || '',
      agent_emoji: mod.agent_emoji || '📦'
    });
    setEditingModule(mod);
  };

  const closeModals = () => {
    setShowCreateModal(false);
    setEditingModule(null);
    setFormData({ name: '', icon: 'box', color: '#8b5cf6', description: '', agent_name: '', agent_emoji: '📦' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Modules Personnalisés</h2>
          <p className="text-gray-600">Créez des pages d'équipements sans code</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 shadow-lg"
        >
          <Plus size={20} /> Nouveau Module
        </button>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      ) : modules.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border">
          <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Aucun module personnalisé</h3>
          <p className="text-gray-500 mb-6">Créez votre premier module pour gérer des équipements personnalisés.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700"
          >
            <Plus size={18} className="inline mr-2" /> Créer un module
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map(mod => (
            <div key={mod.id} className={`bg-white rounded-2xl border overflow-hidden ${!mod.is_active ? 'opacity-60' : ''}`}>
              <div className="p-4" style={{ borderTop: `4px solid ${mod.color}` }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl"
                      style={{ backgroundColor: mod.color }}
                    >
                      {mod.agent_emoji || '📦'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{mod.name}</h3>
                      <p className="text-sm text-gray-500">/app/m/{mod.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => navigate(`/app/m/${mod.slug}`)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-violet-600"
                      title="Ouvrir"
                    >
                      <ExternalLink size={16} />
                    </button>
                    <button
                      onClick={() => openEdit(mod)}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600"
                      title="Modifier"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(mod)}
                      className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600"
                      title="Supprimer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {mod.description && (
                  <p className="mt-3 text-sm text-gray-600 line-clamp-2">{mod.description}</p>
                )}
                <div className="mt-4 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4 text-gray-500">
                    <span>{mod.item_count || 0} éléments</span>
                    <span>{mod.category_count || 0} catégories</span>
                  </div>
                  <button
                    onClick={() => handleToggleActive(mod)}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      mod.is_active
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {mod.is_active ? 'Actif' : 'Inactif'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingModule) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingModule ? 'Modifier le module' : 'Nouveau module'}
                </h2>
                <button onClick={closeModals} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom du module *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    placeholder="Ex: Ordinateurs, Imprimantes, Véhicules..."
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    rows={2}
                    placeholder="Description du module..."
                  />
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Couleur</label>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_OPTIONS.map(color => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-lg ${formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Icon */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Icône</label>
                  <select
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                  >
                    {ICON_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* AI Agent */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Bot size={16} /> Agent IA
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nom de l'agent</label>
                      <input
                        type="text"
                        value={formData.agent_name}
                        onChange={(e) => setFormData({ ...formData, agent_name: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500"
                        placeholder="Ex: Max, Luna..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Emoji</label>
                      <input
                        type="text"
                        value={formData.agent_emoji}
                        onChange={(e) => setFormData({ ...formData, agent_emoji: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500"
                        placeholder="📦"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </div>

                {/* Preview */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Aperçu</h3>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl"
                      style={{ backgroundColor: formData.color }}
                    >
                      {formData.agent_emoji || '📦'}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{formData.name || 'Nouveau module'}</p>
                      <p className="text-sm text-gray-500">Agent: {formData.agent_name || formData.name || 'Sans nom'}</p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={closeModals}
                    className="flex-1 py-2 border rounded-xl font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={editingModule ? handleUpdate : handleCreate}
                    disabled={saving || !formData.name.trim()}
                    className="flex-1 py-2 rounded-xl text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: formData.color }}
                  >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {editingModule ? 'Enregistrer' : 'Créer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== SETTINGS TAB ==============
function SettingsTab() {
  const [aiIconInfo, setAiIconInfo] = useState(null);
  const [aiVideoInfo, setAiVideoInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(null); // 'idle' | 'speaking' | null
  const [previewUrl, setPreviewUrl] = useState(null);
  const [idleVideoUrl, setIdleVideoUrl] = useState(null);
  const [speakingVideoUrl, setSpeakingVideoUrl] = useState(null);
  const fileInputRef = useRef(null);
  const idleVideoInputRef = useRef(null);
  const speakingVideoInputRef = useRef(null);

  // Multi-agent video system
  const [agentsList, setAgentsList] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [uploadingAgentVideo, setUploadingAgentVideo] = useState(null); // 'agentType-idle' | 'agentType-speaking' | null
  const [agentNames, setAgentNames] = useState({});
  const [editingAgentName, setEditingAgentName] = useState(null); // agentType being edited
  const [tempAgentName, setTempAgentName] = useState('');

  // Fetch agent custom names
  const fetchAgentNames = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/ai-agents/names`, getAuthOptions());
      const data = await res.json();
      if (data.names) {
        setAgentNames(data.names);
      }
    } catch (err) {
      console.error('Error fetching agent names:', err);
    }
  }, []);

  // Update agent name
  const handleUpdateAgentName = async (agentType, newName) => {
    try {
      const token = localStorage.getItem('eh_token');
      const res = await fetch(`${API_BASE}/settings/ai-agents/${agentType}/name`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: newName })
      });

      if (!res.ok) throw new Error('Failed to update name');

      setAgentNames(prev => ({ ...prev, [agentType]: newName }));
      setEditingAgentName(null);
    } catch (err) {
      console.error('Error updating agent name:', err);
      alert('Erreur: ' + err.message);
    }
  };

  // Fetch AI agents list with video status
  const fetchAgentsList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/ai-agents/list`, getAuthOptions());
      const data = await res.json();
      if (data.agents) {
        setAgentsList(data.agents);
      }
    } catch (err) {
      console.error('Error fetching agents list:', err);
    }
  }, []);

  // Upload video for specific agent
  const handleAgentVideoUpload = async (file, agentType, videoType) => {
    if (!file) return;

    const uploadKey = `${agentType}-${videoType}`;
    setUploadingAgentVideo(uploadKey);

    try {
      const formData = new FormData();
      formData.append('video', file);

      const token = localStorage.getItem('eh_token');
      const res = await fetch(`${API_BASE}/settings/ai-agents/${agentType}/${videoType}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      await fetchAgentsList();
    } catch (err) {
      console.error('Error uploading agent video:', err);
      alert('Erreur: ' + err.message);
    } finally {
      setUploadingAgentVideo(null);
    }
  };

  // Delete videos for specific agent
  const handleDeleteAgentVideos = async (agentType) => {
    const agent = agentsList.find(a => a.type === agentType);
    if (!confirm(`Supprimer les vidéos de ${agent?.name || agentType} ?`)) return;

    try {
      const token = localStorage.getItem('eh_token');
      await fetch(`${API_BASE}/settings/ai-agents/${agentType}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      await fetchAgentsList();
    } catch (err) {
      console.error('Error deleting agent videos:', err);
    }
  };

  // Fetch AI icon info
  const fetchAiIconInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/ai-icon/info`, getAuthOptions());
      const data = await res.json();
      setAiIconInfo(data);
      if (data.hasCustomIcon) {
        setPreviewUrl(`${API_BASE}/settings/ai-icon?t=${Date.now()}`);
      } else {
        setPreviewUrl(null);
      }
    } catch (err) {
      console.error('Error fetching AI icon info:', err);
    }
  }, []);

  // Fetch AI video info
  const fetchAiVideoInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/ai-video/info`, getAuthOptions());
      const data = await res.json();
      setAiVideoInfo(data);
      if (data.hasIdleVideo) {
        setIdleVideoUrl(`${API_BASE}/settings/ai-video/idle?t=${Date.now()}`);
      } else {
        setIdleVideoUrl(null);
      }
      if (data.hasSpeakingVideo) {
        setSpeakingVideoUrl(`${API_BASE}/settings/ai-video/speaking?t=${Date.now()}`);
      } else {
        setSpeakingVideoUrl(null);
      }
    } catch (err) {
      console.error('Error fetching AI video info:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAiIconInfo(), fetchAiVideoInfo(), fetchAgentsList(), fetchAgentNames()]).finally(() => setLoading(false));
  }, [fetchAiIconInfo, fetchAiVideoInfo, fetchAgentsList, fetchAgentNames]);

  // Handle file selection
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('icon', file);

      const token = localStorage.getItem('eh_token');
      const res = await fetch(`${API_BASE}/settings/ai-icon`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        await fetchAiIconInfo();
        alert('AI icon uploaded successfully!');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      alert('Error uploading icon: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!confirm('Remove custom AI icon and revert to default?')) return;

    try {
      const res = await fetch(`${API_BASE}/settings/ai-icon`, {
        ...getAuthOptions(),
        method: 'DELETE'
      });

      if (res.ok) {
        setPreviewUrl(null);
        setAiIconInfo({ hasCustomIcon: false });
        alert('AI icon removed');
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
    } catch (err) {
      alert('Error removing icon: ' + err.message);
    }
  };

  // Handle video file selection
  const handleVideoSelect = async (e, videoType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!validTypes.includes(file.type)) {
      alert('Please select a valid video file (MP4, WebM, or OGG)');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setUploadingVideo(videoType);
    try {
      const formData = new FormData();
      formData.append('video', file);

      const token = localStorage.getItem('eh_token');
      const res = await fetch(`${API_BASE}/settings/ai-video/${videoType}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        await fetchAiVideoInfo();
        alert(`${videoType === 'idle' ? 'Idle' : 'Speaking'} video uploaded successfully!`);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      alert('Error uploading video: ' + err.message);
    } finally {
      setUploadingVideo(null);
      if (videoType === 'idle' && idleVideoInputRef.current) {
        idleVideoInputRef.current.value = '';
      }
      if (videoType === 'speaking' && speakingVideoInputRef.current) {
        speakingVideoInputRef.current.value = '';
      }
    }
  };

  // Handle delete videos
  const handleDeleteVideos = async () => {
    if (!confirm('Remove all custom AI videos and revert to animated avatar?')) return;

    try {
      const res = await fetch(`${API_BASE}/settings/ai-video`, {
        ...getAuthOptions(),
        method: 'DELETE'
      });

      if (res.ok) {
        setIdleVideoUrl(null);
        setSpeakingVideoUrl(null);
        setAiVideoInfo({ hasIdleVideo: false, hasSpeakingVideo: false });
        alert('AI videos removed');
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
    } catch (err) {
      alert('Error removing videos: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Icon Settings */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">AI Assistant Icon</h3>
              <p className="text-sm text-gray-500">Customize the AI assistant avatar displayed throughout the app</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-8 items-start">
              {/* Preview */}
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className={`w-32 h-32 rounded-2xl overflow-hidden border-4 ${previewUrl ? 'border-indigo-200' : 'border-gray-200'} shadow-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center`}>
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="AI Icon"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Bot size={48} className="text-white" />
                    )}
                  </div>
                  {previewUrl && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check size={14} className="text-white" />
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  {previewUrl ? 'Custom icon active' : 'Using default icon'}
                </p>
              </div>

              {/* Upload controls */}
              <div className="flex-1 space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Upload Custom Icon</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Upload a PNG, JPG, or GIF image. Recommended size: 256x256 pixels. Maximum file size: 5MB.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="ai-icon-upload"
                    />
                    <label
                      htmlFor="ai-icon-upload"
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium cursor-pointer transition-colors ${uploading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                      {uploading ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload size={18} />
                          Choose Image
                        </>
                      )}
                    </label>

                    {previewUrl && (
                      <button
                        onClick={handleDelete}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={18} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {aiIconInfo?.hasCustomIcon && (
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Current Icon Details</h5>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <span className="text-gray-500">Type:</span>
                      <span className="text-gray-900">{aiIconInfo.mimeType}</span>
                      <span className="text-gray-500">Size:</span>
                      <span className="text-gray-900">{(aiIconInfo.size / 1024).toFixed(1)} KB</span>
                      <span className="text-gray-500">Updated:</span>
                      <span className="text-gray-900">{new Date(aiIconInfo.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-800">Note</p>
                      <p className="text-amber-700">The new icon will appear for all users after they refresh their browser.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Video Avatar Settings */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">AI Video Avatar</h3>
              <p className="text-sm text-gray-500">Upload animated videos for the AI assistant (plays instead of static icon)</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Idle Video */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Clock size={18} className="text-blue-500" />
                    Vidéo Repos (Idle)
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Vidéo jouée en boucle quand l'IA est inactive
                  </p>

                  {idleVideoUrl ? (
                    <div className="space-y-3">
                      <video
                        src={idleVideoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-32 object-cover rounded-lg bg-gray-100"
                      />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-600 flex items-center gap-1">
                          <Check size={14} /> Vidéo active
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                      <span>Pas de vidéo</span>
                    </div>
                  )}

                  <div className="mt-4">
                    <input
                      ref={idleVideoInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/ogg"
                      onChange={(e) => handleVideoSelect(e, 'idle')}
                      className="hidden"
                      id="idle-video-upload"
                    />
                    <label
                      htmlFor="idle-video-upload"
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium cursor-pointer transition-colors w-full justify-center ${
                        uploadingVideo === 'idle'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {uploadingVideo === 'idle' ? (
                        <><Loader2 size={18} className="animate-spin" /> Upload...</>
                      ) : (
                        <><Upload size={18} /> {idleVideoUrl ? 'Remplacer' : 'Uploader'}</>
                      )}
                    </label>
                  </div>
                </div>

                {/* Speaking Video */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Sparkles size={18} className="text-purple-500" />
                    Vidéo Parle (Speaking)
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Vidéo jouée quand l'IA répond/parle
                  </p>

                  {speakingVideoUrl ? (
                    <div className="space-y-3">
                      <video
                        src={speakingVideoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-32 object-cover rounded-lg bg-gray-100"
                      />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-600 flex items-center gap-1">
                          <Check size={14} /> Vidéo active
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                      <span>Pas de vidéo</span>
                    </div>
                  )}

                  <div className="mt-4">
                    <input
                      ref={speakingVideoInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/ogg"
                      onChange={(e) => handleVideoSelect(e, 'speaking')}
                      className="hidden"
                      id="speaking-video-upload"
                    />
                    <label
                      htmlFor="speaking-video-upload"
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium cursor-pointer transition-colors w-full justify-center ${
                        uploadingVideo === 'speaking'
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {uploadingVideo === 'speaking' ? (
                        <><Loader2 size={18} className="animate-spin" /> Upload...</>
                      ) : (
                        <><Upload size={18} /> {speakingVideoUrl ? 'Remplacer' : 'Uploader'}</>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              {/* Delete all videos button */}
              {(idleVideoUrl || speakingVideoUrl) && (
                <div className="flex justify-end">
                  <button
                    onClick={handleDeleteVideos}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-colors"
                  >
                    <Trash2 size={18} />
                    Supprimer toutes les vidéos
                  </button>
                </div>
              )}

              {/* Info box */}
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <Sparkles size={18} className="text-purple-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-purple-800">Conseils pour les vidéos</p>
                    <ul className="text-purple-700 mt-1 space-y-1 list-disc list-inside">
                      <li>Format: MP4, WebM ou OGG (max 10MB)</li>
                      <li>Durée recommandée: 2-5 secondes en boucle</li>
                      <li>Résolution: 256x256 ou 512x512 pixels</li>
                      <li>La vidéo "repos" est jouée en continu</li>
                      <li>La vidéo "parle" est jouée pendant les réponses</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Agent Video System */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Users size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Agents IA Spécialisés</h3>
              <p className="text-sm text-gray-500">Configurez les vidéos avatars pour chaque agent IA spécialisé</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Agent cards grid */}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agentsList.map((agent) => {
                  const isExpanded = selectedAgent === agent.type;
                  const hasVideos = agent.hasIdleVideo || agent.hasSpeakingVideo;
                  const isUploading = uploadingAgentVideo?.startsWith(agent.type);

                  // Agent-specific colors
                  const agentColors = {
                    main: { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600' },
                    vsd: { bg: 'bg-green-500', light: 'bg-green-50', border: 'border-green-200', text: 'text-green-600' },
                    meca: { bg: 'bg-orange-500', light: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600' },
                    glo: { bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600' },
                    hv: { bg: 'bg-amber-500', light: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600' },
                    mobile: { bg: 'bg-cyan-500', light: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-600' },
                    atex: { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-600' },
                    switchboard: { bg: 'bg-indigo-500', light: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-600' },
                    doors: { bg: 'bg-rose-500', light: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-600' },
                    datahub: { bg: 'bg-teal-500', light: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-600' },
                    firecontrol: { bg: 'bg-red-500', light: 'bg-red-50', border: 'border-red-200', text: 'text-red-600' },
                    infrastructure: { bg: 'bg-violet-500', light: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-600' }
                  };
                  const colors = agentColors[agent.type] || agentColors.main;

                  return (
                    <div
                      key={agent.type}
                      className={`border rounded-xl overflow-hidden transition-all ${
                        isExpanded ? `${colors.border} shadow-lg` : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Agent header */}
                      <button
                        onClick={() => setSelectedAgent(isExpanded ? null : agent.type)}
                        className={`w-full p-4 flex items-center justify-between transition-colors ${
                          isExpanded ? colors.light : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full ${colors.bg} flex items-center justify-center`}>
                            {agent.hasIdleVideo ? (
                              <video
                                src={`${API_BASE}/settings/ai-agents/${agent.type}/idle?t=${Date.now()}`}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <Sparkles size={18} className="text-white" />
                            )}
                          </div>
                          <div className="text-left">
                            <p className="font-medium text-gray-900">
                              {agentNames[agent.type] || agent.name?.split(' (')[0] || agent.type}
                            </p>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-gray-500">{agent.type}</span>
                              {hasVideos && (
                                <span className="text-green-600 flex items-center gap-1">
                                  <Check size={12} />
                                  {agent.hasIdleVideo && agent.hasSpeakingVideo ? '2 vidéos' : '1 vidéo'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <ChevronDown
                          size={18}
                          className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="p-4 border-t border-gray-100 space-y-4">
                          {/* Agent name editor */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500">Nom:</span>
                            {editingAgentName === agent.type ? (
                              <div className="flex items-center gap-2 flex-1">
                                <input
                                  type="text"
                                  value={tempAgentName}
                                  onChange={(e) => setTempAgentName(e.target.value)}
                                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                                  placeholder="Nom de l'agent"
                                  autoFocus
                                  maxLength={50}
                                />
                                <button
                                  onClick={() => handleUpdateAgentName(agent.type, tempAgentName)}
                                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  onClick={() => setEditingAgentName(null)}
                                  className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-1">
                                <span className="text-sm font-medium text-gray-900">
                                  {agentNames[agent.type] || agent.name?.split(' (')[0]}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTempAgentName(agentNames[agent.type] || agent.name?.split(' (')[0] || '');
                                    setEditingAgentName(agent.type);
                                  }}
                                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                                >
                                  <Edit3 size={14} />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Idle video */}
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700 flex items-center gap-1">
                                <Clock size={12} /> Repos
                              </p>
                              {agent.hasIdleVideo ? (
                                <video
                                  src={`${API_BASE}/settings/ai-agents/${agent.type}/idle?t=${Date.now()}`}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  className="w-full h-20 object-cover rounded-lg bg-gray-100"
                                />
                              ) : (
                                <div className="w-full h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                                  <span className="text-xs text-gray-400">Vide</span>
                                </div>
                              )}
                              <label className="block">
                                <input
                                  type="file"
                                  accept="video/mp4,video/webm,video/ogg"
                                  onChange={(e) => handleAgentVideoUpload(e.target.files?.[0], agent.type, 'idle')}
                                  className="hidden"
                                />
                                <span className={`inline-flex items-center justify-center gap-1 w-full px-2 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                                  uploadingAgentVideo === `${agent.type}-idle`
                                    ? 'bg-gray-100 text-gray-400 cursor-wait'
                                    : `${colors.bg} text-white hover:opacity-90`
                                }`}>
                                  {uploadingAgentVideo === `${agent.type}-idle` ? (
                                    <><Loader2 size={12} className="animate-spin" /> Upload...</>
                                  ) : (
                                    <><Upload size={12} /> {agent.hasIdleVideo ? 'Remplacer' : 'Uploader'}</>
                                  )}
                                </span>
                              </label>
                            </div>

                            {/* Speaking video */}
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700 flex items-center gap-1">
                                <Sparkles size={12} /> Parle
                              </p>
                              {agent.hasSpeakingVideo ? (
                                <video
                                  src={`${API_BASE}/settings/ai-agents/${agent.type}/speaking?t=${Date.now()}`}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  className="w-full h-20 object-cover rounded-lg bg-gray-100"
                                />
                              ) : (
                                <div className="w-full h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                                  <span className="text-xs text-gray-400">Vide</span>
                                </div>
                              )}
                              <label className="block">
                                <input
                                  type="file"
                                  accept="video/mp4,video/webm,video/ogg"
                                  onChange={(e) => handleAgentVideoUpload(e.target.files?.[0], agent.type, 'speaking')}
                                  className="hidden"
                                />
                                <span className={`inline-flex items-center justify-center gap-1 w-full px-2 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                                  uploadingAgentVideo === `${agent.type}-speaking`
                                    ? 'bg-gray-100 text-gray-400 cursor-wait'
                                    : `${colors.bg} text-white hover:opacity-90`
                                }`}>
                                  {uploadingAgentVideo === `${agent.type}-speaking` ? (
                                    <><Loader2 size={12} className="animate-spin" /> Upload...</>
                                  ) : (
                                    <><Upload size={12} /> {agent.hasSpeakingVideo ? 'Remplacer' : 'Uploader'}</>
                                  )}
                                </span>
                              </label>
                            </div>
                          </div>

                          {/* Delete button */}
                          {hasVideos && (
                            <button
                              onClick={() => handleDeleteAgentVideos(agent.type)}
                              className="w-full px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-1"
                            >
                              <Trash2 size={12} />
                              Supprimer les vidéos
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Status summary */}
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <Users size={18} className="text-indigo-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-indigo-800">
                      {agentsList.filter(a => a.hasIdleVideo || a.hasSpeakingVideo).length} / {agentsList.length} agents configurés
                    </p>
                    <p className="text-indigo-600 mt-1">
                      Chaque agent spécialisé peut avoir sa propre vidéo avatar. L'agent approprié sera automatiquement sélectionné en fonction du contexte de la question.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== MAIN ==============
export default function Admin() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('haleon');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [migrating, setMigrating] = useState(false);

  const [haleonUsers, setHaleonUsers] = useState([]);
  const [externalUsers, setExternalUsers] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);

  // Fetch all data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const opts = getAuthOptions();

      // Fetch all data in parallel
      const [haleonRes, externalRes, pendingRes, companiesRes, sitesRes, deptsRes] = await Promise.all([
        fetch(`${API_BASE}/users/haleon`, opts).then(r => r.json()).catch(() => ({ users: [] })),
        fetch(`${API_BASE}/users/external`, opts).then(r => r.json()).catch(() => ({ users: [] })),
        fetch(`${API_BASE}/users/pending`, opts).then(r => r.json()).catch(() => ({ users: [], count: 0 })),
        fetch(`${API_BASE}/companies`, opts).then(r => r.json()).catch(() => ({ companies: [] })),
        fetch(`${API_BASE}/sites`, opts).then(r => r.json()).catch(() => ({ sites: [] })),
        fetch(`${API_BASE}/departments`, opts).then(r => r.json()).catch(() => ({ departments: [] }))
      ]);

      setHaleonUsers(haleonRes.users || []);
      setExternalUsers(externalRes.users || []);
      setPendingCount(pendingRes.count || (pendingRes.users || []).length);
      setCompanies(companiesRes.companies || []);
      setSites(sitesRes.sites || []);
      setDepartments(deptsRes.departments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run migration
  const runMigration = async () => {
    if (!confirm('Run database migration? This will create missing tables and migrate Haleon users.')) return;
    setMigrating(true);
    try {
      const response = await fetch(`${API_BASE}/migrate`, getAuthOptions({ method: 'POST' }));
      const data = await response.json();
      if (data.ok) {
        alert(`Migration completed! ${data.migratedUsers || 0} users migrated.`);
        fetchData();
      } else {
        throw new Error(data.error || 'Migration failed');
      }
    } catch (err) {
      alert('Migration error: ' + err.message);
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setCurrentUser(storedUser);
    if (!ADMIN_EMAILS.includes(storedUser.email)) {
      alert('Access denied');
      navigate('/dashboard');
      return;
    }
    fetchData();
  }, [navigate, fetchData]);

  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><AlertTriangle size={48} className="mx-auto text-red-500 mb-4" /><h1 className="text-xl font-bold">Access Denied</h1></div></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-[95vw] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center"><Shield size={28} /></div>
              <div><h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1><p className="text-gray-400">Manage users, companies and app access</p></div>
            </div>
            <button onClick={runMigration} disabled={migrating} className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm transition-colors">
              {migrating ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              {migrating ? 'Migrating...' : 'Run Migration'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border-b border-gray-100 sticky top-16 z-30">
        <div className="max-w-[95vw] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto">
            <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')} icon={Clock} count={pendingCount}>
              <span className={pendingCount > 0 ? 'text-amber-600 font-semibold' : ''}>Pending</span>
            </TabButton>
            <TabButton active={activeTab === 'haleon'} onClick={() => setActiveTab('haleon')} icon={Sparkles} count={haleonUsers.length}>Haleon Users</TabButton>
            <TabButton active={activeTab === 'external'} onClick={() => setActiveTab('external')} icon={Users} count={externalUsers.length}>External Users</TabButton>
            <TabButton active={activeTab === 'companies'} onClick={() => setActiveTab('companies')} icon={Building2} count={companies.length}>Companies</TabButton>
            <TabButton active={activeTab === 'sites'} onClick={() => setActiveTab('sites')} icon={MapPin} count={sites.length}>Sites</TabButton>
            <TabButton active={activeTab === 'departments'} onClick={() => setActiveTab('departments')} icon={Briefcase} count={departments.length}>Departments</TabButton>
            <TabButton active={activeTab === 'vsd-plans'} onClick={() => setActiveTab('vsd-plans')} icon={FileText}>Plans</TabButton>
            <TabButton active={activeTab === 'plan-scale'} onClick={() => setActiveTab('plan-scale')} icon={Ruler}>Echelle</TabButton>
            <TabButton active={activeTab === 'modules'} onClick={() => setActiveTab('modules')} icon={Package}>Modules</TabButton>
            <TabButton active={activeTab === 'auth-audit'} onClick={() => setActiveTab('auth-audit')} icon={History}>Auth Audit</TabButton>
            <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings}>Settings</TabButton>
          </div>
        </div>
      </div>

      <div className="max-w-[95vw] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error ? (
          <ErrorMessage error={error} onRetry={fetchData} />
        ) : (
          <>
            {activeTab === 'pending' && <PendingUsersTab sites={sites} departments={departments} onRefresh={fetchData} />}
            {activeTab === 'haleon' && <HaleonUsersTab haleonUsers={haleonUsers} sites={sites} departments={departments} onRefresh={fetchData} loading={loading} />}
            {activeTab === 'external' && <ExternalUsersTab users={externalUsers} sites={sites} companies={companies} departments={departments} onRefresh={fetchData} loading={loading} />}
            {activeTab === 'companies' && <CompaniesTab companies={companies} onRefresh={fetchData} loading={loading} />}
            {activeTab === 'sites' && <SitesTab sites={sites} onRefresh={fetchData} loading={loading} />}
            {activeTab === 'departments' && <DepartmentsTab departments={departments} onRefresh={fetchData} loading={loading} />}
            {activeTab === 'vsd-plans' && <VsdPlansTab />}
            {activeTab === 'plan-scale' && <PlanScaleTab />}
            {activeTab === 'modules' && <CustomModulesTab />}
            {activeTab === 'auth-audit' && <AuthAuditTab />}
            {activeTab === 'settings' && <SettingsTab />}
          </>
        )}
      </div>
    </div>
  );
}
