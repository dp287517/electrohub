import { useState, useRef, useEffect } from 'react';
import {
  Camera, X, ChevronUp, ChevronDown, ArrowLeft, Trash2,
  Image, FileText, Minimize2, Maximize2, Check, Plus, Pause
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
    updateCaptureDescription,
    returnToProcedure,
    endCaptureSession,
    stopCapture
  } = useProcedureCapture();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [editingCapture, setEditingCapture] = useState(null);
  const [description, setDescription] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Don't render if not capturing
  if (!isCapturing) return null;

  // Handle file selection (from gallery)
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        addCapture(file, '');
      }
    });
    e.target.value = '';
  };

  // Handle camera capture
  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      addCapture(file, '');
    }
    e.target.value = '';
  };

  // Handle description save
  const saveDescription = () => {
    if (editingCapture) {
      updateCaptureDescription(editingCapture, description);
      setEditingCapture(null);
      setDescription('');
    }
  };

  // Minimized view - just a small indicator
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="relative w-14 h-14 bg-gradient-to-br from-violet-600 to-purple-600 rounded-full shadow-lg shadow-violet-300 flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <Camera className="w-6 h-6" />
          {captureCount > 0 && (
            <span className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full text-white text-xs font-bold flex items-center justify-center border-2 border-white">
              {captureCount}
            </span>
          )}
          <span className="absolute -bottom-1 -left-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Main floating widget */}
      <div className={`fixed bottom-20 right-4 z-50 transition-all duration-300 ${isExpanded ? 'w-72' : 'w-auto'}`}>
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Camera className="w-5 h-5 text-white" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border border-white animate-pulse" />
                </div>
                <div className="text-white">
                  <p className="text-sm font-medium leading-tight">Mode Capture</p>
                  {procedureInfo?.title && (
                    <p className="text-[10px] text-white/70 truncate max-w-[140px]">
                      {procedureInfo.title}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsMinimized(true)}
                  className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
                  title="Réduire"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Capture count and quick actions */}
          <div className="p-3 border-b bg-gray-50">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                {/* Camera button */}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-200 active:scale-95 transition-transform"
                  title="Prendre une photo"
                >
                  <Camera className="w-6 h-6" />
                </button>
                {/* Gallery button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600 active:scale-95 transition-transform hover:bg-gray-200"
                  title="Choisir depuis la galerie"
                >
                  <Image className="w-5 h-5" />
                </button>
              </div>

              {/* Capture count */}
              <button
                onClick={() => setShowGallery(true)}
                disabled={captureCount === 0}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
                  captureCount > 0
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span className="font-medium">{captureCount}</span>
              </button>
            </div>
          </div>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCameraCapture}
            className="hidden"
          />

          {/* Expanded content - recent captures preview */}
          {isExpanded && (
            <div className="p-3 space-y-3">
              {/* Recent captures preview */}
              {captures.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Captures récentes</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {captures.slice(-4).map((capture) => (
                      <div
                        key={capture.id}
                        className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border-2 border-gray-200"
                      >
                        <img
                          src={capture.preview}
                          alt="Capture"
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeCapture(capture.id)}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {captures.length > 4 && (
                      <button
                        onClick={() => setShowGallery(true)}
                        className="w-16 h-16 flex-shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-medium"
                      >
                        +{captures.length - 4}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {captures.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">
                  Naviguez dans l'app et prenez des photos
                </p>
              )}
            </div>
          )}

          {/* Actions footer */}
          <div className="p-3 border-t bg-gray-50 flex gap-2">
            <button
              onClick={returnToProcedure}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white rounded-xl font-medium active:scale-[0.98] transition-transform"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour
              {captureCount > 0 && (
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                  {captureCount}
                </span>
              )}
            </button>
            <button
              onClick={stopCapture}
              className="p-2.5 text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              title="Mettre en pause"
            >
              <Pause className="w-5 h-5" />
            </button>
            <button
              onClick={endCaptureSession}
              className="p-2.5 text-red-500 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
              title="Terminer et effacer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Full gallery modal */}
      {showGallery && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            {/* Gallery header */}
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Captures ({captureCount})
              </h3>
              <button
                onClick={() => setShowGallery(false)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Gallery content */}
            <div className="flex-1 overflow-y-auto p-4">
              {captures.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Aucune capture</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {captures.map((capture, index) => (
                    <div
                      key={capture.id}
                      className="relative bg-gray-100 rounded-xl overflow-hidden"
                    >
                      <img
                        src={capture.preview}
                        alt={`Capture ${index + 1}`}
                        className="w-full aspect-square object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                        {editingCapture === capture.id ? (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              placeholder="Description..."
                              className="flex-1 text-xs px-2 py-1 rounded bg-white text-gray-800"
                              autoFocus
                            />
                            <button
                              onClick={saveDescription}
                              className="p-1 bg-green-500 text-white rounded"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingCapture(capture.id);
                              setDescription(capture.description || '');
                            }}
                            className="w-full text-left"
                          >
                            <p className="text-xs text-white truncate">
                              {capture.description || 'Ajouter une description...'}
                            </p>
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => removeCapture(capture.id)}
                        className="absolute top-2 right-2 w-7 h-7 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/50 rounded-full text-white text-xs font-medium">
                        {index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gallery footer */}
            <div className="p-4 border-t flex gap-2">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 text-white rounded-xl font-medium"
              >
                <Plus className="w-5 h-5" />
                Ajouter
              </button>
              <button
                onClick={() => {
                  setShowGallery(false);
                  returnToProcedure();
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl font-medium"
              >
                <ArrowLeft className="w-5 h-5" />
                Utiliser ({captureCount})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
