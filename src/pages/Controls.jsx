// src/pages/Controls.jsx
// Dashboard Contrôles (TSD) — Hiérarchie + Checklist + IA (sans Gantt)

import React, { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api.js';
import {
  ChevronRight, ChevronDown, SlidersHorizontal, Image as ImageIcon,
  CheckCircle2, Upload, Paperclip, Sparkles, Link2, Rocket
} from 'lucide-react';

// ---------- UI helpers ----------
const Pill = ({ color = 'bg-gray-200 text-gray-800', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{children}</span>
);
const StatusPill = ({ status }) => {
  const s = String(status || '').toLowerCase();
  if (s === 'done' || s === 'closed') return <Pill color="bg-green-100 text-green-700">Done</Pill>;
  if (s === 'overdue') return <Pill color="bg-red-100 text-red-700">Overdue</Pill>;
  if (s === 'pending') return <Pill color="bg-amber-100 text-amber-700">Pending</Pill>;
  return <Pill color="bg-blue-100 text-blue-700">{status || 'Planned'}</Pill>;
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

function Toast({ msg, type='info', onClose }) {
  const colors = { success:'bg-green-600', error:'bg-red-600', info:'bg-blue-600' };
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-xl text-sm text-white ${colors[type]} ring-1 ring-black/10`}>
      {msg}
    </div>
  );
}

// ---------- API helpers ----------
async function patchJSON(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Utilitaires backend (bootstrap/seed)
async function call(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---------- Inline checklist widget ----------
function ChecklistInline({ task, schema, onClosed, busy, pushToast }) {
  const [checklist, setChecklist] = useState(() =>
    (schema?.checklist || []).map(i => ({ key: i.key, label: i.label, value: '' }))
  );
  const [observations, setObservations] = useState(() => {
    const base = {};
    (schema?.observations || []).forEach(o => { base[o.key] = ''; });
    return base;
  });
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState([]);

  // options propres (depuis le 1er item si présent), sinon fallback TSD meta
  const checklistOptions = useMemo(() => {
    const first = (schema?.checklist || [])[0];
    if (first && Array.isArray(first.options) && first.options.length) return first.options;
    return ['Conforme','Non conforme','Non applicable'];
  }, [schema]);

  const setValue = (key, v) =>
    setChecklist(cs => cs.map(c => c.key === key ? { ...c, value: v } : c));

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setFiles(prev => [...prev, { name: f.name, type: f.type, size: f.size, _b64: b64 }]);
  };

  const submit = async () => {
    const payload = {
      record_status: 'done',
      checklist,
      observations,
      attachments: files.map(f => ({ filename: f.name, mimetype: f.type, size: f.size, data: f._b64 })),
      comment,
      closed_at: new Date().toISOString(),
    };
    await onClosed(payload);
    setFiles([]);
    setComment('');
    pushToast('Tâche clôturée et replanifiée.', 'success');
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 mt-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">Checklist</h4>
          <div className="space-y-3">
            {(schema?.checklist || []).map((item, idx) => (
              <div key={item.key || idx} className="flex items-center gap-3">
                <div className="flex-1 text-sm text-gray-800">{item.label}</div>
                <select
                  className="p-2 rounded-lg bg-white ring-1 ring-black/10"
                  value={(checklist.find(c => c.key === item.key)?.value) || ''}
                  onChange={e => setValue(item.key, e.target.value)}
                >
                  <option value="">Sélectionner</option>
                  {checklistOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">Observations</h4>
          <div className="space-y-3">
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
            <div>
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
          className={`px-4 py-2 rounded-lg text-white shadow ${busy ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'} flex items-center gap-2`}
        >
          <CheckCircle2 size={18}/> Clôturer & Replanifier
        </button>
      </div>
    </div>
  );
}

// ---------- IA before-intervention ----------
function AiAssist({ task, onUploaded, pushToast }) {
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('task_id', String(task.id));
      form.append('attach', '1');
      if (file) form.append('file', file);
      const r = await fetch('/api/controls/ai/analyze-before', { method: 'POST', body: form });
      const json = await r.json();
      setRes(json);
      if (file && onUploaded) onUploaded();
    } catch (e) {
      pushToast(`IA: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 mt-3">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="text-violet-500" size={18} />
        <h4 className="font-semibold text-gray-800">Analyse IA (avant intervention)</h4>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg ring-1 ring-black/10 cursor-pointer hover:bg-gray-50">
          <ImageIcon size={16}/> Sélectionner une photo
          <input type="file" className="hidden" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)} />
        </label>
        <button
          disabled={busy || !task}
          onClick={run}
          className={`px-4 py-2 rounded-lg text-white ${busy?'bg-gray-400':'bg-violet-600 hover:bg-violet-700'}`}
        >
          Lancer l’analyse
        </button>
        {!!file && <span className="text-xs text-gray-600">{file.name}</span>}
      </div>

      {res && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-violet-50 p-3 rounded-lg">
            <div className="text-xs font-semibold text-violet-800 mb-1">EPI</div>
            <div className="text-sm text-violet-900 whitespace-pre-wrap">{res?.safety?.ppe || '—'}</div>
            <div className="text-xs font-semibold text-violet-800 mt-3 mb-1">Dangers</div>
            <div className="text-sm text-violet-900 whitespace-pre-wrap">{res?.safety?.hazards || '—'}</div>
          </div>
          <div className="bg-emerald-50 p-3 rounded-lg">
            <div className="text-xs font-semibold text-emerald-800 mb-1">Procédure suggérée</div>
            <ol className="text-sm text-emerald-900 space-y-1">
              {(res?.procedure?.steps || []).map(s => (
                <li key={s.step}>• {s.text}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Bloc détail sur la droite ----------
function DetailsPane({ selectedTask, refreshHierarchy, pushToast }) {
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!selectedTask) { setSchema(null); return; }
      setLoading(true);
      try {
        const s = await get(`/api/controls/tasks/${selectedTask.id}/schema`);
        setSchema(s);
      } catch (e) {
        pushToast(`Schema: ${e.message}`, 'error');
      } finally { setLoading(false); }
    };
    load();
  }, [selectedTask]);

  const onClosed = async (payload) => {
    try {
      setClosing(true);
      await patchJSON(`/api/controls/tasks/${selectedTask.id}/close`, payload);
      setSchema(null);
      await refreshHierarchy();
    } catch (e) {
      pushToast(`Close: ${e.message}`, 'error');
    } finally {
      setClosing(false);
    }
  };

  if (!selectedTask) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Sélectionne une tâche dans la hiérarchie
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-4 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Tâche</div>
            <div className="text-lg font-semibold text-gray-800">{selectedTask.label}</div>
            <div className="text-xs text-gray-500 mt-1">Due: {fmtDate(selectedTask.due_date)} • <StatusPill status={selectedTask.status} /></div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-4 bg-white rounded-xl border border-gray-200">Chargement…</div>
      ) : schema ? (
        <>
          <ChecklistInline
            task={selectedTask}
            schema={schema}
            onClosed={onClosed}
            busy={closing}
            pushToast={pushToast}
          />
          <AiAssist
            task={selectedTask}
            onUploaded={async ()=>{}}
            pushToast={pushToast}
          />
        </>
      ) : (
        <div className="p-4 bg-white rounded-xl border border-gray-200">Aucun schéma disponible.</div>
      )}
    </div>
  );
}

// ---------- Hiérarchie ----------
function NodeHeader({ title, count, open, toggle, level = 0 }) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer ${open ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
      onClick={toggle}
    >
      <div className="flex items-center gap-2">
        {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        <div className="font-semibold" style={{ marginLeft: level * 8 }}>{title}</div>
      </div>
      <Pill>{count}</Pill>
    </div>
  );
}

function TaskRow({ t, onSelect, statusFilter }) {
  if (statusFilter !== 'all') {
    const wanted = statusFilter === 'open' ? ['Planned','Pending','Overdue'] : ['Done','Closed'];
    if (!wanted.includes(String(t.status))) return null;
  }
  return (
    <div
      className="px-3 py-2 rounded-md hover:bg-indigo-50 cursor-pointer flex items-center justify-between"
      onClick={() => onSelect(t)}
    >
      <div className="text-sm text-gray-800">{t.label}</div>
      <div className="flex items-center gap-2">
        <StatusPill status={t.status} />
        <span className="text-xs text-gray-500">{fmtDate(t.due_date)}</span>
      </div>
    </div>
  );
}

export default function Controls() {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'done' | 'all'
  const [selectedTask, setSelectedTask] = useState(null);
  const [toast, setToast] = useState(null);

  const pushToast = (msg, type='info') => setToast({ msg, type });

  const refreshHierarchy = async () => {
    setLoading(true);
    try {
      const t = await get('/api/controls/hierarchy/tree');
      setTree(Array.isArray(t) ? t : []);
    } catch (e) {
      pushToast(`Hiérarchie: ${e.message}`, 'error');
      setTree([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshHierarchy(); }, []);

  const toggleKey = (k) => setExpanded(s => ({ ...s, [k]: !s[k] }));

  // Compteur tâches filtrées
  const countTasks = (tasks = []) => {
    if (statusFilter === 'all') return tasks.length;
    const wanted = statusFilter === 'open' ? ['Planned','Pending','Overdue'] : ['Done','Closed'];
    return tasks.filter(t => wanted.includes(String(t.status))).length;
  };

  // Actions backend
  const autoLink = async () => {
    try {
      await call('/api/controls/bootstrap/auto-link?create=1&seed=0');
      pushToast('Équipements reliés aux entités.', 'success');
      await refreshHierarchy();
    } catch (e) {
      pushToast(`Auto-link: ${e.message}`, 'error');
    }
  };
  const seedTasks = async () => {
    try {
      await call('/api/controls/bootstrap/auto-link?create=0&seed=1');
      pushToast('Tâches seeded.', 'success');
      await refreshHierarchy();
    } catch (e) {
      pushToast(`Seed: ${e.message}`, 'error');
    }
  };

  return (
    <section className="p-8 max-w-7xl mx-auto bg-gradient-to-br from-indigo-50 to-emerald-50 rounded-3xl min-h-screen">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-800">Contrôles (TSD)</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={autoLink}
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 hover:bg-gray-50 text-sm flex items-center gap-2"
            title="Relier équipements → entités"
          >
            <Link2 size={16}/> Relier
          </button>
          <button
            onClick={seedTasks}
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 hover:bg-gray-50 text-sm flex items-center gap-2"
            title="Semer les tâches TSD sur les entités"
          >
            <Rocket size={16}/> Seed
          </button>
          <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl ring-1 ring-black/10">
            <SlidersHorizontal size={16} className="text-gray-500"/>
            <select
              className="bg-transparent outline-none text-sm"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              title="Filtrer par statut"
            >
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="all">Tous</option>
            </select>
          </div>
          <button
            onClick={refreshHierarchy}
            className="px-3 py-2 rounded-xl bg-white ring-1 ring-black/10 hover:bg-gray-50 text-sm"
          >
            Actualiser
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonne gauche : Arborescence */}
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-4">
          {loading ? (
            <div className="p-6 text-center text-gray-600">Chargement…</div>
          ) : tree.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              Aucune donnée. Utilise « Relier » puis « Seed » si besoin.
            </div>
          ) : (
            <div className="space-y-4">
              {tree.map((site, si) => {
                const keySite = `s-${site.id || site.label || si}`;
                const openSite = !!expanded[keySite];
                const hvCount = (site.hv || []).reduce((a, n) => a + countTasks(n.tasks), 0);
                const sbCount = (site.switchboards || []).reduce((a, sb) =>
                  a + countTasks(sb.tasks) + (sb.devices||[]).reduce((x, d)=> x + countTasks(d.tasks), 0), 0);
                const atexCount = (site.atex || []).reduce((a, z) =>
                  a + countTasks(z.tasks) + (z.equipments||[]).reduce((x, e)=> x + countTasks(e.tasks), 0), 0);

                return (
                  <div key={keySite} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                      <div className="text-lg font-semibold text-gray-800">{site.label || site.id || 'Site'}</div>
                      <div className="text-xs text-gray-500">HV {hvCount} • Switchboards {sbCount} • ATEX {atexCount}</div>
                    </div>

                    <div className="p-3 space-y-2">
                      {/* HV */}
                      <NodeHeader
                        title="High Voltage"
                        count={(site.hv || []).reduce((a,n)=> a + countTasks(n.tasks), 0)}
                        open={openSite && expanded[`${keySite}-hv`]}
                        toggle={() => { toggleKey(keySite); toggleKey(`${keySite}-hv`); }}
                      />
                      {openSite && expanded[`${keySite}-hv`] && (
                        <div className="pl-4 space-y-2">
                          {(site.hv || []).map((n, i) => {
                            const k = `${keySite}-hv-${i}`;
                            const open = !!expanded[k];
                            return (
                              <div key={k}>
                                <NodeHeader
                                  title={n.label || 'HV'}
                                  count={countTasks(n.tasks)}
                                  open={open}
                                  toggle={() => toggleKey(k)}
                                  level={1}
                                />
                                {open && (
                                  <div className="pl-6 space-y-1">
                                    {(n.tasks || []).map(t => (
                                      <TaskRow key={t.id} t={t} onSelect={setSelectedTask} statusFilter={statusFilter}/>
                                    ))}
                                    {countTasks(n.tasks) === 0 && <div className="text-xs text-gray-400 pl-1">Aucune tâche</div>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(site.hv||[]).length === 0 && <div className="text-xs text-gray-400 pl-1">Aucun équipement HV</div>}
                        </div>
                      )}

                      {/* Switchboards */}
                      <NodeHeader
                        title="Switchboards"
                        count={(site.switchboards || []).reduce((a,sb)=> a + countTasks(sb.tasks) + (sb.devices||[]).reduce((x,d)=>x+countTasks(d.tasks),0), 0)}
                        open={openSite && expanded[`${keySite}-sb`]}
                        toggle={() => { toggleKey(keySite); toggleKey(`${keySite}-sb`); }}
                      />
                      {openSite && expanded[`${keySite}-sb`] && (
                        <div className="pl-4 space-y-2">
                          {(site.switchboards || []).map((sb, i) => {
                            const k = `${keySite}-sb-${i}`;
                            const open = !!expanded[k];
                            return (
                              <div key={k}>
                                <NodeHeader
                                  title={sb.label || 'Switchboard'}
                                  count={countTasks(sb.tasks) + (sb.devices||[]).reduce((x,d)=>x+countTasks(d.tasks),0)}
                                  open={open}
                                  toggle={() => toggleKey(k)}
                                  level={1}
                                />
                                {open && (
                                  <div className="pl-6 space-y-2">
                                    {(sb.tasks || []).map(t => (
                                      <TaskRow key={t.id} t={t} onSelect={setSelectedTask} statusFilter={statusFilter}/>
                                    ))}
                                    {countTasks(sb.tasks) === 0 && <div className="text-xs text-gray-400 pl-1">Aucune tâche (switchboard)</div>}
                                    {(sb.devices || []).map((d, di) => {
                                      const kd = `${k}-dev-${di}`;
                                      const opend = !!expanded[kd];
                                      return (
                                        <div key={kd} className="mt-1">
                                          <NodeHeader
                                            title={`Device — ${d.label || d.code || d.id}`}
                                            count={countTasks(d.tasks)}
                                            open={opend}
                                            toggle={() => toggleKey(kd)}
                                            level={2}
                                          />
                                          {opend && (
                                            <div className="pl-6 space-y-1">
                                              {(d.tasks || []).map(t => (
                                                <TaskRow key={t.id} t={t} onSelect={setSelectedTask} statusFilter={statusFilter}/>
                                              ))}
                                              {countTasks(d.tasks) === 0 && <div className="text-xs text-gray-400 pl-1">Aucune tâche (device)</div>}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(site.switchboards||[]).length === 0 && <div className="text-xs text-gray-400 pl-1">Aucun switchboard</div>}
                        </div>
                      )}

                      {/* ATEX */}
                      <NodeHeader
                        title="ATEX"
                        count={(site.atex || []).reduce((a,z)=> a + countTasks(z.tasks) + (z.equipments||[]).reduce((x,e)=>x+countTasks(e.tasks),0), 0)}
                        open={openSite && expanded[`${keySite}-atex`]}
                        toggle={() => { toggleKey(keySite); toggleKey(`${keySite}-atex`); }}
                      />
                      {openSite && expanded[`${keySite}-atex`] && (
                        <div className="pl-4 space-y-2">
                          {(site.atex || []).map((z, zi) => {
                            const kz = `${keySite}-atex-${zi}`;
                            const openz = !!expanded[kz];
                            return (
                              <div key={kz}>
                                <NodeHeader
                                  title={`Zone ${z.zone || 'Z?'}`}
                                  count={countTasks(z.tasks) + (z.equipments||[]).reduce((x,e)=>x+countTasks(e.tasks),0)}
                                  open={openz}
                                  toggle={() => toggleKey(kz)}
                                  level={1}
                                />
                                {openz && (
                                  <div className="pl-6 space-y-2">
                                    {(z.tasks || []).map(t => (
                                      <TaskRow key={t.id} t={t} onSelect={setSelectedTask} statusFilter={statusFilter}/>
                                    ))}
                                    {(z.equipments || []).map((e, ei) => {
                                      const ke = `${kz}-eq-${ei}`;
                                      const opene = !!expanded[ke];
                                      return (
                                        <div key={ke}>
                                          <NodeHeader
                                            title={e.label || e.code || e.id}
                                            count={countTasks(e.tasks)}
                                            open={opene}
                                            toggle={() => toggleKey(ke)}
                                            level={2}
                                          />
                                          {opene && (
                                            <div className="pl-6 space-y-1">
                                              {(e.tasks || []).map(t => (
                                                <TaskRow key={t.id} t={t} onSelect={setSelectedTask} statusFilter={statusFilter}/>
                                              ))}
                                              {countTasks(e.tasks) === 0 && <div className="text-xs text-gray-400 pl-1">Aucune tâche</div>}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {countTasks(z.tasks) === 0 && (z.equipments||[]).length === 0 && (
                                      <div className="text-xs text-gray-400 pl-1">Aucun équipement ATEX</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(site.atex||[]).length === 0 && <div className="text-xs text-gray-400 pl-1">Aucune zone ATEX</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Colonne droite : Détails */}
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 p-4 min-h-[480px]">
          <DetailsPane
            selectedTask={selectedTask}
            refreshHierarchy={refreshHierarchy}
            pushToast={pushToast}
          />
        </div>
      </div>

      {toast && <Toast {...toast} onClose={()=>setToast(null)} />}
    </section>
  );
}
