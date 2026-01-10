// src/components/HaleonTicketsWidget.jsx
// Widget d'affichage des tickets Haleon Tool dans le TroubleshootingDashboard

import { useState, useEffect, useCallback } from 'react';
import {
  Ticket, RefreshCw, ExternalLink, User, Clock, AlertTriangle,
  ChevronRight, CheckCircle, UserPlus, MessageSquare, X,
  Building2, MapPin, Filter
} from 'lucide-react';

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

// Helpers
function getPriorityColor(priority) {
  const colors = {
    safety: 'bg-red-600',
    urgent: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-blue-500',
    low: 'bg-green-500'
  };
  return colors[priority] || 'bg-gray-400';
}

function getPriorityLabel(priority) {
  const labels = {
    safety: 'Sécurité',
    urgent: 'Urgent',
    high: 'Haute',
    medium: 'Normale',
    low: 'Faible'
  };
  return labels[priority] || priority;
}

function getStatusColor(status) {
  const colors = {
    unassigned: 'bg-red-100 text-red-700 border-red-200',
    assigned: 'bg-orange-100 text-orange-700 border-orange-200',
    quote_pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    closed: 'bg-green-100 text-green-700 border-green-200'
  };
  return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
}

function getStatusLabel(status) {
  const labels = {
    unassigned: 'Non attribué',
    assigned: 'Attribué',
    quote_pending: 'Devis en attente',
    closed: 'Fermé'
  };
  return labels[status] || status;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Aujourd\'hui';
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getDaysOld(dateStr) {
  if (!dateStr) return 0;
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

// Mini stat card
function StatMini({ label, value, color, icon: Icon }) {
  const colorClasses = {
    red: 'bg-red-50 text-red-600 border-red-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100'
  };

  return (
    <div className={`p-2 rounded-lg border ${colorClasses[color] || colorClasses.blue}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-80">{label}</span>
        {Icon && <Icon size={12} />}
      </div>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

// Ticket row
function TicketRow({ ticket, onAssign, onView, userEmail }) {
  const isOld = getDaysOld(ticket.bubble_created_at) > 7;
  const isVeryOld = getDaysOld(ticket.bubble_created_at) > 14;
  const isMyTicket = ticket.assigned_to_email?.toLowerCase() === userEmail?.toLowerCase();

  return (
    <div
      className={`p-3 rounded-lg border transition-all hover:shadow-md cursor-pointer ${
        isVeryOld ? 'bg-red-50 border-red-200' :
        isOld ? 'bg-orange-50 border-orange-200' :
        'bg-white border-gray-200 hover:border-purple-300'
      }`}
      onClick={onView}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${getPriorityColor(ticket.priority_normalized)}`} />
            <span className="text-xs font-mono text-gray-500">{ticket.ticket_code}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusColor(ticket.status_normalized)}`}>
              {getStatusLabel(ticket.status_normalized)}
            </span>
            {isMyTicket && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                Mon ticket
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-gray-800 line-clamp-2 mb-2">
            {ticket.description || 'Sans description'}
          </p>

          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Building2 size={12} />
              {ticket.building || '-'}
            </span>
            {ticket.zone && (
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {ticket.zone}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {formatDate(ticket.bubble_created_at)}
              {isOld && <AlertTriangle size={10} className="text-orange-500" />}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1">
          {ticket.status_normalized === 'unassigned' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssign(ticket.bubble_ticket_id);
              }}
              className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg"
              title="M'attribuer"
            >
              <UserPlus size={16} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://haleon-tool.io/ticket/${ticket.bubble_ticket_id}`, '_blank');
            }}
            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
            title="Ouvrir dans Haleon Tool"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Ticket Detail Modal (no iframe - Bubble.io blocks embedding)
function TicketDetailModal({ ticket, onClose, onAssign, userEmail }) {
  if (!ticket) return null;

  const ticketUrl = `https://haleon-tool.io/ticket/${ticket.bubble_ticket_id}`;
  const isMyTicket = ticket.assigned_to_email?.toLowerCase() === userEmail?.toLowerCase();
  const daysOld = getDaysOld(ticket.bubble_created_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-purple-500/10 to-indigo-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <Ticket size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900">{ticket.ticket_code}</h3>
                <span className={`w-2 h-2 rounded-full ${getPriorityColor(ticket.priority_normalized)}`} />
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(ticket.status_normalized)}`}>
                {getStatusLabel(ticket.status_normalized)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Description */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Description</h4>
            <p className="text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
              {ticket.description || 'Aucune description'}
            </p>
          </div>

          {/* Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Bâtiment</h4>
              <div className="flex items-center gap-1 text-sm text-gray-800">
                <Building2 size={14} className="text-gray-400" />
                {ticket.building || '-'}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Zone</h4>
              <div className="flex items-center gap-1 text-sm text-gray-800">
                <MapPin size={14} className="text-gray-400" />
                {ticket.zone || '-'}
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Équipe</h4>
              <p className="text-sm text-gray-800">{ticket.team_name || '-'}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Priorité</h4>
              <p className="text-sm text-gray-800">{getPriorityLabel(ticket.priority_normalized)}</p>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Créé le</h4>
              <div className="flex items-center gap-1 text-sm text-gray-800">
                <Clock size={14} className="text-gray-400" />
                {ticket.bubble_created_at ?
                  new Date(ticket.bubble_created_at).toLocaleDateString('fr-FR', {
                    day: 'numeric', month: 'short', year: 'numeric'
                  }) : '-'}
                {daysOld > 7 && (
                  <span className="text-xs text-orange-600 ml-1">({daysOld}j)</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Assigné à</h4>
              <div className="flex items-center gap-1 text-sm text-gray-800">
                <User size={14} className="text-gray-400" />
                {ticket.assigned_to_name || ticket.assigned_to_email || 'Non assigné'}
                {isMyTicket && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 ml-1">Moi</span>
                )}
              </div>
            </div>
          </div>

          {/* Requestor */}
          {ticket.requestor_email && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">Demandeur</h4>
              <p className="text-sm text-gray-800">{ticket.requestor_name || ticket.requestor_email}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          {ticket.status_normalized === 'unassigned' && (
            <button
              onClick={() => {
                onAssign(ticket.bubble_ticket_id);
                onClose();
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium"
            >
              <UserPlus size={16} />
              M'attribuer ce ticket
            </button>
          )}
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${ticket.status_normalized === 'unassigned' ? '' : 'flex-1'} flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-purple-200 text-purple-700 rounded-xl hover:bg-purple-50 transition-colors font-medium`}
          >
            <ExternalLink size={16} />
            Ouvrir dans Haleon Tool
          </a>
        </div>
      </div>

      {/* Backdrop click to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />

      {/* Animation styles */}
      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-scaleIn { animation: scaleIn 0.2s ease-out; }
      `}</style>
    </div>
  );
}

// Main Widget
export default function HaleonTicketsWidget({ userEmail, className = '' }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'unassigned', 'mine'
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null); // For iframe modal

  // Load data
  const loadData = useCallback(async () => {
    if (!userEmail) return;

    try {
      // Load stats
      const statsRes = await fetch('/api/haleon-tickets/stats', getAuthOptions());
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // Load tickets based on filter
      let url = '/api/haleon-tickets/list?limit=20';
      if (filter === 'unassigned') url += '&status=unassigned';
      if (filter === 'mine') url += '&assigned_to_me=true';

      const ticketsRes = await fetch(url, getAuthOptions());
      if (ticketsRes.ok) {
        const ticketsData = await ticketsRes.json();
        setTickets(ticketsData.tickets || []);
      }

      setError(null);
    } catch (err) {
      console.error('[HaleonTickets] Erreur:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userEmail, filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-sync every 15 minutes
  useEffect(() => {
    const SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds

    // Initial sync on mount (if not recently synced)
    const lastSyncTime = localStorage.getItem('haleon_last_sync');
    const now = Date.now();
    const timeSinceLastSync = lastSyncTime ? now - parseInt(lastSyncTime) : SYNC_INTERVAL;

    // If more than 15 minutes since last sync, sync now
    if (timeSinceLastSync >= SYNC_INTERVAL) {
      console.log('[HaleonTickets] Auto-sync: starting initial sync');
      fetch('/api/haleon-tickets/sync', {
        ...getAuthOptions(),
        method: 'POST'
      }).then(() => {
        localStorage.setItem('haleon_last_sync', Date.now().toString());
        setLastSync(new Date());
        loadData();
        console.log('[HaleonTickets] Auto-sync: initial sync completed');
      }).catch(err => console.error('[HaleonTickets] Auto-sync error:', err));
    }

    // Set up interval for regular syncs
    const intervalId = setInterval(() => {
      console.log('[HaleonTickets] Auto-sync: starting scheduled sync');
      fetch('/api/haleon-tickets/sync', {
        ...getAuthOptions(),
        method: 'POST'
      }).then(() => {
        localStorage.setItem('haleon_last_sync', Date.now().toString());
        setLastSync(new Date());
        loadData();
        console.log('[HaleonTickets] Auto-sync: scheduled sync completed');
      }).catch(err => console.error('[HaleonTickets] Auto-sync error:', err));
    }, SYNC_INTERVAL);

    return () => clearInterval(intervalId);
  }, []); // Empty deps - only run once on mount

  // Sync tickets
  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/haleon-tickets/sync', {
        ...getAuthOptions(),
        method: 'POST'
      });
      localStorage.setItem('haleon_last_sync', Date.now().toString());
      setLastSync(new Date());
      await loadData();
    } catch (err) {
      console.error('[HaleonTickets] Erreur sync:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Assign ticket
  const handleAssign = async (ticketId) => {
    try {
      const res = await fetch(`/api/haleon-tickets/${ticketId}/assign`, {
        ...getAuthOptions(),
        method: 'POST'
      });

      if (res.ok) {
        await loadData();
      } else {
        const data = await res.json();
        alert('Erreur: ' + (data.error || 'Impossible de s\'attribuer le ticket'));
      }
    } catch (err) {
      console.error('[HaleonTickets] Erreur assign:', err);
      alert('Erreur: ' + err.message);
    }
  };

  // View ticket details in iframe modal
  const handleView = (ticket) => {
    setSelectedTicket(ticket);
  };

  // No teams assigned
  if (!loading && stats && stats.user_teams?.length === 0) {
    return null; // Don't show widget if user has no teams
  }

  return (
    <div className={`bg-gradient-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-purple-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Ticket size={16} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Tickets Haleon Tool</h3>
              {stats?.user_teams && (
                <p className="text-xs text-gray-500">
                  {stats.user_teams.join(', ')}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg disabled:opacity-50"
            title="Synchroniser"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="p-3 grid grid-cols-4 gap-2 border-b border-purple-500/20">
          <StatMini
            label="Ouverts"
            value={stats.total || 0}
            color="blue"
          />
          <StatMini
            label="Non attribués"
            value={stats.unassigned || 0}
            color="red"
          />
          <StatMini
            label="Mes tickets"
            value={stats.my_tickets || 0}
            color="purple"
          />
          <StatMini
            label="Urgents"
            value={stats.urgent || 0}
            color="orange"
            icon={AlertTriangle}
          />
        </div>
      )}

      {/* Filters */}
      <div className="px-3 pt-3 flex gap-2">
        {[
          { key: 'all', label: 'Tous' },
          { key: 'unassigned', label: 'Non attribués' },
          { key: 'mine', label: 'Mes tickets' }
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === f.key
                ? 'bg-purple-600 text-white'
                : 'bg-white text-gray-600 hover:bg-purple-50 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tickets list */}
      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {loading ? (
          <div className="text-center py-8">
            <RefreshCw className="w-6 h-6 text-purple-400 animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-500">Chargement...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={loadData}
              className="mt-2 text-xs text-purple-600 hover:underline"
            >
              Réessayer
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="w-6 h-6 text-green-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {filter === 'mine' ? 'Aucun ticket attribué' :
               filter === 'unassigned' ? 'Aucun ticket en attente' :
               'Aucun ticket ouvert'}
            </p>
          </div>
        ) : (
          tickets.map(ticket => (
            <TicketRow
              key={ticket.bubble_ticket_id}
              ticket={ticket}
              userEmail={userEmail}
              onAssign={handleAssign}
              onView={() => handleView(ticket)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-purple-500/20 flex items-center justify-between">
        <a
          href="https://haleon-tool.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
        >
          Ouvrir Haleon Tool
          <ExternalLink size={12} />
        </a>
        {lastSync && (
          <span className="text-xs text-gray-400">
            Sync: {lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onAssign={handleAssign}
          userEmail={userEmail}
        />
      )}
    </div>
  );
}
