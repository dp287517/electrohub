// TroubleshootingWizard - Wizard de dépannage avec agent IA
// Permet aux techniciens d'enregistrer les dépannages avec photos et descriptions
import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wrench, Camera, Plus, X, ChevronRight, ChevronLeft, Send,
  CheckCircle, AlertTriangle, Upload, Trash2, Image, Clock,
  FileText, Sparkles, Loader2, Building2, MapPin, Tag,
  Download, Eye, RefreshCw, Zap, Calendar
} from 'lucide-react';
import { post, get, API_BASE } from '../lib/api';
import { getUserPermissions } from '../lib/permissions';
import TimePicker from './TimePicker';
import DurationPicker from './DurationPicker';

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
const wizardStyles = `
@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes slideOut {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(-20px); }
}
@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.7; }
  100% { transform: scale(0.95); opacity: 1; }
}
.animate-slideIn { animation: slideIn 0.3s ease-out forwards; }
.animate-pulse-ring { animation: pulse-ring 2s ease-in-out infinite; }
`;

// Inject styles
if (typeof document !== 'undefined' && !document.getElementById('troubleshooting-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'troubleshooting-styles';
  styleSheet.textContent = wizardStyles;
  document.head.appendChild(styleSheet);
}

// ============================================================
// CONSTANTS
// ============================================================
const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critique', color: 'bg-red-500', description: 'Arrêt total de l\'équipement' },
  { value: 'major', label: 'Majeur', color: 'bg-orange-500', description: 'Fonctionnement dégradé' },
  { value: 'minor', label: 'Mineur', color: 'bg-yellow-500', description: 'Problème secondaire' },
  { value: 'cosmetic', label: 'Cosmétique', color: 'bg-gray-400', description: 'Aspect visuel' }
];

const CATEGORY_OPTIONS = [
  { value: 'electrical', label: 'Électrique', icon: Zap },
  { value: 'mechanical', label: 'Mécanique', icon: Wrench },
  { value: 'software', label: 'Logiciel', icon: FileText },
  { value: 'other', label: 'Autre', icon: Tag }
];

const FAULT_TYPE_OPTIONS = [
  { value: 'breakdown', label: 'Panne' },
  { value: 'malfunction', label: 'Dysfonctionnement' },
  { value: 'preventive', label: 'Préventif' },
  { value: 'corrective', label: 'Correctif' }
];

// ============================================================
// STEP COMPONENTS
// ============================================================

// Step 1: Photos
function PhotoStep({ photos, setPhotos, onNext }) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileSelect = useCallback((files) => {
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPhotos(prev => [...prev, {
            id: Date.now() + Math.random(),
            data: e.target.result,
            caption: '',
            type: prev.length === 0 ? 'before' : 'after'
          }]);
        };
        reader.readAsDataURL(file);
      }
    });
  }, [setPhotos]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const removePhoto = (id) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const updatePhotoCaption = (id, caption) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
  };

  const updatePhotoType = (id, type) => {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, type } : p));
  };

  return (
    <div className="space-y-6 animate-slideIn">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Camera className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Photos du dépannage</h3>
        <p className="text-gray-500 mt-1">Ajoutez des photos avant, pendant et après l'intervention</p>
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
        <Upload className={`w-12 h-12 mx-auto mb-4 ${dragActive ? 'text-blue-500' : 'text-gray-400'}`} />
        <p className="text-gray-600 font-medium">
          {dragActive ? 'Déposez les photos ici' : 'Cliquez ou glissez des photos'}
        </p>
        <p className="text-sm text-gray-400 mt-1">PNG, JPG jusqu'à 10MB</p>
      </div>

      {/* Photos preview */}
      {photos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <div className="aspect-video rounded-xl overflow-hidden border border-gray-200">
                <img
                  src={photo.data}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                onClick={() => removePhoto(photo.id)}
                className="absolute top-2 right-2 p-1.5 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={14} />
              </button>

              {/* Photo type selector */}
              <div className="absolute bottom-2 left-2 flex gap-1">
                {['before', 'during', 'after'].map(t => (
                  <button
                    key={t}
                    onClick={() => updatePhotoType(photo.id, t)}
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                      photo.type === t
                        ? t === 'before' ? 'bg-red-500 text-white' :
                          t === 'during' ? 'bg-orange-500 text-white' :
                          'bg-green-500 text-white'
                        : 'bg-black/50 text-white hover:bg-black/70'
                    }`}
                  >
                    {t === 'before' ? 'Avant' : t === 'during' ? 'Pendant' : 'Après'}
                  </button>
                ))}
              </div>

              {/* Caption input */}
              <input
                type="text"
                value={photo.caption}
                onChange={(e) => updatePhotoCaption(photo.id, e.target.value)}
                placeholder="Légende (optionnel)"
                className="w-full mt-2 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-blue-600 hover:to-indigo-700 transition-all"
        >
          {photos.length === 0 ? 'Passer' : 'Continuer'}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// Step 2: Description
function DescriptionStep({ formData, setFormData, onNext, onBack, isAnalyzing, aiSuggestion, isImproving }) {
  return (
    <div className="space-y-6 animate-slideIn">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Description du problème</h3>
        <p className="text-gray-500 mt-1">Décrivez le problème rencontré et la solution apportée</p>
      </div>

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Titre du dépannage *
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Ex: Remplacement contacteur principal"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Problem description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description du problème
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Décrivez le problème observé, les symptômes, etc."
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Root cause */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Cause identifiée
          </label>
          <textarea
            value={formData.root_cause}
            onChange={(e) => setFormData(prev => ({ ...prev, root_cause: e.target.value }))}
            placeholder="Quelle était la cause du problème ?"
            rows={2}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Solution */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Solution appliquée
          </label>
          <textarea
            value={formData.solution}
            onChange={(e) => setFormData(prev => ({ ...prev, solution: e.target.value }))}
            placeholder="Comment avez-vous résolu le problème ?"
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Parts replaced */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pièces remplacées
          </label>
          <input
            type="text"
            value={formData.parts_replaced}
            onChange={(e) => setFormData(prev => ({ ...prev, parts_replaced: e.target.value }))}
            placeholder="Ex: Contacteur LC1D25, Fusible 16A"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Analyse photo */}
        {isAnalyzing ? (
          <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
              <span className="text-purple-700 font-medium">Analyse photo en cours...</span>
            </div>
          </div>
        ) : aiSuggestion && (
          <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
            <div className="flex items-start gap-3">
              <Image className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-purple-700 font-medium text-sm">Analyse photo</p>
                <p className="text-purple-600 text-sm mt-1">{aiSuggestion}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
        <button
          onClick={onBack}
          className="w-full sm:w-auto px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button
          onClick={onNext}
          disabled={!formData.title || isImproving}
          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-purple-600 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImproving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Correction...
            </>
          ) : (
            <>
              Continuer
              <ChevronRight size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Step 3: Classification
function ClassificationStep({ formData, setFormData, onNext, onBack }) {
  return (
    <div className="space-y-6 animate-slideIn">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Tag className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Classification</h3>
        <p className="text-gray-500 mt-1">Classifiez le type et la sévérité de la panne</p>
      </div>

      {/* Severity */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Sévérité *
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SEVERITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFormData(prev => ({ ...prev, severity: option.value }))}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                formData.severity === option.value
                  ? 'border-gray-900 bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-3 h-3 rounded-full ${option.color}`} />
                <span className="font-semibold text-gray-900">{option.label}</span>
              </div>
              <p className="text-xs text-gray-500">{option.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Catégorie
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CATEGORY_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                onClick={() => setFormData(prev => ({ ...prev, category: option.value }))}
                className={`p-4 rounded-xl border-2 text-center transition-all ${
                  formData.category === option.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-6 h-6 mx-auto mb-2 ${
                  formData.category === option.value ? 'text-blue-500' : 'text-gray-400'
                }`} />
                <span className={`text-sm font-medium ${
                  formData.category === option.value ? 'text-blue-700' : 'text-gray-700'
                }`}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fault type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Type d'intervention
        </label>
        <div className="flex flex-wrap gap-2">
          {FAULT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFormData(prev => ({ ...prev, fault_type: option.value }))}
              className={`px-4 py-2 rounded-full border transition-all ${
                formData.fault_type === option.value
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time section */}
      <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Clock size={16} />
          Temps d'intervention
        </h4>

        {/* Date and start time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date d'intervention
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={formData.intervention_date}
                onChange={(e) => setFormData(prev => ({ ...prev, intervention_date: e.target.value }))}
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white"
              />
            </div>
          </div>
          <TimePicker
            value={formData.start_time}
            onChange={(time) => setFormData(prev => ({ ...prev, start_time: time }))}
            label="Heure de début"
            placeholder="Sélectionner l'heure"
          />
        </div>

        {/* Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DurationPicker
            value={formData.duration_minutes}
            onChange={(minutes) => setFormData(prev => ({ ...prev, duration_minutes: minutes }))}
            label="Durée d'intervention"
            placeholder="Sélectionner la durée"
            color="orange"
          />
          <DurationPicker
            value={formData.downtime_minutes}
            onChange={(minutes) => setFormData(prev => ({ ...prev, downtime_minutes: minutes }))}
            label="Temps d'arrêt machine"
            placeholder="Sélectionner la durée"
            color="red"
          />
        </div>

        {/* Calculated end time */}
        {formData.start_time && formData.duration_minutes > 0 && (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            <div>
              <span className="text-sm text-green-700">Heure de fin calculée : </span>
              <span className="text-sm font-bold text-green-800">
                {(() => {
                  const [h, m] = formData.start_time.split(':').map(Number);
                  const totalMinutes = h * 60 + m + formData.duration_minutes;
                  const endH = Math.floor(totalMinutes / 60) % 24;
                  const endM = totalMinutes % 60;
                  return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                })()}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
        <button
          onClick={onBack}
          className="w-full sm:w-auto px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button
          onClick={onNext}
          disabled={!formData.severity}
          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-orange-600 hover:to-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continuer
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// Step 4: Summary & Submit
function SummaryStep({ formData, photos, equipment, additionalEquipment = [], onBack, onSubmit, isSubmitting }) {
  return (
    <div className="space-y-6 animate-slideIn">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Récapitulatif</h3>
        <p className="text-gray-500 mt-1">Vérifiez les informations avant d'enregistrer</p>
      </div>

      {/* Summary card */}
      <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
        {/* Equipment */}
        <div className="pb-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">
                Équipement{additionalEquipment.length > 0 ? 's' : ''} concerné{additionalEquipment.length > 0 ? 's' : ''}
              </p>
              <p className="font-semibold text-gray-900">
                {equipment?.name || equipment?.equipment_name || 'Non défini'}
                {equipment?.code || equipment?.tag ? ` (${equipment.code || equipment.tag})` : ''}
              </p>
            </div>
          </div>
          {/* Additional equipment */}
          {additionalEquipment.length > 0 && (
            <div className="mt-3 ml-11 space-y-2">
              {additionalEquipment.map((eq, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <span className="w-1.5 h-1.5 bg-orange-400 rounded-full"></span>
                  <span className="text-gray-700">{eq.equipment_name}</span>
                  {eq.equipment_code && (
                    <span className="text-gray-400 text-xs">({eq.equipment_code})</span>
                  )}
                </div>
              ))}
              <p className="text-xs text-orange-600 font-medium mt-1">
                +{additionalEquipment.length} équipement{additionalEquipment.length > 1 ? 's' : ''} lié{additionalEquipment.length > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h4 className="font-bold text-gray-900">{formData.title}</h4>
          <p className="text-sm text-gray-600">{formData.description}</p>
        </div>

        {/* Classification */}
        <div className="flex flex-wrap gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium text-white ${
            formData.severity === 'critical' ? 'bg-red-500' :
            formData.severity === 'major' ? 'bg-orange-500' :
            formData.severity === 'minor' ? 'bg-yellow-500' : 'bg-gray-400'
          }`}>
            {SEVERITY_OPTIONS.find(s => s.value === formData.severity)?.label || formData.severity}
          </span>
          {formData.category && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
              {CATEGORY_OPTIONS.find(c => c.value === formData.category)?.label || formData.category}
            </span>
          )}
          {formData.fault_type && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              {FAULT_TYPE_OPTIONS.find(f => f.value === formData.fault_type)?.label || formData.fault_type}
            </span>
          )}
        </div>

        {/* Times */}
        {(formData.start_time || formData.duration_minutes || formData.downtime_minutes) && (
          <div className="space-y-2 text-sm">
            {/* Date and times */}
            {formData.intervention_date && (
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={14} />
                <span>
                  {new Date(formData.intervention_date).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}
                </span>
              </div>
            )}
            {formData.start_time && (
              <div className="flex items-center gap-2 text-gray-600">
                <Clock size={14} />
                <span>
                  Début: {formData.start_time}
                  {formData.duration_minutes > 0 && (
                    <>
                      {' → Fin: '}
                      {(() => {
                        const [h, m] = formData.start_time.split(':').map(Number);
                        const totalMinutes = h * 60 + m + formData.duration_minutes;
                        const endH = Math.floor(totalMinutes / 60) % 24;
                        const endM = totalMinutes % 60;
                        return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                      })()}
                    </>
                  )}
                </span>
              </div>
            )}
            {/* Duration badges */}
            <div className="flex gap-3">
              {formData.duration_minutes > 0 && (
                <div className="flex items-center gap-1 text-orange-600">
                  <Clock size={14} />
                  <span>Durée: {formData.duration_minutes >= 60 ? `${Math.floor(formData.duration_minutes / 60)}h${formData.duration_minutes % 60 > 0 ? formData.duration_minutes % 60 + 'min' : ''}` : `${formData.duration_minutes} min`}</span>
                </div>
              )}
              {formData.downtime_minutes > 0 && (
                <div className="flex items-center gap-1 text-red-600">
                  <AlertTriangle size={14} />
                  <span>Arrêt: {formData.downtime_minutes >= 60 ? `${Math.floor(formData.downtime_minutes / 60)}h${formData.downtime_minutes % 60 > 0 ? formData.downtime_minutes % 60 + 'min' : ''}` : `${formData.downtime_minutes} min`}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Solution */}
        {formData.solution && (
          <div className="pt-4 border-t border-gray-200">
            <p className="text-sm font-medium text-gray-700 mb-1">Solution:</p>
            <p className="text-sm text-gray-600">{formData.solution}</p>
          </div>
        )}

        {/* Photos count */}
        {photos.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Image size={14} />
            <span>{photos.length} photo(s) jointe(s)</span>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
        <button
          onClick={onBack}
          className="w-full sm:w-auto px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="w-full sm:w-auto px-6 sm:px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Enregistrement...
            </>
          ) : (
            <>
              <CheckCircle size={18} />
              Enregistrer le dépannage
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Success screen
function SuccessScreen({ recordId, onClose, onViewReport, onNewTroubleshooting }) {
  return (
    <div className="text-center py-8 animate-slideIn">
      <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse-ring">
        <CheckCircle className="w-10 h-10 text-white" />
      </div>

      <h3 className="text-2xl font-bold text-gray-900 mb-2">Dépannage enregistré !</h3>
      <p className="text-gray-500 mb-8">
        Votre intervention a été sauvegardée avec succès.
      </p>

      <div className="flex flex-col gap-3 justify-center">
        <button
          onClick={onViewReport}
          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-blue-600 hover:to-indigo-700 transition-all"
        >
          <Download size={18} />
          Télécharger le rapport PDF
        </button>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onNewTroubleshooting}
            className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
          >
            <Plus size={18} />
            Nouveau dépannage
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function TroubleshootingWizard({
  isOpen,
  onClose,
  equipment,
  equipmentType,
  onSuccess,
  additionalEquipment = [] // Support for multiple equipment
}) {
  const [step, setStep] = useState(1);
  const [photos, setPhotos] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    root_cause: '',
    solution: '',
    parts_replaced: '',
    severity: '',
    category: '',
    fault_type: '',
    intervention_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    start_time: '', // HH:MM
    duration_minutes: 0,
    downtime_minutes: 0
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [success, setSuccess] = useState(false);
  const [recordId, setRecordId] = useState(null);

  // Get user info from localStorage (multiple fallback pattern)
  const getUserInfo = () => {
    let email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    let name = localStorage.getItem("name") || localStorage.getItem("user.name") || null;

    // Try eh_user JSON object
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        email = email || eu.email;
        name = name || eu.name;
      } catch (e) {}
    }

    // Try user JSON object
    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        email = email || u.email;
        name = name || u.name;
      } catch (e) {}
    }

    return {
      email: email || '',
      name: name || (email ? email.split('@')[0] : 'Technicien')
    };
  };

  const userInfo = getUserInfo();
  const userEmail = userInfo.email;
  const userName = userInfo.name;

  // Reset wizard when opening
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setPhotos([]);
      setFormData({
        title: '',
        description: '',
        root_cause: '',
        solution: '',
        parts_replaced: '',
        severity: '',
        category: '',
        fault_type: '',
        intervention_date: new Date().toISOString().split('T')[0],
        start_time: '',
        duration_minutes: 0,
        downtime_minutes: 0
      });
      setSuccess(false);
      setRecordId(null);
      setAiSuggestion('');
    }
  }, [isOpen]);

  // AI analysis when photos are added
  useEffect(() => {
    if (photos.length > 0 && step === 2 && !aiSuggestion) {
      analyzeWithAI();
    }
  }, [step, photos.length]);

  const analyzeWithAI = async () => {
    if (!photos.length) return;

    setIsAnalyzing(true);
    try {
      const response = await post('/api/ai-assistant/analyze-troubleshooting', {
        photos: photos.map(p => ({ data: p.data, type: p.type })),
        equipment: {
          name: equipment?.name || equipment?.equipment_name,
          type: equipmentType,
          code: equipment?.code || equipment?.tag
        }
      });

      if (response?.suggestion) {
        setAiSuggestion(response.suggestion);
      }
    } catch (e) {
      console.error('AI analysis error:', e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Auto-correct text and move to next step
  const handleDescriptionNext = async () => {
    // Only improve if there's text to improve
    if (formData.title || formData.description || formData.root_cause || formData.solution) {
      setIsImproving(true);
      try {
        const response = await post('/api/ai-assistant/improve-troubleshooting-text', {
          title: formData.title,
          description: formData.description,
          root_cause: formData.root_cause,
          solution: formData.solution
        });

        if (response?.success && response?.improved) {
          setFormData(prev => ({
            ...prev,
            title: response.improved.title || prev.title,
            description: response.improved.description || prev.description,
            root_cause: response.improved.root_cause || prev.root_cause,
            solution: response.improved.solution || prev.solution
          }));
        }
      } catch (e) {
        console.error('Text improvement error:', e);
      } finally {
        setIsImproving(false);
      }
    }
    // Move to next step
    setStep(3);
  };

  // Calculate started_at and completed_at from form data
  const calculateTimestamps = () => {
    let started_at = new Date();
    let completed_at = new Date();

    if (formData.intervention_date && formData.start_time) {
      const [hours, minutes] = formData.start_time.split(':').map(Number);
      started_at = new Date(`${formData.intervention_date}T${formData.start_time}:00`);

      // Calculate end time: start + duration
      if (formData.duration_minutes > 0) {
        completed_at = new Date(started_at.getTime() + formData.duration_minutes * 60 * 1000);
      } else {
        completed_at = started_at;
      }
    } else if (formData.intervention_date) {
      started_at = new Date(`${formData.intervention_date}T12:00:00`);
      completed_at = started_at;
    }

    return { started_at, completed_at };
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const { started_at, completed_at } = calculateTimestamps();

      const payload = {
        equipment_type: equipmentType,
        equipment_id: equipment?.id,
        equipment_name: equipment?.name || equipment?.equipment_name,
        equipment_code: equipment?.code || equipment?.tag,
        building_code: equipment?.building_code || equipment?.building,
        floor: equipment?.floor,
        zone: equipment?.zone,
        room: equipment?.room,
        ...formData,
        started_at: started_at.toISOString(),
        completed_at: completed_at.toISOString(),
        technician_name: userName,
        technician_email: userEmail,
        ai_diagnosis: aiSuggestion || null,
        photos: photos.map(p => ({
          data: p.data,
          caption: p.caption,
          type: p.type
        })),
        // Support for multiple equipment
        additional_equipment: additionalEquipment || []
      };

      const response = await post('/api/troubleshooting/create', payload);

      if (response?.success) {
        setRecordId(response.id);
        setSuccess(true);
        onSuccess?.(response);
      }
    } catch (e) {
      console.error('Submit error:', e);
      alert('Erreur lors de l\'enregistrement: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewReport = () => {
    if (recordId) {
      window.open(`${API_BASE}/api/troubleshooting/${recordId}/pdf`, '_blank');
    }
  };

  const handleNewTroubleshooting = () => {
    setStep(1);
    setPhotos([]);
    setFormData({
      title: '',
      description: '',
      root_cause: '',
      solution: '',
      parts_replaced: '',
      severity: '',
      category: '',
      fault_type: '',
      intervention_date: new Date().toISOString().split('T')[0],
      start_time: '',
      duration_minutes: 0,
      downtime_minutes: 0
    });
    setSuccess(false);
    setRecordId(null);
    setAiSuggestion('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-4 sm:p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="p-2 bg-white/20 rounded-xl flex-shrink-0">
                <Wrench size={20} className="sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold">Dépannage</h2>
                <p className="text-white/80 text-xs sm:text-sm truncate">
                  {equipment?.name || equipment?.equipment_name || 'Équipement'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Progress bar */}
          {!success && (
            <div className="mt-6">
              <div className="flex justify-between mb-2">
                {['Photos', 'Description', 'Classification', 'Validation'].map((label, i) => (
                  <div key={i} className={`text-xs ${step > i ? 'text-white' : 'text-white/50'}`}>
                    {label}
                  </div>
                ))}
              </div>
              <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-500"
                  style={{ width: `${(step / 4) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(95vh-150px)] sm:max-h-[calc(90vh-180px)]">
          {success ? (
            <SuccessScreen
              recordId={recordId}
              onClose={onClose}
              onViewReport={handleViewReport}
              onNewTroubleshooting={handleNewTroubleshooting}
            />
          ) : (
            <>
              {step === 1 && (
                <PhotoStep
                  photos={photos}
                  setPhotos={setPhotos}
                  onNext={() => setStep(2)}
                />
              )}
              {step === 2 && (
                <DescriptionStep
                  formData={formData}
                  setFormData={setFormData}
                  onNext={handleDescriptionNext}
                  onBack={() => setStep(1)}
                  isAnalyzing={isAnalyzing}
                  aiSuggestion={aiSuggestion}
                  isImproving={isImproving}
                />
              )}
              {step === 3 && (
                <ClassificationStep
                  formData={formData}
                  setFormData={setFormData}
                  onNext={() => setStep(4)}
                  onBack={() => setStep(2)}
                />
              )}
              {step === 4 && (
                <SummaryStep
                  formData={formData}
                  photos={photos}
                  equipment={equipment}
                  additionalEquipment={additionalEquipment}
                  onBack={() => setStep(3)}
                  onSubmit={handleSubmit}
                  isSubmitting={isSubmitting}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TROUBLESHOOTING BUTTON - À utiliser dans les pages équipement
// ============================================================
export function TroubleshootingButton({ equipment, equipmentType, onSuccess, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all shadow-lg hover:shadow-xl ${className}`}
      >
        <Wrench size={18} />
        <span>Dépannage</span>
      </button>

      <TroubleshootingWizard
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        equipment={equipment}
        equipmentType={equipmentType}
        onSuccess={(record) => {
          onSuccess?.(record);
          // Optionally close after a delay
          setTimeout(() => setIsOpen(false), 3000);
        }}
      />
    </>
  );
}

// ============================================================
// TROUBLESHOOTING HISTORY - Liste des dépannages d'un équipement
// ============================================================
export function TroubleshootingHistory({ equipmentId, equipmentType, limit = 5, onRefresh }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    loadHistory();
  }, [equipmentId, equipmentType]);

  const loadHistory = async () => {
    try {
      const response = await get(`/api/troubleshooting/list?equipment_type=${equipmentType}&equipment_id=${equipmentId}&limit=${limit}`);
      if (response?.records) {
        setRecords(response.records);
      }
    } catch (e) {
      console.error('Load history error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (recordId, title) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le dépannage "${title}" ?\n\nCette action est irréversible.`)) {
      return;
    }

    setDeleting(recordId);
    try {
      const response = await fetch(`${API_BASE}/api/troubleshooting/${recordId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setRecords(prev => prev.filter(r => r.id !== recordId));
        onRefresh?.();
      } else {
        alert('Erreur lors de la suppression');
      }
    } catch (e) {
      console.error('Delete error:', e);
      alert('Erreur lors de la suppression: ' + e.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        Aucun dépannage enregistré
      </div>
    );
  }

  const severityColors = {
    critical: 'bg-red-100 text-red-700',
    major: 'bg-orange-100 text-orange-700',
    minor: 'bg-yellow-100 text-yellow-700',
    cosmetic: 'bg-gray-100 text-gray-700'
  };

  return (
    <div className="space-y-3">
      {records.map((record, idx) => (
        <div
          key={record.id}
          className="p-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
          onClick={() => navigate(`/app/troubleshooting/${record.id}`)}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  #{record.row_number || idx + 1}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${severityColors[record.severity] || 'bg-gray-100 text-gray-700'}`}>
                  {record.severity}
                </span>
              </div>
              <h4 className="font-medium text-gray-900 truncate">{record.title}</h4>
              <p className="text-sm text-gray-500 truncate mt-0.5">{record.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>{new Date(record.created_at).toLocaleDateString('fr-FR')}</span>
            <span>{record.technician_name}</span>
            {record.photo_count > 0 && (
              <span className="flex items-center gap-1">
                <Image size={12} />
                {record.photo_count}
              </span>
            )}
          </div>

          <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => navigate(`/app/troubleshooting/${record.id}`)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors"
            >
              <Eye size={12} />
              Voir
            </button>
            <a
              href={`${API_BASE}/api/troubleshooting/${record.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <Download size={12} />
              PDF
            </a>
            {canDeleteTroubleshooting(record) && (
              <button
                onClick={() => handleDelete(record.id, record.title)}
                disabled={deleting === record.id}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting === record.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                Supprimer
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
