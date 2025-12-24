import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// Avatars modernes et propres - style iconique
const AVATAR_STYLES = {
  ai: {
    name: 'AI',
    description: 'Intelligence Artificielle',
    primaryColor: '#6366F1',
    secondaryColor: '#4F46E5',
    accentColor: '#A5B4FC',
    icon: 'ai',
    animated: true
  },
  electro: {
    name: 'Electro',
    description: 'Assistant ElectroHub',
    primaryColor: '#3B82F6',
    secondaryColor: '#1D4ED8',
    accentColor: '#60A5FA',
    icon: 'bolt'
  },
  nova: {
    name: 'Nova',
    description: 'Intelligence avancée',
    primaryColor: '#8B5CF6',
    secondaryColor: '#6D28D9',
    accentColor: '#A78BFA',
    icon: 'star'
  },
  eco: {
    name: 'Eco',
    description: 'Expert conformité',
    primaryColor: '#10B981',
    secondaryColor: '#059669',
    accentColor: '#34D399',
    icon: 'leaf'
  },
  spark: {
    name: 'Spark',
    description: 'Analyste technique',
    primaryColor: '#F59E0B',
    secondaryColor: '#D97706',
    accentColor: '#FBBF24',
    icon: 'zap'
  },
  pulse: {
    name: 'Pulse',
    description: 'Assistant dynamique',
    primaryColor: '#EC4899',
    secondaryColor: '#DB2777',
    accentColor: '#F472B6',
    icon: 'heart'
  }
};

const AnimatedAvatar = forwardRef(({
  style = 'ai',
  size = 'md',
  speaking = false,
  emotion = 'neutral',
  onClick,
  className = ''
}, ref) => {
  const [pulsePhase, setPulsePhase] = useState(0);
  const [waveOffset, setWaveOffset] = useState(0);
  const animationRef = useRef(null);
  const speakingRef = useRef(speaking);

  useImperativeHandle(ref, () => ({
    speak: () => speakingRef.current = true,
    stopSpeaking: () => speakingRef.current = false,
  }));

  const avatar = AVATAR_STYLES[style] || AVATAR_STYLES.electro;
  const sizes = { xs: 32, sm: 40, md: 56, lg: 80, xl: 120 };
  const s = sizes[size] || sizes.md;

  // Animation de pulsation
  useEffect(() => {
    const interval = setInterval(() => {
      setPulsePhase(p => (p + 1) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Animation de parole
  useEffect(() => {
    speakingRef.current = speaking;
    if (speaking) {
      const animate = () => {
        if (speakingRef.current) {
          setWaveOffset(Date.now() / 100);
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setWaveOffset(0);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [speaking]);

  const glowIntensity = speaking ? 0.6 : 0.3 + Math.sin(pulsePhase * 0.05) * 0.1;

  // Générer les barres audio
  const audioBars = speaking ? [0, 1, 2, 3, 4].map(i => ({
    height: 8 + Math.abs(Math.sin(waveOffset + i * 0.8)) * 16,
    delay: i * 0.1
  })) : [];

  const renderIcon = () => {
    const iconSize = s * 0.35;
    const cx = 50;
    const cy = 45;

    switch (avatar.icon) {
      case 'ai':
        // Icône AI moderne avec cerveau/neurones animés
        const nodeOpacity = 0.7 + Math.sin(pulsePhase * 0.08) * 0.3;
        const connectionOpacity = 0.4 + Math.sin(pulsePhase * 0.06) * 0.3;
        const pulseScale = 1 + Math.sin(pulsePhase * 0.05) * 0.05;
        return (
          <g style={{ transform: `scale(${pulseScale})`, transformOrigin: 'center' }}>
            {/* Connexions neuronales animées */}
            <g opacity={connectionOpacity}>
              <line x1="50" y1="35" x2="35" y2="50" stroke="white" strokeWidth="1.5" />
              <line x1="50" y1="35" x2="65" y2="50" stroke="white" strokeWidth="1.5" />
              <line x1="35" y1="50" x2="50" y2="65" stroke="white" strokeWidth="1.5" />
              <line x1="65" y1="50" x2="50" y2="65" stroke="white" strokeWidth="1.5" />
              <line x1="35" y1="50" x2="65" y2="50" stroke="white" strokeWidth="1" strokeDasharray="3 2" />
              <line x1="50" y1="35" x2="50" y2="65" stroke="white" strokeWidth="1" strokeDasharray="3 2" />
            </g>
            {/* Nœuds du réseau neuronal */}
            <g opacity={nodeOpacity}>
              {/* Nœud central supérieur */}
              <circle cx="50" cy="35" r="6" fill="white" />
              <circle cx="50" cy="35" r="3" fill={avatar.primaryColor} />
              {/* Nœuds latéraux */}
              <circle cx="35" cy="50" r="5" fill="white" />
              <circle cx="35" cy="50" r="2.5" fill={avatar.primaryColor} />
              <circle cx="65" cy="50" r="5" fill="white" />
              <circle cx="65" cy="50" r="2.5" fill={avatar.primaryColor} />
              {/* Nœud central inférieur */}
              <circle cx="50" cy="65" r="6" fill="white" />
              <circle cx="50" cy="65" r="3" fill={avatar.primaryColor} />
            </g>
            {/* Pulse animé qui voyage sur les connexions */}
            {speaking && (
              <g>
                <circle
                  cx={35 + Math.sin(waveOffset * 0.5) * 15 + 15}
                  cy={50 + Math.cos(waveOffset * 0.5) * 15}
                  r="2"
                  fill={avatar.accentColor}
                />
                <circle
                  cx={65 - Math.sin(waveOffset * 0.7) * 15 - 15}
                  cy={50 - Math.cos(waveOffset * 0.7) * 15}
                  r="2"
                  fill={avatar.accentColor}
                />
              </g>
            )}
          </g>
        );
      case 'bolt':
        return (
          <path
            d="M52 25 L42 48 L48 48 L46 65 L58 42 L52 42 L52 25"
            fill="white"
            stroke="white"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        );
      case 'star':
        return (
          <path
            d="M50 25 L53 40 L68 40 L56 50 L60 65 L50 55 L40 65 L44 50 L32 40 L47 40 Z"
            fill="white"
          />
        );
      case 'leaf':
        return (
          <path
            d="M50 65 C50 65 35 50 35 38 C35 28 42 25 50 25 C58 25 65 28 65 38 C65 50 50 65 50 65 M50 65 L50 45 M45 50 L50 45 L55 50"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'zap':
        return (
          <path
            d="M55 25 L40 47 L48 47 L45 65 L60 43 L52 43 L55 25"
            fill="white"
          />
        );
      case 'heart':
        return (
          <path
            d="M50 60 C35 48 30 38 30 33 C30 27 35 24 40 24 C45 24 48 27 50 30 C52 27 55 24 60 24 C65 24 70 27 70 33 C70 38 65 48 50 60"
            fill="white"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer transition-transform hover:scale-105 ${className}`}
      style={{ width: s, height: s }}
    >
      {/* Glow effect */}
      <div
        className="absolute inset-0 rounded-full blur-md transition-opacity duration-300"
        style={{
          background: avatar.primaryColor,
          opacity: glowIntensity,
          transform: 'scale(1.1)',
        }}
      />

      <svg viewBox="0 0 100 100" className="relative w-full h-full">
        <defs>
          <linearGradient id={`grad-${style}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={avatar.primaryColor} />
            <stop offset="100%" stopColor={avatar.secondaryColor} />
          </linearGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* Cercle principal */}
        <circle
          cx="50"
          cy="50"
          r="42"
          fill={`url(#grad-${style})`}
          filter="url(#shadow)"
        />

        {/* Anneau externe animé */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={avatar.accentColor}
          strokeWidth="2"
          opacity={speaking ? 0.8 : 0.4}
          strokeDasharray={speaking ? "10 5" : "0"}
          style={{
            transform: speaking ? `rotate(${pulsePhase}deg)` : 'none',
            transformOrigin: 'center',
            transition: 'all 0.3s ease'
          }}
        />

        {/* Icône centrale */}
        <g opacity="0.95">
          {renderIcon()}
        </g>

        {/* Barres audio quand parle */}
        {speaking && (
          <g>
            {audioBars.map((bar, i) => (
              <rect
                key={i}
                x={32 + i * 9}
                y={75 - bar.height / 2}
                width="5"
                height={bar.height}
                rx="2"
                fill="white"
                opacity="0.9"
              />
            ))}
          </g>
        )}

        {/* Indicateur de statut */}
        {!speaking && (
          <circle
            cx="50"
            cy="75"
            r="4"
            fill={avatar.accentColor}
            opacity={0.6 + Math.sin(pulsePhase * 0.1) * 0.4}
          />
        )}
      </svg>

      {/* Indicateurs d'état */}
      {emotion === 'thinking' && (
        <div className="absolute -top-1 -right-1 w-4 h-4">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
        </div>
      )}
      {emotion === 'alert' && (
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-bounce">
          <span className="text-white text-[8px] font-bold">!</span>
        </div>
      )}
    </div>
  );
});

AnimatedAvatar.displayName = 'AnimatedAvatar';

export { AnimatedAvatar, AVATAR_STYLES };
export default AnimatedAvatar;
