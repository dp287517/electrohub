// src/components/AuditHistory.jsx
// Composant réutilisable pour afficher l'historique des modifications
import React, { useState, useEffect } from 'react';
import {
  History, User, Clock, Plus, Trash2, Edit3, Eye, Upload,
  Camera, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Filter, RefreshCw, Download, FileText, Settings, Shield
} from 'lucide-react';

// Mapping des actions vers des icônes et couleurs
const ACTION_CONFIG = {
  created: { icon: Plus, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Créé' },
  deleted: { icon: Trash2, color: 'text-red-600', bg: 'bg-red-100', label: 'Supprimé' },
  updated: { icon: Edit3, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Modifié' },
  viewed: { icon: Eye, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Consulté' },
  imported: { icon: Download, color: 'text-purple-600', bg: 'bg-purple-100', label: 'Importé' },
  exported: { icon: Upload, color: 'text-indigo-600', bg: 'bg-indigo-100', label: 'Exporté' },
  check_completed: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'Contrôlé' },
  check_started: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100', label: 'Contrôle démarré' },
  photo_updated: { icon: Camera, color: 'text-pink-600', bg: 'bg-pink-100', label: 'Photo mise à jour' },
  file_uploaded: { icon: FileText, color: 'text-cyan-600', bg: 'bg-cyan-100', label: 'Fichier ajouté' },
  settings_changed: { icon: Settings, color: 'text-gray-600', bg: 'bg-gray-100', label: 'Paramètres modifiés' },
  status_changed: { icon: Shield, color: 'text-orange-600', bg: 'bg-orange-100', label: 'Statut changé' },
};

// Formatage de la date relative
function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "À l'instant";
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;

  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

// Formatage complet de la date
function formatFullDate(dateStr) {
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Composant pour un événement individuel
const AuditEventItem = ({ event, expanded, onToggle }) => {
  const config = ACTION_CONFIG[event.action] || {
    icon: History,
    color: 'text-gray-600',
    bg: 'bg-gray-100',
    label: event.action
  };
  const Icon = config.icon;

  const actorName = event.actor_name || event.actor_email?.split('@')[0] || 'Anonyme';
  const actorEmail = event.actor_email || '';

  return (
    <div className="border-l-2 border-gray-200 pl-4 pb-4 relative group">
      {/* Timeline dot */}
      <div className={`absolute -left-2 w-4 h-4 rounded-full ${config.bg} border-2 border-white shadow`}>
        <Icon size={8} className={`${config.color} absolute inset-0 m-auto`} />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
                <Icon size={12} />
                {config.label}
              </span>
              {event.entity_type && (
                <span className="text-xs text-gray-500">
                  {event.entity_type}
                  {event.entity_id && ` #${event.entity_id}`}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2 text-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">
                  {actorName.charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-gray-900">{actorName}</span>
              </div>
              {actorEmail && (
                <span className="text-gray-400 text-xs hidden sm:inline">({actorEmail})</span>
              )}
            </div>

            {event.details && Object.keys(event.details).length > 0 && (
              <button
                onClick={onToggle}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? 'Masquer les détails' : 'Voir les détails'}
              </button>
            )}

            {expanded && event.details && (
              <div className="mt-2 p-2 bg-gray-50 rounded-lg text-xs">
                <pre className="whitespace-pre-wrap text-gray-600 font-mono">
                  {JSON.stringify(event.details, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="text-right shrink-0">
            <span className="text-xs text-gray-500" title={formatFullDate(event.ts)}>
              {formatRelativeTime(event.ts)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Composant principal
export default function AuditHistory({
  apiEndpoint,
  entityType = null,
  entityId = null,
  title = "Historique des modifications",
  maxHeight = "400px",
  showFilters = true,
  autoRefresh = false,
  refreshInterval = 30000
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('all');

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = apiEndpoint;
      if (entityType && entityId) {
        url = `${apiEndpoint}/entity/${entityType}/${entityId}`;
      }

      const params = new URLSearchParams();
      if (filter !== 'all') params.set('action', filter);
      if (params.toString()) url += `?${params.toString()}`;

      const token = localStorage.getItem('eh_token');
      const response = await fetch(url, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) throw new Error('Erreur lors du chargement');

      const data = await response.json();
      setEvents(data.events || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [apiEndpoint, entityType, entityId, filter]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchHistory, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  const actionOptions = [
    { value: 'all', label: 'Toutes les actions' },
    { value: 'created', label: 'Créations' },
    { value: 'updated', label: 'Modifications' },
    { value: 'deleted', label: 'Suppressions' },
    { value: 'check_completed', label: 'Contrôles' },
  ];

  if (loading && events.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="animate-spin" size={20} />
          <span>Chargement de l'historique...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <div className="flex items-center gap-2 text-red-600">
          <XCircle size={20} />
          <span>{error}</span>
          <button
            onClick={fetchHistory}
            className="ml-auto text-sm underline hover:no-underline"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <History size={18} className="text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {events.length} événement{events.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {showFilters && (
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {actionOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            <button
              onClick={fetchHistory}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title="Actualiser"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Events list */}
      <div
        className="p-4 overflow-y-auto"
        style={{ maxHeight }}
      >
        {events.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <History size={40} className="mx-auto mb-2 text-gray-300" />
            <p>Aucun historique disponible</p>
          </div>
        ) : (
          <div className="space-y-0">
            {events.map((event) => (
              <AuditEventItem
                key={event.id}
                event={event}
                expanded={expandedId === event.id}
                onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Export des sous-composants pour usage personnalisé
export { AuditEventItem, ACTION_CONFIG, formatRelativeTime, formatFullDate };
