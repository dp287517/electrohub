// src/components/LastModifiedBadge.jsx
// Badge compact affichant le dernier utilisateur qui a modifié un élément
import React from 'react';
import { User, Clock } from 'lucide-react';

// Formatage de la date relative
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `${diffMins}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}j`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}sem`;

  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Générer une couleur à partir d'un email
function getAvatarColor(email) {
  if (!email) return 'from-gray-400 to-gray-500';
  const colors = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-violet-600',
    'from-orange-500 to-red-600',
    'from-pink-500 to-rose-600',
    'from-cyan-500 to-blue-600',
    'from-amber-500 to-orange-600',
  ];
  const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Badge compact pour afficher qui a créé/modifié
export function CreatedByBadge({ name, email, date, size = 'sm' }) {
  if (!name && !email) return null;

  const displayName = name || email?.split('@')[0] || 'Anonyme';
  const initial = displayName.charAt(0).toUpperCase();
  const avatarColor = getAvatarColor(email);

  const sizeClasses = {
    xs: { avatar: 'w-4 h-4 text-[8px]', text: 'text-[10px]' },
    sm: { avatar: 'w-5 h-5 text-[10px]', text: 'text-xs' },
    md: { avatar: 'w-6 h-6 text-xs', text: 'text-sm' },
  };
  const s = sizeClasses[size] || sizeClasses.sm;

  return (
    <div className="inline-flex items-center gap-1.5" title={email || displayName}>
      <div className={`${s.avatar} rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white font-bold shadow-sm`}>
        {initial}
      </div>
      <span className={`${s.text} text-gray-600`}>
        {displayName}
        {date && (
          <span className="text-gray-400 ml-1">
            · {formatRelativeTime(date)}
          </span>
        )}
      </span>
    </div>
  );
}

// Badge pour afficher la dernière modification avec plus de détails
export function LastModifiedBadge({
  actor_name,
  actor_email,
  date,
  action = 'modifié',
  showIcon = true,
  className = ''
}) {
  if (!actor_name && !actor_email && !date) return null;

  const displayName = actor_name || actor_email?.split('@')[0] || 'Quelqu\'un';
  const initial = displayName.charAt(0).toUpperCase();
  const avatarColor = getAvatarColor(actor_email);

  const actionLabels = {
    created: 'Créé par',
    updated: 'Modifié par',
    deleted: 'Supprimé par',
    checked: 'Contrôlé par',
    'modifié': 'Modifié par',
  };
  const actionLabel = actionLabels[action] || action;

  return (
    <div className={`inline-flex items-center gap-2 text-xs text-gray-500 ${className}`}>
      {showIcon && <Clock size={12} className="text-gray-400" />}
      <span>{actionLabel}</span>
      <div className="inline-flex items-center gap-1">
        <div className={`w-4 h-4 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-[8px] font-bold`}>
          {initial}
        </div>
        <span className="font-medium text-gray-700">{displayName}</span>
      </div>
      {date && (
        <span className="text-gray-400">
          · {formatRelativeTime(date)}
        </span>
      )}
    </div>
  );
}

// Liste horizontale de contributeurs
export function ContributorsList({ contributors = [], max = 5 }) {
  if (!contributors.length) return null;

  const visible = contributors.slice(0, max);
  const remaining = contributors.length - max;

  return (
    <div className="flex items-center -space-x-1">
      {visible.map((c, i) => {
        const name = c.actor_name || c.name || c.email?.split('@')[0];
        const avatarColor = getAvatarColor(c.actor_email || c.email);
        return (
          <div
            key={c.actor_email || c.email || i}
            className={`w-6 h-6 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-[10px] font-bold border-2 border-white shadow-sm`}
            title={`${name} (${c.action_count || 1} actions)`}
          >
            {name?.charAt(0).toUpperCase() || '?'}
          </div>
        );
      })}
      {remaining > 0 && (
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-medium border-2 border-white">
          +{remaining}
        </div>
      )}
    </div>
  );
}

export default LastModifiedBadge;
