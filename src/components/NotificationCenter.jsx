import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, AlertCircle, CheckCircle, Clock, FileText,
  PenTool, Play, ChevronRight, Loader2, RefreshCw,
  X, Filter
} from 'lucide-react';
import { api } from '../lib/api';

// Color mapping for activity types
const colorMap = {
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  red: 'bg-red-100 text-red-700 border-red-200',
};

const iconColorMap = {
  violet: 'text-violet-500',
  green: 'text-green-500',
  amber: 'text-amber-500',
  blue: 'text-blue-500',
  red: 'text-red-500',
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

// Activity item component
function ActivityItem({ activity, compact = false }) {
  return (
    <Link
      to={activity.url}
      className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors ${
        activity.actionRequired ? 'bg-amber-50 border border-amber-200' : ''
      }`}
    >
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

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
    </Link>
  );
}

// Main NotificationCenter component
export default function NotificationCenter({ compact = false, maxItems = 10 }) {
  const [activities, setActivities] = useState({ action_required: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, actions, procedures, signatures

  const fetchActivities = async () => {
    try {
      setLoading(true);
      // Use unified dashboard activities endpoint that aggregates from ALL modules
      const response = await api.get('/api/dashboard/activities?limit=50');
      if (response.ok) {
        const data = await response.json();
        setActivities(data);
      } else {
        // Fallback to procedures if unified endpoint fails
        const fallback = await api.get('/api/procedures/activities/recent?limit=50');
        if (fallback.ok) {
          setActivities(await fallback.json());
        }
      }
    } catch (err) {
      setError('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
    // Refresh every 2 minutes
    const interval = setInterval(fetchActivities, 120000);
    return () => clearInterval(interval);
  }, []);

  // Filter activities
  const filteredRecent = activities.recent.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'procedures') return a.type.includes('procedure');
    if (filter === 'signatures') return a.type.includes('signature');
    return true;
  }).slice(0, maxItems);

  if (loading && activities.recent.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
      </div>
    );
  }

  if (compact) {
    // Compact view for dashboard widget
    return (
      <div className="space-y-2">
        {/* Action required items first */}
        {activities.action_required.slice(0, 3).map(activity => (
          <ActivityItem key={activity.id} activity={activity} compact />
        ))}

        {/* Recent items */}
        {filteredRecent.slice(0, maxItems - activities.action_required.length).map(activity => (
          <ActivityItem key={activity.id} activity={activity} compact />
        ))}

        {activities.action_required.length === 0 && filteredRecent.length === 0 && (
          <div className="text-center py-6 text-gray-500">
            <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p>Aucune activité récente</p>
          </div>
        )}
      </div>
    );
  }

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
          <button
            onClick={fetchActivities}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b flex gap-2 overflow-x-auto">
        {[
          { id: 'all', label: 'Tout' },
          { id: 'actions', label: 'Actions' },
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
              <ActivityItem key={activity.id} activity={activity} />
            ))}
          </div>
        </div>
      )}

      {/* Recent Activities */}
      <div className="divide-y max-h-[400px] overflow-y-auto">
        {filteredRecent.map(activity => (
          <ActivityItem key={activity.id} activity={activity} />
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
        const response = await api.get('/api/dashboard/activities?limit=10');
        if (response.ok) {
          const data = await response.json();
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
