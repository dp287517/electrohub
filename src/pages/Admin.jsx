import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, UserPlus, Users, Key, Trash2, Search, Plus, X, Check,
  Eye, EyeOff, Copy, RefreshCw, Building2, Mail, Lock, AlertTriangle,
  Globe, MapPin, Briefcase, Settings, ChevronRight, Edit3, Save,
  Building, Layers, AppWindow, CheckSquare, Square, ChevronDown
} from 'lucide-react';
import { post, get, del } from '../lib/api';

// Admin emails authorized
const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Available applications
const ALL_APPS = [
  { id: 'switchboards', name: 'Electrical Switchboards', icon: '⚡', category: 'Electrical' },
  { id: 'obsolescence', name: 'Obsolescence', icon: '♻️', category: 'Electrical' },
  { id: 'selectivity', name: 'Selectivity', icon: '🧩', category: 'Electrical' },
  { id: 'fault-level', name: 'Fault Level Assessment', icon: '📈', category: 'Electrical' },
  { id: 'arc-flash', name: 'Arc Flash', icon: '⚠️', category: 'Electrical' },
  { id: 'loopcalc', name: 'Loop Calculation', icon: '🔄', category: 'Electrical' },
  { id: 'hv', name: 'High Voltage Equipment', icon: '⚡', category: 'Electrical' },
  { id: 'diagram', name: 'Diagram', icon: '📐', category: 'Electrical' },
  { id: 'projects', name: 'Project', icon: '💳', category: 'Electrical' },
  { id: 'vsd', name: 'Variable Speed Drives', icon: '⚙️', category: 'Electrical' },
  { id: 'meca', name: 'Mechanical Equipments', icon: '⚙️', category: 'Electrical' },
  { id: 'oibt', name: 'OIBT', icon: '📋', category: 'Electrical' },
  { id: 'atex', name: 'ATEX', icon: '🧯', category: 'Utilities' },
  { id: 'controls', name: 'Maintenance Controls', icon: '🛠️', category: 'Utilities' },
  { id: 'comp-ext', name: 'External Contractors', icon: '🤝', category: 'Utilities' },
  { id: 'ask-veeva', name: 'Ask Veeva', icon: '💬', category: 'Utilities' },
  { id: 'doors', name: 'Fire Doors', icon: '🚪', category: 'Utilities' },
  { id: 'dcf', name: 'Dcf', icon: '📊', category: 'Utilities' },
  { id: 'learn_ex', name: 'Formation ATEX', icon: '📊', category: 'Utilities' },
];

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

// Generate random password
function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Tab Button Component
function TabButton({ active, onClick, icon: Icon, children, count }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 font-medium transition-all border-b-2 ${
        active
          ? 'border-brand-600 text-brand-700 bg-brand-50'
          : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
      }`}
    >
      <Icon size={18} />
      {children}
      {count !== undefined && (
        <span className={`px-2 py-0.5 text-xs rounded-full ${active ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// Modal Component
function Modal({ title, icon: Icon, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl ${wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'} max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <Icon size={20} className="text-white" />
              </div>
            )}
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============== COMPANIES TAB ==============
function CompaniesTab({ companies, setCompanies, departments }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCompanies = companies.filter(c =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.country?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.city?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (company) => {
    const newCompany = { ...company, id: Date.now().toString() };
    setCompanies([...companies, newCompany]);
    setShowCreate(false);
  };

  const handleUpdate = (id, updates) => {
    setCompanies(companies.map(c => c.id === id ? { ...c, ...updates } : c));
    setEditingId(null);
  };

  const handleDelete = (id) => {
    if (confirm('Delete this company?')) {
      setCompanies(companies.filter(c => c.id !== id));
    }
  };

  return (
    <div>
      {/* Search & Actions */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-xl hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg"
        >
          <Plus size={20} />
          New Company
        </button>
      </div>

      {/* Companies Grid */}
      {filteredCompanies.length === 0 ? (
        <div className="text-center py-16">
          <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No companies yet</h3>
          <p className="text-gray-500 mt-1">Create your first company to get started</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCompanies.map(company => (
            <div key={company.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xl font-bold">
                  {company.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditingId(company.id)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(company.id)}
                    className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{company.name}</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                <Globe size={14} />
                {company.country}
                <span className="text-gray-300">•</span>
                <MapPin size={14} />
                {company.city}
              </div>
              {company.departments?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {company.departments.map(d => (
                    <span key={d} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{d}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CompanyFormModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}

      {/* Edit Modal */}
      {editingId && (
        <CompanyFormModal
          company={companies.find(c => c.id === editingId)}
          departments={departments}
          onClose={() => setEditingId(null)}
          onSave={(updates) => handleUpdate(editingId, updates)}
        />
      )}
    </div>
  );
}

function CompanyFormModal({ company, departments, onClose, onSave }) {
  const [name, setName] = useState(company?.name || '');
  const [country, setCountry] = useState(company?.country || 'Switzerland');
  const [city, setCity] = useState(company?.city || 'Nyon');
  const [selectedDepts, setSelectedDepts] = useState(company?.departments || []);

  const cities = COUNTRIES[country] || [];

  const toggleDept = (dept) => {
    setSelectedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('Company name is required');
    onSave({ name, country, city, departments: selectedDepts });
  };

  return (
    <Modal title={company ? 'Edit Company' : 'New Company'} icon={Building2} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Company Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corporation"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <Globe size={14} />
              Country
            </label>
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setCity(COUNTRIES[e.target.value]?.[0] || '');
              }}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            >
              {Object.keys(COUNTRIES).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <MapPin size={14} />
              City
            </label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            >
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Departments</label>
          <div className="flex flex-wrap gap-2">
            {departments.map(dept => (
              <button
                key={dept}
                type="button"
                onClick={() => toggleDept(dept)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedDepts.includes(dept)
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="flex-1 px-4 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 flex items-center justify-center gap-2">
            <Save size={18} />
            {company ? 'Save Changes' : 'Create Company'}
          </button>
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

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newDept.trim()) return;
    if (departments.includes(newDept.trim())) return alert('Department already exists');
    setDepartments([...departments, newDept.trim()]);
    setNewDept('');
  };

  const handleEdit = (idx) => {
    setEditingIdx(idx);
    setEditValue(departments[idx]);
  };

  const handleSaveEdit = () => {
    if (!editValue.trim()) return;
    const updated = [...departments];
    updated[editingIdx] = editValue.trim();
    setDepartments(updated);
    setEditingIdx(null);
  };

  const handleDelete = (idx) => {
    if (confirm('Delete this department?')) {
      setDepartments(departments.filter((_, i) => i !== idx));
    }
  };

  return (
    <div>
      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-6">
        <input
          type="text"
          value={newDept}
          onChange={(e) => setNewDept(e.target.value)}
          placeholder="New department name..."
          className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-xl hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg flex items-center gap-2"
        >
          <Plus size={20} />
          Add
        </button>
      </form>

      {/* Departments list */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {departments.map((dept, idx) => (
          <div
            key={idx}
            className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between group hover:shadow-md transition-shadow"
          >
            {editingIdx === idx ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 focus:ring-2 focus:ring-brand-100 outline-none"
                  autoFocus
                />
                <button onClick={handleSaveEdit} className="p-1.5 bg-green-50 text-green-600 rounded-lg">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditingIdx(null)} className="p-1.5 bg-gray-100 rounded-lg">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-white">
                    <Briefcase size={14} />
                  </div>
                  <span className="font-medium text-gray-900">{dept}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEdit(idx)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => handleDelete(idx)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg">
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {departments.length === 0 && (
        <div className="text-center py-16">
          <Briefcase size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No departments yet</h3>
          <p className="text-gray-500 mt-1">Add your first department above</p>
        </div>
      )}
    </div>
  );
}

// ============== USERS TAB ==============
function UsersTab({ users, setUsers, companies, departments }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u =>
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.company?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (user) => {
    setUsers([...users, { ...user, id: Date.now().toString() }]);
    setShowCreate(false);
  };

  const handleUpdate = (id, updates) => {
    setUsers(users.map(u => u.id === id ? { ...u, ...updates } : u));
    setEditingId(null);
  };

  const handleDelete = (id) => {
    if (confirm('Delete this user?')) {
      setUsers(users.filter(u => u.id !== id));
    }
  };

  const handleResetPassword = (id) => {
    const newPwd = generatePassword();
    setUsers(users.map(u => u.id === id ? { ...u, password: newPwd, showPassword: true } : u));
  };

  return (
    <div>
      {/* Search & Actions */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-xl hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg"
        >
          <UserPlus size={20} />
          New User
        </button>
      </div>

      {/* Users List */}
      {filteredUsers.length === 0 ? (
        <div className="text-center py-16">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No users yet</h3>
          <p className="text-gray-500 mt-1">Create your first user account</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map(user => (
            <div key={user.id} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-semibold">
                    {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{user.name || user.email}</p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {user.company && (
                    <span className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded-lg flex items-center gap-1">
                      <Building2 size={12} />
                      {user.company}
                    </span>
                  )}
                  <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg">{user.site || 'No site'}</span>
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg">{user.department || 'No dept'}</span>
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-600 rounded-lg">
                    {user.apps?.length || 0} apps
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleResetPassword(user.id)}
                    className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors"
                    title="Reset Password"
                  >
                    <Key size={16} />
                  </button>
                  <button
                    onClick={() => setEditingId(user.id)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Password display after reset */}
              {user.showPassword && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-800 font-medium">New password:</p>
                    <code className="text-sm font-mono">{user.password}</code>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(user.password);
                      setUsers(users.map(u => u.id === user.id ? { ...u, showPassword: false } : u));
                    }}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg flex items-center gap-1"
                  >
                    <Copy size={14} />
                    Copy & Close
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <UserFormModal
          companies={companies}
          departments={departments}
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}

      {/* Edit Modal */}
      {editingId && (
        <UserFormModal
          user={users.find(u => u.id === editingId)}
          companies={companies}
          departments={departments}
          onClose={() => setEditingId(null)}
          onSave={(updates) => handleUpdate(editingId, updates)}
        />
      )}
    </div>
  );
}

function UserFormModal({ user, companies, departments, onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [name, setName] = useState(user?.name || '');
  const [company, setCompany] = useState(user?.company || '');
  const [site, setSite] = useState(user?.site || 'Nyon');
  const [department, setDepartment] = useState(user?.department || departments[0] || '');
  const [password, setPassword] = useState(user?.password || generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [selectedApps, setSelectedApps] = useState(user?.apps || ALL_APPS.map(a => a.id));
  const [showApps, setShowApps] = useState(false);

  const selectedCompany = companies.find(c => c.name === company);
  const cities = selectedCompany ? COUNTRIES[selectedCompany.country] || [] : Object.values(COUNTRIES).flat();

  const toggleApp = (appId) => {
    setSelectedApps(prev =>
      prev.includes(appId) ? prev.filter(a => a !== appId) : [...prev, appId]
    );
  };

  const toggleAllApps = (category) => {
    const categoryApps = ALL_APPS.filter(a => a.category === category).map(a => a.id);
    const allSelected = categoryApps.every(id => selectedApps.includes(id));
    if (allSelected) {
      setSelectedApps(prev => prev.filter(id => !categoryApps.includes(id)));
    } else {
      setSelectedApps(prev => [...new Set([...prev, ...categoryApps])]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim()) return alert('Email is required');
    onSave({ email, name: name || email.split('@')[0], company, site, department, password, apps: selectedApps });
  };

  return (
    <Modal title={user ? 'Edit User' : 'New User'} icon={UserPlus} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <Mail size={14} />
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
              required
              disabled={!!user}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <Building2 size={14} />
              Company
            </label>
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            >
              <option value="">No company</option>
              {companies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <MapPin size={14} />
              Site
            </label>
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            >
              {cities.length > 0 ? cities.map(c => <option key={c} value={c}>{c}</option>) : <option value="Nyon">Nyon</option>}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <Briefcase size={14} />
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            >
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {!user && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
              <Lock size={14} />
              Password
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        )}

        {/* App Access */}
        <div>
          <button
            type="button"
            onClick={() => setShowApps(!showApps)}
            className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AppWindow size={18} />
              <span className="font-medium">Application Access</span>
              <span className="text-sm text-gray-500">({selectedApps.length}/{ALL_APPS.length} apps)</span>
            </div>
            <ChevronDown size={18} className={`transition-transform ${showApps ? 'rotate-180' : ''}`} />
          </button>

          {showApps && (
            <div className="mt-3 p-4 border border-gray-200 rounded-xl space-y-4">
              {['Electrical', 'Utilities'].map(category => (
                <div key={category}>
                  <button
                    type="button"
                    onClick={() => toggleAllApps(category)}
                    className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700 hover:text-brand-600"
                  >
                    {ALL_APPS.filter(a => a.category === category).every(a => selectedApps.includes(a.id))
                      ? <CheckSquare size={16} className="text-brand-600" />
                      : <Square size={16} />
                    }
                    {category}
                  </button>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {ALL_APPS.filter(a => a.category === category).map(app => (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => toggleApp(app.id)}
                        className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
                          selectedApps.includes(app.id)
                            ? 'bg-brand-50 text-brand-700 border border-brand-200'
                            : 'bg-gray-50 text-gray-600 border border-gray-100 hover:bg-gray-100'
                        }`}
                      >
                        {selectedApps.includes(app.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                        <span>{app.icon}</span>
                        <span className="truncate">{app.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" className="flex-1 px-4 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 flex items-center justify-center gap-2">
            <Save size={18} />
            {user ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============== MAIN ADMIN COMPONENT ==============
export default function Admin() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('companies');
  const [loading, setLoading] = useState(true);

  // Data state
  const [companies, setCompanies] = useState([]);
  const [departments, setDepartments] = useState(['Maintenance', 'Engineering', 'Operations', 'Quality', 'Safety', 'IT', 'External']);
  const [users, setUsers] = useState([]);

  // Check admin access & load data
  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setCurrentUser(storedUser);

    if (!ADMIN_EMAILS.includes(storedUser.email)) {
      alert('Access denied. Admin privileges required.');
      navigate('/dashboard');
      return;
    }

    // Load data from localStorage or API
    const savedCompanies = localStorage.getItem('eh_admin_companies');
    const savedDepartments = localStorage.getItem('eh_admin_departments');
    const savedUsers = localStorage.getItem('eh_admin_users');

    if (savedCompanies) setCompanies(JSON.parse(savedCompanies));
    if (savedDepartments) setDepartments(JSON.parse(savedDepartments));
    if (savedUsers) setUsers(JSON.parse(savedUsers));

    setLoading(false);
  }, [navigate]);

  // Save data to localStorage when changed
  useEffect(() => {
    if (!loading) {
      localStorage.setItem('eh_admin_companies', JSON.stringify(companies));
      localStorage.setItem('eh_admin_departments', JSON.stringify(departments));
      localStorage.setItem('eh_admin_users', JSON.stringify(users));
    }
  }, [companies, departments, users, loading]);

  if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
          <p className="text-gray-600 mt-2">Admin privileges required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
              <Shield size={28} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1>
              <p className="text-gray-400">Manage companies, users, and application access</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1 overflow-x-auto">
            <TabButton
              active={activeTab === 'companies'}
              onClick={() => setActiveTab('companies')}
              icon={Building2}
              count={companies.length}
            >
              Companies
            </TabButton>
            <TabButton
              active={activeTab === 'users'}
              onClick={() => setActiveTab('users')}
              icon={Users}
              count={users.length}
            >
              Users
            </TabButton>
            <TabButton
              active={activeTab === 'departments'}
              onClick={() => setActiveTab('departments')}
              icon={Briefcase}
              count={departments.length}
            >
              Departments
            </TabButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'companies' && (
              <CompaniesTab
                companies={companies}
                setCompanies={setCompanies}
                departments={departments}
              />
            )}
            {activeTab === 'users' && (
              <UsersTab
                users={users}
                setUsers={setUsers}
                companies={companies}
                departments={departments}
              />
            )}
            {activeTab === 'departments' && (
              <DepartmentsTab
                departments={departments}
                setDepartments={setDepartments}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
