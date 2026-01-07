import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';
import { VideoAvatar } from './VideoAvatar';
import MiniEquipmentPreview from './MiniEquipmentPreview';
import {
  X, Send, Mic, MicOff, Settings,
  AlertTriangle, Calendar, Search, FileText,
  Building, Wrench, Zap, RefreshCw, ChevronDown,
  ExternalLink, CheckCircle, Clock, TrendingUp,
  Volume2, VolumeX, BarChart3, Play, Loader2,
  ClipboardList, Camera, Image, Upload, FileUp, FileSearch,
  ThumbsUp, ThumbsDown, Brain, AlertCircle, TrendingDown,
  MapPin, FlaskConical, ArrowRightLeft, Check
} from 'lucide-react';
import { aiAssistant } from '../../lib/ai-assistant';
import { ProcedureCreator, ProcedureViewer } from '../Procedures';
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

// Quick Actions removed - users should type naturally to the AI

export default function AvatarChat({
  isOpen,
  onClose,
  avatarStyle = 'ai',
  onChangeAvatar
}) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [context, setContext] = useState(null);
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('eh_avatar_muted') === 'true';
  });
  // Photo upload state
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileUploadMode, setFileUploadMode] = useState(null); // 'import-document' | 'analyze-report'
  // Procedure Creator modal
  const [showProcedureCreator, setShowProcedureCreator] = useState(false);
  const [procedureCreatorContext, setProcedureCreatorContext] = useState(null);
  // Procedure Viewer modal
  const [viewProcedureId, setViewProcedureId] = useState(null);
  // Feedback state
  const [feedbackGiven, setFeedbackGiven] = useState({});
  // Predictions state
  const [predictions, setPredictions] = useState(null);
  const [showPredictions, setShowPredictions] = useState(false);
  // User profile
  const [userProfile, setUserProfile] = useState(null);
  // Transfer state
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [transferLoading, setTransferLoading] = useState(false);
  // V2 Mode (Function Calling) toggle
  const [useV2Mode, setUseV2Mode] = useState(() => {
    return aiAssistant.getUseV2();
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const speechSynthRef = useRef(null);
  const photoInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Fallback si le style n'existe plus (migration des anciens styles)
  const safeAvatarStyle = AVATAR_STYLES[avatarStyle] ? avatarStyle : 'ai';
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

  // Message de bienvenue (v3.0 - Full assistant)
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `Salut ! Je suis ${avatar.name}. 👋

**Je peux t'aider à :**
• 🗺️ **Naviguer** dans les bâtiments et plans
• 🔌 **Trouver** un équipement (tableau, VSD, ATEX...)
• 📋 **Procédures** : chercher, créer, guider
• ⚠️ **Analyser** non-conformités et risques
• 📊 **Stats** et brief du matin

Demande-moi n'importe quoi !`,
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
      speak(welcomeMessage.content);
    }
  }, [isOpen, avatarStyle]);

  // Charger le contexte de l'application
  const loadContext = async () => {
    try {
      const [ctx, preds, profile] = await Promise.all([
        aiAssistant.getGlobalContext(),
        aiAssistant.getPredictions(),
        aiAssistant.getUserAIProfile()
      ]);
      setContext(ctx);
      if (preds?.ok) setPredictions(preds.predictions);
      if (profile?.ok) setUserProfile(profile.profile);
    } catch (error) {
      console.error('Erreur chargement contexte:', error);
    }
  };

  // Handle feedback
  const handleFeedback = async (messageId, feedback, userMessage, aiResponse) => {
    if (feedbackGiven[messageId]) return;

    setFeedbackGiven(prev => ({ ...prev, [messageId]: feedback }));

    try {
      await aiAssistant.submitFeedback(messageId, feedback, userMessage, aiResponse);
      // Update the message to show feedback was received
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, feedbackReceived: feedback } : m
      ));
    } catch (error) {
      console.error('Feedback error:', error);
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

  // Toggle V2 Mode (Function Calling)
  const toggleV2Mode = () => {
    const newV2Mode = !useV2Mode;
    setUseV2Mode(newV2Mode);
    aiAssistant.setUseV2(newV2Mode);
    // Show a feedback message in the chat
    const modeMessage = {
      id: Date.now(),
      role: 'assistant',
      content: newV2Mode
        ? `🧪 **Mode Beta IA activé**\n\nJ'utilise maintenant le nouveau système avec Function Calling. Je vais récupérer les données intelligemment selon tes demandes.\n\n⚠️ Le guidage de procédures n'est pas encore supporté dans ce mode.`
        : `✅ **Mode classique activé**\n\nJe reviens au système standard avec toutes les fonctionnalités (guidage, import, etc.).`,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, modeMessage]);
    speak(modeMessage.content);
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

  // File handling for document import / report analysis
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Detect mode from last message expectsFile
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.procedureMode === 'analyze-report') {
        setFileUploadMode('analyze-report');
      } else {
        setFileUploadMode('import-document');
      }
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFileUploadMode(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Mobile keyboard handling - scroll input into view
  // MUST be defined before any early return to follow React hooks rules
  const handleInputFocus = useCallback(() => {
    // Small delay to wait for keyboard animation
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, []);

  // Envoyer un fichier
  const handleSendFile = async () => {
    if (!selectedFile || isLoading) return;

    stopSpeaking();

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: `📄 ${selectedFile.name}`,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const fileToSend = selectedFile;
    const modeToSend = fileUploadMode || 'import-document';
    clearFile();
    setIsLoading(true);
    setIsSpeaking(true);

    try {
      const response = await aiAssistant.uploadFile(fileToSend, modeToSend);

      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        actions: response.actions,
        provider: response.provider,
        importedProcedure: response.importedProcedure,
        reportAnalysis: response.reportAnalysis,
        actionListId: response.actionListId,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      speak(response.message);

    } catch (error) {
      console.error('Erreur upload:', error);
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Erreur lors du traitement du fichier: ${error.message}`,
        isError: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsSpeaking(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Envoyer un message (avec photo optionnelle)
  const handleSend = async (messageText = input) => {
    if ((!messageText.trim() && !selectedPhoto) || isLoading) return;

    stopSpeaking();

    const msgLower = messageText.toLowerCase();

    // >>> L'IA gère maintenant TOUTES les intentions procédures:
    // - Recherche de procédures existantes
    // - Affichage des détails
    // - Guidage étape par étape
    // - Création de nouvelles procédures
    // - Assistance générale

    // >>> DETECTION: Importer un document (reste côté client pour l'instant)
    const wantsImport = (
      (msgLower.includes('import') || msgLower.includes('charger') || msgLower.includes('uploader')) &&
      (msgLower.includes('document') || msgLower.includes('fichier'))
    );

    if (wantsImport) {
      setProcedureCreatorContext({ mode: 'import' });
      setShowProcedureCreator(true);
      setInput('');
      return;
    }

    // >>> Tout le reste va à l'IA backend
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
      // Trouver le dernier agent utilisé dans la conversation
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      const previousAgentType = lastAssistantMessage?.agentType || 'main';

      const response = await aiAssistant.chatWithPhoto(messageText, photoToSend, {
        context: {
          ...context,
          previousAgentType // Passer l'agent précédent pour garder le contexte
        },
        conversationHistory: messages.slice(-10)
      });

      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        agentType: response.agentType || 'main', // Agent qui répond (pour vidéo avatar)
        actions: response.actions,
        sources: response.sources,
        chart: response.chart,
        pendingAction: response.pendingAction,
        provider: response.provider,
        model: response.model,
        // ===============================
        // NAVIGATION INTEGRATION
        // ===============================
        navigationMode: response.navigationMode,
        navigateTo: response.navigateTo,
        buildingCode: response.buildingCode,
        floor: response.floor,
        equipmentList: response.equipmentList,
        // ===============================
        // MAP LOCATION INTEGRATION
        // ===============================
        showMap: response.showMap,
        locationEquipment: response.locationEquipment,
        locationEquipmentType: response.locationEquipmentType,
        locationControlStatus: response.locationControlStatus,
        // ===============================
        // PROCEDURE INTEGRATION (v2.0)
        // ===============================
        proceduresFound: response.proceduresFound,
        procedureToOpen: response.procedureToOpen,
        procedureDetails: response.procedureDetails,
        procedureGuidance: response.procedureGuidance,
        openProcedureCreator: response.openProcedureCreator,
        procedureCreatorContext: response.procedureCreatorContext,
        // Legacy procedure fields
        procedureSessionId: response.procedureSessionId,
        procedureStep: response.procedureStep,
        expectsPhoto: response.expectsPhoto,
        procedureReady: response.procedureReady,
        procedureId: response.procedureId,
        procedureMode: response.procedureMode,
        pdfUrl: response.pdfUrl,
        // File upload mode
        expectsFile: response.expectsFile,
        importedProcedure: response.importedProcedure,
        reportAnalysis: response.reportAnalysis,
        // ===============================
        // TROUBLESHOOTING TRANSFER
        // ===============================
        transferData: response.transferData,
        transferCandidates: response.transferCandidates,
        showTransferConfirmation: response.showTransferConfirmation,
        showTransferCandidates: response.showTransferCandidates,
        transferComplete: response.transferComplete,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      speak(response.message);

      // 📝 OPEN PROCEDURE CREATOR - When AI detects create intent
      if (response.openProcedureCreator) {
        console.log('[AI Chat] Opening procedure creator:', response.procedureCreatorContext);
        setTimeout(() => {
          setProcedureCreatorContext(response.procedureCreatorContext || {});
          setShowProcedureCreator(true);
        }, 800); // Delay to let user see the message
      }

      // 📋 OPEN PROCEDURE VIEWER - When procedure details are available
      if (response.procedureToOpen?.id) {
        console.log('[AI Chat] Opening procedure modal:', response.procedureToOpen);
        setTimeout(() => {
          setViewProcedureId(response.procedureToOpen.id);
        }, 500); // Small delay to let user see the message
      }

      // Si un PDF est disponible, on pourrait l'ouvrir automatiquement
      if (response.pdfUrl && response.procedureComplete) {
        // Optionnel: ouvrir le PDF dans un nouvel onglet
        // window.open(response.pdfUrl, '_blank');
      }

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


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Chat Panel - Uses dvh for mobile keyboard support */}
      <div className="relative w-full sm:max-w-xl h-[100dvh] sm:h-[600px] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}>
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <VideoAvatar
              style={avatarStyle}
              size="sm"
              speaking={isSpeaking || isLoading}
              onClick={onChangeAvatar}
              className="cursor-pointer hover:scale-110 transition-transform"
              fallbackToAnimated={true}
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white">{avatar.name}</h3>
                <Zap className="w-4 h-4 text-brand-200" />
              </div>
              <p className="text-xs text-brand-200">
                {isLoading ? 'Réflexion...' : isSpeaking ? 'Parle...' : useV2Mode ? '🧪 Mode Beta' : 'En ligne'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* V2 Beta Mode Toggle */}
            <button
              onClick={toggleV2Mode}
              className={`p-2 rounded-lg transition-colors relative ${
                useV2Mode ? 'bg-purple-500/30' : 'hover:bg-white/10'
              }`}
              title={useV2Mode ? 'Mode Beta IA actif - Cliquer pour désactiver' : 'Activer Mode Beta IA'}
            >
              <FlaskConical className={`w-5 h-5 ${useV2Mode ? 'text-purple-300' : 'text-white'}`} />
              {useV2Mode && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                  V2
                </span>
              )}
            </button>

            {/* Predictions Button */}
            {predictions?.risks?.high > 0 && (
              <button
                onClick={() => setShowPredictions(!showPredictions)}
                className={`p-2 rounded-lg transition-colors relative ${
                  showPredictions ? 'bg-orange-500/30' : 'hover:bg-white/10'
                }`}
                title="Voir les prédictions"
              >
                <Brain className="w-5 h-5 text-white" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {predictions.risks.high}
                </span>
              </button>
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

        {/* Predictions Panel */}
        {showPredictions && predictions && (
          <div className="bg-gradient-to-r from-orange-50 to-red-50 px-4 py-3 border-b border-orange-200 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-orange-600" />
                <h4 className="font-semibold text-orange-800">Prédictions IA</h4>
              </div>
              <button
                onClick={() => setShowPredictions(false)}
                className="p-1 hover:bg-orange-200 rounded"
              >
                <X className="w-4 h-4 text-orange-600" />
              </button>
            </div>

            {/* Risk Summary */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                <div className="text-2xl font-bold text-red-600">{predictions.risks?.high || 0}</div>
                <div className="text-xs text-gray-500">Risque élevé</div>
              </div>
              <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                <div className="text-2xl font-bold text-orange-500">{predictions.risks?.medium || 0}</div>
                <div className="text-xs text-gray-500">Risque moyen</div>
              </div>
              <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                <div className="text-2xl font-bold text-blue-600">{predictions.maintenance?.totalNext30Days || 0}</div>
                <div className="text-xs text-gray-500">Contrôles 30j</div>
              </div>
            </div>

            {/* Top Risks */}
            {predictions.risks?.list?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-orange-700">Équipements à risque:</p>
                {predictions.risks.list.slice(0, 3).map((risk, i) => (
                  <div key={i} className="flex items-center justify-between bg-white rounded p-2 text-sm shadow-sm">
                    <div className="flex items-center gap-2">
                      <AlertCircle className={`w-4 h-4 ${
                        parseFloat(risk.riskScore) >= 0.7 ? 'text-red-500' : 'text-orange-500'
                      }`} />
                      <span className="font-medium truncate max-w-[150px]">{risk.name}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      parseFloat(risk.riskScore) >= 0.7
                        ? 'bg-red-100 text-red-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {(parseFloat(risk.riskScore) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => handleSend("Montre-moi l'analyse des risques complète")}
                  className="w-full text-center text-xs text-orange-600 hover:text-orange-800 py-1"
                >
                  Voir tous les risques →
                </button>
              </div>
            )}

            {/* Workload Recommendation */}
            {predictions.maintenance?.recommendation && (
              <div className="mt-2 p-2 bg-white rounded-lg text-sm shadow-sm">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-blue-500" />
                  <span>{predictions.maintenance.recommendation}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Agent Avatar for assistant messages */}
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 pt-1">
                  <VideoAvatar
                    agentType={message.agentType || 'main'}
                    size="xs"
                    speaking={isSpeaking && message.id === messages[messages.length - 1]?.id}
                    showAgentName={false}
                  />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
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

                {/* Contenu du message avec markdown amélioré */}
                {message.content && (
                  <div className="text-sm space-y-1">
                    {message.content.split('\n').map((line, i) => {
                      // Ligne vide
                      if (!line.trim()) return <div key={i} className="h-2" />;

                      // Titre avec emoji (ex: "🔧 Dernier dépannage")
                      const isTitle = /^[🔧⚠️✅❌📋📊🎯💡🔍📍➡️🚨📈📉🏭⚡🔌💾🛠️🔒🚪📦🌡️]+\s*\*\*/.test(line);

                      // Déterminer le style de ligne
                      const isBullet = line.trim().startsWith('•') || line.trim().startsWith('-');
                      const isNumbered = /^\d+[\.\)]\s/.test(line.trim());

                      // Parser le markdown inline
                      const parseInlineMarkdown = (text) => {
                        const parts = [];
                        let remaining = text;
                        let keyIndex = 0;

                        while (remaining.length > 0) {
                          // Chercher **bold**
                          const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
                          if (boldMatch && boldMatch.index !== undefined) {
                            // Texte avant le bold
                            if (boldMatch.index > 0) {
                              parts.push(<span key={keyIndex++}>{remaining.slice(0, boldMatch.index)}</span>);
                            }
                            // Le texte bold
                            parts.push(<strong key={keyIndex++} className="font-semibold">{boldMatch[1]}</strong>);
                            remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
                          } else {
                            // Pas de markdown, ajouter le reste
                            parts.push(<span key={keyIndex++}>{remaining}</span>);
                            break;
                          }
                        }
                        return parts;
                      };

                      return (
                        <p
                          key={i}
                          className={`${isBullet ? 'ml-3 flex items-start gap-2' : ''} ${isNumbered ? 'ml-2' : ''} ${isTitle ? 'font-medium text-gray-800' : ''}`}
                        >
                          {isBullet && <span className="text-brand-500 mt-0.5">•</span>}
                          <span>{parseInlineMarkdown(isBullet ? line.trim().replace(/^[•-]\s*/, '') : line)}</span>
                        </p>
                      );
                    })}
                  </div>
                )}

                {/* Navigation Mode - Quick access button */}
                {message.navigationMode && message.navigateTo && (
                  <div className="mt-3 p-3 bg-gradient-to-r from-brand-50 to-blue-50 rounded-lg border border-brand-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-brand-100 rounded-lg">
                        <Building className="w-5 h-5 text-brand-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-brand-700">
                          {message.buildingCode ? `Bâtiment ${message.buildingCode}` : 'Équipements trouvés'}
                        </p>
                        <p className="text-xs text-brand-600">
                          {message.equipmentList?.length || 0} équipement(s)
                          {message.floor ? ` • Étage ${message.floor}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          console.log('[AI Chat] Quick navigation to:', message.navigateTo);
                          onClose?.();
                          navigate(message.navigateTo);
                        }}
                        className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors flex items-center gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Voir
                      </button>
                    </div>
                  </div>
                )}

                {/* Map Location Preview - Shows equipment on floor plan (works for all equipment types) */}
                {message.showMap && message.locationEquipment && (
                  <div className="mt-3">
                    <MiniEquipmentPreview
                      equipment={message.locationEquipment}
                      equipmentType={message.locationEquipmentType || 'switchboard'}
                      controlStatus={message.locationControlStatus}
                      onClose={onClose}
                    />
                  </div>
                )}

                {/* Actions suggérées */}
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <p className="text-xs font-medium text-gray-500">Actions suggérées :</p>
                    {message.actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          // Handle different action types
                          if (action.type === 'navigate' && action.navigateTo) {
                            // Navigate to the specified path and close the chat
                            console.log('[AI Chat] Navigating to:', action.navigateTo);
                            onClose?.();
                            navigate(action.navigateTo);
                          } else if (action.type === 'equipment' && action.equipment?.id) {
                            // Navigate to equipment details
                            console.log('[AI Chat] Navigating to equipment:', action.equipment);
                            onClose?.();
                            navigate(`/app/switchboards?switchboard=${action.equipment.id}`);
                          } else if (action.prompt) {
                            // Regular chat action - send the prompt
                            handleSend(action.prompt);
                          } else {
                            handleSend(action.label);
                          }
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors border ${
                          action.type === 'navigate'
                            ? 'bg-brand-50 border-brand-200 hover:bg-brand-100 text-brand-700'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        {action.type === 'navigate' ? (
                          <ExternalLink className="w-4 h-4 text-brand-500 shrink-0" />
                        ) : action.type === 'equipment' ? (
                          <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                        )}
                        <span>{action.label}</span>
                        {(action.type === 'navigate' || action.url) && (
                          <ExternalLink className="w-3 h-3 text-gray-400 ml-auto" />
                        )}
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

                {/* Transfer Confirmation UI */}
                {message.showTransferConfirmation && message.transferData && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="p-4 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 rounded-xl border border-amber-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-amber-100 rounded-lg">
                          <ArrowRightLeft className="w-4 h-4 text-amber-600" />
                        </div>
                        <p className="text-sm font-semibold text-amber-900">Transfert de dépannage</p>
                      </div>

                      <div className="space-y-3 mb-4">
                        <div className="flex items-center gap-3 p-2 bg-white/60 rounded-lg">
                          <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full text-gray-400">
                            <Wrench className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500">Depuis</p>
                            <p className="font-medium text-gray-700 truncate">{message.transferData.sourceEquipment}</p>
                            <p className="text-xs text-gray-400">{message.transferData.sourceBuilding || 'N/A'}</p>
                          </div>
                        </div>

                        <div className="flex justify-center">
                          <div className="p-1 bg-amber-200 rounded-full">
                            <ArrowRightLeft className="w-3 h-3 text-amber-700" />
                          </div>
                        </div>

                        <div className="flex items-center gap-3 p-2 bg-white/80 rounded-lg border border-amber-200">
                          <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-full text-amber-600">
                            <Wrench className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-amber-600 font-medium">Vers</p>
                            <p className="font-semibold text-amber-800 truncate">{message.transferData.targetEquipmentName}</p>
                            <p className="text-xs text-amber-600">{message.transferData.targetBuilding || 'N/A'}</p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          setTransferLoading(true);
                          try {
                            const response = await aiAssistant.chat(
                              `Confirme le transfert du dépannage vers ${message.transferData.targetEquipmentName}`,
                              {
                                context: {
                                  ...context,
                                  transferAction: {
                                    action: 'confirm_troubleshooting_transfer',
                                    params: {
                                      troubleshooting_id: message.transferData.troubleshootingId,
                                      target_equipment_id: message.transferData.targetEquipmentId,
                                      target_equipment_type: message.transferData.targetEquipmentType,
                                      target_equipment_name: message.transferData.targetEquipmentName,
                                      target_building: message.transferData.targetBuilding
                                    }
                                  }
                                },
                                conversationHistory: messages.slice(-10)
                              }
                            );

                            const resultMessage = {
                              id: Date.now(),
                              role: 'assistant',
                              content: response.message || '✅ Transfert effectué !',
                              transferComplete: true,
                              timestamp: new Date()
                            };
                            setMessages(prev => [...prev, resultMessage]);
                            speak(resultMessage.content);
                          } catch (e) {
                            console.error('Transfer error:', e);
                            const errorMessage = {
                              id: Date.now(),
                              role: 'assistant',
                              content: `❌ Erreur lors du transfert: ${e.message}`,
                              isError: true,
                              timestamp: new Date()
                            };
                            setMessages(prev => [...prev, errorMessage]);
                          }
                          setTransferLoading(false);
                        }}
                        disabled={transferLoading}
                        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {transferLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Transfert en cours...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Confirmer le transfert</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Transfer Candidates Selection UI */}
                {message.showTransferCandidates && message.transferCandidates && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2">🎯 Sélectionne l'équipement cible :</p>
                    <div className="space-y-2">
                      {message.transferCandidates.map((candidate, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(`C'est ${candidate.name} (${candidate.type_label || candidate.type}) dans le bâtiment ${candidate.building || 'principal'}`)}
                          className="flex items-center gap-3 w-full px-3 py-2.5 bg-white rounded-xl text-left text-sm hover:bg-amber-50 hover:border-amber-300 transition-all border shadow-sm hover:shadow"
                        >
                          <div className="p-2 bg-gradient-to-br from-amber-100 to-orange-100 rounded-lg">
                            <Wrench className="w-4 h-4 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{candidate.name}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{candidate.type_label || candidate.type}</span>
                              <span>•</span>
                              <span>{candidate.building || 'N/A'}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-amber-600">
                            <span className="text-xs">Sélectionner</span>
                            <ArrowRightLeft className="w-4 h-4" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transfer Complete Badge */}
                {message.transferComplete && (
                  <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    <CheckCircle className="w-3 h-3" />
                    Transfert effectué
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

                {/* Provider badge + Timestamp + Feedback */}
                <div className={`flex items-center justify-between text-xs mt-2 ${
                  message.role === 'user' ? 'text-brand-200' : 'text-gray-400'
                }`}>
                  <span>
                    {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Feedback buttons for assistant messages */}
                    {message.role === 'assistant' && !message.isError && (
                      <div className="flex items-center gap-1 ml-2">
                        {message.feedbackReceived ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            message.feedbackReceived === 'positive'
                              ? 'bg-green-100 text-green-600'
                              : 'bg-orange-100 text-orange-600'
                          }`}>
                            {message.feedbackReceived === 'positive' ? '👍 Utile' : '👎 Noté'}
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                const prevMsg = messages.find(m => m.id === message.id - 1);
                                handleFeedback(message.id, 'positive', prevMsg?.content, message.content);
                              }}
                              className="p-1 hover:bg-green-100 rounded transition-colors group"
                              title="Réponse utile"
                            >
                              <ThumbsUp className="w-3 h-3 text-gray-400 group-hover:text-green-600" />
                            </button>
                            <button
                              onClick={() => {
                                const prevMsg = messages.find(m => m.id === message.id - 1);
                                handleFeedback(message.id, 'negative', prevMsg?.content, message.content);
                              }}
                              className="p-1 hover:bg-orange-100 rounded transition-colors group"
                              title="Réponse à améliorer"
                            >
                              <ThumbsDown className="w-3 h-3 text-gray-400 group-hover:text-orange-600" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
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

        {/* Input Area - with safe-area padding for iOS */}
        <div className="p-4 border-t bg-gray-50 shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {/* Procedure Guidance Indicator */}
          {messages.some(m => m.procedureGuidance?.active) && (
            <div className="mb-3 p-2 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="animate-pulse">⚡</span>
                <span className="text-sm font-medium text-violet-700">
                  Mode guidage actif
                </span>
                {(() => {
                  const lastGuidance = messages.filter(m => m.procedureGuidance?.active).pop()?.procedureGuidance;
                  return lastGuidance ? (
                    <span className="text-xs text-violet-500">
                      • Étape {lastGuidance.currentStep}/{lastGuidance.totalSteps}
                    </span>
                  ) : null;
                })()}
              </div>
              <button
                onClick={() => handleSend("Arrêter le guidage")}
                className="text-xs text-gray-500 hover:text-red-500 transition-colors"
              >
                Arrêter
              </button>
            </div>
          )}

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

          {/* File Preview */}
          {selectedFile && (
            <div className="mb-3 flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-blue-800 flex-1 truncate">{selectedFile.name}</span>
              <button
                onClick={handleSendFile}
                disabled={isLoading}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Envoyer'}
              </button>
              <button
                onClick={clearFile}
                className="p-1 text-red-500 hover:bg-red-100 rounded"
              >
                <X className="w-4 h-4" />
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

            {/* File Upload (documents/reports) */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.xls,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-gray-200 text-gray-600 hover:bg-blue-100 hover:text-blue-600 transition-all"
              title="Importer un document"
              disabled={isLoading}
            >
              <Upload className="w-5 h-5" />
            </button>

            {/* Text Input - 16px min to prevent iOS zoom */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onFocus={handleInputFocus}
              placeholder={isListening ? 'Je vous écoute...' : selectedPhoto ? 'Décris cette photo...' : `Parlez à ${avatar.name}...`}
              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base"
              style={{ fontSize: '16px' }}
              disabled={isLoading || isListening}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
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

      {/* ProcedureCreator Modal - Ouvre quand l'utilisateur veut créer/importer une procédure */}
      {showProcedureCreator && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end lg:items-center justify-center z-[60]">
          <div className="w-full lg:max-w-lg lg:mx-4 overflow-hidden bg-white rounded-t-3xl lg:rounded-2xl lg:shadow-2xl animate-slide-up lg:animate-scale-in">
          <ProcedureCreator
            initialContext={procedureCreatorContext}
            onProcedureCreated={(procedure) => {
              setShowProcedureCreator(false);
              setProcedureCreatorContext(null);
              // Ajouter un message de confirmation
              const successMessage = {
                id: Date.now(),
                role: 'assistant',
                content: `✅ **Procédure créée !**\n\n📋 **${procedure.title}**\n\n[📥 Télécharger le PDF](/api/procedures/${procedure.id}/pdf)\n\nJe l'ai sauvegardée. Tu peux me demander de la relire ou de te guider !`,
                actions: [
                  { label: 'Télécharger PDF', url: `/api/procedures/${procedure.id}/pdf` },
                  { label: 'Voir mes procédures', prompt: 'Montre-moi mes procédures' }
                ],
                timestamp: new Date()
              };
              setMessages(prev => [...prev, successMessage]);
              speak(successMessage.content);
            }}
            onClose={() => {
              setShowProcedureCreator(false);
              setProcedureCreatorContext(null);
            }}
          />
          </div>
        </div>
      )}

      {/* ProcedureViewer Modal - Ouvre quand l'IA trouve une procédure */}
      {viewProcedureId && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <ProcedureViewer
            procedureId={viewProcedureId}
            onClose={() => setViewProcedureId(null)}
            isMobile={true}
          />
        </div>
      )}
    </div>
  );
}
