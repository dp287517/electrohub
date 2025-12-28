import { useState, useEffect } from 'react';
import {
  X, UserPlus, Check, Clock, AlertTriangle, Pen,
  Mail, Trash2, Shield, Loader2, CheckCircle, User
} from 'lucide-react';
import SignaturePad from './SignaturePad';
import {
  getSignatures,
  addSignatureRequest,
  removeSignatureRequest,
  submitSignature,
  setupCreatorSignature
} from '../../lib/procedures-api';

export default function SignatureManager({ procedureId, procedureTitle, onClose, onValidated }) {
  const [loading, setLoading] = useState(true);
  const [signatures, setSignatures] = useState([]);
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({});
  const [showAddSigner, setShowAddSigner] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [newSigner, setNewSigner] = useState({ email: '', name: '', role: 'reviewer' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const currentUserEmail = localStorage.getItem('userEmail') || '';

  const loadSignatures = async () => {
    try {
      setLoading(true);
      const data = await getSignatures(procedureId);
      setSignatures(data.signatures || []);
      setRequests(data.requests || []);
      setSummary(data.summary || {});

      // If no creator signature setup, add current user as creator
      if (data.signatures.length === 0 && data.summary?.creator === currentUserEmail) {
        await setupCreatorSignature(procedureId);
        // Reload
        const updated = await getSignatures(procedureId);
        setSignatures(updated.signatures || []);
        setRequests(updated.requests || []);
        setSummary(updated.summary || {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSignatures();
  }, [procedureId]);

  const handleAddSigner = async () => {
    if (!newSigner.email) return;

    setSubmitting(true);
    try {
      await addSignatureRequest(procedureId, newSigner);
      setNewSigner({ email: '', name: '', role: 'reviewer' });
      setShowAddSigner(false);
      await loadSignatures();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveSigner = async (email) => {
    if (!confirm('Retirer ce signataire ?')) return;

    try {
      await removeSignatureRequest(procedureId, email);
      await loadSignatures();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSign = async (signatureData, signatureType) => {
    setSubmitting(true);
    try {
      const result = await submitSignature(procedureId, signatureData, signatureType);
      setShowSignaturePad(false);
      await loadSignatures();

      if (result.procedure_validated) {
        if (onValidated) onValidated();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSign = () => {
    // Check if current user can sign
    const userSignature = signatures.find(s => s.signer_email === currentUserEmail);
    const userRequest = requests.find(r => r.requested_email === currentUserEmail && r.status === 'pending');

    return (userSignature && !userSignature.signed_at) || userRequest || summary.creator === currentUserEmail;
  };

  const hasSigned = () => {
    const userSignature = signatures.find(s => s.signer_email === currentUserEmail);
    return userSignature && userSignature.signed_at;
  };

  const roleLabels = {
    creator: 'Créateur',
    reviewer: 'Vérificateur',
    approver: 'Approbateur',
    witness: 'Témoin'
  };

  if (showSignaturePad) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <SignaturePad
          onSave={handleSign}
          onCancel={() => setShowSignaturePad(false)}
          signerName={currentUserEmail.split('@')[0]}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Signatures électroniques
            </h3>
            <p className="text-violet-200 text-sm truncate max-w-md">{procedureTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status bar */}
        <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {summary.is_fully_signed ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <Clock className="w-5 h-5 text-amber-600" />
              )}
              <span className={`font-medium ${summary.is_fully_signed ? 'text-green-700' : 'text-amber-700'}`}>
                {summary.is_fully_signed ? 'Toutes les signatures obtenues' : 'Signatures en attente'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">{summary.signed_count || 0}</span>
            <span>/</span>
            <span>{summary.total_required || 0}</span>
            <span>signées</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  {error}
                </div>
              )}

              {/* Signatures list */}
              <div className="space-y-3">
                <h4 className="font-medium text-gray-700 mb-3">Signataires</h4>

                {signatures.length === 0 && requests.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <User className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Aucun signataire configuré</p>
                    <p className="text-sm">Ajoutez des personnes qui doivent signer ce document</p>
                  </div>
                ) : (
                  <>
                    {/* Show all signers */}
                    {signatures.map((sig) => (
                      <div
                        key={sig.id}
                        className={`flex items-center gap-4 p-4 rounded-xl border ${
                          sig.signed_at
                            ? 'bg-green-50 border-green-200'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          sig.signed_at ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          {sig.signed_at ? (
                            <Check className="w-5 h-5 text-green-600" />
                          ) : (
                            <Clock className="w-5 h-5 text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 truncate">{sig.signer_name || sig.signer_email}</p>
                            {sig.is_creator && (
                              <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                                Créateur
                              </span>
                            )}
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {roleLabels[sig.signer_role] || sig.signer_role}
                            </span>
                          </div>
                          <p className="text-sm text-gray-500 truncate">{sig.signer_email}</p>
                          {sig.signed_at && (
                            <p className="text-xs text-green-600 mt-1">
                              Signé le {new Date(sig.signed_at).toLocaleString('fr-FR')}
                            </p>
                          )}
                        </div>

                        {sig.signed_at && sig.signature_data && (
                          <img
                            src={sig.signature_data}
                            alt="Signature"
                            className="h-10 w-20 object-contain bg-white rounded border"
                          />
                        )}

                        {!sig.signed_at && !sig.is_creator && (
                          <button
                            onClick={() => handleRemoveSigner(sig.signer_email)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Retirer ce signataire"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Add signer form */}
              {showAddSigner && (
                <div className="mt-4 p-4 bg-gray-50 rounded-xl border">
                  <h5 className="font-medium text-gray-700 mb-3">Ajouter un signataire</h5>
                  <div className="space-y-3">
                    <input
                      type="email"
                      value={newSigner.email}
                      onChange={(e) => setNewSigner({ ...newSigner, email: e.target.value })}
                      placeholder="Email du signataire *"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    />
                    <input
                      type="text"
                      value={newSigner.name}
                      onChange={(e) => setNewSigner({ ...newSigner, name: e.target.value })}
                      placeholder="Nom (optionnel)"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    />
                    <select
                      value={newSigner.role}
                      onChange={(e) => setNewSigner({ ...newSigner, role: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    >
                      <option value="reviewer">Vérificateur</option>
                      <option value="approver">Approbateur</option>
                      <option value="witness">Témoin</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAddSigner(false)}
                        className="flex-1 py-2 px-4 border rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={handleAddSigner}
                        disabled={!newSigner.email || submitting}
                        className="flex-1 py-2 px-4 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                        Envoyer la demande
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-3 flex-shrink-0">
          {!showAddSigner && (
            <button
              onClick={() => setShowAddSigner(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-white transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Ajouter un signataire
            </button>
          )}

          <div className="flex-1" />

          {canSign() && !hasSigned() && (
            <button
              onClick={() => setShowSignaturePad(true)}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg hover:from-violet-700 hover:to-purple-700 transition-colors shadow-lg"
            >
              <Pen className="w-4 h-4" />
              Signer maintenant
            </button>
          )}

          {hasSigned() && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg">
              <CheckCircle className="w-4 h-4" />
              Vous avez signé
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
