// src/pages/Atex.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';

// Garder en phase avec SignUp si tu ajoutes des sites
const SITE_OPTIONS = ['Nyon','Levice','Aprilia'];

/* ---------- Petits utilitaires UI ---------- */
function Tag({ children, tone='default' }) {
  const toneClass = {
    default: 'bg-gray-100 text-gray-800',
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
  }[tone] || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${toneClass}`}>{children}</span>;
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toISOString().slice(0,10);
}
function daysUntil(d) {
  if (!d) return null;
  const target = new Date(d);
  const now = new Date();
  return Math.ceil((target - now) / (1000*60*60*24));
}

function useOutsideClose(ref, onClose) {
  useEffect(() => {
    function handler(e){ if(ref.current && !ref.current.contains(e.target)) onClose?.(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

/* ---------- Filtres pro/compacts ---------- */
function MultiSelect({ label, values, setValues, options }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);
  useOutsideClose(wrapRef, () => setOpen(false));

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? options.filter(o => String(o).toLowerCase().includes(s)) : options;
  }, [options, search]);

  function toggle(v) {
    setValues(prev => prev.includes(v) ? prev.filter(x => x!==v) : [...prev, v]);
  }
  function clearAll() { setValues([]); setSearch(''); }
  const labelText = values.length ? `${label} · ${values.length}` : label;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={()=>setOpen(o=>!o)}
        className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm flex items-center gap-2 hover:border-gray-400"
        title={label}
      >
        <span className="truncate max-w-[10rem]">{labelText}</span>
        <svg className="w-4 h-4 opacity-60" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"/></svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
          <div className="flex items-center gap-2">
            <input
              className="input h-9 flex-1"
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
            <button className="text-xs text-gray-600 hover:text-gray-900" onClick={clearAll} type="button">Clear</button>
          </div>
          <div className="max-h-56 overflow-auto mt-2 pr-1">
            {filtered.length ? filtered.map(v=>(
              <label key={v} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={values.includes(v)} onChange={()=>toggle(v)} />
                <span className="text-sm truncate">{v}</span>
              </label>
            )) : <div className="text-sm text-gray-500 py-2 px-1">No results</div>}
          </div>
          {!!values.length && (
            <div className="flex flex-wrap gap-1 mt-2">
              {values.map(v=>(
                <span key={v} className="px-2 py-0.5 rounded bg-gray-100 text-xs">
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Segmented({ label, values, setValues, options }) {
  function toggle(v) { setValues(prev => prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]); }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex rounded-md border border-gray-300 overflow-hidden">
        {options.map(v=>(
          <button
            key={v}
            type="button"
            onClick={()=>toggle(v)}
            className={`px-2.5 h-8 text-sm border-r last:border-r-0 ${values.includes(v) ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterBar({
  q, setQ,
  fBuilding, setFBuilding,
  fRoom, setFRoom,
  fType, setFType,
  fManufacturer, setFManufacturer,
  fStatus, setFStatus,
  fGas, setFGas,
  fDust, setFDust,
  uniques,
  onSearch, onReset
}) {
  return (
    <div className="card p-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              className="h-9 w-72 rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm"
              placeholder="Search text (building, room, ref...)"
              value={q}
              onChange={e=>setQ(e.target.value)}
            />
            <svg className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"/></svg>
          </div>
          <button className="btn btn-primary h-9" onClick={onSearch}>Search</button>
          <button className="h-9 px-3 rounded-md border bg-white text-sm hover:bg-gray-50" onClick={onReset} type="button">Reset</button>
        </div>

        <div className="flex flex-wrap gap-2">
          <MultiSelect label="Building" values={fBuilding} setValues={setFBuilding} options={uniques.buildings}/>
          <MultiSelect label="Room" values={fRoom} setValues={setFRoom} options={uniques.rooms}/>
          <MultiSelect label="Type" values={fType} setValues={setFType} options={uniques.types}/>
          <MultiSelect label="Manufacturer" values={fManufacturer} setValues={setFManufacturer} options={uniques.manufacturers}/>
          <MultiSelect label="Status" values={fStatus} setValues={setFStatus} options={['Compliant','Non-compliant','To review']}/>
          <Segmented label="Gas" values={fGas} setValues={setFGas} options={['0','1','2']}/>
          <Segmented label="Dust" values={fDust} setValues={setFDust} options={['20','21','22']}/>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ */

export default function Atex() {
  const [tab, setTab] = useState('controls');
  const [showFilters, setShowFilters] = useState(false);

  // data
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters (multi)
  const [q, setQ] = useState('');
  const [fBuilding, setFBuilding] = useState([]);
  const [fRoom, setFRoom] = useState([]);
  const [fType, setFType] = useState([]);
  const [fManufacturer, setFManufacturer] = useState([]);
  const [fStatus, setFStatus] = useState([]);
  const [fGas, setFGas] = useState([]);     // ['0','1','2']
  const [fDust, setFDust] = useState([]);   // ['20','21','22']

  // sort  **CHANGÉ ICI**
  const [sort, setSort] = useState({ by: 'id', dir: 'desc' });

  // modals/drawers
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);
  const [attachments, setAttachments] = useState([]); // list for drawer
  const [aiItem, setAiItem] = useState(null);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // CREATE form
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const defaultSite = user?.site || '';
  const [suggests, setSuggests] = useState({ building:[], room:[], component_type:[], manufacturer:[], manufacturer_ref:[], atex_ref:[] });
  const [createForm, setCreateForm] = useState({
    site: defaultSite,
    building: '', room: '',
    component_type: '',
    manufacturer: '', manufacturer_ref: '',
    atex_ref: '',
    zone_gas: '', zone_dust: '',
    comments: '',
    last_control: '',
    frequency_months: 36,
    next_control: '',
  });
  const [files, setFiles] = useState([]);

  function cf(k, v) { setCreateForm(s => ({ ...s, [k]: v })); }

  /* ---------- Chargement liste & suggests ---------- */
  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      fBuilding.forEach(v => (params.building = [...(params.building||[]), v]));
      fRoom.forEach(v => (params.room = [...(params.room||[]), v]));
      fType.forEach(v => (params.component_type = [...(params.component_type||[]), v]));
      fManufacturer.forEach(v => (params.manufacturer = [...(params.manufacturer||[]), v]));
      // map UI statuses -> backend statuses
      const mapStatus = { 'Compliant':'Conforme', 'Non-compliant':'Non conforme', 'To review':'À vérifier' };
      fStatus.forEach(v => (params.status = [...(params.status||[]), mapStatus[v] || v]));
      fGas.forEach(v => (params.zone_gas = [...(params.zone_gas||[]), v]));
      fDust.forEach(v => (params.zone_dust = [...(params.zone_dust||[]), v]));
      if (sort.by) { params.sort = sort.by; params.dir = sort.dir; }
      const data = await get('/api/atex/equipments', params);
      setRows(data || []);
    } catch (e) {
      alert('Load failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSuggests() {
    try {
      const s = await get('/api/atex/suggests');
      setSuggests(s || {});
    } catch { /* non-bloquant */ }
  }

  useEffect(() => { load(); }, [sort]); // quand le tri change
  useEffect(() => { loadSuggests(); }, []); // au montage

  const uniques = useMemo(() => {
    const u = (key) => Array.from(new Set(rows.map(r => r[key]).filter(Boolean))).sort();
    return {
      buildings: u('building'),
      rooms: u('room'),
      types: u('component_type'),
      manufacturers: u('manufacturer'),
    };
  }, [rows]);

  function toggleSort(col) {
    setSort(prev => prev.by===col ? { by: col, dir: prev.dir==='asc'?'desc':'asc' } : { by: col, dir:'asc' });
  }

  /* ---------- Actions ---------- */
  async function onDelete(id) {
    try {
      await del(`/api/atex/equipments/${id}`);
      setShowDelete(null);
      load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function onSaveEdit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.zone_gas = payload.zone_gas ? Number(payload.zone_gas) : null;
    payload.zone_dust = payload.zone_dust ? Number(payload.zone_dust) : null;

    try {
      await put(`/api/atex/equipments/${editItem.id}`, payload);
      setEditItem(null);
      load();
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }

  async function runAI(item) {
    try {
      setAiItem(item); setAiLoading(true); setAiText('');
      const { analysis } = await post(`/api/atex/ai/${item.id}`, {});
      setAiText(analysis);
    } catch (e) {
      setAiText('AI failed: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  // Attachments drawer
  async function openAttachments(item) {
    setShowAttach(item);
    try {
      const list = await get(`/api/atex/equipments/${item.id}/attachments`);
      setAttachments(list || []);
    } catch (e) {
      setAttachments([]);
    }
  }

  /* ---------- CREATE helpers ---------- */
  function computeNextControl() {
    const d = createForm.last_control ? new Date(createForm.last_control) : null;
    if (!d) return '';
    const m = Number(createForm.frequency_months || 36);
    d.setMonth(d.getMonth() + m);
    return d.toISOString().slice(0,10);
  }

  // calendar helpers (Create)
  const lastRef = useRef(null);
  const nextRef = useRef(null);
  function openPicker(ref) {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') { el.showPicker(); return; }
    el.focus(); el.click();
  }

  async function onCreate(e) {
    e.preventDefault();
    const payload = { ...createForm };
    payload.zone_gas = payload.zone_gas ? Number(payload.zone_gas) : null;
    payload.zone_dust = payload.zone_dust ? Number(payload.zone_dust) : null;
    if (!payload.next_control) payload.next_control = computeNextControl();

    try {
      const created = await post('/api/atex/equipments', payload);
      if (files.length) {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        await upload(`/api/atex/equipments/${created.id}/attachments`, fd);
      }
      // reset
      setCreateForm({
        site: defaultSite,
        building: '', room: '',
        component_type: '',
        manufacturer: '', manufacturer_ref: '',
        atex_ref: '',
        zone_gas: '', zone_dust: '',
        comments: '',
        last_control: '',
        frequency_months: 36,
        next_control: '',
      });
      setFiles([]);
      await load();
      setTab('controls');
      alert('Equipment created.');
    } catch (e) {
      alert('Create failed: ' + e.message);
    }
  }

  /* ---------- Rendu ---------- */
  return (
    <section className="container-narrow py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">ATEX</h1>
        {tab === 'controls' && (
          <button
            className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm flex items-center gap-2 hover:border-gray-400"
            onClick={()=>setShowFilters(v=>!v)}
            type="button"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3V5zm4 6h10v2H7v-2zm-2 6h14v2H5v-2z"/></svg>
            Filters
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {[
          {key:'controls',label:'Controls'},
          {key:'create',label:'Create'},
          {key:'import',label:'Import / Export'},
          {key:'assessment',label:'Assessment'}
        ].map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} className={`btn ${tab===t.key ? 'btn-primary' : 'bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Onglet Controls ---- */}
      {tab === 'controls' && (
        <div className="space-y-4">
          {/* … TOUT INCHANGÉ (table, modales, etc.) … */}
          {/* (Section inchangée volontairement pour rester concise ici) */}
        </div>
      )}

      {/* Les autres onglets restent inchangés */}
    </section>
  );
}
