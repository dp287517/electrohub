// Controls.jsx — Frontend complet (arborescence + checklists inline + Gantt)
// Style et structure inspirés de Obsolescence.jsx
import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { get, post } from '../lib/api.js';
import { ChevronRight, ChevronDown, SlidersHorizontal, Calendar, Image as ImageIcon, CheckCircle2, Upload, TimerReset, History, Paperclip, X } from 'lucide-react';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

const PALETTE = ['#2563eb','#ef4444','#f59e0b','#7c3aed','#16a34a','#0ea5e9','#059669','#d946ef','#3b82f6','#22c55e'];
const withAlpha = (hex, a) => {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
};
const colorForCategory = (k = '', code = '') => {
  const up = String(k).toUpperCase();
  if (up.includes('HV')) return '#ef4444';
  if (up.includes('ATEX')) return '#f59e0b';
  if (up.includes('SWITCH')) return '#3b82f6';
  if (String(code).toLowerCase().includes('thermo')) return '#22c55e';
  return '#6366f1';
};
const STATUS_COLORS = {
  Planned: '#3b82f6',
  Pending: '#f59e0b',
  Overdue: '#ef4444',
  Done: '#16a34a',
};

function Toast({ msg, type='info', onClose }) {
  const colors = { success:'bg-green-600 text-white', error:'bg-red-600 text-white', info:'bg-blue-600 text-white' };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm ${colors[type]} ring-1 ring-black/10 flex items-center gap-3`}>
      <span>{msg}</span>
      <button onClick={onClose} className="opacity-80 hover:opacity-100">×</button>
    </div>
  );
}

function Modal({ open, onClose, children, title, wide=false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${wide?'max-w-5xl':'max-w-2xl'} bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5`}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-blue-50">
          <h3 className="text-xl font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">×</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[75vh]">{children}</div>
      </div>
    </div>
  );
}

// Helpers API
async function apiGet(path, params) { return await get(`/api/controls${path}`, params); }
async function apiPost(path, body, isFormData = false) {
  return await post(`/api/controls${path}`, body, isFormData);
}
// Local PATCH helper (avoid importing patch from api.js)
async function apiPatch(path, body) {
  const res = await fetch(`/api/controls${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `PATCH ${path} failed (${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true };
  }
}

// Inline checklist widget
function ChecklistInline({ task, schema, onCloseTask, busy }) {
  const [checklist, setChecklist] = useState(() =>
    (schema?.checklist || []).map(i => ({ key: i.key, label: i.label, value: '' }))
  );

  const [observations, setObservations] = useState(() => {
    const obsBase = {};
    (schema?.observations || []).forEach(o => { obsBase[o.key] = ''; });
    return obsBase;
  });

  const [comment, setComment] = useState('');
  const [files, setFiles] = useState([]);

  const options =
    ((schema?.checklist || [])[0]?.options) ||
    ["Conforme", "Non conforme", "Non applicable"];

  const setValue = (key, v) =>
    setChecklist(cs => cs.map(c => (c.key === key ? { ...c, value: v } : c)));

  const submit = async () => {
    const payload = {
      record_status: 'done',
      checklist,
      observations,
      attachments: files.map(f => ({
        filename: f.name,
        mimetype: f.type,
        size: f.size,
        data: f._b64
      })),
      comment,
      closed_at: new Date().toISOString().slice(0, 10)
    };
    await onCloseTask(payload);
    setFiles([]);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setFiles(prev => [...prev, { name: file.name, type: file.type, size: file.size, _b64: b64 }]);
  };

  return (
    <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 mt-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">Checklist</h4>
          <div className="space-y-2">
            {(schema?.checklist || []).map((item, idx) => (
              <div key={item.key || idx} className="flex items-center gap-3">
                <div className="flex-1 text-sm text-gray-800">{item.label}</div>
                <select
                  className="p-2 rounded-lg bg-white ring-1 ring-black/10"
                  value={checklist[idx]?.value || ''}
                  onChange={e => setValue(item.key, e.target.value)}
                >
                  <option value="">Sélectionner</option>
                  {options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-gray-800 mb-2">Observations</h4>
          <div className="space-y-2">
            {(schema?.observations || []).map((o, i) => (
              <div key={o.key || i}>
                <label className="block text-xs text-gray-600 mb-1">{o.label}</label>
                <input
                  className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10"
                  value={observations[o.key] || ''}
                  onChange={e => setObservations(s => ({ ...s, [o.key]: e.target.value }))}
                />
              </div>
            ))}
            <label className="block text-xs text-gray-600 mb-1">Commentaires</label>
            <textarea
              className="w-full p-2 rounded-lg bg-white ring-1 ring-black/10"
              rows={3}
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer hover:bg-gray-50">
          <Upload size={16} /> Joindre une photo
          <input type="file" className="hidden" onChange={handleFile} accept="image/*" />
        </label>

        {files.map((f, idx) => (
          <span
            key={idx}
            className="text-xs bg-white ring-1 ring-black/10 px-2 py-1 rounded-lg flex items-center gap-2"
          >
            <Paperclip size={14} /> {f.name}
          </span>
        ))}

        <div className="flex-1" />

        <button
          disabled={busy}
          onClick={submit}
          className={`px-4 py-2 rounded-lg text-white shadow ${
            busy ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'
          } flex items-center gap-2`}
        >
          <CheckCircle2 size={18} /> Clôturer & Replanifier
        </button>
      </div>
    </div>
  );
}

// IA mini cartes (avant/pdt)
function AICards({ taskId, onAttach }) {
  const [beforeMsg, setBeforeMsg] = useState(null);
  const [reading, setReading] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  const sendBefore = async (file) => {
    if (!file) return;
    setLoadingA(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('task_id', taskId);
    fd.append('attach', '1');
    try {
      const resp = await apiPost('/ai/analyze-before', fd, true);
      setBeforeMsg(resp);
      onAttach?.();
    } catch (e) {
      setBeforeMsg({ error: e.message });
    } finally { setLoadingA(false); }
  };
  const sendRead = async (file) => {
    if (!file) return;
    setLoadingB(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('task_id', taskId);
    fd.append('attach', '1');
    fd.append('meter_type', 'multimeter_voltage');
    fd.append('unit_hint', 'V');
    try {
      const resp = await apiPost('/ai/read-value', fd, true);
      setReading(resp);
      onAttach?.();
    } catch (e) {
      setReading({ error: e.message });
    } finally { setLoadingB(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
      <div className="p-3 rounded-xl ring-1 ring-black/10 bg-white">
        <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
          <ImageIcon size={18}/> Analyse avant intervention
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700">
          <Upload size={16}/> Importer une photo
          <input type="file" className="hidden" accept="image/*" onChange={e=>sendBefore(e.target.files?.[0])} />
        </label>
        <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap min-h-[48px]">
          {loadingA ? 'Analyse en cours…' : beforeMsg ? JSON.stringify(beforeMsg, null, 2) : 'Conseils de sécurité, EPI, positionnement, risques.'}
        </div>
      </div>
      <div className="p-3 rounded-xl ring-1 ring-black/10 bg-white">
        <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
          <ImageIcon size={18}/> Lecture pendant intervention
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white cursor-pointer hover:bg-green-700">
          <Upload size={16}/> Photo de l'appareil
          <input type="file" className="hidden" accept="image/*" onChange={e=>sendRead(e.target.files?.[0])} />
        </label>
        <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap min-h-[48px]">
          {loadingB ? 'Extraction en cours…' : reading ? JSON.stringify(reading, null, 2) : 'Déposez une photo avec l\'afficheur visible.'}
        </div>
      </div>
    </div>
  );
}

export default function Controls() {
  const [tab, setTab] = useState('hierarchy'); // hierarchy | gantt | history
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ building:'', category:'', status:'open', include_closed:false, q:'' });

  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const [expanded, setExpanded] = useState({}); // key -> boolean
  const [taskOpen, setTaskOpen] = useState({}); // taskId -> { schema, loading }
  const [historyOpen, setHistoryOpen] = useState({}); // taskId -> rows
  const [attachments, setAttachments] = useState({}); // taskId -> list

  const [ganttTasks, setGanttTasks] = useState([]);

  // --- load filters
  const loadFilters = async () => {
    try {
      const f = await apiGet('/filters');
      setFilters(prev => ({
        ...prev,
        categories: f.categories || [],
        sites: f.sites || [],
        task_codes: f.task_codes || [],
        statuses: f.statuses || [],
      }));
    } catch {}
  };

  const loadTree = async () => {
    try {
      setLoading(true);
      const data = await apiGet('/hierarchy/tree');
      setTree(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ msg:`Échec du chargement de l'arborescence: ${e.message}`, type:'error' });
    } finally { setLoading(false); }
  };

  const reloadTaskExtras = async (taskId) => {
    try {
      const hist = await apiGet(`/tasks/${taskId}/history`);
      const att = await apiGet(`/tasks/${taskId}/attachments`);
      setHistoryOpen(prev => ({ ...prev, [taskId]: hist }));
      setAttachments(prev => ({ ...prev, [taskId]: att }));
    } catch {}
  };

  const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const openTaskInline = async (task) => {
    if (!taskOpen[task.id]) {
      setTaskOpen(prev => ({ ...prev, [task.id]: { schema: null, loading: true, __visible:true } }));
      try {
        const s = await apiGet(`/tasks/${task.id}/schema`);
        setTaskOpen(prev => ({ ...prev, [task.id]: { schema: s, loading: false, __visible:true } }));
        await reloadTaskExtras(task.id);
      } catch (e) {
        setTaskOpen(prev => ({ ...prev, [task.id]: { error: e.message, loading: false, __visible:true } }));
      }
    } else {
      setTaskOpen(prev => ({ ...prev, [task.id]: { ...(prev[task.id]||{}), __visible: !(prev[task.id]?.__visible) } }));
    }
  };

  const closeTask = async (task, payload) => {
    try {
      setTaskOpen(prev => ({ ...prev, [task.id]: { ...(prev[task.id]||{}), closing:true } }));
      const res = await apiPatch(`/tasks/${task.id}/close`, payload);
      setToast({ msg:`Tâche clôturée. Nouvelle planifiée au ${res?.next_task?.due_date || 'N/A'}`, type:'success' });
      await loadTree();
      setTaskOpen(prev => {
        const copy = { ...prev };
        delete copy[task.id];
        return copy;
      });
    } catch (e) {
      setToast({ msg:`Échec de la clôture: ${e.message}`, type:'error' });
      setTaskOpen(prev => ({ ...prev, [task.id]: { ...(prev[task.id]||{}), closing:false } }));
    }
  };

  const loadGantt = async () => {
    try {
      setLoading(true);
      const params = { include_closed: filters.include_closed ? 1 : 0 };
      const data = await apiGet('/calendar', params);
      const tasks = [];
      Object.keys(data || {}).forEach(day => {
        const arr = data[day] || [];
        arr.forEach(it => {
          const start = new Date(it.due_date);
          const end = new Date(new Date(it.due_date).getTime() + 24*3600*1000);
          tasks.push({
            id: String(it.id),
            name: it.label,
            start, end,
            type: 'task',
            progress: it.status === 'Done' ? 100 : 0,
            styles: {
              backgroundColor: withAlpha(colorForCategory('', it.task_code), 0.9),
              backgroundSelectedColor: withAlpha(colorForCategory('', it.task_code), 1),
              progressColor: '#111827',
              progressSelectedColor: '#111827'
            }
          });
        });
      });
      setGanttTasks(tasks);
    } catch (e) {
      setToast({ msg:`Échec du chargement Gantt: ${e.message}`, type:'error' });
      setGanttTasks([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadFilters(); loadTree(); }, []);
  useEffect(() => { if (tab==='gantt') loadGantt(); }, [tab, filters.include_closed]);

  const countTasks = (node) => {
    const list = [];
    if (node.tasks?.length) list.push(...node.tasks);
    if (node.hv) node.hv.forEach(n=>list.push(...(n.tasks||[])));
    if (node.switchboards) node.switchboards.forEach(sw => {
      list.push(...(sw.tasks||[]));
      (sw.devices||[]).forEach(d => list.push(...(d.tasks||[])));
    });
    if (node.atex) node.atex.forEach(z => {
      list.push(...(z.tasks||[]));
      (z.equipments||[]).forEach(e => list.push(...(e.tasks||[])));
    });
    const open = list.filter(t => t.status !== 'Done').length;
    return { open, total: list.length };
  };

  const TaskRow = ({ t }) => {
    const visible = !!taskOpen[t.id]?.__visible;
    const busy = !!taskOpen[t.id]?.closing;

    return (
      <>
        <tr className="hover:bg-indigo-50/50">
          <td className="p-2 pl-8">
            <button onClick={() => openTaskInline(t)} className="inline-flex items-center gap-2 text-left">
              {visible ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
              <span className="font-medium text-gray-800">{t.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-lg ml-2" style={{background:withAlpha(STATUS_COLORS[t.status]||'#6b7280',.15), color:STATUS_COLORS[t.status]||'#374151'}}>
                {t.status}
              </span>
            </button>
          </td>
          <td className="p-2">{t.code}</td>
          <td className="p-2">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</td>
          <td className="p-2 text-right">
            <button onClick={() => openTaskInline(t)} className="text-indigo-700 hover:text-indigo-900">Détails</button>
          </td>
        </tr>
        {visible && (
          <tr>
            <td colSpan={4} className="p-2 pl-12 bg-white">
              {taskOpen[t.id]?.loading && <div className="text-sm text-gray-500">Chargement du formulaire…</div>}
              {taskOpen[t.id]?.error && <div className="text-sm text-red-600">{taskOpen[t.id]?.error}</div>}
              {taskOpen[t.id]?.schema && (
                <div>
                  <ChecklistInline
                    task={t}
                    schema={taskOpen[t.id].schema}
                    busy={busy}
                    onCloseTask={(payload)=>closeTask(t, payload)}
                  />
                  <AICards taskId={t.id} onAttach={()=>reloadTaskExtras(t.id)} />

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl ring-1 ring-black/10 bg-gray-50">
                      <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><History size={16}/> Historique</div>
                      <div className="text-sm text-gray-700 max-h-48 overflow-auto">
                        {(historyOpen[t.id]||[]).length === 0 && <div className="text-gray-500">Aucun événement.</div>}
                        {(historyOpen[t.id]||[]).map((h,idx)=>(
                          <div key={idx} className="py-1 border-b border-gray-100">
                            <div className="text-xs text-gray-500">{new Date(h.date || h.performed_at || Date.now()).toLocaleString()}</div>
                            <div className="text-sm">{h.action || h.result_status || 'event'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl ring-1 ring-black/10 bg-gray-50">
                      <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Paperclip size={16}/> Pièces jointes</div>
                      <div className="text-sm text-gray-700 max-h-48 overflow-auto">
                        {(attachments[t.id]||[]).length === 0 && <div className="text-gray-500">Aucune pièce jointe.</div>}
                        {(attachments[t.id]||[]).map(a => (
                          <div key={a.id} className="py-1 border-b border-gray-100 flex items-center justify-between gap-3">
                            <span className="truncate">{a.filename}</span>
                            <a className="text-blue-700 hover:text-blue-900 text-sm" href={`/api/controls/attachments/${a.id}`} target="_blank" rel="noreferrer">Ouvrir</a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </td>
          </tr>
        )}
      </>
    );
  };

  const SectionHeader = ({ title, count, nodeKey }) => (
    <tr className="bg-indigo-50">
      <td className="p-2">
        <button onClick={()=>toggleExpand(nodeKey)} className="inline-flex items-center gap-2 font-semibold text-indigo-800">
          {expanded[nodeKey] ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}{title}
        </button>
      </td>
      <td className="p-2 text-sm text-gray-500">—</td>
      <td className="p-2 text-sm text-gray-500">Open: {count.open} / Total: {count.total}</td>
      <td className="p-2"></td>
    </tr>
  );

  const BuildingBlock = ({ b }) => {
    const bKey = `b:${b.id}`;
    const c = countTasks(b);
    return (
      <Fragment>
        <tr className="hover:bg-indigo-50/50">
          <td className="p-3">
            <button onClick={()=>toggleExpand(bKey)} className="inline-flex items-center gap-2 font-semibold text-gray-800">
              {expanded[bKey] ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
              {b.label || b.id}
            </button>
          </td>
          <td className="p-3"></td>
          <td className="p-3 text-sm text-gray-600">Open: {c.open} / Total: {c.total}</td>
          <td className="p-3"></td>
        </tr>

        {/* HV */}
        {expanded[bKey] && (
          <>
            {b.hv?.length > 0 && (
              <>
                <SectionHeader title="High Voltage" count={countTasks({tasks:[], hv:b.hv})} nodeKey={`${bKey}:hv`} />
                {expanded[`${bKey}:hv`] && b.hv.map(h => (
                  <Fragment key={`hv:${h.id}`}>
                    <tr className="bg-red-50">
                      <td className="p-2 pl-6 font-medium text-red-800">{h.label}</td>
                      <td className="p-2">{h.code || '—'}</td>
                      <td className="p-2 text-sm text-gray-600">Tâches: {(h.tasks||[]).length}</td>
                      <td className="p-2"></td>
                    </tr>
                    {(h.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
                  </Fragment>
                ))}
              </>
            )}

            {/* SWITCHBOARDS + DEVICES */}
            {b.switchboards?.length > 0 && (
              <>
                <SectionHeader title="Switchboards" count={countTasks({tasks:[], switchboards:b.switchboards})} nodeKey={`${bKey}:sw`} />
                {expanded[`${bKey}:sw`] && b.switchboards.map(sw => (
                  <Fragment key={`sw:${sw.id}`}>
                    <tr className="bg-blue-50">
                      <td className="p-2 pl-6 font-medium text-blue-800">{sw.label}</td>
                      <td className="p-2">{sw.code || '—'}</td>
                      <td className="p-2 text-sm text-gray-600">Tâches: {(sw.tasks||[]).length}</td>
                      <td className="p-2"></td>
                    </tr>
                    {(sw.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
                    {(sw.devices||[]).map(d => (
                      <Fragment key={`dev:${d.id}`}>
                        <tr className="bg-blue-50/50">
                          <td className="p-2 pl-10 text-blue-900">{d.label}</td>
                          <td className="p-2">{d.code || '—'}</td>
                          <td className="p-2 text-sm text-gray-600">Tâches: {(d.tasks||[]).length}</td>
                          <td className="p-2"></td>
                        </tr>
                        {(d.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </>
            )}

            {/* ATEX */}
            {b.atex?.length > 0 && (
              <>
                <SectionHeader title="ATEX" count={countTasks({tasks:[], atex:b.atex})} nodeKey={`${bKey}:atex`} />
                {expanded[`${bKey}:atex`] && b.atex.map(z => (
                  <Fragment key={`zone:${z.zone}`}>
                    <tr className="bg-amber-50">
                      <td className="p-2 pl-6 font-medium text-amber-800">Zone {z.zone}</td>
                      <td className="p-2">—</td>
                      <td className="p-2 text-sm text-gray-600">Tâches: {(z.tasks||[]).length}</td>
                      <td className="p-2"></td>
                    </tr>
                    {(z.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
                    {(z.equipments||[]).map(e => (
                      <Fragment key={`atex-e:${e.id}`}>
                        <tr className="bg-amber-50/60">
                          <td className="p-2 pl-10 text-amber-900">{e.label}</td>
                          <td className="p-2">{e.code || '—'}</td>
                          <td className="p-2 text-sm text-gray-600">Tâches: {(e.tasks||[]).length}</td>
                          <td className="p-2"></td>
                        </tr>
                        {(e.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </>
            )}

            {/* Tâches directement au niveau building (fallback) */}
            {(b.tasks||[]).length > 0 && (
              <>
                <SectionHeader title="Autres tâches" count={countTasks({tasks:b.tasks})} nodeKey={`${bKey}:misc`} />
                {expanded[`${bKey}:misc`] && (b.tasks||[]).map(t => <TaskRow key={`t:${t.id}`} t={t} />)}
              </>
            )}
          </>
        )}
      </Fragment>
    );
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-indigo-50 to-blue-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-gray-800">Controls (TSD)</h1>
        <div className="flex items-center gap-3">
          <button onClick={()=>setShowFilters(true)} className="px-3 py-2 bg-white text-gray-700 rounded-xl shadow ring-1 ring-black/10 hover:bg-gray-50 flex items-center gap-2">
            <SlidersHorizontal size={18}/> Filtres
          </button>
        </div>
      </header>

      <div className="flex gap-4 mb-8 border-b pb-2">
        <button onClick={() => setTab('hierarchy')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'hierarchy' ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-600'}`}>Arborescence</button>
        <button onClick={() => setTab('gantt')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'gantt' ? 'bg-white text-blue-600 shadow-md' : 'text-gray-600'}`}>Gantt</button>
        <button onClick={() => setTab('history')} className={`px-6 py-3 rounded-t-xl font-semibold ${tab === 'history' ? 'bg-white text-indigo-600 shadow-md' : 'text-gray-600'}`}>Historique</button>
      </div>

      {tab === 'hierarchy' && (
        <div className="overflow-x-auto bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-indigo-50 text-gray-700">
                <th className="p-3">Élément</th>
                <th className="p-3">Code</th>
                <th className="p-3">Infos</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tree.map((b, idx) => <BuildingBlock key={`b:${idx}`} b={b} />)}
              {!tree.length && (
                <tr><td colSpan={4} className="text-center text-gray-600 py-16">
                  Aucune donnée. Utilisez le seed TSD côté backend si nécessaire.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'gantt' && (
        <div className="bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold text-gray-800">Gantt des contrôles</h2>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!filters.include_closed} onChange={e=>setFilters(s=>({ ...s, include_closed: e.target.checked }))} />
              Afficher les tâches closes
            </label>
          </div>
          {ganttTasks.length ? (
            <div className="h-[620px] overflow-auto">
              <Gantt
                tasks={ganttTasks}
                viewMode={ViewMode.Month}
                columnWidth={60}
                listCellWidth="320px"
                todayColor="#ff6b00"
              />
            </div>
          ) : <p className="text-gray-600 text-center py-20">Aucune donnée Gantt.</p>}
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-2xl shadow-md ring-1 ring-black/5 p-6">
          <div className="text-gray-600">Sélectionnez une tâche dans l’arborescence pour consulter l’historique détaillé. Un onglet d’audit global pourra être ajouté ici si besoin (export CSV des records, etc.).</div>
        </div>
      )}

      {/* Filters drawer */}
      <Modal open={showFilters} onClose={()=>setShowFilters(false)} title="Filtres" wide>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recherche</label>
            <input className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10" value={filters.q||''} onChange={e=>setFilters(s=>({ ...s, q:e.target.value }))} placeholder="Nom de tâche / code…" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
            <select className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10"
              value={filters.status||'open'}
              onChange={e=>setFilters(s=>({ ...s, status:e.target.value }))}>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="closed">Closed</option>
              <option value="">Tous</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
            <select className="w-full p-2 rounded-xl bg-gray-50 ring-1 ring-black/10"
              value={filters.category||''}
              onChange={e=>setFilters(s=>({ ...s, category:e.target.value }))}>
              <option value="">Toutes</option>
              {(filters.categories||[]).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-between">
          <button onClick={()=>setFilters(f=>({ ...f, building:'', category:'', status:'open', q:'', include_closed:false }))} className="px-3 py-2 rounded-lg ring-1 ring-black/10 bg-gray-50">Effacer</button>
          <button onClick={async ()=>{ setShowFilters(false); await loadTree(); if (tab==='gantt') await loadGantt(); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg">Appliquer</button>
        </div>
      </Modal>

      {toast && <Toast {...toast} onClose={()=>setToast(null)} />}
      {loading && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-indigo-500 rounded-full"></div></div>}
    </section>
  );
}
