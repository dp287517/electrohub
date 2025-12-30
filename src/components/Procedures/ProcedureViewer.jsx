import { useState, useEffect } from 'react';
import {
  X, Download, Edit2, Trash2, AlertTriangle, Shield,
  HardHat, Phone, Link2, CheckCircle, Clock, User,
  ChevronDown, ChevronUp, Camera, Plus, Save, Building,
  FileText, Loader2, Play, Sparkles, QrCode, FileSpreadsheet,
  BadgeCheck, FileEdit, Pen, Users
} from 'lucide-react';
import {
  getProcedure,
  updateProcedure,
  deleteProcedure,
  addStep,
  updateStep,
  deleteStep,
  uploadStepPhoto,
  getStepPhotoUrl,
  addEquipmentLink,
  removeEquipmentLink,
  searchEquipment,
  downloadProcedurePdf,
  downloadMethodStatementPdf,
  downloadWorkMethodPdf,
  downloadProcedureDocPdf,
  downloadAllDocuments,
  downloadRAMSExcel,
  downloadMethodeWord,
  getSignatures,
  invalidateSignatures,
  recoverPhotos,
  RISK_LEVELS,
  STATUS_LABELS,
  DEFAULT_PPE,
} from '../../lib/procedures-api';
import RealtimeAssistant from './RealtimeAssistant';
import SignatureManager from './SignatureManager';

// Step Component
function StepCard({ step, procedureId, isEditing, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(step);
  const [uploading, setUploading] = useState(false);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await uploadStepPhoto(procedureId, step.id, file);
      onUpdate();
    } catch (error) {
      console.error('Error uploading photo:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      await updateStep(procedureId, step.id, form);
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating step:', error);
    }
  };

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-8 h-8 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center font-semibold">
          {step.step_number}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">{step.title}</h4>
          {step.duration_minutes && (
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {step.duration_minutes} min
            </span>
          )}
        </div>
        {step.photo_path && <Camera className="w-4 h-4 text-gray-400" />}
        {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </div>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t pt-4 space-y-4">
          {editing ? (
            // Edit mode
            <div className="space-y-3">
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Titre de l'étape"
              />
              <textarea
                value={form.instructions || ''}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="Instructions détaillées"
              />
              <textarea
                value={form.warning || ''}
                onChange={(e) => setForm({ ...form, warning: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
                placeholder="Avertissements (optionnel)"
              />
              <input
                type="number"
                value={form.duration_minutes || ''}
                onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || null })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Durée en minutes"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setEditing(false); setForm(step); }}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            // View mode
            <>
              {step.instructions && (
                <div>
                  <h5 className="text-sm font-medium text-gray-500 mb-1">Instructions</h5>
                  <p className="text-gray-700 whitespace-pre-wrap">{step.instructions}</p>
                </div>
              )}

              {step.warning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-800">{step.warning}</p>
                </div>
              )}

              {step.photo_path && (
                <div>
                  <h5 className="text-sm font-medium text-gray-500 mb-2">Photo</h5>
                  <img
                    src={getStepPhotoUrl(step.id)}
                    alt={`Étape ${step.step_number}`}
                    className="max-h-48 rounded-lg border"
                  />
                </div>
              )}

              {isEditing && (
                <div className="flex gap-2 pt-2 border-t">
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                  >
                    <Edit2 className="w-3 h-3" />
                    Modifier
                  </button>
                  <label className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1 cursor-pointer">
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                    Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={() => onDelete(step.id)}
                    className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Supprimer
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Equipment Link Component
function EquipmentLink({ link, isEditing, onRemove }) {
  const typeLabels = {
    switchboard: 'Armoire',
    vsd: 'VSD',
    meca: 'Meca',
    atex: 'ATEX',
  };

  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
        {typeLabels[link.equipment_type] || link.equipment_type}
      </span>
      <span className="text-sm text-gray-700">{link.equipment_name || link.equipment_id}</span>
      {isEditing && (
        <button
          onClick={() => onRemove(link.id)}
          className="ml-auto text-gray-400 hover:text-red-600"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function ProcedureViewer({ procedureId, onClose, onDeleted, isMobile = false, aiGuidedMode = false }) {
  const [procedure, setProcedure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showAddStep, setShowAddStep] = useState(false);
  const [newStep, setNewStep] = useState({ title: '', instructions: '' });
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [equipmentResults, setEquipmentResults] = useState([]);
  const [downloading, setDownloading] = useState(null); // null, 'rams', 'method', 'procedure', 'all'
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showAssistant, setShowAssistant] = useState(aiGuidedMode); // Auto-open AI if from QR code
  const [showSignatures, setShowSignatures] = useState(false);
  const [signatureSummary, setSignatureSummary] = useState(null);

  const loadSignatures = async () => {
    try {
      const data = await getSignatures(procedureId);
      setSignatureSummary(data.summary);
    } catch (error) {
      console.error('Error loading signatures:', error);
    }
  };

  const loadProcedure = async () => {
    try {
      const data = await getProcedure(procedureId);

      // Auto-recover photos if any step is missing photo but should have one
      // Check if steps exist and any has no photo_path (photos might not have been linked during creation)
      const stepsNeedRecovery = data.steps?.length > 0 &&
        data.steps.some(s => !s.photo_path) &&
        !sessionStorage.getItem(`photo_recovery_attempted_${procedureId}`);

      if (stepsNeedRecovery) {
        console.log('[ProcedureViewer] Attempting photo recovery for', procedureId);
        sessionStorage.setItem(`photo_recovery_attempted_${procedureId}`, 'true');
        try {
          const result = await recoverPhotos(procedureId);
          console.log('[ProcedureViewer] Photo recovery result:', result);
          if (result.recoveredCount > 0) {
            // Reload procedure to get updated photos
            const refreshedData = await getProcedure(procedureId);
            setProcedure(refreshedData);
            loadSignatures();
            setEditForm({
              title: refreshedData.title,
              description: refreshedData.description,
              category: refreshedData.category,
              status: refreshedData.status,
              risk_level: refreshedData.risk_level,
              ppe_required: refreshedData.ppe_required || [],
              emergency_contacts: refreshedData.emergency_contacts || [],
            });
            setLoading(false);
            return;
          }
        } catch (recoverError) {
          console.log('[ProcedureViewer] Photo recovery failed:', recoverError.message);
        }
      }

      setProcedure(data);
      loadSignatures();
      setEditForm({
        title: data.title,
        description: data.description,
        category: data.category,
        status: data.status,
        risk_level: data.risk_level,
        ppe_required: data.ppe_required || [],
        emergency_contacts: data.emergency_contacts || [],
      });
    } catch (error) {
      console.error('Error loading procedure:', error);
    } finally {
      setLoading(false);
    }
  };

  // Toggle status between draft and approved
  const handleToggleStatus = async () => {
    const newStatus = procedure.status === 'approved' ? 'draft' : 'approved';
    try {
      await updateProcedure(procedureId, { status: newStatus });
      loadProcedure();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Erreur lors de la mise à jour du statut');
    }
  };

  useEffect(() => {
    loadProcedure();
  }, [procedureId]);

  // Auto-open AI assistant when coming from QR code scan
  useEffect(() => {
    if (aiGuidedMode && procedure) {
      setShowAssistant(true);
    }
  }, [aiGuidedMode, procedure]);

  const handleSave = async () => {
    try {
      // Invalidate signatures if procedure was already validated
      if (procedure.status === 'approved') {
        await invalidateSignatures(procedureId, 'Procédure modifiée');
      }
      await updateProcedure(procedureId, editForm);
      setIsEditing(false);
      loadProcedure();
    } catch (error) {
      console.error('Error saving procedure:', error);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette procédure ?')) return;

    try {
      await deleteProcedure(procedureId);
      if (onDeleted) onDeleted();
      if (onClose) onClose();
    } catch (error) {
      console.error('Error deleting procedure:', error);
    }
  };

  const handleAddStep = async () => {
    if (!newStep.title.trim()) return;

    try {
      await addStep(procedureId, newStep);
      setNewStep({ title: '', instructions: '' });
      setShowAddStep(false);
      loadProcedure();
    } catch (error) {
      console.error('Error adding step:', error);
    }
  };

  const handleDeleteStep = async (stepId) => {
    if (!confirm('Supprimer cette étape ?')) return;

    try {
      await deleteStep(procedureId, stepId);
      loadProcedure();
    } catch (error) {
      console.error('Error deleting step:', error);
    }
  };

  const handleEquipmentSearch = async (query) => {
    setEquipmentSearch(query);
    if (query.length < 2) {
      setEquipmentResults([]);
      return;
    }

    try {
      const results = await searchEquipment(query);
      setEquipmentResults(results);
    } catch (error) {
      console.error('Error searching equipment:', error);
    }
  };

  const handleAddEquipment = async (equipment) => {
    try {
      await addEquipmentLink(procedureId, {
        equipment_type: equipment.equipment_type,
        equipment_id: equipment.id,
        equipment_name: equipment.name,
      });
      setShowAddEquipment(false);
      setEquipmentSearch('');
      setEquipmentResults([]);
      loadProcedure();
    } catch (error) {
      console.error('Error adding equipment link:', error);
    }
  };

  const handleRemoveEquipment = async (linkId) => {
    try {
      await removeEquipmentLink(procedureId, linkId);
      loadProcedure();
    } catch (error) {
      console.error('Error removing equipment link:', error);
    }
  };

  const handleDownload = async (type) => {
    setDownloading(type);
    setShowPrintMenu(false);
    try {
      switch (type) {
        case 'rams':
          await downloadMethodStatementPdf(procedureId);
          break;
        case 'rams-excel':
          await downloadRAMSExcel(procedureId);
          break;
        case 'methode-word':
          await downloadMethodeWord(procedureId);
          break;
        case 'method':
          await downloadWorkMethodPdf(procedureId);
          break;
        case 'procedure':
          await downloadProcedureDocPdf(procedureId);
          break;
        case 'all':
          await downloadAllDocuments(procedureId);
          break;
        default:
          await downloadProcedurePdf(procedureId);
      }
    } catch (error) {
      console.error(`Error downloading ${type}:`, error);
      alert(`Erreur lors du téléchargement: ${error.message}`);
    } finally {
      setDownloading(null);
    }
  };

  const togglePPE = (ppe) => {
    const current = editForm.ppe_required || [];
    if (current.includes(ppe)) {
      setEditForm({ ...editForm, ppe_required: current.filter(p => p !== ppe) });
    } else {
      setEditForm({ ...editForm, ppe_required: [...current, ppe] });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
      </div>
    );
  }

  if (!procedure) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
        <p className="text-gray-600">Procédure non trouvée</p>
      </div>
    );
  }

  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div className={`bg-white shadow-xl overflow-hidden flex flex-col ${
      isMobile
        ? 'w-full h-[100dvh] rounded-t-2xl sm:rounded-2xl sm:max-w-4xl sm:max-h-[90vh] sm:mx-auto'
        : 'rounded-2xl max-w-4xl w-full mx-auto max-h-[90vh]'
    }`} style={isMobile ? { maxHeight: 'calc(100dvh - env(safe-area-inset-bottom))' } : undefined}>
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-5 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {isEditing ? (
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="text-xl font-bold bg-white/10 text-white px-3 py-1 rounded-lg border border-white/20 w-full"
              />
            ) : (
              <h2 className="text-xl font-bold text-white">{procedure.title}</h2>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {/* Status button - clickable to toggle */}
              <button
                onClick={handleToggleStatus}
                className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 ${
                  procedure.status === 'approved'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={procedure.status === 'approved' ? 'Cliquez pour repasser en brouillon' : 'Cliquez pour valider'}
              >
                {procedure.status === 'approved' ? (
                  <>
                    <BadgeCheck className="w-3.5 h-3.5" />
                    Validée
                  </>
                ) : (
                  <>
                    <FileEdit className="w-3.5 h-3.5" />
                    Brouillon
                  </>
                )}
              </button>

              {/* Signature button */}
              <button
                onClick={() => setShowSignatures(true)}
                className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 ${
                  signatureSummary?.is_fully_signed
                    ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                }`}
                title="Gérer les signatures"
              >
                <Pen className="w-3 h-3" />
                {signatureSummary?.signed_count || 0}/{signatureSummary?.total_required || 0} signatures
              </button>

              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor}`}>
                Risque: {riskInfo.label}
              </span>
              <span className="text-white/70 text-sm">v{procedure.version}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Print Menu Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPrintMenu(!showPrintMenu)}
                disabled={!!downloading}
                className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white flex items-center gap-1"
                title="Télécharger les documents"
              >
                {downloading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <ChevronDown className="w-3 h-3" />
                  </>
                )}
              </button>

              {showPrintMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border z-50 overflow-hidden">
                  <div className="p-2 bg-gray-50 border-b">
                    <span className="text-xs font-medium text-gray-500">DOCUMENTS À TÉLÉCHARGER</span>
                  </div>

                  {/* RAMS A3 PDF */}
                  <button
                    onClick={() => handleDownload('rams')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-violet-50 transition-colors text-left"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
                      <Shield className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">RAMS PDF (A3)</p>
                      <p className="text-xs text-gray-500">Risk Assessment Method Statement</p>
                    </div>
                    {downloading === 'rams' && <Loader2 className="w-4 h-4 animate-spin text-violet-600" />}
                  </button>

                  {/* RAMS Excel */}
                  <button
                    onClick={() => handleDownload('rams-excel')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-emerald-50 transition-colors text-left border-t"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                      <FileSpreadsheet className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">RAMS Excel</p>
                      <p className="text-xs text-gray-500">Format tableur modifiable (.xlsx)</p>
                    </div>
                    {downloading === 'rams-excel' && <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />}
                  </button>

                  {/* Méthode de travail Word */}
                  <button
                    onClick={() => handleDownload('methode-word')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-indigo-50 transition-colors text-left border-t"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Méthode de travail (Word)</p>
                      <p className="text-xs text-gray-500">Document officiel modifiable (.docx)</p>
                    </div>
                    {downloading === 'methode-word' && <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />}
                  </button>

                  {/* Méthodologie A4 */}
                  <button
                    onClick={() => handleDownload('method')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-blue-50 transition-colors text-left border-t"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                      <FileSpreadsheet className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Méthodologie (A4)</p>
                      <p className="text-xs text-gray-500">Méthode de travail détaillée</p>
                    </div>
                    {downloading === 'method' && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                  </button>

                  {/* Procédure A4 */}
                  <button
                    onClick={() => handleDownload('procedure')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-green-50 transition-colors text-left border-t"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Procédure (A4)</p>
                      <p className="text-xs text-gray-500">Instructions étape par étape</p>
                    </div>
                    {downloading === 'procedure' && <Loader2 className="w-4 h-4 animate-spin text-green-600" />}
                  </button>

                  {/* Télécharger tout (ZIP) */}
                  <button
                    onClick={() => handleDownload('all')}
                    disabled={!!downloading}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-purple-50 transition-colors text-left border-t bg-gray-50"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-purple-700 rounded-lg flex items-center justify-center">
                      <Download className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Télécharger tout (ZIP)</p>
                      <p className="text-xs text-gray-500">5 documents (3 PDF + 1 Excel + 1 Word)</p>
                    </div>
                    {downloading === 'all' && <Loader2 className="w-4 h-4 animate-spin text-purple-600" />}
                  </button>
                </div>
              )}
            </div>

            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white"
                title="Modifier"
              >
                <Edit2 className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="p-2 bg-green-500 rounded-lg hover:bg-green-600 transition-colors text-white"
                title="Enregistrer"
              >
                <Save className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Description */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Description</h3>
          {isEditing ? (
            <textarea
              value={editForm.description || ''}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              rows={3}
            />
          ) : (
            <p className="text-gray-700">{procedure.description || 'Aucune description'}</p>
          )}
        </div>

        {/* Location */}
        {(procedure.site || procedure.building || procedure.zone) && (
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <Building className="w-4 h-4" />
            <span>{[procedure.site, procedure.building, procedure.zone].filter(Boolean).join(' > ')}</span>
          </div>
        )}

        {/* PPE Required */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
            <HardHat className="w-4 h-4" />
            Équipements de Protection Individuelle
          </h3>
          {isEditing ? (
            <div className="flex flex-wrap gap-2">
              {DEFAULT_PPE.map((ppe) => (
                <button
                  key={ppe}
                  onClick={() => togglePPE(ppe)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    editForm.ppe_required?.includes(ppe)
                      ? 'bg-violet-100 text-violet-700 border-2 border-violet-300'
                      : 'bg-gray-100 text-gray-600 border-2 border-transparent'
                  }`}
                >
                  {ppe}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(procedure.ppe_required || []).length > 0 ? (
                procedure.ppe_required.map((ppe, i) => (
                  <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                    {ppe}
                  </span>
                ))
              ) : (
                <span className="text-gray-400 text-sm">Aucun EPI spécifié</span>
              )}
            </div>
          )}
        </div>

        {/* Safety Codes */}
        {procedure.safety_codes?.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Codes de sécurité
            </h3>
            <div className="flex flex-wrap gap-2">
              {procedure.safety_codes.map((code, i) => (
                <span key={i} className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
                  {code}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Emergency Contacts */}
        {(procedure.emergency_contacts?.length > 0 || isEditing) && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Contacts d'urgence
            </h3>
            <div className="space-y-2">
              {(procedure.emergency_contacts || []).map((contact, i) => (
                <div key={i} className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
                  <Phone className="w-4 h-4 text-red-600" />
                  <div>
                    <span className="font-medium text-gray-900">{contact.name}</span>
                    {contact.role && <span className="text-gray-500 ml-2">({contact.role})</span>}
                  </div>
                  <span className="ml-auto text-red-600 font-medium">{contact.phone}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Étapes ({procedure.steps?.length || 0})
            </h3>
            {isEditing && (
              <button
                onClick={() => setShowAddStep(true)}
                className="text-sm text-violet-600 hover:text-violet-700 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Ajouter une étape
              </button>
            )}
          </div>

          {showAddStep && (
            <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3">
              <input
                type="text"
                value={newStep.title}
                onChange={(e) => setNewStep({ ...newStep, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Titre de l'étape"
              />
              <textarea
                value={newStep.instructions}
                onChange={(e) => setNewStep({ ...newStep, instructions: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
                placeholder="Instructions"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddStep}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700"
                >
                  Ajouter
                </button>
                <button
                  onClick={() => setShowAddStep(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-100"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {(procedure.steps || []).map((step) => (
              <StepCard
                key={step.id}
                step={step}
                procedureId={procedureId}
                isEditing={isEditing}
                onUpdate={loadProcedure}
                onDelete={handleDeleteStep}
              />
            ))}
          </div>
        </div>

        {/* Equipment Links */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              Équipements liés ({procedure.equipment_links?.length || 0})
            </h3>
            {isEditing && (
              <button
                onClick={() => setShowAddEquipment(true)}
                className="text-sm text-violet-600 hover:text-violet-700 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Lier un équipement
              </button>
            )}
          </div>

          {showAddEquipment && (
            <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3">
              <input
                type="text"
                value={equipmentSearch}
                onChange={(e) => handleEquipmentSearch(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Rechercher un équipement..."
              />
              {equipmentResults.length > 0 && (
                <div className="bg-white border rounded-lg max-h-40 overflow-y-auto">
                  {equipmentResults.map((eq) => (
                    <button
                      key={`${eq.equipment_type}-${eq.id}`}
                      onClick={() => handleAddEquipment(eq)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {eq.equipment_type}
                      </span>
                      <span>{eq.name}</span>
                      {eq.code && <span className="text-gray-400 text-sm">({eq.code})</span>}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setShowAddEquipment(false); setEquipmentSearch(''); setEquipmentResults([]); }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Annuler
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(procedure.equipment_links || []).map((link) => (
              <EquipmentLink
                key={link.id}
                link={link}
                isEditing={isEditing}
                onRemove={handleRemoveEquipment}
              />
            ))}
            {(procedure.equipment_links || []).length === 0 && (
              <span className="text-gray-400 text-sm">Aucun équipement lié</span>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="pt-4 border-t text-sm text-gray-500 space-y-1">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <span>Créé par: {procedure.created_by || 'Inconnu'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>Dernière modification: {new Date(procedure.updated_at).toLocaleString('fr-FR')}</span>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      {isEditing && (
        <div className="p-4 border-t flex justify-between flex-shrink-0">
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Supprimer
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => { setIsEditing(false); loadProcedure(); }}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Start Assistance Button - Fixed at bottom when not editing */}
      {!isEditing && procedure?.steps?.length > 0 && (
        <div className="p-4 border-t bg-gradient-to-r from-violet-50 to-purple-50 flex-shrink-0">
          <button
            onClick={() => setShowAssistant(true)}
            className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-200"
          >
            <Play className="w-5 h-5" />
            Commencer l'assistance en temps réel
            <Sparkles className="w-4 h-4" />
          </button>
          <p className="text-center text-xs text-gray-500 mt-2">
            L'IA vous guidera étape par étape avec analyse de photos en temps réel
          </p>
        </div>
      )}

      {/* Realtime Assistant Modal */}
      {showAssistant && procedure && (
        <RealtimeAssistant
          procedureId={procedureId}
          procedureTitle={procedure.title}
          onClose={() => setShowAssistant(false)}
        />
      )}

      {/* Signature Manager Modal */}
      {showSignatures && procedure && (
        <SignatureManager
          procedureId={procedureId}
          procedureTitle={procedure.title}
          createdBy={procedure.created_by}
          onClose={() => { setShowSignatures(false); loadProcedure(); }}
          onValidated={() => { setShowSignatures(false); loadProcedure(); }}
        />
      )}
    </div>
  );
}
