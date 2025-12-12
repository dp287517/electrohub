import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Zap, Plus, Search, ChevronRight, ChevronDown, Building2, Layers,
  MoreVertical, Copy, Trash2, Edit3, Save, X, AlertTriangle, CheckCircle,
  Camera, Sparkles, Shield, Upload, FileSpreadsheet, ArrowRight, ArrowLeft,
  Settings, Info, Download, RefreshCw, Eye, ImagePlus, ShieldCheck, AlertCircle,
  Menu, FileText, Printer, Share2, Link, ExternalLink, GitBranch, ArrowUpRight,
  MapPin, Database, History, Star, ClipboardCheck
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

// Progress Ring Component - Memoized
const ProgressRing = React.memo(({ progress, size = 40, strokeWidth = 4 }) => {
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
});

// Toast Notification Component
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? AlertCircle : Info;

  return (
    <div className={`fixed bottom-4 right-4 z-[200] ${bgColor} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-slideUp`}>
      <Icon size={20} />
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
        <X size={16} />
      </button>
    </div>
  );
};

// ==================== INPUT STYLES ====================

const inputBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400";
const selectBaseClass = "w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900";
const inputSmallClass = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400";

// ==================== IMPORT RESULT MODAL ====================

const ImportResultModal = ({ isOpen, onClose, result }) => {
  if (!isOpen || !result) return null;

  const isWarning = result.already_exists;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
        <div className={`p-6 text-white ${isWarning 
          ? 'bg-gradient-to-r from-amber-500 to-orange-600' 
          : 'bg-gradient-to-r from-emerald-500 to-teal-600'}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              {isWarning ? <AlertTriangle size={24} /> : <CheckCircle size={24} />}
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {isWarning ? 'Tableau existant mis à jour' : 'Import réussi !'}
              </h2>
              <p className={`text-sm ${isWarning ? 'text-amber-100' : 'text-emerald-100'}`}>
                {result.switchboard?.code}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-2">{result.switchboard?.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Code :</span>
                <span className="ml-1 font-mono text-gray-900">{result.switchboard?.code}</span>
              </div>
              <div>
                <span className="text-gray-500">Bâtiment :</span>
                <span className="ml-1 text-gray-900">{result.switchboard?.building || '-'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{result.devices_created}</p>
              <p className="text-xs text-emerald-700">Créés</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-600">{result.devices_skipped}</p>
              <p className="text-xs text-gray-700">Ignorés</p>
            </div>
            {isWarning && (
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{result.existing_devices}</p>
                <p className="text-xs text-amber-700">Existants</p>
              </div>
            )}
          </div>

          {isWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <p className="flex items-start gap-2">
                <Info size={16} className="flex-shrink-0 mt-0.5" />
                Le tableau existait déjà. Les départs avec des positions déjà présentes ont été ignorés.
              </p>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <button
            onClick={onClose}
            className={`w-full py-3 px-4 rounded-xl text-white font-medium transition-all ${
              isWarning 
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700'
            }`}
          >
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== MODAL COMPONENTS ====================

// Site Settings Modal (Logo & Company Info)
const SiteSettingsModal = ({ isOpen, onClose, showToast }) => {
  const [settings, setSettings] = useState({
    company_name: '', company_address: '', company_phone: '', company_email: ''
  });
  const [hasLogo, setHasLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen]);

  const loadSettings = async () => {
    setIsLoading(true);
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
        setLogoPreview(api.switchboard.logoUrl({ bust: false }));
      } else {
        setLogoPreview(null);
      }
    } catch (e) {
      console.error("Failed to load settings", e);
      showToast?.('Erreur lors du chargement des paramètres', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.switchboard.updateSettings(settings);
      showToast?.('Paramètres enregistrés !', 'success');
      onClose();
    } catch (e) {
      console.error("Failed to save", e);
      showToast?.("Erreur lors de l'enregistrement", 'error');
    } finally {
      setIsSaving(false);
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
      showToast?.('Logo uploadé !', 'success');
    } catch (err) {
      console.error("Logo upload failed", err);
      showToast?.("Erreur lors de l'upload du logo", 'error');
      setLogoPreview(null);
    }
  };

  const handleDeleteLogo = async () => {
    if (!confirm("Supprimer le logo ?")) return;
    try {
      await api.switchboard.deleteLogo();
      setHasLogo(false);
      setLogoPreview(null);
      showToast?.('Logo supprimé', 'success');
    } catch (e) {
      console.error("Delete logo failed", e);
      showToast?.('Erreur lors de la suppression', 'error');
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

        {isLoading ? (
          <div className="p-12 flex items-center justify-center">
            <RefreshCw size={32} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
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
        )}

        <div className="border-t p-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          <button 
            onClick={handleSave} 
            disabled={isSaving || isLoading} 
            className="flex-1 py-3 px-4 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
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

  useEffect(() => {
    if (!isOpen) setFile(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.match(/\.xlsx?$/i)) {
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

        <div className="p-6 space-y-4">
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
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Supprimer
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto text-gray-400" size={40} />
                <p className="font-medium text-gray-700">Glissez votre fichier Excel ici</p>
                <p className="text-sm text-gray-500">ou cliquez pour parcourir</p>
              </div>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              Extraction automatique
            </p>
            <ul className="text-sm text-gray-600 space-y-1 ml-6">
              <li>• Nom et code du tableau</li>
              <li>• Liste des départs avec détection doublons</li>
            </ul>
          </div>
        </div>

        <div className="border-t p-4 flex gap-3">
          <button
            onClick={() => { setFile(null); onClose(); }}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={() => file && onImport(file)}
            disabled={!file || isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
const DeleteConfirmModal = ({ isOpen, onClose, onConfirm, itemName, itemType = 'tableau', isLoading, deviceCount = 0 }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
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

        <div className="p-6">
          <p className="text-gray-700">
            Supprimer le {itemType} <span className="font-semibold">"{itemName}"</span> ?
          </p>
          {itemType === 'tableau' && deviceCount > 0 && (
            <p className="mt-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span><strong>{deviceCount}</strong> disjoncteur(s) seront supprimés.</span>
            </p>
          )}
        </div>

        <div className="border-t p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-medium hover:from-red-600 hover:to-rose-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
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
              <p className="text-blue-100 text-sm">{board.code}</p>
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
                copied ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              }`}
            >
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? 'Copié!' : 'Copier'}
            </button>
          </div>
        </div>
        
        <div className="border-t p-4">
          <button
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

// AI Photo Wizard
const AIPhotoWizard = ({ isOpen, onClose, onComplete, showToast }) => {
  const [step, setStep] = useState(1);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoResult, setPhotoResult] = useState(null);
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [cacheSuggestions, setCacheSuggestions] = useState([]);
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
      setCacheSuggestions([]);
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
        if (result.cache_suggestions?.length > 0) {
          setCacheSuggestions(result.cache_suggestions);
        }
        setStep(2);
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setIsLoading(false);
    }
  };

  const searchSpecs = async () => {
    if (!photoResult) return;
    
    const queryParts = [];
    if (photoResult.manufacturer) queryParts.push(photoResult.manufacturer);
    if (photoResult.reference) queryParts.push(photoResult.reference);
    if (photoResult.in_amps) queryParts.push(`${photoResult.in_amps}A`);
    
    if (queryParts.length === 0) {
      setError('Pas assez d\'informations pour rechercher');
      return;
    }
    
    const searchQuery = queryParts.join(' ');
    
    setIsLoading(true);
    setError(null);
    try {
      const specs = await api.switchboard.searchDevice(searchQuery);
      if (specs.error) {
        setError(specs.error);
      } else {
        setDeviceSpecs({
          ...specs,
          manufacturer: photoResult.manufacturer || specs.manufacturer,
          reference: photoResult.reference || specs.reference,
          is_differential: photoResult.is_differential ?? specs.is_differential,
          in_amps: photoResult.in_amps || specs.in_amps,
          poles: photoResult.poles || specs.poles
        });
        setStep(3);
      }
    } catch (err) {
      setError(err.message || 'Erreur lors de la recherche');
    } finally {
      setIsLoading(false);
    }
  };

  const usePhotoResultOnly = () => {
    setDeviceSpecs({
      manufacturer: photoResult.manufacturer || '',
      reference: photoResult.reference || '',
      device_type: 'Low Voltage Circuit Breaker',
      in_amps: photoResult.in_amps || null,
      is_differential: photoResult.is_differential || false,
      poles: photoResult.poles || null,
      icu_ka: null,
      voltage_v: null,
      trip_unit: null,
      settings: {}
    });
    setStep(3);
  };

  const useCachedProduct = (product) => {
    setDeviceSpecs({
      manufacturer: product.manufacturer,
      reference: product.reference,
      device_type: product.device_type || 'Low Voltage Circuit Breaker',
      in_amps: product.in_amps,
      icu_ka: product.icu_ka,
      poles: product.poles,
      voltage_v: product.voltage_v,
      is_differential: product.is_differential,
      trip_unit: product.trip_unit || null,
      settings: product.settings || {}
    });
    setStep(3);
  };

  const handleComplete = () => {
    if (deviceSpecs) {
      onComplete(deviceSpecs);
      showToast?.('Données appliquées', 'success');
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-violet-500 to-purple-600 p-6 text-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Analyse IA</h2>
              <p className="text-violet-100 text-sm">Identifiez votre disjoncteur</p>
            </div>
          </div>
          
          <div className="flex items-center justify-center mt-4 gap-2">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                  ${step >= s ? 'bg-white text-violet-600' : 'bg-white/30 text-white'}`}>
                  {s}
                </div>
                {s < 3 && <div className={`w-12 h-1 rounded ${step > s ? 'bg-white' : 'bg-white/30'}`} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 1 : Prenez une photo</h3>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
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
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && photoResult && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 2 : Identification</h3>
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
                {photoResult.in_amps && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Calibre</span>
                    <span className="font-semibold text-gray-900">{photoResult.in_amps}A</span>
                  </div>
                )}
              </div>

              {cacheSuggestions.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-800 mb-3 flex items-center gap-2">
                    <Database size={16} />
                    Produits similaires :
                  </p>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {cacheSuggestions.map((product, idx) => (
                      <button
                        key={product.id || idx}
                        onClick={() => useCachedProduct(product)}
                        className="w-full text-left p-2 bg-white rounded-lg border border-amber-200 hover:bg-amber-50"
                      >
                        <span className="font-medium text-sm">{product.manufacturer} {product.reference}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && deviceSpecs && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="font-semibold text-gray-900">Étape 3 : Spécifications</h3>
              </div>

              <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Fabricant</span>
                    <p className="font-semibold">{deviceSpecs.manufacturer || '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Référence</span>
                    <p className="font-semibold">{deviceSpecs.reference || '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Calibre</span>
                    <p className="font-semibold">{deviceSpecs.in_amps ? `${deviceSpecs.in_amps}A` : '-'}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2">
                    <span className="text-gray-500 text-xs">Pôles</span>
                    <p className="font-semibold">{deviceSpecs.poles || '-'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4 flex gap-3">
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className="py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 flex items-center gap-2">
              <ArrowLeft size={18} />
              Retour
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          
          {step === 1 && (
            <button
              onClick={analyzePhoto}
              disabled={!photo || isLoading}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Eye size={18} />}
              Analyser
            </button>
          )}
          
          {step === 2 && (
            <div className="flex gap-2 flex-1">
              <button onClick={usePhotoResultOnly} className="flex-1 py-3 px-4 rounded-xl bg-gray-100 text-gray-700 font-medium">
                Utiliser tel quel
              </button>
              <button
                onClick={searchSpecs}
                disabled={isLoading || (!photoResult.manufacturer && !photoResult.reference)}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
                Rechercher
              </button>
            </div>
          )}
          
          {step === 3 && (
            <button
              onClick={handleComplete}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} />
              Utiliser
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Mobile Tree Drawer
const MobileTreeDrawer = React.memo(({ isOpen, onClose, tree, expandedBuildings, setExpandedBuildings, expandedFloors, setExpandedFloors, selectedBoard, onSelectBoard, getProgress, placedBoardIds }) => {
  if (!isOpen) return null;

  const isBoardPlaced = (boardId) => placedBoardIds.has(boardId);
  
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white shadow-2xl animate-slideRight overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Arborescence</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {Object.entries(tree).map(([building, floors]) => (
              <div key={building}>
                <button
                  onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
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
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                          {expandedFloors[`${building}-${floor}`] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <Layers size={14} className="text-amber-500" />
                          <span className="text-sm truncate flex-1">Étage {floor}</span>
                        </button>
                        
                        {expandedFloors[`${building}-${floor}`] && (
                          <div className="ml-4 space-y-1 mt-1">
                            {floorBoards.map(board => (
                              <button
                                key={board.id}
                                onClick={() => { onSelectBoard(board); onClose(); }}
                                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg
                                  ${selectedBoard?.id === board.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                              >
                                <Zap size={14} className={board.is_principal ? 'text-emerald-500' : 'text-gray-400'} />
                                <span className="text-sm font-mono truncate flex-1">{board.code}</span>
                                {!isBoardPlaced(board.id) && (
                                  <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[9px] rounded-full flex items-center gap-0.5">
                                    <MapPin size={8} />
                                  </span>
                                )}
                                {(board.device_count || 0) > 0 && (
                                  <ProgressRing progress={getProgress(board)} size={20} strokeWidth={2} />
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
});

// ==================== MAIN COMPONENT ====================

export default function Switchboards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // State
  const [boards, setBoards] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedFloors, setExpandedFloors] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  
  // Toast state
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);
  
  // Placement state
  const [placedBoardIds, setPlacedBoardIds] = useState(new Set());
  const [placedDetails, setPlacedDetails] = useState({});

  // Control status state
  const [controlStatuses, setControlStatuses] = useState({}); // { boardId: { status: 'ok|pending|overdue', next_due: Date } }

  // Form state
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [boardForm, setBoardForm] = useState({ name: '', code: '', building_code: '', floor: '', room: '', regime_neutral: 'TN-S', is_principal: false });
  const [deviceForm, setDeviceForm] = useState({
    name: '', device_type: 'Low Voltage Circuit Breaker', manufacturer: '', reference: '',
    in_amps: '', icu_ka: '', ics_ka: '', poles: 3, voltage_v: 400, trip_unit: '',
    position_number: '', is_differential: false, is_main_incoming: false,
    downstream_switchboard_id: null, downstream_name: '',
    settings: { ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' }
  });
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Downstream Search
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

  // Import result
  const [showImportResult, setShowImportResult] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Photo state - FIXED: stable timestamp for caching
  const [photoVersion, setPhotoVersion] = useState({});

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

  // URL params handling
  useEffect(() => {
    const boardId = searchParams.get('board');
    if (boardId && (!selectedBoard || selectedBoard.id !== Number(boardId))) {
      api.switchboard.getBoard(boardId)
        .then(board => {
          if (board) {
            setSelectedBoard(board);
            const building = board.meta?.building_code || 'Sans bâtiment';
            const floor = board.meta?.floor || 'Sans étage';
            setExpandedBuildings(prev => ({ ...prev, [building]: true }));
            setExpandedFloors(prev => ({ ...prev, [`${building}-${floor}`]: true }));
          }
        })
        .catch(() => showToast('Tableau non trouvé', 'error'));
    } else if (!boardId && selectedBoard) {
      setSelectedBoard(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedBoard) {
      loadDevices(selectedBoard.id);
    }
  }, [selectedBoard?.id]);

  // Downstream Search
  useEffect(() => {
    const search = async () => {
      if (!downstreamSearch) {
        setDownstreamResults([]);
        return;
      }
      try {
        const res = await api.switchboard.searchDownstreams(downstreamSearch);
        setDownstreamResults((res.suggestions || []).filter(b => b.id !== selectedBoard?.id));
      } catch (err) {
        console.error('Search error:', err);
      }
    };
    
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [downstreamSearch, selectedBoard?.id]);

  // Load placements
  const loadPlacements = useCallback(async () => {
    try {
      const response = await api.switchboardMaps.placedIds();
      const ids = (response?.placed_ids || []).map(Number);
      setPlacedBoardIds(new Set(ids));
      setPlacedDetails(response?.placed_details || {});
    } catch (e) {
      console.error("Load placements error:", e);
    }
  }, []);

  // Refresh placements on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) loadPlacements();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', loadPlacements);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', loadPlacements);
    };
  }, [loadPlacements]);

  // Load control statuses for all boards
  const loadControlStatuses = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules();
      const schedules = res.schedules || [];
      const statuses = {};
      const now = new Date();

      schedules.forEach(s => {
        if (s.switchboard_id) {
          const isOverdue = s.next_due_date && new Date(s.next_due_date) < now;
          const existing = statuses[s.switchboard_id];
          // Keep the worst status (overdue > pending > ok)
          if (!existing || (isOverdue && existing.status !== 'overdue')) {
            statuses[s.switchboard_id] = {
              status: isOverdue ? 'overdue' : 'pending',
              next_due: s.next_due_date,
              template_name: s.template_name
            };
          }
        }
      });
      setControlStatuses(statuses);
    } catch (e) {
      console.warn('Load control statuses error:', e);
    }
  }, []);

  // Load boards
  const loadBoards = async () => {
    setIsLoading(true);
    try {
      const res = await api.switchboard.listBoards({ pageSize: 500 });
      setBoards(res.data || []);
      loadPlacements().catch(console.warn);
      loadControlStatuses().catch(console.warn);
    } catch (err) {
      console.error('Load boards error:', err);
      showToast('Erreur lors du chargement', 'error');
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
      showToast('Erreur lors du chargement des disjoncteurs', 'error');
    }
  };

  const handleSelectBoard = async (board) => {
    setSearchParams({ board: board.id.toString() });
    try {
      const fullBoard = await api.switchboard.getBoard(board.id);
      setSelectedBoard(fullBoard);
    } catch (err) {
      setSelectedBoard(board);
    }
  };

  const handleCloseBoard = () => {
    setSelectedBoard(null);
    setDevices([]);
    setSearchParams({});
  };

  const handleNavigateToMap = (board) => {
    const boardId = board?.id || selectedBoard?.id;
    if (!boardId) {
      navigate('/app/switchboards/map');
      return;
    }

    const details = placedDetails[boardId];
    if (details?.plans?.length > 0) {
      const planKey = details.plans[0];
      navigate(`/app/switchboards/map?switchboard=${boardId}&plan=${encodeURIComponent(planKey)}`);
    } else {
      navigate('/app/switchboards/map');
    }
  };

  // Board handlers
  const handleSaveBoard = async () => {
    if (!boardForm.name || !boardForm.code) {
      showToast('Nom et code requis', 'error');
      return;
    }
    
    setIsSaving(true);
    try {
      const payload = {
        name: boardForm.name,
        code: boardForm.code,
        meta: { building_code: boardForm.building_code, floor: boardForm.floor, room: boardForm.room },
        regime_neutral: boardForm.regime_neutral,
        is_principal: boardForm.is_principal
      };
      
      let savedBoard;
      if (editingBoardId) {
        savedBoard = await api.switchboard.updateBoard(editingBoardId, payload);
        showToast('Tableau modifié !', 'success');
        
        // OPTIMIZED: Update local state instead of full reload
        setBoards(prev => prev.map(b => b.id === editingBoardId ? { ...b, ...savedBoard } : b));
        if (selectedBoard?.id === editingBoardId) {
          setSelectedBoard(prev => ({ ...prev, ...savedBoard }));
        }
      } else {
        savedBoard = await api.switchboard.createBoard(payload);
        showToast('Tableau créé !', 'success');
        setBoards(prev => [...prev, savedBoard]);
      }
      
      resetBoardForm();
    } catch (err) {
      console.error('Save board error:', err);
      // Better error message for timeouts
      if (err.message?.includes('timeout') || err.message?.includes('504')) {
        showToast('Timeout - Réessayez', 'error');
      } else {
        showToast(err.message || 'Erreur lors de l\'enregistrement', 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBoard = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.switchboard.deleteBoard(deleteTarget.id);
      showToast(`Tableau "${deleteTarget.code}" supprimé`, 'success');
      
      // OPTIMIZED: Update local state
      setBoards(prev => prev.filter(b => b.id !== deleteTarget.id));
      if (selectedBoard?.id === deleteTarget.id) {
        handleCloseBoard();
      }
      
      setShowDeleteModal(false);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete board error:', err);
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBoardPhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedBoard) return;
    try {
      await api.switchboard.uploadBoardPhoto(selectedBoard.id, file);
      
      // FIXED: Update photo version to force refresh
      setPhotoVersion(prev => ({ ...prev, [selectedBoard.id]: Date.now() }));
      setSelectedBoard(prev => ({ ...prev, has_photo: true }));
      setBoards(prev => prev.map(b => b.id === selectedBoard.id ? { ...b, has_photo: true } : b));
      
      showToast('Photo uploadée !', 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showToast('Erreur lors de l\'upload', 'error');
    }
  };

  // Device handlers
  const handleSaveDevice = async () => {
    if (!selectedBoard) return;
    
    setIsSaving(true);
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
        const savedDevice = await api.switchboard.updateDevice(editingDeviceId, payload);
        showToast('Disjoncteur modifié !', 'success');
        
        // OPTIMIZED: Update local state
        setDevices(prev => prev.map(d => d.id === editingDeviceId ? savedDevice : d));
      } else {
        const savedDevice = await api.switchboard.createDevice(payload);
        showToast('Disjoncteur créé !', 'success');
        setDevices(prev => [...prev, savedDevice]);
        
        // Update board counts locally
        setSelectedBoard(prev => ({
          ...prev,
          device_count: (prev.device_count || 0) + 1,
          complete_count: savedDevice.is_complete ? (prev.complete_count || 0) + 1 : prev.complete_count
        }));
        setBoards(prev => prev.map(b => 
          b.id === selectedBoard.id 
            ? { 
                ...b, 
                device_count: (b.device_count || 0) + 1,
                complete_count: savedDevice.is_complete ? (b.complete_count || 0) + 1 : b.complete_count
              } 
            : b
        ));
        
        // Cache product if has reference
        if (payload.reference && payload.manufacturer) {
          api.switchboard.saveScannedProduct({
            reference: payload.reference,
            manufacturer: payload.manufacturer,
            device_type: payload.device_type,
            in_amps: payload.in_amps,
            icu_ka: payload.icu_ka,
            poles: payload.poles,
            is_differential: payload.is_differential,
            source: 'manual_entry'
          }).catch(console.warn);
        }
      }
      
      resetDeviceForm();
    } catch (err) {
      console.error('Save device error:', err);
      if (err.message?.includes('timeout') || err.message?.includes('504')) {
        showToast('Timeout - Réessayez', 'error');
      } else {
        showToast(err.message || 'Erreur lors de l\'enregistrement', 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    if (!confirm('Supprimer ce disjoncteur ?')) return;
    
    const device = devices.find(d => d.id === deviceId);
    
    try {
      await api.switchboard.deleteDevice(deviceId);
      showToast('Disjoncteur supprimé', 'success');
      
      // OPTIMIZED: Update local state
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      
      // Update counts locally
      if (selectedBoard) {
        setSelectedBoard(prev => ({
          ...prev,
          device_count: Math.max(0, (prev.device_count || 0) - 1),
          complete_count: device?.is_complete ? Math.max(0, (prev.complete_count || 0) - 1) : prev.complete_count
        }));
        setBoards(prev => prev.map(b => 
          b.id === selectedBoard.id 
            ? { 
                ...b, 
                device_count: Math.max(0, (b.device_count || 0) - 1),
                complete_count: device?.is_complete ? Math.max(0, (b.complete_count || 0) - 1) : b.complete_count
              } 
            : b
        ));
      }
    } catch (err) {
      console.error('Delete device error:', err);
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  // Print PDF
  const handlePrintPDF = async () => {
    if (!selectedBoard) return;
    setIsPrinting(true);
    try {
      const blob = await api.switchboard.downloadPdf(selectedBoard.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBoard.code}_listing.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('PDF téléchargé !', 'success');
    } catch (err) {
      console.error('Print PDF error:', err);
      showToast('Erreur lors de la génération', 'error');
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
        if (result.switchboard?.id) {
          const boardDetail = await api.switchboard.getBoard(result.switchboard.id);
          handleSelectBoard(boardDetail);
        }
        setShowImportModal(false);
        setImportResult(result);
        setShowImportResult(true);
      }
    } catch (err) {
      console.error('Import error:', err);
      showToast('Erreur lors de l\'import', 'error');
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
      in_amps: specs.in_amps || prev.in_amps,
      icu_ka: specs.icu_ka || prev.icu_ka,
      poles: specs.poles || prev.poles,
      is_differential: specs.is_differential ?? prev.is_differential
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
    setShowDownstreamResults(false);
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
      downstream_name: device.downstream_switchboard_code || '',
      settings: device.settings || {}
    });
    setEditingDeviceId(device.id);
    setShowDeviceForm(true);
  };

  // Build tree - MEMOIZED
  const tree = useMemo(() => {
    const result = {};
    const filtered = boards.filter(b => 
      !searchQuery || 
      b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.code?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    filtered.forEach(b => {
      const building = b.meta?.building_code || 'Sans bâtiment';
      const floor = b.meta?.floor || 'Sans étage';
      if (!result[building]) result[building] = {};
      if (!result[building][floor]) result[building][floor] = [];
      result[building][floor].push(b);
    });
    return result;
  }, [boards, searchQuery]);

  // Progress calculation - MEMOIZED
  const getProgress = useCallback((board) => {
    const total = board.device_count || 0;
    const complete = board.complete_count || 0;
    if (total === 0) return 0;
    return Math.round((complete / total) * 100);
  }, []);

  const isBoardPlacedOnMap = useCallback((board) => {
    return placedBoardIds.has(board.id);
  }, [placedBoardIds]);

  // FIXED: Photo URL with stable cache busting
  const getBoardPhotoUrl = useCallback((boardId) => {
    const version = photoVersion[boardId] || '';
    return api.switchboard.boardPhotoUrl(boardId, { bust: false }) + (version ? `&v=${version}` : '');
  }, [photoVersion]);

  // ==================== RENDER ====================

  const renderTree = () => (
    <div className="space-y-1">
      {Object.entries(tree).map(([building, floors]) => (
        <div key={building}>
          <button
            onClick={() => setExpandedBuildings(prev => ({ ...prev, [building]: !prev[building] }))}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-lg"
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
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    {expandedFloors[`${building}-${floor}`] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Layers size={14} className="text-amber-500" />
                    <span className="text-sm truncate">Étage {floor}</span>
                  </button>
                  
                  {expandedFloors[`${building}-${floor}`] && (
                    <div className="ml-4 space-y-1">
                      {floorBoards.map(board => (
                        <button
                          key={board.id}
                          onClick={() => handleSelectBoard(board)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg
                            ${selectedBoard?.id === board.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          <Zap size={14} className={board.is_principal ? 'text-emerald-500' : 'text-gray-400'} />
                          <span className="text-sm font-mono truncate flex-1">{board.code}</span>
                          {!isBoardPlacedOnMap(board) && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] rounded-full">
                              <MapPin size={8} />
                            </span>
                          )}
                          {(board.device_count || 0) > 0 && (
                            <ProgressRing progress={getProgress(board)} size={20} strokeWidth={2} />
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

  const renderMobileCards = () => (
    <div className="grid grid-cols-1 gap-3 p-4">
      {boards.filter(b => 
        !searchQuery || 
        b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.code?.toLowerCase().includes(searchQuery.toLowerCase())
      ).map((board, index) => {
        const progress = getProgress(board);
        
        return (
          <AnimatedCard key={board.id} delay={index * 50}>
            <button
              onClick={() => handleSelectBoard(board)}
              className={`w-full p-4 rounded-xl text-left shadow-sm
                ${selectedBoard?.id === board.id ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg' : 'bg-white hover:shadow-md'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {board.is_principal && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">Principal</span>
                    )}
                    {!isBoardPlacedOnMap(board) && (
                      <span className={`px-2 py-0.5 text-[10px] rounded-full flex items-center gap-1 ${selectedBoard?.id === board.id ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'}`}>
                        <MapPin size={10} />
                      </span>
                    )}
                    {controlStatuses[board.id]?.status === 'overdue' && (
                      <span
                        className={`px-2 py-0.5 text-[10px] rounded-full flex items-center gap-1 cursor-pointer ${selectedBoard?.id === board.id ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'}`}
                        onClick={(e) => { e.stopPropagation(); navigate('/app/switchboard-controls?tab=overdue'); }}
                        title={`Contrôle en retard: ${controlStatuses[board.id]?.template_name}`}
                      >
                        <AlertTriangle size={10} />
                        Ctrl
                      </span>
                    )}
                    {controlStatuses[board.id]?.status === 'pending' && (
                      <span
                        className={`px-2 py-0.5 text-[10px] rounded-full flex items-center gap-1 cursor-pointer ${selectedBoard?.id === board.id ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}
                        onClick={(e) => { e.stopPropagation(); navigate('/app/switchboard-controls?tab=schedules'); }}
                        title={`Contrôle planifié: ${controlStatuses[board.id]?.template_name}`}
                      >
                        <CheckCircle size={10} />
                      </span>
                    )}
                    <span className={`text-lg font-mono font-bold ${selectedBoard?.id === board.id ? 'text-white' : 'text-gray-900'}`}>
                      {board.code}
                    </span>
                  </div>
                  <h3 className={`text-sm mt-1 ${selectedBoard?.id === board.id ? 'text-blue-200' : 'text-gray-500'}`}>
                    {board.name}
                  </h3>
                </div>
                <div className="text-right">
                  <ProgressRing progress={progress} size={44} strokeWidth={4} />
                  <p className={`text-xs mt-1 ${selectedBoard?.id === board.id ? 'text-blue-200' : 'text-gray-500'}`}>
                    {board.complete_count || 0}/{board.device_count || 0}
                  </p>
                </div>
              </div>
            </button>
          </AnimatedCard>
        );
      })}
    </div>
  );

  const renderDeviceCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {devices.map((device, index) => (
        <AnimatedCard key={device.id} delay={index * 30}>
          <div className={`p-4 rounded-xl border hover:shadow-md relative
            ${device.is_main_incoming ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200' : 'bg-white border-gray-200'}`}
          >
            {device.downstream_switchboard_id && (
              <div className="absolute top-0 right-0 p-2">
                <span 
                  onClick={() => handleSelectBoard({ id: device.downstream_switchboard_id })}
                  className="cursor-pointer px-2 py-1 bg-green-100 text-green-700 text-xs rounded-bl-xl rounded-tr-xl font-medium flex items-center gap-1 hover:bg-green-200"
                >
                  → {device.downstream_switchboard_code}
                </span>
              </div>
            )}

            <div className="flex items-start justify-between mb-3 mt-2">
              <div className="flex-1 pr-6">
                <div className="flex items-center gap-2 flex-wrap">
                  {device.position_number && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full font-mono">#{device.position_number}</span>
                  )}
                  {device.is_main_incoming && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">Arrivée</span>
                  )}
                  {device.is_differential && (
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full flex items-center gap-1">
                      <ShieldCheck size={12} />DDR
                    </span>
                  )}
                  {!device.is_complete && (
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full animate-pulse flex items-center gap-1">
                      <AlertCircle size={12} />Incomplet
                    </span>
                  )}
                </div>
                <h4 className="font-semibold text-gray-900 mt-1 line-clamp-2">
                  {device.name || device.reference || 'Sans nom'}
                </h4>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => startEditDevice(device)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg">
                  <Edit3 size={16} />
                </button>
                <button onClick={() => handleDeleteDevice(device.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

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

            {(device.manufacturer || device.reference) && (
              <div className="mt-2 text-xs text-gray-500 truncate">
                {device.manufacturer} {device.reference}
              </div>
            )}
          </div>
        </AnimatedCard>
      ))}
    </div>
  );

  const renderBoardForm = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white rounded-t-2xl">
          <h2 className="text-xl font-bold">{editingBoardId ? 'Modifier le tableau' : 'Nouveau tableau'}</h2>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
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
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Étage</label>
              <input
                type="text"
                value={boardForm.floor}
                onChange={(e) => setBoardForm(prev => ({ ...prev, floor: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
              <input
                type="text"
                value={boardForm.room}
                onChange={(e) => setBoardForm(prev => ({ ...prev, room: e.target.value }))}
                className={inputBaseClass}
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
              <option value="TT">TT</option>
              <option value="IT">IT</option>
            </select>
          </div>
          
          <label className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={boardForm.is_principal}
              onChange={(e) => setBoardForm(prev => ({ ...prev, is_principal: e.target.checked }))}
              className="w-5 h-5 rounded text-emerald-500"
            />
            <span className="font-medium text-emerald-700">Tableau principal</span>
          </label>
        </div>
        
        <div className="border-t p-4 flex gap-3">
          <button onClick={resetBoardForm} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={handleSaveBoard}
            disabled={!boardForm.name || !boardForm.code || isSaving}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {editingBoardId ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderDeviceForm = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="sticky top-0 bg-gradient-to-r from-indigo-500 to-purple-600 p-4 sm:p-6 text-white rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold">{editingDeviceId ? 'Modifier' : 'Nouveau disjoncteur'}</h2>
            <button
              onClick={() => setShowAIWizard(true)}
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <Sparkles size={16} />
              IA
            </button>
          </div>
        </div>
        
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Désignation</label>
              <input
                type="text"
                value={deviceForm.name}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, name: e.target.value }))}
                className={inputBaseClass}
                placeholder="ex: Prise T15"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <input
                type="text"
                value={deviceForm.position_number}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, position_number: e.target.value }))}
                className={`${inputBaseClass} font-mono`}
                placeholder="ex: 1"
              />
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <ArrowUpRight size={16} className="text-green-600" />
              Alimentation Aval
            </label>
            <div className="relative">
              {deviceForm.downstream_switchboard_id ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 p-3 rounded-xl">
                  <span className="text-sm font-medium text-green-800">→ {deviceForm.downstream_name}</span>
                  <button 
                    onClick={() => setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: null, downstream_name: '' }))}
                    className="text-gray-400 hover:text-red-500"
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
                    onBlur={() => setTimeout(() => setShowDownstreamResults(false), 200)}
                    className={inputBaseClass}
                    placeholder="Rechercher un tableau aval..."
                  />
                  {showDownstreamResults && downstreamResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                      {downstreamResults.map(board => (
                        <button
                          key={board.id}
                          onClick={() => {
                            setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: board.id, downstream_name: board.code }));
                            setDownstreamSearch('');
                            setShowDownstreamResults(false);
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between"
                        >
                          <span className="font-mono font-medium">{board.code}</span>
                          <span className="text-xs text-gray-500">{board.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calibre (A)</label>
              <input
                type="number"
                value={deviceForm.in_amps}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, in_amps: e.target.value }))}
                className={inputBaseClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Icu (kA)</label>
              <input
                type="number"
                value={deviceForm.icu_ka}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, icu_ka: e.target.value }))}
                className={inputBaseClass}
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
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={deviceForm.is_differential}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, is_differential: e.target.checked }))}
                className="w-5 h-5 rounded text-purple-500"
              />
              <div>
                <span className="font-medium text-purple-700 flex items-center gap-1">
                  <ShieldCheck size={16} />
                  Différentiel (DDR)
                </span>
              </div>
            </label>
            
            <label className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={deviceForm.is_main_incoming}
                onChange={(e) => setDeviceForm(prev => ({ ...prev, is_main_incoming: e.target.checked }))}
                className="w-5 h-5 rounded text-amber-500"
              />
              <span className="font-medium text-amber-700">Disjoncteur d'arrivée</span>
            </label>
          </div>
        </div>
        
        <div className="border-t p-4 flex gap-3">
          <button onClick={resetDeviceForm} className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={handleSaveDevice}
            disabled={isSaving}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
            {editingDeviceId ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );

  // Main Render
  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slideUp { animation: slideUp 0.3s ease-out forwards; }
        .animate-slideRight { animation: slideRight 0.3s ease-out forwards; }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isMobile && (
                <button onClick={() => setShowMobileDrawer(true)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl">
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
              <button onClick={() => setShowSettingsModal(true)} className="p-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200">
                <Settings size={20} />
              </button>
              <button
                onClick={() => navigate('/app/switchboard-controls')}
                className="px-3 py-2 bg-amber-100 text-amber-700 rounded-xl font-medium hover:bg-amber-200 flex items-center gap-2"
              >
                <ClipboardCheck size={18} />
                <span className="hidden sm:inline">Contrôles</span>
              </button>
              <button onClick={() => setShowImportModal(true)} className="px-3 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-medium hover:bg-emerald-200 flex items-center gap-2">
                <FileSpreadsheet size={18} />
                <span className="hidden sm:inline">Import</span>
              </button>
              <button onClick={() => setShowBoardForm(true)} className="px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-700 flex items-center gap-2">
                <Plus size={18} />
                <span className="hidden sm:inline">Tableau</span>
              </button>
            </div>
          </div>

          <div className="mt-3 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>
      </div>

      {isLoading && boards.length === 0 && (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={32} className="animate-spin text-blue-500" />
        </div>
      )}

      <div className="max-w-7xl mx-auto flex">
        {!isMobile && (
          <div className="w-80 border-r bg-white min-h-screen p-4 sticky top-32 self-start overflow-y-auto max-h-[calc(100vh-8rem)]">
            {renderTree()}
          </div>
        )}

        {isMobile && !selectedBoard && renderMobileCards()}

        {selectedBoard && (
          <div className="flex-1 p-4">
            <AnimatedCard>
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-4">
                <div className="flex flex-col sm:flex-row">
                  <div 
                    onClick={() => boardPhotoRef.current?.click()}
                    className="w-full sm:w-32 h-32 bg-gray-100 flex-shrink-0 relative group cursor-pointer"
                  >
                    <input ref={boardPhotoRef} type="file" accept="image/*" onChange={handleBoardPhotoUpload} className="hidden" />
                    {selectedBoard.has_photo ? (
                      <img src={getBoardPhotoUrl(selectedBoard.id)} alt={selectedBoard.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <ImagePlus size={32} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera size={24} className="text-white" />
                    </div>
                  </div>

                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {selectedBoard.is_principal && (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">Principal</span>
                          )}
                          <span className="text-lg font-mono font-bold text-gray-900">{selectedBoard.code}</span>
                          {!isBoardPlacedOnMap(selectedBoard) && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] rounded-full flex items-center gap-1">
                              <MapPin size={10} />Non placé
                            </span>
                          )}
                        </div>
                        <h2 className="text-base text-gray-600 mt-1">{selectedBoard.name}</h2>
                        
                        {selectedBoard.upstream_sources?.length > 0 && (
                          <div className="mt-1">
                            {selectedBoard.upstream_sources.map(source => (
                              <span key={source.id} className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs px-2 py-1 rounded-md mr-2">
                                ← {source.source_board_code}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        <button onClick={() => setShowShareModal(true)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl">
                          <Link size={18} />
                        </button>
                        <button
                          onClick={() => handleNavigateToMap(selectedBoard)}
                          className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${
                            isBoardPlacedOnMap(selectedBoard) ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          <MapPin size={16} />
                          Plans
                        </button>
                        <button onClick={handlePrintPDF} disabled={isPrinting} className="p-2 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-xl disabled:opacity-50">
                          {isPrinting ? <RefreshCw size={18} className="animate-spin" /> : <Printer size={18} />}
                        </button>
                        <button onClick={() => navigate(`/app/switchboards/${selectedBoard.id}/diagram`)} className="p-2 text-gray-400 hover:text-violet-500 hover:bg-violet-50 rounded-xl">
                          <GitBranch size={18} />
                        </button>
                        <button onClick={() => startEditBoard(selectedBoard)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl">
                          <Edit3 size={18} />
                        </button>
                        <button onClick={() => { setDeleteTarget(selectedBoard); setShowDeleteModal(true); }} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl">
                          <Trash2 size={18} />
                        </button>
                        {isMobile && (
                          <button onClick={handleCloseBoard} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl">
                            <X size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    {(selectedBoard.device_count || 0) > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-500">Complétion</span>
                          <span className="font-medium">{selectedBoard.complete_count || 0}/{selectedBoard.device_count || 0}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${getProgress(selectedBoard)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </AnimatedCard>

            {/* Control Status Section */}
            <AnimatedCard delay={50}>
              <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${
                      controlStatuses[selectedBoard.id]?.status === 'overdue' ? 'bg-red-100' :
                      controlStatuses[selectedBoard.id]?.status === 'pending' ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <ClipboardCheck size={20} className={
                        controlStatuses[selectedBoard.id]?.status === 'overdue' ? 'text-red-600' :
                        controlStatuses[selectedBoard.id]?.status === 'pending' ? 'text-blue-600' : 'text-gray-400'
                      } />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">Contrôles</h4>
                      {controlStatuses[selectedBoard.id] ? (
                        <p className={`text-sm ${
                          controlStatuses[selectedBoard.id].status === 'overdue' ? 'text-red-600' :
                          controlStatuses[selectedBoard.id].status === 'pending' ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {controlStatuses[selectedBoard.id].status === 'overdue'
                            ? `⚠️ En retard - ${controlStatuses[selectedBoard.id].template_name}`
                            : `Prochain: ${new Date(controlStatuses[selectedBoard.id].next_due).toLocaleDateString('fr-FR')}`
                          }
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400">Aucun contrôle planifié</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/app/switchboard-controls?tab=history&switchboard=${selectedBoard.id}`)}
                      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                    >
                      <History size={14} />
                      Historique
                    </button>
                    <button
                      onClick={() => navigate('/app/switchboard-controls?tab=schedules')}
                      className="px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 flex items-center gap-1"
                    >
                      <ClipboardCheck size={14} />
                      Gérer
                    </button>
                  </div>
                </div>
              </div>
            </AnimatedCard>

            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Disjoncteurs ({devices.length})</h3>
              <button onClick={() => setShowDeviceForm(true)} className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium flex items-center gap-2">
                <Plus size={18} />Ajouter
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center">
                <Zap size={48} className="mx-auto text-gray-300 mb-4" />
                <h4 className="text-lg font-medium text-gray-700">Aucun disjoncteur</h4>
                <p className="text-gray-500 mt-1">Ajoutez votre premier disjoncteur</p>
              </div>
            ) : (
              renderDeviceCards()
            )}
          </div>
        )}

        {!isMobile && !selectedBoard && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap size={40} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-700">Sélectionnez un tableau</h3>
            </div>
          </div>
        )}
      </div>

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
        getProgress={getProgress}
        placedBoardIds={placedBoardIds}
      />

      <ImportExcelModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} onImport={handleImportExcel} isLoading={isImporting} />
      <ImportResultModal isOpen={showImportResult} onClose={() => { setShowImportResult(false); setImportResult(null); }} result={importResult} />
      <SiteSettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} showToast={showToast} />
      <DeleteConfirmModal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }} onConfirm={handleDeleteBoard} itemName={deleteTarget?.code} itemType="tableau" isLoading={isDeleting} deviceCount={deleteTarget?.device_count || 0} />
      <ShareLinkModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} board={selectedBoard} />
      <AIPhotoWizard isOpen={showAIWizard} onClose={() => setShowAIWizard(false)} onComplete={handleAIComplete} showToast={showToast} />

      {showBoardForm && renderBoardForm()}
      {showDeviceForm && renderDeviceForm()}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
