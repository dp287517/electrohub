// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';

/** Utilities */
const regimes = ['TN-S','TN-C-S','IT','TT'];
const deviceTypes = [
  'HT Cell', 'HT Disconnector', 'HT Circuit Breaker', 'Transformer',
  'LV Panel', 'LV Circuit Breaker', 'MCCB', 'ACB', 'MCB', 'Fuse', 'Relay'
];

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Pill({ children }) {
  return <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">{children}</span>;
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg border px-2 py-1 text-sm">Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const emptySwitchboardForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

const emptyDeviceForm = {
  name: '',
  type: 'LV Circuit Breaker',
  rating: 0,       // In (A)
  voltage_level: 'LV',  // HT or LV
  icu: 0,          // kA
  ics: 0,          // kA
  settings: {      // LSIG/ZSI/ERMS etc.
    ir: 1,         // Long delay pickup (x In)
    tr: 10,        // Long delay time (s)
    isd: 6,        // Short delay pickup (x Ir)
    tsd: 0.1,      // Short delay time (s)
    ii: 10,        // Instantaneous pickup (x In)
    ig: 0.5,       // Ground fault pickup (x In)
    tg: 0.2,       // Ground fault time (s)
    zsi: false,    // Zone Selective Interlocking
    erms: false,   // Energy Reducing Maintenance Switch
  },
  is_main: false,
  parent_id: null, // For hierarchy
  pv_tests: null,  // Binary for PV files
  photos: []       // Array of URLs or binaries
};

export default function Switchboards() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState({ q:'', building:'', floor:'', room:'', sort:'created_at', dir:'desc', page:1 });
  const [openSwitchboard, setOpenSwitchboard] = useState(false);
  const [editingSwitchboard, setEditingSwitchboard] = useState(null);
  const [switchboardForm, setSwitchboardForm] = useState(emptySwitchboardForm);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 18;

  // Device states
  const [expandedPanels, setExpandedPanels] = useState({});
  const [devices, setDevices] = useState({}); // {panelId: [devices]}
  const [openDevice, setOpenDevice] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);

  // Search sidebar
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadSwitchboards = async () => {
    const params = { ...q, pageSize, site };
    const data = await get('/api/switchboard/boards', params);
    setRows(data?.data || []);
    setTotal(data?.total || 0);
  };

  const loadDevices = async (panelId) => {
    const data = await get(`/api/switchboard/devices`, { switchboard_id: panelId });
    setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
  };

  useEffect(() => { loadSwitchboards(); /* eslint-disable-next-line */ }, [q.page, q.sort, q.dir, q.q, q.building, q.floor, q.room]);

  const toggleExpand = async (panelId) => {
    setExpandedPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
    if (!devices[panelId]) await loadDevices(panelId);
  };

  const resetSwitchboardModal = () => {
    setEditingSwitchboard(null);
    setSwitchboardForm({ ...emptySwitchboardForm, meta: { ...emptySwitchboardForm.meta, site } });
    setOpenSwitchboard(true);
  };

  const onEditSwitchboard = (row) => {
    setEditingSwitchboard(row);
    setSwitchboardForm({
      name: row.name || '',
      code: row.code || '',
      meta: {
        site: row.meta?.site || site,
        building_code: row.meta?.building_code || '',
        floor: row.meta?.floor || '',
        room: row.meta?.room || '',
      },
      regime_neutral: row.regime_neutral || 'TN-S',
      modes: {
        bypass: !!row.modes?.bypass,
        maintenance_mode: !!row.modes?.maintenance_mode,
        bus_coupling: !!row.modes?.bus_coupling,
        genset_backup: !!row.modes?.genset_backup,
        ups_backup: !!row.modes?.ups_backup,
      },
      quality: {
        thd: row.quality?.thd ?? '',
        flicker: row.quality?.flicker ?? ''
      }
    });
    setOpenSwitchboard(true);
  };

  const saveSwitchboard = async () => {
    setBusy(true);
    try {
      if (editingSwitchboard) {
        await put(`/api/switchboard/boards/${editingSwitchboard.id}`, switchboardForm);
      } else {
        await post('/api/switchboard/boards', switchboardForm);
      }
      setOpenSwitchboard(false);
      await loadSwitchboards();
    } finally { setBusy(false); }
  };

  const duplicateSwitchboard = async (id) => {
    await post(`/api/switchboard/boards/${id}/duplicate`);
    await loadSwitchboards();
  };

  const removeSwitchboard = async (id) => {
    if (!confirm('Delete this switchboard and all its devices?')) return;
    await del(`/api/switchboard/boards/${id}`);
    await loadSwitchboards();
  };

  // Device functions
  const resetDeviceModal = (panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(null);
    setDeviceForm(emptyDeviceForm);
    setOpenDevice(true);
  };

  const onEditDevice = (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
    setDeviceForm({
      name: device.name || '',
      type: device.type || 'LV Circuit Breaker',
      rating: device.rating || 0,
      voltage_level: device.voltage_level || 'LV',
      icu: device.icu || 0,
      ics: device.ics || 0,
      settings: {
        ir: device.settings?.ir || 1,
        tr: device.settings?.tr || 10,
        isd: device.settings?.isd || 6,
        tsd: device.settings?.tsd || 0.1,
        ii: device.settings?.ii || 10,
        ig: device.settings?.ig || 0.5,
        tg: device.settings?.tg || 0.2,
        zsi: !!device.settings?.zsi,
        erms: !!device.settings?.erms,
      },
      is_main: !!device.is_main,
      parent_id: device.parent_id || null,
      pv_tests: device.pv_tests || null,
      photos: device.photos || []
    });
    setOpenDevice(true);
  };

  const saveDevice = async () => {
    setBusy(true);
    try {
      const payload = { ...deviceForm, switchboard_id: currentPanelId };
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}`, payload);
      } else {
        await post('/api/switchboard/devices', payload);
      }
      setOpenDevice(false);
      await loadDevices(currentPanelId);
    } finally { setBusy(false); }
  };

  const duplicateDevice = async (id, panelId) => {
    await post(`/api/switchboard/devices/${id}/duplicate`);
    await loadDevices(panelId);
  };

  const removeDevice = async (id, panelId) => {
    if (!confirm('Delete this device?')) return;
    await del(`/api/switchboard/devices/${id}`);
    await loadDevices(panelId);
  };

  const setMainDevice = async (id, panelId, isMain) => {
    await put(`/api/switchboard/devices/${id}/set-main`, { is_main: isMain });
    await loadDevices(panelId);
  };

  // Build tree from flat list (recursive)
  const buildTree = (devicesList, parentId = null) => {
    return devicesList
      .filter(d => d.parent_id === parentId)
      .map(d => ({
        ...d,
        children: buildTree(devicesList, d.id)
      }));
  };

  // Search function
  const performSearch = async () => {
    setSearchBusy(true);
    try {
      const data = await post('/api/switchboard/search-device', { query: searchQuery });
      setSearchResults(data.results || []);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearchBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="container-narrow py-6 space-y-4 relative">
      {/* Sidebar for search */}
      <div className={`fixed right-0 top-0 h-full bg-white shadow-lg p-4 overflow-y-auto transition-transform duration-300 ${sidebarOpen ? 'translate-x-0 w-80' : 'translate-x-full w-0'}`}>
        <button className="btn mb-4" onClick={() => setSidebarOpen(false)}>Close Sidebar</button>
        <h3 className="text-lg font-semibold mb-2">Device Reference Search</h3>
        <input 
          className="input mb-2" 
          placeholder="e.g., MCCB 630A Icu 50kA LSIG" 
          value={searchQuery} 
          onChange={e => setSearchQuery(e.target.value)} 
        />
        <button className="btn btn-primary w-full mb-4" disabled={searchBusy || !searchQuery} onClick={performSearch}>
          {searchBusy ? 'Searching...' : 'Search'}
        </button>
        <div className="space-y-4">
          {searchResults.map((res, idx) => (
            <div key={idx} className="border p-3 rounded">
              <h4 className="font-medium">{res.title}</h4>
              <p className="text-sm text-gray-600">{res.snippet}</p>
              <a href={res.link} target="_blank" rel="noreferrer" className="text-blue-500 text-xs">View Source</a>
            </div>
          ))}
          {searchResults.length === 0 && <p className="text-gray-500">No results</p>}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Electrical Switchboards</h1>
          <p className="text-sm text-gray-500">Site-scoped to <b>{site || '—'}</b>. Manage location, neutral regime, modes, quality, and protective devices hierarchy.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={()=>setQ(p=>({ ...p, page:1 }))}>Refresh</button>
          <button className="btn btn-primary" onClick={resetSwitchboardModal}>+ Switchboard</button>
          <button className="btn bg-indigo-500 text-white" onClick={() => setSidebarOpen(true)}>Open Search Sidebar</button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid md:grid-cols-5 gap-3 card p-4">
        <input className="input" placeholder="Search name/code" value={q.q} onChange={e=>setQ(p=>({ ...p, q:e.target.value, page:1 }))} />
        <input className="input" placeholder="Building" value={q.building} onChange={e=>setQ(p=>({ ...p, building:e.target.value, page:1 }))} />
        <input className="input" placeholder="Floor" value={q.floor} onChange={e=>setQ(p=>({ ...p, floor:e.target.value, page:1 }))} />
        <input className="input" placeholder="Room" value={q.room} onChange={e=>setQ(p=>({ ...p, room:e.target.value, page:1 }))} />
      </div>

      {/* List */}
      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.id} className="card p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-xl font-semibold">{row.name} <code className="text-sm text-gray-500">({row.code})</code></h3>
                <div className="text-sm text-gray-500 flex gap-2 mt-1">
                  <span>{row.meta.building_code || '—'} / {row.meta.floor || '—'} / {row.meta.room || '—'}</span>
                  <Pill>{row.regime_neutral || '—'}</Pill>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Modes: {Object.entries(row.modes || {}).filter(([,v])=>v).map(([k])=>k.replace(/_/g,' ')).join(', ') || 'None'}
                  <br />
                  Quality: THD {row.quality.thd || '—'}%, Flicker {row.quality.flicker || '—'}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                <button className="btn bg-blue-500 text-white text-xs px-2 py-1 rounded" onClick={()=>onEditSwitchboard(row)}>Edit</button>
                <button className="btn bg-green-500 text-white text-xs px-2 py-1 rounded" onClick={()=>duplicateSwitchboard(row.id)}>Duplicate</button>
                <button className="btn bg-red-500 text-white text-xs px-2 py-1 rounded" onClick={()=>removeSwitchboard(row.id)}>Delete</button>
                <button className="btn bg-indigo-500 text-white text-xs px-2 py-1 rounded" onClick={()=>resetDeviceModal(row.id)}>+ Device</button>
                <button className="btn bg-gray-500 text-white text-xs px-2 py-1 rounded" onClick={()=>toggleExpand(row.id)}>
                  {expandedPanels[row.id] ? 'Hide Devices' : 'Show Devices'}
                </button>
              </div>
            </div>
            {expandedPanels[row.id] && (
              <div className="mt-4">
                <h4 className="text-lg font-medium mb-2">Protective Devices Hierarchy</h4>
                <div className="overflow-x-auto">
                  <DeviceTree 
                    devices={buildTree(devices[row.id] || [])} 
                    panelId={row.id} 
                    onEdit={onEditDevice} 
                    onDuplicate={duplicateDevice} 
                    onDelete={removeDevice} 
                    onSetMain={setMainDevice} 
                  />
                </div>
              </div>
            )}
            <div className="flex gap-2 mt-4 flex-wrap">
              <a href={`/app/fault-level?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Fault Level</a>
              <a href={`/app/arc-flash?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Arc-Flash</a>
              <a href={`/app/selectivity?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Selectivity</a>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-sm text-gray-500">Total: {total}</div>
        <div className="flex items-center gap-2">
          <button className="btn" disabled={q.page<=1} onClick={()=>setQ(p=>({ ...p, page:p.page-1 }))}>Prev</button>
          <span className="text-sm">Page {q.page} / {totalPages}</span>
          <button className="btn" disabled={q.page>=totalPages} onClick={()=>setQ(p=>({ ...p, page:p.page+1 }))}>Next</button>
        </div>
      </div>

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={()=>setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit switchboard' : 'Create switchboard'}>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={switchboardForm.name} onChange={e=>setSwitchboardForm(f=>({ ...f, name:e.target.value }))} />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" value={switchboardForm.code} onChange={e=>setSwitchboardForm(f=>({ ...f, code:e.target.value }))} placeholder="e.g., LVB-A-01" />
          </div>

          <div>
            <label className="label">Building</label>
            <input className="input" value={switchboardForm.meta.building_code} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, building_code:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Floor</label>
            <input className="input" value={switchboardForm.meta.floor} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, floor:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Room</label>
            <input className="input" value={switchboardForm.meta.room} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, room:e.target.value} }))} />
          </div>

          <div>
            <label className="label">Neutral regime</label>
            <select className="input" value={switchboardForm.regime_neutral} onChange={e=>setSwitchboardForm(f=>({ ...f, regime_neutral:e.target.value }))}>
              {regimes.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={switchboardForm.modes.bypass} onChange={e=>setSwitchboardForm(f=>({ ...f, modes:{...f.modes, bypass:e.target.checked} }))} /> Bypass
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={switchboardForm.modes.maintenance_mode} onChange={e=>setSwitchboardForm(f=>({ ...f, modes:{...f.modes, maintenance_mode:e.target.checked} }))} /> Maintenance mode
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={switchboardForm.modes.bus_coupling} onChange={e=>setSwitchboardForm(f=>({ ...f, modes:{...f.modes, bus_coupling:e.target.checked} }))} /> Bus coupling
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={switchboardForm.modes.genset_backup} onChange={e=>setSwitchboardForm(f=>({ ...f, modes:{...f.modes, genset_backup:e.target.checked} }))} /> GEN backup
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={switchboardForm.modes.ups_backup} onChange={e=>setSwitchboardForm(f=>({ ...f, modes:{...f.modes, ups_backup:e.target.checked} }))} /> UPS backup
            </label>
          </div>

          <div>
            <label className="label">THD (%)</label>
            <input className="input" type="number" step="0.1" value={switchboardForm.quality.thd} onChange={e=>setSwitchboardForm(f=>({ ...f, quality:{...f.quality, thd:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Flicker</label>
            <input className="input" type="number" step="0.1" value={switchboardForm.quality.flicker} onChange={e=>setSwitchboardForm(f=>({ ...f, quality:{...f.quality, flicker:e.target.value} }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={()=>setOpenSwitchboard(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !switchboardForm.name || !switchboardForm.code} onClick={saveSwitchboard}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={()=>setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'Create Device'}>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={deviceForm.name} onChange={e=>setDeviceForm(f=>({ ...f, name:e.target.value }))} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={deviceForm.type} onChange={e=>setDeviceForm(f=>({ ...f, type:e.target.value }))}>
              {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Rating (In, A)</label>
            <input type="number" className="input" value={deviceForm.rating} onChange={e=>setDeviceForm(f=>({ ...f, rating:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Voltage Level</label>
            <select className="input" value={deviceForm.voltage_level} onChange={e=>setDeviceForm(f=>({ ...f, voltage_level:e.target.value }))}>
              <option>LV</option>
              <option>HT</option>
            </select>
          </div>
          <div>
            <label className="label">Icu (kA)</label>
            <input type="number" className="input" value={deviceForm.icu} onChange={e=>setDeviceForm(f=>({ ...f, icu:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Ics (kA)</label>
            <input type="number" className="input" value={deviceForm.ics} onChange={e=>setDeviceForm(f=>({ ...f, ics:Number(e.target.value) }))} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Parent Device (for hierarchy)</label>
            <select className="input" value={deviceForm.parent_id || ''} onChange={e=>setDeviceForm(f=>({ ...f, parent_id:e.target.value ? Number(e.target.value) : null }))}>
              <option value="">None (Top Level)</option>
              {(devices[currentPanelId] || []).map(d => <option key={d.id} value={d.id}>{d.name} ({d.type})</option>)}
            </select>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={deviceForm.is_main} onChange={e=>setDeviceForm(f=>({ ...f, is_main:e.target.checked }))} />
            <label>Main Incoming Device</label>
          </div>

          {/* Settings */}
          <div className="md:col-span-2 space-y-2">
            <h4 className="font-medium">Protection Settings (LSIG)</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Ir (Long Delay Pickup, x In)</label>
                <input type="number" step="0.1" className="input text-sm" value={deviceForm.settings.ir} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ir:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tr (Long Delay Time, s)</label>
                <input type="number" step="0.1" className="input text-sm" value={deviceForm.settings.tr} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tr:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Isd (Short Delay Pickup, x Ir)</label>
                <input type="number" step="0.1" className="input text-sm" value={deviceForm.settings.isd} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, isd:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tsd (Short Delay Time, s)</label>
                <input type="number" step="0.01" className="input text-sm" value={deviceForm.settings.tsd} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tsd:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Ii (Instantaneous Pickup, x In)</label>
                <input type="number" step="0.1" className="input text-sm" value={deviceForm.settings.ii} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ii:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Ig (Ground Fault Pickup, x In)</label>
                <input type="number" step="0.1" className="input text-sm" value={deviceForm.settings.ig} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ig:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tg (Ground Fault Time, s)</label>
                <input type="number" step="0.01" className="input text-sm" value={deviceForm.settings.tg} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tg:Number(e.target.value)} }))} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={deviceForm.settings.zsi} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, zsi:e.target.checked} }))} />
                <label className="text-xs">ZSI (Zone Selective Interlocking)</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={deviceForm.settings.erms} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, erms:e.target.checked} }))} />
                <label className="text-xs">ERMS (Energy Reducing Maintenance Switch)</label>
              </div>
            </div>
          </div>

          {/* Files */}
          <div className="md:col-span-2">
            <label className="label">PV Tests (Upload)</label>
            <input type="file" className="input" onChange={e => setDeviceForm(f => ({ ...f, pv_tests: e.target.files[0] }))} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Photos (Multiple Upload)</label>
            <input type="file" multiple className="input" onChange={e => setDeviceForm(f => ({ ...f, photos: Array.from(e.target.files) }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={()=>setOpenDevice(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !deviceForm.name || deviceForm.rating <= 0} onClick={saveDevice}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>
    </section>
  );
}

// Component for recursive device tree
function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0 }) {
  return (
    <ul className={`space-y-2 ${level > 0 ? 'ml-6 border-l pl-4' : ''}`}>
      {devices.map(d => (
        <li key={d.id}>
          <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
            <div>
              <span className="font-medium">{d.name} ({d.type})</span>
              <span className="text-sm text-gray-500 ml-2">In: {d.rating}A, Icu: {d.icu}kA, Ics: {d.ics}kA</span>
              {d.is_main && <Pill>Main</Pill>}
            </div>
            <div className="flex gap-1">
              <button className="text-xs text-blue-500" onClick={() => onEdit(d, panelId)}>Edit</button>
              <button className="text-xs text-green-500" onClick={() => onDuplicate(d.id, panelId)}>Duplicate</button>
              <button className="text-xs text-red-500" onClick={() => onDelete(d.id, panelId)}>Delete</button>
              <button className="text-xs text-purple-500" onClick={() => onSetMain(d.id, panelId, !d.is_main)}>
                {d.is_main ? 'Unset Main' : 'Set Main'}
              </button>
            </div>
          </div>
          {d.children?.length > 0 && <DeviceTree devices={d.children} panelId={panelId} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onSetMain={onSetMain} level={level + 1} />}
        </li>
      ))}
      {devices.length === 0 && <li className="text-gray-500 text-sm">No devices</li>}
    </ul>
  );
}
