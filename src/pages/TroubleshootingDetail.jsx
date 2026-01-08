// TroubleshootingDetail.jsx - Page de détail d'un dépannage (accessible via email)
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Wrench, Calendar, Building2, Users, MapPin, AlertTriangle,
  CheckCircle, Clock, ArrowLeft, Zap, Image, FileText,
  Sparkles, Edit, Trash2, Loader2, X
} from 'lucide-react';
import { get, API_BASE } from '../lib/api';
import { getUserPermissions } from '../lib/permissions';
import MiniEquipmentPreview from '../components/AIAvatar/MiniEquipmentPreview';

// Get current user email from localStorage
function getCurrentUserEmail() {
  try {
    const ehUser = localStorage.getItem('eh_user');
    if (ehUser) {
      const user = JSON.parse(ehUser);
      if (user?.email) return user.email.toLowerCase();
    }
    const email = localStorage.getItem('email') || localStorage.getItem('user.email');
    if (email) return email.toLowerCase();
  } catch (e) {}
  return null;
}

// Check if current user can edit/delete
function canModifyTroubleshooting(record) {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return false;
  const permissions = getUserPermissions(currentEmail);
  if (permissions?.isAdmin) return true;
  const creatorEmail = record?.technician_email?.toLowerCase();
  return creatorEmail && creatorEmail === currentEmail;
}

// ============================================================
// SEVERITY BADGE
// ============================================================
function SeverityBadge({ severity }) {
  const config = {
    critical: { label: 'Critique', bg: 'bg-red-100', text: 'text-red-700' },
    major: { label: 'Majeur', bg: 'bg-orange-100', text: 'text-orange-700' },
    minor: { label: 'Mineur', bg: 'bg-yellow-100', text: 'text-yellow-700' },
    cosmetic: { label: 'Cosmétique', bg: 'bg-gray-100', text: 'text-gray-700' }
  };
  const { label, bg, text } = config[severity] || config.cosmetic;
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

// ============================================================
// STATUS BADGE
// ============================================================
function StatusBadge({ status }) {
  const config = {
    completed: { label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
    in_progress: { label: 'En cours', icon: Clock, bg: 'bg-orange-100', text: 'text-orange-700' },
    pending_review: { label: 'En attente', icon: Clock, bg: 'bg-gray-100', text: 'text-gray-700' }
  };
  const { label, icon: Icon, bg, text } = config[status] || config.pending_review;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${bg} ${text}`}>
      <Icon size={14} />
      {label}
    </span>
  );
}

// ============================================================
// EQUIPMENT TYPE BADGE
// ============================================================
function EquipmentTypeBadge({ type }) {
  const config = {
    switchboard: { label: 'Tableau électrique', icon: Zap, color: 'text-amber-600 bg-amber-50' },
    vsd: { label: 'Variateur VSD', icon: Zap, color: 'text-green-600 bg-green-50' },
    meca: { label: 'Équipement mécanique', icon: Wrench, color: 'text-orange-600 bg-orange-50' },
    hv: { label: 'Haute Tension', icon: Zap, color: 'text-yellow-600 bg-yellow-50' },
    glo: { label: 'Éclairage GLO', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
    mobile: { label: 'Équipement mobile', icon: Zap, color: 'text-cyan-600 bg-cyan-50' },
    datahub: { label: 'Datahub', icon: Zap, color: 'text-purple-600 bg-purple-50' },
    atex: { label: 'Zone ATEX', icon: Zap, color: 'text-purple-600 bg-purple-50' },
    infrastructure: { label: 'Infrastructure', icon: Zap, color: 'text-violet-600 bg-violet-50' }
  };
  const { label, icon: Icon, color } = config[type] || { label: type, icon: Wrench, color: 'text-gray-600 bg-gray-50' };
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      <Icon size={14} />
      {label}
    </span>
  );
}

// ============================================================
// PHOTO GALLERY
// ============================================================
function PhotoGallery({ photos }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  if (!photos || photos.length === 0) return null;

  const photoTypeLabels = {
    before: 'Avant',
    during: 'Pendant',
    after: 'Après'
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Image size={16} className="text-orange-500" />
        Photos ({photos.length})
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <div
            key={photo.id || idx}
            className="relative group cursor-pointer"
            onClick={() => setSelectedPhoto(photo)}
          >
            <img
              src={photo.photo_data}
              alt={photo.caption || `Photo ${idx + 1}`}
              className="w-full h-32 object-cover rounded-lg border border-gray-200 group-hover:border-orange-400 transition-colors"
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
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 text-white rounded-lg">
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
export default function TroubleshootingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadRecord();
  }, [id]);

  const loadRecord = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await get(`/api/troubleshooting/${id}`);
      if (response) {
        setRecord(response);
        setPhotos(response.photos || []);
      } else {
        setError('Dépannage non trouvé');
      }
    } catch (e) {
      console.error('Load error:', e);
      setError('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer ce dépannage ?\n\nCette action est irréversible.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/api/troubleshooting/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        navigate('/app/troubleshooting');
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (e) {
      console.error('Delete error:', e);
      alert('Erreur: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Chargement du dépannage...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !record) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Dépannage non trouvé</h1>
          <p className="text-gray-600 mb-6">{error || "Ce dépannage n'existe pas ou a été supprimé."}</p>
          <Link
            to="/app/troubleshooting"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            <ArrowLeft size={18} />
            Retour aux dépannages
          </Link>
        </div>
      </div>
    );
  }

  const canModify = canModifyTroubleshooting(record);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Link
            to="/app/troubleshooting"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={18} />
            Retour aux dépannages
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-white/20 rounded-xl">
                <Wrench size={28} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">{record.title}</h1>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-white/80">
                  <span className="flex items-center gap-1">
                    <Calendar size={16} />
                    {new Date(record.created_at).toLocaleDateString('fr-FR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={16} />
                    {record.technician_name}
                  </span>
                </div>
              </div>
            </div>

            {canModify && (
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="p-2 bg-white/10 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
                  title="Supprimer"
                >
                  {deleting ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText size={18} className="text-orange-500" />
                Description du problème
              </h2>
              <p className="text-gray-700 whitespace-pre-wrap">{record.description}</p>

              {record.root_cause && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-gray-900 mb-2">Cause identifiée</h3>
                  <p className="text-gray-700">{record.root_cause}</p>
                </div>
              )}

              {record.solution && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <CheckCircle size={16} className="text-green-500" />
                    Solution appliquée
                  </h3>
                  <p className="text-gray-700">{record.solution}</p>
                </div>
              )}

              {record.parts_replaced && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="font-medium text-gray-900 mb-2">Pièces remplacées</h3>
                  <p className="text-gray-700">{record.parts_replaced}</p>
                </div>
              )}
            </div>

            {/* AI Analysis */}
            {(record.ai_diagnosis || record.ai_recommendations) && (
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl shadow-sm border border-purple-100 p-6">
                <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Sparkles size={18} className="text-purple-500" />
                  Analyse IA
                </h2>

                {record.ai_diagnosis && (
                  <div className="mb-4">
                    <h3 className="font-medium text-gray-900 mb-2">Diagnostic</h3>
                    <p className="text-gray-700">{record.ai_diagnosis}</p>
                  </div>
                )}

                {record.ai_recommendations && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Recommandations</h3>
                    <p className="text-gray-700">{record.ai_recommendations}</p>
                  </div>
                )}
              </div>
            )}

            {/* Photos */}
            {photos.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <PhotoGallery photos={photos} />
              </div>
            )}

            {/* Mini Plan */}
            {record.equipment_type && record.equipment_id && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <MapPin size={18} className="text-orange-500" />
                  Localisation sur plan
                </h2>
                <MiniEquipmentPreview
                  equipmentType={record.equipment_type}
                  equipmentId={record.equipment_id}
                />
              </div>
            )}
          </div>

          {/* Sidebar - 1 column */}
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

              {record.fault_type && (
                <div className="mt-3">
                  <span className="text-sm text-gray-500">Type de panne</span>
                  <p className="font-medium text-gray-900 capitalize">{record.fault_type}</p>
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

                  {record.room && (
                    <div>
                      <span className="text-sm text-gray-500">Local</span>
                      <p className="font-medium text-gray-900">{record.room}</p>
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
          </div>
        </div>
      </div>
    </div>
  );
}
