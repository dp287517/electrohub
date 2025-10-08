// Controls.jsx — Dashboard moderne (Sidebar hiérarchique + Tâches par équipement + Checklist TSD + IA réelle + Gantt)
// Dépendances: react, lucide-react, gantt-task-react, dayjs
// API utilisées côté backend (server_controls.js):
//   GET  /api/controls/hierarchy/tree
//   GET  /api/controls/tasks/:id/schema
//   POST /api/controls/tasks/:id/attachments  (FormData)
//   PATCH /api/controls/tasks/:id/close       (JSON)
//   GET  /api/controls/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//   POST /api/controls/ai/analyze-before      (FormData)  // IA réelle

import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { get, post } from '../lib/api.js';
import { ChevronRight, ChevronDown, Filter, Calendar, Image as ImageIcon, CheckCircle2, Upload, Paperclip, AlertTriangle, Shield, Loader2 } from 'lucide-react';
import dayjs from 'dayjs';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

// ---------------------------------------------------------------------------
// Helpers API
// ---------------------------------------------------------------------------
async function patchJSON(url, data) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    throw new Error(t || `PATCH ${url} failed`);
  }
  return r.json();
}

const STATUS_BADGE = {
  Planned: 'bg-indigo-100 text-indigo-800',
  Pending: 'bg-blue-100 text-blue-800',
  Overdue: 'bg-red-100 text-red-800',
  Done: 'bg-emerald-100 text-emerald-800',
  Open: 'bg-indigo-100 text-indigo-800', // alias
};

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------
function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{children}</h3>
      {right}
    </div>
  );
}
function Badge({ children, className = '' }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${className}`} children={children} />;
}
function Pill({ color = '#6366f1' }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: color }} />;
}
function Spinner({ className = '' }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}
function Divider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent my-3" />;
}

// ---------------------------------------------------------------------------
// Sidebar: Tree & collapses
// ---------------------------------------------------------------------------
function Collapse({ title, count = 0, open, onToggle, children, icon = null }) {
  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-200"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="font-medium text-gray-800">{title}</span>
          {typeof count === 'number' && <Badge className="bg-gray-100 text-gray-700">{count}</Badge>}
        </div>
        {icon}
      </button>
      {open && <div className="mt-2 ml-5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist Inline (labels TSD, options par défaut si manquantes)
// ---------------------------------------------------------------------------
function ChecklistInline({ task, schema, onClosed }) {
  // schema: { checklist[], observations[], procedure_md, hazards_md, ppe_md, tools_md }
  const defaultOptions = ['Conforme','Non conforme','Non applicable'];
  const [checklist, setChecklist] = useState(
    () => (schema?.checklist || []).map(i => ({ key: i.key, label: i.label, value: '' }))
  );
  const [observations, setObservations] = useState(() => {
    const base = {};
    (schema?.observations || []).forEach(o => { base[o.key] = ''; });
    return base;
  });
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const first = (schema?.checklist || [])[0];
    return (first && Array.isArray(first.options) && first.options.length) ? first.options : defaultOptions;
  }, [schema]);

  const setValue = (key, value) => setChecklist(cs => cs.map(c => (c.key === key ? { ...c, value } : c)));

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setFiles(prev => [...prev, { file: f, name: f.name, type: f.type, size: f.size, _b64: b64 }]);
  };

  const runIA = async (withFile) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('task_id', String(task.id));
      fd.append('hints', JSON.stringify(Object.keys(observations || {})));
      fd.append('attach', withFile ? '1' : '0');
      if (withFile && files[0]) {
        fd.append('file', files[0].file, files[0].name);
      }
      const r = await fetch('/api/controls/ai/analyze-before', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      alert([
        'Consignes IA :',
        `- EPI : ${data?.safety?.ppe || '—'}`,
        `- Dangers : ${data?.safety?.hazards || '—'}`,
        ...(Array.isArray(data?.procedure?.steps) ? data.procedure.steps.map(s => `- Étape ${s.step || ''}: ${s.text}`) : [])
      ].join('\n'));
    } catch (e) {
      alert(`Erreur IA: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadAllFiles = async () => {
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f.file, f.name);
      await fetch(`/api/controls/tasks/${task.id}/attachments`, { method: 'POST', body: fd });
    }
  };

  const closeTask = async () => {
    setBusy(true);
    try {
      await uploadAllFiles();
      const payload = {
        record_status: 'done',
        checklist,
        observations,
        attachments: [], // déjà uploadées juste au-dessus
        comment,
        closed_at: dayjs().format('YYYY-MM-DD'),
      };
      const res = await patchJSON(`/api/controls/tasks/${task.id}/close`, payload);
      onClosed?.(res);
    } catch (e) {
      alert(`Clôture échouée: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle>Checklist</SectionTitle>
          <div className="space-y-3">
            {(schema?.checklist || []).map((item, idx) => (
              <div key={item.key || idx} className="flex items-center gap-3">
                <div className="flex-1 text-sm text-gray-800">{item.label}</div>
                <select
                  className="p-2 rounded-lg bg-gray-50 border border-gray-200"
                  value={checklist[idx]?.value || ''}
                  onChange={e => setValue(item.key, e.target.value)}
                >
                  <option value="">Sélectionner</option>
                  {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>Observations</SectionTitle>
          <div className="space-y-3">
            {(schema?.observations || []).map((o, i) => (
              <div key={o.key || i}>
                <label className="block text-xs text-gray-600 mb-1">{o.label}</label>
                <input
                  className="w-full p-2 rounded-lg bg-gray-50 border border-gray-200"
                  value={observations[o.key] || ''}
                  onChange={e => setObservations(s => ({ ...s, [o.key]: e.target.value }))}
                />
              </div>
            ))}
            <label className="block text-xs text-gray-600 mb-1">Commentaires</label>
            <textarea
              className="w-full p-2 rounded-lg bg-gray-50 border border-gray-200"
              rows={3}
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Divider />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <Upload size={16}/> Joindre une photo
          <input type="file" className="hidden" accept="image/*" onChange={handleFile} />
        </label>
        {files.map((f, i) => (
          <span key={i} className="text-xs bg-white border border-gray-200 px-2 py-1 rounded-lg flex items-center gap-2">
            <Paperclip size={14}/> {f.name}
          </span>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => runIA(Boolean(files.length))}
          disabled={busy}
          className={`px-3 py-2 rounded-lg border ${busy ? 'bg-gray-200 text-gray-500' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'}`}
          title="Analyse des consignes et étapes par l'IA"
        >
          {busy ? <Spinner className="w-4 h-4 inline mr-2" /> : <ImageIcon size={16} className="inline mr-2" />}
          Analyse IA
        </button>
        <button
          onClick={closeTask}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-white shadow ${busy ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'} flex items-center gap-2`}
          title="Clôturer la tâche et replanifier selon la TSD"
        >
          <CheckCircle2 size={18}/> Clôturer & Replanifier
        </button>
      </div>

      {(schema?.hazards_md || schema?.ppe_md) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {schema?.hazards_md && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <div className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle size={16}/> Dangers</div>
              <div className="whitespace-pre-line">{schema.hazards_md}</div>
            </div>
          )}
          {schema?.ppe_md && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              <div className="font-semibold flex items-center gap-2 mb-1"><Shield size={16}/> EPI</div>
              <div className="whitespace-pre-line">{schema.ppe_md}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskCard — charge le schema TSD & affiche ChecklistInline
// ---------------------------------------------------------------------------
function TaskCard({ task, statusFilter, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState(null);
  const openThis = async () => {
    setOpen(o => !o);
    if (!schema) {
      try {
        const s = await get(`/api/controls/tasks/${task.id}/schema`);
        setSchema(s);
      } catch (e) {
        alert(`Chargement du schéma échoué: ${e.message}`);
      }
    }
  };
  const visible = useMemo(() => {
    if (!statusFilter || statusFilter === 'all') return true;
    const st = (task.status || '').toLowerCase();
    if (statusFilter === 'open') return ['planned','pending','overdue'].includes(st);
    return st === statusFilter;
  }, [statusFilter, task.status]);

  if (!visible) return null;

  return (
    <div className="mb-3 border border-gray-200 rounded-xl bg-white">
      <button onClick={openThis} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-xl">
        <div className="flex items-center gap-3">
          <Pill color={task.color || '#6366f1'} />
          <div>
            <div className="font-medium text-gray-900">{task.label}</div>
            <div className="text-xs text-gray-500">{task.code}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={STATUS_BADGE[task.status] || 'bg-gray-100 text-gray-700'}>{task.status}</Badge>
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <Calendar size={14}/> {task.due_date ? dayjs(task.due_date).format('DD/MM/YYYY') : '—'}
          </div>
          {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {schema ? (
            <ChecklistInline
              task={task}
              schema={schema}
              onClosed={() => onRefresh?.()}
            />
          ) : (
            <div className="py-6 text-center text-gray-500"><Spinner className="inline w-5 h-5 mr-2" />Chargement du schéma…</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Controls() {
  const [tab, setTab] = useState('hierarchy'); // 'hierarchy' | 'gantt'
  const [tree, setTree] = useState([]);        // /hierarchy/tree
  const [expanded, setExpanded] = useState({}); // { key: boolean }
  const [selectedEquip, setSelectedEquip] = useState(null); // {type, id, label, tasks:[]}
  const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'closed' | 'overdue' | 'all'
  const [busy, setBusy] = useState(false);
  const [ganttData, setGanttData] = useState([]);

  // Load hierarchy
  const loadTree = async () => {
    setBusy(true);
    try {
      const data = await get('/api/controls/hierarchy/tree');
      setTree(Array.isArray(data) ? data : []);
      // Auto-select first equipment if none selected
      if (!selectedEquip) {
        const first = findFirstEquipment(data);
        if (first) setSelectedEquip(first);
      }
    } catch (e) {
      console.error(e);
      alert(`Erreur hiérarchie: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Gantt data
  const loadGantt = async () => {
    try {
      const from = dayjs().subtract(3, 'month').format('YYYY-MM-DD');
      const to   = dayjs().add(18, 'month').format('YYYY-MM-DD');
      const groups = await get('/api/controls/calendar', { from, to });
      // groups = { '2026-01-07': [ {id,label,due_date,color,...}, ...], ... }
      const tasks = [];
      const today = new Date();
      Object.entries(groups || {}).forEach(([date, items], idx) => {
        (items || []).forEach((it, k) => {
          const start = new Date(date);
          const end = new Date(date);
          // petit padding visuel
          end.setDate(end.getDate() + 1);
          tasks.push({
            id: `${it.id}`,
            name: it.label,
            start,
            end,
            type: 'task',
            progress: 0,
            styles: {
              backgroundColor: it.color || '#6366f1',
              backgroundSelectedColor: it.color || '#6366f1',
              progressColor: '#111827',
              progressSelectedColor: '#111827',
            },
          });
        });
      });
      // ligne Today
      tasks.push({
        id: 'today',
        name: 'Aujourd’hui',
        start: today,
        end: today,
        type: 'milestone',
        styles: { backgroundColor: '#111827' }
      });
      setGanttData(tasks);
    } catch (e) {
      console.error(e);
      alert(`Erreur Gantt: ${e.message}`);
    }
  };

  useEffect(() => {
    loadTree();
  }, []);
  useEffect(() => {
    if (tab === 'gantt') loadGantt();
  }, [tab]);

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const selectEquip = (obj) => setSelectedEquip(obj);

  const refreshAfterClose = async () => {
    await loadTree();
  };

  // Rendu Sidebar hiérarchie
  const renderATEX = (site) => {
    // site.atex = [{ zone, equipments:[{id,label,tasks:[]}] , tasks:[] }]
    return (site.atex || []).map((z, zi) => {
      const zKey = `${site.id}-atex-${zi}`;
      const equipCount = (z.equipments || []).length;
      return (
        <Collapse
          key={zKey}
          title={`Zone ${z.zone || 'Z?'}`}
          count={equipCount}
          open={!!expanded[zKey]}
          onToggle={() => toggle(zKey)}
        >
          {(z.equipments || []).map((e) => {
            const eKey = `${zKey}-e-${e.id}`;
            const count = (e.tasks || []).length;
            return (
              <button
                key={eKey}
                onClick={() => selectEquip({ type:'atex', id:e.id, label:e.label, tasks:e.tasks || [] })}
                className={`w-full text-left px-3 py-2 rounded-lg border ${selectedEquip?.type==='atex' && selectedEquip?.id===e.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'} mb-2`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-800">{e.label}</span>
                  <Badge className="bg-gray-100 text-gray-700">{count}</Badge>
                </div>
              </button>
            );
          })}
          {(z.tasks || []).length === 0 && (z.equipments || []).length === 0 && (
            <div className="text-xs text-gray-500 ml-1">Aucun équipement ATEX.</div>
          )}
        </Collapse>
      );
    });
  };

  const renderSwitchboards = (site) => {
    // site.switchboards = [{ id,label,devices:[{id,label,tasks:[]}] ,tasks:[] }]
    return (site.switchboards || []).map((sb) => {
      const sbKey = `${site.id}-sb-${sb.id}`;
      const countDevices = (sb.devices || []).length;
      return (
        <Collapse
          key={sbKey}
          title={sb.label}
          count={countDevices}
          open={!!expanded[sbKey]}
          onToggle={() => toggle(sbKey)}
        >
          {(sb.devices || []).map((d) => {
            const dKey = `${sbKey}-dev-${d.id}`;
            const count = (d.tasks || []).length;
            return (
              <button
                key={dKey}
                onClick={() => selectEquip({ type:'device', id:d.id, label:d.label, tasks:d.tasks || [] })}
                className={`w-full text-left px-3 py-2 rounded-lg border ${selectedEquip?.type==='device' && selectedEquip?.id===d.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'} mb-2`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-800">{d.label}</span>
                  <Badge className="bg-gray-100 text-gray-700">{count}</Badge>
                </div>
              </button>
            );
          })}
          {(sb.tasks || []).length > 0 && (
            <div className="mt-2">
              <SectionTitle>Tâches liées au switchboard</SectionTitle>
              {(sb.tasks || []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectEquip({ type:'switchboard', id:sb.id, label:sb.label, tasks:sb.tasks })}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 mb-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-800">{t.label}</span>
                    <Badge className={STATUS_BADGE[t.status] || 'bg-gray-100 text-gray-700'}>{t.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
          {(sb.devices || []).length === 0 && (sb.tasks || []).length === 0 && (
            <div className="text-xs text-gray-500 ml-1">Aucun appareil rattaché.</div>
          )}
        </Collapse>
      );
    });
  };

  const renderHV = (site) => {
    // site.hv = [{ id,label,tasks:[] }]
    return (
      <Collapse
        title="High Voltage"
        count={(site.hv || []).length}
        open={!!expanded[`${site.id}-hv`]}
        onToggle={() => toggle(`${site.id}-hv`)}
      >
        {(site.hv || []).map(h => {
          const hKey = `${site.id}-hv-${h.id}`;
          const count = (h.tasks || []).length;
          return (
            <button
              key={hKey}
              onClick={() => selectEquip({ type:'hv', id:h.id, label:h.label, tasks:h.tasks || [] })}
              className={`w-full text-left px-3 py-2 rounded-lg border ${selectedEquip?.type==='hv' && selectedEquip?.id===h.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'} mb-2`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-800">{h.label}</span>
                <Badge className="bg-gray-100 text-gray-700">{count}</Badge>
              </div>
            </button>
          );
        })}
        {(site.hv || []).length === 0 && <div className="text-xs text-gray-500 ml-1">Aucun équipement HT.</div>}
      </Collapse>
    );
  };

  const renderSite = (site) => {
    const key = `site-${site.id}`;
    return (
      <div key={key} className="mb-4">
        <button
          onClick={() => toggle(key)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200"
        >
          <div className="flex items-center gap-2">
            {expanded[key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="font-semibold text-gray-800">{site.label}</span>
          </div>
        </button>

        {expanded[key] && (
          <div className="mt-2 ml-3">
            {renderHV(site)}
            <Collapse
              title="Switchboards"
              count={(site.switchboards || []).length}
              open={!!expanded[`${site.id}-sb`]}
              onToggle={() => toggle(`${site.id}-sb`)}
            >
              {renderSwitchboards(site)}
            </Collapse>

            <Collapse
              title="ATEX"
              count={(site.atex || []).reduce((n,z)=> n + (z.equipments?.length||0), 0)}
              open={!!expanded[`${site.id}-atex`]}
              onToggle={() => toggle(`${site.id}-atex`)}
            >
              {renderATEX(site)}
            </Collapse>
          </div>
        )}
      </div>
    );
  };

  // Panneau principal: liste des tâches de l'équipement sélectionné
  const renderMainTasks = () => {
    if (!selectedEquip) {
      return <div className="text-gray-500 text-sm">Sélectionne un équipement dans la hiérarchie pour voir ses tâches.</div>;
    }
    const tasks = selectedEquip.tasks || [];
    if (!tasks.length) {
      return <div className="text-gray-500 text-sm">Aucune tâche définie pour cet équipement.</div>;
    }
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-500">Équipement sélectionné :</div>
          <div className="text-sm font-medium text-gray-800">{selectedEquip.label}</div>
        </div>
        <div className="flex items-center gap-2 mb-4">
          <Filter size={14} className="text-gray-500" />
          <select
            className="p-2 rounded-lg bg-white border border-gray-200 text-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="open">Ouvert (Planned/Pending/Overdue)</option>
            <option value="overdue">En retard (Overdue)</option>
            <option value="closed">Clôturé (Done)</option>
            <option value="all">Tous</option>
          </select>
        </div>
        {tasks.map(t => (
          <TaskCard
            key={t.id}
            task={t}
            statusFilter={statusFilter}
            onRefresh={refreshAfterClose}
          />
        ))}
      </div>
    );
  };

  return (
    <section className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Controls</h1>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${tab==='hierarchy'?'bg-gray-900 text-white':'bg-white border border-gray-200 text-gray-700'}`}
              onClick={()=>setTab('hierarchy')}
            >
              Hiérarchie
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-sm ${tab==='gantt'?'bg-gray-900 text-white':'bg-white border border-gray-200 text-gray-700'}`}
              onClick={()=>setTab('gantt')}
            >
              Gantt
            </button>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="lg:col-span-4">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <SectionTitle right={busy ? <Spinner className="w-4 h-4 text-gray-500" /> : null}>Bâtiments & équipements</SectionTitle>
            {tree.length === 0 && !busy && (
              <div className="text-sm text-gray-500">Aucune donnée d’équipement. Lance d’abord le sync d’entités + seed TSD.</div>
            )}
            {(tree || []).map(renderSite)}
          </div>
        </aside>

        {/* Main */}
        <main className="lg:col-span-8">
          {tab === 'hierarchy' && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <SectionTitle>Tâches</SectionTitle>
              {renderMainTasks()}
            </div>
          )}

          {tab === 'gantt' && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <SectionTitle>Planification</SectionTitle>
              <div className="h-[600px] overflow-auto bg-white border border-gray-200 rounded-xl">
                {ganttData.length ? (
                  <Gantt
                    tasks={ganttData}
                    viewMode={ViewMode.Month}
                    listCellWidth="280px"
                    columnWidth={60}
                    todayColor="#ff6b00"
                  />
                ) : (
                  <div className="p-6 text-sm text-gray-500">Chargement ou aucune tâche planifiée…</div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

// util: trouve le premier équipement ayant des tâches
function findFirstEquipment(tree) {
  for (const site of tree || []) {
    // HV
    for (const hv of site.hv || []) {
      if ((hv.tasks || []).length) return { type:'hv', id:hv.id, label:hv.label, tasks:hv.tasks };
    }
    // Switchboards / Devices
    for (const sb of site.switchboards || []) {
      if ((sb.tasks || []).length) return { type:'switchboard', id:sb.id, label:sb.label, tasks:sb.tasks };
      for (const d of sb.devices || []) {
        if ((d.tasks || []).length) return { type:'device', id:d.id, label:d.label, tasks:d.tasks };
      }
    }
    // ATEX
    for (const z of site.atex || []) {
      for (const e of z.equipments || []) {
        if ((e.tasks || []).length) return { type:'atex', id:e.id, label:e.label, tasks:e.tasks };
      }
    }
  }
  return null;
}
