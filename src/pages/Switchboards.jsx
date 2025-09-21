// src/pages/Switchboards.jsx
import { useEffect, useMemo, useRef, useState } from 'react';

// Helpers (autonomes, pas de dépendance lib/api)
const API = import.meta.env.VITE_API_BASE || '';
async function apiGet(path) {
  const res = await fetch(`${API}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function Info({text}) {
  return (
    <span className="inline-flex items-center gap-1 text-gray-500 text-xs ml-2" title={text}>
      <span className="inline-block w-4 h-4 rounded-full bg-gray-100 text-gray-700 text-[10px] font-bold flex items-center justify-center">i</span>
    </span>
  );
}

// Tiny debounce hook
function useDebounced(value, delay=300) {
  const [v, setV] = useState(value);
  useEffect(()=>{ const t=setTimeout(()=>setV(value), delay); return ()=>clearTimeout(t); },[value,delay]);
  return v;
}

export default function SwitchboardsPage() {
  // -------- Global state
  const [site, setSite] = useState(localStorage.getItem('eh_user') ? JSON.parse(localStorage.getItem('eh_user')).site : '');
  const siteHeader = site || 'Nyon'; // fallback
  const [boards, setBoards] = useState([]);
  const [totalBoards, setTotalBoards] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState('desc');

  // board form
  const [boardForm, setBoardForm] = useState({
    id: null,
    name: '',
    code: '',
    meta: { building_code: '', floor: '', room: '' },
    regime_neutral: '',
    is_principal: false,
    modes: {},
    quality: {}
  });
  const editingBoard = boardForm.id !== null;

  // devices for selected board
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);

  // device form (stepper-like)
  const [devForm, setDevForm] = useState({
    id: null,
    device_number: '',           // tri & PDF
    name: '',
    device_type: '',
    manufacturer: '',
    reference: '',
    in_amps: '',
    icu_kA: '',
    ics_kA: '',
    poles: '',
    voltage_V: '',
    trip_unit: '',
    settings: {},                // JSON
    is_main_incoming: false,
    parent_id: null,
    downstream_switchboard_id: null,
    photos: [],
    pv_tests: null
  });
  const editingDevice = devForm.id !== null;

  // quick select / autocomplete
  const [refQuery, setRefQuery] = useState('');
  const dRefQuery = useDebounced(refQuery, 300);
  const [refOptions, setRefOptions] = useState([]); // {manufacturer, reference}
  const [refOpen, setRefOpen] = useState(false);

  // unified search drawer
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const dGlobalQuery = useDebounced(globalQuery, 350);
  const [globalResults, setGlobalResults] = useState({ boards: [], devices: [] });

  // photo -> IA
  const photoInputRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // -------- Load boards
  async function loadBoards() {
    const params = new URLSearchParams({ page, pageSize, sort, dir });
    if (dq) params.set('q', dq);
    const data = await apiGet(`/api/switchboard/boards?${params.toString()}`);
    setBoards(data.data||[]);
    setTotalBoards(data.total||0);
  }

  // -------- Load devices for active board
  async function loadDevices(boardId) {
    if (!boardId) return;
    const data = await apiGet(`/api/switchboard/devices?switchboard_id=${boardId}`);
    setDevices(data.data || []);
    setSelectedDeviceIds([]);
  }

  // -------- Effects
  useEffect(()=>{ loadBoards(); /* eslint-disable-next-line */ }, [dq, sort, dir, page, pageSize]);
  useEffect(()=>{ if (activeBoardId) loadDevices(activeBoardId); }, [activeBoardId]);

  // -------- Handlers Board
  function bf(k, v) {
    if (k.startsWith('meta.')) {
      const key = k.split('.').slice(1).join('.');
      setBoardForm(s => ({ ...s, meta: { ...s.meta, [key]: v }}));
    } else {
      setBoardForm(s => ({ ...s, [k]: v }));
    }
  }

  async function createBoard() {
    const payload = { ...boardForm, id: undefined };
    const sb = await apiPost('/api/switchboard/boards', payload);
    setBoardForm({ id: null, name: '', code: '', meta:{ building_code:'', floor:'', room:'' }, regime_neutral:'', is_principal:false, modes:{}, quality:{} });
    setPage(1);
    await loadBoards();
    setActiveBoardId(sb.id);
  }
  async function updateBoard() {
    await apiPut(`/api/switchboard/boards/${boardForm.id}`, boardForm);
    setBoardForm({ id: null, name: '', code: '', meta:{ building_code:'', floor:'', room:'' }, regime_neutral:'', is_principal:false, modes:{}, quality:{} });
    await loadBoards();
  }
  async function duplicateBoard(id) {
    const sb = await apiPost(`/api/switchboard/boards/${id}/duplicate`, {});
    await loadBoards();
    setActiveBoardId(sb.id);
  }
  async function deleteBoard(id) {
    if (!confirm('Delete this switchboard?')) return;
    await apiDelete(`/api/switchboard/boards/${id}`);
    if (activeBoardId === id) {
      setActiveBoardId(null);
      setDevices([]);
    }
    await loadBoards();
  }

  // -------- Handlers Device
  function df(k, v) { setDevForm(s => ({ ...s, [k]: v })); }

  async function createDevice() {
    const payload = { ...devForm, id: undefined, switchboard_id: activeBoardId };
    // coerce fields
    ['in_amps','icu_kA','ics_kA','poles','voltage_V','device_number'].forEach(n=>{
      if (payload[n]!=='' && payload[n]!==null && payload[n]!==undefined) payload[n] = Number(payload[n]);
      if (Number.isNaN(payload[n])) payload[n] = null;
    });
    const r = await apiPost('/api/switchboard/devices', payload);
    setDevForm({ id: null, device_number:'', name:'', device_type:'', manufacturer:'', reference:'', in_amps:'', icu_kA:'', ics_kA:'', poles:'', voltage_V:'', trip_unit:'', settings:{}, is_main_incoming:false, parent_id:null, downstream_switchboard_id:null, photos:[], pv_tests:null });
    await loadDevices(activeBoardId);
    // focus newly created? (optional)
  }

  async function updateDevice() {
    const payload = { ...devForm };
    ['in_amps','icu_kA','ics_kA','poles','voltage_V','device_number'].forEach(n=>{
      if (payload[n]!=='' && payload[n]!==null && payload[n]!==undefined) payload[n] = Number(payload[n]);
      if (Number.isNaN(payload[n])) payload[n] = null;
    });
    await apiPut(`/api/switchboard/devices/${devForm.id}`, payload);
    setDevForm({ id: null, device_number:'', name:'', device_type:'', manufacturer:'', reference:'', in_amps:'', icu_kA:'', ics_kA:'', poles:'', voltage_V:'', trip_unit:'', settings:{}, is_main_incoming:false, parent_id:null, downstream_switchboard_id:null, photos:[], pv_tests:null });
    await loadDevices(activeBoardId);
  }

  async function deleteDevice(id) {
    if (!confirm('Delete device?')) return;
    await apiDelete(`/api/switchboard/devices/${id}`);
    await loadDevices(activeBoardId);
  }

  async function setMainIncoming(id, val) {
    await apiPut(`/api/switchboard/devices/${id}/set-main`, { is_main_incoming: !!val });
    await loadDevices(activeBoardId);
  }

  // --- Bulk actions
  async function bulkDelete() {
    if (selectedDeviceIds.length===0) return;
    if (!confirm(`Delete ${selectedDeviceIds.length} devices?`)) return;
    await apiPost('/api/switchboard/devices/bulk-delete', { ids: selectedDeviceIds });
    await loadDevices(activeBoardId);
  }
  async function bulkDuplicate() {
    if (selectedDeviceIds.length===0) return;
    await apiPost('/api/switchboard/devices/bulk-duplicate', { ids: selectedDeviceIds });
    await loadDevices(activeBoardId);
  }

  // -------- Quick Select (autocomplete) + autofill immediate
  useEffect(()=>{
    let closed = false;
    async function run() {
      if (!dRefQuery) { setRefOptions([]); return; }
      const r = await apiGet(`/api/switchboard/device-references?q=${encodeURIComponent(dRefQuery)}`);
      if (!closed) setRefOptions(r.data || []);
    }
    run();
    return ()=>{ closed = true; };
  }, [dRefQuery]);

  async function applyRefOption(opt) {
    setRefOpen(false);
    setRefQuery(`${opt.manufacturer} ${opt.reference}`);
    // auto fill immediately from AI OR DB
    try {
      // 1° tenter un lookup DB direct
      const ai = await apiPost('/api/switchboard/search-device', { query: `${opt.manufacturer} ${opt.reference}` });
      // on remplit les champs du deviceForm
      df('manufacturer', ai.manufacturer || opt.manufacturer || '');
      df('reference', ai.reference || opt.reference || '');
      df('device_type', ai.device_type || '');
      if (ai.in_amps != null) df('in_amps', ai.in_amps);
      if (ai.icu_kA != null) df('icu_kA', ai.icu_kA);
      if (ai.ics_kA != null) df('ics_kA', ai.ics_kA);
      if (ai.poles != null) df('poles', ai.poles);
      if (ai.voltage_V != null) df('voltage_V', ai.voltage_V);
      if (ai.trip_unit) df('trip_unit', ai.trip_unit);
      if (ai.settings) df('settings', ai.settings);
      if (typeof ai.is_main_incoming === 'boolean') df('is_main_incoming', ai.is_main_incoming);
    } catch (e) {
      console.warn('Auto-fill failed', e);
    }
  }

  // -------- Global search (boards + devices)
  useEffect(()=>{
    let closed=false;
    async function run() {
      if (!dGlobalQuery) { setGlobalResults({boards:[], devices:[]}); return; }
      const r = await apiGet(`/api/switchboard/search?q=${encodeURIComponent(dGlobalQuery)}`);
      if (!closed) setGlobalResults(r || {boards:[], devices:[]});
    }
    run();
    return ()=>{ closed = true; };
  }, [dGlobalQuery]);

  // -------- Photo → IA
  async function handlePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await new Promise((resolve,reject)=>{
      const rr=new FileReader();
      rr.onload=()=>resolve(rr.result.split(',')[1]);
      rr.onerror=reject;
      rr.readAsDataURL(f);
    });
    setPhotoBusy(true);
    try {
      const ai = await apiPost('/api/switchboard/search-photo', { image_base64: b64 });
      // apply
      if (ai.manufacturer) df('manufacturer', ai.manufacturer);
      if (ai.reference) df('reference', ai.reference);
      if (ai.device_type) df('device_type', ai.device_type);
      if (ai.in_amps != null) df('in_amps', ai.in_amps);
      if (ai.icu_kA != null) df('icu_kA', ai.icu_kA);
      if (ai.ics_kA != null) df('ics_kA', ai.ics_kA);
      if (ai.poles != null) df('poles', ai.poles);
      if (ai.voltage_V != null) df('voltage_V', ai.voltage_V);
      if (ai.trip_unit) df('trip_unit', ai.trip_unit);
      if (ai.settings) df('settings', ai.settings);
      if (typeof ai.is_main_incoming === 'boolean') df('is_main_incoming', ai.is_main_incoming);

      // s’il détecte une référence déjà présente en DB, proposition de lien (parent/downstream)
      if (ai.match && ai.match.id) {
        if (confirm(`Link to existing device #${ai.match.id} (${ai.match.reference}) as parent?`)) {
          df('parent_id', ai.match.id);
        }
      }
    } catch (e) {
      alert('Photo recognition failed');
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  const totalPages = useMemo(()=>Math.max(1, Math.ceil(totalBoards / pageSize)),[totalBoards, pageSize]);

  return (
    <section className="container-narrow py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Switchboards</h1>
        <div className="flex gap-2">
          <button className="btn bg-gray-100" onClick={()=>setSearchOpen(o=>!o)} title="Open global search panel">🔎 Search</button>
          {activeBoardId && (
            <a className="btn bg-green-600 hover:bg-green-700 text-white"
               href={`/api/switchboard/boards/${activeBoardId}/report`} target="_blank" rel="noreferrer"
               title="Open PDF report">
              📄 PDF
            </a>
          )}
        </div>
      </div>

      {/* Filters / search boards */}
      <div className="card p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input className="input" placeholder="Search boards (name, code, building, floor, room…)" value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} />
          <select className="input w-full md:w-56" value={`${sort}:${dir}`} onChange={e=>{ const [s,d]=e.target.value.split(':'); setSort(s); setDir(d); }}>
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="name:asc">Name A→Z</option>
            <option value="name:desc">Name Z→A</option>
            <option value="code:asc">Code A→Z</option>
            <option value="code:desc">Code Z→A</option>
            <option value="building_code:asc">Building A→Z</option>
            <option value="building_code:desc">Building Z→A</option>
            <option value="floor:asc">Floor A→Z</option>
            <option value="floor:desc">Floor Z→A</option>
          </select>
        </div>
      </div>

      {/* Boards grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {boards.map(b=>(
          <div key={b.id} className="card p-4 hover:-translate-y-0.5 transition">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold">{b.name}</div>
                <div className="text-sm text-gray-600">{b.code}</div>
                <div className="text-xs text-gray-500 mt-1">{b.meta?.building_code || '—'} · {b.meta?.floor || '—'} · {b.meta?.room || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {b.is_principal && <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700">⭐ Principal</span>}
                  {b.regime_neutral && <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-emerald-50 text-emerald-700">⚡ {b.regime_neutral}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button className="btn bg-gray-100 text-xs" title="Open devices" onClick={()=>setActiveBoardId(b.id)}>📂</button>
                <button className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs" title="Edit board" onClick={()=>{
                  setBoardForm({
                    id: b.id,
                    name: b.name,
                    code: b.code,
                    meta: { building_code: b.meta?.building_code || '', floor: b.meta?.floor || '', room: b.meta?.room || '' },
                    regime_neutral: b.regime_neutral || '',
                    is_principal: !!b.is_principal,
                    modes: b.modes || {},
                    quality: b.quality || {}
                  });
                }}>✏️</button>
                <button className="btn bg-purple-500 hover:bg-purple-600 text-white text-xs" title="Duplicate" onClick={()=>duplicateBoard(b.id)}>📑</button>
                <button className="btn bg-red-500 hover:bg-red-600 text-white text-xs" title="Delete" onClick={()=>deleteBoard(b.id)}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mb-8">
        <div className="text-sm text-gray-600">{totalBoards} boards · Page {page}/{totalPages}</div>
        <div className="flex gap-2">
          <button className="btn bg-gray-100" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
          <button className="btn bg-gray-100" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
        </div>
      </div>

      {/* Board form */}
      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{editingBoard ? 'Edit switchboard' : 'Create switchboard'}</h2>
          {editingBoard && <button className="btn bg-gray-100" onClick={()=>setBoardForm({ id:null, name:'', code:'', meta:{building_code:'',floor:'',room:''}, regime_neutral:'', is_principal:false, modes:{}, quality:{} })}>Cancel</button>}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name<Info text="Nom court du tableau (ex: TGBT B11)"/></label>
            <input className="input mt-1" value={boardForm.name} onChange={e=>bf('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Code<Info text="Identifiant unique du tableau (ex: TGBT-B11-01)"/></label>
            <input className="input mt-1" value={boardForm.code} onChange={e=>bf('code', e.target.value)} />
          </div>
          <div>
            <label className="label">Building<Info text="Code bâtiment (ex: B11)"/></label>
            <input className="input mt-1" value={boardForm.meta.building_code} onChange={e=>bf('meta.building_code', e.target.value)} />
          </div>
          <div>
            <label className="label">Floor<Info text="Niveau (ex: 1, -1, RDC)"/></label>
            <input className="input mt-1" value={boardForm.meta.floor} onChange={e=>bf('meta.floor', e.target.value)} />
          </div>
          <div>
            <label className="label">Room<Info text="Local (ex: Local Elec 02)"/></label>
            <input className="input mt-1" value={boardForm.meta.room} onChange={e=>bf('meta.room', e.target.value)} />
          </div>
          <div>
            <label className="label">Neutral regime<Info text="TT, TN-S, TN-C, IT…"/></label>
            <input className="input mt-1" value={boardForm.regime_neutral} onChange={e=>bf('regime_neutral', e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <label className="label">Principal switchboard<Info text="Arrivée principale (plusieurs possibles)"/></label>
            <input type="checkbox" className="mt-1" checked={boardForm.is_principal} onChange={e=>bf('is_principal', e.target.checked)} />
          </div>
        </div>
        <div className="flex justify-end mt-4 gap-2">
          {!editingBoard && <button className="btn btn-primary" onClick={createBoard}>Create</button>}
          {editingBoard && <button className="btn btn-primary" onClick={updateBoard}>Update</button>}
        </div>
      </div>

      {/* Devices panel */}
      {activeBoardId && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Devices of board #{activeBoardId}</h2>
            <div className="flex gap-2">
              <button className="btn bg-red-100 hover:bg-red-200" onClick={bulkDelete} disabled={selectedDeviceIds.length===0}>🗑 Delete selected</button>
              <button className="btn bg-purple-100 hover:bg-purple-200" onClick={bulkDuplicate} disabled={selectedDeviceIds.length===0}>📑 Duplicate selected</button>
              <a className="btn bg-green-600 hover:bg-green-700 text-white"
                 href={`/api/switchboard/boards/${activeBoardId}/report`} target="_blank" rel="noreferrer">
                📄 PDF
              </a>
            </div>
          </div>

          {/* Quick Select Existing — now searchable */}
          <div className="mb-4 relative">
            <label className="label">Quick Select Existing<Info text="Tape quelques lettres de la marque ou de la référence, puis choisis pour pré-remplir"/></label>
            <input
              className="input mt-1"
              placeholder="Ex: Schneider NSX100F…"
              value={refQuery}
              onFocus={()=>setRefOpen(true)}
              onChange={e=>{ setRefQuery(e.target.value); setRefOpen(true); }}
            />
            {refOpen && refOptions.length>0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-soft max-h-72 overflow-auto">
                {refOptions.map((opt,i)=>(
                  <button key={`${opt.manufacturer}-${opt.reference}-${i}`}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50"
                          onClick={()=>applyRefOption(opt)}>
                    <div className="text-sm font-medium">{opt.manufacturer} <span className="text-gray-500">{opt.reference}</span></div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Device form (stepper light) */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Device #<Info text="Numéro pour l’ordre PDF et la liste"/></label>
                  <input className="input mt-1" value={devForm.device_number} onChange={e=>df('device_number', e.target.value)} placeholder="ex: 1, 2, 3…" />
                </div>
                <div>
                  <label className="label">Name<Info text="Nom affiché (ex: QF1, Arrivée BT…)"/></label>
                  <input className="input mt-1" value={devForm.name} onChange={e=>df('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Type<Info text="MCB, MCCB, ACB, Switch, Fuse…"/></label>
                  <input className="input mt-1" value={devForm.device_type} onChange={e=>df('device_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">Manufacturer</label>
                  <input className="input mt-1" value={devForm.manufacturer} onChange={e=>df('manufacturer', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input
                    className="input mt-1"
                    value={devForm.reference}
                    onChange={async e=>{
                      df('reference', e.target.value);
                      // auto-IA dès la saisie
                      if (e.target.value.length >= 4 && devForm.manufacturer) {
                        try {
                          const ai = await apiPost('/api/switchboard/search-device', { query: `${devForm.manufacturer} ${e.target.value}` });
                          if (ai.device_type && !devForm.device_type) df('device_type', ai.device_type);
                          if (ai.in_amps != null && !devForm.in_amps) df('in_amps', ai.in_amps);
                          if (ai.icu_kA != null && !devForm.icu_kA) df('icu_kA', ai.icu_kA);
                          if (ai.ics_kA != null && !devForm.ics_kA) df('ics_kA', ai.ics_kA);
                          if (ai.poles != null && !devForm.poles) df('poles', ai.poles);
                          if (ai.voltage_V != null && !devForm.voltage_V) df('voltage_V', ai.voltage_V);
                          if (ai.trip_unit && !devForm.trip_unit) df('trip_unit', ai.trip_unit);
                          if (ai.settings && (!devForm.settings || Object.keys(devForm.settings).length===0)) df('settings', ai.settings);
                        } catch {}
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="label">In (A)</label>
                  <input className="input mt-1" type="number" value={devForm.in_amps} onChange={e=>df('in_amps', e.target.value)} />
                </div>
                <div>
                  <label className="label">Icu (kA)</label>
                  <input className="input mt-1" type="number" value={devForm.icu_kA} onChange={e=>df('icu_kA', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ics (kA)</label>
                  <input className="input mt-1" type="number" value={devForm.ics_kA} onChange={e=>df('ics_kA', e.target.value)} />
                </div>
                <div>
                  <label className="label">Poles</label>
                  <input className="input mt-1" type="number" value={devForm.poles} onChange={e=>df('poles', e.target.value)} />
                </div>
                <div>
                  <label className="label">Voltage (V)</label>
                  <input className="input mt-1" type="number" value={devForm.voltage_V} onChange={e=>df('voltage_V', e.target.value)} />
                </div>
                <div>
                  <label className="label">Trip unit</label>
                  <input className="input mt-1" value={devForm.trip_unit} onChange={e=>df('trip_unit', e.target.value)} />
                </div>
                <div className="md:col-span-3">
                  <label className="label">Settings (JSON)<Info text="LSIG, courbes B/C/D…"/></label>
                  <textarea className="input mt-1 min-h-24" value={JSON.stringify(devForm.settings || {}, null, 2)} onChange={e=>{
                    try { df('settings', JSON.parse(e.target.value)); } catch { /* ignore */ }
                  }}/>
                </div>
                <div className="flex items-center gap-2">
                  <label className="label">Main incoming</label>
                  <input type="checkbox" className="mt-1" checked={devForm.is_main_incoming} onChange={e=>df('is_main_incoming', e.target.checked)} />
                </div>
                <div>
                  <label className="label">Parent device ID<Info text="Pour l’arborescence interne"/></label>
                  <input className="input mt-1" value={devForm.parent_id || ''} onChange={e=>df('parent_id', e.target.value ? Number(e.target.value) : null)} />
                </div>
                <div>
                  <label className="label">Downstream board ID<Info text="Lien vers un tableau aval"/></label>
                  <input className="input mt-1" value={devForm.downstream_switchboard_id || ''} onChange={e=>df('downstream_switchboard_id', e.target.value ? Number(e.target.value) : null)} />
                </div>
              </div>

              <div className="flex justify-between items-center mt-4">
                <div className="flex items-center gap-2">
                  <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhoto} hidden />
                  <button className="btn bg-gray-100" onClick={()=>photoInputRef.current?.click()} disabled={photoBusy}>
                    {photoBusy ? 'Scanning…' : '📷 Photo → Auto-fill'}
                  </button>
                </div>
                <div className="flex gap-2">
                  {!editingDevice && <button className="btn btn-primary" onClick={createDevice}>Add device</button>}
                  {editingDevice && (
                    <>
                      <button className="btn bg-gray-100" onClick={()=>setDevForm({ id:null, device_number:'', name:'', device_type:'', manufacturer:'', reference:'', in_amps:'', icu_kA:'', ics_kA:'', poles:'', voltage_V:'', trip_unit:'', settings:{}, is_main_incoming:false, parent_id:null, downstream_switchboard_id:null, photos:[], pv_tests:null })}>Cancel</button>
                      <button className="btn btn-primary" onClick={updateDevice}>Update</button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Devices list (ordered by device_number asc, fallback created_at) */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Devices</h3>
                <div className="text-xs text-gray-500">{devices.length} items</div>
              </div>
              <div className="max-h-[560px] overflow-auto divide-y">
                {devices
                  .slice()
                  .sort((a,b)=>{
                    const aa = (a.device_number ?? 999999) - (b.device_number ?? 999999);
                    if (aa !== 0) return aa;
                    return new Date(b.created_at) - new Date(a.created_at);
                  })
                  .map(d=>(
                  <div key={d.id} className="py-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <input type="checkbox"
                                 checked={selectedDeviceIds.includes(d.id)}
                                 onChange={(e)=>{
                                   setSelectedDeviceIds(s=>{
                                     if (e.target.checked) return [...new Set([...s, d.id])];
                                     return s.filter(x=>x!==d.id);
                                   });
                                 }} />
                          <div className="font-medium truncate">{d.name || d.reference || `Device #${d.id}`}</div>
                          {d.is_main_incoming && <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700">⭐ Main</span>}
                          {d.downstream_switchboard_id && <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-amber-50 text-amber-700">🔗 SB→{d.downstream_switchboard_id}</span>}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          #{d.device_number ?? '—'} · {d.device_type || '—'} · {d.manufacturer || '—'} {d.reference || ''} · In {d.in_amps ?? '—'}A · Icu {d.icu_kA ?? '—'}kA · Ics {d.ics_kA ?? '—'}kA · {d.poles ?? '—'}P · {d.voltage_V ?? '—'}V
                        </div>
                        {d.parent_id && <div className="text-[11px] text-gray-500 mt-0.5">Parent: {d.parent_id}</div>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs" title="Edit" onClick={()=>setDevForm({
                          id: d.id,
                          device_number: d.device_number ?? '',
                          name: d.name || '',
                          device_type: d.device_type || '',
                          manufacturer: d.manufacturer || '',
                          reference: d.reference || '',
                          in_amps: d.in_amps ?? '',
                          icu_kA: d.icu_kA ?? '',
                          ics_kA: d.ics_kA ?? '',
                          poles: d.poles ?? '',
                          voltage_V: d.voltage_V ?? '',
                          trip_unit: d.trip_unit || '',
                          settings: d.settings || {},
                          is_main_incoming: !!d.is_main_incoming,
                          parent_id: d.parent_id || null,
                          downstream_switchboard_id: d.downstream_switchboard_id || null,
                          photos: [],
                          pv_tests: null
                        })}>✏️</button>
                        <button className="btn bg-emerald-500 hover:bg-emerald-600 text-white text-xs" title="Toggle main" onClick={()=>setMainIncoming(d.id, !d.is_main_incoming)}>⭐</button>
                        <button className="btn bg-purple-500 hover:bg-purple-600 text-white text-xs" title="Duplicate" onClick={async()=>{
                          await apiPost(`/api/switchboard/devices/${d.id}/duplicate`, {});
                          await loadDevices(activeBoardId);
                        }}>📑</button>
                        <button className="btn bg-red-500 hover:bg-red-600 text-white text-xs" title="Delete" onClick={()=>deleteDevice(d.id)}>🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
                {devices.length===0 && <div className="text-sm text-gray-500 py-8 text-center">No devices</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global search drawer */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={()=>setSearchOpen(false)}>
          <div className="absolute top-0 right-0 h-full w-full max-w-xl bg-white shadow-xl p-5 overflow-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Global search</h3>
              <button className="btn bg-gray-100" onClick={()=>setSearchOpen(false)}>Close</button>
            </div>
            <input className="input w-full mb-3" placeholder="Search switchboards & devices…" value={globalQuery} onChange={e=>setGlobalQuery(e.target.value)} />
            <div className="space-y-6">
              <div>
                <div className="text-sm font-semibold mb-1">Boards</div>
                <div className="divide-y">
                  {globalResults.boards?.map(b=>(
                    <button key={`sb-${b.id}`} className="w-full text-left py-2 hover:bg-gray-50" onClick={()=>{
                      setActiveBoardId(b.id);
                      setSearchOpen(false);
                    }}>
                      <div className="font-medium">{b.name} <span className="text-gray-500">{b.code}</span></div>
                      <div className="text-xs text-gray-500">{b.meta?.building_code || '—'} · {b.meta?.floor || '—'} · {b.meta?.room || '—'}</div>
                    </button>
                  ))}
                  {(!globalResults.boards || globalResults.boards.length===0) && <div className="text-xs text-gray-500 py-3">No board</div>}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold mb-1">Devices</div>
                <div className="divide-y">
                  {globalResults.devices?.map(d=>(
                    <button key={`dv-${d.id}`} className="w-full text-left py-2 hover:bg-gray-50" onClick={()=>{
                      setActiveBoardId(d.switchboard_id);
                      setSearchOpen(false);
                      setTimeout(()=>setDevForm({
                        id: d.id,
                        device_number: d.device_number ?? '',
                        name: d.name || '',
                        device_type: d.device_type || '',
                        manufacturer: d.manufacturer || '',
                        reference: d.reference || '',
                        in_amps: d.in_amps ?? '',
                        icu_kA: d.icu_kA ?? '',
                        ics_kA: d.ics_kA ?? '',
                        poles: d.poles ?? '',
                        voltage_V: d.voltage_V ?? '',
                        trip_unit: d.trip_unit || '',
                        settings: d.settings || {},
                        is_main_incoming: !!d.is_main_incoming,
                        parent_id: d.parent_id || null,
                        downstream_switchboard_id: d.downstream_switchboard_id || null,
                        photos: [],
                        pv_tests: null
                      }), 250);
                    }}>
                      <div className="font-medium">{d.manufacturer} {d.reference} <span className="text-gray-500">#{d.device_number ?? '—'}</span></div>
                      <div className="text-xs text-gray-500">SB {d.switchboard_id} · {d.device_type || '—'} · In {d.in_amps ?? '—'}A</div>
                    </button>
                  ))}
                  {(!globalResults.devices || globalResults.devices.length===0) && <div className="text-xs text-gray-500 py-3">No device</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
