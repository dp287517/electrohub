// TimePicker - Sélecteur d'heure avec interface intuitive
import { useState, useRef, useEffect } from 'react';
import { Clock, ChevronUp, ChevronDown, X } from 'lucide-react';

export default function TimePicker({
  value, // format "HH:MM" ou null
  onChange,
  label,
  placeholder = "Sélectionner l'heure",
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hours, setHours] = useState(value ? parseInt(value.split(':')[0]) : new Date().getHours());
  const [minutes, setMinutes] = useState(value ? parseInt(value.split(':')[1]) : 0);
  const containerRef = useRef(null);

  // Sync internal state with value prop
  useEffect(() => {
    if (value) {
      const [h, m] = value.split(':').map(Number);
      setHours(h);
      setMinutes(m);
    }
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

  const formatTime = (h, m) => {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const handleConfirm = () => {
    onChange(formatTime(hours, minutes));
    setIsOpen(false);
  };

  const incrementHours = () => setHours(h => (h + 1) % 24);
  const decrementHours = () => setHours(h => (h - 1 + 24) % 24);
  const incrementMinutes = () => setMinutes(m => (m + 5) % 60);
  const decrementMinutes = () => setMinutes(m => (m - 5 + 60) % 60);

  // Quick time presets
  const presets = [
    { label: 'Maintenant', getValue: () => formatTime(new Date().getHours(), Math.round(new Date().getMinutes() / 5) * 5 % 60) },
    { label: '06:00', getValue: () => '06:00' },
    { label: '08:00', getValue: () => '08:00' },
    { label: '12:00', getValue: () => '12:00' },
    { label: '14:00', getValue: () => '14:00' },
    { label: '18:00', getValue: () => '18:00' },
  ];

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
        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white text-left flex items-center gap-3 hover:border-gray-400 transition-colors"
      >
        <Clock className="w-5 h-5 text-gray-400" />
        <span className={value ? 'text-gray-900 font-medium' : 'text-gray-400'}>
          {value || placeholder}
        </span>
      </button>

      {/* Dropdown picker */}
      {isOpen && (
        <div className="absolute z-50 mt-2 w-full bg-white rounded-2xl shadow-xl border border-gray-200 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">Choisir l'heure</span>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={16} className="text-gray-400" />
            </button>
          </div>

          {/* Time wheels */}
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
              <div className="w-16 h-14 flex items-center justify-center bg-orange-50 rounded-xl border-2 border-orange-200">
                <span className="text-2xl font-bold text-orange-600">
                  {hours.toString().padStart(2, '0')}
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

            <span className="text-2xl font-bold text-gray-300 mt-[-20px]">:</span>

            {/* Minutes */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={incrementMinutes}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronUp size={20} className="text-gray-500" />
              </button>
              <div className="w-16 h-14 flex items-center justify-center bg-orange-50 rounded-xl border-2 border-orange-200">
                <span className="text-2xl font-bold text-orange-600">
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

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2 mb-4">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  const time = preset.getValue();
                  const [h, m] = time.split(':').map(Number);
                  setHours(h);
                  setMinutes(m);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Confirm button */}
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all"
          >
            Confirmer {formatTime(hours, minutes)}
          </button>
        </div>
      )}
    </div>
  );
}
