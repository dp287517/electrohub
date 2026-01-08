import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench, AlertTriangle, CheckCircle, Clock, TrendingUp, Plus, Minus,
  Zap, Cog, Battery, Shield, Flame, Activity, RefreshCw, Users,
  ChevronRight, ChevronDown, Sparkles, Building2, Calendar, Target,
  MessageCircle, Play, Pause, Volume2, VolumeX, ArrowRight, Package,
  ClipboardList, AlertCircle, FileText, Trash2, UserCircle, Bot,
  Timer, ThumbsUp, ThumbsDown, Bell, ExternalLink, Settings
} from 'lucide-react';
import { aiAssistant } from '../lib/ai-assistant';

// Animated AI Avatar - Personnage animé avec idle/speaking states
const AnimatedAvatar = ({ agent, isActive, isSpeaking, onClick }) => {
  const [blinkState, setBlinkState] = useState(false);

  // Blinking animation
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 150);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(blinkInterval);
  }, []);

  const avatarConfig = {
    maintenance: {
      color: '#f59e0b',
      bgGradient: 'from-amber-500 to-orange-600',
      skinTone: '#e0ac69',
      hairColor: '#4a3728',
      shirtColor: '#f59e0b',
      name: 'Alex',
      role: 'Maintenance'
    },
    troubleshooting: {
      color: '#ef4444',
      bgGradient: 'from-red-500 to-rose-600',
      skinTone: '#c68642',
      hairColor: '#1a1a1a',
      shirtColor: '#ef4444',
      name: 'Sam',
      role: 'Dépannages'
    },
    equipment: {
      color: '#3b82f6',
      bgGradient: 'from-blue-500 to-indigo-600',
      skinTone: '#ffd5c8',
      hairColor: '#8b4513',
      shirtColor: '#3b82f6',
      name: 'Jordan',
      role: 'Équipements'
    },
    security: {
      color: '#10b981',
      bgGradient: 'from-emerald-500 to-green-600',
      skinTone: '#d4a574',
      hairColor: '#2d1b0e',
      shirtColor: '#10b981',
      name: 'Morgan',
      role: 'Sécurité'
    },
    procedures: {
      color: '#8b5cf6',
      bgGradient: 'from-violet-500 to-purple-600',
      skinTone: '#e8beac',
      hairColor: '#4a0e0e',
      shirtColor: '#8b5cf6',
      name: 'Taylor',
      role: 'Procédures'
    }
  };

  const config = avatarConfig[agent.type] || avatarConfig.equipment;

  return (
    <motion.button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${
        isActive ? 'bg-white/15 scale-105' : 'hover:bg-white/5'
      }`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Video-like frame with avatar */}
      <div className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shadow-2xl ${
        isActive ? 'ring-4 ring-white/50' : ''
      }`}>
        {/* Background gradient */}
        <div className={`absolute inset-0 bg-gradient-to-br ${config.bgGradient}`} />

        {/* Animated character SVG */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
          {/* Body/Shoulders */}
          <motion.ellipse
            cx="50"
            cy="95"
            rx="35"
            ry="20"
            fill={config.shirtColor}
            animate={isSpeaking ? {
              cy: [95, 93, 95],
            } : {
              cy: [95, 94, 95]
            }}
            transition={{
              duration: isSpeaking ? 0.3 : 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />

          {/* Neck */}
          <rect x="43" y="65" width="14" height="12" fill={config.skinTone} rx="2" />

          {/* Head */}
          <motion.ellipse
            cx="50"
            cy="45"
            rx="22"
            ry="26"
            fill={config.skinTone}
            animate={isSpeaking ? {
              cy: [45, 43, 45, 44, 45],
              scale: [1, 1.02, 1, 1.01, 1]
            } : {
              cy: [45, 44.5, 45]
            }}
            transition={{
              duration: isSpeaking ? 0.5 : 4,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />

          {/* Hair */}
          <motion.path
            d={`M28 40 Q30 15, 50 12 Q70 15, 72 40 Q70 30, 50 28 Q30 30, 28 40`}
            fill={config.hairColor}
            animate={isSpeaking ? { d: [
              "M28 40 Q30 15, 50 12 Q70 15, 72 40 Q70 30, 50 28 Q30 30, 28 40",
              "M28 39 Q30 14, 50 11 Q70 14, 72 39 Q70 29, 50 27 Q30 29, 28 39",
              "M28 40 Q30 15, 50 12 Q70 15, 72 40 Q70 30, 50 28 Q30 30, 28 40"
            ]} : {}}
            transition={{ duration: 0.5, repeat: Infinity }}
          />

          {/* Eyes */}
          <motion.g
            animate={blinkState ? { scaleY: 0.1 } : { scaleY: 1 }}
            style={{ originY: '50%' }}
          >
            {/* Left eye */}
            <ellipse cx="40" cy="42" rx="4" ry="5" fill="white" />
            <motion.circle
              cx="40"
              cy="43"
              r="2.5"
              fill="#1a1a1a"
              animate={isActive ? { cx: [40, 41, 40, 39, 40] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <circle cx="41" cy="42" r="1" fill="white" />

            {/* Right eye */}
            <ellipse cx="60" cy="42" rx="4" ry="5" fill="white" />
            <motion.circle
              cx="60"
              cy="43"
              r="2.5"
              fill="#1a1a1a"
              animate={isActive ? { cx: [60, 61, 60, 59, 60] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <circle cx="61" cy="42" r="1" fill="white" />
          </motion.g>

          {/* Eyebrows */}
          <motion.path
            d="M35 36 Q40 34, 45 36"
            stroke={config.hairColor}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            animate={isSpeaking ? { d: [
              "M35 36 Q40 34, 45 36",
              "M35 34 Q40 32, 45 34",
              "M35 36 Q40 34, 45 36"
            ]} : {}}
            transition={{ duration: 0.4, repeat: Infinity }}
          />
          <motion.path
            d="M55 36 Q60 34, 65 36"
            stroke={config.hairColor}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            animate={isSpeaking ? { d: [
              "M55 36 Q60 34, 65 36",
              "M55 34 Q60 32, 65 34",
              "M55 36 Q60 34, 65 36"
            ]} : {}}
            transition={{ duration: 0.4, repeat: Infinity }}
          />

          {/* Nose */}
          <path d="M48 48 Q50 52, 52 48" stroke={config.skinTone} strokeWidth="2" fill="none" filter="brightness(0.9)" />

          {/* Mouth - animated when speaking */}
          <motion.ellipse
            cx="50"
            cy="58"
            rx={isSpeaking ? "6" : "4"}
            ry={isSpeaking ? "4" : "2"}
            fill={isSpeaking ? "#c44" : "#b55"}
            animate={isSpeaking ? {
              ry: [2, 5, 3, 6, 2, 4, 2],
              rx: [4, 7, 5, 8, 4, 6, 4]
            } : {
              ry: [2, 2.2, 2]
            }}
            transition={{
              duration: isSpeaking ? 0.4 : 2,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />

          {/* Smile line when not speaking */}
          {!isSpeaking && (
            <path
              d="M44 58 Q50 62, 56 58"
              stroke="#a44"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Speaking indicator waves */}
        {isSpeaking && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
            {[0, 1, 2, 3, 4].map(i => (
              <motion.div
                key={i}
                className="w-1 bg-white rounded-full"
                animate={{ height: [4, 12, 4] }}
                transition={{
                  duration: 0.4,
                  repeat: Infinity,
                  delay: i * 0.1,
                  ease: "easeInOut"
                }}
              />
            ))}
          </div>
        )}

        {/* Active indicator glow */}
        {isActive && (
          <motion.div
            className="absolute inset-0 bg-white/20"
            animate={{ opacity: [0.1, 0.3, 0.1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        {/* Live badge when speaking */}
        {isSpeaking && (
          <div className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] font-bold text-white">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}
      </div>

      {/* Alert badge */}
      {agent.alertCount > 0 && (
        <motion.span
          className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {agent.alertCount > 9 ? '9+' : agent.alertCount}
        </motion.span>
      )}

      {/* Name tag */}
      <div className="text-center">
        <p className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-200'}`}>
          {config.name}
        </p>
        <p className="text-xs text-slate-400">{config.role}</p>
      </div>
    </motion.button>
  );
};

// Speech Bubble - Ce que dit l'agent
const SpeechBubble = ({ agent, items, onItemClick, onClose }) => {
  const bubbleStyles = {
    maintenance: { accent: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-700' },
    troubleshooting: { accent: 'border-red-500', bg: 'bg-red-50', text: 'text-red-900', badge: 'bg-red-100 text-red-700' },
    equipment: { accent: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-900', badge: 'bg-blue-100 text-blue-700' },
    security: { accent: 'border-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-700' },
    procedures: { accent: 'border-violet-500', bg: 'bg-violet-50', text: 'text-violet-900', badge: 'bg-violet-100 text-violet-700' },
    ai: { accent: 'border-cyan-500', bg: 'bg-cyan-50', text: 'text-cyan-900', badge: 'bg-cyan-100 text-cyan-700' }
  };

  const agentNames = {
    maintenance: 'Alex - Maintenance',
    troubleshooting: 'Sam - Dépannages',
    equipment: 'Jordan - Équipements',
    security: 'Morgan - Sécurité',
    procedures: 'Taylor - Procédures'
  };

  const style = bubbleStyles[agent.type] || bubbleStyles.ai;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={`bg-white rounded-2xl shadow-xl border-l-4 ${style.accent} overflow-hidden`}
    >
      {/* Header */}
      <div className={`${style.bg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className={`font-semibold ${style.text}`}>{agentNames[agent.type] || agent.name}</span>
          <span className="text-xs text-slate-500">parle...</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-black/5 rounded-lg transition-colors"
        >
          <ChevronDown size={16} className="text-slate-500" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={24} className="text-emerald-500" />
            </div>
            <p className="text-slate-600 font-medium">Rien à signaler !</p>
            <p className="text-slate-400 text-sm">Tout est en ordre de mon côté.</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <motion.button
              key={item.id || idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              onClick={() => onItemClick?.(item)}
              className={`w-full text-left p-3 rounded-xl ${style.bg} hover:shadow-md transition-all group`}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-medium text-sm ${style.text}`}>{item.title}</h4>
                  <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{item.description}</p>
                  {item.time && (
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <Clock size={10} />
                      {item.time}
                    </p>
                  )}
                </div>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0 mt-1" />
              </div>
            </motion.button>
          ))
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && agent.actionUrl && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
          <button
            onClick={() => onItemClick?.({ url: agent.actionUrl })}
            className={`w-full text-center text-sm font-medium ${style.text} hover:underline flex items-center justify-center gap-1`}
          >
            Voir tout
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </motion.div>
  );
};

// Activity Feed Item
const ActivityItem = ({ activity, onClick }) => {
  const colorMap = {
    green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    violet: 'bg-violet-100 text-violet-700 border-violet-200'
  };

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full flex items-center gap-3 p-3 bg-white/80 backdrop-blur rounded-xl hover:bg-white hover:shadow-md transition-all text-left"
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
        colorMap[activity.color] || colorMap.blue
      }`}>
        {activity.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{activity.title}</p>
        <p className="text-xs text-slate-500 truncate">{activity.description}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-slate-400">{activity.timeAgo}</p>
        <p className="text-xs text-slate-300">{activity.actor}</p>
      </div>
    </motion.button>
  );
};

// Quick Stat Card
const QuickStat = ({ icon: Icon, value, label, trend, color = 'blue', onClick }) => {
  const colors = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
    violet: 'from-violet-500 to-violet-600'
  };

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all text-left relative overflow-hidden"
    >
      <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${colors[color]} opacity-10 rounded-bl-full`} />
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center shadow-lg`}>
          <Icon size={20} className="text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-slate-900">{value}</span>
            {trend !== undefined && trend !== 0 && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                trend > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {trend > 0 ? '+' : ''}{trend}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </motion.button>
  );
};

// Main BriefingBoard Component
export default function BriefingBoard({ userName, userEmail, onClose }) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [activeAgent, setActiveAgent] = useState(null);
  const [briefingData, setBriefingData] = useState(null);
  const [activities, setActivities] = useState([]);
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load all briefing data
  useEffect(() => {
    loadBriefingData();
  }, []);

  // Auto-play through agents
  useEffect(() => {
    if (!isAutoPlay || !briefingData?.agents) return;

    const agentKeys = Object.keys(briefingData.agents);
    let currentIndex = agentKeys.indexOf(activeAgent);

    const timer = setInterval(() => {
      currentIndex = (currentIndex + 1) % agentKeys.length;
      setActiveAgent(agentKeys[currentIndex]);
    }, 5000);

    return () => clearInterval(timer);
  }, [isAutoPlay, briefingData, activeAgent]);

  const loadBriefingData = async () => {
    setIsLoading(true);
    try {
      // Fetch all data in parallel using fetch directly
      const [morningBrief, activitiesRes, troubleshootingRes] = await Promise.all([
        aiAssistant.getMorningBrief().catch(e => null),
        fetch('/api/dashboard/activities?limit=20').then(r => r.json()).catch(e => ({ recent: [] })),
        fetch('/api/troubleshooting/list?limit=10').then(r => r.json()).catch(e => ({ records: [] }))
      ]);

      // Process activities for timeline
      const recentActivities = (activitiesRes?.recent || []).map(a => ({
        ...a,
        timeAgo: getTimeAgo(a.timestamp)
      }));

      // Build agents data
      const agents = buildAgentsData(morningBrief, troubleshootingRes?.records || [], recentActivities);

      setBriefingData({
        brief: morningBrief,
        agents,
        stats: {
          healthScore: morningBrief?.healthScore || 85,
          totalEquipment: morningBrief?.stats?.totalEquipment || 0,
          overdueControls: morningBrief?.stats?.controls?.overdue || 0,
          completedToday: morningBrief?.stats?.controls?.completedThisWeek || 0,
          troubleshootingToday: troubleshootingRes?.records?.filter(r =>
            new Date(r.created_at).toDateString() === new Date().toDateString()
          ).length || 0
        }
      });
      setActivities(recentActivities.slice(0, 10));

      // Start with first agent that has alerts
      const firstAlertAgent = Object.entries(agents).find(([, a]) => a.alertCount > 0);
      if (firstAlertAgent) {
        setActiveAgent(firstAlertAgent[0]);
      }
    } catch (err) {
      console.error('Failed to load briefing data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Build agents data structure
  const buildAgentsData = (brief, troubleshooting, activities) => {
    const now = new Date();

    // Maintenance Agent
    const overdueControls = brief?.stats?.controls?.overdue || 0;
    const thisWeekControls = brief?.stats?.controls?.thisWeek || 0;
    const maintenanceItems = [];

    if (overdueControls > 0) {
      maintenanceItems.push({
        id: 'overdue',
        icon: '🚨',
        title: `${overdueControls} contrôle${overdueControls > 1 ? 's' : ''} en retard`,
        description: 'Ces contrôles doivent être effectués en priorité',
        url: '/app/switchboard-controls?filter=overdue'
      });
    }
    if (thisWeekControls > 0) {
      maintenanceItems.push({
        id: 'thisweek',
        icon: '📅',
        title: `${thisWeekControls} contrôle${thisWeekControls > 1 ? 's' : ''} cette semaine`,
        description: 'Planifiés pour les 7 prochains jours',
        url: '/app/switchboard-controls?filter=thisweek'
      });
    }

    // Troubleshooting Agent
    const recentTroubleshooting = troubleshooting.slice(0, 5).map(t => ({
      id: t.id,
      icon: t.severity === 'critical' ? '🔴' : t.severity === 'major' ? '🟠' : '🟡',
      title: t.title,
      description: `${t.equipment_name || 'Équipement'} - ${t.technician_name}`,
      time: getTimeAgo(t.created_at),
      url: `/app/troubleshooting/${t.id}`
    }));

    // Equipment Agent - from activities
    const equipmentActivities = activities
      .filter(a => ['switchboard', 'mobile-equipment', 'datahub'].includes(a.module))
      .slice(0, 5)
      .map(a => ({
        id: a.id,
        icon: a.type === 'created' ? '✅' : a.type === 'deleted' ? '❌' : '📝',
        title: a.title,
        description: a.description,
        time: a.timeAgo,
        url: a.url
      }));

    // Security Agent
    const ncCount = brief?.stats?.nonConformities?.pending || 0;
    const securityItems = [];
    if (ncCount > 0) {
      securityItems.push({
        id: 'nc',
        icon: '⚠️',
        title: `${ncCount} non-conformité${ncCount > 1 ? 's' : ''} en attente`,
        description: 'Nécessitent une action corrective',
        url: '/app/atex?filter=nc'
      });
    }
    // Add ATEX-related activities
    activities
      .filter(a => a.module === 'atex' || a.type?.includes('nc'))
      .slice(0, 3)
      .forEach(a => {
        securityItems.push({
          id: a.id,
          icon: '🛡️',
          title: a.title,
          description: a.description,
          time: a.timeAgo,
          url: a.url
        });
      });

    // Procedures Agent
    const procedureActivities = activities
      .filter(a => a.module === 'procedures')
      .slice(0, 5)
      .map(a => ({
        id: a.id,
        icon: a.type === 'created' ? '📄' : a.type === 'signed' ? '✍️' : '📋',
        title: a.title,
        description: a.description,
        time: a.timeAgo,
        url: a.url
      }));

    return {
      maintenance: {
        type: 'maintenance',
        name: 'Maintenance',
        alertCount: overdueControls,
        items: maintenanceItems,
        actionUrl: '/app/switchboard-controls'
      },
      troubleshooting: {
        type: 'troubleshooting',
        name: 'Dépannages',
        alertCount: troubleshooting.filter(t =>
          new Date(t.created_at) > new Date(now - 24 * 60 * 60 * 1000)
        ).length,
        items: recentTroubleshooting,
        actionUrl: '/app/troubleshooting'
      },
      equipment: {
        type: 'equipment',
        name: 'Équipements',
        alertCount: equipmentActivities.filter(e => e.icon === '✅' || e.icon === '❌').length,
        items: equipmentActivities,
        actionUrl: '/app/switchboards'
      },
      security: {
        type: 'security',
        name: 'Sécurité',
        alertCount: ncCount,
        items: securityItems,
        actionUrl: '/app/atex'
      },
      procedures: {
        type: 'procedures',
        name: 'Procédures',
        alertCount: procedureActivities.length,
        items: procedureActivities,
        actionUrl: '/app/procedures'
      }
    };
  };

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "À l'instant";
    if (minutes < 60) return `Il y a ${minutes}min`;
    if (hours < 24) return `Il y a ${hours}h`;
    if (days === 1) return 'Hier';
    if (days < 7) return `Il y a ${days}j`;
    return new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const handleItemClick = (item) => {
    if (item?.url) {
      navigate(item.url);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[500px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <RefreshCw size={40} className="text-blue-400" />
            </motion.div>
          </div>
          <p className="text-slate-400 text-lg">Connexion aux agents...</p>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map(i => (
              <motion.div
                key={i}
                className="w-3 h-3 bg-blue-500 rounded-full"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header - Meeting Room Style */}
      <div className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Users size={24} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white truncate flex items-center gap-2">
                Briefing Équipe
                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 rounded text-xs text-red-400 font-medium">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  EN DIRECT
                </span>
              </h2>
              <p className="text-slate-400 text-sm flex items-center gap-2">
                <Calendar size={12} />
                <span>{currentTime.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                <span>•</span>
                <Clock size={12} />
                <span>{currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Auto-play toggle */}
            <button
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className={`p-2 rounded-lg transition-all ${
                isAutoPlay
                  ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/30'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
              title={isAutoPlay ? 'Arrêter le défilement auto' : 'Défilement automatique'}
            >
              {isAutoPlay ? <Pause size={18} /> : <Play size={18} />}
            </button>

            {/* Refresh */}
            <button
              onClick={loadBriefingData}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
              title="Actualiser"
            >
              <RefreshCw size={18} />
            </button>

            {/* Close */}
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
              >
                <ChevronDown size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="px-4 sm:px-6 py-4 bg-black/20 border-b border-white/5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickStat
            icon={Activity}
            value={briefingData?.stats?.healthScore || 0}
            label="Score santé"
            color={briefingData?.stats?.healthScore >= 80 ? 'green' : briefingData?.stats?.healthScore >= 60 ? 'amber' : 'red'}
            onClick={() => navigate('/app/switchboard-controls')}
          />
          <QuickStat
            icon={AlertTriangle}
            value={briefingData?.stats?.overdueControls || 0}
            label="En retard"
            color="red"
            onClick={() => navigate('/app/switchboard-controls?filter=overdue')}
          />
          <QuickStat
            icon={Wrench}
            value={briefingData?.stats?.troubleshootingToday || 0}
            label="Dépannages (24h)"
            color="amber"
            onClick={() => navigate('/app/troubleshooting')}
          />
          <QuickStat
            icon={CheckCircle}
            value={briefingData?.stats?.completedToday || 0}
            label="Complétés"
            color="green"
            onClick={() => navigate('/app/switchboard-controls')}
          />
        </div>
      </div>

      {/* Main Content - Video Conference Layout */}
      <div className="p-4 sm:p-6">
        {/* Agents Row - "Participants" with video avatars */}
        <div className="flex justify-center gap-3 sm:gap-6 mb-6 overflow-x-auto pb-2">
          {briefingData?.agents && Object.entries(briefingData.agents).map(([key, agent]) => (
            <AnimatedAvatar
              key={key}
              agent={agent}
              isActive={activeAgent === key}
              isSpeaking={activeAgent === key}
              onClick={() => setActiveAgent(activeAgent === key ? null : key)}
            />
          ))}
        </div>

        {/* Speech Bubble - What the active agent is saying */}
        <AnimatePresence mode="wait">
          {activeAgent && briefingData?.agents?.[activeAgent] && (
            <SpeechBubble
              key={activeAgent}
              agent={briefingData.agents[activeAgent]}
              items={briefingData.agents[activeAgent].items}
              onItemClick={handleItemClick}
              onClose={() => setActiveAgent(null)}
            />
          )}
        </AnimatePresence>

        {/* No agent selected - Show overview */}
        {!activeAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white/5 backdrop-blur rounded-2xl p-6 text-center"
          >
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={28} className="text-blue-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Bienvenue au briefing !</h3>
            <p className="text-slate-400 text-sm mb-4">
              Cliquez sur un agent pour voir ses infos, ou activez le défilement automatique.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {briefingData?.agents && Object.entries(briefingData.agents)
                .filter(([, a]) => a.alertCount > 0)
                .map(([key, agent]) => (
                  <button
                    key={key}
                    onClick={() => setActiveAgent(key)}
                    className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white transition-colors flex items-center gap-2"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    {agent.name}: {agent.alertCount} alerte{agent.alertCount > 1 ? 's' : ''}
                  </button>
                ))
              }
            </div>
          </motion.div>
        )}
      </div>

      {/* Activity Timeline */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            Activité récente
          </h3>
          <button
            onClick={() => navigate('/app/activity')}
            className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
          >
            Voir tout
            <ExternalLink size={12} />
          </button>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {activities.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">
              Aucune activité récente
            </p>
          ) : (
            activities.map((activity, idx) => (
              <ActivityItem
                key={activity.id || idx}
                activity={activity}
                onClick={() => handleItemClick(activity)}
              />
            ))
          )}
        </div>
      </div>

      {/* AI Insight Footer */}
      {briefingData?.brief?.aiInsight && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-white" />
              </div>
              <div>
                <h4 className="text-cyan-400 text-sm font-semibold mb-1">Conseil de l'IA</h4>
                <p className="text-slate-300 text-sm leading-relaxed">{briefingData.brief.aiInsight}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
