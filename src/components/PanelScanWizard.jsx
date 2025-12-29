/**
 * src/components/PanelScanWizard.jsx
 * Wizard pour scanner un tableau électrique complet via photos
 * Détecte automatiquement tous les appareils et permet la création en masse
 */

import React, { useState, useRef, useCallback } from 'react';
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
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setPhotos(prev => [...prev, ...files].slice(0, 15));
    }
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

        {photos.length < 15 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-indigo-400 transition-colors flex flex-col items-center justify-center gap-2 text-gray-500"
          >
            <Upload size={24} />
            <span className="text-sm font-medium">Ajouter</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
          <li>• Photographiez de face, bien droit</li>
          <li>• Assurez un bon éclairage (pas de reflets)</li>
          <li>• Incluez toutes les rangées du tableau</li>
          <li>• Zoomez sur les zones avec petits caractères si besoin</li>
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

const AnalysisStep = ({ photos, switchboardId, onComplete, onError }) => {
  const [status, setStatus] = useState('uploading');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Envoi des photos...');
  const [jobId, setJobId] = useState(null);

  React.useEffect(() => {
    let cancelled = false;
    let pollInterval = null;

    const startAnalysis = async () => {
      try {
        setProgress(5);
        setMessage('Envoi des photos...');

        // Start the async job
        const response = await api.switchboard.analyzePanel(photos, switchboardId);

        if (cancelled) return;

        if (response.job_id) {
          // Async mode - start polling
          setJobId(response.job_id);
          setStatus('analyzing');
          setProgress(10);
          setMessage('Analyse IA démarrée...');

          // Poll for job status
          pollInterval = setInterval(async () => {
            try {
              const job = await api.switchboard.getPanelScanJob(response.job_id);

              if (cancelled) return;

              setProgress(job.progress || 0);
              setMessage(job.message || 'Analyse en cours...');

              if (job.status === 'completed') {
                clearInterval(pollInterval);
                setStatus('complete');
                setProgress(100);
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
  }, [photos, switchboardId, onComplete, onError]);

  return (
    <div className="py-12 text-center">
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

      <p className="text-gray-600 mb-6">{message}</p>

      {/* Progress bar */}
      <div className="max-w-xs mx-auto">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              status === 'error' ? 'bg-red-500' : 'bg-indigo-600'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-sm text-gray-500">{progress}%</div>
      </div>

      {/* Info about photos being analyzed */}
      <div className="mt-8 flex justify-center gap-2">
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
          <p>Vous recevrez une notification quand l'analyse sera terminée.</p>
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

  const selectedCount = devices.filter(d => d.selected).length;

  const getConfidenceBadge = (confidence) => {
    const colors = {
      high: 'bg-green-100 text-green-700',
      medium: 'bg-amber-100 text-amber-700',
      low: 'bg-red-100 text-red-700'
    };
    return colors[confidence] || colors.medium;
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
                <th className="px-3 py-2 text-center">Icu (kA)</th>
                <th className="px-3 py-2 text-center">Pôles</th>
                <th className="px-3 py-2 text-center">Confiance</th>
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
                        className="w-16 px-2 py-1 border rounded text-xs text-center"
                      />
                    ) : (
                      <span className="font-semibold">{device.in_amps || '-'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editingIndex === idx ? (
                      <input
                        type="number"
                        value={device.icu_ka || ''}
                        onChange={(e) => updateDevice(idx, 'icu_ka', parseInt(e.target.value) || null)}
                        className="w-16 px-2 py-1 border rounded text-xs text-center"
                      />
                    ) : (
                      device.icu_ka || '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{device.poles || 1}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceBadge(device.confidence)}`}>
                      {device.confidence === 'high' ? 'Sûr' : device.confidence === 'low' ? 'Incertain' : 'Moyen'}
                    </span>
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
          <p className="text-green-600 font-semibold">
            {result.created} appareil{result.created > 1 ? 's' : ''} créé{result.created > 1 ? 's' : ''} avec succès
          </p>
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

export default function PanelScanWizard({ switchboardId, switchboardName, onClose, onSuccess }) {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [devices, setDevices] = useState([]);
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
