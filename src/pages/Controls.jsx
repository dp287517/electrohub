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
    className={`px-3 py-1.5 rounded-full text-sm font-medium border ${active ? 'bg-gray-200 text-black border-gray-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
  >
    {children}
  </button>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full border rounded px-3 py-2 text-sm text-black bg-white ${props.className || ''}`}
  />
);
const Textarea = (props) => (
  <textarea
    {...props}
    className={`w-full border rounded px-3 py-2 text-sm text-black bg-white ${props.className || ''}`}
  />
);
const Select = ({ options = [], value, onChange, placeholder, className }) => (
  <select value={value || ''} onChange={e => onChange(e.target.value)} className={`w-full border rounded px-3 py-2 text-sm text-black bg-white ${className || ''}`}>
    <option value="">{placeholder || '—'}</option>
    {options.map((o) => <option key={String(o)} value={o}>{o}</option>)}
  </select>
);

const SectionCard = ({ title, right, children }) => (
  <div className="card p-4 bg-white">
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-black">{title}</h3>
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
    className={`px-4 py-2 rounded-md text-sm font-medium border ${active ? 'bg-gray-200 text-black border-gray-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
  >
    {children}
  </button>
);

// ---------- Main Page ----------
export default function Controls() {
  const [tab, setTab] = useState('overview'); // overview | roadmap | analysis
  const [lang, setLang] = useState(localStorage.getItem('eh_lang') || 'en');

  // Filters / suggests
  const [suggests, setSuggests] = useState({ building: [], room: [], module: [], equipment_type: [] });
  const [filter, setFilter] = useState({ q: '', building: '', module: '', status: '' });

  // Entities & tasks
  const [entities, setEntities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  // Analytics / Gantt
  const [analytics, setAnalytics] = useState(null);
  const [gantt, setGantt] = useState({ tasks: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);

  useEffect(() => {
    localStorage.setItem('eh_lang', lang);
  }, [lang]);

  useEffect(() => {
    (async () => {
      try {
        // Seed DB if empty
        const { data: health } = await api.get('/api/controls/health');
        if (!health.ok) throw new Error('Health check failed');
        const { data: taskCount } = await api.get('/api/controls/tasks?limit=1');
        if (taskCount.length === 0) {
          await api.get('/api/controls/init-from-pdf');
        }

        // Suggests
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

  // ---------- AI Modal ----------
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTask, setAiTask] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [aiMsgs, setAiMsgs] = useState([]);

  const aiAsk = async () => {
    if (!aiInput.trim() || !aiTask) return;
    const msg = aiInput.trim();
    setAiMsgs((m) => [...m, { role: 'user', content: msg }]);
    setAiInput('');
    try {
      const r = await api.post('/api/controls/ai/assistant', { query: msg, lang, context: { filter }, task_id: aiTask.id });
      const content = r.data?.response || '—';
      setAiMsgs((m) => [...m, { role: 'assistant', content }]);
      setAiOpen(true);
    } catch (e) {
      setAiMsgs((m) => [...m, { role: 'assistant', content: 'AI unavailable.' }]);
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
    <section className="container-narrow py-8 bg-white">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-black">Electrical Maintenance Controls</h1>
          <p className="text-gray-600">Automated tracking and analysis of electrical equipment maintenance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={lang}
            onChange={setLang}
            options={['en', 'fr', 'de', 'es', 'pt', 'it', 'pl']}
            placeholder="Select language"
            className="w-40"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4 bg-white">
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
            <button className="btn w-full bg-gray-200 text-black border-gray-300" onClick={() => { loadEntities(); loadTasks(); loadAnalytics(); loadGantt(); }}>Apply</button>
            <button className="btn-secondary w-full bg-white text-gray-700 border-gray-300" onClick={() => setFilter({ q: '', building: '', module: '', status: '' })}>Reset</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'roadmap'} onClick={() => setTab('roadmap')}>Roadmap</TabButton>
        <TabButton active={tab === 'analysis'} onClick={() => setTab('analysis')}>Analysis</TabButton>
      </div>

      {/* Content */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}

          {/* Task groups by building */}
          {Object.keys(groupedByBuilding).length === 0 && !loading && (
            <div className="text-sm text-gray-500">No tasks yet. Initializing from PDF…</div>
          )}

          {Object.entries(groupedByBuilding).map(([b, list]) => (
            <SectionCard
              key={b}
              title={`Building: ${b}`}
              right={<span className="text-sm text-gray-500">{list.length} task(s)</span>}
            >
              <div className="overflow-auto">
                <table className="w-full text-sm text-black">
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
                            <button className="btn-xs bg-gray-200 text-black border-gray-300" onClick={() => setAiTask(t)}>Ask AI</button>
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
                <div key={e.id} className="border rounded p-3 bg-white">
                  <div className="font-medium text-black">{e.name}</div>
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
          <div className="border rounded overflow-hidden bg-white">
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
        <div className="space-y-4">
          {analytics && (
            <>
              <SectionCard title="Status Overview">
                <Doughnut data={doughnutData} />
              </SectionCard>
              <SectionCard title="Tasks by Building">
                <Bar data={barByBuilding} />
              </SectionCard>
              <SectionCard title="Due Tasks Trend">
                <Line data={lineDue} />
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* AI Modal */}
      {aiOpen && aiTask && (
        <div className="modal">
          <div className="modal-card max-w-2xl bg-white">
            <div className="modal-head">
              <h3 className="font-semibold text-black">AI Assistant - {aiTask.task_name}</h3>
            </div>
            <div className="modal-body space-y-4 p-4">
              <div className="h-64 overflow-y-auto border rounded p-2 bg-white">
                {aiMsgs.map((m, i) => (
                  <div key={i} className={`p-2 ${m.role === 'user' ? 'bg-gray-100' : 'bg-white'}`}>
                    <strong>{m.role === 'user' ? 'You' : 'AI'}:</strong> {m.content}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={aiInput} onChange={(e) => setAiInput(e.target.value)} placeholder="Ask about this task…" />
                <button className="btn bg-gray-200 text-black border-gray-300" onClick={aiAsk}>Send</button>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn-secondary bg-white text-gray-700 border-gray-300" onClick={() => setAiOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* --- Minimal tailwind-ish utility classes used above (if not globally present):
.btn { @apply inline-flex items-center px-3 py-2 rounded-md bg-gray-200 text-black border-gray-300 hover:bg-gray-300; }
.btn-secondary { @apply inline-flex items-center px-3 py-2 rounded-md border text-sm text-gray-700 bg-white border-gray-300 hover:bg-gray-50; }
.btn-xs { @apply inline-flex items-center px-2 py-1 rounded border text-xs text-black bg-gray-200 border-gray-300; }
.btn-xs-secondary { @apply inline-flex items-center px-2 py-1 rounded border text-xs text-gray-700 bg-white border-gray-300; }
.card { @apply border rounded-md bg-white; }
.modal { @apply fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50; }
.modal-card { @apply bg-white w-full max-w-2xl rounded-md border shadow; }
.modal-head { @apply p-4 border-b; }
.modal-body { @apply p-4; }
.modal-foot { @apply p-4 border-t flex justify-end gap-2; }
.container-narrow { @apply max-w-6xl mx-auto px-4; }
*/
