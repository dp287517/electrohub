// src/components/HaleonTicketsWidget.jsx
// Widget d'affichage des tickets Haleon Tool dans le TroubleshootingDashboard

import { useState, useEffect, useCallback } from 'react';
import {
  Ticket, RefreshCw, ExternalLink, User, Clock, AlertTriangle,
  ChevronRight, CheckCircle, UserPlus, MessageSquare, X,
  Building2, MapPin, Filter, Image as ImageIcon
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

// Check if a value is a Bubble ID (format: timestamp x random)
function isBubbleId(value) {
  if (!value || typeof value !== 'string') return false;
  return /^\d{13,}x\d+$/.test(value);
}

// Get a clean display value - hide Bubble IDs
function getDisplayValue(value, fallback = '-') {
  if (!value) return fallback;
  if (isBubbleId(value)) return fallback;
  return value;
}

// Extract readable values from raw_data
function extractReadableData(rawData) {
  if (!rawData) return {};

  let data;
  try {
    data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch (e) {
    console.warn('[HaleonTickets] Failed to parse raw_data:', e);
    return {};
  }

  // Try to find human-readable versions of fields
  // Bubble sometimes has _text or _display suffixes, or uses French/English variations
  const result = {
    building: null,
    zone: null,
    assignedTo: null,
    createdBy: null,
    createdAt: null
  };

  // Building - look for text version or code (multiple naming conventions)
  const buildingFields = [
    'Bâtiment_text', 'batiment_text', 'building_text', 'Building_text',
    'Bat_Code', 'BatCode', 'bat_code', 'batCode',
    'NomBâtiment', 'nom_batiment', 'building_name', 'BuildingName',
    'batiment_nom', 'Batiment_nom', 'bâtiment_nom',
    'batiment', 'Batiment', 'bâtiment' // Only use if not a Bubble ID
  ];
  for (const field of buildingFields) {
    const value = data[field];
    if (value && typeof value === 'string' && !isBubbleId(value)) {
      result.building = value;
      break;
    }
  }

  // Zone - look for text version
  const zoneFields = [
    'Zone_text', 'zone_text', 'zone_name', 'ZoneName',
    'NomZone', 'nom_zone', 'Zone_nom', 'zone_nom',
    'zone', 'Zone' // Only use if not a Bubble ID
  ];
  for (const field of zoneFields) {
    const value = data[field];
    if (value && typeof value === 'string' && !isBubbleId(value)) {
      result.zone = value;
      break;
    }
  }

  // Assigned to - look for name or email
  const assignedFields = [
    'AssigneANom', 'assigne_a_nom', 'AssignedToName', 'assigned_to_name',
    'Attribué à_name', 'attribue_a_name', 'attribue_name',
    'AssignedToEmail', 'assigned_to_email', 'assignee_email', 'Assignee_email',
    'responsable_nom', 'ResponsableNom', 'responsable_email', 'ResponsableEmail'
  ];
  for (const field of assignedFields) {
    const value = data[field];
    if (value && typeof value === 'string' && !isBubbleId(value)) {
      result.assignedTo = value;
      break;
    }
  }

  // Creator/Demandeur - look for name or email
  const creatorFields = [
    'CréateurNom', 'createur_nom', 'CreatorName', 'creator_name',
    'CréateurDuTicket_name', 'createur_du_ticket_name',
    'CreatorEmail', 'creator_email', 'createur_email', 'CréateurEmail',
    'demandeur_nom', 'DemandeurNom', 'demandeur_name', 'DemandeurName',
    'demandeur_email', 'DemandeurEmail', 'requestor_email', 'RequestorEmail',
    'requestor_name', 'RequestorName', 'auteur_nom', 'AuteurNom', 'auteur_email', 'AuteurEmail'
  ];
  for (const field of creatorFields) {
    const value = data[field];
    if (value && typeof value === 'string' && !isBubbleId(value)) {
      result.createdBy = value;
      break;
    }
  }

  // Creation date - check multiple field names
  const dateFields = [
    'Creation Date', 'creation_date', 'CreationDate', 'created_date',
    'Created Date', 'date_creation', 'DateCreation', 'createdAt',
    'Created', 'created_at', 'date', 'Date'
  ];
  for (const field of dateFields) {
    const value = data[field];
    if (value && typeof value === 'string') {
      // Must look like a date (contains - or /)
      if (value.includes('-') || value.includes('/') || value.includes('T')) {
        result.createdAt = value;
        break;
      }
    }
  }

  return result;
}

// Build Bubble.io ticket URL - format: ?screen=parcourirC&code=CODE
function getTicketUrl(ticketCode) {
  // Extract the numeric code from ticket_code (e.g., "TICKET#220091" -> "220091")
  const code = ticketCode?.replace(/[^0-9]/g, '') || ticketCode;
  return `https://haleon-tool.io/ticket?screen=parcourirC&code=${code}`;
}

// Extract photos from raw_data
function getTicketPhotos(rawData) {
  if (!rawData) return [];
  const photos = [];

  // Parse raw_data if it's a string
  const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

  // Common photo field names in Bubble
  const photoFields = ['Photo', 'Photos', 'Picture', 'Pictures', 'Image', 'Images', 'Attachments', 'photo', 'photos', 'image', 'images'];

  for (const field of photoFields) {
    if (data[field]) {
      const value = data[field];
      // Handle array of photos
      if (Array.isArray(value)) {
        value.forEach(v => {
          if (typeof v === 'string' && v.includes('http')) {
            photos.push(v);
          } else if (typeof v === 'string' && v.match(/^\d+x\d+$/)) {
            // Bubble file ID format: timestamp x random
            photos.push(`https://s3.amazonaws.com/appforest_uf/f${v.split('x')[0]}/${v}`);
          }
        });
      }
      // Handle single photo
      else if (typeof value === 'string') {
        if (value.includes('http')) {
          photos.push(value);
        } else if (value.match(/^\d+x\d+$/)) {
          photos.push(`https://s3.amazonaws.com/appforest_uf/f${value.split('x')[0]}/${value}`);
        }
      }
    }
  }

  return photos;
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

// Ticket row - improved responsive
function TicketRow({ ticket, onAssign, onView, userEmail }) {
  const readableData = extractReadableData(ticket.raw_data);
  const createdAt = ticket.bubble_created_at || readableData.createdAt;
  const isOld = getDaysOld(createdAt) > 7;
  const isVeryOld = getDaysOld(createdAt) > 14;
  const isMyTicket = ticket.assigned_to_email?.toLowerCase() === userEmail?.toLowerCase();
  const photos = getTicketPhotos(ticket.raw_data);

  // Get clean display values
  const displayBuilding = readableData.building || getDisplayValue(ticket.building);

  return (
    <div
      className={`p-2 sm:p-3 rounded-lg border transition-all hover:shadow-md cursor-pointer ${
        isVeryOld ? 'bg-red-50 border-red-200' :
        isOld ? 'bg-orange-50 border-orange-200' :
        'bg-white border-gray-200 hover:border-purple-300'
      }`}
      onClick={onView}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Header - mobile optimized */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getPriorityColor(ticket.priority_normalized)}`} />
            <span className="text-xs font-mono text-gray-500">{ticket.ticket_code}</span>
            <span className={`text-xs px-1 sm:px-1.5 py-0.5 rounded border ${getStatusColor(ticket.status_normalized)}`}>
              {getStatusLabel(ticket.status_normalized)}
            </span>
            {isMyTicket && (
              <span className="text-xs px-1 sm:px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                Moi
              </span>
            )}
            {photos.length > 0 && (
              <span className="text-xs px-1 py-0.5 rounded bg-blue-100 text-blue-600 flex items-center gap-0.5">
                <ImageIcon size={10} /> {photos.length}
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-xs sm:text-sm text-gray-800 line-clamp-2 mb-1 sm:mb-2">
            {ticket.description || 'Sans description'}
          </p>

          {/* Meta - mobile optimized - only show non-empty values */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-500">
            {displayBuilding !== '-' && (
              <span className="flex items-center gap-1">
                <Building2 size={10} className="sm:w-3 sm:h-3" />
                {displayBuilding}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} className="sm:w-3 sm:h-3" />
              {formatDate(createdAt)}
              {isOld && <AlertTriangle size={10} className="text-orange-500" />}
            </span>
          </div>
        </div>

        {/* Actions - compact on mobile */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {ticket.status_normalized === 'unassigned' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssign(ticket.bubble_ticket_id);
              }}
              className="p-1 sm:p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg"
              title="M'attribuer"
            >
              <UserPlus size={14} className="sm:w-4 sm:h-4" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(getTicketUrl(ticket.ticket_code), '_blank');
            }}
            className="p-1 sm:p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
            title="Ouvrir dans Haleon Tool"
          >
            <ExternalLink size={14} className="sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Ticket Detail Modal - Full screen on mobile for better interaction
function TicketDetailModal({ ticket, onClose, onAssign, userEmail, onRefresh }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  if (!ticket) return null;

  const ticketUrl = getTicketUrl(ticket.ticket_code);
  const isMyTicket = ticket.assigned_to_email?.toLowerCase() === userEmail?.toLowerCase();
  const photos = getTicketPhotos(ticket.raw_data);
  const canClose = isMyTicket && ticket.status_normalized === 'assigned';

  // Extract readable data from raw_data
  const readableData = extractReadableData(ticket.raw_data);

  // Get clean display values - prefer readable extracted data, then check if stored value is not a Bubble ID
  const displayBuilding = readableData.building || getDisplayValue(ticket.building);
  const displayZone = readableData.zone || getDisplayValue(ticket.zone);
  const displayAssignedTo = readableData.assignedTo || getDisplayValue(ticket.assigned_to_name) || getDisplayValue(ticket.assigned_to_email) || 'Non assigné';
  const displayCreatedBy = readableData.createdBy || getDisplayValue(ticket.created_by_name) || getDisplayValue(ticket.requestor_name) || getDisplayValue(ticket.created_by_email) || getDisplayValue(ticket.requestor_email);

  // Get creation date - try multiple sources
  const createdAt = ticket.bubble_created_at || readableData.createdAt;
  const daysOld = getDaysOld(createdAt);

  const handleAssign = async () => {
    setAssigning(true);
    try {
      const res = await fetch(`/api/haleon-tickets/${ticket.bubble_ticket_id}/assign`, {
        ...getAuthOptions(),
        method: 'POST'
      });
      if (res.ok) {
        onRefresh?.();
        onClose();
      } else {
        const data = await res.json();
        alert('Erreur: ' + (data.error || 'Impossible d\'attribuer'));
      }
    } catch (err) {
      alert('Erreur: ' + err.message);
    } finally {
      setAssigning(false);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      const res = await fetch(`/api/haleon-tickets/${ticket.bubble_ticket_id}/close`, {
        ...getAuthOptions(),
        method: 'POST',
        body: JSON.stringify({ resolution_note: 'Fermé depuis ElectroHub' })
      });
      if (res.ok) {
        onRefresh?.();
        onClose();
      } else {
        const data = await res.json();
        alert('Erreur: ' + (data.error || 'Impossible de fermer'));
      }
    } catch (err) {
      alert('Erreur: ' + err.message);
    } finally {
      setClosing(false);
      setShowCloseConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* Full height on mobile, centered modal on desktop */}
      <div className="relative bg-white w-full h-[95vh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slideUp sm:animate-scaleIn rounded-t-2xl">
        {/* Header - sticky */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-3 border-b bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <Ticket size={20} />
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">{ticket.ticket_code}</h3>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  ticket.priority_normalized === 'urgent' || ticket.priority_normalized === 'safety'
                    ? 'bg-red-400' : 'bg-white/60'
                }`} />
                <span className="text-xs opacity-90">{getPriorityLabel(ticket.priority_normalized)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/20">
                  {getStatusLabel(ticket.status_normalized)}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Quick info bar - only show fields with real values */}
          <div className="grid grid-cols-3 gap-1 p-2 bg-gray-50 border-b text-center text-xs">
            <div>
              <div className="text-gray-500">Bâtiment</div>
              <div className="font-medium truncate">{displayBuilding}</div>
            </div>
            <div>
              <div className="text-gray-500">Zone</div>
              <div className="font-medium truncate">{displayZone}</div>
            </div>
            <div>
              <div className="text-gray-500">Créé</div>
              <div className="font-medium">{formatDate(createdAt)}</div>
            </div>
          </div>

          {/* Description */}
          <div className="p-3 border-b">
            <h4 className="text-xs font-semibold text-gray-500 mb-1">DESCRIPTION</h4>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">
              {ticket.description || 'Aucune description'}
            </p>
          </div>

          {/* Photos */}
          {photos.length > 0 && (
            <div className="p-3 border-b">
              <h4 className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                <ImageIcon size={12} /> PHOTOS ({photos.length})
              </h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map((photo, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedPhoto(photo)}
                    className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 border-gray-200 hover:border-purple-400"
                  >
                    <img
                      src={photo}
                      alt={`Photo ${idx + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23eee" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="12">Erreur</text></svg>'; }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">Équipe</div>
                <div className="text-sm font-medium">{ticket.team_name || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Assigné à</div>
                <div className="text-sm font-medium flex items-center gap-1">
                  {displayAssignedTo}
                  {isMyTicket && <span className="text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-700">Moi</span>}
                </div>
              </div>
            </div>

            {displayCreatedBy && displayCreatedBy !== '-' && (
              <div>
                <div className="text-xs text-gray-500">Demandeur</div>
                <div className="text-sm font-medium">{displayCreatedBy}</div>
              </div>
            )}

            {daysOld > 7 && (
              <div className="flex items-center gap-2 p-2 bg-orange-50 rounded-lg text-orange-700 text-sm">
                <AlertTriangle size={16} />
                <span>Ce ticket a {daysOld} jours</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions - sticky bottom */}
        <div className="sticky bottom-0 p-3 border-t bg-white space-y-2">
          {/* Main actions */}
          <div className="flex gap-2">
            {ticket.status_normalized === 'unassigned' && (
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-purple-600 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {assigning ? <RefreshCw size={18} className="animate-spin" /> : <UserPlus size={18} />}
                {assigning ? 'Attribution...' : 'M\'attribuer ce ticket'}
              </button>
            )}
            {canClose && !showCloseConfirm && (
              <button
                onClick={() => setShowCloseConfirm(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl font-medium"
              >
                <CheckCircle size={18} />
                Fermer le ticket
              </button>
            )}
            {showCloseConfirm && (
              <>
                <button
                  onClick={handleClose}
                  disabled={closing}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {closing ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                  Confirmer
                </button>
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium"
                >
                  Annuler
                </button>
              </>
            )}
          </div>

          {/* External link */}
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-2 text-purple-600 text-sm"
          >
            <ExternalLink size={14} />
            Ouvrir sur haleon-tool.io
          </a>
        </div>
      </div>

      {/* Photo lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-2 bg-black/95"
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 p-2 text-white bg-white/20 rounded-full"
          >
            <X size={24} />
          </button>
          <img
            src={selectedPhoto}
            alt="Photo"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}

      {/* Animation styles */}
      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-scaleIn { animation: scaleIn 0.2s ease-out; }
        .animate-slideUp { animation: slideUp 0.3s ease-out; }
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

  // Auto-sync every 15 minutes + visibility change handling for mobile
  useEffect(() => {
    const SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes
    const BACKGROUND_SYNC_THRESHOLD = 5 * 60 * 1000; // 5 minutes - sync if app was in background this long

    // Track when app went to background
    let backgroundTime = null;

    // Sync function
    const doSync = async (reason = 'scheduled') => {
      console.log(`[HaleonTickets] Auto-sync: starting ${reason} sync`);
      try {
        await fetch('/api/haleon-tickets/sync', {
          ...getAuthOptions(),
          method: 'POST'
        });
        localStorage.setItem('haleon_last_sync', Date.now().toString());
        setLastSync(new Date());
        await loadData();
        console.log(`[HaleonTickets] Auto-sync: ${reason} sync completed`);
      } catch (err) {
        console.error('[HaleonTickets] Auto-sync error:', err);
        // On mobile, still try to load local data on sync failure
        await loadData();
      }
    };

    // Initial sync on mount (if not recently synced)
    const lastSyncTime = localStorage.getItem('haleon_last_sync');
    const now = Date.now();
    const timeSinceLastSync = lastSyncTime ? now - parseInt(lastSyncTime) : SYNC_INTERVAL;

    if (timeSinceLastSync >= SYNC_INTERVAL) {
      doSync('initial');
    } else {
      // Even if we don't sync, load data from cache
      loadData();
    }

    // Set up interval for regular syncs
    const intervalId = setInterval(() => doSync('scheduled'), SYNC_INTERVAL);

    // Handle visibility change (mobile app going to background/foreground)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // App went to background
        backgroundTime = Date.now();
        console.log('[HaleonTickets] App went to background');
      } else {
        // App came back to foreground
        console.log('[HaleonTickets] App came back to foreground');
        if (backgroundTime) {
          const timeInBackground = Date.now() - backgroundTime;
          console.log(`[HaleonTickets] Was in background for ${Math.round(timeInBackground / 1000)}s`);

          // If app was in background for more than 5 minutes, sync
          if (timeInBackground >= BACKGROUND_SYNC_THRESHOLD) {
            doSync('visibility-change');
          } else {
            // Just reload data without full sync
            loadData();
          }
        }
        backgroundTime = null;
      }
    };

    // Handle page show (iOS Safari, mobile browsers)
    const handlePageShow = (event) => {
      if (event.persisted) {
        // Page was restored from bfcache (back-forward cache)
        console.log('[HaleonTickets] Page restored from cache, reloading data');
        loadData();

        // Check if we need a full sync
        const lastSync = localStorage.getItem('haleon_last_sync');
        if (lastSync && Date.now() - parseInt(lastSync) >= BACKGROUND_SYNC_THRESHOLD) {
          doSync('page-restore');
        }
      }
    };

    // Handle focus (when switching tabs/apps)
    const handleFocus = () => {
      console.log('[HaleonTickets] Window focused, checking for updates');
      const lastSync = localStorage.getItem('haleon_last_sync');
      if (lastSync && Date.now() - parseInt(lastSync) >= BACKGROUND_SYNC_THRESHOLD) {
        doSync('focus');
      } else {
        loadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadData]); // Include loadData in deps

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
          onRefresh={loadData}
        />
      )}
    </div>
  );
}
