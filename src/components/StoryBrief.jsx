import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX,
  Zap, Cog, Battery, Shield, Flame, Activity, AlertTriangle, CheckCircle,
  Clock, TrendingUp, TrendingDown, Building2, Calendar, Target, Users,
  Database, Wrench, DoorOpen, FileText, Briefcase, Globe, MapPin,
  BarChart3, PieChart, Sparkles, RefreshCw, ExternalLink, Star,
  Box, Tag, Folder, Server, HardDrive, Cpu, Wifi, Monitor, Gauge,
  Hammer, Factory, Droplet, Wind, Sun, Cloud, Bell, Award, Home,
  Package, Lock, Eye, Bookmark, Circle, Square, Triangle, Heart,
  Navigation, Compass, Crosshair, Flag, Pin, Info, Power, Plug,
  Thermometer, Cable
} from 'lucide-react';
import { api } from '../lib/api';
import { aiAssistant } from '../lib/ai-assistant';
import { getDashboardStats as getProceduresDashboard } from '../lib/procedures-api';

// Icon mapping for datahub categories
const ICON_MAP = {
  circle: Circle, square: Square, triangle: Triangle, star: Star, heart: Heart,
  target: Target, mappin: MapPin, pin: Pin, crosshair: Crosshair, compass: Compass,
  navigation: Navigation, flag: Flag, database: Database, server: Server,
  harddrive: HardDrive, cpu: Cpu, wifi: Wifi, monitor: Monitor, zap: Zap,
  power: Power, battery: Battery, plug: Plug, flame: Flame, thermometer: Thermometer,
  gauge: Gauge, wrench: Wrench, hammer: Hammer, factory: Factory, cable: Cable,
  droplet: Droplet, wind: Wind, sun: Sun, cloud: Cloud, check: CheckCircle,
  alertcircle: AlertTriangle, info: Info, shield: Shield, lock: Lock, eye: Eye,
  tag: Tag, bookmark: Bookmark, award: Award, user: Users, users: Users,
  building: Building2, home: Home, box: Box, package: Package, folder: Folder,
  file: FileText, clock: Clock, calendar: Calendar, bell: Bell, cog: Cog
};

// Animated counter
const AnimatedNumber = ({ value, duration = 1000 }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTime;
    const startValue = displayValue;

    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.floor(startValue + (value - startValue) * eased));

      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span>{displayValue}</span>;
};

// Progress bar for story navigation
const StoryProgress = ({ current, total, progress }) => (
  <div className="flex gap-1 px-3 pt-3 pb-2 safe-area-top">
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-white rounded-full transition-all duration-100"
          style={{
            width: i < current ? '100%' : i === current ? `${progress}%` : '0%'
          }}
        />
      </div>
    ))}
  </div>
);

// Individual Story Slide
const StorySlide = ({ children, gradient, isActive }) => (
  <div
    className={`absolute inset-0 transition-all duration-500 ${
      isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
    }`}
  >
    <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
    <div className="absolute inset-0 bg-black/10" />
    <div className="relative h-full flex flex-col">
      {children}
    </div>
  </div>
);

// Stat bubble component
const StatBubble = ({ icon: Icon, value, label, color = 'white', onClick, delay = 0 }) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center p-3 sm:p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 hover:bg-white/20 transition-all hover:scale-105 animate-fadeInUp"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center mb-2`}>
      <Icon size={20} className="text-white sm:w-6 sm:h-6" />
    </div>
    <span className="text-2xl sm:text-3xl font-bold text-white">
      <AnimatedNumber value={value} />
    </span>
    <span className="text-white/70 text-xs sm:text-sm text-center">{label}</span>
  </button>
);

// Category card for datahub
const CategoryCard = ({ category, onClick, delay = 0 }) => {
  const IconComponent = ICON_MAP[category.icon?.toLowerCase()] || Database;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20 hover:bg-white/20 transition-all hover:scale-102 animate-fadeInUp w-full"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: category.color || '#3B82F6' }}
      >
        <IconComponent size={20} className="text-white" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-white font-semibold text-sm truncate">{category.name}</p>
        <p className="text-white/60 text-xs">{category.item_count || 0} éléments</p>
      </div>
      <div className="text-2xl font-bold text-white/90">{category.item_count || 0}</div>
    </button>
  );
};

// App card for overview
const AppPreview = ({ app, stats, onClick, delay = 0 }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 p-2 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 hover:bg-white/20 transition-all animate-fadeInUp"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${app.color} flex items-center justify-center flex-shrink-0`}>
      <Zap size={14} className="text-white" />
    </div>
    <div className="flex-1 text-left min-w-0">
      <p className="text-white text-xs font-medium truncate">{app.label}</p>
    </div>
    {stats > 0 && (
      <span className="text-white/80 text-xs font-bold">{stats}</span>
    )}
  </button>
);

// Main StoryBrief Component
export default function StoryBrief({
  userName,
  onClose,
  autoPlay = true,
  slideDuration = 6000
}) {
  const navigate = useNavigate();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [briefData, setBriefData] = useState(null);
  const [datahubCategories, setDatahubCategories] = useState([]);
  const [datahubStats, setDatahubStats] = useState(null);
  const [proceduresStats, setProceduresStats] = useState(null);
  const [doorsStats, setDoorsStats] = useState(null);
  const containerRef = useRef(null);
  const touchStartX = useRef(0);

  // Load all data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [brief, categories, stats, procedures, doors] = await Promise.all([
          aiAssistant.getMorningBrief().catch(() => null),
          api.datahub.listCategories().catch(() => ({ categories: [] })),
          api.datahub.stats().catch(() => null),
          getProceduresDashboard().catch(() => null),
          api.doors.dashboard().catch(() => null)
        ]);

        setBriefData(brief);
        setDatahubCategories(categories?.categories || []);
        setDatahubStats(stats);
        setProceduresStats(procedures);
        setDoorsStats(doors);
      } catch (err) {
        console.error('StoryBrief load error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Auto-advance slides
  useEffect(() => {
    if (!autoPlay || isPaused || isLoading) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev + (100 / (slideDuration / 100));
        if (newProgress >= 100) {
          setCurrentSlide(curr => (curr + 1) % slides.length);
          return 0;
        }
        return newProgress;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPaused, isLoading, autoPlay, slideDuration, currentSlide]);

  // Navigate slides
  const goToSlide = useCallback((index) => {
    setCurrentSlide(index);
    setProgress(0);
  }, []);

  const nextSlide = useCallback(() => {
    goToSlide((currentSlide + 1) % slides.length);
  }, [currentSlide]);

  const prevSlide = useCallback(() => {
    goToSlide((currentSlide - 1 + slides.length) % slides.length);
  }, [currentSlide]);

  // Touch handlers for mobile swipe
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) nextSlide();
      else prevSlide();
    }
  };

  // Click zones for navigation
  const handleClick = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const zone = x / rect.width;

    if (zone < 0.3) prevSlide();
    else if (zone > 0.7) nextSlide();
    else setIsPaused(!isPaused);
  };

  // Navigate to app
  const navigateTo = (path) => {
    onClose?.();
    navigate(path);
  };

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  // Build slides data
  const slides = [
    // Slide 1: Welcome
    {
      id: 'welcome',
      gradient: 'from-indigo-600 via-purple-600 to-pink-500',
      content: (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-6 animate-bounce-slow">
            <Sparkles size={40} className="text-white sm:w-12 sm:h-12" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 animate-fadeInUp">
            {getGreeting()}, {userName || 'Technicien'}
          </h1>
          <p className="text-white/80 text-lg sm:text-xl mb-6 animate-fadeInUp" style={{ animationDelay: '100ms' }}>
            Voici votre brief du matin
          </p>
          <div className="flex items-center gap-2 text-white/60 animate-fadeInUp" style={{ animationDelay: '200ms' }}>
            <Calendar size={16} />
            <span>{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>

          {briefData && (
            <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-sm animate-fadeInUp" style={{ animationDelay: '300ms' }}>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center border border-white/20">
                <p className="text-4xl font-bold text-white">{briefData.healthScore || 0}</p>
                <p className="text-white/70 text-sm">Score Santé</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center border border-white/20">
                <p className="text-4xl font-bold text-white">{briefData.stats?.totalEquipment || 0}</p>
                <p className="text-white/70 text-sm">Équipements</p>
              </div>
            </div>
          )}
        </div>
      )
    },

    // Slide 2: Controls Status
    {
      id: 'controls',
      gradient: 'from-emerald-600 via-teal-600 to-cyan-500',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <CheckCircle size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Contrôles</h2>
              <p className="text-white/70">État des vérifications</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatBubble
              icon={AlertTriangle}
              value={briefData?.stats?.controls?.overdue || 0}
              label="En retard"
              onClick={() => navigateTo('/app/switchboard-controls?tab=overdue')}
              delay={100}
            />
            <StatBubble
              icon={Clock}
              value={briefData?.stats?.controls?.thisWeek || 0}
              label="Cette semaine"
              onClick={() => navigateTo('/app/switchboard-controls?tab=schedules')}
              delay={200}
            />
            <StatBubble
              icon={CheckCircle}
              value={briefData?.stats?.controls?.completedThisWeek || 0}
              label="Complétés"
              onClick={() => navigateTo('/app/switchboard-controls')}
              delay={300}
            />
            <StatBubble
              icon={Target}
              value={briefData?.stats?.controls?.total || 0}
              label="Total"
              onClick={() => navigateTo('/app/switchboard-controls')}
              delay={400}
            />
          </div>

          {(briefData?.stats?.controls?.overdue || 0) > 0 && (
            <div className="bg-red-500/30 backdrop-blur-sm border border-red-400/50 rounded-xl p-4 animate-pulse-slow">
              <div className="flex items-center gap-3">
                <AlertTriangle size={24} className="text-red-200" />
                <div>
                  <p className="text-white font-semibold">Attention</p>
                  <p className="text-white/80 text-sm">
                    {briefData.stats.controls.overdue} contrôle(s) en retard nécessitent votre attention
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )
    },

    // Slide 3: Procedures
    {
      id: 'procedures',
      gradient: 'from-violet-600 via-purple-600 to-indigo-600',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <FileText size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Procédures</h2>
              <p className="text-white/70">Méthodes opérationnelles</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatBubble
              icon={FileText}
              value={proceduresStats?.draft || 0}
              label="Brouillons"
              onClick={() => navigateTo('/app/procedures?status=draft')}
              delay={100}
            />
            <StatBubble
              icon={Clock}
              value={proceduresStats?.review || 0}
              label="En révision"
              onClick={() => navigateTo('/app/procedures?status=review')}
              delay={200}
            />
            <StatBubble
              icon={CheckCircle}
              value={proceduresStats?.approved || 0}
              label="Approuvées"
              onClick={() => navigateTo('/app/procedures?status=approved')}
              delay={300}
            />
            <StatBubble
              icon={AlertTriangle}
              value={proceduresStats?.highRisk || 0}
              label="Haut risque"
              onClick={() => navigateTo('/app/procedures')}
              delay={400}
            />
          </div>

          {(proceduresStats?.pendingAttention || 0) > 0 && (
            <div className="bg-purple-500/30 backdrop-blur-sm border border-purple-400/50 rounded-xl p-4 animate-pulse-slow">
              <div className="flex items-center gap-3">
                <FileText size={24} className="text-purple-200" />
                <div>
                  <p className="text-white font-semibold">Procédures à traiter</p>
                  <p className="text-white/80 text-sm">
                    {proceduresStats.pendingAttention} procédure(s) en attente de finalisation
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )
    },

    // Slide 4: Fire Doors
    {
      id: 'doors',
      gradient: 'from-rose-500 via-pink-500 to-red-500',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <DoorOpen size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Portes Coupe-Feu</h2>
              <p className="text-white/70">État des contrôles</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatBubble
              icon={CheckCircle}
              value={doorsStats?.aFaire || 0}
              label="À faire"
              onClick={() => navigateTo('/app/doors?status=a_faire')}
              delay={100}
            />
            <StatBubble
              icon={Clock}
              value={doorsStats?.enCours || 0}
              label="Sous 30 jours"
              onClick={() => navigateTo('/app/doors?status=en_cours_30')}
              delay={200}
            />
            <StatBubble
              icon={AlertTriangle}
              value={doorsStats?.enRetard || 0}
              label="En retard"
              onClick={() => navigateTo('/app/doors?status=en_retard')}
              delay={300}
            />
            <StatBubble
              icon={Shield}
              value={doorsStats?.nonConforme || 0}
              label="Non conformes"
              onClick={() => navigateTo('/app/doors?door_state=non_conforme')}
              delay={400}
            />
          </div>

          {(doorsStats?.enRetard || 0) > 0 && (
            <div className="bg-red-500/30 backdrop-blur-sm border border-red-400/50 rounded-xl p-4 animate-pulse-slow">
              <div className="flex items-center gap-3">
                <AlertTriangle size={24} className="text-red-200" />
                <div>
                  <p className="text-white font-semibold">Contrôles urgents</p>
                  <p className="text-white/80 text-sm">
                    {doorsStats.enRetard} porte(s) avec contrôle en retard
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-auto bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <div className="flex items-center justify-between">
              <span className="text-white/70">Total portes</span>
              <span className="text-2xl font-bold text-white">
                <AnimatedNumber value={doorsStats?.total || 0} />
              </span>
            </div>
          </div>
        </div>
      )
    },

    // Slide 5: Equipment Types
    {
      id: 'equipment',
      gradient: 'from-amber-500 via-orange-500 to-red-500',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Zap size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Équipements</h2>
              <p className="text-white/70">Par type</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatBubble
              icon={Zap}
              value={briefData?.stats?.byType?.switchboards || 0}
              label="Tableaux"
              onClick={() => navigateTo('/app/switchboards')}
              delay={100}
            />
            <StatBubble
              icon={Cog}
              value={briefData?.stats?.byType?.vsd || 0}
              label="VSD"
              onClick={() => navigateTo('/app/vsd')}
              delay={150}
            />
            <StatBubble
              icon={Wrench}
              value={briefData?.stats?.byType?.meca || 0}
              label="Méca"
              onClick={() => navigateTo('/app/meca')}
              delay={200}
            />
            <StatBubble
              icon={Flame}
              value={briefData?.stats?.byType?.atex || 0}
              label="ATEX"
              onClick={() => navigateTo('/app/atex')}
              delay={250}
            />
            <StatBubble
              icon={Battery}
              value={briefData?.stats?.byType?.glo || 0}
              label="GLO"
              onClick={() => navigateTo('/app/glo')}
              delay={300}
            />
            <StatBubble
              icon={Zap}
              value={briefData?.stats?.byType?.hv || 0}
              label="HV"
              onClick={() => navigateTo('/app/hv')}
              delay={350}
            />
          </div>

          <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <div className="flex items-center justify-between">
              <span className="text-white/70">Total équipements</span>
              <span className="text-2xl font-bold text-white">
                <AnimatedNumber value={briefData?.stats?.totalEquipment || 0} />
              </span>
            </div>
          </div>
        </div>
      )
    },

    // Slide 4: DataHub Categories
    {
      id: 'datahub',
      gradient: 'from-violet-600 via-purple-600 to-fuchsia-500',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Database size={24} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-white">DataHub</h2>
              <p className="text-white/70">Vos catégories personnalisées</p>
            </div>
            <button
              onClick={() => navigateTo('/app/datahub')}
              className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
            >
              <ExternalLink size={18} className="text-white" />
            </button>
          </div>

          {datahubCategories.length > 0 ? (
            <div className="space-y-2 overflow-y-auto flex-1 pr-1">
              {datahubCategories.slice(0, 6).map((cat, i) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  onClick={() => navigateTo(`/app/datahub?category=${cat.id}`)}
                  delay={i * 100}
                />
              ))}
              {datahubCategories.length > 6 && (
                <button
                  onClick={() => navigateTo('/app/datahub')}
                  className="w-full p-3 bg-white/10 rounded-xl text-white/80 text-sm hover:bg-white/20 transition-colors"
                >
                  Voir les {datahubCategories.length - 6} autres catégories...
                </button>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <Database size={48} className="text-white/40 mb-4" />
              <p className="text-white/60 mb-4">Aucune catégorie créée</p>
              <button
                onClick={() => navigateTo('/app/datahub')}
                className="px-4 py-2 bg-white/20 rounded-lg text-white hover:bg-white/30 transition-colors"
              >
                Créer ma première catégorie
              </button>
            </div>
          )}

          {datahubStats && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/20">
                <p className="text-2xl font-bold text-white">{datahubStats.total_items || 0}</p>
                <p className="text-white/70 text-xs">Éléments</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center border border-white/20">
                <p className="text-2xl font-bold text-white">{datahubStats.total_categories || datahubCategories.length}</p>
                <p className="text-white/70 text-xs">Catégories</p>
              </div>
            </div>
          )}
        </div>
      )
    },

    // Slide 5: Buildings & Sites
    {
      id: 'buildings',
      gradient: 'from-slate-700 via-slate-800 to-slate-900',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Building2 size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Infrastructure</h2>
              <p className="text-white/70">Vue d'ensemble du site</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatBubble
              icon={Building2}
              value={briefData?.stats?.buildings || 0}
              label="Bâtiments"
              delay={100}
            />
            <StatBubble
              icon={MapPin}
              value={briefData?.stats?.floors || 0}
              label="Étages"
              delay={200}
            />
            <StatBubble
              icon={DoorOpen}
              value={briefData?.stats?.rooms || 0}
              label="Locaux"
              delay={300}
            />
            <StatBubble
              icon={Zap}
              value={briefData?.stats?.devices || 0}
              label="Appareils"
              delay={400}
            />
          </div>

          <div className="mt-auto bg-gradient-to-r from-blue-500/30 to-purple-500/30 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <div className="flex items-center gap-3">
              <Globe size={20} className="text-white/80" />
              <p className="text-white/80 text-sm">
                Couverture complète de votre infrastructure électrique
              </p>
            </div>
          </div>
        </div>
      )
    },

    // Slide 6: All Apps Overview
    {
      id: 'apps',
      gradient: 'from-blue-600 via-indigo-600 to-violet-600',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Folder size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Vos Applications</h2>
              <p className="text-white/70">Accès rapide</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 pr-1">
            {[
              { label: 'Tableaux', to: '/app/switchboards', color: 'from-amber-400 to-orange-500' },
              { label: 'VSD', to: '/app/vsd', color: 'from-slate-400 to-gray-500' },
              { label: 'Méca', to: '/app/meca', color: 'from-zinc-400 to-stone-500' },
              { label: 'ATEX', to: '/app/atex', color: 'from-orange-400 to-red-500' },
              { label: 'Haute Tension', to: '/app/hv', color: 'from-yellow-400 to-amber-500' },
              { label: 'GLO', to: '/app/glo', color: 'from-emerald-400 to-teal-500' },
              { label: 'Mobile', to: '/app/mobile-equipments', color: 'from-cyan-400 to-blue-500' },
              { label: 'DataHub', to: '/app/datahub', color: 'from-indigo-400 to-purple-500' },
              { label: 'Portes Feu', to: '/app/doors', color: 'from-rose-400 to-pink-500' },
              { label: 'Projets', to: '/app/projects', color: 'from-green-400 to-emerald-500' },
              { label: 'Obsolescence', to: '/app/obsolescence', color: 'from-emerald-400 to-teal-500' },
              { label: 'Arc Flash', to: '/app/arc-flash', color: 'from-red-400 to-rose-500' },
              { label: 'Sélectivité', to: '/app/selectivity', color: 'from-purple-400 to-indigo-500' },
              { label: 'Ask Veeva', to: '/app/ask-veeva', color: 'from-violet-400 to-purple-500' },
              { label: 'Contrôles', to: '/app/switchboard-controls', color: 'from-blue-400 to-cyan-500' },
              { label: 'DCF', to: '/app/dcf', color: 'from-emerald-400 to-green-500' },
            ].map((app, i) => (
              <AppPreview
                key={app.to}
                app={app}
                onClick={() => navigateTo(app.to)}
                delay={i * 50}
              />
            ))}
          </div>
        </div>
      )
    },

    // Slide 7: AI Insights
    {
      id: 'insights',
      gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
      content: (
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center animate-pulse-slow">
              <Sparkles size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Conseils IA</h2>
              <p className="text-white/70">Recommandations du jour</p>
            </div>
          </div>

          {briefData?.aiInsight && (
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20 mb-4 animate-fadeInUp">
              <p className="text-white text-lg leading-relaxed">{briefData.aiInsight}</p>
            </div>
          )}

          <div className="space-y-3 flex-1">
            {briefData?.suggestions?.slice(0, 3).map((suggestion, i) => (
              <button
                key={i}
                onClick={() => suggestion.action?.path && navigateTo(suggestion.action.path)}
                className="w-full p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20 text-left hover:bg-white/20 transition-all animate-fadeInUp"
                style={{ animationDelay: `${(i + 1) * 100}ms` }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{suggestion.icon || '💡'}</span>
                  <div className="flex-1">
                    <h4 className="text-white font-semibold">{suggestion.title}</h4>
                    <p className="text-white/70 text-sm">{suggestion.message}</p>
                  </div>
                  <ChevronRight size={18} className="text-white/50 mt-1" />
                </div>
              </button>
            )) || (
              <div className="flex-1 flex flex-col items-center justify-center text-white/60">
                <Star size={32} className="mb-2" />
                <p>Tout semble en ordre !</p>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full py-3 bg-white/20 backdrop-blur-sm rounded-xl text-white font-semibold hover:bg-white/30 transition-colors border border-white/20"
          >
            Commencer ma journée
          </button>
        </div>
      )
    }
  ];

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center safe-area-top">
        <div className="text-center text-white">
          <RefreshCw size={32} className="animate-spin mx-auto mb-4" />
          <p className="text-lg">Préparation du brief...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* CSS Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-fadeInUp { animation: fadeInUp 0.5s ease-out forwards; }
        .animate-bounce-slow { animation: bounce-slow 3s ease-in-out infinite; }
        .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
      `}</style>

      {/* Story Container */}
      <div
        ref={containerRef}
        className="relative h-full w-full max-w-lg mx-auto"
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Slides */}
        {slides.map((slide, index) => (
          <StorySlide
            key={slide.id}
            gradient={slide.gradient}
            isActive={currentSlide === index}
          >
            {/* Progress Bar */}
            <StoryProgress current={currentSlide} total={slides.length} progress={progress} />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Zap size={16} className="text-white" />
                </div>
                <span className="text-white font-medium text-sm">ElectroHub</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setIsPaused(!isPaused); }}
                  className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                >
                  {isPaused ? <Play size={16} className="text-white" /> : <Pause size={16} className="text-white" />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onClose?.(); }}
                  className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X size={16} className="text-white" />
                </button>
              </div>
            </div>

            {/* Content */}
            {slide.content}

            {/* Navigation hints */}
            <div className="absolute top-1/2 left-2 transform -translate-y-1/2 opacity-30">
              <ChevronLeft size={24} className="text-white" />
            </div>
            <div className="absolute top-1/2 right-2 transform -translate-y-1/2 opacity-30">
              <ChevronRight size={24} className="text-white" />
            </div>
          </StorySlide>
        ))}

        {/* Slide indicators (dots) */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goToSlide(i); }}
              className={`w-2 h-2 rounded-full transition-all ${
                currentSlide === i ? 'bg-white w-4' : 'bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
