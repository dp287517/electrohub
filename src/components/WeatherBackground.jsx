import { useState, useEffect, useMemo } from 'react';
import { Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudFog, Wind, Droplets, Thermometer } from 'lucide-react';

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
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 56 && code <= 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 66 && code <= 67) return 'Freezing rain';
  if (code >= 71 && code <= 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code >= 96 && code <= 99) return 'Thunderstorm with hail';
  return 'Unknown';
};

// Dynamic gradient based on weather and time
const getGradient = (condition, isNight, hour) => {
  // Sunrise/sunset times (approx)
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

  if (isSunrise) {
    return 'from-orange-300 via-rose-400 to-purple-500';
  }

  if (isSunset) {
    return 'from-orange-400 via-rose-500 to-purple-600';
  }

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
      return 'from-slate-300 via-slate-400 to-blue-400';
    case 'thunderstorm':
      return 'from-slate-600 via-purple-700 to-slate-800';
    case 'fog':
      return 'from-slate-300 via-slate-400 to-slate-500';
    default:
      return 'from-sky-400 via-blue-500 to-blue-600';
  }
};

// Animated elements components
function Stars({ count = 50 }) {
  const stars = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 60,
      size: Math.random() * 2 + 1,
      delay: Math.random() * 3,
      duration: 2 + Math.random() * 2,
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden">
      {stars.map(star => (
        <div
          key={star.id}
          className="absolute rounded-full bg-white animate-twinkle"
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
    </div>
  );
}

function AnimatedClouds({ count = 5, dark = false }) {
  const clouds = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      top: 10 + Math.random() * 40,
      size: 60 + Math.random() * 100,
      duration: 30 + Math.random() * 40,
      delay: Math.random() * -30,
      opacity: 0.3 + Math.random() * 0.4,
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {clouds.map(cloud => (
        <div
          key={cloud.id}
          className="absolute animate-cloud"
          style={{
            top: `${cloud.top}%`,
            width: cloud.size,
            height: cloud.size * 0.6,
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        >
          <svg viewBox="0 0 100 60" className="w-full h-full">
            <ellipse cx="50" cy="35" rx="45" ry="20" fill={dark ? 'rgba(30,30,30,0.4)' : 'rgba(255,255,255,0.4)'} />
            <ellipse cx="30" cy="30" rx="25" ry="18" fill={dark ? 'rgba(30,30,30,0.5)' : 'rgba(255,255,255,0.5)'} />
            <ellipse cx="70" cy="30" rx="28" ry="20" fill={dark ? 'rgba(30,30,30,0.45)' : 'rgba(255,255,255,0.45)'} />
            <ellipse cx="50" cy="22" rx="30" ry="18" fill={dark ? 'rgba(40,40,40,0.5)' : 'rgba(255,255,255,0.6)'} />
          </svg>
        </div>
      ))}
    </div>
  );
}

function RainDrops({ intensity = 'normal' }) {
  const count = intensity === 'heavy' ? 100 : intensity === 'light' ? 30 : 60;
  const drops = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 0.5 + Math.random() * 0.5,
      opacity: 0.3 + Math.random() * 0.4,
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {drops.map(drop => (
        <div
          key={drop.id}
          className="absolute w-0.5 h-4 bg-gradient-to-b from-transparent via-blue-200 to-blue-300 animate-rain"
          style={{
            left: `${drop.left}%`,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration}s`,
            opacity: drop.opacity,
          }}
        />
      ))}
    </div>
  );
}

function SnowFlakes({ intensity = 'normal' }) {
  const count = intensity === 'heavy' ? 80 : intensity === 'light' ? 25 : 50;
  const flakes = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 3 + Math.random() * 5,
      delay: Math.random() * 5,
      duration: 5 + Math.random() * 5,
      drift: Math.random() * 40 - 20,
    })), [count]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {flakes.map(flake => (
        <div
          key={flake.id}
          className="absolute rounded-full bg-white animate-snow"
          style={{
            left: `${flake.left}%`,
            width: flake.size,
            height: flake.size,
            animationDelay: `${flake.delay}s`,
            animationDuration: `${flake.duration}s`,
            '--drift': `${flake.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

function SunRays() {
  return (
    <div className="absolute top-0 right-0 w-48 h-48 sm:w-96 sm:h-96 overflow-hidden pointer-events-none">
      <div className="absolute -top-10 -right-10 sm:-top-20 sm:-right-20 w-32 h-32 sm:w-64 sm:h-64">
        {/* Sun glow */}
        <div className="absolute inset-0 bg-yellow-300/30 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute inset-8 bg-yellow-200/40 rounded-full blur-2xl" />
        <div className="absolute inset-16 bg-yellow-100/50 rounded-full blur-xl" />
        {/* Sun rays */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-1/2 left-1/2 w-1 h-32 bg-gradient-to-b from-yellow-200/40 to-transparent origin-bottom animate-ray"
            style={{
              transform: `rotate(${i * 30}deg) translateY(-100%)`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Moon() {
  return (
    <div className="absolute top-16 right-4 sm:top-8 sm:right-12 w-12 h-12 sm:w-20 sm:h-20 pointer-events-none">
      <div className="relative w-full h-full">
        <div className="absolute inset-0 bg-slate-200 rounded-full shadow-lg shadow-slate-300/50" />
        <div className="absolute top-1 left-1.5 sm:top-2 sm:left-3 w-2 h-2 sm:w-4 sm:h-4 bg-slate-300/50 rounded-full" />
        <div className="absolute top-3 right-2 sm:top-6 sm:right-4 w-1.5 h-1.5 sm:w-3 sm:h-3 bg-slate-300/40 rounded-full" />
        <div className="absolute bottom-2 left-2.5 sm:bottom-4 sm:left-5 w-1 h-1 sm:w-2 sm:h-2 bg-slate-300/30 rounded-full" />
        {/* Moon glow */}
        <div className="absolute -inset-2 sm:-inset-4 bg-slate-200/20 rounded-full blur-xl" />
      </div>
    </div>
  );
}

function Lightning() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute top-0 left-1/4 w-full h-full animate-lightning">
        <svg viewBox="0 0 100 200" className="w-16 h-32 text-yellow-200">
          <path
            d="M50 0 L30 80 L50 80 L20 200 L60 100 L40 100 L70 0 Z"
            fill="currentColor"
            className="drop-shadow-[0_0_10px_rgba(253,224,71,0.8)]"
          />
        </svg>
      </div>
    </div>
  );
}

function FogLayer() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="absolute w-[200%] h-32 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-fog"
          style={{
            top: `${30 + i * 20}%`,
            animationDelay: `${i * 3}s`,
            animationDuration: `${15 + i * 5}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function WeatherBackground({ site, children }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true);

        // Get coordinates for site or default to Nyon
        const coords = SITE_COORDINATES[site] || SITE_COORDINATES['Nyon'];

        // Fetch from Open-Meteo API (free, no API key needed)
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
        setError(null);
      } catch (err) {
        console.error('Weather error:', err);
        setError(err.message);
        // Fallback weather
        setWeather({
          temperature: 15,
          humidity: 60,
          weatherCode: 2,
          windSpeed: 10,
          isDay: new Date().getHours() >= 6 && new Date().getHours() < 20,
          condition: 'partly-cloudy',
          label: 'Partly cloudy',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    // Refresh weather every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [site]);

  const hour = new Date().getHours();
  const isNight = weather ? !weather.isDay : (hour < 6 || hour >= 20);
  const condition = weather?.condition || 'partly-cloudy';
  const gradient = getGradient(condition, isNight, hour);

  // Weather icon based on condition
  const WeatherIcon = useMemo(() => {
    switch (condition) {
      case 'clear': return isNight ? Moon : Sun;
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
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes cloud {
          from { transform: translateX(-100%); }
          to { transform: translateX(calc(100vw + 100%)); }
        }
        @keyframes rain {
          0% { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0.3; }
        }
        @keyframes snow {
          0% { transform: translateY(-20px) translateX(0); opacity: 0; }
          10% { opacity: 0.8; }
          100% { transform: translateY(100vh) translateX(var(--drift, 20px)); opacity: 0; }
        }
        @keyframes ray {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        @keyframes lightning {
          0%, 90%, 100% { opacity: 0; }
          92%, 94%, 96% { opacity: 1; }
          93%, 95% { opacity: 0; }
        }
        @keyframes fog {
          from { transform: translateX(-50%); }
          to { transform: translateX(0%); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }
        .animate-twinkle { animation: twinkle ease-in-out infinite; }
        .animate-cloud { animation: cloud linear infinite; }
        .animate-rain { animation: rain linear infinite; }
        .animate-snow { animation: snow ease-in-out infinite; }
        .animate-ray { animation: ray ease-in-out 3s infinite; }
        .animate-lightning { animation: lightning 4s infinite; }
        .animate-fog { animation: fog linear infinite; }
        .animate-pulse-slow { animation: pulse-slow 4s ease-in-out infinite; }
      `}</style>

      {/* Weather effects based on condition */}
      {isNight && condition === 'clear' && <Stars count={80} />}
      {isNight && condition === 'clear' && <Moon />}

      {!isNight && condition === 'clear' && <SunRays />}

      {(condition === 'partly-cloudy' || condition === 'cloudy') && (
        <AnimatedClouds count={condition === 'cloudy' ? 8 : 4} dark={condition === 'cloudy'} />
      )}

      {(condition === 'rain' || condition === 'drizzle') && (
        <>
          <AnimatedClouds count={6} dark />
          <RainDrops intensity={condition === 'rain' ? 'normal' : 'light'} />
        </>
      )}

      {condition === 'snow' && (
        <>
          <AnimatedClouds count={5} />
          <SnowFlakes intensity="normal" />
        </>
      )}

      {condition === 'thunderstorm' && (
        <>
          <AnimatedClouds count={8} dark />
          <RainDrops intensity="heavy" />
          <Lightning />
        </>
      )}

      {condition === 'fog' && <FogLayer />}

      {/* Gradient overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />

      {/* Weather info overlay - top right on mobile, integrated on desktop */}
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 lg:top-auto lg:bottom-28 lg:right-8 z-20">
        {!loading && weather && (
          <div className="flex items-center gap-2 sm:gap-3 bg-black/30 backdrop-blur-md rounded-xl sm:rounded-2xl px-2 py-1.5 sm:px-4 sm:py-3 border border-white/20">
            <div className="text-right">
              <div className="text-xl sm:text-3xl lg:text-4xl font-light text-white">
                {weather.temperature}°
              </div>
              <div className="text-[10px] sm:text-xs lg:text-sm text-white/80 hidden sm:block">{weather.label}</div>
            </div>
            <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-14 lg:h-14 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center">
              <WeatherIcon size={18} className="text-white sm:hidden" />
              <WeatherIcon size={22} className="text-white hidden sm:block lg:hidden" />
              <WeatherIcon size={28} className="text-white hidden lg:block" />
            </div>
          </div>
        )}
      </div>

      {/* Weather details (bottom left) - hidden on mobile, visible on tablet+ */}
      {!loading && weather && (
        <div className="absolute bottom-28 left-4 sm:left-6 lg:left-8 z-20 hidden md:flex gap-3 text-white/70 text-xs sm:text-sm">
          <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5">
            <Droplets size={14} />
            <span>{weather.humidity}%</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5">
            <Wind size={14} />
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
