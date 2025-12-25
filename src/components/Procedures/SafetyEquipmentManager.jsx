import { useState, useEffect, useRef } from 'react';
import {
  X, Upload, Camera, Trash2, Check, Loader2, Shield,
  HardHat, AlertTriangle, ChevronDown, ChevronUp, Image
} from 'lucide-react';

// Category display info
const CATEGORY_INFO = {
  height_access: { label: 'Accès en hauteur', color: 'bg-blue-100 text-blue-700' },
  head_protection: { label: 'Protection tête', color: 'bg-red-100 text-red-700' },
  eye_protection: { label: 'Protection yeux', color: 'bg-cyan-100 text-cyan-700' },
  hand_protection: { label: 'Protection mains', color: 'bg-yellow-100 text-yellow-700' },
  foot_protection: { label: 'Protection pieds', color: 'bg-gray-100 text-gray-700' },
  hearing_protection: { label: 'Protection auditive', color: 'bg-pink-100 text-pink-700' },
  fall_protection: { label: 'Antichute', color: 'bg-purple-100 text-purple-700' },
  visibility: { label: 'Visibilité', color: 'bg-amber-100 text-amber-700' },
  gas_detection: { label: 'Détection gaz', color: 'bg-green-100 text-green-700' },
  respiratory: { label: 'Respiratoire', color: 'bg-indigo-100 text-indigo-700' },
  electrical: { label: 'Électrique', color: 'bg-orange-100 text-orange-700' },
};

function EquipmentCard({ equipment, onUpload, onDelete, uploading }) {
  const fileInputRef = useRef(null);
  const categoryInfo = CATEGORY_INFO[equipment.category] || { label: equipment.category, color: 'bg-gray-100 text-gray-700' };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(equipment.id, file);
      e.target.value = '';
    }
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Image section - clickable for upload */}
      <button
        type="button"
        onClick={handleImageClick}
        className="relative aspect-square bg-gray-50 flex items-center justify-center p-4 w-full cursor-pointer active:bg-gray-100 transition-colors"
      >
        {uploading === equipment.id ? (
          <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
        ) : (
          <>
            <img
              src={equipment.imageUrl}
              alt={equipment.name}
              className="max-w-full max-h-full object-contain"
              onError={(e) => {
                e.target.src = '/safety-equipment/casque.svg'; // Fallback
              }}
            />
            {/* Upload hint - always visible on mobile */}
            <div className="absolute bottom-2 right-2 bg-violet-600 text-white rounded-full p-1.5 shadow-lg">
              <Camera className="w-3.5 h-3.5" />
            </div>
          </>
        )}

        {/* Custom badge */}
        {equipment.hasCustomImage && (
          <div className="absolute top-2 right-2 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
            <Check className="w-3 h-3" />
            Perso
          </div>
        )}
      </button>

      {/* Info section */}
      <div className="p-3">
        <h4 className="font-semibold text-gray-900 text-sm">{equipment.name}</h4>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{equipment.fullName}</p>

        <div className="flex items-center justify-between mt-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${categoryInfo.color}`}>
            {categoryInfo.label}
          </span>

          {equipment.hasCustomImage && (
            <button
              onClick={() => onDelete(equipment.id)}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Supprimer l'image personnalisée"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

export default function SafetyEquipmentManager({ isOpen, onClose }) {
  const [equipment, setEquipment] = useState([]);
  const [permits, setPermits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [showPermits, setShowPermits] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (isOpen) {
      loadEquipment();
    }
  }, [isOpen]);

  const loadEquipment = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/procedures/safety-equipment');
      if (res.ok) {
        const data = await res.json();
        setEquipment(data.equipment || []);
        setPermits(data.permits || []);
      }
    } catch (err) {
      console.error('Error loading equipment:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (equipmentId, file) => {
    try {
      setUploading(equipmentId);

      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`/api/procedures/safety-equipment/${equipmentId}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        // Reload to get updated image URLs
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error uploading image:', err);
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (equipmentId) => {
    if (!confirm('Supprimer l\'image personnalisée et revenir à l\'icône par défaut ?')) return;

    try {
      const res = await fetch(`/api/procedures/safety-equipment/${equipmentId}/image`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error deleting image:', err);
    }
  };

  // Get unique categories
  const categories = [...new Set(equipment.map(e => e.category))];

  // Filter equipment
  const filteredEquipment = filter === 'all'
    ? equipment
    : equipment.filter(e => e.category === filter);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center">
      <div
        className="bg-white w-full lg:max-w-4xl lg:rounded-2xl rounded-t-3xl max-h-[90vh] flex flex-col overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 sm:px-6 py-4 flex-shrink-0">
          {/* Mobile handle */}
          <div className="lg:hidden flex justify-center mb-3">
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Équipements de Sécurité</h2>
                <p className="text-sm text-white/80">Personnalisez les images pour vos PDFs</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 active:bg-white/30 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category filter */}
        <div className="px-4 py-3 border-b flex gap-2 overflow-x-auto flex-shrink-0">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              filter === 'all'
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-600 active:bg-gray-200'
            }`}
          >
            Tous ({equipment.length})
          </button>
          {categories.map(cat => {
            const info = CATEGORY_INFO[cat] || { label: cat };
            const count = equipment.filter(e => e.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  filter === cat
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                }`}
              >
                {info.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Equipment grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredEquipment.map(eq => (
                  <EquipmentCard
                    key={eq.id}
                    equipment={eq}
                    onUpload={handleUpload}
                    onDelete={handleDelete}
                    uploading={uploading}
                  />
                ))}
              </div>

              {/* Permits section */}
              <div className="mt-6">
                <button
                  onClick={() => setShowPermits(!showPermits)}
                  className="flex items-center gap-2 w-full px-4 py-3 bg-purple-50 rounded-xl text-left"
                >
                  <AlertTriangle className="w-5 h-5 text-purple-600" />
                  <span className="font-semibold text-purple-900 flex-1">
                    Permis de Travail ({permits.length})
                  </span>
                  {showPermits ? (
                    <ChevronUp className="w-5 h-5 text-purple-600" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-purple-600" />
                  )}
                </button>

                {showPermits && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {permits.map(permit => (
                      <div
                        key={permit.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-gray-100"
                        style={{ backgroundColor: permit.color + '10' }}
                      >
                        <span className="text-2xl">{permit.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm" style={{ color: permit.color }}>
                            {permit.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{permit.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer help */}
        <div className="px-4 py-3 bg-gray-50 border-t flex-shrink-0">
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Image className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              <strong>Astuce :</strong> Cliquez sur une image pour la remplacer par votre propre photo.
              L'IA utilisera ces images dans les documents RAMS, Méthodologie et Procédure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
