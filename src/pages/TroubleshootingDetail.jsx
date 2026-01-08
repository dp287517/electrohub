// TroubleshootingDetail.jsx - Page de détail d'un dépannage avec mode édition
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Wrench, Calendar, Building2, Users, MapPin, AlertTriangle,
  CheckCircle, Clock, ArrowLeft, Zap, Image, FileText,
  Sparkles, Edit, Trash2, Loader2, X, Save, Plus, Camera
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
// SEVERITY & STATUS CONFIGS
// ============================================================
const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critique', bg: 'bg-red-100', text: 'text-red-700' },
  { value: 'major', label: 'Majeur', bg: 'bg-orange-100', text: 'text-orange-700' },
  { value: 'minor', label: 'Mineur', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  { value: 'cosmetic', label: 'Cosmétique', bg: 'bg-gray-100', text: 'text-gray-700' }
];

const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'En cours', icon: Clock, bg: 'bg-orange-100', text: 'text-orange-700' },
  { value: 'completed', label: 'Résolu', icon: CheckCircle, bg: 'bg-green-100', text: 'text-green-700' },
  { value: 'pending_review', label: 'En attente', icon: Clock, bg: 'bg-gray-100', text: 'text-gray-700' }
];

const CATEGORY_OPTIONS = [
  { value: 'electrical', label: 'Électrique' },
  { value: 'mechanical', label: 'Mécanique' },
  { value: 'software', label: 'Logiciel' },
  { value: 'other', label: 'Autre' }
];

// ============================================================
// BADGES
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
  const config = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[2];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
      <Icon size={14} />
      {config.label}
    </span>
  );
}

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
// PHOTO GALLERY WITH EDIT
// ============================================================
function PhotoGallery({ photos, editMode, onAddPhoto, onDeletePhoto }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const fileInputRef = useRef(null);

  const photoTypeLabels = {
    before: 'Avant',
    during: 'Pendant',
    after: 'Après'
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onAddPhoto({
          photo_data: event.target.result,
          photo_type: 'after',
          caption: ''
        });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Image size={16} className="text-orange-500" />
          Photos ({photos.length})
        </h3>
        {editMode && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 transition-colors"
          >
            <Plus size={16} />
            Ajouter
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {photos.length === 0 && !editMode && (
        <p className="text-gray-500 text-sm italic">Aucune photo</p>
      )}

      {photos.length === 0 && editMode && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-orange-400 hover:text-orange-500 transition-colors cursor-pointer"
        >
          <Camera size={32} />
          <span className="text-sm">Cliquez pour ajouter des photos</span>
        </button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <div
            key={photo.id || idx}
            className="relative group"
          >
            <img
              src={photo.photo_data}
              alt={photo.caption || `Photo ${idx + 1}`}
              className="w-full h-32 object-cover rounded-lg border border-gray-200 cursor-pointer group-hover:border-orange-400 transition-colors"
              onClick={() => !editMode && setSelectedPhoto(photo)}
            />
            {photo.photo_type && (
              <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded">
                {photoTypeLabels[photo.photo_type] || photo.photo_type}
              </span>
            )}
            {editMode && (
              <button
                onClick={() => onDeletePhoto(idx)}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={14} />
              </button>
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
export default function TroubleshootingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [newPhotos, setNewPhotos] = useState([]);

  useEffect(() => {
    loadRecord();
  }, [id]);

  const loadRecord = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await get(`/api/troubleshooting/${id}`);
      if (response?.record) {
        setRecord(response.record);
        setPhotos(response.photos || []);
        setEditData(response.record);
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

  const handleSave = async () => {
    setSaving(true);
    try {
      // Auto-correct text with AI before saving
      let dataToSave = { ...editData };
      if (editData.title || editData.description || editData.root_cause || editData.solution) {
        try {
          const improveResponse = await fetch(`${API_BASE}/api/ai-assistant/improve-troubleshooting-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              title: editData.title,
              description: editData.description,
              root_cause: editData.root_cause,
              solution: editData.solution
            })
          });
          const improveData = await improveResponse.json();
          if (improveData?.success && improveData?.improved) {
            dataToSave = {
              ...dataToSave,
              title: improveData.improved.title || dataToSave.title,
              description: improveData.improved.description || dataToSave.description,
              root_cause: improveData.improved.root_cause || dataToSave.root_cause,
              solution: improveData.improved.solution || dataToSave.solution
            };
          }
        } catch (improveError) {
          console.error('Text improvement error:', improveError);
          // Continue with original text if improvement fails
        }
      }

      // Update record
      const response = await fetch(`${API_BASE}/api/troubleshooting/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dataToSave)
      });

      if (!response.ok) throw new Error('Erreur de sauvegarde');

      // Add new photos
      for (const photo of newPhotos) {
        await fetch(`${API_BASE}/api/troubleshooting/${id}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(photo)
        });
      }

      setNewPhotos([]);
      await loadRecord();
      setEditMode(false);
    } catch (e) {
      console.error('Save error:', e);
      alert('Erreur lors de la sauvegarde: ' + e.message);
    } finally {
      setSaving(false);
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

  const handleAddPhoto = (photo) => {
    setNewPhotos([...newPhotos, photo]);
  };

  const handleDeletePhoto = async (idx) => {
    const allPhotos = [...photos, ...newPhotos];
    const photo = allPhotos[idx];

    if (idx < photos.length) {
      // Delete existing photo
      try {
        await fetch(`${API_BASE}/api/troubleshooting/${id}/photos/${photo.id}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        setPhotos(photos.filter((_, i) => i !== idx));
      } catch (e) {
        console.error('Delete photo error:', e);
      }
    } else {
      // Remove new photo
      setNewPhotos(newPhotos.filter((_, i) => i !== (idx - photos.length)));
    }
  };

  const updateField = (field, value) => {
    setEditData({ ...editData, [field]: value });
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
  const displayData = editMode ? editData : record;
  const allPhotos = [...photos, ...newPhotos];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`${editMode ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500' : 'bg-gradient-to-r from-orange-500 via-red-500 to-pink-500'} text-white`}>
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
                {editMode ? (
                  <input
                    type="text"
                    value={editData.title || ''}
                    onChange={(e) => updateField('title', e.target.value)}
                    className="text-2xl sm:text-3xl font-bold bg-white/20 rounded-lg px-3 py-1 w-full text-white placeholder-white/60"
                    placeholder="Titre du dépannage"
                  />
                ) : (
                  <h1 className="text-2xl sm:text-3xl font-bold">{record.title}</h1>
                )}
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
                {editMode ? (
                  <>
                    <button
                      onClick={() => { setEditMode(false); setEditData(record); setNewPhotos([]); }}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-600 rounded-lg hover:bg-white/90 transition-colors disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                      Enregistrer
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditMode(true)}
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                      title="Modifier"
                    >
                      <Edit size={20} />
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="p-2 bg-white/10 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
                      title="Supprimer"
                    >
                      {deleting ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
                    </button>
                  </>
                )}
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
              {editMode ? (
                <textarea
                  value={editData.description || ''}
                  onChange={(e) => updateField('description', e.target.value)}
                  className="w-full h-32 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  placeholder="Décrivez le problème..."
                />
              ) : (
                <p className="text-gray-700 whitespace-pre-wrap">{record.description || <span className="italic text-gray-400">Aucune description</span>}</p>
              )}

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-2">Cause identifiée</h3>
                {editMode ? (
                  <textarea
                    value={editData.root_cause || ''}
                    onChange={(e) => updateField('root_cause', e.target.value)}
                    className="w-full h-24 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Cause du problème..."
                  />
                ) : (
                  <p className="text-gray-700">{record.root_cause || <span className="italic text-gray-400">Non renseignée</span>}</p>
                )}
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-500" />
                  Solution appliquée
                </h3>
                {editMode ? (
                  <textarea
                    value={editData.solution || ''}
                    onChange={(e) => updateField('solution', e.target.value)}
                    className="w-full h-24 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Solution mise en place..."
                  />
                ) : (
                  <p className="text-gray-700">{record.solution || <span className="italic text-gray-400">Non renseignée</span>}</p>
                )}
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-medium text-gray-900 mb-2">Pièces remplacées</h3>
                {editMode ? (
                  <textarea
                    value={editData.parts_replaced || ''}
                    onChange={(e) => updateField('parts_replaced', e.target.value)}
                    className="w-full h-20 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Liste des pièces remplacées..."
                  />
                ) : (
                  <p className="text-gray-700">{record.parts_replaced || <span className="italic text-gray-400">Aucune</span>}</p>
                )}
              </div>
            </div>

            {/* AI Analysis */}
            {(record.ai_diagnosis || record.ai_recommendations) && !editMode && (
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
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <PhotoGallery
                photos={allPhotos}
                editMode={editMode}
                onAddPhoto={handleAddPhoto}
                onDeletePhoto={handleDeletePhoto}
              />
            </div>

            {/* Mini Plan */}
            {record.equipment_type && record.equipment_id && !editMode && (
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

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Status & Severity */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Statut</h3>
              {editMode ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-500 block mb-1">Statut</label>
                    <select
                      value={editData.status || 'in_progress'}
                      onChange={(e) => updateField('status', e.target.value)}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500 block mb-1">Sévérité</label>
                    <select
                      value={editData.severity || 'minor'}
                      onChange={(e) => updateField('severity', e.target.value)}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      {SEVERITY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-500 block mb-1">Catégorie</label>
                    <select
                      value={editData.category || ''}
                      onChange={(e) => updateField('category', e.target.value)}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">-- Sélectionner --</option>
                      {CATEGORY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <>
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
                </>
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
              {editMode ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-500 block mb-1">Durée intervention (min)</label>
                    <input
                      type="number"
                      value={editData.duration_minutes || ''}
                      onChange={(e) => updateField('duration_minutes', parseInt(e.target.value) || null)}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="Ex: 45"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-500 block mb-1">Temps d'arrêt (min)</label>
                    <input
                      type="number"
                      value={editData.downtime_minutes || ''}
                      onChange={(e) => updateField('downtime_minutes', parseInt(e.target.value) || null)}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="Ex: 120"
                    />
                  </div>
                </div>
              ) : (
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
              )}
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
