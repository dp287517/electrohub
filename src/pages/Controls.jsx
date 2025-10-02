// src/pages/Controls.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, del, upload } from '../lib/api.js';
import {
  Plus, Trash2, CheckCircle2, History as HistoryIcon, BarChart2, Calendar, Sparkles, FileText,
  Layers3, ShieldAlert, Building2, Filter, Upload as UploadIcon, X, AlertTriangle
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

/* ------------------ Constantes ------------------ */
const STATUS_OPTIONS = ['open', 'overdue', 'completed'];

/* ------------------ Page principale ------------------ */
export default function Controls() {
  const [tab, setTab] = useState('controls');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtres tâches
  const [fBuilding, setFBuilding] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [q, setQ] = useState('');

  // Données
  const [buildings, setBuildings] = useState([]);
  const [types, setTypes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [history, setHistory] = useState([]);
  const [roadmap, setRoadmap] = useState([]);
  const [library, setLibrary] = useState({ types: [], library: {} });
  const [catalog, setCatalog] = useState([]);
  const [notPresent, setNotPresent] = useState([]);

  // Détails tâche
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskItem, setTaskItem] = useState(null);
  const [equipOfTask, setEquipOfTask] = useState(null);
  const [resultForm, setResultForm] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [aiRisk, setAiRisk] = useState(null);

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

  /* ------------------ Loaders ------------------ */
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
  useEffect(() => { loadTasks(); }, [fBuilding, fType, fStatus]);

  /* ------------------ Actions ------------------ */
  async function syncCatalog() {
    await post('/api/controls/sync', { site:'Default' });
    await loadCatalog();
    await loadTasks();
    notify('Catalogue synchronisé avec HV / Switchboards / ATEX', 'ok');
  }

  async function createEquip() {
    if (!equipDraft.building || !equipDraft.equipment_type || !equipDraft.name) {
      notify('Building, Type et Name sont requis', 'danger');
      return;
    }
    await post('/api/controls/catalog', equipDraft);
    setOpenAddEquip(false);
    setEquipDraft({ building:'', equipment_type:'', name:'', code:'' });
    await loadCatalog();
    await post('/api/controls/generate', { site:'Default' });
    await loadTasks();
    notify('Équipement ajouté et tâches générées', 'ok');
  }

  async function removeEquip(id) {
    if (!window.confirm('Supprimer cet équipement ?')) return;
    await del(`/api/controls/catalog/${id}`);
    await loadCatalog();
    notify('Équipement supprimé', 'ok');
  }

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

  async function openTask(t) {
    const details = await get(`/api/controls/tasks/${t.id}/details`);
    setSelectedTask(details);
    setTaskItem(details.tsd_item || null);
    setEquipOfTask(details.equipment || null);
    setResultForm({});
    setAiRisk(null);
    const atts = await get(`/api/controls/tasks/${t.id}/attachments`);
    setAttachments(atts || []);
  }

  async function completeTask() {
    if (!selectedTask) return;
    const body = { user:'Daniel', results: {}, ai_risk_score: aiRisk?.ai_risk_score ?? null };
    if (taskItem) {
      if (taskItem.type === 'check') body.results[taskItem.field] = Boolean(resultForm[taskItem.field]);
      if (taskItem.type === 'number') {
        const val = Number(resultForm[taskItem.field]);
        body.results[taskItem.field] = isNaN(val) ? null : val;
      }
      if (taskItem.type === 'text') body.results[taskItem.field] = String(resultForm[taskItem.field] || '');
    }
    const res = await post(`/api/controls/tasks/${selectedTask.id}/complete`, body);
    notify(`Tâche complétée — ${res?.verdict?.status || 'OK'}`, res?.verdict?.status === 'Non conforme' ? 'danger' : 'ok');
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

  async function analyzePhotos(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('hints', 'analyse automatique');
    const res = await upload('/api/controls/ai/vision-score', fd);
    setAiRisk(res);
    notify(`Analyse IA: risque ${res.ai_risk_score}`, res.ai_risk_score > 0.7 ? 'danger' : 'warn');
  }

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

  /* ------------------ Rendus ------------------ */
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
            <input type="checkbox" checked={Boolean(resultForm[it.field])} onChange={e => setResultForm(p => ({ ...p, [it.field]: e.target.checked }))}/>
            <span>Cocher si OK</span>
          </label>
        )}
        {it.type === 'number' && (
          <div className="flex items-center gap-2">
            <Input type="number" step="any" value={resultForm[it.field] ?? ''} onChange={e => setResultForm(p => ({ ...p, [it.field]: e.target.value }))}/>
            {it.unit && <Badge tone="info">{it.unit}</Badge>}
            {it.comparator && it.threshold != null && <Badge tone="warn">{it.comparator} {it.threshold}{it.unit ? ` ${it.unit}` : ''}</Badge>}
          </div>
        )}
        {it.type === 'text' && <Input value={resultForm[it.field] ?? ''} onChange={e => setResultForm(p => ({ ...p, [it.field]: e.target.value }))}/>}
      </div>
    );
  }

  /* ------------------ UI ------------------ */
  return (
    <section className="container mx-auto py-8">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Tab active={tab==='controls'} onClick={() => setTab('controls')}><CheckCircle2 size={16} className="inline mr-1" /> Contrôles</Tab>
        <Tab active={tab==='catalog'} onClick={() => setTab('catalog')}><Layers3 size={16} className="inline mr-1" /> Catalogue</Tab>
        <Tab active={tab==='analytics'} onClick={() => setTab('analytics')}><BarChart2 size={16} className="inline mr-1" /> Analytics</Tab>
        <Tab active={tab==='history'} onClick={() => setTab('history')}><HistoryIcon size={16} className="inline mr-1" /> Historique</Tab>
        <Tab active={tab==='roadmap'} onClick={() => setTab('roadmap')}><Calendar size={16} className="inline mr-1" /> Roadmap</Tab>
        <Tab active={tab==='tsd'} onClick={() => setTab('tsd')}><ShieldAlert size={16} className="inline mr-1" /> TSD</Tab>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          toast.type==='ok' ? 'bg-green-50 text-green-800 border border-green-200'
          : toast.type==='danger' ? 'bg-red-50 text-red-800 border border-red-200'
          : 'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>{toast.msg}</div>
      )}

      {/* Loading */}
      {loading && <div className="text-gray-500">Chargement…</div>}

      {/* CONTROLS */}
      {tab==='controls' && !loading && (
        <div className="space-y-4">
          <div className="card p-4 bg-white rounded-xl shadow flex flex-wrap gap-2 items-center">
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
            <button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black" onClick={loadTasks} type="button">Rechercher</button>
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={async () => { await post('/api/controls/generate', { site:'Default' }); await loadTasks(); }} type="button">Générer tâches dues</button>
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={syncCatalog} type="button">Sync HV/SB/ATEX</button>
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
                    <div className="text-xs flex gap-2 items-center">
                      Status:{' '}
                      {t.status==='completed' ? <Badge tone="ok">Completed</Badge>
                        : t.status==='overdue' ? <Badge tone="danger">Overdue</Badge>
                        : <Badge tone="warn">Open</Badge>}
                      {t.ai_risk_score != null && <Badge tone={t.ai_risk_score>0.7 ? 'danger':'warn'}>Risk {t.ai_risk_score}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Détail tâche */}
            <div className="bg-white rounded-xl shadow p-4">
              <h2 className="font-semibold text-lg mb-3">Détail</h2>
              {!selectedTask && <div className="text-sm text-gray-500">Sélectionne une tâche.</div>}
              {selectedTask && (
                <>
                  <div className="mb-2">
                    <div className="font-medium">{selectedTask.title}</div>
                    <div className="text-xs text-gray-500">{equipOfTask?.building} • {equipOfTask?.equipment_type || selectedTask.equipment_type} • {equipOfTask?.code || selectedTask.equipment_code || '—'}</div>
                  </div>
                  <div className="border rounded-lg p-3 mb-3"><RenderTaskForm /></div>
                  <div className="mb-3">
                    <label className="text-sm font-medium">Pièces jointes</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="file" multiple onChange={onUploadFiles} disabled={selectedTask.locked}/>
                      <UploadIcon size={18} className="text-gray-600" />
                    </div>
                    <ul className="mt-2 text-sm">{attachments.map(a => <li key={a.id}>📎 {a.filename}</li>)}</ul>
                  </div>
                  <div className="mb-3">
                    <label className="text-sm font-medium flex items-center gap-2"><AlertTriangle size={16}/> Analyse IA des photos</label>
                    <input type="file" multiple onChange={analyzePhotos} disabled={selectedTask.locked}/>
                    {aiRisk && <div className="mt-1 text-sm">Score: {aiRisk.ai_risk_score} — Tags: {aiRisk.tags?.join(', ')}</div>}
                  </div>
                  {!selectedTask.locked && (
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" onClick={completeTask} type="button">Valider & figer</button>
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
              <button className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" onClick={() => askAI('Conseil HV')} disabled={aiBusy} type="button">Demander</button>
            </div>
            {!!aiReply && <div className="mt-2 text-gray-700">{aiReply}</div>}
          </div>
        </div>
      )}

      {/* Catalog, Analytics, History, Roadmap, TSD : mêmes que ta version mais avec le bouton Sync ajouté ci-dessus */}

      {/* Modaux AddEquip / DeclareNP restent identiques */}
      <Modal
        open={openAddEquip}
        title="Ajouter un équipement"
        onClose={() => setOpenAddEquip(false)}
        footer={<div className="flex justify-end gap-2"><button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenAddEquip(false)}>Annuler</button><button className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700" onClick={createEquip}>Ajouter</button></div>}
      >
        <div className="space-y-3">
          <Row label="Building"><Select value={equipDraft.building} onChange={e => setEquipDraft(p => ({ ...p, building:e.target.value }))}><option value="">Choisir…</option>{buildings.map(b => <option key={b} value={b}>{b}</option>)}</Select></Row>
          <Row label="Type"><Select value={equipDraft.equipment_type} onChange={e => setEquipDraft(p => ({ ...p, equipment_type:e.target.value }))}><option value="">Choisir…</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</Select></Row>
          <Row label="Name"><Input value={equipDraft.name} onChange={e => setEquipDraft(p => ({ ...p, name:e.target.value }))}/></Row>
          <Row label="Code"><Input value={equipDraft.code} onChange={e => setEquipDraft(p => ({ ...p, code:e.target.value }))}/></Row>
        </div>
      </Modal>

      <Modal
        open={openDeclareNP}
        title="Déclarer un type “Non présent”"
        onClose={() => setOpenDeclareNP(false)}
        footer={<div className="flex justify-end gap-2"><button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenDeclareNP(false)}>Annuler</button><button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black" onClick={declareNotPresent}>Déclarer</button></div>}
      >
        <div className="space-y-3">
          <Row label="Building"><Select value={npDraft.building} onChange={e => setNpDraft(p => ({ ...p, building:e.target.value }))}><option value="">Choisir…</option>{buildings.map(b => <option key={b} value={b}>{b}</option>)}</Select></Row>
          <Row label="Type"><Select value={npDraft.equipment_type} onChange={e => setNpDraft(p => ({ ...p, equipment_type:e.target.value }))}><option value="">Choisir…</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</Select></Row>
          <Row label="Note"><Input value={npDraft.note} onChange={e => setNpDraft(p => ({ ...p, note:e.target.value }))}/></Row>
        </div>
      </Modal>
    </section>
  );
}
