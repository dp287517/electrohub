// src/pages/Atex.jsx
// ✅ VERSION REFONDÉE - Design style SwitchboardControls
// Build: 2025-12-18T15:30:00 - Force cache invalidation
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");
import "../styles/atex-map.css";
import { api, API_BASE } from "../lib/api.js";
import AtexMap from "./Atex-map.jsx";
import AuditHistory from "../components/AuditHistory.jsx";
import { LastModifiedBadge, CreatedByBadge } from "../components/LastModifiedBadge.jsx";

// 📊 Chart.js imports pour l'onglet Analyse
import { Doughnut, Bar, Line, Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import zoomPlugin from "chartjs-plugin-zoom";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin,
  zoomPlugin
);

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

    // Check "user" localStorage
    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && u?.name) name = String(u.name);
      } catch {}
    }

    // Check "eh_user" localStorage (Bubble login stores user data here)
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName)) name = String(x.name || x.displayName);
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
  const navigate = useNavigate();
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
  const [aiPhotosCount, setAiPhotosCount] = useState(0);
  const [massComplianceRunning, setMassComplianceRunning] = useState(false);

  // Lightbox pour agrandir les photos
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxTitle, setLightboxTitle] = useState("");

  // Historique des photos d'analyse IA
  const [aiAnalysisPhotos, setAiAnalysisPhotos] = useState([]);

  // Plans
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Infrastructure states (for placing equipment on infra plans)
  const [infraPlans, setInfraPlans] = useState([]);
  const [infraPositions, setInfraPositions] = useState([]);
  const [infraLoading, setInfraLoading] = useState(false);
  const [placingOnInfra, setPlacingOnInfra] = useState(null); // { planId, planName }

  // 🆕 Sélection équipement pour highlight sur carte
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(null);

  // Toast
  const [toast, setToast] = useState("");

  // Upload plan modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // 🆕 Modal de confirmation moderne
  const [confirmModal, setConfirmModal] = useState({ open: false, title: "", message: "", onConfirm: null, variant: "danger" });

  // 🆕 Modal Management Monitoring (ex-DRPCE) avec filtres
  const [drpceModalOpen, setDrpceModalOpen] = useState(false);
  const [drpceFilters, setDrpceFilters] = useState({ building: "", zone: "", compliance: "" });

  // 🆕 Lire l'URL au chargement pour navigation directe vers équipement
  useEffect(() => {
    const eqId = searchParams.get("eq");
    if (eqId) {
      setSelectedEquipmentId(eqId);
      // Trouver le plan de l'équipement, afficher et ouvrir le drawer
      const findEquipmentPlan = async () => {
        try {
          const res = await api.atex.getEquipment(eqId);
          const eq = res?.equipment;
          if (eq) {
            // Ouvrir le drawer avec l'équipement
            setEditing(eq);
            setDrawerOpen(true);

            if (eq.building || eq.zone) {
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

  // Fermer le lightbox avec Échap
  useEffect(() => {
    if (!lightboxOpen) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setLightboxOpen(false);
        setLightboxSrc(null);
        setLightboxTitle("");
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [lightboxOpen]);

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

  // Upload a new plan
  const handleUploadPlan = useCallback(async (file, buildingName, isMultiZone) => {
    try {
      await api.atexMaps.uploadPlan(file, { building_name: buildingName, is_multi_zone: isMultiZone });
      setToast("Plan importé avec succès");
      setUploadModalOpen(false);
      loadPlans();
    } catch (err) {
      setToast("Erreur: " + (err.message || "Import échoué"));
    }
  }, [loadPlans]);

  // Load infrastructure data for equipment placement (now uses unified atex_plans with is_multi_zone)
  const loadInfraData = useCallback(async () => {
    setInfraLoading(true);
    try {
      // Get all plans and filter multi-zone ones for infrastructure section
      const plansRes = await api.atexMaps.listPlans().catch(() => ({ plans: [] }));
      const allPlans = plansRes?.plans || [];
      const multiZonePlans = allPlans.filter(p => p.is_multi_zone === true);
      // Deduplicate by logical_name (keep only the first/latest version)
      const seen = new Set();
      const uniquePlans = multiZonePlans.filter(p => {
        if (seen.has(p.logical_name)) return false;
        seen.add(p.logical_name);
        return true;
      });
      console.log("[ATEX] loadInfraData:", { total: allPlans.length, multiZone: multiZonePlans.length, unique: uniquePlans.length });
      setInfraPlans(uniquePlans);
      // Positions are in atex_positions - we'll check them when needed
      setInfraPositions([]);
    } catch (e) {
      console.error("[ATEX] Error loading infra data:", e);
    } finally {
      setInfraLoading(false);
    }
  }, []);

  // Place equipment on infrastructure plan (now uses unified atex_positions)
  const placeOnInfraPlan = useCallback(async (equipmentId, planId, x_frac = 0.5, y_frac = 0.5) => {
    try {
      // Find the plan to get its logical_name
      const plan = infraPlans.find(p => p.id === planId);
      if (!plan) {
        throw new Error("Plan not found");
      }
      console.log("[ATEX] placeOnInfraPlan called:", { equipmentId, planId, logical_name: plan.logical_name, x_frac, y_frac });

      // Use unified atexMaps.setPosition (same as ATEX plans)
      const result = await api.atexMaps.setPosition(equipmentId, {
        logical_name: plan.logical_name,
        plan_id: planId,
        page_index: 0,
        x_frac,
        y_frac,
      });
      console.log("[ATEX] setPosition result:", result);
      setToast("Équipement placé sur le plan");
      setPlacingOnInfra(null);
      // Trigger reload
      await reload();
    } catch (e) {
      console.error("[ATEX] Error placing on plan:", e);
      setToast("Erreur: " + (e.message || "Placement échoué"));
    }
  }, [infraPlans, reload]);

  // Remove equipment from plan (unified system - removes from atex_positions)
  const removeFromInfraPlan = useCallback(async (equipmentId) => {
    try {
      await api.atexMaps.removePosition(equipmentId);
      setToast("Équipement retiré du plan");
      await reload();
    } catch (e) {
      console.error("[ATEX] Error removing from plan:", e);
      setToast("Erreur: " + (e.message || "Suppression échouée"));
    }
  }, [reload]);

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

  // Load infrastructure data when drawer opens with existing equipment
  useEffect(() => {
    if (drawerOpen && editing?.id) {
      loadInfraData();
    }
  }, [drawerOpen, editing?.id, loadInfraData]);

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
    // Nettoyer l'URL - ne plus garder l'équipement sélectionné
    setSelectedEquipmentId(null);
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

  // 🔄 Fonction de duplication d'équipement
  async function handleDuplicateEquipment() {
    if (!editing?.id) return;
    try {
      const result = await api.atex.duplicateEquipment(editing.id, { copy_position: false });
      if (result?.equipment) {
        // Fermer le drawer actuel et ouvrir le nouvel équipement
        closeEdit();
        await reload();
        setMapRefreshTick((t) => t + 1);
        // Ouvrir le nouvel équipement créé
        setEditing(result.equipment);
        setDrawerOpen(true);
        setToast("Équipement dupliqué !");
      }
    } catch (e) {
      console.error("[ATEX] Duplicate error:", e);
      setToast("Erreur de duplication");
    }
  }

  // 🗺️ Retirer l'équipement de tous les plans (supprime sa position)
  async function handleRemoveFromPlan() {
    if (!editing?.id) return;
    setConfirmModal({
      open: true,
      title: "Retirer du plan ?",
      message: `L'équipement "${editing.name || 'cet équipement'}" sera retiré de tous les plans. Vous pourrez le repositionner depuis la carte.`,
      variant: "warning",
      onConfirm: async () => {
        try {
          await api.atexMaps.removePosition(editing.id);
          await reload();
          setMapRefreshTick((t) => t + 1);
          setToast("Équipement retiré du plan");
        } catch (e) {
          console.error("[ATEX] Remove from plan error:", e);
          setToast("Erreur lors du retrait");
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

  /* ----------------------------- Lightbox ----------------------------- */
  function openLightbox(src, title = "") {
    setLightboxSrc(src);
    setLightboxTitle(title);
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxSrc(null);
    setLightboxTitle("");
  }

  /* ----------------------------- AI Analysis ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;
    setAiPhotosCount(list.length);

    // Stocker les photos en mémoire pour consultation ultérieure
    const newPhotos = list.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      url: URL.createObjectURL(file),
      date: new Date().toISOString(),
      file: file, // Garder référence pour ré-analyse
    }));
    setAiAnalysisPhotos((prev) => [...newPhotos, ...prev].slice(0, 20)); // Garder les 20 dernières

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
      setToast(`Analyse de ${list.length} photo(s) terminée`);
    } catch {
      setToast("Analyse photos indisponible");
    } finally {
      setAiPhotosCount(0);
    }
  }

  // Envoyer la photo principale vers l'analyse IA
  async function sendMainPhotoToAI() {
    if (!editing?.id || !editing?.photo_url) {
      setToast("Aucune photo à analyser");
      return;
    }
    try {
      // Récupérer l'image depuis l'URL
      const response = await fetch(api.atex.photoUrl(editing.id, { bust: true }));
      const blob = await response.blob();
      const file = new File([blob], `photo-${editing.id}.jpg`, { type: blob.type || "image/jpeg" });
      await analyzeFromPhotos([file]);
    } catch {
      setToast("Impossible de charger la photo pour l'analyse");
    }
  }

  /* ----------------------------- Mass Compliance Check ----------------------------- */
  async function runMassComplianceCheck() {
    if (massComplianceRunning) return;
    setMassComplianceRunning(true);
    let checked = 0;
    let errors = 0;

    try {
      for (const item of items) {
        if (!item.id) continue;
        try {
          const body = {
            atex_mark_gas: item.atex_mark_gas || "",
            atex_mark_dust: item.atex_mark_dust || "",
            target_gas: item.zoning_gas ?? null,
            target_dust: item.zoning_dust ?? null,
          };

          const res = (api.atex.assessConformity && (await api.atex.assessConformity(body))) ||
            (api.atex.aiAnalyze && (await api.atex.aiAnalyze(body)));

          const decision = res?.decision || null;
          const rationale = res?.rationale || "";
          const source = res?.source || "unknown";

          if (decision && api.atex.applyCompliance) {
            await api.atex.applyCompliance(item.id, { decision, rationale, source });
          }
          checked++;
        } catch {
          errors++;
        }
      }
      await reload();
      setToast(`Vérification terminée: ${checked} équipements analysés${errors > 0 ? `, ${errors} erreurs` : ""}`);
    } catch {
      setToast("Erreur lors de la vérification en masse");
    } finally {
      setMassComplianceRunning(false);
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

      setEditing((cur) => ({
        ...(cur || {}),
        compliance_state: decision || cur?.compliance_state || "na",
        compliance_rationale: rationale || "",
        compliance_source: source || "unknown"
      }));

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

    try {
      // 1. D'abord, chercher la position réelle de l'équipement via API
      const positionData = await api.atexMaps.getEquipmentPosition(eq.id);

      if (positionData?.found && positionData?.position) {
        const pos = positionData.position;

        // 2. Charger les plans si pas encore fait
        let availablePlans = plans;
        if (availablePlans.length === 0) {
          const res = await api.atexMaps.listPlans();
          availablePlans = res?.plans || [];
          setPlans(availablePlans);
        }

        // 3. Trouver le plan exact par logical_name
        const matchingPlan = availablePlans.find(p => p.logical_name === pos.logical_name);

        if (matchingPlan) {
          // 4. D'abord définir l'ID pour le highlight AVANT de changer le plan
          setSelectedEquipmentId(eq.id);

          // 5. Sélectionner le plan avec la bonne page
          setSelectedPlan({ ...matchingPlan, _targetPageIndex: pos.page_index || 0 });
          setMapRefreshTick(t => t + 1);

          // 6. Basculer vers l'onglet Plans
          setActiveTab("plans");
          setToast(`📍 ${eq.name || "Équipement"} sur ${matchingPlan?.display_name || matchingPlan?.logical_name}`);
          return;
        }
      }

      // Équipement non positionné sur un plan
      setToast(`⚠️ ${eq.name || "Équipement"} n'est pas encore placé sur un plan`);
      setActiveTab("plans");

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
    <div className="max-w-[95vw] mx-auto px-4 sm:px-6 py-4 space-y-4">
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
                : confirmModal.variant === "warning"
                ? "bg-gradient-to-r from-orange-500 to-amber-600"
                : "bg-gradient-to-r from-blue-500 to-indigo-600"
            } text-white`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <span className="text-2xl">{confirmModal.variant === "danger" ? "⚠️" : confirmModal.variant === "warning" ? "📍" : "❓"}</span>
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
                    : confirmModal.variant === "warning"
                    ? "bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700"
                    : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                }`}
              >
                {confirmModal.variant === "danger" ? "Supprimer" : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🆕 Modal Management Monitoring avec Filtres */}
      {drpceModalOpen && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-slideUp">
            {/* Header avec gradient Haleon */}
            <div className="p-5 bg-gradient-to-r from-teal-500 to-teal-700 text-white">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <span className="text-2xl">📄</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold">Management Monitoring</h3>
                  <p className="text-white/80 text-sm">Générer le rapport ATEX</p>
                </div>
              </div>
            </div>
            {/* Content - Filtres */}
            <div className="p-5 space-y-4">
              <p className="text-gray-600 text-sm">
                Sélectionnez les filtres pour personnaliser votre rapport. Laissez vide pour inclure tous les éléments.
              </p>

              {/* Filtre Bâtiment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
                <select
                  value={drpceFilters.building}
                  onChange={e => setDrpceFilters(f => ({ ...f, building: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Tous les bâtiments</option>
                  {buildings.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {/* Filtre Zone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                <select
                  value={drpceFilters.zone}
                  onChange={e => setDrpceFilters(f => ({ ...f, zone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Toutes les zones</option>
                  {zones.map(z => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>

              {/* Filtre Conformité */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">État de conformité</label>
                <select
                  value={drpceFilters.compliance}
                  onChange={e => setDrpceFilters(f => ({ ...f, compliance: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                >
                  <option value="">Tous les états</option>
                  <option value="conforme">Conformes uniquement</option>
                  <option value="non_conforme">Non conformes uniquement</option>
                  <option value="na">Non vérifiés uniquement</option>
                </select>
              </div>

              {/* Résumé des filtres */}
              <div className="bg-teal-50 rounded-lg p-3 text-sm text-teal-800">
                <p className="font-medium">Résumé :</p>
                <p>
                  {drpceFilters.building || "Tous les bâtiments"}
                  {" / "}
                  {drpceFilters.zone || "Toutes les zones"}
                  {" / "}
                  {drpceFilters.compliance === "conforme" ? "Conformes" :
                   drpceFilters.compliance === "non_conforme" ? "Non conformes" :
                   drpceFilters.compliance === "na" ? "Non vérifiés" : "Tous les états"}
                </p>
              </div>
            </div>
            {/* Actions */}
            <div className="flex justify-end gap-3 p-4 bg-gray-50 border-t">
              <button
                onClick={() => {
                  setDrpceModalOpen(false);
                  setDrpceFilters({ building: "", zone: "", compliance: "" });
                }}
                className="px-4 py-2.5 rounded-xl text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 font-medium transition-all"
              >
                Annuler
              </button>
              <a
                href={api.atex.drpceUrl(drpceFilters)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setDrpceModalOpen(false)}
                className="px-4 py-2.5 rounded-xl text-white font-medium transition-all bg-gradient-to-r from-teal-500 to-teal-700 hover:from-teal-600 hover:to-teal-800 flex items-center gap-2"
              >
                <span>📄</span>
                Générer le PDF
              </a>
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
        <TabButton id="analytics" label="📊 Analyse" color="bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800" />
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
            items={items}
            runMassComplianceCheck={runMassComplianceCheck}
            massComplianceRunning={massComplianceRunning}
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

        {/* ANALYTICS */}
        {activeTab === "analytics" && (
          <AnalyticsTab
            items={items}
            stats={stats}
            loading={loading}
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
            onUploadClick={() => setUploadModalOpen(true)}
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
          onDuplicate={handleDuplicateEquipment}
          onRemoveFromPlan={handleRemoveFromPlan}
          files={files}
          history={history}
          onUploadPhoto={uploadMainPhoto}
          onUploadAttachments={uploadAttachments}
          onAnalyzePhotos={analyzeFromPhotos}
          onVerifyCompliance={verifyComplianceIA}
          onSendMainPhotoToAI={sendMainPhotoToAI}
          asDateInput={asDateInput}
          next36MonthsISO={next36MonthsISO}
          aiPhotosCount={aiPhotosCount}
          aiAnalysisPhotos={aiAnalysisPhotos}
          onOpenLightbox={openLightbox}
          infraLoading={infraLoading}
          infraPlans={infraPlans}
          infraPositions={infraPositions}
          placeOnInfraPlan={placeOnInfraPlan}
          removeFromInfraPlan={removeFromInfraPlan}
          onGoToPlans={() => { setActiveTab("plans"); setDrawerOpen(false); }}
        />
      )}

      {/* Lightbox pour agrandir les photos */}
      {lightboxOpen && lightboxSrc && (
        <div
          className="fixed inset-0 z-[10001] bg-black/90 flex items-center justify-center p-4"
          onClick={closeLightbox}
        >
          <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* Bouton fermer */}
            <button
              onClick={closeLightbox}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors text-lg font-medium flex items-center gap-2"
            >
              <span>Fermer</span>
              <span className="text-2xl">✕</span>
            </button>

            {/* Titre */}
            {lightboxTitle && (
              <div className="absolute -top-12 left-0 text-white text-lg font-medium truncate max-w-[70%]">
                {lightboxTitle}
              </div>
            )}

            {/* Image */}
            <img
              src={lightboxSrc}
              alt={lightboxTitle || "Photo agrandie"}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />

            {/* Instructions */}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-gray-400 text-sm">
              Cliquez en dehors de l'image ou appuyez sur Échap pour fermer
            </div>
          </div>
        </div>
      )}

      {/* Upload Plan Modal */}
      {uploadModalOpen && (
        <UploadPlanModal
          onClose={() => setUploadModalOpen(false)}
          onUpload={handleUploadPlan}
        />
      )}
    </div>
  );
}

// ============================================================
// UPLOAD PLAN MODAL
// ============================================================

function UploadPlanModal({ onClose, onUpload }) {
  const [file, setFile] = useState(null);
  const [buildingName, setBuildingName] = useState("");
  const [isMultiZone, setIsMultiZone] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    await onUpload(file, buildingName, isMultiZone);
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Importer un plan PDF</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fichier PDF *
            </label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom du bâtiment (optionnel)
            </label>
            <input
              type="text"
              value={buildingName}
              onChange={(e) => setBuildingName(e.target.value)}
              placeholder="Ex: Bâtiment A"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <input
              type="checkbox"
              id="multi-zone"
              checked={isMultiZone}
              onChange={(e) => setIsMultiZone(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="multi-zone" className="text-sm">
              <span className="font-medium text-blue-800">Plan Infrastructure</span>
              <span className="block text-xs text-blue-600">Plan multi-zones (non ATEX) pour positionner les équipements</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!file || uploading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Import..." : "Importer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD TAB
// ============================================================

function DashboardTab({ stats, overdueList, upcomingList, onOpenEquipment, items, runMassComplianceCheck, massComplianceRunning }) {
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

      {/* Zones Stats + Mass Compliance Check */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4">
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
        {/* Bouton Management Monitoring (ex-DRPCE) */}
        <button
          onClick={() => setDrpceModalOpen(true)}
          className="bg-gradient-to-br from-teal-500 to-teal-700 border border-teal-400 rounded-xl p-3 sm:p-4 hover:from-teal-600 hover:to-teal-800 transition-all shadow-md hover:shadow-lg group text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl sm:text-2xl group-hover:scale-110 transition-transform">📄</span>
            <div>
              <p className="text-xs sm:text-sm text-white/80">Générer le rapport</p>
              <p className="text-lg sm:text-xl font-bold text-white">Management Monitoring</p>
            </div>
          </div>
        </button>
        <button
          onClick={runMassComplianceCheck}
          disabled={massComplianceRunning || items.length === 0}
          className={`mass-ai-button rounded-xl p-3 sm:p-4 border-2 transition-all ${
            massComplianceRunning ? "running" : ""
          } disabled:opacity-50`}
        >
          {/* Particules décoratives */}
          <div className="mass-ai-particles">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          {/* Badge compteur */}
          {!massComplianceRunning && items.length > 0 && (
            <span className="mass-ai-badge">{items.length}</span>
          )}
          <div className="flex items-center gap-3 ai-text">
            <span className="text-xl sm:text-2xl ai-icon">{massComplianceRunning ? "⚡" : "🤖"}</span>
            <div className="text-left">
              <p className="text-xs sm:text-sm font-medium text-white/90">
                {massComplianceRunning ? "Analyse IA en cours..." : "Vérification IA en masse"}
              </p>
              <p className="text-lg sm:text-xl font-bold ai-text-title">
                {massComplianceRunning ? "Veuillez patienter..." : "Lancer l'analyse"}
              </p>
            </div>
          </div>
        </button>
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
// 📊 ANALYTICS TAB - Onglet d'analyse FURIEUX avec graphiques dynamiques
// ============================================================

function AnalyticsTab({ items, stats, loading }) {
  // États pour les filtres
  const [timeFilter, setTimeFilter] = useState("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");
  const [aiInsights, setAiInsights] = useState([]);
  const [loadingInsights, setLoadingInsights] = useState(false);

  // Données filtrées
  const filteredItems = useMemo(() => {
    let filtered = [...items];

    if (buildingFilter !== "all") {
      filtered = filtered.filter(it => it.building === buildingFilter);
    }

    if (complianceFilter !== "all") {
      filtered = filtered.filter(it => it.compliance_state === complianceFilter);
    }

    if (timeFilter !== "all") {
      const now = dayjs();
      if (timeFilter === "30days") {
        filtered = filtered.filter(it => it.next_check_date && dayjs(it.next_check_date).isBefore(now.add(30, 'day')));
      } else if (timeFilter === "90days") {
        filtered = filtered.filter(it => it.next_check_date && dayjs(it.next_check_date).isBefore(now.add(90, 'day')));
      } else if (timeFilter === "overdue") {
        filtered = filtered.filter(it => it.status === "en_retard");
      }
    }

    return filtered;
  }, [items, timeFilter, buildingFilter, complianceFilter]);

  // Liste unique des bâtiments
  const buildings = useMemo(() => {
    const set = new Set(items.map(it => it.building).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  // Liste unique des zones
  const zones = useMemo(() => {
    const set = new Set(items.map(it => it.zone).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  // Stats calculées pour les graphiques
  const chartStats = useMemo(() => {
    const total = filteredItems.length;
    const conforme = filteredItems.filter(it => it.compliance_state === "conforme").length;
    const nonConforme = filteredItems.filter(it => it.compliance_state === "non_conforme").length;
    const na = filteredItems.filter(it => !it.compliance_state || it.compliance_state === "na").length;

    const aFaire = filteredItems.filter(it => it.status === "a_faire").length;
    const enCours = filteredItems.filter(it => it.status === "en_cours_30").length;
    const enRetard = filteredItems.filter(it => it.status === "en_retard").length;

    const zonesGaz = filteredItems.filter(it => it.zoning_gas != null).length;
    const zonesDust = filteredItems.filter(it => it.zoning_dust != null).length;

    // Par zone gaz
    const zone0 = filteredItems.filter(it => it.zoning_gas === 0).length;
    const zone1 = filteredItems.filter(it => it.zoning_gas === 1).length;
    const zone2 = filteredItems.filter(it => it.zoning_gas === 2).length;

    // Par zone poussière
    const zone20 = filteredItems.filter(it => it.zoning_dust === 20).length;
    const zone21 = filteredItems.filter(it => it.zoning_dust === 21).length;
    const zone22 = filteredItems.filter(it => it.zoning_dust === 22).length;

    // Par bâtiment
    const byBuilding = {};
    filteredItems.forEach(it => {
      const b = it.building || "Non défini";
      if (!byBuilding[b]) byBuilding[b] = { total: 0, conforme: 0, nonConforme: 0 };
      byBuilding[b].total++;
      if (it.compliance_state === "conforme") byBuilding[b].conforme++;
      if (it.compliance_state === "non_conforme") byBuilding[b].nonConforme++;
    });

    // Timeline des contrôles à venir
    const timeline = [];
    const now = dayjs();
    for (let i = 0; i < 12; i++) {
      const month = now.add(i, 'month');
      const count = filteredItems.filter(it => {
        if (!it.next_check_date) return false;
        const d = dayjs(it.next_check_date);
        return d.month() === month.month() && d.year() === month.year();
      }).length;
      timeline.push({ month: month.format("MMM YYYY"), count });
    }

    return {
      total, conforme, nonConforme, na, aFaire, enCours, enRetard,
      zonesGaz, zonesDust, zone0, zone1, zone2, zone20, zone21, zone22,
      byBuilding, timeline,
      conformityRate: total > 0 ? Math.round((conforme / total) * 100) : 0
    };
  }, [filteredItems]);

  // Génération des insights IA
  useEffect(() => {
    const generateInsights = () => {
      const insights = [];

      if (chartStats.nonConforme > 0) {
        insights.push({
          icon: "⚠️",
          type: "warning",
          text: `${chartStats.nonConforme} équipement${chartStats.nonConforme > 1 ? 's' : ''} non conforme${chartStats.nonConforme > 1 ? 's' : ''} détecté${chartStats.nonConforme > 1 ? 's' : ''}. Action corrective recommandée.`
        });
      }

      if (chartStats.enRetard > 0) {
        insights.push({
          icon: "🕐",
          type: "critical",
          text: `${chartStats.enRetard} contrôle${chartStats.enRetard > 1 ? 's' : ''} en retard. Priorité haute recommandée.`
        });
      }

      if (chartStats.conformityRate >= 90) {
        insights.push({
          icon: "🎉",
          type: "success",
          text: `Excellent! Taux de conformité de ${chartStats.conformityRate}%. Maintenez ce niveau.`
        });
      } else if (chartStats.conformityRate >= 70) {
        insights.push({
          icon: "📈",
          type: "info",
          text: `Taux de conformité à ${chartStats.conformityRate}%. Objectif: atteindre 90% ce trimestre.`
        });
      } else if (chartStats.conformityRate > 0) {
        insights.push({
          icon: "🔴",
          type: "critical",
          text: `Taux de conformité critique: ${chartStats.conformityRate}%. Plan d'action urgent requis.`
        });
      }

      if (chartStats.zone0 > 0) {
        insights.push({
          icon: "💥",
          type: "warning",
          text: `${chartStats.zone0} équipement${chartStats.zone0 > 1 ? 's' : ''} en Zone 0 (risque maximum). Surveillance renforcée.`
        });
      }

      const prochainMois = chartStats.timeline[0]?.count || 0;
      if (prochainMois > 5) {
        insights.push({
          icon: "📅",
          type: "info",
          text: `${prochainMois} contrôles prévus ce mois. Planifiez les ressources.`
        });
      }

      setAiInsights(insights.slice(0, 5));
    };

    generateInsights();
  }, [chartStats]);

  // Export Excel
  const exportToExcel = () => {
    const headers = [
      "Nom", "Type", "Bâtiment", "Zone", "Marquage Gaz", "Marquage Poussière",
      "Zone Gaz", "Zone Poussière", "Conformité", "Statut", "Dernier contrôle", "Prochain contrôle"
    ];

    const rows = filteredItems.map(it => [
      it.name || "",
      it.type || "",
      it.building || "",
      it.zone || "",
      it.atex_mark_gas || "",
      it.atex_mark_dust || "",
      it.zoning_gas ?? "",
      it.zoning_dust ?? "",
      it.compliance_state || "N/A",
      it.status || "",
      it.last_check_date ? dayjs(it.last_check_date).format("DD/MM/YYYY") : "",
      it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : ""
    ]);

    const csvContent = [
      headers.join(";"),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    ].join("\n");

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atex_analyse_${dayjs().format("YYYY-MM-DD_HH-mm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Configuration des graphiques
  const complianceDonutData = {
    labels: ["Conforme", "Non conforme", "Non évalué"],
    datasets: [{
      data: [chartStats.conforme, chartStats.nonConforme, chartStats.na],
      backgroundColor: [
        "rgba(16, 185, 129, 0.8)",
        "rgba(239, 68, 68, 0.8)",
        "rgba(156, 163, 175, 0.8)"
      ],
      borderColor: [
        "rgba(16, 185, 129, 1)",
        "rgba(239, 68, 68, 1)",
        "rgba(156, 163, 175, 1)"
      ],
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  const statusDonutData = {
    labels: ["À faire", "En cours (30j)", "En retard"],
    datasets: [{
      data: [chartStats.aFaire, chartStats.enCours, chartStats.enRetard],
      backgroundColor: [
        "rgba(34, 197, 94, 0.8)",
        "rgba(245, 158, 11, 0.8)",
        "rgba(239, 68, 68, 0.8)"
      ],
      borderColor: [
        "rgba(34, 197, 94, 1)",
        "rgba(245, 158, 11, 1)",
        "rgba(239, 68, 68, 1)"
      ],
      borderWidth: 2,
      hoverOffset: 8
    }]
  };

  const zonesBarData = {
    labels: ["Zone 0", "Zone 1", "Zone 2", "Zone 20", "Zone 21", "Zone 22"],
    datasets: [{
      label: "Équipements",
      data: [chartStats.zone0, chartStats.zone1, chartStats.zone2, chartStats.zone20, chartStats.zone21, chartStats.zone22],
      backgroundColor: [
        "rgba(220, 38, 38, 0.8)",
        "rgba(245, 158, 11, 0.8)",
        "rgba(34, 197, 94, 0.8)",
        "rgba(147, 51, 234, 0.8)",
        "rgba(99, 102, 241, 0.8)",
        "rgba(59, 130, 246, 0.8)"
      ],
      borderRadius: 8,
      borderSkipped: false
    }]
  };

  const timelineData = {
    labels: chartStats.timeline.map(t => t.month),
    datasets: [{
      label: "Contrôles prévus",
      data: chartStats.timeline.map(t => t.count),
      fill: true,
      borderColor: "rgba(99, 102, 241, 1)",
      backgroundColor: "rgba(99, 102, 241, 0.1)",
      tension: 0.4,
      pointBackgroundColor: "rgba(99, 102, 241, 1)",
      pointBorderColor: "#fff",
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 8
    }]
  };

  const buildingLabels = Object.keys(chartStats.byBuilding).slice(0, 8);
  const buildingBarData = {
    labels: buildingLabels,
    datasets: [
      {
        label: "Conforme",
        data: buildingLabels.map(b => chartStats.byBuilding[b]?.conforme || 0),
        backgroundColor: "rgba(16, 185, 129, 0.8)",
        borderRadius: 4
      },
      {
        label: "Non conforme",
        data: buildingLabels.map(b => chartStats.byBuilding[b]?.nonConforme || 0),
        backgroundColor: "rgba(239, 68, 68, 0.8)",
        borderRadius: 4
      }
    ]
  };

  const radarData = {
    labels: ["Conformité", "Contrôles OK", "Zones Gaz", "Zones Poussière", "Documentation", "Maintenance"],
    datasets: [{
      label: "Score actuel",
      data: [
        chartStats.conformityRate,
        chartStats.total > 0 ? Math.round(((chartStats.aFaire + chartStats.enCours) / chartStats.total) * 100) : 0,
        chartStats.total > 0 ? Math.round((chartStats.zonesGaz / chartStats.total) * 100) : 0,
        chartStats.total > 0 ? Math.round((chartStats.zonesDust / chartStats.total) * 100) : 0,
        75,
        80
      ],
      backgroundColor: "rgba(99, 102, 241, 0.2)",
      borderColor: "rgba(99, 102, 241, 1)",
      borderWidth: 2,
      pointBackgroundColor: "rgba(99, 102, 241, 1)",
      pointBorderColor: "#fff",
      pointHoverBackgroundColor: "#fff",
      pointHoverBorderColor: "rgba(99, 102, 241, 1)"
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          padding: 20,
          usePointStyle: true,
          font: { size: 12, weight: "500" }
        }
      },
      tooltip: {
        backgroundColor: "rgba(17, 24, 39, 0.9)",
        padding: 12,
        titleFont: { size: 14, weight: "600" },
        bodyFont: { size: 13 },
        cornerRadius: 8
      }
    }
  };

  const barOptions = {
    ...chartOptions,
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 } }
      },
      y: {
        grid: { color: "rgba(0,0,0,0.05)" },
        beginAtZero: true,
        ticks: { font: { size: 11 } }
      }
    }
  };

  const lineOptions = {
    ...chartOptions,
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 }, maxRotation: 45 }
      },
      y: {
        grid: { color: "rgba(0,0,0,0.05)" },
        beginAtZero: true,
        ticks: { font: { size: 11 } }
      }
    },
    plugins: {
      ...chartOptions.plugins,
      zoom: {
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: "x"
        },
        pan: {
          enabled: true,
          mode: "x"
        }
      }
    }
  };

  const radarOptions = {
    ...chartOptions,
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: { stepSize: 20, font: { size: 10 } },
        pointLabels: { font: { size: 11, weight: "500" } }
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="kpi-grid">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="chart-skeleton h-24" />
          ))}
        </div>
        <div className="charts-grid charts-grid-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="chart-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-container">
      {/* Header avec filtres et export */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📊</span> Analyse ATEX
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {filteredItems.length} équipement{filteredItems.length !== 1 ? "s" : ""} analysé{filteredItems.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button onClick={exportToExcel} className="export-btn">
          <span>📥</span> Exporter Excel
        </button>
      </div>

      {/* Filtres dynamiques */}
      <div className="analytics-filters">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">🕐 Période:</span>
          {[
            { id: "all", label: "Tout" },
            { id: "30days", label: "30 jours" },
            { id: "90days", label: "90 jours" },
            { id: "overdue", label: "En retard" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setTimeFilter(f.id)}
              className={`analytics-filter-btn ${timeFilter === f.id ? "active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">🏢 Bâtiment:</span>
          <select
            value={buildingFilter}
            onChange={(e) => setBuildingFilter(e.target.value)}
            className="analytics-filter-btn"
          >
            <option value="all">Tous</option>
            {buildings.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">✅ Conformité:</span>
          {[
            { id: "all", label: "Tout" },
            { id: "conforme", label: "Conforme" },
            { id: "non_conforme", label: "Non conforme" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setComplianceFilter(f.id)}
              className={`analytics-filter-btn ${complianceFilter === f.id ? "active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs animés */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-value animate-count">{chartStats.total}</div>
          <div className="kpi-label">Total Équipements</div>
        </div>
        <div className="kpi-card kpi-green">
          <div className="kpi-value animate-count">{chartStats.conformityRate}%</div>
          <div className="kpi-label">Taux de Conformité</div>
          {chartStats.conformityRate >= 90 && <div className="kpi-trend up">↑ Excellent</div>}
        </div>
        <div className="kpi-card kpi-red">
          <div className="kpi-value animate-count">{chartStats.nonConforme}</div>
          <div className="kpi-label">Non Conformes</div>
          {chartStats.nonConforme > 0 && <div className="kpi-trend down">Action requise</div>}
        </div>
        <div className="kpi-card kpi-orange">
          <div className="kpi-value animate-count">{chartStats.enRetard}</div>
          <div className="kpi-label">En Retard</div>
          {chartStats.enRetard > 0 && <div className="kpi-trend down">Urgent</div>}
        </div>
      </div>

      {/* Panel IA Insights */}
      {aiInsights.length > 0 && (
        <div className="ai-insights-panel">
          <div className="ai-insights-header">
            <span className="text-2xl">🤖</span>
            <span className="ai-insights-title">Analyse IA</span>
            <span className="ai-insights-badge">Live</span>
          </div>
          <div className="ai-insights-content">
            {aiInsights.map((insight, idx) => (
              <div key={idx} className="ai-insight-item">
                <span className="ai-insight-icon">{insight.icon}</span>
                <span className="ai-insight-text">{insight.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Graphiques - Ligne 1 */}
      <div className="charts-grid charts-grid-2">
        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">🎯</span>
              État de Conformité
            </span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Doughnut data={complianceDonutData} options={chartOptions} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">📋</span>
              Statut des Contrôles
            </span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Doughnut data={statusDonutData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Graphiques - Ligne 2 */}
      <div className="charts-grid charts-grid-2">
        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">⚠️</span>
              Répartition par Zone ATEX
            </span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Bar data={zonesBarData} options={barOptions} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">🏢</span>
              Conformité par Bâtiment
            </span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Bar data={buildingBarData} options={{ ...barOptions, indexAxis: "y" }} />
          </div>
        </div>
      </div>

      {/* Graphiques - Ligne 3 */}
      <div className="charts-grid charts-grid-2">
        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">📅</span>
              Planning des Contrôles (12 mois)
            </span>
            <span className="text-xs text-gray-500">Zoom: molette souris</span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Line data={timelineData} options={lineOptions} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <span className="chart-title">
              <span className="chart-title-icon">🎯</span>
              Radar de Performance
            </span>
          </div>
          <div className="chart-body" style={{ height: "280px" }}>
            <Radar data={radarData} options={radarOptions} />
          </div>
        </div>
      </div>

      {/* Table récapitulative */}
      <div className="chart-card">
        <div className="chart-header">
          <span className="chart-title">
            <span className="chart-title-icon">📊</span>
            Détail par Bâtiment
          </span>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Bâtiment</th>
                <th>Total</th>
                <th>Conformes</th>
                <th>Non conformes</th>
                <th>Taux</th>
                <th>Progression</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(chartStats.byBuilding).slice(0, 10).map(([building, data]) => {
                const rate = data.total > 0 ? Math.round((data.conforme / data.total) * 100) : 0;
                return (
                  <tr key={building}>
                    <td className="font-medium">{building}</td>
                    <td>{data.total}</td>
                    <td className="text-green-600 font-medium">{data.conforme}</td>
                    <td className="text-red-600 font-medium">{data.nonConforme}</td>
                    <td>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        rate >= 90 ? "bg-green-100 text-green-700" :
                        rate >= 70 ? "bg-yellow-100 text-yellow-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {rate}%
                      </span>
                    </td>
                    <td style={{ width: "150px" }}>
                      <div className="analytics-progress">
                        <div
                          className={`analytics-progress-bar ${rate >= 90 ? "green" : rate >= 70 ? "orange" : "red"}`}
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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

function PlansTab({ plans, mapsLoading, selectedPlan, setSelectedPlan, mapRefreshTick, setMapRefreshTick, loadPlans, openEdit, applyZonesLocally, reload, mergeZones, editing, setEditing, setToast, selectedEquipmentId, setSelectedEquipmentId, onUploadClick }) {
  const grouped = useMemo(() => {
    const byKey = new Map();
    for (const p of plans) {
      // Plans multi-zones go to "Infrastructure Globale"
      if (p.is_multi_zone) {
        const batKey = "🏗️ Infrastructure Globale";
        const zoneKey = p.building_name?.trim() || p.display_name || p.logical_name;
        const g = byKey.get(batKey) || { key: batKey, zones: new Map(), isInfra: true };
        const z = g.zones.get(zoneKey) || { name: zoneKey, items: [] };
        z.items.push(p);
        g.zones.set(zoneKey, z);
        byKey.set(batKey, g);
      } else {
        // Regular ATEX plans grouped by building/zone
        const batKey = p.building?.trim() || "Autres";
        const zoneKey = p.zone?.trim() || "Zone non renseignée";
        const g = byKey.get(batKey) || { key: batKey, zones: new Map() };
        const z = g.zones.get(zoneKey) || { name: zoneKey, items: [] };
        z.items.push(p);
        g.zones.set(zoneKey, z);
        byKey.set(batKey, g);
      }
    }
    // Sort to put Infrastructure Globale first
    const result = Array.from(byKey.values()).map((g) => ({
      key: g.key,
      zones: Array.from(g.zones.values()),
      isInfra: g.isInfra || false,
    }));
    return result.sort((a, b) => (b.isInfra ? 1 : 0) - (a.isInfra ? 1 : 0));
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
        <div className="flex flex-col sm:flex-row gap-2">
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
          <button
            onClick={onUploadClick}
            className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 font-medium text-center shadow-md transition-all"
          >
            📄 Import PDF
          </button>
        </div>
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
            <details key={bat.key} open={bat.isInfra} className="group border rounded-2xl bg-white shadow-sm overflow-hidden">
              <summary className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-all ${
                bat.isInfra
                  ? "bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100"
                  : "bg-gradient-to-r from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-150"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${bat.isInfra ? "bg-blue-100" : "bg-amber-100"}`}>
                    <span className="text-xl">{bat.isInfra ? "🏗️" : "🏢"}</span>
                  </div>
                  <span className="font-semibold text-gray-800">{bat.key}</span>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  bat.isInfra ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                }`}>
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
                        <div
                          key={p.id || p.logical_name}
                          className={`relative p-3 border rounded-xl text-left transition-all hover:shadow-md group ${
                            selectedPlan?.logical_name === p.logical_name
                              ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-50 ring-2 ring-amber-200"
                              : "bg-white hover:bg-gray-50 border-gray-200"
                          }`}
                        >
                          <button
                            onClick={() => {
                              if (selectedPlan?.logical_name === p.logical_name) {
                                setSelectedPlan(null);
                              } else {
                                setSelectedPlan(p);
                                setMapRefreshTick((t) => t + 1);
                              }
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-center gap-2 pr-8">
                              <span className={`text-xl ${selectedPlan?.logical_name === p.logical_name ? "" : "opacity-60"}`}>📄</span>
                              <span className="font-medium truncate text-gray-800">{p.display_name || p.logical_name}</span>
                            </div>
                            {selectedPlan?.logical_name === p.logical_name && (
                              <span className="mt-2 inline-flex px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">
                                Actif
                              </span>
                            )}
                          </button>
                          {/* Bouton supprimer */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Supprimer le plan "${p.display_name || p.logical_name}" ?\n\nCela supprimera aussi les positions des équipements sur ce plan (les équipements ne seront pas supprimés).`)) return;
                              try {
                                await api.atexMaps.deletePlan(p.id);
                                setToast("Plan supprimé ✓");
                                if (selectedPlan?.logical_name === p.logical_name) {
                                  setSelectedPlan(null);
                                }
                                await loadPlans();
                              } catch (err) {
                                setToast("Erreur: " + (err.message || "Suppression échouée"));
                              }
                            }}
                            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all"
                            title="Supprimer ce plan"
                          >
                            🗑️
                          </button>
                        </div>
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
            key={`${selectedPlan.logical_name}:${mapRefreshTick}:${selectedEquipmentId || ''}:${selectedPlan._targetPageIndex || 0}`}
            plan={selectedPlan}
            pageIndex={selectedPlan._targetPageIndex || 0}
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
  onDuplicate,
  onRemoveFromPlan,
  files,
  history,
  onUploadPhoto,
  onUploadAttachments,
  onAnalyzePhotos,
  onVerifyCompliance,
  onSendMainPhotoToAI,
  asDateInput,
  next36MonthsISO,
  aiPhotosCount = 0,
  aiAnalysisPhotos = [],
  onOpenLightbox,
  infraLoading = false,
  infraPlans = [],
  infraPositions = [],
  placeOnInfraPlan,
  removeFromInfraPlan,
  onGoToPlans,
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
              <span
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white border border-emerald-400 cursor-help"
                title={editing.compliance_rationale || "Équipement conforme aux exigences ATEX"}
              >✓ Conforme</span>
            ) : editing.compliance_state === "non_conforme" ? (
              <span
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500 text-white border border-red-400 cursor-help"
                title={editing.compliance_rationale || "Équipement non conforme aux exigences ATEX"}
              >✗ Non conforme</span>
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
          {editing.id && <SectionTab id="infrastructure" label="Repositionner" icon="🔄" />}
          <SectionTab id="atex" label="ATEX" icon="⚠️" />
          <SectionTab id="dates" label="Contrôles" icon="📅" />
          {editing.id && <SectionTab id="files" label="Fichiers" icon="📎" />}
          {editing.id && <SectionTab id="audit" label="Historique" icon="📜" />}
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
                    <div
                      className={`w-24 h-24 sm:w-32 sm:h-32 rounded-xl border-2 border-dashed border-gray-300 overflow-hidden bg-gray-100 flex items-center justify-center shrink-0 ${editing.photo_url ? "cursor-zoom-in hover:ring-2 hover:ring-blue-400 transition-all" : ""}`}
                      onClick={() => editing.photo_url && onOpenLightbox(api.atex.photoUrl(editing.id, { bust: true }), editing.name || "Photo équipement")}
                      title={editing.photo_url ? "Cliquer pour agrandir" : ""}
                    >
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
                      <div className="flex flex-wrap gap-2">
                        <label className={`atex-btn w-full sm:w-auto cursor-pointer relative ${aiPhotosCount > 0 ? "atex-btn-secondary animate-pulse" : "atex-btn-ai"}`}>
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && onAnalyzePhotos(e.target.files)} />
                          {aiPhotosCount > 0 ? `⏳ Analyse ${aiPhotosCount} photo(s)...` : "🤖 Analyse IA"}
                        </label>
                        {editing.photo_url && (
                          <button
                            onClick={onSendMainPhotoToAI}
                            className="atex-btn atex-btn-ai w-full sm:w-auto"
                            title="Analyser la photo actuelle avec l'IA"
                          >
                            🔄 Analyser photo de profil de l'équipement
                          </button>
                        )}
                        <button onClick={onVerifyCompliance} className="atex-btn atex-btn-secondary w-full sm:w-auto">
                          ✅ Conformité IA
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Historique des photos analysées par IA */}
                  {aiAnalysisPhotos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="text-xs font-medium text-gray-500 mb-2">📂 Photos analysées récemment ({aiAnalysisPhotos.length})</div>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {aiAnalysisPhotos.map((photo) => (
                          <div
                            key={photo.id}
                            className="w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0 cursor-zoom-in hover:ring-2 hover:ring-blue-400 transition-all relative group"
                            onClick={() => onOpenLightbox(photo.url, photo.name)}
                            title={`${photo.name} - Cliquer pour agrandir`}
                          >
                            <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 text-white text-lg">🔍</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Cliquez sur une miniature pour l'agrandir</div>
                    </div>
                  )}
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

              {/* Actions sur le plan */}
              {editing.id && onRemoveFromPlan && (
                <div className="atex-section">
                  <div className="atex-section-title">🗺️ Actions sur le plan</div>
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-gray-600">
                      Retirez l'équipement du plan actuel pour le repositionner sur un autre plan depuis la carte.
                    </p>
                    <button
                      onClick={onRemoveFromPlan}
                      className="atex-btn bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 w-full sm:w-auto"
                    >
                      📍 Retirer du plan actuel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION: Repositionner sur un autre plan */}
          {activeSection === "infrastructure" && editing.id && (
            <div className="space-y-4 animate-fadeIn">
              <div className="atex-section">
                <div className="atex-section-title">🔄 Repositionner sur un autre plan</div>

                {infraLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-amber-500 border-t-transparent" />
                  </div>
                ) : (
                  <>
                    {/* Current position info */}
                    {editing.logical_name ? (
                      <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <p className="text-sm text-gray-600 mb-1">Position actuelle :</p>
                        <p className="font-medium text-gray-900">{editing.logical_name}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Pour repositionner, retirez d'abord l'équipement du plan actuel (section Localisation), puis placez-le sur un nouveau plan.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 mb-4 italic">
                        Cet équipement n'est pas encore positionné sur un plan.
                      </p>
                    )}

                    {/* Available multi-zone plans */}
                    {infraPlans.length > 0 ? (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Plans multi-zones disponibles :</p>
                        <div className="grid gap-2 max-h-[300px] overflow-y-auto">
                          {infraPlans.map(plan => {
                            const isCurrentPlan = editing.logical_name === plan.logical_name;
                            return (
                              <button
                                key={plan.id}
                                onClick={() => {
                                  if (isCurrentPlan) return;
                                  if (editing.logical_name) {
                                    if (confirm(`Déplacer l'équipement du plan actuel vers "${plan.display_name || plan.logical_name}" ?`)) {
                                      placeOnInfraPlan(editing.id, plan.id);
                                    }
                                  } else {
                                    placeOnInfraPlan(editing.id, plan.id);
                                  }
                                }}
                                disabled={isCurrentPlan}
                                className={`flex items-center gap-3 p-3 border rounded-lg transition-colors text-left ${
                                  isCurrentPlan
                                    ? "bg-green-50 border-green-300 cursor-default"
                                    : "bg-white border-gray-200 hover:bg-amber-50 hover:border-amber-300"
                                }`}
                              >
                                <span className={isCurrentPlan ? "text-green-500 text-lg" : "text-amber-500 text-lg"}>
                                  {isCurrentPlan ? "✓" : "📄"}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 truncate">{plan.display_name || plan.logical_name}</p>
                                  {plan.building_name && <p className="text-xs text-gray-500 truncate">{plan.building_name}</p>}
                                </div>
                                {isCurrentPlan ? (
                                  <span className="text-xs text-green-600 font-medium shrink-0">Actuel</span>
                                ) : (
                                  <span className="text-xs text-amber-600 font-medium shrink-0">Placer ici</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        <p className="text-sm">Aucun plan multi-zones disponible.</p>
                        <button
                          onClick={onGoToPlans}
                          className="text-sm text-amber-600 hover:text-amber-700 underline mt-1 inline-block"
                        >
                          Importer des plans →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="atex-section bg-blue-50 border-blue-200">
                <div className="atex-section-title text-blue-800">💡 Info</div>
                <p className="text-sm text-blue-700">
                  Les plans multi-zones permettent de positionner les équipements sur des plans d'infrastructure avec plusieurs zones définies.
                </p>
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

          {/* SECTION: Audit History */}
          {activeSection === "audit" && editing.id && (
            <div className="space-y-4 animate-fadeIn">
              {/* Qui a créé/modifié */}
              <div className="atex-section">
                <div className="atex-section-title">👤 Informations de création</div>
                <div className="grid sm:grid-cols-2 gap-4">
                  {(editing.created_by_name || editing.created_by_email || editing.created_by || editing.created_at) && (
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                      <div className="text-xs text-gray-500 mb-1">Créé par</div>
                      <CreatedByBadge
                        name={editing.created_by_name || editing.created_by}
                        email={editing.created_by_email}
                        date={editing.created_at}
                        size="md"
                      />
                    </div>
                  )}
                  {(editing.updated_by_name || editing.updated_by_email || editing.updated_by || editing.user_email || editing.updated_at) && (
                    <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                      <div className="text-xs text-gray-500 mb-1">Dernière modification</div>
                      <LastModifiedBadge
                        actor_name={editing.updated_by_name || editing.updated_by || editing.user_name}
                        actor_email={editing.updated_by_email || editing.user_email}
                        date={editing.updated_at}
                        action="updated"
                        showIcon={false}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Full audit history */}
              <AuditHistory
                apiEndpoint="/api/atex/audit/equipment"
                entityType="equipment"
                entityId={editing.id}
                title="Historique complet"
                maxHeight="350px"
                showFilters={true}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-white gap-2 flex-wrap">
          <button onClick={onClose} className="atex-btn atex-btn-secondary">
            ✕ Fermer
          </button>
          <div className="flex gap-2 flex-wrap">
            {editing.id && onDuplicate && (
              <button
                onClick={onDuplicate}
                className="atex-btn bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                title="Créer une copie de cet équipement"
              >
                📋 Dupliquer
              </button>
            )}
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
