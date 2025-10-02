// src/pages/Controls.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, del, upload } from '../lib/api.js';
import {
  Plus, Trash2, CheckCircle2, History as HistoryIcon, BarChart2, Calendar, Sparkles, FileText,
  Layers3, ShieldAlert, Building2, Filter, Upload as UploadIcon, X, RefreshCcw
} from 'lucide-react';

/* ------------------ Petits composants UI ------------------ */
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      type="button"
    >
      {children}
    </button>
  );
}

function Badge({ tone='default', children }) {
  const cls = {
    default: 'bg-gray-100 text-gray-800',
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
  }[tone] || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{children}</span>;
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-48 text-sm text-gray-600">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Input({ type='text', ...props }) {
  return <input type={type} {...props} className={`h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm ${props.className||''}`} />;
}

function Select({ children, ...props }) {
  return <select {...props} className={`h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm ${props.className||''}`}>{children}</select>;
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200" type="button"><X size={18} /></button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="px-4 py-3 border-t bg-gray-50">{footer}</div>
      </div>
    </div>
  );
}

/* ------------------ Constantes côté front ------------------ */
const STATUS_OPTIONS = ['open', 'completed', 'overdue'];

/* ------------------ Page principale ------------------ */
export default function Controls() {
  const [tab, setTab] = useState('controls'); // controls | catalog | analytics | history | roadmap | tsd
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtres tâches
  const [fBuilding, setFBuilding] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [q, setQ] = useState('');

  // Données principales
  const [buildings, setBuildings] = useState([]);
  const [types, setTypes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [history, setHistory] = useState([]);
  const [roadmap, setRoadmap] = useState([]);
  const [library, setLibrary] = useState({ types: [], library: {} });

  // Catalogues équipements & Non présent
  const [catalog, setCatalog] = useState([]);
  const [notPresent, setNotPresent] = useState([]);

  // Détail tâche & PJ
  const [selectedTask, setSelectedTask] = useState(null);     // /tasks/:id/details
  const [taskItem, setTaskItem] = useState(null);             // tsd_item
  const [equipOfTask, setEquipOfTask] = useState(null);       // equipment
  const [resultForm, setResultForm] = useState({});
  const [attachments, setAttachments] = useState([]);

  // Modaux
  const [openAddEquip, setOpenAddEquip] = useState(false);
  const [equipDraft, setEquipDraft] = useState({ building:'', equipment_type:'', name:'', code:'' });

  const [openDeclareNP, setOpenDeclareNP] = useState(false);
  const [npDraft, setNpDraft] = useState({ building:'', equipment_type:'', note:'' });

  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState('');

  function notify(msg, type='info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  /* ------------------ Charges initiales ------------------ */
  async function loadCatalog() {
    const data = await get('/api/controls/catalog');
    setCatalog(data.data || []);
    setBuildings(data.buildings || []);
    setTypes(data.types || []);
  }
  async function loadTasks() {
    const data = await get(`/api/controls/tasks?${new URLSearchParams({
      building: fBuilding || '',
      type: fType || '',
      status: fStatus || '',
      q: q || ''
    }).toString()}`);
    setTasks(data || []);
  }
  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([
        loadCatalog(),
        loadTasks(),
        get('/api/controls/analytics').then(setAnalytics),
        get('/api/controls/history').then(setHistory),
        get('/api/controls/roadmap').then(setRoadmap),
        get('/api/controls/library').then(setLibrary),
        get('/api/controls/not-present').then(setNotPresent),
      ]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadTasks(); }, [fBuilding, fType, fStatus]); // filtres

  /* ------------------ Actions catalog ------------------ */
  async function createEquip() {
    if (!equipDraft.building || !equipDraft.equipment_type || !equipDraft.name) {
      notify('Building, Type et Name sont requis', 'danger');
      return;
    }
    await post('/api/controls/catalog', equipDraft);
    setOpenAddEquip(false);
    setEquipDraft({ building:'', equipment_type:'', name:'', code:'' });
    await loadCatalog();
    await post('/api/controls/generate', { site:'Default' }); // regénère les tâches dues
    await loadTasks();
    notify('Équipement ajouté et tâches générées', 'ok');
  }

  async function removeEquip(id) {
    if (!window.confirm('Supprimer cet équipement ?')) return;
    await del(`/api/controls/catalog/${id}`);
    await loadCatalog();
    notify('Équipement supprimé', 'ok');
  }

  /* ------------------ Actions Non présent ------------------ */
  async function declareNotPresent() {
    if (!npDraft.building || !npDraft.equipment_type) {
      notify('Building et Type requis', 'danger');
      return;
    }
    await post('/api/controls/not-present', { ...npDraft, declared_by: 'Daniel' });
    setOpenDeclareNP(false);
    setNpDraft({ building:'', equipment_type:'', note:'' });
    await get('/api/controls/not-present').then(setNotPresent);
    await post('/api/controls/generate', { site:'Default' });
    await loadTasks();
    notify('Déclaration enregistrée + tâche annuelle générée', 'ok');
  }

  async function assessNotPresent(row) {
    const note = prompt('Note d’assessment (optionnel)') || '';
    await post(`/api/controls/not-present/${row.id}/assess`, { user:'Daniel', note });
    await get('/api/controls/not-present').then(setNotPresent);
    await loadTasks();
    await get('/api/controls/history').then(setHistory);
    notify('Assessment annuel enregistré', 'ok');
  }

  /* ------------------ Détails tâche ------------------ */
  async function openTask(t) {
    const details = await get(`/api/controls/tasks/${t.id}/details`);
    setSelectedTask(details);
    setTaskItem(details.tsd_item || null);
    setEquipOfTask(details.equipment || null);
    setResultForm({});
    const atts = await get(`/api/controls/tasks/${t.id}/attachments`);
    setAttachments(atts || []);
  }

  async function completeTask() {
    if (!selectedTask) return;
    // Construire payload à partir du schéma item
    const body = { user:'Daniel', results: {} };
    if (taskItem) {
      if (taskItem.type === 'check') {
        body.results[taskItem.field] = Boolean(resultForm[taskItem.field] === true);
      } else if (taskItem.type === 'number') {
        const val = Number(resultForm[taskItem.field]);
        body.results[taskItem.field] = isNaN(val) ? null : val;
      } else if (taskItem.type === 'text') {
        body.results[taskItem.field] = String(resultForm[taskItem.field] || '');
      }
    }
    const res = await post(`/api/controls/tasks/${selectedTask.id}/complete`, body);
    notify(`Tâche complétée — ${res?.verdict?.status || 'OK'}`, res?.verdict?.status === 'Non conforme' ? 'danger' : res?.verdict?.status === 'À vérifier' ? 'warn' : 'ok');
    setSelectedTask(null);
    await loadTasks();
    await get('/api/controls/history').then(setHistory);
  }

  async function onUploadFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !selectedTask) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    await upload(`/api/controls/tasks/${selectedTask.id}/upload`, fd);
    const atts = await get(`/api/controls/tasks/${selectedTask.id}/attachments`);
    setAttachments(atts || []);
  }

  /* ------------------ Assistant IA ------------------ */
  async function askAI(msg) {
    setAiBusy(true);
    try {
      const res = await post('/api/controls/ai/assistant', { mode:'text', text:msg });
      setAiReply(res.reply || '—');
    } catch {
      setAiReply('Erreur IA');
    } finally {
      setAiBusy(false);
    }
  }

  /* ------------------ Sync équipements externes ------------------ */
  async function syncExternal() {
    await post('/api/controls/sync', { site:'Default' });
    await loadCatalog();
    await loadTasks();
    notify('Synchronisation (Switchboards, HV, ATEX) effectuée', 'ok');
  }

  /* ------------------ Rendus utiles ------------------ */
  const filteredCatalog = useMemo(() => {
    return catalog.sort((a,b) => String(a.building).localeCompare(String(b.building)));
  }, [catalog]);

  function RenderTaskForm() {
    if (!taskItem) return <div className="text-gray-500">Aucun item TSD</div>;
    const it = taskItem;
    return (
      <div className="space-y-2">
        <div className="text-sm text-gray-600">{it.label}</div>
        {it.hint && <div className="text-xs text-gray-500">Hint: {it.hint}</div>}
        {it.type === 'check' && (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(resultForm[it.field])}
              onChange={e => setResultForm(prev => ({ ...prev, [it.field]: e.target.checked }))}
            />
            <span>Cocher si OK</span>
          </label>
        )}
        {it.type === 'number' && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              value={resultForm[it.field] ?? ''}
              onChange={e => setResultForm(prev => ({ ...prev, [it.field]: e.target.value }))}
              placeholder={`Saisir une valeur (${it.unit || ''})`}
            />
            {it.unit && <Badge tone="info">{it.unit}</Badge>}
            {it.comparator && it.threshold != null && (
              <Badge tone="warn">{it.comparator} {it.threshold}{it.unit ? ` ${it.unit}` : ''}</Badge>
            )}
          </div>
        )}
        {it.type === 'text' && (
          <Input
            value={resultForm[it.field] ?? ''}
            onChange={e => setResultForm(prev => ({ ...prev, [it.field]: e.target.value }))}
            placeholder="Observation..."
          />
        )}
      </div>
    );
  }

  /* ------------------ UI ------------------ */
  return (
    <section className="container mx-auto py-8">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Tab active={tab==='controls'} onClick={() => setTab('controls')}>
          <CheckCircle2 size={16} className="inline mr-1" /> Contrôles
        </Tab>
        <Tab active={tab==='catalog'} onClick={() => setTab('catalog')}>
          <Layers3 size={16} className="inline mr-1" /> Catalogue
        </Tab>
        <Tab active={tab==='analytics'} onClick={() => setTab('analytics')}>
          <BarChart2 size={16} className="inline mr-1" /> Analytics
        </Tab>
        <Tab active={tab==='history'} onClick={() => setTab('history')}>
          <HistoryIcon size={16} className="inline mr-1" /> Historique
        </Tab>
        <Tab active={tab==='roadmap'} onClick={() => setTab('roadmap')}>
          <Calendar size={16} className="inline mr-1" /> Roadmap
        </Tab>
        <Tab active={tab==='tsd'} onClick={() => setTab('tsd')}>
          <ShieldAlert size={16} className="inline mr-1" /> TSD
        </Tab>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          toast.type==='ok' ? 'bg-green-50 text-green-800 border border-green-200'
          : toast.type==='danger' ? 'bg-red-50 text-red-800 border border-red-200'
          : toast.type==='warn' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
          : 'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Loading */}
      {loading && <div className="text-gray-500">Chargement…</div>}

      {/* ------------------ CONTROLS ------------------ */}
      {tab==='controls' && !loading && (
        <div className="space-y-4">
          <div className="card p-4 bg-white rounded-xl shadow">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="text-gray-600" />
              <Select value={fBuilding} onChange={e => setFBuilding(e.target.value)} style={{maxWidth:220}}>
                <option value="">All buildings</option>
                {buildings.map(b => <option key={b} value={b}>{b}</option>)}
              </Select>

              <Layers3 className="text-gray-600" />
              <Select value={fType} onChange={e => setFType(e.target.value)} style={{maxWidth:280}}>
                <option value="">All types</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>

              <Filter className="text-gray-600" />
              <Select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{maxWidth:180}}>
                <option value="">All status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>

              <Input placeholder="Search text…" value={q} onChange={e => setQ(e.target.value)} style={{maxWidth:220}} />
              <button
                className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black"
                onClick={loadTasks}
                type="button"
              >
                Rechercher
              </button>
              <button
                className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50"
                onClick={async () => { await post('/api/controls/generate', { site:'Default' }); await loadTasks(); }}
                type="button"
              >
                Générer tâches dues
              </button>
              <button
                className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 flex items-center gap-2"
                onClick={syncExternal}
                type="button"
              >
                <RefreshCcw size={16}/> Sync équipements
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Liste tâches */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-semibold text-lg mb-3">Tâches</h2>
              {tasks.length === 0 && <div className="text-sm text-gray-500">Aucune tâche.</div>}
              <ul className="space-y-2">
                {tasks.map(t => (
                  <li key={t.id} className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer" onClick={() => openTask(t)}>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-gray-500">{t.building} • {t.equipment_type} • {t.equipment_code || '—'}</div>
                    <div className="text-xs flex items-center gap-2">
                      Status:{' '}
                      {t.status === 'completed' ? <Badge tone="ok">Completed</Badge>
                        : t.status === 'overdue' ? <Badge tone="danger">Overdue</Badge>
                        : <Badge tone="warn">Open</Badge>}
                      {typeof t.ai_risk_score === 'number' && (<Badge tone={t.ai_risk_score >= 0.7 ? 'danger' : t.ai_risk_score >= 0.4 ? 'warn' : 'info'}>Risk: {t.ai_risk_score.toFixed(2)}</Badge>)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Détail tâche */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-semibold text-lg mb-3">Détail</h2>
              {!selectedTask && <div className="text-sm text-gray-500">Sélectionne une tâche pour afficher le formulaire.</div>}
              {selectedTask && (
                <>
                  <div className="mb-2">
                    <div className="font-medium">{selectedTask.title}</div>
                    <div className="text-xs text-gray-500">
                      {equipOfTask?.building} • {equipOfTask?.equipment_type || selectedTask.equipment_type} • {equipOfTask?.code || selectedTask.equipment_code || '—'}
                    </div>
                  </div>
                  {selectedTask.results?.verdict && (
                    <div className="mb-2 text-sm">
                      Verdict:{' '}
                      <Badge tone={selectedTask.results.verdict.status==='Non conforme' ? 'danger' : (selectedTask.results.verdict.status==='Conforme' ? 'ok' : 'warn')}>
                        {selectedTask.results.verdict.status}
                      </Badge>
                      {typeof selectedTask.results.ai_risk_score === 'number' && (
                        <span className="ml-2">
                          <Badge tone={selectedTask.results.ai_risk_score >= 0.7 ? 'danger' : selectedTask.results.ai_risk_score >= 0.4 ? 'warn' : 'info'}>
                            Risk: {selectedTask.results.ai_risk_score.toFixed(2)}
                          </Badge>
                        </span>
                      )}
                    </div>
                  )}
                  <div className="border rounded-lg p-3 mb-3">
                    <RenderTaskForm />
                  </div>
                  <div className="mb-3">
                    <label className="text-sm font-medium">Pièces jointes</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="file" multiple onChange={onUploadFiles} disabled={selectedTask.locked} />
                      <UploadIcon size={18} className="text-gray-600" />
                    </div>
                    <ul className="mt-2 text-sm text-gray-700">
                      {attachments.map(a => (
                        <li key={a.id}>📎 {a.filename} <span className="text-xs text-gray-500">({a.size} bytes)</span></li>
                      ))}
                      {attachments.length === 0 && <li className="text-gray-500">Aucune pièce jointe</li>}
                    </ul>
                  </div>
                  {!selectedTask.locked && (
                    <button
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      onClick={completeTask}
                      type="button"
                    >
                      Valider & figer
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Assistant IA */}
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold text-lg mb-3 flex items-center gap-2"><Sparkles size={18}/> Assistant IA</h2>
            <div className="flex gap-2">
              <Input placeholder="Pose une question…" onKeyDown={(e) => e.key==='Enter' && askAI(e.target.value)} />
              <button className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" onClick={() => askAI('Conseil HV')} disabled={aiBusy} type="button">
                Demander
              </button>
            </div>
            {!!aiReply && <div className="mt-2 text-gray-700">{aiReply}</div>}
          </div>
        </div>
      )}

      {/* ------------------ CATALOG ------------------ */}
      {tab==='catalog' && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Catalogue équipements</h2>
            <div className="flex gap-2">
              <button className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 flex items-center gap-2" onClick={() => setOpenAddEquip(true)} type="button">
                <Plus size={16}/> Ajouter
              </button>
              <button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black flex items-center gap-2" onClick={syncExternal} type="button">
                <RefreshCcw size={16}/> Sync
              </button>
              <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={loadCatalog} type="button">Rafraîchir</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Building</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Code</th>
                  <th className="p-2 w-20">—</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalog.map(e => (
                  <tr key={e.id} className="border-b">
                    <td className="p-2">{e.building}</td>
                    <td className="p-2">{e.equipment_type}</td>
                    <td className="p-2">{e.name}</td>
                    <td className="p-2">{e.code || '—'}</td>
                    <td className="p-2">
                      <button className="p-1 rounded hover:bg-red-50 text-red-600" onClick={() => removeEquip(e.id)} title="Supprimer" type="button">
                        <Trash2 size={16}/>
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredCatalog.length === 0 && (
                  <tr><td className="p-2 text-gray-500" colSpan={5}>Aucun équipement</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-6">
            <h2 className="font-semibold text-lg">Éléments déclarés “Non présent”</h2>
            <button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black" onClick={() => setOpenDeclareNP(true)} type="button">
              Déclarer “Non présent”
            </button>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Building</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Déclaré par</th>
                  <th className="p-2">Déclaré le</th>
                  <th className="p-2">Dernier assessment</th>
                  <th className="p-2">Note</th>
                  <th className="p-2 w-40">—</th>
                </tr>
              </thead>
              <tbody>
                {notPresent.map(n => (
                  <tr key={n.id} className="border-b">
                    <td className="p-2">{n.building}</td>
                    <td className="p-2">{n.equipment_type}</td>
                    <td className="p-2">{n.declared_by || '—'}</td>
                    <td className="p-2">{n.declared_at?.slice(0,10)}</td>
                    <td className="p-2">{n.last_assessment_at?.slice(0,10) || <span className="text-orange-600">Jamais</span>}</td>
                    <td className="p-2">{n.note || '—'}</td>
                    <td className="p-2">
                      <button className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700" onClick={() => assessNotPresent(n)} type="button">
                        Assessment annuel
                      </button>
                    </td>
                  </tr>
                ))}
                {notPresent.length === 0 && (
                  <tr><td className="p-2 text-gray-500" colSpan={7}>Aucune déclaration</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------ ANALYTICS ------------------ */}
      {tab==='analytics' && analytics && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold mb-2">Vue d’ensemble</h2>
            <div className="flex gap-3 items-center">
              <Badge tone="info">Total: {analytics.total}</Badge>
              <Badge tone="ok">Completed: {analytics.completed}</Badge>
              <Badge tone="warn">Open: {analytics.open}</Badge>
              {'overdue' in analytics && <Badge tone="danger">Overdue: {analytics.overdue}</Badge>}
            </div>
            <h3 className="font-medium mt-4 mb-2">Par bâtiment</h3>
            <ul className="text-sm space-y-1">
              {Object.entries(analytics.byBuilding || {}).map(([b, n]) => (
                <li key={b} className="flex justify-between">
                  <span>{b}</span><span className="text-gray-600">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold mb-2">Par type</h2>
            <ul className="text-sm space-y-1">
              {Object.entries(analytics.byType || {}).map(([t, n]) => (
                <li key={t} className="flex justify-between">
                  <span>{t}</span><span className="text-gray-600">{n}</span>
                </li>
              ))}
            </ul>
            <h3 className="font-medium mt-4 mb-2">Gaps (à traiter)</h3>
            {analytics.gaps?.length ? (
              <ul className="text-sm space-y-2">
                {analytics.gaps.map(g => (
                  <li key={g} className="flex items-center justify-between">
                    <div><Badge tone="danger">Manquant</Badge> <span className="ml-2">{g}</span></div>
                    <div className="flex gap-2">
                      <button className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
                        onClick={() => { setOpenAddEquip(true); setEquipDraft(d => ({...d, equipment_type:g})); }}
                        type="button">
                        Créer équipement
                      </button>
                      <button className="h-8 px-3 rounded-md border text-xs hover:bg-gray-50"
                        onClick={() => { setOpenDeclareNP(true); setNpDraft(d => ({...d, equipment_type:g})); }}
                        type="button">
                        Déclarer “Non présent”
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <div className="text-sm text-gray-500">Aucun gap détecté.</div>}
          </div>
        </div>
      )}

      {/* ------------------ HISTORY ------------------ */}
      {tab==='history' && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Historique</h2>
            <a
              className="inline-flex items-center px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-black text-sm"
              href="/api/controls/history/export"
            >
              <FileText size={16} className="mr-2" /> Export CSV
            </a>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Task ID</th>
                <th className="p-2">User</th>
                <th className="p-2">Date</th>
                <th className="p-2">Verdict</th>
                <th className="p-2">Détails</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} className="border-b">
                  <td className="p-2">{h.task_id}</td>
                  <td className="p-2">{h.user}</td>
                  <td className="p-2">{h.date}</td>
                  <td className="p-2">
                    {h.results?.verdict?.status
                      ? <Badge tone={h.results.verdict.status==='Non conforme' ? 'danger' : (h.results.verdict.status==='Conforme' ? 'ok' : 'warn')}>{h.results.verdict.status}</Badge>
                      : '—'}
                  </td>
                  <td className="p-2 text-gray-600">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(h.results, null, 0)}</pre>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td className="p-2 text-gray-500" colSpan={5}>Aucun historique</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------ ROADMAP ------------------ */}
      {tab==='roadmap' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Roadmap</h2>
          <ul className="divide-y">
            {roadmap.map(r => (
              <li key={r.id} className="py-2">
                <span className="font-medium">{r.title}</span>
                <span className="ml-2 text-gray-500 text-sm">{r.start} → {r.end}</span>
              </li>
            ))}
            {roadmap.length===0 && <li className="py-2 text-gray-500">Aucune entrée</li>}
          </ul>
        </div>
      )}

      {/* ------------------ TSD ------------------ */}
      {tab==='tsd' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Bibliothèque TSD (points & périodicités)</h2>
          <div className="text-sm text-gray-600 mb-2">Référence backend /api/controls/library</div>
          <div className="space-y-6">
            {(library.types || []).map(tp => (
              <div key={tp} className="border rounded-lg p-3">
                <div className="font-semibold mb-2">{tp}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="p-2">Label</th>
                      <th className="p-2">Field</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Comparateur</th>
                      <th className="p-2">Seuil</th>
                      <th className="p-2">Unité</th>
                      <th className="p-2">Périodicité (mois)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(library.library?.[tp] || []).map(it => (
                      <tr key={it.id} className="border-b">
                        <td className="p-2">{it.label}</td>
                        <td className="p-2">{it.field}</td>
                        <td className="p-2">{it.type}</td>
                        <td className="p-2">{it.comparator || '—'}</td>
                        <td className="p-2">{it.threshold != null ? String(it.threshold) : '—'}</td>
                        <td className="p-2">{it.unit || '—'}</td>
                        <td className="p-2">{it.frequency_months}</td>
                      </tr>
                    ))}
                    {(library.library?.[tp] || []).length === 0 && (
                      <tr><td className="p-2 text-gray-500" colSpan={7}>Aucun item</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------ Modaux ------------------ */}
      <Modal
        open={openAddEquip}
        title="Ajouter un équipement"
        onClose={() => setOpenAddEquip(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenAddEquip(false)} type="button">Annuler</button>
            <button className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700" onClick={createEquip} type="button">Ajouter</button>
          </div>
        }
      >
        <div className="space-y-3">
          <Row label="Building">
            <Select value={equipDraft.building} onChange={e => setEquipDraft(prev => ({ ...prev, building:e.target.value }))}>
              <option value="">Choisir…</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select value={equipDraft.equipment_type} onChange={e => setEquipDraft(prev => ({ ...prev, equipment_type:e.target.value }))}>
              <option value="">Choisir…</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Row>
          <Row label="Name">
            <Input value={equipDraft.name} onChange={e => setEquipDraft(prev => ({ ...prev, name:e.target.value }))} placeholder="Nom affiché" />
          </Row>
          <Row label="Code">
            <Input value={equipDraft.code} onChange={e => setEquipDraft(prev => ({ ...prev, code:e.target.value }))} placeholder="Code interne (optionnel)" />
          </Row>
        </div>
      </Modal>

      <Modal
        open={openDeclareNP}
        title="Déclarer un type “Non présent”"
        onClose={() => setOpenDeclareNP(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenDeclareNP(false)} type="button">Annuler</button>
            <button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black" onClick={declareNotPresent} type="button">Déclarer</button>
          </div>
        }
      >
        <div className="space-y-3">
          <Row label="Building">
            <Select value={npDraft.building} onChange={e => setNpDraft(prev => ({ ...prev, building:e.target.value }))}>
              <option value="">Choisir…</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select value={npDraft.equipment_type} onChange={e => setNpDraft(prev => ({ ...prev, equipment_type:e.target.value }))}>
              <option value="">Choisir…</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Row>
          <Row label="Note">
            <Input value={npDraft.note} onChange={e => setNpDraft(prev => ({ ...prev, note:e.target.value }))} placeholder="Contexte/remédiations…" />
          </Row>
        </div>
      </Modal>
    </section>
  );
}
