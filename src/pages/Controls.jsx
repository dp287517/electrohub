// ============================================================================
// src/pages/Controls.jsx — v2
// Page complète pour les contrôles (BT / HV / Gantt / Non intégrés)
// Compatible avec Neon + server_controls.js (v2)
// Auteur : ChatGPT - 2025
// ============================================================================

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight,
  ChevronDown,
  Upload,
  Paperclip,
  Calendar,
  Wand2,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

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
              className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10"
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

        <div className="bg-violet-50 p-3 rounded-lg">
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
// Arborescence hiérarchique
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

function Tree({ statusFilter, onSelect }) {
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
              <div className="text-lg font-semibold">{b.label}</div>
              <div className="text-xs text-gray-500">
                HV {hvCount} • Switchboards {swCount}
              </div>
            </div>

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
// Gantt chart
// ---------------------------------------------------------------------------
function Gantt() {
  const [data, setData] = useState([]);
  const load = async () => {
    const r = await api.controls.timeline();
    setData(
      (r.items || []).map((t) => ({
        name: t.label,
        days: Math.max(
          1,
          Math.round((new Date(t.end) - Date.now()) / 86400000)
        ),
      }))
    );
  };
  useEffect(() => {
    load();
  }, []);
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
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 80, right: 20 }}
            >
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={220} />
              <Tooltip />
              <Bar dataKey="days" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Non intégrés (diff TSD/DB)
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
// Page principale
// ---------------------------------------------------------------------------
export default function ControlsV2() {
  const [tab, setTab] = useState("bt");
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState(null);
  const refresh = async () => {};

  return (
    <section className="p-8 max-w-7xl mx-auto">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          <TabsContent
            value="bt"
            className="grid grid-cols-1 lg:grid-cols-2 gap-6 col-span-2"
          >
            <div className="bg-white rounded-2xl ring-1 ring-black/5 p-4">
              <Tree statusFilter={status} onSelect={setSelected} />
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
              <Tree statusFilter={status} onSelect={setSelected} />
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
        </div>
      </Tabs>
    </section>
  );
}
