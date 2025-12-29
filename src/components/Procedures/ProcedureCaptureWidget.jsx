import { useState, useRef, useEffect } from 'react';
import { Camera, X, ArrowLeft, Trash2, Check, Plus, Monitor } from 'lucide-react';
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

  const [showGallery, setShowGallery] = useState(false);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [justCaptured, setJustCaptured] = useState(false);
  const fileInputRef = useRef(null);

  // Detect platform
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isDesktop = !isMobile;

  // Listen for paste events (desktop)
  useEffect(() => {
    if (!isCapturing || isMobile) return;

    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            addCapture(file, '');
            showCapturedFeedback();
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isCapturing, isMobile, addCapture]);

  // Visual feedback when captured
  const showCapturedFeedback = () => {
    setJustCaptured(true);
    setTimeout(() => setJustCaptured(false), 1000);
  };

  // Handle file/photo selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        addCapture(file, '');
      }
    });
    if (files.length > 0) showCapturedFeedback();
    e.target.value = '';
  };

  // Screen capture (desktop only)
  const handleScreenCapture = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;

    setIsCapturingScreen(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window' },
        preferCurrentTab: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise(r => setTimeout(r, 100));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      stream.getTracks().forEach(t => t.stop());

      canvas.toBlob((blob) => {
        if (blob) {
          addCapture(new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' }), '');
          showCapturedFeedback();
        }
      }, 'image/png');
    } catch (e) {
      if (e.name !== 'NotAllowedError') console.error(e);
    } finally {
      setIsCapturingScreen(false);
    }
  };

  if (!isCapturing) return null;

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={isDesktop}
        capture={isMobile ? "environment" : undefined}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Main Widget - Fixed bottom center on mobile, bottom right on desktop */}
      <div className={`fixed z-50 ${isMobile ? 'bottom-4 left-4 right-4' : 'bottom-6 right-6'}`}>
        <div className={`bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden ${isMobile ? '' : 'w-72'}`}>

          {/* Header - Minimal */}
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-white">
              <div className="relative">
                <Camera className="w-5 h-5" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              </div>
              <span className="font-medium text-sm">
                {captureCount > 0 ? `${captureCount} capture${captureCount > 1 ? 's' : ''}` : 'Mode Capture'}
              </span>
            </div>
            <button
              onClick={endCaptureSession}
              className="p-1 rounded-full hover:bg-white/20 text-white/80 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Capture Success Animation */}
          {justCaptured && (
            <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-green-500 text-white rounded-full p-3 animate-bounce">
                <Check className="w-8 h-8" />
              </div>
            </div>
          )}

          {/* Main Action Area */}
          <div className="p-4">
            {/* Captures Preview (if any) */}
            {captureCount > 0 && (
              <div className="mb-4">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {captures.slice(-5).map((cap, i) => (
                    <div key={cap.id} className="relative flex-shrink-0">
                      <img
                        src={cap.preview}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover border-2 border-gray-200"
                      />
                      <button
                        onClick={() => removeCapture(cap.id)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white shadow"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {captureCount > 5 && (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-medium flex-shrink-0">
                      +{captureCount - 5}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* MOBILE: Simple big button */}
            {isMobile && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl flex flex-col items-center justify-center gap-2 text-white active:scale-[0.98] transition-transform shadow-lg"
              >
                <Camera className="w-10 h-10" />
                <span className="font-semibold text-lg">Prendre une photo</span>
                <span className="text-white/70 text-xs">ou importer depuis la galerie</span>
              </button>
            )}

            {/* DESKTOP: Two options */}
            {isDesktop && (
              <div className="space-y-2">
                {/* Screen Capture */}
                <button
                  onClick={handleScreenCapture}
                  disabled={isCapturingScreen}
                  className="w-full py-4 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center gap-3 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Monitor className="w-6 h-6" />
                  <span className="font-medium">Capturer une fenêtre</span>
                </button>

                {/* Import or Paste hint */}
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-3 bg-gray-100 rounded-xl flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-sm font-medium">Importer</span>
                  </button>
                  <div className="flex-1 py-3 bg-amber-50 border border-dashed border-amber-300 rounded-xl flex items-center justify-center gap-2 text-amber-700">
                    <span className="text-sm font-medium">Ctrl+V</span>
                  </div>
                </div>

                <p className="text-xs text-gray-400 text-center mt-2">
                  Astuce : Win+Shift+S → sélection → Ctrl+V ici
                </p>
              </div>
            )}
          </div>

          {/* Return Button */}
          <div className="px-4 pb-4">
            <button
              onClick={returnToProcedure}
              className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                captureCount > 0
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <ArrowLeft className="w-5 h-5" />
              {captureCount > 0 ? `Utiliser ${captureCount} capture${captureCount > 1 ? 's' : ''}` : 'Retour sans capture'}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile: Floating mini button when scrolled (optional enhancement) */}
    </>
  );
}
