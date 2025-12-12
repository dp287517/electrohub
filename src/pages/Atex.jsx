// src/pages/Atex.jsx
// ✅ VERSION REFONDÉE - Design style SwitchboardControls
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");
import "../styles/atex-map.css";
import { api, API_BASE } from "../lib/api.js";
import AtexMap from "./Atex-map.jsx";

// ============================================================
// ATEX EQUIPMENTS - Page principale v2.0
// Design inspiré de SwitchboardControls
// ============================================================

export default function Atex() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "dashboard");

  // Data states
  const [items, setItems] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapsLoading, setMapsLoading] = useState(false);

  // Stats calculés
  const stats = useMemo(() => {
    const total = items.length;
    const conforme = items.filter(it => it.compliance_state === "conforme").length;
    const nonConforme = items.filter(it => it.compliance_state === "non_conforme").length;
    const aFaire = items.filter(it => it.status === "a_faire").length;
    const enCours = items.filter(it => it.status === "en_cours_30").length;
    const enRetard = items.filter(it => it.status === "en_retard").length;
    const zonesGaz = items.filter(it => it.zoning_gas != null).length;
    const zonesDust = items.filter(it => it.zoning_dust != null).length;
    return { total, conforme, nonConforme, aFaire, enCours, enRetard, zonesGaz, zonesDust };
  }, [items]);

  // Listes filtrées
  const overdueList = useMemo(() =>
    items.filter(it => it.status === "en_retard" || (it.next_check_date && dayjs(it.next_check_date).isBefore(dayjs())))
  , [items]);

  const upcomingList = useMemo(() =>
    items.filter(it => {
      if (!it.next_check_date) return false;
      const nextDate = dayjs(it.next_check_date);
      return nextDate.isAfter(dayjs()) && nextDate.isBefore(dayjs().add(30, 'day'));
    })
  , [items]);

  // Filtres
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [complianceFilter, setComplianceFilter] = useState("");

  // Modal states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const initialRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [history, setHistory] = useState([]);

  // Plans
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Toast
  const [toast, setToast] = useState("");

  // Update URL when tab changes
  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  /* ----------------------------- Data Loading ----------------------------- */
  const debouncer = useRef(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.atex.listEquipments({
        q,
        status: statusFilter,
        building: buildingFilter,
        zone: zoneFilter,
        compliance: complianceFilter,
        limit: 500,
      });
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      console.error('[ATEX] Error loading:', e);
      setItems([]);
      setToast("Erreur chargement équipements");
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, buildingFilter, zoneFilter, complianceFilter]);

  const loadPlans = useCallback(async () => {
    setMapsLoading(true);
    try {
      const r = await api.atexMaps.listPlans();
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally {
      setMapsLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(reload, 300);
  }, [q, statusFilter, buildingFilter, zoneFilter, complianceFilter]);

  useEffect(() => {
    if (activeTab === "plans") loadPlans();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "plans" && selectedPlan) setSelectedPlan(null);
  }, [activeTab]);

  /* ----------------------------- Helpers ----------------------------- */
  const mergeZones = (raw) => {
    if (!raw) return raw;
    const clean = { ...raw };
    ["building", "zone", "equipment", "sub_equipment"].forEach((field) => {
      if (typeof clean[field] === "object" && clean[field] !== null) {
        clean[field] = clean[field].name || clean[field].equipment || clean[field].id || "";
      } else if (clean[field] == null) {
        clean[field] = "";
      }
    });
    return clean;
  };

  function next36MonthsISO(dateStr) {
    if (!dateStr) return "";
    const d = dayjs(dateStr);
    return d.isValid() ? d.add(36, "month").format("YYYY-MM-DD") : "";
  }

  function asDateInput(d) {
    if (!d) return "";
    return dayjs(d).format("YYYY-MM-DD");
  }

  /* ----------------------------- Equipment Edit ----------------------------- */
  async function openEdit(eq) {
    let fresh = eq;
    if (eq?.id) {
      try {
        const res = await api.atex.getEquipment(eq.id);
        fresh = mergeZones(res?.equipment || eq);
      } catch {
        fresh = mergeZones(eq);
      }
    } else {
      fresh = mergeZones({
        name: "", building: "", zone: "", equipment: "", sub_equipment: "",
        type: "", manufacturer: "", manufacturer_ref: "",
        atex_mark_gas: null, atex_mark_dust: null, comment: "",
        status: "a_faire", zoning_gas: null, zoning_dust: null,
        compliance_state: "na", installed_at: null,
        last_check_date: null, next_check_date: null, photo_url: null,
      });
    }

    setEditing(fresh);
    initialRef.current = JSON.parse(JSON.stringify(fresh));

    if (fresh?.id) {
      await reloadFiles(fresh.id);
      try {
        const hist = await api.atex.getEquipmentHistory(fresh.id);
        setHistory(Array.isArray(hist?.checks) ? hist.checks : []);
      } catch {
        setHistory([]);
      }
    } else {
      setFiles([]);
      setHistory([]);
    }
    setDrawerOpen(true);
  }

  function closeEdit() {
    setDrawerOpen(false);
    setTimeout(() => {
      setEditing(null);
      initialRef.current = null;
    }, 200);
  }

  function isDirty() {
    if (!editing) return false;
    return JSON.stringify(editing) !== JSON.stringify(initialRef.current || {});
  }

  async function reloadFiles(equipId) {
    if (!equipId) return;
    try {
      const res = await api.atex.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url: f.download_url || f.inline_url || `${API_BASE}/api/atex/files/${encodeURIComponent(f.id)}/download`,
          }))
        : [];
      setFiles(arr);
    } catch {
      setFiles([]);
    }
  }

  async function saveBase() {
    if (!editing) return;

    const payload = {
      name: editing.name || "",
      building: editing.building || "",
      zone: editing.zone || "",
      equipment: editing.equipment || "",
      sub_equipment: editing.sub_equipment || "",
      type: editing.type || "",
      manufacturer: editing.manufacturer || "",
      manufacturer_ref: editing.manufacturer_ref || "",
      atex_mark_gas: editing.atex_mark_gas || null,
      atex_mark_dust: editing.atex_mark_dust || null,
      comment: editing.comment || "",
      status: editing.status || "a_faire",
      installed_at: editing.installed_at || editing.installation_date || null,
      last_check_date: editing.last_check_date || null,
      next_check_date: editing.next_check_date || null,
      zoning_gas: editing.zoning_gas ?? null,
      zoning_dust: editing.zoning_dust ?? null,
    };

    try {
      let updated;
      if (editing.id) {
        updated = await api.atex.updateEquipment(editing.id, payload);
      } else {
        updated = await api.atex.createEquipment(payload);
      }

      const eq = updated?.equipment || updated || null;
      if (eq?.id) {
        const fresh = mergeZones(eq);
        setEditing(fresh);
        initialRef.current = fresh;
      }

      await reload();
      setToast("Fiche enregistrée");
    } catch (e) {
      console.error("[ATEX] Save error:", e);
      setToast("Erreur enregistrement");
    }
  }

  async function deleteEquipment() {
    if (!editing?.id) return;
    if (!window.confirm("Supprimer définitivement cet équipement ATEX ?")) return;
    try {
      await api.atex.removeEquipment(editing.id);
      closeEdit();
      await reload();
      setMapRefreshTick((t) => t + 1);
      setToast("Équipement supprimé");
    } catch {
      setToast("Suppression impossible");
    }
  }

  /* ----------------------------- Photos / Files ----------------------------- */
  async function uploadMainPhoto(file) {
    if (!editing?.id || !file) return;
    try {
      await api.atex.uploadPhoto(editing.id, file);
      const url = api.atex.photoUrl(editing.id, { bust: true });
      setEditing((cur) => ({ ...(cur || {}), photo_url: url }));
      await reloadFiles(editing.id);
      await reload();
      setToast("Photo mise à jour");
    } catch {
      setToast("Échec upload photo");
    }
  }

  async function uploadAttachments(filesArr) {
    if (!editing?.id || !filesArr?.length) return;
    try {
      await api.atex.uploadAttachments(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch {
      setToast("Échec upload fichiers");
    }
  }

  /* ----------------------------- AI Analysis ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;
    try {
      const res = await api.atex.analyzePhotoBatch(list);
      const s = res?.extracted || res || {};
      setEditing((x) => {
        const safe = { ...x };
        const applyIfValid = (field, value) => {
          if (value && typeof value === "string" && value.trim().length > 2) {
            safe[field] = value.trim();
          }
        };
        applyIfValid("manufacturer", s.manufacturer);
        applyIfValid("manufacturer_ref", s.manufacturer_ref);
        applyIfValid("atex_mark_gas", s.atex_mark_gas);
        applyIfValid("atex_mark_dust", s.atex_mark_dust);
        applyIfValid("type", s.type);
        return safe;
      });
      setToast("Analyse photos terminée");
    } catch {
      setToast("Analyse photos indisponible");
    }
  }

  async function verifyComplianceIA() {
    if (!editing?.id) {
      alert("Veuillez d'abord enregistrer la fiche.");
      return;
    }
    if (isDirty()) await saveBase();

    try {
      const body = {
        atex_mark_gas: editing.atex_mark_gas || "",
        atex_mark_dust: editing.atex_mark_dust || "",
        target_gas: editing.zoning_gas ?? null,
        target_dust: editing.zoning_dust ?? null,
      };

      const res = (api.atex.assessConformity && (await api.atex.assessConformity(body))) ||
        (api.atex.aiAnalyze && (await api.atex.aiAnalyze(body)));

      const decision = res?.decision || null;
      const rationale = res?.rationale || "";
      const source = res?.source || "unknown";

      if (editing?.id && api.atex.applyCompliance) {
        await api.atex.applyCompliance(editing.id, { decision, rationale, source });
      }

      setEditing((cur) => ({ ...(cur || {}), compliance_state: decision || cur?.compliance_state || "na" }));

      try {
        const hist = await api.atex.getEquipmentHistory(editing.id);
        setHistory(Array.isArray(hist?.checks) ? hist.checks : []);
      } catch {}

      await reload();
      setToast(decision ? `Conformité: ${decision === "conforme" ? "Conforme" : "Non conforme"}` : "Analyse IA terminée");
    } catch {
      setToast("Échec vérification conformité IA");
    }
  }

  /* ----------------------------- Zone updates ----------------------------- */
  function applyZonesLocally(id, zones) {
    if (!id) return;
    setItems((old) =>
      (old || []).map((it) =>
        it.id === id ? { ...it, zoning_gas: zones?.zoning_gas ?? it.zoning_gas, zoning_dust: zones?.zoning_dust ?? it.zoning_dust } : it
      )
    );
    setEditing((cur) =>
      cur && cur.id === id ? { ...cur, zoning_gas: zones?.zoning_gas ?? cur.zoning_gas, zoning_dust: zones?.zoning_dust ?? cur.zoning_dust } : cur
    );
  }

  /* ----------------------------- UI Components ----------------------------- */
  const dirty = isDirty();

  const TabButton = ({ id, label, count, color }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2.5 rounded-t-lg font-medium transition-all ${
        activeTab === id
          ? "bg-white text-blue-600 border-t-2 border-x border-blue-600 -mb-px"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 border-transparent"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${color || "bg-gray-200 text-gray-700"}`}>
          {count}
        </span>
      )}
    </button>
  );

  const StatCard = ({ label, value, color, icon }) => {
    const colors = {
      blue: "bg-blue-50 text-blue-800 border-blue-200",
      red: "bg-red-50 text-red-800 border-red-200",
      green: "bg-emerald-50 text-emerald-800 border-emerald-200",
      orange: "bg-amber-50 text-amber-800 border-amber-200",
      purple: "bg-purple-50 text-purple-800 border-purple-200",
      gray: "bg-gray-50 text-gray-800 border-gray-200",
    };
    return (
      <div className={`rounded-xl p-4 border ${colors[color] || colors.gray}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-75">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <span className="text-3xl">{icon}</span>
        </div>
      </div>
    );
  };

  const Badge = ({ color = "gray", children, className = "" }) => {
    const map = {
      gray: "bg-gray-100 text-gray-700",
      green: "bg-emerald-100 text-emerald-700",
      orange: "bg-amber-100 text-amber-700",
      red: "bg-rose-100 text-rose-700",
      blue: "bg-blue-100 text-blue-700",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color] || map.gray} ${className}`}>
        {children}
      </span>
    );
  };

  /* ----------------------------- Render ----------------------------- */
  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          <span className="text-gray-500">Chargement des équipements ATEX...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10010] bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-lg text-sm animate-fadeIn">
          {toast}
          <button onClick={() => setToast("")} className="ml-3 text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Équipements ATEX</h1>
          <p className="text-gray-500">Gestion des équipements en zones explosives</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
          >
            <span>🔍</span>
            {filtersOpen ? "Masquer filtres" : "Filtres"}
          </button>
          <button
            onClick={() => openEdit({})}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Nouvel équipement
          </button>
        </div>
      </div>

      {/* Filters */}
      {filtersOpen && (
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
          <div className="grid md:grid-cols-5 gap-3">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche..."
              className="border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value="">Tous statuts</option>
              <option value="a_faire">À faire</option>
              <option value="en_cours_30">En cours ≤90j</option>
              <option value="en_retard">En retard</option>
            </select>
            <input
              type="text"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              placeholder="Bâtiment"
              className="border rounded-lg px-3 py-2 text-sm w-full"
            />
            <input
              type="text"
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              placeholder="Zone"
              className="border rounded-lg px-3 py-2 text-sm w-full"
            />
            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value="">Toute conformité</option>
              <option value="conforme">Conforme</option>
              <option value="non_conforme">Non conforme</option>
            </select>
          </div>
          <button
            onClick={() => { setQ(""); setStatusFilter(""); setBuildingFilter(""); setZoneFilter(""); setComplianceFilter(""); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Réinitialiser les filtres
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        <TabButton id="dashboard" label="Tableau de bord" />
        <TabButton id="controls" label="Équipements" count={stats.total} color="bg-blue-100 text-blue-800" />
        <TabButton id="overdue" label="En retard" count={stats.enRetard} color="bg-red-100 text-red-800" />
        <TabButton id="calendar" label="Calendrier" />
        <TabButton id="plans" label="Plans" count={plans.length} color="bg-purple-100 text-purple-800" />
        <TabButton id="settings" label="Paramètres" />
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        {/* DASHBOARD */}
        {activeTab === "dashboard" && (
          <DashboardTab
            stats={stats}
            overdueList={overdueList}
            upcomingList={upcomingList}
            onOpenEquipment={openEdit}
          />
        )}

        {/* EQUIPMENTS LIST */}
        {activeTab === "controls" && (
          <EquipmentsTab
            items={items}
            loading={loading}
            onOpenEquipment={openEdit}
          />
        )}

        {/* OVERDUE */}
        {activeTab === "overdue" && (
          <OverdueTab
            overdueList={overdueList}
            onOpenEquipment={openEdit}
          />
        )}

        {/* CALENDAR */}
        {activeTab === "calendar" && (
          <CalendarTab items={items} onOpenEquipment={openEdit} />
        )}

        {/* PLANS */}
        {activeTab === "plans" && (
          <PlansTab
            plans={plans}
            mapsLoading={mapsLoading}
            selectedPlan={selectedPlan}
            setSelectedPlan={setSelectedPlan}
            mapRefreshTick={mapRefreshTick}
            setMapRefreshTick={setMapRefreshTick}
            loadPlans={loadPlans}
            openEdit={openEdit}
            applyZonesLocally={applyZonesLocally}
            reload={reload}
            mergeZones={mergeZones}
            editing={editing}
            setEditing={setEditing}
            setToast={setToast}
          />
        )}

        {/* SETTINGS */}
        {activeTab === "settings" && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-4">⚙️</p>
            <p className="font-medium">Paramètres ATEX</p>
            <p className="text-sm mt-2">Configuration globale (fréquence contrôles, checklist...) à venir.</p>
          </div>
        )}
      </div>

      {/* Equipment Drawer */}
      {drawerOpen && editing && (
        <EquipmentDrawer
          editing={editing}
          setEditing={setEditing}
          dirty={dirty}
          onClose={closeEdit}
          onSave={saveBase}
          onDelete={deleteEquipment}
          files={files}
          history={history}
          onUploadPhoto={uploadMainPhoto}
          onUploadAttachments={uploadAttachments}
          onAnalyzePhotos={analyzeFromPhotos}
          onVerifyCompliance={verifyComplianceIA}
          asDateInput={asDateInput}
          next36MonthsISO={next36MonthsISO}
        />
      )}
    </div>
  );
}

// ============================================================
// DASHBOARD TAB
// ============================================================

function DashboardTab({ stats, overdueList, upcomingList, onOpenEquipment }) {
  const StatCard = ({ label, value, color, icon }) => {
    const colors = {
      blue: "bg-blue-50 text-blue-800 border-blue-200",
      red: "bg-red-50 text-red-800 border-red-200",
      green: "bg-emerald-50 text-emerald-800 border-emerald-200",
      orange: "bg-amber-50 text-amber-800 border-amber-200",
      purple: "bg-purple-50 text-purple-800 border-purple-200",
    };
    return (
      <div className={`rounded-xl p-4 border ${colors[color]}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-75">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
          <span className="text-3xl">{icon}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total équipements" value={stats.total} color="blue" icon="📦" />
        <StatCard label="Conformes" value={stats.conforme} color="green" icon="✅" />
        <StatCard label="Non conformes" value={stats.nonConforme} color="red" icon="⚠️" />
        <StatCard label="En retard" value={stats.enRetard} color="orange" icon="🕐" />
      </div>

      {/* Zones Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💨</span>
            <div>
              <p className="text-sm text-amber-700">Zones Gaz (0/1/2)</p>
              <p className="text-2xl font-bold text-amber-800">{stats.zonesGaz} équipements</p>
            </div>
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌫️</span>
            <div>
              <p className="text-sm text-orange-700">Zones Poussière (20/21/22)</p>
              <p className="text-2xl font-bold text-orange-800">{stats.zonesDust} équipements</p>
            </div>
          </div>
        </div>
      </div>

      {/* Overdue Alerts */}
      {overdueList.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
            <span>⚠️</span> Contrôles en retard ({overdueList.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {overdueList.slice(0, 10).map((eq) => (
              <div key={eq.id} className="flex items-center justify-between bg-white rounded-lg p-3 shadow-sm">
                <div>
                  <span className="font-medium">{eq.name || eq.type || "Équipement"}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  <span className="text-gray-600">{eq.building || "—"} / {eq.zone || "—"}</span>
                  {eq.next_check_date && (
                    <span className="ml-2 text-red-600 text-sm">
                      Dû le {dayjs(eq.next_check_date).format("DD/MM/YYYY")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onOpenEquipment(eq)}
                  className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                >
                  Contrôler
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcomingList.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
            <span>📅</span> Contrôles à venir (30 jours)
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {upcomingList.slice(0, 10).map((eq) => (
              <div key={eq.id} className="flex items-center justify-between bg-white rounded-lg p-3 shadow-sm">
                <div>
                  <span className="font-medium">{eq.name || eq.type || "Équipement"}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  <span className="text-gray-600">{eq.building || "—"} / {eq.zone || "—"}</span>
                  <span className="ml-2 text-blue-600 text-sm">
                    Prévu le {dayjs(eq.next_check_date).format("DD/MM/YYYY")}
                  </span>
                </div>
                <button
                  onClick={() => onOpenEquipment(eq)}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  Voir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Clear */}
      {overdueList.length === 0 && upcomingList.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">✅</p>
          <p className="font-medium">Tous les contrôles sont à jour !</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// EQUIPMENTS TAB
// ============================================================

function EquipmentsTab({ items, loading, onOpenEquipment }) {
  const statusLabel = (st) => {
    if (st === "a_faire") return "À faire";
    if (st === "en_cours_30") return "En cours";
    if (st === "en_retard") return "En retard";
    return "—";
  };

  const statusColor = (st) => {
    if (st === "a_faire") return "green";
    if (st === "en_cours_30") return "orange";
    if (st === "en_retard") return "red";
    return "gray";
  };

  const Badge = ({ color = "gray", children }) => {
    const map = {
      gray: "bg-gray-100 text-gray-700",
      green: "bg-emerald-100 text-emerald-700",
      orange: "bg-amber-100 text-amber-700",
      red: "bg-rose-100 text-rose-700",
      blue: "bg-blue-100 text-blue-700",
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]}`}>{children}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-4xl mb-4">📦</p>
        <p>Aucun équipement ATEX trouvé.</p>
        <p className="text-sm mt-2">Créez-en un nouveau ou importez des plans.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-3 font-semibold">Équipement</th>
            <th className="text-left p-3 font-semibold">Localisation</th>
            <th className="text-left p-3 font-semibold">Zonage</th>
            <th className="text-left p-3 font-semibold">Conformité</th>
            <th className="text-left p-3 font-semibold">Statut</th>
            <th className="text-left p-3 font-semibold">Prochain contrôle</th>
            <th className="text-left p-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={it.id} className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : ""}`}>
              <td className="p-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg border overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
                    {it.photo_url ? (
                      <img src={api.atex.photoUrl(it.id, { thumb: true })} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-gray-400 text-lg">📷</span>
                    )}
                  </div>
                  <button className="text-blue-600 font-medium hover:underline text-left" onClick={() => onOpenEquipment(it)}>
                    {it.name || it.type || "Équipement"}
                  </button>
                </div>
              </td>
              <td className="p-3 text-gray-600">
                {it.building || "—"} / {it.zone || "—"}
                {it.equipment && <span className="text-gray-400"> • {it.equipment}</span>}
              </td>
              <td className="p-3">
                <div className="flex gap-1">
                  {it.zoning_gas != null && <Badge color="orange">Gaz {it.zoning_gas}</Badge>}
                  {it.zoning_dust != null && <Badge color="blue">Dust {it.zoning_dust}</Badge>}
                  {it.zoning_gas == null && it.zoning_dust == null && <span className="text-gray-400">—</span>}
                </div>
              </td>
              <td className="p-3">
                {it.compliance_state === "conforme" ? (
                  <Badge color="green">Conforme</Badge>
                ) : it.compliance_state === "non_conforme" ? (
                  <Badge color="red">Non conforme</Badge>
                ) : (
                  <Badge>N/A</Badge>
                )}
              </td>
              <td className="p-3">
                <Badge color={statusColor(it.status)}>{statusLabel(it.status)}</Badge>
              </td>
              <td className="p-3 whitespace-nowrap text-gray-600">
                {it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : "—"}
              </td>
              <td className="p-3">
                <button
                  onClick={() => onOpenEquipment(it)}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm"
                >
                  Ouvrir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// OVERDUE TAB
// ============================================================

function OverdueTab({ overdueList, onOpenEquipment }) {
  if (overdueList.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-4xl mb-4">✅</p>
        <p className="font-medium">Aucun contrôle en retard</p>
        <p className="text-sm mt-2">Tous vos équipements sont à jour.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {overdueList.map((eq) => (
        <div key={eq.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg border overflow-hidden bg-white flex items-center justify-center">
              {eq.photo_url ? (
                <img src={api.atex.photoUrl(eq.id, { thumb: true })} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">⚠️</span>
              )}
            </div>
            <div>
              <span className="font-semibold text-red-800">{eq.name || eq.type || "Équipement"}</span>
              <p className="text-sm text-gray-600">{eq.building || "—"} / {eq.zone || "—"}</p>
              {eq.next_check_date && (
                <p className="text-sm text-red-600 mt-1">
                  En retard de {Math.max(0, Math.ceil((new Date() - new Date(eq.next_check_date)) / (1000 * 60 * 60 * 24)))} jours
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => onOpenEquipment(eq)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Contrôler maintenant
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// CALENDAR TAB
// ============================================================

function CalendarTab({ items, onOpenEquipment }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf("month"));

  const days = useMemo(() => {
    const start = cursor.startOf("month").startOf("week").add(1, "day");
    const arr = [];
    for (let i = 0; i < 42; i++) arr.push(start.add(i, "day"));
    return arr;
  }, [cursor]);

  const eventsMap = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!it.next_check_date) continue;
      const k = dayjs(it.next_check_date).format("YYYY-MM-DD");
      m.set(k, [...(m.get(k) || []), it]);
    }
    return m;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{cursor.format("MMMM YYYY")}</h3>
        <div className="flex gap-2">
          <button onClick={() => setCursor(cursor.subtract(1, "month"))} className="px-3 py-1 bg-gray-100 rounded-lg hover:bg-gray-200">◀</button>
          <button onClick={() => setCursor(dayjs().startOf("month"))} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">Aujourd'hui</button>
          <button onClick={() => setCursor(cursor.add(1, "month"))} className="px-3 py-1 bg-gray-100 rounded-lg hover:bg-gray-200">▶</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-1">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => (
          <div key={l} className="px-2 py-1 text-center font-medium">{l}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const es = eventsMap.get(key) || [];
          const isCurMonth = day.month() === cursor.month();
          const isToday = day.isSame(dayjs(), "day");

          return (
            <button
              key={key}
              onClick={() => {
                if (es.length === 1) {
                  onOpenEquipment(es[0]);
                } else if (es.length > 1) {
                  alert(`${es.length} contrôles le ${day.format("DD/MM/YYYY")}:\n${es.map(e => e.name || e.type).join("\n")}`);
                }
              }}
              className={`border rounded-lg p-2 text-left min-h-[70px] transition-colors ${
                isCurMonth ? "bg-white hover:bg-gray-50" : "bg-gray-50 text-gray-400"
              } ${isToday ? "ring-2 ring-blue-500" : ""}`}
            >
              <div className={`text-xs mb-1 ${isToday ? "font-bold text-blue-600" : ""}`}>{day.format("D")}</div>
              <div className="flex flex-wrap gap-1">
                {es.slice(0, 3).map((ev, i) => (
                  <span key={i} className="px-1 rounded bg-blue-100 text-blue-700 text-[10px] truncate max-w-full">
                    {ev.name || ev.type || "Eq."}
                  </span>
                ))}
                {es.length > 3 && <span className="text-[10px] text-gray-500">+{es.length - 3}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PLANS TAB
// ============================================================

function PlansTab({ plans, mapsLoading, selectedPlan, setSelectedPlan, mapRefreshTick, setMapRefreshTick, loadPlans, openEdit, applyZonesLocally, reload, mergeZones, editing, setEditing, setToast }) {
  const grouped = useMemo(() => {
    const byKey = new Map();
    for (const p of plans) {
      const batKey = p.building?.trim() || "Autres";
      const zoneKey = p.zone?.trim() || "Zone non renseignée";
      const g = byKey.get(batKey) || { key: batKey, zones: new Map() };
      const z = g.zones.get(zoneKey) || { name: zoneKey, items: [] };
      z.items.push(p);
      g.zones.set(zoneKey, z);
      byKey.set(batKey, g);
    }
    return Array.from(byKey.values()).map((g) => ({
      key: g.key,
      zones: Array.from(g.zones.values()),
    }));
  }, [plans]);

  return (
    <div className="space-y-4">
      {/* Import ZIP */}
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
        <span className="font-medium">Plans PDF ATEX</span>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                await api.atexMaps.uploadZip(f);
                setToast("Plans importés");
                await loadPlans();
              }
              e.target.value = "";
            }}
          />
          Import ZIP
        </label>
      </div>

      {/* Plans List */}
      {mapsLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">📄</p>
          <p>Aucun plan ATEX chargé.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((bat) => (
            <details key={bat.key} className="border rounded-xl bg-white">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer bg-gray-50 rounded-t-xl hover:bg-gray-100">
                <span className="font-medium">🏢 {bat.key}</span>
                <span className="text-sm text-gray-500">{bat.zones.reduce((n, z) => n + z.items.length, 0)} plan(s)</span>
              </summary>
              <div className="p-3 space-y-2">
                {bat.zones.map((z) => (
                  <details key={z.name} className="pl-3 border-l-2 border-gray-200">
                    <summary className="cursor-pointer py-1 text-sm text-gray-700 hover:text-gray-900">
                      📍 {z.name} ({z.items.length})
                    </summary>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {z.items.map((p) => (
                        <button
                          key={p.id || p.logical_name}
                          onClick={() => {
                            if (selectedPlan?.logical_name === p.logical_name) {
                              setSelectedPlan(null);
                            } else {
                              setSelectedPlan(p);
                              setMapRefreshTick((t) => t + 1);
                            }
                          }}
                          className={`p-3 border rounded-xl text-left transition-all hover:shadow ${
                            selectedPlan?.logical_name === p.logical_name ? "border-blue-500 bg-blue-50" : "bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">📄</span>
                            <span className="font-medium truncate">{p.display_name || p.logical_name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Selected Plan Map */}
      {selectedPlan && (
        <div className="border rounded-xl p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{selectedPlan.display_name || selectedPlan.logical_name}</h3>
            <button
              onClick={() => setSelectedPlan(null)}
              className="px-3 py-1 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm"
            >
              Fermer
            </button>
          </div>
          <AtexMap
            key={`${selectedPlan.logical_name}:${mapRefreshTick}`}
            plan={selectedPlan}
            onOpenEquipment={openEdit}
            onZonesApplied={async (id, zones) => {
              applyZonesLocally(id, zones);
              await reload();
              if (editing?.id === id) {
                try {
                  const res = await api.atex.getEquipment(id);
                  const fresh = mergeZones(res?.equipment || {});
                  setEditing((cur) => ({ ...(cur || {}), ...fresh }));
                } catch {}
              }
            }}
            onMetaChanged={async () => {
              await reload();
              setToast("Plans et équipements mis à jour");
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// EQUIPMENT DRAWER
// ============================================================

function EquipmentDrawer({
  editing,
  setEditing,
  dirty,
  onClose,
  onSave,
  onDelete,
  files,
  history,
  onUploadPhoto,
  onUploadAttachments,
  onAnalyzePhotos,
  onVerifyCompliance,
  asDateInput,
  next36MonthsISO,
}) {
  const Badge = ({ color = "gray", children }) => {
    const map = {
      gray: "bg-gray-100 text-gray-700",
      green: "bg-emerald-100 text-emerald-700",
      orange: "bg-amber-100 text-amber-700",
      red: "bg-rose-100 text-rose-700",
      blue: "bg-blue-100 text-blue-700",
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]}`}>{children}</span>;
  };

  const statusColor = (st) => {
    if (st === "a_faire") return "green";
    if (st === "en_cours_30") return "orange";
    if (st === "en_retard") return "red";
    return "gray";
  };

  const statusLabel = (st) => {
    if (st === "a_faire") return "À faire";
    if (st === "en_cours_30") return "En cours";
    if (st === "en_retard") return "En retard";
    return "—";
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (!dirty || window.confirm("Des modifications non sauvegardées. Fermer quand même ?")) {
            onClose();
          }
        }
      }}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b bg-gray-50">
          <h2 className="text-lg font-bold">{editing.id ? "Modifier équipement" : "Nouvel équipement"}</h2>
          <div className="flex items-center gap-2">
            {dirty && (
              <button onClick={onSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                Enregistrer
              </button>
            )}
            <button onClick={onClose} className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Photo */}
          {editing.id && (
            <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
              <div className="w-24 h-24 rounded-xl border overflow-hidden bg-white flex items-center justify-center shrink-0">
                {editing.photo_url ? (
                  <img src={api.atex.photoUrl(editing.id, { bust: true })} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl text-gray-300">📷</span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <label className="inline-block px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 cursor-pointer text-sm">
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUploadPhoto(e.target.files[0])} />
                  Changer la photo
                </label>
                <div className="flex gap-2">
                  <label className="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 cursor-pointer text-sm">
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && onAnalyzePhotos(e.target.files)} />
                    Analyser photos (IA)
                  </label>
                  <button onClick={onVerifyCompliance} className="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm">
                    Vérifier conformité (IA)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Info Fields */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Nom</label>
              <input
                type="text"
                value={editing.name || ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Type</label>
              <input
                type="text"
                value={editing.type || ""}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Fabricant</label>
              <input
                type="text"
                value={editing.manufacturer || ""}
                onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Référence fabricant</label>
              <input
                type="text"
                value={editing.manufacturer_ref || ""}
                onChange={(e) => setEditing({ ...editing, manufacturer_ref: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* ATEX Markings */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Marquage ATEX (gaz)</label>
              <input
                type="text"
                value={editing.atex_mark_gas || ""}
                onChange={(e) => setEditing({ ...editing, atex_mark_gas: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Ex II 2G..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Marquage ATEX (poussière)</label>
              <input
                type="text"
                value={editing.atex_mark_dust || ""}
                onChange={(e) => setEditing({ ...editing, atex_mark_dust: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Ex II 2D..."
              />
            </div>
          </div>

          {/* Location (readonly) */}
          <div className="grid sm:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-xl">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bâtiment</label>
              <input type="text" value={editing.building || "—"} readOnly className="w-full bg-white border rounded-lg px-3 py-2 text-sm text-gray-600" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Zone</label>
              <input type="text" value={editing.zone || "—"} readOnly className="w-full bg-white border rounded-lg px-3 py-2 text-sm text-gray-600" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Zonage Gaz</label>
              <input
                type="text"
                value={editing.zoning_gas ?? "—"}
                onChange={(e) => setEditing({ ...editing, zoning_gas: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Zonage Poussière</label>
              <input
                type="text"
                value={editing.zoning_dust ?? "—"}
                onChange={(e) => setEditing({ ...editing, zoning_dust: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Installation</label>
              <input
                type="date"
                value={asDateInput(editing.installed_at)}
                onChange={(e) => setEditing({ ...editing, installed_at: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Dernier contrôle</label>
              <input
                type="date"
                value={asDateInput(editing.last_check_date)}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditing({
                    ...editing,
                    last_check_date: v,
                    next_check_date: next36MonthsISO(v) || editing.next_check_date,
                  });
                }}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Prochain contrôle</label>
              <input
                type="date"
                value={asDateInput(editing.next_check_date)}
                onChange={(e) => setEditing({ ...editing, next_check_date: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Status badges */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Statut:</span>
              <Badge color={statusColor(editing.status)}>{statusLabel(editing.status)}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Conformité:</span>
              {editing.compliance_state === "conforme" ? (
                <Badge color="green">Conforme</Badge>
              ) : editing.compliance_state === "non_conforme" ? (
                <Badge color="red">Non conforme</Badge>
              ) : (
                <Badge>N/A</Badge>
              )}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Commentaire</label>
            <textarea
              value={editing.comment || ""}
              onChange={(e) => setEditing({ ...editing, comment: e.target.value })}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Files */}
          {editing.id && (
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">Pièces jointes</span>
                <label className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 cursor-pointer text-sm">
                  <input type="file" multiple className="hidden" onChange={(e) => e.target.files?.length && onUploadAttachments(Array.from(e.target.files))} />
                  Ajouter
                </label>
              </div>
              {files.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune pièce jointe.</p>
              ) : (
                <div className="space-y-1">
                  {files.map((f) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block text-sm text-blue-600 hover:underline">
                      {f.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* History */}
          {editing.id && history.length > 0 && (
            <div className="p-4 bg-gray-50 rounded-xl">
              <span className="font-medium">Historique des contrôles</span>
              <div className="mt-2 space-y-1">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">{dayjs(h.date).format("DD/MM/YYYY HH:mm")}</span>
                    <Badge color={h.result === "conforme" ? "green" : h.result === "non_conforme" ? "red" : "gray"}>
                      {h.result || "N/A"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            Fermer
          </button>
          <div className="flex gap-2">
            {editing.id && (
              <button onClick={onDelete} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
                Supprimer
              </button>
            )}
            <button
              onClick={onSave}
              disabled={!dirty}
              className={`px-4 py-2 rounded-lg ${dirty ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
            >
              {dirty ? "Enregistrer" : "Enregistré"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
