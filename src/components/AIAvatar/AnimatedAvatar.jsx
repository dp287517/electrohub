import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// Avatars style Memoji Apple - réalistes et modernes
const AVATAR_STYLES = {
  alex: {
    name: 'Alex',
    description: 'Expert technique',
    skin: '#F5D0C5',
    hair: '#4A3728',
    hairStyle: 'short',
    eyes: '#5D8AA8',
    shirt: '#3B82F6',
    accessories: []
  },
  maya: {
    name: 'Maya',
    description: 'Ingénieure senior',
    skin: '#8D5524',
    hair: '#1C1C1C',
    hairStyle: 'long',
    eyes: '#3D2314',
    shirt: '#8B5CF6',
    accessories: []
  },
  sam: {
    name: 'Sam',
    description: 'Spécialiste ATEX',
    skin: '#FFDBAC',
    hair: '#B55239',
    hairStyle: 'wavy',
    eyes: '#2E8B57',
    shirt: '#10B981',
    accessories: ['glasses']
  },
  jordan: {
    name: 'Jordan',
    description: 'Analyste données',
    skin: '#C68642',
    hair: '#2C1810',
    hairStyle: 'curly',
    eyes: '#634E34',
    shirt: '#F59E0B',
    accessories: []
  },
  robin: {
    name: 'Robin',
    description: 'Technicien expert',
    skin: '#FFE0BD',
    hair: '#8B7355',
    hairStyle: 'buzz',
    eyes: '#6B8E23',
    shirt: '#EC4899',
    accessories: ['headphones']
  }
};

// Composant Avatar Memoji animé avec lip-sync
const AnimatedAvatar = forwardRef(({
  style = 'alex',
  size = 'md',
  speaking = false,
  emotion = 'neutral',
  onClick,
  className = ''
}, ref) => {
  const [mouthOpen, setMouthOpen] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  const [eyePosition, setEyePosition] = useState({ x: 0, y: 0 });
  const animationRef = useRef(null);
  const speakingRef = useRef(speaking);

  useImperativeHandle(ref, () => ({
    speak: () => speakingRef.current = true,
    stopSpeaking: () => speakingRef.current = false,
  }));

  const avatar = AVATAR_STYLES[style] || AVATAR_STYLES.alex;

  const sizes = {
    xs: 32,
    sm: 40,
    md: 56,
    lg: 80,
    xl: 120
  };
  const s = sizes[size] || sizes.md;

  // Animation de clignement
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 150);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(blinkInterval);
  }, []);

  // Mouvement subtil des yeux
  useEffect(() => {
    const eyeInterval = setInterval(() => {
      setEyePosition({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 1
      });
    }, 2000 + Math.random() * 1000);
    return () => clearInterval(eyeInterval);
  }, []);

  // Animation lip-sync
  useEffect(() => {
    speakingRef.current = speaking;

    if (speaking) {
      const animate = () => {
        if (speakingRef.current) {
          const time = Date.now() / 100;
          const openAmount = Math.abs(Math.sin(time * 3) * Math.sin(time * 1.7)) * 100;
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

  // Couleurs dérivées
  const skinDark = adjustColor(avatar.skin, -20);
  const skinLight = adjustColor(avatar.skin, 20);
  const hairDark = adjustColor(avatar.hair, -30);

  const renderHair = () => {
    switch (avatar.hairStyle) {
      case 'long':
        return (
          <>
            <ellipse cx="50" cy="25" rx="38" ry="20" fill={avatar.hair} />
            <path d={`M 12 40 Q 8 70 15 95`} stroke={avatar.hair} strokeWidth="12" fill="none" strokeLinecap="round" />
            <path d={`M 88 40 Q 92 70 85 95`} stroke={avatar.hair} strokeWidth="12" fill="none" strokeLinecap="round" />
            <ellipse cx="50" cy="22" rx="35" ry="18" fill={hairDark} />
          </>
        );
      case 'wavy':
        return (
          <>
            <ellipse cx="50" cy="26" rx="36" ry="22" fill={avatar.hair} />
            <path d="M 18 35 Q 10 45 18 60 Q 25 50 20 40" fill={avatar.hair} />
            <path d="M 82 35 Q 90 45 82 60 Q 75 50 80 40" fill={avatar.hair} />
            <ellipse cx="50" cy="24" rx="33" ry="18" fill={hairDark} />
          </>
        );
      case 'curly':
        return (
          <>
            <ellipse cx="50" cy="28" rx="38" ry="25" fill={avatar.hair} />
            {[...Array(8)].map((_, i) => (
              <circle
                key={i}
                cx={20 + i * 9}
                cy={18 + Math.sin(i) * 5}
                r={6 + Math.random() * 3}
                fill={i % 2 === 0 ? avatar.hair : hairDark}
              />
            ))}
          </>
        );
      case 'buzz':
        return (
          <ellipse cx="50" cy="32" rx="32" ry="18" fill={avatar.hair} opacity="0.8" />
        );
      default: // short
        return (
          <>
            <ellipse cx="50" cy="28" rx="34" ry="20" fill={avatar.hair} />
            <ellipse cx="50" cy="26" rx="30" ry="16" fill={hairDark} />
          </>
        );
    }
  };

  const renderAccessories = () => {
    return avatar.accessories.map((acc, i) => {
      if (acc === 'glasses') {
        return (
          <g key={i}>
            <circle cx="35" cy="48" r="10" fill="none" stroke="#1F2937" strokeWidth="2" />
            <circle cx="65" cy="48" r="10" fill="none" stroke="#1F2937" strokeWidth="2" />
            <line x1="45" y1="48" x2="55" y2="48" stroke="#1F2937" strokeWidth="2" />
            <line x1="25" y1="48" x2="18" y2="45" stroke="#1F2937" strokeWidth="2" />
            <line x1="75" y1="48" x2="82" y2="45" stroke="#1F2937" strokeWidth="2" />
          </g>
        );
      }
      if (acc === 'headphones') {
        return (
          <g key={i}>
            <path d="M 15 50 Q 15 25 50 20 Q 85 25 85 50" fill="none" stroke="#374151" strokeWidth="4" />
            <ellipse cx="15" cy="55" rx="6" ry="10" fill="#374151" />
            <ellipse cx="85" cy="55" rx="6" ry="10" fill="#374151" />
            <ellipse cx="15" cy="55" rx="4" ry="7" fill="#6B7280" />
            <ellipse cx="85" cy="55" rx="4" ry="7" fill="#6B7280" />
          </g>
        );
      }
      return null;
    });
  };

  const eyeOpenHeight = blinkState ? 1 : 8;
  const mouthOpenHeight = 2 + (mouthOpen / 100) * 8;

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer transition-transform hover:scale-105 ${className}`}
      style={{ width: s, height: s }}
    >
      {/* Glow effect when speaking */}
      {speaking && (
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{
            background: `radial-gradient(circle, ${avatar.shirt}40 0%, transparent 70%)`,
            transform: 'scale(1.2)',
          }}
        />
      )}

      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          {/* Gradients for 3D effect */}
          <radialGradient id={`skinGrad-${style}`} cx="40%" cy="30%">
            <stop offset="0%" stopColor={skinLight} />
            <stop offset="70%" stopColor={avatar.skin} />
            <stop offset="100%" stopColor={skinDark} />
          </radialGradient>

          <radialGradient id={`eyeGrad-${style}`} cx="30%" cy="30%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F0F0F0" />
          </radialGradient>

          <linearGradient id={`shirtGrad-${style}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={avatar.shirt} />
            <stop offset="100%" stopColor={adjustColor(avatar.shirt, -30)} />
          </linearGradient>

          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* Neck */}
        <ellipse cx="50" cy="88" rx="12" ry="8" fill={`url(#skinGrad-${style})`} />

        {/* Shirt/Body */}
        <ellipse cx="50" cy="98" rx="30" ry="15" fill={`url(#shirtGrad-${style})`} />

        {/* Ears */}
        <ellipse cx="16" cy="52" rx="5" ry="8" fill={`url(#skinGrad-${style})`} />
        <ellipse cx="84" cy="52" rx="5" ry="8" fill={`url(#skinGrad-${style})`} />
        <ellipse cx="16" cy="52" rx="3" ry="5" fill={skinDark} opacity="0.3" />
        <ellipse cx="84" cy="52" rx="3" ry="5" fill={skinDark} opacity="0.3" />

        {/* Head */}
        <ellipse
          cx="50" cy="50"
          rx="34" ry="38"
          fill={`url(#skinGrad-${style})`}
          filter="url(#shadow)"
        />

        {/* Hair */}
        {renderHair()}

        {/* Eyebrows */}
        <path
          d={emotion === 'thinking'
            ? "M 28 38 Q 35 34 42 37"
            : emotion === 'alert'
            ? "M 28 34 Q 35 38 42 34"
            : "M 28 36 Q 35 34 42 36"
          }
          stroke={avatar.hair}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={emotion === 'thinking'
            ? "M 58 37 Q 65 34 72 38"
            : emotion === 'alert'
            ? "M 58 34 Q 65 38 72 34"
            : "M 58 36 Q 65 34 72 36"
          }
          stroke={avatar.hair}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />

        {/* Eyes */}
        <g>
          {/* Left eye */}
          <ellipse cx="35" cy="48" rx="8" ry={eyeOpenHeight} fill={`url(#eyeGrad-${style})`} />
          {!blinkState && (
            <>
              <circle
                cx={35 + eyePosition.x}
                cy={48 + eyePosition.y}
                r="5"
                fill={avatar.eyes}
              />
              <circle
                cx={35 + eyePosition.x}
                cy={48 + eyePosition.y}
                r="3"
                fill="#000000"
              />
              <circle
                cx={33 + eyePosition.x}
                cy={46 + eyePosition.y}
                r="1.5"
                fill="#FFFFFF"
              />
            </>
          )}

          {/* Right eye */}
          <ellipse cx="65" cy="48" rx="8" ry={eyeOpenHeight} fill={`url(#eyeGrad-${style})`} />
          {!blinkState && (
            <>
              <circle
                cx={65 + eyePosition.x}
                cy={48 + eyePosition.y}
                r="5"
                fill={avatar.eyes}
              />
              <circle
                cx={65 + eyePosition.x}
                cy={48 + eyePosition.y}
                r="3"
                fill="#000000"
              />
              <circle
                cx={63 + eyePosition.x}
                cy={46 + eyePosition.y}
                r="1.5"
                fill="#FFFFFF"
              />
            </>
          )}
        </g>

        {/* Nose */}
        <path
          d="M 50 52 L 48 60 Q 50 62 52 60 L 50 52"
          fill={skinDark}
          opacity="0.3"
        />

        {/* Cheeks (subtle blush) */}
        <ellipse cx="28" cy="58" rx="6" ry="4" fill="#FFB6C1" opacity="0.3" />
        <ellipse cx="72" cy="58" rx="6" ry="4" fill="#FFB6C1" opacity="0.3" />

        {/* Mouth with lip-sync */}
        <g>
          {/* Upper lip */}
          <path
            d={`M 40 68 Q 45 ${66 - mouthOpenHeight * 0.3} 50 ${66 - mouthOpenHeight * 0.3} Q 55 ${66 - mouthOpenHeight * 0.3} 60 68`}
            fill="#C9A0A0"
          />

          {/* Mouth opening */}
          {speaking ? (
            <>
              <ellipse
                cx="50"
                cy="68"
                rx="8"
                ry={mouthOpenHeight}
                fill="#4A1515"
              />
              {/* Teeth */}
              {mouthOpenHeight > 4 && (
                <rect x="44" y="66" width="12" height="3" rx="1" fill="#FFFFFF" />
              )}
              {/* Tongue */}
              {mouthOpenHeight > 5 && (
                <ellipse cx="50" cy={69 + mouthOpenHeight * 0.3} rx="5" ry="3" fill="#D46A6A" />
              )}
            </>
          ) : (
            /* Closed smile */
            <path
              d="M 42 68 Q 50 74 58 68"
              stroke="#9A6B6B"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* Lower lip */}
          <path
            d={`M 40 68 Q 45 ${70 + mouthOpenHeight * 0.5} 50 ${71 + mouthOpenHeight * 0.5} Q 55 ${70 + mouthOpenHeight * 0.5} 60 68`}
            fill="#C9A0A0"
            opacity={speaking ? 1 : 0}
          />
        </g>

        {/* Accessories */}
        {renderAccessories()}
      </svg>

      {/* Status indicators */}
      {emotion === 'thinking' && (
        <div className="absolute -top-1 -right-1 w-4 h-4">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-500" />
        </div>
      )}
      {emotion === 'alert' && (
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-bounce">
          <span className="text-white text-xs font-bold">!</span>
        </div>
      )}
    </div>
  );
});

// Helper function to adjust color brightness
function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

AnimatedAvatar.displayName = 'AnimatedAvatar';

export { AnimatedAvatar, AVATAR_STYLES };
export default AnimatedAvatar;
