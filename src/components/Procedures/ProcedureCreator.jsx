import { useState, useRef, useEffect } from 'react';
import {
  Send, Camera, Upload, X, Sparkles, AlertTriangle,
  Shield, HardHat, Phone, Link2, CheckCircle, Loader2,
  FileText, ChevronRight, Image, Plus, Trash2
} from 'lucide-react';
import {
  startAISession,
  continueAISession,
  finalizeAISession,
  analyzeDocument,
  analyzeReport,
  DEFAULT_PPE,
  RISK_LEVELS,
} from '../../lib/procedures-api';

// AI Chat Message Component
function ChatMessage({ message, isUser }) {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-violet-600 text-white rounded-br-md'
            : 'bg-gray-100 text-gray-800 rounded-bl-md'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        {message.photo && (
          <div className="mt-2">
            <img
              src={message.photo}
              alt="Photo uploadée"
              className="max-h-40 rounded-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Quick Option Button
function OptionButton({ label, onClick, selected }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-full text-sm font-medium transition-all ${
        selected
          ? 'bg-violet-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-violet-100'
      }`}
    >
      {label}
    </button>
  );
}

export default function ProcedureCreator({ onProcedureCreated, onClose, initialContext }) {
  const [mode, setMode] = useState('choose'); // choose, guided, import, report
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState('init');
  const [collectedData, setCollectedData] = useState({});
  const [options, setOptions] = useState([]);
  const [expectsPhoto, setExpectsPhoto] = useState(false);
  const [procedureReady, setProcedureReady] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  // Auto-start guided mode if launched from chat with context
  useEffect(() => {
    if (initialContext?.initialSubject || initialContext?.userMessage) {
      const initMessage = initialContext.initialSubject
        ? `Je veux créer une procédure pour: ${initialContext.initialSubject}`
        : initialContext.userMessage || 'Je veux créer une nouvelle procédure';
      startGuidedSession(initMessage);
    }
  }, [initialContext]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Start guided session
  const startGuidedSession = async (initialMessage = null) => {
    setIsLoading(true);
    try {
      const response = await startAISession(initialMessage);
      setSessionId(response.sessionId);
      setMessages([
        { role: 'assistant', content: response.message }
      ]);
      setCurrentStep(response.currentStep);
      setOptions(response.options || []);
      setExpectsPhoto(response.expectsPhoto || false);
      setCollectedData(response.collectedData || {});
      setMode('guided');
    } catch (error) {
      console.error('Error starting session:', error);
      setMessages([
        { role: 'assistant', content: "Désolé, une erreur s'est produite. Veuillez réessayer." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Send message in guided session
  const sendMessage = async (messageText = input, photoFile = null) => {
    if (!messageText.trim() && !photoFile) return;
    if (!sessionId) return;

    const userMessage = { role: 'user', content: messageText };
    if (photoFile) {
      userMessage.photo = URL.createObjectURL(photoFile);
    }

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await continueAISession(sessionId, messageText, photoFile);

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: response.message }
      ]);
      setCurrentStep(response.currentStep);
      setOptions(response.options || []);
      setExpectsPhoto(response.expectsPhoto || false);
      setCollectedData(response.collectedData || {});
      setProcedureReady(response.procedureReady || false);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Désolé, une erreur s'est produite. Veuillez réessayer." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle photo upload
  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      sendMessage(`[Photo: ${file.name}]`, file);
    }
  };

  // Finalize and create procedure
  const handleFinalize = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    try {
      const procedure = await finalizeAISession(sessionId);
      if (onProcedureCreated) {
        onProcedureCreated(procedure);
      }
      // Also call onClose with the procedure for chat integration
      if (onClose) {
        onClose(procedure);
      }
    } catch (error) {
      console.error('Error finalizing procedure:', error);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Erreur lors de la création de la procédure. Veuillez réessayer." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle document import for analysis
  const handleDocumentImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsLoading(true);

    try {
      const result = await analyzeDocument(file);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error analyzing document:', error);
      setAnalysisResult({ error: "Impossible d'analyser le document" });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle report import for action list
  const handleReportImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsLoading(true);

    try {
      const result = await analyzeReport(file);
      setAnalysisResult(result);
    } catch (error) {
      console.error('Error analyzing report:', error);
      setAnalysisResult({ error: "Impossible d'analyser le rapport" });
    } finally {
      setIsLoading(false);
    }
  };

  // Create procedure from analysis
  const createFromAnalysis = () => {
    if (!analysisResult) return;

    // Start guided session with pre-filled data
    startGuidedSession(
      `Je veux créer une procédure basée sur cette analyse: ${analysisResult.title || 'Nouvelle procédure'}. ` +
      `Étapes identifiées: ${analysisResult.steps?.length || 0}. ` +
      `EPI requis: ${analysisResult.ppe_required?.join(', ') || 'aucun'}.`
    );
  };

  // Mode Selection Screen
  if (mode === 'choose') {
    return (
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-2xl w-full mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Nouvelle Procédure</h2>
                <p className="text-sm text-white/80">Choisissez comment créer votre procédure</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Options */}
        <div className="p-6 space-y-4">
          {/* Guided AI Creation */}
          <button
            onClick={() => startGuidedSession()}
            className="w-full p-5 bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl border-2 border-violet-200 hover:border-violet-400 transition-all group text-left"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                <Sparkles className="w-6 h-6 text-violet-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  Création guidée avec LIA
                  <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                    RAMS + Méthodo + Procédure
                  </span>
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Titre → Décrivez chaque étape + 📸 photo → LIA génère les 3 documents complets
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-violet-600 transition-colors" />
            </div>
          </button>

          {/* Import existing procedure */}
          <button
            onClick={() => setMode('import')}
            className="w-full p-5 bg-gray-50 rounded-xl border-2 border-gray-200 hover:border-blue-400 transition-all group text-left"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Importer une procédure existante</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Uploadez un document PDF ou texte, l'IA l'analyse et crée une mini-procédure structurée.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
            </div>
          </button>

          {/* Analyze report for actions */}
          <button
            onClick={() => setMode('report')}
            className="w-full p-5 bg-gray-50 rounded-xl border-2 border-gray-200 hover:border-amber-400 transition-all group text-left"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Analyser un rapport</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Uploadez un rapport de contrôle ou d'audit, l'IA génère une liste d'actions correctives.
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-amber-600 transition-colors" />
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Import Document Mode
  if (mode === 'import' || mode === 'report') {
    return (
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-2xl w-full mx-auto">
        {/* Header */}
        <div className={`bg-gradient-to-r ${mode === 'import' ? 'from-blue-600 to-cyan-600' : 'from-amber-500 to-orange-500'} px-6 py-5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                {mode === 'import' ? <Upload className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {mode === 'import' ? 'Importer une procédure' : 'Analyser un rapport'}
                </h2>
                <p className="text-sm text-white/80">
                  {mode === 'import' ? 'L\'IA analysera votre document' : 'L\'IA générera une liste d\'actions'}
                </p>
              </div>
            </div>
            <button
              onClick={() => { setMode('choose'); setAnalysisResult(null); setUploadedFile(null); }}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {!analysisResult ? (
            // Upload zone
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50 transition-all"
              >
                {isLoading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-violet-600 animate-spin" />
                    <p className="text-gray-600">Analyse en cours...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">
                      Cliquez pour sélectionner un fichier
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      PDF, TXT, DOC (max 50 MB)
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.doc,.docx"
                onChange={mode === 'import' ? handleDocumentImport : handleReportImport}
                className="hidden"
              />
            </div>
          ) : (
            // Analysis Result
            <div className="space-y-4">
              {analysisResult.error ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-red-700">{analysisResult.error}</p>
                </div>
              ) : (
                <>
                  {/* Title */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="font-semibold text-gray-900">{analysisResult.title || 'Document analysé'}</h3>
                    {analysisResult.summary && (
                      <p className="text-sm text-gray-600 mt-2">{analysisResult.summary}</p>
                    )}
                  </div>

                  {/* Steps or Actions */}
                  {mode === 'import' && analysisResult.steps?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">Étapes identifiées:</h4>
                      {analysisResult.steps.map((step, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white border rounded-lg p-3">
                          <span className="w-6 h-6 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center text-sm font-medium">
                            {i + 1}
                          </span>
                          <div>
                            <p className="font-medium text-gray-900">{step.title}</p>
                            {step.instructions && (
                              <p className="text-sm text-gray-600">{step.instructions}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {mode === 'report' && analysisResult.actions?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-700">
                        Actions identifiées ({analysisResult.actions.length}):
                      </h4>
                      {analysisResult.actions.map((action, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white border rounded-lg p-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            action.priority === 'high' ? 'bg-red-100 text-red-700' :
                            action.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {action.priority === 'high' ? 'Urgent' : action.priority === 'medium' ? 'Moyen' : 'Faible'}
                          </span>
                          <div className="flex-1">
                            <p className="text-gray-900">{action.action}</p>
                            {action.equipment && (
                              <p className="text-sm text-gray-500">Équipement: {action.equipment}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* PPE */}
                  {analysisResult.ppe_required?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-sm text-gray-600">EPI requis:</span>
                      {analysisResult.ppe_required.map((ppe, i) => (
                        <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                          {ppe}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={createFromAnalysis}
                      className="flex-1 bg-violet-600 text-white rounded-xl py-3 font-medium hover:bg-violet-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      Créer la procédure
                    </button>
                    <button
                      onClick={() => { setAnalysisResult(null); setUploadedFile(null); }}
                      className="px-4 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Réessayer
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Guided Creation Mode
  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-2xl w-full mx-auto flex flex-col" style={{ height: '80vh', maxHeight: '700px' }}>
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">LIA - Création rapide</h2>
              <p className="text-sm text-white/80">
                {currentStep === 'init' && '1/3 - Titre'}
                {currentStep === 'steps' && '2/3 - Étapes'}
                {(currentStep === 'review' || currentStep === 'complete') && '3/3 - Finalisation'}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setMode('choose'); setMessages([]); setSessionId(null); }}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar - Simplified to 3 steps */}
        <div className="mt-3 flex gap-1">
          {['init', 'steps', 'review'].map((step, i) => {
            const stepOrder = ['init', 'steps', 'review'];
            const currentIndex = stepOrder.indexOf(currentStep);
            const isCompleted = currentIndex > i || (currentStep === 'complete');
            const isCurrent = currentStep === step;
            return (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  isCompleted || isCurrent ? 'bg-white' : 'bg-white/30'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} isUser={msg.role === 'user'} />
        ))}

        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Options */}
      {options.length > 0 && !isLoading && (
        <div className="px-4 py-2 border-t flex flex-wrap gap-2">
          {options.map((option, i) => (
            <OptionButton
              key={i}
              label={option}
              onClick={() => sendMessage(option)}
            />
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t flex-shrink-0">
        {procedureReady ? (
          <button
            onClick={handleFinalize}
            disabled={isLoading}
            className="w-full bg-green-600 text-white rounded-xl py-3 font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Créer la procédure
              </>
            )}
          </button>
        ) : (
          <div className="space-y-2">
            {/* Photo requirement hint when in steps mode */}
            {currentStep === 'steps' && (
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg">
                <Camera className="w-3.5 h-3.5" />
                <span>📸 <strong>Photo obligatoire</strong> pour chaque étape - cliquez sur l'icône caméra</span>
              </div>
            )}
            <div className="flex gap-2">
              {/* Always show camera button in steps mode - now required */}
              {(expectsPhoto || currentStep === 'steps') && (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="p-3 bg-amber-100 text-amber-600 rounded-xl hover:bg-amber-200 transition-colors relative animate-pulse"
                  title="Ajouter une photo (obligatoire)"
                >
                  <Camera className="w-5 h-5" />
                  <span className="absolute -top-1 -right-1 text-[10px] bg-amber-500 text-white px-1 rounded font-medium">!</span>
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={
                  currentStep === 'init' ? "Ex: Remplacement disjoncteur, Maintenance moteur..." :
                  currentStep === 'steps' ? "Décrivez l'étape + ajoutez une photo 📸" :
                  currentStep === 'review' ? "Tapez 'oui' pour créer ou modifiez..." :
                  "Votre réponse..."
                }
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={isLoading || !input.trim()}
                className="p-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
