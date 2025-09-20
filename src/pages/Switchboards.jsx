// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';

/** Utilities */
const regimes = ['TN-S','TN-C-S','IT','TT'];
const deviceTypes = [
  'Cellule haute tension', 'Sectionneur HT', 'Disjoncteur HT', 'Transformateur',
  'Tableau BT', 'Disjoncteur BT', 'MCCB', 'ACB', 'MCB', 'Fuse', 'Relay'
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
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg border px-2 py-1 text-sm">Close</button>
        </div>
        <div className="p-4 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

const emptySwitchboardForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  is_principal: false,
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

const emptyDeviceForm = {
  device_type: 'Disjoncteur BT',
  manufacturer: '',
  reference: '',
  in_amps: 0,
  icu_kA: 0,
  ics_kA: 0,
  poles: 3,
  voltage_V: 400,
  trip_unit: '',
  settings: {
    ir: 1, tr: 10, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false,
    curve_type: ''  // e.g. 'B', 'C', 'D' or TCC data
  },
  is_main_incoming: false,
  parent_id: null,
  pv_tests: null,
  photos: []
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

  // Chat sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const loadSwitchboards = async () => {
    const params = { ...q, pageSize, site };
    const data = await get('/api/switchboard/boards', params);
    setRows(data?.data || []);
    setTotal(data?.total || 0);
  };

  const loadDevices = async (panelId) => {
    const data = await get('/api/switchboard/devices', { switchboard_id: panelId });
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
      is_principal: !!row.is_principal,
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
      device_type: device.device_type || 'Disjoncteur BT',
      manufacturer: device.manufacturer || '',
      reference: device.reference || '',
      in_amps: device.in_amps || 0,
      icu_kA: device.icu_kA || 0,
      ics_kA: device.ics_kA || 0,
      poles: device.poles || 3,
      voltage_V: device.voltage_V || 400,
      trip_unit: device.trip_unit || '',
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
        curve_type: device.settings?.curve_type || ''
      },
      is_main_incoming: !!device.is_main_incoming,
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
    await put(`/api/switchboard/devices/${id}/set-main`, { is_main_incoming: isMain });
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

  // Chat functions
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    setChatBusy(true);
    try {
      const data = await post('/api/switchboard/search-device', { query: chatInput });
      setChatMessages(prev => [...prev, { role: 'assistant', content: JSON.stringify(data, null, 2) }]);
      // Auto-fill if in device modal and data is structured
      if (openDevice && data.manufacturer) {
        setDeviceForm(prev => ({
          ...prev,
          manufacturer: data.manufacturer || prev.manufacturer,
          reference: data.reference || prev.reference,
          device_type: data.device_type || prev.device_type,
          in_amps: data.in_amps || prev.in_amps,
          icu_kA: data.icu_kA || prev.icu_kA,
          ics_kA: data.ics_kA || prev.ics_kA,
          poles: data.poles || prev.poles,
          voltage_V: data.voltage_V || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, ...data.settings }
        }));
      }
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setChatBusy(false);
      setChatInput('');
    }
  };

  const autoFillFromChat = (messageContent) => {
    try {
      const data = JSON.parse(messageContent);
      if (data.manufacturer) {
        setDeviceForm(prev => ({
          ...prev,
          manufacturer: data.manufacturer || prev.manufacturer,
          reference: data.reference || prev.reference,
          device_type: data.device_type || prev.device_type,
          in_amps: data.in_amps || prev.in_amps,
          icu_kA: data.icu_kA || prev.icu_kA,
          ics_kA: data.ics_kA || prev.ics_kA,
          poles: data.poles || prev.poles,
          voltage_V: data.voltage_V || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, ...data.settings }
        }));
      }
    } catch {}
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="container-narrow py-6 space-y-4 relative">
      {/* Sidebar for chat */}
      <div className={`fixed right-0 top-0 h-full bg-white shadow-lg p-4 overflow-y-auto transition-transform duration-300 ${sidebarOpen ? 'translate-x-0 w-full md:w-96' : 'translate-x-full w-0'}`}>
        <button className="btn mb-4" onClick={() => setSidebarOpen(false)}>Close Sidebar</button>
        <h3 className="text-lg font-semibold mb-2">AI Device Research Chat</h3>
        <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto">
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`p-2 rounded ${msg.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
              <strong>{msg.role}:</strong> {msg.content}
              {msg.role === 'assistant' && openDevice && (
                <button className="text-xs text-green-500 ml-2" onClick={() => autoFillFromChat(msg.content)}>Auto-Fill Form</button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input 
            className="input flex-1" 
            placeholder="Ask about brand/reference..." 
            value={chatInput} 
            onChange={e => setChatInput(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
          />
          <button className="btn btn-primary" disabled={chatBusy || !chatInput} onClick={sendChatMessage}>
            {chatBusy ? '...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Electrical Switchboards</h1>
          <p className="text-sm text-gray-500">Site-scoped to <b>{site || '—'}</b>. Manage location, neutral regime, modes, quality, and protective devices hierarchy.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={()=>setQ(p=>({ ...p, page:1 }))}>Refresh</button>
          <button className="btn btn-primary" onClick={resetSwitchboardModal}>+ Switchboard</button>
          <button className="btn bg-indigo-500 text-white" onClick={() => setSidebarOpen(true)}>Open AI Chat Sidebar</button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 card p-4">
        <input className="input" placeholder="Search name/code" value={q.q} onChange={e=>setQ(p=>({ ...p, q:e.target.value, page:1 }))} />
        <input className="input" placeholder="Building" value={q.building} onChange={e=>setQ(p=>({ ...p, building:e.target.value, page:1 }))} />
        <input className="input" placeholder="Floor" value={q.floor} onChange={e=>setQ(p=>({ ...p, floor:e.target.value, page:1 }))} />
        <input className="input" placeholder="Room" value={q.room} onChange={e=>setQ(p=>({ ...p, room:e.target.value, page:1 }))} />
      </div>

      {/* List */}
      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.id} className="card p-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-3 gap-4">
              <div>
                <h3 className="text-xl font-semibold">{row.name} <code className="text-sm text-gray-500">({row.code})</code> {row.is_principal && <Pill>Principal</Pill>}</h3>
                <div className="text-sm text-gray-500 flex flex-wrap gap-2 mt-1">
                  <span>{row.meta.building_code || '—'} / {row.meta.floor || '—'} / {row.meta.room || '—'}</span>
                  <Pill>{row.regime_neutral || '—'}</Pill>
                </div>
                <div className="text-xs text-gray-400 mt-1 flex flex-col md:flex-row gap-1">
                  Modes: {Object.entries(row.modes || {}).filter(([,v])=>v).map(([k])=>k.replace(/_/g,' ')).join(', ') || 'None'}
                  <br className="md:hidden" />
                  Quality: THD {row.quality.thd || '—'}%, Flicker {row.quality.flicker || '—'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
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
            <div className="flex flex-wrap gap-2 mt-4">
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
            <input className="input mt-1" value={switchboardForm.name} onChange={e=>setSwitchboardForm(f=>({ ...f, name:e.target.value }))} />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input mt-1" value={switchboardForm.code} onChange={e=>setSwitchboardForm(f=>({ ...f, code:e.target.value }))} />
          </div>
          <div>
            <label className="label">Building code</label>
            <input className="input mt-1" value={switchboardForm.meta.building_code} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, building_code:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Floor</label>
            <input className="input mt-1" value={switchboardForm.meta.floor} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, floor:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Room</label>
            <input className="input mt-1" value={switchboardForm.meta.room} onChange={e=>setSwitchboardForm(f=>({ ...f, meta:{...f.meta, room:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Neutral regime</label>
            <select className="input mt-1" value={switchboardForm.regime_neutral} onChange={e=>setSwitchboardForm(f=>({ ...f, regime_neutral:e.target.value }))}>
              {regimes.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={switchboardForm.is_principal} onChange={e=>setSwitchboardForm(f=>({ ...f, is_principal:e.target.checked }))} />
            <label>Principal Switchboard</label>
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
            <input className="input mt-1" type="number" step="0.1" value={switchboardForm.quality.thd} onChange={e=>setSwitchboardForm(f=>({ ...f, quality:{...f.quality, thd:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Flicker</label>
            <input className="input mt-1" type="number" step="0.1" value={switchboardForm.quality.flicker} onChange={e=>setSwitchboardForm(f=>({ ...f, quality:{...f.quality, flicker:e.target.value} }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn bg-gray-500 text-white" onClick={()=>setOpenSwitchboard(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !switchboardForm.name || !switchboardForm.code} onClick={saveSwitchboard}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={()=>setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'Create Device'}>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input mt-1" value={deviceForm.name} onChange={e=>setDeviceForm(f=>({ ...f, name:e.target.value }))} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input mt-1" value={deviceForm.device_type} onChange={e=>setDeviceForm(f=>({ ...f, device_type:e.target.value }))}>
              {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Manufacturer</label>
            <input className="input mt-1" value={deviceForm.manufacturer} onChange={e=>setDeviceForm(f=>({ ...f, manufacturer:e.target.value }))} />
          </div>
          <div>
            <label className="label">Reference</label>
            <input className="input mt-1" value={deviceForm.reference} onChange={e=>setDeviceForm(f=>({ ...f, reference:e.target.value }))} />
          </div>
          <div>
            <label className="label">In (A)</label>
            <input type="number" className="input mt-1" value={deviceForm.in_amps} onChange={e=>setDeviceForm(f=>({ ...f, in_amps:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Icu (kA)</label>
            <input type="number" className="input mt-1" value={deviceForm.icu_kA} onChange={e=>setDeviceForm(f=>({ ...f, icu_kA:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Ics (kA)</label>
            <input type="number" className="input mt-1" value={deviceForm.ics_kA} onChange={e=>setDeviceForm(f=>({ ...f, ics_kA:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Poles</label>
            <input type="number" className="input mt-1" min="1" max="4" value={deviceForm.poles} onChange={e=>setDeviceForm(f=>({ ...f, poles:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Voltage (V)</label>
            <input type="number" className="input mt-1" value={deviceForm.voltage_V} onChange={e=>setDeviceForm(f=>({ ...f, voltage_V:Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Trip Unit</label>
            <input className="input mt-1" value={deviceForm.trip_unit} onChange={e=>setDeviceForm(f=>({ ...f, trip_unit:e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Parent Device</label>
            <select className="input mt-1" value={deviceForm.parent_id || ''} onChange={e=>setDeviceForm(f=>({ ...f, parent_id:e.target.value ? Number(e.target.value) : null }))}>
              <option value="">None (Top Level)</option>
              {(devices[currentPanelId] || []).map(d => <option key={d.id} value={d.id}>{d.name} ({d.device_type})</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input type="checkbox" checked={deviceForm.is_main_incoming} onChange={e=>setDeviceForm(f=>({ ...f, is_main_incoming:e.target.checked }))} />
            <label>Main Incoming</label>
          </div>

          {/* Settings with curve_type */}
          <div className="md:col-span-2 space-y-2">
            <h4 className="font-medium">Protection Settings (LSIG + Curve)</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Ir (Long Delay Pickup, x In)</label>
                <input type="number" step="0.1" className="input mt-1 text-sm" value={deviceForm.settings.ir} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ir:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tr (Long Delay Time, s)</label>
                <input type="number" step="0.1" className="input mt-1 text-sm" value={deviceForm.settings.tr} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tr:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Isd (Short Delay Pickup, x Ir)</label>
                <input type="number" step="0.1" className="input mt-1 text-sm" value={deviceForm.settings.isd} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, isd:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tsd (Short Delay Time, s)</label>
                <input type="number" step="0.01" className="input mt-1 text-sm" value={deviceForm.settings.tsd} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tsd:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Ii (Instantaneous Pickup, x In)</label>
                <input type="number" step="0.1" className="input mt-1 text-sm" value={deviceForm.settings.ii} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ii:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">Ig (Ground Fault Pickup, x In)</label>
                <input type="number" step="0.1" className="input mt-1 text-sm" value={deviceForm.settings.ig} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, ig:Number(e.target.value)} }))} />
              </div>
              <div>
                <label className="label text-xs">tg (Ground Fault Time, s)</label>
                <input type="number" step="0.01" className="input mt-1 text-sm" value={deviceForm.settings.tg} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, tg:Number(e.target.value)} }))} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={deviceForm.settings.zsi} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, zsi:e.target.checked} }))} />
                <label className="text-xs">ZSI (Zone Selective Interlocking)</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={deviceForm.settings.erms} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, erms:e.target.checked} }))} />
                <label className="text-xs">ERMS (Energy Reducing Maintenance Switch)</label>
              </div>
              <div className="md:col-span-2">
                <label className="label text-xs">Curve Type (e.g. B/C/D or TCC description)</label>
                <input className="input mt-1 text-sm" value={deviceForm.settings.curve_type} onChange={e=>setDeviceForm(f=>({ ...f, settings:{...f.settings, curve_type:e.target.value} }))} />
              </div>
            </div>
          </div>

          {/* Files */}
          <div className="md:col-span-2">
            <label className="label">PV Tests (Upload)</label>
            <input type="file" className="input mt-1" onChange={e => setDeviceForm(f => ({ ...f, pv_tests: e.target.files[0] }))} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Photos (Multiple)</label>
            <input type="file" multiple className="input mt-1" onChange={e => setDeviceForm(f => ({ ...f, photos: Array.from(e.target.files) }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={()=>setOpenDevice(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !deviceForm.name || deviceForm.in_amps <= 0} onClick={saveDevice}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>
    </section>
  );
}

// DeviceTree (ajouté is_main_incoming)
function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0 }) {
  return (
    <ul className={`space-y-2 ${level > 0 ? 'ml-6 border-l pl-4' : ''}`}>
      {devices.map(d => (
        <li key={d.id}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-gray-50 p-2 rounded gap-2">
            <div>
              <span className="font-medium">{d.name} ({d.device_type})</span>
              <span className="text-sm text-gray-500 ml-2">In: {d.in_amps}A, Icu: {d.icu_kA}kA, Ics: {d.ics_kA}kA, {d.manufacturer} {d.reference}</span>
              {d.is_main_incoming && <Pill>Main Incoming</Pill>}
            </div>
            <div className="flex flex-wrap gap-1">
              <button className="text-xs text-blue-500" onClick={() => onEdit(d, panelId)}>Edit</button>
              <button className="text-xs text-green-500" onClick={() => onDuplicate(d.id, panelId)}>Duplicate</button>
              <button className="text-xs text-red-500" onClick={() => onDelete(d.id, panelId)}>Delete</button>
              <button className="text-xs text-purple-500" onClick={() => onSetMain(d.id, panelId, !d.is_main_incoming)}>
                {d.is_main_incoming ? 'Unset Main' : 'Set Main'}
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
