// ============================================================================
// src/pages/Controls.jsx — version finale corrigée et autonome
// Intègre Tabs, Button, Card, Modal "Vue plan" + interop avec Controls-map.jsx
// ============================================================================

import React, { useEffect, useState } from "react";
import ControlsMap from "./Controls-map.jsx";
import { api } from "../lib/api.js";
import {
  ChevronRight,
  ChevronDown,
  Upload,
  Paperclip,
  Calendar,
  Wand2,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

import "../styles/controls.css";

// ---------------------------------------------------------------------------
// Composants UI intégrés (Tabs, Button, Card)
// ---------------------------------------------------------------------------
export function Tabs({ value, onValueChange, children }) {
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
export function TabsList({ children }) {
  return <div className="flex flex-wrap gap-2 mt-2">{children}</div>;
}
export function TabsTrigger({ value, children, active, onValueChange }) {
  const selected = active === value;
  return (
    <button
      onClick={() => onValueChange(value)}
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
export function TabsContent({ value, active, children }) {
  if (value !== active) return null;
  return <div className="fade-in-up mt-4">{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center font-semibold rounded-lg transition-all disabled:opacity-50";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100",
  };
  const sizes = {
    sm: "px-2.5 py-1.5 text-sm",
    md: "px-3.5 py-2 text-sm",
  };
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div
      className={`bg-white shadow-sm rounded-xl border border-gray-200 ${className}`}
    >
      {children}
    </div>
  );
}
export function CardContent({ children, className = "" }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Helpers simples
// ---------------------------------------------------------------------------
const Pill = ({ children }) => (
  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
    {children}
  </span>
);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
function StatusPill({ s }) {
  const v = String(s || "").toLowerCase();
  const map = {
    done: "bg-green-100 text-green-700",
    closed: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
    pending: "bg-amber-100 text-amber-700",
  };
  const cls = map[v] || "bg-blue-100 text-blue-700";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}
    >
      {s || "Planned"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Checklist dynamique
// ---------------------------------------------------------------------------
function Checklist({ schema, onSubmit }) {
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

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold mb-2">Checklist</div>
        <div className="space-y-2">
          {schema?.checklist?.map((q) => (
            <div key={q.key} className="flex items-center gap-3">
              <div className="flex-1 text-sm">{q.label}</div>
              <select
                className="p-2 rounded-lg bg-white ring-1 ring-black/10"
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

      <div>
        <div className="text-sm font-semibold mb-2">Observations</div>
        {(schema?.observations || []).map((o) => (
          <div key={o.key} className="mb-2">
            <div className="text-xs text-gray-600">{o.label}</div>
            <input
              className="observation-input"
              value={obs[o.key] || ""}
              onChange={(e) =>
                setObs((s) => ({ ...s, [o.key]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs text-gray-600 mb-1">Commentaire</div>
        <textarea
          rows={3}
          className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div>
        <label className="inline-flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer w-fit">
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
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        Clôturer & replanifier
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Détails d'une tâche
// ---------------------------------------------------------------------------
function Details({ task, refresh }) {
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    api.controls.taskSchema(task.id).then(setSchema).catch(console.error);
  }, [task]);

  const submit = async ({ items, obs, files, comment }) => {
    setBusy(true);
    try {
      for (const f of files) {
        await api.controls.attachToTask(task.id, f).catch(() => {});
      }
      await api.controls.closeTask(task.id, {
        record_status: "done",
        checklist: items,
        observations: obs,
        comment,
        closed_at: new Date().toISOString(),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!task)
    return <div className="text-gray-500">Sélectionne une tâche à droite.</div>;
  if (!schema) return <div>Chargement…</div>;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <div className="text-xs text-gray-500">Tâche</div>
          <div className="text-lg font-semibold">{task.label}</div>
          <div className="text-xs text-gray-500">
            Échéance: {fmtDate(task.next_control)}{" "}
            <span className="ml-2">
              <StatusPill s={task.status} />
            </span>
          </div>
        </div>

        <Checklist schema={schema} onSubmit={submit} />

        <div className="ia-panel">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 className="text-violet-600" size={16} />
            <div className="font-semibold">IA (avant intervention)</div>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              await api.controls.analyze(task.id);
            }}
          >
            <Wand2 size={16} /> Lancer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tree hiérarchique + bouton Vue plan intégré
// ---------------------------------------------------------------------------
function NodeHeader({ title, count, open, toggle, level = 0 }) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg ${
        open ? "bg-gray-100" : "hover:bg-gray-50"
      } cursor-pointer`}
      onClick={toggle}
      style={{ marginLeft: level * 12 }}
    >
      <div className="flex items-center gap-2">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="font-semibold">{title}</span>
      </div>
      <Pill>{count}</Pill>
    </div>
  );
}

function Tree({ statusFilter, onSelect, onShowPlan }) {
  const [tree, setTree] = useState([]);
  const [exp, setExp] = useState({});

  const toggle = (k) => setExp((s) => ({ ...s, [k]: !s[k] }));

  const refresh = async () => {
    const r = await api.controls.hierarchyTree();
    setTree(r || []);
  };

  useEffect(() => {
    refresh();
  }, []);

  const count = (tasks = []) => {
    if (statusFilter === "all") return tasks.length;
    const open = ["Planned", "Pending", "Overdue"];
    const done = ["Done", "Closed"];
    return (tasks || []).filter((t) =>
      statusFilter === "open" ? open.includes(t.status) : done.includes(t.status)
    ).length;
  };

  return (
    <div className="space-y-3">
      {tree.map((b, bi) => {
        const kB = `b-${bi}`;
        const oB = !!exp[kB];
        const hvCount = (b.hv || []).reduce((a, n) => a + count(n.tasks), 0);
        const swCount = (b.switchboards || []).reduce(
          (a, sb) =>
            a +
            count(sb.tasks) +
            (sb.devices || []).reduce((x, d) => x + count(d.tasks), 0),
          0
        );
        return (
          <div key={kB} className="border rounded-xl">
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold">{b.label}</div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onShowPlan({
                      id: b.label,
                      display_name: b.label,
                      url_pdf: `/plans/${b.label.replace(/\s+/g, "_")}.pdf`,
                    })
                  }
                >
                  Vue plan
                </Button>
              </div>
              <div className="text-xs text-gray-500">
                HV {hvCount} • Switchboards {swCount}
              </div>
            </div>

            {/* Contenu bâtiment */}
            <div className="p-3 space-y-2">
              {/* HV */}
              <NodeHeader
                title="High Voltage"
                count={hvCount}
                open={oB && exp[`${kB}-hv`]}
                toggle={() => {
                  toggle(kB);
                  toggle(`${kB}-hv`);
                }}
              />
              {oB &&
                exp[`${kB}-hv`] &&
                b.hv.map((n, i) => (
                  <div key={i} className="pl-4">
                    <NodeHeader
                      title={n.label}
                      count={count(n.tasks)}
                      open={exp[`hv-${i}`]}
                      toggle={() => toggle(`hv-${i}`)}
                      level={1}
                    />
                    {exp[`hv-${i}`] &&
                      n.tasks.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onSelect(t)}
                          className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between"
                        >
                          <div className="text-sm">{t.label}</div>
                          <div className="flex items-center gap-2">
                            <StatusPill s={t.status} />
                            <span className="text-xs text-gray-500">
                              {fmtDate(t.next_control)}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                ))}

              {/* Switchboards */}
              <NodeHeader
                title="Switchboards"
                count={swCount}
                open={oB && exp[`${kB}-sb`]}
                toggle={() => {
                  toggle(kB);
                  toggle(`${kB}-sb`);
                }}
              />
              {oB &&
                exp[`${kB}-sb`] &&
                b.switchboards.map((sb, si) => (
                  <div key={si} className="pl-4">
                    <NodeHeader
                      title={sb.label}
                      count={count(sb.tasks)}
                      open={exp[`sb-${si}`]}
                      toggle={() => toggle(`sb-${si}`)}
                      level={1}
                    />
                    {exp[`sb-${si}`] &&
                      sb.tasks.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => onSelect(t)}
                          className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between"
                        >
                          <div className="text-sm">{t.label}</div>
                          <div className="flex items-center gap-2">
                            <StatusPill s={t.status} />
                            <span className="text-xs text-gray-500">
                              {fmtDate(t.next_control)}
                            </span>
                          </div>
                        </div>
                      ))}
                    {sb.devices?.map((d, di) => (
                      <div key={di} className="pl-6">
                        <NodeHeader
                          title={`Device — ${d.label}`}
                          count={count(d.tasks)}
                          open={exp[`d-${si}-${di}`]}
                          toggle={() => toggle(`d-${si}-${di}`)}
                          level={2}
                        />
                        {exp[`d-${si}-${di}`] &&
                          d.tasks.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => onSelect(t)}
                              className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between"
                            >
                              <div className="text-sm">{t.label}</div>
                              <div className="flex items-center gap-2">
                                <StatusPill s={t.status} />
                                <span className="text-xs text-gray-500">
                                  {fmtDate(t.next_control)}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt (Chart.js version, cohérente avec Obsolescence.jsx)
// ---------------------------------------------------------------------------
function Gantt() {
  const [data, setData] = useState({ labels: [], datasets: [] });

  const load = async () => {
    try {
      const r = await api.controls.timeline();
      const tasks = Array.isArray(r.items) ? r.items : [];
      const labels = tasks.map((t) => t.label);
      const days = tasks.map((t) =>
        Math.max(1, Math.round((new Date(t.end) - Date.now()) / 86400000))
      );
      setData({
        labels,
        datasets: [
          {
            label: "Jours restants",
            data: days,
            backgroundColor: "#6366f1",
            borderRadius: 6,
          },
        ],
      });
    } catch (e) {
      console.error("Erreur chargement Gantt:", e);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    scales: {
      x: {
        title: { display: true, text: "Jours restants" },
        grid: { color: "#f3f4f6" },
      },
      y: {
        ticks: { autoSkip: false },
        grid: { display: false },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.x} jours restants`,
        },
      },
    },
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} />
          <div className="font-semibold">Gantt (jours restants)</div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw size={14} />
          </Button>
        </div>
        <div style={{ height: 320 }}>
          <Bar data={data} options={options} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Non intégrés (diff TSD / DB Neon)
// ---------------------------------------------------------------------------
function MissingPanel() {
  const [data, setData] = useState(null);
  const load = async () => {
    const r = await fetch("/api/controls/tsd/missing").then((r) => r.json());
    setData(r);
  };
  useEffect(() => {
    load();
  }, []);

  if (!data)
    return (
      <Card>
        <CardContent className="p-4">Chargement…</CardContent>
      </Card>
    );

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold mb-2">
            Catégories TSD sans table
          </div>
          <ul className="list-disc pl-5 text-sm">
            {(data.missing || []).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold mb-2">Snippets SQL proposés</div>
          <pre className="text-xs whitespace-pre-wrap">
            {(data.sqlTemplates || [])
              .map((x) => `-- ${x.table}\n${x.sql}`)
              .join("\n\n")}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page principale ControlsV2 + modal "Vue plan"
// ---------------------------------------------------------------------------
export default function ControlsV2() {
  const [tab, setTab] = useState("bt");
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState(null);
  const [mapPlan, setMapPlan] = useState(null);
  const [showMap, setShowMap] = useState(false);

  const refresh = async () => {};

  return (
    <section className="p-8 max-w-7xl mx-auto controls-wrapper">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Contrôles (TSD) v2</h1>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="all">Tous</option>
          </select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bt">
            BT (Bâtiments → Switchboards → Devices)
          </TabsTrigger>
          <TabsTrigger value="hv">HV (Bâtiments → HV)</TabsTrigger>
          <TabsTrigger value="gantt">Gantt</TabsTrigger>
          <TabsTrigger value="missing">Non intégrés</TabsTrigger>
        </TabsList>

        <TabsContent
          value="bt"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 col-span-2"
        >
          <div className="bg-white rounded-2xl ring-1 ring-black/5 p-4">
            <Tree
              statusFilter={status}
              onSelect={setSelected}
              onShowPlan={(p) => {
                setMapPlan(p);
                setShowMap(true);
              }}
            />
          </div>
          <div>
            <Details task={selected} refresh={refresh} />
          </div>
        </TabsContent>

        <TabsContent
          value="hv"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 col-span-2"
        >
          <div className="bg-white rounded-2xl ring-1 ring-black/5 p-4">
            <Tree
              statusFilter={status}
              onSelect={setSelected}
              onShowPlan={(p) => {
                setMapPlan(p);
                setShowMap(true);
              }}
            />
          </div>
          <div>
            <Details task={selected} refresh={refresh} />
          </div>
        </TabsContent>

        <TabsContent value="gantt" className="col-span-2">
          <Gantt />
        </TabsContent>

        <TabsContent value="missing" className="col-span-2">
          <MissingPanel />
        </TabsContent>
      </Tabs>

      {/* -------------------- MODAL "VUE PLAN" -------------------- */}
      {showMap && mapPlan && (
        <div className="fixed inset-0 z-[6000] flex flex-col fade-in-up">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMap(false)}
          />
          <div className="relative z-[6001] mx-auto my-0 h-[100dvh] w-full md:w-[min(1100px,96vw)] md:h-[94dvh] md:my-[3vh]">
            <div className="bg-white rounded-none md:rounded-2xl shadow-lg h-full flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b gap-3">
                <div className="font-semibold">
                  Vue plan — {mapPlan.display_name}
                </div>
                <Button variant="ghost" onClick={() => setShowMap(false)}>
                  Fermer
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ControlsMap
                  plan={mapPlan}
                  onSelectTask={(t) => {
                    setSelected(t);
                    setShowMap(false);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

