import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench, AlertTriangle, CheckCircle, Clock,
  Zap, Activity, RefreshCw, Users,
  ChevronRight, ChevronDown, Calendar,
  MessageCircle, Play, Pause, ArrowRight, Send,
  Mic, MicOff, X
} from 'lucide-react';
import { aiAssistant } from '../lib/ai-assistant';
import { getUserPermissions } from '../lib/permissions';

// Mapping agent type to app permission
const AGENT_TO_APP_MAP = {
  main: null,
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
  main: { bg: 'from-blue-500 to-cyan-600', ring: 'ring-blue-400', text: 'text-blue-600', bgLight: 'bg-blue-50', border: '#3b82f6' },
  switchboard: { bg: 'from-amber-500 to-orange-600', ring: 'ring-amber-400', text: 'text-amber-600', bgLight: 'bg-amber-50', border: '#f59e0b' },
  vsd: { bg: 'from-purple-500 to-violet-600', ring: 'ring-purple-400', text: 'text-purple-600', bgLight: 'bg-purple-50', border: '#8b5cf6' },
  meca: { bg: 'from-slate-500 to-gray-600', ring: 'ring-slate-400', text: 'text-slate-600', bgLight: 'bg-slate-50', border: '#64748b' },
  hv: { bg: 'from-yellow-500 to-amber-600', ring: 'ring-yellow-400', text: 'text-yellow-600', bgLight: 'bg-yellow-50', border: '#eab308' },
  glo: { bg: 'from-emerald-500 to-green-600', ring: 'ring-emerald-400', text: 'text-emerald-600', bgLight: 'bg-emerald-50', border: '#10b981' },
  mobile: { bg: 'from-cyan-500 to-blue-600', ring: 'ring-cyan-400', text: 'text-cyan-600', bgLight: 'bg-cyan-50', border: '#06b6d4' },
  atex: { bg: 'from-red-500 to-rose-600', ring: 'ring-red-400', text: 'text-red-600', bgLight: 'bg-red-50', border: '#ef4444' },
  doors: { bg: 'from-pink-500 to-fuchsia-600', ring: 'ring-pink-400', text: 'text-pink-600', bgLight: 'bg-pink-50', border: '#ec4899' },
  datahub: { bg: 'from-indigo-500 to-purple-600', ring: 'ring-indigo-400', text: 'text-indigo-600', bgLight: 'bg-indigo-50', border: '#6366f1' },
  infrastructure: { bg: 'from-violet-500 to-purple-600', ring: 'ring-violet-400', text: 'text-violet-600', bgLight: 'bg-violet-50', border: '#8b5cf6' },
  firecontrol: { bg: 'from-orange-500 to-red-600', ring: 'ring-orange-400', text: 'text-orange-600', bgLight: 'bg-orange-50', border: '#f97316' }
};

// Video Agent Avatar - Video always visible, plays only when speaking
const VideoAgentAvatar = ({ agent, isActive, isSpeaking, onClick, alertCount }) => {
  const videoRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const colors = AGENT_COLORS[agent.type] || AGENT_COLORS.main;
  const emoji = AGENT_EMOJIS[agent.type] || '🤖';

  const idleVideoUrl = `/api/admin/settings/ai-agents/${agent.type}/idle`;
  const speakingVideoUrl = `/api/admin/settings/ai-agents/${agent.type}/speaking`;
  const hasVideo = agent.hasIdleVideo || agent.hasSpeakingVideo;

  // Control video playback - play ONLY when speaking
  useEffect(() => {
    if (videoRef.current && hasVideo) {
      if (isSpeaking) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [isSpeaking, hasVideo]);

  return (
    <motion.button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2 p-2 rounded-2xl transition-all ${
        isActive ? 'bg-white/15 scale-110 z-10' : 'hover:bg-white/5'
      }`}
      whileHover={{ scale: isActive ? 1.1 : 1.05 }}
      whileTap={{ scale: 0.95 }}
      animate={{
        scale: isActive ? 1.1 : 1
      }}
    >
      {/* Video frame */}
      <div className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden shadow-xl transition-all duration-300 ${
        isActive ? `ring-4 ${colors.ring} ring-opacity-70 shadow-2xl` : 'shadow-lg'
      }`}>
        {/* Background gradient (only visible if no video) */}
        <div className={`absolute inset-0 bg-gradient-to-br ${colors.bg}`} />

        {/* Video - ALWAYS visible, paused when not speaking */}
        {hasVideo && (
          <video
            ref={videoRef}
            src={isSpeaking && agent.hasSpeakingVideo ? speakingVideoUrl : idleVideoUrl}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              videoLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            loop
            muted
            playsInline
            onLoadedData={() => setVideoLoaded(true)}
            onError={() => setVideoLoaded(false)}
          />
        )}

        {/* Emoji fallback (only if no video loaded) */}
        {(!hasVideo || !videoLoaded) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.span
              className="text-3xl sm:text-4xl"
              animate={isSpeaking ? {
                scale: [1, 1.2, 1, 1.15, 1],
                rotate: [0, -5, 5, -3, 0]
              } : {}}
              transition={{
                duration: 0.5,
                repeat: isSpeaking ? Infinity : 0,
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
                className="w-1 bg-white rounded-full shadow-sm"
                animate={{ height: [3, 10, 3] }}
                transition={{
                  duration: 0.35,
                  repeat: Infinity,
                  delay: i * 0.08,
                  ease: "easeInOut"
                }}
              />
            ))}
          </div>
        )}

        {/* Live badge when speaking */}
        {isSpeaking && (
          <div className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] font-bold text-white shadow-lg">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}

        {/* Inactive overlay - subtle dim when not active */}
        {!isActive && (
          <div className="absolute inset-0 bg-black/30" />
        )}
      </div>

      {/* Alert badge */}
      {alertCount > 0 && (
        <motion.span
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg"
          animate={isActive ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 1, repeat: Infinity }}
        >
          {alertCount > 9 ? '9+' : alertCount}
        </motion.span>
      )}

      {/* Name tag */}
      <div className="text-center">
        <p className={`text-xs sm:text-sm font-bold transition-colors ${isActive ? 'text-white' : 'text-slate-400'}`}>
          {agent.customName || agent.name?.split(' ')[0]}
        </p>
      </div>
    </motion.button>
  );
};

// Video Avatar for Chat Messages
const ChatVideoAvatar = ({ agent, isUser }) => {
  const videoRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const colors = AGENT_COLORS[agent?.type] || AGENT_COLORS.main;
  const emoji = AGENT_EMOJIS[agent?.type] || '🤖';

  const idleVideoUrl = agent ? `/api/admin/settings/ai-agents/${agent.type}/idle` : null;
  const hasVideo = agent?.hasIdleVideo;

  if (isUser) {
    return (
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-lg shadow-md">
        👤
      </div>
    );
  }

  return (
    <div className={`flex-shrink-0 w-10 h-10 rounded-full overflow-hidden shadow-md ${
      !hasVideo || !videoLoaded ? `bg-gradient-to-br ${colors.bg}` : ''
    }`}>
      {hasVideo && (
        <video
          ref={videoRef}
          src={idleVideoUrl}
          className={`w-full h-full object-cover ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
          loop
          muted
          playsInline
          autoPlay={false}
          onLoadedData={() => setVideoLoaded(true)}
          onError={() => setVideoLoaded(false)}
        />
      )}
      {(!hasVideo || !videoLoaded) && (
        <div className="w-full h-full flex items-center justify-center text-lg">
          {emoji}
        </div>
      )}
    </div>
  );
};

// Chat Message Component
const ChatMessage = ({ message, agents }) => {
  const isUser = message.role === 'user';
  const agent = agents.find(a => a.type === message.agentType);
  const colors = AGENT_COLORS[message.agentType] || AGENT_COLORS.main;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Video Avatar */}
      <ChatVideoAvatar agent={agent} isUser={isUser} />

      {/* Message bubble */}
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
        isUser
          ? 'bg-blue-600 text-white rounded-br-md'
          : 'bg-white text-slate-800 rounded-bl-md shadow-md'
      }`}
        style={!isUser ? { borderLeft: `3px solid ${colors.border}` } : {}}
      >
        {!isUser && (
          <p className={`text-xs font-semibold mb-1 ${colors.text}`}>
            {agent?.customName || message.agentName || 'Agent'}
          </p>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </div>
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
      className="bg-white rounded-xl p-3 shadow-sm hover:shadow-md transition-all text-left relative overflow-hidden"
    >
      <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br ${colors[color]} opacity-10 rounded-bl-full`} />
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center shadow`}>
          <Icon size={16} className="text-white" />
        </div>
        <div>
          <span className="text-xl font-bold text-slate-900">{value}</span>
          <p className="text-[10px] text-slate-500">{label}</p>
        </div>
      </div>
    </motion.button>
  );
};

// Main BriefingBoard Component
export default function BriefingBoard({ userName, userEmail, onClose }) {
  const navigate = useNavigate();
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [activeAgent, setActiveAgent] = useState(null);
  const [speakingAgent, setSpeakingAgent] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agentData, setAgentData] = useState({});
  const [stats, setStats] = useState({});
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showChat, setShowChat] = useState(true);

  // User permissions
  const userPermissions = useMemo(() => getUserPermissions(userEmail), [userEmail]);
  const userApps = userPermissions?.apps || [];
  const isAdmin = userPermissions?.isAdmin || false;

  // Update time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Load data
  useEffect(() => {
    loadBriefingData();
  }, [userEmail]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-play through agents
  useEffect(() => {
    if (!isAutoPlay || agents.length === 0) return;

    let currentIndex = agents.findIndex(a => a.type === activeAgent);

    const timer = setInterval(() => {
      currentIndex = (currentIndex + 1) % agents.length;
      const nextAgent = agents[currentIndex];
      setActiveAgent(nextAgent.type);
      setSpeakingAgent(nextAgent.type);

      // Add agent message for their info
      const agentInfo = agentData[nextAgent.type];
      if (agentInfo?.items?.length > 0) {
        const summaryText = agentInfo.items.map(item => `• ${item.title}`).join('\n');
        addAgentMessage(nextAgent.type, `Voici mes informations :\n${summaryText}`);
      } else {
        addAgentMessage(nextAgent.type, "Rien à signaler de mon côté, tout est en ordre !");
      }

      // Stop speaking after delay
      setTimeout(() => setSpeakingAgent(null), 3000);
    }, 6000);

    return () => clearInterval(timer);
  }, [isAutoPlay, agents, activeAgent, agentData]);

  const loadBriefingData = async () => {
    setIsLoading(true);
    try {
      const [agentListRes, agentNamesRes, morningBrief, troubleshootingRes] = await Promise.all([
        fetch('/api/admin/settings/ai-agents/list').then(r => r.json()).catch(() => ({ agents: [] })),
        fetch('/api/admin/settings/ai-agents/names').then(r => r.json()).catch(() => ({ names: {} })),
        aiAssistant.getMorningBrief().catch(() => null),
        fetch('/api/troubleshooting/list?limit=10').then(r => r.json()).catch(() => ({ records: [] }))
      ]);

      // Filter agents based on permissions
      const filteredAgents = (agentListRes.agents || []).filter(agent => {
        const requiredApp = AGENT_TO_APP_MAP[agent.type];
        if (!requiredApp) return true;
        if (isAdmin) return true;
        return userApps.includes(requiredApp);
      }).map(agent => ({
        ...agent,
        customName: agentNamesRes.names?.[agent.type] || agent.name?.split(' ')[0],
        role: getRoleDescription(agent.type)
      }));

      setAgents(filteredAgents);

      const data = buildAgentData(morningBrief, troubleshootingRes?.records || []);
      setAgentData(data);

      setStats({
        healthScore: morningBrief?.healthScore || 85,
        overdueControls: morningBrief?.stats?.controls?.overdue || 0,
        completedToday: morningBrief?.stats?.controls?.completedThisWeek || 0,
        troubleshootingToday: (troubleshootingRes?.records || []).filter(r =>
          new Date(r.created_at).toDateString() === new Date().toDateString()
        ).length
      });

      // Welcome message from main agent
      const mainAgent = filteredAgents.find(a => a.type === 'main') || filteredAgents[0];
      if (mainAgent) {
        setActiveAgent(mainAgent.type);
        setSpeakingAgent(mainAgent.type);

        const welcomeMsg = `Bonjour ${userName || 'à tous'} ! Bienvenue au briefing d'équipe. Je suis ${mainAgent.customName}, votre coordinateur. ${filteredAgents.length - 1} agents sont présents aujourd'hui. Cliquez sur un agent pour qu'il présente ses informations, ou posez-moi une question !`;

        setTimeout(() => {
          addAgentMessage(mainAgent.type, welcomeMsg);
          setTimeout(() => setSpeakingAgent(null), 3000);
        }, 500);
      }

    } catch (err) {
      console.error('Failed to load briefing data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleDescription = (type) => {
    const roles = {
      main: 'Coordinateur',
      switchboard: 'Tableaux',
      vsd: 'Variateurs',
      meca: 'Mécanique',
      hv: 'Haute Tension',
      glo: 'Éclairage',
      mobile: 'Mobile',
      atex: 'ATEX',
      doors: 'Portes',
      datahub: 'Data',
      infrastructure: 'Infra',
      firecontrol: 'Incendie'
    };
    return roles[type] || type;
  };

  const buildAgentData = (brief, troubleshooting) => {
    const data = {};

    // Main agent
    data.main = { items: [], actionUrl: '/dashboard' };
    if (brief?.aiInsight) {
      data.main.items.push({ id: 'insight', icon: '💡', title: 'Conseil du jour', description: brief.aiInsight });
    }

    // Switchboard
    const overdueControls = brief?.stats?.controls?.overdue || 0;
    const thisWeekControls = brief?.stats?.controls?.thisWeek || 0;
    data.switchboard = { items: [], actionUrl: '/app/switchboard-controls' };
    if (overdueControls > 0) {
      data.switchboard.items.push({ id: 'overdue', icon: '🚨', title: `${overdueControls} contrôle(s) en retard`, description: 'Priorité haute' });
    }
    if (thisWeekControls > 0) {
      data.switchboard.items.push({ id: 'week', icon: '📅', title: `${thisWeekControls} contrôle(s) cette semaine`, description: 'À planifier' });
    }

    // Other agents - initialize empty
    ['vsd', 'meca', 'hv', 'glo', 'mobile', 'datahub', 'infrastructure', 'doors', 'firecontrol'].forEach(type => {
      data[type] = { items: [], actionUrl: `/app/${type === 'mobile' ? 'mobile-equipments' : type === 'firecontrol' ? 'fire-control' : type}` };
    });

    // ATEX
    const ncCount = brief?.stats?.nonConformities?.pending || 0;
    data.atex = { items: [], actionUrl: '/app/atex' };
    if (ncCount > 0) {
      data.atex.items.push({ id: 'nc', icon: '⚠️', title: `${ncCount} non-conformité(s)`, description: 'Action requise' });
    }

    // Add troubleshooting to relevant agents
    troubleshooting.slice(0, 5).forEach(t => {
      const agentType = t.equipment_type || 'switchboard';
      if (data[agentType]) {
        data[agentType].items.push({
          id: t.id,
          icon: t.severity === 'critical' ? '🔴' : '🟡',
          title: `Dépannage: ${t.title}`,
          description: t.equipment_name || 'Équipement'
        });
      }
    });

    return data;
  };

  const addAgentMessage = (agentType, content) => {
    const agent = agents.find(a => a.type === agentType);
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'assistant',
      agentType,
      agentName: agent?.customName || agentType,
      content
    }]);
  };

  const handleAgentClick = (agentType) => {
    setActiveAgent(agentType);
    setSpeakingAgent(agentType);

    const agent = agents.find(a => a.type === agentType);
    const agentInfo = agentData[agentType];

    if (agentInfo?.items?.length > 0) {
      const itemsList = agentInfo.items.map(item => `• ${item.title}: ${item.description}`).join('\n');
      addAgentMessage(agentType, `${agent?.customName || 'Agent'} au rapport !\n\n${itemsList}`);
    } else {
      addAgentMessage(agentType, `${agent?.customName || 'Agent'} ici. Tout est en ordre de mon côté, rien à signaler !`);
    }

    setTimeout(() => setSpeakingAgent(null), 3000);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    // Get current active agent info
    const currentAgent = agents.find(a => a.type === activeAgent);

    // Add user message
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      content: userMessage
    }]);

    try {
      // Call AI chat API with active agent context
      const result = await aiAssistant.chatV2(userMessage, {
        conversationHistory: messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        // Tell the AI which agent the user is talking to
        previousAgentType: activeAgent,
        context: {
          briefingMode: true,
          activeAgent: activeAgent,
          activeAgentName: currentAgent?.customName || currentAgent?.name,
          activeAgentRole: currentAgent?.role,
          // This is what the backend uses to determine who should respond
          previousAgentType: activeAgent
        }
      });

      // Use the active agent to respond (not what AI says)
      // The user clicked on an agent, so that agent should respond
      const respondingAgent = activeAgent || result.agentType || 'main';
      setSpeakingAgent(respondingAgent);

      // Add agent response
      const responseText = result.message || "Je n'ai pas compris, pouvez-vous reformuler ?";
      addAgentMessage(respondingAgent, responseText);

      setTimeout(() => setSpeakingAgent(null), 3000);

    } catch (err) {
      console.error('Chat error:', err);
      addAgentMessage('main', "Désolé, je n'ai pas pu traiter votre demande. Réessayez dans un moment.");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
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
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="relative px-4 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
              <Users size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate flex items-center gap-2">
                Briefing Équipe
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/20 rounded text-[10px] text-red-400 font-medium">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              </h2>
              <p className="text-slate-400 text-xs flex items-center gap-1">
                <Calendar size={10} />
                {currentTime.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                <span className="mx-1">•</span>
                <Clock size={10} />
                {currentTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className={`p-2 rounded-lg transition-all ${
                isAutoPlay ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
              title={isAutoPlay ? 'Arrêter' : 'Tour de table auto'}
            >
              {isAutoPlay ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={loadBriefingData} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400">
              <RefreshCw size={16} />
            </button>
            {onClose && (
              <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="px-3 py-2 bg-black/20 border-b border-white/5 flex-shrink-0">
        <div className="grid grid-cols-4 gap-2">
          <QuickStat icon={Activity} value={stats.healthScore || 0} label="Santé" color={stats.healthScore >= 80 ? 'green' : 'amber'} onClick={() => navigate('/app/switchboard-controls')} />
          <QuickStat icon={AlertTriangle} value={stats.overdueControls || 0} label="Retard" color="red" onClick={() => navigate('/app/switchboard-controls?filter=overdue')} />
          <QuickStat icon={Wrench} value={stats.troubleshootingToday || 0} label="Dépan." color="amber" onClick={() => navigate('/app/troubleshooting')} />
          <QuickStat icon={CheckCircle} value={stats.completedToday || 0} label="Fait" color="green" onClick={() => navigate('/app/switchboard-controls')} />
        </div>
      </div>

      {/* Agents Row - Video Conference Style */}
      <div className="px-3 py-3 bg-black/10 border-b border-white/5 flex-shrink-0">
        <div className="flex justify-center gap-2 sm:gap-3 overflow-x-auto pb-1">
          {agents.map(agent => (
            <VideoAgentAvatar
              key={agent.type}
              agent={agent}
              isActive={activeAgent === agent.type}
              isSpeaking={speakingAgent === agent.type}
              onClick={() => handleAgentClick(agent.type)}
              alertCount={agentData[agent.type]?.items?.length || 0}
            />
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Messages */}
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ minHeight: '200px' }}
        >
          <AnimatePresence>
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} agents={agents} />
            ))}
          </AnimatePresence>

          {isSending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                <span className="text-sm">⚡</span>
              </div>
              <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-md">
                <div className="flex gap-1">
                  <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-2 h-2 bg-slate-400 rounded-full" />
                  <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }} className="w-2 h-2 bg-slate-400 rounded-full" />
                  <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }} className="w-2 h-2 bg-slate-400 rounded-full" />
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-3 bg-slate-800/50 border-t border-white/10 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Posez une question aux agents..."
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent"
                rows={1}
                style={{ minHeight: '42px', maxHeight: '100px' }}
              />
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isSending}
              className={`p-3 rounded-xl transition-all ${
                inputValue.trim() && !isSending
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-white/10 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2 text-center">
            Cliquez sur un agent pour qu'il présente ses infos, ou discutez directement !
          </p>
        </div>
      </div>
    </div>
  );
}
