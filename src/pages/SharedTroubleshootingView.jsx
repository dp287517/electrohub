// SharedTroubleshootingView.jsx - Public read-only view for shared troubleshooting
// Structure matches TroubleshootingDetail.jsx for consistency
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Wrench, Calendar, Building2, Users, MapPin, AlertTriangle,
  CheckCircle, Clock, Zap, Image, FileText, X, Eye, Share2, Lock
} from 'lucide-react';
import SharedMapPreview from '../components/SharedMapPreview';

// ============================================================
// SEVERITY & STATUS CONFIGS (same as TroubleshootingDetail)
// ============================================================
const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critique', bg: 'bg-red-100', text: 'text-red-700' },
  { value: 'major', label: 'Majeur', bg: 'bg-orange-100', text: 'text-orange-700' },
  { value: 'minor', label: 'Mineur', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  { value: 'cosmetic', label: 'Cosmétique', bg: 'bg-gray-100', text: 'text-gray-700' }
];

const STATUS_OPTIONS = [
  { value: 'open', label: 'Ouvert', icon: AlertTriangle, bg: 'bg-red-100', text: 'text-red-700' },
  { value: 'in_progress', label: 'En cours', icon: Clock, bg: 'bg-orange-100', text: 'text-orange-700' },
  { value: 'resolved', label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  { value: 'completed', label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  { value: 'closed', label: 'Clôturé', icon: Lock, bg: 'bg-gray-100', text: 'text-gray-700' },
  { value: 'pending_review', label: 'En attente', icon: Clock, bg: 'bg-gray-100', text: 'text-gray-700' }
];

const EQUIPMENT_TYPE_CONFIG = {
  switchboard: { label: 'Tableau électrique', icon: Zap, color: 'text-amber-600 bg-amber-50' },
  vsd: { label: 'Variateur VSD', icon: Zap, color: 'text-green-600 bg-green-50' },
  meca: { label: 'Équipement mécanique', icon: Wrench, color: 'text-orange-600 bg-orange-50' },
  hv: { label: 'Haute Tension', icon: Zap, color: 'text-yellow-600 bg-yellow-50' },
  glo: { label: 'Éclairage GLO', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
  mobile: { label: 'Équipement mobile', icon: Zap, color: 'text-cyan-600 bg-cyan-50' },
  datahub: { label: 'Datahub', icon: Zap, color: 'text-purple-600 bg-purple-50' },
  atex: { label: 'Zone ATEX', icon: Zap, color: 'text-purple-600 bg-purple-50' },
  infrastructure: { label: 'Infrastructure', icon: Zap, color: 'text-violet-600 bg-violet-50' },
  firecontrol: { label: 'Sécurité incendie', icon: Zap, color: 'text-red-600 bg-red-50' },
  doors: { label: 'Portes', icon: Zap, color: 'text-blue-600 bg-blue-50' }
};

// ============================================================
// BADGES (same as TroubleshootingDetail)
// ============================================================
function SeverityBadge({ severity }) {
  const config = SEVERITY_OPTIONS.find(s => s.value === severity) || SEVERITY_OPTIONS[3];
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const config = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[1];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
      <Icon size={14} />
      {config.label}
    </span>
  );
}

function EquipmentTypeBadge({ type }) {
  const config = EQUIPMENT_TYPE_CONFIG[type] || { label: type, icon: Wrench, color: 'text-gray-600 bg-gray-50' };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>
      <Icon size={14} />
      {config.label}
    </span>
  );
}

// ============================================================
// PHOTO GALLERY (READ-ONLY, same style as TroubleshootingDetail)
// ============================================================
function PhotoGallery({ photos }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const photoTypeLabels = {
    before: 'Avant',
    during: 'Pendant',
    after: 'Après'
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Image size={16} className="text-orange-500" />
          Photos ({photos.length})
        </h3>
      </div>

      {photos.length === 0 && (
        <p className="text-gray-500 text-sm italic">Aucune photo</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <div key={photo.id || idx} className="relative group">
            <img
              src={photo.photo_data}
              alt={photo.caption || `Photo ${idx + 1}`}
              className="w-full h-32 object-cover rounded-lg border border-gray-200 cursor-pointer group-hover:border-orange-400 transition-colors"
              onClick={() => setSelectedPhoto(photo)}
            />
            {photo.photo_type && (
              <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded">
                {photoTypeLabels[photo.photo_type] || photo.photo_type}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
            onClick={() => setSelectedPhoto(null)}
          >
            <X size={24} />
          </button>
          <img
            src={selectedPhoto.photo_data}
            alt={selectedPhoto.caption || 'Photo'}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function SharedTroubleshootingView() {
  const { token } = useParams();
  const [record, setRecord] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [shareInfo, setShareInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSharedData();
  }, [token]);

  const loadSharedData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sendgrid/shared/${token}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Lien invalide ou expiré');
      }

      setRecord(data.record);
      setPhotos(data.photos || []);
      setShareInfo(data.shareInfo);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement du dépannage...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Lien invalide</h1>
            <p className="text-gray-600 mb-6">{error}</p>
            <p className="text-sm text-gray-500">
              Ce lien de partage a peut-être expiré ou n'existe plus.
            </p>
          </div>
        </div>
        {/* Footer */}
        <footer className="bg-gray-900 text-gray-400 py-6 text-center text-sm">
          <p>© {new Date().getFullYear()} Haleon-tool - Daniel Palha - Tous droits réservés</p>
        </footer>
      </div>
    );
  }

  if (!record) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header - Same style as TroubleshootingDetail (black theme) */}
      <div className="bg-gradient-to-r from-slate-800 via-slate-900 to-black text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
          {/* Shared indicator */}
          <div className="flex items-center gap-2 text-white/80 mb-3 sm:mb-4">
            <Share2 size={16} />
            <span className="text-xs sm:text-sm">Dépannage partagé - Vue en lecture seule</span>
            <span className="ml-auto flex items-center gap-1 text-xs sm:text-sm">
              <Eye size={14} />
              {shareInfo?.viewCount || 1} vue(s)
            </span>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="flex-shrink-0 p-2.5 sm:p-3 bg-white/20 rounded-xl">
                <Wrench size={22} className="sm:w-7 sm:h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold leading-tight line-clamp-2">{record.title}</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 sm:mt-2 text-white/80 text-xs sm:text-sm">
                  <span className="flex items-center gap-1">
                    <Calendar size={14} className="sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">
                      {new Date(record.created_at).toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </span>
                    <span className="sm:hidden">
                      {new Date(record.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                  </span>
                  {record.technician_name && (
                    <span className="flex items-center gap-1">
                      <Users size={14} className="sm:w-4 sm:h-4" />
                      {record.technician_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content - Same 2-column layout as TroubleshootingDetail */}
      <div className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText size={18} className="text-orange-500" />
                Description du problème
              </h2>
              <p className="text-gray-700 whitespace-pre-wrap">
                {record.description || <span className="italic text-gray-400">Aucune description</span>}
              </p>

              {/* Root Cause */}
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-2">Cause identifiée</h3>
                <p className="text-gray-700">
                  {record.root_cause || <span className="italic text-gray-400">Non renseignée</span>}
                </p>
              </div>

              {/* Solution */}
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-500" />
                  Solution appliquée
                </h3>
                <p className="text-gray-700">
                  {record.solution || <span className="italic text-gray-400">Non renseignée</span>}
                </p>
              </div>

              {/* Parts replaced */}
              {record.parts_replaced && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-gray-900 mb-2">Pièces remplacées</h3>
                  <p className="text-gray-700">{record.parts_replaced}</p>
                </div>
              )}
            </div>

            {/* Mini Plan - Uses public API with share token validation */}
            {record.equipment_type && (record.equipment_id || record.equipment_original_id) && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <MapPin size={18} className="text-orange-500" />
                  Localisation sur plan
                </h2>
                <SharedMapPreview shareToken={token} />
              </div>
            )}

            {/* Photos */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <PhotoGallery photos={photos} />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status & Severity */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Statut</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={record.status} />
                <SeverityBadge severity={record.severity} />
              </div>
              {record.category && (
                <div className="mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-500">Catégorie</span>
                  <p className="font-medium text-gray-900 capitalize">{record.category}</p>
                </div>
              )}
            </div>

            {/* Equipment Info */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Zap size={16} className="text-orange-500" />
                Équipement
              </h3>
              <div className="space-y-3">
                <EquipmentTypeBadge type={record.equipment_type} />
                {record.equipment_name && (
                  <div>
                    <span className="text-sm text-gray-500">Nom</span>
                    <p className="font-medium text-gray-900">{record.equipment_name}</p>
                  </div>
                )}
                {record.equipment_code && (
                  <div>
                    <span className="text-sm text-gray-500">Code</span>
                    <p className="font-medium text-gray-900 font-mono">{record.equipment_code}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            {(record.building_code || record.floor || record.zone) && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Building2 size={16} className="text-orange-500" />
                  Localisation
                </h3>
                <div className="space-y-3">
                  {record.building_code && (
                    <div>
                      <span className="text-sm text-gray-500">Bâtiment</span>
                      <p className="font-medium text-gray-900">{record.building_code}</p>
                    </div>
                  )}
                  {record.floor && (
                    <div>
                      <span className="text-sm text-gray-500">Étage</span>
                      <p className="font-medium text-gray-900">{record.floor}</p>
                    </div>
                  )}
                  {record.zone && (
                    <div>
                      <span className="text-sm text-gray-500">Zone</span>
                      <p className="font-medium text-gray-900">{record.zone}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Time Tracking */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Clock size={16} className="text-orange-500" />
                Temps
              </h3>
              <div className="space-y-3">
                {record.started_at && (
                  <div>
                    <span className="text-sm text-gray-500">Début</span>
                    <p className="font-medium text-gray-900">
                      {new Date(record.started_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                )}
                {record.completed_at && (
                  <div>
                    <span className="text-sm text-gray-500">Fin</span>
                    <p className="font-medium text-gray-900">
                      {new Date(record.completed_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                )}
                {record.duration_minutes && (
                  <div>
                    <span className="text-sm text-gray-500">Durée intervention</span>
                    <p className="font-medium text-gray-900">{record.duration_minutes} minutes</p>
                  </div>
                )}
                {record.downtime_minutes && (
                  <div className="pt-3 border-t">
                    <span className="text-sm text-red-500">Temps d'arrêt</span>
                    <p className="font-bold text-red-600 text-lg">{record.downtime_minutes} minutes</p>
                  </div>
                )}
              </div>
            </div>

            {/* Technician */}
            {record.technician_name && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users size={16} className="text-orange-500" />
                  Technicien
                </h3>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold">
                    {record.technician_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{record.technician_name}</p>
                    {record.technician_email && (
                      <p className="text-sm text-gray-500">{record.technician_email}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Share Info */}
            {shareInfo?.createdBy && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
                <p className="text-sm text-blue-700">
                  Partagé par <strong>{shareInfo.createdBy}</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer with copyright */}
      <footer className="bg-gray-900 text-gray-400 py-6 text-center text-sm mt-auto">
        <p>© {new Date().getFullYear()} Haleon-tool - Daniel Palha - Tous droits réservés</p>
      </footer>
    </div>
  );
}
