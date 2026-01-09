// DurationPicker - Sélecteur de durée avec presets et mode personnalisé
import { useState, useRef, useEffect } from 'react';
import { Timer, ChevronUp, ChevronDown, X } from 'lucide-react';

export default function DurationPicker({
  value = 0, // valeur en minutes
  onChange,
  label,
  placeholder = "Sélectionner la durée",
  className = '',
  showPresets = true,
  color = 'orange' // 'orange' ou 'red' pour le temps d'arrêt
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hours, setHours] = useState(Math.floor(value / 60));
  const [minutes, setMinutes] = useState(value % 60);
  const containerRef = useRef(null);

  // Color variants
  const colors = {
    orange: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-600',
      gradient: 'from-orange-500 to-red-500',
      gradientHover: 'hover:from-orange-600 hover:to-red-600',
      ring: 'focus:ring-orange-500',
      preset: 'bg-orange-100 hover:bg-orange-200 text-orange-700'
    },
    red: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-600',
      gradient: 'from-red-500 to-red-600',
      gradientHover: 'hover:from-red-600 hover:to-red-700',
      ring: 'focus:ring-red-500',
      preset: 'bg-red-100 hover:bg-red-200 text-red-700'
    }
  };
  const c = colors[color] || colors.orange;

  // Sync internal state with value prop
  useEffect(() => {
    setHours(Math.floor(value / 60));
    setMinutes(value % 60);
  }, [value]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDuration = (totalMinutes) => {
    if (totalMinutes === 0) return null;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  };

  const handleConfirm = () => {
    const totalMinutes = hours * 60 + minutes;
    onChange(totalMinutes);
    setIsOpen(false);
  };

  const setPreset = (totalMinutes) => {
    onChange(totalMinutes);
    setIsOpen(false);
  };

  const incrementHours = () => setHours(h => Math.min(h + 1, 23));
  const decrementHours = () => setHours(h => Math.max(h - 1, 0));
  const incrementMinutes = () => setMinutes(m => (m + 5) % 60);
  const decrementMinutes = () => setMinutes(m => (m - 5 + 60) % 60);

  // Quick presets
  const presets = [
    { label: '15 min', value: 15 },
    { label: '30 min', value: 30 },
    { label: '45 min', value: 45 },
    { label: '1h', value: 60 },
    { label: '1h30', value: 90 },
    { label: '2h', value: 120 },
    { label: '3h', value: 180 },
    { label: '4h', value: 240 },
  ];

  const displayValue = formatDuration(value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}

      {/* Input button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-3 border border-gray-300 rounded-xl ${c.ring} focus:ring-2 focus:border-transparent bg-white text-left flex items-center gap-3 hover:border-gray-400 transition-colors`}
      >
        <Timer className={`w-5 h-5 ${displayValue ? c.text : 'text-gray-400'}`} />
        <span className={displayValue ? `${c.text} font-medium` : 'text-gray-400'}>
          {displayValue || placeholder}
        </span>
      </button>

      {/* Dropdown picker */}
      {isOpen && (
        <div className="absolute z-50 mt-2 w-full bg-white rounded-2xl shadow-xl border border-gray-200 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">Choisir la durée</span>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={16} className="text-gray-400" />
            </button>
          </div>

          {/* Quick presets */}
          {showPresets && (
            <div className="flex flex-wrap gap-2 mb-4">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setPreset(preset.value)}
                  className={`px-3 py-1.5 text-xs font-medium ${c.preset} rounded-lg transition-colors`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">ou personnaliser</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Duration wheels */}
          <div className="flex items-center justify-center gap-4 mb-4">
            {/* Hours */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={incrementHours}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronUp size={20} className="text-gray-500" />
              </button>
              <div className={`w-16 h-14 flex items-center justify-center ${c.bg} rounded-xl border-2 ${c.border}`}>
                <span className={`text-2xl font-bold ${c.text}`}>
                  {hours}
                </span>
              </div>
              <button
                type="button"
                onClick={decrementHours}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronDown size={20} className="text-gray-500" />
              </button>
              <span className="text-xs text-gray-400 mt-1">Heures</span>
            </div>

            <span className="text-2xl font-bold text-gray-300 mt-[-20px]">h</span>

            {/* Minutes */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={incrementMinutes}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronUp size={20} className="text-gray-500" />
              </button>
              <div className={`w-16 h-14 flex items-center justify-center ${c.bg} rounded-xl border-2 ${c.border}`}>
                <span className={`text-2xl font-bold ${c.text}`}>
                  {minutes.toString().padStart(2, '0')}
                </span>
              </div>
              <button
                type="button"
                onClick={decrementMinutes}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronDown size={20} className="text-gray-500" />
              </button>
              <span className="text-xs text-gray-400 mt-1">Minutes</span>
            </div>
          </div>

          {/* Display total */}
          <div className="text-center text-sm text-gray-500 mb-4">
            Total : <span className={`font-medium ${c.text}`}>{formatDuration(hours * 60 + minutes) || '0 min'}</span>
          </div>

          {/* Confirm button */}
          <button
            type="button"
            onClick={handleConfirm}
            className={`w-full py-2.5 bg-gradient-to-r ${c.gradient} text-white rounded-xl font-medium ${c.gradientHover} transition-all`}
          >
            Confirmer
          </button>
        </div>
      )}
    </div>
  );
}
