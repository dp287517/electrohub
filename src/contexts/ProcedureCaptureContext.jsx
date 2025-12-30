import { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const ProcedureCaptureContext = createContext(null);

export function ProcedureCaptureProvider({ children }) {
  const navigate = useNavigate();

  // Capture mode state
  const [isCapturing, setIsCapturing] = useState(false);
  const [procedureInfo, setProcedureInfo] = useState(null); // { id, title, sessionId, returnPath }
  const [captures, setCaptures] = useState([]); // [{ id, file, preview, timestamp, description }]
  const [returnPath, setReturnPath] = useState('/app/procedures');
  const [shouldReopenModal, setShouldReopenModal] = useState(false); // FIX: Signal to reopen modal after capture
  const [shouldMinimizeModal, setShouldMinimizeModal] = useState(false); // Signal to close modal when minimizing

  // Start capture mode for a procedure
  // FIX: Store full session info (sessionId, mode, collectedData) to restore after capture
  const startCapture = useCallback((info) => {
    setProcedureInfo({
      ...info,
      sessionId: info.sessionId || info.id,
      mode: info.mode || 'guided',
      collectedData: info.collectedData || {},
      messages: info.messages || []
    });
    setReturnPath(info.returnPath || '/app/procedures');
    setIsCapturing(true);
  }, []);

  // Stop capture mode
  const stopCapture = useCallback(() => {
    setIsCapturing(false);
    // Don't clear captures - they remain available until used
  }, []);

  // Add a capture
  const addCapture = useCallback((file, description = '') => {
    const capture = {
      id: Date.now().toString(),
      file,
      preview: URL.createObjectURL(file),
      timestamp: new Date(),
      description
    };
    setCaptures(prev => [...prev, capture]);
    return capture;
  }, []);

  // Remove a capture
  const removeCapture = useCallback((captureId) => {
    setCaptures(prev => {
      const capture = prev.find(c => c.id === captureId);
      if (capture?.preview) {
        URL.revokeObjectURL(capture.preview);
      }
      return prev.filter(c => c.id !== captureId);
    });
  }, []);

  // Update capture description
  const updateCaptureDescription = useCallback((captureId, description) => {
    setCaptures(prev => prev.map(c =>
      c.id === captureId ? { ...c, description } : c
    ));
  }, []);

  // Clear all captures
  const clearCaptures = useCallback(() => {
    captures.forEach(c => {
      if (c.preview) URL.revokeObjectURL(c.preview);
    });
    setCaptures([]);
  }, [captures]);

  // Get captures and clear them (for consuming)
  const consumeCaptures = useCallback(() => {
    const current = [...captures];
    // Don't revoke URLs - they'll be used by the consumer
    setCaptures([]);
    return current;
  }, [captures]);

  // Navigate back to procedure and close capture mode (keep captures)
  const returnToProcedure = useCallback(() => {
    setIsCapturing(false);
    setShouldReopenModal(true); // FIX: Signal to reopen the modal
    navigate(returnPath);
  }, [navigate, returnPath]);

  // Clear the reopen signal after it's been consumed
  const clearReopenSignal = useCallback(() => {
    setShouldReopenModal(false);
  }, []);

  // Signal to minimize/close the modal (when user wants to navigate freely)
  const minimizeModal = useCallback(() => {
    setShouldMinimizeModal(true);
  }, []);

  // Clear the minimize signal after it's been consumed
  const clearMinimizeSignal = useCallback(() => {
    setShouldMinimizeModal(false);
  }, []);

  // End capture session completely
  const endCaptureSession = useCallback(() => {
    clearCaptures();
    setProcedureInfo(null);
    setIsCapturing(false);
    setReturnPath('/app/procedures');
  }, [clearCaptures]);

  const value = {
    // State
    isCapturing,
    procedureInfo,
    captures,
    captureCount: captures.length,
    shouldReopenModal, // FIX: Signal to reopen modal after capture
    shouldMinimizeModal, // Signal to close modal when minimizing

    // Actions
    startCapture,
    stopCapture,
    addCapture,
    removeCapture,
    updateCaptureDescription,
    clearCaptures,
    consumeCaptures,
    returnToProcedure,
    clearReopenSignal, // FIX: Clear the reopen signal after modal is reopened
    minimizeModal, // Close the modal but keep session active
    clearMinimizeSignal,
    endCaptureSession
  };

  return (
    <ProcedureCaptureContext.Provider value={value}>
      {children}
    </ProcedureCaptureContext.Provider>
  );
}

export function useProcedureCapture() {
  const context = useContext(ProcedureCaptureContext);
  if (!context) {
    throw new Error('useProcedureCapture must be used within a ProcedureCaptureProvider');
  }
  return context;
}

export default ProcedureCaptureContext;
