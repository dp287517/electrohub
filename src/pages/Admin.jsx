import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, UserPlus, Users, Key, Trash2, Search, Plus, X, Check,
  Eye, EyeOff, Copy, RefreshCw, Building2, Mail, Lock, AlertTriangle,
  Globe, MapPin, Briefcase, Edit3, Save, AppWindow, CheckSquare,
  Square, ChevronDown, Sparkles
} from 'lucide-react';
import { ADMIN_EMAILS, ALL_APPS } from '../lib/permissions';

// Countries with cities
const COUNTRIES = {
  'Switzerland': ['Nyon', 'Geneva', 'Lausanne', 'Zurich', 'Basel', 'Bern'],
  'France': ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Strasbourg'],
  'Germany': ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne', 'Stuttgart'],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow', 'Bristol'],
  'Italy': ['Milan', 'Rome', 'Turin', 'Florence', 'Naples', 'Bologna'],
  'Spain': ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Malaga'],
  'Belgium': ['Brussels', 'Antwerp', 'Ghent', 'Liège', 'Bruges'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
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

// ============== HALEON USERS TAB ==============
function HaleonUsersTab({ haleonUsers, setHaleonUsers, departments }) {
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const filtered = haleonUsers.filter(u => u.email?.toLowerCase().includes(searchQuery.toLowerCase()) || u.name?.toLowerCase().includes(searchQuery.toLowerCase()));

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
            <div key={user.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold">{user.name?.[0]?.toUpperCase() || '?'}</div>
                  <div>
                    <p className="font-medium text-gray-900 flex items-center gap-2">{user.name || user.email}<span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full">Haleon</span></p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded-lg">{user.apps?.length ?? ALL_APPS.length} apps</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(user.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => confirm('Remove?') && setHaleonUsers(haleonUsers.filter(u => u.id !== user.id))} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && <HaleonUserModal departments={departments} onClose={() => setShowAddModal(false)} onSave={(u) => { setHaleonUsers([...haleonUsers, { ...u, id: Date.now().toString() }]); setShowAddModal(false); }} />}
      {editingId && <HaleonUserModal user={haleonUsers.find(u => u.id === editingId)} departments={departments} onClose={() => setEditingId(null)} onSave={(updates) => { setHaleonUsers(haleonUsers.map(u => u.id === editingId ? { ...u, ...updates } : u)); setEditingId(null); }} />}
    </div>
  );
}

function HaleonUserModal({ user, departments, onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [department, setDepartment] = useState(user?.department || departments[0] || '');
  const [selectedApps, setSelectedApps] = useState(user?.apps || ALL_APPS.map(a => a.id));

  return (
    <Modal title={user ? 'Edit Haleon User' : 'Add Haleon User'} icon={Sparkles} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; onSave({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], department, apps: selectedApps }); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Mail size={14} />Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@haleon.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required disabled={!!user} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" /></div>
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Briefcase size={14} />Department</label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{departments.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
        <AppSelector selectedApps={selectedApps} onChange={setSelectedApps} showByDefault={true} />
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center justify-center gap-2"><Save size={18} />{user ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============== EXTERNAL USERS TAB ==============
function ExternalUsersTab({ users, setUsers, companies, departments }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = users.filter(u => u.email?.toLowerCase().includes(searchQuery.toLowerCase()) || u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.company?.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleResetPassword = (id) => {
    const pwd = generatePassword();
    setUsers(users.map(u => u.id === id ? { ...u, password: pwd, showPassword: true } : u));
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search external users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 outline-none" />
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl shadow-lg">
          <UserPlus size={20} />New External User
        </button>
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
                  {user.company && <span className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded-lg flex items-center gap-1"><Building2 size={12} />{user.company}</span>}
                  <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg">{user.site || 'No site'}</span>
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded-lg">{user.apps?.length || 0} apps</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResetPassword(user.id)} className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg" title="Reset Password"><Key size={16} /></button>
                  <button onClick={() => setEditingId(user.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => confirm('Delete?') && setUsers(users.filter(u => u.id !== user.id))} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
              {user.showPassword && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <div><p className="text-sm text-green-800 font-medium">New password:</p><code className="text-sm font-mono">{user.password}</code></div>
                  <button onClick={() => { navigator.clipboard.writeText(user.password); setUsers(users.map(u => u.id === user.id ? { ...u, showPassword: false } : u)); }} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg flex items-center gap-1"><Copy size={14} />Copy</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <ExternalUserModal companies={companies} departments={departments} onClose={() => setShowCreate(false)} onSave={(u) => { setUsers([...users, { ...u, id: Date.now().toString() }]); setShowCreate(false); }} />}
      {editingId && <ExternalUserModal user={users.find(u => u.id === editingId)} companies={companies} departments={departments} onClose={() => setEditingId(null)} onSave={(updates) => { setUsers(users.map(u => u.id === editingId ? { ...u, ...updates } : u)); setEditingId(null); }} />}
    </div>
  );
}

function ExternalUserModal({ user, companies, departments, onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [company, setCompany] = useState(user?.company || '');
  const [site, setSite] = useState(user?.site || 'Nyon');
  const [department, setDepartment] = useState(user?.department || departments[0] || '');
  const [password, setPassword] = useState(user?.password || generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [selectedApps, setSelectedApps] = useState(user?.apps || []);

  const selectedCompany = companies.find(c => c.name === company);
  const cities = selectedCompany ? COUNTRIES[selectedCompany.country] || [] : Object.values(COUNTRIES).flat();

  return (
    <Modal title={user ? 'Edit External User' : 'New External User'} icon={UserPlus} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; onSave({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], company, site, department, password, apps: selectedApps }); }} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Mail size={14} />Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required disabled={!!user} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" /></div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Building2 size={14} />Company</label>
            <select value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none"><option value="">No company</option>{companies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><MapPin size={14} />Site</label>
            <select value={site} onChange={(e) => setSite(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{cities.length > 0 ? cities.map(c => <option key={c} value={c}>{c}</option>) : <option value="Nyon">Nyon</option>}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Briefcase size={14} />Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{departments.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
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
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 flex items-center justify-center gap-2"><Save size={18} />{user ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============== COMPANIES TAB ==============
function CompaniesTab({ companies, setCompanies, departments }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = companies.filter(c => c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.country?.toLowerCase().includes(searchQuery.toLowerCase()));

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
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white text-xl font-bold">{company.name?.[0]?.toUpperCase() || '?'}</div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingId(company.id)} className="p-2 hover:bg-gray-100 rounded-lg"><Edit3 size={16} /></button>
                  <button onClick={() => confirm('Delete?') && setCompanies(companies.filter(c => c.id !== company.id))} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={16} /></button>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{company.name}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500"><Globe size={14} />{company.country}<span className="text-gray-300">•</span><MapPin size={14} />{company.city}</div>
              {company.departments?.length > 0 && <div className="flex flex-wrap gap-1 mt-3">{company.departments.map(d => <span key={d} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{d}</span>)}</div>}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CompanyModal departments={departments} onClose={() => setShowCreate(false)} onSave={(c) => { setCompanies([...companies, { ...c, id: Date.now().toString() }]); setShowCreate(false); }} />}
      {editingId && <CompanyModal company={companies.find(c => c.id === editingId)} departments={departments} onClose={() => setEditingId(null)} onSave={(updates) => { setCompanies(companies.map(c => c.id === editingId ? { ...c, ...updates } : c)); setEditingId(null); }} />}
    </div>
  );
}

function CompanyModal({ company, departments, onClose, onSave }) {
  const [name, setName] = useState(company?.name || '');
  const [country, setCountry] = useState(company?.country || 'Switzerland');
  const [city, setCity] = useState(company?.city || 'Nyon');
  const [selectedDepts, setSelectedDepts] = useState(company?.departments || []);

  return (
    <Modal title={company ? 'Edit Company' : 'New Company'} icon={Building2} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onSave({ name, country, city, departments: selectedDepts }); }} className="space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Company Name *</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none" required /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><Globe size={14} />Country</label>
            <select value={country} onChange={(e) => { setCountry(e.target.value); setCity(COUNTRIES[e.target.value]?.[0] || ''); }} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2"><MapPin size={14} />City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none">{(COUNTRIES[country] || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Departments</label>
          <div className="flex flex-wrap gap-2">{departments.map(dept => (
            <button key={dept} type="button" onClick={() => setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedDepts.includes(dept) ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{dept}</button>
          ))}</div></div>
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button type="submit" className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 flex items-center justify-center gap-2"><Save size={18} />{company ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============== DEPARTMENTS TAB ==============
function DepartmentsTab({ departments, setDepartments }) {
  const [newDept, setNewDept] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editValue, setEditValue] = useState('');

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (!newDept.trim() || departments.includes(newDept.trim())) return; setDepartments([...departments, newDept.trim()]); setNewDept(''); }} className="flex gap-3 mb-6">
        <input type="text" value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="New department name..." className="flex-1 px-4 py-3 rounded-xl border border-gray-200 outline-none" />
        <button type="submit" className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl shadow-lg flex items-center gap-2"><Plus size={20} />Add</button>
      </form>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {departments.map((dept, idx) => (
          <div key={idx} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between group hover:shadow-md">
            {editingIdx === idx ? (
              <div className="flex-1 flex gap-2">
                <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="flex-1 px-3 py-1.5 rounded-lg border" autoFocus />
                <button onClick={() => { const updated = [...departments]; updated[idx] = editValue.trim(); setDepartments(updated); setEditingIdx(null); }} className="p-1.5 bg-green-50 text-green-600 rounded-lg"><Check size={16} /></button>
                <button onClick={() => setEditingIdx(null)} className="p-1.5 bg-gray-100 rounded-lg"><X size={16} /></button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-white"><Briefcase size={14} /></div><span className="font-medium text-gray-900">{dept}</span></div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={() => { setEditingIdx(idx); setEditValue(dept); }} className="p-1.5 hover:bg-gray-100 rounded-lg"><Edit3 size={14} /></button>
                  <button onClick={() => setDepartments(departments.filter((_, i) => i !== idx))} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>
        ))}
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

  const [haleonUsers, setHaleonUsers] = useState([]);
  const [externalUsers, setExternalUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState(['Maintenance', 'Engineering', 'Operations', 'Quality', 'Safety', 'IT', 'External']);

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setCurrentUser(storedUser);
    if (!ADMIN_EMAILS.includes(storedUser.email)) { alert('Access denied'); navigate('/dashboard'); return; }

    const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    setHaleonUsers(load('eh_admin_haleon_users') || []);
    setExternalUsers(load('eh_admin_users') || []);
    setCompanies(load('eh_admin_companies') || []);
    const deps = load('eh_admin_departments');
    if (deps) setDepartments(deps);
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    if (!loading) {
      localStorage.setItem('eh_admin_haleon_users', JSON.stringify(haleonUsers));
      localStorage.setItem('eh_admin_users', JSON.stringify(externalUsers));
      localStorage.setItem('eh_admin_companies', JSON.stringify(companies));
      localStorage.setItem('eh_admin_departments', JSON.stringify(departments));
    }
  }, [haleonUsers, externalUsers, companies, departments, loading]);

  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><AlertTriangle size={48} className="mx-auto text-red-500 mb-4" /><h1 className="text-xl font-bold">Access Denied</h1></div></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center"><Shield size={28} /></div>
            <div><h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1><p className="text-gray-400">Manage users, companies and app access</p></div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b border-gray-100 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto">
            <TabButton active={activeTab === 'haleon'} onClick={() => setActiveTab('haleon')} icon={Sparkles} count={haleonUsers.length}>Haleon Users</TabButton>
            <TabButton active={activeTab === 'external'} onClick={() => setActiveTab('external')} icon={Users} count={externalUsers.length}>External Users</TabButton>
            <TabButton active={activeTab === 'companies'} onClick={() => setActiveTab('companies')} icon={Building2} count={companies.length}>Companies</TabButton>
            <TabButton active={activeTab === 'departments'} onClick={() => setActiveTab('departments')} icon={Briefcase} count={departments.length}>Departments</TabButton>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? <div className="flex items-center justify-center py-20"><div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div> : (
          <>
            {activeTab === 'haleon' && <HaleonUsersTab haleonUsers={haleonUsers} setHaleonUsers={setHaleonUsers} departments={departments} />}
            {activeTab === 'external' && <ExternalUsersTab users={externalUsers} setUsers={setExternalUsers} companies={companies} departments={departments} />}
            {activeTab === 'companies' && <CompaniesTab companies={companies} setCompanies={setCompanies} departments={departments} />}
            {activeTab === 'departments' && <DepartmentsTab departments={departments} setDepartments={setDepartments} />}
          </>
        )}
      </div>
    </div>
  );
}
