// src/pages/FireControl.jsx
// Fire Control - Contrôle des asservissements incendie
// VERSION 1.0

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
} from "lucide-react";

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export default function FireControl() {
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
  const [detectors, setDetectors] = useState([]);
  const [checks, setChecks] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [buildings, setBuildings] = useState([]);

  // Filter states
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [selectedFloor, setSelectedFloor] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showUploadMatrixModal, setShowUploadMatrixModal] = useState(false);
  const [showUploadPlanModal, setShowUploadPlanModal] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [selectedDetector, setSelectedDetector] = useState(null);

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
      const data = await api.fireControl.listPlans({ active_only: "true" });
      setPlans(data || []);
    } catch (err) {
      console.error("Failed to load plans:", err);
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

  const loadDetectors = useCallback(async () => {
    try {
      const params = {};
      if (selectedBuilding) params.building = selectedBuilding;
      if (selectedFloor) params.floor = selectedFloor;
      const data = await api.fireControl.listDetectors(params);
      setDetectors(data || []);
    } catch (err) {
      console.error("Failed to load detectors:", err);
    }
  }, [selectedBuilding, selectedFloor]);

  const loadChecks = useCallback(async () => {
    try {
      const params = {};
      if (selectedCampaign) params.campaign_id = selectedCampaign;
      if (selectedBuilding) params.building = selectedBuilding;
      if (selectedFloor) params.floor = selectedFloor;
      const data = await api.fireControl.listChecks(params);
      setChecks(data || []);
    } catch (err) {
      console.error("Failed to load checks:", err);
    }
  }, [selectedCampaign, selectedBuilding, selectedFloor]);

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
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadDashboard, loadCampaigns, loadMatrices, loadPlans, loadBuildings]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (activeTab === "controls") {
      loadDetectors();
      loadChecks();
    } else if (activeTab === "schedule") {
      loadSchedule();
    }
  }, [activeTab, loadDetectors, loadChecks, loadSchedule]);

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

  const handleUploadPlan = async (file, extra) => {
    try {
      await api.fireControl.uploadPlan(file, extra);
      showToast("Plan uploadé");
      setShowUploadPlanModal(false);
      loadPlans();
      loadBuildings();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleGenerateChecks = async (campaignId) => {
    try {
      const result = await api.fireControl.generateChecks(campaignId, {
        building: selectedBuilding || undefined,
        floor: selectedFloor || undefined,
      });
      showToast(`${result.created_count} contrôles générés`);
      loadChecks();
      loadDashboard();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleUpdateCheck = async (checkId, data) => {
    try {
      await api.fireControl.updateCheck(checkId, data);
      showToast("Contrôle mis à jour");
      loadChecks();
      loadDashboard();
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

  // =============================================================================
  // COMPUTED VALUES
  // =============================================================================
  const filteredChecks = useMemo(() => {
    if (!searchQuery) return checks;
    const q = searchQuery.toLowerCase();
    return checks.filter(
      (c) =>
        c.detector_number?.toLowerCase().includes(q) ||
        c.building?.toLowerCase().includes(q) ||
        c.floor?.toLowerCase().includes(q) ||
        c.zone?.toLowerCase().includes(q)
    );
  }, [checks, searchQuery]);

  const checkStats = useMemo(() => {
    const total = checks.length;
    const passed = checks.filter((c) => c.status === "passed").length;
    const failed = checks.filter((c) => c.status === "failed").length;
    const pending = checks.filter((c) => c.status === "pending").length;
    const partial = checks.filter((c) => c.status === "partial").length;
    return { total, passed, failed, pending, partial };
  }, [checks]);

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
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Flame className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Contrôle Asservissements Incendie
                </h1>
                <p className="text-sm text-gray-500">
                  Gestion des tests d'alarmes et asservissements
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Year selector */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-3 py-2 border rounded-lg text-sm"
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <button
                onClick={loadAll}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                title="Actualiser"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto">
            {[
              { id: "dashboard", label: "Tableau de bord", icon: BarChart3 },
              { id: "campaigns", label: "Campagnes", icon: Calendar },
              { id: "documents", label: "Documents", icon: FileText },
              { id: "controls", label: "Contrôles", icon: ClipboardCheck },
              { id: "schedule", label: "Calendrier", icon: CalendarDays },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-orange-50 text-orange-700 border-b-2 border-orange-500"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
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
                onUploadPlan={() => setShowUploadPlanModal(true)}
                onRefresh={() => {
                  loadMatrices();
                  loadPlans();
                }}
              />
            )}

            {activeTab === "controls" && (
              <ControlsTab
                checks={filteredChecks}
                checkStats={checkStats}
                campaigns={campaigns}
                selectedCampaign={selectedCampaign}
                onSelectCampaign={setSelectedCampaign}
                selectedBuilding={selectedBuilding}
                onSelectBuilding={setSelectedBuilding}
                selectedFloor={selectedFloor}
                onSelectFloor={setSelectedFloor}
                buildingOptions={buildingOptions}
                floorOptions={floorOptions}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onUpdateCheck={handleUpdateCheck}
                onSelectCheck={(c) => {
                  setSelectedCheck(c);
                  setShowCheckModal(true);
                }}
                onRefresh={loadChecks}
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

      {showUploadPlanModal && (
        <UploadPlanModal
          buildings={buildingOptions}
          onUpload={handleUploadPlan}
          onClose={() => setShowUploadPlanModal(false)}
        />
      )}

      {showCheckModal && selectedCheck && (
        <CheckModal
          check={selectedCheck}
          onSave={(data) => {
            handleUpdateCheck(selectedCheck.id, data);
            setShowCheckModal(false);
          }}
          onClose={() => {
            setShowCheckModal(false);
            setSelectedCheck(null);
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
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={ClipboardCheck}
          label="Total Contrôles"
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
          label="Non-conformes"
          value={checks?.failed || 0}
          color="red"
        />
        <StatCard
          icon={Clock}
          label="En attente"
          value={checks?.pending || 0}
          color="yellow"
        />
      </div>

      {/* Buildings overview */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-gray-500" />
          Vue par bâtiment
        </h3>
        {buildings && buildings.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {buildings.map((bld) => (
              <div
                key={bld.building}
                className="p-4 border rounded-lg hover:border-orange-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{bld.building || "Non défini"}</span>
                  <span className="text-sm text-gray-500">
                    {bld.detector_count} détecteurs
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
          <p className="text-gray-500 text-center py-8">
            Aucun bâtiment configuré. Uploadez des plans pour commencer.
          </p>
        )}
      </div>

      {/* Active campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-500" />
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
            <p className="text-gray-500 text-center py-8">
              Aucune campagne active
            </p>
          )}
        </div>

        {/* Upcoming schedule */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-gray-500" />
            Prochains contrôles planifiés
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
            <p className="text-gray-500 text-center py-8">
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Campagnes de contrôle</h2>
        <button
          onClick={onCreateCampaign}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Nouvelle campagne
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <Calendar className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Aucune campagne
          </h3>
          <p className="text-gray-500 mb-4">
            Créez une campagne de contrôle annuelle pour commencer
          </p>
          <button
            onClick={onCreateCampaign}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            Créer une campagne
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="bg-white rounded-xl shadow-sm border p-6 hover:border-orange-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
                  <p className="text-sm text-gray-500">Année {campaign.year}</p>
                </div>
                <StatusBadge status={campaign.status} />
              </div>

              {campaign.start_date && (
                <p className="text-sm text-gray-600 mb-3">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  {dayjs(campaign.start_date).format("DD/MM/YYYY")}
                  {campaign.end_date &&
                    ` - ${dayjs(campaign.end_date).format("DD/MM/YYYY")}`}
                </p>
              )}

              {campaign.notes && (
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                  {campaign.notes}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
                <button
                  onClick={() => onSelectCampaign(campaign)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  <Eye className="w-4 h-4" />
                  Voir
                </button>
                <button
                  onClick={() => onGenerateChecks(campaign.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg"
                >
                  <Play className="w-4 h-4" />
                  Générer
                </button>
                <button
                  onClick={() => onGenerateReport(campaign.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  Rapport
                </button>
                <button
                  onClick={() => onEditCampaign(campaign)}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDeleteCampaign(campaign.id)}
                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-4 h-4" />
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
function DocumentsTab({ matrices, plans, onUploadMatrix, onUploadPlan, onRefresh }) {
  return (
    <div className="space-y-6">
      {/* Matrices */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-gray-500" />
            Matrices d'asservissement
          </h3>
          <button
            onClick={onUploadMatrix}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Upload className="w-4 h-4" />
            Uploader
          </button>
        </div>

        {matrices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileSpreadsheet className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>Aucune matrice uploadée</p>
            <p className="text-sm">Uploadez votre matrice d'asservissement PDF</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matrices.map((matrix) => (
              <div
                key={matrix.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:border-orange-300"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-orange-500" />
                  <div>
                    <p className="font-medium">{matrix.name}</p>
                    <p className="text-sm text-gray-500">
                      Version {matrix.version} -{" "}
                      {dayjs(matrix.upload_date).format("DD/MM/YYYY")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={api.fireControl.matrixFileUrl(matrix.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  >
                    <Eye className="w-5 h-5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plans */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Map className="w-5 h-5 text-gray-500" />
            Plans de bâtiments
          </h3>
          <button
            onClick={onUploadPlan}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Upload className="w-4 h-4" />
            Uploader
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Map className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>Aucun plan uploadé</p>
            <p className="text-sm">Uploadez vos plans de bâtiments PDF</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="p-4 border rounded-lg hover:border-orange-300"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-gray-500">
                      {plan.building} {plan.floor && `- ${plan.floor}`}
                    </p>
                  </div>
                  <a
                    href={api.fireControl.planFileUrl(plan.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  >
                    <Eye className="w-5 h-5" />
                  </a>
                </div>
                <p className="text-xs text-gray-400">
                  {plan.page_count} page(s) - v{plan.version}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CONTROLS TAB
// =============================================================================
function ControlsTab({
  checks,
  checkStats,
  campaigns,
  selectedCampaign,
  onSelectCampaign,
  selectedBuilding,
  onSelectBuilding,
  selectedFloor,
  onSelectFloor,
  buildingOptions,
  floorOptions,
  searchQuery,
  onSearchChange,
  onUpdateCheck,
  onSelectCheck,
  onRefresh,
}) {
  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un détecteur..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          <select
            value={selectedCampaign || ""}
            onChange={(e) => onSelectCampaign(e.target.value || null)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">Toutes les campagnes</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={selectedBuilding}
            onChange={(e) => {
              onSelectBuilding(e.target.value);
              onSelectFloor("");
            }}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">Tous les bâtiments</option>
            {buildingOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          {selectedBuilding && floorOptions.length > 0 && (
            <select
              value={selectedFloor}
              onChange={(e) => onSelectFloor(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">Tous les étages</option>
              {floorOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={onRefresh}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
          <span className="text-gray-600">Total:</span>
          <span className="font-semibold">{checkStats.total}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-lg text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="font-semibold text-green-700">{checkStats.passed}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 rounded-lg text-sm">
          <XCircle className="w-4 h-4 text-red-600" />
          <span className="font-semibold text-red-700">{checkStats.failed}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 rounded-lg text-sm">
          <Clock className="w-4 h-4 text-yellow-600" />
          <span className="font-semibold text-yellow-700">{checkStats.pending}</span>
        </div>
      </div>

      {/* Checks list */}
      {checks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <ClipboardCheck className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Aucun contrôle
          </h3>
          <p className="text-gray-500">
            Sélectionnez une campagne et générez les contrôles
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Détecteur
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                  Localisation
                </th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                  Alarme 1
                </th>
                <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                  Alarme 2
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
              {checks.map((check) => (
                <tr
                  key={check.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectCheck(check)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CircleDot className="w-4 h-4 text-orange-500" />
                      <span className="font-medium">{check.detector_number}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <p>{check.building}</p>
                      <p className="text-gray-500">
                        {check.floor} {check.zone && `- ${check.zone}`}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {check.alarm1_ok === true && (
                      <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                    )}
                    {check.alarm1_ok === false && (
                      <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                    )}
                    {check.alarm1_ok === null && (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {check.alarm2_ok === true && (
                      <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                    )}
                    {check.alarm2_ok === false && (
                      <XCircle className="w-5 h-5 text-red-500 mx-auto" />
                    )}
                    {check.alarm2_ok === null && (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <CheckStatusBadge status={check.status} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCheck(check);
                      }}
                      className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Calendrier des contrôles</h2>
        <button
          onClick={onCreateSchedule}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Planifier
        </button>
      </div>

      {schedule.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <CalendarDays className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Aucune planification
          </h3>
          <p className="text-gray-500 mb-4">
            Planifiez vos contrôles annuels par bâtiment
          </p>
          <button
            onClick={onCreateSchedule}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            Créer une planification
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedSchedule)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, items]) => (
              <div key={month} className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-4">
                  {dayjs(month).format("MMMM YYYY")}
                </h3>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`p-2 rounded-lg ${
                            item.status === "completed"
                              ? "bg-green-100"
                              : item.status === "in_progress"
                              ? "bg-yellow-100"
                              : "bg-gray-100"
                          }`}
                        >
                          <Building2
                            className={`w-5 h-5 ${
                              item.status === "completed"
                                ? "text-green-600"
                                : item.status === "in_progress"
                                ? "text-yellow-600"
                                : "text-gray-500"
                            }`}
                          />
                        </div>
                        <div>
                          <p className="font-medium">{item.building}</p>
                          {item.campaign_name && (
                            <p className="text-sm text-gray-500">
                              {item.campaign_name}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">
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
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Année
            </label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="planned">Planifié</option>
              <option value="in_progress">En cours</option>
              <option value="completed">Terminé</option>
              <option value="cancelled">Annulé</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date de début
            </label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date de fin
            </label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
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

// Check Modal (for recording test results)
function CheckModal({ check, onSave, onClose }) {
  const [form, setForm] = useState({
    alarm1_ok: check.alarm1_ok,
    alarm2_ok: check.alarm2_ok,
    notes: check.notes || "",
    interlocks_checked: check.interlocks_checked || [],
  });
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

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
    <Modal title={`Contrôle - Détecteur ${check.detector_number}`} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Detector info */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Bâtiment:</span>{" "}
              <span className="font-medium">{check.building || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Étage:</span>{" "}
              <span className="font-medium">{check.floor || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Zone:</span>{" "}
              <span className="font-medium">{check.zone || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Accès:</span>{" "}
              <span className="font-medium">{check.access_point || "-"}</span>
            </div>
          </div>
        </div>

        {/* Alarm tests */}
        <div>
          <h4 className="font-medium mb-3">Résultats des tests</h4>
          <div className="grid grid-cols-2 gap-4">
            <div
              onClick={() => toggleAlarm("alarm1_ok")}
              className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                form.alarm1_ok === true
                  ? "border-green-500 bg-green-50"
                  : form.alarm1_ok === false
                  ? "border-red-500 bg-red-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Alarme 1</span>
                {form.alarm1_ok === true && (
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                )}
                {form.alarm1_ok === false && (
                  <XCircle className="w-6 h-6 text-red-500" />
                )}
                {form.alarm1_ok === null && (
                  <span className="text-sm text-gray-400">Non testé</span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Cliquez pour changer: OK → NOK → Non testé
              </p>
            </div>

            <div
              onClick={() => toggleAlarm("alarm2_ok")}
              className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                form.alarm2_ok === true
                  ? "border-green-500 bg-green-50"
                  : form.alarm2_ok === false
                  ? "border-red-500 bg-red-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Alarme 2</span>
                {form.alarm2_ok === true && (
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                )}
                {form.alarm2_ok === false && (
                  <XCircle className="w-6 h-6 text-red-500" />
                )}
                {form.alarm2_ok === null && (
                  <span className="text-sm text-gray-400">Non testé</span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Cliquez pour changer: OK → NOK → Non testé
              </p>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes / Observations
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            placeholder="Ajoutez vos observations..."
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>

        {/* Photos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Photos
          </label>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative">
                <img
                  src={URL.createObjectURL(f)}
                  alt=""
                  className="w-20 h-20 object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center hover:border-orange-300"
            >
              <Camera className="w-6 h-6 text-gray-400" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const newFiles = Array.from(e.target.files || []);
                setFiles([...files, ...newFiles]);
              }}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
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
// UI COMPONENTS
// =============================================================================

function Modal({ title, children, onClose, size = "md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${
          size === "lg" ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = "gray", subtext }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    red: "bg-red-50 text-red-600",
    yellow: "bg-yellow-50 text-yellow-600",
    orange: "bg-orange-50 text-orange-600",
    gray: "bg-gray-50 text-gray-600",
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {subtext && <p className="text-sm text-gray-400">{subtext}</p>}
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
