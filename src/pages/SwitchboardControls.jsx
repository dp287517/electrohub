// src/pages/SwitchboardControls.jsx
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";

// ============================================================
// SWITCHBOARD CONTROLS - Page principale v1.0
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

  // Tab button component
  const TabButton = ({ id, label, count, color }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
        activeTab === id
          ? "bg-white text-blue-600 border-t-2 border-blue-600"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${color || "bg-gray-200"}`}>
          {count}
        </span>
      )}
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contrôles Électriques</h1>
          <p className="text-gray-500">Gestion des contrôles de tableaux et disjoncteurs</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Nouveau modèle
          </button>
          <button
            onClick={() => setShowScheduleModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + Planifier contrôle
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <TabButton id="dashboard" label="Tableau de bord" />
        <TabButton id="schedules" label="Planifiés" count={schedules.length} color="bg-blue-100 text-blue-800" />
        <TabButton id="overdue" label="En retard" count={dashboard?.stats?.overdue || 0} color="bg-red-100 text-red-800" />
        <TabButton id="history" label="Historique" count={records.length} color="bg-gray-200" />
        <TabButton id="templates" label="Modèles" count={templates.length} />
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === "dashboard" && (
          <DashboardTab dashboard={dashboard} onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }} />
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
          onClose={() => setShowScheduleModal(false)}
          onSave={async (data) => {
            await api.switchboardControls.createSchedule(data);
            loadSchedules();
            loadDashboard();
            setShowScheduleModal(false);
          }}
        />
      )}

      {showControlModal && selectedSchedule && (
        <ControlModal
          schedule={selectedSchedule}
          onClose={() => { setShowControlModal(false); setSelectedSchedule(null); }}
          onComplete={async () => {
            // Record is created inside the modal (to handle file uploads)
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
// DASHBOARD TAB
// ============================================================

function DashboardTab({ dashboard, onStartControl }) {
  if (!dashboard) return <div>Chargement...</div>;

  const { stats, upcoming, overdue_list } = dashboard;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="En attente" value={stats.pending} color="blue" icon="📋" />
        <StatCard label="En retard" value={stats.overdue} color="red" icon="⚠️" />
        <StatCard label="Complétés (30j)" value={stats.completed_30d} color="green" icon="✅" />
        <StatCard label="Modèles actifs" value={stats.templates} color="purple" icon="📝" />
      </div>

      {/* Overdue alerts */}
      {overdue_list && overdue_list.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-800 mb-3">Contrôles en retard</h3>
          <div className="space-y-2">
            {overdue_list.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-white rounded p-3">
                <div>
                  <span className="font-medium">{s.template_name}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  <span className="text-gray-600">
                    {s.switchboard_code || s.switchboard_name || `Position ${s.device_position}`}
                  </span>
                  <span className="ml-2 text-red-600 text-sm">
                    Dû le {new Date(s.next_due_date).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <button
                  onClick={() => onStartControl(s)}
                  className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                >
                  Faire maintenant
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcoming && upcoming.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-800 mb-3">Contrôles à venir (7 jours)</h3>
          <div className="space-y-2">
            {upcoming.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-white rounded p-3">
                <div>
                  <span className="font-medium">{s.template_name}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  <span className="text-gray-600">
                    {s.switchboard_code || s.switchboard_name || `Position ${s.device_position}`}
                  </span>
                  <span className="ml-2 text-blue-600 text-sm">
                    Prévu le {new Date(s.next_due_date).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <button
                  onClick={() => onStartControl(s)}
                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Commencer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!overdue_list?.length && !upcoming?.length && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">✅</p>
          <p>Tous les contrôles sont à jour !</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }) {
  const colors = {
    blue: "bg-blue-100 text-blue-800",
    red: "bg-red-100 text-red-800",
    green: "bg-green-100 text-green-800",
    purple: "bg-purple-100 text-purple-800",
  };

  return (
    <div className={`rounded-lg p-4 ${colors[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm opacity-80">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

// ============================================================
// SCHEDULES TAB
// ============================================================

function SchedulesTab({ schedules, onStartControl, onDelete, navigate }) {
  return (
    <div className="space-y-4">
      {schedules.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Aucun contrôle planifié</p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Modèle</th>
              <th className="text-left p-3">Cible</th>
              <th className="text-left p-3">Navigation</th>
              <th className="text-left p-3">Prochaine date</th>
              <th className="text-left p-3">Statut</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const isOverdue = s.next_due_date && new Date(s.next_due_date) < new Date();
              return (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{s.template_name}</td>
                  <td className="p-3">
                    {s.switchboard_id ? (
                      <button
                        onClick={() => navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {s.switchboard_code || s.switchboard_name}
                      </button>
                    ) : (
                      <span className="text-purple-600">Disj. {s.device_position}</span>
                    )}
                  </td>
                  <td className="p-3">
                    {s.switchboard_id && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                          className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          title="Voir le tableau"
                        >
                          ⚡
                        </button>
                        <button
                          onClick={() => navigate(`/app/switchboard-map?highlight=${s.switchboard_id}`)}
                          className="p-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                          title="Voir sur la carte"
                        >
                          🗺️
                        </button>
                        <button
                          onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)}
                          className="p-1.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200"
                          title="Voir le schéma"
                        >
                          📊
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {s.next_due_date ? new Date(s.next_due_date).toLocaleDateString("fr-FR") : "-"}
                  </td>
                  <td className="p-3">
                    {isOverdue ? (
                      <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">En retard</span>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">À jour</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => onStartControl(s)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        Contrôler
                      </button>
                      <button
                        onClick={() => onDelete(s.id)}
                        className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// OVERDUE TAB
// ============================================================

function OverdueTab({ overdueList, onStartControl, navigate }) {
  return (
    <div className="space-y-4">
      {overdueList.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">✅</p>
          <p>Aucun contrôle en retard</p>
        </div>
      ) : (
        <div className="space-y-3">
          {overdueList.map((s) => (
            <div key={s.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-4">
                <div>
                  <span className="font-semibold text-red-800">{s.template_name}</span>
                  <span className="mx-2 text-gray-400">•</span>
                  <button
                    onClick={() => s.switchboard_id && navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                    className="text-gray-700 hover:underline"
                  >
                    {s.switchboard_code || s.switchboard_name || `Disj. ${s.device_position}`}
                  </button>
                  <p className="text-sm text-red-600 mt-1">
                    En retard de {Math.ceil((new Date() - new Date(s.next_due_date)) / (1000 * 60 * 60 * 24))} jours
                  </p>
                </div>
                {s.switchboard_id && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => navigate(`/app/switchboards?board=${s.switchboard_id}`)}
                      className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      title="Voir le tableau"
                    >
                      ⚡
                    </button>
                    <button
                      onClick={() => navigate(`/app/switchboard-map?highlight=${s.switchboard_id}`)}
                      className="p-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                      title="Voir sur la carte"
                    >
                      🗺️
                    </button>
                    <button
                      onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)}
                      className="p-1.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200"
                      title="Voir le schéma"
                    >
                      📊
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => onStartControl(s)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Faire maintenant
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// HISTORY TAB
// ============================================================

function HistoryTab({ records, navigate }) {
  const statusColors = {
    conform: "bg-green-100 text-green-800",
    non_conform: "bg-red-100 text-red-800",
    partial: "bg-yellow-100 text-yellow-800",
  };
  const statusLabels = {
    conform: "Conforme",
    non_conform: "Non conforme",
    partial: "Partiel",
  };

  return (
    <div className="space-y-4">
      {records.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Aucun contrôle effectué</p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Modèle</th>
              <th className="text-left p-3">Cible</th>
              <th className="text-left p-3">Navigation</th>
              <th className="text-left p-3">Contrôlé par</th>
              <th className="text-left p-3">Statut</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="p-3">{new Date(r.performed_at).toLocaleDateString("fr-FR")}</td>
                <td className="p-3">{r.template_name || "-"}</td>
                <td className="p-3">
                  {r.switchboard_id ? (
                    <button
                      onClick={() => navigate(`/app/switchboards?board=${r.switchboard_id}`)}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {r.switchboard_code || r.switchboard_name}
                    </button>
                  ) : (
                    <span className="text-purple-600">Disj. {r.device_position}</span>
                  )}
                </td>
                <td className="p-3">
                  {r.switchboard_id && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => navigate(`/app/switchboards?board=${r.switchboard_id}`)}
                        className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        title="Voir le tableau"
                      >
                        ⚡
                      </button>
                      <button
                        onClick={() => navigate(`/app/switchboard-map?highlight=${r.switchboard_id}`)}
                        className="p-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                        title="Voir sur la carte"
                      >
                        🗺️
                      </button>
                      <button
                        onClick={() => navigate(`/app/switchboards/${r.switchboard_id}/diagram`)}
                        className="p-1.5 bg-violet-100 text-violet-700 rounded hover:bg-violet-200"
                        title="Voir le schéma"
                      >
                        📊
                      </button>
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div>
                    <p className="font-medium">{r.performed_by}</p>
                    <p className="text-xs text-gray-500">{r.performed_by_email}</p>
                  </div>
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-sm ${statusColors[r.status] || "bg-gray-100"}`}>
                    {statusLabels[r.status] || r.status}
                  </span>
                </td>
                <td className="p-3">
                  <a
                    href={api.switchboardControls.recordPdfUrl(r.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
                  >
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// TEMPLATES TAB
// ============================================================

function TemplatesTab({ templates, onEdit, onDelete }) {
  return (
    <div className="space-y-4">
      {templates.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Aucun modèle de contrôle</p>
          <p className="text-sm mt-2">Créez un modèle pour commencer</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{t.name}</h3>
                  <p className="text-sm text-gray-500">{t.description || "Pas de description"}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${
                  t.target_type === "switchboard" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                }`}>
                  {t.target_type === "switchboard" ? "Tableau" : "Disjoncteur"}
                </span>
              </div>
              <div className="mt-3 text-sm text-gray-600">
                <p>Périodicité: {t.frequency_months} mois</p>
                <p>Points de contrôle: {(t.checklist_items || []).length}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => onEdit(t)}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm"
                >
                  Modifier
                </button>
                <button
                  onClick={() => onDelete(t.id)}
                  className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// TEMPLATE MODAL
// ============================================================

function TemplateModal({ template, onClose, onSave }) {
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [targetType, setTargetType] = useState(template?.target_type || "switchboard");
  const [frequencyMonths, setFrequencyMonths] = useState(template?.frequency_months || 12);
  const [checklistItems, setChecklistItems] = useState(template?.checklist_items || []);
  const [saving, setSaving] = useState(false);

  const addItem = (type) => {
    setChecklistItems([
      ...checklistItems,
      { id: crypto.randomUUID(), label: "", type, unit: "", required: false },
    ]);
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
    if (!name.trim()) return alert("Nom requis");
    setSaving(true);
    try {
      await onSave({
        name,
        description,
        target_type: targetType,
        frequency_months: frequencyMonths,
        checklist_items: checklistItems,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {template ? "Modifier le modèle" : "Nouveau modèle de contrôle"}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh] space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nom du modèle *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white text-gray-900"
                placeholder="Ex: Contrôle annuel tableau"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type de cible</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white text-gray-900"
              >
                <option value="switchboard">Tableau électrique</option>
                <option value="device">Disjoncteur</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
              rows={2}
              placeholder="Description du contrôle..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Périodicité (mois)</label>
            <select
              value={frequencyMonths}
              onChange={(e) => setFrequencyMonths(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
            >
              <option value={1}>Mensuel (1 mois)</option>
              <option value={3}>Trimestriel (3 mois)</option>
              <option value={6}>Semestriel (6 mois)</option>
              <option value={12}>Annuel (12 mois)</option>
              <option value={24}>Bisannuel (24 mois)</option>
              <option value={60}>Quinquennal (60 mois)</option>
            </select>
          </div>

          {/* Checklist items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Points de contrôle</label>
              <div className="flex gap-2">
                <button
                  onClick={() => addItem("conform")}
                  className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                >
                  + Conforme/NC
                </button>
                <button
                  onClick={() => addItem("value")}
                  className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                >
                  + Valeur
                </button>
                <button
                  onClick={() => addItem("text")}
                  className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm hover:bg-purple-200"
                >
                  + Texte
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {checklistItems.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-center bg-gray-50 p-2 rounded">
                  <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => updateItem(idx, "label", e.target.value)}
                    className="flex-1 border rounded px-2 py-1 text-sm bg-white text-gray-900"
                    placeholder="Libellé du point de contrôle"
                  />
                  <span className={`px-2 py-1 rounded text-xs ${
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
                      className="w-16 border rounded px-2 py-1 text-sm bg-white text-gray-900"
                      placeholder="Unité"
                    />
                  )}
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-red-500 hover:text-red-700"
                  >
                    ×
                  </button>
                </div>
              ))}
              {checklistItems.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  Ajoutez des points de contrôle ci-dessus
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCHEDULE MODAL
// ============================================================

function ScheduleModal({ templates, switchboards, onClose, onSave }) {
  const [templateId, setTemplateId] = useState("");
  const [targetType, setTargetType] = useState("switchboard");
  const [switchboardId, setSwitchboardId] = useState("");
  const [nextDueDate, setNextDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);

  const filteredTemplates = templates.filter((t) => t.target_type === targetType);

  const handleSave = async () => {
    if (!templateId) return alert("Sélectionnez un modèle");
    if (targetType === "switchboard" && !switchboardId) return alert("Sélectionnez un tableau");

    setSaving(true);
    try {
      await onSave({
        template_id: Number(templateId),
        switchboard_id: targetType === "switchboard" ? Number(switchboardId) : null,
        device_id: null, // TODO: implement device selection
        next_due_date: nextDueDate,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-xl font-semibold">Planifier un contrôle</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type de cible</label>
            <select
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTemplateId(""); }}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
            >
              <option value="switchboard">Tableau électrique</option>
              <option value="device">Disjoncteur</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Modèle de contrôle</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
            >
              <option value="">-- Sélectionner --</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {targetType === "switchboard" && (
            <div>
              <label className="block text-sm font-medium mb-1">Tableau</label>
              <select
                value={switchboardId}
                onChange={(e) => setSwitchboardId(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white text-gray-900"
              >
                <option value="">-- Sélectionner --</option>
                {switchboards.map((sb) => (
                  <option key={sb.id} value={sb.id}>
                    {sb.code || sb.name} {sb.building_code ? `(${sb.building_code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Date du premier contrôle</label>
            <input
              type="date"
              value={nextDueDate}
              onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
            />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Création..." : "Planifier"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CONTROL MODAL (Execute a control)
// ============================================================

function ControlModal({ schedule, onClose, onComplete }) {
  const [template, setTemplate] = useState(null);
  const [results, setResults] = useState([]);
  const [globalNotes, setGlobalNotes] = useState("");
  const [status, setStatus] = useState("conform");
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]); // { file, type: 'photo'|'document', caption }

  // Load template details
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

    // Auto-update global status
    const hasNonConform = updated.some((r) => r.status === "non_conform");
    const allConform = updated.every((r) => r.status === "conform" || r.status === "na");
    setStatus(hasNonConform ? "non_conform" : allConform ? "conform" : "partial");
  };

  const handleFileAdd = (e, fileType) => {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map((file) => ({
      file,
      type: fileType,
      caption: "",
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
      // 1. Create the record
      const recordRes = await api.switchboardControls.createRecord({
        schedule_id: schedule.id,
        template_id: schedule.template_id,
        switchboard_id: schedule.switchboard_id,
        device_id: schedule.device_id,
        checklist_results: results,
        global_notes: globalNotes,
        status,
      });

      // 2. Upload attachments if any
      const recordId = recordRes?.record?.id;
      if (recordId && pendingFiles.length > 0) {
        for (const pf of pendingFiles) {
          await api.switchboardControls.uploadAttachment(recordId, pf.file, {
            file_type: pf.type,
            caption: pf.caption,
          });
        }
      }

      // 3. Notify parent to refresh
      await onComplete(null); // Pass null since we already created the record
    } finally {
      setSaving(false);
    }
  };

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-500">Chargement du formulaire...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{template.name}</h2>
              <p className="text-gray-500">
                {schedule.switchboard_code || schedule.switchboard_name || `Disj. ${schedule.device_position}`}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4">
          {/* Checklist */}
          {(template.checklist_items || []).map((item, idx) => (
            <div key={item.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <label className="font-medium">{idx + 1}. {item.label}</label>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  item.type === "conform" ? "bg-green-100 text-green-700" :
                  item.type === "value" ? "bg-blue-100 text-blue-700" :
                  "bg-purple-100 text-purple-700"
                }`}>
                  {item.type === "conform" ? "C/NC/NA" : item.type === "value" ? "Valeur" : "Texte"}
                </span>
              </div>

              {item.type === "conform" && (
                <div className="flex gap-2">
                  {["conform", "non_conform", "na"].map((s) => (
                    <button
                      key={s}
                      onClick={() => updateResult(idx, "status", s)}
                      className={`px-4 py-2 rounded ${
                        results[idx]?.status === s
                          ? s === "conform" ? "bg-green-600 text-white" :
                            s === "non_conform" ? "bg-red-600 text-white" :
                            "bg-gray-600 text-white"
                          : "bg-gray-100 hover:bg-gray-200"
                      }`}
                    >
                      {s === "conform" ? "✓ Conforme" : s === "non_conform" ? "✗ Non conforme" : "N/A"}
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
                    className="border rounded px-3 py-2 w-32 bg-white text-gray-900"
                    placeholder="Valeur"
                  />
                  <span className="text-gray-500">{item.unit}</span>
                </div>
              )}

              {item.type === "text" && (
                <textarea
                  value={results[idx]?.value || ""}
                  onChange={(e) => updateResult(idx, "value", e.target.value)}
                  className="w-full border rounded px-3 py-2 bg-white text-gray-900"
                  rows={2}
                  placeholder="Saisir le texte..."
                />
              )}

              <input
                type="text"
                value={results[idx]?.comment || ""}
                onChange={(e) => updateResult(idx, "comment", e.target.value)}
                className="w-full border rounded px-3 py-2 mt-2 text-sm bg-white text-gray-900"
                placeholder="Commentaire (optionnel)"
              />
            </div>
          ))}

          {/* Global notes */}
          <div>
            <label className="block text-sm font-medium mb-1">Observations générales</label>
            <textarea
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white text-gray-900"
              rows={3}
              placeholder="Notes, remarques, actions à prévoir..."
            />
          </div>

          {/* Status summary */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
            <span className="font-medium">Statut global:</span>
            <span className={`px-3 py-1 rounded ${
              status === "conform" ? "bg-green-100 text-green-800" :
              status === "non_conform" ? "bg-red-100 text-red-800" :
              "bg-yellow-100 text-yellow-800"
            }`}>
              {status === "conform" ? "✓ Conforme" :
               status === "non_conform" ? "✗ Non conforme" : "Partiel"}
            </span>
          </div>

          {/* Photos & Documents */}
          <div className="border rounded-lg p-4">
            <h4 className="font-medium mb-3">📎 Pièces jointes</h4>
            <div className="flex gap-2 mb-3">
              <label className="px-3 py-2 bg-blue-100 text-blue-700 rounded cursor-pointer hover:bg-blue-200 text-sm flex items-center gap-1">
                📷 Ajouter photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFileAdd(e, "photo")}
                  className="hidden"
                />
              </label>
              <label className="px-3 py-2 bg-purple-100 text-purple-700 rounded cursor-pointer hover:bg-purple-200 text-sm flex items-center gap-1">
                📄 Ajouter documents
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                  multiple
                  onChange={(e) => handleFileAdd(e, "document")}
                  className="hidden"
                />
              </label>
            </div>

            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                {pendingFiles.map((pf, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-gray-50 p-2 rounded">
                    {pf.preview ? (
                      <img src={pf.preview} alt="" className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-500">
                        📄
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pf.file.name}</p>
                      <p className="text-xs text-gray-500">
                        {pf.type === "photo" ? "Photo" : "Document"} • {(pf.file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="p-1 text-red-500 hover:bg-red-100 rounded"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {pendingFiles.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">
                Aucune pièce jointe (optionnel)
              </p>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
            Annuler
          </button>
          <button
            onClick={handleComplete}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Valider le contrôle"}
          </button>
        </div>
      </div>
    </div>
  );
}
