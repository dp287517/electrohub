import { useState } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';
import { Check, X } from 'lucide-react';

export default function AvatarSelector({ currentStyle, onSelect, onClose }) {
  // Fallback si le style n'existe plus
  const safeCurrentStyle = AVATAR_STYLES[currentStyle] ? currentStyle : 'alex';
  const [selectedStyle, setSelectedStyle] = useState(safeCurrentStyle);
  const [previewSpeaking, setPreviewSpeaking] = useState(null);

  const handleSelect = () => {
    onSelect(selectedStyle);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Choisir votre Assistant</h2>
            <p className="text-brand-200 text-sm">Sélectionnez l'avatar qui vous accompagnera</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Avatar Grid */}
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Object.entries(AVATAR_STYLES).map(([key, avatar]) => (
              <button
                key={key}
                onClick={() => setSelectedStyle(key)}
                onMouseEnter={() => setPreviewSpeaking(key)}
                onMouseLeave={() => setPreviewSpeaking(null)}
                className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                  selectedStyle === key
                    ? 'border-brand-500 bg-brand-50 shadow-lg shadow-brand-500/20'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {/* Check mark */}
                {selectedStyle === key && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}

                {/* Avatar */}
                <div className="flex justify-center mb-3">
                  <AnimatedAvatar
                    style={key}
                    size="lg"
                    speaking={previewSpeaking === key}
                  />
                </div>

                {/* Info */}
                <div className="text-center">
                  <p className="font-bold text-gray-900">{avatar.name}</p>
                  <p className="text-xs text-gray-500">{avatar.description}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Selected Avatar Preview */}
          <div className="mt-6 p-4 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-4">
              <AnimatedAvatar
                style={selectedStyle}
                size="xl"
                speaking={true}
              />
              <div>
                <p className="font-semibold text-gray-900">
                  {AVATAR_STYLES[selectedStyle].name}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Votre assistant personnel pour ElectroHub. Il vous aidera à gérer vos contrôles,
                  analyser les non-conformités et planifier vos actions.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSelect}
            className="px-6 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors font-medium"
          >
            Choisir {AVATAR_STYLES[selectedStyle].name}
          </button>
        </div>
      </div>
    </div>
  );
}
