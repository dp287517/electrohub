import { useState, useRef, useEffect } from 'react';
import { Trash2, Check, RotateCcw, Pen, Type } from 'lucide-react';

export default function SignaturePad({ onSave, onCancel, signerName = '' }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [mode, setMode] = useState('draw'); // 'draw' or 'type'
  const [typedSignature, setTypedSignature] = useState(signerName);
  const [lastPoint, setLastPoint] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    // Set canvas size to match display size
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Set drawing styles
    ctx.strokeStyle = '#1a365d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw signature line
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.moveTo(20, rect.height - 30);
    ctx.lineTo(rect.width - 20, rect.height - 30);
    ctx.stroke();

    // Reset for drawing
    ctx.strokeStyle = '#1a365d';
    ctx.lineWidth = 2;
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    setIsDrawing(true);
    setLastPoint(getPos(e));
  };

  const draw = (e) => {
    if (!isDrawing || mode !== 'draw') return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const currentPoint = getPos(e);

    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(currentPoint.x, currentPoint.y);
    ctx.stroke();

    setLastPoint(currentPoint);
    setHasSignature(true);
  };

  const stopDrawing = (e) => {
    if (e) e.preventDefault();
    setIsDrawing(false);
    setLastPoint(null);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw signature line
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.moveTo(20, rect.height - 30);
    ctx.lineTo(rect.width - 20, rect.height - 30);
    ctx.stroke();

    ctx.strokeStyle = '#1a365d';
    ctx.lineWidth = 2;

    setHasSignature(false);
    setTypedSignature('');
  };

  const handleSave = () => {
    if (mode === 'draw') {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL('image/png');
      onSave(dataUrl, 'draw');
    } else {
      // For typed signature, create a canvas with the text
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = 'italic 32px "Brush Script MT", cursive, sans-serif';
      ctx.fillStyle = '#1a365d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedSignature, canvas.width / 2, canvas.height / 2);

      const dataUrl = canvas.toDataURL('image/png');
      onSave(dataUrl, 'type');
    }
  };

  const drawTypedSignature = () => {
    if (mode !== 'type' || !typedSignature) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw signature line
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.moveTo(20, rect.height - 30);
    ctx.lineTo(rect.width - 20, rect.height - 30);
    ctx.stroke();

    // Draw typed signature
    ctx.font = 'italic 32px "Brush Script MT", cursive, sans-serif';
    ctx.fillStyle = '#1a365d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedSignature, rect.width / 2, rect.height / 2);

    setHasSignature(typedSignature.length > 0);
  };

  useEffect(() => {
    if (mode === 'type') {
      drawTypedSignature();
    }
  }, [typedSignature, mode]);

  const canSave = mode === 'draw' ? hasSignature : typedSignature.length > 2;

  return (
    <div className="bg-white rounded-xl shadow-xl overflow-hidden max-w-lg w-full mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4">
        <h3 className="text-lg font-semibold text-white">Signer le document</h3>
        <p className="text-violet-200 text-sm">Dessinez ou tapez votre signature</p>
      </div>

      {/* Mode Toggle */}
      <div className="flex border-b">
        <button
          onClick={() => { setMode('draw'); clearCanvas(); }}
          className={`flex-1 py-3 flex items-center justify-center gap-2 transition-colors ${
            mode === 'draw'
              ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-600'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Pen className="w-4 h-4" />
          Dessiner
        </button>
        <button
          onClick={() => { setMode('type'); clearCanvas(); setTypedSignature(signerName); }}
          className={`flex-1 py-3 flex items-center justify-center gap-2 transition-colors ${
            mode === 'type'
              ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-600'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Type className="w-4 h-4" />
          Taper
        </button>
      </div>

      {/* Canvas */}
      <div className="p-4">
        {mode === 'type' && (
          <input
            type="text"
            value={typedSignature}
            onChange={(e) => setTypedSignature(e.target.value)}
            placeholder="Tapez votre nom..."
            className="w-full px-4 py-2 border rounded-lg mb-4 text-lg"
            autoFocus
          />
        )}

        <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <canvas
            ref={canvasRef}
            className="w-full h-40 touch-none cursor-crosshair"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />

          {!hasSignature && mode === 'draw' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-gray-400 text-sm">
                {window.matchMedia('(pointer: coarse)').matches
                  ? 'Signez avec votre doigt'
                  : 'Signez avec la souris'}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-4">
          <button
            onClick={clearCanvas}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Effacer
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 p-4 border-t bg-gray-50">
        <button
          onClick={onCancel}
          className="flex-1 py-3 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
        >
          Annuler
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors ${
            canSave
              ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          <Check className="w-5 h-5" />
          Valider la signature
        </button>
      </div>
    </div>
  );
}
