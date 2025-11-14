// ============================================================================
// Controls.jsx - CORRIGÉ avec bouton "Placer sur plan" et gestion plans améliorée
// ============================================================================

import React, { useEffect, useState, useRef } from "react";
import { ChevronRight, ChevronDown, Upload, Paperclip, Calendar, Wand2, RefreshCw, Eye, AlertTriangle, CheckCircle, XCircle, Clock, Map, MapPin } from "lucide-react";
import ControlsMap, { ControlsMapManager } from "./Controls-map.jsx";
import { api } from "../lib/api.js";

// ============================================================================
// COMPOSANTS UI DE BASE
// ============================================================================

function Tabs({ value, onValueChange, children }) {
  const [active, setActive] = useState(value);
  useEffect(() => setActive(value), [value]);
  return (
    <div className="flex flex-col gap-3">
      {React.Children.map(children, (child) =>
        React.cloneElement(child, { active, onValueChange })
      )}
    </div>
  );
}

function TabsList({ children, active, onValueChange }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {React.Children.map(children, (child) =>
        React.cloneElement(child, { active, onValueChange })
      )}
    </div>
  );
}

function TabsTrigger({ value, children, active, onValueChange }) {
  const selected = active === value;

  const handleClick = () => {
    if (typeof onValueChange === "function") {
      onValueChange(value);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
        selected
          ? "bg-indigo-600 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, active, children }) {
  if (value !== active) return null;
  return <div className="fade-in-up mt-4">{children}</div>;
}

function Button({ children, variant = "primary", size = "md", className = "", ...props }) {
  const base = "inline-flex items-center justify-center font-semibold rounded-lg transition-all disabled:opacity-50 gap-2";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-green-600 text-white hover:bg-green-700",
    warning: "bg-amber-500 text-white hover:bg-amber-600",
  };
  const sizes = {
    sm: "px-2.5 py-1.5 text-sm",
    md: "px-3.5 py-2 text-sm",
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return <div className={`bg-white shadow-sm rounded-xl border border-gray-200 ${className}`}>{children}</div>;
}

function CardContent({ children, className = "" }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

function Badge({ children, variant = "default" }) {
  const variants = {
    default: "bg-gray-100 text-gray-700",
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${variants[variant]}`}>
      {children}
    </span>
  );
}

// ============================================================================
// HELPERS & FORMATAGE
// ============================================================================

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  const map = {
    planned: { variant: "success", icon: CheckCircle, label: "Planifié" },
    pending: { variant: "warning", icon: Clock, label: "À faire (≤30j)" },
    overdue: { variant: "danger", icon: AlertTriangle, label: "En retard" },
    done: { variant: "info", icon: CheckCircle, label: "Terminé" },
  };
  const cfg = map[s] || map.planned;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant}>
      <Icon size={12} className="inline mr-1" />
      {cfg.label}
    </Badge>
  );
}

// ============================================================================
// COMPOSANT CHECKLIST
// ============================================================================

function Checklist({ schema, onSubmit, busy }) {
  const [items, setItems] = useState(
    (schema?.checklist || []).map((q) => ({ key: q.key, value: "" }))
  );
  const [obs, setObs] = useState(
    Object.fromEntries((schema?.observations || []).map((o) => [o.key, ""]))
  );
  const [files, setFiles] = useState([]);
  const [comment, setComment] = useState("");

  const opts = ["Conforme", "Non conforme", "Non applicable"];

  const setValue = (k, v) =>
    setItems((arr) => arr.map((x) => (x.key === k ? { ...x, value: v } : x)));

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFiles((p) => [...p, f]);
  };

  const submit = () => onSubmit({ items, obs, files, comment });

  const allFilled = items.every((i) => i.value);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold mb-2">Checklist</div>
        <div className="space-y-2">
          {schema?.checklist?.map((q) => (
            <div key={q.key} className="flex items-start gap-3">
              <div className="flex-1 text-sm">{q.label}</div>
              <select
                className="p-2 rounded-lg bg-white ring-1 ring-black/10 text-sm"
                value={items.find((x) => x.key === q.key)?.value || ""}
                onChange={(e) => setValue(q.key, e.target.value)}
              >
                <option value="">Sélectionner</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {schema?.observations?.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-2">Observations</div>
          {schema.observations.map((o) => (
            <div key={o.key} className="mb-2">
              <div className="text-xs text-gray-600">{o.label}</div>
              <input
                className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10 text-sm"
                value={obs[o.key] || ""}
                onChange={(e) => setObs((s) => ({ ...s, [o.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-xs text-gray-600 mb-1">Commentaire</div>
        <textarea
          rows={3}
          className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10 text-sm"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div>
        <label className="inline-flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer w-fit text-sm">
          <Upload size={16} /> Joindre une photo
          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
        </label>
        <div className="flex flex-wrap gap-2 mt-1">
          {files.map((f, i) => (
            <span
              key={i}
              className="text-xs bg-white ring-1 ring-black/10 px-2 py-1 rounded-lg flex items-center gap-1"
            >
              <Paperclip size={14} /> {f.name}
            </span>
          ))}
        </div>
      </div>

      <Button onClick={submit} disabled={!allFilled || busy} variant="success" className="w-full">
        {busy ? "Enregistrement..." : "Clôturer & Replanifier"}
      </Button>

      {schema?.notes && (
        <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">{schema.notes}</div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT DÉTAILS TÂCHE
// ============================================================================

function TaskDetails({ task, onClose, onRefresh }) {
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    api.controls.taskSchema(task.id).then(setSchema);
  }, [task]);

  const submit = async (data) => {
    setBusy(true);
    try {
      await api.controls.closeTask(task.id, data);
      onRefresh?.();
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-semibold text-lg">{task.task_name || task.label}</div>
            <div className="text-xs text-gray-500 mt-1">
              Échéance: {fmtDate(task.next_control)} • <StatusPill status={task.status} />
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>

        <div className="p-4">
          {!schema && <div className="text-gray-500">Chargement du schéma TSD...</div>}
          {schema && <Checklist schema={schema} onSubmit={submit} busy={busy} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT ARBRE HIÉRARCHIQUE - CORRIGÉ
// ============================================================================

function TreeNode({ title, count, open, toggle, level = 0, children, positioned, needsPosition, onPlace, building }) {
  return (
    <div>
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer ${
          open ? "bg-indigo-50" : "hover:bg-gray-50"
        }`}
        onClick={toggle}
        style={{ marginLeft: level * 12 }}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-semibold text-sm">{title}</span>
          
          {/* ✅ AJOUT : Bouton "Placer sur plan" */}
          {needsPosition && (
            <Button 
              size="sm" 
              variant="warning"
              onClick={(e) => {
                e.stopPropagation();
                onPlace?.();
              }}
            >
              <MapPin size={12} /> Placer sur plan
            </Button>
          )}
          
          {/* ✅ AJOUT : Bouton "Voir sur plan" si déjà positionné */}
          {positioned && !needsPosition && (
            <Button 
              size="sm" 
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onPlace?.();
              }}
            >
              <Eye size={12} /> Voir sur plan
            </Button>
          )}
        </div>
        {count > 0 && <Badge variant="default">{count}</Badge>}
      </div>
      {open && <div className="ml-4">{children}</div>}
    </div>
  );
}

function HierarchyTree({ statusFilter, onSelectTask, onPlaceEquipment, onRefresh }) {
  const [tree, setTree] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    loadTree();
  }, [statusFilter]);

  const loadTree = async () => {
    try {
      const data = await api.controls.hierarchyTree({ status: statusFilter });
      setTree(data);
    } catch (e) {
      console.error("[HierarchyTree] error:", e);
    }
  };

  const toggle = (key) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  const countTasks = (tasks) => {
    if (!Array.isArray(tasks)) return 0;
    if (statusFilter === "all") return tasks.length;
    const open = ["Planned", "Pending", "Overdue"];
    const done = ["Done"];
    return tasks.filter((t) =>
      statusFilter === "open" ? open.includes(t.status) : done.includes(t.status)
    ).length;
  };

  if (!tree) return <div className="text-gray-500">Chargement...</div>;

  return (
    <div className="space-y-3">
      {tree.buildings?.map((b, bi) => {
        const kB = `b-${bi}`;
        const hvItems = b.hv || [];
        const swItems = b.switchboards || [];
        
        const hvCount = hvItems.reduce((a, n) => a + countTasks(n.tasks), 0);
        const swCount = swItems.reduce(
          (a, sb) => a + countTasks(sb.tasks) + (sb.devices || []).reduce((x, d) => x + countTasks(d.tasks), 0),
          0
        );

        // Ne pas afficher le bâtiment s'il n'a aucun équipement
        if (hvItems.length === 0 && swItems.length === 0) return null;

        return (
          <Card key={kB}>
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between border-b">
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold">{b.label}</div>
              </div>
              <div className="text-xs text-gray-500">
                {hvItems.length > 0 && `HV: ${hvCount}`}
                {hvItems.length > 0 && swItems.length > 0 && " • "}
                {swItems.length > 0 && `Switchboards: ${swCount}`}
              </div>
            </div>

            <CardContent className="p-3 space-y-2">
              {/* HV */}
              {hvItems.length > 0 && (
                <TreeNode
                  title="High Voltage"
                  count={hvCount}
                  open={expanded[`${kB}-hv`]}
                  toggle={() => toggle(`${kB}-hv`)}
                  building={b.label}
                >
                  {hvItems.map((eq, i) => (
                    <TreeNode
                      key={i}
                      title={eq.label}
                      count={countTasks(eq.tasks)}
                      open={expanded[`hv-${i}`]}
                      toggle={() => toggle(`hv-${i}`)}
                      level={1}
                      positioned={eq.positioned}
                      needsPosition={!eq.positioned && countTasks(eq.tasks) > 0}
                      building={b.label}
                      onPlace={() => onPlaceEquipment({
                        entity_id: eq.id,
                        entity_type: eq.entity_type,
                        label: eq.label,
                        building: b.label,
                        positioned: eq.positioned,
                      })}
                    >
                      {eq.tasks?.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onSelectTask(t)}
                          className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                        >
                          <div>{t.task_name}</div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={t.status} />
                            <span className="text-xs text-gray-500">{fmtDate(t.next_control)}</span>
                          </div>
                        </div>
                      ))}
                      {(eq.devices || []).map((d, di) => (
                        <TreeNode
                          key={di}
                          title={d.label}
                          count={countTasks(d.tasks)}
                          open={expanded[`hv-dev-${i}-${di}`]}
                          toggle={() => toggle(`hv-dev-${i}-${di}`)}
                          level={2}
                          positioned={d.positioned}
                          needsPosition={!d.positioned && countTasks(d.tasks) > 0}
                          building={b.label}
                          onPlace={() => onPlaceEquipment({
                            entity_id: d.id,
                            entity_type: d.entity_type,
                            label: d.label,
                            building: b.label,
                            positioned: d.positioned,
                          })}
                        >
                          {d.tasks?.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => onSelectTask(t)}
                              className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                            >
                              <div>{t.task_name}</div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={t.status} />
                                <span className="text-xs text-gray-500">{fmtDate(t.next_control)}</span>
                              </div>
                            </div>
                          ))}
                        </TreeNode>
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              )}

              {/* Switchboards */}
              {swItems.length > 0 && (
                <TreeNode
                  title="Switchboards"
                  count={swCount}
                  open={expanded[`${kB}-sb`]}
                  toggle={() => toggle(`${kB}-sb`)}
                  building={b.label}
                >
                  {swItems.map((sb, i) => (
                    <TreeNode
                      key={i}
                      title={sb.label}
                      count={countTasks(sb.tasks)}
                      open={expanded[`sb-${i}`]}
                      toggle={() => toggle(`sb-${i}`)}
                      level={1}
                      positioned={sb.positioned}
                      needsPosition={!sb.positioned && countTasks(sb.tasks) > 0}
                      building={b.label}
                      onPlace={() => onPlaceEquipment({
                        entity_id: sb.id,
                        entity_type: sb.entity_type,
                        label: sb.label,
                        building: b.label,
                        positioned: sb.positioned,
                      })}
                    >
                      {sb.tasks?.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onSelectTask(t)}
                          className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                        >
                          <div>{t.task_name}</div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={t.status} />
                            <span className="text-xs text-gray-500">{fmtDate(t.next_control)}</span>
                          </div>
                        </div>
                      ))}
                      {(sb.devices || []).map((d, di) => (
                        <TreeNode
                          key={di}
                          title={`${d.label} (hérite position)`}
                          count={countTasks(d.tasks)}
                          open={expanded[`sb-dev-${i}-${di}`]}
                          toggle={() => toggle(`sb-dev-${i}-${di}`)}
                          level={2}
                        >
                          {d.tasks?.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => onSelectTask(t)}
                              className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                            >
                              <div>{t.task_name}</div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={t.status} />
                                <span className="text-xs text-gray-500">{fmtDate(t.next_control)}</span>
                              </div>
                            </div>
                          ))}
                        </TreeNode>
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================================
// COMPOSANT ÉQUIPEMENTS MANQUANTS
// ============================================================================

function MissingEquipment() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.controls.getMissingEquipment().then(setData);
  }, []);

  if (!data) return <div>Chargement...</div>;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-amber-500" size={20} />
            <div className="font-semibold">Équipements non intégrés</div>
          </div>
          <div className="text-sm text-gray-600 mb-3">
            Ces catégories TSD n'ont pas encore de table en base. Créez-les pour activer les contrôles.
          </div>
          <div className="space-y-2">
            {data.missing?.map((m, i) => (
              <div key={i} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="font-medium text-amber-900">{m.category}</div>
                <div className="text-xs text-amber-700 mt-1">
                  Table manquante: <code className="bg-amber-100 px-1 rounded">{m.db_table}</code> • {m.count_in_tsd}{" "}
                  contrôles TSD
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="text-green-500" size={20} />
            <div className="font-semibold">Équipements intégrés</div>
          </div>
          <div className="space-y-2">
            {data.existing?.map((e, i) => (
              <div key={i} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="font-medium text-green-900">{e.category}</div>
                <div className="text-xs text-green-700 mt-1">
                  Table: <code className="bg-green-100 px-1 rounded">{e.db_table}</code> • {e.count} équipements
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// PAGE PRINCIPALE - CORRIGÉE
// ============================================================================

export default function ControlsPage() {
  const [tab, setTab] = useState("tree");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedTask, setSelectedTask] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pendingPlacement, setPendingPlacement] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = () => setRefreshTrigger((t) => t + 1);

  // ✅ CORRECTION : Gestion robuste du placement
  const handlePlaceEquipment = (equipment) => {
    if (equipment.positioned) {
      // Déjà placé : zoom direct
      setSelectedPlan({ 
        logical_name: equipment.building,
        display_name: equipment.building,
      });
      setPendingPlacement(null);
      setShowMap(true);
    } else {
      // Pas encore placé : mode placement
      setSelectedPlan({ 
        logical_name: equipment.building,
        display_name: equipment.building,
      });
      setPendingPlacement(equipment);
      setShowMap(true);
    }
  };

  const handlePlacementComplete = () => {
    setPendingPlacement(null);
    handleRefresh();
  };

  // Auto-link au démarrage
  useEffect(() => {
    api.controls.autoLink().then(() => {
      console.log("[Controls] Auto-link completed");
      handleRefresh();
    });
  }, []);

  return (
    <section className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Contrôles (TSD)</h1>
          <div className="text-sm text-gray-500 mt-1">Maintenance, Inspection & Testing of Electrical Equipment</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Tâches ouvertes</option>
            <option value="done">Tâches terminées</option>
            <option value="all">Toutes</option>
          </select>
          <Button variant="secondary" size="sm" onClick={handleRefresh}>
            <RefreshCw size={14} /> Actualiser
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tree">Arborescence</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="missing">Équipements manquants</TabsTrigger>
        </TabsList>

        <TabsContent value="tree">
          <HierarchyTree
            statusFilter={statusFilter}
            onSelectTask={setSelectedTask}
            onPlaceEquipment={handlePlaceEquipment}
            onRefresh={handleRefresh}
          />
        </TabsContent>

        <TabsContent value="plans">
          <ControlsMapManager
            onPlanSelect={(plan) => {
              setSelectedPlan(plan);
              setPendingPlacement(null);
              setShowMap(true);
            }}
          />
        </TabsContent>

        <TabsContent value="missing">
          <MissingEquipment />
        </TabsContent>
      </Tabs>

      {selectedTask && (
        <TaskDetails
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onRefresh={handleRefresh}
        />
      )}

      {showMap && selectedPlan && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => {
            setShowMap(false);
            setPendingPlacement(null);
          }} />
          <div className="relative z-[6001] w-full max-w-7xl h-[90vh] mx-4">
            <Card className="h-full flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <div className="font-semibold">
                  Plan - {selectedPlan.display_name || selectedPlan.logical_name}
                  {pendingPlacement && (
                    <span className="ml-3 text-sm text-amber-600">
                      Mode placement : {pendingPlacement.label}
                    </span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => {
                  setShowMap(false);
                  setPendingPlacement(null);
                }}>
                  Fermer
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ControlsMap
                  plan={selectedPlan}
                  building={selectedPlan.logical_name}
                  onSelectTask={(task) => {
                    setSelectedTask(task);
                  }}
                  pendingPlacement={pendingPlacement}
                  onPlacementComplete={handlePlacementComplete}
                  inModal={false}
                />
              </div>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
