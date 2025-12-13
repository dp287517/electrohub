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
// 🆕 Helper pour récupérer l'identité utilisateur (email)
// ============================================================
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function getIdentity() {
  let email = getCookie("email") || null;
  let name = getCookie("name") || getCookie("fullname") || getCookie("username") || null;

  if (typeof window !== "undefined") {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name) name = localStorage.getItem("name") || localStorage.getItem("username") || null;

    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && u?.name) name = String(u.name);
      } catch {}
    }
  }

  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    name = base.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  email = email ? String(email).trim() : null;
  name = name ? String(name).trim() : null;

  return { email, name };
}

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

  // 🆕 Sélection équipement pour highlight sur carte
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(null);

  // Toast
  const [toast, setToast] = useState("");

  // 🆕 Modal de confirmation moderne
  const [confirmModal, setConfirmModal] = useState({ open: false, title: "", message: "", onConfirm: null, variant: "danger" });

  // 🆕 Lire l'URL au chargement pour navigation directe vers équipement
  useEffect(() => {
    const eqId = searchParams.get("eq");
    if (eqId) {
      setSelectedEquipmentId(eqId);
      // Trouver le plan de l'équipement et l'afficher
      const findEquipmentPlan = async () => {
        try {
          const res = await api.atex.getEquipment(eqId);
          const eq = res?.equipment;
          if (eq?.building || eq?.zone) {
            // Chercher un plan correspondant
            const plansRes = await api.atexMaps.listPlans();
            const matchingPlan = (plansRes?.plans || []).find(
              p => p.building === eq.building && p.zone === eq.zone
            );
            if (matchingPlan) {
              setSelectedPlan(matchingPlan);
              setActiveTab("plans");
            }
          }
        } catch (e) {
          console.warn("[ATEX] findEquipmentPlan error:", e);
        }
      };
      findEquipmentPlan();
    }
  }, []);

  // Update URL when tab or equipment changes
  useEffect(() => {
    const params = { tab: activeTab };
    if (selectedEquipmentId) params.eq = selectedEquipmentId;
    setSearchParams(params, { replace: true });
  }, [activeTab, selectedEquipmentId, setSearchParams]);

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

    // 🆕 Récupérer l'identité utilisateur pour tracking
    const identity = getIdentity();

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
      // 🆕 Tracking utilisateur
      user_email: identity.email || null,
      user_name: identity.name || null,
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

  // 🆕 Fonction de suppression avec modal moderne
  function confirmDeleteEquipment() {
    if (!editing?.id) return;
    setConfirmModal({
      open: true,
      title: "Supprimer cet équipement ?",
      message: `Êtes-vous sûr de vouloir supprimer définitivement "${editing.name || 'cet équipement ATEX'}" ? Cette action est irréversible.`,
      variant: "danger",
      onConfirm: async () => {
        try {
          await api.atex.removeEquipment(editing.id);
          closeEdit();
          await reload();
          setMapRefreshTick((t) => t + 1);
          setToast("Équipement supprimé");
        } catch {
          setToast("Suppression impossible");
        }
        setConfirmModal({ open: false, title: "", message: "", onConfirm: null, variant: "danger" });
      }
    });
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

  // 🆕 Fonction pour naviguer vers un équipement sur la carte
  async function goToEquipmentOnMap(eq) {
    if (!eq?.id) return;
    setSelectedEquipmentId(eq.id);

    try {
      // 1. Charger les plans si pas encore fait
      let availablePlans = plans;
      if (availablePlans.length === 0) {
        const res = await api.atexMaps.listPlans();
        availablePlans = res?.plans || [];
        setPlans(availablePlans);
      }

      if (availablePlans.length === 0) {
        setToast("Aucun plan ATEX disponible");
        setActiveTab("plans");
        return;
      }

      // 2. Trouver le plan correspondant à l'équipement
      let matchingPlan = null;

      // Priorité 1: correspondance exacte building + zone
      if (eq.building && eq.zone) {
        matchingPlan = availablePlans.find(
          p => p.building === eq.building && p.zone === eq.zone
        );
      }

      // Priorité 2: correspondance building uniquement
      if (!matchingPlan && eq.building) {
        matchingPlan = availablePlans.find(p => p.building === eq.building);
      }

      // Priorité 3: premier plan disponible
      if (!matchingPlan) {
        matchingPlan = availablePlans[0];
      }

      // 3. Sélectionner le plan et forcer le refresh
      setSelectedPlan(matchingPlan);
      setMapRefreshTick(t => t + 1);

      // 4. Basculer vers l'onglet Plans
      setActiveTab("plans");
      setToast(`🔍 ${eq.name || "Équipement"} sur ${matchingPlan?.display_name || matchingPlan?.logical_name || "le plan"}`);

    } catch (e) {
      console.error("[ATEX] goToEquipmentOnMap error:", e);
      setActiveTab("plans");
      setToast("Erreur lors de la navigation");
    }
  }

  /* ----------------------------- UI Components ----------------------------- */
  const dirty = isDirty();

  // Style tabs moderne (comme SwitchboardControls)
  const TabButton = ({ id, label, count, color, alert }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium transition-all whitespace-nowrap text-sm sm:text-base ${
        activeTab === id
          ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
          : alert
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label.length > 10 ? label.slice(0, 8) + "…" : label}</span>
      {count !== undefined && count > 0 && (
        <span className={`ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 rounded-full text-xs font-bold ${
          activeTab === id ? "bg-white/20 text-white" : color || "bg-gray-200 text-gray-700"
        }`}>
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

      {/* 🆕 Modal de Confirmation Moderne */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-slideUp">
            {/* Header avec gradient */}
            <div className={`p-5 ${
              confirmModal.variant === "danger"
                ? "bg-gradient-to-r from-red-500 to-rose-600"
                : "bg-gradient-to-r from-blue-500 to-indigo-600"
            } text-white`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <span className="text-2xl">{confirmModal.variant === "danger" ? "⚠️" : "❓"}</span>
                </div>
                <h3 className="text-lg font-bold">{confirmModal.title}</h3>
              </div>
            </div>
            {/* Content */}
            <div className="p-5">
              <p className="text-gray-600">{confirmModal.message}</p>
            </div>
            {/* Actions */}
            <div className="flex justify-end gap-3 p-4 bg-gray-50 border-t">
              <button
                onClick={() => setConfirmModal({ open: false, title: "", message: "", onConfirm: null, variant: "danger" })}
                className="px-4 py-2.5 rounded-xl text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 font-medium transition-all"
              >
                Annuler
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2.5 rounded-xl text-white font-medium transition-all ${
                  confirmModal.variant === "danger"
                    ? "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700"
                    : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                }`}
              >
                {confirmModal.variant === "danger" ? "Supprimer" : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header - Style Switchboard */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-4 sm:p-6 text-white shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="p-3 sm:p-4 bg-white/20 rounded-xl sm:rounded-2xl backdrop-blur-sm">
              <span className="text-3xl sm:text-4xl">🔥</span>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Équipements ATEX</h1>
              <p className="text-white/80 text-sm sm:text-base">Gestion des zones explosives</p>
            </div>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium backdrop-blur-sm transition-all text-sm sm:text-base flex items-center justify-center gap-2"
            >
              <span>🔍</span>
              <span className="hidden sm:inline">{filtersOpen ? "Masquer" : "Filtres"}</span>
              <span className="sm:hidden">Filtres</span>
            </button>
          </div>
        </div>
        {/* Stats en une ligne */}
        <div className="flex flex-wrap gap-2 sm:gap-4 mt-4 text-sm">
          <span className="px-3 py-1 bg-white/20 rounded-full">{stats.total} équip.</span>
          <span className="px-3 py-1 bg-emerald-500/40 rounded-full">✓ {stats.conforme} conformes</span>
          {stats.nonConforme > 0 && <span className="px-3 py-1 bg-red-500/40 rounded-full">⚠ {stats.nonConforme} non conf.</span>}
          {stats.enRetard > 0 && <span className="px-3 py-1 bg-red-600/50 rounded-full animate-pulse">🕐 {stats.enRetard} en retard</span>}
        </div>
      </div>

      {/* Filters */}
      {filtersOpen && (
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche..."
              className="col-span-2 sm:col-span-1 border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-2 sm:px-3 py-2 text-sm w-full"
            >
              <option value="">Statut</option>
              <option value="a_faire">À faire</option>
              <option value="en_cours_30">En cours</option>
              <option value="en_retard">En retard</option>
            </select>
            <input
              type="text"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              placeholder="Bâtiment"
              className="border rounded-lg px-2 sm:px-3 py-2 text-sm w-full"
            />
            <input
              type="text"
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              placeholder="Zone"
              className="border rounded-lg px-2 sm:px-3 py-2 text-sm w-full"
            />
            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value)}
              className="border rounded-lg px-2 sm:px-3 py-2 text-sm w-full"
            >
              <option value="">Conformité</option>
              <option value="conforme">Conforme</option>
              <option value="non_conforme">Non conforme</option>
            </select>
          </div>
          <button
            onClick={() => { setQ(""); setStatusFilter(""); setBuildingFilter(""); setZoneFilter(""); setComplianceFilter(""); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Réinitialiser
          </button>
        </div>
      )}

      {/* Tabs - Style Switchboard sans scrollbar */}
      <div className="flex gap-1 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <TabButton id="dashboard" label="Tableau de bord" />
        <TabButton id="controls" label="Équipements" count={stats.total} color="bg-blue-100 text-blue-800" />
        <TabButton id="plans" label="Plans" count={plans.length} color="bg-purple-100 text-purple-800" />
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
            onGoToMap={goToEquipmentOnMap}
          />
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
            selectedEquipmentId={selectedEquipmentId}
            setSelectedEquipmentId={setSelectedEquipmentId}
          />
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
          onDelete={confirmDeleteEquipment}
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
      <div className={`rounded-xl p-3 sm:p-4 border ${colors[color]}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm opacity-75 truncate">{label}</p>
            <p className="text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1">{value}</p>
          </div>
          <span className="text-2xl sm:text-3xl shrink-0">{icon}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <StatCard label="Total" value={stats.total} color="blue" icon="📦" />
        <StatCard label="Conformes" value={stats.conforme} color="green" icon="✅" />
        <StatCard label="Non conf." value={stats.nonConforme} color="red" icon="⚠️" />
        <StatCard label="En retard" value={stats.enRetard} color="orange" icon="🕐" />
      </div>

      {/* Zones Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <span className="text-xl sm:text-2xl">💨</span>
            <div>
              <p className="text-xs sm:text-sm text-amber-700">Zones Gaz (0/1/2)</p>
              <p className="text-lg sm:text-2xl font-bold text-amber-800">{stats.zonesGaz} éq.</p>
            </div>
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <span className="text-xl sm:text-2xl">🌫️</span>
            <div>
              <p className="text-xs sm:text-sm text-orange-700">Zones Poussière (20/21/22)</p>
              <p className="text-lg sm:text-2xl font-bold text-orange-800">{stats.zonesDust} éq.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Overdue Alerts */}
      {overdueList.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 sm:p-4">
          <h3 className="font-semibold text-red-800 mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
            <span>⚠️</span> En retard ({overdueList.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {overdueList.slice(0, 10).map((eq) => (
              <div key={eq.id} className="bg-white rounded-lg p-2.5 sm:p-3 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{eq.name || eq.type || "Équipement"}</p>
                    <p className="text-xs text-gray-500 truncate">{eq.building || "—"} / {eq.zone || "—"}</p>
                    {eq.next_check_date && (
                      <p className="text-xs text-red-600 mt-0.5">Dû le {dayjs(eq.next_check_date).format("DD/MM/YY")}</p>
                    )}
                  </div>
                  <button
                    onClick={() => onOpenEquipment(eq)}
                    className="w-full sm:w-auto px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs sm:text-sm font-medium shrink-0"
                  >
                    Contrôler
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcomingList.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-4">
          <h3 className="font-semibold text-blue-800 mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
            <span>📅</span> À venir (30j)
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {upcomingList.slice(0, 10).map((eq) => (
              <div key={eq.id} className="bg-white rounded-lg p-2.5 sm:p-3 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{eq.name || eq.type || "Équipement"}</p>
                    <p className="text-xs text-gray-500 truncate">{eq.building || "—"} / {eq.zone || "—"}</p>
                    <p className="text-xs text-blue-600 mt-0.5">Prévu le {dayjs(eq.next_check_date).format("DD/MM/YY")}</p>
                  </div>
                  <button
                    onClick={() => onOpenEquipment(eq)}
                    className="w-full sm:w-auto px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs sm:text-sm font-medium shrink-0"
                  >
                    Voir
                  </button>
                </div>
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
// EQUIPMENTS TAB - Avec arborescence Bâtiment > Zone > Équipement
// ============================================================

function EquipmentsTab({ items, loading, onOpenEquipment, onGoToMap }) {
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
      purple: "bg-purple-100 text-purple-700",
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]}`}>{children}</span>;
  };

  // 🆕 Grouper les équipements par bâtiment > zone (comme PlansTab)
  const grouped = useMemo(() => {
    const byKey = new Map();
    for (const eq of items) {
      const batKey = eq.building?.trim() || "Autres";
      const zoneKey = eq.zone?.trim() || "Zone non renseignée";
      const g = byKey.get(batKey) || { key: batKey, zones: new Map() };
      const z = g.zones.get(zoneKey) || { name: zoneKey, items: [] };
      z.items.push(eq);
      g.zones.set(zoneKey, z);
      byKey.set(batKey, g);
    }
    return Array.from(byKey.values()).map((g) => ({
      key: g.key,
      zones: Array.from(g.zones.values()),
    }));
  }, [items]);

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

  // 🆕 Composant carte équipement compact
  const EquipmentCard = ({ eq }) => (
    <div className="bg-white border rounded-xl p-3 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg border overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
          {eq.photo_url ? (
            <img src={api.atex.photoUrl(eq.id, { thumb: true })} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <span className="text-gray-400 text-xl">🔥</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <button className="text-blue-600 font-semibold hover:underline text-left truncate w-full text-sm" onClick={() => onOpenEquipment(eq)}>
            {eq.name || eq.type || "Équipement"}
          </button>
          <div className="flex flex-wrap gap-1 mt-1">
            {eq.zoning_gas != null && <Badge color="orange">Gaz {eq.zoning_gas}</Badge>}
            {eq.zoning_dust != null && <Badge color="blue">Dust {eq.zoning_dust}</Badge>}
            <Badge color={statusColor(eq.status)}>{statusLabel(eq.status)}</Badge>
          </div>
          {eq.next_check_date && (
            <p className="text-xs text-gray-400 mt-1">
              Prochain: {dayjs(eq.next_check_date).format("DD/MM/YY")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={() => onOpenEquipment(eq)} className="p-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-xs" title="Modifier">
            ✏️
          </button>
          {onGoToMap && (
            <button onClick={() => onGoToMap(eq)} className="p-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-xs" title="Voir sur carte">
              📍
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // 🆕 Vue arborescence (comme PlansTab)
  return (
    <div className="space-y-3">
      {/* Stats rapides */}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full font-medium">
          {items.length} équipement{items.length > 1 ? "s" : ""}
        </span>
        <span className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full font-medium">
          {grouped.length} bâtiment{grouped.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Arborescence Bâtiment > Zone > Équipements - Fermée par défaut */}
      {grouped.map((bat) => (
        <details key={bat.key} className="group border rounded-2xl bg-white shadow-sm overflow-hidden">
          <summary className="flex items-center justify-between px-4 py-3 cursor-pointer bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <span className="text-xl">🏢</span>
              </div>
              <span className="font-semibold text-gray-800">{bat.key}</span>
            </div>
            <span className="px-2.5 py-1 bg-blue-500 text-white rounded-full text-xs font-medium">
              {bat.zones.reduce((n, z) => n + z.items.length, 0)} éq.
            </span>
          </summary>
          <div className="p-3 space-y-2 bg-gray-50/50">
            {bat.zones.map((z) => (
              <details key={z.name} className="ml-2 pl-3 border-l-2 border-blue-200">
                <summary className="cursor-pointer py-2 text-sm text-gray-700 hover:text-blue-700 font-medium transition-colors flex items-center gap-2">
                  <span className="p-1 bg-amber-100 rounded">📍</span>
                  {z.name}
                  <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs">
                    {z.items.length}
                  </span>
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pb-2">
                  {z.items.map((eq) => (
                    <EquipmentCard key={eq.id} eq={eq} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
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

function PlansTab({ plans, mapsLoading, selectedPlan, setSelectedPlan, mapRefreshTick, setMapRefreshTick, loadPlans, openEdit, applyZonesLocally, reload, mergeZones, editing, setEditing, setToast, selectedEquipmentId, setSelectedEquipmentId }) {
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
      {/* Import ZIP - Style Switchboard */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-xl">
            <span className="text-2xl">📄</span>
          </div>
          <div>
            <span className="font-semibold text-amber-900">Plans ATEX</span>
            <p className="text-xs text-amber-700">Importez un ZIP contenant vos PDFs ATEX</p>
          </div>
        </div>
        <label className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl hover:from-amber-600 hover:to-orange-600 cursor-pointer font-medium text-center shadow-md transition-all">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                await api.atexMaps.uploadZip(f);
                setToast("Plans importés ✓");
                await loadPlans();
              }
              e.target.value = "";
            }}
          />
          📤 Import ZIP
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
          {/* Arborescence fermée par défaut */}
          {grouped.map((bat) => (
            <details key={bat.key} className="group border rounded-2xl bg-white shadow-sm overflow-hidden">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer bg-gradient-to-r from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-150 transition-all">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <span className="text-xl">🏢</span>
                  </div>
                  <span className="font-semibold text-gray-800">{bat.key}</span>
                </div>
                <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                  {bat.zones.reduce((n, z) => n + z.items.length, 0)} plan(s)
                </span>
              </summary>
              <div className="p-3 space-y-2 bg-gray-50/50">
                {bat.zones.map((z) => (
                  <details key={z.name} className="ml-2 pl-3 border-l-2 border-amber-200">
                    <summary className="cursor-pointer py-2 text-sm text-gray-700 hover:text-amber-700 font-medium transition-colors">
                      📍 {z.name} <span className="text-gray-400">({z.items.length})</span>
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
                          className={`p-3 border rounded-xl text-left transition-all hover:shadow-md ${
                            selectedPlan?.logical_name === p.logical_name
                              ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-50 ring-2 ring-amber-200"
                              : "bg-white hover:bg-gray-50 border-gray-200"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-xl ${selectedPlan?.logical_name === p.logical_name ? "" : "opacity-60"}`}>📄</span>
                            <span className="font-medium truncate text-gray-800">{p.display_name || p.logical_name}</span>
                          </div>
                          {selectedPlan?.logical_name === p.logical_name && (
                            <span className="mt-2 inline-flex px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">
                              Actif
                            </span>
                          )}
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

      {/* Selected Plan Map - Design épuré */}
      {selectedPlan && (
        <div className="mt-4 rounded-2xl overflow-hidden bg-white shadow-xl border border-gray-200">
          {/* Header compact et moderne */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">🗺️</span>
              <div className="min-w-0">
                <h3 className="font-bold text-base truncate">{selectedPlan.display_name || selectedPlan.logical_name}</h3>
                <p className="text-amber-100 text-xs">Cliquez sur + pour ajouter un équipement</p>
              </div>
            </div>
            <button
              onClick={() => setSelectedPlan(null)}
              className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-lg transition-all shrink-0"
              title="Fermer"
            >
              ✕
            </button>
          </div>
          {/* Carte sans padding excessif */}
          <AtexMap
            key={`${selectedPlan.logical_name}:${mapRefreshTick}:${selectedEquipmentId || ''}`}
            plan={selectedPlan}
            selectedEquipmentId={selectedEquipmentId}
            onOpenEquipment={(eq) => {
              setSelectedEquipmentId(eq?.id || null);
              openEdit(eq);
            }}
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
              setToast("Équipements mis à jour");
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
  const [activeSection, setActiveSection] = useState("info");

  const Badge = ({ color = "gray", children, className = "" }) => {
    const map = {
      gray: "bg-gray-100 text-gray-700",
      green: "bg-emerald-100 text-emerald-700",
      orange: "bg-amber-100 text-amber-700",
      red: "bg-rose-100 text-rose-700",
      blue: "bg-blue-100 text-blue-700",
      purple: "bg-purple-100 text-purple-700",
    };
    return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${map[color]} ${className}`}>{children}</span>;
  };

  const statusColor = (st) => {
    if (st === "a_faire") return "green";
    if (st === "en_cours_30") return "orange";
    if (st === "en_retard") return "red";
    return "gray";
  };

  const statusLabel = (st) => {
    if (st === "a_faire") return "À faire";
    if (st === "en_cours_30") return "≤ 90 jours";
    if (st === "en_retard") return "En retard";
    return "—";
  };

  const SectionTab = ({ id, label, icon }) => (
    <button
      onClick={() => setActiveSection(id)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        activeSection === id
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
      }`}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (!dirty || window.confirm("Des modifications non sauvegardées. Fermer quand même ?")) {
            onClose();
          }
        }
      }}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden animate-slideUp">
        {/* Header avec gradient */}
        <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <span className="text-xl sm:text-2xl">🔥</span>
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold">
                  {editing.id ? (editing.name || "Équipement ATEX") : "Nouvel équipement"}
                </h2>
                <p className="text-blue-100 text-xs sm:text-sm">
                  {editing.id ? `ID: ${editing.id.slice(0, 8)}...` : "Créer une nouvelle fiche"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  onClick={onSave}
                  className="px-3 sm:px-4 py-2 bg-white text-blue-600 rounded-xl hover:bg-blue-50 text-sm font-semibold shadow-lg transition-all"
                >
                  💾 <span className="hidden sm:inline">Sauver</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-xl transition-all"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Status badges in header - Couleurs contrastées */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
              editing.status === 'a_faire' ? 'bg-emerald-500 text-white border-emerald-400' :
              editing.status === 'en_cours_30' ? 'bg-amber-500 text-white border-amber-400' :
              editing.status === 'en_retard' ? 'bg-red-500 text-white border-red-400' :
              'bg-white/30 text-white border-white/40'
            }`}>
              {statusLabel(editing.status)}
            </span>
            {editing.compliance_state === "conforme" ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white border border-emerald-400">✓ Conforme</span>
            ) : editing.compliance_state === "non_conforme" ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500 text-white border border-red-400">✗ Non conforme</span>
            ) : null}
            {editing.zoning_gas != null && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500 text-white border border-amber-400">💨 Gaz {editing.zoning_gas}</span>
            )}
            {editing.zoning_dust != null && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500 text-white border border-orange-400">🌫️ Pouss. {editing.zoning_dust}</span>
            )}
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-2 p-3 bg-gray-50 border-b overflow-x-auto">
          <SectionTab id="info" label="Informations" icon="📋" />
          <SectionTab id="location" label="Localisation" icon="📍" />
          <SectionTab id="atex" label="ATEX" icon="⚠️" />
          <SectionTab id="dates" label="Contrôles" icon="📅" />
          {editing.id && <SectionTab id="files" label="Fichiers" icon="📎" />}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 space-y-4 atex-scroll">

          {/* SECTION: Informations */}
          {activeSection === "info" && (
            <div className="space-y-4 animate-fadeIn">
              {/* Photo zone */}
              {editing.id && (
                <div className="atex-section">
                  <div className="atex-section-title">📸 Photo de l'équipement</div>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl border-2 border-dashed border-gray-300 overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
                      {editing.photo_url ? (
                        <img src={api.atex.photoUrl(editing.id, { bust: true })} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-4xl text-gray-300">📷</span>
                      )}
                    </div>
                    <div className="flex-1 w-full space-y-2">
                      <label className="atex-btn atex-btn-primary w-full sm:w-auto cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUploadPhoto(e.target.files[0])} />
                        📤 Changer la photo
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <label className="atex-btn atex-btn-secondary w-full sm:w-auto cursor-pointer">
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && onAnalyzePhotos(e.target.files)} />
                          🤖 Analyse IA
                        </label>
                        <button onClick={onVerifyCompliance} className="atex-btn atex-btn-secondary w-full sm:w-auto">
                          ✅ Conformité IA
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Basic info */}
              <div className="atex-section">
                <div className="atex-section-title">📝 Informations générales</div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom de l'équipement</label>
                    <input
                      type="text"
                      value={editing.name || ""}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Moteur Zone 1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Type</label>
                    <input
                      type="text"
                      value={editing.type || ""}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Moteur électrique"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Fabricant</label>
                    <input
                      type="text"
                      value={editing.manufacturer || ""}
                      onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: ABB, Siemens..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Référence fabricant</label>
                    <input
                      type="text"
                      value={editing.manufacturer_ref || ""}
                      onChange={(e) => setEditing({ ...editing, manufacturer_ref: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 1LA7..."
                    />
                  </div>
                </div>
              </div>

              {/* Comment */}
              <div className="atex-section">
                <div className="atex-section-title">💬 Commentaire</div>
                <textarea
                  value={editing.comment || ""}
                  onChange={(e) => setEditing({ ...editing, comment: e.target.value })}
                  rows={3}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Notes, remarques, observations..."
                />
              </div>

              {/* 🆕 Tracking utilisateur - Créé / Modifié par */}
              {editing.id && (editing.user_email || editing.user_name || editing.created_by || editing.updated_by || editing.created_at || editing.updated_at) && (
                <div className="atex-section bg-gray-50">
                  <div className="atex-section-title">👤 Traçabilité</div>
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    {(editing.created_by || editing.created_at) && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <span className="text-green-500">●</span>
                        <span>Créé {editing.created_by && `par ${editing.created_by}`} {editing.created_at && `le ${dayjs(editing.created_at).format("DD/MM/YY HH:mm")}`}</span>
                      </div>
                    )}
                    {(editing.updated_by || editing.user_email || editing.updated_at) && (
                      <div className="flex items-center gap-2 text-gray-600">
                        <span className="text-blue-500">●</span>
                        <span>Modifié {(editing.updated_by || editing.user_name || editing.user_email) && `par ${editing.updated_by || editing.user_name || editing.user_email}`} {editing.updated_at && `le ${dayjs(editing.updated_at).format("DD/MM/YY HH:mm")}`}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION: Localisation */}
          {activeSection === "location" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="atex-section">
                <div className="atex-section-title">🏢 Emplacement physique</div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Bâtiment</label>
                    <input
                      type="text"
                      value={editing.building || ""}
                      readOnly
                      className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400 mt-1">🔒 Défini par le plan</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Zone</label>
                    <input
                      type="text"
                      value={editing.zone || ""}
                      readOnly
                      className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400 mt-1">🔒 Défini par le plan</p>
                  </div>
                </div>
              </div>

              <div className="atex-section">
                <div className="atex-section-title">⚙️ Hiérarchie équipement</div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Équipement principal</label>
                    <input
                      type="text"
                      value={editing.equipment || ""}
                      onChange={(e) => setEditing({ ...editing, equipment: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Ligne de production A"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Sous-équipement</label>
                    <input
                      type="text"
                      value={editing.sub_equipment || ""}
                      onChange={(e) => setEditing({ ...editing, sub_equipment: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Convoyeur, Broyeur..."
                    />
                    <p className="text-xs text-gray-400 mt-1">💡 Auto-rempli si dans une zone ATEX</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: ATEX */}
          {activeSection === "atex" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="atex-section">
                <div className="atex-section-title">⚠️ Marquages ATEX</div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">💨 Marquage Gaz</label>
                    <input
                      type="text"
                      value={editing.atex_mark_gas || ""}
                      onChange={(e) => setEditing({ ...editing, atex_mark_gas: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: II 2G Ex db IIC T4 Gb"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">🌫️ Marquage Poussière</label>
                    <input
                      type="text"
                      value={editing.atex_mark_dust || ""}
                      onChange={(e) => setEditing({ ...editing, atex_mark_dust: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: II 2D Ex tb IIIC T85°C Db"
                    />
                  </div>
                </div>
              </div>

              <div className="atex-section">
                <div className="atex-section-title">🎯 Zonage ATEX (automatique)</div>
                <p className="text-xs text-gray-500 mb-3">
                  Le zonage est déterminé automatiquement par la position de l'équipement sur le plan ATEX.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className={`p-4 rounded-xl border-2 ${
                    editing.zoning_gas != null
                      ? "bg-amber-50 border-amber-300"
                      : "bg-gray-50 border-gray-200"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">💨</span>
                      <span className="font-semibold text-gray-700">Zonage Gaz</span>
                    </div>
                    <div className={`text-2xl font-bold ${
                      editing.zoning_gas != null ? "text-amber-700" : "text-gray-400"
                    }`}>
                      {editing.zoning_gas != null ? `Zone ${editing.zoning_gas}` : "Non classé"}
                    </div>
                  </div>
                  <div className={`p-4 rounded-xl border-2 ${
                    editing.zoning_dust != null
                      ? "bg-orange-50 border-orange-300"
                      : "bg-gray-50 border-gray-200"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">🌫️</span>
                      <span className="font-semibold text-gray-700">Zonage Poussière</span>
                    </div>
                    <div className={`text-2xl font-bold ${
                      editing.zoning_dust != null ? "text-orange-700" : "text-gray-400"
                    }`}>
                      {editing.zoning_dust != null ? `Zone ${editing.zoning_dust}` : "Non classé"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: Dates/Contrôles */}
          {activeSection === "dates" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="atex-section">
                <div className="atex-section-title">📅 Dates importantes</div>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Date d'installation</label>
                    <input
                      type="date"
                      value={asDateInput(editing.installed_at)}
                      onChange={(e) => setEditing({ ...editing, installed_at: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Dernier contrôle</label>
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
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Prochain contrôle</label>
                    <input
                      type="date"
                      value={asDateInput(editing.next_check_date)}
                      onChange={(e) => setEditing({ ...editing, next_check_date: e.target.value })}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {editing.id && history.length > 0 && (
                <div className="atex-section">
                  <div className="atex-section-title">📜 Historique des contrôles</div>
                  <div className="atex-timeline">
                    {history.map((h) => (
                      <div key={h.id} className="atex-timeline-item">
                        <div className="atex-timeline-date">{dayjs(h.date).format("DD/MM/YYYY à HH:mm")}</div>
                        <div className="atex-timeline-content">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>Contrôle effectué</span>
                            <Badge color={h.result === "conforme" ? "green" : h.result === "non_conforme" ? "red" : "gray"}>
                              {h.result === "conforme" ? "✓ Conforme" : h.result === "non_conforme" ? "✗ Non conforme" : "N/A"}
                            </Badge>
                          </div>
                          {/* 🆕 Affichage de l'utilisateur qui a fait le contrôle */}
                          {(h.user_email || h.user_name || h.performed_by) && (
                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                              <span>👤</span>
                              <span>{h.user_name || h.performed_by || h.user_email}</span>
                              {h.user_email && h.user_name && (
                                <span className="text-gray-400">({h.user_email})</span>
                              )}
                            </div>
                          )}
                          {h.rationale && (
                            <div className="text-xs text-gray-500 mt-1 italic">"{h.rationale}"</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION: Fichiers */}
          {activeSection === "files" && editing.id && (
            <div className="space-y-4 animate-fadeIn">
              <div className="atex-section">
                <div className="flex items-center justify-between mb-4">
                  <div className="atex-section-title mb-0">📎 Pièces jointes</div>
                  <label className="atex-btn atex-btn-primary cursor-pointer">
                    <input type="file" multiple className="hidden" onChange={(e) => e.target.files?.length && onUploadAttachments(Array.from(e.target.files))} />
                    ➕ Ajouter
                  </label>
                </div>
                {files.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <span className="text-4xl block mb-2">📂</span>
                    <p>Aucune pièce jointe</p>
                    <p className="text-xs mt-1">Ajoutez des certificats, photos, documents...</p>
                  </div>
                ) : (
                  <div className="atex-files-grid">
                    {files.map((f) => (
                      <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="atex-file-item">
                        <div className="atex-file-icon">📄</div>
                        <span className="atex-file-name">{f.name}</span>
                        <span className="text-gray-400 text-xs">↗</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-white gap-2 flex-wrap">
          <button onClick={onClose} className="atex-btn atex-btn-secondary">
            ✕ Fermer
          </button>
          <div className="flex gap-2">
            {editing.id && (
              <button onClick={onDelete} className="atex-btn atex-btn-danger">
                🗑️ Supprimer
              </button>
            )}
            <button
              onClick={onSave}
              disabled={!dirty}
              className={`atex-btn ${dirty ? "atex-btn-primary" : "atex-btn-secondary opacity-50 cursor-not-allowed"}`}
            >
              {dirty ? "💾 Enregistrer" : "✓ Enregistré"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
