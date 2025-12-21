import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

// Avatars modernes style Apple Memoji - propres et réalistes
const AVATAR_STYLES = {
  lucas: {
    name: 'Lucas',
    description: 'Assistant principal',
    skinTone: '#FFDBB4',
    hairColor: '#4A3728',
    eyeColor: '#4A90D9',
    shirtColor: '#3B82F6',
    gender: 'male'
  },
  emma: {
    name: 'Emma',
    description: 'Experte technique',
    skinTone: '#F5D0C5',
    hairColor: '#2C1810',
    eyeColor: '#634E34',
    shirtColor: '#8B5CF6',
    gender: 'female'
  },
  noah: {
    name: 'Noah',
    description: 'Spécialiste conformité',
    skinTone: '#8D5524',
    hairColor: '#1A1A1A',
    eyeColor: '#3D2314',
    shirtColor: '#10B981',
    gender: 'male'
  },
  sofia: {
    name: 'Sofia',
    description: 'Analyste données',
    skinTone: '#C68642',
    hairColor: '#1C1C1C',
    eyeColor: '#2E5A1C',
    shirtColor: '#F59E0B',
    gender: 'female'
  },
  alex: {
    name: 'Alex',
    description: 'Ingénieur système',
    skinTone: '#FFE0BD',
    hairColor: '#8B7355',
    eyeColor: '#6B8E23',
    shirtColor: '#EC4899',
    gender: 'neutral'
  }
};

const AnimatedAvatar = forwardRef(({
  style = 'lucas',
  size = 'md',
  speaking = false,
  emotion = 'neutral',
  onClick,
  className = ''
}, ref) => {
  const [mouthOpen, setMouthOpen] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  const animationRef = useRef(null);
  const speakingRef = useRef(speaking);

  useImperativeHandle(ref, () => ({
    speak: () => speakingRef.current = true,
    stopSpeaking: () => speakingRef.current = false,
  }));

  const avatar = AVATAR_STYLES[style] || AVATAR_STYLES.lucas;

  const sizes = { xs: 32, sm: 40, md: 56, lg: 80, xl: 120 };
  const s = sizes[size] || sizes.md;

  // Clignement naturel
  useEffect(() => {
    const blink = () => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 150);
    };
    const interval = setInterval(blink, 3000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  // Lip-sync animation
  useEffect(() => {
    speakingRef.current = speaking;
    if (speaking) {
      const animate = () => {
        if (speakingRef.current) {
          const time = Date.now() / 80;
          setMouthOpen(Math.abs(Math.sin(time * 2.5) * Math.sin(time * 1.3)) * 100);
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setMouthOpen(0);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [speaking]);

  const skinDark = adjustColor(avatar.skinTone, -25);
  const skinLight = adjustColor(avatar.skinTone, 15);
  const hairDark = adjustColor(avatar.hairColor, -20);
  const mouthHeight = 1 + (mouthOpen / 100) * 6;

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer transition-transform hover:scale-105 ${className}`}
      style={{ width: s, height: s }}
    >
      {speaking && (
        <div
          className="absolute inset-0 rounded-full animate-pulse opacity-40"
          style={{ background: `radial-gradient(circle, ${avatar.shirtColor} 0%, transparent 70%)`, transform: 'scale(1.3)' }}
        />
      )}

      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
        <defs>
          <radialGradient id={`skin-${style}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor={skinLight} />
            <stop offset="60%" stopColor={avatar.skinTone} />
            <stop offset="100%" stopColor={skinDark} />
          </radialGradient>
          <linearGradient id={`shirt-${style}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={avatar.shirtColor} />
            <stop offset="100%" stopColor={adjustColor(avatar.shirtColor, -40)} />
          </linearGradient>
          <linearGradient id={`hair-${style}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={avatar.hairColor} />
            <stop offset="100%" stopColor={hairDark} />
          </linearGradient>
        </defs>

        {/* Cou */}
        <ellipse cx="50" cy="85" rx="10" ry="6" fill={`url(#skin-${style})`} />

        {/* Corps/Épaules */}
        <path d="M25 100 Q25 88 40 85 L60 85 Q75 88 75 100" fill={`url(#shirt-${style})`} />

        {/* Tête - forme ovale naturelle */}
        <ellipse cx="50" cy="48" rx="28" ry="32" fill={`url(#skin-${style})`} />

        {/* Oreilles */}
        <ellipse cx="22" cy="50" rx="4" ry="6" fill={`url(#skin-${style})`} />
        <ellipse cx="78" cy="50" rx="4" ry="6" fill={`url(#skin-${style})`} />
        <ellipse cx="22" cy="50" rx="2" ry="3" fill={skinDark} opacity="0.2" />
        <ellipse cx="78" cy="50" rx="2" ry="3" fill={skinDark} opacity="0.2" />

        {/* Cheveux - style propre et moderne */}
        {avatar.gender === 'female' ? (
          <>
            {/* Cheveux longs féminins */}
            <ellipse cx="50" cy="28" rx="30" ry="18" fill={`url(#hair-${style})`} />
            <path d="M20 35 Q15 55 22 80" stroke={avatar.hairColor} strokeWidth="8" fill="none" strokeLinecap="round" />
            <path d="M80 35 Q85 55 78 80" stroke={avatar.hairColor} strokeWidth="8" fill="none" strokeLinecap="round" />
            <ellipse cx="50" cy="24" rx="26" ry="14" fill={hairDark} opacity="0.6" />
          </>
        ) : avatar.gender === 'male' ? (
          <>
            {/* Cheveux courts masculins */}
            <ellipse cx="50" cy="26" rx="27" ry="15" fill={`url(#hair-${style})`} />
            <ellipse cx="50" cy="23" rx="24" ry="12" fill={hairDark} opacity="0.4" />
          </>
        ) : (
          <>
            {/* Style neutre/court moderne */}
            <ellipse cx="50" cy="27" rx="26" ry="14" fill={`url(#hair-${style})`} />
            <path d="M30 22 Q50 15 70 22" stroke={avatar.hairColor} strokeWidth="4" fill="none" />
          </>
        )}

        {/* Sourcils expressifs */}
        <path
          d={emotion === 'thinking' ? "M32 38 Q38 35 44 38" : emotion === 'alert' ? "M32 36 Q38 40 44 36" : "M32 37 Q38 35 44 37"}
          stroke={avatar.hairColor} strokeWidth="2" fill="none" strokeLinecap="round"
        />
        <path
          d={emotion === 'thinking' ? "M56 38 Q62 35 68 38" : emotion === 'alert' ? "M56 36 Q62 40 68 36" : "M56 37 Q62 35 68 37"}
          stroke={avatar.hairColor} strokeWidth="2" fill="none" strokeLinecap="round"
        />

        {/* Yeux */}
        <g>
          {/* Oeil gauche */}
          <ellipse cx="38" cy="46" rx="6" ry={blinkState ? 0.5 : 5} fill="white" />
          {!blinkState && (
            <>
              <circle cx="38" cy="46" r="3.5" fill={avatar.eyeColor} />
              <circle cx="38" cy="46" r="2" fill="#1a1a1a" />
              <circle cx="36.5" cy="44.5" r="1" fill="white" opacity="0.8" />
            </>
          )}

          {/* Oeil droit */}
          <ellipse cx="62" cy="46" rx="6" ry={blinkState ? 0.5 : 5} fill="white" />
          {!blinkState && (
            <>
              <circle cx="62" cy="46" r="3.5" fill={avatar.eyeColor} />
              <circle cx="62" cy="46" r="2" fill="#1a1a1a" />
              <circle cx="60.5" cy="44.5" r="1" fill="white" opacity="0.8" />
            </>
          )}
        </g>

        {/* Nez subtil */}
        <path d="M50 50 L48 58 Q50 60 52 58 L50 50" fill={skinDark} opacity="0.15" />

        {/* Joues rosées */}
        <ellipse cx="30" cy="55" rx="5" ry="3" fill="#FFB6C1" opacity="0.25" />
        <ellipse cx="70" cy="55" rx="5" ry="3" fill="#FFB6C1" opacity="0.25" />

        {/* Bouche avec lip-sync */}
        {speaking ? (
          <g>
            <ellipse cx="50" cy="66" rx="6" ry={mouthHeight} fill="#8B4513" />
            {mouthHeight > 3 && <ellipse cx="50" cy="64" rx="4" ry="1.5" fill="white" />}
            {mouthHeight > 4 && <ellipse cx="50" cy={66 + mouthHeight * 0.4} rx="3" ry="2" fill="#CD5C5C" />}
          </g>
        ) : (
          <path d="M44 66 Q50 70 56 66" stroke="#CD8B8B" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
      </svg>

      {/* Indicateurs d'état */}
      {emotion === 'thinking' && (
        <div className="absolute -top-1 -right-1 w-3 h-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </div>
      )}
      {emotion === 'alert' && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center animate-bounce">
          <span className="text-white text-[8px] font-bold">!</span>
        </div>
      )}
    </div>
  );
});

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
