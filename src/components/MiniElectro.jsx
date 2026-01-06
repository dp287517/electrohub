// MiniElectro - Assistant IA contextuel pour chaque équipement
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles, MessageCircle, FileText, AlertTriangle, CheckCircle,
  Download, ExternalLink, X, ChevronDown, ChevronUp, Zap,
  Search, Wrench, Calendar, BarChart3, Loader2, RefreshCw,
  BookOpen, Link2, PlusCircle, History, Image, Send
} from 'lucide-react';
import { post, get, API_BASE } from '../lib/api';
import TroubleshootingWizard, { TroubleshootingHistory } from './TroubleshootingWizard';
import { VideoAvatar, AGENT_NAMES } from './AIAvatar/VideoAvatar';

/**
 * MiniElectro - Assistant IA contextuel qui apparaît sur chaque équipement
 * Analyse l'équipement et propose des actions intelligentes
 */
export default function MiniElectro({
  equipment,
  equipmentType = 'generic', // vsd, meca, atex, glo, datahub, hv, mobile, doors, switchboard
  onAction,
  className = ''
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [docSearch, setDocSearch] = useState({ loading: false, results: null, error: null });
  const [showDocSearch, setShowDocSearch] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Chat state - show by default for direct interaction
  const [showChat, setShowChat] = useState(true);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const chatContainerRef = useRef(null);

  // Noms personnalisés des agents (depuis la base de données)
  const [customAgentNames, setCustomAgentNames] = useState(null);

  // Charger les noms personnalisés des agents au montage
  useEffect(() => {
    const fetchAgentNames = async () => {
      try {
        const response = await get('/api/admin/settings/ai-agents/names');
        if (response && typeof response === 'object') {
          setCustomAgentNames(response);
        }
      } catch (error) {
        console.debug('Using default agent names');
      }
    };
    fetchAgentNames();
  }, []);

  // Nom de l'agent pour ce type d'équipement (personnalisé ou par défaut)
  const agentName = customAgentNames?.[equipmentType] || customAgentNames?.main || AGENT_NAMES[equipmentType] || AGENT_NAMES.main;

  // Analyser l'équipement au montage ou quand il change
  const analyzeEquipment = useCallback(async () => {
    if (!equipment) return;

    setIsLoading(true);
    try {
      const response = await post('/api/ai-assistant/analyze-equipment', {
        equipment: {
          id: equipment.id,
          name: equipment.name || equipment.equipment_name,
          manufacturer: equipment.manufacturer || equipment.brand,
          model: equipment.model || equipment.manufacturer_ref,
          type: equipmentType,
          building: equipment.building || equipment.building_code,
          floor: equipment.floor,
          zone: equipment.zone,
          lastControl: equipment.next_check_date || equipment.last_control_date,
          status: equipment.status || equipment.control_status,
          documentationUrl: equipment.documentation_url
        },
        equipmentType
      });

      setAnalysis(response);
    } catch (error) {
      console.error('MiniElectro analysis error:', error);
      // Analyse locale de fallback
      setAnalysis(generateLocalAnalysis(equipment, equipmentType));
    } finally {
      setIsLoading(false);
    }
  }, [equipment, equipmentType]);

  useEffect(() => {
    if (equipment && isExpanded && !analysis) {
      analyzeEquipment();
    }
  }, [equipment, isExpanded, analysis, analyzeEquipment]);

  // Recherche de documentation
  const searchDocumentation = async () => {
    if (!equipment) return;

    const searchQuery = `${equipment.manufacturer || equipment.brand || ''} ${equipment.model || equipment.manufacturer_ref || ''} ${equipment.name || ''} fiche technique PDF`.trim();

    setDocSearch({ loading: true, results: null, error: null });
    setShowDocSearch(true);

    try {
      const response = await post('/api/ai-assistant/execute-action', {
        action: 'searchDoc',
        params: {
          query: searchQuery,
          equipmentId: equipment.id,
          equipmentType
        }
      });

      setDocSearch({
        loading: false,
        results: response,
        error: null
      });
    } catch (error) {
      setDocSearch({
        loading: false,
        results: null,
        error: 'Erreur lors de la recherche'
      });
    }
  };

  // Détecter si l'utilisateur veut créer un dépannage
  const wantsTroubleshooting = (message) => {
    const keywords = ['faire un dépannage', 'créer un dépannage', 'nouveau dépannage', 'signaler un problème', 'déclarer une panne', 'signaler une panne', 'créer une intervention'];
    return keywords.some(k => message.toLowerCase().includes(k));
  };

  // Chat avec l'IA
  const sendChatMessage = async (e) => {
    e?.preventDefault();
    if (!chatMessage.trim() || isSending) return;

    const userMessage = chatMessage.trim();
    setChatMessage('');
    setIsSending(true);

    // Ajouter le message utilisateur à l'historique
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);

    // Si l'utilisateur veut créer un dépannage, on ouvre directement le modal
    if (wantsTroubleshooting(userMessage)) {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: `Je t'ouvre le formulaire de dépannage pour ${equipment.name || equipment.equipment_name || 'cet équipement'} 🔧`,
        actions: [
          { label: '📝 Ouvrir le formulaire', action: 'openTroubleshooting' }
        ]
      }]);
      setIsSending(false);
      // Ouvrir automatiquement le modal après un court délai
      setTimeout(() => setShowTroubleshooting(true), 500);
      return;
    }

    try {
      // Construire les détails complets de l'équipement pour le contexte
      const equipmentDetails = {
        id: equipment.id,
        name: equipment.name || equipment.equipment_name,
        code: equipment.code || equipment.equipment_code,
        type: equipmentType,
        manufacturer: equipment.manufacturer || equipment.brand,
        model: equipment.model || equipment.manufacturer_ref,
        building: equipment.building || equipment.building_code,
        floor: equipment.floor,
        zone: equipment.zone,
        location: equipment.location,
        status: equipment.status || equipment.control_status,
        lastControl: equipment.last_control_date || equipment.next_check_date,
        serialNumber: equipment.serial_number,
        power: equipment.power_kw || equipment.power,
        description: equipment.description
      };

      // Enrichir le message avec le contexte de l'équipement
      const contextualMessage = `[Contexte: Je suis sur l'équipement "${equipmentDetails.name || equipmentDetails.code}" (${equipmentType}) - Bâtiment: ${equipmentDetails.building || 'N/A'}, Étage: ${equipmentDetails.floor || 'N/A'}]\n\nQuestion: ${userMessage}`;

      // Utiliser chat-v2 avec les tools pour des réponses intelligentes
      const response = await post('/api/ai-assistant/chat-v2', {
        message: contextualMessage,
        context: {
          currentEquipment: equipmentDetails,
          equipmentType: equipmentType,
          previousAgentType: equipmentType // Forcer l'agent spécialiste
        },
        conversationHistory: chatHistory.slice(-10).map(m => ({
          role: m.role,
          content: m.content
        }))
      });

      // Ajouter la réponse de l'IA
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: response.message || response.response || 'Désolé, je n\'ai pas pu répondre.',
        agentType: response.agentType || equipmentType,
        actions: response.actions
      }]);

      // Scroll vers le bas
      setTimeout(() => {
        chatContainerRef.current?.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }, 100);
    } catch (error) {
      console.error('Chat error:', error);
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: 'Désolé, une erreur est survenue. Réessaie.'
      }]);
    } finally {
      setIsSending(false);
    }
  };

  // Gérer les actions suggérées
  const handleChatAction = (action) => {
    if (action.action === 'openTroubleshooting') {
      setShowTroubleshooting(true);
    } else if (action.prompt) {
      setChatMessage(action.prompt);
      // Envoyer automatiquement
      setTimeout(() => {
        const fakeEvent = { preventDefault: () => {} };
        sendChatMessage(fakeEvent);
      }, 100);
    } else if (action.url) {
      window.open(action.url, '_blank');
    }
  };

  // Attacher la documentation à l'équipement
  const attachDocumentation = async (docUrl, docTitle) => {
    try {
      await post('/api/ai-assistant/execute-action', {
        action: 'attachDocToEquipments',
        params: {
          docUrl,
          docTitle,
          equipments: [{ id: equipment.id, type: equipmentType, name: equipment.name }]
        }
      });

      // Notifier le parent pour rafraîchir
      onAction?.('docAttached', { docUrl, docTitle });

      setDocSearch(prev => ({
        ...prev,
        results: { ...prev.results, attached: true }
      }));
    } catch (error) {
      console.error('Error attaching doc:', error);
    }
  };

  if (!equipment) return null;

  const hasIssues = analysis?.issues?.length > 0;
  const hasSuggestions = analysis?.suggestions?.length > 0;

  return (
    <div className={`w-full max-w-full bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 rounded-xl border border-indigo-200 overflow-hidden ${className}`}>
      {/* Header - toujours visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <VideoAvatar
              agentType={equipmentType}
              size="sm"
              speaking={isLoading || isSending}
            />
            {hasIssues && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                <span className="text-[10px] text-white font-bold">{analysis.issues.length}</span>
              </span>
            )}
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900 text-sm">{agentName}</p>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Analyse en cours...' :
               hasIssues ? `${analysis.issues.length} point(s) d'attention` :
               'Assistant IA'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isExpanded && hasSuggestions && (
            <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-full">
              {analysis.suggestions.length} suggestion(s)
            </span>
          )}
          {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {/* Contenu expandable */}
      {isExpanded && (
        <div className="px-2 sm:px-4 pb-4 space-y-3 sm:space-y-4 w-full max-w-full overflow-hidden">
          {/* Chat Interface - Direct et visible en premier */}
          {showChat && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden w-full">
              {/* Chat messages */}
              <div
                ref={chatContainerRef}
                className="md:h-52 md:overflow-y-auto p-2 sm:p-3 space-y-2 sm:space-y-3"
              >
                {chatHistory.length === 0 ? (
                  <div className="text-center text-gray-500 text-sm py-3 sm:py-4">
                    <div className="flex justify-center mb-2 sm:mb-3">
                      <VideoAvatar
                        agentType={equipmentType}
                        size="sm"
                        speaking={false}
                      />
                    </div>
                    <p className="font-medium text-gray-700 text-sm sm:text-base">Salut ! Je suis {agentName}</p>
                    <p className="text-xs text-gray-400 mt-1">Pose-moi une question sur cet équipement</p>
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 justify-center mt-3 sm:mt-4">
                      <button
                        onClick={() => setShowTroubleshooting(true)}
                        className="px-2 sm:px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full text-[11px] sm:text-xs font-medium hover:from-orange-600 hover:to-red-600 transition-colors shadow-sm col-span-2 sm:col-span-1"
                      >
                        🔧 Dépannage
                      </button>
                      <button
                        onClick={() => {
                          // Question complète incluant l'état des contrôles
                          const building = equipment?.building || equipment?.building_code;
                          const stateQuestion = building
                            ? `Quel est l'état de cet équipement ? Y a-t-il des contrôles en retard dans le bâtiment ${building} ?`
                            : 'Quel est l\'état de cet équipement ?';
                          setChatMessage(stateQuestion);
                          setTimeout(() => sendChatMessage({ preventDefault: () => {} }), 100);
                        }}
                        className="px-2 sm:px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-full text-[11px] sm:text-xs font-medium transition-colors"
                      >
                        📊 État
                      </button>
                      <button
                        onClick={() => {
                          setChatMessage('Historique des dépannages');
                          setTimeout(() => sendChatMessage({ preventDefault: () => {} }), 100);
                        }}
                        className="px-2 sm:px-3 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-full text-[11px] sm:text-xs font-medium transition-colors"
                      >
                        📋 Historique
                      </button>
                      <button
                        onClick={() => {
                          // Inclure le bâtiment dans la question pour contextualiser
                          const building = equipment?.building || equipment?.building_code;
                          const controlQuestion = building
                            ? `Y a-t-il des contrôles en retard ou à venir pour le bâtiment ${building} ?`
                            : 'Quels sont les contrôles en retard ou à venir ?';
                          setChatMessage(controlQuestion);
                          setTimeout(() => sendChatMessage({ preventDefault: () => {} }), 100);
                        }}
                        className="px-2 sm:px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-full text-[11px] sm:text-xs font-medium transition-colors"
                      >
                        📅 Contrôles
                      </button>
                    </div>
                  </div>
                ) : (
                  chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
                    >
                      {/* Avatar pour les messages assistant */}
                      {msg.role === 'assistant' && (
                        <div className="flex-shrink-0">
                          <VideoAvatar
                            agentType={equipmentType}
                            size="xs"
                            speaking={false}
                          />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                          msg.role === 'user'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {/* Actions suggérées */}
                        {msg.actions && msg.actions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {msg.actions.slice(0, 3).map((action, j) => (
                              <button
                                key={j}
                                onClick={() => handleChatAction(action)}
                                className="px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs"
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {isSending && (
                  <div className="flex justify-start gap-2">
                    <div className="flex-shrink-0">
                      <VideoAvatar
                        agentType={equipmentType}
                        size="xs"
                        speaking={true}
                      />
                    </div>
                    <div className="bg-gray-100 rounded-xl px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <form onSubmit={sendChatMessage} className="border-t border-gray-200 p-1.5 sm:p-2 flex gap-1.5 sm:gap-2">
                <input
                  type="text"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder={`Demande à ${agentName}...`}
                  className="flex-1 px-2 sm:px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-w-0"
                  disabled={isSending}
                />
                <button
                  type="submit"
                  disabled={!chatMessage.trim() || isSending}
                  className="p-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <span className="ml-2 text-sm text-gray-500">Analyse en cours...</span>
            </div>
          ) : (
            <>
              {/* Alertes/Issues */}
              {hasIssues && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Points d'attention</p>
                  {analysis.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
                      <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{issue}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestions intelligentes */}
              {hasSuggestions && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Suggestions</p>
                  {analysis.suggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (suggestion.action === 'searchDoc') {
                          searchDocumentation();
                        } else {
                          onAction?.(suggestion.action, suggestion.params);
                        }
                      }}
                      className="w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-indigo-100 hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                    >
                      <div className={`p-2 rounded-lg ${suggestion.color || 'bg-indigo-100'}`}>
                        {getSuggestionIcon(suggestion.icon)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{suggestion.title}</p>
                        <p className="text-xs text-gray-500 truncate">{suggestion.description}</p>
                      </div>
                      <ChevronDown className="w-4 h-4 text-gray-400 -rotate-90 group-hover:translate-x-1 transition-transform" />
                    </button>
                  ))}
                </div>
              )}

              {/* Recherche Documentation */}
              {showDocSearch && (
                <div className="space-y-3 p-3 bg-white rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">Recherche Documentation</p>
                    <button onClick={() => setShowDocSearch(false)} className="p-1 hover:bg-gray-100 rounded">
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>

                  {docSearch.loading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                      <span className="ml-2 text-sm text-gray-500">Recherche en cours...</span>
                    </div>
                  ) : docSearch.results ? (
                    <div className="space-y-3">
                      {/* Résumé de la recherche */}
                      {docSearch.results.webSearch?.summary && (
                        <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                          <div className="flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm text-green-800 font-medium">Documentation trouvée</p>
                              <p className="text-xs text-green-600 mt-1 line-clamp-3">
                                {docSearch.results.webSearch.summary.substring(0, 200)}...
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Équipements correspondants */}
                      {docSearch.results.matchingCount > 0 && (
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                          <div className="flex items-start gap-2">
                            <Link2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm text-blue-800 font-medium">
                                {docSearch.results.matchingCount} équipement(s) similaire(s) trouvé(s)
                              </p>
                              <p className="text-xs text-blue-600 mt-1">
                                Cette documentation peut être associée à ces équipements
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2">
                        {docSearch.results.webSearch?.sources?.map((source, i) => (
                          <a
                            key={i}
                            href={source.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-full text-xs hover:bg-indigo-200 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Voir la doc
                          </a>
                        ))}

                        {!docSearch.results.attached && (
                          <button
                            onClick={() => attachDocumentation(
                              docSearch.results.webSearch?.sources?.[0]?.url || 'manual',
                              `Documentation ${equipment.model || equipment.name}`
                            )}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs hover:bg-green-200 transition-colors"
                          >
                            <PlusCircle className="w-3 h-3" />
                            Associer à cet équipement
                          </button>
                        )}

                        {docSearch.results.attached && (
                          <span className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-full text-xs">
                            <CheckCircle className="w-3 h-3" />
                            Documentation associée
                          </span>
                        )}
                      </div>
                    </div>
                  ) : docSearch.error ? (
                    <div className="p-3 bg-red-50 rounded-lg">
                      <p className="text-sm text-red-600">{docSearch.error}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Quick Actions */}
              <div className="pt-2 border-t border-indigo-100">
                <div className="flex flex-wrap gap-2">
                  {/* DÉPANNAGE - Action principale */}
                  <button
                    onClick={() => setShowTroubleshooting(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full text-xs font-medium hover:from-orange-600 hover:to-red-600 transition-all shadow-sm"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Dépannage
                  </button>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                      showHistory
                        ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    Historique
                  </button>
                  <button
                    onClick={searchDocumentation}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Chercher doc
                  </button>
                  <button
                    onClick={() => onAction?.('scheduleControl', { equipmentId: equipment.id })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Planifier contrôle
                  </button>
                  <button
                    onClick={analyzeEquipment}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Réanalyser
                  </button>
                </div>
              </div>

              {/* Historique des dépannages */}
              {showHistory && equipment?.id && (
                <div className="pt-3 border-t border-indigo-100">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">
                    Historique des dépannages
                  </p>
                  <TroubleshootingHistory
                    equipmentId={equipment.id}
                    equipmentType={equipmentType}
                    limit={3}
                  />
                </div>
              )}

              {/* Stats rapides */}
              {analysis?.stats && (
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-indigo-100">
                  {Object.entries(analysis.stats).map(([key, value]) => (
                    <div key={key} className="text-center p-2 bg-white rounded-lg">
                      <p className="text-lg font-bold text-indigo-600">{value}</p>
                      <p className="text-[10px] text-gray-500 uppercase">{key}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Wizard de dépannage */}
      <TroubleshootingWizard
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        equipment={equipment}
        equipmentType={equipmentType}
        onSuccess={(record) => {
          onAction?.('troubleshootingCreated', record);
        }}
      />
    </div>
  );
}

// Génère une analyse locale si le backend n'est pas disponible
function generateLocalAnalysis(equipment, type) {
  const issues = [];
  const suggestions = [];
  const stats = {};

  // Vérifier la documentation
  if (!equipment.documentation_url && !equipment.model) {
    issues.push('Documentation technique manquante');
    suggestions.push({
      icon: 'search',
      title: 'Rechercher documentation',
      description: 'Je peux chercher la fiche technique de cet équipement',
      action: 'searchDoc',
      color: 'bg-blue-100'
    });
  }

  // Vérifier les contrôles
  const lastControl = equipment.next_check_date || equipment.last_control_date;
  if (lastControl) {
    const daysSince = Math.floor((new Date() - new Date(lastControl)) / (1000 * 60 * 60 * 24));
    if (daysSince > 365) {
      issues.push(`Dernier contrôle il y a ${daysSince} jours`);
      suggestions.push({
        icon: 'calendar',
        title: 'Planifier un contrôle',
        description: 'Cet équipement nécessite une vérification',
        action: 'scheduleControl',
        color: 'bg-orange-100'
      });
    }
    stats['Jours'] = Math.abs(daysSince);
  }

  // Vérifier le statut
  if (equipment.status === 'non_conforme' || equipment.control_status === 'non_conforme') {
    issues.push('Équipement non conforme');
    suggestions.push({
      icon: 'wrench',
      title: 'Traiter la non-conformité',
      description: 'Action corrective recommandée',
      action: 'treatNC',
      color: 'bg-red-100'
    });
  }

  // Suggestion par défaut si pas de problème
  if (issues.length === 0 && suggestions.length === 0) {
    suggestions.push({
      icon: 'doc',
      title: 'Enrichir les données',
      description: 'Ajouter la documentation technique',
      action: 'searchDoc',
      color: 'bg-indigo-100'
    });
  }

  // Stats basiques selon le type
  if (type === 'vsd') {
    stats['kW'] = equipment.power_kw || equipment.power || '?';
  } else if (type === 'atex') {
    stats['Zone'] = equipment.zone || '?';
  }

  return { issues, suggestions, stats };
}

// Icônes pour les suggestions
function getSuggestionIcon(iconName) {
  const icons = {
    search: <Search className="w-4 h-4 text-blue-600" />,
    calendar: <Calendar className="w-4 h-4 text-orange-600" />,
    wrench: <Wrench className="w-4 h-4 text-red-600" />,
    doc: <FileText className="w-4 h-4 text-indigo-600" />,
    chart: <BarChart3 className="w-4 h-4 text-green-600" />,
    zap: <Zap className="w-4 h-4 text-yellow-600" />,
    book: <BookOpen className="w-4 h-4 text-purple-600" />
  };
  return icons[iconName] || <Sparkles className="w-4 h-4 text-indigo-600" />;
}
