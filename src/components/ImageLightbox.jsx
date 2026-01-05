// src/components/ImageLightbox.jsx - Reusable lightbox for image enlargement
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function ImageLightbox({ src, title, onClose }) {
  // Handle keyboard escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[10001] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors text-lg font-medium flex items-center gap-2"
        >
          <span>Fermer</span>
          <X className="w-6 h-6" />
        </button>

        {/* Title */}
        {title && (
          <div className="absolute -top-12 left-0 text-white text-lg font-medium truncate max-w-[70%]">
            {title}
          </div>
        )}

        {/* Image */}
        <img
          src={src}
          alt={title || "Photo agrandie"}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />

        {/* Instructions */}
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-gray-400 text-sm">
          Cliquez en dehors de l'image ou appuyez sur Echap pour fermer
        </div>
      </div>
    </div>
  );
}

// Hook for lightbox state management
export function useLightbox() {
  const [lightbox, setLightbox] = React.useState({ open: false, src: null, title: '' });

  const openLightbox = (src, title = '') => {
    setLightbox({ open: true, src, title });
  };

  const closeLightbox = () => {
    setLightbox({ open: false, src: null, title: '' });
  };

  return { lightbox, openLightbox, closeLightbox };
}
