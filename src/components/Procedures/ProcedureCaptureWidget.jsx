import { useState, useRef, useEffect } from 'react';
import { Camera, X, ArrowLeft, Check, FolderOpen } from 'lucide-react';
import { useProcedureCapture } from '../../contexts/ProcedureCaptureContext';

export default function ProcedureCaptureWidget() {
  const {
    isCapturing,
    procedureInfo,
    captures,
    captureCount,
    addCapture,
    removeCapture,
    returnToProcedure,
    endCaptureSession
  } = useProcedureCapture();

  const [justCaptured, setJustCaptured] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  // Hide onboarding after first capture
  useEffect(() => {
    if (captureCount > 0) {
      setShowOnboarding(false);
    }
  }, [captureCount]);

  // Visual + haptic feedback when captured
  const showCapturedFeedback = () => {
    setJustCaptured(true);
    // Vibration on mobile if available
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }
    setTimeout(() => setJustCaptured(false), 1500);
  };

  // Handle camera capture
  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      addCapture(file, '');
      showCapturedFeedback();
    }
    e.target.value = '';
  };

  // Handle gallery import
  const handleGalleryImport = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        addCapture(file, '');
      }
    });
    if (files.length > 0) showCapturedFeedback();
    e.target.value = '';
  };

  if (!isCapturing) return null;

  return (
    <>
      {/* Hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraCapture}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryImport}
        className="hidden"
      />

      {/* Full screen overlay */}
      <div className="fixed inset-0 z-50 bg-gray-900/95 flex flex-col">

        {/* Header */}
        <div className="bg-violet-600 px-4 py-4 flex items-center justify-between safe-area-top">
          <div className="text-white">
            <h1 className="font-bold text-lg">Mode Capture</h1>
            <p className="text-violet-200 text-sm">
              {procedureInfo?.title || 'Procédure en cours'}
            </p>
          </div>
          <button
            onClick={endCaptureSession}
            className="p-2 bg-white/20 rounded-full text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">

          {/* Success animation overlay */}
          {justCaptured && (
            <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center z-20 pointer-events-none">
              <div className="bg-green-500 text-white rounded-full p-6 animate-bounce shadow-2xl">
                <Check className="w-16 h-16" />
              </div>
              <p className="absolute bottom-1/3 text-white text-2xl font-bold">
                Photo ajoutée !
              </p>
            </div>
          )}

          {/* Onboarding message */}
          {showOnboarding && captureCount === 0 && (
            <div className="bg-white rounded-2xl p-6 mb-8 max-w-sm text-center shadow-xl">
              <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Camera className="w-8 h-8 text-violet-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Capturez vos photos
              </h2>
              <ol className="text-left text-gray-600 space-y-3 mb-4">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-violet-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                  <span><strong>Prenez une photo</strong> avec la caméra</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-violet-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                  <span>Ou <strong>importez depuis la galerie</strong> (screenshots d'autres apps, photos existantes...)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-violet-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
                  <span>Appuyez sur <strong>"Terminer"</strong> quand vous avez toutes les photos</span>
                </li>
              </ol>
              <p className="text-xs text-gray-400 mt-2">
                💡 Chaque photo = une étape de la procédure
              </p>
            </div>
          )}

          {/* Captures grid */}
          {captureCount > 0 && (
            <div className="w-full max-w-sm mb-6">
              <p className="text-white text-center mb-3 font-medium">
                {captureCount} photo{captureCount > 1 ? 's' : ''} capturée{captureCount > 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {captures.map((cap, i) => (
                  <div key={cap.id} className="relative aspect-square">
                    <img
                      src={cap.preview}
                      alt=""
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeCapture(cap.id)}
                      className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 rounded">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom action buttons */}
        <div className="p-4 space-y-3 safe-area-bottom bg-gray-900">

          {/* Main capture button */}
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full py-5 bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center gap-3 text-white active:scale-[0.98] transition-transform shadow-lg"
          >
            <Camera className="w-8 h-8" />
            <span className="font-bold text-xl">Prendre une photo</span>
          </button>

          {/* Gallery import button */}
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full py-3 bg-gray-700 rounded-xl flex items-center justify-center gap-2 text-gray-200 active:scale-[0.98] transition-transform"
          >
            <FolderOpen className="w-5 h-5" />
            <span className="font-medium">Importer depuis la galerie</span>
          </button>

          {/* Return button */}
          <button
            onClick={returnToProcedure}
            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${
              captureCount > 0
                ? 'bg-green-500 text-white active:bg-green-600'
                : 'bg-gray-700 text-gray-300 active:bg-gray-600'
            }`}
          >
            <ArrowLeft className="w-6 h-6" />
            {captureCount > 0
              ? `Terminer avec ${captureCount} photo${captureCount > 1 ? 's' : ''}`
              : 'Annuler et revenir'
            }
          </button>
        </div>
      </div>
    </>
  );
}
