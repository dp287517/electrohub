// GlobalProcedureModal.jsx - Renders ProcedureCreator globally, allowing it to open from any page
import { useState, useEffect } from 'react';
import { useProcedureCapture } from '../../contexts/ProcedureCaptureContext';
import ProcedureCreator from './ProcedureCreator';

export default function GlobalProcedureModal() {
  const [showModal, setShowModal] = useState(false);
  const {
    shouldReopenModal,
    clearReopenSignal,
    shouldMinimizeModal,
    clearMinimizeSignal,
    captureCount,
    procedureInfo
  } = useProcedureCapture();

  // Open modal when returning from capture on any page
  useEffect(() => {
    if (shouldReopenModal && procedureInfo) {
      console.log('[GlobalProcedureModal] Opening modal after capture, captureCount:', captureCount);
      setShowModal(true);
      clearReopenSignal();
    }
  }, [shouldReopenModal, clearReopenSignal, captureCount, procedureInfo]);

  // Close modal when minimizing
  useEffect(() => {
    if (shouldMinimizeModal) {
      console.log('[GlobalProcedureModal] Minimizing modal');
      setShowModal(false);
      clearMinimizeSignal();
    }
  }, [shouldMinimizeModal, clearMinimizeSignal]);

  if (!showModal) return null;

  return (
    <ProcedureCreator
      onProcedureCreated={(procedure) => {
        console.log('[GlobalProcedureModal] Procedure created:', procedure?.id);
        setShowModal(false);
      }}
      onClose={() => setShowModal(false)}
    />
  );
}
