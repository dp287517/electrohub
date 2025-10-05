import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api.js';
import {
  ChevronRight, ChevronDown, SlidersHorizontal, PlusCircle, UploadCloud, Calendar, PoundSterling,
  AlertTriangle, CheckCircle2, XCircle, Paperclip, Bot, Download, Trash2, Edit2, Save, X
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

/* ----------------------------- UI helpers ----------------------------- */
const input = 'w-full bg-white border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed';
const btnPri = 'px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = 'px-2 py-1 rounded hover:bg-gray-100 text-gray-700';
const danger = 'px-3 py-2 rounded bg-rose-600 text-white hover:bg-rose-700';

/** Currency GBP */
const gbp = (n) => Number(n || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });

function Badge({ children, tone='gray'}) {
  const map = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    rose: 'bg-rose-100 text-rose-800 border-rose-200',
    green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  return <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border ${map[tone] || map.gray}`}>{children}</span>;
}

function Toast({ msg, type = 'info', onClose }) {
  if (!msg) return null;
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warn: 'bg-amber-500' };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${colors[type]}`}>
      <div className="flex items-center gap-3">
        <span dangerouslySetInnerHTML={{ __html: msg }} />
        <button onClick={onClose} className="bg-white/20 rounded px-2 py-0.5">OK</button>
      </div>
    </div>
  );
}

function Modal({ open, title, children, footer, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e)=>e.stopPropagation()}>
        <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <button className={btnGhost} onClick={onClose}><X /></button>
        </div>
        {/* Scrollable body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t bg-gray-50">{footer}</div>}
      </div>
    </div>
  );
}

function DropInput({ label = 'Drag & drop or click', onFiles, accept = undefined, multiple = true }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files || []); if (files.length) onFiles(files); }}
      className={`cursor-pointer border-2 rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${
        drag ? 'border-blue-500 bg-blue-50' : 'border-dashed border-gray-300 bg-white'
      }`}
    >
      <UploadCloud />
      <span>{label}</span>
      <input type="file" className="hidden" multiple={multiple} accept={accept}
             onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) onFiles(files); }} />
    </label>
  );
}

/* ----------------------------- HTTP helpers ----------------------------- */
async function put(url, body) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': body instanceof FormData ? undefined : 'application/json' },
    credentials: 'include',
    body: body instanceof FormData ? body : JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function del(url) {
  const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json().catch(() => ({}));
}

/* --------------------------------- Page -------------------------------- */
export default function Project() {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);

  // accordion
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(null);

  // per-selected data
  const [status, setStatus] = useState(null);
  const [lines, setLines] = useState({ offers: [], orders: [], invoices: [] });
  const [files, setFiles] = useState({ business_case: [], pip: [], offer: [], wbs: [], order: [], invoice: [] });
  const [analysis, setAnalysis] = useState(null);
  const [aiAnswer, setAiAnswer] = useState('');

  // header fields (controlled)
  const [editWbs, setEditWbs] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [editPrepDate, setEditPrepDate] = useState('');   // "Created" (mapped to prep_month)
  const [editStartDate, setEditStartDate] = useState(''); // start_month
  const [editCloseDate, setEditCloseDate] = useState(''); // close_month

  // filters
  const [showFilters, setShowFilters] = useState(false);
  const [fltTitle, setFltTitle] = useState('');
  const [fltWbsOnly, setFltWbsOnly] = useState(false);
  const [fltHealth, setFltHealth] = useState('all'); // all|ok|warn|critical
  const [fltBudgetMin, setFltBudgetMin] = useState('');
  const [fltBudgetMax, setFltBudgetMax] = useState('');
  const [fltCreatedFrom, setFltCreatedFrom] = useState('');
  const [fltCreatedTo, setFltCreatedTo] = useState('');
  const [fltStartFrom, setFltStartFrom] = useState('');
  const [fltStartTo, setFltStartTo] = useState('');
  const [fltCloseFrom, setFltCloseFrom] = useState('');
  const [fltCloseTo, setFltCloseTo] = useState('');
  const [fltSteps, setFltSteps] = useState({
    business_case_done: false, pip_done: false, offers_received: false,
    wbs_recorded: false, orders_placed: false, invoices_received: false
  });

  // create / delete modals
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // project to delete

  // toast
  const [toast, setToast] = useState(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) return;
    setEditWbs(selected.wbs_number || '');
    setEditBudget(selected.budget_amount ?? '');
    setEditPrepDate(dateInputValue(selected.prep_month || selected.created_at));
    setEditStartDate(dateInputValue(selected.start_month));
    setEditCloseDate(dateInputValue(selected.close_month));
  }, [selected?.id]); // eslint-disable-line

  async function load() {
    try {
      setBusy(true);
      const data = await get('/api/projects/projects');
      setList(data?.data || []);
    } finally { setBusy(false); }
  }

  async function expand(p) {
    const willExpand = expandedId !== p.id;
    setExpandedId(willExpand ? p.id : null);
    if (willExpand) {
      setSelected(p);
      await openProject(p);
    } else {
      setSelected(null);
    }
  }

  async function openProject(p) {
    try {
      const s = await get(`/api/projects/projects/${p.id}/status`); setStatus(s || {});
    } catch { setStatus({}); }
    try {
      const l = await get(`/api/projects/projects/${p.id}/lines`); setLines(l || { offers: [], orders: [], invoices: [] });
    } catch { setLines({ offers: [], orders: [], invoices: [] }); }
    try {
      const a = await get(`/api/projects/projects/${p.id}/analysis`); setAnalysis(a || null);
    } catch { setAnalysis(null); }
    await loadAllFiles(p.id);
  }

  async function loadAllFiles(projectId) {
    const cats = ['business_case', 'pip', 'offer', 'wbs', 'order', 'invoice'];
    const out = {};
    for (const c of cats) {
      try {
        const f = await get(`/api/projects/projects/${projectId}/files`, { category: c });
        out[c] = f?.files || [];
      } catch { out[c] = []; }
    }
    setFiles(out);
  }

  async function saveHeaderFields() {
    if (!selected) return;
    try {
      const payload = {
        wbs_number: editWbs || null,
        budget_amount: editBudget === '' ? null : Number(editBudget),
      };
      const updated = await put(`/api/projects/projects/${selected.id}`, payload);
      // Auto-flag WBS when wbs_number/budget is set
      if ((payload.wbs_number && !status?.wbs_recorded) || (payload.budget_amount && !status?.wbs_recorded)) {
        await ensureStatus({ wbs_recorded: true });
      }
      setSelected(updated);
      setList((s) => s.map((x) => (x.id === updated.id ? updated : x)));
      setToast({ msg: 'Header saved.', type: 'success' });
      await openProject(updated);
    } catch (e) {
      setToast({ msg: 'Save failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function saveDates() {
    if (!selected) return;
    try {
      const payload = {
        prep_month: editPrepDate ? new Date(editPrepDate) : null,
        start_month: editStartDate ? new Date(editStartDate) : null,
        close_month: editCloseDate ? new Date(editCloseDate) : null,
      };
      const updated = await put(`/api/projects/projects/${selected.id}`, payload);
      // If user sets a close date manually, that's a "closed" step
      setSelected(updated);
      setList((s) => s.map((x) => (x.id === updated.id ? updated : x)));
      setToast({ msg: 'Dates saved.', type: 'success' });
      await openProject(updated);
    } catch (e) {
      setToast({ msg: 'Saving dates failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function createProject() {
    const name = newTitle.trim();
    if (!name) return;
    try {
      const row = await post('/api/projects/projects', { title: name });
      setNewTitle('');
      setShowCreate(false);
      setList((s) => [row, ...s]);
      setToast({ msg: `Project <b>${row.title}</b> created.`, type: 'success' });
      setExpandedId(row.id);
      setSelected(row);
      await openProject(row);
    } catch (e) {
      setToast({ msg: 'Creation failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function removeProject() {
    if (!confirmDelete) return;
    try {
      await del(`/api/projects/projects/${confirmDelete.id}`);
      setList((s) => s.filter((p) => p.id !== confirmDelete.id));
      if (expandedId === confirmDelete.id) { setExpandedId(null); setSelected(null); }
      setConfirmDelete(null);
      setToast({ msg: 'Project deleted.', type: 'success' });
    } catch (e) {
      setToast({ msg: 'Deletion failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function uploadFiles(p, category, filesList) {
    if (!filesList?.length) return;
    try {
      for (const file of filesList) {
        const fd = new FormData(); fd.append('file', file);
        await post(`/api/projects/projects/${p.id}/upload?category=${encodeURIComponent(category)}`, fd);
      }
      // Auto-ensure matching step when relevant (front-side safety)
      await ensureStepForCategory(category);
      setToast({ msg: filesList.length > 1 ? `${filesList.length} files uploaded.` : 'File uploaded.', type: 'success' });
      await loadAllFiles(p.id);
      await openProject(p);
    } catch (e) { setToast({ msg: 'Upload failed: ' + (e?.message || e), type: 'error' }); }
  }

  async function ensureStepForCategory(category) {
    // Even if backend already ticks, front enforces it for safety.
    const mapping = {
      business_case: 'business_case_done',
      pip: 'pip_done',
      offer: 'offers_received',
      wbs: 'wbs_recorded',
      order: 'orders_placed',
      invoice: 'invoices_received',
    };
    const key = mapping[category];
    if (!key || !selected) return;
    if (!status?.[key]) await ensureStatus({ [key]: true });
  }

  async function ensureStatus(patch) {
    const next = { ...(status || {}), ...patch };
    try {
      const js = await put(`/api/projects/projects/${selected.id}/status`, next);
      setStatus(js);
    } catch (e) {
      // non-bloquant
    }
  }

  async function deleteFile(fileId) {
    try {
      await del(`/api/projects/files/${fileId}`);
      setToast({ msg: 'File deleted.', type: 'success' });
      if (selected) await loadAllFiles(selected.id);
    } catch (e) { setToast({ msg: 'Delete failed: ' + (e?.message || e), type: 'error' }); }
  }

  async function addLine(kind, amount, vendor) {
    if (!selected || !amount) return;
    try {
      await post(`/api/projects/projects/${selected.id}/${kind}`, { amount: Number(amount), vendor: vendor || null });
      // auto-steps for offers/orders/invoices
      if (kind === 'offer')  await ensureStatus({ offers_received: true });
      if (kind === 'order')  await ensureStatus({ orders_placed: true });
      if (kind === 'invoice')await ensureStatus({ invoices_received: true });
      setToast({ msg: `${kind.charAt(0).toUpperCase() + kind.slice(1)} added.`, type: 'success' });
      await openProject(selected);
    } catch (e) { setToast({ msg: 'Operation failed: ' + (e?.message || e), type: 'error' }); }
  }
  async function updateLine(kind, lineId, patch) {
    try {
      await put(`/api/projects/projects/${selected.id}/${kind}/${lineId}`, patch);
      setToast({ msg: 'Line saved.', type: 'success' });
      await openProject(selected);
    } catch (e) { setToast({ msg: 'Edit failed: ' + (e?.message || e), type: 'error' }); }
  }
  async function deleteLine(kind, lineId) {
    try {
      await del(`/api/projects/projects/${selected.id}/${kind}/${lineId}`);
      setToast({ msg: 'Line deleted.', type: 'success' });
      await openProject(selected);
    } catch (e) { setToast({ msg: 'Delete failed: ' + (e?.message || e), type: 'error' }); }
  }

  async function toggleStatus(key) {
    if (!selected) return;
    const next = { ...(status || {}) }; next[key] = !next[key];
    try {
      const js = await put(`/api/projects/projects/${selected.id}/status`, next);
      setStatus(js);
      setToast({ msg: 'Status updated.', type: 'success' });
    } catch (e) { setToast({ msg: 'Status update failed: ' + (e?.message || e), type: 'error' }); }
  }

  async function setClosed(on) {
    // close toggle writes/clears close_month
    if (!selected) return;
    try {
      const payload = { close_month: on ? new Date() : null };
      const updated = await put(`/api/projects/projects/${selected.id}`, payload);
      setSelected(updated);
      setList((s) => s.map((x) => (x.id === updated.id ? updated : x)));
      setEditCloseDate(dateInputValue(updated.close_month));
      setToast({ msg: on ? 'Project closed.' : 'Project reopened.', type: 'success' });
      await openProject(updated);
    } catch (e) { setToast({ msg: 'Close toggle failed: ' + (e?.message || e), type: 'error' }); }
  }

  async function askAI(question) {
    if (!selected) return;
    const r = await post(`/api/projects/projects/${selected.id}/assistant`, { question });
    setAiAnswer(r?.answer || '');
  }

  /* ----------------------------- Filtering (client-side) ----------------------------- */
  const filtered = useMemo(() => {
    const within = (d, from, to) => {
      if (!d) return false;
      const t = new Date(d).setHours(0,0,0,0);
      const a = from ? new Date(from).setHours(0,0,0,0) : null;
      const b = to   ? new Date(to).setHours(0,0,0,0)   : null;
      if (a && t < a) return false;
      if (b && t > b) return false;
      return true;
    };
    return (list || []).filter((p) => {
      if (fltTitle && !(p.title || '').toLowerCase().includes(fltTitle.toLowerCase())) return false;
      if (fltWbsOnly && !p.wbs_number) return false;
      if (fltBudgetMin && Number(p.budget_amount ?? 0) < Number(fltBudgetMin)) return false;
      if (fltBudgetMax && Number(p.budget_amount ?? 0) > Number(fltBudgetMax)) return false;
      const health = p.status?.last_analysis?.health || 'ok';
      if (fltHealth !== 'all' && health !== fltHealth) return false;
      for (const k of Object.keys(fltSteps)) {
        if (fltSteps[k] && !p.status?.[k]) return false;
      }
      if (fltCreatedFrom || fltCreatedTo) if (!within(p.created_at, fltCreatedFrom, fltCreatedTo)) return false;
      if (fltStartFrom || fltStartTo)     if (!within(p.start_month, fltStartFrom, fltStartTo)) return false;
      if (fltCloseFrom || fltCloseTo)     if (!within(p.close_month, fltCloseFrom, fltCloseTo)) return false;
      return true;
    });
  }, [list, fltTitle, fltWbsOnly, fltBudgetMin, fltBudgetMax, fltHealth, fltSteps, fltCreatedFrom, fltCreatedTo, fltStartFrom, fltStartTo, fltCloseFrom, fltCloseTo]);

  const clearFilters = () => {
    setFltTitle('');
    setFltWbsOnly(false);
    setFltBudgetMin(''); setFltBudgetMax('');
    setFltHealth('all');
    setFltSteps({ business_case_done:false, pip_done:false, offers_received:false, wbs_recorded:false, orders_placed:false, invoices_received:false });
    setFltCreatedFrom(''); setFltCreatedTo(''); setFltStartFrom(''); setFltStartTo(''); setFltCloseFrom(''); setFltCloseTo('');
  };

  /* --------------------------------- Render --------------------------------- */
  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <PoundSterling /> Projects
        </h1>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={load} disabled={busy}>Refresh</button>
          <button className={btn} onClick={() => setShowFilters(s => !s)}>
            <SlidersHorizontal className="inline -mt-0.5 mr-1" /> Filters
          </button>
          <button className={btnPri} onClick={() => setShowCreate(true)}>
            <PlusCircle className="inline -mt-0.5 mr-1" /> Create
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="mb-6 p-4 rounded-2xl border bg-white shadow-sm">
          <div className="grid md:grid-cols-4 gap-3">
            <input className={input} placeholder="Search by title…" value={fltTitle} onChange={(e)=>setFltTitle(e.target.value)} />
            <div className="flex items-center gap-2">
              <input id="wbsOnly" type="checkbox" checked={fltWbsOnly} onChange={(e)=>setFltWbsOnly(e.target.checked)} />
              <label htmlFor="wbsOnly" className="text-sm text-gray-700">WBS present only</label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Health</span>
              <select className={input} value={fltHealth} onChange={(e)=>setFltHealth(e.target.value)}>
                <option value="all">All</option>
                <option value="ok">OK</option>
                <option value="warn">Warn</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} type="number" placeholder="Budget min £" value={fltBudgetMin} onChange={(e)=>setFltBudgetMin(e.target.value)} />
              <input className={input} type="number" placeholder="Budget max £" value={fltBudgetMax} onChange={(e)=>setFltBudgetMax(e.target.value)} />
            </div>

            <fieldset className="md:col-span-4 grid sm:grid-cols-3 gap-3">
              <legend className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                <Calendar size={16}/> Date filters
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} type="date" value={fltCreatedFrom} onChange={(e)=>setFltCreatedFrom(e.target.value)} />
                <input className={input} type="date" value={fltCreatedTo}   onChange={(e)=>setFltCreatedTo(e.target.value)} />
                <div className="col-span-2 text-xs text-gray-500">Created: from / to</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} type="date" value={fltStartFrom} onChange={(e)=>setFltStartFrom(e.target.value)} />
                <input className={input} type="date" value={fltStartTo}   onChange={(e)=>setFltStartTo(e.target.value)} />
                <div className="col-span-2 text-xs text-gray-500">Start: from / to</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} type="date" value={fltCloseFrom} onChange={(e)=>setFltCloseFrom(e.target.value)} />
                <input className={input} type="date" value={fltCloseTo}   onChange={(e)=>setFltCloseTo(e.target.value)} />
                <div className="col-span-2 text-xs text-gray-500">Close: from / to</div>
              </div>
            </fieldset>

            <fieldset className="md:col-span-4">
              <legend className="text-sm font-medium text-gray-700 mb-2">Steps (AND)</legend>
              <div className="grid sm:grid-cols-3 md:grid-cols-6 gap-2 text-sm">
                {Object.entries({
                  business_case_done: 'Business case', pip_done: 'PIP', offers_received: 'Offers',
                  wbs_recorded: 'WBS', orders_placed: 'Orders', invoices_received: 'Invoices'
                }).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!fltSteps[k]} onChange={(e)=>setFltSteps(s => ({...s, [k]: e.target.checked}))} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-4 flex gap-2">
            <button className={btn} onClick={load}>Reload</button>
            <button className={btnGhost} onClick={clearFilters}>Clear filters</button>
          </div>
        </div>
      )}

      {/* List (accordion) */}
      <div className="grid gap-3">
        {filtered.map((p) => {
          const st = p.status || {};
          const health = st?.last_analysis?.health || 'ok';
          const tone = health === 'critical' ? 'rose' : health === 'warn' ? 'amber' : 'green';
          const isOpen = expandedId === p.id;

          // progress computation (7 steps including "closed")
          const stepsDone = {
            business_case_done: !!st.business_case_done || (files.business_case?.length > 0),
            pip_done:           !!st.pip_done          || (files.pip?.length > 0),
            offers_received:    !!st.offers_received   || (lines.offers?.length > 0),
            wbs_recorded:       !!st.wbs_recorded      || !!p.wbs_number || Number(p.budget_amount || 0) > 0,
            orders_placed:      !!st.orders_placed     || (lines.orders?.length > 0),
            invoices_received:  !!st.invoices_received || (lines.invoices?.length > 0),
            closed:             !!p.close_month,
          };
          const totalSteps = 7;
          const completed = Object.values(stepsDone).filter(Boolean).length;
          const pct = Math.round((completed / totalSteps) * 100);

          return (
            <div key={p.id} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
              {/* Row header: only title + arrow + basic chips + delete icon */}
              <div className="px-4 py-3 flex items-center justify-between">
                <button className="flex items-center gap-3 text-left" onClick={() => expand(p)}>
                  {isOpen ? <ChevronDown /> : <ChevronRight />}
                  <span className="font-semibold">{p.title}</span>
                </button>
                <div className="flex items-center gap-2">
                  <Badge tone={tone}>
                    {health === 'critical' ? <AlertTriangle size={14}/> : health === 'warn' ? <AlertTriangle size={14}/> : <CheckCircle2 size={14}/>}
                    {health.toUpperCase()}
                  </Badge>
                  {p.wbs_number ? <Badge><CheckCircle2 size={12}/> WBS</Badge> : <Badge><XCircle size={12}/> WBS</Badge>}
                  <button className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded"
                          onClick={() => setConfirmDelete(p)} title="Delete project">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Expanded content */}
              {isOpen && (
                <div className="px-4 pb-5">
                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>Progress</span>
                      <span>{completed}/{totalSteps} • {pct}%</span>
                    </div>
                    <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
                      <div className="h-2 bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 grid sm:grid-cols-7 gap-2 text-[11px]">
                      {[
                        ['Business case', stepsDone.business_case_done],
                        ['PIP', stepsDone.pip_done],
                        ['Offers', stepsDone.offers_received],
                        ['WBS', stepsDone.wbs_recorded],
                        ['Orders', stepsDone.orders_placed],
                        ['Invoices', stepsDone.invoices_received],
                        ['Closed', stepsDone.closed],
                      ].map(([label, ok]) => (
                        <span key={label} className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${ok?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {ok ? <CheckCircle2 size={12}/> : <XCircle size={12}/>}
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Dates + WBS & Budget (editable) */}
                  <div className="grid lg:grid-cols-2 gap-4 mb-4">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">Created</label>
                        <input className={input} type="date" value={editPrepDate}
                               onChange={(e)=>setEditPrepDate(e.target.value)} onBlur={saveDates} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Start</label>
                        <input className={input} type="date" value={editStartDate}
                               onChange={(e)=>setEditStartDate(e.target.value)} onBlur={saveDates} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Close</label>
                        <input className={input} type="date" value={editCloseDate}
                               onChange={(e)=>setEditCloseDate(e.target.value)} onBlur={saveDates} />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-3">
                      <input className={input} placeholder="WBS number" value={editWbs}
                             onChange={(e)=>setEditWbs(e.target.value)} onBlur={saveHeaderFields}/>
                      <div className="flex items-center gap-2">
                        <PoundSterling size={16} className="text-gray-500"/>
                        <input className={input} placeholder="Budget amount (£)" type="number" value={editBudget}
                               onChange={(e)=>setEditBudget(e.target.value)} onBlur={saveHeaderFields}/>
                      </div>
                      {/* Close switch */}
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!selected?.close_month} onChange={(e)=>setClosed(e.target.checked)} />
                        <span>Mark as closed</span>
                      </label>
                    </div>
                  </div>

                  {/* Status checklist (interactive toggles) */}
                  <div className="p-3 rounded border bg-gray-50 mb-4">
                    <div className="text-sm font-medium mb-2">Checklist</div>
                    <div className="grid sm:grid-cols-3 md:grid-cols-7 gap-2 text-sm">
                      {[
                        ['business_case_done', 'Business case'],
                        ['pip_done', 'PIP'],
                        ['offers_received', 'Offers'],
                        ['wbs_recorded', 'WBS'],
                        ['orders_placed', 'Orders'],
                        ['invoices_received', 'Invoices'],
                      ].map(([k, label]) => (
                        <label key={k} className="flex items-center gap-2">
                          <input type="checkbox" checked={!!status?.[k]} onChange={()=>toggleStatus(k)} />
                          <span>{label}</span>
                        </label>
                      ))}
                      <div className="text-xs text-gray-500 md:col-span-1">Use the toggle above to close/reopen.</div>
                    </div>
                  </div>

                  {/* Attachments blocks */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {[
                      ['business_case', 'Business case'],
                      ['pip', 'PIP'],
                      ['offer', 'Offers'],
                      ['wbs', 'WBS / Budget'],
                      ['order', 'Orders'],
                      ['invoice', 'Invoices'],
                    ].map(([key, label]) => (
                      <div key={key} className="p-3 rounded border bg-gray-50">
                        <div className="text-sm font-medium mb-2 flex items-center gap-2"><Paperclip size={16}/> {label}</div>
                        <DropInput label="Drop files here"
                                   onFiles={(filesList)=>uploadFiles(selected, key, filesList)}
                                   accept={'.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'} multiple />
                        <ul className="mt-2 divide-y text-sm bg-white rounded border">
                          {(files[key] || []).length === 0 && <li className="px-3 py-2 text-gray-500">No files yet.</li>}
                          {(files[key] || []).map((f) => (
                            <li key={f.id} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div className="truncate">
                                <span className="font-medium">{f.filename}</span>
                                <span className="text-gray-500 text-xs ml-2">{new Date(f.uploaded_at).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <a className={btnGhost} href={`/api/projects/download?file_id=${f.id}`} target="_blank" rel="noreferrer" title="Download">
                                  <Download size={16}/>
                                </a>
                                <button className={btnGhost} title="Delete" onClick={() => deleteFile(f.id)}>
                                  <Trash2 size={16}/>
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {/* Add lines */}
                  <div className="grid md:grid-cols-3 gap-3 mt-4">
                    <AddLine title="Add offer" onSubmit={(amount, vendor)=>addLine('offer', amount, vendor)} />
                    <AddLine title="Add order" onSubmit={(amount, vendor)=>addLine('order', amount, vendor)} />
                    <AddLine title="Add invoice" onSubmit={(amount, vendor)=>addLine('invoice', amount, vendor)} />
                  </div>

                  {/* Lines tables */}
                  <div className="mt-4 grid gap-3">
                    <LinesTable title="Offers"   kind="offer"   rows={lines.offers}   dateKey="received_at" onEdit={(id,p)=>updateLine('offer',id,p)}   onDelete={(id)=>deleteLine('offer',id)} />
                    <LinesTable title="Orders"   kind="order"   rows={lines.orders}   dateKey="ordered_at"  onEdit={(id,p)=>updateLine('order',id,p)}   onDelete={(id)=>deleteLine('order',id)} />
                    <LinesTable title="Invoices" kind="invoice" rows={lines.invoices} dateKey="invoiced_at" onEdit={(id,p)=>updateLine('invoice',id,p)} onDelete={(id)=>deleteLine('invoice',id)} />
                  </div>

                  {/* KPI & Chart */}
                  <ProjectCharts lines={lines} analysis={analysis} />

                  {/* Alerts */}
                  <Alerts analysis={analysis} />

                  {/* AI */}
                  <div className="p-4 rounded border bg-indigo-50 mt-3">
                    <div className="font-semibold mb-2 flex items-center gap-2"><Bot/> AI Assistant</div>
                    <div className="flex gap-2">
                      <input className={input} placeholder="Ask a question (e.g., where is the overrun risk?)"
                             onKeyDown={(e)=> e.key==='Enter' && askAI(e.currentTarget.value)} />
                      <button className={btn} onClick={()=>askAI('Quick risk assessment with prioritized actions')}>Quick advice</button>
                    </div>
                    {aiAnswer && <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{aiAnswer}</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      <Modal open={showCreate} title="Create a project" onClose={()=>setShowCreate(false)}
             footer={
               <div className="flex justify-end gap-2">
                 <button className={btnGhost} onClick={()=>setShowCreate(false)}>Cancel</button>
                 <button className={btnPri} onClick={createProject} disabled={!newTitle.trim()}>Create</button>
               </div>
             }>
        <label className="text-sm text-gray-700">Title</label>
        <input className={`${input} mt-1`} placeholder="Project title" value={newTitle} onChange={(e)=>setNewTitle(e.target.value)}
               onKeyDown={(e)=> e.key==='Enter' && newTitle.trim() && createProject()} />
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!confirmDelete} title="Delete project" onClose={()=>setConfirmDelete(null)}
             footer={
               <div className="flex justify-end gap-2">
                 <button className={btnGhost} onClick={()=>setConfirmDelete(null)}>Cancel</button>
                 <button className={danger} onClick={removeProject}><Trash2 className="inline -mt-0.5 mr-1" /> Delete</button>
               </div>
             }>
        <div className="text-sm text-gray-700">
          Are you sure you want to delete <b>{confirmDelete?.title}</b>? This action is irreversible.
        </div>
      </Modal>

      {/* Toast */}
      <Toast {...toast} onClose={() => setToast(null)} />
    </section>
  );
}

/* ------------------------------ Subcomponents ------------------------------ */
function AddLine({ title, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  return (
    <div className="p-3 rounded border bg-white">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="flex gap-2">
        <input className={input} placeholder="Amount £" type="number" value={amount} onChange={(e)=>setAmount(e.target.value)} />
        <input className={input} placeholder="Vendor (optional)" value={vendor} onChange={(e)=>setVendor(e.target.value)} />
        <button className={btnPri} onClick={()=>{ if(!amount) return; onSubmit(amount, vendor); setAmount(''); setVendor(''); }}>
          Add
        </button>
      </div>
    </div>
  );
}

function LinesTable({ title, kind, rows, dateKey, onEdit, onDelete }) {
  const [editId, setEditId] = useState(null);
  const [val, setVal] = useState({ amount: '', vendor: '' });

  const startEdit = (r) => { setEditId(r.id); setVal({ amount: r.amount, vendor: r.vendor || '' }); };
  const cancel = () => { setEditId(null); setVal({ amount: '', vendor: '' }); };
  const save = async (id) => { await onEdit?.(id, { amount: Number(val.amount), vendor: val.vendor || null }); setEditId(null); };

  return (
    <div className="p-3 rounded border bg-white">
      <div className="font-semibold mb-2">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Vendor</th>
              <th className="py-2 pr-3">Amount</th>
              <th className="py-2 pr-3 w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="[&_tr:hover]:bg-gray-50">
            {rows.length === 0 && <tr><td className="py-3 text-gray-500" colSpan={4}>No lines yet.</td></tr>}
            {rows.map((r) => (
              <tr key={`${kind}-${r.id}`} className="border-t">
                <td className="py-2 pr-3">{new Date(r[dateKey] || Date.now()).toLocaleDateString()}</td>
                <td className="py-2 pr-3">
                  {editId === r.id
                    ? <input className={input} value={val.vendor} onChange={(e)=>setVal((s)=>({...s, vendor: e.target.value}))} />
                    : (r.vendor || '—')}
                </td>
                <td className="py-2 pr-3">
                  {editId === r.id
                    ? <input className={input} type="number" value={val.amount} onChange={(e)=>setVal((s)=>({...s, amount: e.target.value}))} />
                    : gbp(r.amount)}
                </td>
                <td className="py-2 pr-3">
                  {editId === r.id ? (
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={()=>save(r.id)} title="Save"><Save size={16}/></button>
                      <button className={btnGhost} onClick={cancel} title="Cancel"><X size={16}/></button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={()=>startEdit(r)} title="Edit"><Edit2 size={16}/></button>
                      <button className={btnGhost} onClick={()=>onDelete?.(r.id)} title="Delete"><Trash2 size={16}/></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatMonth(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
}

function ProjectCharts({ analysis, lines }) {
  const data = useMemo(() => {
    const toSeries = (arr, dateKey) => {
      const s = (arr || []).slice().sort((a, b) => new Date(a[dateKey] || 0) - new Date(b[dateKey] || 0));
      let cum = 0; const labels = []; const values = [];
      for (const x of s) { cum += Number(x.amount) || 0; labels.push(formatMonth(x[dateKey] || Date.now())); values.push(cum); }
      return { labels, values };
    };
    const inv = toSeries(lines?.invoices || [], 'invoiced_at');
    const ord = toSeries(lines?.orders || [], 'ordered_at');
    const off = toSeries(lines?.offers || [], 'received_at');

    const labels = [...new Set([...off.labels, ...ord.labels, ...inv.labels])];
    const mapTo = (labels, s) => labels.map(l => { const idx = s.labels.indexOf(l); return idx >= 0 ? s.values[idx] : (s.values[(idx < 0 ? s.values.length - 1 : idx)] ?? 0); });

    return {
      labels,
      datasets: [
        { label: 'Offers (£)', data: mapTo(labels, off), tension: 0.2 },
        { label: 'Orders (£)', data: mapTo(labels, ord), tension: 0.2 },
        { label: 'Invoices (£)', data: mapTo(labels, inv), tension: 0.2 },
      ],
    };
  }, [lines]);

  return (
    <div className="grid gap-4 mt-2">
      <div className="p-4 rounded border bg-white">
        <div className="font-semibold mb-2">Cumulative curves (£)</div>
        <Line data={data} options={{ responsive: true, scales: { y: { beginAtZero: true } } }} />
        <div className="text-xs text-gray-500 mt-1">Curves update as soon as you add offers, orders or invoices.</div>
      </div>
      {analysis && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Offers</div>
            <div className="text-xl font-semibold">{gbp(analysis.variance_vs_offer || 0)}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Budget</div>
            <div className="text-xl font-semibold">{gbp(analysis.variance_vs_budget || 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Alerts({ analysis }) {
  if (!analysis) return null;
  const items = [];
  if (analysis.risk_overrun_offer) items.push({ level: 'warn', text: 'Overrun risk vs Offers (>5%).' });
  if (analysis.risk_overrun_budget) items.push({ level: 'error', text: 'Likely overrun vs Budget (>5%).' });
  if (!items.length) items.push({ level: 'ok', text: 'No alerts — situation under control.' });

  return (
    <div className="grid gap-2">
      {items.map((a, i) => (
        <div key={i}
             className={`px-3 py-2 rounded border flex items-center gap-2 ${
               a.level === 'error' ? 'bg-rose-100 text-rose-800 border-rose-200'
                 : a.level === 'warn' ? 'bg-amber-100 text-amber-800 border-amber-200'
                 : 'bg-emerald-100 text-emerald-800 border-emerald-200'
             }`}>
          {a.level === 'error' ? <AlertTriangle /> : a.level === 'warn' ? <AlertTriangle /> : <CheckCircle2 />}
          <span className="text-sm">{a.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ helpers ------------------------------ */
function dateInputValue(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
