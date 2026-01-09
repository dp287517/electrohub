// TroubleshootingDashboard - Page de gestion des rapports de dépannage
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Wrench, Download, Search, Calendar, Building2, Layers,
  Filter, X, ChevronRight, ChevronDown, AlertTriangle,
  CheckCircle, Clock, BarChart3, TrendingUp, FileText,
  Zap, MapPin, RefreshCw, Sparkles, Eye, Image, Users, Trash2, Loader2
} from 'lucide-react';
import { get, API_BASE } from '../lib/api';
import MiniEquipmentPreview from '../components/AIAvatar/MiniEquipmentPreview';
import { getUserPermissions, ADMIN_EMAILS } from '../lib/permissions';

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

// Check if current user can delete a troubleshooting record
function canDeleteTroubleshooting(record) {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return false;

  // Admin can delete any record
  const permissions = getUserPermissions(currentEmail);
  if (permissions?.isAdmin) return true;

  // Creator can delete their own record
  const creatorEmail = record?.technician_email?.toLowerCase();
  return creatorEmail && creatorEmail === currentEmail;
}

// ============================================================
// ANIMATION STYLES
// ============================================================
const dashboardStyles = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes countUp {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 1; transform: scale(1); }
}
.animate-slideUp { animation: slideUp 0.4s ease-out forwards; }
.animate-countUp { animation: countUp 0.3s ease-out forwards; }
`;

if (typeof document !== 'undefined' && !document.getElementById('troubleshooting-dashboard-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'troubleshooting-dashboard-styles';
  styleSheet.textContent = dashboardStyles;
  document.head.appendChild(styleSheet);
}

// ============================================================
// STAT CARD COMPONENT
// ============================================================
function StatCard({ icon: Icon, label, value, color, trend, delay = 0 }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200'
  };

  return (
    <div
      className="bg-white rounded-xl border p-4 animate-slideUp"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon size={20} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
            <TrendingUp size={12} className={trend < 0 ? 'rotate-180' : ''} />
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-900 animate-countUp">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
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
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}

// ============================================================
// EQUIPMENT TYPE BADGE
// ============================================================
function EquipmentTypeBadge({ type }) {
  const config = {
    switchboard: { label: 'Tableau', icon: Zap, color: 'text-amber-600 bg-amber-50' },
    vsd: { label: 'VSD', icon: Zap, color: 'text-green-600 bg-green-50' },
    meca: { label: 'Méca', icon: Wrench, color: 'text-orange-600 bg-orange-50' },
    hv: { label: 'HT', icon: Zap, color: 'text-yellow-600 bg-yellow-50' },
    glo: { label: 'GLO', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
    mobile: { label: 'Mobile', icon: Zap, color: 'text-cyan-600 bg-cyan-50' },
    datahub: { label: 'Datahub', icon: Zap, color: 'text-purple-600 bg-purple-50' },
    atex: { label: 'ATEX', icon: Zap, color: 'text-purple-600 bg-purple-50' },
    infrastructure: { label: 'Infra', icon: Zap, color: 'text-violet-600 bg-violet-50' }
  };
  const { label, icon: Icon, color } = config[type] || { label: type, icon: Wrench, color: 'text-gray-600 bg-gray-50' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

// ============================================================
// TROUBLESHOOTING DETAIL MODAL - Affiche les détails avec mini plan
// ============================================================
function TroubleshootingDetailModal({ record, onClose, onDelete, onRefresh }) {
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Charger les photos du dépannage
  useEffect(() => {
    if (record?.id) {
      loadPhotos();
    }
  }, [record?.id]);

  const loadPhotos = async () => {
    setLoadingPhotos(true);
    try {
      const response = await get(`/api/troubleshooting/${record.id}`);
      if (response?.photos) {
        setPhotos(response.photos);
      }
    } catch (e) {
      console.error('Load photos error:', e);
    } finally {
      setLoadingPhotos(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le dépannage "${record.title}" ?\n\nCette action est irréversible.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`${API_BASE}/api/troubleshooting/${record.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        onDelete?.(record.id);
        onClose();
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (e) {
      console.error('Delete error:', e);
      alert('Erreur lors de la suppression: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (!record) return null;

  const severityConfig = {
    critical: { label: 'Critique', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
    major: { label: 'Majeur', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
    minor: { label: 'Mineur', bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
    cosmetic: { label: 'Cosmétique', bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' }
  };
  const sev = severityConfig[record.severity] || severityConfig.cosmetic;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-4 sm:p-6 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Wrench size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">{record.title}</h2>
                <div className="flex items-center gap-3 mt-1 text-white/80 text-sm">
                  <span className="flex items-center gap-1">
                    <Calendar size={14} />
                    {new Date(record.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {record.technician_name}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Colonne gauche - Informations */}
            <div className="space-y-6">
              {/* Équipement et localisation */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <MapPin size={16} className="text-orange-500" />
                  Équipement
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Nom</span>
                    <span className="font-medium text-gray-900">{record.equipment_name || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Code</span>
                    <span className="font-medium text-gray-900">{record.equipment_code || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Type</span>
                    <EquipmentTypeBadge type={record.equipment_type} />
                  </div>
                  {record.building_code && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Bâtiment</span>
                      <span className="font-medium text-gray-900 flex items-center gap-1">
                        <Building2 size={14} />
                        {record.building_code}
                      </span>
                    </div>
                  )}
                  {record.floor && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Étage</span>
                      <span className="font-medium text-gray-900">{record.floor}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Classification */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-orange-500" />
                  Classification
                </h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${sev.bg} ${sev.text}`}>
                    {sev.label}
                  </span>
                  {record.category && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                      {record.category}
                    </span>
                  )}
                  {record.fault_type && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                      {record.fault_type}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="text-center p-3 bg-white rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{record.duration_minutes || 0}</p>
                    <p className="text-xs text-gray-500">min intervention</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg">
                    <p className="text-2xl font-bold text-red-600">{record.downtime_minutes || 0}</p>
                    <p className="text-xs text-gray-500">min arrêt</p>
                  </div>
                </div>
              </div>

              {/* Description et solution */}
              <div className="space-y-4">
                {record.description && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Description du problème</h4>
                    <p className="text-gray-600 text-sm bg-gray-50 rounded-lg p-3">{record.description}</p>
                  </div>
                )}
                {record.root_cause && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Cause identifiée</h4>
                    <p className="text-gray-600 text-sm bg-gray-50 rounded-lg p-3">{record.root_cause}</p>
                  </div>
                )}
                {record.solution && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Solution appliquée</h4>
                    <p className="text-gray-600 text-sm bg-green-50 rounded-lg p-3 border border-green-200">{record.solution}</p>
                  </div>
                )}
                {record.parts_replaced && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Pièces remplacées</h4>
                    <p className="text-gray-600 text-sm bg-gray-50 rounded-lg p-3">{record.parts_replaced}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Colonne droite - Mini plan et photos */}
            <div className="space-y-6">
              {/* Mini plan de localisation - use equipment_original_id for non-UUID IDs (e.g. switchboards) */}
              {(record.equipment_original_id || record.equipment_id) && record.equipment_type && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <MapPin size={16} className="text-blue-500" />
                    Localisation sur le plan
                  </h3>
                  <MiniEquipmentPreview
                    equipment={{
                      id: record.equipment_original_id || record.equipment_id,
                      name: record.equipment_name,
                      code: record.equipment_code,
                      building_code: record.building_code,
                      floor: record.floor
                    }}
                    equipmentType={record.equipment_type}
                    className="w-full"
                  />
                </div>
              )}

              {/* Photos */}
              {photos.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Image size={16} className="text-purple-500" />
                    Photos ({photos.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {photos.map((photo, idx) => (
                      <div key={idx} className="relative group">
                        <div className="aspect-video rounded-lg overflow-hidden border border-gray-200">
                          <img
                            src={photo.photo_data || `${API_BASE}/api/troubleshooting/photo/${photo.id}`}
                            alt={photo.caption || `Photo ${idx + 1}`}
                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                            onClick={() => window.open(photo.photo_data || `${API_BASE}/api/troubleshooting/photo/${photo.id}`, '_blank')}
                          />
                        </div>
                        {photo.photo_type && (
                          <span className={`absolute top-1 left-1 px-2 py-0.5 text-xs rounded-full font-medium ${
                            photo.photo_type === 'before' ? 'bg-red-500 text-white' :
                            photo.photo_type === 'during' ? 'bg-orange-500 text-white' :
                            'bg-green-500 text-white'
                          }`}>
                            {photo.photo_type === 'before' ? 'Avant' : photo.photo_type === 'during' ? 'Pendant' : 'Après'}
                          </span>
                        )}
                        {photo.caption && (
                          <p className="text-xs text-gray-500 mt-1 truncate">{photo.caption}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {loadingPhotos && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-gray-50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          {canDeleteTroubleshooting(record) ? (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
              Supprimer
            </button>
          ) : (
            <div className="text-xs text-gray-400 italic">
              Seul le créateur ou un admin peut supprimer
            </div>
          )}

          <div className="flex items-center gap-3">
            <a
              href={`${API_BASE}/api/troubleshooting/${record.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              <Download size={16} />
              Télécharger PDF
            </a>
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-100 transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function TroubleshootingDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // State
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locationStats, setLocationStats] = useState([]);
  const [problematicEquipment, setProblematicEquipment] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Filters
  const [filters, setFilters] = useState({
    equipment_type: searchParams.get('type') || '',
    building_code: searchParams.get('building') || '',
    severity: searchParams.get('severity') || '',
    date_from: searchParams.get('from') || '',
    date_to: searchParams.get('to') || '',
    search: searchParams.get('search') || ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'list');

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) queryParams.set(key, value);
      });

      const [recordsRes, summaryRes, locationRes, problematicRes] = await Promise.all([
        get(`/api/troubleshooting/list?${queryParams.toString()}&limit=100`),
        get(`/api/troubleshooting/analytics/summary?${queryParams.toString()}`),
        get(`/api/troubleshooting/analytics/by-location?${queryParams.toString()}&group_by=building`),
        get(`/api/troubleshooting/analytics/problematic-equipment?${queryParams.toString()}&limit=10`)
      ]);

      setRecords(recordsRes?.records || []);
      setSummary(summaryRes?.summary || null);
      setLocationStats(locationRes?.data || []);
      setProblematicEquipment(problematicRes?.problematic_equipment || []);
    } catch (e) {
      console.error('Load data error:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== 'list') params.set('tab', activeTab);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key === 'equipment_type' ? 'type' : key === 'building_code' ? 'building' : key === 'date_from' ? 'from' : key === 'date_to' ? 'to' : key, value);
    });
    setSearchParams(params);
  }, [filters, activeTab, setSearchParams]);

  // Generate PDF report
  const generateReport = useCallback(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('title', 'Rapport des dépannages');
    window.open(`${API_BASE}/api/troubleshooting/report/pdf?${params.toString()}`, '_blank');
  }, [filters]);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    return Object.values(filters).filter(v => v).length;
  }, [filters]);

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      equipment_type: '',
      building_code: '',
      severity: '',
      date_from: '',
      date_to: '',
      search: ''
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-xl">
                <Wrench size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Rapports de dépannage</h1>
                <p className="text-white/80 text-sm">
                  Analyse et suivi des interventions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={generateReport}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 rounded-xl hover:bg-white/30 transition-colors"
              >
                <Download size={18} />
                <span className="hidden sm:inline">Exporter PDF</span>
              </button>
              <button
                onClick={loadData}
                className="p-2 bg-white/20 rounded-xl hover:bg-white/30 transition-colors"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Stats row */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              <div className="bg-white/20 rounded-xl p-3">
                <p className="text-3xl font-bold">{summary.total_interventions}</p>
                <p className="text-white/80 text-sm">Interventions</p>
              </div>
              <div className="bg-white/20 rounded-xl p-3">
                <p className="text-3xl font-bold">{summary.by_severity?.critical || 0}</p>
                <p className="text-white/80 text-sm">Critiques</p>
              </div>
              <div className="bg-white/20 rounded-xl p-3">
                <p className="text-3xl font-bold">{summary.total_downtime_hours}h</p>
                <p className="text-white/80 text-sm">Temps d'arrêt</p>
              </div>
              <div className="bg-white/20 rounded-xl p-3">
                <p className="text-3xl font-bold">{summary.avg_repair_time_minutes}min</p>
                <p className="text-white/80 text-sm">Durée moy.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {[
              { id: 'list', label: 'Liste', icon: FileText },
              { id: 'analytics', label: 'Analyse', icon: BarChart3 },
              { id: 'locations', label: 'Par lieu', icon: Building2 },
              { id: 'problematic', label: 'Équipements', icon: AlertTriangle }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-orange-100 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="bg-white rounded-xl border mb-6">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  placeholder="Rechercher un dépannage..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors ${
                  activeFiltersCount > 0
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Filter size={16} />
                Filtres
                {activeFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-orange-500 text-white text-xs rounded-full">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Effacer
                </button>
              )}
            </div>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="border-t p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type d'équipement</label>
                <select
                  value={filters.equipment_type}
                  onChange={(e) => setFilters(prev => ({ ...prev, equipment_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">Tous</option>
                  <option value="switchboard">Tableaux</option>
                  <option value="vsd">VSD</option>
                  <option value="meca">Mécanique</option>
                  <option value="hv">Haute tension</option>
                  <option value="glo">GLO</option>
                  <option value="mobile">Mobile</option>
                  <option value="datahub">Datahub</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sévérité</label>
                <select
                  value={filters.severity}
                  onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">Toutes</option>
                  <option value="critical">Critique</option>
                  <option value="major">Majeur</option>
                  <option value="minor">Mineur</option>
                  <option value="cosmetic">Cosmétique</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
                <input
                  type="text"
                  value={filters.building_code}
                  onChange={(e) => setFilters(prev => ({ ...prev, building_code: e.target.value }))}
                  placeholder="Code bâtiment"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Du</label>
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) => setFilters(prev => ({ ...prev, date_from: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Au</label>
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) => setFilters(prev => ({ ...prev, date_to: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
            </div>
          )}
        </div>

        {/* Tab content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : (
          <>
            {/* List Tab */}
            {activeTab === 'list' && (
              <div className="space-y-3">
                {records.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl border">
                    <Wrench className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucun dépannage trouvé</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Modifiez vos filtres ou enregistrez un nouveau dépannage
                    </p>
                  </div>
                ) : (
                  records.map((record, idx) => (
                    <div
                      key={record.id}
                      className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow animate-slideUp cursor-pointer"
                      style={{ animationDelay: `${idx * 30}ms` }}
                      onClick={() => navigate(`/app/troubleshooting/${record.id}`)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                              #{record.row_number || idx + 1}
                            </span>
                            <EquipmentTypeBadge type={record.equipment_type} />
                            <SeverityBadge severity={record.severity} />
                            {record.photo_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <Image size={12} />
                                {record.photo_count}
                              </span>
                            )}
                          </div>

                          <h3 className="font-semibold text-gray-900 truncate">{record.title}</h3>

                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <MapPin size={12} />
                              {record.equipment_name || record.equipment_code || 'N/A'}
                            </span>
                            {record.building_code && (
                              <span className="flex items-center gap-1">
                                <Building2 size={12} />
                                {record.building_code}
                              </span>
                            )}
                          </div>

                          <p className="text-sm text-gray-600 mt-2 line-clamp-2">{record.description}</p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <p className="text-sm text-gray-500">
                            {new Date(record.created_at).toLocaleDateString('fr-FR')}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">{record.technician_name}</p>
                          {(record.duration_minutes || record.downtime_minutes) && (
                            <div className="flex items-center gap-2 mt-2 text-xs">
                              {record.duration_minutes > 0 && (
                                <span className="flex items-center gap-1 text-gray-500">
                                  <Clock size={10} />
                                  {record.duration_minutes}min
                                </span>
                              )}
                              {record.downtime_minutes > 0 && (
                                <span className="flex items-center gap-1 text-red-500">
                                  <AlertTriangle size={10} />
                                  {record.downtime_minutes}min arrêt
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/app/troubleshooting/${record.id}`)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
                        >
                          <Eye size={14} />
                          Ouvrir
                        </button>
                        <a
                          href={`${API_BASE}/api/troubleshooting/${record.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          <Download size={14} />
                          PDF
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Analytics Tab */}
            {activeTab === 'analytics' && summary && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    icon={Wrench}
                    label="Total interventions"
                    value={summary.total_interventions}
                    color="blue"
                    delay={0}
                  />
                  <StatCard
                    icon={AlertTriangle}
                    label="Pannes critiques"
                    value={summary.by_severity?.critical || 0}
                    color="red"
                    delay={50}
                  />
                  <StatCard
                    icon={Clock}
                    label="Durée moyenne"
                    value={`${summary.avg_repair_time_minutes}min`}
                    color="orange"
                    delay={100}
                  />
                  <StatCard
                    icon={Users}
                    label="Techniciens"
                    value={summary.technicians_count}
                    color="purple"
                    delay={150}
                  />
                </div>

                {/* By category */}
                {summary.by_category?.length > 0 && (
                  <div className="bg-white rounded-xl border p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Par catégorie</h3>
                    <div className="space-y-3">
                      {summary.by_category.map((cat, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <span className="text-gray-700">{cat.category || 'Non défini'}</span>
                          <div className="flex items-center gap-3">
                            <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-orange-500"
                                style={{ width: `${(cat.count / summary.total_interventions) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-gray-900 w-8">{cat.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By equipment type */}
                {summary.by_equipment_type?.length > 0 && (
                  <div className="bg-white rounded-xl border p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Par type d'équipement</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {summary.by_equipment_type.map((item, idx) => (
                        <div key={idx} className="text-center p-4 bg-gray-50 rounded-xl">
                          <p className="text-2xl font-bold text-gray-900">{item.count}</p>
                          <EquipmentTypeBadge type={item.type} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Locations Tab */}
            {activeTab === 'locations' && (
              <div className="space-y-4">
                {locationStats.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl border">
                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucune donnée par lieu</p>
                  </div>
                ) : (
                  locationStats.map((loc, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-xl border p-4 animate-slideUp"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-50 rounded-lg">
                            <Building2 size={20} className="text-blue-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{loc.location}</h3>
                            <p className="text-sm text-gray-500">{loc.total_interventions} intervention(s)</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {loc.critical_count > 0 && (
                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                              {loc.critical_count} critique(s)
                            </span>
                          )}
                          {loc.major_count > 0 && (
                            <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                              {loc.major_count} majeur(s)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-center text-sm">
                        <div>
                          <p className="text-lg font-bold text-gray-900">{loc.avg_duration}min</p>
                          <p className="text-gray-500">Durée moy.</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900">{loc.total_downtime}min</p>
                          <p className="text-gray-500">Temps arrêt</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900">{loc.equipment_types?.length || 0}</p>
                          <p className="text-gray-500">Types équip.</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Problematic Equipment Tab */}
            {activeTab === 'problematic' && (
              <div className="space-y-4">
                {problematicEquipment.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl border">
                    <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
                    <p className="text-gray-500">Aucun équipement problématique</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Les équipements avec 2+ interventions apparaîtront ici
                    </p>
                  </div>
                ) : (
                  problematicEquipment.map((equip, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-xl border p-4 animate-slideUp"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <EquipmentTypeBadge type={equip.equipment_type} />
                            {equip.critical_count > 0 && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                                {equip.critical_count} critique(s)
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold text-gray-900">
                            {equip.equipment_name || equip.equipment_code || 'Équipement inconnu'}
                          </h3>
                          {equip.building_code && (
                            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                              <Building2 size={12} />
                              {equip.building_code}
                            </p>
                          )}
                        </div>

                        <div className="text-right">
                          <p className="text-2xl font-bold text-red-600">{equip.intervention_count}</p>
                          <p className="text-xs text-gray-500">interventions</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t text-center text-sm">
                        <div>
                          <p className="text-lg font-bold text-gray-900">{equip.avg_repair_time}min</p>
                          <p className="text-gray-500">Durée moy.</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-orange-600">{equip.total_downtime}min</p>
                          <p className="text-gray-500">Temps arrêt</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Dernière</p>
                          <p className="text-sm font-medium text-gray-900">
                            {new Date(equip.last_intervention).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                      </div>

                      {equip.fault_categories?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {equip.fault_categories.filter(c => c).map((cat, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <TroubleshootingDetailModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onDelete={(deletedId) => {
            setRecords(prev => prev.filter(r => r.id !== deletedId));
          }}
          onRefresh={loadData}
        />
      )}
    </div>
  );
}
