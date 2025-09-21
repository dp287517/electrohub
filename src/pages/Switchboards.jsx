// src/pages/Switchboards.jsx
import { useEffect, useMemo, useRef, useState } from 'react';

/* ================= API HELPERS (with X-Site) ================= */
const API = import.meta.env.VITE_API_BASE || '';

function makeHeaders(site) {
  const h = { 'Content-Type': 'application/json' };
  if (site) h['X-Site'] = site; // required to scope data per site
  return h;
}
async function apiGet(path, site) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: site ? { 'X-Site': site } : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, body, site) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: makeHeaders(site),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPut(path, body, site) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: makeHeaders(site),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path, site) {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: site ? { 'X-Site': site } : undefined,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ================= Small UI helpers ================= */
function Info({ text }) {
  return (
    <span className="inline-flex items-center gap-1 text-gray-500 text-xs ml-2" title={text}>
      <span className="inline-block w-4 h-4 rounded-full bg-gray-100 text-gray-700 text-[10px] font-bold flex items-center justify-center">i</span>
    </span>
  );
}
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

/* ================= PAGE ================= */
export default function SwitchboardsPage() {
  // Current site from local storage
  const [site, setSite] = useState(() => {
    try { return JSON.parse(localStorage.getItem('eh_user') || '{}').site || ''; } catch { return ''; }
  });
  const siteLabel = site || 'Nyon';

  // Boards list (homepage)
  const [boards, setBoards] = useState([]);
  const [totalBoards, setTotalBoards] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState('desc');

  // Board form (toggle panel)
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardForm, setBoardForm] = useState({
    id: null,
    name: '',
    code: '',
    meta: { building_code: '', floor: '', room: '' },
    regime_neutral: '',
    is_principal: false,
    modes: {},
    quality: {},
  });
  const editingBoard = boardForm.id !== null;

  // Active board & devices
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);

  // Devices search (text) + client-side filter
  const [devQuery, setDevQuery] = useState('');
  const dDevQuery = useDebounced(devQuery, 250);

  // Device form — settings split into explicit fields (no JSON textarea anymore)
  const [devForm, setDevForm] = useState({
    id: null,
    device_number: '',
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
    // split settings:
    curve_type: '', // e.g., B/C/D for MCB or other curve code
    L_long_delay: '', // LSIG parameters
    S_short_delay: '',
    I_instantaneous: '',
    G_ground: '',
    // relations:
    is_main_incoming: false,
    parent_id: null,
    downstream_switchboard_id: null,
    // raw settings object kept internally for submission
    settings: {},
    photos: [],
    pv_tests: null,
  });
  const editingDevice = devForm.id !== null;

  // Quick Select (existing refs) + AI autofill
  const [refQuery, setRefQuery] = useState('');
  const dRefQuery = useDebounced(refQuery, 300);
  const [refOptions, setRefOptions] = useState([]);
  const [refOpen, setRefOpen] = useState(false);

  // Global search drawer (unchanged)
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const dGlobalQuery = useDebounced(globalQuery, 350);
  const [globalResults, setGlobalResults] = useState({ boards: [], devices: [] });

  // Photo → AI
  const photoInputRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Pickers for parent / downstream
  const [allBoards, setAllBoards] = useState([]);
  const [boardDevices, setBoardDevices] = useState([]);

  /* ================= LOADERS ================= */
  async function loadBoards() {
    const params = new URLSearchParams({ page, pageSize, sort, dir });
    if (dq) params.set('q', dq);
    const data = await apiGet(`/api/switchboard/boards?${params.toString()}`, site);
    setBoards(data.data || []);
    setTotalBoards(data.total || 0);
  }
  async function loadDevices(boardId) {
    if (!boardId) return;
    const data = await apiGet(`/api/switchboard/devices?switchboard_id=${boardId}`, site);
    setDevices(data.data || []);
    setSelectedDeviceIds([]);
    setBoardDevices(data.data || []);
  }
  async function loadAllBoardsLight() {
    // Just enough for dropdown (multiple pages if needed)
    const data = await apiGet(`/api/switchboard/boards?page=1&pageSize=100&sort=name&dir=asc`, site);
    setAllBoards(data.data || []);
  }

  useEffect(() => { loadBoards(); /* eslint-disable-next-line */ }, [dq, sort, dir, page, pageSize, site]);
  useEffect(() => { if (activeBoardId) { loadDevices(activeBoardId); } }, [activeBoardId, site]);
  useEffect(() => { loadAllBoardsLight(); }, [site]);

  /* ================= HANDLERS ================= */
  // --- Board
  function bf(k, v) {
    if (k.startsWith('meta.')) {
      const key = k.split('.').slice(1).join('.');
      setBoardForm(s => ({ ...s, meta: { ...s.meta, [key]: v } }));
    } else {
      setBoardForm(s => ({ ...s, [k]: v }));
    }
  }
  async function createBoard() {
    const payload = { ...boardForm, id: undefined };
    const sb = await apiPost('/api/switchboard/boards', payload, site);
    setBoardForm({ id: null, name: '', code: '', meta: { building_code: '', floor: '', room: '' }, regime_neutral: '', is_principal: false, modes: {}, quality: {} });
    setBoardOpen(false);
    setPage(1);
    await loadBoards();
    setActiveBoardId(sb.id);
  }
  async function updateBoard() {
    await apiPut(`/api/switchboard/boards/${boardForm.id}`, boardForm, site);
    setBoardForm({ id: null, name: '', code: '', meta: { building_code: '', floor: '', room: '' }, regime_neutral: '', is_principal: false, modes: {}, quality: {} });
    setBoardOpen(false);
    await loadBoards();
  }
  async function duplicateBoard(id) {
    const sb = await apiPost(`/api/switchboard/boards/${id}/duplicate`, {}, site);
    await loadBoards();
    setActiveBoardId(sb.id);
  }
  async function deleteBoard(id) {
    if (!confirm('Delete this switchboard?')) return;
    await apiDelete(`/api/switchboard/boards/${id}`, site);
    if (activeBoardId === id) {
      setActiveBoardId(null);
      setDevices([]);
      setBoardDevices([]);
    }
    await loadBoards();
  }

  // --- Device helpers
  function df(k, v) { setDevForm(s => ({ ...s, [k]: v })); }

  // Keep settings object in sync with split fields for submission
  function buildSettingsFromForm(form) {
    const settings = { ...(form.settings || {}) };
    // Position from device_number
    if (form.device_number !== '' && form.device_number !== null && form.device_number !== undefined) {
      const n = Number(form.device_number);
      if (!Number.isNaN(n)) settings.position = n;
    }
    // Curve + LSIG params only if provided
    if (form.curve_type) settings.curve_type = form.curve_type;
    if (form.L_long_delay !== '') settings.L = Number(form.L_long_delay) || form.L_long_delay;
    if (form.S_short_delay !== '') settings.S = Number(form.S_short_delay) || form.S_short_delay;
    if (form.I_instantaneous !== '') settings.I = Number(form.I_instantaneous) || form.I_instantaneous;
    if (form.G_ground !== '') settings.G = Number(form.G_ground) || form.G_ground;
    return settings;
  }

  async function createDevice() {
    let payload = { ...devForm, id: undefined, switchboard_id: activeBoardId };
    ['in_amps', 'icu_kA', 'ics_kA', 'poles', 'voltage_V', 'device_number'].forEach(n => {
      if (payload[n] !== '' && payload[n] !== null && payload[n] !== undefined) payload[n] = Number(payload[n]);
      if (Number.isNaN(payload[n])) payload[n] = null;
    });
    payload.settings = buildSettingsFromForm(payload);
    await apiPost('/api/switchboard/devices', payload, site);
    resetDeviceForm();
    await loadDevices(activeBoardId);
  }

  async function updateDevice() {
    let payload = { ...devForm };
    ['in_amps', 'icu_kA', 'ics_kA', 'poles', 'voltage_V', 'device_number'].forEach(n => {
      if (payload[n] !== '' && payload[n] !== null && payload[n] !== undefined) payload[n] = Number(payload[n]);
      if (Number.isNaN(payload[n])) payload[n] = null;
    });
    payload.settings = buildSettingsFromForm(payload);
    await apiPut(`/api/switchboard/devices/${devForm.id}`, payload, site);
    resetDeviceForm();
    await loadDevices(activeBoardId);
  }

  function resetDeviceForm() {
    setDevForm({
      id: null,
      device_number: '',
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
      curve_type: '',
      L_long_delay: '',
      S_short_delay: '',
      I_instantaneous: '',
      G_ground: '',
      is_main_incoming: false,
      parent_id: null,
      downstream_switchboard_id: null,
      settings: {},
      photos: [],
      pv_tests: null,
    });
  }

  async function deleteDevice(id) {
    if (!confirm('Delete device?')) return;
    await apiDelete(`/api/switchboard/devices/${id}`, site);
    await loadDevices(activeBoardId);
  }

  async function setMainIncoming(id, val) {
    await apiPut(`/api/switchboard/devices/${id}/set-main`, { is_main_incoming: !!val }, site);
    await loadDevices(activeBoardId);
  }

  async function bulkDelete() {
    if (selectedDeviceIds.length === 0) return;
    if (!confirm(`Delete ${selectedDeviceIds.length} devices?`)) return;
    await apiPost('/api/switchboard/devices/bulk-delete', { ids: selectedDeviceIds }, site);
    await loadDevices(activeBoardId);
  }
  async function bulkDuplicate() {
    if (selectedDeviceIds.length === 0) return;
    await apiPost('/api/switchboard/devices/bulk-duplicate', { ids: selectedDeviceIds }, site);
    await loadDevices(activeBoardId);
  }

  // Quick select (existing)
  useEffect(() => {
    let closed = false;
    async function run() {
      if (!dRefQuery) { setRefOptions([]); return; }
      const r = await apiGet(`/api/switchboard/device-references`, site);
      const all = r.data || [];
      const q = dRefQuery.toLowerCase();
      const filtered = all.filter(o =>
        `${o.manufacturer || ''} ${o.reference || ''}`.toLowerCase().includes(q)
      ).slice(0, 50);
      if (!closed) setRefOptions(filtered);
    }
    run();
    return () => { closed = true; };
  }, [dRefQuery, site]);

  async function applyRefOption(opt) {
    setRefOpen(false);
    setRefQuery(`${opt.manufacturer} ${opt.reference}`);
    await autofillFromAI(`${opt.manufacturer} ${opt.reference}`);
  }

  // AI autofill from text
  async function autofillFromAI(query) {
    try {
      const ai = await apiPost('/api/switchboard/search-device', { query }, site);
      // Main fields
      if (ai.manufacturer) df('manufacturer', ai.manufacturer);
      if (ai.reference) df('reference', ai.reference);
      if (ai.device_type) df('device_type', ai.device_type);
      if (ai.in_amps != null) df('in_amps', ai.in_amps);
      if (ai.icu_kA != null) df('icu_kA', ai.icu_kA);
      if (ai.ics_kA != null) df('ics_kA', ai.ics_kA);
      if (ai.poles != null) df('poles', ai.poles);
      if (ai.voltage_V != null) df('voltage_V', ai.voltage_V);
      if (ai.trip_unit) df('trip_unit', ai.trip_unit);

      // Split settings
      const s = ai.settings || {};
      if (s.curve_type) df('curve_type', s.curve_type);
      if (s.L != null) df('L_long_delay', s.L);
      if (s.S != null) df('S_short_delay', s.S);
      if (s.I != null) df('I_instantaneous', s.I);
      if (s.G != null) df('G_ground', s.G);

      if (typeof ai.is_main_incoming === 'boolean') df('is_main_incoming', ai.is_main_incoming);
    } catch (e) {
      console.warn('Auto-fill failed', e);
    }
  }

  // Global search (guarded if endpoint missing)
  useEffect(() => {
    let closed = false;
    async function run() {
      if (!dGlobalQuery) { setGlobalResults({ boards: [], devices: [] }); return; }
      try {
        const r = await apiGet(`/api/switchboard/search?q=${encodeURIComponent(dGlobalQuery)}`, site);
        if (!closed) setGlobalResults(r || { boards: [], devices: [] });
      } catch {
        if (!closed) setGlobalResults({ boards: [], devices: [] });
      }
    }
    run();
    return () => { closed = true; };
  }, [dGlobalQuery, site]);

  // Photo → AI
  async function handlePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const b64 = await new Promise((resolve, reject) => {
      const rr = new FileReader();
      rr.onload = () => resolve(rr.result.split(',')[1]);
      rr.onerror = reject;
      rr.readAsDataURL(f);
    });
    setPhotoBusy(true);
    try {
      const ai = await apiPost('/api/switchboard/search-photo', { image_base64: b64 }, site);
      if (ai.manufacturer) df('manufacturer', ai.manufacturer);
      if (ai.reference) df('reference', ai.reference);
      if (ai.device_type) df('device_type', ai.device_type);
      if (ai.in_amps != null) df('in_amps', ai.in_amps);
      if (ai.icu_kA != null) df('icu_kA', ai.icu_kA);
      if (ai.ics_kA != null) df('ics_kA', ai.ics_kA);
      if (ai.poles != null) df('poles', ai.poles);
      if (ai.voltage_V != null) df('voltage_V', ai.voltage_V);
      if (ai.trip_unit) df('trip_unit', ai.trip_unit);

      const s = ai.settings || {};
      if (s.curve_type) df('curve_type', s.curve_type);
      if (s.L != null) df('L_long_delay', s.L);
      if (s.S != null) df('S_short_delay', s.S);
      if (s.I != null) df('I_instantaneous', s.I);
      if (s.G != null) df('G_ground', s.G);

      if (typeof ai.is_main_incoming === 'boolean') df('is_main_incoming', ai.is_main_incoming);
      if (ai.match && ai.match.id) {
        if (confirm(`Link to existing device #${ai.match.id} as parent?`)) df('parent_id', ai.match.id);
      }
    } catch {
      alert('Photo recognition failed');
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  // parent selector uses devices of the active board
  const parentOptions = useMemo(() => {
    return (boardDevices || []).slice().sort((a, b) => {
      const ap = Number(a?.settings?.position ?? 1e9);
      const bp = Number(b?.settings?.position ?? 1e9);
      if (ap !== bp) return ap - bp;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [boardDevices]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalBoards / pageSize)), [totalBoards, pageSize]);

  // filtered devices by text
  const filteredDevices = useMemo(() => {
    const q = dDevQuery.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(d => {
      const hay = [
        d?.settings?.position ?? d?.settings?.number ?? '',
        d.name, d.device_type, d.manufacturer, d.reference,
        d.in_amps, d.icu_kA, d.ics_kA, d.poles, d.voltage_V, d.trip_unit
      ].map(x => `${x ?? ''}`.toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [devices, dDevQuery]);

  /* ================= RENDER ================= */
  return (
    <section className="container-narrow py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Switchboards <span className="text-gray-400 text-lg">· {siteLabel}</span></h1>
        <div className="flex gap-2">
          <button className="btn bg-gray-100" onClick={() => setSearchOpen(o => !o)} title="Open global search">🔎 Search</button>
          {activeBoardId && (
            <a className="btn bg-green-600 hover:bg-green-700 text-white"
               href={`/api/switchboard/boards/${activeBoardId}/report`} target="_blank" rel="noreferrer"
               title="Open PDF report">
              📄 PDF
            </a>
          )}
          <button className="btn btn-primary" onClick={() => setBoardOpen(o => !o)}>
            {boardOpen ? 'Close' : 'New switchboard'}
          </button>
        </div>
      </div>

      {/* Board filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input className="input" placeholder="Search boards (name, code, building, floor, room…)" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          <select className="input w-full md:w-56" value={`${sort}:${dir}`} onChange={e => { const [s, d] = e.target.value.split(':'); setSort(s); setDir(d); }}>
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
        {boards.map(b => (
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
                <button className="btn bg-gray-100 text-xs" title="Open devices" onClick={() => setActiveBoardId(b.id)}>📂</button>
                <button className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs" title="Edit board" onClick={() => {
                  setBoardOpen(true);
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
                <button className="btn bg-purple-500 hover:bg-purple-600 text-white text-xs" title="Duplicate" onClick={() => duplicateBoard(b.id)}>📑</button>
                <button className="btn bg-red-500 hover:bg-red-600 text-white text-xs" title="Delete" onClick={() => deleteBoard(b.id)}>🗑</button>
              </div>
            </div>
          </div>
        ))}
        {boards.length === 0 && (
          <div className="col-span-full text-center text-sm text-gray-500 py-6">
            No switchboards found for site <b>{siteLabel}</b>. Try creating one.
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mb-8">
        <div className="text-sm text-gray-600">{totalBoards} boards · Page {page}/{totalPages}</div>
        <div className="flex gap-2">
          <button className="btn bg-gray-100" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
          <button className="btn bg-gray-100" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
        </div>
      </div>

      {/* Board form (toggle) */}
      {boardOpen && (
        <div className="card p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{editingBoard ? 'Edit switchboard' : 'Create switchboard'}</h2>
            <button className="btn bg-gray-100" onClick={() => { setBoardOpen(false); setBoardForm({ id: null, name: '', code: '', meta: { building_code: '', floor: '', room: '' }, regime_neutral: '', is_principal: false, modes: {}, quality: {} }); }}>Close</button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Name<Info text="Short board name (e.g., TGBT B11)" /></label>
              <input className="input mt-1" value={boardForm.name} onChange={e => bf('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Code<Info text="Unique ID (e.g., TGBT-B11-01)" /></label>
              <input className="input mt-1" value={boardForm.code} onChange={e => bf('code', e.target.value)} />
            </div>
            <div>
              <label className="label">Building<Info text="e.g., B11" /></label>
              <input className="input mt-1" value={boardForm.meta.building_code} onChange={e => bf('meta.building_code', e.target.value)} />
            </div>
            <div>
              <label className="label">Floor<Info text="e.g., 1, -1, G" /></label>
              <input className="input mt-1" value={boardForm.meta.floor} onChange={e => bf('meta.floor', e.target.value)} />
            </div>
            <div>
              <label className="label">Room<Info text="e.g., Electrical Room 02" /></label>
              <input className="input mt-1" value={boardForm.meta.room} onChange={e => bf('meta.room', e.target.value)} />
            </div>
            <div>
              <label className="label">Neutral regime<Info text="TT, TN-S, TN-C, IT…" /></label>
              <input className="input mt-1" value={boardForm.regime_neutral} onChange={e => bf('regime_neutral', e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="label">Principal switchboard<Info text="Main incomer (multiple allowed)" /></label>
              <input type="checkbox" className="mt-1" checked={boardForm.is_principal} onChange={e => bf('is_principal', e.target.checked)} />
            </div>
          </div>
          <div className="flex justify-end mt-4 gap-2">
            {!editingBoard && <button className="btn btn-primary" onClick={createBoard}>Create</button>}
            {editingBoard && <button className="btn btn-primary" onClick={updateBoard}>Update</button>}
          </div>
        </div>
      )}

      {/* DEVICES PANEL */}
      {activeBoardId && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Devices of board #{activeBoardId}</h2>
            <div className="flex gap-2">
              <button className="btn bg-red-100 hover:bg-red-200" onClick={bulkDelete} disabled={selectedDeviceIds.length === 0}>🗑 Delete selected</button>
              <button className="btn bg-purple-100 hover:bg-purple-200" onClick={bulkDuplicate} disabled={selectedDeviceIds.length === 0}>📑 Duplicate selected</button>
              <a className="btn bg-green-600 hover:bg-green-700 text-white"
                 href={`/api/switchboard/boards/${activeBoardId}/report`} target="_blank" rel="noreferrer">
                📄 PDF
              </a>
            </div>
          </div>

          {/* Top tools: Quick select + search */}
          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <div className="lg:col-span-2 relative">
              <label className="label">Quick Select Existing<Info text="Type some letters of the brand or reference, then choose to auto-fill" /></label>
              <input
                className="input mt-1"
                placeholder="e.g., Schneider NSX100F…"
                value={refQuery}
                onFocus={() => setRefOpen(true)}
                onChange={e => { setRefQuery(e.target.value); setRefOpen(true); }}
              />
              {refOpen && refOptions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-soft max-h-72 overflow-auto">
                  {refOptions.map((opt, i) => (
                    <button key={`${opt.manufacturer}-${opt.reference}-${i}`}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50"
                            onClick={() => applyRefOption(opt)}>
                      <div className="text-sm font-medium">{opt.manufacturer} <span className="text-gray-500">{opt.reference}</span></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label">Search devices (text)</label>
              <input className="input mt-1" placeholder="Type, brand, ref, In, Icu/Ics…" value={devQuery} onChange={e => setDevQuery(e.target.value)} />
            </div>
          </div>

          {/* DEVICE FORM */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Device #<Info text="Ordering number for PDF and list" /></label>
                  <input className="input mt-1" value={devForm.device_number} onChange={e => df('device_number', e.target.value)} placeholder="1, 2, 3…" />
                </div>
                <div>
                  <label className="label">Name<Info text="Display name (e.g., QF1, Main Incomer…)" /></label>
                  <input className="input mt-1" value={devForm.name} onChange={e => df('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Type<Info text="MCB, MCCB, ACB, Switch, Fuse…" /></label>
                  <input className="input mt-1" value={devForm.device_type} onChange={e => df('device_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">Manufacturer</label>
                  <input className="input mt-1" value={devForm.manufacturer} onChange={e => df('manufacturer', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input
                    className="input mt-1"
                    value={devForm.reference}
                    onChange={async e => {
                      df('reference', e.target.value);
                      if (e.target.value.length >= 4 && devForm.manufacturer) {
                        await autofillFromAI(`${devForm.manufacturer} ${e.target.value}`);
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="label">In (A)</label>
                  <input className="input mt-1" type="number" value={devForm.in_amps} onChange={e => df('in_amps', e.target.value)} />
                </div>
                <div>
                  <label className="label">Icu (kA)</label>
                  <input className="input mt-1" type="number" value={devForm.icu_kA} onChange={e => df('icu_kA', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ics (kA)</label>
                  <input className="input mt-1" type="number" value={devForm.ics_kA} onChange={e => df('ics_kA', e.target.value)} />
                </div>
                <div>
                  <label className="label">Poles</label>
                  <input className="input mt-1" type="number" value={devForm.poles} onChange={e => df('poles', e.target.value)} />
                </div>
                <div>
                  <label className="label">Voltage (V)</label>
                  <input className="input mt-1" type="number" value={devForm.voltage_V} onChange={e => df('voltage_V', e.target.value)} />
                </div>
                <div>
                  <label className="label">Trip unit</label>
                  <input className="input mt-1" value={devForm.trip_unit} onChange={e => df('trip_unit', e.target.value)} />
                </div>

                {/* Split settings (no JSON) */}
                <div>
                  <label className="label">Curve type<Info text="e.g., B / C / D for MCB" /></label>
                  <input className="input mt-1" value={devForm.curve_type} onChange={e => df('curve_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">L (long delay)</label>
                  <input className="input mt-1" value={devForm.L_long_delay} onChange={e => df('L_long_delay', e.target.value)} />
                </div>
                <div>
                  <label className="label">S (short delay)</label>
                  <input className="input mt-1" value={devForm.S_short_delay} onChange={e => df('S_short_delay', e.target.value)} />
                </div>
                <div>
                  <label className="label">I (instantaneous)</label>
                  <input className="input mt-1" value={devForm.I_instantaneous} onChange={e => df('I_instantaneous', e.target.value)} />
                </div>
                <div>
                  <label className="label">G (ground)</label>
                  <input className="input mt-1" value={devForm.G_ground} onChange={e => df('G_ground', e.target.value)} />
                </div>

                <div className="flex items-center gap-2">
                  <label className="label">Main incoming</label>
                  <input type="checkbox" className="mt-1" checked={devForm.is_main_incoming} onChange={e => df('is_main_incoming', e.target.checked)} />
                </div>

                {/* Parent selector */}
                <div>
                  <label className="label">Parent device<Info text="Build the internal hierarchy" /></label>
                  <select className="input mt-1" value={devForm.parent_id || ''} onChange={e => df('parent_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">None</option>
                    {parentOptions.map(d => (
                      <option key={d.id} value={d.id}>
                        #{d?.settings?.position ?? d?.settings?.number ?? '—'} · {d.manufacturer || ''} {d.reference || d.name || d.device_type || `Device #${d.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Downstream board selector */}
                <div>
                  <label className="label">Downstream board<Info text="Link to a downstream switchboard" /></label>
                  <select
                    className="input mt-1"
                    value={devForm.downstream_switchboard_id || ''}
                    onChange={e => df('downstream_switchboard_id', e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">None</option>
                    {allBoards
                      .filter(b => b.id !== activeBoardId)
                      .map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-between items-center mt-4">
                <div className="flex items-center gap-2">
                  <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhoto} hidden />
                  <button className="btn bg-gray-100" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>
                    {photoBusy ? 'Scanning…' : '📷 Photo → Auto-fill'}
                  </button>
                </div>
                <div className="flex gap-2">
                  {!editingDevice && <button className="btn btn-primary" onClick={createDevice}>Add device</button>}
                  {editingDevice && (
                    <>
                      <button className="btn bg-gray-100" onClick={resetDeviceForm}>Cancel</button>
                      <button className="btn btn-primary" onClick={updateDevice}>Update</button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* DEVICES TABLE */}
            <div className="card p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Devices</h3>
                <div className="text-xs text-gray-500">{filteredDevices.length} items</div>
              </div>
              <div className="overflow-auto max-h-[560px]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-3 py-2">Sel</th>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Manufacturer</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">In (A)</th>
                      <th className="px-3 py-2">Icu</th>
                      <th className="px-3 py-2">Ics</th>
                      <th className="px-3 py-2">Poles</th>
                      <th className="px-3 py-2">Voltage</th>
                      <th className="px-3 py-2">Trip</th>
                      <th className="px-3 py-2">Parent</th>
                      <th className="px-3 py-2">Downstream</th>
                      <th className="px-3 py-2">Main</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredDevices
                      .slice()
                      .sort((a, b) => {
                        const ap = Number(a?.settings?.position ?? a?.settings?.number ?? 1e9);
                        const bp = Number(b?.settings?.position ?? b?.settings?.number ?? 1e9);
                        if (ap !== bp) return ap - bp;
                        return new Date(a.created_at) - new Date(b.created_at);
                      })
                      .map(d => (
                        <tr key={d.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedDeviceIds.includes(d.id)}
                              onChange={(e) => {
                                setSelectedDeviceIds(s => e.target.checked ? [...new Set([...s, d.id])] : s.filter(x => x !== d.id));
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">{d?.settings?.position ?? d?.settings?.number ?? '—'}</td>
                          <td className="px-3 py-2 truncate max-w-[140px]">{d.name || '—'}</td>
                          <td className="px-3 py-2">{d.device_type || '—'}</td>
                          <td className="px-3 py-2">{d.manufacturer || '—'}</td>
                          <td className="px-3 py-2 truncate max-w-[140px]">{d.reference || '—'}</td>
                          <td className="px-3 py-2">{d.in_amps ?? '—'}</td>
                          <td className="px-3 py-2">{d.icu_kA ?? '—'}</td>
                          <td className="px-3 py-2">{d.ics_kA ?? '—'}</td>
                          <td className="px-3 py-2">{d.poles ?? '—'}</td>
                          <td className="px-3 py-2">{d.voltage_V ?? '—'}</td>
                          <td className="px-3 py-2">{d.trip_unit ?? '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{d.parent_id ? (d.parent_name || d.parent_reference || `#${d.parent_id}`) : '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{d.downstream_switchboard_id ? `SB ${d.downstream_switchboard_id}` : '—'}</td>
                          <td className="px-3 py-2">{d.is_main_incoming ? '⭐' : '—'}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs"
                                title="Edit"
                                onClick={() => setDevForm({
                                  id: d.id,
                                  device_number: d?.settings?.position ?? d?.settings?.number ?? '',
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
                                  curve_type: d?.settings?.curve_type || '',
                                  L_long_delay: d?.settings?.L ?? '',
                                  S_short_delay: d?.settings?.S ?? '',
                                  I_instantaneous: d?.settings?.I ?? '',
                                  G_ground: d?.settings?.G ?? '',
                                  is_main_incoming: !!d.is_main_incoming,
                                  parent_id: d.parent_id || null,
                                  downstream_switchboard_id: d.downstream_switchboard_id || null,
                                  settings: d.settings || {},
                                  photos: [],
                                  pv_tests: null
                                })}
                              >✏️</button>
                              <button className="btn bg-emerald-500 hover:bg-emerald-600 text-white text-xs" title="Toggle main" onClick={() => setMainIncoming(d.id, !d.is_main_incoming)}>⭐</button>
                              <button className="btn bg-purple-500 hover:bg-purple-600 text-white text-xs" title="Duplicate" onClick={async () => {
                                await apiPost(`/api/switchboard/devices/${d.id}/duplicate`, {}, site);
                                await loadDevices(activeBoardId);
                              }}>📑</button>
                              <button className="btn bg-red-500 hover:bg-red-600 text-white text-xs" title="Delete" onClick={() => deleteDevice(d.id)}>🗑</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {filteredDevices.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-gray-500" colSpan={16}>No devices</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global search drawer (protected if endpoint absent) */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSearchOpen(false)}>
          <div className="absolute top-0 right-0 h-full w-full max-w-xl bg-white shadow-xl p-5 overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Global search</h3>
              <button className="btn bg-gray-100" onClick={() => setSearchOpen(false)}>Close</button>
            </div>
            <input className="input w-full mb-3" placeholder="Search switchboards & devices…" value={globalQuery} onChange={e => setGlobalQuery(e.target.value)} />
            <div className="space-y-6">
              <div>
                <div className="text-sm font-semibold mb-1">Boards</div>
                <div className="divide-y">
                  {globalResults.boards?.map(b => (
                    <button key={`sb-${b.id}`} className="w-full text-left py-2 hover:bg-gray-50" onClick={() => { setActiveBoardId(b.id); setSearchOpen(false); }}>
                      <div className="font-medium">{b.name} <span className="text-gray-500">{b.code}</span></div>
                      <div className="text-xs text-gray-500">{b.meta?.building_code || '—'} · {b.meta?.floor || '—'} · {b.meta?.room || '—'}</div>
                    </button>
                  ))}
                  {(!globalResults.boards || globalResults.boards.length === 0) && <div className="text-xs text-gray-500 py-3">No board</div>}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold mb-1">Devices</div>
                <div className="divide-y">
                  {globalResults.devices?.map(d => (
                    <button key={`dv-${d.id}`} className="w-full text-left py-2 hover:bg-gray-50" onClick={() => {
                      setActiveBoardId(d.switchboard_id);
                      setSearchOpen(false);
                      setTimeout(() => setDevForm({
                        id: d.id,
                        device_number: d?.settings?.position ?? d?.settings?.number ?? '',
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
                        curve_type: d?.settings?.curve_type || '',
                        L_long_delay: d?.settings?.L ?? '',
                        S_short_delay: d?.settings?.S ?? '',
                        I_instantaneous: d?.settings?.I ?? '',
                        G_ground: d?.settings?.G ?? '',
                        is_main_incoming: !!d.is_main_incoming,
                        parent_id: d.parent_id || null,
                        downstream_switchboard_id: d.downstream_switchboard_id || null,
                        settings: d.settings || {},
                        photos: [],
                        pv_tests: null
                      }), 250);
                    }}>
                      <div className="font-medium">{d.manufacturer} {d.reference} <span className="text-gray-500">#{d?.settings?.position ?? d?.settings?.number ?? '—'}</span></div>
                      <div className="text-xs text-gray-500">SB {d.switchboard_id} · {d.device_type || '—'} · In {d.in_amps ?? '—'}A</div>
                    </button>
                  ))}
                  {(!globalResults.devices || globalResults.devices.length === 0) && <div className="text-xs text-gray-500 py-3">No device</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
