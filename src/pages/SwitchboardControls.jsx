// src/pages/SwitchboardControls.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";

// ============================================================
// ANIMATIONS CSS
// ============================================================
const styles = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.animate-slideUp { animation: slideUp 0.4s ease-out; }
.animate-fadeIn { animation: fadeIn 0.3s ease-out; }
.animate-pulse-slow { animation: pulse 2s ease-in-out infinite; }
.animate-bounce-slow { animation: bounce 1.5s ease-in-out infinite; }
.gradient-animate {
  background-size: 200% 200%;
  animation: gradient 3s ease infinite;
}
`;

// Inject styles
if (typeof document !== 'undefined' && !document.getElementById('control-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'control-styles';
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

// ============================================================
// ANIMATED CARD COMPONENT
// ============================================================
const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// ============================================================
// STAT CARD WITH ANIMATION
// ============================================================
const StatCard = ({ icon, label, value, color, delay, onClick }) => (
  <AnimatedCard delay={delay}>
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 cursor-pointer group ${onClick ? 'hover:scale-[1.02]' : ''}`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-xl ${color} group-hover:scale-110 transition-transform`}>
          <span className="text-xl sm:text-2xl">{icon}</span>
        </div>
        <div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{value}</p>
          <p className="text-xs sm:text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  </AnimatedCard>
);

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function SwitchboardControls() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "dashboard");

  // Data states
  const [dashboard, setDashboard] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [records, setRecords] = useState([]);
  const [switchboards, setSwitchboards] = useState([]);

  // Loading states
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showControlModal, setShowControlModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // Pre-selected board for schedule modal (from URL param newBoard)
  const [preSelectedBoardId, setPreSelectedBoardId] = useState(null);

  // Load data
  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.switchboardControls.dashboard();
      setDashboard(res);
    } catch (e) {
      console.error("Dashboard error:", e);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listTemplates();
      setTemplates(res.templates || []);
    } catch (e) {
      console.error("Templates error:", e);
    }
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules();
      setSchedules(res.schedules || []);
    } catch (e) {
      console.error("Schedules error:", e);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listRecords({ limit: 100 });
      setRecords(res.records || []);
    } catch (e) {
      console.error("Records error:", e);
    }
  }, []);

  const loadSwitchboards = useCallback(async () => {
    try {
      const res = await api.switchboard.listBoards({ pageSize: 500 });
      setSwitchboards(res.data || []);
    } catch (e) {
      console.error("Switchboards error:", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadDashboard(),
      loadTemplates(),
      loadSchedules(),
      loadRecords(),
      loadSwitchboards(),
    ]).finally(() => setLoading(false));
  }, [loadDashboard, loadTemplates, loadSchedules, loadRecords, loadSwitchboards]);

  // Update URL when tab changes
  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  // Handle newBoard URL param - auto-open schedule modal
  useEffect(() => {
    const newBoardId = searchParams.get('newBoard');
    if (newBoardId && switchboards.length > 0) {
      setPreSelectedBoardId(Number(newBoardId));
      setShowScheduleModal(true);
      // Clear the URL param
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('newBoard');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, switchboards, setSearchParams]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin border-t-blue-600" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl">⚡</span>
          </div>
        </div>
        <p className="text-gray-500 animate-pulse">Chargement des contrôles...</p>
      </div>
    );
  }

  // Stats from dashboard API - structure: { stats: { pending, overdue, completed_30d, templates }, upcoming, overdue_list }
  const overdueCount = dashboard?.stats?.overdue || 0;
  const pendingCount = dashboard?.stats?.pending || 0;
  const completedCount = dashboard?.stats?.completed_30d || 0;

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      {/* Header - Responsive */}
      <AnimatedCard>
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-4 sm:p-6 text-white shadow-lg gradient-animate">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-white/20 rounded-xl sm:rounded-2xl backdrop-blur-sm">
                <span className="text-3xl sm:text-4xl">📋</span>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">Contrôles Électriques</h1>
                <p className="text-white/80 text-sm sm:text-base">Suivi et planification des contrôles</p>
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium backdrop-blur-sm transition-all text-sm sm:text-base flex items-center justify-center gap-2"
              >
                <span>📝</span>
                <span className="hidden sm:inline">Nouveau modèle</span>
                <span className="sm:hidden">Modèle</span>
              </button>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white text-orange-600 hover:bg-orange-50 rounded-xl font-medium transition-all text-sm sm:text-base flex items-center justify-center gap-2 animate-pulse-slow"
              >
                <span>➕</span>
                <span className="hidden sm:inline">Planifier contrôle</span>
                <span className="sm:hidden">Planifier</span>
              </button>
            </div>
          </div>
        </div>
      </AnimatedCard>

      {/* Stats Cards - Responsive Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon="⚠️"
          label="En retard"
          value={overdueCount}
          color={overdueCount > 0 ? "bg-red-100" : "bg-gray-100"}
          delay={100}
          onClick={() => setActiveTab("overdue")}
        />
        <StatCard
          icon="📅"
          label="Planifiés"
          value={pendingCount}
          color="bg-blue-100"
          delay={150}
          onClick={() => setActiveTab("schedules")}
        />
        <StatCard
          icon="✅"
          label="Effectués"
          value={completedCount}
          color="bg-green-100"
          delay={200}
          onClick={() => setActiveTab("history")}
        />
        <StatCard
          icon="📋"
          label="Modèles"
          value={templates.length}
          color="bg-purple-100"
          delay={250}
          onClick={() => setActiveTab("templates")}
        />
      </div>

      {/* Alert Banner for Overdue */}
      {overdueCount > 0 && (
        <AnimatedCard delay={300}>
          <div
            onClick={() => setActiveTab("overdue")}
            className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl animate-bounce-slow">🚨</span>
              <div>
                <p className="font-bold text-red-800">Attention ! {overdueCount} contrôle(s) en retard</p>
                <p className="text-red-600 text-sm">Cliquez pour voir les détails</p>
              </div>
            </div>
            <span className="text-2xl">→</span>
          </div>
        </AnimatedCard>
      )}

      {/* Tabs - Responsive scrollable */}
      <AnimatedCard delay={350}>
        <div className="flex gap-1 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { id: "dashboard", label: "📊 Tableau de bord", shortLabel: "📊" },
            { id: "schedules", label: `📅 Planifiés (${pendingCount})`, shortLabel: `📅 ${pendingCount}` },
            { id: "overdue", label: `⚠️ En retard (${overdueCount})`, shortLabel: `⚠️ ${overdueCount}`, alert: overdueCount > 0 },
            { id: "history", label: "📜 Historique", shortLabel: "📜" },
            { id: "templates", label: "📝 Modèles", shortLabel: "📝" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium transition-all whitespace-nowrap text-sm sm:text-base ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                  : tab.alert
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          ))}
        </div>
      </AnimatedCard>

      {/* Tab Content */}
      <AnimatedCard delay={400}>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {activeTab === "dashboard" && (
            <DashboardTab
              dashboard={dashboard}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
            />
          )}
          {activeTab === "schedules" && (
            <SchedulesTab
              schedules={schedules}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
              onDelete={async (id) => {
                if (confirm("Supprimer cette planification ?")) {
                  await api.switchboardControls.deleteSchedule(id);
                  loadSchedules();
                  loadDashboard();
                }
              }}
            />
          )}
          {activeTab === "overdue" && (
            <OverdueTab
              overdueList={dashboard?.overdue_list || []}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
            />
          )}
          {activeTab === "history" && (
            <HistoryTab records={records} navigate={navigate} />
          )}
          {activeTab === "templates" && (
            <TemplatesTab
              templates={templates}
              onEdit={(t) => { setEditingTemplate(t); setShowTemplateModal(true); }}
              onDelete={async (id) => {
                if (confirm("Supprimer ce modèle ?")) {
                  await api.switchboardControls.deleteTemplate(id);
                  loadTemplates();
                }
              }}
            />
          )}
        </div>
      </AnimatedCard>

      {/* Modals */}
      {showTemplateModal && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => { setShowTemplateModal(false); setEditingTemplate(null); }}
          onSave={async (data) => {
            if (editingTemplate) {
              await api.switchboardControls.updateTemplate(editingTemplate.id, data);
            } else {
              await api.switchboardControls.createTemplate(data);
            }
            loadTemplates();
            setShowTemplateModal(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleModal
          templates={templates}
          switchboards={switchboards}
          preSelectedBoardId={preSelectedBoardId}
          onClose={() => { setShowScheduleModal(false); setPreSelectedBoardId(null); }}
          onSave={async (data, shouldReload = true) => {
            await api.switchboardControls.createSchedule(data);
            // Only reload on last item to avoid too many requests
            if (shouldReload) {
              loadSchedules();
              loadDashboard();
              setShowScheduleModal(false);
              setPreSelectedBoardId(null);
            }
          }}
        />
      )}

      {showControlModal && selectedSchedule && (
        <ControlModal
          schedule={selectedSchedule}
          onClose={() => { setShowControlModal(false); setSelectedSchedule(null); }}
          onComplete={async () => {
            loadSchedules();
            loadRecords();
            loadDashboard();
            setShowControlModal(false);
            setSelectedSchedule(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// DASHBOARD TAB - Enhanced
// ============================================================
function DashboardTab({ dashboard, navigate, onStartControl }) {
  const overdue_list = dashboard?.overdue_list || [];
  const upcoming = dashboard?.upcoming || [];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Welcome Message */}
      <div className="text-center py-4 sm:py-6">
        <span className="text-4xl sm:text-5xl mb-4 block">👋</span>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Bienvenue dans vos contrôles</h2>
        <p className="text-gray-500 mt-2 text-sm sm:text-base">Gardez vos installations électriques sous contrôle</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: "⚡", label: "Tableaux", onClick: () => navigate("/app/switchboards"), color: "from-blue-400 to-blue-600" },
          { icon: "🗺️", label: "Plans", onClick: () => navigate("/app/switchboard-map"), color: "from-emerald-400 to-emerald-600" },
          { icon: "📊", label: "Schémas", onClick: () => navigate("/app/switchboards"), color: "from-violet-400 to-violet-600" },
          { icon: "📋", label: "Contrôles", onClick: () => {}, color: "from-amber-400 to-orange-500", active: true },
        ].map((action, idx) => (
          <button
            key={idx}
            onClick={action.onClick}
            className={`p-3 sm:p-4 rounded-xl text-white font-medium transition-all hover:scale-105 bg-gradient-to-br ${action.color} ${action.active ? 'ring-2 ring-offset-2 ring-orange-400' : ''}`}
          >
            <span className="text-2xl sm:text-3xl block mb-1">{action.icon}</span>
            <span className="text-xs sm:text-sm">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Overdue Section */}
      {overdue_list.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4">
          <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
            <span className="animate-bounce-slow">🚨</span> Contrôles en retard
          </h3>
          <div className="space-y-2">
            {overdue_list.slice(0, 3).map((s) => (
              <div key={s.id} className="bg-white rounded-lg p-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">⚠️</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{s.template_name}</p>
                    <p className="text-sm text-gray-500 truncate">{s.switchboard_code || s.switchboard_name}</p>
                  </div>
                </div>
                <button
                  onClick={() => onStartControl(s)}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex-shrink-0"
                >
                  Faire
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Section */}
      {upcoming.length > 0 && (
        <div className="bg-blue-50 rounded-xl p-4">
          <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
            <span>📅</span> Prochains contrôles
          </h3>
          <div className="space-y-2">
            {upcoming.slice(0, 3).map((s) => (
              <div key={s.id} className="bg-white rounded-lg p-3 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">📋</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{s.template_name}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {s.switchboard_code || s.switchboard_name} • {new Date(s.next_due_date).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onStartControl(s)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex-shrink-0"
                >
                  Faire
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {overdue_list.length === 0 && upcoming.length === 0 && (
        <div className="text-center py-8 sm:py-12">
          <span className="text-5xl sm:text-6xl block mb-4">🎉</span>
          <h3 className="text-lg sm:text-xl font-bold text-gray-800">Tout est sous contrôle !</h3>
          <p className="text-gray-500 mt-2">Aucun contrôle en attente. Planifiez vos prochains contrôles.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SCHEDULES TAB - Responsive
// ============================================================
function SchedulesTab({ schedules, onStartControl, onDelete, navigate }) {
  if (schedules.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📅</span>
        <p className="text-gray-500">Aucun contrôle planifié</p>
        <p className="text-sm text-gray-400 mt-2">Créez un nouveau contrôle pour commencer</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {schedules.map((s, idx) => {
        const isOverdue = s.next_due_date && new Date(s.next_due_date) < new Date();
        return (
          <div
            key={s.id}
            className={`p-4 hover:bg-gray-50 transition-colors animate-slideUp ${isOverdue ? 'bg-red-50' : ''}`}
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg">{isOverdue ? '⚠️' : '📋'}</span>
                  <span className="font-medium text-gray-900">{s.template_name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {isOverdue ? 'En retard' : 'À jour'}
                  </span>
                </div>
                <button
                  onClick={() => s.switchboard_id && navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                  className="text-sm text-blue-600 hover:underline mt-1"
                >
                  {s.switchboard_code || s.switchboard_name || `Disj. ${s.device_position}`}
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  Prochain: {s.next_due_date ? new Date(s.next_due_date).toLocaleDateString("fr-FR") : "-"}
                </p>
              </div>

              {/* Navigation Links */}
              {s.switchboard_id && (
                <div className="flex gap-1">
                  <button
                    onClick={() => navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                    className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    title="Voir le tableau"
                  >
                    ⚡
                  </button>
                  <button
                    onClick={() => navigate(`/app/switchboard-map?highlight=${s.switchboard_id}`)}
                    className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                    title="Voir sur la carte"
                  >
                    🗺️
                  </button>
                  <button
                    onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)}
                    className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200"
                    title="Voir le schéma"
                  >
                    📊
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => onStartControl(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isOverdue
                      ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse-slow'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isOverdue ? '⚡ Faire maintenant' : 'Contrôler'}
                </button>
                <button
                  onClick={() => onDelete(s.id)}
                  className="p-2 text-red-500 hover:bg-red-100 rounded-lg"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// OVERDUE TAB - Enhanced
// ============================================================
function OverdueTab({ overdueList, onStartControl, navigate }) {
  if (overdueList.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-6xl block mb-4">✅</span>
        <h3 className="text-xl font-bold text-green-600">Félicitations !</h3>
        <p className="text-gray-500 mt-2">Aucun contrôle en retard</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="bg-red-100 rounded-xl p-4 text-center mb-4">
        <span className="text-4xl animate-bounce-slow inline-block">🚨</span>
        <p className="font-bold text-red-800 mt-2">{overdueList.length} contrôle(s) nécessite(nt) votre attention</p>
      </div>

      {overdueList.map((s, idx) => (
        <div
          key={s.id}
          className="bg-white border-2 border-red-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all animate-slideUp"
          style={{ animationDelay: `${idx * 100}ms` }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-3xl animate-bounce-slow">⚠️</span>
              <div className="min-w-0">
                <p className="font-bold text-red-800">{s.template_name}</p>
                <button
                  onClick={() => s.switchboard_id && navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                  className="text-sm text-gray-600 hover:text-blue-600 hover:underline"
                >
                  {s.switchboard_code || s.switchboard_name || `Disj. ${s.device_position}`}
                </button>
                <p className="text-xs text-red-600 mt-1">
                  En retard de {Math.ceil((new Date() - new Date(s.next_due_date)) / (1000 * 60 * 60 * 24))} jours
                </p>
              </div>
            </div>

            {/* Navigation */}
            {s.switchboard_id && (
              <div className="flex gap-1">
                <button onClick={() => navigate(`/app/switchboards?board=${s.switchboard_id}`)} className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">⚡</button>
                <button onClick={() => navigate(`/app/switchboard-map?highlight=${s.switchboard_id}`)} className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200">🗺️</button>
                <button onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)} className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200">📊</button>
              </div>
            )}

            <button
              onClick={() => onStartControl(s)}
              className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 animate-pulse-slow whitespace-nowrap"
            >
              ⚡ Faire maintenant
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// HISTORY TAB - Responsive
// ============================================================
function HistoryTab({ records, navigate }) {
  const statusConfig = {
    conform: { bg: "bg-green-100", text: "text-green-800", icon: "✅", label: "Conforme" },
    non_conform: { bg: "bg-red-100", text: "text-red-800", icon: "❌", label: "Non conforme" },
    partial: { bg: "bg-yellow-100", text: "text-yellow-800", icon: "⚠️", label: "Partiel" },
  };

  if (records.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📜</span>
        <p className="text-gray-500">Aucun contrôle effectué</p>
        <p className="text-sm text-gray-400 mt-2">L'historique apparaîtra ici</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {records.map((r, idx) => {
        const status = statusConfig[r.status] || statusConfig.partial;
        return (
          <div
            key={r.id}
            className="p-4 hover:bg-gray-50 transition-colors animate-slideUp"
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Status Icon */}
              <span className="text-2xl">{status.icon}</span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{r.template_name || "-"}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${status.bg} ${status.text}`}>
                    {status.label}
                  </span>
                </div>
                <button
                  onClick={() => r.switchboard_id && navigate(`/app/switchboards?board=${r.switchboard_id}`)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {r.switchboard_code || r.switchboard_name || `Disj. ${r.device_position}`}
                </button>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                  <span>📅 {new Date(r.performed_at).toLocaleDateString("fr-FR")}</span>
                  <span>👤 {r.performed_by}</span>
                </div>
              </div>

              {/* Navigation */}
              {r.switchboard_id && (
                <div className="flex gap-1">
                  <button onClick={() => navigate(`/app/switchboards?board=${r.switchboard_id}`)} className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200">⚡</button>
                  <button onClick={() => navigate(`/app/switchboard-map?highlight=${r.switchboard_id}`)} className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200">🗺️</button>
                  <button onClick={() => navigate(`/app/switchboards/${r.switchboard_id}/diagram`)} className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200">📊</button>
                </div>
              )}

              {/* PDF Button */}
              <a
                href={api.switchboardControls.recordPdfUrl(r.id)}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm flex items-center gap-2"
              >
                📄 PDF
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// TEMPLATES TAB - Responsive
// ============================================================
function TemplatesTab({ templates, onEdit, onDelete }) {
  if (templates.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📝</span>
        <p className="text-gray-500">Aucun modèle de contrôle</p>
        <p className="text-sm text-gray-400 mt-2">Créez un modèle pour commencer</p>
      </div>
    );
  }

  return (
    <div className="p-4 grid gap-4 sm:grid-cols-2">
      {templates.map((t, idx) => (
        <div
          key={t.id}
          className="border rounded-xl p-4 hover:shadow-md transition-all animate-slideUp"
          style={{ animationDelay: `${idx * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-bold text-gray-900">{t.name}</h4>
              <span className={`text-xs px-2 py-0.5 rounded-full ${t.target_type === 'switchboard' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                {t.target_type === 'switchboard' ? '⚡ Tableau' : '🔌 Disjoncteur'}
              </span>
            </div>
            <span className="text-2xl">{t.target_type === 'switchboard' ? '⚡' : '🔌'}</span>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            📋 {(t.checklist_items || []).length} points de contrôle • 🔄 Tous les {t.frequency_months || 12} mois
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(t)}
              className="flex-1 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium"
            >
              ✏️ Modifier
            </button>
            <button
              onClick={() => onDelete(t.id)}
              className="px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// TEMPLATE MODAL - Responsive
// ============================================================
function TemplateModal({ template, onClose, onSave }) {
  const [name, setName] = useState(template?.name || "");
  const [targetType, setTargetType] = useState(template?.target_type || "switchboard");
  const [frequencyMonths, setFrequencyMonths] = useState(template?.frequency_months || 12);
  const [checklistItems, setChecklistItems] = useState(template?.checklist_items || []);
  const [saving, setSaving] = useState(false);

  const addItem = (type) => {
    setChecklistItems([...checklistItems, {
      id: Date.now().toString(),
      type,
      label: "",
      unit: type === "value" ? "" : undefined,
    }]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...checklistItems];
    updated[index][field] = value;
    setChecklistItems(updated);
  };

  const removeItem = (index) => {
    setChecklistItems(checklistItems.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) return alert("Entrez un nom pour le modèle");
    if (checklistItems.length === 0) return alert("Ajoutez au moins un point de contrôle");

    setSaving(true);
    try {
      await onSave({
        name,
        target_type: targetType,
        frequency_months: Number(frequencyMonths),
        checklist_items: checklistItems,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-hidden animate-slideUp">
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📝</span>
              <h2 className="text-lg sm:text-xl font-bold">{template ? "Modifier le modèle" : "Nouveau modèle"}</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh] space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Nom du modèle</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Contrôle annuel tableau principal"
            />
          </div>

          {/* Type & Frequency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type de cible</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              >
                <option value="switchboard">⚡ Tableau</option>
                <option value="device">🔌 Disjoncteur</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Périodicité</label>
              <select
                value={frequencyMonths}
                onChange={(e) => setFrequencyMonths(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              >
                <option value={1}>Mensuel</option>
                <option value={3}>Trimestriel</option>
                <option value={6}>Semestriel</option>
                <option value={12}>Annuel</option>
                <option value={24}>Bi-annuel</option>
              </select>
            </div>
          </div>

          {/* Checklist Items */}
          <div>
            <label className="block text-sm font-medium mb-2">Points de contrôle</label>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => addItem("conform")} className="px-3 py-2 bg-green-100 text-green-700 rounded-xl text-sm hover:bg-green-200">
                + Conforme/Non conforme
              </button>
              <button onClick={() => addItem("value")} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-xl text-sm hover:bg-blue-200">
                + Valeur numérique
              </button>
              <button onClick={() => addItem("text")} className="px-3 py-2 bg-purple-100 text-purple-700 rounded-xl text-sm hover:bg-purple-200">
                + Champ texte
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {checklistItems.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-center bg-gray-50 p-3 rounded-xl">
                  <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => updateItem(idx, "label", e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                    placeholder="Libellé du point de contrôle"
                  />
                  <span className={`px-2 py-1 rounded text-xs flex-shrink-0 ${
                    item.type === "conform" ? "bg-green-100 text-green-700" :
                    item.type === "value" ? "bg-blue-100 text-blue-700" :
                    "bg-purple-100 text-purple-700"
                  }`}>
                    {item.type === "conform" ? "C/NC" : item.type === "value" ? "Valeur" : "Texte"}
                  </span>
                  {item.type === "value" && (
                    <input
                      type="text"
                      value={item.unit || ""}
                      onChange={(e) => updateItem(idx, "unit", e.target.value)}
                      className="w-16 border rounded-lg px-2 py-2 text-sm bg-white text-gray-900"
                      placeholder="Unité"
                    />
                  )}
                  <button onClick={() => removeItem(idx)} className="p-1 text-red-500 hover:bg-red-100 rounded">
                    ✕
                  </button>
                </div>
              ))}
              {checklistItems.length === 0 && (
                <p className="text-center text-gray-400 py-4">Ajoutez des points de contrôle ci-dessus</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "⏳ Enregistrement..." : "✓ Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCHEDULE MODAL - Responsive
// ============================================================
function ScheduleModal({ templates, switchboards, preSelectedBoardId, onClose, onSave }) {
  const [templateId, setTemplateId] = useState("");
  const [targetType, setTargetType] = useState("switchboard");
  // Initialize with pre-selected board if provided
  const [selectedIds, setSelectedIds] = useState(() => {
    if (preSelectedBoardId) {
      return new Set([preSelectedBoardId]);
    }
    return new Set();
  });
  const [nextDueDate, setNextDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const filteredTemplates = (templates || []).filter((t) => t.target_type === targetType);

  // Filter switchboards by search
  const filteredSwitchboards = (switchboards || []).filter(sb => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (sb.code?.toLowerCase().includes(q) || sb.name?.toLowerCase().includes(q) || sb.meta?.building_code?.toLowerCase().includes(q));
  });

  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredSwitchboards.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSwitchboards.map(sb => sb.id)));
    }
  };

  const handleSave = async () => {
    if (!templateId) return alert("Sélectionnez un modèle");
    if (targetType === "switchboard" && selectedIds.size === 0) return alert("Sélectionnez au moins un tableau");

    setSaving(true);
    setProgress({ current: 0, total: selectedIds.size });

    try {
      const ids = Array.from(selectedIds);
      let successCount = 0;

      // Create schedules for all selected items
      for (let i = 0; i < ids.length; i++) {
        try {
          await onSave({
            template_id: Number(templateId),
            switchboard_id: targetType === "switchboard" ? Number(ids[i]) : null,
            device_id: null,
            next_due_date: nextDueDate,
          }, i === ids.length - 1); // Only reload on last item
          successCount++;
        } catch (e) {
          console.warn(`Failed to create schedule for ${ids[i]}:`, e);
        }
        setProgress({ current: i + 1, total: ids.length });
      }

      if (successCount > 0) {
        alert(`✅ ${successCount} contrôle(s) planifié(s) avec succès!`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl animate-slideUp max-h-[90vh] flex flex-col">
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-green-500 to-emerald-600 text-white flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <h2 className="text-lg sm:text-xl font-bold">Planifier un contrôle</h2>
                {selectedIds.size > 0 && (
                  <p className="text-sm text-white/80">{selectedIds.size} tableau(x) sélectionné(s)</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full">✕</button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium mb-1">Type de cible</label>
            <select
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTemplateId(""); setSelectedIds(new Set()); }}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
            >
              <option value="switchboard">⚡ Tableau électrique</option>
              <option value="device">🔌 Disjoncteur</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Modèle de contrôle</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
            >
              <option value="">-- Sélectionner un modèle --</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {filteredTemplates.length === 0 && (
              <p className="text-xs text-orange-600 mt-1">⚠️ Aucun modèle pour ce type. Créez-en un d'abord.</p>
            )}
          </div>

          {targetType === "switchboard" && (
            <div>
              <label className="block text-sm font-medium mb-1">Tableaux à contrôler</label>
              {/* Search and Select All */}
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="🔍 Rechercher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                />
                <button
                  onClick={selectAll}
                  className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 whitespace-nowrap"
                >
                  {selectedIds.size === filteredSwitchboards.length ? '✓ Désélectionner' : '☐ Tout sélectionner'}
                </button>
              </div>
              {/* Scrollable list with checkboxes */}
              <div className="border rounded-xl max-h-48 overflow-y-auto divide-y">
                {filteredSwitchboards.map((sb) => (
                  <label
                    key={sb.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedIds.has(sb.id) ? 'bg-green-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(sb.id)}
                      onChange={() => toggleSelection(sb.id)}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{sb.code || sb.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {sb.name} {sb.meta?.building_code ? `• ${sb.meta.building_code}` : ''}
                      </p>
                    </div>
                    {selectedIds.has(sb.id) && (
                      <span className="text-green-600">✓</span>
                    )}
                  </label>
                ))}
                {filteredSwitchboards.length === 0 && (
                  <p className="p-4 text-center text-gray-500 text-sm">Aucun tableau trouvé</p>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                💡 Sélectionnez plusieurs tableaux pour leur attribuer le même contrôle
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Date du premier contrôle</label>
            <input
              type="date"
              value={nextDueDate}
              onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
            />
          </div>
        </div>

        {/* Progress bar when saving */}
        {saving && progress.total > 1 && (
          <div className="px-4 sm:px-6 py-2 bg-gray-100">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>Création en cours...</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || selectedIds.size === 0}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? `⏳ ${progress.current}/${progress.total}...` : `✓ Planifier (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CONTROL MODAL - Enhanced with visible file upload
// ============================================================
function ControlModal({ schedule, onClose, onComplete }) {
  const [template, setTemplate] = useState(null);
  const [results, setResults] = useState([]);
  const [globalNotes, setGlobalNotes] = useState("");
  const [status, setStatus] = useState("conform");
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);

  useEffect(() => {
    if (schedule.template_id) {
      api.switchboardControls.listTemplates().then((res) => {
        const t = (res.templates || []).find((x) => x.id === schedule.template_id);
        if (t) {
          setTemplate(t);
          setResults(
            (t.checklist_items || []).map((item) => ({
              item_id: item.id,
              status: "conform",
              value: "",
              comment: "",
            }))
          );
        }
      });
    }
  }, [schedule.template_id]);

  const updateResult = (index, field, value) => {
    const updated = [...results];
    updated[index][field] = value;
    setResults(updated);

    const hasNonConform = updated.some((r) => r.status === "non_conform");
    const allConform = updated.every((r) => r.status === "conform" || r.status === "na");
    setStatus(hasNonConform ? "non_conform" : allConform ? "conform" : "partial");
  };

  const handleFileAdd = (e, fileType) => {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map((file) => ({
      file,
      type: fileType,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  };

  const removeFile = (index) => {
    setPendingFiles((prev) => {
      const updated = [...prev];
      if (updated[index].preview) URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const recordRes = await api.switchboardControls.createRecord({
        schedule_id: schedule.id,
        template_id: schedule.template_id,
        switchboard_id: schedule.switchboard_id,
        device_id: schedule.device_id,
        checklist_results: results,
        global_notes: globalNotes,
        status,
      });

      const recordId = recordRes?.record?.id;
      if (recordId && pendingFiles.length > 0) {
        for (const pf of pendingFiles) {
          await api.switchboardControls.uploadAttachment(recordId, pf.file, {
            file_type: pf.type,
          });
        }
      }

      await onComplete();
    } finally {
      setSaving(false);
    }
  };

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-12 h-12 border-4 border-blue-200 rounded-full animate-spin border-t-blue-600 mx-auto" />
          <p className="mt-4 text-gray-500">Chargement du formulaire...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-amber-500 to-orange-500 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">📋</span>
                {template.name}
              </h2>
              <p className="text-white/80 text-sm mt-1">
                {schedule.switchboard_code || schedule.switchboard_name || `Disj. ${schedule.device_position}`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[55vh] sm:max-h-[50vh] space-y-4">
          {/* Checklist */}
          {(template.checklist_items || []).map((item, idx) => (
            <div key={item.id} className="border rounded-xl p-4 bg-gray-50">
              <div className="flex items-start justify-between mb-3">
                <label className="font-medium text-gray-900">{idx + 1}. {item.label}</label>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  item.type === "conform" ? "bg-green-100 text-green-700" :
                  item.type === "value" ? "bg-blue-100 text-blue-700" :
                  "bg-purple-100 text-purple-700"
                }`}>
                  {item.type === "conform" ? "C/NC/NA" : item.type === "value" ? "Valeur" : "Texte"}
                </span>
              </div>

              {item.type === "conform" && (
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "conform", label: "✓ Conforme", color: "bg-green-600" },
                    { key: "non_conform", label: "✗ Non conforme", color: "bg-red-600" },
                    { key: "na", label: "N/A", color: "bg-gray-600" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => updateResult(idx, "status", opt.key)}
                      className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        results[idx]?.status === opt.key
                          ? `${opt.color} text-white`
                          : "bg-white border hover:bg-gray-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {item.type === "value" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={results[idx]?.value || ""}
                    onChange={(e) => updateResult(idx, "value", e.target.value)}
                    className="border rounded-lg px-3 py-2 w-28 bg-white text-gray-900"
                    placeholder="Valeur"
                  />
                  <span className="text-gray-500">{item.unit}</span>
                </div>
              )}

              {item.type === "text" && (
                <textarea
                  value={results[idx]?.value || ""}
                  onChange={(e) => updateResult(idx, "value", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 bg-white text-gray-900"
                  rows={2}
                  placeholder="Saisir le texte..."
                />
              )}

              <input
                type="text"
                value={results[idx]?.comment || ""}
                onChange={(e) => updateResult(idx, "comment", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 mt-2 text-sm bg-white text-gray-900"
                placeholder="💬 Commentaire (optionnel)"
              />
            </div>
          ))}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-2">📝 Observations générales</label>
            <textarea
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              rows={3}
              placeholder="Notes, remarques, actions à prévoir..."
            />
          </div>

          {/* STATUS SUMMARY */}
          <div className={`p-4 rounded-xl text-center ${
            status === "conform" ? "bg-green-100" :
            status === "non_conform" ? "bg-red-100" : "bg-yellow-100"
          }`}>
            <span className="text-3xl">{status === "conform" ? "✅" : status === "non_conform" ? "❌" : "⚠️"}</span>
            <p className={`font-bold mt-2 ${
              status === "conform" ? "text-green-800" :
              status === "non_conform" ? "text-red-800" : "text-yellow-800"
            }`}>
              {status === "conform" ? "Conforme" : status === "non_conform" ? "Non conforme" : "Partiel"}
            </p>
          </div>

          {/* FILE UPLOAD - VISIBLE SECTION */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
            <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
              📎 Pièces jointes
              <span className="text-xs font-normal text-gray-500">(optionnel)</span>
            </h4>

            {/* Upload Buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleFileAdd(e, "photo")}
                className="hidden"
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                multiple
                onChange={(e) => handleFileAdd(e, "document")}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 font-medium transition-all"
              >
                📷 Ajouter photos
              </button>
              <button
                onClick={() => docInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-purple-100 text-purple-700 rounded-xl hover:bg-purple-200 font-medium transition-all"
              >
                📄 Ajouter documents
              </button>
            </div>

            {/* Files Preview */}
            {pendingFiles.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {pendingFiles.map((pf, idx) => (
                  <div key={idx} className="relative group bg-white rounded-lg p-2 border">
                    {pf.preview ? (
                      <img src={pf.preview} alt="" className="w-full h-20 object-cover rounded" />
                    ) : (
                      <div className="w-full h-20 bg-gray-100 rounded flex items-center justify-center">
                        <span className="text-3xl">📄</span>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-1 truncate">{pf.file.name}</p>
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-gray-400">
                <span className="text-4xl block mb-2">📷</span>
                <p className="text-sm">Ajoutez des photos ou documents</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleComplete}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "⏳ Enregistrement..." : "✓ Valider le contrôle"}
          </button>
        </div>
      </div>
    </div>
  );
}
