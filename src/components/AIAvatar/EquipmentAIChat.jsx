import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';
import MiniEquipmentPreview from './MiniEquipmentPreview';
import {
  X, Send, Mic, MicOff, Sparkles,
  AlertTriangle, Calendar, Search, FileText,
  Wrench, Zap, RefreshCw, CheckCircle, Clock,
  Volume2, VolumeX, Play, Cpu, Cog, Battery,
  Shield, MapPin, Download, BookOpen, Settings,
  TrendingUp, Activity, ClipboardCheck, HelpCircle,
  Lightbulb, Target, ChevronRight, Map
} from 'lucide-react';
import { aiAssistant } from '../../lib/ai-assistant';
import { Bar, Pie, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

// Equipment type configurations
const EQUIPMENT_CONFIGS = {
  vsd: {
    name: 'Variateur',
    icon: Cpu,
    color: 'green',
    gradient: 'from-green-500 to-green-600',
    bgLight: 'bg-green-50',
    textColor: 'text-green-600',
    borderColor: 'border-green-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve ce variateur sur le plan.', isMapAction: true },
      { icon: Wrench, label: 'Diagnostic', prompt: 'Fais un diagnostic complet de ce variateur et identifie les points d\'attention.' },
      { icon: AlertTriangle, label: 'Problèmes courants', prompt: 'Quels sont les problèmes courants pour ce type de variateur et comment les prévenir ?' },
      { icon: Calendar, label: 'Maintenance', prompt: 'Propose un plan de maintenance préventive adapté à ce variateur.' },
      { icon: Search, label: 'Documentation', prompt: 'Recherche la documentation technique de ce variateur sur internet.' },
      { icon: TrendingUp, label: 'Optimisation', prompt: 'Comment optimiser les paramètres de ce variateur pour améliorer l\'efficacité énergétique ?' },
    ]
  },
  switchboard: {
    name: 'Tableau électrique',
    icon: Zap,
    color: 'blue',
    gradient: 'from-blue-500 to-blue-600',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-200',
    showMapPreview: true, // Enable mini map preview for switchboards
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve ce tableau sur le plan.', isMapAction: true },
      { icon: Shield, label: 'Sécurité', prompt: 'Analyse la conformité sécurité de ce tableau électrique et identifie les risques.' },
      { icon: Activity, label: 'État général', prompt: 'Donne-moi un état général de ce tableau électrique et ses points d\'attention.' },
      { icon: Calendar, label: 'Contrôles', prompt: 'Quels contrôles sont à prévoir pour ce tableau ? Propose un planning.' },
      { icon: Search, label: 'Normes', prompt: 'Quelles normes s\'appliquent à ce tableau électrique ? Vérifie la conformité.' },
      { icon: Wrench, label: 'Maintenance', prompt: 'Propose un programme de maintenance préventive pour ce tableau.' },
    ]
  },
  meca: {
    name: 'Équipement mécanique',
    icon: Cog,
    color: 'orange',
    gradient: 'from-orange-500 to-orange-600',
    bgLight: 'bg-orange-50',
    textColor: 'text-orange-600',
    borderColor: 'border-orange-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve cet équipement mécanique sur le plan.', isMapAction: true },
      { icon: Wrench, label: 'Diagnostic', prompt: 'Fais un diagnostic mécanique de cet équipement et identifie les usures potentielles.' },
      { icon: AlertTriangle, label: 'Points critiques', prompt: 'Quels sont les points critiques à surveiller sur cet équipement mécanique ?' },
      { icon: Calendar, label: 'Maintenance', prompt: 'Propose un plan de maintenance préventive adapté à cet équipement.' },
      { icon: Search, label: 'Pièces détachées', prompt: 'Recherche les pièces détachées disponibles pour cet équipement.' },
      { icon: TrendingUp, label: 'Durée de vie', prompt: 'Estime la durée de vie restante de cet équipement et propose des recommandations.' },
    ]
  },
  glo: {
    name: 'Équipement GLO',
    icon: Battery,
    color: 'emerald',
    gradient: 'from-emerald-500 to-emerald-600',
    bgLight: 'bg-emerald-50',
    textColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve cet équipement GLO sur le plan.', isMapAction: true },
      { icon: Battery, label: 'État batteries', prompt: 'Analyse l\'état des batteries de cet équipement et estime leur durée de vie.' },
      { icon: Activity, label: 'Performance', prompt: 'Évalue les performances de cet équipement et identifie les améliorations possibles.' },
      { icon: Calendar, label: 'Tests', prompt: 'Quels tests périodiques sont requis ? Propose un planning de tests.' },
      { icon: Search, label: 'Documentation', prompt: 'Recherche la documentation technique et les normes applicables.' },
      { icon: Shield, label: 'Conformité', prompt: 'Vérifie la conformité réglementaire de cet équipement.' },
    ]
  },
  hv: {
    name: 'Haute Tension',
    icon: Zap,
    color: 'amber',
    gradient: 'from-amber-500 to-amber-600',
    bgLight: 'bg-amber-50',
    textColor: 'text-amber-600',
    borderColor: 'border-amber-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve cet équipement haute tension sur le plan.', isMapAction: true },
      { icon: Shield, label: 'Sécurité HT', prompt: 'Analyse les risques haute tension de cet équipement et les mesures de sécurité requises.' },
      { icon: AlertTriangle, label: 'Points critiques', prompt: 'Quels sont les points critiques à surveiller sur cet équipement HT ?' },
      { icon: Calendar, label: 'Contrôles réglementaires', prompt: 'Quels contrôles réglementaires sont requis ? Vérifie les échéances.' },
      { icon: Search, label: 'Normes HT', prompt: 'Quelles normes haute tension s\'appliquent ? Vérifie la conformité.' },
      { icon: Wrench, label: 'Maintenance HT', prompt: 'Propose un programme de maintenance pour cet équipement haute tension.' },
    ]
  },
  mobile: {
    name: 'Équipement mobile',
    icon: Cpu,
    color: 'blue',
    gradient: 'from-blue-500 to-blue-600',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve cet équipement mobile sur le plan.', isMapAction: true },
      { icon: ClipboardCheck, label: 'Vérifications', prompt: 'Liste les vérifications à effectuer avant utilisation de cet équipement.' },
      { icon: Calendar, label: 'Planning', prompt: 'Propose un planning de contrôles périodiques pour cet équipement mobile.' },
      { icon: Shield, label: 'Conformité', prompt: 'Vérifie la conformité réglementaire de cet équipement mobile.' },
      { icon: Search, label: 'Documentation', prompt: 'Recherche la documentation et les certifications requises.' },
      { icon: Wrench, label: 'Entretien', prompt: 'Propose un programme d\'entretien adapté à cet équipement mobile.' },
    ]
  },
  atex: {
    name: 'Équipement ATEX',
    icon: Shield,
    color: 'purple',
    gradient: 'from-purple-500 to-purple-600',
    bgLight: 'bg-purple-50',
    textColor: 'text-purple-600',
    borderColor: 'border-purple-200',
    showMapPreview: true,
    actions: [
      { icon: Map, label: 'Localisation', prompt: 'Montre-moi où se trouve cet équipement ATEX sur le plan.', isMapAction: true },
      { icon: Shield, label: 'Conformité ATEX', prompt: 'Vérifie la conformité ATEX de cet équipement et identifie les écarts.' },
      { icon: AlertTriangle, label: 'Zones à risque', prompt: 'Analyse les zones à risque d\'explosion autour de cet équipement.' },
      { icon: Calendar, label: 'Inspections', prompt: 'Quelles inspections ATEX sont requises ? Propose un planning.' },
      { icon: Search, label: 'Certifications', prompt: 'Vérifie les certifications ATEX et leur validité.' },
      { icon: FileText, label: 'DRPCE', prompt: 'Aide-moi à préparer la documentation DRPCE pour cet équipement.' },
    ]
  }
};

// Chart component
function AIChart({ chart }) {
  if (!chart) return null;

  const colors = [
    'rgba(59, 130, 246, 0.8)',
    'rgba(16, 185, 129, 0.8)',
    'rgba(245, 158, 11, 0.8)',
    'rgba(239, 68, 68, 0.8)',
    'rgba(139, 92, 246, 0.8)',
    'rgba(236, 72, 153, 0.8)',
    'rgba(20, 184, 166, 0.8)',
    'rgba(251, 146, 60, 0.8)'
  ];

  const data = {
    labels: chart.labels || [],
    datasets: [{
      label: chart.title || 'Données',
      data: chart.data || [],
      backgroundColor: colors.slice(0, chart.data?.length || 1),
      borderColor: colors.map(c => c.replace('0.8', '1')),
      borderWidth: 1
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: chart.type === 'pie' || chart.type === 'doughnut' },
      title: { display: true, text: chart.title || '' }
    }
  };

  const ChartComponent = {
    bar: Bar,
    line: Line,
    pie: Pie,
    doughnut: Doughnut
  }[chart.type] || Bar;

  return (
    <div className="mt-3 p-3 bg-white rounded-lg border" style={{ height: 200 }}>
      <ChartComponent data={data} options={options} />
    </div>
  );
}

/**
 * EquipmentAIChat - Assistant IA contextuel pour un équipement spécifique
 *
 * @param {boolean} isOpen - Si le chat est ouvert
 * @param {function} onClose - Callback pour fermer le chat
 * @param {string} equipmentType - Type d'équipement (vsd, switchboard, meca, glo, hv, mobile, atex)
 * @param {object} equipment - Données de l'équipement
 * @param {object} controlStatus - Statut des contrôles (optionnel)
 */
export default function EquipmentAIChat({
  isOpen,
  onClose,
  equipmentType = 'vsd',
  equipment,
  controlStatus
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('eh_avatar_muted') === 'true';
  });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Get avatar style
  const avatarStyle = localStorage.getItem('eh_avatar_style') || 'ai';
  const avatar = AVATAR_STYLES[avatarStyle] || AVATAR_STYLES.ai;

  // Get equipment config
  const config = EQUIPMENT_CONFIGS[equipmentType] || EQUIPMENT_CONFIGS.vsd;
  const EquipmentIcon = config.icon;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Generate welcome message with equipment context
  useEffect(() => {
    if (isOpen && messages.length === 0 && equipment) {
      const equipmentName = equipment.name || equipment.tag || equipment.code || 'cet équipement';
      const location = [equipment.building, equipment.floor, equipment.room].filter(Boolean).join(' > ') || 'Non spécifié';

      // Build status info
      let statusInfo = '';
      if (controlStatus?.hasOverdue) {
        statusInfo = `\n\n⚠️ **Attention**: Cet équipement a des **contrôles en retard** !`;
      } else if (controlStatus?.nextDueDate) {
        const daysUntil = Math.ceil((new Date(controlStatus.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 7 && daysUntil > 0) {
          statusInfo = `\n\n📅 **Prochain contrôle** dans ${daysUntil} jour(s).`;
        }
      }

      const welcomeMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `Bonjour ! Je suis ${avatar.name}, votre assistant dédié pour **${equipmentName}**.

📍 **Localisation**: ${location}
🏭 **Type**: ${config.name}
${equipment.manufacturer ? `�icing **Fabricant**: ${equipment.manufacturer}` : ''}
${equipment.power_kw ? `⚡ **Puissance**: ${equipment.power_kw} kW` : ''}${statusInfo}

Comment puis-je vous aider avec cet équipement ?`,
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
      speak(welcomeMessage.content);
    }
  }, [isOpen, equipment]);

  // Reset messages when equipment changes
  useEffect(() => {
    if (equipment?.id) {
      setMessages([]);
      setShowQuickActions(true);
    }
  }, [equipment?.id]);

  // Toggle mute
  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStorage.setItem('eh_avatar_muted', newMuted.toString());
    if (newMuted) stopSpeaking();
  };

  // Audio ref for OpenAI TTS
  const audioRef = useRef(null);

  // Speech synthesis with OpenAI TTS (fallback to browser)
  const speak = useCallback(async (text) => {
    if (isMuted) return;

    // Stop any current audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    setIsSpeaking(true);

    try {
      // Try ElevenLabs TTS first (ultra-natural voice), then OpenAI fallback
      const audioBlob = await aiAssistant.textToSpeechPremium(text);

      if (audioBlob) {
        // Use OpenAI audio
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };

        await audio.play();
        return;
      }
    } catch (e) {
      console.log('[TTS] OpenAI failed, using browser fallback');
    }

    // Fallback to browser TTS
    if ('speechSynthesis' in window) {
      const cleanText = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/•/g, '')
        .replace(/\n+/g, '. ');

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'fr-FR';
      utterance.rate = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } else {
      setIsSpeaking(false);
    }
  }, [isMuted]);

  const stopSpeaking = () => {
    // Stop OpenAI audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Stop browser TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  // Voice recognition
  const toggleListening = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('La reconnaissance vocale n\'est pas supportée par votre navigateur.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setTimeout(() => handleSend(transcript), 500);
    };
    recognition.start();
  };

  // Build equipment context for AI
  const buildEquipmentContext = () => {
    if (!equipment) return null;

    return {
      type: equipmentType,
      typeName: config.name,
      equipment: {
        id: equipment.id,
        name: equipment.name || equipment.tag || equipment.code,
        manufacturer: equipment.manufacturer,
        model: equipment.model,
        reference: equipment.reference,
        serial_number: equipment.serial_number,
        power_kw: equipment.power_kw,
        voltage: equipment.voltage,
        current_a: equipment.current_a,
        building: equipment.building || equipment.building_code,
        floor: equipment.floor,
        room: equipment.room,
        zone: equipment.zone,
        location: equipment.location,
        status: equipment.status,
        installation_date: equipment.installation_date,
        last_maintenance: equipment.last_maintenance,
        comments: equipment.comments
      },
      controlStatus: controlStatus ? {
        hasOverdue: controlStatus.hasOverdue,
        nextDueDate: controlStatus.nextDueDate,
        lastControlDate: controlStatus.lastControlDate,
        templateName: controlStatus.templateName
      } : null
    };
  };

  // Send message
  const handleSend = async (messageText = input) => {
    if (!messageText.trim() || isLoading) return;

    stopSpeaking();
    setShowQuickActions(false);

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: messageText.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsSpeaking(true);

    try {
      const equipmentContext = buildEquipmentContext();
      const response = await aiAssistant.chatWithEquipment(messageText, equipmentContext, {
        conversationHistory: messages.slice(-10)
      });

      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        actions: response.actions,
        sources: response.sources,
        chart: response.chart,
        pendingAction: response.pendingAction,
        provider: response.provider,
        model: response.model,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      speak(response.message);

    } catch (error) {
      console.error('Erreur:', error);
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Désolé, j'ai rencontré une erreur: ${error.message}. Réessayons.`,
        isError: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsSpeaking(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Quick action
  const handleQuickAction = (action) => {
    if (action.isMapAction) {
      // Show mini map preview instead of sending message
      setShowMapPreview(true);
      setShowQuickActions(false);

      // Add a message showing the map
      const mapMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `📍 Voici la localisation de **${equipment?.name || equipment?.code || 'ce tableau'}** sur le plan :`,
        showMap: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, mapMessage]);
      return;
    }
    handleSend(action.prompt);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Chat Panel */}
      <div className="relative w-full max-w-2xl h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header with equipment info */}
        <div className={`bg-gradient-to-r ${config.gradient} px-4 py-3 shrink-0`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <AnimatedAvatar
                  style={avatarStyle}
                  size="sm"
                  speaking={isSpeaking}
                />
                <div className={`absolute -bottom-1 -right-1 p-1 rounded-full bg-white shadow-sm`}>
                  <EquipmentIcon className={`w-3 h-3 ${config.textColor}`} />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-white">{avatar.name}</h3>
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs text-white">
                    {config.name}
                  </span>
                </div>
                <p className="text-xs text-white/80 truncate max-w-[200px]">
                  {equipment?.name || equipment?.tag || 'Équipement'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Equipment status indicator */}
              {controlStatus?.hasOverdue && (
                <div className="px-2 py-1 bg-red-500 rounded-lg flex items-center gap-1 mr-2">
                  <AlertTriangle className="w-3 h-3 text-white" />
                  <span className="text-xs text-white font-medium">Retard</span>
                </div>
              )}

              {/* Mute Button */}
              <button
                onClick={toggleMute}
                className={`p-2 rounded-lg transition-colors ${
                  isMuted ? 'bg-red-500/20 hover:bg-red-500/30' : 'hover:bg-white/10'
                }`}
                title={isMuted ? 'Activer le son' : 'Couper le son'}
              >
                {isMuted ? (
                  <VolumeX className="w-5 h-5 text-red-300" />
                ) : (
                  <Volume2 className="w-5 h-5 text-white" />
                )}
              </button>

              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Equipment Quick Info Bar */}
        {equipment && (
          <div className={`px-4 py-2 ${config.bgLight} border-b ${config.borderColor} flex items-center gap-4 text-xs shrink-0 overflow-x-auto`}>
            {equipment.building && (
              <span className="flex items-center gap-1 text-gray-600 whitespace-nowrap">
                <MapPin className="w-3 h-3" />
                {equipment.building}
              </span>
            )}
            {equipment.manufacturer && (
              <span className="flex items-center gap-1 text-gray-600 whitespace-nowrap">
                <Settings className="w-3 h-3" />
                {equipment.manufacturer}
              </span>
            )}
            {equipment.power_kw && (
              <span className="flex items-center gap-1 text-gray-600 whitespace-nowrap">
                <Zap className="w-3 h-3" />
                {equipment.power_kw} kW
              </span>
            )}
            {controlStatus?.nextDueDate && (
              <span className={`flex items-center gap-1 whitespace-nowrap ${controlStatus.hasOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                <Calendar className="w-3 h-3" />
                {new Date(controlStatus.nextDueDate).toLocaleDateString('fr-FR')}
              </span>
            )}
            {/* Show on Map button for switchboards */}
            {config.showMapPreview && (
              <button
                onClick={() => {
                  const mapAction = config.actions.find(a => a.isMapAction);
                  if (mapAction) handleQuickAction(mapAction);
                }}
                className="ml-auto flex items-center gap-1 px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg transition-colors whitespace-nowrap"
              >
                <Map className="w-3 h-3" />
                Voir sur le plan
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? `bg-gradient-to-r ${config.gradient} text-white`
                    : message.isError
                    ? 'bg-red-50 text-red-900 border border-red-200'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {/* Message content with basic markdown */}
                <div className="text-sm whitespace-pre-wrap">
                  {message.content.split('\n').map((line, i) => (
                    <p key={i} className={line.startsWith('•') || line.startsWith('-') ? 'ml-2' : ''}>
                      {line.split('**').map((part, j) =>
                        j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                      )}
                    </p>
                  ))}
                </div>

                {/* Suggested actions */}
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <p className="text-xs font-medium text-gray-500">Actions suggérées :</p>
                    {message.actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(action.prompt || action.label)}
                        className="flex items-center gap-2 w-full px-3 py-2 bg-white rounded-lg text-left text-sm hover:bg-gray-50 transition-colors border"
                      >
                        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                        <span>{action.label}</span>
                        <ChevronRight className="w-3 h-3 text-gray-400 ml-auto" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Chart */}
                {message.chart && <AIChart chart={message.chart} />}

                {/* Mini Equipment Map Preview - Works for all equipment types */}
                {message.showMap && config.showMapPreview && (
                  <div className="mt-3">
                    <MiniEquipmentPreview
                      equipment={equipment}
                      equipmentType={equipmentType}
                      controlStatus={controlStatus}
                      onClose={onClose}
                    />
                  </div>
                )}

                {/* Pending Action */}
                {message.pendingAction && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2">Action proposée :</p>
                    <button
                      onClick={async () => {
                        setIsLoading(true);
                        try {
                          const result = await aiAssistant.executeAction(
                            message.pendingAction.action,
                            message.pendingAction.params
                          );
                          const resultMessage = {
                            id: Date.now(),
                            role: 'assistant',
                            content: result.success
                              ? `✅ **Action exécutée:** ${result.message}`
                              : `❌ **Erreur:** ${result.message}`,
                            timestamp: new Date(),
                            sources: result.sources || [], // Include PDF sources
                            matchingEquipments: result.matchingEquipments || []
                          };
                          setMessages(prev => [...prev, resultMessage]);

                          // Auto-speak result if not muted
                          if (!isMuted && result.message) {
                            speak(result.message);
                          }
                        } catch (e) {
                          console.error('Action error:', e);
                        }
                        setIsLoading(false);
                      }}
                      className={`flex items-center gap-2 w-full px-3 py-2 ${config.bgLight} ${config.textColor} rounded-lg text-left text-sm hover:opacity-80 transition-colors border ${config.borderColor}`}
                    >
                      <Play className="w-4 h-4" />
                      <span>Exécuter: {message.pendingAction.action}</span>
                    </button>
                  </div>
                )}

                {/* Sources - PDF Links */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <Download className="w-3 h-3" />
                      Documents trouvés ({message.sources.length}) :
                    </p>
                    <div className="space-y-1.5">
                      {message.sources.map((source, i) => (
                        <a
                          key={i}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg text-sm text-blue-700 border border-blue-200 hover:from-blue-100 hover:to-indigo-100 transition-all group`}
                        >
                          <FileText className="w-4 h-4 flex-shrink-0" />
                          <span className="flex-1 truncate font-medium">{source.title || 'Document'}</span>
                          {source.manufacturer && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full">
                              {source.manufacturer}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Matching Equipments */}
                {message.matchingEquipments && message.matchingEquipments.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <Cog className="w-3 h-3" />
                      Équipements correspondants ({message.matchingEquipments.length}) :
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {message.matchingEquipments.slice(0, 6).map((eq, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded-lg text-xs border border-amber-200"
                        >
                          <MapPin className="w-3 h-3 text-amber-500" />
                          <span className="truncate font-medium text-amber-800">{eq.name}</span>
                          <span className="text-amber-600 uppercase text-[10px]">{eq.type}</span>
                        </div>
                      ))}
                    </div>
                    {message.matchingEquipments.length > 6 && (
                      <p className="text-xs text-gray-400 mt-1">
                        + {message.matchingEquipments.length - 6} autres équipements
                      </p>
                    )}
                  </div>
                )}

                {/* Timestamp + Provider */}
                <div className={`flex items-center justify-between text-xs mt-2 ${
                  message.role === 'user' ? 'text-white/60' : 'text-gray-400'
                }`}>
                  <span>
                    {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {message.provider && (
                    <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase text-gray-500">
                      {message.provider}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className={`w-2 h-2 ${config.textColor.replace('text', 'bg')} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }} />
                    <span className={`w-2 h-2 ${config.textColor.replace('text', 'bg')} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }} />
                    <span className={`w-2 h-2 ${config.textColor.replace('text', 'bg')} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-gray-500">Analyse en cours...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        {showQuickActions && messages.length <= 1 && (
          <div className="px-4 pb-2 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className={`w-4 h-4 ${config.textColor}`} />
              <span className="text-sm font-medium text-gray-700">Actions rapides</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {config.actions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all hover:scale-105 ${config.bgLight} ${config.textColor}`}
                >
                  <action.icon className="w-4 h-4" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 border-t bg-gray-50 shrink-0">
          <div className="flex items-center gap-2">
            {/* Voice Input */}
            <button
              onClick={toggleListening}
              className={`p-3 rounded-xl transition-all ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
              title={isListening ? 'Arrêter' : 'Parler'}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {/* Text Input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={isListening ? 'Je vous écoute...' : `Posez une question sur ${equipment?.name || 'cet équipement'}...`}
              className={`flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-${config.color}-500 focus:border-transparent`}
              disabled={isLoading || isListening}
            />

            {/* Send Button */}
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className={`p-3 rounded-xl transition-all ${
                input.trim() && !isLoading
                  ? `bg-gradient-to-r ${config.gradient} text-white hover:opacity-90`
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Helpful hints */}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <HelpCircle className="w-3 h-3" />
            <span>Astuce: Demandez un diagnostic, de la documentation, ou des recommandations de maintenance</span>
          </div>
        </div>
      </div>
    </div>
  );
}
