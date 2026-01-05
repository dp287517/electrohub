/**
 * VideoAvatar - Composant d'avatar vidéo animé multi-agents
 *
 * Affiche une vidéo MP4 qui peut être en deux états:
 * - idle: vidéo en boucle quand l'IA est inactive
 * - speaking: vidéo en boucle quand l'IA parle/répond
 *
 * Supporte les vidéos personnalisées par type d'agent via l'API admin.
 * agentType: 'main' | 'vsd' | 'meca' | 'glo' | 'hv' | 'mobile' | 'atex' | 'switchboard' | 'doors' | 'datahub' | 'firecontrol'
 */

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';

// Cache global pour les vidéos par type d'agent
const videoCache = {};

// Vérifier si des vidéos personnalisées existent pour un agent
async function checkAgentVideos(agentType = 'main') {
  // Si déjà en cache, retourner
  if (videoCache[agentType]?.checked) {
    return videoCache[agentType];
  }

  // Initialiser le cache pour cet agent
  videoCache[agentType] = { checked: false, idle: null, speaking: null };

  try {
    const res = await fetch(`/api/admin/settings/ai-agents/${agentType}/info`);
    const data = await res.json();

    if (data.hasIdleVideo) {
      videoCache[agentType].idle = `/api/admin/settings/ai-agents/${agentType}/idle?t=${Date.now()}`;
    }
    if (data.hasSpeakingVideo) {
      videoCache[agentType].speaking = `/api/admin/settings/ai-agents/${agentType}/speaking?t=${Date.now()}`;
    }
  } catch (e) {
    // Silently fail - fallback to AnimatedAvatar
    console.debug(`No custom videos for agent ${agentType}`);
  }

  videoCache[agentType].checked = true;
  return videoCache[agentType];
}

// Force refresh des vidéos pour un agent (appelée après upload)
export function refreshVideoCache(agentType = null) {
  if (agentType) {
    delete videoCache[agentType];
  } else {
    // Effacer tout le cache
    Object.keys(videoCache).forEach(key => delete videoCache[key]);
  }
}

// Noms et personnalités des agents IA
export const AGENT_NAMES = {
  main: 'Electro',
  vsd: 'Shakira',
  meca: 'Titan',
  glo: 'Lumina',
  hv: 'Voltaire',
  mobile: 'Nomad',
  atex: 'Phoenix',
  switchboard: 'Matrix',
  doors: 'Portal',
  datahub: 'Nexus',
  firecontrol: 'Blaze'
};

// Descriptions des spécialités de chaque agent
export const AGENT_DESCRIPTIONS = {
  main: 'Assistant principal ElectroHub',
  vsd: 'Spécialiste des variateurs de fréquence',
  meca: 'Expert en équipements mécaniques',
  glo: 'Spécialiste éclairage de sécurité',
  hv: 'Expert haute tension',
  mobile: 'Spécialiste équipements mobiles',
  atex: 'Expert zones ATEX et explosives',
  switchboard: 'Spécialiste tableaux électriques',
  doors: 'Expert portes et accès',
  datahub: 'Spécialiste capteurs et monitoring',
  firecontrol: 'Expert sécurité incendie'
};

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
  // Type d'agent pour charger les vidéos spécifiques
  agentType = 'main',
  // Sources vidéo personnalisées (optionnel - override agentType)
  idleVideoSrc = null,
  speakingVideoSrc = null,
  // Fallback vers AnimatedAvatar si pas de vidéo
  fallbackToAnimated = true,
  // Afficher le nom de l'agent
  showAgentName = false
}, ref) => {
  const [hasVideo, setHasVideo] = useState(false);
  const [idleUrl, setIdleUrl] = useState(idleVideoSrc);
  const [speakingUrl, setSpeakingUrl] = useState(speakingVideoSrc);
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
    },
    getAgentType: () => agentType,
    getAgentName: () => AGENT_NAMES[agentType] || 'IA'
  }));

  // Charger les vidéos personnalisées au montage ou quand agentType change
  useEffect(() => {
    if (!idleVideoSrc && !speakingVideoSrc) {
      // Charger depuis l'API pour l'agent spécifié
      checkAgentVideos(agentType).then(cache => {
        if (cache.idle || cache.speaking) {
          setHasVideo(true);
          setIdleUrl(cache.idle || cache.speaking);
          setSpeakingUrl(cache.speaking || cache.idle);
        } else {
          setHasVideo(false);
          setIdleUrl(null);
          setSpeakingUrl(null);
        }
      });
    } else {
      setHasVideo(true);
      setIdleUrl(idleVideoSrc);
      setSpeakingUrl(speakingVideoSrc);
    }
  }, [agentType, idleVideoSrc, speakingVideoSrc]);

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
      <div className={`relative ${className}`}>
        <AnimatedAvatar
          style={style}
          size={size}
          speaking={speaking}
          onClick={onClick}
        />
        {showAgentName && (
          <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 px-1.5 py-0.5 bg-gray-900/75 text-white text-[9px] font-medium rounded whitespace-nowrap">
            {AGENT_NAMES[agentType] || 'IA'}
          </div>
        )}
      </div>
    );
  }

  const dimensions = SIZES[size] || SIZES.md;
  const avatarStyle = AVATAR_STYLES[style] || AVATAR_STYLES.ai;

  return (
    <div className={`relative ${showAgentName ? 'pb-4' : ''}`}>
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

      {/* Badge avec nom de l'agent */}
      {showAgentName && (
        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 px-1.5 py-0.5 bg-gray-900/75 text-white text-[9px] font-medium rounded whitespace-nowrap">
          {AGENT_NAMES[agentType] || 'IA'}
        </div>
      )}
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';

export { VideoAvatar, SIZES as VIDEO_AVATAR_SIZES };
export default VideoAvatar;
