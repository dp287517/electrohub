// src/pages/Infrastructure.jsx
// Module Infrastructure - Plans électriques multi-zones
// Prises, éclairages, coffrets, boutons, boîtes de dérivation, etc.
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
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "dashboard");

  // Data states
  const [plans, setPlans] = useState([]);
  const [elements, setElements] = useState([]);
  const [zones, setZones] = useState([]);
  const [elementTypes, setElementTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected plan for map view
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Filters
  const [q, setQ] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");

  // Modal states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingElement, setEditingElement] = useState(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState(null);

  // Toast
  const [toast, setToast] = useState("");

  // Stats calculés
  const stats = useMemo(() => {
    const total = elements.length;
    const byType = {};
    elements.forEach(el => {
      byType[el.element_type] = (byType[el.element_type] || 0) + 1;
    });
    const byZone = {};
    zones.forEach(z => {
      byZone[z.name] = elements.filter(el => el.zone_id === z.id).length;
    });
    const byBuilding = {};
    plans.forEach(p => {
      byBuilding[p.building_name || "Sans bâtiment"] = elements.filter(el => el.plan_id === p.id).length;
    });
    return { total, byType, byZone, byBuilding, plansCount: plans.length, zonesCount: zones.length };
  }, [elements, zones, plans]);

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
      const [plansRes, elementsRes, zonesRes, typesRes] = await Promise.all([
        api.infra.listPlans().catch(() => ({ plans: [] })),
        api.infra.listElements().catch(() => ({ elements: [] })),
        api.infra.listZones().catch(() => ({ zones: [] })),
        api.infra.listElementTypes().catch(() => ({ types: [] })),
      ]);
      setPlans(plansRes?.plans || []);
      setElements(elementsRes?.elements || []);
      setZones(zonesRes?.zones || []);
      setElementTypes(typesRes?.types || []);
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
  // Filtered elements
  // ============================================================
  const filteredElements = useMemo(() => {
    let list = [...elements];
    if (q) {
      const searchLower = q.toLowerCase();
      list = list.filter(el =>
        el.element_type?.toLowerCase().includes(searchLower) ||
        el.label?.toLowerCase().includes(searchLower) ||
        el.notes?.toLowerCase().includes(searchLower)
      );
    }
    if (typeFilter) {
      list = list.filter(el => el.element_type === typeFilter);
    }
    if (zoneFilter) {
      list = list.filter(el => el.zone_id === zoneFilter);
    }
    if (buildingFilter) {
      const planIds = plans.filter(p => p.building_name === buildingFilter).map(p => p.id);
      list = list.filter(el => planIds.includes(el.plan_id));
    }
    return list;
  }, [elements, q, typeFilter, zoneFilter, buildingFilter, plans]);

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

  const handleSaveElement = async (data) => {
    try {
      if (editingElement?.id) {
        await api.infra.updateElement(editingElement.id, data);
        showToast("Élément mis à jour");
      } else {
        await api.infra.createElement(data);
        showToast("Élément créé");
      }
      setDrawerOpen(false);
      setEditingElement(null);
      fetchData();
      setMapRefreshTick(t => t + 1);
    } catch (err) {
      showToast("Erreur: " + (err.message || "Sauvegarde échouée"));
    }
  };

  const handleDeleteElement = async (id) => {
    if (!confirm("Supprimer cet élément ?")) return;
    try {
      await api.infra.deleteElement(id);
      showToast("Élément supprimé");
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
  // Render helpers
  // ============================================================
  const StatCard = ({ label, value, icon, color = "blue", onClick }) => (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 ${onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-${color}-100 dark:bg-${color}-900/30 flex items-center justify-center text-${color}-600 dark:text-${color}-400`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        </div>
      </div>
    </div>
  );

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Infrastructure Électrique
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Plans d'infrastructure - Prises, éclairages, coffrets, boutons...
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/app/atex")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg font-medium transition-colors"
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

        {/* Tabs */}
        <div className="max-w-7xl mx-auto mt-4 flex gap-1 overflow-x-auto">
          {[
            { id: "dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
            { id: "plans", label: "Plans", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
            { id: "elements", label: "Éléments", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
            { id: "zones", label: "Zones", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* ============ DASHBOARD TAB ============ */}
            {activeTab === "dashboard" && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="Plans"
                    value={stats.plansCount}
                    color="blue"
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                  />
                  <StatCard
                    label="Zones"
                    value={stats.zonesCount}
                    color="green"
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>}
                  />
                  <StatCard
                    label="Éléments"
                    value={stats.total}
                    color="amber"
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                  />
                  <StatCard
                    label="Bâtiments"
                    value={buildingNames.length}
                    color="purple"
                    icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
                  />
                </div>

                {/* Elements by Type */}
                {Object.keys(stats.byType).length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Éléments par type</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                        <div
                          key={type}
                          onClick={() => { setTypeFilter(type); setActiveTab("elements"); }}
                          className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        >
                          <p className="font-medium text-gray-900 dark:text-white truncate">{type}</p>
                          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{count}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick access to plans */}
                {plans.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Accès rapide aux plans</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {plans.slice(0, 6).map(plan => (
                        <div
                          key={plan.id}
                          onClick={() => { setSelectedPlan(plan); setActiveTab("plans"); }}
                          className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                              <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white truncate">
                                {plan.display_name || plan.logical_name}
                              </p>
                              {plan.building_name && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">{plan.building_name}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {plans.length === 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Aucun plan d'infrastructure</h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">Commencez par importer un plan PDF</p>
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
            )}

            {/* ============ PLANS TAB ============ */}
            {activeTab === "plans" && (
              <div className="space-y-4">
                {/* Plans list / Map view toggle */}
                {!selectedPlan ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {plans.map(plan => {
                      const planElements = elements.filter(e => e.plan_id === plan.id);
                      const planZones = zones.filter(z => z.plan_id === plan.id);
                      return (
                        <div
                          key={plan.id}
                          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
                        >
                          <div className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                  {plan.display_name || plan.logical_name}
                                </h3>
                                {plan.building_name && (
                                  <p className="text-sm text-gray-500 dark:text-gray-400">{plan.building_name}</p>
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
                            <div className="mt-3 flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                              <span>{planZones.length} zones</span>
                              <span>{planElements.length} éléments</span>
                            </div>
                            <button
                              onClick={() => setSelectedPlan(plan)}
                              className="mt-3 w-full px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                            >
                              Ouvrir le plan
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {plans.length === 0 && (
                      <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                        Aucun plan importé. Cliquez sur "Importer Plan" pour commencer.
                      </div>
                    )}
                  </div>
                ) : (
                  /* Map view */
                  <div>
                    <button
                      onClick={() => setSelectedPlan(null)}
                      className="mb-4 inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      Retour aux plans
                    </button>
                    <InfrastructureMap
                      plan={selectedPlan}
                      elements={elements.filter(e => e.plan_id === selectedPlan.id)}
                      zones={zones.filter(z => z.plan_id === selectedPlan.id)}
                      elementTypes={elementTypes}
                      onElementClick={(el) => { setEditingElement(el); setDrawerOpen(true); }}
                      onElementCreate={(data) => handleSaveElement({ ...data, plan_id: selectedPlan.id })}
                      onElementUpdate={(id, data) => handleSaveElement({ ...data, id })}
                      onElementDelete={handleDeleteElement}
                      onZoneCreate={(data) => handleSaveZone({ ...data, plan_id: selectedPlan.id })}
                      onZoneUpdate={(id, data) => handleSaveZone({ ...data, id })}
                      onZoneDelete={handleDeleteZone}
                      refreshTick={mapRefreshTick}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ============ ELEMENTS TAB ============ */}
            {activeTab === "elements" && (
              <div className="space-y-4">
                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex flex-wrap gap-4">
                    <input
                      type="text"
                      placeholder="Rechercher..."
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">Tous les types</option>
                      {elementTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <select
                      value={buildingFilter}
                      onChange={(e) => setBuildingFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">Tous les bâtiments</option>
                      {buildingNames.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => { setQ(""); setTypeFilter(""); setBuildingFilter(""); setZoneFilter(""); }}
                      className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      Effacer
                    </button>
                  </div>
                </div>

                {/* Elements list */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Label</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Zone</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Plan</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredElements.map(el => {
                        const zone = zones.find(z => z.id === el.zone_id);
                        const plan = plans.find(p => p.id === el.plan_id);
                        return (
                          <tr key={el.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{el.element_type}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{el.label || "-"}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{zone?.name || "-"}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                              {plan?.display_name || plan?.logical_name || "-"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => { setEditingElement(el); setDrawerOpen(true); }}
                                  className="p-1 text-gray-400 hover:text-amber-500"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteElement(el.id)}
                                  className="p-1 text-gray-400 hover:text-red-500"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredElements.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                            Aucun élément trouvé
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ============ ZONES TAB ============ */}
            {activeTab === "zones" && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button
                    onClick={() => { setEditingZone({}); setZoneModalOpen(true); }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Nouvelle zone
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {zones.map(zone => {
                    const plan = plans.find(p => p.id === zone.plan_id);
                    const zoneElements = elements.filter(e => e.zone_id === zone.id);
                    return (
                      <div
                        key={zone.id}
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-white">{zone.name}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {plan?.display_name || plan?.logical_name || "Aucun plan"}
                            </p>
                          </div>
                          <div
                            className="w-6 h-6 rounded"
                            style={{ backgroundColor: zone.color || "#6B7280" }}
                          />
                        </div>
                        <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                          {zoneElements.length} élément(s)
                        </div>
                        {zone.linked_atex_plans?.length > 0 && (
                          <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                            Lié à: {zone.linked_atex_plans.join(", ")}
                          </div>
                        )}
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => { setEditingZone(zone); setZoneModalOpen(true); }}
                            className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => handleDeleteZone(zone.id)}
                            className="px-3 py-1.5 text-red-600 hover:text-red-700"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {zones.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                      Aucune zone définie. Les zones sont créées automatiquement sur les plans ou manuellement ici.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
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

      {/* ============ ELEMENT DRAWER ============ */}
      {drawerOpen && (
        <ElementDrawer
          element={editingElement}
          elementTypes={elementTypes}
          zones={zones}
          plans={plans}
          onClose={() => { setDrawerOpen(false); setEditingElement(null); }}
          onSave={handleSaveElement}
          onDelete={handleDeleteElement}
        />
      )}

      {/* ============ ZONE MODAL ============ */}
      {zoneModalOpen && (
        <ZoneModal
          zone={editingZone}
          plans={plans}
          onClose={() => { setZoneModalOpen(false); setEditingZone(null); }}
          onSave={handleSaveZone}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg animate-fade-in">
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
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Importer un plan</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Fichier PDF
            </label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Bâtiment (optionnel)
            </label>
            <input
              type="text"
              value={buildingName}
              onChange={(e) => setBuildingName(e.target.value)}
              placeholder="Ex: Bâtiment A"
              list="building-suggestions"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <datalist id="building-suggestions">
              {buildingNames.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
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

function ElementDrawer({ element, elementTypes, zones, plans, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({
    element_type: element?.element_type || "",
    label: element?.label || "",
    notes: element?.notes || "",
    plan_id: element?.plan_id || "",
    zone_id: element?.zone_id || "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50">
      <div className="bg-white dark:bg-gray-800 h-full w-full max-w-md shadow-xl overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {element?.id ? "Modifier l'élément" : "Nouvel élément"}
            </h2>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <input
                type="text"
                value={form.element_type}
                onChange={(e) => setForm({ ...form, element_type: e.target.value })}
                list="element-types"
                placeholder="Ex: Prise, Éclairage..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
              <datalist id="element-types">
                {elementTypes.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Ex: PR-001"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan</label>
              <select
                value={form.plan_id}
                onChange={(e) => setForm({ ...form, plan_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Sélectionner un plan</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.display_name || p.logical_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Zone</label>
              <select
                value={form.zone_id}
                onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Auto-détection</option>
                {zones.filter(z => !form.plan_id || z.plan_id === form.plan_id).map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex gap-3 pt-4">
              {element?.id && (
                <button
                  type="button"
                  onClick={() => onDelete(element.id)}
                  className="px-4 py-2 text-red-600 hover:text-red-700"
                >
                  Supprimer
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 dark:text-gray-400"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ZoneModal({ zone, plans, onClose, onSave }) {
  const [form, setForm] = useState({
    name: zone?.name || "",
    plan_id: zone?.plan_id || "",
    color: zone?.color || "#6B7280",
    linked_atex_plans: zone?.linked_atex_plans || [],
  });
  const [atexInput, setAtexInput] = useState("");

  const handleAddAtex = () => {
    if (atexInput && !form.linked_atex_plans.includes(atexInput)) {
      setForm({ ...form, linked_atex_plans: [...form.linked_atex_plans, atexInput] });
      setAtexInput("");
    }
  };

  const handleRemoveAtex = (name) => {
    setForm({ ...form, linked_atex_plans: form.linked_atex_plans.filter(n => n !== name) });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          {zone?.id ? "Modifier la zone" : "Nouvelle zone"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nom</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Zone A"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan</label>
            <select
              value={form.plan_id}
              onChange={(e) => setForm({ ...form, plan_id: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              required
            >
              <option value="">Sélectionner un plan</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.display_name || p.logical_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Couleur</label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="w-full h-10 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              PIDs ATEX liés (optionnel)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={atexInput}
                onChange={(e) => setAtexInput(e.target.value)}
                placeholder="Nom du PID ATEX"
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleAddAtex}
                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                +
              </button>
            </div>
            {form.linked_atex_plans.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {form.linked_atex_plans.map(name => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded text-sm"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => handleRemoveAtex(name)}
                      className="hover:text-amber-900 dark:hover:text-amber-200"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 dark:text-gray-400"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
