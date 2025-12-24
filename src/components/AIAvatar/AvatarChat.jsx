import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';
import {
  X, Send, Mic, MicOff, Settings, Sparkles,
  AlertTriangle, Calendar, Search, FileText,
  Building, Wrench, Zap, RefreshCw, ChevronDown,
  ExternalLink, CheckCircle, Clock, TrendingUp,
  Volume2, VolumeX, BarChart3, Play, Loader2,
  ClipboardList, Camera, Image, Upload
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

// Chart component based on type
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

// Suggestions contextuelles
const QUICK_ACTIONS = [
  {
    icon: ClipboardList,
    label: 'Créer une procédure',
    prompt: 'Je veux créer une procédure',
    color: 'text-violet-600 bg-violet-50'
  },
  {
    icon: AlertTriangle,
    label: 'Non-conformités',
    prompt: 'Montre-moi un résumé des non-conformités actuelles et propose des actions.',
    color: 'text-red-600 bg-red-50'
  },
  {
    icon: Calendar,
    label: 'Contrôles à venir',
    prompt: 'Quels sont les contrôles à venir dans les 30 prochains jours ? Fais-moi une liste d\'actions prioritaires.',
    color: 'text-blue-600 bg-blue-50'
  },
  {
    icon: Building,
    label: 'Par bâtiment',
    prompt: 'Regroupe les équipements et contrôles par bâtiment et étage.',
    color: 'text-green-600 bg-green-50'
  },
  {
    icon: Search,
    label: 'Rechercher doc',
    prompt: 'J\'ai besoin de documentation technique. Que cherches-tu ?',
    color: 'text-purple-600 bg-purple-50'
  },
  {
    icon: TrendingUp,
    label: 'Analyse globale',
    prompt: 'Donne-moi une analyse globale de la situation : équipements, contrôles, tendances.',
    color: 'text-amber-600 bg-amber-50'
  }
];

export default function AvatarChat({
  isOpen,
  onClose,
  avatarStyle = 'electro',
  onChangeAvatar
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [context, setContext] = useState(null);
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('eh_avatar_muted') === 'true';
  });
  // Photo upload state
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const speechSynthRef = useRef(null);
  const photoInputRef = useRef(null);

  // Fallback si le style n'existe plus (migration des anciens styles)
  const safeAvatarStyle = AVATAR_STYLES[avatarStyle] ? avatarStyle : 'electro';
  const avatar = AVATAR_STYLES[safeAvatarStyle];

  // Scroll vers le bas quand nouveaux messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input quand ouvre
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Charger le contexte global
      loadContext();
    }
  }, [isOpen]);

  // Message de bienvenue
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `Salut ! Je suis ${avatar.name}. 👋

**Que veux-tu faire ?**
• 📋 Créer une procédure (avec photos)
• ⚠️ Voir les non-conformités
• 📅 Contrôles à venir
• 🔍 Rechercher un équipement`,
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
      speak(welcomeMessage.content);
    }
  }, [isOpen, avatarStyle]);

  // Charger le contexte de l'application
  const loadContext = async () => {
    try {
      const ctx = await aiAssistant.getGlobalContext();
      setContext(ctx);
    } catch (error) {
      console.error('Erreur chargement contexte:', error);
    }
  };

  // Toggle mute
  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStorage.setItem('eh_avatar_muted', newMuted.toString());
    if (newMuted) {
      stopSpeaking();
    }
  };

  // Audio ref for OpenAI TTS
  const audioRef = useRef(null);

  // Synthèse vocale avec OpenAI TTS (fallback navigateur)
  const speak = useCallback(async (text) => {
    if (isMuted) return;

    // Arrêter tout audio en cours
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    setIsSpeaking(true);

    try {
      // Essayer ElevenLabs TTS d'abord (voix ultra-naturelle), puis OpenAI en fallback
      const audioBlob = await aiAssistant.textToSpeechPremium(text);

      if (audioBlob) {
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

    // Fallback navigateur
    if ('speechSynthesis' in window) {
      const cleanText = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/•/g, '')
        .replace(/\n+/g, '. ');

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'fr-FR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      speechSynthRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } else {
      setIsSpeaking(false);
    }
  }, [isMuted]);

  // Arrêter la parole
  const stopSpeaking = () => {
    // Arrêter OpenAI audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Arrêter TTS navigateur
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  };

  // Reconnaissance vocale
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
      // Auto-envoyer après reconnaissance
      setTimeout(() => handleSend(transcript), 500);
    };

    recognition.start();
  };

  // Photo handling
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearPhoto = () => {
    setSelectedPhoto(null);
    setPhotoPreview(null);
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
    }
  };

  // Envoyer un message (avec photo optionnelle)
  const handleSend = async (messageText = input) => {
    if ((!messageText.trim() && !selectedPhoto) || isLoading) return;

    stopSpeaking();
    setShowQuickActions(false);

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: messageText.trim() || (selectedPhoto ? '📷 Photo envoyée' : ''),
      photo: photoPreview,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    const photoToSend = selectedPhoto;
    clearPhoto();
    setIsLoading(true);
    setIsSpeaking(true);

    try {
      const response = await aiAssistant.chatWithPhoto(messageText, photoToSend, {
        context,
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

  // Action rapide
  const handleQuickAction = (action) => {
    handleSend(action.prompt);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Chat Panel */}
      <div className="relative w-full sm:max-w-xl h-[85vh] sm:h-[600px] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <AnimatedAvatar
              style={avatarStyle}
              size="sm"
              speaking={isSpeaking}
              onClick={onChangeAvatar}
              className="cursor-pointer hover:scale-110 transition-transform"
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white">{avatar.name}</h3>
                <Sparkles className="w-4 h-4 text-brand-200" />
              </div>
              <p className="text-xs text-brand-200">
                {isLoading ? 'Réflexion...' : isSpeaking ? 'Parle...' : 'En ligne'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
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
                    ? 'bg-brand-600 text-white'
                    : message.isError
                    ? 'bg-red-50 text-red-900 border border-red-200'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {/* Photo attachée */}
                {message.photo && (
                  <div className="mb-2">
                    <img
                      src={message.photo}
                      alt="Photo"
                      className="max-h-48 rounded-lg"
                    />
                  </div>
                )}

                {/* Contenu du message avec markdown basique */}
                {message.content && (
                  <div className="text-sm whitespace-pre-wrap">
                    {message.content.split('\n').map((line, i) => (
                      <p key={i} className={line.startsWith('•') ? 'ml-2' : ''}>
                        {line.split('**').map((part, j) =>
                          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                        )}
                      </p>
                    ))}
                  </div>
                )}

                {/* Actions suggérées */}
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
                        {action.url && <ExternalLink className="w-3 h-3 text-gray-400 ml-auto" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Chart */}
                {message.chart && (
                  <AIChart chart={message.chart} />
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
                            timestamp: new Date()
                          };
                          setMessages(prev => [...prev, resultMessage]);
                        } catch (e) {
                          console.error('Action error:', e);
                        }
                        setIsLoading(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 bg-green-50 text-green-700 rounded-lg text-left text-sm hover:bg-green-100 transition-colors border border-green-200"
                    >
                      <Play className="w-4 h-4" />
                      <span>Exécuter: {message.pendingAction.action}</span>
                    </button>
                  </div>
                )}

                {/* Sources & Documentation */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2">📚 Documentation trouvée :</p>
                    <div className="space-y-2">
                      {message.sources.map((source, i) => (
                        <a
                          key={i}
                          href={source.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 bg-white rounded-lg border hover:bg-blue-50 hover:border-blue-300 transition-colors group"
                        >
                          {source.url?.includes('.pdf') ? (
                            <div className="p-1.5 bg-red-100 rounded">
                              <FileText className="w-4 h-4 text-red-600" />
                            </div>
                          ) : (
                            <div className="p-1.5 bg-blue-100 rounded">
                              <ExternalLink className="w-4 h-4 text-blue-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {source.title || 'Documentation'}
                            </p>
                            {source.url && (
                              <p className="text-xs text-gray-500 truncate">{new URL(source.url).hostname}</p>
                            )}
                          </div>
                          {source.url?.includes('.pdf') && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">PDF</span>
                          )}
                          <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-blue-600 flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provider badge + Timestamp */}
                <div className={`flex items-center justify-between text-xs mt-2 ${
                  message.role === 'user' ? 'text-brand-200' : 'text-gray-400'
                }`}>
                  <span>
                    {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {message.provider && (
                    <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase">
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
                    <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
              <Sparkles className="w-4 h-4 text-brand-500" />
              <span className="text-sm font-medium text-gray-700">Actions rapides</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all hover:scale-105 ${action.color}`}
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
          {/* Photo Preview */}
          {photoPreview && (
            <div className="mb-3 relative inline-block">
              <img
                src={photoPreview}
                alt="Preview"
                className="h-20 rounded-lg"
              />
              <button
                onClick={clearPhoto}
                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

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

            {/* Photo Upload */}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />
            <button
              onClick={() => photoInputRef.current?.click()}
              className="p-3 rounded-xl bg-gray-200 text-gray-600 hover:bg-violet-100 hover:text-violet-600 transition-all"
              title="Ajouter une photo"
              disabled={isLoading}
            >
              <Camera className="w-5 h-5" />
            </button>

            {/* Text Input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={isListening ? 'Je vous écoute...' : selectedPhoto ? 'Décris cette photo...' : `Parlez à ${avatar.name}...`}
              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={isLoading || isListening}
            />

            {/* Send Button */}
            <button
              onClick={() => handleSend()}
              disabled={(!input.trim() && !selectedPhoto) || isLoading}
              className={`p-3 rounded-xl transition-all ${
                (input.trim() || selectedPhoto) && !isLoading
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Context Info */}
          {context && (
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Wrench className="w-3 h-3" />
                {context.totalEquipments || 0} équipements
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {context.upcomingControls || 0} contrôles à venir
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {context.nonConformities || 0} NC
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
