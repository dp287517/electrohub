import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ticket, Users, RefreshCw, Plus, X, Check, Search, Trash2,
  AlertTriangle, Loader2, UserPlus, ChevronDown, ChevronUp,
  ExternalLink, Settings, Clock, ArrowLeft, Save, Eye
} from 'lucide-react';
import { ADMIN_EMAILS } from '../lib/permissions';

// API helpers
function getAuthOptions(extraOptions = {}) {
  const token = localStorage.getItem('eh_token');
  return {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    },
    ...extraOptions
  };
}

// Composants UI réutilisables
function LoadingSpinner({ text = 'Chargement...' }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="text-purple-600 animate-spin" />
        <p className="text-gray-500">{text}</p>
      </div>
    </div>
  );
}

function ErrorMessage({ error, onRetry }) {
  return (
    <div className="text-center py-12">
      <AlertTriangle size={48} className="mx-auto text-red-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900">Erreur de chargement</h3>
      <p className="text-gray-500 mt-1">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
          Réessayer
        </button>
      )}
    </div>
  );
}

function Modal({ title, icon: Icon, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl ${wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'} max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                <Icon size={20} className="text-white" />
              </div>
            )}
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

// Composant Équipe
function TeamCard({ team, onAddMember, onRemoveMember, onToggleExpand, expanded, availableUsers }) {
  const [searchUser, setSearchUser] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const filteredUsers = availableUsers.filter(u =>
    !team.members?.some(m => m.user_email === u.email) &&
    (u.email.toLowerCase().includes(searchUser.toLowerCase()) ||
     u.name?.toLowerCase().includes(searchUser.toLowerCase()))
  );

  const handleAddMember = async () => {
    if (!selectedUser) return;
    await onAddMember(team.id, selectedUser.email, selectedUser.name);
    setSelectedUser(null);
    setSearchUser('');
    setShowUserDropdown(false);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div
        className="p-4 cursor-pointer flex items-center justify-between"
        style={{ borderLeft: `4px solid ${team.color || '#3b82f6'}` }}
        onClick={() => onToggleExpand(team.id)}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: team.color || '#3b82f6' }}
          >
            {team.name?.charAt(0) || 'T'}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{team.name}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Users size={14} />
              <span>{team.member_count || 0} membres ElectroHub</span>
              <span className="mx-1">•</span>
              <Ticket size={14} />
              <span>{team.open_tickets_count || 0} tickets ouverts</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {team.bubble_users?.length > 0 && (
            <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
              {team.bubble_users.length} sur Bubble
            </span>
          )}
          {expanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="p-4 pt-0 border-t border-gray-100">
          {/* Membres actuels */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Membres ElectroHub</h4>
            {team.members?.length > 0 ? (
              <div className="space-y-2">
                {team.members.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                        <span className="text-purple-600 text-sm font-medium">
                          {member.user_name?.charAt(0) || member.user_email?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{member.user_name || 'Sans nom'}</p>
                        <p className="text-xs text-gray-500">{member.user_email}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveMember(team.id, member.id);
                      }}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Aucun membre assigné</p>
            )}
          </div>

          {/* Ajouter un membre */}
          <div className="pt-3 border-t border-gray-100">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Ajouter un membre</h4>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchUser}
                  onChange={(e) => {
                    setSearchUser(e.target.value);
                    setShowUserDropdown(true);
                  }}
                  onFocus={() => setShowUserDropdown(true)}
                  placeholder="Rechercher un utilisateur..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                />
                {showUserDropdown && filteredUsers.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredUsers.slice(0, 10).map(user => (
                      <button
                        key={user.email}
                        onClick={() => {
                          setSelectedUser(user);
                          setSearchUser(user.name || user.email);
                          setShowUserDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-purple-50 text-sm flex items-center gap-2"
                      >
                        <span className="font-medium">{user.name || user.email}</span>
                        {user.name && <span className="text-gray-400">({user.email})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleAddMember}
                disabled={!selectedUser}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <UserPlus size={16} />
                Ajouter
              </button>
            </div>
          </div>

          {/* Utilisateurs Bubble de référence */}
          {team.bubble_users?.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <details className="text-sm">
                <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                  Voir les {team.bubble_users.length} utilisateurs Bubble (référence)
                </summary>
                <div className="mt-2 p-2 bg-blue-50 rounded-lg text-xs text-blue-700 max-h-32 overflow-y-auto">
                  {team.bubble_users.map((email, i) => (
                    <span key={i} className="inline-block mr-2 mb-1 px-2 py-0.5 bg-blue-100 rounded">
                      {email}
                    </span>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Page principale
export default function HaleonTicketTeamsAdmin() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [teams, setTeams] = useState([]);
  const [expandedTeams, setExpandedTeams] = useState(new Set());
  const [availableUsers, setAvailableUsers] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Check auth & admin
  useEffect(() => {
    const storedUser = localStorage.getItem('eh_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        const isAdminUser = ADMIN_EMAILS.includes(parsed.email?.toLowerCase()) ||
                           parsed.role === 'admin' || parsed.role === 'superadmin';
        setIsAdmin(isAdminUser);
        if (!isAdminUser) {
          navigate('/');
        }
      } catch (e) {
        navigate('/login');
      }
    } else {
      navigate('/login');
    }
  }, [navigate]);

  // Load data
  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);

    try {
      // Load teams with members
      const teamsRes = await fetch('/api/haleon-tickets/teams', getAuthOptions());
      if (!teamsRes.ok) throw new Error('Erreur chargement équipes');
      const teamsData = await teamsRes.json();

      // Load members for each team
      const teamsWithMembers = await Promise.all(
        teamsData.teams.map(async (team) => {
          const membersRes = await fetch(`/api/haleon-tickets/teams/${team.id}/members`, getAuthOptions());
          const membersData = await membersRes.json();
          return { ...team, members: membersData.members || [] };
        })
      );

      setTeams(teamsWithMembers);

      // Load available users
      const usersRes = await fetch('/api/haleon-tickets/available-users', getAuthOptions());
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setAvailableUsers(usersData.users || []);
      }
    } catch (err) {
      console.error('Erreur chargement:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  // Sync from Bubble
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);

    try {
      const res = await fetch('/api/haleon-tickets/teams/sync', {
        ...getAuthOptions(),
        method: 'POST'
      });

      if (!res.ok) throw new Error('Erreur synchronisation');
      const data = await res.json();
      setSyncResult(data);
      await loadData(); // Reload teams
    } catch (err) {
      console.error('Erreur sync:', err);
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Add member
  const handleAddMember = async (teamId, email, name) => {
    try {
      const res = await fetch(`/api/haleon-tickets/teams/${teamId}/members`, {
        ...getAuthOptions(),
        method: 'POST',
        body: JSON.stringify({ user_email: email, user_name: name })
      });

      if (!res.ok) throw new Error('Erreur ajout membre');
      await loadData();
    } catch (err) {
      console.error('Erreur ajout membre:', err);
      alert('Erreur: ' + err.message);
    }
  };

  // Remove member
  const handleRemoveMember = async (teamId, memberId) => {
    if (!confirm('Retirer ce membre de l\'équipe ?')) return;

    try {
      const res = await fetch(`/api/haleon-tickets/teams/${teamId}/members/${memberId}`, {
        ...getAuthOptions(),
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('Erreur suppression membre');
      await loadData();
    } catch (err) {
      console.error('Erreur suppression membre:', err);
      alert('Erreur: ' + err.message);
    }
  };

  // Toggle expand
  const toggleExpand = (teamId) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Filtered teams
  const filteredTeams = teams.filter(t =>
    t.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Stats
  const totalMembers = teams.reduce((acc, t) => acc + (t.member_count || 0), 0);
  const totalTickets = teams.reduce((acc, t) => acc + (t.open_tickets_count || 0), 0);

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/admin')}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <Ticket size={24} />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Équipes Haleon Tool</h1>
                  <p className="text-purple-200 text-sm">Gestion des équipes et permissions tickets</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://haleon-tool.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                <ExternalLink size={16} />
                Haleon Tool
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Stats & Actions */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{teams.length}</p>
                <p className="text-sm text-gray-500">Équipes</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <UserPlus size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalMembers}</p>
                <p className="text-sm text-gray-500">Membres assignés</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <Ticket size={20} className="text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalTickets}</p>
                <p className="text-sm text-gray-500">Tickets ouverts</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="w-full h-full flex items-center justify-center gap-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={20} className={syncing ? 'animate-spin' : ''} />
              <span className="font-medium">{syncing ? 'Synchronisation...' : 'Sync Bubble'}</span>
            </button>
          </div>
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className="mb-6 space-y-3">
            <div className={`p-4 rounded-xl ${syncResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              {syncResult.error ? (
                <p className="text-red-700"><AlertTriangle className="inline mr-2" size={16} />Erreur: {syncResult.error}</p>
              ) : (
                <p className="text-green-700">
                  <Check className="inline mr-2" size={16} />
                  Synchronisation réussie: {syncResult.teams_created} équipes créées, {syncResult.teams_updated} mises à jour, {syncResult.categories_synced} catégories
                </p>
              )}
            </div>

            {/* Alerte catégories non mappées */}
            {syncResult.has_unmapped && syncResult.unmapped_categories?.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
                  <div className="flex-1">
                    <h4 className="font-medium text-amber-800 mb-2">
                      ⚠️ {syncResult.unmapped_categories.length} catégorie(s) non mappée(s) détectée(s)
                    </h4>
                    <p className="text-sm text-amber-700 mb-3">
                      Ces catégories Bubble n'ont pas de mapping vers une équipe. Contactez le support pour ajouter le mapping :
                    </p>
                    <div className="space-y-2">
                      {syncResult.unmapped_categories.map((cat, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 bg-amber-100 rounded-lg text-sm">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: cat.color || '#ccc' }}
                          />
                          <code className="font-mono text-amber-900 flex-1">'{cat.name}': 'NOM_EQUIPE'</code>
                          <span className="text-amber-600 text-xs">(ID: {cat.equipeUserId?.slice(0, 15)}...)</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-amber-600 mt-3">
                      💡 Copiez le nom de la catégorie et indiquez l'équipe correspondante pour mettre à jour le mapping.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher une équipe..."
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Teams list */}
        {loading ? (
          <LoadingSpinner text="Chargement des équipes..." />
        ) : error ? (
          <ErrorMessage error={error} onRetry={loadData} />
        ) : filteredTeams.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl">
            <Ticket size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">Aucune équipe trouvée</h3>
            <p className="text-gray-500 mt-1">Cliquez sur "Sync Bubble" pour importer les équipes depuis Haleon Tool</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTeams.map(team => (
              <TeamCard
                key={team.id}
                team={team}
                expanded={expandedTeams.has(team.id)}
                onToggleExpand={toggleExpand}
                onAddMember={handleAddMember}
                onRemoveMember={handleRemoveMember}
                availableUsers={availableUsers}
              />
            ))}
          </div>
        )}

        {/* Help */}
        <div className="mt-8 p-4 bg-purple-50 rounded-xl border border-purple-100">
          <h4 className="font-medium text-purple-900 mb-2">Comment ça marche ?</h4>
          <ol className="text-sm text-purple-700 space-y-1 list-decimal list-inside">
            <li>Cliquez sur <strong>Sync Bubble</strong> pour importer les équipes depuis Haleon Tool</li>
            <li>Pour chaque équipe, ajoutez les utilisateurs ElectroHub qui doivent voir les tickets</li>
            <li>Les utilisateurs verront ensuite les tickets de leurs équipes dans le widget Dépannages</li>
            <li>Ils pourront s'attribuer, commenter et fermer les tickets directement depuis ElectroHub</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
