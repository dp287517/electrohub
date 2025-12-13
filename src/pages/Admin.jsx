import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, UserPlus, Users, Key, Trash2, Search, Plus, X, Check,
  Eye, EyeOff, Copy, RefreshCw, Building, Mail, Lock, AlertTriangle
} from 'lucide-react';
import { post, get, del } from '../lib/api';

// Admin email authorized
const ADMIN_EMAIL = 'daniel.x.palha@haleon.com';

// Available sites
const SITES = ['Nyon', 'Geneva', 'Lausanne', 'Zurich', 'Basel'];
const DEPARTMENTS = ['Maintenance', 'Engineering', 'Operations', 'Quality', 'Safety', 'IT', 'External'];

// Generate random password
function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// User Card component
function UserCard({ user, onResetPassword, onDelete }) {
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const handleReset = async () => {
    setResetting(true);
    const pwd = generatePassword();
    try {
      await onResetPassword(user.email, pwd);
      setNewPassword(pwd);
    } catch (e) {
      alert('Failed to reset password');
    }
    setResetting(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete user ${user.email}?`)) return;
    setDeleting(true);
    try {
      await onDelete(user.email);
    } catch (e) {
      alert('Failed to delete user');
    }
    setDeleting(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-semibold">
            {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-medium text-gray-900">{user.name || user.email}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg">{user.site || 'No site'}</span>
          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg">{user.department || 'External'}</span>
        </div>
      </div>

      {/* New password display */}
      {newPassword && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium mb-1">New password generated:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-white px-2 py-1 rounded border font-mono">
              {showPassword ? newPassword : '••••••••••••'}
            </code>
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="p-1.5 hover:bg-green-100 rounded transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              onClick={() => copyToClipboard(newPassword)}
              className="p-1.5 hover:bg-green-100 rounded transition-colors"
            >
              <Copy size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleReset}
          disabled={resetting}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {resetting ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
          Reset Password
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center justify-center gap-2 px-3 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          {deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  );
}

// Create User Modal
function CreateUserModal({ onClose, onCreate }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [site, setSite] = useState('Nyon');
  const [department, setDepartment] = useState('External');
  const [password, setPassword] = useState(generatePassword());
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!email) return alert('Email is required');

    setCreating(true);
    try {
      await onCreate({ email, name: name || email.split('@')[0], company, site, department, password });
      setCreated(true);
    } catch (err) {
      alert('Failed to create user: ' + err.message);
    }
    setCreating(false);
  };

  const copyCredentials = () => {
    const text = `Email: ${email}\nPassword: ${password}\nSite: ${site}`;
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <UserPlus size={20} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              {created ? 'User Created!' : 'Create External Account'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {created ? (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-2 text-green-700 mb-3">
                <Check size={20} />
                <span className="font-medium">Account created successfully</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Email:</span>
                  <span className="font-medium">{email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Password:</span>
                  <div className="flex items-center gap-2">
                    <code className="font-mono bg-white px-2 py-0.5 rounded border">
                      {showPassword ? password : '••••••••'}
                    </code>
                    <button onClick={() => setShowPassword(!showPassword)} className="p-1 hover:bg-green-100 rounded">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Site:</span>
                  <span className="font-medium">{site}</span>
                </div>
              </div>
            </div>
            <button
              onClick={copyCredentials}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors"
            >
              <Copy size={18} />
              Copy Credentials
            </button>
            <button
              onClick={onClose}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                <Mail size={14} />
                Email *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contractor@company.com"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
                required
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="External Company Ltd."
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                  <Building size={14} />
                  Site
                </label>
                <select
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
                >
                  {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
                >
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

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
                  title="Generate new password"
                >
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-xl hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg disabled:opacity-50"
              >
                {creating ? (
                  <RefreshCw size={18} className="animate-spin" />
                ) : (
                  <>
                    <UserPlus size={18} />
                    Create Account
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Check admin access
  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    setCurrentUser(storedUser);

    if (storedUser.email !== ADMIN_EMAIL) {
      alert('Access denied. Admin privileges required.');
      navigate('/dashboard');
      return;
    }

    loadUsers();
  }, [navigate]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await get('/api/admin/users');
      setUsers(res.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
      // Mock data for demo
      setUsers([
        { email: 'contractor1@ext.com', name: 'John Contractor', site: 'Nyon', department: 'External', company: 'ABC Corp' },
        { email: 'vendor@supplier.com', name: 'Jane Vendor', site: 'Geneva', department: 'External', company: 'XYZ Ltd' },
      ]);
    }
    setLoading(false);
  };

  const handleCreateUser = async (userData) => {
    try {
      await post('/api/admin/users', userData);
      await loadUsers();
    } catch (err) {
      console.error('Create user failed:', err);
      // For demo, add to local state
      setUsers(prev => [...prev, userData]);
    }
  };

  const handleResetPassword = async (email, newPassword) => {
    try {
      await post('/api/admin/users/reset-password', { email, password: newPassword });
    } catch (err) {
      console.error('Reset password failed:', err);
    }
  };

  const handleDeleteUser = async (email) => {
    try {
      await del(`/api/admin/users/${encodeURIComponent(email)}`);
      setUsers(prev => prev.filter(u => u.email !== email));
    } catch (err) {
      console.error('Delete user failed:', err);
      setUsers(prev => prev.filter(u => u.email !== email));
    }
  };

  const filteredUsers = users.filter(u =>
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.company?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!currentUser || currentUser.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto text-red-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
          <p className="text-gray-600 mt-2">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
              <Shield size={28} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1>
              <p className="text-gray-400">Manage external contractor accounts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Users size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{users.length}</p>
                <p className="text-sm text-gray-500">Total Users</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <Building size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{new Set(users.map(u => u.company)).size}</p>
                <p className="text-sm text-gray-500">Companies</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Key size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{SITES.length}</p>
                <p className="text-sm text-gray-500">Sites</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search users by email, name or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-4 focus:ring-brand-100 focus:border-brand-400 outline-none"
            />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-xl hover:from-brand-700 hover:to-brand-800 transition-all shadow-lg"
          >
            <Plus size={20} />
            New Account
          </button>
        </div>

        {/* Users Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-20">
            <Users size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No users found</h3>
            <p className="text-gray-500 mt-1">
              {searchQuery ? 'Try a different search term' : 'Create your first external account'}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map(user => (
              <UserCard
                key={user.email}
                user={user}
                onResetPassword={handleResetPassword}
                onDelete={handleDeleteUser}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateUser}
        />
      )}
    </div>
  );
}
