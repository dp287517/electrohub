// src/pages/FireControl.jsx
// Fire Control - Contrôle des asservissements incendie
// VERSION 2.0 - Architecture ZONE-CENTRIC (pas détecteur-centric)

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import {
  Flame,
  Building2,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Upload,
  FileText,
  Plus,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  X,
  Camera,
  Download,
  RefreshCw,
  BarChart3,
  List,
  Map,
  Settings,
  Play,
  Bell,
  Eye,
  Trash2,
  Edit,
  Save,
  Loader2,
  Check,
  MapPin,
  Layers,
  FileSpreadsheet,
  ClipboardCheck,
  CalendarDays,
  TrendingUp,
  ArrowRight,
  Building,
  CircleDot,
  Info,
  HelpCircle,
  Link2,
  ThumbsUp,
  ThumbsDown,
  ListChecks,
  Sparkles,
} from "lucide-react";

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export default function FireControl() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "dashboard";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);

  // Data states
  const [dashboard, setDashboard] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [matrices, setMatrices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [zones, setZones] = useState([]);
  const [zoneChecks, setZoneChecks] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState({});

  // Filter states
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [selectedFloor, setSelectedFloor] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showUploadMatrixModal, setShowUploadMatrixModal] = useState(false);
  const [showZoneCheckModal, setShowZoneCheckModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showEquipmentMatchingModal, setShowEquipmentMatchingModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [selectedZoneCheck, setSelectedZoneCheck] = useState(null);
  const [uncertainMatches, setUncertainMatches] = useState([]);
  const [matchingContext, setMatchingContext] = useState(null); // campaign/matrix info
  const [parsingMatrixId, setParsingMatrixId] = useState(null); // Track which matrix is being AI-parsed

  // =============================================================================
  // DATA LOADING
  // =============================================================================
  const loadDashboard = useCallback(async () => {
    try {
      const data = await api.fireControl.dashboard({ year: selectedYear });
      setDashboard(data);
    } catch (err) {
      console.error("Failed to load dashboard:", err);
    }
  }, [selectedYear]);

  const loadCampaigns = useCallback(async () => {
    try {
      const data = await api.fireControl.listCampaigns({ year: selectedYear });
      setCampaigns(data || []);
    } catch (err) {
      console.error("Failed to load campaigns:", err);
    }
  }, [selectedYear]);

  const loadMatrices = useCallback(async () => {
    try {
      const data = await api.fireControl.listMatrices({ active_only: "true" });
      setMatrices(data || []);
    } catch (err) {
      console.error("Failed to load matrices:", err);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      // Load shared plans from admin (doors system)
      const data = await api.fireControlMaps.listSharedPlans();
      setPlans(data?.plans || data?.items || []);
    } catch (err) {
      console.error("Failed to load shared plans:", err);
    }
  }, []);

  const loadBuildings = useCallback(async () => {
    try {
      const data = await api.fireControl.listBuildings();
      setBuildings(data || []);
    } catch (err) {
      console.error("Failed to load buildings:", err);
    }
  }, []);

  const loadZones = useCallback(async () => {
    try {
      const params = {};
      if (selectedBuilding) params.building = selectedBuilding;
      if (selectedFloor) params.floor = selectedFloor;
      const data = await api.fireControl.listZones(params);
      setZones(data || []);
    } catch (err) {
      console.error("Failed to load zones:", err);
    }
  }, [selectedBuilding, selectedFloor]);

  const loadZoneChecks = useCallback(async () => {
    try {
      const params = {};
      if (selectedCampaign) params.campaign_id = selectedCampaign;
      if (selectedBuilding) params.building = selectedBuilding;
      const data = await api.fireControl.listZoneChecks(params);
      setZoneChecks(data || []);
    } catch (err) {
      console.error("Failed to load zone checks:", err);
    }
  }, [selectedCampaign, selectedBuilding]);

  const loadEquipmentTypes = useCallback(async () => {
    try {
      const data = await api.fireControl.getEquipmentTypes();
      setEquipmentTypes(data || {});
    } catch (err) {
      console.error("Failed to load equipment types:", err);
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    try {
      const data = await api.fireControl.listSchedule({ year: selectedYear });
      setSchedule(data || []);
    } catch (err) {
      console.error("Failed to load schedule:", err);
    }
  }, [selectedYear]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadDashboard(),
        loadCampaigns(),
        loadMatrices(),
        loadPlans(),
        loadBuildings(),
        loadEquipmentTypes(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadDashboard, loadCampaigns, loadMatrices, loadPlans, loadBuildings, loadEquipmentTypes]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (activeTab === "controls") {
      loadZones();
      loadZoneChecks();
    } else if (activeTab === "schedule") {
      loadSchedule();
    }
  }, [activeTab, loadZones, loadZoneChecks, loadSchedule]);

  // Update URL when tab changes
  useEffect(() => {
    setSearchParams({ tab: activeTab });
  }, [activeTab, setSearchParams]);

  // =============================================================================
  // HANDLERS
  // =============================================================================
  const showToast = (message, type = "success") => {
    setToastMessage({ text: message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleCreateCampaign = async (data) => {
    try {
      if (editingCampaign) {
        await api.fireControl.updateCampaign(editingCampaign.id, data);
        showToast("Campagne mise à jour");
      } else {
        await api.fireControl.createCampaign(data);
        showToast("Campagne créée");
      }
      setShowCampaignModal(false);
      setEditingCampaign(null);
      loadCampaigns();
      loadDashboard();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleDeleteCampaign = async (id) => {
    if (!confirm("Supprimer cette campagne ?")) return;
    try {
      await api.fireControl.deleteCampaign(id);
      showToast("Campagne supprimée");
      loadCampaigns();
      loadDashboard();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleUploadMatrix = async (file, extra) => {
    try {
      await api.fireControl.uploadMatrix(file, extra);
      showToast("Matrice uploadée");
      setShowUploadMatrixModal(false);
      loadMatrices();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // AI-powered matrix parsing - extracts equipment from PDF using Vision AI (background job)
  const handleAiParseMatrix = async (matrix) => {
    setParsingMatrixId(matrix.id);
    try {
      // Start background job
      const startResult = await api.fireControl.aiParseMatrix(matrix.id);

      if (startResult.reused) {
        showToast("Analyse déjà en cours...");
      } else {
        showToast("🚀 Analyse IA lancée en arrière-plan. Vous serez notifié quand ce sera terminé.");
      }

      // Clear the spinner after a short delay - the job runs in background
      setTimeout(() => {
        setParsingMatrixId(null);
      }, 2000);

      // Optional: Poll for completion (for immediate feedback without leaving the page)
      if (startResult.job_id) {
        pollMatrixParseJob(startResult.job_id, matrix.id);
      }

    } catch (err) {
      console.error("AI parse error:", err);
      showToast(err.message || "Erreur lors du lancement de l'analyse", "error");
      setParsingMatrixId(null);
    }
  };

  // Delete matrix
  const handleDeleteMatrix = async (matrix) => {
    if (!window.confirm(`Supprimer la matrice "${matrix.name}" ?`)) return;
    try {
      await api.fireControl.deleteMatrix(matrix.id);
      showToast("Matrice supprimée");
      loadMatrices();
    } catch (err) {
      console.error("Delete matrix error:", err);
      showToast(err.message || "Erreur lors de la suppression", "error");
    }
  };

  // Poll matrix parse job status
  const pollMatrixParseJob = async (jobId, matrixId) => {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s intervals)

    const poll = async () => {
      try {
        const job = await api.fireControl.getMatrixParseJob(jobId);

        if (job.status === 'completed') {
          const zones = job.result?.zones_created || 0;
          const equip = job.result?.equipment_created || 0;
          showToast(
            `✅ Analyse terminée: ${zones} zones, ${equip} équipements extraits. Allez dans l'onglet Équipements pour le matching.`,
            "success"
          );
          loadMatrices();
          loadZones();
          loadDashboard();
          return; // Stop polling
        }

        if (job.status === 'failed') {
          showToast(`❌ Analyse échouée: ${job.error}`, "error");
          return; // Stop polling
        }

        // Still processing - continue polling
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        }
      } catch (err) {
        console.warn("Poll error:", err.message);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        }
      }
    };

    // Start polling after a short delay
    setTimeout(poll, 3000);
  };

  const handleGenerateChecks = async (campaignId) => {
    try {
      const result = await api.fireControl.generateChecks(campaignId, {
        building: selectedBuilding || undefined,
      });
      showToast(`${result.created_count} zone(s) à contrôler`);
      loadZoneChecks();
      loadDashboard();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleUpdateZoneCheck = async (zoneCheckId, data) => {
    try {
      await api.fireControl.updateZoneCheckResults(zoneCheckId, data);
      showToast("Contrôle mis à jour");
      loadZoneChecks();
      loadDashboard();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleUpdateEquipmentResult = async (resultId, data) => {
    try {
      await api.fireControl.updateEquipmentResult(resultId, data);
      // Reload the current zone check
      if (selectedZoneCheck) {
        const updated = await api.fireControl.getZoneCheck(selectedZoneCheck.id);
        setSelectedZoneCheck(updated);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleGenerateReport = async (campaignId) => {
    try {
      const result = await api.fireControl.generateReport(campaignId);
      showToast("Rapport généré");
      // Open report in new tab
      window.open(api.fireControl.reportFileUrl(result.report_id), "_blank");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleCreateSchedule = async (data) => {
    try {
      await api.fireControl.createSchedule(data);
      showToast("Planification créée");
      setShowScheduleModal(false);
      loadSchedule();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Handler for auto-matching equipment from matrix
  const handleAutoMatchEquipment = async (matrixEquipment, context = {}) => {
    try {
      const response = await api.fireControlMaps.autoMatchEquipment(matrixEquipment);
      const results = response.matches || [];

      // Separate confident matches (auto-link) from uncertain matches (need confirmation)
      const confident = results.filter(r => r.status === "confident" && r.best_match);
      const uncertain = results.filter(r => r.status === "uncertain" && r.best_match);
      const noMatch = results.filter(r => r.status === "no_match");

      // Auto-link confident matches
      let autoLinked = 0;
      for (const match of confident) {
        try {
          await api.fireControlMaps.confirmEquipmentMatch({
            source_system: match.best_match.source_system,
            equipment_id: match.best_match.id,
            zone_id: context.zone_id,
            alarm_level: match.matrix_equipment.alarm_level || 1,
            fire_interlock_code: match.matrix_equipment.code,
          });
          autoLinked++;
        } catch (e) {
          console.error("Failed to auto-link:", e);
        }
      }

      if (autoLinked > 0) {
        showToast(`${autoLinked} équipement(s) lié(s) automatiquement`);
      }

      // If there are uncertain matches, show the modal
      if (uncertain.length > 0) {
        setUncertainMatches(uncertain);
        setMatchingContext(context);
        setShowEquipmentMatchingModal(true);
      } else if (noMatch.length > 0) {
        showToast(`${noMatch.length} équipement(s) sans correspondance`, "error");
      }

      return { confident: confident.length, uncertain: uncertain.length, noMatch: noMatch.length };
    } catch (err) {
      showToast(err.message, "error");
      return { confident: 0, uncertain: 0, noMatch: 0 };
    }
  };

  const handleConfirmEquipmentMatch = async (matchResult, selectedEquipment) => {
    try {
      await api.fireControlMaps.confirmEquipmentMatch({
        source_system: selectedEquipment.source_system,
        equipment_id: selectedEquipment.id,
        zone_id: matchingContext?.zone_id,
        alarm_level: matchResult.matrix_equipment.alarm_level || 1,
        fire_interlock_code: matchResult.matrix_equipment.code,
      });

      // Remove from uncertain list
      setUncertainMatches(prev => prev.filter(m => m.matrix_equipment.code !== matchResult.matrix_equipment.code));
      showToast("Équipement lié avec succès");

      // Close modal if no more uncertain matches
      if (uncertainMatches.length <= 1) {
        setShowEquipmentMatchingModal(false);
        setUncertainMatches([]);
        setMatchingContext(null);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleSkipEquipmentMatch = (matchResult) => {
    setUncertainMatches(prev => prev.filter(m => m.matrix_equipment.code !== matchResult.matrix_equipment.code));

    if (uncertainMatches.length <= 1) {
      setShowEquipmentMatchingModal(false);
      setUncertainMatches([]);
      setMatchingContext(null);
    }
  };

  // =============================================================================
  // COMPUTED VALUES
  // =============================================================================
  const filteredZoneChecks = useMemo(() => {
    if (!searchQuery) return zoneChecks;
    const q = searchQuery.toLowerCase();
    return zoneChecks.filter(
      (c) =>
        c.zone_code?.toLowerCase().includes(q) ||
        c.zone_name?.toLowerCase().includes(q) ||
        c.building?.toLowerCase().includes(q) ||
        c.floor?.toLowerCase().includes(q) ||
        c.access_point?.toLowerCase().includes(q)
    );
  }, [zoneChecks, searchQuery]);

  const checkStats = useMemo(() => {
    const total = zoneChecks.length;
    const passed = zoneChecks.filter((c) => c.status === "passed").length;
    const failed = zoneChecks.filter((c) => c.status === "failed").length;
    const pending = zoneChecks.filter((c) => c.status === "pending").length;
    const partial = zoneChecks.filter((c) => c.status === "partial").length;
    const inProgress = zoneChecks.filter((c) => c.status === "in_progress").length;
    return { total, passed, failed, pending, partial, inProgress };
  }, [zoneChecks]);

  const buildingOptions = useMemo(() => {
    const unique = [...new Set(plans.map((p) => p.building).filter(Boolean))];
    return unique.sort();
  }, [plans]);

  const floorOptions = useMemo(() => {
    if (!selectedBuilding) return [];
    const bldPlans = plans.filter((p) => p.building === selectedBuilding);
    const unique = [...new Set(bldPlans.map((p) => p.floor).filter(Boolean))];
    return unique.sort();
  }, [plans, selectedBuilding]);

  // =============================================================================
  // RENDER
  // =============================================================================
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in ${
            toastMessage.type === "error"
              ? "bg-red-500 text-white"
              : "bg-green-500 text-white"
          }`}
        >
          {toastMessage.type === "error" ? (
            <XCircle className="w-5 h-5" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          {/* Mobile: Stack vertically, Desktop: Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-orange-100 rounded-lg">
                <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold text-gray-900">
                  Contrôle Incendie
                </h1>
                <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">
                  Gestion des tests d'alarmes et asservissements
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Map view button */}
              <button
                onClick={() => navigate("/app/fire-control/map")}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-xs sm:text-sm font-medium hover:bg-orange-100 transition-colors"
                title="Voir sur le plan"
              >
                <MapPin className="w-4 h-4" />
                <span className="hidden xs:inline">Plan</span>
              </button>

              {/* Year selector */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-2 sm:px-3 py-1.5 sm:py-2 border rounded-lg text-xs sm:text-sm"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <button
                onClick={loadAll}
                className="p-1.5 sm:p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                title="Actualiser"
              >
                <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Tabs - Horizontal scroll on mobile */}
          <div className="flex gap-1 mt-3 sm:mt-4 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-hide">
            {[
              { id: "dashboard", label: "Dashboard", mobileLabel: "Accueil", icon: BarChart3 },
              { id: "documents", label: "1. Documents", mobileLabel: "Docs", icon: FileText },
              { id: "equipment", label: "2. Équipements", mobileLabel: "Équip.", icon: Link2 },
              { id: "campaigns", label: "3. Campagnes", mobileLabel: "Camp.", icon: Calendar },
              { id: "controls", label: "4. Contrôles", mobileLabel: "Ctrl", icon: ClipboardCheck },
              { id: "schedule", label: "Calendrier", mobileLabel: "Cal.", icon: CalendarDays },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-t-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? "bg-orange-50 text-orange-700 border-b-2 border-orange-500"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.mobileLabel}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {loading && !dashboard ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {activeTab === "dashboard" && (
              <DashboardTab
                dashboard={dashboard}
                campaigns={campaigns}
                onSelectCampaign={(c) => {
                  setSelectedCampaign(c.id);
                  setActiveTab("controls");
                }}
              />
            )}

            {activeTab === "campaigns" && (
              <CampaignsTab
                campaigns={campaigns}
                onCreateCampaign={() => {
                  setEditingCampaign(null);
                  setShowCampaignModal(true);
                }}
                onEditCampaign={(c) => {
                  setEditingCampaign(c);
                  setShowCampaignModal(true);
                }}
                onDeleteCampaign={handleDeleteCampaign}
                onGenerateChecks={handleGenerateChecks}
                onGenerateReport={handleGenerateReport}
                onSelectCampaign={(c) => {
                  setSelectedCampaign(c.id);
                  setActiveTab("controls");
                }}
              />
            )}

            {activeTab === "documents" && (
              <DocumentsTab
                matrices={matrices}
                plans={plans}
                onUploadMatrix={() => setShowUploadMatrixModal(true)}
                onRefresh={() => {
                  loadMatrices();
                  loadPlans();
                }}
                onAiParse={handleAiParseMatrix}
                onDeleteMatrix={handleDeleteMatrix}
                parsingMatrixId={parsingMatrixId}
                onLinkEquipment={async (matrix) => {
                  // Fetch equipment from this matrix and run auto-matching
                  try {
                    const response = await api.fireControl.getMatrixEquipment(matrix.id);
                    const matrixEquipment = response?.equipment || [];
                    if (matrixEquipment.length === 0) {
                      showToast("Aucun équipement trouvé dans cette matrice. Utilisez l'analyse IA d'abord.", "error");
                      return;
                    }
                    await handleAutoMatchEquipment(matrixEquipment, { matrix_id: matrix.id });
                  } catch (err) {
                    showToast(err.message, "error");
                  }
                }}
              />
            )}

            {activeTab === "controls" && (
              <ControlsTab
                zoneChecks={filteredZoneChecks}
                checkStats={checkStats}
                campaigns={campaigns}
                selectedCampaign={selectedCampaign}
                onSelectCampaign={setSelectedCampaign}
                selectedBuilding={selectedBuilding}
                onSelectBuilding={setSelectedBuilding}
                buildingOptions={buildingOptions}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelectZoneCheck={async (c) => {
                  // Load full zone check with equipment results
                  const fullCheck = await api.fireControl.getZoneCheck(c.id);
                  setSelectedZoneCheck(fullCheck);
                  setShowZoneCheckModal(true);
                }}
                onRefresh={loadZoneChecks}
              />
            )}

            {activeTab === "equipment" && (
              <EquipmentMatchingTab
                matrices={matrices}
                zones={zones}
                showToast={showToast}
                onRefresh={() => {
                  loadMatrices();
                  loadZones();
                }}
              />
            )}

            {activeTab === "schedule" && (
              <ScheduleTab
                schedule={schedule}
                campaigns={campaigns}
                buildings={buildingOptions}
                onCreateSchedule={() => setShowScheduleModal(true)}
                onRefresh={loadSchedule}
              />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showCampaignModal && (
        <CampaignModal
          campaign={editingCampaign}
          year={selectedYear}
          onSave={handleCreateCampaign}
          onClose={() => {
            setShowCampaignModal(false);
            setEditingCampaign(null);
          }}
        />
      )}

      {showUploadMatrixModal && (
        <UploadMatrixModal
          campaigns={campaigns}
          onUpload={handleUploadMatrix}
          onClose={() => setShowUploadMatrixModal(false)}
        />
      )}

      {showZoneCheckModal && selectedZoneCheck && (
        <ZoneCheckModal
          zoneCheck={selectedZoneCheck}
          equipmentTypes={equipmentTypes}
          onUpdateResult={handleUpdateEquipmentResult}
          onSave={(data) => {
            handleUpdateZoneCheck(selectedZoneCheck.id, data);
            setShowZoneCheckModal(false);
          }}
          onClose={() => {
            setShowZoneCheckModal(false);
            setSelectedZoneCheck(null);
          }}
          onViewMap={(zoneCheckId) => {
            setShowZoneCheckModal(false);
            navigate(`/app/fire-control/map?zone_check=${zoneCheckId}`);
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleModal
          campaigns={campaigns}
          buildings={buildingOptions}
          onSave={handleCreateSchedule}
          onClose={() => setShowScheduleModal(false)}
        />
      )}

      {showEquipmentMatchingModal && uncertainMatches.length > 0 && (
        <EquipmentMatchingModal
          uncertainMatches={uncertainMatches}
          context={matchingContext}
          onConfirm={handleConfirmEquipmentMatch}
          onSkip={handleSkipEquipmentMatch}
          onClose={() => {
            setShowEquipmentMatchingModal(false);
            setUncertainMatches([]);
            setMatchingContext(null);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// DASHBOARD TAB
// =============================================================================
function DashboardTab({ dashboard, campaigns, onSelectCampaign }) {
  if (!dashboard) return null;

  const { checks, buildings, upcoming_schedule } = dashboard;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <StatCard
          icon={ClipboardCheck}
          label="Total"
          labelFull="Total Contrôles"
          value={checks?.total_checks || 0}
          color="blue"
        />
        <StatCard
          icon={CheckCircle2}
          label="Conformes"
          value={checks?.passed || 0}
          color="green"
          subtext={
            checks?.total_checks > 0
              ? `${Math.round((checks.passed / checks.total_checks) * 100)}%`
              : "0%"
          }
        />
        <StatCard
          icon={XCircle}
          label="Non-conf."
          labelFull="Non-conformes"
          value={checks?.failed || 0}
          color="red"
        />
        <StatCard
          icon={Clock}
          label="Attente"
          labelFull="En attente"
          value={checks?.pending || 0}
          color="yellow"
        />
      </div>

      {/* Buildings overview */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 flex items-center gap-2">
          <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
          Vue par bâtiment
        </h3>
        {buildings && buildings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {buildings.map((bld) => (
              <div
                key={bld.building}
                className="p-4 border rounded-lg hover:border-orange-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{bld.building || "Non défini"}</span>
                  <span className="text-sm text-gray-500">
                    {bld.zone_count || 0} zones
                  </span>
                </div>
                <div className="flex gap-2 text-sm">
                  <span className="text-green-600">{bld.passed || 0} OK</span>
                  <span className="text-red-600">{bld.failed || 0} NOK</span>
                </div>
                {bld.check_count > 0 && (
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${((bld.passed || 0) / bld.check_count) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-6 sm:py-8 text-sm sm:text-base">
            Aucun bâtiment configuré. Uploadez des plans et configurez les zones.
          </p>
        )}
      </div>

      {/* Active campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
            Campagnes actives
          </h3>
          {campaigns && campaigns.length > 0 ? (
            <div className="space-y-3">
              {campaigns
                .filter((c) => c.status === "in_progress" || c.status === "planned")
                .slice(0, 5)
                .map((campaign) => (
                  <div
                    key={campaign.id}
                    onClick={() => onSelectCampaign(campaign)}
                    className="p-3 border rounded-lg hover:border-orange-300 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{campaign.name}</span>
                      <StatusBadge status={campaign.status} />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {campaign.start_date
                        ? dayjs(campaign.start_date).format("DD/MM/YYYY")
                        : "Non planifié"}
                    </p>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-6 sm:py-8 text-sm sm:text-base">
              Aucune campagne active
            </p>
          )}
        </div>

        {/* Upcoming schedule */}
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
            <span className="hidden sm:inline">Prochains contrôles planifiés</span>
            <span className="sm:hidden">Prochains contrôles</span>
          </h3>
          {upcoming_schedule && upcoming_schedule.length > 0 ? (
            <div className="space-y-3">
              {upcoming_schedule.map((item) => (
                <div key={item.id} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.building}</span>
                    <span className="text-sm text-orange-600">
                      {dayjs(item.scheduled_date).format("DD/MM/YYYY")}
                    </span>
                  </div>
                  {item.campaign_name && (
                    <p className="text-sm text-gray-500">{item.campaign_name}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-6 sm:py-8 text-sm sm:text-base">
              Aucun contrôle planifié
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CAMPAIGNS TAB
// =============================================================================
function CampaignsTab({
  campaigns,
  onCreateCampaign,
  onEditCampaign,
  onDeleteCampaign,
  onGenerateChecks,
  onGenerateReport,
  onSelectCampaign,
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <h2 className="text-base sm:text-lg font-semibold">Campagnes de contrôle</h2>
        <button
          onClick={onCreateCampaign}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
        >
          <Plus className="w-4 h-4" />
          Nouvelle campagne
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 sm:p-12 text-center">
          <Calendar className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">
            Aucune campagne
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Créez une campagne de contrôle annuelle pour commencer
          </p>
          <button
            onClick={onCreateCampaign}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
          >
            Créer une campagne
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 hover:border-orange-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-2 sm:mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">{campaign.name}</h3>
                  <p className="text-xs sm:text-sm text-gray-500">Année {campaign.year}</p>
                </div>
                <StatusBadge status={campaign.status} />
              </div>

              {campaign.start_date && (
                <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">
                  <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
                  {dayjs(campaign.start_date).format("DD/MM/YYYY")}
                  {campaign.end_date &&
                    ` - ${dayjs(campaign.end_date).format("DD/MM/YYYY")}`}
                </p>
              )}

              {campaign.notes && (
                <p className="text-xs sm:text-sm text-gray-500 mb-2 sm:mb-3 line-clamp-2">
                  {campaign.notes}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t">
                <button
                  onClick={() => onSelectCampaign(campaign)}
                  className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Voir
                </button>
                <button
                  onClick={() => onGenerateChecks(campaign.id)}
                  className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg"
                >
                  <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Générer</span>
                </button>
                <button
                  onClick={() => onGenerateReport(campaign.id)}
                  className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
                >
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">Rapport</span>
                </button>
                <button
                  onClick={() => onEditCampaign(campaign)}
                  className="p-1 sm:p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                >
                  <Edit className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
                <button
                  onClick={() => onDeleteCampaign(campaign.id)}
                  className="p-1 sm:p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DOCUMENTS TAB
// =============================================================================
function DocumentsTab({ matrices, plans, onUploadMatrix, onRefresh, onLinkEquipment, onAiParse, onDeleteMatrix, parsingMatrixId }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Matrices */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
            <span className="hidden sm:inline">Matrices d'asservissement</span>
            <span className="sm:hidden">Matrices</span>
          </h3>
          <button
            onClick={onUploadMatrix}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
          >
            <Upload className="w-4 h-4" />
            Uploader
          </button>
        </div>

        {matrices.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <FileSpreadsheet className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm sm:text-base">Aucune matrice uploadée</p>
            <p className="text-xs sm:text-sm">Uploadez votre matrice d'asservissement PDF</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matrices.map((matrix) => (
              <div
                key={matrix.id}
                className="flex items-center justify-between p-3 sm:p-4 border rounded-lg hover:border-orange-300"
              >
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-orange-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm sm:text-base truncate">{matrix.name}</p>
                    <p className="text-xs sm:text-sm text-gray-500">
                      v{matrix.version} - {dayjs(matrix.upload_date).format("DD/MM/YY")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {onAiParse && (
                    <button
                      onClick={() => onAiParse(matrix)}
                      disabled={parsingMatrixId === matrix.id}
                      className="p-2 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded flex-shrink-0 disabled:opacity-50"
                      title="Analyser avec IA"
                    >
                      {parsingMatrixId === matrix.id ? (
                        <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                    </button>
                  )}
                  {onLinkEquipment && (
                    <button
                      onClick={() => onLinkEquipment(matrix)}
                      className="p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded flex-shrink-0"
                      title="Lier les équipements"
                    >
                      <Link2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  )}
                  <a
                    href={api.fireControl.matrixFileUrl(matrix.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded flex-shrink-0"
                  >
                    <Eye className="w-4 h-4 sm:w-5 sm:h-5" />
                  </a>
                  {onDeleteMatrix && (
                    <button
                      onClick={() => onDeleteMatrix(matrix)}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plans - Link to admin shared plans */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Map className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
            Plans de bâtiments
          </h3>
          <a
            href="/app/plans"
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
          >
            <Settings className="w-4 h-4" />
            Gérer dans Admin
          </a>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-800 mb-1">Plans partagés depuis Admin</p>
              <p className="text-blue-600">
                Les plans utilisés pour le contrôle incendie sont ceux uploadés dans la page Admin &gt; Plans.
                Cela permet d'utiliser les mêmes plans pour toutes les applications (Portes, Tableaux, DataHub, etc.).
              </p>
              <p className="text-blue-600 mt-2">
                <strong>{plans.length} plan(s)</strong> disponible(s) pour la visualisation des équipements.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CONTROLS TAB - Zone-centric
// =============================================================================
function ControlsTab({
  zoneChecks,
  checkStats,
  campaigns,
  selectedCampaign,
  onSelectCampaign,
  selectedBuilding,
  onSelectBuilding,
  buildingOptions,
  searchQuery,
  onSearchChange,
  onSelectZoneCheck,
  onRefresh,
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center">
          <div className="w-full sm:flex-1 sm:min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher zone, bâtiment..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto">
            <select
              value={selectedCampaign || ""}
              onChange={(e) => onSelectCampaign(e.target.value || null)}
              className="px-2 sm:px-3 py-2 border rounded-lg text-xs sm:text-sm min-w-0 flex-shrink"
            >
              <option value="">Campagnes</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={selectedBuilding}
              onChange={(e) => onSelectBuilding(e.target.value)}
              className="px-2 sm:px-3 py-2 border rounded-lg text-xs sm:text-sm min-w-0 flex-shrink"
            >
              <option value="">Bâtiment</option>
              {buildingOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <button
              onClick={onRefresh}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex-shrink-0"
            >
              <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-2 sm:gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-gray-100 rounded-lg text-xs sm:text-sm">
          <span className="text-gray-600">Zones:</span>
          <span className="font-semibold">{checkStats.total}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-green-100 rounded-lg text-xs sm:text-sm">
          <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
          <span className="font-semibold text-green-700">{checkStats.passed}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-red-100 rounded-lg text-xs sm:text-sm">
          <XCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600" />
          <span className="font-semibold text-red-700">{checkStats.failed}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-yellow-100 rounded-lg text-xs sm:text-sm">
          <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-yellow-600" />
          <span className="font-semibold text-yellow-700">{checkStats.pending}</span>
        </div>
        {checkStats.inProgress > 0 && (
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-100 rounded-lg text-xs sm:text-sm">
            <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
            <span className="font-semibold text-blue-700">{checkStats.inProgress}</span>
          </div>
        )}
      </div>

      {/* Zone checks list */}
      {zoneChecks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 sm:p-12 text-center">
          <ClipboardCheck className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">
            Aucun contrôle de zone
          </h3>
          <p className="text-sm text-gray-500">
            Sélectionnez une campagne et générez les contrôles par zone
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: Cards */}
          <div className="sm:hidden space-y-3">
            {zoneChecks.map((check) => (
              <div
                key={check.id}
                onClick={() => onSelectZoneCheck(check)}
                className="bg-white rounded-xl shadow-sm border p-4 cursor-pointer active:bg-gray-50"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-orange-500" />
                    <span className="font-semibold text-sm">{check.zone_code}</span>
                  </div>
                  <CheckStatusBadge status={check.status} />
                </div>
                <p className="text-xs text-gray-700 mb-1">{check.zone_name}</p>
                <p className="text-xs text-gray-500 mb-3">
                  {check.building} {check.floor && `- ${check.floor}`} {check.access_point && `- ${check.access_point}`}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">AL1:</span>
                      {check.alarm1_triggered === true && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {check.alarm1_triggered === false && <XCircle className="w-4 h-4 text-red-500" />}
                      {check.alarm1_triggered == null && <span className="text-gray-300">-</span>}
                      <span className="text-gray-400">({check.equipment_count_al1 || 0})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">AL2:</span>
                      {check.alarm2_triggered === true && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {check.alarm2_triggered === false && <XCircle className="w-4 h-4 text-red-500" />}
                      {check.alarm2_triggered == null && <span className="text-gray-300">-</span>}
                      <span className="text-gray-400">({check.equipment_count_al2 || 0})</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectZoneCheck(check);
                    }}
                    className="p-2 text-orange-600 bg-orange-50 rounded-lg"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className="hidden sm:block bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                    Zone
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                    Localisation
                  </th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                    AL1 (Équip.)
                  </th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                    AL2 (Équip.)
                  </th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                    Résultat
                  </th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                    Status
                  </th>
                  <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {zoneChecks.map((check) => (
                  <tr
                    key={check.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onSelectZoneCheck(check)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-orange-500" />
                        <div>
                          <span className="font-medium">{check.zone_code}</span>
                          <p className="text-xs text-gray-500">{check.zone_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <p>{check.building}</p>
                        <p className="text-gray-500">
                          {check.floor} {check.access_point && `- ${check.access_point}`}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {check.alarm1_triggered === true && (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                        {check.alarm1_triggered === false && (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        {check.alarm1_triggered == null && (
                          <span className="text-gray-300">-</span>
                        )}
                        <span className="text-xs text-gray-400">({check.equipment_count_al1 || 0})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {check.alarm2_triggered === true && (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                        {check.alarm2_triggered === false && (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        {check.alarm2_triggered == null && (
                          <span className="text-gray-300">-</span>
                        )}
                        <span className="text-xs text-gray-400">({check.equipment_count_al2 || 0})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 text-xs">
                        <span className="text-green-600">{check.ok_count || 0} OK</span>
                        <span className="text-red-600">{check.nok_count || 0} NOK</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CheckStatusBadge status={check.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectZoneCheck(check);
                        }}
                        className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded"
                        title="Effectuer le contrôle"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// SCHEDULE TAB
// =============================================================================
function ScheduleTab({ schedule, campaigns, buildings, onCreateSchedule, onRefresh }) {
  // Group by month
  const groupedSchedule = useMemo(() => {
    const groups = {};
    schedule.forEach((item) => {
      const month = dayjs(item.scheduled_date).format("YYYY-MM");
      if (!groups[month]) groups[month] = [];
      groups[month].push(item);
    });
    return groups;
  }, [schedule]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <h2 className="text-base sm:text-lg font-semibold">Calendrier des contrôles</h2>
        <button
          onClick={onCreateSchedule}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
        >
          <Plus className="w-4 h-4" />
          Planifier
        </button>
      </div>

      {schedule.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 sm:p-12 text-center">
          <CalendarDays className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">
            Aucune planification
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Planifiez vos contrôles annuels par bâtiment
          </p>
          <button
            onClick={onCreateSchedule}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm"
          >
            Créer une planification
          </button>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {Object.entries(groupedSchedule)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, items]) => (
              <div key={month} className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 capitalize">
                  {dayjs(month).format("MMMM YYYY")}
                </h3>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 border rounded-lg gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg flex-shrink-0 ${
                            item.status === "completed"
                              ? "bg-green-100"
                              : item.status === "in_progress"
                              ? "bg-yellow-100"
                              : "bg-gray-100"
                          }`}
                        >
                          <Building2
                            className={`w-4 h-4 sm:w-5 sm:h-5 ${
                              item.status === "completed"
                                ? "text-green-600"
                                : item.status === "in_progress"
                                ? "text-yellow-600"
                                : "text-gray-500"
                            }`}
                          />
                        </div>
                        <div>
                          <p className="font-medium text-sm sm:text-base">{item.building}</p>
                          {item.campaign_name && (
                            <p className="text-xs sm:text-sm text-gray-500">
                              {item.campaign_name}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 pl-11 sm:pl-0">
                        <span className="text-xs sm:text-sm text-gray-500">
                          {dayjs(item.scheduled_date).format("DD/MM/YYYY")}
                        </span>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MODALS
// =============================================================================

// Campaign Modal
function CampaignModal({ campaign, year, onSave, onClose }) {
  const [form, setForm] = useState({
    name: campaign?.name || `Contrôle annuel ${year}`,
    year: campaign?.year || year,
    start_date: campaign?.start_date?.slice(0, 10) || "",
    end_date: campaign?.end_date?.slice(0, 10) || "",
    status: campaign?.status || "planned",
    notes: campaign?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={campaign ? "Modifier la campagne" : "Nouvelle campagne"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom de la campagne *
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-sm sm:text-base"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Année
            </label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg text-sm sm:text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm sm:text-base"
            >
              <option value="planned">Planifié</option>
              <option value="in_progress">En cours</option>
              <option value="completed">Terminé</option>
              <option value="cancelled">Annulé</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date début
            </label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm sm:text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date fin
            </label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm sm:text-base"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {campaign ? "Mettre à jour" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Upload Matrix Modal
function UploadMatrixModal({ campaigns, onUpload, onClose }) {
  const [file, setFile] = useState(null);
  const [matrixName, setMatrixName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [version, setVersion] = useState("1.0");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      await onUpload(file, {
        matrix_name: matrixName || file.name,
        campaign_id: campaignId || undefined,
        version,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Uploader une matrice d'asservissement" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            file ? "border-orange-300 bg-orange-50" : "border-gray-300 hover:border-orange-300"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                if (!matrixName) setMatrixName(f.name.replace(/\.pdf$/i, ""));
              }
            }}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className="w-8 h-8 text-orange-500" />
              <div className="text-left">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-600">Cliquez pour sélectionner un fichier PDF</p>
              <p className="text-sm text-gray-400">ou glissez-déposez</p>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom de la matrice
          </label>
          <input
            type="text"
            value={matrixName}
            onChange={(e) => setMatrixName(e.target.value)}
            placeholder="Ex: Matrice d'asservissement 2024"
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Campagne associée
            </label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Aucune</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Version
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!file || uploading}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            Uploader
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Upload Plan Modal
function UploadPlanModal({ buildings, onUpload, onClose }) {
  const [file, setFile] = useState(null);
  const [building, setBuilding] = useState("");
  const [newBuilding, setNewBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [planName, setPlanName] = useState("");
  const [version, setVersion] = useState("1.0");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const finalBuilding = building === "_new" ? newBuilding : building;
    if (!finalBuilding) return;

    setUploading(true);
    try {
      await onUpload(file, {
        building: finalBuilding,
        floor,
        plan_name: planName || file.name,
        version,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Uploader un plan de bâtiment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            file ? "border-orange-300 bg-orange-50" : "border-gray-300 hover:border-orange-300"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                if (!planName) setPlanName(f.name.replace(/\.pdf$/i, ""));
              }
            }}
            className="hidden"
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className="w-8 h-8 text-orange-500" />
              <div className="text-left">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-600">Cliquez pour sélectionner un fichier PDF</p>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bâtiment *
          </label>
          <select
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            required
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Sélectionner...</option>
            {buildings.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value="_new">+ Nouveau bâtiment</option>
          </select>
        </div>

        {building === "_new" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom du nouveau bâtiment *
            </label>
            <input
              type="text"
              required
              value={newBuilding}
              onChange={(e) => setNewBuilding(e.target.value)}
              placeholder="Ex: B22, B23, B24..."
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Étage
            </label>
            <input
              type="text"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="Ex: Rez, 1er, Sous-sol..."
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Version
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Nom du plan
          </label>
          <input
            type="text"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!file || uploading || (!building && !newBuilding)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            Uploader
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Zone Check Modal (for recording test results with equipment checklist)
function ZoneCheckModal({ zoneCheck, equipmentTypes, onUpdateResult, onSave, onClose, onViewMap }) {
  const [form, setForm] = useState({
    alarm1_triggered: zoneCheck.alarm1_triggered,
    alarm2_triggered: zoneCheck.alarm2_triggered,
    detector_used: zoneCheck.detector_used || "",
    notes: zoneCheck.notes || "",
  });
  const [activeTab, setActiveTab] = useState("al1");
  const [saving, setSaving] = useState(false);

  const equipmentAL1 = zoneCheck.equipment_results_alarm1 || [];
  const equipmentAL2 = zoneCheck.equipment_results_alarm2 || [];

  const getEquipmentTypeLabel = (type) => {
    const labels = {
      pcf: "Porte CF",
      rideau: "Rideau CF",
      hvac: "HVAC",
      elevator: "Ascenseur",
      lift: "Monte-charge",
      evacuation: "Évacuation",
      flash: "Feu flash",
      siren: "Sirène",
      damper: "Clapet CF",
      interlock: "Asservissement",
      other: "Autre",
    };
    return labels[type] || type;
  };

  const getResultColor = (result) => {
    if (result === "ok") return "bg-green-100 border-green-500 text-green-700";
    if (result === "nok") return "bg-red-100 border-red-500 text-red-700";
    if (result === "na") return "bg-gray-100 border-gray-400 text-gray-600";
    return "bg-white border-gray-200";
  };

  const cycleResult = async (item) => {
    const order = ["pending", "ok", "nok", "na"];
    const currentIndex = order.indexOf(item.result);
    const nextResult = order[(currentIndex + 1) % order.length];
    await onUpdateResult(item.id, { result: nextResult });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const toggleAlarm = (alarm) => {
    const current = form[alarm];
    const next = current === null ? true : current === true ? false : null;
    setForm({ ...form, [alarm]: next });
  };

  return (
    <Modal title={`Zone ${zoneCheck.zone_code}`} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
        {/* Zone info */}
        <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
          <h4 className="font-medium text-sm mb-2">{zoneCheck.zone_name}</h4>
          <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
            <div>
              <span className="text-gray-500">Bâtiment:</span>{" "}
              <span className="font-medium">{zoneCheck.building || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Étage:</span>{" "}
              <span className="font-medium">{zoneCheck.floor || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Accès:</span>{" "}
              <span className="font-medium">{zoneCheck.access_point || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Détecteurs:</span>{" "}
              <span className="font-medium">{zoneCheck.detector_numbers || "-"}</span>
            </div>
          </div>
        </div>

        {/* Detector used for test */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Détecteur utilisé pour le test
          </label>
          <input
            type="text"
            value={form.detector_used}
            onChange={(e) => setForm({ ...form, detector_used: e.target.value })}
            placeholder="Ex: 20003"
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {/* Alarm toggle buttons */}
        <div className="grid grid-cols-2 gap-3">
          <div
            onClick={() => toggleAlarm("alarm1_triggered")}
            className={`p-3 border-2 rounded-lg cursor-pointer transition-all active:scale-[0.98] ${
              form.alarm1_triggered === true
                ? "border-green-500 bg-green-50"
                : form.alarm1_triggered === false
                ? "border-red-500 bg-red-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">AL 1 déclenché</span>
              {form.alarm1_triggered === true && <CheckCircle2 className="w-5 h-5 text-green-500" />}
              {form.alarm1_triggered === false && <XCircle className="w-5 h-5 text-red-500" />}
              {form.alarm1_triggered == null && <span className="text-xs text-gray-400">-</span>}
            </div>
          </div>
          <div
            onClick={() => toggleAlarm("alarm2_triggered")}
            className={`p-3 border-2 rounded-lg cursor-pointer transition-all active:scale-[0.98] ${
              form.alarm2_triggered === true
                ? "border-green-500 bg-green-50"
                : form.alarm2_triggered === false
                ? "border-red-500 bg-red-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">AL 2 déclenché</span>
              {form.alarm2_triggered === true && <CheckCircle2 className="w-5 h-5 text-green-500" />}
              {form.alarm2_triggered === false && <XCircle className="w-5 h-5 text-red-500" />}
              {form.alarm2_triggered == null && <span className="text-xs text-gray-400">-</span>}
            </div>
          </div>
        </div>

        {/* Equipment tabs */}
        <div>
          <div className="flex border-b">
            <button
              type="button"
              onClick={() => setActiveTab("al1")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "al1"
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Alarme 1 ({equipmentAL1.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("al2")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "al2"
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Alarme 2 ({equipmentAL2.length})
            </button>
          </div>

          {/* Equipment checklist */}
          <div className="mt-3 max-h-[40vh] overflow-y-auto">
            {activeTab === "al1" && equipmentAL1.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">Aucun équipement pour AL1</p>
            )}
            {activeTab === "al2" && equipmentAL2.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">Aucun équipement pour AL2</p>
            )}

            <div className="space-y-2">
              {(activeTab === "al1" ? equipmentAL1 : equipmentAL2).map((item) => (
                <div
                  key={item.id}
                  onClick={() => cycleResult(item)}
                  className={`p-3 border rounded-lg cursor-pointer transition-all active:scale-[0.99] ${getResultColor(item.result)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 bg-gray-200 rounded text-gray-600">
                          {getEquipmentTypeLabel(item.equipment_type)}
                        </span>
                        <span className="font-medium text-sm truncate">{item.equipment_code}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {item.equipment_name} {item.location && `- ${item.location}`}
                      </p>
                      {item.external_system && (
                        <p className="text-xs text-blue-500 mt-0.5">
                          Lié: {item.external_system === 'doors' ? '🚪 Porte' : item.external_system === 'switchboard' ? '⚡ Tableau' : '📦 Équipement'}
                        </p>
                      )}
                      {item.position && (
                        <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          Position sur plan disponible
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      {item.result === "ok" && <CheckCircle2 className="w-6 h-6 text-green-500" />}
                      {item.result === "nok" && <XCircle className="w-6 h-6 text-red-500" />}
                      {item.result === "na" && <span className="text-xs font-medium text-gray-500">N/A</span>}
                      {item.result === "pending" && (
                        <div className="w-6 h-6 border-2 border-dashed border-gray-300 rounded-full" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-gray-400 mt-2 text-center">
            Appuyez sur un équipement pour changer: - → OK → NOK → N/A
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes / Observations
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="Ajoutez vos observations..."
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-gray-700 border rounded-lg hover:bg-gray-50 text-sm"
          >
            Fermer
          </button>
          {onViewMap && (equipmentAL1.some(e => e.position) || equipmentAL2.some(e => e.position)) && (
            <button
              type="button"
              onClick={() => onViewMap(zoneCheck.id)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 text-sm"
            >
              <MapPin className="w-4 h-4" />
              <span className="hidden sm:inline">Voir sur plan</span>
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Schedule Modal
function ScheduleModal({ campaigns, buildings, onSave, onClose }) {
  const [form, setForm] = useState({
    building: "",
    scheduled_date: "",
    campaign_id: "",
    assigned_to: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Planifier un contrôle" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bâtiment *
          </label>
          <select
            value={form.building}
            onChange={(e) => setForm({ ...form, building: e.target.value })}
            required
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Sélectionner...</option>
            {buildings.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date prévue *
          </label>
          <input
            type="date"
            required
            value={form.scheduled_date}
            onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Campagne associée
          </label>
          <select
            value={form.campaign_id}
            onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Aucune</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Assigné à
          </label>
          <input
            type="text"
            value={form.assigned_to}
            onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
            placeholder="Nom de la personne responsable"
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Planifier
          </button>
        </div>
      </form>
    </Modal>
  );
}

// =============================================================================
// EQUIPMENT MATCHING MODAL - Résolution des doutes sur les équipements
// =============================================================================
function EquipmentMatchingModal({ uncertainMatches, context, onConfirm, onSkip, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [processing, setProcessing] = useState(false);

  const currentMatch = uncertainMatches[currentIndex];
  const progress = uncertainMatches.length > 0 ? ((currentIndex + 1) / uncertainMatches.length) * 100 : 0;

  if (!currentMatch) return null;

  const handleConfirmBestMatch = async () => {
    if (!currentMatch.best_match) return;
    setProcessing(true);
    try {
      await onConfirm(currentMatch, currentMatch.best_match);
      if (currentIndex < uncertainMatches.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setShowAlternatives(false);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSelectAlternative = async (equipment) => {
    setProcessing(true);
    try {
      await onConfirm(currentMatch, equipment);
      setShowAlternatives(false);
      if (currentIndex < uncertainMatches.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = () => {
    onSkip(currentMatch);
    if (currentIndex < uncertainMatches.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowAlternatives(false);
    }
  };

  const getSourceSystemLabel = (system) => {
    const labels = {
      doors: "Portes (Doors)",
      switchboard: "Tableau Électrique",
      datahub: "DataHub",
    };
    return labels[system] || system;
  };

  const getSourceSystemColor = (system) => {
    const colors = {
      doors: "bg-purple-100 text-purple-700",
      switchboard: "bg-blue-100 text-blue-700",
      datahub: "bg-green-100 text-green-700",
    };
    return colors[system] || "bg-gray-100 text-gray-700";
  };

  return (
    <Modal title="Résolution des équipements" onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
            <span>Équipement {currentIndex + 1} sur {uncertainMatches.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <HelpCircle className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-yellow-800 mb-2">
                {currentMatch.question || "J'ai un doute sur cet équipement"}
              </h4>
              <div className="bg-white rounded-lg p-3 border border-yellow-200">
                <p className="text-sm font-medium text-gray-900">
                  Code matrice: <span className="font-bold text-orange-600">{currentMatch.matrix_equipment?.code}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Nom: {currentMatch.matrix_equipment?.name || "-"}
                </p>
                {currentMatch.matrix_equipment?.building && (
                  <p className="text-sm text-gray-600">
                    Bâtiment: {currentMatch.matrix_equipment.building}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Best match suggestion */}
        {currentMatch.best_match && (
          <div className="bg-white border-2 border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ThumbsUp className="w-5 h-5 text-green-600" />
              <h4 className="font-semibold text-green-800">
                Meilleure correspondance ({currentMatch.best_match.score}% de confiance)
              </h4>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${getSourceSystemColor(currentMatch.best_match.source_system)}`}>
                    {getSourceSystemLabel(currentMatch.best_match.source_system)}
                  </span>
                  <span className="text-xs text-gray-500">
                    ID: {currentMatch.best_match.id?.substring(0, 8)}...
                  </span>
                </div>
                <p className="font-medium text-gray-900">
                  {currentMatch.best_match.code || currentMatch.best_match.name}
                </p>
                {currentMatch.best_match.name && currentMatch.best_match.code && (
                  <p className="text-sm text-gray-600">{currentMatch.best_match.name}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                  {currentMatch.best_match.building && (
                    <span className="flex items-center gap-1">
                      <Building className="w-3 h-3" />
                      {currentMatch.best_match.building}
                    </span>
                  )}
                  {currentMatch.best_match.floor && (
                    <span>Étage: {currentMatch.best_match.floor}</span>
                  )}
                  {currentMatch.best_match.location && (
                    <span>📍 {currentMatch.best_match.location}</span>
                  )}
                </div>
              </div>

              <button
                onClick={handleConfirmBestMatch}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {processing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Oui, c'est lui
              </button>
            </div>
          </div>
        )}

        {/* Alternatives toggle */}
        {currentMatch.alternatives && currentMatch.alternatives.length > 0 && (
          <div>
            <button
              onClick={() => setShowAlternatives(!showAlternatives)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${showAlternatives ? "rotate-90" : ""}`} />
              <ListChecks className="w-4 h-4" />
              Voir {currentMatch.alternatives.length} autre(s) suggestion(s)
            </button>

            {showAlternatives && (
              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                {currentMatch.alternatives.map((alt, idx) => (
                  <div
                    key={alt.id || idx}
                    className="flex items-center justify-between p-3 border rounded-lg hover:border-orange-300 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getSourceSystemColor(alt.source_system)}`}>
                          {getSourceSystemLabel(alt.source_system)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {alt.score}%
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate">{alt.code || alt.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {alt.building} {alt.floor && `- ${alt.floor}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSelectAlternative(alt)}
                      disabled={processing}
                      className="ml-2 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 rounded-lg transition-colors"
                    >
                      Choisir
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <button
            onClick={handleSkip}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ThumbsDown className="w-4 h-4" />
            <span className="hidden sm:inline">Ce n'est pas dans la liste</span>
            <span className="sm:hidden">Passer</span>
          </button>

          <div className="flex gap-2">
            {currentIndex > 0 && (
              <button
                onClick={() => {
                  setCurrentIndex(prev => prev - 1);
                  setShowAlternatives(false);
                }}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Précédent
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// UI COMPONENTS
// =============================================================================

function Modal({ title, children, onClose, size = "md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50">
      <div
        className={`bg-white w-full rounded-t-xl sm:rounded-xl shadow-xl ${
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
        } max-h-[90vh] sm:max-h-[85vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0">
          <h3 className="text-base sm:text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, labelFull, value, color = "gray", subtext }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    red: "bg-red-50 text-red-600",
    yellow: "bg-yellow-50 text-yellow-600",
    orange: "bg-orange-50 text-orange-600",
    gray: "bg-gray-50 text-gray-600",
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-3 sm:p-6">
      <div className="flex items-center gap-2 sm:gap-4">
        <div className={`p-2 sm:p-3 rounded-lg ${colors[color]}`}>
          <Icon className="w-4 h-4 sm:w-6 sm:h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm text-gray-500 truncate">
            <span className="sm:hidden">{label}</span>
            <span className="hidden sm:inline">{labelFull || label}</span>
          </p>
          <p className="text-lg sm:text-2xl font-bold">{value}</p>
          {subtext && <p className="text-xs sm:text-sm text-gray-400">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    planned: { label: "Planifié", class: "bg-gray-100 text-gray-700" },
    in_progress: { label: "En cours", class: "bg-yellow-100 text-yellow-700" },
    completed: { label: "Terminé", class: "bg-green-100 text-green-700" },
    cancelled: { label: "Annulé", class: "bg-red-100 text-red-700" },
    scheduled: { label: "Planifié", class: "bg-blue-100 text-blue-700" },
  };

  const cfg = config[status] || config.planned;

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

function CheckStatusBadge({ status }) {
  const config = {
    pending: { label: "En attente", class: "bg-gray-100 text-gray-700" },
    in_progress: { label: "En cours", class: "bg-blue-100 text-blue-700" },
    passed: { label: "Conforme", class: "bg-green-100 text-green-700" },
    failed: { label: "Non-conforme", class: "bg-red-100 text-red-700" },
    partial: { label: "Partiel", class: "bg-yellow-100 text-yellow-700" },
  };

  const cfg = config[status] || config.pending;

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${cfg.class}`}>
      {cfg.label}
    </span>
  );
}

// =============================================================================
// EQUIPMENT MATCHING TAB
// =============================================================================
function EquipmentMatchingTab({ matrices, zones, showToast, onRefresh }) {
  const [selectedMatrix, setSelectedMatrix] = useState(null);
  const [matrixEquipment, setMatrixEquipment] = useState([]);
  const [matchResults, setMatchResults] = useState([]);
  const [crossSystemEquipment, setCrossSystemEquipment] = useState([]);
  const [loading, setLoading] = useState(false);
  const [matchingInProgress, setMatchingInProgress] = useState(false);
  const [filter, setFilter] = useState("all"); // all, matched, unmatched

  // Load matrix equipment when matrix is selected
  useEffect(() => {
    if (selectedMatrix) {
      loadMatrixEquipment(selectedMatrix);
    }
  }, [selectedMatrix]);

  // Load cross-system equipment on mount
  useEffect(() => {
    loadCrossSystemEquipment();
  }, []);

  const loadMatrixEquipment = async (matrixId) => {
    setLoading(true);
    try {
      const data = await api.fireControl.getMatrixEquipment(matrixId);
      setMatrixEquipment(data.equipment || []);
    } catch (err) {
      showToast("Erreur chargement équipements: " + err.message, "error");
    }
    setLoading(false);
  };

  const loadCrossSystemEquipment = async () => {
    try {
      const data = await api.fireControlMaps.crossSystemEquipment({});
      setCrossSystemEquipment(data.equipment || []);
    } catch (err) {
      console.warn("Erreur chargement équipements cross-système:", err.message);
    }
  };

  const handleAutoMatch = async () => {
    if (!matrixEquipment.length) {
      showToast("Aucun équipement à matcher", "error");
      return;
    }

    setMatchingInProgress(true);
    try {
      const result = await api.fireControlMaps.autoMatchEquipment(matrixEquipment);
      setMatchResults(result.matches || []);
      showToast(`${result.matches?.length || 0} équipements analysés`, "success");
    } catch (err) {
      showToast("Erreur matching: " + err.message, "error");
    }
    setMatchingInProgress(false);
  };

  const handleConfirmMatch = async (matrixEqCode, match) => {
    try {
      await api.fireControlMaps.confirmEquipmentMatch({
        source_system: match.source_system,
        equipment_id: match.candidate_id || match.id,
        fire_interlock_code: matrixEqCode,
        zone_id: null,
        alarm_level: 1
      });
      showToast(`${match.candidate_name || match.name} lié à ${matrixEqCode}`, "success");
      loadCrossSystemEquipment();
      // Update match results to show as confirmed
      setMatchResults(prev => prev.map(r =>
        r.matrix_equipment.code === matrixEqCode
          ? { ...r, confirmed: true, confirmed_match: match }
          : r
      ));
    } catch (err) {
      showToast("Erreur: " + err.message, "error");
    }
  };

  const filteredResults = useMemo(() => {
    if (!matchResults.length) return [];
    if (filter === "all") return matchResults;
    if (filter === "matched") return matchResults.filter(r => r.best_match?.score >= 85 || r.confirmed);
    if (filter === "unmatched") return matchResults.filter(r => !r.best_match || r.best_match.score < 50);
    return matchResults;
  }, [matchResults, filter]);

  const stats = useMemo(() => {
    if (!matchResults.length) return { total: 0, confident: 0, uncertain: 0, noMatch: 0 };
    return {
      total: matchResults.length,
      confident: matchResults.filter(r => r.best_match?.score >= 85 || r.confirmed).length,
      uncertain: matchResults.filter(r => r.best_match && r.best_match.score >= 50 && r.best_match.score < 85).length,
      noMatch: matchResults.filter(r => !r.best_match || r.best_match.score < 50).length,
    };
  }, [matchResults]);

  const sourceIcons = {
    doors: "🚪",
    switchboard: "⚡",
    datahub: "📦",
  };

  const sourceLabels = {
    doors: "Porte",
    switchboard: "Tableau",
    datahub: "Équipement",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Link2 className="w-5 h-5 text-orange-500" />
              Association des équipements
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Liez les équipements de la matrice aux équipements existants (Portes, Tableaux, Datahub)
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={selectedMatrix || ""}
              onChange={(e) => setSelectedMatrix(e.target.value || null)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">Sélectionner une matrice...</option>
              {matrices.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <button
              onClick={handleAutoMatch}
              disabled={!selectedMatrix || matchingInProgress || loading}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {matchingInProgress ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Auto-matcher
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {matchResults.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4 text-center cursor-pointer hover:bg-green-50" onClick={() => setFilter("matched")}>
            <div className="text-2xl font-bold text-green-600">{stats.confident}</div>
            <div className="text-sm text-gray-500">Correspondances</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">{stats.uncertain}</div>
            <div className="text-sm text-gray-500">Incertains</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-4 text-center cursor-pointer hover:bg-red-50" onClick={() => setFilter("unmatched")}>
            <div className="text-2xl font-bold text-red-600">{stats.noMatch}</div>
            <div className="text-sm text-gray-500">Sans correspondance</div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {matchResults.length > 0 && (
        <div className="flex gap-2">
          {[
            { id: "all", label: "Tous" },
            { id: "matched", label: "Correspondances" },
            { id: "unmatched", label: "Sans correspondance" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                filter === f.id
                  ? "bg-orange-100 text-orange-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Results list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      ) : matchResults.length > 0 ? (
        <div className="space-y-3">
          {filteredResults.map((result, idx) => (
            <EquipmentMatchCard
              key={idx}
              result={result}
              sourceIcons={sourceIcons}
              sourceLabels={sourceLabels}
              onConfirm={handleConfirmMatch}
            />
          ))}
        </div>
      ) : selectedMatrix && matrixEquipment.length > 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
          <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {matrixEquipment.length} équipements trouvés
          </h3>
          <p className="text-gray-500 mb-4">
            Cliquez sur "Auto-matcher" pour trouver les correspondances avec vos équipements existants
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
          <Link2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Sélectionnez une matrice
          </h3>
          <p className="text-gray-500">
            Choisissez une matrice pour voir les équipements à associer
          </p>
        </div>
      )}

      {/* Cross-system equipment summary */}
      {crossSystemEquipment.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Équipements déjà liés ({crossSystemEquipment.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {crossSystemEquipment.slice(0, 10).map((eq) => (
              <span key={`${eq.source_system}-${eq.id}`} className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-sm">
                <span>{sourceIcons[eq.source_system]}</span>
                {eq.name}
              </span>
            ))}
            {crossSystemEquipment.length > 10 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-sm">
                +{crossSystemEquipment.length - 10} autres
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Equipment match card component
function EquipmentMatchCard({ result, sourceIcons, sourceLabels, onConfirm }) {
  const [expanded, setExpanded] = useState(false);
  const { matrix_equipment, best_match, alternatives, confirmed, confirmed_match } = result;

  const getScoreColor = (score) => {
    if (score >= 85) return "text-green-600 bg-green-100";
    if (score >= 50) return "text-yellow-600 bg-yellow-100";
    return "text-red-600 bg-red-100";
  };

  const getScoreLabel = (score) => {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Bon";
    if (score >= 50) return "Possible";
    return "Faible";
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-4 ${confirmed ? 'border-green-300 bg-green-50/30' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        {/* Matrix equipment info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded">{matrix_equipment.code}</span>
            <span className="font-medium text-gray-900 truncate">{matrix_equipment.name}</span>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {matrix_equipment.type && <span className="capitalize">{matrix_equipment.type}</span>}
            {matrix_equipment.building && <span> • {matrix_equipment.building}</span>}
            {matrix_equipment.floor && <span> • {matrix_equipment.floor}</span>}
          </div>
        </div>

        {/* Match status */}
        <div className="flex items-center gap-2">
          {confirmed ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">Lié à {confirmed_match?.name}</span>
            </div>
          ) : best_match ? (
            <>
              <span className={`px-2 py-1 rounded text-xs font-medium ${getScoreColor(best_match.score)}`}>
                {best_match.score}% - {getScoreLabel(best_match.score)}
              </span>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">
              Aucune correspondance
            </span>
          )}
        </div>
      </div>

      {/* Best match suggestion */}
      {best_match && !confirmed && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{sourceIcons[best_match.source_system]}</span>
              <div>
                <div className="font-medium text-gray-900">
                  {best_match.candidate_code || best_match.candidate_name || best_match.name}
                </div>
                <div className="text-sm text-gray-500">
                  {sourceLabels[best_match.source_system]}
                  {best_match.candidate_building && ` • ${best_match.candidate_building}`}
                  {best_match.candidate_location && ` • ${best_match.candidate_location}`}
                </div>
                {/* Match reasons */}
                {best_match.match_reasons && best_match.match_reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {best_match.match_reasons.map((reason, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => onConfirm(matrix_equipment.code, best_match)}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm"
            >
              <Check className="w-4 h-4" />
              Confirmer
            </button>
          </div>
        </div>
      )}

      {/* Alternatives */}
      {expanded && alternatives && alternatives.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-sm font-medium text-gray-700">Autres correspondances possibles:</div>
          {alternatives.map((alt, idx) => (
            <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span>{sourceIcons[alt.source_system]}</span>
                  <span className="text-sm text-gray-900 truncate">
                    {alt.candidate_code || alt.candidate_name}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({sourceLabels[alt.source_system]})
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${getScoreColor(alt.score)}`}>
                    {alt.score}%
                  </span>
                </div>
                {alt.match_reasons && alt.match_reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 ml-6">
                    {alt.match_reasons.slice(0, 3).map((reason, i) => (
                      <span key={i} className="px-1 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => onConfirm(matrix_equipment.code, alt)}
                className="text-xs text-orange-600 hover:text-orange-700 font-medium ml-2"
              >
                Sélectionner
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
