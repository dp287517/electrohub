// ============================================================================
// Controls.jsx - v2 FULL REWRITE (Arborescence + IA + Plans + TSD)
// ============================================================================

import React, { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Upload,
  Paperclip,
  Calendar,
  Wand2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  MapPin,
  Loader2,
} from "lucide-react";
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

function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center font-semibold rounded-lg transition-all disabled:opacity-50 gap-2";
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
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={`bg-white shadow-sm rounded-xl border border-gray-200 ${className}`}
    >
      {children}
    </div>
  );
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
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${variants[variant]}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// HELPERS & FORMATAGE
// ============================================================================

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  const map = {
    planned: { variant: "success", icon: Clock, label: "Planifié" },
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
//
// CHECKLIST (schéma issu de la tsd_library, coté backend)
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
        <div className="text-sm font-semibold mb-2">
          Checklist (TSD – {schema?.tsd_code || "?"})
        </div>
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
                onChange={(e) =>
                  setObs((s) => ({ ...s, [o.key]: e.target.value }))
                }
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
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
          />
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

      <Button
        onClick={submit}
        disabled={!allFilled || busy}
        variant="success"
        className="w-full"
      >
        {busy ? "Enregistrement..." : "Clôturer & Replanifier"}
      </Button>

      {schema?.notes && (
        <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">
          {schema.notes}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DÉTAILS D'UNE TÂCHE + ASSISTANT IA (par tâche)
// ============================================================================

function TaskDetails({ task, onClose, onRefresh }) {
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  // 🔽 nouveaux
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  useEffect(() => {
    if (!task) return;
    setSchema(null);
    setAiAnswer("");
    setAiQuestion("");

    // 1) Schéma TSD
    api.controls
      .taskSchema(task.id)
      .then(setSchema)
      .catch((e) => {
        console.error("[TaskDetails] schema error:", e);
      });

    // 2) Historique
    setHistory([]);
    setHistoryLoading(true);
    api.controls
      .taskHistory(task.id)
      .then((res) => {
        const items = Array.isArray(res?.items) ? res.items : res || [];
        setHistory(items);
      })
      .catch((e) => {
        console.error("[TaskDetails] history error:", e);
      })
      .finally(() => setHistoryLoading(false));

    // 3) Pièces jointes / photos
    setAttachments([]);
    setAttachmentsLoading(true);

    if (task.entity_id && task.entity_type) {
      api.controls
        .listAttachments({
          entityId: task.entity_id,
          entityType: task.entity_type,
        })
        .then((res) => {
          const items = Array.isArray(res?.items) ? res.items : res || [];
          setAttachments(items);
        })
        .catch((e) => {
          console.error("[TaskDetails] attachments error:", e);
        })
        .finally(() => setAttachmentsLoading(false));
    } else {
      setAttachmentsLoading(false);
    }
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

  const submitAutoAnalysis = async () => {
    if (!task) return;
    setAiLoading(true);
    setAiAnswer("");
    try {
      const res = await api.controls.analyze({ taskId: task.id });
      const text =
        res?.answer ||
        res?.analysis ||
        res?.text ||
        (typeof res === "string" ? res : JSON.stringify(res, null, 2));
      setAiAnswer(text);
    } catch (e) {
      console.error("[TaskDetails] AI analyze error:", e);
      setAiAnswer(
        "Erreur lors de l'analyse IA. Vérifie que le backend IA des contrôles est bien configuré."
      );
    } finally {
      setAiLoading(false);
    }
  };

  const askAi = async () => {
    if (!task || !aiQuestion.trim()) return;
    setAiLoading(true);
    try {
      const res = await api.controls.assistant({
        taskId: task.id,
        question: aiQuestion.trim(),
      });
      const text =
        res?.answer ||
        res?.text ||
        (typeof res === "string" ? res : JSON.stringify(res, null, 2));
      setAiAnswer(text);
    } catch (e) {
      console.error("[TaskDetails] AI assistant error:", e);
      setAiAnswer(
        "Erreur lors de la réponse IA. Vérifie que le backend IA des contrôles est bien configuré."
      );
    } finally {
      setAiLoading(false);
    }
  };

  if (!task) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-semibold text-lg">
              {task.task_name || task.label}
            </div>
            <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
              <span>Échéance: {fmtDate(task.next_control)}</span>
              <span>•</span>
              <StatusPill status={task.status} />
            </div>
            {task.tsd_code && (
              <div className="text-[11px] text-indigo-600 mt-1">
                TSD: {task.tsd_code} – {task.control_type || "Contrôle"}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>

        <div className="p-4 grid md:grid-cols-2 gap-6">
          <div>
            {!schema && (
              <div className="text-gray-500">Chargement du schéma TSD...</div>
            )}
            {schema && (
              <Checklist schema={schema} onSubmit={submit} busy={busy} />
            )}
          </div>

          {/* Panneau IA */}
          <div className="md:border-l md:pl-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Wand2 size={18} className="text-indigo-500" />
                Assistant IA (sécurité / contrôle)
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={submitAutoAnalysis}
                disabled={aiLoading}
              >
                <Calendar size={14} />
                {aiLoading ? "Analyse..." : "Analyser la tâche"}
              </Button>
            </div>

          {/* Historique des contrôles */}
            <div className="px-4 pb-4 border-t mt-2">
              <div className="text-sm font-semibold mb-2">
                Historique des contrôles
              </div>

              {historyLoading && (
                <div className="text-xs text-gray-500">Chargement...</div>
              )}

              {!historyLoading && history.length === 0 && (
                <div className="text-xs text-gray-400">
                  Aucun contrôle réalisé pour le moment.
                </div>
              )}

              {!historyLoading && history.length > 0 && (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="border rounded-lg px-3 py-2 bg-gray-50 text-xs flex flex-col gap-1"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">
                          {fmtDate(h.performed_at)}
                        </span>
                        <span className="text-[11px] text-gray-600">
                          Statut : {h.result_status || "—"}
                        </span>
                      </div>
                      {h.comments && (
                        <div className="text-gray-700">
                          <span className="font-medium">Commentaire : </span>
                          {h.comments}
                        </div>
                      )}
                      {Array.isArray(h.checklist_result) && h.checklist_result.length > 0 && (
                        <div className="text-gray-600">
                          <span className="font-medium">Checklist : </span>
                          {h.checklist_result.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pièces jointes / Photos */}
            <div className="px-4 pb-4 border-t mt-2">
              <div className="text-sm font-semibold mb-2">
                Pièces jointes / Photos (équipement)
              </div>

              {attachmentsLoading && (
                <div className="text-xs text-gray-500">Chargement...</div>
              )}

              {!attachmentsLoading && attachments.length === 0 && (
                <div className="text-xs text-gray-400">
                  Aucune pièce jointe pour cet équipement pour l&apos;instant.
                </div>
              )}

              {!attachmentsLoading && attachments.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1 text-xs">
                  {attachments.map((f) => {
                    const isImage = (f.mime_type || "").startsWith("image/");
                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 border rounded-lg px-2 py-1 bg-white"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span>{isImage ? "📷" : "📎"}</span>
                          <span className="truncate" title={f.filename}>
                            {f.filename}
                          </span>
                        </div>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline shrink-0"
                        >
                          Ouvrir
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500">
              L&apos;assistant IA peut t&apos;aider à résumer la situation,
              repérer les points de vigilance, proposer des priorités d&apos;action
              ou répondre à tes questions sur ce contrôle précis.
            </p>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-600">
                Poser une question à l&apos;IA
              </div>
              <textarea
                rows={4}
                className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10 text-sm"
                placeholder="Ex : Quels sont les risques principaux pour cet équipement ? Quelles recommandations de sécurité proposer ?"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={askAi}
                  disabled={aiLoading || !aiQuestion.trim()}
                >
                  <Wand2 size={14} />
                  Envoyer à l&apos;IA
                </Button>
              </div>
            </div>

            {aiAnswer && (
              <div className="mt-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs whitespace-pre-wrap text-gray-800">
                {aiAnswer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TREE NODE (briques de l'arborescence)
// ============================================================================

function TreeNode({
  title,
  count,
  equipmentCount,
  open,
  toggle,
  level = 0,
  children,
  positioned,
  needsPosition,
  inheritsPosition,
  onPlanClick,
  building,
  entity,
  focusEntity,
}) {
  const hasPlanInfo = positioned || needsPosition || inheritsPosition;

  const isFocused =
    focusEntity &&
    entity &&
    String(focusEntity.entity_type || "").toLowerCase() ===
      String(entity.entity_type || "").toLowerCase() &&
    String(focusEntity.entity_id) === String(
      entity.entity_id || entity.id
    );

  return (
    <div>
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer border ${
          isFocused
            ? "bg-indigo-100 border-indigo-300"
            : open
            ? "bg-indigo-50 border-transparent"
            : "hover:bg-gray-50 border-transparent"
        }`}
        onClick={toggle}
        style={{ marginLeft: level * 12 }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-semibold text-sm truncate">{title}</span>

          {hasPlanInfo && (
            <button
              className={`ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${
                needsPosition
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onPlanClick?.();
              }}
            >
              <MapPin size={12} />
              {needsPosition
                ? "À placer sur un plan"
                : inheritsPosition
                ? "Hérite du plan parent"
                : `Sur un plan${building ? ` (${building})` : ""}`}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {typeof equipmentCount === "number" && equipmentCount > 0 && (
            <Badge variant="info">{equipmentCount} équip.</Badge>
          )}
          {typeof count === "number" && count > 0 && (
            <Badge variant="default">{count} ctrl.</Badge>
          )}
        </div>
      </div>
      {open && <div className="ml-4">{children}</div>}
    </div>
  );
}


// ============================================================================
// ARBORESCENCE (bâtiments / HV / TGBT / devices)
// ============================================================================

function HierarchyTree({
  statusFilter,
  onSelectTask,
  onPlanAction,
  refreshKey,
  focusEntity,
  textFilter = "",
  planFilter = "all",
  typeFilter = "all",
}) {
  const [tree, setTree] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const normalizedText = textFilter.trim().toLowerCase();

  const matchesText = (label, extra = "") => {
    if (!normalizedText) return true;
    const hay = `${label || ""} ${extra || ""}`.toLowerCase();
    return hay.includes(normalizedText);
  };

  const matchesPlanFilter = (item) => {
    const hasPlan = !!(
      item?.plan_id ||
      item?.plan_logical_name ||
      item?.main_plan_id ||
      item?.main_plan_logical_name
    );
    if (planFilter === "with") return hasPlan;
    if (planFilter === "without") return !hasPlan;
    return true;
  };


  useEffect(() => {
    loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, refreshKey]);

  const loadTree = async () => {
    setLoading(true);
    try {
      const data = await api.controls.hierarchyTree({ status: statusFilter });
      setTree(data);
    } catch (e) {
      console.error("[HierarchyTree] error:", e);
      setTree({ buildings: [] });
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key) =>
    setExpanded((s) => ({ ...s, [key]: !s[key] }));

  const countTasksForFilter = (tasks) => {
    if (!Array.isArray(tasks)) return 0;
    if (statusFilter === "all") return tasks.length;
    const openStatuses = ["Planned", "Pending", "Overdue"];
    const doneStatuses = ["Done"];
    return tasks.filter((t) =>
      statusFilter === "open"
        ? openStatuses.includes(t.status)
        : doneStatuses.includes(t.status)
    ).length;
  };

  if (loading && !tree) return <div className="text-gray-500">Chargement...</div>;
  if (!tree) return <div className="text-gray-500">Aucune donnée.</div>;

  return (
    <div className="space-y-3">
      {tree.buildings?.map((b, bi) => {
        const kB = `b-${bi}`;
        const hvItemsRaw = b.hv || [];
        const swItemsRaw = b.switchboards || [];

        // 🔽 filtration HV/LV + texte + plan
        const hvItems =
          typeFilter === "lv"
            ? []
            : hvItemsRaw.filter(
                (hv) =>
                  matchesText(hv.label) &&
                  matchesPlanFilter(hv)
              );

        const swItems =
          typeFilter === "hv"
            ? []
            : swItemsRaw.filter(
                (sb) =>
                  matchesText(sb.label) &&
                  matchesPlanFilter(sb)
              );

        // Compteurs par tâches
        const hvTaskCount = hvItems.reduce(
          (a, hv) =>
            a +
            countTasksForFilter(hv.tasks) +
            (hv.devices || []).reduce(
              (x, d) => x + countTasksForFilter(d.tasks),
              0
            ),
          0
        );
        const swTaskCount = swItems.reduce(
          (a, sb) =>
            a +
            countTasksForFilter(sb.tasks) +
            (sb.devices || []).reduce(
              (x, d) => x + countTasksForFilter(d.tasks),
              0
            ),
          0
        );

        // Compteurs par équipements
        const hvEquipCount = hvItems.reduce(
          (a, hv) => a + 1 + (hv.devices?.length || 0),
          0
        );
        const swEquipCount = swItems.reduce(
          (a, sb) => a + 1 + (sb.devices?.length || 0),
          0
        );

        if (hvItems.length === 0 && swItems.length === 0) return null;

        const buildingLabel = b.label;

        return (
          <Card key={kB}>
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between border-b">
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold">{buildingLabel}</div>
              </div>
              <div className="text-xs text-gray-600 flex flex-wrap gap-3">
                {hvEquipCount > 0 && (
                  <span>
                    HV: {hvEquipCount} équip. – {hvTaskCount} ctrl.
                  </span>
                )}
                {swEquipCount > 0 && (
                  <span>
                    TGBT/DB: {swEquipCount} équip. – {swTaskCount} ctrl.
                  </span>
                )}
              </div>
            </div>

            <CardContent className="p-3 space-y-2">
              {/* HIGH VOLTAGE */}
              {hvItems.length > 0 && (
                <TreeNode
                  title="High Voltage"
                  count={hvTaskCount}
                  equipmentCount={hvEquipCount}
                  open={expanded[`${kB}-hv`]}
                  toggle={() => toggle(`${kB}-hv`)}
                  building={buildingLabel}
                  focusEntity={focusEntity}
                >
                  {hvItems.map((eq, i) => {
                    const hvEquipTaskCount = countTasksForFilter(eq.tasks);
                    const hvEquipEquipCount =
                      1 + (eq.devices?.length || 0);

                    const handlePlanClick = () =>
                      onPlanAction?.({
                        entity_id: eq.id,
                        entity_type: eq.entity_type || "hvequipment",
                        label: eq.label,
                        building: buildingLabel,
                        building_code: eq.building_code || buildingLabel,
                        positioned: eq.positioned,
                        plan_id: eq.plan_id || eq.main_plan_id,
                        plan_logical_name:
                          eq.plan_logical_name || eq.main_plan_logical_name,
                        plan_display_name:
                          eq.plan_display_name || eq.main_plan_display_name,
                      });

                    return (
                      <TreeNode
                        key={eq.id || i}
                        title={eq.label}
                        count={hvEquipTaskCount}
                        equipmentCount={hvEquipEquipCount}
                        open={expanded[`hv-${bi}-${i}`]}
                        toggle={() => toggle(`hv-${bi}-${i}`)}
                        level={1}
                        positioned={eq.positioned}
                        needsPosition={!eq.positioned && hvEquipTaskCount > 0}
                        inheritsPosition={false}
                        building={buildingLabel}
                        onPlanClick={handlePlanClick}
                        entity={eq}
                        focusEntity={focusEntity}
                      >
                        {/* Tâches HV */}
                        {eq.tasks?.map((t) => (
                          <div
                            key={t.id}
                            onClick={() => onSelectTask(t)}
                            className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                          >
                            <div className="flex flex-col">
                              <span>{t.task_name}</span>
                              {t.tsd_code && (
                                <span className="text-[11px] text-gray-500">
                                  {t.tsd_code} • {t.control_type || "Contrôle"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={t.status} />
                              <span className="text-xs text-gray-500">
                                {fmtDate(t.next_control)}
                              </span>
                            </div>
                          </div>
                        ))}

                        {/* Devices HV */}
                        {(eq.devices || []).map((d, di) => {
                          const deviceTaskCount = countTasksForFilter(
                            d.tasks
                          );
                          const inheritsPosition =
                            !d.positioned && eq.positioned;
                          const positioned = d.positioned || inheritsPosition;

                          const planPayloadBase = {
                            building: buildingLabel,
                            building_code: d.building_code || eq.building_code || buildingLabel,
                            plan_id:
                              d.plan_id ||
                              d.main_plan_id ||
                              eq.plan_id ||
                              eq.main_plan_id,
                            plan_logical_name:
                              d.plan_logical_name ||
                              d.main_plan_logical_name ||
                              eq.plan_logical_name ||
                              eq.main_plan_logical_name,
                            plan_display_name:
                              d.plan_display_name ||
                              d.main_plan_display_name ||
                              eq.plan_display_name ||
                              eq.main_plan_display_name,
                          };

                          const handlePlanClickDevice = () => {
                            if (inheritsPosition) {
                              onPlanAction?.({
                                entity_id: eq.id,
                                entity_type: eq.entity_type || "hvequipment",
                                label: eq.label,
                                positioned: eq.positioned,
                                ...planPayloadBase,
                              });
                            } else {
                              onPlanAction?.({
                                entity_id: d.id,
                                entity_type: d.entity_type || "hvdevice",
                                label: d.label,
                                positioned: positioned,
                                ...planPayloadBase,
                              });
                            }
                          };

                          return (
                            <TreeNode
                              key={d.id || di}
                              title={
                                inheritsPosition
                                  ? `${d.label} (hérite position)`
                                  : d.label
                              }
                              count={deviceTaskCount}
                              equipmentCount={1}
                              open={expanded[`hv-dev-${bi}-${i}-${di}`] || false}
                              toggle={() => toggle(`hv-dev-${bi}-${i}-${di}`)}
                              level={2}
                              positioned={positioned}
                              needsPosition={!positioned && deviceTaskCount > 0}
                              inheritsPosition={inheritsPosition}
                              building={buildingLabel}
                              onPlanClick={handlePlanClickDevice}
                              entity={d}
                              focusEntity={focusEntity}
                            >
                              {d.tasks?.map((t) => (
                                <div
                                  key={t.id}
                                  onClick={() => onSelectTask(t)}
                                  className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                                >
                                  <div className="flex flex-col">
                                    <span>{t.task_name}</span>
                                    {t.tsd_code && (
                                      <span className="text-[11px] text-gray-500">
                                        {t.tsd_code} •{" "}
                                        {t.control_type || "Contrôle"}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <StatusPill status={t.status} />
                                    <span className="text-xs text-gray-500">
                                      {fmtDate(t.next_control)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </TreeNode>
                          );
                        })}
                      </TreeNode>
                    );
                  })}
                </TreeNode>
              )}

              {/* SWITCHBOARDS */}
              {swItems.length > 0 && (
                <TreeNode
                  title="Switchboards"
                  count={swTaskCount}
                  equipmentCount={swEquipCount}
                  open={expanded[`${kB}-sb`]}
                  toggle={() => toggle(`${kB}-sb`)}
                  building={buildingLabel}
                  focusEntity={focusEntity}
                >
                  {swItems.map((sb, i) => {
                    const sbTaskCount = countTasksForFilter(sb.tasks);
                    const sbEquipCount = 1 + (sb.devices?.length || 0);

                    const handlePlanClickSwitchboard = () =>
                      onPlanAction?.({
                        entity_id: sb.id,
                        entity_type: sb.entity_type || "switchboard",
                        label: sb.label,
                        building: buildingLabel,
                        building_code: sb.building_code || buildingLabel,
                        positioned: sb.positioned,
                        plan_id: sb.plan_id || sb.main_plan_id,
                        plan_logical_name:
                          sb.plan_logical_name || sb.main_plan_logical_name,
                        plan_display_name:
                          sb.plan_display_name || sb.main_plan_display_name,
                      });

                    return (
                      <TreeNode
                        key={sb.id || i}
                        title={sb.label}
                        count={sbTaskCount}
                        equipmentCount={sbEquipCount}
                        open={expanded[`sb-${bi}-${i}`]}
                        toggle={() => toggle(`sb-${bi}-${i}`)}
                        level={1}
                        positioned={sb.positioned}
                        needsPosition={!sb.positioned && sbTaskCount > 0}
                        inheritsPosition={false}
                        building={buildingLabel}
                        onPlanClick={handlePlanClickSwitchboard}
                        entity={sb}
                        focusEntity={focusEntity}
                      >
                        {sb.tasks?.map((t) => (
                          <div
                            key={t.id}
                            onClick={() => onSelectTask(t)}
                            className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                          >
                            <div className="flex flex-col">
                              <span>{t.task_name}</span>
                              {t.tsd_code && (
                                <span className="text-[11px] text-gray-500">
                                  {t.tsd_code} • {t.control_type || "Contrôle"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={t.status} />
                              <span className="text-xs text-gray-500">
                                {fmtDate(t.next_control)}
                              </span>
                            </div>
                          </div>
                        ))}

                        {(sb.devices || []).map((d, di) => {
                          const devTaskCount = countTasksForFilter(d.tasks);
                          // Devices TGBT héritent toujours de la position du switchboard (backend)
                          const inheritsPosition = sb.positioned;
                          const positioned = inheritsPosition;

                          const handlePlanClickDevice = () =>
                            onPlanAction?.({
                              entity_id: sb.id,
                              entity_type: sb.entity_type || "switchboard",
                              label: sb.label,
                              building: buildingLabel,
                              building_code:
                                sb.building_code || buildingLabel,
                              positioned: sb.positioned,
                              plan_id:
                                d.plan_id ||
                                d.main_plan_id ||
                                sb.plan_id ||
                                sb.main_plan_id,
                              plan_logical_name:
                                d.plan_logical_name ||
                                d.main_plan_logical_name ||
                                sb.plan_logical_name ||
                                sb.main_plan_logical_name,
                              plan_display_name:
                                d.plan_display_name ||
                                d.main_plan_display_name ||
                                sb.plan_display_name ||
                                sb.main_plan_display_name,
                            });

                          return (
                            <TreeNode
                              key={d.id || di}
                              title={`${d.label} (hérite position)`}
                              count={devTaskCount}
                              equipmentCount={1}
                              open={expanded[`sb-dev-${bi}-${i}-${di}`] || false}
                              toggle={() => toggle(`sb-dev-${bi}-${i}-${di}`)}
                              level={2}
                              positioned={positioned}
                              needsPosition={!positioned && devTaskCount > 0}
                              inheritsPosition={inheritsPosition}
                              building={buildingLabel}
                              onPlanClick={handlePlanClickDevice}
                              entity={d}
                              focusEntity={focusEntity}
                            >
                              {d.tasks?.map((t) => (
                                <div
                                  key={t.id}
                                  onClick={() => onSelectTask(t)}
                                  className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-sm"
                                >
                                  <div className="flex flex-col">
                                    <span>{t.task_name}</span>
                                    {t.tsd_code && (
                                      <span className="text-[11px] text-gray-500">
                                        {t.tsd_code} •{" "}
                                        {t.control_type || "Contrôle"}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <StatusPill status={t.status} />
                                    <span className="text-xs text-gray-500">
                                      {fmtDate(t.next_control)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </TreeNode>
                          );
                        })}
                      </TreeNode>
                    );
                  })}
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
// ÉQUIPEMENTS MANQUANTS (DB vs tsd_library)
// ============================================================================

function MissingEquipment() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.controls
      .getMissingEquipment()
      .then(setData)
      .catch((e) => {
        console.error("[MissingEquipment] error:", e);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading && !data) return <div>Chargement...</div>;
  if (!data) return <div>Aucune donnée.</div>;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-amber-500" size={20} />
            <div className="font-semibold">Équipements non intégrés</div>
          </div>
          <div className="text-sm text-gray-600 mb-3">
            Catégories TSD sans table ou sans équipements en base. Crée-les
            pour activer les contrôles.
          </div>
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {data.missing?.map((m, i) => (
              <div
                key={i}
                className="p-3 bg-amber-50 border border-amber-200 rounded-lg"
              >
                <div className="font-medium text-amber-900">
                  {m.category}
                </div>
                <div className="text-xs text-amber-700 mt-1">
                  Table attendue :{" "}
                  <code className="bg-amber-100 px-1 rounded">
                    {m.db_table}
                  </code>{" "}
                  • {m.count_in_tsd} contrôles TSD
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
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {data.existing?.map((e, i) => (
              <div
                key={i}
                className="p-3 bg-green-50 border border-green-200 rounded-lg"
              >
                <div className="font-medium text-green-900">
                  {e.category}
                </div>
                <div className="text-xs text-green-700 mt-1">
                  Table :{" "}
                  <code className="bg-green-100 px-1 rounded">
                    {e.db_table}
                  </code>{" "}
                  • {e.count} équipements en base
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
// MODAL DE CHOIX DU PLAN POUR LE PLACEMENT
// ============================================================================

function PlanChoiceModal({
  open,
  onClose,
  equipment,
  onPlanChosen,
}) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.controls.listPlans();
        const list = Array.isArray(res?.plans)
          ? res.plans
          : Array.isArray(res)
          ? res
          : [];
        if (!cancelled) {
          setPlans(list);
          // auto-sélection : on essaie de matcher le bâtiment dans le logical_name
          const building = equipment?.building || equipment?.building_code || "";
          const auto =
            equipment &&
            list.find((p) =>
              (p.logical_name || "")
                .toString()
                .toLowerCase()
                .includes(String(building || "").toLowerCase())
            );
          setSelected(auto || list[0] || null);
        }
      } catch (e) {
        console.error("[PlanChoiceModal] listPlans error:", e);
        if (!cancelled) {
          setError("Impossible de récupérer la liste des plans.");
        }
      } finally {
        !cancelled && setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, equipment]);

  if (!open || !equipment) return null;

  const confirm = () => {
    if (!selected) {
      setError("Merci de choisir un plan.");
      return;
    }
    onPlanChosen?.(selected);
  };

  return (
    <div
      className="fixed inset-0 z-[5050] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold text-sm">
            Choisir un plan pour placer :{" "}
            <span className="text-indigo-600">{equipment.label}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
        <div className="p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="animate-spin" size={16} />
              Chargement des plans...
            </div>
          )}

          {!loading && plans.length === 0 && (
            <div className="text-sm text-red-600">
              Aucun plan n&apos;est encore disponible pour ce site.
            </div>
          )}

          {!loading && plans.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {plans.map((p) => {
                const key = p.id || p.logical_name;
                const name = p.display_name || p.logical_name || `#${key}`;
                const hint = p.logical_name || "";
                const isSel =
                  selected &&
                  (selected.id || selected.logical_name) === key;

                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${
                      isSel
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={isSel}
                      onChange={() => setSelected(p)}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{name}</span>
                      <span className="text-[11px] text-gray-500">
                        {hint}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={loading || !selected}
            >
              {loading ? "..." : "Ouvrir le plan et placer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PAGE PRINCIPALE
// ============================================================================

export default function ControlsPage() {
  const [tab, setTab] = useState("tree");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedTask, setSelectedTask] = useState(null);
  const [textFilter, setTextFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("all"); // all | with | without
  const [typeFilter, setTypeFilter] = useState("all"); // all | hv | lv

  const [showMap, setShowMap] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [pendingPlacement, setPendingPlacement] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [focusEntity, setFocusEntity] = useState(null);

  // Sync TSD ↔ DB (génération / mise à jour des tâches)
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Choix du plan pour placement
  const [planChoiceOpen, setPlanChoiceOpen] = useState(false);
  const [planChoiceEquipment, setPlanChoiceEquipment] = useState(null);

  const handleRefresh = () =>
    setRefreshTrigger((t) => t + 1);

  useEffect(() => {
    handleRefresh();
  }, []);

  const handleSyncTSD = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await api.controls.autoLink();
      setSyncMsg(
        res?.message ||
          "Synchronisation TSD / équipements effectuée. Les tâches ont été mises à jour."
      );
      handleRefresh();
    } catch (e) {
      console.error("[Controls] autoLink error:", e);
      setSyncMsg(
        e?.message ||
          "Erreur lors de la synchronisation TSD / équipements."
      );
    } finally {
      setSyncing(false);
    }
  };

  // Gestion du clic sur l'icône plan dans l'arborescence
  const handlePlanActionFromTree = (equipment) => {
    if (!equipment) return;

    const entityId = equipment.entity_id || equipment.id;
    const entityType = equipment.entity_type || "device";

    // Normalisation du plan côté équipement si le backend le fournit
    const planId =
      equipment.plan_id ||
      equipment.main_plan_id ||
      null;
    const planLogicalName =
      equipment.plan_logical_name ||
      equipment.main_plan_logical_name ||
      null;
    const planDisplayName =
      equipment.plan_display_name ||
      equipment.main_plan_display_name ||
      planLogicalName ||
      equipment.building ||
      equipment.building_code ||
      "";

    const building =
      equipment.building ||
      equipment.building_code ||
      "";

    // Équipement pas encore positionné : on passe par la modale
    if (!equipment.positioned) {
      setFocusEntity({ entity_id: entityId, entity_type: entityType });
      setPlanChoiceEquipment({
        ...equipment,
        entity_id: entityId,
        entity_type: entityType,
        building,
      });
      setPlanChoiceOpen(true);
      return;
    }

    // Équipement positionné et plan connu côté backend
    if (planId || planLogicalName) {
      setSelectedPlan({
        id: planId || undefined,
        logical_name: planLogicalName || undefined,
        display_name: planDisplayName,
        building,
      });
      setPendingPlacement(null); // mode visualisation
      setFocusEntity({ entity_id: entityId, entity_type: entityType });
      setShowMap(true);
      return;
    }

    // Équipement positionné mais sans info de plan précise : fallback → modale
    setFocusEntity({ entity_id: entityId, entity_type: entityType });
    setPlanChoiceEquipment({
      ...equipment,
      entity_id: entityId,
      entity_type: entityType,
      building,
    });
    setPlanChoiceOpen(true);
  };

  const handlePlanChosen = (plan) => {
    if (!plan || !planChoiceEquipment) return;

    const eq = planChoiceEquipment;
    const entityId = eq.entity_id || eq.id;
    const entityType = eq.entity_type || "device";
    const building =
      eq.building || eq.building_code || plan.display_name || plan.logical_name;

    setSelectedPlan({
      id: plan.id,
      logical_name: plan.logical_name,
      display_name: plan.display_name || plan.logical_name || building,
      building,
    });

    // Mode placement: on passe l'équipement à la carte
    setPendingPlacement({
      ...eq,
      entity_id: entityId,
      entity_type: entityType,
      building,
    });

    setFocusEntity({ entity_id: entityId, entity_type: entityType });

    setPlanChoiceOpen(false);
    setPlanChoiceEquipment(null);
    setShowMap(true);
  };

  const handlePlacementComplete = () => {
    setPendingPlacement(null);
    handleRefresh();
  };

  const closeMap = () => {
    setShowMap(false);
    setPendingPlacement(null);
    setFocusEntity(null);
  };

  return (
    <section className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Contrôles (TSD)</h1>
          <div className="text-sm text-gray-500 mt-1">
            Maintenance, Inspection & Testing of Electrical Equipment
          </div>
          {syncMsg && (
            <div className="mt-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded">
              {syncMsg}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Tâches ouvertes</option>
            <option value="done">Tâches terminées</option>
            <option value="all">Toutes</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={syncing}
          >
            <RefreshCw size={14} /> Actualiser
          </Button>
          <Button
            variant="warning"
            size="sm"
            onClick={handleSyncTSD}
            disabled={syncing}
          >
            {syncing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Sync TSD...
              </>
            ) : (
              <>
                <Wand2 size={14} /> Sync TSD ↔ DB
              </>
            )}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tree">Arborescence</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="missing">Équipements manquants</TabsTrigger>
        </TabsList>

        {/* 🔽 barre de filtres globale */}
        <div className="flex flex-wrap gap-2 mt-2">
          <input
            type="text"
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm min-w-[200px]"
            placeholder="Filtrer par texte (équipement, tâche...)"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />

          <select
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
          >
            <option value="all">Tous les équipements</option>
            <option value="with">Avec plan</option>
            <option value="without">Sans plan</option>
          </select>

          <select
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">HV + TGBT/DB</option>
            <option value="hv">High Voltage uniquement</option>
            <option value="lv">TGBT / DB uniquement</option>
          </select>
        </div>

        {/* Onglet Arborescence */}
        <TabsContent value="tree">
          <HierarchyTree
            statusFilter={statusFilter}
            onSelectTask={setSelectedTask}
            onPlanAction={handlePlanActionFromTree}
            refreshKey={refreshTrigger}
            textFilter={textFilter}
            planFilter={planFilter}
            typeFilter={typeFilter}
          />
        </TabsContent>

        {/* Onglet Plans */}
        <TabsContent value="plans">
          <ControlsMapManager
            onPlanSelect={(plan) => {
              setSelectedPlan({
                ...plan,
                building: plan.building_code || plan.display_name || plan.logical_name,
              });
              setPendingPlacement(null);
              setFocusEntity(null);
              setShowMap(true);
            }}
          />
        </TabsContent>

        {/* Onglet Équipements manquants / cohérence TSD */}
        <TabsContent value="missing">
          <MissingEquipment />
        </TabsContent>
      </Tabs>

      {/* Détails de tâche + IA */}
      {selectedTask && (
        <TaskDetails
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onRefresh={handleRefresh}
        />
      )}

      {/* Modal choix de plan pour placement */}
      <PlanChoiceModal
        open={planChoiceOpen}
        onClose={() => {
          setPlanChoiceOpen(false);
          setPlanChoiceEquipment(null);
        }}
        equipment={planChoiceEquipment}
        onPlanChosen={handlePlanChosen}
      />

      {/* Carte / plan en plein écran */}
      {showMap && selectedPlan && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeMap}
          />
          <div className="relative z-[6001] w-full max-w-7xl h-[90vh] mx-4">
            <Card className="h-full flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <div className="font-semibold text-sm">
                  Plan –{" "}
                  {selectedPlan.display_name ||
                    selectedPlan.logical_name}
                  {pendingPlacement && (
                    <span className="ml-3 text-sm text-amber-600">
                      Mode placement : {pendingPlacement.label}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeMap}
                >
                  Fermer
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ControlsMap
                  plan={selectedPlan}
                  building={
                    selectedPlan.building ||
                    selectedPlan.logical_name
                  }
                  onSelectTask={(task) => {
                    setSelectedTask(task);
                    if (task?.entity_id && task?.entity_type) {
                      setTab("tree");
                      setFocusEntity({
                        entity_id: task.entity_id,
                        entity_type: task.entity_type,
                      });
                    }
                  }}
                  pendingPlacement={pendingPlacement}
                  onPlacementComplete={handlePlacementComplete}
                  focusEntity={focusEntity}
                  inModal={false}
                  statusFilter={statusFilter}
                />
              </div>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
