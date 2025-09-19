// src/pages/Atex.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';
import * as XLSX from 'xlsx';

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

/* ---------- Simple Bar Chart Component ---------- */
function SimpleBarChart({ data, title, yLabel = 'Count' }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barWidth = 100 / data.length;

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full h-3">
              <div 
                className="bg-blue-500 h-3 rounded-full" 
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-700 w-12">{item.value}</span>
            <span className="text-sm text-gray-600 min-w-0 truncate">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2">{yLabel}</p>
    </div>
  );
}

/* ---------- Doughnut Chart Component ---------- */
function DoughnutChart({ data, title }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = 60;
  const centerRadius = 30;
  const colors = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];
  
  // Calculate cumulative angles
  const cumulativeAngles = data.reduce((acc, item, i) => {
    const startAngle = acc[i-1]?.endAngle || 0;
    const endAngle = startAngle + (item.value / total) * 2 * Math.PI;
    acc[i] = { startAngle, endAngle, ...item };
    return acc;
  }, []);

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="relative flex justify-center">
        <svg width="200" height="200" viewBox="0 0 200 200">
          {/* Center circle */}
          <circle 
            cx="100" 
            cy="100" 
            r={centerRadius} 
            fill="white" 
            stroke="white" 
            strokeWidth="2"
          />
          
          {/* Doughnut segments */}
          {cumulativeAngles.map((segment, i) => {
            const x1 = 100 + centerRadius * Math.cos(segment.startAngle - Math.PI/2);
            const y1 = 100 + centerRadius * Math.sin(segment.startAngle - Math.PI/2);
            const x2 = 100 + centerRadius * Math.cos(segment.endAngle - Math.PI/2);
            const y2 = 100 + centerRadius * Math.sin(segment.endAngle - Math.PI/2);
            const largeArc = segment.endAngle - segment.startAngle > Math.PI ? 1 : 0;
            
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A ${centerRadius} ${centerRadius} 0 ${largeArc} 1 ${x2} ${y2} L 100 100 Z`}
                fill={colors[i % colors.length]}
                stroke="white"
                strokeWidth="1"
              />
            );
          })}
          
          {/* Center text */}
          <text x="100" y="95" textAnchor="middle" className="font-bold text-lg fill-gray-700">
            {total}
          </text>
          <text x="100" y="115" textAnchor="middle" className="text-xs fill-gray-500">
            Total
          </text>
        </svg>
      </div>
      
      {/* Legend */}
      <div className="mt-4 space-y-1">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            <span className="text-sm">
              {item.label}: {item.value} ({Math.round((item.value / total) * 100)}%)
            </span>
          </div>
        ))}
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
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
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

  // ✅ sort SÛR par défaut (évite 500 si "updated_at" n'existe pas encore en DB)
  const [sort, setSort] = useState({ by: 'id', dir: 'desc' });

  // modals/drawers
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);
  const [attachments, setAttachments] = useState([]); // list for drawer
  const [newAttachFiles, setNewAttachFiles] = useState([]); // for adding new attachments
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

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const data = await get('/api/atex/analytics');
      setAnalytics(data);
    } catch (e) {
      console.error('Analytics load failed:', e);
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadSuggests() {
    try {
      const s = await get('/api/atex/suggests');
      setSuggests(s || {});
    } catch { /* non-bloquant */ }
  }

  useEffect(() => { load(); }, [sort, q, fBuilding, fRoom, fType, fManufacturer, fStatus, fGas, fDust]); // quand les filtres changent
  useEffect(() => { loadSuggests(); }, []); // au montage
  useEffect(() => { if (tab === 'assessment') loadAnalytics(); }, [tab]); // analytics quand on va dans assessment

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

  // Status mapping for display and color
  const statusMap = {
    'Conforme': { display: 'Compliant', color: 'bg-green-100 text-green-800' },
    'Non conforme': { display: 'Non-compliant', color: 'bg-red-100 text-red-800' },
    'À vérifier': { display: 'To review', color: 'bg-yellow-100 text-yellow-800' },
  };

  function getStatusDisplay(status) {
    return statusMap[status]?.display || status;
  }

  function getStatusColor(status) {
    return statusMap[status]?.color || '';
  }

  function getDateColor(dateStr) {
    if (!dateStr) return '';
    const days = daysUntil(dateStr);
    if (days === null || days < 0) return 'bg-red-100 text-red-800';
    return 'bg-green-100 text-green-800';
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
    setNewAttachFiles([]);
    try {
      const list = await get(`/api/atex/equipments/${item.id}/attachments`);
      setAttachments(list || []);
    } catch (e) {
      setAttachments([]);
    }
  }

  async function uploadNewAttachments() {
    if (!newAttachFiles.length) return;
    try {
      const fd = new FormData();
      for (const f of newAttachFiles) fd.append('files', f);
      await upload(`/api/atex/equipments/${showAttach.id}/attachments`, fd);
      setNewAttachFiles([]);
      const list = await get(`/api/atex/equipments/${showAttach.id}/attachments`);
      setAttachments(list || []);
      alert('Attachments uploaded.');
    } catch (e) {
      alert('Upload failed: ' + e.message);
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

  /* ---------- Import/Export helpers ---------- */
  async function exportToExcel() {
    try {
      const { data } = await get('/api/atex/export');
      if (!data.length) {
        alert('No data to export');
        return;
      }
      
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ATEX Equipment');
      XLSX.writeFile(wb, `atex_equipment_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  }

  async function importFromExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        // Filter and validate
        const validData = jsonData
          .filter(row => row.component_type && row.building && row.room)
          .map(row => ({
            site: row.site || '',
            building: String(row.building || ''),
            room: String(row.room || ''),
            component_type: String(row.component_type || ''),
            manufacturer: row.manufacturer || '',
            manufacturer_ref: row.manufacturer_ref || '',
            atex_ref: row.atex_ref || '',
            zone_gas: row.zone_gas ? Number(row.zone_gas) : null,
            zone_dust: row.zone_dust ? Number(row.zone_dust) : null,
            comments: row.comments || '',
            last_control: row.last_control || '',
            frequency_months: row.frequency_months ? Number(row.frequency_months) : 36,
            next_control: row.next_control || ''
          }));

        if (!validData.length) {
          alert('No valid equipment data found. Required: building, room, component_type');
          return;
        }

        // Batch import
        const results = [];
        for (const payload of validData) {
          try {
            const created = await post('/api/atex/equipments', payload);
            results.push({ success: true, data: created });
          } catch (err) {
            results.push({ success: false, error: err.message, data: payload });
          }
        }

        const successCount = results.filter(r => r.success).length;
        alert(`${successCount}/${validData.length} equipments imported successfully.`);
        load();
      } catch (e) {
        alert('Import failed: ' + e.message);
      }
    };
    reader.readAsArrayBuffer(file);
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
          {showFilters && (
            <FilterBar
              q={q} setQ={setQ}
              fBuilding={fBuilding} setFBuilding={setFBuilding}
              fRoom={fRoom} setFRoom={setFRoom}
              fType={fType} setFType={setFType}
              fManufacturer={fManufacturer} setFManufacturer={setFManufacturer}
              fStatus={fStatus} setFStatus={setFStatus}
              fGas={fGas} setFGas={setFGas}
              fDust={fDust} setFDust={setFDust}
              uniques={uniques}
              onSearch={load}
              onReset={()=>{
                setQ(''); setFBuilding([]); setFRoom([]); setFType([]); setFManufacturer([]); setFStatus([]); setFGas([]); setFDust([]);
                setSort({by:'id', dir:'desc'}); load();
              }}
            />
          )}

          <div className="card p-0 overflow-x-auto">
            <table className="min-w-full text-sm w-full">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  {[
                    ['building','Building'],['room','Room'],['component_type','Component'],
                    ['manufacturer','Manufacturer'],['manufacturer_ref','Mfr Ref'],
                    ['atex_ref','ATEX Ref'],['zone_gas','Gas Zone'],['zone_dust','Dust Zone'],
                    ['status','Status'],['last_control','Last inspection'],['next_control','Next inspection']
                  ].map(([key,label])=>(
                    <th key={key} className="px-4 py-3 cursor-pointer select-none" onClick={()=>toggleSort(key)}>
                      {label}{' '}{sort.by===key ? (sort.dir==='asc'?'▲':'▼') : ''}
                    </th>
                  ))}
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">No equipment found</td></tr>
                ) : rows.map(r=>{
                  const dleft = daysUntil(r.next_control);
                  const statusDisplay = getStatusDisplay(r.status);
                  const statusColor = getStatusColor(r.status);
                  const nextDateColor = getDateColor(r.next_control);
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2">{r.building}</td>
                      <td className="px-4 py-2">{r.room}</td>
                      <td className="px-4 py-2 truncate max-w-[12rem]" title={r.component_type}>{r.component_type}</td>
                      <td className="px-4 py-2 truncate max-w-[12rem]" title={r.manufacturer}>{r.manufacturer}</td>
                      <td className="px-4 py-2 truncate max-w-[10rem]" title={r.manufacturer_ref}>{r.manufacturer_ref}</td>
                      <td className="px-4 py-2 truncate max-w-[14rem]" title={r.atex_ref}>{r.atex_ref}</td>
                      <td className="px-4 py-2">{r.zone_gas ?? '—'}</td>
                      <td className="px-4 py-2">{r.zone_dust ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor} whitespace-nowrap`}>
                          {statusDisplay}
                        </span>
                      </td>
                      <td className="px-4 py-2">{formatDate(r.last_control)}</td>
                      <td className="px-4 py-2">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${nextDateColor} whitespace-nowrap`}>
                          {formatDate(r.next_control)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button className="w-8 h-8 rounded bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center" title="Edit" onClick={()=>setEditItem(r)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                          <button className="w-8 h-8 rounded bg-red-500 text-white hover:bg-red-600 flex items-center justify-center" title="Delete" onClick={()=>setShowDelete(r)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                          <button className="w-8 h-8 rounded bg-green-500 text-white hover:bg-green-600 flex items-center justify-center" title="Attachments" onClick={()=>openAttachments(r)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                          </button>
                          <button className="w-8 h-8 rounded bg-purple-500 text-white hover:bg-purple-600 flex items-center justify-center" title="AI Check" onClick={()=>runAI(r)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Edit modal - Responsive */}
          {editItem && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
              <div className={`card p-6 w-full max-w-2xl ${window.innerWidth < 768 ? 'h-full overflow-auto' : ''}`}>
                <h3 className="text-xl font-semibold mb-4">Edit equipment #{editItem.id}</h3>
                <form className="grid md:grid-cols-2 gap-4" onSubmit={onSaveEdit}>
                  <div>
                    <label className="label">Building</label>
                    <input className="input mt-1" name="building" defaultValue={editItem.building} placeholder="Building" required/>
                  </div>
                  <div>
                    <label className="label">Room</label>
                    <input className="input mt-1" name="room" defaultValue={editItem.room} placeholder="Room" required/>
                  </div>
                  <div>
                    <label className="label">Component type</label>
                    <input className="input mt-1" name="component_type" defaultValue={editItem.component_type} placeholder="Component type" required/>
                  </div>
                  <div>
                    <label className="label">Manufacturer</label>
                    <input className="input mt-1" name="manufacturer" defaultValue={editItem.manufacturer} placeholder="Manufacturer"/>
                  </div>
                  <div>
                    <label className="label">Manufacturer ref</label>
                    <input className="input mt-1" name="manufacturer_ref" defaultValue={editItem.manufacturer_ref} placeholder="Manufacturer ref"/>
                  </div>
                  <div>
                    <label className="label">ATEX marking</label>
                    <input className="input mt-1" name="atex_ref" defaultValue={editItem.atex_ref} placeholder="ATEX marking"/>
                  </div>
                  <div>
                    <label className="label">Gas zone</label>
                    <select className="input mt-1" name="zone_gas" defaultValue={editItem.zone_gas ?? ''}>
                      <option value="">Gas zone</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Dust zone</label>
                    <select className="input mt-1" name="zone_dust" defaultValue={editItem.zone_dust ?? ''}>
                      <option value="">Dust zone</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="input mt-1" name="status" defaultValue={editItem.status}>
                      <option>Conforme</option><option>Non conforme</option><option>À vérifier</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Last inspection</label>
                    <input className="input mt-1" type="date" name="last_control" defaultValue={formatDate(editItem.last_control)} />
                  </div>
                  <div>
                    <label className="label">Next inspection</label>
                    <input className="input mt-1" type="date" name="next_control" defaultValue={formatDate(editItem.next_control)} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Comments</label>
                    <textarea className="input mt-1" name="comments" placeholder="Comments" defaultValue={editItem.comments||''}/>
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button type="button" className="btn bg-gray-100" onClick={()=>setEditItem(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete pop-up - Responsive */}
          {showDelete && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
              <div className={`card p-6 w-full max-w-md ${window.innerWidth < 768 ? 'h-full max-h-full overflow-auto' : ''}`}>
                <h3 className="text-xl font-semibold mb-3">Confirm deletion</h3>
                <p className="text-gray-700 mb-6">
                  Delete equipment <b>#{showDelete.id}</b> — {showDelete.component_type} ({showDelete.building}/{showDelete.room})?
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn bg-gray-100" onClick={()=>setShowDelete(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={()=>onDelete(showDelete.id)}>Delete</button>
                </div>
              </div>
            </div>
          )}

          {/* Attachments drawer - Responsive */}
          {showAttach && (
            <div className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4 z-50">
              <div className={`card p-6 w-full md:max-w-xl md:mx-auto md:rounded-2xl rounded-t-2xl ${window.innerWidth < 768 ? 'h-[90vh] overflow-auto' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-semibold">Attachments — #{showAttach.id}</h3>
                  <button className="btn bg-gray-100" onClick={()=>{ setShowAttach(null); setAttachments([]); setNewAttachFiles([]); }}>Close</button>
                </div>
                <div className="mb-4">
                  <label className="label block">Add attachments</label>
                  <input className="input mt-1" type="file" multiple onChange={e=>setNewAttachFiles(Array.from(e.target.files||[]))}/>
                  {!!newAttachFiles.length && (
                    <div className="text-xs text-gray-600 mt-1">
                      {newAttachFiles.length} file(s) selected
                    </div>
                  )}
                  {!!newAttachFiles.length && (
                    <button className="btn btn-primary mt-2 text-xs" onClick={uploadNewAttachments} type="button">Upload</button>
                  )}
                </div>
                <ul className="space-y-2">
                  {(attachments||[]).length ? attachments.map(a=>(
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <div className="truncate">{a.filename} <span className="text-xs text-gray-500">({Math.round((a.size||0)/1024)} KB)</span></div>
                      <div className="flex gap-2">
                        <a className="btn btn-primary text-xs px-2 py-1" href={`${API_BASE}/api/atex/attachments/${a.id}/download`} target="_blank" rel="noreferrer">Download</a>
                        <button className="btn bg-gray-100 text-xs px-2 py-1" onClick={async()=>{
                          await del(`/api/atex/attachments/${a.id}`);
                          const list = await get(`/api/atex/equipments/${showAttach.id}/attachments`);
                          setAttachments(list||[]);
                        }}>Remove</button>
                      </div>
                    </li>
                  )) : (
                    <li className="text-gray-600">No attachments.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* AI modal - Lateral on PC, full on mobile */}
          {aiItem && (
            <div className={`fixed bg-black/30 z-50 ${window.innerWidth >= 768 ? 'right-0 top-0 h-full w-96' : 'inset-0 flex items-center justify-center p-4'}`}>
              {window.innerWidth >= 768 ? (
                <div className="card p-6 h-full overflow-auto">
                  <div className="flex items-center justify-between mb-3 sticky top-0 bg-white z-10">
                    <h3 className="text-xl font-semibold">AI assessment — #{aiItem.id}</h3>
                    <button className="btn bg-gray-100" onClick={()=>{ setAiItem(null); setAiText(''); }}>Close</button>
                  </div>
                  <div className="mt-3">
                    {aiLoading ? (
                      <div className="text-gray-600">Running analysis…</div>
                    ) : (
                      <pre className="text-sm whitespace-pre-wrap">{aiText || '—'}</pre>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card p-6 w-full max-w-2xl h-[80vh] overflow-auto">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xl font-semibold">AI assessment — #{aiItem.id}</h3>
                    <button className="btn bg-gray-100" onClick={()=>{ setAiItem(null); setAiText(''); }}>Close</button>
                  </div>
                  <div className="mt-3">
                    {aiLoading ? (
                      <div className="text-gray-600">Running analysis…</div>
                    ) : (
                      <pre className="text-sm whitespace-pre-wrap">{aiText || '—'}</pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Onglet Create ---- */}
      {tab === 'create' && (
        <div className="card p-6">
          <form className="grid md:grid-cols-2 gap-4" onSubmit={onCreate}>
            <div>
              <label className="label">Site</label>
              <select className="input mt-1" value={createForm.site} onChange={e=>cf('site', e.target.value)}>
                <option value="">—</option>
                {SITE_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Building</label>
              <input className="input mt-1" value={createForm.building} onChange={e=>cf('building', e.target.value)} list="buildings" placeholder="Building"/>
              <datalist id="buildings">{suggests.building?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">Room</label>
              <input className="input mt-1" value={createForm.room} onChange={e=>cf('room', e.target.value)} list="rooms" placeholder="Room"/>
              <datalist id="rooms">{suggests.room?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">Component type</label>
              <input className="input mt-1" value={createForm.component_type} onChange={e=>cf('component_type', e.target.value)} list="types" placeholder="Component type"/>
              <datalist id="types">{suggests.component_type?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">Manufacturer</label>
              <input className="input mt-1" value={createForm.manufacturer} onChange={e=>cf('manufacturer', e.target.value)} list="mans" placeholder="Manufacturer"/>
              <datalist id="mans">{suggests.manufacturer?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">Mfr Ref</label>
              <input className="input mt-1" value={createForm.manufacturer_ref} onChange={e=>cf('manufacturer_ref', e.target.value)} list="mrefs" placeholder="Manufacturer ref"/>
              <datalist id="mrefs">{suggests.manufacturer_ref?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">ATEX marking</label>
              <input className="input mt-1" value={createForm.atex_ref} onChange={e=>cf('atex_ref', e.target.value)} list="arefs" placeholder="Ex: II 2G Ex ib IIC T4 Gb / 2D Ex tb IIIC T135°C Db"/>
              <datalist id="arefs">{suggests.atex_ref?.map(v=><option key={v} value={v}/>)}</datalist>
            </div>
            <div>
              <label className="label">Gas zone</label>
              <select className="input mt-1" value={createForm.zone_gas} onChange={e=>cf('zone_gas', e.target.value)}>
                <option value="">—</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
              </select>
            </div>
            <div>
              <label className="label">Dust zone</label>
              <select className="input mt-1" value={createForm.zone_dust} onChange={e=>cf('zone_dust', e.target.value)}>
                <option value="">—</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Comments</label>
              <textarea className="input mt-1" rows={3} value={createForm.comments} onChange={e=>cf('comments', e.target.value)} />
            </div>

            <div>
              <label className="label">Last inspection</label>
              <div className="flex gap-2 mt-1">
                <input ref={lastRef} className="input flex-1" type="date" value={createForm.last_control} onChange={e=>cf('last_control', e.target.value)} />
                <button type="button" className="btn bg-gray-100" onClick={()=>openPicker(lastRef)}>📅</button>
              </div>
            </div>

            <div>
              <label className="label">Frequency (months)</label>
              <input className="input mt-1" type="number" min="1" value={createForm.frequency_months} onChange={e=>cf('frequency_months', e.target.value)} />
            </div>

            <div>
              <label className="label">Next inspection</label>
              <div className="flex gap-2 mt-1">
                <input ref={nextRef} className="input flex-1" type="date" value={createForm.next_control} onChange={e=>cf('next_control', e.target.value)} />
                <button type="button" className="btn bg-gray-100" onClick={()=>{
                  cf('next_control', computeNextControl());
                }}>↻</button>
                <button type="button" className="btn bg-gray-100" onClick={()=>openPicker(nextRef)}>📅</button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="label">Attachments</label>
              <input className="input mt-1" type="file" multiple onChange={e=>setFiles(Array.from(e.target.files||[]))}/>
              {!!files.length && (
                <div className="text-xs text-gray-600 mt-1">
                  {files.length} file(s) selected
                </div>
              )}
            </div>

            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" className="btn bg-gray-100" onClick={()=>{
                setCreateForm({
                  site: defaultSite, building:'', room:'', component_type:'',
                  manufacturer:'', manufacturer_ref:'', atex_ref:'',
                  zone_gas:'', zone_dust:'', comments:'',
                  last_control:'', frequency_months:36, next_control:'',
                });
                setFiles([]);
              }}>Reset</button>
              <button type="submit" className="btn btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* ---- Onglet Import/Export ---- */}
      {tab === 'import' && (
        <div className="card p-6 space-y-6">
          <h2 className="text-2xl font-semibold">Import / Export</h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">Excel Template Instructions</h3>
              <p className="text-gray-700 mb-4">Use the following column order in your Excel file (first row headers):</p>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left border">Column</th>
                      <th className="px-4 py-2 text-left border">Example</th>
                      <th className="px-4 py-2 text-left border">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-4 py-2 border">site</td><td className="px-4 py-2 border">Nyon</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">building</td><td className="px-4 py-2 border">20</td><td className="px-4 py-2 border font-semibold">Yes</td></tr>
                    <tr><td className="px-4 py-2 border">room</td><td className="px-4 py-2 border">112</td><td className="px-4 py-2 border font-semibold">Yes</td></tr>
                    <tr><td className="px-4 py-2 border">component_type</td><td className="px-4 py-2 border">Compressor</td><td className="px-4 py-2 border font-semibold">Yes</td></tr>
                    <tr><td className="px-4 py-2 border">manufacturer</td><td className="px-4 py-2 border">Schneider</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">manufacturer_ref</td><td className="px-4 py-2 border">218143RT</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">atex_ref</td><td className="px-4 py-2 border">II 2G Ex ib IIC T4 Gb</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">zone_gas</td><td className="px-4 py-2 border">2</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">zone_dust</td><td className="px-4 py-2 border">21</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">comments</td><td className="px-4 py-2 border">Installed 2023</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">last_control</td><td className="px-4 py-2 border">2025-09-19</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">frequency_months</td><td className="px-4 py-2 border">36</td><td className="px-4 py-2 border">No</td></tr>
                    <tr><td className="px-4 py-2 border">next_control</td><td className="px-4 py-2 border">2028-09-19</td><td className="px-4 py-2 border">No</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-3">Dates in YYYY-MM-DD format. Numbers for zones (0,1,2 for gas; 20,21,22 for dust).</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <button className="btn btn-primary" onClick={exportToExcel}>
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Current Equipment Data
              </button>
              <div>
                <label className="block text-sm font-medium mb-1">Import Equipment Data</label>
                <input className="input" type="file" accept=".xlsx,.xls" onChange={importFromExcel} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Onglet Assessment ---- */}
      {tab === 'assessment' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Assessment & Analytics</h2>
            <div className="text-sm text-gray-500">
              Updated: {analytics?.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : 'Loading...'}
            </div>
          </div>

          {/* Stats Cards */}
          {analyticsLoading ? (
            <div className="grid md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white p-4 rounded-lg shadow animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                </div>
              ))}
            </div>
          ) : analytics ? (
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                <h3 className="text-lg font-medium text-gray-900">Total Equipment</h3>
                <p className="text-3xl font-bold text-blue-600 mt-1">{analytics.stats.total}</p>
                <p className="text-sm text-gray-500 mt-1">All ATEX equipment</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                <h3 className="text-lg font-medium text-gray-900">Compliant</h3>
                <p className="text-3xl font-bold text-green-600 mt-1">{analytics.stats.compliant}</p>
                <p className="text-sm text-gray-500 mt-1">{Math.round((analytics.stats.compliant / analytics.stats.total) * 100)}% compliance rate</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
                <h3 className="text-lg font-medium text-gray-900">Overdue Inspections</h3>
                <p className="text-3xl font-bold text-red-600 mt-1">{analytics.stats.overdue}</p>
                <p className="text-sm text-gray-500 mt-1">Immediate action required</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">Loading analytics...</div>
          )}

          {/* Charts */}
          {analytics && (
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Compliance Doughnut Chart */}
              <DoughnutChart 
                data={[
                  { label: 'Compliant', value: analytics.stats.compliant },
                  { label: 'Non-compliant', value: analytics.stats.non_compliant },
                  { label: 'To review', value: analytics.stats.to_review }
                ]} 
                title="Compliance Status Distribution" 
              />

              {/* Top Equipment Types */}
              <SimpleBarChart 
                data={analytics.byType.map(item => ({
                  label: item.component_type.slice(0, 20) + (item.component_type.length > 20 ? '...' : ''),
                  value: parseInt(item.count)
                }))} 
                title="Top Equipment Types" 
              />

              {/* Inspections Due */}
              <SimpleBarChart 
                data={[
                  { label: 'Overdue', value: analytics.stats.overdue },
                  { label: 'Due 90 days', value: analytics.stats.due_90_days },
                  { label: 'Future', value: analytics.stats.future }
                ]} 
                title="Inspection Timeline" 
              />

              {/* Compliance by Zone */}
              <SimpleBarChart 
                data={analytics.complianceByZone.map(item => ({
                  label: `Zone ${item.zone}`,
                  value: parseInt(item.compliant)
                }))} 
                title="Compliant Equipment by Gas Zone" 
                yLabel="Compliant Count"
              />
            </div>
          )}

          {/* Risk Assessment Table */}
          {analytics && analytics.riskEquipment.length > 0 && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b bg-gray-50">
                <h3 className="text-lg font-medium">High Priority Equipment ({analytics.riskEquipment.length})</h3>
                <p className="text-sm text-gray-600">Overdue inspections and due within next 90 days</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">ID</th>
                      <th className="px-4 py-2 text-left font-medium">Equipment</th>
                      <th className="px-4 py-2 text-left font-medium">Location</th>
                      <th className="px-4 py-2 text-left font-medium">Zones</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Next Inspection</th>
                      <th className="px-4 py-2 text-left font-medium">Days</th>
                      <th className="px-4 py-2 text-left font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.riskEquipment.map(r => {
                      const dleft = daysUntil(r.next_control);
                      const risk = dleft < 0 ? 'High' : 'Medium';
                      const riskColor = risk === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-4 py-2 font-mono text-sm">#{r.id}</td>
                          <td className="px-4 py-2">{r.component_type}</td>
                          <td className="px-4 py-2">
                            <div>{r.building}</div>
                            <div className="text-xs text-gray-500">Room {r.room}</div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="text-xs">Gas: {r.zone_gas || '—'}</div>
                            <div className="text-xs">Dust: {r.zone_dust || '—'}</div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-1 rounded text-xs ${getStatusColor(r.status)}`}>
                              {getStatusDisplay(r.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2">{formatDate(r.next_control)}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-1 rounded text-xs ${riskColor}`}>
                              {dleft < 0 ? `${Math.abs(dleft)} days late` : `${dleft} days`}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <button 
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                              onClick={() => setTab('controls')}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
