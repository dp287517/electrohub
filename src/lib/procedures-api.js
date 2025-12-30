// procedures-api.js — Client API for Procedures microservice

const API_BASE = '/api/procedures';

// Get user email from any localStorage key
function getUserEmail() {
  return localStorage.getItem('userEmail')
    || localStorage.getItem('email')
    || localStorage.getItem('user.email')
    || localStorage.getItem('askVeeva_email')
    || '';
}

// Helper for fetch with auth headers
async function fetchWithAuth(url, options = {}) {
  const userEmail = getUserEmail();
  const site = localStorage.getItem('selectedSite') || localStorage.getItem('site') || '';

  const headers = {
    'Content-Type': 'application/json',
    'X-User-Email': userEmail,
    'X-Site': site,
    ...options.headers,
  };

  // Remove Content-Type for FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erreur réseau' }));
    throw new Error(error.error || 'Erreur API');
  }

  return response;
}

// ==================== PROCEDURES ====================

export async function listProcedures(filters = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.append('category', filters.category);
  if (filters.status) params.append('status', filters.status);
  if (filters.search) params.append('search', filters.search);

  const response = await fetchWithAuth(`${API_BASE}?${params}`);
  return response.json();
}

export async function getProcedure(id) {
  const response = await fetchWithAuth(`${API_BASE}/${id}`);
  return response.json();
}

export async function createProcedure(data) {
  const response = await fetchWithAuth(API_BASE, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function updateProcedure(id, data) {
  const response = await fetchWithAuth(`${API_BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function deleteProcedure(id) {
  const response = await fetchWithAuth(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  return response.json();
}

// Recover photos from AI session raw_steps
export async function recoverPhotos(id) {
  const response = await fetchWithAuth(`${API_BASE}/${id}/recover-photos`, {
    method: 'POST',
  });
  return response.json();
}

// ==================== STEPS ====================

export async function addStep(procedureId, stepData) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/steps`, {
    method: 'POST',
    body: JSON.stringify(stepData),
  });
  return response.json();
}

export async function updateStep(procedureId, stepId, stepData) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/steps/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify(stepData),
  });
  return response.json();
}

export async function deleteStep(procedureId, stepId) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/steps/${stepId}`, {
    method: 'DELETE',
  });
  return response.json();
}

export async function uploadStepPhoto(procedureId, stepId, photoFile) {
  const formData = new FormData();
  formData.append('photo', photoFile);

  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/steps/${stepId}/photo`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

export function getStepPhotoUrl(stepId) {
  return `${API_BASE}/steps/${stepId}/photo`;
}

// ==================== EQUIPMENT LINKS ====================

export async function addEquipmentLink(procedureId, linkData) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/equipment`, {
    method: 'POST',
    body: JSON.stringify(linkData),
  });
  return response.json();
}

export async function removeEquipmentLink(procedureId, linkId) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/equipment/${linkId}`, {
    method: 'DELETE',
  });
  return response.json();
}

export async function searchEquipment(query, type = null) {
  const params = new URLSearchParams({ q: query });
  if (type) params.append('type', type);

  const response = await fetchWithAuth(`${API_BASE}/search-equipment?${params}`);
  return response.json();
}

// ==================== DRAFTS (Auto-save for resume) ====================

export async function saveDraft(draftData) {
  const response = await fetchWithAuth(`${API_BASE}/drafts`, {
    method: 'POST',
    body: JSON.stringify(draftData),
  });
  return response.json();
}

export async function getDrafts() {
  const response = await fetchWithAuth(`${API_BASE}/drafts`);
  return response.json();
}

export async function getDraft(draftId) {
  const response = await fetchWithAuth(`${API_BASE}/drafts/${draftId}`);
  return response.json();
}

export async function deleteDraft(draftId) {
  const response = await fetchWithAuth(`${API_BASE}/drafts/${draftId}`, {
    method: 'DELETE',
  });
  return response.json();
}

export async function cleanupOrphanDrafts() {
  const response = await fetchWithAuth(`${API_BASE}/drafts/cleanup-orphans`, {
    method: 'POST',
  });
  return response.json();
}

export async function resumeDraft(draftId) {
  const response = await fetchWithAuth(`${API_BASE}/ai/resume/${draftId}`, {
    method: 'POST',
  });
  return response.json();
}

// ==================== AI GUIDED CREATION ====================

export async function startAISession(initialMessage = null, draftId = null) {
  const response = await fetchWithAuth(`${API_BASE}/ai/start`, {
    method: 'POST',
    body: JSON.stringify({ initialMessage, draftId }),
  });
  return response.json();
}

export async function continueAISession(sessionId, message, photoFile = null) {
  if (photoFile) {
    const formData = new FormData();
    formData.append('message', message);
    formData.append('photo', photoFile);

    const response = await fetchWithAuth(`${API_BASE}/ai/chat/${sessionId}`, {
      method: 'POST',
      body: formData,
    });
    return response.json();
  }

  const response = await fetchWithAuth(`${API_BASE}/ai/chat/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return response.json();
}

// Finalize AI session and create the procedure
// Set background=true to finalize async and receive notification when done
export async function finalizeAISession(sessionId, { background = false } = {}) {
  const url = background
    ? `${API_BASE}/ai/finalize/${sessionId}?background=true`
    : `${API_BASE}/ai/finalize/${sessionId}`;

  const response = await fetchWithAuth(url, {
    method: 'POST',
  });
  return response.json();
}

// Process raw steps into quality procedure details (called when user says "terminé")
// Set background=true to process async and receive notification when done
// Set autoFinalize=true to also create the procedure automatically (recommended for background mode)
export async function processAISession(sessionId, { background = false, autoFinalize = false } = {}) {
  let url = `${API_BASE}/ai/process/${sessionId}`;

  if (background) {
    // In background mode, always auto-finalize for better UX
    url += `?background=true&autoFinalize=true`;
  }

  const response = await fetchWithAuth(url, {
    method: 'POST',
  });
  return response.json();
}

// ==================== DOCUMENT ANALYSIS ====================

export async function analyzeDocument(documentFile) {
  const formData = new FormData();
  formData.append('document', documentFile);

  const response = await fetchWithAuth(`${API_BASE}/ai/analyze-document`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

export async function analyzeReport(reportFile) {
  const formData = new FormData();
  formData.append('report', reportFile);

  const response = await fetchWithAuth(`${API_BASE}/ai/analyze-report`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

export async function getActionLists() {
  const response = await fetchWithAuth(`${API_BASE}/action-lists`);
  return response.json();
}

// ==================== PDF ====================

export function getProcedurePdfUrl(procedureId) {
  return `${API_BASE}/${procedureId}/pdf`;
}

export async function downloadProcedurePdf(procedureId) {
  const response = await fetch(getProcedurePdfUrl(procedureId), {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement du PDF');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `procedure_${procedureId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Method Statement A3 Landscape PDF with QR Code
export function getMethodStatementPdfUrl(procedureId) {
  return `${API_BASE}/${procedureId}/method-statement-pdf`;
}

// Generate Example Method Statement (ATEX Demo)
export async function generateExampleMethodStatement() {
  const response = await fetchWithAuth(`${API_BASE}/generate-example-method-statement`, {
    method: 'POST',
  });
  return response.json();
}

// Download Example RAMS PDF (A3) directly
export async function downloadExampleRAMSPdf() {
  const response = await fetch(`${API_BASE}/example-method-statement-pdf`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement du RAMS Exemple');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RAMS_Exemple_ATEX_${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Alias for backward compatibility
export const downloadExampleMethodStatementPdf = downloadExampleRAMSPdf;

// Download Example Work Method PDF (A4)
export async function downloadExampleWorkMethodPdf() {
  const response = await fetch(`${API_BASE}/example-work-method-pdf`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Méthode de Travail Exemple');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Methode_Travail_Exemple_${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Example Procedure PDF (A4)
export async function downloadExampleProcedurePdf() {
  const response = await fetch(`${API_BASE}/example-procedure-pdf`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Procédure Exemple');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Procedure_Exemple_${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download All Example Documents as ZIP
export async function downloadAllExampleDocuments() {
  const response = await fetch(`${API_BASE}/example-all-documents`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la documentation complète');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Documentation_Complete_${new Date().toISOString().split('T')[0]}.zip`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export async function downloadMethodStatementPdf(procedureId) {
  const response = await fetch(getMethodStatementPdfUrl(procedureId), {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement du RAMS PDF');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RAMS_${procedureId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Work Method PDF (Méthodologie A4)
export async function downloadWorkMethodPdf(procedureId) {
  const response = await fetch(`${API_BASE}/${procedureId}/work-method-pdf`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Méthodologie PDF');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Methodologie_${procedureId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Procedure Document PDF (Procédure A4)
export async function downloadProcedureDocPdf(procedureId) {
  const response = await fetch(`${API_BASE}/${procedureId}/procedure-doc-pdf`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Procédure PDF');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Procedure_${procedureId}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download all 4 documents as ZIP (3 PDFs + 1 Excel RAMS)
export async function downloadAllDocuments(procedureId) {
  const response = await fetch(`${API_BASE}/${procedureId}/all-documents`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement des documents');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Documents_${procedureId}.zip`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download RAMS Excel (format RAMS_B20_ATEX)
export async function downloadRAMSExcel(procedureId) {
  const response = await fetch(`${API_BASE}/${procedureId}/rams-excel`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement du RAMS Excel');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RAMS_${procedureId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Example RAMS Excel
export async function downloadExampleRAMSExcel() {
  const response = await fetch(`${API_BASE}/example-rams-excel`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement du RAMS Excel Exemple');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RAMS_Exemple_ATEX_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Méthode de Travail Word (format identique au template officiel)
export async function downloadMethodeWord(procedureId) {
  const response = await fetch(`${API_BASE}/${procedureId}/methode-word`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Méthode de Travail Word');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Methode_Travail_${procedureId}.docx`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Download Example Méthode de Travail Word
export async function downloadExampleMethodeWord() {
  const response = await fetch(`${API_BASE}/example-methode-word`, {
    headers: {
      'X-User-Email': getUserEmail(),
      'X-Site': localStorage.getItem('selectedSite') || '',
    },
  });

  if (!response.ok) {
    throw new Error('Erreur lors du téléchargement de la Méthode de Travail Word Exemple');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Methode_Travail_Exemple_${new Date().toISOString().split('T')[0]}.docx`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// ==================== CATEGORIES ====================

export async function getCategories() {
  const response = await fetchWithAuth(`${API_BASE}/categories`);
  return response.json();
}

// ==================== SIGNATURES ÉLECTRONIQUES ====================

// Get all signatures for a procedure
export async function getSignatures(procedureId) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/signatures`);
  return response.json();
}

// Add a signature request (invite someone to sign)
export async function addSignatureRequest(procedureId, { email, name, role, message }) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/signature-requests`, {
    method: 'POST',
    body: JSON.stringify({ email, name, role, message }),
  });
  return response.json();
}

// Remove a signature request
export async function removeSignatureRequest(procedureId, email) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/signature-requests/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  return response.json();
}

// Submit a signature
export async function submitSignature(procedureId, signatureData, signatureType = 'draw') {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/sign`, {
    method: 'POST',
    body: JSON.stringify({ signature_data: signatureData, signature_type: signatureType }),
  });
  return response.json();
}

// Get pending signatures for current user
export async function getPendingSignatures() {
  const response = await fetchWithAuth(`${API_BASE}/pending-signatures`);
  return response.json();
}

// Invalidate signatures (when procedure is modified)
export async function invalidateSignatures(procedureId, reason) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/invalidate-signatures`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return response.json();
}

// Setup creator as first signer
export async function setupCreatorSignature(procedureId) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/setup-creator-signature`, {
    method: 'POST',
  });
  return response.json();
}

// Claim ownership of a procedure (if created_by is system/anonymous)
export async function claimProcedureOwnership(procedureId) {
  const response = await fetchWithAuth(`${API_BASE}/${procedureId}/claim-ownership`, {
    method: 'POST',
  });
  return response.json();
}

// Send reminder notifications
export async function sendSignatureReminders() {
  const response = await fetchWithAuth(`${API_BASE}/send-signature-reminders`, {
    method: 'POST',
  });
  return response.json();
}

// ==================== CONSTANTS ====================

export const RISK_LEVELS = {
  low: { label: 'Faible', color: 'green', bgColor: 'bg-green-100', textColor: 'text-green-800' },
  medium: { label: 'Modéré', color: 'yellow', bgColor: 'bg-yellow-100', textColor: 'text-yellow-800' },
  high: { label: 'Élevé', color: 'orange', bgColor: 'bg-orange-100', textColor: 'text-orange-800' },
  critical: { label: 'Critique', color: 'red', bgColor: 'bg-red-100', textColor: 'text-red-800' },
};

export const STATUS_LABELS = {
  draft: { label: 'Brouillon', color: 'gray', bgColor: 'bg-gray-100', textColor: 'text-gray-800' },
  review: { label: 'En révision', color: 'blue', bgColor: 'bg-blue-100', textColor: 'text-blue-800' },
  approved: { label: 'Approuvée', color: 'green', bgColor: 'bg-green-100', textColor: 'text-green-800' },
  archived: { label: 'Archivée', color: 'gray', bgColor: 'bg-gray-200', textColor: 'text-gray-600' },
};

export const DEFAULT_PPE = [
  'Casque de sécurité',
  'Lunettes de protection',
  'Gants isolants',
  'Chaussures de sécurité',
  'Vêtements antistatiques',
  'Protection auditive',
  'Masque respiratoire',
  'Harnais de sécurité',
];

// Training levels/certifications required for specific work types
export const TRAINING_TYPES = {
  // Electrical qualifications (Belgium/EU standard)
  ba4: { label: 'BA4 - Personne avertie', category: 'electrical', description: 'Formation de base pour travaux électriques sous surveillance' },
  ba5: { label: 'BA5 - Personne qualifiée', category: 'electrical', description: 'Qualification complète pour travaux électriques autonomes' },

  // Height work
  height_work: { label: 'Travail en hauteur', category: 'height', description: 'Formation travaux en hauteur et utilisation de harnais' },
  scaffold: { label: 'Montage échafaudage', category: 'height', description: 'Certification montage/démontage échafaudages' },
  nacelle: { label: 'Nacelle élévatrice (PEMP)', category: 'height', description: 'Conduite de plateformes élévatrices mobiles' },

  // Confined spaces
  confined_space: { label: 'Espace confiné', category: 'confined', description: 'Travaux en espaces confinés et atmosphères contrôlées' },

  // Equipment operation
  forklift: { label: 'Chariot élévateur', category: 'equipment', description: 'Conduite de chariots élévateurs' },
  crane: { label: 'Pont roulant', category: 'equipment', description: 'Utilisation de ponts roulants et palans' },

  // Safety procedures
  loto: { label: 'LOTO - Consignation', category: 'safety', description: 'Procédures de consignation/déconsignation' },
  atex: { label: 'ATEX - Zones explosives', category: 'safety', description: 'Travaux en atmosphères explosives' },

  // Emergency
  first_aid: { label: 'Premiers secours', category: 'emergency', description: 'Secourisme et premiers soins' },
  fire_safety: { label: 'Sécurité incendie', category: 'emergency', description: 'Équipier de première intervention' },

  // Specific equipment
  hydraulic: { label: 'Systèmes hydrauliques', category: 'technical', description: 'Maintenance systèmes hydrauliques haute pression' },
  pneumatic: { label: 'Systèmes pneumatiques', category: 'technical', description: 'Maintenance systèmes pneumatiques' },
  welding: { label: 'Soudage', category: 'technical', description: 'Certification soudage (MIG/TIG/Arc)' },

  // General
  safety_induction: { label: 'Induction sécurité site', category: 'general', description: 'Formation d\'accueil sécurité obligatoire' },
};

export const CATEGORY_ICONS = {
  general: 'FileText',
  maintenance: 'Wrench',
  securite: 'Shield',
  mise_en_service: 'Play',
  mise_hors_service: 'PowerOff',
  urgence: 'AlertTriangle',
  controle: 'CheckCircle',
  formation: 'Book',
};
