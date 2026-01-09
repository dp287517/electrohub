// SharedTroubleshootingView.jsx - Public read-only view for shared troubleshooting
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Wrench, Calendar, Building2, MapPin, AlertTriangle,
  CheckCircle, Clock, Zap, Image, X, Eye, Share2, Lock
} from 'lucide-react';
import MiniEquipmentPreview from '../components/AIAvatar/MiniEquipmentPreview';

// ============================================================
// SEVERITY & STATUS CONFIGS
// ============================================================
const SEVERITY_CONFIG = {
  critical: { label: 'Critique', bg: 'bg-red-100', text: 'text-red-700' },
  major: { label: 'Majeur', bg: 'bg-orange-100', text: 'text-orange-700' },
  minor: { label: 'Mineur', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  cosmetic: { label: 'Cosmétique', bg: 'bg-gray-100', text: 'text-gray-700' }
};

const STATUS_CONFIG = {
  open: { label: 'Ouvert', icon: AlertTriangle, bg: 'bg-red-100', text: 'text-red-700' },
  in_progress: { label: 'En cours', icon: Clock, bg: 'bg-orange-100', text: 'text-orange-700' },
  resolved: { label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  completed: { label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  closed: { label: 'Clôturé', icon: Lock, bg: 'bg-gray-100', text: 'text-gray-700' }
};

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
// BADGES
// ============================================================
function SeverityBadge({ severity }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.cosmetic;
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.in_progress;
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
// PHOTO GALLERY (READ-ONLY)
// ============================================================
function PhotoGallery({ photos }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const photoTypeLabels = {
    before: 'Avant',
    during: 'Pendant',
    after: 'Après'
  };

  if (!photos || photos.length === 0) {
    return (
      <div className="text-gray-500 text-sm italic py-4 text-center">
        Aucune photo disponible
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <div key={photo.id || idx} className="relative group">
            <img
              src={photo.photo_data}
              alt={photo.caption || `Photo ${idx + 1}`}
              className="w-full h-32 object-cover rounded-lg border border-gray-200 cursor-pointer hover:border-blue-400 transition-colors"
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
          {selectedPhoto.caption && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black/50 px-4 py-2 rounded-lg">
              {selectedPhoto.caption}
            </p>
          )}
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

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Chargement du dépannage...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
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
    );
  }

  if (!record) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Share2 size={24} />
            <div>
              <h1 className="font-semibold">Dépannage partagé</h1>
              <p className="text-sm text-blue-100">Vue en lecture seule</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-blue-100">
            <Eye size={16} />
            <span>{shareInfo?.viewCount || 1} vue(s)</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Main Info Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Equipment Header */}
          <div className="bg-gradient-to-r from-gray-50 to-white p-6 border-b border-gray-100">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {record.equipment_name || record.equipment_code || 'Équipement'}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  {record.equipment_type && <EquipmentTypeBadge type={record.equipment_type} />}
                  {record.building_code && (
                    <span className="flex items-center gap-1">
                      <Building2 size={14} />
                      {record.building_code}
                    </span>
                  )}
                  {record.floor && <span>• Étage {record.floor}</span>}
                  {record.zone && <span>• {record.zone}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <SeverityBadge severity={record.severity} />
                <StatusBadge status={record.status} />
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="p-6 space-y-6">
            {/* Title & Description */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <Wrench size={18} className="text-orange-500" />
                {record.title || 'Description du problème'}
              </h3>
              {record.description && (
                <p className="text-gray-700 whitespace-pre-wrap">{record.description}</p>
              )}
            </div>

            {/* Root Cause */}
            {record.root_cause && (
              <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg">
                <h4 className="font-semibold text-amber-800 mb-1">Cause identifiée</h4>
                <p className="text-amber-700">{record.root_cause}</p>
              </div>
            )}

            {/* Solution */}
            {record.solution && (
              <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-r-lg">
                <h4 className="font-semibold text-green-800 mb-1">Solution appliquée</h4>
                <p className="text-green-700">{record.solution}</p>
              </div>
            )}

            {/* Metadata */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
              <div>
                <span className="text-xs text-gray-500 uppercase">Créé le</span>
                <p className="text-sm font-medium text-gray-900">{formatDate(record.created_at)}</p>
              </div>
              {record.resolved_at && (
                <div>
                  <span className="text-xs text-gray-500 uppercase">Résolu le</span>
                  <p className="text-sm font-medium text-gray-900">{formatDate(record.resolved_at)}</p>
                </div>
              )}
              {record.downtime_minutes > 0 && (
                <div>
                  <span className="text-xs text-gray-500 uppercase">Temps d'arrêt</span>
                  <p className="text-sm font-medium text-red-600">{record.downtime_minutes} min</p>
                </div>
              )}
              {record.duration_minutes > 0 && (
                <div>
                  <span className="text-xs text-gray-500 uppercase">Durée intervention</span>
                  <p className="text-sm font-medium text-gray-900">{record.duration_minutes} min</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Image size={18} className="text-orange-500" />
            Photos ({photos.length})
          </h3>
          <PhotoGallery photos={photos} />
        </div>

        {/* Mini Map */}
        {record.equipment_id && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin size={18} className="text-blue-500" />
              Localisation sur le plan
            </h3>
            <div className="rounded-xl overflow-hidden border border-gray-200">
              <MiniEquipmentPreview
                equipmentId={record.equipment_id}
                equipmentType={record.equipment_type}
                equipmentCode={record.equipment_code}
                buildingCode={record.building_code}
              />
            </div>
          </div>
        )}

        {/* Share Info Footer */}
        <div className="text-center text-sm text-gray-500 py-4">
          <p>Partagé par <strong>{shareInfo?.createdBy}</strong></p>
          <p className="mt-1">
            Ce lien est valide pour consultation uniquement.
          </p>
        </div>
      </div>
    </div>
  );
}
