import { useState, useEffect, useRef } from 'react';
import {
  X, Camera, Trash2, Check, Loader2, Shield,
  AlertTriangle, ChevronDown, ChevronUp, Image, Edit3, Save, Plus
} from 'lucide-react';

// Category display info
const CATEGORY_INFO = {
  height_access: { label: 'Hauteur', color: 'bg-blue-100 text-blue-700' },
  head_protection: { label: 'Tête', color: 'bg-red-100 text-red-700' },
  eye_protection: { label: 'Yeux', color: 'bg-cyan-100 text-cyan-700' },
  hand_protection: { label: 'Mains', color: 'bg-yellow-100 text-yellow-700' },
  foot_protection: { label: 'Pieds', color: 'bg-gray-100 text-gray-700' },
  hearing_protection: { label: 'Audition', color: 'bg-pink-100 text-pink-700' },
  fall_protection: { label: 'Antichute', color: 'bg-purple-100 text-purple-700' },
  visibility: { label: 'Visibilité', color: 'bg-amber-100 text-amber-700' },
  gas_detection: { label: 'Gaz', color: 'bg-green-100 text-green-700' },
  respiratory: { label: 'Respiration', color: 'bg-indigo-100 text-indigo-700' },
  electrical: { label: 'Électrique', color: 'bg-orange-100 text-orange-700' },
  custom: { label: 'Personnalisé', color: 'bg-violet-100 text-violet-700' },
};

// List of categories for selection
const CATEGORY_OPTIONS = [
  { id: 'head_protection', label: 'Protection tête' },
  { id: 'eye_protection', label: 'Protection yeux' },
  { id: 'hand_protection', label: 'Protection mains' },
  { id: 'foot_protection', label: 'Protection pieds' },
  { id: 'hearing_protection', label: 'Protection auditive' },
  { id: 'fall_protection', label: 'Protection antichute' },
  { id: 'respiratory', label: 'Protection respiratoire' },
  { id: 'electrical', label: 'Protection électrique' },
  { id: 'visibility', label: 'Haute visibilité' },
  { id: 'gas_detection', label: 'Détection gaz' },
  { id: 'height_access', label: 'Travail en hauteur' },
  { id: 'custom', label: 'Autre (personnalisé)' },
];

function EquipmentCard({ equipment, onUpload, onDeleteImage, onDeleteEquipment, uploading }) {
  const fileInputRef = useRef(null);
  const categoryInfo = CATEGORY_INFO[equipment.category] || { label: equipment.category, color: 'bg-gray-100 text-gray-700' };
  const isCustom = equipment.isCustom || equipment.id?.startsWith('custom_');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(equipment.id, file);
      e.target.value = '';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Image section */}
      <div
        className="relative aspect-square bg-gray-50 flex items-center justify-center p-3"
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading === equipment.id ? (
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        ) : (
          <img
            src={equipment.imageUrl}
            alt={equipment.name}
            className="max-w-full max-h-full object-contain pointer-events-none"
            onError={(e) => {
              e.target.src = '/safety-equipment/casque.svg';
            }}
          />
        )}

        {/* Upload button */}
        <div className="absolute bottom-1.5 right-1.5 bg-violet-600 text-white rounded-full p-1.5 shadow-md">
          <Camera className="w-3 h-3" />
        </div>

        {/* Custom badge */}
        {(equipment.hasCustomImage || isCustom) && (
          <div className="absolute top-1.5 left-1.5 bg-green-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5">
            <Check className="w-2.5 h-2.5" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <div className="flex items-center justify-between gap-1">
          <h4 className="font-medium text-gray-900 text-xs truncate flex-1">{equipment.name}</h4>
          <div className="flex items-center gap-0.5">
            {equipment.hasCustomImage && !isCustom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteImage(equipment.id);
                }}
                className="p-1 text-amber-500 active:bg-amber-50 rounded"
                title="Supprimer l'image personnalisée"
              >
                <Image className="w-3 h-3" />
              </button>
            )}
            {isCustom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEquipment(equipment.id);
                }}
                className="p-1 text-red-500 active:bg-red-50 rounded"
                title="Supprimer cet équipement"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium inline-block mt-1 ${categoryInfo.color}`}>
          {categoryInfo.label}
        </span>
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

// Permit card with inline editing and delete
function PermitCard({ permit, onUpdate, onDelete, saving }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(permit.name);
  const [editDescription, setEditDescription] = useState(permit.description);
  const isCustom = permit.isCustom || permit.id?.startsWith('custom_');

  const handleSave = async () => {
    await onUpdate(permit.id, { name: editName, description: editDescription });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(permit.name);
    setEditDescription(permit.description);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div
        className="p-3 rounded-lg border-2 border-purple-300"
        style={{ backgroundColor: permit.color + '10' }}
      >
        <div className="flex items-start gap-2">
          <span className="text-xl">{permit.icon}</span>
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Nom du permis"
            />
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Description"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Enregistrer
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 group"
      style={{ backgroundColor: permit.color + '10' }}
    >
      <span className="text-xl">{permit.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-xs" style={{ color: permit.color }}>
          {permit.name}
        </p>
        <p className="text-[10px] text-gray-500 truncate">{permit.description}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100"
          title="Modifier"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        {isCustom && (
          <button
            onClick={() => onDelete(permit.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100"
            title="Supprimer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// Add Equipment Form
function AddEquipmentForm({ onAdd, onCancel, saving }) {
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [category, setCategory] = useState('custom');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    await onAdd({ name, fullName, category, description }, imageFile);
  };

  return (
    <div className="p-4 bg-violet-50 rounded-xl border-2 border-violet-200 space-y-3">
      <h4 className="font-medium text-violet-900 text-sm flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Nouvel équipement
      </h4>

      <div className="flex gap-3">
        {/* Image upload */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-20 h-20 bg-white rounded-lg border-2 border-dashed border-violet-300 flex items-center justify-center cursor-pointer hover:border-violet-500 transition-colors flex-shrink-0"
        >
          {imagePreview ? (
            <img src={imagePreview} alt="Preview" className="w-full h-full object-contain rounded-lg" />
          ) : (
            <Camera className="w-6 h-6 text-violet-400" />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
        />

        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom court (ex: Casque)"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nom complet (optionnel)"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
      >
        {CATEGORY_OPTIONS.map(cat => (
          <option key={cat.id} value={cat.id}>{cat.label}</option>
        ))}
      </select>

      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optionnel)"
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
      />

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300"
        >
          Annuler
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || saving}
          className="flex-1 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Ajouter
        </button>
      </div>
    </div>
  );
}

// Add Permit Form
function AddPermitForm({ onAdd, onCancel, saving }) {
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📋');
  const [color, setColor] = useState('#6b7280');

  const iconOptions = ['📋', '🔥', '⚡', '🔒', '🚧', '⚠️', '🛠️', '🎯', '📍', '🏗️'];
  const colorOptions = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];

  const handleSubmit = async () => {
    if (!name.trim()) return;
    await onAdd({ name, fullName, description, icon, color });
  };

  return (
    <div className="p-4 bg-purple-50 rounded-xl border-2 border-purple-200 space-y-3 mt-3">
      <h4 className="font-medium text-purple-900 text-sm flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Nouveau permis de travail
      </h4>

      <div className="flex gap-3">
        {/* Icon selector */}
        <div className="flex flex-wrap gap-1 w-20">
          {iconOptions.map(i => (
            <button
              key={i}
              onClick={() => setIcon(i)}
              className={`w-8 h-8 text-lg rounded-lg flex items-center justify-center ${
                icon === i ? 'bg-purple-200 ring-2 ring-purple-500' : 'bg-white hover:bg-purple-100'
              }`}
            >
              {i}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du permis"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nom complet (optionnel)"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      {/* Color selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Couleur:</span>
        <div className="flex gap-1">
          {colorOptions.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-purple-500' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-300"
        >
          Annuler
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || saving}
          className="flex-1 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Ajouter
        </button>
      </div>
    </div>
  );
}

export default function SafetyEquipmentManager({ isOpen, onClose }) {
  const [equipment, setEquipment] = useState([]);
  const [permits, setPermits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [savingPermit, setSavingPermit] = useState(null);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [showPermits, setShowPermits] = useState(false);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [showAddPermit, setShowAddPermit] = useState(false);
  const [filter, setFilter] = useState('all');
  const contentRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      loadEquipment();
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
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
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error uploading image:', err);
    } finally {
      setUploading(null);
    }
  };

  const handleDeleteImage = async (equipmentId) => {
    if (!confirm('Supprimer l\'image personnalisée ?')) return;

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

  const handleDeleteEquipment = async (equipmentId) => {
    if (!confirm('Supprimer cet équipement personnalisé ?')) return;

    try {
      const res = await fetch(`/api/procedures/safety-equipment/${equipmentId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error deleting equipment:', err);
    }
  };

  const handleAddEquipment = async (data, imageFile) => {
    try {
      setSavingEquipment(true);

      const formData = new FormData();
      formData.append('name', data.name);
      if (data.fullName) formData.append('fullName', data.fullName);
      formData.append('category', data.category);
      if (data.description) formData.append('description', data.description);
      if (imageFile) formData.append('image', imageFile);

      const res = await fetch('/api/procedures/safety-equipment', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setShowAddEquipment(false);
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error adding equipment:', err);
    } finally {
      setSavingEquipment(false);
    }
  };

  const handleUpdatePermit = async (permitId, updates) => {
    try {
      setSavingPermit(permitId);
      const res = await fetch(`/api/procedures/permits/${permitId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        // Update local state
        setPermits(prev => prev.map(p =>
          p.id === permitId ? { ...p, ...updates } : p
        ));
      }
    } catch (err) {
      console.error('Error updating permit:', err);
    } finally {
      setSavingPermit(null);
    }
  };

  const handleDeletePermit = async (permitId) => {
    if (!confirm('Supprimer ce permis personnalisé ?')) return;

    try {
      const res = await fetch(`/api/procedures/permits/${permitId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error deleting permit:', err);
    }
  };

  const handleAddPermit = async (data) => {
    try {
      setSavingPermit('new');
      const res = await fetch('/api/procedures/permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setShowAddPermit(false);
        await loadEquipment();
      }
    } catch (err) {
      console.error('Error adding permit:', err);
    } finally {
      setSavingPermit(null);
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
    <div
      className="fixed inset-0 z-50 flex flex-col"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal - Full screen on mobile */}
      <div className="relative z-10 mt-auto sm:m-auto w-full sm:max-w-2xl bg-white sm:rounded-2xl rounded-t-2xl flex flex-col min-h-[70vh] max-h-[95vh] sm:min-h-0 sm:max-h-[85vh]">

        {/* Header - Fixed */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 rounded-t-2xl flex-shrink-0">
          {/* Mobile drag handle */}
          <div className="sm:hidden flex justify-center mb-2">
            <div className="w-10 h-1 bg-white/40 rounded-full" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-white" />
              <h2 className="text-base font-semibold text-white">Équipements de Sécurité</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 active:bg-white/40 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category filter - Horizontal scroll */}
        <div
          className="px-3 py-2 border-b bg-white flex-shrink-0 overflow-x-auto touch-pan-x"
        >
          <div className="flex gap-1.5 min-w-max">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
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
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
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
        </div>

        {/* Scrollable Content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overscroll-contain touch-pan-y"
        >
          <div className="p-3">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
              </div>
            ) : (
              <>
                {/* Add Equipment Button */}
                {!showAddEquipment ? (
                  <button
                    onClick={() => setShowAddEquipment(true)}
                    className="w-full mb-3 py-2.5 border-2 border-dashed border-violet-300 rounded-xl text-violet-600 text-sm font-medium flex items-center justify-center gap-2 hover:bg-violet-50 active:bg-violet-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter un équipement
                  </button>
                ) : (
                  <div className="mb-3">
                    <AddEquipmentForm
                      onAdd={handleAddEquipment}
                      onCancel={() => setShowAddEquipment(false)}
                      saving={savingEquipment}
                    />
                  </div>
                )}

                {/* Equipment grid - 3 columns on mobile */}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {filteredEquipment.map(eq => (
                    <EquipmentCard
                      key={eq.id}
                      equipment={eq}
                      onUpload={handleUpload}
                      onDeleteImage={handleDeleteImage}
                      onDeleteEquipment={handleDeleteEquipment}
                      uploading={uploading}
                    />
                  ))}
                </div>

                {/* Permits section */}
                <div className="mt-4">
                  <button
                    onClick={() => setShowPermits(!showPermits)}
                    className="flex items-center gap-2 w-full px-3 py-2.5 bg-purple-50 rounded-xl text-left active:bg-purple-100"
                  >
                    <AlertTriangle className="w-4 h-4 text-purple-600" />
                    <span className="font-medium text-purple-900 flex-1 text-sm">
                      Permis de Travail ({permits.length})
                    </span>
                    <span className="text-[10px] text-purple-500 mr-1">Gérer</span>
                    {showPermits ? (
                      <ChevronUp className="w-4 h-4 text-purple-600" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-purple-600" />
                    )}
                  </button>

                  {showPermits && (
                    <>
                      {/* Add Permit Button */}
                      {!showAddPermit ? (
                        <button
                          onClick={() => setShowAddPermit(true)}
                          className="w-full mt-3 py-2 border-2 border-dashed border-purple-300 rounded-xl text-purple-600 text-sm font-medium flex items-center justify-center gap-2 hover:bg-purple-50 active:bg-purple-100 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          Ajouter un permis
                        </button>
                      ) : (
                        <AddPermitForm
                          onAdd={handleAddPermit}
                          onCancel={() => setShowAddPermit(false)}
                          saving={savingPermit === 'new'}
                        />
                      )}

                      <div className="mt-3 space-y-1.5">
                        {permits.map(permit => (
                          <PermitCard
                            key={permit.id}
                            permit={permit}
                            onUpdate={handleUpdatePermit}
                            onDelete={handleDeletePermit}
                            saving={savingPermit === permit.id}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer - Fixed */}
        <div className="px-3 py-2 bg-gray-50 border-t flex-shrink-0 pb-safe">
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <Image className="w-3.5 h-3.5 flex-shrink-0" />
            <p>Touchez une image pour la remplacer. Les éléments personnalisés peuvent être supprimés.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
