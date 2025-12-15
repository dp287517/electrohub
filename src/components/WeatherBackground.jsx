import { useState, useEffect, useMemo, useCallback } from 'react';
import { Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudFog, Wind, Droplets } from 'lucide-react';

// Site coordinates (Switzerland locations)
const SITE_COORDINATES = {
  'Nyon': { lat: 46.3833, lon: 6.2333 },
  'Geneva': { lat: 46.2044, lon: 6.1432 },
  'Lausanne': { lat: 46.5197, lon: 6.6323 },
  'Zurich': { lat: 47.3769, lon: 8.5417 },
  'Basel': { lat: 47.5596, lon: 7.5886 },
};

// Weather code to condition mapping (WMO codes)
const getWeatherCondition = (code) => {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'cloudy';
};

const getWeatherLabel = (code) => {
  if (code === 0) return 'Ciel dégagé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Couvert';
  if (code >= 45 && code <= 48) return 'Brouillard';
  if (code >= 51 && code <= 55) return 'Bruine';
  if (code >= 56 && code <= 57) return 'Bruine verglaçante';
  if (code >= 61 && code <= 65) return 'Pluie';
  if (code >= 66 && code <= 67) return 'Pluie verglaçante';
  if (code >= 71 && code <= 75) return 'Neige';
  if (code === 77) return 'Grésil';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code >= 85 && code <= 86) return 'Averses de neige';
  if (code === 95) return 'Orage';
  if (code >= 96 && code <= 99) return 'Orage avec grêle';
  return 'Inconnu';
};

// Dynamic gradient based on weather and time
const getGradient = (condition, isNight, hour) => {
  const isSunrise = hour >= 6 && hour < 8;
  const isSunset = hour >= 18 && hour < 20;

  if (isNight) {
    switch (condition) {
      case 'clear':
        return 'from-slate-900 via-indigo-950 to-slate-950';
      case 'partly-cloudy':
        return 'from-slate-800 via-slate-900 to-indigo-950';
      case 'cloudy':
        return 'from-slate-700 via-slate-800 to-slate-900';
      case 'rain':
      case 'drizzle':
        return 'from-slate-800 via-slate-900 to-gray-950';
      case 'snow':
        return 'from-slate-600 via-slate-700 to-slate-800';
      case 'thunderstorm':
        return 'from-slate-900 via-purple-950 to-slate-950';
      case 'fog':
        return 'from-slate-600 via-slate-700 to-slate-800';
      default:
        return 'from-slate-800 via-slate-900 to-indigo-950';
    }
  }

  if (isSunrise) return 'from-orange-300 via-rose-400 to-purple-500';
  if (isSunset) return 'from-orange-400 via-rose-500 to-purple-600';

  switch (condition) {
    case 'clear':
      return 'from-sky-400 via-blue-500 to-blue-600';
    case 'partly-cloudy':
      return 'from-sky-400 via-blue-400 to-slate-500';
    case 'cloudy':
      return 'from-slate-400 via-slate-500 to-slate-600';
    case 'rain':
    case 'drizzle':
      return 'from-slate-500 via-slate-600 to-gray-700';
    case 'snow':
      return 'from-slate-300 via-blue-200 to-blue-300';
    case 'thunderstorm':
      return 'from-slate-600 via-purple-700 to-slate-800';
    case 'fog':
      return 'from-slate-300 via-slate-400 to-slate-500';
    default:
      return 'from-sky-400 via-blue-500 to-blue-600';
  }
};

// ============================================================
// ANIMATED COMPONENTS
// ============================================================

// ⭐ Twinkling Stars with shooting stars
function Stars({ count = 80 }) {
  const stars = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 70,
      size: Math.random() * 2.5 + 0.5,
      delay: Math.random() * 4,
      duration: 1.5 + Math.random() * 2,
      brightness: Math.random() > 0.7 ? 'bright' : 'normal',
    })), [count]
  );

  const shootingStars = useMemo(() =>
    Array.from({ length: 3 }, (_, i) => ({
      id: i,
      delay: i * 5 + Math.random() * 3,
      duration: 1 + Math.random() * 0.5,
      top: 5 + Math.random() * 30,
    })), []
  );

  return (
    <div className="absolute inset-0 overflow-hidden">
      {stars.map(star => (
        <div
          key={star.id}
          className={`absolute rounded-full animate-twinkle ${star.brightness === 'bright' ? 'bg-white shadow-lg shadow-white/50' : 'bg-white/80'}`}
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.delay}s`,
            animationDuration: `${star.duration}s`,
          }}
        />
      ))}
      {shootingStars.map(star => (
        <div
          key={`shooting-${star.id}`}
          className="absolute w-1 h-1 bg-white rounded-full animate-shooting-star"
          style={{
            top: `${star.top}%`,
            animationDelay: `${star.delay}s`,
            animationDuration: `${star.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

// 🌙 Realistic Moon with craters and glow
function Moon() {
  return (
    <div className="absolute top-8 right-8 sm:top-6 sm:right-16 w-14 h-14 sm:w-20 sm:h-20 pointer-events-none">
      <div className="relative w-full h-full animate-float-slow">
        {/* Outer glow */}
        <div className="absolute -inset-8 bg-slate-200/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute -inset-4 bg-slate-200/20 rounded-full blur-xl" />
        {/* Moon surface */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-slate-200 to-slate-300 rounded-full shadow-2xl">
          {/* Craters */}
          <div className="absolute top-2 left-3 w-3 h-3 bg-slate-300/60 rounded-full" />
          <div className="absolute top-5 right-3 w-2 h-2 bg-slate-300/50 rounded-full" />
          <div className="absolute bottom-3 left-5 w-4 h-4 bg-slate-300/40 rounded-full" />
          <div className="absolute bottom-5 right-5 w-1.5 h-1.5 bg-slate-300/30 rounded-full" />
          <div className="absolute top-7 left-7 w-2 h-2 bg-slate-300/35 rounded-full" />
        </div>
        {/* Inner highlight */}
        <div className="absolute top-1 left-1 w-1/3 h-1/3 bg-white/30 rounded-full blur-sm" />
      </div>
    </div>
  );
}

// ☀️ Spectacular Sun with rays, flares and corona
function SunRays() {
  return (
    <div className="absolute -top-20 -right-20 w-80 h-80 sm:w-[500px] sm:h-[500px] pointer-events-none">
      {/* Corona layers */}
      <div className="absolute inset-0 bg-yellow-200/20 rounded-full blur-3xl animate-pulse-slow" />
      <div className="absolute inset-10 bg-orange-300/25 rounded-full blur-2xl animate-pulse-slower" />
      <div className="absolute inset-20 bg-yellow-300/30 rounded-full blur-xl" />

      {/* Sun core */}
      <div className="absolute inset-24 sm:inset-32">
        <div className="relative w-full h-full">
          <div className="absolute inset-0 bg-gradient-radial from-white via-yellow-200 to-orange-300 rounded-full shadow-2xl shadow-orange-400/50" />

          {/* Rotating rays */}
          <div className="absolute inset-0 animate-spin-slow">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 w-2 h-40 sm:h-60 origin-bottom"
                style={{ transform: `rotate(${i * 22.5}deg) translateY(-100%)` }}
              >
                <div
                  className="w-full h-full bg-gradient-to-t from-yellow-300/60 via-yellow-200/30 to-transparent"
                  style={{ clipPath: 'polygon(30% 0, 70% 0, 100% 100%, 0% 100%)' }}
                />
              </div>
            ))}
          </div>

          {/* Pulsing rays */}
          <div className="absolute inset-0 animate-pulse-slow">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`pulse-${i}`}
                className="absolute top-1/2 left-1/2 w-1 h-32 sm:h-48 bg-gradient-to-t from-orange-400/40 to-transparent origin-bottom"
                style={{
                  transform: `rotate(${i * 45 + 22.5}deg) translateY(-100%)`,
                  animationDelay: `${i * 0.2}s`
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Lens flares */}
      <div className="absolute top-1/2 left-1/3 w-8 h-8 bg-gradient-radial from-white/40 to-transparent rounded-full animate-flare" />
      <div className="absolute top-2/3 left-1/4 w-4 h-4 bg-gradient-radial from-orange-200/30 to-transparent rounded-full animate-flare-delayed" />
      <div className="absolute bottom-1/4 left-1/2 w-6 h-6 bg-gradient-radial from-yellow-100/25 to-transparent rounded-full animate-flare" />
    </div>
  );
}

// ☁️ Realistic 3D Clouds with shadows
function AnimatedClouds({ count = 5, dark = false, hasWind = false }) {
  const clouds = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      top: 5 + Math.random() * 45,
      size: 80 + Math.random() * 120,
      duration: 25 + Math.random() * 35,
      delay: Math.random() * -30,
      opacity: 0.4 + Math.random() * 0.4,
      layer: Math.random() > 0.5 ? 'front' : 'back',
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {clouds.map(cloud => (
        <div
          key={cloud.id}
          className={`absolute ${hasWind ? 'animate-cloud-fast' : 'animate-cloud'}`}
          style={{
            top: `${cloud.top}%`,
            width: cloud.size,
            height: cloud.size * 0.5,
            animationDuration: `${hasWind ? cloud.duration * 0.5 : cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
            zIndex: cloud.layer === 'front' ? 2 : 1,
            filter: cloud.layer === 'back' ? 'blur(1px)' : 'none',
          }}
        >
          <svg viewBox="0 0 120 60" className="w-full h-full drop-shadow-lg">
            {/* Cloud shadow */}
            <ellipse cx="60" cy="45" rx="50" ry="12" fill={dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)'} />
            {/* Cloud body */}
            <ellipse cx="60" cy="38" rx="48" ry="18" fill={dark ? `rgba(60,60,70,${cloud.opacity})` : `rgba(255,255,255,${cloud.opacity})`} />
            <ellipse cx="35" cy="32" rx="28" ry="20" fill={dark ? `rgba(70,70,80,${cloud.opacity + 0.1})` : `rgba(255,255,255,${cloud.opacity + 0.1})`} />
            <ellipse cx="85" cy="32" rx="30" ry="22" fill={dark ? `rgba(65,65,75,${cloud.opacity + 0.05})` : `rgba(255,255,255,${cloud.opacity + 0.05})`} />
            <ellipse cx="60" cy="22" rx="35" ry="20" fill={dark ? `rgba(75,75,85,${cloud.opacity + 0.15})` : `rgba(255,255,255,${cloud.opacity + 0.15})`} />
            <ellipse cx="45" cy="18" rx="22" ry="16" fill={dark ? `rgba(80,80,90,${cloud.opacity + 0.1})` : `rgba(255,255,255,${cloud.opacity + 0.2})`} />
            <ellipse cx="75" cy="20" rx="25" ry="18" fill={dark ? `rgba(78,78,88,${cloud.opacity + 0.12})` : `rgba(255,255,255,${cloud.opacity + 0.18})`} />
          </svg>
        </div>
      ))}
    </div>
  );
}

// 🌧️ Realistic Rain with splashes and wind
function RainDrops({ intensity = 'normal', hasWind = false }) {
  const count = intensity === 'heavy' ? 150 : intensity === 'light' ? 40 : 80;
  const angle = hasWind ? 15 : 0;

  const drops = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 120 - 10,
      delay: Math.random() * 2,
      duration: 0.4 + Math.random() * 0.4,
      length: 15 + Math.random() * 20,
      opacity: 0.2 + Math.random() * 0.5,
    })), [count]
  );

  const splashes = useMemo(() =>
    Array.from({ length: Math.floor(count / 3) }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      size: 3 + Math.random() * 4,
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Rain drops */}
      {drops.map(drop => (
        <div
          key={drop.id}
          className="absolute animate-rain"
          style={{
            left: `${drop.left}%`,
            width: 2,
            height: drop.length,
            background: `linear-gradient(to bottom, transparent, rgba(174, 194, 224, ${drop.opacity}), rgba(148, 176, 216, ${drop.opacity}))`,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration}s`,
            transform: `rotate(${angle}deg)`,
            borderRadius: '50%',
          }}
        />
      ))}
      {/* Splash effects at bottom */}
      {splashes.map(splash => (
        <div
          key={`splash-${splash.id}`}
          className="absolute bottom-0 animate-splash"
          style={{
            left: `${splash.left}%`,
            width: splash.size * 2,
            height: splash.size,
            animationDelay: `${splash.delay}s`,
          }}
        >
          <div className="absolute inset-0 border-2 border-blue-200/40 rounded-full scale-0 animate-ripple" />
          <div className="absolute inset-0 border border-blue-200/20 rounded-full scale-0 animate-ripple-delayed" />
        </div>
      ))}
    </div>
  );
}

// ❄️ Beautiful Snowflakes with variety
function SnowFlakes({ intensity = 'normal' }) {
  const count = intensity === 'heavy' ? 120 : intensity === 'light' ? 35 : 70;

  const flakes = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 4 + Math.random() * 10,
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 8,
      drift: Math.random() * 60 - 30,
      rotation: Math.random() * 360,
      type: Math.floor(Math.random() * 3), // 0: circle, 1: star, 2: crystal
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {flakes.map(flake => (
        <div
          key={flake.id}
          className="absolute animate-snow"
          style={{
            left: `${flake.left}%`,
            width: flake.size,
            height: flake.size,
            animationDelay: `${flake.delay}s`,
            animationDuration: `${flake.duration}s`,
            '--drift': `${flake.drift}px`,
            '--rotation': `${flake.rotation}deg`,
          }}
        >
          {flake.type === 0 ? (
            <div className="w-full h-full bg-white rounded-full shadow-sm shadow-white/50" />
          ) : flake.type === 1 ? (
            <svg viewBox="0 0 24 24" className="w-full h-full text-white drop-shadow-sm">
              <path fill="currentColor" d="M12 2L14 8L20 8L15 12L17 18L12 14L7 18L9 12L4 8L10 8Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-full h-full text-white drop-shadow-sm animate-spin-slow">
              <path fill="currentColor" d="M12 0L13 5L12 7L11 5L12 0M12 17L13 19L12 24L11 19L12 17M0 12L5 11L7 12L5 13L0 12M17 12L19 11L24 12L19 13L17 12M3.5 3.5L7 6L8 8L6 7L3.5 3.5M16 16L18 17L20.5 20.5L17 18L16 16M3.5 20.5L6 17L8 16L7 18L3.5 20.5M16 8L17 6L20.5 3.5L18 7L16 8" />
            </svg>
          )}
        </div>
      ))}
      {/* Snow accumulation effect */}
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-white/30 to-transparent" />
    </div>
  );
}

// ⚡ Dramatic Lightning
function Lightning() {
  const bolts = useMemo(() => [
    { id: 0, left: 20, delay: 0, path: 'M30 0 L25 40 L35 42 L20 100 L40 55 L32 53 L45 0' },
    { id: 1, left: 60, delay: 2.5, path: 'M35 0 L40 35 L30 38 L50 100 L35 50 L42 48 L25 0' },
    { id: 2, left: 80, delay: 4, path: 'M40 0 L35 45 L45 47 L25 100 L42 58 L36 55 L50 0' },
  ], []);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {bolts.map(bolt => (
        <div
          key={bolt.id}
          className="absolute top-0 animate-lightning"
          style={{
            left: `${bolt.left}%`,
            animationDelay: `${bolt.delay}s`,
          }}
        >
          <svg viewBox="0 0 60 100" className="w-20 h-48 sm:w-32 sm:h-64">
            <defs>
              <filter id={`glow-${bolt.id}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d={bolt.path}
              fill="#fef08a"
              filter={`url(#glow-${bolt.id})`}
            />
          </svg>
        </div>
      ))}
      {/* Flash effect */}
      <div className="absolute inset-0 bg-white/0 animate-flash" />
    </div>
  );
}

// 🌫️ Atmospheric Fog
function FogLayer({ density = 'normal' }) {
  const layers = density === 'heavy' ? 5 : density === 'light' ? 2 : 3;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: layers }).map((_, i) => (
        <div
          key={i}
          className="absolute w-[300%] animate-fog"
          style={{
            top: `${20 + i * 18}%`,
            height: `${60 + i * 20}px`,
            background: `linear-gradient(90deg,
              transparent 0%,
              rgba(255,255,255,${0.15 + i * 0.08}) 20%,
              rgba(255,255,255,${0.25 + i * 0.1}) 50%,
              rgba(255,255,255,${0.15 + i * 0.08}) 80%,
              transparent 100%)`,
            animationDelay: `${i * -5}s`,
            animationDuration: `${20 + i * 8}s`,
            filter: `blur(${4 + i * 2}px)`,
          }}
        />
      ))}
      {/* Ground fog */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white/40 via-white/20 to-transparent" />
    </div>
  );
}

// 💨 Wind particles and leaves
function WindEffect({ speed = 'normal' }) {
  const particleCount = speed === 'strong' ? 30 : speed === 'light' ? 10 : 20;

  const particles = useMemo(() =>
    Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      top: Math.random() * 80,
      size: 2 + Math.random() * 6,
      duration: 2 + Math.random() * 3,
      delay: Math.random() * 5,
      type: Math.random() > 0.7 ? 'leaf' : 'dust',
      rotation: Math.random() * 720,
    })), [particleCount]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Wind streaks */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`streak-${i}`}
          className="absolute h-px bg-gradient-to-r from-transparent via-white/20 to-transparent animate-wind-streak"
          style={{
            top: `${10 + i * 10}%`,
            width: `${100 + Math.random() * 200}px`,
            animationDelay: `${i * 0.3}s`,
            animationDuration: `${1 + Math.random()}s`,
          }}
        />
      ))}
      {/* Particles */}
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute animate-wind-particle"
          style={{
            top: `${p.top}%`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            '--rotation': `${p.rotation}deg`,
          }}
        >
          {p.type === 'leaf' ? (
            <svg viewBox="0 0 24 24" style={{ width: p.size * 2, height: p.size * 2 }} className="text-green-600/60">
              <path fill="currentColor" d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z" />
            </svg>
          ) : (
            <div
              className="rounded-full bg-white/40"
              style={{ width: p.size, height: p.size }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// 🌈 Aurora Borealis (for special clear nights)
function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
      <div className="absolute top-0 left-0 right-0 h-2/3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="absolute inset-x-0 animate-aurora"
            style={{
              top: `${i * 15}%`,
              height: '40%',
              background: `linear-gradient(180deg,
                transparent,
                ${i % 2 === 0 ? 'rgba(74, 222, 128, 0.3)' : 'rgba(139, 92, 246, 0.3)'} 30%,
                ${i % 2 === 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(167, 139, 250, 0.2)'} 60%,
                transparent)`,
              animationDelay: `${i * 2}s`,
              animationDuration: `${8 + i * 2}s`,
              filter: 'blur(20px)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function WeatherBackground({ site, children }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true);
        const coords = SITE_COORDINATES[site] || SITE_COORDINATES['Nyon'];
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto`
        );

        if (!response.ok) throw new Error('Weather fetch failed');

        const data = await response.json();
        setWeather({
          temperature: Math.round(data.current.temperature_2m),
          humidity: data.current.relative_humidity_2m,
          weatherCode: data.current.weather_code,
          windSpeed: Math.round(data.current.wind_speed_10m),
          isDay: data.current.is_day === 1,
          condition: getWeatherCondition(data.current.weather_code),
          label: getWeatherLabel(data.current.weather_code),
        });
      } catch (err) {
        console.error('Weather error:', err);
        setWeather({
          temperature: 15,
          humidity: 60,
          weatherCode: 2,
          windSpeed: 10,
          isDay: new Date().getHours() >= 6 && new Date().getHours() < 20,
          condition: 'partly-cloudy',
          label: 'Partiellement nuageux',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [site]);

  const hour = new Date().getHours();
  const isNight = weather ? !weather.isDay : (hour < 6 || hour >= 20);
  const condition = weather?.condition || 'partly-cloudy';
  const gradient = getGradient(condition, isNight, hour);
  const hasStrongWind = weather?.windSpeed > 30;
  const hasWind = weather?.windSpeed > 15;

  const WeatherIcon = useMemo(() => {
    switch (condition) {
      case 'clear': return isNight ? Cloud : Sun;
      case 'rain':
      case 'drizzle': return CloudRain;
      case 'snow': return CloudSnow;
      case 'thunderstorm': return CloudLightning;
      case 'fog': return CloudFog;
      default: return Cloud;
    }
  }, [condition, isNight]);

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${gradient} transition-all duration-1000`}>
      {/* CSS Animations */}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes shooting-star {
          0% { transform: translateX(0) translateY(0) rotate(-45deg); opacity: 1; }
          100% { transform: translateX(300px) translateY(300px) rotate(-45deg); opacity: 0; }
        }
        @keyframes cloud {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(calc(100vw + 50%)); }
        }
        @keyframes cloud-fast {
          0% { transform: translateX(-150%) skewX(-5deg); }
          100% { transform: translateX(calc(100vw + 50%)) skewX(-5deg); }
        }
        @keyframes rain {
          0% { transform: translateY(-30px) rotate(var(--angle, 0deg)); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(calc(100vh + 30px)) rotate(var(--angle, 0deg)); opacity: 0; }
        }
        @keyframes splash {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        @keyframes ripple {
          0% { transform: scale(0); opacity: 1; }
          100% { transform: scale(3); opacity: 0; }
        }
        @keyframes ripple-delayed {
          0% { transform: scale(0); opacity: 0; }
          30% { opacity: 0; }
          31% { transform: scale(0); opacity: 1; }
          100% { transform: scale(4); opacity: 0; }
        }
        @keyframes snow {
          0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% {
            transform: translateY(calc(100vh + 20px)) translateX(var(--drift, 0px)) rotate(var(--rotation, 360deg));
            opacity: 0.3;
          }
        }
        @keyframes lightning {
          0%, 89%, 100% { opacity: 0; }
          90%, 92%, 94% { opacity: 1; }
          91%, 93% { opacity: 0.5; }
        }
        @keyframes flash {
          0%, 89%, 100% { background-color: rgba(255,255,255,0); }
          90% { background-color: rgba(255,255,255,0.3); }
          92% { background-color: rgba(255,255,255,0); }
          94% { background-color: rgba(255,255,255,0.15); }
        }
        @keyframes fog {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes pulse-slower {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.08); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes flare {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.5); }
        }
        @keyframes flare-delayed {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes wind-streak {
          0% { transform: translateX(-200px); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateX(calc(100vw + 200px)); opacity: 0; }
        }
        @keyframes wind-particle {
          0% { transform: translateX(-50px) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateX(calc(100vw + 50px)) rotate(var(--rotation, 360deg)); opacity: 0; }
        }
        @keyframes aurora {
          0%, 100% { transform: translateX(-10%) scaleY(1); opacity: 0.3; }
          25% { transform: translateX(5%) scaleY(1.2); opacity: 0.5; }
          50% { transform: translateX(-5%) scaleY(0.8); opacity: 0.4; }
          75% { transform: translateX(10%) scaleY(1.1); opacity: 0.6; }
        }

        .animate-twinkle { animation: twinkle ease-in-out infinite; }
        .animate-shooting-star { animation: shooting-star linear infinite 8s; }
        .animate-cloud { animation: cloud linear infinite; }
        .animate-cloud-fast { animation: cloud-fast linear infinite; }
        .animate-rain { animation: rain linear infinite; }
        .animate-splash { animation: splash linear infinite 2s; }
        .animate-ripple { animation: ripple ease-out infinite 2s; }
        .animate-ripple-delayed { animation: ripple-delayed ease-out infinite 2s; }
        .animate-snow { animation: snow ease-in-out infinite; }
        .animate-lightning { animation: lightning linear infinite 6s; }
        .animate-flash { animation: flash linear infinite 6s; }
        .animate-fog { animation: fog linear infinite; }
        .animate-float-slow { animation: float-slow ease-in-out infinite 6s; }
        .animate-pulse-slow { animation: pulse-slow ease-in-out infinite 4s; }
        .animate-pulse-slower { animation: pulse-slower ease-in-out infinite 6s; }
        .animate-spin-slow { animation: spin-slow linear infinite 20s; }
        .animate-flare { animation: flare ease-in-out infinite 3s; }
        .animate-flare-delayed { animation: flare-delayed ease-in-out infinite 4s 1s; }
        .animate-wind-streak { animation: wind-streak linear infinite; }
        .animate-wind-particle { animation: wind-particle linear infinite; }
        .animate-aurora { animation: aurora ease-in-out infinite; }

        .bg-gradient-radial {
          background: radial-gradient(circle, var(--tw-gradient-stops));
        }
      `}</style>

      {/* Weather effects based on condition */}

      {/* Night: Stars, Moon, Aurora */}
      {isNight && condition === 'clear' && (
        <>
          <Stars count={100} />
          <Moon />
          <Aurora />
        </>
      )}
      {isNight && condition === 'partly-cloudy' && (
        <>
          <Stars count={40} />
          <Moon />
        </>
      )}

      {/* Day: Sun with full effects */}
      {!isNight && condition === 'clear' && <SunRays />}

      {/* Cloudy conditions */}
      {(condition === 'partly-cloudy' || condition === 'cloudy') && (
        <AnimatedClouds
          count={condition === 'cloudy' ? 10 : 5}
          dark={condition === 'cloudy'}
          hasWind={hasWind}
        />
      )}

      {/* Rain */}
      {(condition === 'rain' || condition === 'drizzle') && (
        <>
          <AnimatedClouds count={8} dark hasWind={hasWind} />
          <RainDrops
            intensity={condition === 'rain' ? 'heavy' : 'light'}
            hasWind={hasWind}
          />
        </>
      )}

      {/* Snow */}
      {condition === 'snow' && (
        <>
          <AnimatedClouds count={6} />
          <SnowFlakes intensity="normal" />
        </>
      )}

      {/* Thunderstorm */}
      {condition === 'thunderstorm' && (
        <>
          <AnimatedClouds count={10} dark hasWind />
          <RainDrops intensity="heavy" hasWind />
          <Lightning />
        </>
      )}

      {/* Fog */}
      {condition === 'fog' && <FogLayer density="normal" />}

      {/* Wind effect for high wind speed */}
      {hasWind && condition !== 'fog' && (
        <WindEffect speed={hasStrongWind ? 'strong' : 'normal'} />
      )}

      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />

      {/* Weather info overlay */}
      {!loading && weather && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-black/30 backdrop-blur-md rounded-xl px-3 py-1.5 border border-white/10 shadow-lg">
          <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
            <WeatherIcon size={16} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-white leading-none">{weather.temperature}°C</span>
            <span className="text-[10px] text-white/70 leading-none">{weather.label}</span>
          </div>
        </div>
      )}

      {/* Weather details */}
      {!loading && weather && (
        <div className="absolute top-2 left-2 z-20 hidden sm:flex gap-2 text-white/80 text-xs">
          <div className="flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-2.5 py-1">
            <Droplets size={12} />
            <span>{weather.humidity}%</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-2.5 py-1">
            <Wind size={12} />
            <span>{weather.windSpeed} km/h</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>

      {/* Wave decoration */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <svg viewBox="0 0 1440 100" className="w-full h-auto fill-gray-50" preserveAspectRatio="none">
          <path d="M0,50 C360,100 1080,0 1440,50 L1440,100 L0,100 Z" />
        </svg>
      </div>
    </div>
  );
}
