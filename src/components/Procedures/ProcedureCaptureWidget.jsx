import { useState, useRef, useEffect } from 'react';
import {
  Camera, X, Check, FolderOpen, Monitor, Minimize2,
  Maximize2, ArrowRight, Smartphone, Info
} from 'lucide-react';
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
    endCaptureSession,
    minimizeModal,
    shouldReopenModal
  } = useProcedureCapture();

  const [isMinimized, setIsMinimized] = useState(false);
  const [justCaptured, setJustCaptured] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Detect platform
  useEffect(() => {
    const checkDesktop = () => {
      const isDesktopDevice = window.innerWidth >= 1024 && !('ontouchstart' in window);
      setIsDesktop(isDesktopDevice);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Hide help after first capture
  useEffect(() => {
    if (captureCount > 0) setShowHelp(false);
  }, [captureCount]);

  // Visual + haptic feedback
  const showCapturedFeedback = () => {
    setJustCaptured(true);
    if (navigator.vibrate) navigator.vibrate(100);
    setTimeout(() => setJustCaptured(false), 1500);
  };

  // Desktop: Screen capture via getDisplayMedia
  const handleScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' }
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      stream.getTracks().forEach(track => track.stop());

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
          addCapture(file, '');
          showCapturedFeedback();
        }
      }, 'image/png');
    } catch (err) {
      console.log('Screen capture cancelled or failed:', err);
    }
  };

  // Camera capture (mobile)
  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      addCapture(file, '');
      showCapturedFeedback();
    }
    e.target.value = '';
  };

  // Gallery import
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

  // Hidden inputs
  const hiddenInputs = (
    <>
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
    </>
  );

  // MINIMIZED MODE - Floating button
  if (isMinimized) {
    return (
      <>
        {hiddenInputs}
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
          {/* Capture count badge */}
          {captureCount > 0 && (
            <div className="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg">
              {captureCount} photo{captureCount > 1 ? 's' : ''}
            </div>
          )}

          {/* Main floating button - Reopen modal */}
          <button
            onClick={() => {
              setIsMinimized(false);
              returnToProcedure(); // This will set shouldReopenModal and trigger modal reopen
            }}
            className="w-16 h-16 bg-gradient-to-br from-violet-600 to-purple-700 rounded-full shadow-2xl flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <Maximize2 className="w-7 h-7" />
          </button>

          {/* Quick actions */}
          <div className="flex gap-2">
            {isDesktop ? (
              <button
                onClick={handleScreenCapture}
                className="w-12 h-12 bg-blue-600 rounded-full shadow-lg flex items-center justify-center text-white active:scale-95"
                title="Capturer l'écran"
              >
                <Monitor className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-12 h-12 bg-violet-600 rounded-full shadow-lg flex items-center justify-center text-white active:scale-95"
                title="Prendre photo"
              >
                <Camera className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="w-12 h-12 bg-gray-700 rounded-full shadow-lg flex items-center justify-center text-white active:scale-95"
              title="Importer"
            >
              <FolderOpen className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Success flash */}
        {justCaptured && (
          <div className="fixed inset-0 z-40 bg-green-500/30 pointer-events-none flex items-center justify-center">
            <div className="bg-green-500 text-white rounded-full p-4 animate-ping">
              <Check className="w-10 h-10" />
            </div>
          </div>
        )}
      </>
    );
  }

  // EXPANDED MODE - Bottom panel
  return (
    <>
      {hiddenInputs}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={() => setIsMinimized(true)}
      />

      {/* Bottom panel */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 rounded-t-3xl max-h-[85vh] flex flex-col safe-area-bottom">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white">Mode Capture</h2>
              <p className="text-xs text-gray-400 truncate max-w-[200px]">
                {procedureInfo?.title || 'Procédure en cours'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setIsMinimized(true);
                minimizeModal(); // Signal to close the ProcedureCreator modal
              }}
              className="p-2 bg-gray-700 rounded-lg text-gray-300"
              title="Naviguer librement"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
            <button
              onClick={endCaptureSession}
              className="p-2 bg-gray-700 rounded-lg text-gray-300"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Help section */}
        {showHelp && (
          <div className="mx-4 mt-4 p-4 bg-violet-900/50 rounded-xl border border-violet-700">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-violet-200">
                {isDesktop ? (
                  <>
                    <p className="font-medium mb-1">💻 Sur ordinateur :</p>
                    <p>Cliquez sur <strong>"Capturer l'écran"</strong> pour sélectionner une fenêtre ou tout l'écran d'une autre application.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium mb-1">📱 Sur mobile/tablette :</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li><strong>Minimisez</strong> ce panneau (bouton en haut)</li>
                      <li><strong>Sortez de l'app</strong> et naviguez où vous voulez</li>
                      <li><strong>Faites des captures</strong> (Power + Volume)</li>
                      <li><strong>Revenez ici</strong> et importez depuis la galerie</li>
                    </ol>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowHelp(false)}
              className="mt-2 text-xs text-violet-400 underline"
            >
              Masquer l'aide
            </button>
          </div>
        )}

        {/* Captures preview */}
        {captureCount > 0 && (
          <div className="px-4 py-3">
            <p className="text-white text-sm mb-2 font-medium">
              {captureCount} capture{captureCount > 1 ? 's' : ''} :
            </p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {captures.map((cap, i) => (
                <div key={cap.id} className="relative flex-shrink-0">
                  <img
                    src={cap.preview}
                    alt=""
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeCapture(cap.id)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <span className="absolute bottom-0.5 left-0.5 bg-black/70 text-white text-[10px] px-1 rounded">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="p-4 space-y-3 mt-auto">
          {/* Desktop: Screen capture */}
          {isDesktop && (
            <button
              onClick={handleScreenCapture}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center gap-3 text-white font-bold active:scale-[0.98] transition-transform"
            >
              <Monitor className="w-6 h-6" />
              Capturer l'écran d'une autre app
            </button>
          )}

          {/* Mobile: Camera */}
          {!isDesktop && (
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full py-4 bg-gradient-to-r from-violet-600 to-purple-600 rounded-xl flex items-center justify-center gap-3 text-white font-bold active:scale-[0.98] transition-transform"
            >
              <Camera className="w-6 h-6" />
              Prendre une photo
            </button>
          )}

          {/* Import from gallery */}
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full py-3 bg-gray-700 rounded-xl flex items-center justify-center gap-2 text-gray-200 font-medium active:scale-[0.98]"
          >
            <FolderOpen className="w-5 h-5" />
            Importer depuis la galerie
            {!isDesktop && <span className="text-xs text-gray-400">(captures d'autres apps)</span>}
          </button>

          {/* Finish button */}
          <button
            onClick={returnToProcedure}
            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
              captureCount > 0
                ? 'bg-green-500 text-white active:bg-green-600'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {captureCount > 0 ? (
              <>
                Terminer avec {captureCount} photo{captureCount > 1 ? 's' : ''}
                <ArrowRight className="w-5 h-5" />
              </>
            ) : (
              'Annuler'
            )}
          </button>
        </div>
      </div>

      {/* Success flash */}
      {justCaptured && (
        <div className="fixed inset-0 z-[60] bg-green-500/30 pointer-events-none flex items-center justify-center">
          <div className="bg-green-500 text-white rounded-full p-6 shadow-2xl animate-bounce">
            <Check className="w-12 h-12" />
          </div>
        </div>
      )}
    </>
  );
}
