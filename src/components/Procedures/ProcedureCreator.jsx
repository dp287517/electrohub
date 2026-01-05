import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Camera, Upload, X, Sparkles, AlertTriangle,
  Shield, HardHat, Phone, Link2, CheckCircle, Loader2,
  FileText, ChevronRight, Image, Plus, Trash2, Save, Clock,
  LayoutGrid
} from 'lucide-react';
import { useProcedureCapture } from '../../contexts/ProcedureCaptureContext';
import {
  startAISession,
  continueAISession,
  finalizeAISession,
  processAISession,
  analyzeDocument,
  analyzeReport,
  saveDraft,
  getDrafts,
  resumeDraft,
  deleteDraft,
  cleanupOrphanDrafts,
  uploadPendingPhoto,
  getPendingPhotos,
  deletePendingPhoto,
  clearPendingPhotos,
  getPendingPhotoUrl,
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
  const {
    isCapturing,
    captureCount,
    startCapture,
    consumeCaptures,
    procedureInfo,
    shouldReopenModal
  } = useProcedureCapture();

  const [mode, setMode] = useState('choose'); // choose, guided, import, report, drafts
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
  const [serverPendingPhotos, setServerPendingPhotos] = useState([]); // Photos saved on server
  const [uploadingPhoto, setUploadingPhoto] = useState(false); // Photo upload in progress
  const [isProcessing, setIsProcessing] = useState(false); // Quality processing in progress
  const [pendingCaptures, setPendingCaptures] = useState([]); // Captures from widget (will be uploaded)

  // Draft management
  const [draftId, setDraftId] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);

  // CRITICAL: Persist active session to localStorage to survive app minimize/refresh
  useEffect(() => {
    if (sessionId && mode === 'guided') {
      const activeSession = {
        sessionId,
        draftId,
        mode,
        collectedData,
        currentStep,
        timestamp: Date.now()
      };
      localStorage.setItem('activeProcedureSession', JSON.stringify(activeSession));
      console.log('[ProcedureCreator] Saved active session to localStorage:', sessionId);
    }
  }, [sessionId, draftId, mode, collectedData, currentStep]);

  // CRITICAL: Restore active session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem('activeProcedureSession');
    if (savedSession && mode === 'choose') {
      try {
        const session = JSON.parse(savedSession);
        // Only restore if session is less than 24 hours old
        if (session.sessionId && (Date.now() - session.timestamp) < 24 * 60 * 60 * 1000) {
          console.log('[ProcedureCreator] Restoring session from localStorage:', session.sessionId);
          setSessionId(session.sessionId);
          setDraftId(session.draftId);
          setMode(session.mode || 'guided');
          setCollectedData(session.collectedData || {});
          setCurrentStep(session.currentStep || 'steps');

          // Build restoration message with last step info
          const rawSteps = session.collectedData?.raw_steps || [];
          const stepsCount = rawSteps.length;
          const lastStep = rawSteps[rawSteps.length - 1];

          let restorationMessage = `📋 **"${session.collectedData?.title || 'Procédure en cours'}"**\n\n`;
          restorationMessage += `✅ ${stepsCount} étape(s) enregistrée(s)\n\n`;

          if (lastStep) {
            const lastStepDesc = lastStep.raw_text || lastStep.title || 'Étape sans description';
            const truncated = lastStepDesc.length > 60 ? lastStepDesc.substring(0, 60) + '...' : lastStepDesc;
            restorationMessage += `📸 Dernière étape: "${truncated}"`;
            if (lastStep.has_photo || lastStep.photo) {
              restorationMessage += ` (avec photo)`;
            }
            restorationMessage += `\n\n`;
          }

          restorationMessage += `➡️ Continuez à ajouter des étapes ou dites "terminé".`;

          setMessages([{
            role: 'assistant',
            content: restorationMessage,
            photo: lastStep?.photo // Include photo URL if available
          }]);
        }
      } catch (e) {
        console.error('Error restoring session:', e);
        localStorage.removeItem('activeProcedureSession');
      }
    }
  }, []);

  // Clear localStorage when procedure is completed or modal closed
  const clearActiveSession = useCallback(() => {
    localStorage.removeItem('activeProcedureSession');
    console.log('[ProcedureCreator] Cleared active session from localStorage');
  }, []);

  // FIX: Restore state when modal is reopened after photo capture
  useEffect(() => {
    if (shouldReopenModal && procedureInfo) {
      console.log('[ProcedureCreator] Restoring state from capture session:', procedureInfo);
      // Restore the session state
      if (procedureInfo.sessionId) setSessionId(procedureInfo.sessionId);
      if (procedureInfo.draftId) setDraftId(procedureInfo.draftId);
      if (procedureInfo.mode) setMode(procedureInfo.mode);
      if (procedureInfo.collectedData) setCollectedData(procedureInfo.collectedData);
      if (procedureInfo.messages) setMessages(procedureInfo.messages);
      if (procedureInfo.currentStep) setCurrentStep(procedureInfo.currentStep);
    }
  }, [shouldReopenModal, procedureInfo]);

  // Check for captured photos when returning from capture mode
  useEffect(() => {
    if (!isCapturing && captureCount > 0 && (mode === 'guided' || procedureInfo?.mode === 'guided')) {
      // User returned with captures - consume and upload them
      const newCaptures = consumeCaptures();
      if (newCaptures.length > 0) {
        console.log('[ProcedureCreator] Consuming and uploading captures:', newCaptures.length);
        setPendingCaptures(newCaptures);
        // Upload all captures to server immediately
        (async () => {
          for (const capture of newCaptures) {
            if (capture.file) {
              await uploadPhotoToServer(capture.file);
            }
          }
          // Clear local captures after upload
          setPendingCaptures([]);
        })();
      }
    }
  }, [isCapturing, captureCount, mode, consumeCaptures, procedureInfo]);

  // Open multi-photo capture mode
  const handleOpenMultiCapture = () => {
    startCapture({
      id: sessionId || draftId,
      sessionId: sessionId,
      draftId: draftId,
      title: collectedData?.title || 'Nouvelle procédure',
      mode: mode,
      collectedData: collectedData,
      messages: messages,
      currentStep: currentStep,
      returnPath: '/app/procedures'
    });
  };

  // Load drafts on mount
  useEffect(() => {
    loadDrafts();
  }, []);

  // Load pending photos from server when session starts
  useEffect(() => {
    if (sessionId || draftId) {
      loadPendingPhotos();
    }
  }, [sessionId, draftId]);

  const loadPendingPhotos = async () => {
    try {
      const result = await getPendingPhotos(sessionId, draftId);
      if (result.ok !== false && result.photos) {
        setServerPendingPhotos(result.photos);
        console.log(`[ProcedureCreator] Loaded ${result.photos.length} pending photos from server`);
      }
    } catch (e) {
      console.error('Error loading pending photos:', e);
    }
  };

  // Upload photo immediately to server
  const uploadPhotoToServer = async (file) => {
    if (!file) return null;
    setUploadingPhoto(true);
    try {
      const result = await uploadPendingPhoto(file, sessionId, draftId);
      if (result.ok !== false && result.photo) {
        setServerPendingPhotos(prev => [...prev, result.photo]);
        console.log(`[ProcedureCreator] Photo uploaded to server: ${result.photo.id}`);
        return result.photo;
      }
    } catch (e) {
      console.error('Error uploading photo:', e);
      alert('Erreur lors de l\'upload de la photo. Veuillez réessayer.');
    } finally {
      setUploadingPhoto(false);
    }
    return null;
  };

  // Delete pending photo from server
  const removeServerPhoto = async (photoId) => {
    try {
      await deletePendingPhoto(photoId);
      setServerPendingPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (e) {
      console.error('Error deleting photo:', e);
    }
  };

  // Auto-save when collectedData changes (debounced)
  useEffect(() => {
    if (!sessionId || !collectedData || Object.keys(collectedData).length === 0) return;

    const saveTimer = setTimeout(() => {
      autoSaveDraft();
    }, 2000); // Save 2 seconds after last change

    return () => clearTimeout(saveTimer);
  }, [collectedData, sessionId]);

  // Load user's drafts (with automatic orphan cleanup)
  const loadDrafts = async () => {
    try {
      // First, cleanup any orphan drafts (drafts whose procedures are already approved)
      try {
        const cleanup = await cleanupOrphanDrafts();
        if (cleanup.cleaned > 0) {
          console.log(`[Drafts] Cleaned ${cleanup.cleaned} orphan drafts:`, cleanup.drafts);
        }
      } catch (cleanupErr) {
        console.warn('[Drafts] Orphan cleanup failed:', cleanupErr.message);
      }

      // Then load remaining drafts
      const result = await getDrafts();
      if (result.ok !== false) {
        setDrafts(Array.isArray(result) ? result : result.drafts || []);
      }
    } catch (error) {
      console.error('Error loading drafts:', error);
    }
  };

  // Auto-save current progress as draft
  const autoSaveDraft = useCallback(async () => {
    if (!collectedData || Object.keys(collectedData).length === 0) return;

    setIsSaving(true);
    try {
      const draftData = {
        id: draftId,
        title: collectedData.title || 'Brouillon en cours',
        description: collectedData.description || '',
        category: collectedData.category || 'general',
        risk_level: collectedData.risk_level || 'low',
        steps: collectedData.steps || [],
        raw_steps: collectedData.raw_steps || [], // CRITICAL: Save raw_steps to persist user's work
        ppe: collectedData.ppe || [],
        equipment_links: collectedData.equipment_links || [],
        session_id: sessionId
      };

      const result = await saveDraft(draftData);
      if (result.ok !== false && result.draft) {
        setDraftId(result.draft.id);
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error('Error auto-saving draft:', error);
    } finally {
      setIsSaving(false);
    }
  }, [collectedData, draftId, sessionId]);

  // Resume from a draft
  const handleResumeDraft = async (draft) => {
    setIsLoading(true);
    try {
      const response = await resumeDraft(draft.id);
      if (response.sessionId) {
        setSessionId(response.sessionId);
        setDraftId(draft.id);
        setCollectedData(response.collectedData || {
          title: draft.title,
          description: draft.description,
          category: draft.category,
          risk_level: draft.risk_level,
          steps: draft.steps || [],
          ppe: draft.ppe || []
        });
        setMessages([
          { role: 'assistant', content: `📋 **Reprise du brouillon: ${draft.title}**\n\nJe vois que tu as déjà commencé cette procédure. Voici ce qu'on a:\n${draft.steps?.length || 0} étape(s) créée(s).\n\nOn continue où on en était ?` }
        ]);
        setCurrentStep(response.currentStep || 'resume');
        setOptions(response.options || ['Continuer', 'Voir le résumé', 'Recommencer']);
        setMode('guided');
      }
    } catch (error) {
      console.error('Error resuming draft:', error);
      // Fallback: start new session with draft data
      setCollectedData({
        title: draft.title,
        description: draft.description,
        category: draft.category,
        risk_level: draft.risk_level,
        steps: draft.steps || [],
        ppe: draft.ppe || []
      });
      setDraftId(draft.id);
      startGuidedSession(`Je reprends la procédure "${draft.title}" avec ${draft.steps?.length || 0} étapes déjà créées.`);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a draft
  const handleDeleteDraft = async (e, draftIdToDelete, draftTitle) => {
    e.stopPropagation(); // Prevent triggering the resume action

    if (!confirm(`Supprimer le brouillon "${draftTitle || 'Sans titre'}" ?`)) {
      return;
    }

    setIsLoading(true);
    try {
      await deleteDraft(draftIdToDelete);

      // CRITICAL FIX: Clear localStorage if deleted draft matches active session
      // This prevents the deleted draft from reappearing when reopening the page
      const savedSession = localStorage.getItem('activeProcedureSession');
      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          if (session.draftId === draftIdToDelete) {
            localStorage.removeItem('activeProcedureSession');
            console.log('[ProcedureCreator] Cleared localStorage for deleted draft:', draftIdToDelete);
            // Also reset current state if we're in the same session
            if (draftId === draftIdToDelete) {
              setDraftId(null);
              setSessionId(null);
              setCollectedData({});
              setMessages([]);
            }
          }
        } catch (e) {
          // If parsing fails, clear it anyway to be safe
          localStorage.removeItem('activeProcedureSession');
        }
      }

      // Refresh drafts list - handle {ok, drafts} response format
      const result = await getDrafts();
      const updatedDrafts = Array.isArray(result) ? result : result.drafts || [];
      setDrafts(updatedDrafts);

      // If no more drafts, go back to choose mode
      if (updatedDrafts.length === 0) {
        setMode('choose');
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
      alert('Erreur lors de la suppression du brouillon');
    } finally {
      setIsLoading(false);
    }
  };

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
    // Use server photo if available, otherwise use passed file
    const serverPhoto = serverPendingPhotos.length > 0 ? serverPendingPhotos[0] : null;
    const photoToSend = photoFile || (serverPhoto ? { id: serverPhoto.id, fromServer: true } : null);

    if (!messageText.trim() && !photoToSend) return;
    if (!sessionId) return;

    const userMessage = { role: 'user', content: messageText || '📸 Photo ajoutée' };
    if (photoToSend) {
      // Show thumbnail from server or create blob URL for local file
      userMessage.photo = photoToSend.fromServer
        ? getPendingPhotoUrl(photoToSend.id, true)
        : URL.createObjectURL(photoToSend);
    }

    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Remove used photo from server list
    if (serverPhoto) {
      setServerPendingPhotos(prev => prev.slice(1));
    }

    setIsLoading(true);

    try {
      // Pass pending_photo_id to backend if using server photo
      const response = await continueAISession(
        sessionId,
        messageText || 'Photo de l\'étape',
        photoToSend?.fromServer ? null : photoToSend, // Pass file only if not from server
        photoToSend?.fromServer ? photoToSend.id : null // Pass photo ID if from server
      );

      // If needs processing (user said "terminé"), show waiting message and process
      if (response.needsProcessing) {
        const stepsCount = response.collectedData?.raw_steps?.length || collectedData?.raw_steps?.length || 0;

        // Use background mode for large procedures (>10 steps) to avoid timeout
        if (stepsCount > 10) {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `⏳ **Création de la procédure en cours...**\n\n📋 ${stepsCount} étapes à traiter\n\nLe traitement continue en arrière-plan.\n\n📲 **Vous recevrez une notification** quand la procédure sera créée.\n\n💡 Vous pouvez fermer cette fenêtre sans risque.` }
          ]);

          // Start background processing with auto-finalize
          await processAISession(sessionId, { background: true });
          setIsProcessing(false);
          setCurrentStep('processing_background');

          // Clear localStorage session since it will be finalized in background
          localStorage.removeItem('activeProcedureSession');
          return;
        }

        // For smaller procedures, process synchronously
        setIsProcessing(true);
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: "⏳ Traitement des étapes en cours...\n\nGénération des instructions détaillées, EPI et niveau de risque." }
        ]);

        // Call processing endpoint for quality generation
        const processedResponse = await processAISession(sessionId);

        setIsProcessing(false);
        setMessages(prev => [
          ...prev.slice(0, -1), // Remove "please wait" message
          { role: 'assistant', content: processedResponse.message }
        ]);
        setCurrentStep('review');
        setCollectedData(processedResponse.collectedData || {});
        setProcedureReady(true);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: response.message }
        ]);
        setCurrentStep(response.currentStep);
        setOptions(response.options || []);
        setExpectsPhoto(response.expectsPhoto || false);
        setCollectedData(response.collectedData || {});
        setProcedureReady(response.procedureReady || false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsProcessing(false);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Désolé, une erreur s'est produite. Veuillez réessayer." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Continue processing in background and close modal
  const handleBackgroundProcessing = async () => {
    if (!sessionId) return;

    try {
      // Start background processing
      await processAISession(sessionId, { background: true });

      // Close the modal - user will receive notification when done
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error starting background processing:', error);
    }
  };

  // Handle photo upload - upload immediately to server
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Reset file input so same file can be selected again
      e.target.value = '';
      // Upload immediately to server
      await uploadPhotoToServer(file);
    }
  };

  // Finalize and create procedure
  // Uses background mode by default to avoid timeout errors on slow connections
  const handleFinalize = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    try {
      // Use background mode - returns immediately, sends push notification when done
      const result = await finalizeAISession(sessionId, { background: true });

      // Clear active session from localStorage since procedure is being finalized
      clearActiveSession();

      // Clear any remaining pending photos from server
      if (sessionId) {
        try {
          await clearPendingPhotos(sessionId);
          setServerPendingPhotos([]);
        } catch (e) {
          console.error('Error clearing pending photos:', e);
        }
      }

      // Delete the draft since procedure is being created
      if (draftId) {
        try {
          await deleteDraft(draftId);
          console.log('[ProcedureCreator] Deleted draft after finalization:', draftId);
        } catch (e) {
          console.error('Error deleting draft:', e);
        }
      }

      if (result.processing) {
        // Background mode: close immediately, user will get notification
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: "⏳ Création en cours... Vous recevrez une notification quand ce sera prêt." }
        ]);
        // Close after a short delay to show the message
        setTimeout(() => {
          if (onClose) {
            onClose({ background: true });
          }
        }, 1500);
      } else {
        // Synchronous mode returned a procedure (fallback)
        if (onProcedureCreated) {
          onProcedureCreated(result);
        }
        if (onClose) {
          onClose(result);
        }
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
      <div className="bg-white rounded-t-3xl lg:rounded-2xl shadow-xl overflow-hidden w-full">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 sm:px-6 py-4 sm:py-5">
          {/* Mobile handle */}
          <div className="lg:hidden flex justify-center mb-3">
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Nouvelle Procédure</h2>
                <p className="text-sm text-white/80 hidden sm:block">Choisissez comment créer votre procédure</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 active:bg-white/30 text-white"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Options */}
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          {/* Guided AI Creation */}
          <button
            onClick={() => startGuidedSession()}
            className="w-full p-4 sm:p-5 bg-gradient-to-r from-violet-50 to-purple-50 rounded-2xl border-2 border-violet-200 active:border-violet-400 active:scale-[0.98] transition-all text-left touch-manipulation"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 flex flex-wrap items-center gap-2">
                  <span>Création avec LIA</span>
                  <span className="text-[10px] sm:text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                    3 docs
                  </span>
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  Décrivez + photo → RAMS, Méthodo, Procédure
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-violet-400 flex-shrink-0" />
            </div>
          </button>

          {/* Import existing procedure */}
          <button
            onClick={() => setMode('import')}
            className="w-full p-4 sm:p-5 bg-gray-50 rounded-2xl border-2 border-gray-200 active:border-blue-400 active:scale-[0.98] transition-all text-left touch-manipulation"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">Importer un document</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  PDF ou texte → analyse IA automatique
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </div>
          </button>

          {/* Analyze report for actions */}
          <button
            onClick={() => setMode('report')}
            className="w-full p-4 sm:p-5 bg-gray-50 rounded-2xl border-2 border-gray-200 active:border-amber-400 active:scale-[0.98] transition-all text-left touch-manipulation"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">Analyser un rapport</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  Audit/contrôle → liste d'actions correctives
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </div>
          </button>

          {/* Drafts - Resume unfinished procedures */}
          {drafts.length > 0 && (
            <button
              onClick={() => setMode('drafts')}
              className="w-full p-4 sm:p-5 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border-2 border-emerald-200 active:border-emerald-400 active:scale-[0.98] transition-all text-left touch-manipulation"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0 relative">
                  <Clock className="w-6 h-6 text-white" />
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
                    {drafts.length}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">Reprendre un brouillon</h3>
                  <p className="text-xs sm:text-sm text-gray-600 mt-1">
                    {drafts.length} procédure(s) non terminée(s)
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Drafts List Mode
  if (mode === 'drafts') {
    return (
      <div className="bg-white rounded-t-3xl lg:rounded-2xl shadow-xl overflow-hidden w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 sm:px-6 py-4 sm:py-5 flex-shrink-0">
          <div className="lg:hidden flex justify-center mb-3">
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Brouillons</h2>
                <p className="text-sm text-white/80">{drafts.length} procédure(s) à reprendre</p>
              </div>
            </div>
            <button
              onClick={() => setMode('choose')}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drafts List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className={`w-full p-4 bg-gray-50 hover:bg-emerald-50 rounded-xl border border-gray-200 hover:border-emerald-300 transition-all ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-start justify-between">
                <button
                  onClick={() => handleResumeDraft(draft)}
                  disabled={isLoading}
                  className="flex-1 min-w-0 text-left"
                >
                  <h3 className="font-medium text-gray-900 truncate">{draft.title || 'Sans titre'}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {draft.step_count || 0} étape(s)
                    </span>
                    <span>{draft.category || 'Général'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      draft.risk_level === 'high' ? 'bg-red-100 text-red-700' :
                      draft.risk_level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {draft.risk_level === 'high' ? 'Élevé' :
                       draft.risk_level === 'medium' ? 'Moyen' : 'Faible'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Modifié le {new Date(draft.updated_at).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </button>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button
                    onClick={(e) => handleDeleteDraft(e, draft.id, draft.title)}
                    disabled={isLoading}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer le brouillon"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Back Button */}
        <div className="p-4 border-t flex-shrink-0">
          <button
            onClick={() => setMode('choose')}
            className="w-full py-3 text-gray-600 hover:text-gray-800 font-medium"
          >
            ← Retour
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
    <div className="bg-white rounded-t-3xl lg:rounded-2xl shadow-xl overflow-hidden w-full flex flex-col h-[85vh] lg:h-[520px]">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
        {/* Mobile handle */}
        <div className="lg:hidden flex justify-center mb-2">
          <div className="w-10 h-1 bg-white/30 rounded-full" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">LIA</h2>
              <p className="text-xs sm:text-sm text-white/80">
                {currentStep === 'init' && '1/3 - Titre'}
                {currentStep === 'steps' && '2/3 - Étapes + Photos'}
                {(currentStep === 'review' || currentStep === 'complete') && '3/3 - Finalisation'}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setMode('choose'); setMessages([]); setSessionId(null); }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 active:bg-white/30 text-white"
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
                className={`h-1 sm:h-1.5 flex-1 rounded-full transition-all ${
                  isCompleted || isCurrent ? 'bg-white' : 'bg-white/30'
                }`}
              />
            );
          })}
        </div>

        {/* Auto-save indicator */}
        {(isSaving || lastSaved) && (
          <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-white/70">
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Sauvegarde...</span>
              </>
            ) : lastSaved ? (
              <>
                <Save className="w-3 h-3" />
                <span>Sauvegardé à {lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} isUser={msg.role === 'user'} />
        ))}

        {isLoading && !isProcessing && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
            </div>
          </div>
        )}

        {/* Processing indicator with background option */}
        {isProcessing && (
          <div className="flex justify-start mb-3">
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-2xl rounded-bl-md px-4 py-4 max-w-[90%]">
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                  <Sparkles className="w-4 h-4 text-yellow-500 absolute -top-1 -right-1" />
                </div>
                <div>
                  <p className="font-medium text-violet-900">Traitement en cours...</p>
                  <p className="text-xs text-violet-600">Génération des détails de la procédure</p>
                </div>
              </div>
              <button
                onClick={handleBackgroundProcessing}
                className="w-full mt-2 bg-white border border-violet-300 text-violet-700 rounded-xl py-2.5 text-sm font-medium hover:bg-violet-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Fermer et continuer en arrière-plan
              </button>
              <p className="text-xs text-center text-violet-500 mt-2">
                Vous recevrez une notification quand ce sera prêt
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Options */}
      {options.length > 0 && !isLoading && (
        <div className="px-3 sm:px-4 py-2 border-t flex flex-wrap gap-1.5 sm:gap-2 overflow-x-auto">
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
      <div className="p-3 sm:p-4 border-t flex-shrink-0 safe-area-bottom bg-white">
        {procedureReady ? (
          <button
            onClick={handleFinalize}
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-2xl py-3.5 sm:py-3 font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-green-200"
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
            {/* Upload in progress indicator */}
            {uploadingPhoto && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-2 rounded-xl">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="text-sm text-blue-700 font-medium">Upload en cours...</span>
              </div>
            )}
            {/* Server pending photos preview */}
            {serverPendingPhotos.length > 0 && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-2 rounded-xl">
                <div className="flex -space-x-2 flex-shrink-0">
                  {serverPendingPhotos.slice(0, 3).map((photo) => (
                    <img
                      key={photo.id}
                      src={getPendingPhotoUrl(photo.id, true)}
                      alt=""
                      className="w-10 h-10 rounded-lg border-2 border-white object-cover"
                    />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-700">
                    {serverPendingPhotos.length} photo{serverPendingPhotos.length > 1 ? 's' : ''} prête{serverPendingPhotos.length > 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-green-600">Sauvegardée{serverPendingPhotos.length > 1 ? 's' : ''} sur le serveur</p>
                </div>
                <button
                  onClick={() => removeServerPhoto(serverPendingPhotos[0].id)}
                  className="p-2 text-green-600 active:text-red-500 transition-colors"
                  title="Supprimer la photo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {/* Pending captures being uploaded */}
            {pendingCaptures.length > 0 && (
              <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 px-3 py-2 rounded-xl">
                <Loader2 className="w-4 h-4 animate-spin text-violet-600 flex-shrink-0" />
                <span className="text-xs text-violet-700 flex-1">
                  Upload de <strong>{pendingCaptures.length} capture{pendingCaptures.length > 1 ? 's' : ''}</strong>...
                </span>
              </div>
            )}
            {/* Photo actions when in steps mode */}
            {currentStep === 'steps' && serverPendingPhotos.length === 0 && pendingCaptures.length === 0 && !uploadingPhoto && (
              <div className="space-y-2">
                {/* Multi-photo button - prominent */}
                <button
                  onClick={handleOpenMultiCapture}
                  className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl flex items-center justify-center gap-2 font-medium active:scale-[0.98] transition-transform"
                >
                  <Camera className="w-5 h-5" />
                  <span>Prendre des photos</span>
                </button>
                <p className="text-xs text-gray-500 text-center">
                  Prenez toutes les photos nécessaires, puis décrivez l'étape
                </p>
              </div>
            )}
            <div className="flex gap-2">
              {/* Camera button - for adding more photos */}
              {(expectsPhoto || currentStep === 'steps') && serverPendingPhotos.length > 0 && (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="p-3 rounded-xl bg-green-100 text-green-600 active:bg-green-200 transition-all relative flex-shrink-0"
                  title="Ajouter une photo"
                >
                  <Camera className="w-5 h-5" />
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[10px] rounded-full flex items-center justify-center">+</span>
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={
                  currentStep === 'init' ? "Ex: Remplacement disjoncteur..." :
                  currentStep === 'steps' ? (serverPendingPhotos.length > 0 ? "Décrivez l'étape..." : "Photo + description") :
                  currentStep === 'review' ? "'oui' pour créer" :
                  "Votre réponse..."
                }
                className="flex-1 min-w-0 px-3 sm:px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-gray-50 focus:bg-white text-base"
                disabled={isLoading || uploadingPhoto}
              />
              <button
                onClick={() => sendMessage()}
                disabled={isLoading || uploadingPhoto || (!input.trim() && serverPendingPhotos.length === 0)}
                className={`p-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 flex-shrink-0 ${
                  serverPendingPhotos.length > 0 && input.trim()
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white'
                    : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                }`}
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
