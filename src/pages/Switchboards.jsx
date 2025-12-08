import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2, Layers, DoorOpen,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Sparkles, Shield, Upload, FileSpreadsheet, ArrowRight, ArrowLeft,
  Settings, Info, Download, RefreshCw, Eye, ImagePlus, ShieldCheck, AlertCircle,
  Menu, FileText, Printer, Share2, Link, ExternalLink, GitBranch, ArrowUpRight,
  MapPin, Phone, Mail
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== ANIMATION COMPONENTS ====================

const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div 
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// Progress Ring Component
const ProgressRing = ({ progress, size = 40, strokeWidth = 4 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#10b981"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
    </svg>
  );
};

// ==================== INPUT STYLES ====================

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900";
const inputSmallClass = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400";

// ==================== MODAL COMPONENTS ====================

// Site Settings Modal (Logo & Company Info)
const SiteSettingsModal = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState({
    company_name: '', company_address: '', company_phone: '', company_email: ''
  });
  const [hasLogo, setHasLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const data = await api.switchboard.getSettings();
      setSettings({
        company_name: data.company_name || '',
        company_address: data.company_address || '',
        company_phone: data.company_phone || '',
        company_email: data.company_email || ''
      });
      setHasLogo(data.has_logo);
      if (data.has_logo) {
        setLogoPreview(api.switchboard.logoUrl({ bust: true }));
      } else {
        setLogoPreview(null);
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await api.switchboard.updateSettings(settings);
      alert('Paramètres enregistrés ! Ils apparaîtront sur les exports PDF.');
      onClose();
    } catch (e) {
      console.error("Failed to save", e);
      alert("Erreur lors de l'enregistrement");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    try {
      await api.switchboard.uploadLogo(file);
      setHasLogo(true);
    } catch (err) {
      console.error("Logo upload failed", err);
      alert("Erreur lors de l'upload du logo");
    }
  };

  const handleDeleteLogo = async () => {
    if (!confirm("Supprimer le logo ?")) return;
    try {
      await api.switchboard.deleteLogo();
      setHasLogo(false);
      setLogoPreview(null);
    } catch (e) {
      console.error("Delete logo failed", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-gray-700 to-gray-900 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Settings size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Paramètres PDF & Site</h2>
              <p className="text-gray-300 text-sm">Personnalisez l'entête des exports</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Logo Section */}
          <div className="flex items-center gap-6">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-gray-50 transition-all relative overflow-hidden group"
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="text-center text-gray-400">
                  <ImagePlus size={24} className="mx-auto mb-1" />
                  <span className="text-[10px]">Logo</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Edit3 size={16} className="text-white" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">Logo de l'entreprise</h3>
              <p className="text-sm text-gray-500 mb-2">Sera affiché en haut à gauche des PDF.</p>
              {hasLogo && (
                <button 
                  onClick={handleDeleteLogo}
                  className="text-xs text-red-600 hover:text-red-800 flex items-center gap-1"
                >
                  <Trash2 size={12} /> Supprimer le logo
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'entreprise</label>
              <input 
                type="text" 
                value={settings.company_name} 
                onChange={e => setSettings(s => ({...s, company_name: e.target.value}))}
                className={inputBaseClass}
                placeholder="Ex: Mon Electricien SA"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
              <input 
                type="text" 
                value={settings.company_address} 
                onChange={e => setSettings(s => ({...s, company_address: e.target.value}))}
                className={inputBaseClass}
                placeholder="Ex: 12 Rue des Disjoncteurs, 75000 Paris"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input 
                  type="text" 
                  value={settings.company_phone} 
                  onChange={e => setSettings(s => ({...s, company_phone: e.target.value}))}
                  className={inputBaseClass}
                  placeholder="01 23 45 67 89"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input 
                  type="email" 
                  value={settings.company_email} 
                  onChange={e => setSettings(s => ({...s, company_email: e.target.value}))}
                  className={inputBaseClass}
                  placeholder="contact@example.com"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          <button onClick={handleSave} disabled={isLoading} className="flex-1 py-3 px-4 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center justify-center gap-2">
            {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};

// Import Excel Modal
const ImportExcelModal = ({ isOpen, onClose, onImport, isLoading }) => {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.xlsx') || droppedFile?.name.endsWith('.xls')) {
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) setFile(selectedFile);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Import Excel</h2>
              <p className="text-emerald-100 text-sm">Importez une liste de départs</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
              ${dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50'}
              ${file ? 'border-emerald-500 bg-emerald-50' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="space-y-2">
                <CheckCircle className="mx-auto text-emerald-500" size={40} />
                <p className="font-medium text-emerald-700">{file.name}</p>
                <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto text-gray-400" size={40} />
                <p className="font-medium text-gray-700">Glissez votre fichier Excel ici</p>
                <p className="text-sm text-gray-500">ou cliquez pour parcourir</p>
              </div>
            )}
          </div>

          {/* Features */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              Extraction automatique :
            </p>
            <ul className="text-sm text-gray-600 space-y-1 ml-6">
              <li>• Nom du tableau (ligne 2)</li>
              <li>• Code tableau (ligne 4)</li>
              <li>• Bâtiment et étage depuis le code</li>
              <li>• Liste des départs</li>
            </ul>
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Info size={12} />
              La détection DDR se fait uniquement via l'analyse photo IA
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex gap-3">
          <button
            onClick={() => { setFile(null); onClose(); }}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => file && onImport(file)}
            disabled={!file || isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Import...
              </>
            ) : (
              <>
                <Download size={18} />
                Importer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Delete Confirm Modal
const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, itemName, itemType = 'tableau', isLoading }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Confirmer la suppression</h2>
              <p className="text-red-100 text-sm">Cette action est irréversible</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-700">
            Êtes-vous sûr de vouloir supprimer le {itemType} <span className="font-semibold text-gray-900">"{itemName}"</span> ?
          </p>
          {itemType === 'tableau' && (
            <p className="mt-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              Tous les disjoncteurs associés seront également supprimés.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium hover:from-red-600 hover:to-rose-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Trash2 size={18} />
            )}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
};

// Share Link Modal
const ShareLinkModal = ({ isOpen, onClose, board }) => {
  const [copied, setCopied] = useState(false);
  
  if (!isOpen || !board) return null;
  
  const url = `${window.location.origin}${window.location.pathname}?board=${board.id}`;
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Partager le lien</h2>
              <p className="text-blue-100 text-sm">{board.name}</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              readOnly
              className={`${inputBaseClass} flex-1 text-sm font-mono`}
            />
            <button
              onClick={handleCopy}
              className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
                copied 
                  ? 'bg-emerald-100 text-emerald-700' 
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              }`}
            >
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? 'Copié!' : 'Copier'}
            </button>
          </div>
          
          <p className="text-sm text-gray-500">
            Ce lien ouvrira directement ce tableau électrique.
          </p>
        </div>
        
        <div className="border-t p-4">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

// AI Photo Wizard
const AIPhotoWizard = ({ isOpen, onClose, onComplete }) => {
  const [step, setStep] = useState(1);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoResult, setPhotoResult] = useState(null);
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setPhoto(null);
      setPhotoPreview(null);
      setPhotoResult(null);
      setDeviceSpecs(null);
      setError(null);
    }
  }, [isOpen]);

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onload = (e) => setPhotoPreview(e.target.result);
      reader.readAsDataURL(file);
      setError(null);
    }
  };

  const analyzePhoto = async () => {
    if (!photo) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.switchboard.analyzePhoto(photo);
      if (result.error && !result.manufacturer && !result.reference) {
        setError(result.error);
      } else {
        setPhotoResult(result);
        setStep(2);
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setIsLoading(false);
    }
  };

  const searchSpecs = async () => {
    if (!photoResult?.quick_ai_query) return;
    setIsLoading(true);
    setError(null);
    try {
      const specs = await api.switchboard.searchDevice(photoResult.quick_ai_query);
      if (specs.error) {
        setError(specs.error);
      } else {
        // Merge photo results with specs
        setDeviceSpecs({
          ...specs,
          manufacturer: photoResult.manufacturer || specs.manufacturer,
          reference: photoResult.reference || specs.reference,
          is_differential: photoResult.is_differential || specs.is_differential
        });
        setStep(3);
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de la recherche');
    } finally {
      setIsLoading(false);
    }
  };

  const handleComplete = () => {
    if (deviceSpecs) {
      onComplete(deviceSpecs);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Analyse IA</h2>
              <p className="text-violet-100 text-sm">Identifiez automatiquement votre disjoncteur</p>
            </div>
          </div>
          
          {/* Progress Steps */}
          <div className="flex items-center justify-center mt-4 gap-2">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                  ${step >= s ? 'bg-white text-violet-600' : 'bg-white/30 text-white'}`}>
                  {s}
                </div>
                {s < 3 && (
                  <div className={`w-12 h-1 rounded transition-all ${step > s ? 'bg-white' : 'bg-white/30'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Step 1: Photo */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 1 : Prenez une photo</h3>
                <p className="text-sm text-gray-500 mt-1">Photographiez la face avant du disjoncteur</p>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
                  ${photoPreview ? 'border-violet-500 bg-violet-50' : 'border-gray-300 hover:border-violet-400'}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setPhoto(null); setPhotoPreview(null); }}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Camera className="mx-auto text-gray-400" size={48} />
                    <p className="font-medium text-gray-700">Cliquez pour prendre une photo</p>
                    <p className="text-sm text-gray-500">ou sélectionnez une image</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Photo Analysis Result */}
          {step === 2 && photoResult && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 2 : Identification</h3>
                <p className="text-sm text-gray-500 mt-1">Vérifiez les informations détectées</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Fabricant</span>
                  <span className="font-semibold text-gray-900">{photoResult.manufacturer || 'Non détecté'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Référence</span>
                  <span className="font-semibold text-gray-900">{photoResult.reference || 'Non détecté'}</span>
                </div>
                {photoResult.is_differential && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Type</span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium flex items-center gap-1">
                      <ShieldCheck size={14} />
                      Différentiel
                    </span>
                  </div>
                )}
              </div>

              {photoPreview && (
                <div className="flex justify-center">
                  <img src={photoPreview} alt="Device" className="max-h-32 rounded-lg opacity-50" />
                </div>
              )}
            </div>
          )}

          {/* Step 3: Full Specs */}
          {step === 3 && deviceSpecs && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 3 : Spécifications complètes</h3>
                <p className="text-sm text-gray-500 mt-1">Données techniques récupérées par l'IA</p>
              </div>

              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 space-y-2 max-h-64 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Fabricant</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.manufacturer || '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Référence</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.reference || '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Calibre</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.in_amps ? `${deviceSpecs.in_amps} A` : '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Icu</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.icu_ka ? `${deviceSpecs.icu_ka} kA` : '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Pôles</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.poles || '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Tension</span>
                    <p className="font-semibold text-gray-900">{deviceSpecs.voltage_v ? `${deviceSpecs.voltage_v} V` : '-'}</p>
                  </div>
                </div>
                {deviceSpecs.is_differential && (
                  <div className="bg-purple-100 text-purple-700 rounded-lg p-2 text-center font-medium flex items-center justify-center gap-2">
                    <ShieldCheck size={16} />
                    Protection différentielle
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex gap-3">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <ArrowLeft size={18} />
              Retour
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          
          {step === 1 && (
            <button
              onClick={analyzePhoto}
              disabled={!photo || isLoading}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:from-violet-600 hover:to-purple-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Eye size={18} />}
              Analyser
            </button>
          )}
          
          {step === 2 && (
            <button
              onClick={searchSpecs}
              disabled={isLoading}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium hover:from-violet-600 hover:to-purple-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
              Rechercher specs
            </button>
          )}
          
          {step === 3 && (
            <button
              onClick={handleComplete}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:from-emerald-600 hover:to-teal-700 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} />
              Utiliser ces données
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Mobile Tree Drawer
const MobileTreeDrawer = ({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, expandedFloors, setExpandedFloors, selectedBoard, onSelectBoard, deviceCounts, getProgress }) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      {/* Drawer */}
      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Arborescence</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>
        
        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {Object.entries(tree).map(([building, floors]) => (
              <div key={building}>
                <button
                  onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Building2 size={16} className="text-blue-500" />
                  <span className="font-medium truncate flex-1">{building}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {Object.values(floors).flat().length}
                  </span>
                </button>
                
                {expandedBuildings[building] && (
                  <div className="ml-4 space-y-1 mt-1">
                    {Object.entries(floors).map(([floor, floorBoards]) => (
                      <div key={floor}>
                        <button
                          onClick={() => setExpandedFloors(prev => ({ ...prev, [`${building}-${floor}`]: !prev[`${building}-${floor}`] }))}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          {expandedFloors[`${building}-${floor}`] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <Layers size={14} className="text-amber-500" />
                          <span className="text-sm truncate flex-1">Étage {floor}</span>
                          <span className="text-xs text-gray-400">{floorBoards.length}</span>
                        </button>
                        
                        {expandedFloors[`${building}-${floor}`] && (
                          <div className="ml-4 space-y-1 mt-1">
                            {floorBoards.map(board => (
                              <button
                                key={board.id}
                                onClick={() => { onSelectBoard(board); onClose(); }}
                                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg transition-all
                                  ${selectedBoard?.id === board.id 
                                    ? 'bg-blue-100 text-blue-700 shadow-sm' 
                                    : 'text-gray-600 hover:bg-gray-100'}`}
                              >
                                <Zap size={14} className={board.is_principal ? 'text-emerald-500' : 'text-gray-400'} />
                                <span className="text-sm truncate flex-1">{board.name}</span>
                                {deviceCounts[board.id]?.total > 0 && (
                                  <ProgressRing progress={getProgress(board.id)} size={20} strokeWidth={2} />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export default function Switchboards() {
  // URL params for deep linking
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // State
  const [boards, setBoards] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceCounts, setDeviceCounts] = useState({});
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedFloors, setExpandedFloors] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  
  // Form state
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [boardForm, setBoardForm] = useState({ name: '', code: '', building_code: '', floor: '', room: '', regime_neutral: 'TN-S', is_principal: false });
  const [deviceForm, setDeviceForm] = useState({
    name: '', device_type: 'Low Voltage Circuit Breaker', manufacturer: '', reference: '',
    in_amps: '', icu_ka: '', ics_ka: '', poles: 3, voltage_v: 400, trip_unit: '',
    position_number: '', is_differential: false, is_main_incoming: false,
    downstream_switchboard_id: null, downstream_name: '', // Added for downstream linking
    settings: { ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' }
  });
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [editingDeviceId, setEditingDeviceId] = useState(null);

  // Downstream Search State
  const [downstreamSearch, setDownstreamSearch] = useState('');
  const [downstreamResults, setDownstreamResults] = useState([]);
  const [showDownstreamResults, setShowDownstreamResults] = useState(false);

  // Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showAIWizard, setShowAIWizard] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  // Photo upload refs
  const boardPhotoRef = useRef(null);

  // Effects
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadBoards();
  }, []);

  // Handle URL params for deep linking (CORRECTED)
  useEffect(() => {
    const boardId = searchParams.get('board');
    if (boardId) {
      // If we have an ID in URL but not loaded in state, or different ID
      if (!selectedBoard || selectedBoard.id !== Number(boardId)) {
        api.switchboard.getBoard(boardId)
          .then(board => {
            if (board) {
              setSelectedBoard(board);
              // Expand tree to show this board
              const building = board.meta?.building_code || 'Sans bâtiment';
              const floor = board.meta?.floor || 'Sans étage';
              setExpandedBuildings(prev => ({ ...prev, [building]: true }));
              setExpandedFloors(prev => ({ ...prev, [`${building}-${floor}`]: true }));
            }
          })
          .catch(console.error);
      }
    } else {
      // URL has no board ID -> Clear selection
      if (selectedBoard) {
        setSelectedBoard(null);
      }
    }
  }, [searchParams]); // Dependent only on URL changes

  useEffect(() => {
    if (selectedBoard) {
      loadDevices(selectedBoard.id);
    }
  }, [selectedBoard]);

  // Downstream Search Effect
  useEffect(() => {
    const search = async () => {
      if (!downstreamSearch) {
        setDownstreamResults([]);
        return;
      }
      try {
        const res = await api.switchboard.searchDownstreams(downstreamSearch);
        // Filter out current board to avoid circular link to self
        const results = (res.suggestions || []).filter(b => b.id !== selectedBoard?.id);
        setDownstreamResults(results);
      } catch (err) {
        console.error('Search downstreams error:', err);
      }
    };
    
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [downstreamSearch, selectedBoard]);

  // API calls
  const loadBoards = async () => {
    setIsLoading(true);
    try {
      const res = await api.switchboard.listBoards({ pageSize: 100 });
      setBoards(res.data || []);
      // Load device counts
      if (res.data?.length) {
        const counts = await api.switchboard.getDeviceCounts(res.data.map(b => b.id));
        setDeviceCounts(counts.counts || {});
      }
    } catch (err) {
      console.error('Load boards error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDevices = async (boardId) => {
    try {
      const res = await api.switchboard.listDevices(boardId);
      setDevices(res.data || []);
    } catch (err) {
      console.error('Load devices error:', err);
    }
  };

  // Select board handler wrapper to fetch full details AND update URL
  const handleSelectBoard = async (board) => {
    // 1. Update URL (Source of Truth)
    setSearchParams({ board: board.id.toString() });
    
    // 2. Fetch data
    try {
      const fullBoard = await api.switchboard.getBoard(board.id);
      setSelectedBoard(fullBoard);
    } catch (err) {
      console.error('Failed to fetch full board details', err);
      setSelectedBoard(board); // Fallback
    }
  };

  // Close board handler
  const handleCloseBoard = () => {
    setSelectedBoard(null);
    setSearchParams({}); // Clear URL param
  };

  // Board handlers
  const handleSaveBoard = async () => {
    try {
      const payload = {
        name: boardForm.name,
        code: boardForm.code,
        meta: { building_code: boardForm.building_code, floor: boardForm.floor, room: boardForm.room },
        regime_neutral: boardForm.regime_neutral,
        is_principal: boardForm.is_principal
      };
      
      let newBoard;
      if (editingBoardId) {
        newBoard = await api.switchboard.updateBoard(editingBoardId, payload);
      } else {
        newBoard = await api.switchboard.createBoard(payload);
      }
      
      await loadBoards();
      if (editingBoardId && selectedBoard?.id === editingBoardId) {
        // Refresh selected board details including upstream info
        const updated = await api.switchboard.getBoard(editingBoardId);
        setSelectedBoard(updated);
      }
      resetBoardForm();
    } catch (err) {
      console.error('Save board error:', err);
    }
  };

  const handleDeleteBoard = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.switchboard.deleteBoard(deleteTarget.id);
      if (selectedBoard?.id === deleteTarget.id) {
        handleCloseBoard();
        setDevices([]);
      }
      await loadBoards();
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete board error:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBoardPhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedBoard) return;
    try {
      await api.switchboard.uploadBoardPhoto(selectedBoard.id, file);
      await loadBoards();
      // Update selected board
      setSelectedBoard(prev => ({ ...prev, has_photo: true }));
    } catch (err) {
      console.error('Photo upload error:', err);
    }
  };

  // Device handlers
  const handleSaveDevice = async () => {
    if (!selectedBoard) return;
    try {
      const payload = {
        ...deviceForm,
        switchboard_id: selectedBoard.id,
        in_amps: deviceForm.in_amps ? Number(deviceForm.in_amps) : null,
        icu_ka: deviceForm.icu_ka ? Number(deviceForm.icu_ka) : null,
        ics_ka: deviceForm.ics_ka ? Number(deviceForm.ics_ka) : null,
        poles: deviceForm.poles ? Number(deviceForm.poles) : null,
        voltage_v: deviceForm.voltage_v ? Number(deviceForm.voltage_v) : null,
        downstream_switchboard_id: deviceForm.downstream_switchboard_id || null
      };
      
      if (editingDeviceId) {
        await api.switchboard.updateDevice(editingDeviceId, payload);
      } else {
        await api.switchboard.createDevice(payload);
      }
      
      await loadDevices(selectedBoard.id);
      await loadBoards(); // Refresh counts
      resetDeviceForm();
    } catch (err) {
      console.error('Save device error:', err);
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    try {
      await api.switchboard.deleteDevice(deviceId);
      await loadDevices(selectedBoard.id);
      await loadBoards();
    } catch (err) {
      console.error('Delete device error:', err);
    }
  };

  // Print PDF
  const handlePrintPDF = async () => {
    if (!selectedBoard) return;
    setIsPrinting(true);
    try {
      // Call backend API to generate PDF
      const response = await fetch(`${api.baseURL}/api/switchboard/boards/${selectedBoard.id}/pdf?site=${api.site}`, {
        method: 'GET',
        headers: {
          'X-Site': api.site
        }
      });
      
      if (!response.ok) throw new Error('PDF generation failed');
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      // Open in new tab or download
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBoard.code || selectedBoard.name}_listing.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Print PDF error:', err);
      alert('Erreur lors de la génération du PDF. Vérifiez que l\'endpoint est disponible.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Import Excel
  const handleImportExcel = async (file) => {
    setIsImporting(true);
    try {
      const result = await api.switchboard.importExcel(file);
      if (result.success) {
        await loadBoards();
        // Select the imported board with full details
        if (result.switchboard?.id) {
           const boardDetail = await api.switchboard.getBoard(result.switchboard.id);
           handleSelectBoard(boardDetail); // Use handleSelectBoard to set URL
        }
        
        setShowImportModal(false);
        alert(`Import réussi!\n${result.devices_created} disjoncteurs créés pour "${result.switchboard.name}"`);
      }
    } catch (err) {
      console.error('Import error:', err);
      alert('Erreur lors de l\'import: ' + (err.message || 'Erreur inconnue'));
    } finally {
      setIsImporting(false);
    }
  };

  // AI Wizard complete
  const handleAIComplete = (specs) => {
    setDeviceForm(prev => ({
      ...prev,
      manufacturer: specs.manufacturer || prev.manufacturer,
      reference: specs.reference || prev.reference,
      device_type: specs.device_type || prev.device_type,
      in_amps: specs.in_amps || prev.in_amps,
      icu_ka: specs.icu_ka || prev.icu_ka,
      ics_ka: specs.ics_ka || prev.ics_ka,
      poles: specs.poles || prev.poles,
      voltage_v: specs.voltage_v || prev.voltage_v,
      trip_unit: specs.trip_unit || prev.trip_unit,
      is_differential: specs.is_differential || prev.is_differential,
      settings: specs.settings || prev.settings
    }));
  };

  // Form reset
  const resetBoardForm = () => {
    setBoardForm({ name: '', code: '', building_code: '', floor: '', room: '', regime_neutral: 'TN-S', is_principal: false });
    setEditingBoardId(null);
    setShowBoardForm(false);
  };

  const resetDeviceForm = () => {
    setDeviceForm({
      name: '', device_type: 'Low Voltage Circuit Breaker', manufacturer: '', reference: '',
      in_amps: '', icu_ka: '', ics_ka: '', poles: 3, voltage_v: 400, trip_unit: '',
      position_number: '', is_differential: false, is_main_incoming: false,
      downstream_switchboard_id: null, downstream_name: '',
      settings: { ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' }
    });
    setEditingDeviceId(null);
    setDownstreamSearch('');
    setShowDeviceForm(false);
  };

  // Edit handlers
  const startEditBoard = (board) => {
    setBoardForm({
      name: board.name,
      code: board.code,
      building_code: board.meta?.building_code || '',
      floor: board.meta?.floor || '',
      room: board.meta?.room || '',
      regime_neutral: board.regime_neutral || 'TN-S',
      is_principal: board.is_principal || false
    });
    setEditingBoardId(board.id);
    setShowBoardForm(true);
  };

  const startEditDevice = (device) => {
    setDeviceForm({
      name: device.name || '',
      device_type: device.device_type,
      manufacturer: device.manufacturer || '',
      reference: device.reference || '',
      in_amps: device.in_amps || '',
      icu_ka: device.icu_ka || '',
      ics_ka: device.ics_ka || '',
      poles: device.poles || 3,
      voltage_v: device.voltage_v || 400,
      trip_unit: device.trip_unit || '',
      position_number: device.position_number || '',
      is_differential: device.is_differential || false,
      is_main_incoming: device.is_main_incoming || false,
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      downstream_name: device.downstream_switchboard_name || '',
      settings: device.settings || { ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' }
    });
    setEditingDeviceId(device.id);
    setDownstreamSearch(''); // Reset search on edit open
    setShowDeviceForm(true);
  };

  // Build tree structure
  const buildTree = useCallback(() => {
    const tree = {};
    const filtered = boards.filter(b => 
      !searchQuery || 
      b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.code?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    filtered.forEach(b => {
      const building = b.meta?.building_code || 'Sans bâtiment';
      const floor = b.meta?.floor || 'Sans étage';
      if (!tree[building]) tree[building] = {};
      if (!tree[building][floor]) tree[building][floor] = [];
      tree[building][floor].push(b);
    });
    return tree;
  }, [boards, searchQuery]);

  const tree = buildTree();

  // Calculate progress
  const getProgress = (boardId) => {
    const counts = deviceCounts[boardId];
    if (!counts || counts.total === 0) return 0;
    return Math.round((counts.complete / counts.total) * 100);
  };

  // ==================== RENDER ====================

  // Sidebar Tree (Desktop)
  const renderTree = () => (
    <div className="space-y-1">
      {Object.entries(tree).map(([building, floors]) => (
        <div key={building}>
          <button
            onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {expandedBuildings[building] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Building2 size={16} className="text-blue-500" />
            <span className="font-medium truncate">{building}</span>
            <span className="ml-auto text-xs text-gray-400">
              {Object.values(floors).flat().length}
            </span>
          </button>
          
          {expandedBuildings[building] && (
            <div className="ml-4 space-y-1">
              {Object.entries(floors).map(([floor, floorBoards]) => (
                <div key={floor}>
                  <button
                    onClick={() => setExpandedFloors(prev => ({ ...prev, [`${building}-${floor}`]: !prev[`${building}-${floor}`] }))}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    {expandedFloors[`${building}-${floor}`] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Layers size={14} className="text-amber-500" />
                    <span className="text-sm truncate">Étage {floor}</span>
                    <span className="ml-auto text-xs text-gray-400">{floorBoards.length}</span>
                  </button>
                  
                  {expandedFloors[`${building}-${floor}`] && (
                    <div className="ml-4 space-y-1">
                      {floorBoards.map(board => (
                        <button
                          key={board.id}
                          onClick={() => handleSelectBoard(board)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-all
                            ${selectedBoard?.id === board.id 
                              ? 'bg-blue-100 text-blue-700 shadow-sm' 
                              : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          <Zap size={14} className={board.is_principal ? 'text-emerald-500' : 'text-gray-400'} />
                          <span className="text-sm truncate flex-1">{board.name}</span>
                          {deviceCounts[board.id]?.total > 0 && (
                            <ProgressRing progress={getProgress(board.id)} size={20} strokeWidth={2} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  // Mobile Board Cards
  const renderMobileCards = () => (
    <div className="grid grid-cols-1 gap-3 p-4">
      {boards.filter(b => 
        !searchQuery || 
        b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.code?.toLowerCase().includes(searchQuery.toLowerCase())
      ).map((board, index) => {
        const counts = deviceCounts[board.id];
        const progress = getProgress(board.id);
        
        return (
          <AnimatedCard key={board.id} delay={index * 50}>
            <button
              onClick={() => handleSelectBoard(board)}
              className={`w-full p-4 rounded-xl text-left transition-all shadow-sm
                ${selectedBoard?.id === board.id 
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg' 
                  : 'bg-white hover:shadow-md'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {board.is_principal && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                        Principal
                      </span>
                    )}
                    <span className={`text-xs ${selectedBoard?.id === board.id ? 'text-blue-200' : 'text-gray-400'}`}>
                      {board.code}
                    </span>
                  </div>
                  <h3 className={`font-semibold mt-1 ${selectedBoard?.id === board.id ? 'text-white' : 'text-gray-900'}`}>
                    {board.name}
                  </h3>
                  <div className={`flex items-center gap-3 mt-2 text-sm ${selectedBoard?.id === board.id ? 'text-blue-200' : 'text-gray-500'}`}>
                    <span className="flex items-center gap-1">
                      <Building2 size={14} />
                      {board.meta?.building_code || '-'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Layers size={14} />
                      {board.meta?.floor || '-'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <ProgressRing progress={progress} size={44} strokeWidth={4} />
                  <p className={`text-xs mt-1 ${selectedBoard?.id === board.id ? 'text-blue-200' : 'text-gray-500'}`}>
                    {counts?.complete || 0}/{counts?.total || 0}
                  </p>
                </div>
              </div>
              
              {/* Progress bar */}
              {counts?.total > 0 && (
                <div className={`mt-3 h-1.5 rounded-full overflow-hidden ${selectedBoard?.id === board.id ? 'bg-white/20' : 'bg-gray-100'}`}>
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </button>
          </AnimatedCard>
        );
      })}
    </div>
  );

  // Device Cards
  const renderDeviceCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {devices.map((device, index) => {
        const isComplete = device.is_complete;
        
        return (
          <AnimatedCard key={device.id} delay={index * 30}>
            <div className={`p-4 rounded-xl border transition-all hover:shadow-md relative
              ${device.is_main_incoming ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200' : 'bg-white border-gray-200'}`}
            >
              {/* Downstream Badge */}
              {device.downstream_switchboard_id && (
                <div className="absolute top-0 right-0 p-2">
                   <span 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      handleSelectBoard({ id: device.downstream_switchboard_id }); 
                    }}
                    className="cursor-pointer px-2 py-1 bg-green-100 text-green-700 text-xs rounded-bl-xl rounded-tr-xl font-medium flex items-center gap-1 hover:bg-green-200 transition-colors"
                    title={`Alimente le tableau ${device.downstream_switchboard_name}`}
                   >
                     Vers : {device.downstream_switchboard_code || device.downstream_switchboard_name || 'Tableau'}
                     <ArrowUpRight size={12} />
                   </span>
                </div>
              )}

              {/* Header */}
              <div className="flex items-start justify-between mb-3 mt-2">
                <div className="flex-1 pr-6">
                  <div className="flex items-center gap-2 flex-wrap">
                    {device.position_number && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full font-mono">
                        #{device.position_number}
                      </span>
                    )}
                    {device.is_main_incoming && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                        Arrivée
                      </span>
                    )}
                    {device.is_differential && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium flex items-center gap-1">
                        <ShieldCheck size={12} />
                        DDR
                      </span>
                    )}
                    {!isComplete && (
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full font-medium animate-pulse flex items-center gap-1">
                        <AlertCircle size={12} />
                        Incomplet
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold text-gray-900 mt-1 line-clamp-2">
                    {device.name || device.reference || 'Sans nom'}
                  </h4>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEditDevice(device)}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteDevice(device.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Specs */}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <span className="text-gray-500 text-xs block">In</span>
                  <span className="font-semibold text-gray-900">{device.in_amps ? `${device.in_amps}A` : '-'}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <span className="text-gray-500 text-xs block">Icu</span>
                  <span className="font-semibold text-gray-900">{device.icu_ka ? `${device.icu_ka}kA` : '-'}</span>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <span className="text-gray-500 text-xs block">Pôles</span>
                  <span className="font-semibold text-gray-900">{device.poles || '-'}</span>
                </div>
              </div>

              {/* Manufacturer */}
              {(device.manufacturer || device.reference) && (
                <div className="mt-2 text-xs text-gray-500 truncate">
                  {device.manufacturer} {device.reference}
                </div>
              )}
            </div>
          </AnimatedCard>
        );
      })}
    </div>
  );

  // Board Form Modal
  const renderBoardForm = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white rounded-t-2xl">
          <h2 className="text-xl font-bold">{editingBoardId ? 'Modifier le tableau' : 'Nouveau tableau'}</h2>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom du tableau *</label>
            <input
              type="text"
              value={boardForm.name}
              onChange={(e) => setBoardForm(prev => ({ ...prev, name: e.target.value }))}
              className={inputBaseClass}
              placeholder="ex: Tableau Général"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
            <input
              type="text"
              value={boardForm.code}
              onChange={(e) => setBoardForm(prev => ({ ...prev, code: e.target.value }))}
              className={`${inputBaseClass} font-mono`}
              placeholder="ex: 11-1-04-FL"
            />
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
              <input
                type="text"
                value={boardForm.building_code}
                onChange={(e) => setBoardForm(prev => ({ ...prev, building_code: e.target.value }))}
                className={inputBaseClass}
                placeholder="11"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Étage</label>
              <input
                type="text"
                value={boardForm.floor}
                onChange={(e) => setBoardForm(prev => ({ ...prev, floor: e.target.value }))}
                className={inputBaseClass}
                placeholder="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
              <input
                type="text"
                value={boardForm.room}
                onChange={(e) => setBoardForm(prev => ({ ...prev, room: e.target.value }))}
                className={inputBaseClass}
                placeholder="104"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Régime de neutre</label>
            <select
              value={boardForm.regime_neutral}
              onChange={(e) => setBoardForm(prev => ({ ...prev, regime_neutral: e.target.value }))}
              className={selectBaseClass}
            >
              <option value="TN-S">TN-S</option>
              <option value="TN-C">TN-C</option>
              <option value="TN-C-S">TN-C-S</option>
              <option value="TT">TT</option>
              <option value="IT">IT</option>
            </select>
          </div>
          
          <label className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={boardForm.is_principal}
              onChange={(e) => setBoardForm(prev => ({ ...prev, is_principal: e.target.checked }))}
              className="w-5 h-5 rounded text-emerald-500 focus:ring-emerald-500"
            />
            <div>
              <span className="font-medium text-emerald-700">Tableau principal</span>
              <p className="text-xs text-emerald-600">Point d'alimentation principal du bâtiment</p>
            </div>
          </label>
        </div>
        
        <div className="border-t p-4 flex gap-3">
          <button
            onClick={resetBoardForm}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSaveBoard}
            disabled={!boardForm.name || !boardForm.code}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium hover:from-blue-600 hover:to-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save size={18} />
            {editingBoardId ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );

  // Device Form Modal - CORRECTED CSS FOR MOBILE
  const renderDeviceForm = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-indigo-500 to-purple-600 p-4 sm:p-6 text-white rounded-t-2xl z-10">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg sm:text-xl font-bold">{editingDeviceId ? 'Modifier le disjoncteur' : 'Nouveau disjoncteur'}</h2>
            <button
              onClick={() => setShowAIWizard(true)}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-colors"
            >
              <Sparkles size={16} />
              <span className="hidden xs:inline">Analyser photo</span>
              <span className="xs:hidden">IA</span>
            </button>
          </div>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Désignation</label>
              <input
                type="text"
                value={deviceForm.name}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, name: e.target.value }))}
                className={inputBaseClass}
                placeholder="ex: Prise T15 côté Lausanne"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <input
                type="text"
                value={deviceForm.position_number}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, position_number: e.target.value }))}
                className={`${inputBaseClass} font-mono`}
                placeholder="ex: 1, 9.1"
              />
            </div>
          </div>

          {/* Downstream Board Link (Updated UI) */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
             <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
               <ArrowUpRight size={16} className="text-green-600" />
               Alimentation Aval (Optionnel)
             </label>
             <div className="relative">
                {deviceForm.downstream_switchboard_id ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 p-3 rounded-xl">
                    <div className="flex items-center gap-2">
                       <Zap className="text-green-600" size={18} />
                       <div>
                         <span className="text-sm font-medium text-green-800">Alimente le tableau :</span>
                         <span className="ml-1 text-sm font-bold text-gray-800">{deviceForm.downstream_name}</span>
                       </div>
                    </div>
                    <button 
                      onClick={() => setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: null, downstream_name: '' }))}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={downstreamSearch}
                      onChange={(e) => { setDownstreamSearch(e.target.value); setShowDownstreamResults(true); }}
                      onFocus={() => setShowDownstreamResults(true)}
                      className={inputBaseClass}
                      placeholder="Rechercher un tableau aval (ex: T1-2)..."
                    />
                    {showDownstreamResults && downstreamResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                        {downstreamResults.map(board => (
                          <button
                            key={board.id}
                            onClick={() => {
                              setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: board.id, downstream_name: board.name }));
                              setDownstreamSearch('');
                              setShowDownstreamResults(false);
                            }}
                            className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between"
                          >
                             <span className="font-medium text-gray-900">{board.name}</span>
                             <span className="text-xs text-gray-500 font-mono">{board.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
             </div>
          </div>

          {/* Manufacturer & Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fabricant</label>
              <input
                type="text"
                value={deviceForm.manufacturer}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, manufacturer: e.target.value }))}
                className={inputBaseClass}
                placeholder="ex: Schneider"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Référence</label>
              <input
                type="text"
                value={deviceForm.reference}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, reference: e.target.value }))}
                className={inputBaseClass}
                placeholder="ex: NSX250N"
              />
            </div>
          </div>

          {/* Electrical Specs - CORRECTED: 2 columns on mobile, 4 on desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calibre (A)</label>
              <input
                type="number"
                value={deviceForm.in_amps}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, in_amps: e.target.value }))}
                className={inputBaseClass}
                placeholder="63"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Icu (kA)</label>
              <input
                type="number"
                value={deviceForm.icu_ka}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, icu_ka: e.target.value }))}
                className={inputBaseClass}
                placeholder="36"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pôles</label>
              <select
                value={deviceForm.poles}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, poles: e.target.value }))}
                className={selectBaseClass}
              >
                <option value={1}>1P</option>
                <option value={2}>2P</option>
                <option value={3}>3P</option>
                <option value={4}>4P</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tension (V)</label>
              <input
                type="number"
                value={deviceForm.voltage_v}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, voltage_v: e.target.value }))}
                className={inputBaseClass}
                placeholder="400"
              />
            </div>
          </div>

          {/* Trip Unit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unité de déclenchement</label>
            <input
              type="text"
              value={deviceForm.trip_unit}
              onChange={(e) => setDeviceForm(prev => ({ ...prev, trip_unit: e.target.value }))}
              className={inputBaseClass}
              placeholder="ex: Micrologic 5.2 E"
            />
          </div>

          {/* Checkboxes - CORRECTED: Stack on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={deviceForm.is_differential}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, is_differential: e.target.checked }))}
                className="w-5 h-5 rounded text-purple-500 focus:ring-purple-500 flex-shrink-0"
              />
              <div className="min-w-0">
                <span className="font-medium text-purple-700 flex items-center gap-1">
                  <ShieldCheck size={16} />
                  Différentiel (DDR)
                </span>
                <p className="text-xs text-purple-600">Protection 30mA ou 300mA</p>
              </div>
            </label>
            
            <label className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={deviceForm.is_main_incoming}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, is_main_incoming: e.target.checked }))}
                className="w-5 h-5 rounded text-amber-500 focus:ring-amber-500 flex-shrink-0"
              />
              <div className="min-w-0">
                <span className="font-medium text-amber-700">Disjoncteur d'arrivée</span>
                <p className="text-xs text-amber-600">Protège l'ensemble du tableau</p>
              </div>
            </label>
          </div>

          {/* LSIG Settings (Collapsible) */}
          <details className="bg-gray-50 rounded-xl p-4">
            <summary className="font-medium text-gray-700 cursor-pointer flex items-center gap-2">
              <Settings size={16} />
              Réglages LSIG (optionnel)
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ir (×In)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.ir}
                  onChange={(e) => setDeviceForm(prev => ({ ...prev, settings: { ...prev.settings, ir: e.target.value }}))}
                  className={inputSmallClass}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tr (s)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.tr}
                  onChange={(e) => setDeviceForm(prev => ({ ...prev, settings: { ...prev.settings, tr: e.target.value }}))}
                  className={inputSmallClass}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Isd (×Ir)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.isd}
                  onChange={(e) => setDeviceForm(prev => ({ ...prev, settings: { ...prev.settings, isd: e.target.value }}))}
                  className={inputSmallClass}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ii (×In)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.ii}
                  onChange={(e) => setDeviceForm(prev => ({ ...prev, settings: { ...prev.settings, ii: e.target.value }}))}
                  className={inputSmallClass}
                />
              </div>
            </div>
          </details>
        </div>
        
        <div className="border-t p-4 flex gap-3">
          <button
            onClick={resetDeviceForm}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSaveDevice}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium hover:from-indigo-600 hover:to-purple-700 transition-all flex items-center justify-center gap-2"
          >
            <Save size={18} />
            {editingDeviceId ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );

  // Main Render
  return (
    <div className="min-h-screen bg-gray-50">
      {/* CSS for animations */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slideUp {
          animation: slideUp 0.3s ease-out forwards;
        }
        .animate-slideRight {
          animation: slideRight 0.3s ease-out forwards;
        }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile menu button */}
              {isMobile && (
                <button
                  onClick={() => setShowMobileDrawer(true)}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <Menu size={24} />
                </button>
              )}
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl text-white">
                <Zap size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Tableaux électriques</h1>
                <p className="text-sm text-gray-500">{boards.length} tableaux</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettingsModal(true)}
                className="p-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                title="Paramètres Site & Logo"
              >
                <Settings size={20} />
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 md:px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-medium hover:bg-emerald-200 transition-colors flex items-center gap-2"
              >
                <FileSpreadsheet size={18} />
                <span className="hidden sm:inline">Import Excel</span>
              </button>
              <button
                onClick={() => setShowBoardForm(true)}
                className="px-3 md:px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 transition-all flex items-center gap-2"
              >
                <Plus size={18} />
                <span className="hidden sm:inline">Tableau</span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mt-3 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un tableau..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar (Desktop) */}
        {!isMobile && (
          <div className="w-80 border-r bg-white min-h-screen p-4 sticky top-32 self-start overflow-y-auto max-h-[calc(100vh-8rem)]">
            {renderTree()}
          </div>
        )}

        {/* Mobile: Board List or Detail */}
        {isMobile && !selectedBoard && renderMobileCards()}

        {/* Detail Panel */}
        {selectedBoard && (
          <div className="flex-1 p-4">
            {/* Board Header */}
            <AnimatedCard>
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
                <div className="flex flex-col sm:flex-row">
                  {/* Photo Section */}
                  <div 
                    onClick={() => boardPhotoRef.current?.click()}
                    className="w-full sm:w-32 h-32 bg-gray-100 flex-shrink-0 relative group cursor-pointer"
                  >
                    <input
                      ref={boardPhotoRef}
                      type="file"
                      accept="image/*"
                      onChange={handleBoardPhotoUpload}
                      className="hidden"
                    />
                    {selectedBoard.has_photo ? (
                      <img 
                        src={`${api.baseURL}/api/switchboard/boards/${selectedBoard.id}/photo?site=${api.site}`}
                        alt={selectedBoard.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <ImagePlus size={32} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera size={24} className="text-white" />
                    </div>
                  </div>

                  {/* Info Section */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selectedBoard.is_principal && (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                              Principal
                            </span>
                          )}
                          <span className="text-sm text-gray-500 font-mono">{selectedBoard.code}</span>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mt-1">{selectedBoard.name}</h2>
                        
                        {/* Source (Upstream) Display */}
                        {selectedBoard.upstream_sources && selectedBoard.upstream_sources.length > 0 ? (
                           <div className="mt-1 space-y-1">
                             {selectedBoard.upstream_sources.map(source => (
                               <div key={source.id} className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs px-2 py-1 rounded-md mr-2 border border-amber-200">
                                  <ArrowRight size={12} />
                                  Alimenté par : <span className="font-semibold">{source.source_board_name}</span> (via {source.name})
                               </div>
                             ))}
                           </div>
                        ) : selectedBoard.is_principal ? (
                           <div className="mt-1 inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                             <CheckCircle size={12} /> Source Principale
                           </div>
                        ) : (
                           <div className="mt-1 inline-flex items-center gap-1 text-gray-400 text-xs">
                             <AlertCircle size={12} /> Source non définie
                           </div>
                        )}

                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Building2 size={14} />
                            Bât. {selectedBoard.meta?.building_code || '-'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Layers size={14} />
                            Étage {selectedBoard.meta?.floor || '-'}
                          </span>
                          {selectedBoard.regime_neutral && (
                            <span className="flex items-center gap-1">
                              <Shield size={14} />
                              {selectedBoard.regime_neutral}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Share Link */}
                        <button
                          onClick={() => setShowShareModal(true)}
                          className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                          title="Partager le lien"
                        >
                          <Link size={18} />
                        </button>
                        {/* Print PDF */}
                        <button
                          onClick={handlePrintPDF}
                          disabled={isPrinting}
                          className="p-2 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl transition-colors disabled:opacity-50"
                          title="Imprimer le listing PDF"
                        >
                          {isPrinting ? <RefreshCw size={18} className="animate-spin" /> : <Printer size={18} />}
                        </button>
                        {/* Single Line Diagram */}
                        <button
                          onClick={() => navigate(`/app/switchboards/${selectedBoard.id}/diagram`)}
                          className="p-2 text-gray-400 hover:text-violet-500 hover:bg-violet-50 rounded-xl transition-colors"
                          title="Schéma unifilaire"
                        >
                          <GitBranch size={18} />
                        </button>
                        <button
                          onClick={() => startEditBoard(selectedBoard)}
                          className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                        >
                          <Edit3 size={18} />
                        </button>
                        <button
                          onClick={() => { setDeleteTarget(selectedBoard); setShowDeleteModal(true); }}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                        {isMobile && (
                          <button
                            onClick={handleCloseBoard}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                          >
                            <X size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress */}
                    {deviceCounts[selectedBoard.id]?.total > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-500">Complétion</span>
                          <span className="font-medium text-gray-700">
                            {deviceCounts[selectedBoard.id]?.complete || 0}/{deviceCounts[selectedBoard.id]?.total || 0} ({getProgress(selectedBoard.id)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                            style={{ width: `${getProgress(selectedBoard.id)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </AnimatedCard>

            {/* Devices Section */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                Disjoncteurs ({devices.length})
              </h3>
              <button
                onClick={() => setShowDeviceForm(true)}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-purple-700 transition-all flex items-center gap-2"
              >
                <Plus size={18} />
                Ajouter
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center">
                <Zap size={48} className="mx-auto text-gray-300 mb-4" />
                <h4 className="text-lg font-medium text-gray-700">Aucun disjoncteur</h4>
                <p className="text-gray-500 mt-1">Ajoutez votre premier disjoncteur ou importez depuis Excel</p>
                <div className="flex justify-center gap-3 mt-4">
                  <button
                    onClick={() => setShowDeviceForm(true)}
                    className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-xl font-medium hover:bg-indigo-200 transition-colors"
                  >
                    Ajouter manuellement
                  </button>
                </div>
              </div>
            ) : (
              renderDeviceCards()
            )}
          </div>
        )}

        {/* Empty State (Desktop) */}
        {!isMobile && !selectedBoard && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap size={40} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-700">Sélectionnez un tableau</h3>
              <p className="text-gray-500 mt-1">Choisissez un tableau dans la liste pour voir ses disjoncteurs</p>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Tree Drawer */}
      <MobileTreeDrawer
        isOpen={showMobileDrawer}
        onClose={() => setShowMobileDrawer(false)}
        tree={tree}
        expandedBuildings={expandedBuildings}
        setExpandedBuildings={setExpandedBuildings}
        expandedFloors={expandedFloors}
        setExpandedFloors={setExpandedFloors}
        selectedBoard={selectedBoard}
        onSelectBoard={handleSelectBoard}
        deviceCounts={deviceCounts}
        getProgress={getProgress}
      />

      {/* Modals */}
      <ImportExcelModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportExcel}
        isLoading={isImporting}
      />

      <SiteSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />

      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
        onConfirm={handleDeleteBoard}
        itemName={deleteTarget?.name}
        itemType="tableau"
        isLoading={isDeleting}
      />

      <ShareLinkModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        board={selectedBoard}
      />

      <AIPhotoWizard
        isOpen={showAIWizard}
        onClose={() => setShowAIWizard(false)}
        onComplete={handleAIComplete}
      />

      {showBoardForm && renderBoardForm()}
      {showDeviceForm && renderDeviceForm()}
    </div>
  );
}
