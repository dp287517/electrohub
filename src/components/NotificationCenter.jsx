import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Bell, AlertCircle, CheckCircle, Clock, FileText,
  PenTool, Play, ChevronRight, Loader2, RefreshCw,
  X, Filter, Trash2, ExternalLink
} from 'lucide-react';
import { get, del } from '../lib/api';
import { getAllowedAppIds, EQUIPMENT_TYPE_TO_APP } from '../lib/permissions';

// Color mapping for activity types
const colorMap = {
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  red: 'bg-red-100 text-red-700 border-red-200',
};

// Format relative time
function formatRelativeTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes}min`;
  if (hours < 24) return `Il y a ${hours}h`;
  if (days < 7) return `Il y a ${days}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Activity item component with delete option
function ActivityItem({ activity, compact = false, onDelete, showDelete = false }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    await onDelete?.(activity.id);
    setDeleting(false);
  };

  const content = (
    <div className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors ${
      activity.actionRequired ? 'bg-amber-50 border border-amber-200' : ''
    }`}>
      {/* Icon */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-lg ${
        colorMap[activity.color] || colorMap.blue
      }`}>
        {activity.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-medium text-sm ${
            activity.actionRequired ? 'text-amber-800' : 'text-gray-900'
          }`}>
            {activity.title}
          </span>
          {activity.actionRequired && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-500 text-white rounded">
              Action
            </span>
          )}
        </div>
        <p className="text-sm text-gray-600 truncate">{activity.description}</p>
        {!compact && (
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <Clock className="w-3 h-3" />
            <span>{formatRelativeTime(activity.timestamp)}</span>
            {activity.actor && (
              <>
                <span>•</span>
                <span>{activity.actor}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {showDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Supprimer"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        )}
        {activity.url && (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </div>
    </div>
  );

  if (activity.url) {
    return <Link to={activity.url}>{content}</Link>;
  }
  return content;
}

// Modal for full activity list - uses Portal to render at body level
function ActivityModal({ isOpen, onClose, activities, loading, onRefresh, onDelete, onClearAll }) {
  if (!isOpen) return null;

  const allActivities = [...(activities.action_required || []), ...(activities.recent || [])];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              <h2 className="font-semibold">Activité récente</h2>
              {allActivities.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold bg-white/20 rounded-full">
                  {allActivities.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onRefresh}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                disabled={loading}
                title="Rafraîchir"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {allActivities.length > 0 && (
                <button
                  onClick={onClearAll}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                  title="Tout effacer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto divide-y">
          {loading && allActivities.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
            </div>
          ) : allActivities.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">Aucune activité</p>
              <p className="text-sm">Les nouvelles activités apparaîtront ici</p>
            </div>
          ) : (
            allActivities.map(activity => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                onDelete={onDelete}
                showDelete={true}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t rounded-b-2xl flex-shrink-0 text-center">
          <Link
            to="/app/procedures"
            onClick={onClose}
            className="text-sm text-violet-600 hover:text-violet-700 font-medium inline-flex items-center gap-1"
          >
            Voir les procédures <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Map activity types/URLs to app IDs for filtering
const ACTIVITY_TO_APP = {
  'switchboard': 'switchboards',
  'switchboards': 'switchboards',
  'vsd': 'vsd',
  'meca': 'meca',
  'mobile': 'mobile-equipments',
  'mobile-equipments': 'mobile-equipments',
  'hv': 'hv',
  'glo': 'glo',
  'datahub': 'datahub',
  'infrastructure': 'infrastructure',
  'controls': 'switchboard-controls',
  'switchboard-controls': 'switchboard-controls',
  'procedures': 'procedures',
  'doors': 'doors',
  'fire-control': 'fire-control',
  'projects': 'projects',
  'atex': 'atex',
  'comp-ext': 'comp-ext',
};

// Extract app ID from activity URL or type
function getActivityAppId(activity) {
  // Check URL first
  if (activity.url) {
    const urlMatch = activity.url.match(/\/app\/([a-z-]+)/);
    if (urlMatch) {
      return ACTIVITY_TO_APP[urlMatch[1]] || urlMatch[1];
    }
  }
  // Check type field
  if (activity.type) {
    const typeParts = activity.type.split('_');
    for (const part of typeParts) {
      if (ACTIVITY_TO_APP[part]) return ACTIVITY_TO_APP[part];
    }
  }
  // Check equipment_type field
  if (activity.equipment_type) {
    const appId = EQUIPMENT_TYPE_TO_APP[activity.equipment_type];
    if (appId) return appId;
  }
  return null;
}

// Main NotificationCenter component
export default function NotificationCenter({ compact = false, maxItems = 10, userEmail }) {
  const [activities, setActivities] = useState({ action_required: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [clearedAt, setClearedAt] = useState(() => {
    // Load cleared timestamp from localStorage
    const saved = localStorage.getItem('activities_cleared_at');
    return saved ? new Date(saved) : null;
  });

  // Get user's allowed apps for filtering
  const allowedAppIds = useMemo(() => getAllowedAppIds(userEmail), [userEmail]);
  const isAdmin = useMemo(() => {
    // Check if user is admin (has all apps or is in admin list)
    const allAppIds = ['switchboards', 'vsd', 'meca', 'mobile-equipments', 'hv', 'glo', 'datahub',
                      'infrastructure', 'switchboard-controls', 'procedures', 'doors', 'projects',
                      'atex', 'comp-ext', 'fire-control', 'obsolescence', 'selectivity', 'fault-level',
                      'arc-flash', 'loopcalc'];
    return allowedAppIds.length >= allAppIds.length;
  }, [allowedAppIds]);

  // Filter activity based on user's allowed apps
  const filterActivityByPermission = (activity) => {
    // Admins see everything
    if (isAdmin || allowedAppIds.length === 0) return true;

    const activityAppId = getActivityAppId(activity);
    // If we can't determine the app, show it (safe default)
    if (!activityAppId) return true;

    return allowedAppIds.includes(activityAppId);
  };

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const data = await get('/api/dashboard/activities', { limit: 50 });
      if (data) {
        // Filter out activities older than clearedAt and by user permissions
        const filterActivities = (items) => {
          let filtered = items || [];
          // Filter by cleared timestamp
          if (clearedAt) {
            filtered = filtered.filter(a => new Date(a.timestamp) > clearedAt);
          }
          // Filter by user permissions
          filtered = filtered.filter(filterActivityByPermission);
          return filtered;
        };
        setActivities({
          action_required: filterActivities(data.action_required),
          recent: filterActivities(data.recent)
        });
      } else {
        const fallback = await get('/api/procedures/activities/recent', { limit: 50 });
        if (fallback) {
          const filterActivities = (items) => {
            let filtered = items || [];
            if (clearedAt) {
              filtered = filtered.filter(a => new Date(a.timestamp) > clearedAt);
            }
            filtered = filtered.filter(filterActivityByPermission);
            return filtered;
          };
          setActivities({
            action_required: filterActivities(fallback.action_required),
            recent: filterActivities(fallback.recent)
          });
        }
      }
    } catch (err) {
      setError('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await del(`/api/dashboard/activities/${id}`);
      // Remove from local state
      setActivities(prev => ({
        action_required: prev.action_required.filter(a => a.id !== id),
        recent: prev.recent.filter(a => a.id !== id)
      }));
    } catch (err) {
      console.error('Failed to delete activity:', err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Supprimer toutes les activités ?')) return;
    try {
      // Also call backend to clean up deletable entries
      await del('/api/dashboard/activities');
      // Save current time to localStorage - all activities before this are "cleared"
      const now = new Date().toISOString();
      localStorage.setItem('activities_cleared_at', now);
      setClearedAt(new Date(now));
      setActivities({ action_required: [], recent: [] });
    } catch (err) {
      console.error('Failed to clear activities:', err);
    }
  };

  useEffect(() => {
    fetchActivities();
    const interval = setInterval(fetchActivities, 120000);
    return () => clearInterval(interval);
  }, [clearedAt, allowedAppIds]); // Re-fetch when clearedAt or permissions change

  const totalCount = (activities.action_required?.length || 0) + (activities.recent?.length || 0);
  const actionCount = activities.action_required?.length || 0;
  const latestActivity = activities.action_required?.[0] || activities.recent?.[0];

  // Compact view - just a clickable card
  if (compact) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="w-full text-left p-4 hover:bg-gray-50 transition-colors rounded-xl"
        >
          {loading && totalCount === 0 ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            </div>
          ) : totalCount === 0 ? (
            <div className="flex items-center gap-3 text-gray-500">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                <Bell className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="font-medium text-gray-600">Aucune activité</p>
                <p className="text-sm text-gray-400">Tout est à jour</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {/* Icon with badge */}
              <div className="relative">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  actionCount > 0
                    ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                    : 'bg-gradient-to-br from-violet-400 to-purple-500'
                }`}>
                  <Bell className="w-5 h-5 text-white" />
                </div>
                {totalCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {totalCount > 9 ? '9+' : totalCount}
                  </span>
                )}
              </div>

              {/* Latest activity preview */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {actionCount > 0 ? `${actionCount} action${actionCount > 1 ? 's' : ''} requise${actionCount > 1 ? 's' : ''}` : `${totalCount} activité${totalCount > 1 ? 's' : ''}`}
                  </span>
                </div>
                {latestActivity && (
                  <p className="text-sm text-gray-500 truncate">
                    {latestActivity.icon} {latestActivity.title}
                  </p>
                )}
              </div>

              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          )}
        </button>

        <ActivityModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          activities={activities}
          loading={loading}
          onRefresh={fetchActivities}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />
      </>
    );
  }

  // Filter activities for full view
  const filteredRecent = activities.recent.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'procedures') return a.type?.includes('procedure');
    if (filter === 'signatures') return a.type?.includes('signature');
    if (filter === 'scans') return a.type?.includes('scan');
    return true;
  }).slice(0, maxItems);

  // Full view
  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <h2 className="font-semibold">Centre de Notifications</h2>
            {activities.action_required.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-bold bg-white text-violet-600 rounded-full">
                {activities.action_required.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={fetchActivities}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {totalCount > 0 && (
              <button
                onClick={handleClearAll}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="Tout effacer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b flex gap-2 overflow-x-auto">
        {[
          { id: 'all', label: 'Tout' },
          { id: 'actions', label: 'Actions' },
          { id: 'scans', label: 'Scans IA' },
          { id: 'procedures', label: 'Procédures' },
          { id: 'signatures', label: 'Signatures' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 text-sm rounded-full whitespace-nowrap transition-colors ${
              filter === f.id
                ? 'bg-violet-100 text-violet-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Action Required Section */}
      {activities.action_required.length > 0 && filter !== 'procedures' && (
        <div className="border-b">
          <div className="px-4 py-2 bg-amber-50">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Actions requises</span>
            </div>
          </div>
          <div className="divide-y">
            {activities.action_required.map(activity => (
              <ActivityItem key={activity.id} activity={activity} onDelete={handleDelete} showDelete />
            ))}
          </div>
        </div>
      )}

      {/* Recent Activities */}
      <div className="divide-y max-h-[400px] overflow-y-auto">
        {filteredRecent.map(activity => (
          <ActivityItem key={activity.id} activity={activity} onDelete={handleDelete} showDelete />
        ))}
      </div>

      {filteredRecent.length === 0 && activities.action_required.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Aucune activité</p>
          <p className="text-sm">Les nouvelles activités apparaîtront ici</p>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-50 border-t text-center">
        <Link
          to="/app/procedures"
          className="text-sm text-violet-600 hover:text-violet-700 font-medium"
        >
          Voir toutes les procédures →
        </Link>
      </div>
    </div>
  );
}

// Small notification badge for header
export function NotificationBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const data = await get('/api/dashboard/activities', { limit: 10 });
        if (data) {
          setCount(data.action_required?.length || 0);
        }
      } catch (err) {
        // Silent fail
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  if (count === 0) return null;

  return (
    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
      {count > 9 ? '9+' : count}
    </span>
  );
}
