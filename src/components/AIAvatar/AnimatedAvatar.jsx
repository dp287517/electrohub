import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// Collection d'avatars stylisés avec animations
const AVATAR_STYLES = {
  // Robot amical
  robot: {
    name: 'NOVA',
    description: 'Assistant robotique',
    colors: {
      primary: '#3B82F6',
      secondary: '#1D4ED8',
      accent: '#60A5FA',
      glow: '#93C5FD'
    }
  },
  // Humanoïde futuriste
  cyber: {
    name: 'ARIA',
    description: 'Intelligence cyber',
    colors: {
      primary: '#8B5CF6',
      secondary: '#6D28D9',
      accent: '#A78BFA',
      glow: '#C4B5FD'
    }
  },
  // Style minimaliste
  minimal: {
    name: 'ZEN',
    description: 'Assistant épuré',
    colors: {
      primary: '#10B981',
      secondary: '#059669',
      accent: '#34D399',
      glow: '#6EE7B7'
    }
  },
  // Style tech/circuit
  circuit: {
    name: 'SPARK',
    description: 'Expert électrique',
    colors: {
      primary: '#F59E0B',
      secondary: '#D97706',
      accent: '#FBBF24',
      glow: '#FCD34D'
    }
  },
  // Style orbe énergie
  orb: {
    name: 'PULSE',
    description: 'Énergie pure',
    colors: {
      primary: '#EC4899',
      secondary: '#DB2777',
      accent: '#F472B6',
      glow: '#F9A8D4'
    }
  }
};

// Composant Avatar animé avec lip-sync
const AnimatedAvatar = forwardRef(({
  style = 'robot',
  size = 'md',
  speaking = false,
  emotion = 'neutral', // neutral, happy, thinking, alert
  onClick,
  className = ''
}, ref) => {
  const [mouthOpen, setMouthOpen] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  const [pulsePhase, setPulsePhase] = useState(0);
  const animationRef = useRef(null);
  const speakingRef = useRef(speaking);

  // Exposer les méthodes pour contrôler l'avatar depuis l'extérieur
  useImperativeHandle(ref, () => ({
    speak: () => speakingRef.current = true,
    stopSpeaking: () => speakingRef.current = false,
    setEmotion: (e) => {}, // Pour extension future
  }));

  const avatarStyle = AVATAR_STYLES[style] || AVATAR_STYLES.robot;
  const { colors } = avatarStyle;

  // Tailles
  const sizes = {
    xs: { container: 32, eye: 4, mouth: 8 },
    sm: { container: 40, eye: 5, mouth: 10 },
    md: { container: 56, eye: 7, mouth: 14 },
    lg: { container: 80, eye: 10, mouth: 20 },
    xl: { container: 120, eye: 14, mouth: 28 }
  };
  const s = sizes[size] || sizes.md;

  // Animation de clignement des yeux
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 150);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(blinkInterval);
  }, []);

  // Animation lip-sync quand speaking est true
  useEffect(() => {
    speakingRef.current = speaking;

    if (speaking) {
      const animate = () => {
        if (speakingRef.current) {
          // Simulation réaliste de mouvement de lèvres
          const time = Date.now() / 100;
          const openAmount = Math.abs(Math.sin(time * 2.5) * Math.sin(time * 1.7)) * 100;
          setMouthOpen(openAmount);
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setMouthOpen(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [speaking]);

  // Animation pulse
  useEffect(() => {
    const pulseInterval = setInterval(() => {
      setPulsePhase(p => (p + 1) % 360);
    }, 50);
    return () => clearInterval(pulseInterval);
  }, []);

  // Rendu selon le style
  const renderAvatar = () => {
    const eyeY = blinkState ? s.container * 0.38 : s.container * 0.35;
    const eyeHeight = blinkState ? s.eye * 0.2 : s.eye;
    const mouthHeight = (mouthOpen / 100) * s.mouth * 0.6;

    switch (style) {
      case 'robot':
        return (
          <svg viewBox={`0 0 ${s.container} ${s.container}`} className="w-full h-full">
            <defs>
              <linearGradient id={`robotGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={colors.primary} />
                <stop offset="100%" stopColor={colors.secondary} />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Corps principal */}
            <rect
              x={s.container * 0.1}
              y={s.container * 0.15}
              width={s.container * 0.8}
              height={s.container * 0.7}
              rx={s.container * 0.15}
              fill={`url(#robotGrad-${size})`}
            />

            {/* Antenne */}
            <circle
              cx={s.container * 0.5}
              cy={s.container * 0.08}
              r={s.container * 0.05}
              fill={colors.accent}
              filter="url(#glow)"
              style={{
                opacity: 0.6 + Math.sin(pulsePhase * 0.1) * 0.4
              }}
            />
            <line
              x1={s.container * 0.5}
              y1={s.container * 0.13}
              x2={s.container * 0.5}
              y2={s.container * 0.18}
              stroke={colors.accent}
              strokeWidth="2"
            />

            {/* Visière/écran */}
            <rect
              x={s.container * 0.18}
              y={s.container * 0.25}
              width={s.container * 0.64}
              height={s.container * 0.25}
              rx={s.container * 0.05}
              fill="#1E293B"
            />

            {/* Yeux LED */}
            <ellipse
              cx={s.container * 0.35}
              cy={eyeY}
              rx={s.eye}
              ry={eyeHeight}
              fill={colors.glow}
              filter="url(#glow)"
            />
            <ellipse
              cx={s.container * 0.65}
              cy={eyeY}
              rx={s.eye}
              ry={eyeHeight}
              fill={colors.glow}
              filter="url(#glow)"
            />

            {/* Bouche LED */}
            <rect
              x={s.container * 0.35}
              y={s.container * 0.58}
              width={s.container * 0.3}
              height={Math.max(2, mouthHeight)}
              rx={2}
              fill={colors.glow}
              filter="url(#glow)"
              style={{ transition: 'height 0.05s ease-out' }}
            />

            {/* Lignes déco */}
            <line
              x1={s.container * 0.2}
              y1={s.container * 0.75}
              x2={s.container * 0.4}
              y2={s.container * 0.75}
              stroke={colors.accent}
              strokeWidth="2"
              opacity="0.5"
            />
            <line
              x1={s.container * 0.6}
              y1={s.container * 0.75}
              x2={s.container * 0.8}
              y2={s.container * 0.75}
              stroke={colors.accent}
              strokeWidth="2"
              opacity="0.5"
            />
          </svg>
        );

      case 'cyber':
        return (
          <svg viewBox={`0 0 ${s.container} ${s.container}`} className="w-full h-full">
            <defs>
              <linearGradient id={`cyberGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={colors.primary} />
                <stop offset="100%" stopColor={colors.secondary} />
              </linearGradient>
              <filter id="cyberGlow">
                <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Forme hexagonale */}
            <polygon
              points={`
                ${s.container * 0.5},${s.container * 0.05}
                ${s.container * 0.9},${s.container * 0.25}
                ${s.container * 0.9},${s.container * 0.75}
                ${s.container * 0.5},${s.container * 0.95}
                ${s.container * 0.1},${s.container * 0.75}
                ${s.container * 0.1},${s.container * 0.25}
              `}
              fill={`url(#cyberGrad-${size})`}
            />

            {/* Face interne */}
            <polygon
              points={`
                ${s.container * 0.5},${s.container * 0.15}
                ${s.container * 0.8},${s.container * 0.3}
                ${s.container * 0.8},${s.container * 0.7}
                ${s.container * 0.5},${s.container * 0.85}
                ${s.container * 0.2},${s.container * 0.7}
                ${s.container * 0.2},${s.container * 0.3}
              `}
              fill="#1E1B4B"
            />

            {/* Yeux triangulaires */}
            <polygon
              points={`
                ${s.container * 0.28},${eyeY}
                ${s.container * 0.38},${eyeY - s.eye}
                ${s.container * 0.38},${eyeY + (blinkState ? 0 : s.eye)}
              `}
              fill={colors.glow}
              filter="url(#cyberGlow)"
            />
            <polygon
              points={`
                ${s.container * 0.72},${eyeY}
                ${s.container * 0.62},${eyeY - s.eye}
                ${s.container * 0.62},${eyeY + (blinkState ? 0 : s.eye)}
              `}
              fill={colors.glow}
              filter="url(#cyberGlow)"
            />

            {/* Bouche - ligne qui s'anime */}
            <path
              d={`M ${s.container * 0.35} ${s.container * 0.6}
                  Q ${s.container * 0.5} ${s.container * 0.6 + mouthHeight * 0.3} ${s.container * 0.65} ${s.container * 0.6}`}
              stroke={colors.glow}
              strokeWidth="3"
              fill="none"
              filter="url(#cyberGlow)"
            />

            {/* Circuits décoratifs */}
            <circle cx={s.container * 0.5} cy={s.container * 0.2} r="2" fill={colors.accent} opacity="0.7" />
            <line x1={s.container * 0.5} y1={s.container * 0.22} x2={s.container * 0.5} y2={s.container * 0.28} stroke={colors.accent} strokeWidth="1" opacity="0.5" />
          </svg>
        );

      case 'minimal':
        return (
          <svg viewBox={`0 0 ${s.container} ${s.container}`} className="w-full h-full">
            <defs>
              <linearGradient id={`minGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={colors.primary} />
                <stop offset="100%" stopColor={colors.secondary} />
              </linearGradient>
            </defs>

            {/* Cercle principal */}
            <circle
              cx={s.container * 0.5}
              cy={s.container * 0.5}
              r={s.container * 0.45}
              fill={`url(#minGrad-${size})`}
            />

            {/* Yeux simples */}
            <circle
              cx={s.container * 0.35}
              cy={eyeY + s.container * 0.05}
              r={blinkState ? 1 : s.eye * 0.7}
              fill="white"
            />
            <circle
              cx={s.container * 0.65}
              cy={eyeY + s.container * 0.05}
              r={blinkState ? 1 : s.eye * 0.7}
              fill="white"
            />

            {/* Bouche - arc animé */}
            <path
              d={speaking
                ? `M ${s.container * 0.35} ${s.container * 0.62}
                   Q ${s.container * 0.5} ${s.container * 0.62 + mouthHeight * 0.4} ${s.container * 0.65} ${s.container * 0.62}
                   Q ${s.container * 0.5} ${s.container * 0.62 + mouthHeight * 0.2} ${s.container * 0.35} ${s.container * 0.62}`
                : `M ${s.container * 0.38} ${s.container * 0.62}
                   Q ${s.container * 0.5} ${s.container * 0.68} ${s.container * 0.62} ${s.container * 0.62}`
              }
              stroke="white"
              strokeWidth="2.5"
              fill={speaking ? "white" : "none"}
              strokeLinecap="round"
            />
          </svg>
        );

      case 'circuit':
        return (
          <svg viewBox={`0 0 ${s.container} ${s.container}`} className="w-full h-full">
            <defs>
              <linearGradient id={`circGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={colors.primary} />
                <stop offset="100%" stopColor={colors.secondary} />
              </linearGradient>
              <filter id="circuitGlow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Fond carré arrondi */}
            <rect
              x={s.container * 0.08}
              y={s.container * 0.08}
              width={s.container * 0.84}
              height={s.container * 0.84}
              rx={s.container * 0.12}
              fill="#1C1917"
              stroke={colors.primary}
              strokeWidth="2"
            />

            {/* Lignes de circuit */}
            <path
              d={`M ${s.container * 0.15} ${s.container * 0.3}
                  L ${s.container * 0.25} ${s.container * 0.3}
                  L ${s.container * 0.25} ${s.container * 0.2}
                  L ${s.container * 0.4} ${s.container * 0.2}`}
              stroke={colors.accent}
              strokeWidth="1.5"
              fill="none"
              opacity={0.5 + Math.sin(pulsePhase * 0.05) * 0.3}
            />
            <path
              d={`M ${s.container * 0.85} ${s.container * 0.3}
                  L ${s.container * 0.75} ${s.container * 0.3}
                  L ${s.container * 0.75} ${s.container * 0.2}
                  L ${s.container * 0.6} ${s.container * 0.2}`}
              stroke={colors.accent}
              strokeWidth="1.5"
              fill="none"
              opacity={0.5 + Math.sin(pulsePhase * 0.05 + 1) * 0.3}
            />

            {/* Points de connexion */}
            <circle cx={s.container * 0.4} cy={s.container * 0.2} r="3" fill={colors.glow} filter="url(#circuitGlow)" />
            <circle cx={s.container * 0.6} cy={s.container * 0.2} r="3" fill={colors.glow} filter="url(#circuitGlow)" />

            {/* Yeux - écrans */}
            <rect
              x={s.container * 0.22}
              y={eyeY - s.eye * 0.5}
              width={s.eye * 2}
              height={blinkState ? 2 : s.eye * 1.2}
              rx="2"
              fill={colors.glow}
              filter="url(#circuitGlow)"
            />
            <rect
              x={s.container * 0.78 - s.eye * 2}
              y={eyeY - s.eye * 0.5}
              width={s.eye * 2}
              height={blinkState ? 2 : s.eye * 1.2}
              rx="2"
              fill={colors.glow}
              filter="url(#circuitGlow)"
            />

            {/* Bouche - barre de niveau */}
            <rect
              x={s.container * 0.3}
              y={s.container * 0.6}
              width={s.container * 0.4}
              height={s.container * 0.08}
              rx="2"
              fill="#292524"
            />
            <rect
              x={s.container * 0.32}
              y={s.container * 0.62}
              width={(s.container * 0.36) * (speaking ? (mouthOpen / 100) : 0.3)}
              height={s.container * 0.04}
              rx="1"
              fill={colors.glow}
              filter="url(#circuitGlow)"
              style={{ transition: 'width 0.05s ease-out' }}
            />

            {/* Lignes du bas */}
            <path
              d={`M ${s.container * 0.2} ${s.container * 0.75}
                  L ${s.container * 0.2} ${s.container * 0.8}
                  L ${s.container * 0.35} ${s.container * 0.8}`}
              stroke={colors.accent}
              strokeWidth="1.5"
              fill="none"
              opacity="0.4"
            />
            <path
              d={`M ${s.container * 0.8} ${s.container * 0.75}
                  L ${s.container * 0.8} ${s.container * 0.8}
                  L ${s.container * 0.65} ${s.container * 0.8}`}
              stroke={colors.accent}
              strokeWidth="1.5"
              fill="none"
              opacity="0.4"
            />
          </svg>
        );

      case 'orb':
        const orbPulse = 0.85 + Math.sin(pulsePhase * 0.08) * 0.1;
        return (
          <svg viewBox={`0 0 ${s.container} ${s.container}`} className="w-full h-full">
            <defs>
              <radialGradient id={`orbGrad-${size}`} cx="30%" cy="30%">
                <stop offset="0%" stopColor={colors.glow} />
                <stop offset="50%" stopColor={colors.primary} />
                <stop offset="100%" stopColor={colors.secondary} />
              </radialGradient>
              <filter id="orbGlow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Aura externe */}
            <circle
              cx={s.container * 0.5}
              cy={s.container * 0.5}
              r={s.container * 0.48 * orbPulse}
              fill="none"
              stroke={colors.glow}
              strokeWidth="1"
              opacity="0.3"
            />

            {/* Orbe principal */}
            <circle
              cx={s.container * 0.5}
              cy={s.container * 0.5}
              r={s.container * 0.4}
              fill={`url(#orbGrad-${size})`}
              filter="url(#orbGlow)"
            />

            {/* Reflet */}
            <ellipse
              cx={s.container * 0.38}
              cy={s.container * 0.35}
              rx={s.container * 0.12}
              ry={s.container * 0.08}
              fill="white"
              opacity="0.3"
            />

            {/* Yeux - points lumineux */}
            <circle
              cx={s.container * 0.38}
              cy={s.container * 0.45}
              r={blinkState ? 1 : s.eye * 0.6}
              fill="white"
              filter="url(#orbGlow)"
            />
            <circle
              cx={s.container * 0.62}
              cy={s.container * 0.45}
              r={blinkState ? 1 : s.eye * 0.6}
              fill="white"
              filter="url(#orbGlow)"
            />

            {/* Bouche - arc lumineux */}
            <path
              d={speaking
                ? `M ${s.container * 0.38} ${s.container * 0.58}
                   Q ${s.container * 0.5} ${s.container * 0.58 + mouthHeight * 0.3} ${s.container * 0.62} ${s.container * 0.58}
                   Q ${s.container * 0.5} ${s.container * 0.58 + mouthHeight * 0.15} ${s.container * 0.38} ${s.container * 0.58}`
                : `M ${s.container * 0.4} ${s.container * 0.58}
                   Q ${s.container * 0.5} ${s.container * 0.63} ${s.container * 0.6} ${s.container * 0.58}`
              }
              stroke="white"
              strokeWidth="2"
              fill={speaking ? "rgba(255,255,255,0.5)" : "none"}
              strokeLinecap="round"
              filter="url(#orbGlow)"
            />

            {/* Particules orbitales */}
            <circle
              cx={s.container * 0.5 + Math.cos(pulsePhase * 0.03) * s.container * 0.35}
              cy={s.container * 0.5 + Math.sin(pulsePhase * 0.03) * s.container * 0.35}
              r="2"
              fill="white"
              opacity="0.6"
            />
            <circle
              cx={s.container * 0.5 + Math.cos(pulsePhase * 0.03 + 2) * s.container * 0.35}
              cy={s.container * 0.5 + Math.sin(pulsePhase * 0.03 + 2) * s.container * 0.35}
              r="1.5"
              fill="white"
              opacity="0.4"
            />
          </svg>
        );

      default:
        return null;
    }
  };

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer transition-transform hover:scale-105 ${className}`}
      style={{
        width: s.container,
        height: s.container,
      }}
    >
      {/* Effet de lueur quand parle */}
      {speaking && (
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{
            background: `radial-gradient(circle, ${colors.glow}40 0%, transparent 70%)`,
            transform: 'scale(1.3)',
          }}
        />
      )}

      {renderAvatar()}

      {/* Indicateur d'état */}
      {emotion === 'thinking' && (
        <div
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse"
          style={{ backgroundColor: colors.accent }}
        />
      )}
      {emotion === 'alert' && (
        <div
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-bounce"
          style={{ backgroundColor: '#EF4444' }}
        />
      )}
    </div>
  );
});

AnimatedAvatar.displayName = 'AnimatedAvatar';

export { AnimatedAvatar, AVATAR_STYLES };
export default AnimatedAvatar;
