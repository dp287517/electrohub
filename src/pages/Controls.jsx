// src/pages/Controls.jsx
// Frontend complet : Tâches, Hiérarchie, Gantt, Outils (confort) + Checklist TSD propre
import React, { useEffect, useMemo, useState, Fragment } from 'react';
import { get, post } from '../lib/api.js';
import { ChevronRight, ChevronDown, SlidersHorizontal, Calendar, Image as ImageIcon, CheckCircle2, Upload, TimerReset, Paperclip, RefreshCw, ListChecks } from 'lucide-react';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

// ---------- Utils UI ----------
function Toast({ msg, type='info', onClose }) {
  const colors = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white'
  };
  useEffect(() => { if (!onClose) return; const t = setTimeout(onClose, 3000); return ()=>clearTimeout(t); }, [onClose]);
  return <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm ${colors[type]} ring-1 ring-black/10`}>{msg}</div>;
}
function Modal({ open, onClose, title, children, wide=false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${wide?'max-w-5xl':'max-w-2xl'} bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5`}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-blue-50">
          <h3 className="text-lg md:text-xl font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">×</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[75vh]">{children}</div>
      </div>
    </div>
  );
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

// ---------- Checklist inline ----------
function ChecklistInline({ task, schema, onCloseTask, busy }) {
  const [checklist, setChecklist] = useState(() =>
    (schema?.checklist || []).map(i => ({
      key: i.key,
      label: i.label,
      value: ''
    }))
  );
  const [observations, setObservations] = useState(() => {
    const base = {};
    (schema?.observations || []).forEach(o => { base[o.key] = ''; });
    return base;
  });
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState([]);

  // IMPORTANT: options par item (ou options globales)
  const getOptionsFor = (item) => (item?.options && item.options.length ? item.options : ["Conforme","Non conforme","Non applicable"]);

  const setValue = (key, v) => setChecklist(cs => cs.map(c => c.key === key ? { ...c, value:v } : c));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setFiles(prev => [...prev, { name:file.name, type:file.type, size:file.size, _b64:b64 }]);
  };

  const submit = async () => {
    const payload = {
      record_status: 'done',
      checklist,
      observations,
      attachments: files.map(f => ({ filename:f.name, mimetype:f.type, size:f.size, data:f._b64 })),
      comment,
      closed_at: new Date().toISOString(), // l’API accepte ISO, côté DB c’est casté
    };
    await onCloseTask(payload);
    setFiles([]);
  };

  return (
    <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 mt-4">
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
                  {getOptionsFor(item).map(opt => <option key={opt} value={opt}>{opt}</option>)}
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
              onChange={e=>setComment(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer hover:bg-gray-50">
          <Upload size={16}/> Joindre une photo
          <input type="file" className="hidden" onChange={handleFile} accept="image/*" />
        </label>
        {files.map((f,idx)=>(
          <span key={idx} className="text-xs bg-white ring-1 ring-black/10 px-2 py-1 rounded-lg flex items-center gap-2">
            <Paperclip size={14}/> {f.name}
          </span>
        ))}
        <div className="flex-1" />
        <button
          disabled={busy}
          onClick={submit}
          className={`px-4 py-2 rounded-lg text-white shadow ${busy?'bg-gray-400':'bg-green-600 hover:bg-green-700'} flex items-center gap-2`}
        >
          <CheckCircle2 size={18}/> Clôturer & Replanifier
        </button>
      </div>
    </div>
  );
}

// ---------- Page principale ----------
export default function Controls() {
  const [tab, setTab] = useState('tasks'); // tasks | hierarchy | gantt | tools
  const [filters, setFilters] = useState({ site:'', task_code:'', status:'open', atex_zone:'', category_key:'', q:'' });
  const [filterData, setFilterData] = useState({ sites:[], task_codes:[], statuses:[], atex_zones:[], categories:[] });
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [order, setOrder] = useState('due_date.asc');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [openTaskId, setOpenTaskId] = useState(null);
  const [taskSchema, setTaskSchema] = useState(null);
  const [taskHistory, setTaskHistory] = useState([]);
  const [taskAttachments, setTaskAttachments] = useState([]);

  const [tree, setTree] = useState([]);
  const [gantt, setGantt] = useState([]);

  // init
  useEffect(() => {
    (async () => {
      try {
        const f = await get('/api/controls/filters');
        setFilterData(f || {});
      } catch (e) {
        setToast({ msg:`Erreur chargement filtres: ${e.message}`, type:'error' });
      }
      await loadTasks(1);
    })();
  // eslint-disable-next-line
  }, []);

  // recharge quand filtres changent
  useEffect(() => { loadTasks(1); /* eslint-disable-next-line */ }, [filters, order]);

  const loadTasks = async (p = page) => {
    if (tab !== 'tasks') return;
    try {
      setBusy(true);
      const params = { ...filters, page:p, page_size:pageSize, order };
      const res = await get('/api/controls/tasks', params);
      setTasks(res?.items || []);
      setPage(p);
    } catch (e) {
      setToast({ msg:`Erreur chargement tâches: ${e.message}`, type:'error' });
    } finally {
      setBusy(false);
    }
  };

  const openDetails = async (t) => {
    try {
      setOpenTaskId(t.id);
      setTaskSchema(null); setTaskHistory([]); setTaskAttachments([]);
      const s = await get(`/api/controls/tasks/${t.id}/schema`);
      setTaskSchema(s);
      const h = await get(`/api/controls/tasks/${t.id}/history`);
      setTaskHistory(Array.isArray(h)?h:[]);
      const a = await get(`/api/controls/tasks/${t.id}/attachments`);
      setTaskAttachments(Array.isArray(a)?a:[]);
    } catch (e) {
      setToast({ msg:`Erreur chargement détails: ${e.message}`, type:'error' });
    }
  };

  const closeTask = async (payload) => {
    try {
      setBusy(true);
      await post(`/api/controls/tasks/${openTaskId}/close`, payload, { method:'PATCH' });
      setToast({ msg:'Tâche clôturée et replanifiée', type:'success' });
      setOpenTaskId(null);
      await loadTasks(1);
      if (tab === 'hierarchy') await loadHierarchy();
      if (tab === 'gantt') await loadCalendar();
    } catch (e) {
      setToast({ msg:`Clôture échouée: ${e.message}`, type:'error' });
    } finally {
      setBusy(false);
    }
  };

  const uploadAttachment = async (file) => {
    if (!openTaskId || !file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      await fetch(`/api/controls/tasks/${openTaskId}/attachments`, { method:'POST', body: form });
      const a = await get(`/api/controls/tasks/${openTaskId}/attachments`);
      setTaskAttachments(Array.isArray(a)?a:[]);
      setToast({ msg:'Pièce jointe ajoutée', type:'success' });
    } catch (e) {
      setToast({ msg:`Upload échoué: ${e.message}`, type:'error' });
    }
  };

  // Hiérarchie
  const loadHierarchy = async () => {
    try {
      setBusy(true);
      const t = await get('/api/controls/hierarchy/tree');
      setTree(Array.isArray(t) ? t : []);
    } catch (e) {
      setToast({ msg:`Erreur hiérarchie: ${e.message}`, type:'error' });
    } finally {
      setBusy(false);
    }
  };

  // Gantt calendrier
  const loadCalendar = async () => {
    try {
      setBusy(true);
      const now = new Date();
      const from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
      const to   = new Date(now.getFullYear()+1, 11, 31).toISOString().slice(0,10);
      const groups = await get('/api/controls/calendar', { from, to });
      const items = [];
      Object.entries(groups || {}).forEach(([date, arr]) => {
        (arr || []).forEach(ev => {
          const start = new Date(date);
          const end = new Date(date);
          end.setDate(end.getDate()+1);
          items.push({
            id: `${ev.id}`,
            name: ev.label,
            start,
            end,
            type: 'task',
            progress: 0,
            styles: {
              backgroundColor: ev.color || '#6366f1',
              backgroundSelectedColor: ev.color || '#6366f1',
              progressColor: '#111827',
              progressSelectedColor: '#111827'
            }
          });
        });
      });
      setGantt(items);
    } catch (e) {
      setToast({ msg:`Erreur calendrier: ${e.message}`, type:'error' });
    } finally {
      setBusy(false);
    }
  };

  // Tools (sync / seed)
  const syncEntities = async (dry=true) => {
    try {
      setBusy(true);
      const r = await get('/api/controls/bootstrap/sync-entities', { dry_run: dry?1:0 });
      setToast({ msg: dry ? `Dry-run sync: ${r.total_created||0} create / ${r.total_updated||0} update` : 'Sync terminé', type:'success' });
    } catch (e) {
      setToast({ msg:`Sync échoué: ${e.message}`, type:'error' });
    } finally { setBusy(false); }
  };
  const seedTsd = async (dry=true) => {
    try {
      setBusy(true);
      const r = await get('/api/controls/bootstrap/seed', { dry_run: dry?1:0, category:'ALL' });
      const n = (r?.actions || []).filter(a => (dry? a.action==='would_create' : a.action==='created')).length;
      setToast({ msg: dry ? `Dry-run seed: ${n} tâches` : `Seed créé: ${n} tâches`, type:'success' });
    } catch (e) {
      setToast({ msg:`Seed échoué: ${e.message}`, type:'error' });
    } finally { setBusy(false); }
  };

  // Rendu helpers
  const FilterBar = () => (
    <div className="bg-white rounded-2xl shadow ring-1 ring-black/5 p-4 mb-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Site</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={filters.site}
            onChange={e=>setFilters(s=>({ ...s, site:e.target.value }))}>
            <option value="">Tous</option>
            {filterData.sites?.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Code tâche</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={filters.task_code}
            onChange={e=>setFilters(s=>({ ...s, task_code:e.target.value }))}>
            <option value="">Tous</option>
            {filterData.task_codes?.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Statut</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={filters.status}
            onChange={e=>setFilters(s=>({ ...s, status:e.target.value }))}>
            <option value="open">Ouvertes</option>
            {filterData.statuses?.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Zone ATEX</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={filters.atex_zone}
            onChange={e=>setFilters(s=>({ ...s, atex_zone:e.target.value }))}>
            <option value="">Toutes</option>
            {filterData.atex_zones?.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Catégorie TSD</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={filters.category_key}
            onChange={e=>setFilters(s=>({ ...s, category_key:e.target.value }))}>
            <option value="">Toutes</option>
            {filterData.categories?.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-600 mb-1">Recherche</label>
          <input className="w-full p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            placeholder="Label, code…"
            value={filters.q}
            onChange={e=>setFilters(s=>({ ...s, q:e.target.value }))} />
        </div>

        <div className="flex-1" />
        <div>
          <label className="block text-xs text-gray-600 mb-1">Tri</label>
          <select className="p-2 rounded-lg bg-gray-50 ring-1 ring-black/10"
            value={order}
            onChange={e=>setOrder(e.target.value)}>
            <option value="due_date.asc">Échéance ↑</option>
            <option value="due_date.desc">Échéance ↓</option>
            <option value="task_name.asc">Libellé ↑</option>
            <option value="task_name.desc">Libellé ↓</option>
            <option value="status.asc">Statut ↑</option>
            <option value="status.desc">Statut ↓</option>
          </select>
        </div>
      </div>
    </div>
  );

  // ----------- RENDER -----------
  return (
    <section className="p-6 md:p-8 max-w-7xl mx-auto bg-gradient-to-br from-indigo-50 to-blue-50 rounded-3xl shadow-xl min-h-screen">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-800">Controls (TSD)</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('tasks')} className={`px-3 md:px-4 py-2 rounded-xl ${tab==='tasks'?'bg-white text-indigo-700 shadow':'text-gray-600 ring-1 ring-black/10'}`}>Tâches</button>
          <button onClick={async ()=>{ setTab('hierarchy'); await loadHierarchy(); }} className={`px-3 md:px-4 py-2 rounded-xl ${tab==='hierarchy'?'bg-white text-indigo-700 shadow':'text-gray-600 ring-1 ring-black/10'}`}>Hiérarchie</button>
          <button onClick={async ()=>{ setTab('gantt'); await loadCalendar(); }} className={`px-3 md:px-4 py-2 rounded-xl ${tab==='gantt'?'bg-white text-indigo-700 shadow':'text-gray-600 ring-1 ring-black/10'}`}>Gantt</button>
          <button onClick={()=>setTab('tools')} className={`px-3 md:px-4 py-2 rounded-xl ${tab==='tools'?'bg-white text-indigo-700 shadow':'text-gray-600 ring-1 ring-black/10'}`}>Outils</button>
        </div>
      </header>

      {/* TÂCHES */}
      {tab === 'tasks' && (
        <>
          <FilterBar />
          <div className="overflow-x-auto bg-white rounded-2xl shadow ring-1 ring-black/5">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-indigo-50 text-gray-700">
                  <th className="p-3">Label</th>
                  <th className="p-3">Code</th>
                  <th className="p-3">Statut</th>
                  <th className="p-3">Échéance</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-gray-500">Aucune tâche</td></tr>
                )}
                {tasks.map(t => (
                  <tr key={t.id} className="hover:bg-indigo-50/50">
                    <td className="p-3">{t.label}</td>
                    <td className="p-3 text-xs text-gray-600">{t.task_code}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 text-xs rounded-lg ${t.status==='Overdue'?'bg-red-100 text-red-700':t.status==='Planned'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="p-3">{fmtDate(t.due_date)}</td>
                    <td className="p-3">
                      <button className="px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700" onClick={() => openDetails(t)}>
                        Détails
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pagination simple */}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button disabled={page<=1} onClick={()=>loadTasks(page-1)} className="px-3 py-1 rounded-lg ring-1 ring-black/10 bg-white disabled:opacity-50">Préc.</button>
            <div className="text-sm text-gray-600">Page {page}</div>
            <button disabled={tasks.length < pageSize} onClick={()=>loadTasks(page+1)} className="px-3 py-1 rounded-lg ring-1 ring-black/10 bg-white disabled:opacity-50">Suiv.</button>
          </div>
        </>
      )}

      {/* HIÉRARCHIE */}
      {tab === 'hierarchy' && (
        <div className="bg-white rounded-2xl shadow ring-1 ring-black/5 p-4">
          {tree.length === 0 && <div className="text-center text-gray-500 p-8">Aucun équipement. Lance “Sync Entities” et “Seed TSD” dans l’onglet Outils.</div>}
          {tree.map((b, bi) => (
            <div key={`b-${bi}`} className="mb-6">
              <div className="text-xl font-semibold text-gray-800 mb-2">🏢 {b.label}</div>

              {/* HV */}
              {!!(b.hv || []).length && (
                <div className="mb-3">
                  <div className="font-semibold text-gray-700 mb-1">High Voltage</div>
                  <div className="space-y-2">
                    {b.hv.map((h, hi) => (
                      <div key={`hv-${bi}-${hi}`} className="p-3 rounded-lg ring-1 ring-black/10">
                        <div className="font-medium">{h.label}</div>
                        {(h.tasks || []).length > 0 ? (
                          <ul className="list-disc pl-5 mt-1">
                            {h.tasks.map(t => (
                              <li key={`hvt-${t.id}`}>
                                <button className="text-indigo-700 hover:underline" onClick={()=>openDetails({ id:t.id })}>{t.label}</button>
                                <span className="text-xs text-gray-500 ml-2">{fmtDate(t.due_date)} — {t.status}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <div className="text-xs text-gray-500 mt-1">Aucune tâche</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Switchboards */}
              {!!(b.switchboards || []).length && (
                <div className="mb-3">
                  <div className="font-semibold text-gray-700 mb-1">Switchboards</div>
                  <div className="space-y-2">
                    {b.switchboards.map((s, si) => (
                      <div key={`sw-${bi}-${si}`} className="p-3 rounded-lg ring-1 ring-black/10">
                        <div className="font-medium">{s.label}</div>
                        {(s.tasks || []).length > 0 && (
                          <ul className="list-disc pl-5 mt-1">
                            {s.tasks.map(t => (
                              <li key={`swt-${t.id}`}>
                                <button className="text-indigo-700 hover:underline" onClick={()=>openDetails({ id:t.id })}>{t.label}</button>
                                <span className="text-xs text-gray-500 ml-2">{fmtDate(t.due_date)} — {t.status}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* Devices */}
                        {!!(s.devices || []).length && (
                          <div className="mt-2">
                            <div className="text-sm font-medium text-gray-700">Devices</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                              {s.devices.map((d, di) => (
                                <div key={`dev-${bi}-${si}-${di}`} className="p-2 rounded ring-1 ring-black/10">
                                  <div className="font-medium text-sm">{d.label}</div>
                                  {(d.tasks || []).length
                                    ? <ul className="list-disc pl-5">
                                        {d.tasks.map(t => (
                                          <li key={`dt-${t.id}`}>
                                            <button className="text-indigo-700 hover:underline" onClick={()=>openDetails({ id:t.id })}>{t.label}</button>
                                            <span className="text-xs text-gray-500 ml-2">{fmtDate(t.due_date)} — {t.status}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    : <div className="text-xs text-gray-500">Aucune tâche</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ATEX */}
              {!!(b.atex || []).length && (
                <div className="mb-3">
                  <div className="font-semibold text-gray-700 mb-1">ATEX</div>
                  <div className="space-y-2">
                    {b.atex.map((z, zi) => (
                      <div key={`atex-${bi}-${zi}`} className="p-3 rounded-lg ring-1 ring-black/10">
                        <div className="font-medium">Zone {z.zone}</div>
                        {(z.tasks || []).length > 0 && (
                          <ul className="list-disc pl-5 mt-1">
                            {z.tasks.map(t => (
                              <li key={`zt-${t.id}`}>
                                <button className="text-indigo-700 hover:underline" onClick={()=>openDetails({ id:t.id })}>{t.label}</button>
                                <span className="text-xs text-gray-500 ml-2">{fmtDate(t.due_date)} — {t.status}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!!(z.equipments || []).length && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                            {z.equipments.map((e, ei) => (
                              <div key={`ae-${ei}`} className="p-2 rounded ring-1 ring-black/10">
                                <div className="font-medium text-sm">{e.label}</div>
                                {(e.tasks || []).length
                                  ? <ul className="list-disc pl-5">
                                      {e.tasks.map(t => (
                                        <li key={`aet-${t.id}`}>
                                          <button className="text-indigo-700 hover:underline" onClick={()=>openDetails({ id:t.id })}>{t.label}</button>
                                          <span className="text-xs text-gray-500 ml-2">{fmtDate(t.due_date)} — {t.status}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  : <div className="text-xs text-gray-500">Aucune tâche</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* GANTT */}
      {tab === 'gantt' && (
        <div className="bg-white rounded-2xl shadow ring-1 ring-black/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-gray-800">Gantt — Tâches planifiées</div>
            <button onClick={loadCalendar} className="px-3 py-2 rounded-lg bg-white ring-1 ring-black/10 hover:bg-gray-50 flex items-center gap-2"><RefreshCw size={16}/> Rafraîchir</button>
          </div>
          {gantt.length
            ? <div className="h-[640px] overflow-auto">
                <Gantt tasks={gantt} viewMode={ViewMode.Month} listCellWidth="320px" columnWidth={54} todayColor="#f97316" />
              </div>
            : <div className="text-center text-gray-500 p-10">Aucune donnée (lancez le seed si nécessaire).</div>
          }
        </div>
      )}

      {/* OUTILS */}
      {tab === 'tools' && (
        <div className="bg-white rounded-2xl shadow ring-1 ring-black/5 p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-3">Outils (confort)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl ring-1 ring-black/10">
              <div className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><ListChecks size={18}/> Sync Entities</div>
              <p className="text-sm text-gray-600 mb-3">Crée/Met à jour <code>controls_entities</code> à partir des tables *switchboards*, *devices*, *atex_equipments*, *hv_*.</p>
              <div className="flex gap-2">
                <button onClick={()=>syncEntities(true)} className="px-3 py-2 rounded-lg bg-white ring-1 ring-black/10 hover:bg-gray-50">Dry-run</button>
                <button onClick={()=>syncEntities(false)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Exécuter</button>
              </div>
            </div>
            <div className="p-4 rounded-xl ring-1 ring-black/10">
              <div className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><TimerReset size={18}/> Seed TSD</div>
              <p className="text-sm text-gray-600 mb-3">Génère les tâches selon la *tsd_library* pour chaque entité (fréquences incluses).</p>
              <div className="flex gap-2">
                <button onClick={()=>seedTsd(true)} className="px-3 py-2 rounded-lg bg-white ring-1 ring-black/10 hover:bg-gray-50">Dry-run</button>
                <button onClick={()=>seedTsd(false)} className="px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700">Créer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DÉTAILS */}
      <Modal
        open={!!openTaskId}
        onClose={()=>setOpenTaskId(null)}
        title={taskSchema?.label || 'Détails de la tâche'}
        wide
      >
        {!taskSchema && <div className="text-center text-gray-500 py-10">Chargement…</div>}
        {taskSchema && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><div className="text-xs text-gray-500">Code</div><div className="font-medium">{taskSchema.task_code}</div></div>
              <div><div className="text-xs text-gray-500">Catégorie</div><div className="font-medium">{taskSchema.tsd_category?.label || '—'}</div></div>
              <div><div className="text-xs text-gray-500">Procédure</div><div className="text-xs text-gray-700 line-clamp-2">{taskSchema.procedure_md || '—'}</div></div>
              <div><div className="text-xs text-gray-500">PPE</div><div className="text-xs text-gray-700 line-clamp-2">{taskSchema.ppe_md || '—'}</div></div>
            </div>

            {/* Checklist */}
            <ChecklistInline task={{ id:openTaskId }} schema={taskSchema} onCloseTask={closeTask} busy={busy} />

            {/* Pièces jointes */}
            <div className="mt-4">
              <div className="font-semibold text-gray-800 mb-2">Pièces jointes</div>
              <div className="flex items-center gap-3 mb-2">
                <label className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer hover:bg-gray-50">
                  <ImageIcon size={16}/> Joindre
                  <input type="file" className="hidden" onChange={(e)=>e.target.files && uploadAttachment(e.target.files[0])} />
                </label>
              </div>
              {taskAttachments.length === 0 && <div className="text-sm text-gray-500">Aucune pièce jointe</div>}
              <ul className="text-sm">
                {taskAttachments.map(a => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Paperclip size={14}/> <a className="text-indigo-700 hover:underline" href={`/api/controls/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a>
                    <span className="text-xs text-gray-500">({a.mimetype}, {a.size} o)</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Historique */}
            <div className="mt-4">
              <div className="font-semibold text-gray-800 mb-2">Historique</div>
              {taskHistory.length === 0 && <div className="text-sm text-gray-500">Aucun historique</div>}
              <ul className="text-sm">
                {taskHistory.map((h, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Calendar size={14}/> {fmtDate(h.date)} — {h.action} — <span className="text-gray-500">{h.user || h.user_name || 'system'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast {...toast} onClose={()=>setToast(null)} />}
      {busy && <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><div className="animate-spin h-16 w-16 border-b-4 border-indigo-500 rounded-full"></div></div>}
    </section>
  );
}
