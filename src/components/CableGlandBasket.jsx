// src/components/CableGlandBasket.jsx
// Cable Gland (Presse-Étoupe) Basket Modal Component
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";

// Get user headers for API calls
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;
  try {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name) name = localStorage.getItem("name") || localStorage.getItem("user.name") || null;
  } catch {}
  return { email, name };
}

function userHeaders() {
  const { email, name } = getIdentity();
  const h = { "Content-Type": "application/json" };
  if (email) h["X-User-Email"] = email;
  if (name) h["X-User-Name"] = name;
  const site = localStorage.getItem("selectedSite");
  if (site) h["X-Site"] = site;
  return h;
}

// API base URL
const ATEX_API = import.meta.env.VITE_ATEX_API_URL || "/api/atex";

// Status badges
const StatusBadge = ({ status }) => {
  const colors = {
    pending: "bg-gray-100 text-gray-700",
    analyzing: "bg-blue-100 text-blue-700",
    analyzed: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
    processing: "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700"
  };
  const labels = {
    pending: "En attente",
    analyzing: "Analyse en cours",
    analyzed: "Analysé",
    error: "Erreur",
    processing: "En cours",
    completed: "Terminé"
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
      {labels[status] || status}
    </span>
  );
};

// Main Component
export default function CableGlandBasket({
  isOpen,
  onClose,
  planLogicalName,
  pageIndex = 0,
  initialPosition = null, // { xFrac, yFrac } for new basket
  zoneName = "",
  building = "",
  onBasketCreated = null,
  existingBasketId = null // If editing existing basket
}) {
  const [mode, setMode] = useState(existingBasketId ? "view" : "create"); // create | view | upload
  const [baskets, setBaskets] = useState([]);
  const [selectedBasket, setSelectedBasket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisQueue, setAnalysisQueue] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [newBasketName, setNewBasketName] = useState("");
  const [newBasketDesc, setNewBasketDesc] = useState("");
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // Load baskets for this plan
  const loadBaskets = useCallback(async () => {
    if (!planLogicalName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${ATEX_API}/cable-glands/baskets/by-plan/${encodeURIComponent(planLogicalName)}?pageIndex=${pageIndex}`,
        { headers: userHeaders() }
      );
      const data = await res.json();
      if (data.ok) {
        setBaskets(data.baskets || []);
      }
    } catch (err) {
      console.error("[CableGland] Load baskets error:", err);
    }
    setLoading(false);
  }, [planLogicalName, pageIndex]);

  // Load specific basket details
  const loadBasketDetails = useCallback(async (basketId) => {
    setLoading(true);
    try {
      const res = await fetch(`${ATEX_API}/cable-glands/baskets/${basketId}`, {
        headers: userHeaders()
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedBasket({
          ...data.basket,
          photos: data.photos || [],
          items: data.items || []
        });
        setMode("view");
      }
    } catch (err) {
      console.error("[CableGland] Load basket details error:", err);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      if (existingBasketId) {
        loadBasketDetails(existingBasketId);
      } else {
        loadBaskets();
        setMode("create");
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOpen, existingBasketId, loadBaskets, loadBasketDetails]);

  // Create new basket
  const handleCreateBasket = async () => {
    if (!newBasketName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${ATEX_API}/cable-glands/baskets`, {
        method: "POST",
        headers: userHeaders(),
        body: JSON.stringify({
          name: newBasketName.trim(),
          description: newBasketDesc.trim(),
          planLogicalName,
          pageIndex,
          zoneName,
          building,
          xFrac: initialPosition?.xFrac,
          yFrac: initialPosition?.yFrac
        })
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedBasket({ ...data.basket, photos: [], items: [] });
        setMode("upload");
        setNewBasketName("");
        setNewBasketDesc("");
        onBasketCreated?.(data.basket);
      }
    } catch (err) {
      console.error("[CableGland] Create basket error:", err);
    }
    setLoading(false);
  };

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(f =>
      f.type.startsWith("image/")
    );
    if (files.length > 0) {
      uploadFiles(files);
    }
  }, []);

  // Handle file input change
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []).filter(f =>
      f.type.startsWith("image/")
    );
    if (files.length > 0) {
      uploadFiles(files);
    }
  };

  // Upload files
  const uploadFiles = async (files) => {
    if (!selectedBasket?.id || uploading) return;
    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append("photos", f));

      // Custom headers without Content-Type (let browser set it for multipart)
      const headers = {};
      const { email, name } = getIdentity();
      if (email) headers["X-User-Email"] = email;
      if (name) headers["X-User-Name"] = name;
      const site = localStorage.getItem("selectedSite");
      if (site) headers["X-Site"] = site;

      const res = await fetch(`${ATEX_API}/cable-glands/baskets/${selectedBasket.id}/photos`, {
        method: "POST",
        headers,
        body: formData
      });
      const data = await res.json();

      if (data.ok) {
        // Reload basket details
        await loadBasketDetails(selectedBasket.id);
      }
    } catch (err) {
      console.error("[CableGland] Upload error:", err);
    }
    setUploading(false);
    setUploadProgress(0);
  };

  // Start analysis
  const handleStartAnalysis = async () => {
    if (!selectedBasket?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`${ATEX_API}/cable-glands/baskets/${selectedBasket.id}/analyze`, {
        method: "POST",
        headers: userHeaders()
      });
      const data = await res.json();
      if (data.ok && data.queueId) {
        setAnalysisQueue({ id: data.queueId, status: "pending", progress: 0, totalItems: data.totalItems });
        // Start polling
        pollRef.current = setInterval(() => pollAnalysisStatus(data.queueId), 2000);
      }
    } catch (err) {
      console.error("[CableGland] Start analysis error:", err);
    }
    setLoading(false);
  };

  // Poll analysis status
  const pollAnalysisStatus = async (queueId) => {
    try {
      const res = await fetch(`${ATEX_API}/cable-glands/analysis/${queueId}/status`, {
        headers: userHeaders()
      });
      const data = await res.json();
      if (data.ok) {
        setAnalysisQueue(data.queue);
        if (data.queue.status === "completed" || data.queue.status === "error") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          // Reload basket to get updated items
          await loadBasketDetails(selectedBasket.id);
        }
      }
    } catch (err) {
      console.error("[CableGland] Poll status error:", err);
    }
  };

  // Delete photo
  const handleDeletePhoto = async (photoId) => {
    if (!confirm("Supprimer cette photo ?")) return;
    try {
      await fetch(`${ATEX_API}/cable-glands/photos/${photoId}`, {
        method: "DELETE",
        headers: userHeaders()
      });
      await loadBasketDetails(selectedBasket.id);
    } catch (err) {
      console.error("[CableGland] Delete photo error:", err);
    }
  };

  // Delete basket
  const handleDeleteBasket = async () => {
    if (!selectedBasket?.id) return;
    if (!confirm("Supprimer ce panier et toutes ses photos ?")) return;
    try {
      await fetch(`${ATEX_API}/cable-glands/baskets/${selectedBasket.id}`, {
        method: "DELETE",
        headers: userHeaders()
      });
      setSelectedBasket(null);
      setMode("create");
      await loadBaskets();
    } catch (err) {
      console.error("[CableGland] Delete basket error:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-white text-lg">
              ⚡
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Presse-Étoupes</h2>
              <p className="text-sm text-gray-500">
                {mode === "create" ? "Nouveau panier" : selectedBasket?.name || "Gestion des PE"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && !selectedBasket ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
            </div>
          ) : mode === "create" && !selectedBasket ? (
            // Create new basket or select existing
            <div className="space-y-6">
              {/* Existing baskets */}
              {baskets.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Paniers existants sur ce plan</h3>
                  <div className="grid gap-3">
                    {baskets.map(basket => (
                      <button
                        key={basket.id}
                        onClick={() => loadBasketDetails(basket.id)}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600">
                            📦
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{basket.name}</div>
                            <div className="text-sm text-gray-500">
                              {basket.photo_count || 0} photos • {basket.gland_count || 0} PE détectés
                            </div>
                          </div>
                        </div>
                        <StatusBadge status={basket.status} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Create new */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Créer un nouveau panier</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Nom du panier *</label>
                    <input
                      type="text"
                      value={newBasketName}
                      onChange={e => setNewBasketName(e.target.value)}
                      placeholder="Ex: Zone 1 - Bâtiment A"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Description (optionnel)</label>
                    <textarea
                      value={newBasketDesc}
                      onChange={e => setNewBasketDesc(e.target.value)}
                      placeholder="Notes sur ce panier..."
                      rows={2}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-200 focus:border-amber-500 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleCreateBasket}
                    disabled={!newBasketName.trim() || loading}
                    className="w-full py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Créer le panier
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // View/Upload mode
            <div className="space-y-6">
              {/* Basket info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setSelectedBasket(null); setMode("create"); loadBaskets(); }}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                  >
                    ←
                  </button>
                  <div>
                    <h3 className="font-medium text-gray-900">{selectedBasket?.name}</h3>
                    <p className="text-sm text-gray-500">{selectedBasket?.description || "Aucune description"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedBasket?.status} />
                  <button
                    onClick={handleDeleteBasket}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    title="Supprimer le panier"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                  dragOver ? "border-amber-500 bg-amber-50" : "border-gray-300 hover:border-amber-400 hover:bg-amber-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {uploading ? (
                  <div className="space-y-2">
                    <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" />
                    <p className="text-amber-600">Upload en cours...</p>
                  </div>
                ) : (
                  <>
                    <div className="text-4xl mb-2">📸</div>
                    <p className="text-gray-600 font-medium">Glissez vos photos ici</p>
                    <p className="text-sm text-gray-400">ou cliquez pour sélectionner</p>
                  </>
                )}
              </div>

              {/* Photos grid */}
              {selectedBasket?.photos?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700">
                      Photos ({selectedBasket.photos.length})
                    </h4>
                    {selectedBasket.photos.some(p => p.analysis_status === "pending") && !analysisQueue && (
                      <button
                        onClick={handleStartAnalysis}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition flex items-center gap-2"
                      >
                        🤖 Lancer l'analyse IA
                      </button>
                    )}
                  </div>

                  {/* Analysis progress */}
                  {analysisQueue && analysisQueue.status !== "completed" && (
                    <div className="mb-4 p-4 bg-blue-50 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-700">Analyse en cours...</span>
                        <span className="text-sm text-blue-600">
                          {analysisQueue.progress}/{analysisQueue.total_items}
                        </span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${(analysisQueue.progress / analysisQueue.total_items) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {selectedBasket.photos.map(photo => (
                      <div key={photo.id} className="relative group">
                        <img
                          src={`${ATEX_API}/cable-glands/photos/${photo.id}?thumb=1`}
                          alt={photo.original_name}
                          className="w-full aspect-square object-cover rounded-lg"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition rounded-lg">
                          <button
                            onClick={() => handleDeletePhoto(photo.id)}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition"
                          >
                            ×
                          </button>
                        </div>
                        <div className="absolute bottom-1 left-1 right-1">
                          <div className={`text-[10px] px-1.5 py-0.5 rounded text-center ${
                            photo.analysis_status === "completed" ? "bg-green-500 text-white" :
                            photo.analysis_status === "error" ? "bg-red-500 text-white" :
                            "bg-gray-800/70 text-white"
                          }`}>
                            {photo.analysis_status === "completed" ? `${photo.glands_count} PE` :
                             photo.analysis_status === "error" ? "Erreur" : "En attente"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detected items */}
              {selectedBasket?.items?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    Presse-étoupes détectés ({selectedBasket.items.length})
                  </h4>
                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Taille</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Marquage ATEX</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">État</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Conformité</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {selectedBasket.items.map(item => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{item.type || "-"}</div>
                              {item.manufacturer && (
                                <div className="text-xs text-gray-500">{item.manufacturer}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-700">{item.size || "-"}</td>
                            <td className="px-3 py-2">
                              {item.atex_marking ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                                  {item.atex_marking}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                item.condition === "ok" ? "bg-green-100 text-green-700" :
                                item.condition === "usé" ? "bg-yellow-100 text-yellow-700" :
                                "bg-red-100 text-red-700"
                              }`}>
                                {item.condition}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                item.compliance_status === "ok" ? "bg-green-100 text-green-700" :
                                item.compliance_status === "issue" ? "bg-red-100 text-red-700" :
                                "bg-gray-100 text-gray-700"
                              }`}>
                                {item.compliance_status === "ok" ? "Conforme" :
                                 item.compliance_status === "issue" ? "Non conforme" : "À vérifier"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Stats summary */}
              {selectedBasket && (
                <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-xl">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-600">{selectedBasket.photos?.length || 0}</div>
                    <div className="text-xs text-gray-500">Photos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{selectedBasket.items?.length || 0}</div>
                    <div className="text-xs text-gray-500">PE détectés</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {selectedBasket.items?.filter(i => i.compliance_status === "ok").length || 0}
                    </div>
                    <div className="text-xs text-gray-500">Conformes</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
