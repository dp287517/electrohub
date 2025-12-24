import { useState, useRef, useEffect } from 'react';
import {
  Play, Camera, Send, X, CheckCircle, AlertTriangle,
  Phone, Loader2, ChevronRight, Shield, StopCircle,
  RefreshCw, HelpCircle
} from 'lucide-react';

const API_BASE = '/api/procedures';

// Fetch helper
async function fetchWithAuth(url, options = {}) {
  const userEmail = localStorage.getItem('userEmail') || '';
  const site = localStorage.getItem('selectedSite') || '';

  const headers = {
    'Content-Type': 'application/json',
    'X-User-Email': userEmail,
    'X-Site': site,
    ...options.headers,
  };

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(error.error || 'Erreur API');
  }
  return response;
}

// Message Component
function AssistantMessage({ message, isUser, photoAnalysis }) {
  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%] bg-violet-600 text-white rounded-2xl rounded-br-md px-4 py-3">
          <p className="text-sm whitespace-pre-wrap">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{message}</p>
        {photoAnalysis && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs font-medium text-blue-700 mb-1">Analyse de la photo:</p>
            <p className="text-sm text-blue-800">{photoAnalysis}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Step Progress Indicator
function StepProgress({ currentStep, totalSteps, isComplete }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          className={`flex-1 h-2 rounded-full transition-all ${
            i + 1 < currentStep ? 'bg-green-500' :
            i + 1 === currentStep ? (isComplete ? 'bg-green-500' : 'bg-violet-500 animate-pulse') :
            'bg-gray-200'
          }`}
        />
      ))}
      <span className="text-sm font-medium text-gray-600 ml-2">
        {currentStep}/{totalSteps}
      </span>
    </div>
  );
}

// Warning Banner
function WarningBanner({ warning }) {
  if (!warning) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-amber-800">{warning}</p>
    </div>
  );
}

// Emergency Stop Banner
function EmergencyBanner({ onStop }) {
  return (
    <div className="bg-red-600 text-white rounded-xl p-4 mb-4 flex items-center gap-3">
      <StopCircle className="w-6 h-6" />
      <div className="flex-1">
        <p className="font-bold">ARRÊT D'URGENCE RECOMMANDÉ</p>
        <p className="text-sm text-red-100">L'IA a détecté un problème de sécurité.</p>
      </div>
      <button
        onClick={onStop}
        className="px-4 py-2 bg-white text-red-600 rounded-lg font-medium hover:bg-red-50"
      >
        Contacter urgence
      </button>
    </div>
  );
}

// Suggested Actions
function SuggestedActions({ actions, onSelect }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onSelect(action)}
          className="px-3 py-2 bg-gray-100 hover:bg-violet-100 text-gray-700 hover:text-violet-700 rounded-full text-sm transition-colors"
        >
          {action}
        </button>
      ))}
    </div>
  );
}

export default function RealtimeAssistant({ procedureId, procedureTitle, onClose }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(0);
  const [isStepComplete, setIsStepComplete] = useState(false);
  const [warning, setWarning] = useState(null);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState([]);
  const [needsPhoto, setNeedsPhoto] = useState(false);
  const [photoAnalysis, setPhotoAnalysis] = useState(null);

  const messagesEndRef = useRef(null);
  const photoInputRef = useRef(null);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Start session on mount
  useEffect(() => {
    startSession();
  }, [procedureId]);

  const startSession = async (initialQuestion = null) => {
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(`${API_BASE}/ai/assist/start`, {
        method: 'POST',
        body: JSON.stringify({ procedureId, initialQuestion }),
      });
      const data = await response.json();

      setSessionId(data.sessionId);
      setTotalSteps(data.totalSteps);
      setCurrentStep(data.currentStepNumber || 1);
      setIsStepComplete(data.isStepComplete || false);
      setWarning(data.warning);
      setEmergencyStop(data.emergencyStop || false);
      setSuggestedActions(data.suggestedActions || []);
      setNeedsPhoto(data.needsPhoto || false);

      setMessages([{ role: 'assistant', content: data.message }]);
    } catch (error) {
      console.error('Error starting session:', error);
      setMessages([{ role: 'assistant', content: "Erreur lors du démarrage de l'assistance. Veuillez réessayer." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (text = input, photoFile = null) => {
    if (!text.trim() && !photoFile) return;
    if (!sessionId) return;

    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setPhotoAnalysis(null);

    try {
      let response;

      if (photoFile) {
        const formData = new FormData();
        formData.append('message', text);
        formData.append('photo', photoFile);

        response = await fetchWithAuth(`${API_BASE}/ai/assist/${sessionId}`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetchWithAuth(`${API_BASE}/ai/assist/${sessionId}`, {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
      }

      const data = await response.json();

      setCurrentStep(data.currentStepNumber || currentStep);
      setIsStepComplete(data.isStepComplete || false);
      setWarning(data.warning);
      setEmergencyStop(data.emergencyStop || false);
      setSuggestedActions(data.suggestedActions || []);
      setNeedsPhoto(data.needsPhoto || false);
      setPhotoAnalysis(data.photoAnalysis);

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.message, photoAnalysis: data.photoAnalysis }
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Erreur de communication. Veuillez réessayer." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      sendMessage("Voici la photo de l'étape actuelle", file);
    }
  };

  const handleEmergencyContact = () => {
    // Could open a modal with emergency contacts or trigger a call
    alert("Contactez les services d'urgence appropriés.");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-b from-gray-50 to-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-2xl flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Play className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Assistance en temps réel</h2>
                <p className="text-sm text-white/80">{procedureTitle}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step Progress */}
          {totalSteps > 0 && (
            <div className="mt-4">
              <StepProgress
                currentStep={currentStep}
                totalSteps={totalSteps}
                isComplete={isStepComplete}
              />
            </div>
          )}
        </div>

        {/* Emergency Banner */}
        {emergencyStop && (
          <div className="px-4 pt-4">
            <EmergencyBanner onStop={handleEmergencyContact} />
          </div>
        )}

        {/* Warning Banner */}
        {warning && !emergencyStop && (
          <div className="px-4 pt-4">
            <WarningBanner warning={warning} />
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.map((msg, i) => (
            <AssistantMessage
              key={i}
              message={msg.content}
              isUser={msg.role === 'user'}
              photoAnalysis={msg.photoAnalysis}
            />
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

        {/* Suggested Actions */}
        {suggestedActions.length > 0 && !isLoading && (
          <div className="px-4 pb-2">
            <SuggestedActions
              actions={suggestedActions}
              onSelect={(action) => sendMessage(action)}
            />
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 border-t bg-white flex-shrink-0">
          <div className="flex gap-2">
            {/* Photo button - highlighted if photo is expected */}
            <button
              onClick={() => photoInputRef.current?.click()}
              className={`p-3 rounded-xl transition-colors ${
                needsPhoto
                  ? 'bg-violet-100 text-violet-600 ring-2 ring-violet-300 animate-pulse'
                  : 'bg-gray-100 text-gray-600 hover:bg-violet-100 hover:text-violet-600'
              }`}
              title={needsPhoto ? "Photo attendue pour cette étape" : "Envoyer une photo"}
            >
              <Camera className="w-5 h-5" />
            </button>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoCapture}
              className="hidden"
            />

            {/* Text input */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
              placeholder="Posez une question ou décrivez ce que vous voyez..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              disabled={isLoading}
            />

            {/* Send button */}
            <button
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              className="p-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => sendMessage("C'est fait, étape suivante")}
              disabled={isLoading}
              className="flex-1 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Étape terminée
            </button>
            <button
              onClick={() => sendMessage("J'ai un problème avec cette étape")}
              disabled={isLoading}
              className="flex-1 py-2 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-200 transition-colors flex items-center justify-center gap-2"
            >
              <HelpCircle className="w-4 h-4" />
              J'ai un problème
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
