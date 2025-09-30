// Controls.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import {
  Chart as ChartJS,
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement
);

const api = axios.create();
api.interceptors.request.use((cfg) => {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    cfg.headers['X-Site'] = user?.site || '';
  } catch {}
  return cfg;
});

// ---------- Small UI helpers ----------
const Badge = ({ color = 'gray', children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-${color}-100 text-${color}-800`}>
    {children}
  </span>
);

const Pill = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-sm font-medium border ${active ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
  >
    {children}
  </button>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full border rounded px-3 py-2 text-sm ${props.className || ''}`}
  />
);
const Textarea = (props) => (
  <textarea
    {...props}
    className={`w-full border rounded px-3 py-2 text-sm ${props.className || ''}`}
  />
);
const Select = ({ options = [], value, onChange, placeholder, className }) => (
  <select value={value || ''} onChange={e => onChange(e.target.value)} className={`w-full border rounded px-3 py-2 text-sm ${className || ''}`}>
    <option value="">{placeholder || '—'}</option>
    {options.map((o) => <option key={String(o)} value={o}>{o}</option>)}
  </select>
);

const SectionCard = ({ title, right, children }) => (
  <div className="card p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold">{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const statusColor = (s) => {
  const m = String(s || '').toLowerCase();
  if (m.includes('overdue') || m === 'non-compliant') return 'red';
  if (m.includes('due') || m.includes('planned')) return 'amber';
  if (m.includes('done') || m.includes('compliant')) return 'green';
  return 'gray';
};

const toISO = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

const TabButton = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-md text-sm font-medium border ${active ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
  >
    {children}
  </button>
);

// ---------- Main Page ----------
export default function Controls() {
  const [tab, setTab] = useState('overview'); // overview | roadmap | analysis | assistant
  const [lang, setLang] = useState(localStorage.getItem('eh_lang') || 'en');

  // Filters / suggests
  const [suggests, setSuggests] = useState({ building: [], room: [], module: [], equipment_type: [] });
  const [filter, setFilter] = useState({ q: '', building: '', module: '', status: '' });

  // Entities & tasks
  const [entities, setEntities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [showNewEntity, setShowNewEntity] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [performTask, setPerformTask] = useState(null); // task object

  // Analytics / Gantt
  const [analytics, setAnalytics] = useState(null);
  const [gantt, setGantt] = useState({ tasks: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);

  // Assistant
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantMsgs, setAssistantMsgs] = useState([
    { role: 'system', content: 'Hello! Choose your language in the top-right selector and ask me anything about your maintenance controls.' }
  ]);
  const assistantBoxRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('eh_lang', lang);
  }, [lang]);

  useEffect(() => {
    (async () => {
      try {
        // suggests
        const s = await api.get('/api/controls/suggests');
        setSuggests(s.data || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const loadEntities = async () => {
    const params = new URLSearchParams();
    if (filter.building) params.set('building', filter.building);
    if (filter.q) params.set('q', filter.q);
    setLoading(true);
    try {
      const r = await api.get(`/api/controls/entities?${params.toString()}`);
      setEntities(r.data || []);
    } finally { setLoading(false); }
  };

  const loadTasks = async () => {
    const params = new URLSearchParams();
    if (filter.q) params.set('q', filter.q);
    if (filter.status) params.set('status', filter.status);
    if (filter.building) params.set('building', filter.building);
    params.set('sort', 'next_control');
    params.set('dir', 'asc');
    setLoading(true);
    try {
      const r = await api.get(`/api/controls/tasks?${params.toString()}`);
      setTasks(r.data || []);
    } finally { setLoading(false); }
  };

  const loadAnalytics = async () => {
    try {
      const r = await api.get('/api/controls/analytics');
      setAnalytics(r.data || null);
    } catch {}
  };

  const loadGantt = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.building) params.set('building', filter.building);
      const r = await api.get(`/api/controls/gantt-data?${params.toString()}`);
      setGantt(r.data || { tasks: [] });
    } catch {}
  };

  useEffect(() => {
    loadEntities();
    loadTasks();
    loadAnalytics();
    loadGantt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.building, filter.status]);

  // ---------- Derived ----------
  const groupedByBuilding = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      const key = t.building || '—';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return map;
  }, [tasks]);

  // ---------- Actions ----------
  const handleCreateEntity = async (payload) => {
    await api.post('/api/controls/entities', payload);
    setShowNewEntity(false);
    loadEntities();
  };
  const handleCreateTask = async (payload) => {
    await api.post('/api/controls/tasks', payload);
    setShowNewTask(false);
    loadTasks();
    loadGantt();
    loadAnalytics();
  };

  const assistantAsk = async () => {
    if (!assistantInput.trim()) return;
    const msg = assistantInput.trim();
    setAssistantMsgs((m) => [...m, { role: 'user', content: msg }]);
    setAssistantInput('');
    try {
      const r = await api.post('/api/controls/ai/assistant', { query: msg, lang, context: { filter } });
      const content = r.data?.response || '—';
      setAssistantMsgs((m) => [...m, { role: 'assistant', content }]);
      setAssistantOpen(true);
      setTab('assistant');
      setTimeout(() => assistantBoxRef.current?.scrollTo(0, 999999), 100);
    } catch (e) {
      setAssistantMsgs((m) => [...m, { role: 'assistant', content: 'AI unavailable.' }]);
    }
  };

  // ---------- Charts data ----------
  const doughnutData = useMemo(() => {
    const s = analytics?.stats || {};
    return {
      labels: ['Overdue', 'Due < 90d', 'Future'],
      datasets: [{ data: [s.overdue || 0, s.due_90_days || 0, s.future || 0] }]
    };
  }, [analytics]);

  const barByBuilding = useMemo(() => {
    const items = analytics?.byBuilding || [];
    return {
      labels: items.map(i => i.building || '—'),
      datasets: [{ label: 'Tasks', data: items.map(i => i.count || 0) }]
    };
  }, [analytics]);

  const lineDue = useMemo(() => {
    // Build a 12-month trend from tasks' next_control
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const counts = months.map((label) =>
      tasks.filter(t => (t.next_control || '').startsWith(label)).length
    );
    return { labels: months, datasets: [{ label: 'Due tasks per month', data: counts }] };
  }, [tasks]);

  // ---------- Render ----------
  return (
    <section className="container-narrow py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Maintenance Controls</h1>
          <p className="text-gray-600">Plan, perform, and analyze electrical maintenance tasks across buildings and modules.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={lang}
            onChange={setLang}
            options={['en', 'fr', 'de', 'es', 'pt', 'it', 'pl']}
            placeholder="Language (AI)"
            className="w-40"
          />
          <button className="btn" onClick={() => setShowNewEntity(true)}>+ New Entity</button>
          <button className="btn" onClick={() => setShowNewTask(true)}>+ New Task</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="grid sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <Input placeholder="Search (entity/task)…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          </div>
          <Select
            value={filter.building}
            onChange={(v) => setFilter({ ...filter, building: v })}
            options={suggests.building || []}
            placeholder="Filter by building"
          />
          <Select
            value={filter.status}
            onChange={(v) => setFilter({ ...filter, status: v })}
            options={['Planned', 'Due', 'Overdue', 'Done', 'Compliant', 'Non-compliant']}
            placeholder="Filter by status"
          />
          <div className="flex gap-2">
            <button className="btn w-full" onClick={() => { loadEntities(); loadTasks(); loadAnalytics(); loadGantt(); }}>Apply</button>
            <button className="btn-secondary w-full" onClick={() => setFilter({ q: '', building: '', module: '', status: '' })}>Reset</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'roadmap'} onClick={() => setTab('roadmap')}>Roadmap</TabButton>
        <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>Analysis</TabButton>
        <TabButton active={tab === 'assistant'} onClick={() => setTab('assistant')}>Assistant</TabButton>
      </div>

      {/* Content */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}

          {/* Task groups by building */}
          {Object.keys(groupedByBuilding).length === 0 && !loading && (
            <div className="text-sm text-gray-500">No tasks yet. Create an entity and add tasks.</div>
          )}

          {Object.entries(groupedByBuilding).map(([b, list]) => (
            <SectionCard
              key={b}
              title={`Building: ${b}`}
              right={<span className="text-sm text-gray-500">{list.length} task(s)</span>}
            >
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 border-b">
                      <th className="py-2 pr-2">Entity</th>
                      <th className="py-2 pr-2">Task</th>
                      <th className="py-2 pr-2">Freq</th>
                      <th className="py-2 pr-2">Last</th>
                      <th className="py-2 pr-2">Next</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(t => (
                      <tr key={t.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-2 whitespace-nowrap">{t.entity_name || '—'} <span className="text-gray-400">({t.room || '—'})</span></td>
                        <td className="py-2 pr-2">{t.task_name}</td>
                        <td className="py-2 pr-2">
                          {t.frequency_months_max ? `${t.frequency_months_min || '—'}–${t.frequency_months_max} mo` : (t.frequency_months ? `${t.frequency_months} mo` : '—')}
                        </td>
                        <td className="py-2 pr-2">{fmtDate(t.last_control)}</td>
                        <td className="py-2 pr-2">{fmtDate(t.next_control)}</td>
                        <td className="py-2 pr-2">
                          <Badge color={statusColor(t.status)}>{t.status || 'Planned'}</Badge>
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex gap-2">
                            <button className="btn-xs" onClick={() => setPerformTask(t)}>Perform</button>
                            <button className="btn-xs-secondary" onClick={async () => {
                              if (!confirm('Delete this task?')) return;
                              await api.delete(`/api/controls/tasks/${t.id}`);
                              loadTasks(); loadGantt(); loadAnalytics();
                            }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}

          {/* Entities quick view */}
          <SectionCard title="Entities">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {entities.map(e => (
                <div key={e.id} className="border rounded p-3">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-gray-600">{e.equipment_type || '—'} · {e.equipment_ref || '—'}</div>
                  <div className="text-xs text-gray-500 mt-1">Bldg {e.building || '—'} · Room {e.room || '—'}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === 'roadmap' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Pill active={viewMode === ViewMode.Week} onClick={() => setViewMode(ViewMode.Week)}>Week</Pill>
            <Pill active={viewMode === ViewMode.Month} onClick={() => setViewMode(ViewMode.Month)}>Month</Pill>
            <Pill active={viewMode === ViewMode.Year} onClick={() => setViewMode(ViewMode.Year)}>Year</Pill>
          </div>
          <div className="border rounded overflow-hidden">
            <Gantt
              tasks={(gantt.tasks || []).map(t => ({
                ...t,
                start: new Date(t.start),
                end: new Date(t.end),
                type: 'task',
                isDisabled: true,
                progress: t.progress || 0
              }))}
              viewMode={viewMode}
              listCellWidth="200px"
            />
          </div>
        </div>
      )}

      {tab === 'analysis' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <SectionCard title="Portfolio status">
            <Doughnut data={doughnutData} />
            <div className="text-xs text-gray-500 mt-3">Last refresh: {analytics?.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : '—'}</div>
          </SectionCard>
          <SectionCard title="Tasks by building">
            <Bar data={barByBuilding} />
          </SectionCard>
          <SectionCard title="12-month due forecast">
            <Line data={lineDue} />
          </SectionCard>
        </div>
      )}

      {tab === 'assistant' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <SectionCard title="AI Assistant" right={<span className="text-xs text-gray-500">Language: {lang}</span>}>
            <div ref={assistantBoxRef} className="h-80 overflow-auto border rounded p-3 bg-gray-50">
              {assistantMsgs.map((m, i) => (
                <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block px-3 py-2 rounded ${m.role === 'user' ? 'bg-black text-white' : 'bg-white border'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input value={assistantInput} onChange={(e) => setAssistantInput(e.target.value)} placeholder="Ask procedures, risks, tools, how-to…" />
              <button className="btn" onClick={assistantAsk}>Send</button>
            </div>
          </SectionCard>

          <SectionCard title="Quick tips">
            <ul className="text-sm list-disc pl-5 space-y-2">
              <li>Use <b>Perform</b> to record a control with photos and auto-analysis.</li>
              <li>When a periodicity is a range (e.g. 3–8 years), next date uses the <b>longest</b> interval.</li>
              <li>Tasks can be linked to a <b>building/zone</b> even without a specific equipment.</li>
            </ul>
          </SectionCard>

          <SectionCard title="Shortcuts">
            <div className="flex gap-2 flex-wrap">
              <button className="btn" onClick={() => setTab('overview')}>Go to Overview</button>
              <button className="btn" onClick={() => setTab('roadmap')}>Open Roadmap</button>
              <button className="btn" onClick={() => setTab('analysis')}>Open Analysis</button>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Modals */}
      {showNewEntity && (
        <EntityModal
          onClose={() => setShowNewEntity(false)}
          onSubmit={handleCreateEntity}
          suggests={suggests}
        />
      )}

      {showNewTask && (
        <TaskModal
          entities={entities}
          onClose={() => setShowNewTask(false)}
          onSubmit={handleCreateTask}
        />
      )}

      {!!performTask && (
        <PerformModal
          task={performTask}
          lang={lang}
          onClose={() => setPerformTask(null)}
          onDone={() => { setPerformTask(null); loadTasks(); loadGantt(); loadAnalytics(); }}
        />
      )}
    </section>
  );
}

// ---------- Entity Modal ----------
function EntityModal({ onClose, onSubmit, suggests }) {
  const [form, setForm] = useState({
    name: '',
    equipment_type: '',
    equipment_ref: '',
    module: '',
    building: '',
    zone: '',
    room: '',
    criticality: ''
  });

  return (
    <div className="modal">
      <div className="modal-card">
        <div className="modal-head">
          <h3 className="font-semibold">New Entity</h3>
        </div>
        <div className="modal-body space-y-3">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select placeholder="Equipment type" value={form.equipment_type} onChange={(v) => setForm({ ...form, equipment_type: v })} options={suggests.equipment_type || []} />
            <Input placeholder="Equipment ref" value={form.equipment_ref} onChange={(e) => setForm({ ...form, equipment_ref: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input placeholder="Module" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} />
            <Select placeholder="Building" value={form.building} onChange={(v) => setForm({ ...form, building: v })} options={suggests.building || []} />
            <Input placeholder="Zone" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select placeholder="Room" value={form.room} onChange={(v) => setForm({ ...form, room: v })} options={suggests.room || []} />
            <Input placeholder="Criticality" value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => onSubmit(form)}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Task Modal ----------
function TaskModal({ entities, onClose, onSubmit }) {
  const [form, setForm] = useState({
    entity_id: '',
    task_name: '',
    task_code: '',
    frequency_months_min: '',
    frequency_months_max: '',
    value_type: 'checklist',
    result_schema: [{ key: 'Visual check', type: 'boolean' }],
    procedure_md: '',
    hazards_md: '',
    ppe_md: '',
    tools_md: ''
  });

  const addSchemaItem = () => setForm(f => ({ ...f, result_schema: [...f.result_schema, { key: '', type: 'boolean' }] }));
  const setSchemaItem = (i, patch) => setForm(f => {
    const arr = [...f.result_schema];
    arr[i] = { ...arr[i], ...patch };
    return { ...f, result_schema: arr };
  });
  const delSchemaItem = (i) => setForm(f => ({ ...f, result_schema: f.result_schema.filter((_, k) => k !== i) }));

  return (
    <div className="modal">
      <div className="modal-card max-w-3xl">
        <div className="modal-head">
          <h3 className="font-semibold">New Task</h3>
        </div>
        <div className="modal-body space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              value={form.entity_id}
              onChange={(v) => setForm({ ...form, entity_id: v })}
              options={entities.map(e => ({ id: e.id, label: `${e.name} (${e.building || '—'}/${e.room || '—'})` }))?.map(o => o.id)}
              placeholder="Entity (select by ID)"
            />
            <Input placeholder="Task name" value={form.task_name} onChange={(e) => setForm({ ...form, task_name: e.target.value })} />
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <Input placeholder="Task code (optional)" value={form.task_code} onChange={(e) => setForm({ ...form, task_code: e.target.value })} />
            <Input placeholder="Frequency MIN (months)" value={form.frequency_months_min} onChange={(e) => setForm({ ...form, frequency_months_min: e.target.value })} />
            <Input placeholder="Frequency MAX (months)" value={form.frequency_months_max} onChange={(e) => setForm({ ...form, frequency_months_max: e.target.value })} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              value={form.value_type}
              onChange={(v) => setForm({ ...form, value_type: v })}
              options={['checklist', 'numeric', 'text']}
              placeholder="Value type"
            />
            <Input placeholder="Created by (optional)" value={form.created_by || ''} onChange={(e) => setForm({ ...form, created_by: e.target.value })} />
          </div>

          <div className="border rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Result schema (for checklists / fields)</div>
              <button className="btn-xs" onClick={addSchemaItem}>+ Add field</button>
            </div>
            <div className="space-y-2">
              {form.result_schema.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input className="col-span-6 border rounded px-2 py-1 text-sm" placeholder="Label / key" value={it.key} onChange={(e) => setSchemaItem(i, { key: e.target.value })} />
                  <select className="col-span-3 border rounded px-2 py-1 text-sm" value={it.type} onChange={(e) => setSchemaItem(i, { type: e.target.value })}>
                    <option value="boolean">Checkbox</option>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                  </select>
                  <button className="col-span-2 btn-xs-secondary" onClick={() => delSchemaItem(i)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Textarea rows={6} placeholder="Procedure (Markdown)" value={form.procedure_md} onChange={(e) => setForm({ ...form, procedure_md: e.target.value })} />
            <div className="space-y-3">
              <Textarea rows={3} placeholder="Hazards / risks (Markdown)" value={form.hazards_md} onChange={(e) => setForm({ ...form, hazards_md: e.target.value })} />
              <Textarea rows={3} placeholder="PPE (Markdown)" value={form.ppe_md} onChange={(e) => setForm({ ...form, ppe_md: e.target.value })} />
              <Textarea rows={3} placeholder="Tools (Markdown)" value={form.tools_md} onChange={(e) => setForm({ ...form, tools_md: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={() => onSubmit({ ...form, result_schema: form.result_schema })}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Perform Modal ----------
function PerformModal({ task, lang = 'en', onClose, onDone }) {
  const [performed_at, setPerformedAt] = useState(toISO(new Date()));
  const [performed_by, setPerformedBy] = useState('');
  const [result_status, setResultStatus] = useState('Done');
  const [numeric_value, setNumericValue] = useState('');
  const [text_value, setTextValue] = useState('');
  const [checklist, setChecklist] = useState({});
  const [comments, setComments] = useState('');
  const [photos, setPhotos] = useState([]);
  const [aiPreview, setAiPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Initialize checklist keys to false
    if (task?.result_schema && Array.isArray(task.result_schema)) {
      const base = {};
      task.result_schema.forEach(f => { base[f.key] = false; });
      setChecklist(base);
    }
  }, [task]);

  const handleAnalyze = async () => {
    if (!photos?.length) return;
    setBusy(true);
    const form = new FormData();
    for (const p of photos) form.append('photos', p);
    form.append('lang', lang);
    try {
      const r = await api.post('/api/controls/ai/analyze', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAiPreview(r.data?.result || null);
      // Autofill some fields if available
      if (r.data?.result?.status) setResultStatus(r.data.result.status);
      if (r.data?.result?.measurements && typeof r.data.result.measurements === 'object') {
        // Best effort: map numeric field if present
        const firstNum = Object.values(r.data.result.measurements).find(v => !isNaN(Number(v)));
        if (firstNum !== undefined) setNumericValue(String(firstNum));
      }
      if (r.data?.result?.observations?.length) {
        setComments([comments, ...r.data.result.observations].filter(Boolean).join('\n'));
      }
    } catch (e) {
      setAiPreview({ error: 'AI unavailable' });
    } finally { setBusy(false); }
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('performed_at', performed_at);
      fd.append('performed_by', performed_by);
      fd.append('lang', lang);
      fd.append('result_status', result_status);
      if (task.value_type === 'numeric') fd.append('numeric_value', numeric_value);
      if (task.value_type === 'text') fd.append('text_value', text_value);
      if (task.value_type === 'checklist') fd.append('checklist_result', JSON.stringify(checklist));
      fd.append('comments', comments);
      for (const p of photos) fd.append('photos', p);
      await api.post(`/api/controls/tasks/${task.id}/records`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal-card max-w-3xl">
        <div className="modal-head">
          <h3 className="font-semibold">Perform Task — {task?.task_name}</h3>
          <div className="text-xs text-gray-500">Entity: {task?.entity_name || '—'} · Building {task?.building || '—'}</div>
        </div>
        <div className="modal-body space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Input type="date" value={performed_at} onChange={(e) => setPerformedAt(e.target.value)} />
            <Input placeholder="Performed by" value={performed_by} onChange={(e) => setPerformedBy(e.target.value)} />
            <Select value={result_status} onChange={setResultStatus} options={['Done', 'Compliant', 'Non-compliant', 'To review']} placeholder="Status" />
          </div>

          {/* Dynamic form */}
          {task.value_type === 'numeric' && (
            <Input placeholder="Numeric value" value={numeric_value} onChange={(e) => setNumericValue(e.target.value)} />
          )}
          {task.value_type === 'text' && (
            <Textarea rows={4} placeholder="Text result" value={text_value} onChange={(e) => setTextValue(e.target.value)} />
          )}
          {task.value_type === 'checklist' && Array.isArray(task.result_schema) && (
            <div className="border rounded p-3">
              <div className="font-medium mb-2">Checklist</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {task.result_schema.map((f, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!checklist[f.key]} onChange={(e) => setChecklist({ ...checklist, [f.key]: !!e.target.checked })} />
                    <span>{f.key}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Photos */}
          <div className="border rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Photos</div>
              <button className="btn-xs" onClick={handleAnalyze} disabled={busy || !(photos?.length)}>Analyze with AI</button>
            </div>
            <input type="file" multiple accept="image/*" onChange={(e) => setPhotos(Array.from(e.target.files || []))} />
            {aiPreview && (
              <div className="mt-3 text-xs bg-gray-50 border rounded p-2">
                <div className="font-medium mb-1">AI result</div>
                <pre className="whitespace-pre-wrap">{JSON.stringify(aiPreview, null, 2)}</pre>
              </div>
            )}
          </div>

          <Textarea rows={4} placeholder="Comments / observations" value={comments} onChange={(e) => setComments(e.target.value)} />
          <div className="text-xs text-gray-500">
            Note: next due date will be computed server-side using the <b>longest</b> interval (e.g., 3–8 years → 8 years).
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={handleSubmit} disabled={busy}>Save record</button>
        </div>
      </div>
    </div>
  );
}

/* --- Minimal tailwind-ish utility classes used above (if not globally present):
.btn { @apply inline-flex items-center px-3 py-2 rounded-md bg-black text-white text-sm hover:opacity-90; }
.btn-secondary { @apply inline-flex items-center px-3 py-2 rounded-md border text-sm; }
.btn-xs { @apply inline-flex items-center px-2 py-1 rounded border text-xs; }
.btn-xs-secondary { @apply inline-flex items-center px-2 py-1 rounded border text-xs bg-white; }
.card { @apply border rounded-md bg-white; }
.modal { @apply fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50; }
.modal-card { @apply bg-white w-full max-w-2xl rounded-md border shadow; }
.modal-head { @apply p-4 border-b; }
.modal-body { @apply p-4; }
.modal-foot { @apply p-4 border-t flex justify-end gap-2; }
.container-narrow { @apply max-w-6xl mx-auto px-4; }
*/
