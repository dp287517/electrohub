// src/pages/Infrastructure.jsx
// Module Infrastructure - Plans électriques multi-zones
// Permet de placer les équipements ATEX sur des plans d'infrastructure
import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import InfrastructureMap from "./Infrastructure_map.jsx";

// ============================================================
// INFRASTRUCTURE - Page principale
// ============================================================

export default function Infrastructure() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "plans");

  // Data states
  const [plans, setPlans] = useState([]);
  const [positions, setPositions] = useState([]);
  const [zones, setZones] = useState([]);
  const [atexEquipments, setAtexEquipments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected plan for map view
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Modal states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState(null);

  // Toast
  const [toast, setToast] = useState("");

  // Stats calculés
  const stats = useMemo(() => {
    return {
      plansCount: plans.length,
      zonesCount: zones.length,
      positionsCount: positions.length,
      equipmentsCount: atexEquipments.length,
    };
  }, [plans, zones, positions, atexEquipments]);

  // Unique building names for filter
  const buildingNames = useMemo(() => {
    const names = new Set(plans.map(p => p.building_name).filter(Boolean));
    return Array.from(names).sort();
  }, [plans]);

  // ============================================================
  // Fetch data
  // ============================================================
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, positionsRes, zonesRes, atexRes] = await Promise.all([
        api.infra.listPlans().catch(() => ({ plans: [] })),
        api.infra.listPositions().catch(() => ({ positions: [] })),
        api.infra.listZones().catch(() => ({ zones: [] })),
        api.atex.listEquipments({ limit: 1000 }).catch(() => ({ items: [] })),
      ]);
      setPlans(plansRes?.plans || []);
      setPositions(positionsRes?.positions || []);
      setZones(zonesRes?.zones || []);
      setAtexEquipments(atexRes?.items || []);
    } catch (err) {
      console.error("[Infrastructure] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update URL when tab changes
  useEffect(() => {
    const currentTab = searchParams.get("tab");
    if (currentTab !== activeTab) {
      setSearchParams({ tab: activeTab });
    }
  }, [activeTab, searchParams, setSearchParams]);

  // ============================================================
  // Handlers
  // ============================================================
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const handleUploadPlan = async (file, buildingName) => {
    try {
      await api.infra.uploadPlan(file, { building_name: buildingName });
      showToast("Plan uploadé avec succès");
      setUploadModalOpen(false);
      fetchData();
    } catch (err) {
      showToast("Erreur: " + (err.message || "Upload échoué"));
    }
  };

  const handleDeletePlan = async (planId) => {
    if (!confirm("Supprimer ce plan et tous ses éléments ?")) return;
    try {
      await api.infra.deletePlan(planId);
      showToast("Plan supprimé");
      fetchData();
    } catch (err) {
      showToast("Erreur: " + (err.message || "Suppression échouée"));
    }
  };

  const handlePlaceEquipment = async (equipmentId, planId, x_frac, y_frac, pageIndex = 0) => {
    try {
      await api.infra.createPosition({
        equipment_id: equipmentId,
        plan_id: planId,
        x_frac,
        y_frac,
        page_index: pageIndex,
      });
      showToast("Équipement placé");
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Placement échoué"));
    }
  };

  const handleUpdatePosition = async (positionId, data) => {
    try {
      await api.infra.updatePosition(positionId, data);
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Mise à jour échouée"));
    }
  };

  const handleDeletePosition = async (positionId) => {
    try {
      await api.infra.deletePosition(positionId);
      showToast("Position supprimée");
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Suppression échouée"));
    }
  };

  const handleSaveZone = async (data) => {
    try {
      if (editingZone?.id) {
        await api.infra.updateZone(editingZone.id, data);
        showToast("Zone mise à jour");
      } else {
        await api.infra.createZone(data);
        showToast("Zone créée");
      }
      setZoneModalOpen(false);
      setEditingZone(null);
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Sauvegarde échouée"));
    }
  };

  const handleDeleteZone = async (id) => {
    if (!confirm("Supprimer cette zone ?")) return;
    try {
      await api.infra.deleteZone(id);
      showToast("Zone supprimée");
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Suppression échouée"));
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Infrastructure Électrique
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Placez les équipements ATEX sur vos plans d'infrastructure
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/app/atex")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Retour ATEX
            </button>
            <button
              onClick={() => setUploadModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Importer Plan
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="max-w-7xl mx-auto mt-4 flex gap-4 text-sm">
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full">
            {stats.plansCount} plans
          </span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">
            {stats.zonesCount} zones
          </span>
          <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full">
            {stats.positionsCount} équipements placés
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Plans list / Map view */}
            {!selectedPlan ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plans.map(plan => {
                  const planPositions = positions.filter(p => p.plan_id === plan.id);
                  const planZones = zones.filter(z => z.plan_id === plan.id);
                  return (
                    <div
                      key={plan.id}
                      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-900 truncate">
                              {plan.display_name || plan.logical_name}
                            </h3>
                            {plan.building_name && (
                              <p className="text-sm text-gray-500">{plan.building_name}</p>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeletePlan(plan.id); }}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        <div className="mt-3 flex gap-4 text-sm text-gray-600">
                          <span>{planZones.length} zones</span>
                          <span>{planPositions.length} équipements</span>
                        </div>
                        <button
                          onClick={() => setSelectedPlan(plan)}
                          className="mt-3 w-full px-4 py-2 bg-amber-100 text-amber-700 rounded-lg font-medium hover:bg-amber-200 transition-colors"
                        >
                          Ouvrir le plan
                        </button>
                      </div>
                    </div>
                  );
                })}

                {plans.length === 0 && (
                  <div className="col-span-full bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Aucun plan d'infrastructure</h3>
                    <p className="text-gray-500 mb-4">Commencez par importer un plan PDF</p>
                    <button
                      onClick={() => setUploadModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Importer un plan
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Map view */
              <div>
                <button
                  onClick={() => setSelectedPlan(null)}
                  className="mb-4 inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Retour aux plans
                </button>
                <InfrastructureMap
                  plan={selectedPlan}
                  positions={positions.filter(p => p.plan_id === selectedPlan.id)}
                  zones={zones.filter(z => z.plan_id === selectedPlan.id)}
                  atexEquipments={atexEquipments}
                  onPlaceEquipment={(eqId, x, y, page) => handlePlaceEquipment(eqId, selectedPlan.id, x, y, page)}
                  onUpdatePosition={handleUpdatePosition}
                  onDeletePosition={handleDeletePosition}
                  onZoneCreate={(data) => handleSaveZone({ ...data, plan_id: selectedPlan.id })}
                  onZoneUpdate={(id, data) => handleSaveZone({ ...data, id })}
                  onZoneDelete={handleDeleteZone}
                  refreshTick={mapRefreshTick}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* ============ UPLOAD MODAL ============ */}
      {uploadModalOpen && (
        <UploadPlanModal
          onClose={() => setUploadModalOpen(false)}
          onUpload={handleUploadPlan}
          buildingNames={buildingNames}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function UploadPlanModal({ onClose, onUpload, buildingNames }) {
  const [file, setFile] = useState(null);
  const [buildingName, setBuildingName] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    await onUpload(file, buildingName);
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Importer un plan</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fichier PDF
            </label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bâtiment (optionnel)
            </label>
            <input
              type="text"
              value={buildingName}
              onChange={(e) => setBuildingName(e.target.value)}
              placeholder="Ex: Bâtiment A"
              list="building-suggestions"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
            />
            <datalist id="building-suggestions">
              {buildingNames.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!file || uploading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Upload..." : "Importer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
