import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Zap, Cog, Battery, Shield, Flame, Activity, RefreshCw, Users,
  ChevronRight, ChevronDown, Sparkles, Calendar,
  MessageCircle, Play, Pause, ArrowRight,
  ClipboardList, AlertCircle, Bot, Bell, ExternalLink
} from 'lucide-react';
import { aiAssistant } from '../lib/ai-assistant';
import { getUserPermissions } from '../lib/permissions';

// Mapping agent type to app permission
const AGENT_TO_APP_MAP = {
  main: null, // Always visible
  switchboard: 'switchboards',
  vsd: 'vsd',
  meca: 'meca',
  hv: 'hv',
  glo: 'glo',
  mobile: 'mobile-equipments',
  atex: 'atex',
  doors: 'doors',
  datahub: 'datahub',
  infrastructure: 'infrastructure',
  firecontrol: 'fire-control'
};

// Agent emoji mapping
const AGENT_EMOJIS = {
  main: '⚡',
  switchboard: '🔌',
  vsd: '🎛️',
  meca: '⚙️',
  hv: '⚡',
  glo: '💡',
  mobile: '📱',
  atex: '🔥',
  doors: '🚪',
  datahub: '📊',
  infrastructure: '🏗️',
  firecontrol: '🧯'
};

// Agent color schemes
const AGENT_COLORS = {
  main: { bg: 'from-blue-500 to-cyan-600', ring: 'ring-blue-400', text: 'text-blue-600', bgLight: 'bg-blue-50' },
  switchboard: { bg: 'from-amber-500 to-orange-600', ring: 'ring-amber-400', text: 'text-amber-600', bgLight: 'bg-amber-50' },
  vsd: { bg: 'from-purple-500 to-violet-600', ring: 'ring-purple-400', text: 'text-purple-600', bgLight: 'bg-purple-50' },
  meca: { bg: 'from-slate-500 to-gray-600', ring: 'ring-slate-400', text: 'text-slate-600', bgLight: 'bg-slate-50' },
  hv: { bg: 'from-yellow-500 to-amber-600', ring: 'ring-yellow-400', text: 'text-yellow-600', bgLight: 'bg-yellow-50' },
  glo: { bg: 'from-emerald-500 to-green-600', ring: 'ring-emerald-400', text: 'text-emerald-600', bgLight: 'bg-emerald-50' },
  mobile: { bg: 'from-cyan-500 to-blue-600', ring: 'ring-cyan-400', text: 'text-cyan-600', bgLight: 'bg-cyan-50' },
  atex: { bg: 'from-red-500 to-rose-600', ring: 'ring-red-400', text: 'text-red-600', bgLight: 'bg-red-50' },
  doors: { bg: 'from-pink-500 to-fuchsia-600', ring: 'ring-pink-400', text: 'text-pink-600', bgLight: 'bg-pink-50' },
  datahub: { bg: 'from-indigo-500 to-purple-600', ring: 'ring-indigo-400', text: 'text-indigo-600', bgLight: 'bg-indigo-50' },
  infrastructure: { bg: 'from-violet-500 to-purple-600', ring: 'ring-violet-400', text: 'text-violet-600', bgLight: 'bg-violet-50' },
  firecontrol: { bg: 'from-orange-500 to-red-600', ring: 'ring-orange-400', text: 'text-orange-600', bgLight: 'bg-orange-50' }
};

// Video Agent Avatar - Shows real video or animated fallback
const VideoAgentAvatar = ({ agent, isActive, isSpeaking, onClick, alertCount }) => {
  const [videoError, setVideoError] = useState(false);
  const colors = AGENT_COLORS[agent.type] || AGENT_COLORS.main;
  const emoji = AGENT_EMOJIS[agent.type] || '🤖';

  // Video URLs
  const idleVideoUrl = `/api/admin/settings/ai-agents/${agent.type}/idle`;
  const speakingVideoUrl = `/api/admin/settings/ai-agents/${agent.type}/speaking`;
  const hasVideo = agent.hasIdleVideo || agent.hasSpeakingVideo;

  return (
    <motion.button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${
        isActive ? 'bg-white/15 scale-105' : 'hover:bg-white/5'
      }`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Video frame */}
      <div className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shadow-2xl ${
        isActive ? `ring-4 ${colors.ring} ring-opacity-50` : ''
      }`}>
        {/* Background gradient */}
        <div className={`absolute inset-0 bg-gradient-to-br ${colors.bg}`} />

        {/* Video or fallback */}
        {hasVideo && !videoError ? (
          <video
            key={isSpeaking ? 'speaking' : 'idle'}
            src={isSpeaking && agent.hasSpeakingVideo ? speakingVideoUrl : idleVideoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            onError={() => setVideoError(true)}
          />
        ) : (
          // Animated emoji fallback
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.span
              className="text-4xl"
              animate={isSpeaking ? {
                scale: [1, 1.2, 1, 1.15, 1],
                rotate: [0, -5, 5, -3, 0]
              } : {
                scale: [1, 1.05, 1]
              }}
              transition={{
                duration: isSpeaking ? 0.5 : 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              {emoji}
            </motion.span>
          </div>
        )}

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

        {/* Active glow */}
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
      {alertCount > 0 && (
        <motion.span
          className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {alertCount > 9 ? '9+' : alertCount}
        </motion.span>
      )}

      {/* Name tag */}
      <div className="text-center">
        <p className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-200'}`}>
          {agent.customName || agent.name}
        </p>
        <p className="text-xs text-slate-400">{agent.role || agent.type}</p>
      </div>
    </motion.button>
  );
};

// Speech Bubble - What the agent is saying
const SpeechBubble = ({ agent, items, onItemClick, onClose }) => {
  const colors = AGENT_COLORS[agent.type] || AGENT_COLORS.main;
  const emoji = AGENT_EMOJIS[agent.type] || '🤖';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={`bg-white rounded-2xl shadow-xl border-l-4 border-l-${colors.text.replace('text-', '')} overflow-hidden`}
      style={{ borderLeftColor: colors.text.includes('blue') ? '#2563eb' : colors.text.includes('amber') ? '#d97706' : colors.text.includes('red') ? '#dc2626' : '#6366f1' }}
    >
      {/* Header */}
      <div className={`${colors.bgLight} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className={`font-semibold ${colors.text}`}>{agent.customName || agent.name}</span>
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
              className={`w-full text-left p-3 rounded-xl ${colors.bgLight} hover:shadow-md transition-all group`}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-medium text-sm ${colors.text}`}>{item.title}</h4>
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
            className={`w-full text-center text-sm font-medium ${colors.text} hover:underline flex items-center justify-center gap-1`}
          >
            Voir tout
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </motion.div>
  );
};

// Quick Stat Card
const QuickStat = ({ icon: Icon, value, label, color = 'blue', onClick }) => {
  const colors = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
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
          <span className="text-2xl font-bold text-slate-900">{value}</span>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </motion.button>
  );
};

// Activity Item
const ActivityItem = ({ activity, onClick }) => {
  const colorMap = {
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700'
  };

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full flex items-center gap-3 p-3 bg-white/80 backdrop-blur rounded-xl hover:bg-white hover:shadow-md transition-all text-left"
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${colorMap[activity.color] || colorMap.blue}`}>
        {activity.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{activity.title}</p>
        <p className="text-xs text-slate-500 truncate">{activity.description}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-slate-400">{activity.timeAgo}</p>
      </div>
    </motion.button>
  );
};

// Main BriefingBoard Component
export default function BriefingBoard({ userName, userEmail, onClose }) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [activeAgent, setActiveAgent] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agentData, setAgentData] = useState({});
  const [activities, setActivities] = useState([]);
  const [stats, setStats] = useState({});
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Get user permissions
  const userPermissions = useMemo(() => getUserPermissions(userEmail), [userEmail]);
  const userApps = userPermissions?.apps || [];
  const isAdmin = userPermissions?.isAdmin || false;

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load agents and data
  useEffect(() => {
    loadBriefingData();
  }, [userEmail]);

  // Auto-play through agents
  useEffect(() => {
    if (!isAutoPlay || agents.length === 0) return;

    let currentIndex = agents.findIndex(a => a.type === activeAgent);

    const timer = setInterval(() => {
      currentIndex = (currentIndex + 1) % agents.length;
      setActiveAgent(agents[currentIndex].type);
    }, 5000);

    return () => clearInterval(timer);
  }, [isAutoPlay, agents, activeAgent]);

  const loadBriefingData = async () => {
    setIsLoading(true);
    try {
      // Fetch all data in parallel
      const [agentListRes, agentNamesRes, morningBrief, activitiesRes, troubleshootingRes] = await Promise.all([
        fetch('/api/admin/settings/ai-agents/list').then(r => r.json()).catch(() => ({ agents: [] })),
        fetch('/api/admin/settings/ai-agents/names').then(r => r.json()).catch(() => ({ names: {} })),
        aiAssistant.getMorningBrief().catch(() => null),
        fetch('/api/dashboard/activities?limit=20').then(r => r.json()).catch(() => ({ recent: [] })),
        fetch('/api/troubleshooting/list?limit=10').then(r => r.json()).catch(() => ({ records: [] }))
      ]);

      // Filter agents based on user permissions
      const filteredAgents = (agentListRes.agents || []).filter(agent => {
        const requiredApp = AGENT_TO_APP_MAP[agent.type];
        if (!requiredApp) return true; // main agent always visible
        if (isAdmin) return true; // admin sees all
        return userApps.includes(requiredApp);
      }).map(agent => ({
        ...agent,
        customName: agentNamesRes.names?.[agent.type] || agent.name?.split(' ')[0],
        role: getRoleDescription(agent.type)
      }));

      setAgents(filteredAgents);

      // Build agent data (what each agent will "say")
      const data = buildAgentData(morningBrief, troubleshootingRes?.records || [], activitiesRes?.recent || []);
      setAgentData(data);

      // Set stats
      setStats({
        healthScore: morningBrief?.healthScore || 85,
        overdueControls: morningBrief?.stats?.controls?.overdue || 0,
        completedToday: morningBrief?.stats?.controls?.completedThisWeek || 0,
        troubleshootingToday: (troubleshootingRes?.records || []).filter(r =>
          new Date(r.created_at).toDateString() === new Date().toDateString()
        ).length
      });

      // Set activities
      setActivities((activitiesRes?.recent || []).slice(0, 10).map(a => ({
        ...a,
        timeAgo: getTimeAgo(a.timestamp)
      })));

      // Start with first agent that has alerts
      const firstAlertAgent = filteredAgents.find(a => (data[a.type]?.items?.length || 0) > 0);
      if (firstAlertAgent) {
        setActiveAgent(firstAlertAgent.type);
      }

    } catch (err) {
      console.error('Failed to load briefing data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleDescription = (type) => {
    const roles = {
      main: 'Assistant Principal',
      switchboard: 'Tableaux Électriques',
      vsd: 'Variateurs',
      meca: 'Mécanique',
      hv: 'Haute Tension',
      glo: 'Éclairage Sécurité',
      mobile: 'Équipements Mobiles',
      atex: 'Zones ATEX',
      doors: 'Portes Coupe-Feu',
      datahub: 'Capteurs & Data',
      infrastructure: 'Infrastructure',
      firecontrol: 'Sécurité Incendie'
    };
    return roles[type] || type;
  };

  const buildAgentData = (brief, troubleshooting, activities) => {
    const now = new Date();
    const data = {};

    // Main agent - overview
    data.main = {
      items: [],
      actionUrl: '/dashboard'
    };
    if (brief?.aiInsight) {
      data.main.items.push({
        id: 'insight',
        icon: '💡',
        title: 'Conseil du jour',
        description: brief.aiInsight
      });
    }

    // Switchboard agent - controls
    const overdueControls = brief?.stats?.controls?.overdue || 0;
    const thisWeekControls = brief?.stats?.controls?.thisWeek || 0;
    data.switchboard = {
      items: [],
      actionUrl: '/app/switchboard-controls'
    };
    if (overdueControls > 0) {
      data.switchboard.items.push({
        id: 'overdue',
        icon: '🚨',
        title: `${overdueControls} contrôle${overdueControls > 1 ? 's' : ''} en retard`,
        description: 'À effectuer en priorité',
        url: '/app/switchboard-controls?filter=overdue'
      });
    }
    if (thisWeekControls > 0) {
      data.switchboard.items.push({
        id: 'thisweek',
        icon: '📅',
        title: `${thisWeekControls} contrôle${thisWeekControls > 1 ? 's' : ''} cette semaine`,
        description: 'Planifiés pour les 7 prochains jours',
        url: '/app/switchboard-controls'
      });
    }

    // VSD, Meca, HV, GLO, Mobile - from activities
    ['vsd', 'meca', 'hv', 'glo', 'mobile', 'datahub', 'infrastructure'].forEach(type => {
      const typeActivities = activities
        .filter(a => a.module === type || a.module === `${type}-equipments` || a.module === 'mobile-equipment')
        .slice(0, 3)
        .map(a => ({
          id: a.id,
          icon: a.type === 'created' ? '✅' : a.type === 'deleted' ? '❌' : '📝',
          title: a.title,
          description: a.description,
          time: getTimeAgo(a.timestamp),
          url: a.url
        }));
      data[type] = {
        items: typeActivities,
        actionUrl: `/app/${type === 'mobile' ? 'mobile-equipments' : type}`
      };
    });

    // ATEX agent - non-conformities
    const ncCount = brief?.stats?.nonConformities?.pending || 0;
    data.atex = {
      items: [],
      actionUrl: '/app/atex'
    };
    if (ncCount > 0) {
      data.atex.items.push({
        id: 'nc',
        icon: '⚠️',
        title: `${ncCount} non-conformité${ncCount > 1 ? 's' : ''} en attente`,
        description: 'Nécessitent une action corrective',
        url: '/app/atex'
      });
    }

    // Doors agent
    data.doors = {
      items: activities
        .filter(a => a.module === 'doors')
        .slice(0, 3)
        .map(a => ({
          id: a.id,
          icon: '🚪',
          title: a.title,
          description: a.description,
          time: getTimeAgo(a.timestamp),
          url: a.url
        })),
      actionUrl: '/app/doors'
    };

    // Fire control agent
    data.firecontrol = {
      items: activities
        .filter(a => a.module === 'fire-control' || a.type?.includes('fire'))
        .slice(0, 3)
        .map(a => ({
          id: a.id,
          icon: '🧯',
          title: a.title,
          description: a.description,
          time: getTimeAgo(a.timestamp),
          url: a.url
        })),
      actionUrl: '/app/fire-control'
    };

    // Troubleshooting - add to relevant agents
    troubleshooting.slice(0, 5).forEach(t => {
      const agentType = t.equipment_type || 'switchboard';
      if (data[agentType]) {
        data[agentType].items.push({
          id: t.id,
          icon: t.severity === 'critical' ? '🔴' : t.severity === 'major' ? '🟠' : '🟡',
          title: `Dépannage: ${t.title}`,
          description: `${t.equipment_name || 'Équipement'} - ${t.technician_name}`,
          time: getTimeAgo(t.created_at),
          url: `/app/troubleshooting/${t.id}`
        });
      }
    });

    return data;
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
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <RefreshCw size={40} className="text-blue-400" />
          </motion.div>
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
      {/* Header */}
      <div className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10">
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
            <button
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className={`p-2 rounded-lg transition-all ${
                isAutoPlay ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
              title={isAutoPlay ? 'Arrêter' : 'Lecture auto'}
            >
              {isAutoPlay ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              onClick={loadBriefingData}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <RefreshCw size={18} />
            </button>
            {onClose && (
              <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white">
                <ChevronDown size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="px-4 sm:px-6 py-4 bg-black/20 border-b border-white/5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickStat icon={Activity} value={stats.healthScore || 0} label="Score santé" color={stats.healthScore >= 80 ? 'green' : stats.healthScore >= 60 ? 'amber' : 'red'} onClick={() => navigate('/app/switchboard-controls')} />
          <QuickStat icon={AlertTriangle} value={stats.overdueControls || 0} label="En retard" color="red" onClick={() => navigate('/app/switchboard-controls?filter=overdue')} />
          <QuickStat icon={Wrench} value={stats.troubleshootingToday || 0} label="Dépannages (24h)" color="amber" onClick={() => navigate('/app/troubleshooting')} />
          <QuickStat icon={CheckCircle} value={stats.completedToday || 0} label="Complétés" color="green" onClick={() => navigate('/app/switchboard-controls')} />
        </div>
      </div>

      {/* Agents Grid */}
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mb-6">
          {agents.map(agent => (
            <VideoAgentAvatar
              key={agent.type}
              agent={agent}
              isActive={activeAgent === agent.type}
              isSpeaking={activeAgent === agent.type}
              onClick={() => setActiveAgent(activeAgent === agent.type ? null : agent.type)}
              alertCount={agentData[agent.type]?.items?.length || 0}
            />
          ))}
        </div>

        {/* Speech Bubble */}
        <AnimatePresence mode="wait">
          {activeAgent && agents.find(a => a.type === activeAgent) && (
            <SpeechBubble
              key={activeAgent}
              agent={agents.find(a => a.type === activeAgent)}
              items={agentData[activeAgent]?.items || []}
              onItemClick={handleItemClick}
              onClose={() => setActiveAgent(null)}
            />
          )}
        </AnimatePresence>

        {/* No agent selected */}
        {!activeAgent && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/5 backdrop-blur rounded-2xl p-6 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={28} className="text-blue-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Bienvenue au briefing !</h3>
            <p className="text-slate-400 text-sm mb-4">Cliquez sur un agent pour voir ses infos.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {agents.filter(a => (agentData[a.type]?.items?.length || 0) > 0).map(agent => (
                <button
                  key={agent.type}
                  onClick={() => setActiveAgent(agent.type)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white transition-colors flex items-center gap-2"
                >
                  <span>{AGENT_EMOJIS[agent.type]}</span>
                  {agent.customName}: {agentData[agent.type]?.items?.length || 0} info{(agentData[agent.type]?.items?.length || 0) > 1 ? 's' : ''}
                </button>
              ))}
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
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {activities.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">Aucune activité récente</p>
          ) : (
            activities.map((activity, idx) => (
              <ActivityItem key={activity.id || idx} activity={activity} onClick={() => handleItemClick(activity)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
