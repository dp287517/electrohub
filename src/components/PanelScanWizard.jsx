/**
 * src/components/PanelScanWizard.jsx
 * Wizard pour scanner un tableau électrique complet via photos
 * Détecte automatiquement tous les appareils et permet la création en masse
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Camera, Upload, Trash2, ChevronRight, ChevronLeft,
  Zap, Check, AlertTriangle, Edit3, Loader2, Image,
  CheckCircle, XCircle, RefreshCw, Sparkles, Grid3X3
} from 'lucide-react';
import api from '../lib/api';

// ============================================================
// STEP COMPONENTS
// ============================================================

const StepIndicator = ({ currentStep, steps }) => (
  <div className="flex items-center justify-center gap-2 mb-6">
    {steps.map((step, idx) => (
      <React.Fragment key={idx}>
        <div className={`flex items-center gap-2 ${idx <= currentStep ? 'text-indigo-600' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            idx < currentStep ? 'bg-indigo-600 text-white' :
            idx === currentStep ? 'bg-indigo-100 text-indigo-600 border-2 border-indigo-600' :
            'bg-gray-200 text-gray-500'
          }`}>
            {idx < currentStep ? <Check size={16} /> : idx + 1}
          </div>
          <span className="hidden sm:inline text-sm font-medium">{step}</span>
        </div>
        {idx < steps.length - 1 && (
          <ChevronRight size={16} className="text-gray-300" />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ============================================================
// STEP 1: PHOTO CAPTURE
// ============================================================

const PhotoCaptureStep = ({ photos, setPhotos, onNext }) => {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setPhotos(prev => [...prev, ...files].slice(0, 15));
    }
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  };

  const removePhoto = (index) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-3">
          <Camera size={32} className="text-indigo-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900">Photographiez le tableau</h3>
        <p className="text-sm text-gray-500 mt-1">
          Prenez 1 à 15 photos pour capturer tous les appareils du tableau
        </p>
      </div>

      {/* Important: Listing photos instruction */}
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg shrink-0">
            <Grid3X3 size={20} className="text-amber-600" />
          </div>
          <div>
            <h4 className="font-semibold text-amber-900 mb-1">Commencez par le LISTING !</h4>
            <p className="text-sm text-amber-800">
              Prenez d'abord en photo la <strong>feuille de listing/nomenclature</strong> du tableau
              (document papier avec la liste des circuits). Cela permet de détecter correctement
              le <strong>nombre de pôles</strong> (1P, 2P, 3P, 4P) de chaque appareil.
            </p>
          </div>
        </div>
      </div>

      {/* Source selection buttons */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={photos.length >= 15}
          className="flex-1 max-w-[160px] py-3 px-4 bg-indigo-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Camera size={20} />
          Caméra
        </button>
        <button
          onClick={() => galleryInputRef.current?.click()}
          disabled={photos.length >= 15}
          className="flex-1 max-w-[160px] py-3 px-4 bg-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Image size={20} />
          Galerie
        </button>
      </div>

      {/* Photo grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <div key={idx} className="relative aspect-[4/3] rounded-xl overflow-hidden border-2 border-gray-200 bg-gray-100">
            <img
              src={URL.createObjectURL(photo)}
              alt={`Photo ${idx + 1}`}
              className="w-full h-full object-cover"
            />
            <button
              onClick={() => removePhoto(idx)}
              className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-lg"
            >
              <Trash2 size={14} />
            </button>
            <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded-full">
              Photo {idx + 1}
            </div>
          </div>
        ))}

        {photos.length < 15 && photos.length > 0 && (
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-indigo-400 transition-colors flex flex-col items-center justify-center gap-2 text-gray-500"
          >
            <Upload size={24} />
            <span className="text-sm font-medium">Ajouter</span>
          </button>
        )}
      </div>

      {/* Camera input - forces camera on mobile */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Gallery input - allows selecting from gallery */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Tips */}
      <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
        <div className="font-semibold mb-2 flex items-center gap-2">
          <Sparkles size={16} />
          Conseils pour de meilleurs résultats
        </div>
        <ul className="space-y-1 text-blue-700">
          <li><strong>1. Photo du LISTING</strong> (document papier) - Pour les pôles et circuits</li>
          <li><strong>2. Photos du TABLEAU</strong> - De face, bien droit, bon éclairage</li>
          <li>• Incluez toutes les rangées du tableau</li>
          <li>• Zoomez sur les zones avec petits caractères si besoin</li>
          <li>• Évitez les reflets sur les plastiques</li>
        </ul>
      </div>

      {/* Action */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onNext}
          disabled={photos.length === 0}
          className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-shadow"
        >
          Analyser {photos.length} photo{photos.length > 1 ? 's' : ''}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};

// ============================================================
// STEP 2: ANALYSIS IN PROGRESS (Async with polling)
// ============================================================

const AnalysisStep = ({ photos, switchboardId, onComplete, onError, onRetry }) => {
  const [status, setStatus] = useState('uploading');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Envoi des photos...');
  const [jobId, setJobId] = useState(null);
  const [phase, setPhase] = useState('upload'); // upload, gpt, gemini, merge, cache, done
  const [retryCount, setRetryCount] = useState(0); // Force re-run effect

  // Determine phase from progress
  const getPhaseFromProgress = (p) => {
    if (p < 5) return 'upload';
    if (p < 25) return 'gpt';
    if (p < 40) return 'gemini';
    if (p < 50) return 'merge';
    if (p < 80) return 'cache';
    return 'done';
  };

  React.useEffect(() => {
    let cancelled = false;
    let pollInterval = null;

    const startAnalysis = async () => {
      try {
        setProgress(2);
        setMessage('Envoi des photos...');
        setPhase('upload');

        // Start the async job
        const response = await api.switchboard.analyzePanel(photos, switchboardId);

        if (cancelled) return;

        if (response.job_id) {
          // Async mode - start polling
          setJobId(response.job_id);
          setStatus('analyzing');
          setProgress(5);
          setPhase('gpt');
          setMessage('Analyse GPT-4o en cours...');

          // Poll for job status
          pollInterval = setInterval(async () => {
            try {
              const job = await api.switchboard.getPanelScanJob(response.job_id);

              if (cancelled) return;

              const newProgress = job.progress || 0;
              setProgress(newProgress);
              setPhase(getPhaseFromProgress(newProgress));
              setMessage(job.message || 'Analyse en cours...');

              if (job.status === 'completed') {
                clearInterval(pollInterval);
                setStatus('complete');
                setProgress(100);
                setPhase('done');
                const deviceCount = job.result?.total_devices_detected || job.result?.devices?.length || 0;
                setMessage(`${deviceCount} appareils détectés !`);

                setTimeout(() => {
                  if (!cancelled) onComplete(job.result);
                }, 1000);
              } else if (job.status === 'failed') {
                clearInterval(pollInterval);
                setStatus('error');
                setMessage(job.error || 'Erreur lors de l\'analyse');
                onError(job.error);
              }
            } catch (pollErr) {
              console.warn('[PanelScan] Poll error:', pollErr.message);
            }
          }, 2000); // Poll every 2 seconds
        } else {
          // Sync mode fallback (if result is returned directly)
          setProgress(100);
          setPhase('done');
          setMessage(`${response.total_devices_detected || response.devices?.length || 0} appareils détectés !`);
          setStatus('complete');
          setTimeout(() => {
            if (!cancelled) onComplete(response);
          }, 1000);
        }

      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMessage(err.message || 'Erreur lors de l\'analyse');
        onError(err.message);
      }
    };

    startAnalysis();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [photos, switchboardId, onComplete, onError, retryCount]);

  // Handle retry
  const handleRetry = () => {
    setStatus('uploading');
    setProgress(0);
    setMessage('Réessai en cours...');
    setPhase('upload');
    setJobId(null);
    setRetryCount(c => c + 1);
  };

  // Phase labels for display
  const phases = [
    { id: 'upload', label: 'Envoi', icon: '📤' },
    { id: 'gpt', label: 'GPT-4o', icon: '🤖' },
    { id: 'gemini', label: 'Gemini', icon: '✨' },
    { id: 'merge', label: 'Fusion', icon: '🔀' },
    { id: 'cache', label: 'Enrichissement', icon: '📦' },
    { id: 'done', label: 'Terminé', icon: '✅' }
  ];

  const currentPhaseIndex = phases.findIndex(p => p.id === phase);

  return (
    <div className="py-8 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-100 rounded-full mb-6">
        {(status === 'uploading' || status === 'analyzing') && <Loader2 size={40} className="text-indigo-600 animate-spin" />}
        {status === 'complete' && <CheckCircle size={40} className="text-green-600" />}
        {status === 'error' && <XCircle size={40} className="text-red-600" />}
      </div>

      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        {status === 'uploading' && 'Envoi des photos...'}
        {status === 'analyzing' && 'Analyse en cours...'}
        {status === 'complete' && 'Analyse terminée !'}
        {status === 'error' && 'Erreur d\'analyse'}
      </h3>

      <p className="text-gray-600 mb-4">{message}</p>

      {/* Phase indicators */}
      {status !== 'error' && (
        <div className="flex justify-center items-center gap-1 mb-6 px-4 flex-wrap">
          {phases.map((p, idx) => (
            <div key={p.id} className="flex items-center">
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                  idx < currentPhaseIndex
                    ? 'bg-green-100 text-green-700'
                    : idx === currentPhaseIndex
                    ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                <span>{p.icon}</span>
                <span className="hidden sm:inline">{p.label}</span>
              </div>
              {idx < phases.length - 1 && (
                <div className={`w-4 h-0.5 mx-0.5 ${idx < currentPhaseIndex ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div className="max-w-sm mx-auto px-4">
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              status === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-lg font-semibold text-gray-700">{progress}%</div>
      </div>

      {/* Info about photos being analyzed */}
      <div className="mt-6 flex justify-center gap-2">
        {photos.map((_, idx) => (
          <div key={idx} className="w-3 h-3 rounded-full bg-indigo-200" />
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-1">
        {photos.length} photo{photos.length > 1 ? 's' : ''} en cours d'analyse
      </div>

      {/* Notification hint */}
      {status === 'analyzing' && (
        <div className="mt-6 p-3 bg-blue-50 rounded-xl text-sm text-blue-700 max-w-sm mx-auto">
          <p>L'analyse continue même si vous quittez l'application. Vous recevrez une notification quand ce sera terminé.</p>
        </div>
      )}

      {/* Error with retry button */}
      {status === 'error' && (
        <div className="mt-6 space-y-4 max-w-sm mx-auto">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <p className="font-medium mb-1">L'analyse a échoué</p>
            <p className="text-red-600">{message}</p>
            {message?.includes('redémarrage') && (
              <p className="mt-2 text-red-500 text-xs">
                Le serveur a été mis à jour pendant l'analyse. Cela peut arriver lors de maintenances.
              </p>
            )}
          </div>
          <button
            onClick={handleRetry}
            className="w-full py-3 px-4 bg-indigo-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw size={18} />
            Relancer l'analyse
          </button>
          <button
            onClick={onRetry}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Retourner aux photos
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================
// STEP 3: REVIEW & EDIT
// ============================================================

const ReviewStep = ({ analysisResult, devices, setDevices, onBack, onNext }) => {
  const [editingIndex, setEditingIndex] = useState(null);
  const [selectAll, setSelectAll] = useState(true);
  const [quickEditField, setQuickEditField] = useState(null); // {index, field, value}
  const editInputRef = useRef(null);

  const toggleDevice = (index) => {
    setDevices(prev => prev.map((d, i) =>
      i === index ? { ...d, selected: !d.selected } : d
    ));
  };

  const toggleAll = () => {
    const newState = !selectAll;
    setSelectAll(newState);
    setDevices(prev => prev.map(d => ({ ...d, selected: newState })));
  };

  const updateDevice = (index, field, value) => {
    setDevices(prev => prev.map((d, i) =>
      i === index ? { ...d, [field]: value } : d
    ));
  };

  // Quick edit modal for tablet/mobile
  const openQuickEdit = (index, field, currentValue) => {
    setQuickEditField({ index, field, value: currentValue || '' });
    setTimeout(() => editInputRef.current?.focus(), 100);
  };

  const closeQuickEdit = () => {
    if (quickEditField) {
      const { index, field, value } = quickEditField;
      if (field === 'in_amps' || field === 'icu_ka' || field === 'poles') {
        updateDevice(index, field, parseInt(value) || null);
      } else {
        updateDevice(index, field, value || null);
      }
    }
    setQuickEditField(null);
  };

  const selectedCount = devices.filter(d => d.selected).length;

  const getConfidenceBadge = (confidence) => {
    const colors = {
      high: 'bg-green-100 text-green-700',
      medium: 'bg-amber-100 text-amber-700',
      low: 'bg-red-100 text-red-700'
    };
    return colors[confidence] || colors.medium;
  };

  const getFieldLabel = (field) => {
    const labels = {
      in_amps: 'Intensité (A)',
      icu_ka: 'Icu (kA)',
      poles: 'Pôles',
      curve_type: 'Courbe',
      reference: 'Référence',
      manufacturer: 'Fabricant',
      device_type: 'Type'
    };
    return labels[field] || field;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {analysisResult?.total_devices_detected || devices.length} appareils détectés
          </h3>
          {analysisResult?.panel_description && (
            <p className="text-sm text-gray-500">{analysisResult.panel_description}</p>
          )}
        </div>
        <button
          onClick={toggleAll}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          {selectAll ? 'Désélectionner tout' : 'Tout sélectionner'}
        </button>
      </div>

      {/* Summary of updates vs creates */}
      {analysisResult?.summary && (
        <div className="flex gap-3 text-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg">
            <span className="font-semibold">{analysisResult.summary.will_create || 0}</span>
            <span>nouveaux</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
            <RefreshCw size={14} />
            <span className="font-semibold">{analysisResult.summary.will_update || 0}</span>
            <span>à mettre à jour</span>
          </div>
          {analysisResult.summary.existing_in_switchboard > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg">
              <span>{analysisResult.summary.existing_in_switchboard} existants</span>
            </div>
          )}
        </div>
      )}

      {/* Devices table */}
      <div className="border rounded-xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">Circuit</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Fabricant</th>
                <th className="px-3 py-2 text-left">Référence</th>
                <th className="px-3 py-2 text-center">In (A)</th>
                <th className="px-3 py-2 text-center">Courbe</th>
                <th className="px-3 py-2 text-center">Icu (kA)</th>
                <th className="px-3 py-2 text-center">Pôles</th>
                <th className="px-3 py-2 text-center">V</th>
                <th className="px-3 py-2 text-center">Diff</th>
                <th className="px-3 py-2 text-center">Confiance</th>
                <th className="px-3 py-2 text-center">Action</th>
                <th className="px-3 py-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device, idx) => (
                <tr
                  key={idx}
                  className={`border-b last:border-0 ${device.selected ? '' : 'opacity-50 bg-gray-50'}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={device.selected}
                      onChange={() => toggleDevice(idx)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs font-bold text-indigo-600">
                      {device.position_label || device.position || `R${device.row || '?'}-P${device.position_in_row || '?'}`}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-gray-600 truncate max-w-[100px] block">
                      {device.circuit_name || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {editingIndex === idx ? (
                      <input
                        type="text"
                        value={device.device_type || ''}
                        onChange={(e) => updateDevice(idx, 'device_type', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-xs"
                      />
                    ) : (
                      <span className="truncate max-w-[120px] block">{device.device_type || '-'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editingIndex === idx ? (
                      <input
                        type="text"
                        value={device.manufacturer || ''}
                        onChange={(e) => updateDevice(idx, 'manufacturer', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-xs"
                      />
                    ) : (
                      device.manufacturer || '-'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editingIndex === idx ? (
                      <input
                        type="text"
                        value={device.reference || ''}
                        onChange={(e) => updateDevice(idx, 'reference', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-xs"
                      />
                    ) : (
                      <span className="font-mono text-xs">{device.reference || '-'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editingIndex === idx ? (
                      <input
                        type="number"
                        value={device.in_amps || ''}
                        onChange={(e) => updateDevice(idx, 'in_amps', parseInt(e.target.value) || null)}
                        className="w-20 px-2 py-2 border-2 border-indigo-300 rounded text-sm text-center font-semibold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                      />
                    ) : (
                      <button
                        onClick={() => openQuickEdit(idx, 'in_amps', device.in_amps)}
                        className="font-semibold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded min-w-[40px] transition-colors"
                        title="Tap pour modifier"
                      >
                        {device.in_amps || '-'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editingIndex === idx ? (
                      <select
                        value={device.curve_type || ''}
                        onChange={(e) => updateDevice(idx, 'curve_type', e.target.value || null)}
                        className="w-16 px-1 py-2 border-2 border-indigo-300 rounded text-sm text-center font-semibold"
                      >
                        <option value="">-</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                        <option value="K">K</option>
                        <option value="Z">Z</option>
                      </select>
                    ) : (
                      <button
                        onClick={() => openQuickEdit(idx, 'curve_type', device.curve_type)}
                        className="font-medium text-gray-700 hover:bg-gray-100 px-2 py-1 rounded min-w-[30px] transition-colors"
                        title="Tap pour modifier"
                      >
                        {device.curve_type || '-'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editingIndex === idx ? (
                      <input
                        type="number"
                        value={device.icu_ka || ''}
                        onChange={(e) => updateDevice(idx, 'icu_ka', parseInt(e.target.value) || null)}
                        className="w-20 px-2 py-2 border-2 border-indigo-300 rounded text-sm text-center font-semibold"
                      />
                    ) : (
                      <button
                        onClick={() => openQuickEdit(idx, 'icu_ka', device.icu_ka)}
                        className="flex items-center justify-center gap-1 text-gray-700 hover:bg-gray-100 px-2 py-1 rounded min-w-[40px] transition-colors"
                        title="Tap pour modifier"
                      >
                        {device.icu_ka || '-'}
                        {device.from_cache && (
                          <span className="w-2 h-2 bg-green-500 rounded-full" title="Depuis le cache" />
                        )}
                        {device.enriched_by_ai && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full" title="Enrichi par IA" />
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editingIndex === idx ? (
                      <select
                        value={device.poles || 1}
                        onChange={(e) => updateDevice(idx, 'poles', parseInt(e.target.value))}
                        className="w-16 px-1 py-2 border-2 border-indigo-300 rounded text-sm text-center font-semibold"
                      >
                        <option value={1}>1P</option>
                        <option value={2}>2P</option>
                        <option value={3}>3P</option>
                        <option value={4}>4P</option>
                      </select>
                    ) : (
                      <button
                        onClick={() => openQuickEdit(idx, 'poles', device.poles || 1)}
                        className={`font-semibold px-2 py-1 rounded min-w-[40px] transition-colors ${
                          (device.poles || 1) >= 3
                            ? 'text-orange-600 hover:bg-orange-50'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                        title="Tap pour modifier"
                      >
                        {device.poles || 1}P
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-gray-600">
                    {device.voltage_v || (device.poles >= 3 ? 400 : 230)}V
                  </td>
                  <td className="px-3 py-2 text-center">
                    {device.is_differential ? (
                      <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium" title={`${device.differential_sensitivity_ma || '?'}mA ${device.differential_type || ''}`}>
                        {device.differential_sensitivity_ma || '?'}
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceBadge(device.confidence)}`}>
                      {device.confidence === 'high' ? 'Sûr' : device.confidence === 'low' ? 'Incertain' : 'Moyen'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {device.will_update ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium" title={device.matching_device_name ? `Mise à jour: ${device.matching_device_name}` : 'Sera mis à jour'}>
                        <RefreshCw size={10} />
                        MAJ
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        Nouveau
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => setEditingIndex(editingIndex === idx ? null : idx)}
                      className={`p-1 rounded hover:bg-gray-100 ${editingIndex === idx ? 'text-indigo-600' : 'text-gray-400'}`}
                    >
                      <Edit3 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cache legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full" />
          Depuis le cache (déjà scanné)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-blue-500 rounded-full" />
          Enrichi par IA (nouveau)
        </span>
      </div>

      {/* Analysis notes */}
      {analysisResult?.analysis_notes && (
        <div className="bg-amber-50 rounded-xl p-3 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <AlertTriangle size={16} />
            Notes d'analyse
          </div>
          <p>{analysisResult.analysis_notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium flex items-center gap-2"
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button
          onClick={onNext}
          disabled={selectedCount === 0}
          className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-shadow"
        >
          Créer {selectedCount} appareil{selectedCount > 1 ? 's' : ''}
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Quick Edit Modal for tablet/mobile */}
      {quickEditField && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60]" onClick={closeQuickEdit}>
          <div
            className="bg-white w-full sm:w-auto sm:min-w-[320px] rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {getFieldLabel(quickEditField.field)}
              </h3>
              <button
                onClick={closeQuickEdit}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-500 mb-2">
                Position: {devices[quickEditField.index]?.position_label || `R${devices[quickEditField.index]?.row}-P${devices[quickEditField.index]?.position_in_row}`}
              </div>

              {quickEditField.field === 'poles' ? (
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map(p => (
                    <button
                      key={p}
                      onClick={() => {
                        setQuickEditField(prev => ({ ...prev, value: p }));
                      }}
                      className={`py-4 text-xl font-bold rounded-xl transition-colors ${
                        parseInt(quickEditField.value) === p
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {p}P
                    </button>
                  ))}
                </div>
              ) : quickEditField.field === 'curve_type' ? (
                <div className="grid grid-cols-5 gap-2">
                  {['B', 'C', 'D', 'K', 'Z'].map(c => (
                    <button
                      key={c}
                      onClick={() => {
                        setQuickEditField(prev => ({ ...prev, value: c }));
                      }}
                      className={`py-4 text-xl font-bold rounded-xl transition-colors ${
                        quickEditField.value === c
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : quickEditField.field === 'in_amps' ? (
                <div className="space-y-3">
                  {/* Quick select common values */}
                  <div className="grid grid-cols-5 gap-2">
                    {[6, 10, 13, 16, 20, 25, 32, 40, 50, 63].map(a => (
                      <button
                        key={a}
                        onClick={() => {
                          setQuickEditField(prev => ({ ...prev, value: a }));
                        }}
                        className={`py-3 text-lg font-bold rounded-xl transition-colors ${
                          parseInt(quickEditField.value) === a
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  {/* Custom input */}
                  <input
                    ref={editInputRef}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={quickEditField.value}
                    onChange={(e) => setQuickEditField(prev => ({ ...prev, value: e.target.value }))}
                    placeholder="Autre valeur..."
                    className="w-full px-4 py-4 text-2xl font-bold text-center border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
              ) : (
                <input
                  ref={editInputRef}
                  type={quickEditField.field === 'icu_ka' ? 'number' : 'text'}
                  inputMode={quickEditField.field === 'icu_ka' ? 'numeric' : 'text'}
                  value={quickEditField.value}
                  onChange={(e) => setQuickEditField(prev => ({ ...prev, value: e.target.value }))}
                  className="w-full px-4 py-4 text-2xl font-bold text-center border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
              )}
            </div>

            <button
              onClick={closeQuickEdit}
              className="w-full py-4 bg-indigo-600 text-white rounded-xl font-semibold text-lg hover:bg-indigo-700 transition-colors"
            >
              Valider
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// STEP 4: CREATION
// ============================================================

const CreationStep = ({ switchboardId, devices, onComplete, onError }) => {
  const [status, setStatus] = useState('creating');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  React.useEffect(() => {
    let cancelled = false;

    const create = async () => {
      try {
        setProgress(20);

        const selectedDevices = devices.filter(d => d.selected);
        const response = await api.switchboard.bulkCreateDevices(switchboardId, selectedDevices);

        if (cancelled) return;

        setProgress(100);
        setResult(response);
        setStatus('complete');

        setTimeout(() => {
          if (!cancelled) onComplete(response);
        }, 2000);

      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        onError(err.message);
      }
    };

    create();
    return () => { cancelled = true; };
  }, [switchboardId, devices, onComplete, onError]);

  return (
    <div className="py-12 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
        {status === 'creating' && <Loader2 size={40} className="text-green-600 animate-spin" />}
        {status === 'complete' && <CheckCircle size={40} className="text-green-600" />}
        {status === 'error' && <XCircle size={40} className="text-red-600" />}
      </div>

      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        {status === 'creating' && 'Création en cours...'}
        {status === 'complete' && 'Création terminée !'}
        {status === 'error' && 'Erreur de création'}
      </h3>

      {status === 'complete' && result && (
        <div className="space-y-2">
          {result.created > 0 && (
            <p className="text-green-600 font-semibold">
              {result.created} appareil{result.created > 1 ? 's' : ''} créé{result.created > 1 ? 's' : ''}
            </p>
          )}
          {result.updated > 0 && (
            <p className="text-blue-600 font-semibold">
              {result.updated} appareil{result.updated > 1 ? 's' : ''} mis à jour
            </p>
          )}
          {result.errors && result.errors.length > 0 && (
            <p className="text-amber-600 text-sm">
              {result.errors.length} erreur{result.errors.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="max-w-xs mx-auto mt-6">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              status === 'error' ? 'bg-red-500' : 'bg-green-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function PanelScanWizard({ switchboardId, switchboardName, onClose, onSuccess, preloadedResult }) {
  // If preloadedResult is provided, start at review step (step 2)
  const [step, setStep] = useState(preloadedResult ? 2 : 0);
  const [photos, setPhotos] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(preloadedResult || null);
  const [devices, setDevices] = useState(() => {
    if (preloadedResult?.devices) {
      return preloadedResult.devices.map(d => ({ ...d, selected: true }));
    }
    return [];
  });
  const [error, setError] = useState(null);

  const steps = ['Photos', 'Analyse', 'Vérification', 'Création'];

  const handleAnalysisComplete = (result) => {
    setAnalysisResult(result);
    // Préparer les devices avec la sélection par défaut
    const preparedDevices = (result.devices || []).map(d => ({
      ...d,
      selected: true
    }));
    setDevices(preparedDevices);
    setStep(2);
  };

  const handleCreationComplete = (result) => {
    onSuccess?.(result);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Grid3X3 size={24} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Scan du Tableau</h2>
              {switchboardName && (
                <p className="text-sm text-white/80">{switchboardName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <StepIndicator currentStep={step} steps={steps} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
              <AlertTriangle size={20} />
              <span>{error}</span>
              <button
                onClick={() => { setError(null); setStep(0); }}
                className="ml-auto text-sm underline hover:no-underline"
              >
                Réessayer
              </button>
            </div>
          )}

          {step === 0 && (
            <PhotoCaptureStep
              photos={photos}
              setPhotos={setPhotos}
              onNext={() => setStep(1)}
            />
          )}

          {step === 1 && (
            <AnalysisStep
              photos={photos}
              switchboardId={switchboardId}
              onComplete={handleAnalysisComplete}
              onError={(msg) => setError(msg)}
              onRetry={() => setStep(0)}
            />
          )}

          {step === 2 && (
            <ReviewStep
              analysisResult={analysisResult}
              devices={devices}
              setDevices={setDevices}
              onBack={() => setStep(0)}
              onNext={() => setStep(3)}
            />
          )}

          {step === 3 && (
            <CreationStep
              switchboardId={switchboardId}
              devices={devices}
              onComplete={handleCreationComplete}
              onError={(msg) => setError(msg)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
