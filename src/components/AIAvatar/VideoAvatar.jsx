/**
 * VideoAvatar - Composant d'avatar vidéo animé
 *
 * Affiche une vidéo MP4 qui peut être en deux états:
 * - idle: vidéo en boucle quand l'IA est inactive
 * - speaking: vidéo en boucle quand l'IA parle/répond
 *
 * Supporte les vidéos personnalisées via l'API admin.
 */

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';

// Cache global pour les vidéos personnalisées
let videoCache = { checked: false, idle: null, speaking: null };

// Vérifier si des vidéos personnalisées existent
async function checkCustomVideos() {
  if (videoCache.checked) return videoCache;

  try {
    const res = await fetch('/api/admin/settings/ai-video/info');
    const data = await res.json();
    if (data.hasIdleVideo) {
      videoCache.idle = `/api/admin/settings/ai-video/idle?t=${Date.now()}`;
    }
    if (data.hasSpeakingVideo) {
      videoCache.speaking = `/api/admin/settings/ai-video/speaking?t=${Date.now()}`;
    }
  } catch (e) {
    // Silently fail - fallback to AnimatedAvatar
  }
  videoCache.checked = true;
  return videoCache;
}

// Force refresh des vidéos (appelée après upload)
export function refreshVideoCache() {
  videoCache = { checked: false, idle: null, speaking: null };
}

// Tailles prédéfinies
const SIZES = {
  xs: { width: 32, height: 32 },
  sm: { width: 48, height: 48 },
  md: { width: 64, height: 64 },
  lg: { width: 96, height: 96 },
  xl: { width: 128, height: 128 }
};

const VideoAvatar = forwardRef(({
  style = 'ai',
  size = 'md',
  speaking = false,
  onClick,
  className = '',
  // Sources vidéo personnalisées (optionnel)
  idleVideoSrc = null,
  speakingVideoSrc = null,
  // Fallback vers AnimatedAvatar si pas de vidéo
  fallbackToAnimated = true
}, ref) => {
  const [hasVideo, setHasVideo] = useState(false);
  const [idleUrl, setIdleUrl] = useState(idleVideoSrc);
  const [speakingUrl, setSpeakingUrl] = useState(speakingVideoSrc);
  const [currentSrc, setCurrentSrc] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const idleVideoRef = useRef(null);
  const speakingVideoRef = useRef(null);
  const containerRef = useRef(null);

  // Exposer des méthodes via ref
  useImperativeHandle(ref, () => ({
    speak: () => {
      if (speakingVideoRef.current) {
        speakingVideoRef.current.play().catch(() => {});
      }
    },
    stopSpeaking: () => {
      if (idleVideoRef.current) {
        idleVideoRef.current.play().catch(() => {});
      }
    }
  }));

  // Charger les vidéos personnalisées au montage
  useEffect(() => {
    if (!idleVideoSrc && !speakingVideoSrc) {
      checkCustomVideos().then(cache => {
        if (cache.idle || cache.speaking) {
          setHasVideo(true);
          setIdleUrl(cache.idle || cache.speaking);
          setSpeakingUrl(cache.speaking || cache.idle);
        }
      });
    } else {
      setHasVideo(true);
    }
  }, [idleVideoSrc, speakingVideoSrc]);

  // Gérer le changement d'état speaking
  useEffect(() => {
    if (!hasVideo) return;

    const idleVideo = idleVideoRef.current;
    const speakingVideo = speakingVideoRef.current;

    if (speaking) {
      // Passer en mode speaking
      if (speakingVideo) {
        speakingVideo.style.opacity = '1';
        speakingVideo.play().catch(() => {});
      }
      if (idleVideo) {
        idleVideo.style.opacity = '0';
        idleVideo.pause();
      }
    } else {
      // Retour en mode idle
      if (idleVideo) {
        idleVideo.style.opacity = '1';
        idleVideo.play().catch(() => {});
      }
      if (speakingVideo) {
        speakingVideo.style.opacity = '0';
        speakingVideo.pause();
      }
    }
  }, [speaking, hasVideo]);

  // Si pas de vidéo, utiliser AnimatedAvatar
  if (!hasVideo && fallbackToAnimated) {
    return (
      <AnimatedAvatar
        style={style}
        size={size}
        speaking={speaking}
        onClick={onClick}
        className={className}
      />
    );
  }

  const dimensions = SIZES[size] || SIZES.md;
  const avatarStyle = AVATAR_STYLES[style] || AVATAR_STYLES.ai;

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      className={`relative overflow-hidden rounded-full cursor-pointer ${className}`}
      style={{
        width: dimensions.width,
        height: dimensions.height,
        backgroundColor: avatarStyle.primaryColor
      }}
    >
      {/* Vidéo idle (toujours présente, opacité variable) */}
      {idleUrl && (
        <video
          ref={idleVideoRef}
          src={idleUrl}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: speaking ? 0 : 1 }}
          onLoadedData={() => setIsLoaded(true)}
        />
      )}

      {/* Vidéo speaking (superposée, opacité variable) */}
      {speakingUrl && speakingUrl !== idleUrl && (
        <video
          ref={speakingVideoRef}
          src={speakingUrl}
          autoPlay={speaking}
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: speaking ? 1 : 0 }}
        />
      )}

      {/* Overlay de pulsation quand parle (si même vidéo) */}
      {speaking && speakingUrl === idleUrl && (
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{
            boxShadow: `0 0 20px ${avatarStyle.accentColor}`,
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Indicateur de chargement */}
      {!isLoaded && hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800/50">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';

export { VideoAvatar, SIZES as VIDEO_AVATAR_SIZES };
export default VideoAvatar;
