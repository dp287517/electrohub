// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';
import { ChevronDown, ChevronRight, Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle } from 'lucide-react'; // Assuming lucide-react for icons

/** Utilities */
const regimes = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const deviceTypes = [
  'High Voltage Cell', 'High Voltage Disconnect Switch', 'High Voltage Circuit Breaker', 'Transformer',
  'Low Voltage Switchboard', 'Low Voltage Circuit Breaker', 'MCCB', 'ACB', 'MCB', 'Fuse', 'Relay'
];

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Pill({ children, color = 'blue' }) {
  const colors = { blue: 'bg-blue-100 text-blue-800', green: 'bg-green-100 text-green-800', red: 'bg-red-100 text-red-800' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${colors[color]}`}>{children}</span>;
}

function Tooltip({ children, content }) {
  return (
    <div className="relative inline-block">
      {children}
      <div className="absolute z-10 hidden group-hover:block bg-gray-800 text-white text-xs rounded py-1 px-2 bottom-full left-1/2 transform -translate-x-1/2 mb-2">
        {content}
      </div>
    </div>
  );
}

function Popover({ trigger, content }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}>{trigger}</button>
      {open && (
        <div className="absolute z-10 bg-white border rounded shadow-lg p-4 w-64">
          {content}
          <button className="text-xs text-gray-500 mt-2" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-gray-50 gap-2">
          <button onClick={onClose} className="btn bg-gray-200 hover:bg-gray-300">Cancel</button>
        </div>
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
  name: '',
  device_type: 'Low Voltage Circuit Breaker',
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
    curve_type: ''
  },
  is_main_incoming: false,
  parent_id: null,
  downstream_switchboard_id: null,
  pv_tests: null,
  photos: []
};

export default function Switchboards() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [allSwitchboards, setAllSwitchboards] = useState([]);
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1 });
  const [openSwitchboard, setOpenSwitchboard] = useState(false);
  const [editingSwitchboard, setEditingSwitchboard] = useState(null);
  const [switchboardForm, setSwitchboardForm] = useState(emptySwitchboardForm);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 18;

  // Device states
  const [expandedPanels, setExpandedPanels] = useState({});
  const [devices, setDevices] = useState({});
  const [openDevice, setOpenDevice] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);
  const [deviceReferences, setDeviceReferences] = useState([]);
  const [deviceSearchBusy, setDeviceSearchBusy] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [parentSuggestions, setParentSuggestions] = useState([]);
  const [downstreamSuggestions, setDownstreamSuggestions] = useState([]);
  const [referenceSuggestions, setReferenceSuggestions] = useState([]);

  // Chat sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // AI Tips state
  const [aiTip, setAiTip] = useState('');
  const [aiTipLoading, setAiTipLoading] = useState(false);

  const loadSwitchboards = async () => {
    const params = { ...q, pageSize, site };
    const data = await get('/api/switchboard/boards', params);
    setRows(data?.data || []);
    setTotal(data?.total || 0);
  };

  const loadAllSwitchboards = async () => {
    const data = await get('/api/switchboard/boards', { site, pageSize: 1000 });
    setAllSwitchboards(data?.data || []);
  };

  const loadDevices = async (panelId) => {
    const data = await get('/api/switchboard/devices', { switchboard_id: panelId });
    setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
  };

  const loadDeviceReferences = async () => {
    const data = await get('/api/switchboard/device-references');
    setDeviceReferences(data.data || []);
  };

  useEffect(() => {
    loadSwitchboards();
    loadAllSwitchboards();
    loadDeviceReferences();
  }, [q.page, q.sort, q.dir, q.q, q.building, q.floor, q.room]);

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
    setPhotoFile(null);
    setOpenDevice(true);
  };

  const onEditDevice = (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
    setDeviceForm({
      name: device.name || '',
      device_type: device.device_type || 'Low Voltage Circuit Breaker',
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
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      pv_tests: null,
      photos: []
    });
    setPhotoFile(null);
    setOpenDevice(true);
  };

  const safeUploadStrip = (form) => {
    const { pv_tests, photos, ...rest } = form;
    return { ...rest, pv_tests: null, photos: [] };
  };

  const saveDevice = async () => {
    setBusy(true);
    try {
      const payload = { ...safeUploadStrip(deviceForm), switchboard_id: currentPanelId };
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}`, payload);
      } else {
        await post('/api/switchboard/devices', payload);
      }
      setOpenDevice(false);
      await loadDevices(currentPanelId);
      await loadDeviceReferences();
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
    // Trigger AI tip
    getAiTip(`User set device ${id} as main incoming: ${isMain}. Provide advice on next steps like adding downstream or linking boards.`);
  };

  const searchDeviceReference = async () => {
    setDeviceSearchBusy(true);
    try {
      const data = await post('/api/switchboard/search-device', { query: `${deviceForm.manufacturer} ${deviceForm.reference}` });
      fillDeviceForm(data);
    } catch (e) {
      console.error('Device search failed:', e);
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  const analyzePhoto = async () => {
    if (!photoFile) return;
    setDeviceSearchBusy(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      const data = await post('/api/switchboard/analyze-photo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      fillDeviceForm(data);
      if (data.existing_id) {
        alert('Matched existing device! Auto-linking.');
      } else if (data.created) {
        alert('New device created from photo analysis!');
      }
    } catch (e) {
      console.error('Photo analysis failed:', e);
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  const fillDeviceForm = (data) => {
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
  };

  // Autocomplete searches
  const searchParents = async (query) => {
    const data = await get('/api/switchboard/search-parents', { query, switchboard_id: currentPanelId });
    setParentSuggestions(data.suggestions || []);
  };

  const searchDownstreams = async (query) => {
    const data = await get('/api/switchboard/search-downstreams', { query });
    setDownstreamSuggestions(data.suggestions || []);
  };

  const searchReferences = async (query) => {
    const data = await get('/api/switchboard/search-references', { query });
    setReferenceSuggestions(data.suggestions || []);
    if (data.auto_fill) fillDeviceForm(data.auto_fill);
  };

  const selectReference = (ref) => {
    setDeviceForm(prev => ({ ...prev, manufacturer: ref.manufacturer, reference: ref.reference }));
    searchDeviceReference(); // Auto-fill full details
  };

  // Chat functions
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    setChatBusy(true);
    try {
      const data = await post('/api/switchboard/search-device', { query: chatInput });
      setChatMessages(prev => [...prev, { role: 'assistant', content: JSON.stringify(data, null, 2) }]);
      if (openDevice && data.manufacturer) fillDeviceForm(data);
    } catch (e) {
      console.error('Chat failed:', e);
    } finally {
      setChatBusy(false);
      setChatInput('');
    }
  };

  // AI Tip function
  const getAiTip = async (query) => {
    setAiTipLoading(true);
    try {
      const data = await post('/api/switchboard/ai-tip', { query });
      setAiTip(data.tip || 'No tip available.');
    } catch (e) {
      console.error('AI tip failed:', e);
    } finally {
      setAiTipLoading(false);
    }
  };

  // Build tree
  const buildTree = (devicesList, parentId = null) => {
    return devicesList
      .filter(d => d.parent_id === parentId)
      .map(d => ({
        ...d,
        children: buildTree(devicesList, d.id)
      }));
  };

  return (
    <section className="container py-8">
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">Switchboards <Info size={20} className="text-blue-500" /></h1>

      {/* Filters and Add */}
      <div className="card p-4 mb-6 flex flex-wrap gap-4 items-center">
        <input className="input flex-1" placeholder="Search by name or code" value={q.q} onChange={e => setQ({ ...q, q: e.target.value, page: 1 })} />
        <input className="input" placeholder="Building" value={q.building} onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} />
        <input className="input" placeholder="Floor" value={q.floor} onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} />
        <input className="input" placeholder="Room" value={q.room} onChange={e => setQ({ ...q, room: e.target.value, page: 1 })} />
        <button className="btn btn-primary flex items-center gap-2" onClick={resetSwitchboardModal}><Plus size={16} /> Add Switchboard</button>
        <button className="btn bg-indigo-500 text-white flex items-center gap-2" onClick={() => setSidebarOpen(true)}><Search size={16} /> AI Assistant</button>
      </div>

      {/* Switchboards List */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rows.map(row => (
          <div key={row.id} className="card p-4 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-lg">{row.name} ({row.code})</h3>
              <div className="flex gap-2">
                <button onClick={() => onEditSwitchboard(row)} title="Edit"><Edit size={16} className="text-blue-500 hover:text-blue-700" /></button>
                <button onClick={() => duplicateSwitchboard(row.id)} title="Duplicate"><Copy size={16} className="text-green-500 hover:text-green-700" /></button>
                <button onClick={() => removeSwitchboard(row.id)} title="Delete"><Trash size={16} className="text-red-500 hover:text-red-700" /></button>
                <a href={`/api/switchboard/boards/${row.id}/report`} target="_blank" rel="noreferrer" title="Download PDF"><Download size={16} className="text-purple-500 hover:text-purple-700" /></a>
              </div>
            </div>
            <p className="text-sm text-gray-600">Building: {row.meta.building_code || '—'}, Floor: {row.meta.floor || '—'}, Room: {row.meta.room || '—'}</p>
            <p className="text-sm">Regime: {row.regime_neutral}, Principal: {row.is_principal ? 'Yes' : 'No'}</p>
            <button className="mt-2 flex items-center gap-1 text-blue-600 hover:underline" onClick={() => toggleExpand(row.id)}>
              {expandedPanels[row.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Devices
            </button>
            {expandedPanels[row.id] && (
              <div className="mt-4">
                <button className="btn btn-sm btn-primary mb-2" onClick={() => resetDeviceModal(row.id)}>Add Device</button>
                <DeviceTree 
                  devices={buildTree(devices[row.id] || [])} 
                  panelId={row.id} 
                  onEdit={onEditDevice} 
                  onDuplicate={duplicateDevice} 
                  onDelete={removeDevice} 
                  onSetMain={setMainDevice} 
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-center mt-6 gap-2">
        <button disabled={q.page <= 1} onClick={() => setQ({ ...q, page: q.page - 1 })} className="btn bg-gray-200">Prev</button>
        <span>Page {q.page}</span>
        <button disabled={total <= q.page * pageSize} onClick={() => setQ({ ...q, page: q.page + 1 })} className="btn bg-gray-200">Next</button>
      </div>

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit Switchboard' : 'Add Switchboard'}>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label flex items-center gap-1">Name <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Unique name for the switchboard, e.g. 'Main Distribution Panel'"><input className="input mt-1" value={switchboardForm.name} onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Distribution Panel" /></Tooltip>
          </div>
          <div>
            <label className="label flex items-center gap-1">Code <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Short code identifier, e.g. 'MDB-01'"><input className="input mt-1" value={switchboardForm.code} onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. MDB-01" /></Tooltip>
          </div>
          {/* More fields with tooltips and placeholders */}
          {/* ... (add similar for all fields) */}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={saveSwitchboard}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'Add Device'}>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label flex items-center gap-1">Name <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Descriptive name for the device, e.g. 'Incoming Breaker'"><input className="input mt-1" value={deviceForm.name} onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Incoming Breaker" /></Tooltip>
          </div>
          <div>
            <label className="label flex items-center gap-1">Type <HelpCircle size={14} className="text-gray-400" /></label>
            <select className="input mt-1" value={deviceForm.device_type} onChange={e => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}>
              {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1">Manufacturer <HelpCircle size={14} className="text-gray-400" /></label>
            <input className="input mt-1" value={deviceForm.manufacturer} onChange={e => setDeviceForm(f => ({ ...f, manufacturer: e.target.value }))} placeholder="e.g. Schneider" />
          </div>
          <div className="relative">
            <label className="label flex items-center gap-1">Reference <HelpCircle size={14} className="text-gray-400" /></label>
            <input className="input mt-1" value={deviceForm.reference} onChange={e => {
              setDeviceForm(f => ({ ...f, reference: e.target.value }));
              searchReferences(e.target.value);
            }} placeholder="e.g. NSX100" />
            {referenceSuggestions.length > 0 && (
              <ul className="absolute z-10 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                {referenceSuggestions.map((s, idx) => (
                  <li key={idx} className="px-4 py-2 hover:bg-gray-100 cursor-pointer" onClick={() => selectReference(s)}>{s.manufacturer} - {s.reference}</li>
                ))}
              </ul>
            )}
            <button className="absolute right-2 top-8 btn bg-indigo-500 text-white text-xs px-2 py-1 rounded" disabled={deviceSearchBusy || !deviceForm.reference} onClick={searchDeviceReference}>
              {deviceSearchBusy ? 'Searching...' : 'Search & Fill'}
            </button>
          </div>
          {/* Photo Analysis */}
          <div className="md:col-span-2">
            <label className="label flex items-center gap-1">Upload Photo for Analysis <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Upload a photo of the device; AI will analyze and auto-fill or create if not existing.">
              <input type="file" accept="image/*" className="input mt-1" onChange={e => setPhotoFile(e.target.files[0])} />
            </Tooltip>
            <button className="btn bg-purple-500 text-white mt-2" disabled={deviceSearchBusy || !photoFile} onClick={analyzePhoto}>
              {deviceSearchBusy ? 'Analyzing...' : 'Analyze Photo & Fill'}
            </button>
          </div>
          {/* Parent and Downstream with autocomplete */}
          <div className="md:col-span-2">
            <label className="label flex items-center gap-1">Parent Device <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Search for parent device by name or code; AI suggests matches.">
              <input className="input mt-1" placeholder="Search parent..." onChange={e => searchParents(e.target.value)} />
            </Tooltip>
            {parentSuggestions.length > 0 && (
              <ul className="absolute z-10 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                {parentSuggestions.map(s => (
                  <li key={s.id} className="px-4 py-2 hover:bg-gray-100 cursor-pointer" onClick={() => setDeviceForm(f => ({ ...f, parent_id: s.id }))}>{s.name} ({s.device_type})</li>
                ))}
              </ul>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="label flex items-center gap-1">Downstream Switchboard <HelpCircle size={14} className="text-gray-400" /></label>
            <Tooltip content="Search for downstream switchboard; links hierarchies.">
              <input className="input mt-1" placeholder="Search downstream..." onChange={e => searchDownstreams(e.target.value)} />
            </Tooltip>
            {downstreamSuggestions.length > 0 && (
              <ul className="absolute z-10 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                {downstreamSuggestions.map(s => (
                  <li key={s.id} className="px-4 py-2 hover:bg-gray-100 cursor-pointer" onClick={() => setDeviceForm(f => ({ ...f, downstream_switchboard_id: s.id }))}>{s.name} ({s.code})</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <Popover trigger={<input type="checkbox" checked={deviceForm.is_main_incoming} onChange={e => {
              setDeviceForm(f => ({ ...f, is_main_incoming: e.target.checked }));
              getAiTip(`User selected main incoming: ${e.target.checked}. Provide advice.`);
            }} />} content={aiTipLoading ? 'Loading tip...' : aiTip} />
            <label>Main Incoming</label>
          </div>
          {/* Other fields with tooltips */}
          {/* ... */}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-primary" disabled={busy || !deviceForm.name || deviceForm.in_amps <= 0} onClick={saveDevice}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </Modal>

      {/* AI Sidebar */}
      <div className={`fixed right-0 top-0 h-full w-80 bg-white shadow-xl transform transition-transform ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b flex justify-between">
          <h3 className="font-semibold">AI Assistant</h3>
          <button onClick={() => setSidebarOpen(false)}>Close</button>
        </div>
        <div className="p-4 overflow-y-auto h-[calc(100%-8rem)]">
          {chatMessages.map((m, idx) => (
            <div key={idx} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span className={`inline-block p-2 rounded ${m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>{m.content}</span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t">
          <input className="input mb-2" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask about devices..." />
          <button className="btn btn-primary w-full" disabled={chatBusy} onClick={sendChatMessage}>{chatBusy ? 'Sending...' : 'Send'}</button>
        </div>
      </div>
    </section>
  );
}

// DeviceTree
function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0 }) {
  return (
    <ul className={`space-y-2 ${level > 0 ? 'ml-6 border-l pl-4' : ''}`}>
      {devices.map(d => (
        <li key={d.id}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-gray-50 p-3 rounded-lg gap-2 hover:bg-gray-100 transition-colors">
            <div className="flex items-center gap-2">
              <span className="font-medium">{d.name || `${d.manufacturer || '—'} ${d.reference || ''}`.trim()} ({d.device_type})</span>
              <span className="text-sm text-gray-500">In: {d.in_amps}A, Icu: {d.icu_kA}kA</span>
              {d.is_main_incoming && <Pill color="green">Main Incoming</Pill>}
              {d.downstream_switchboard_id && <Pill color="blue">Linked to SB #{d.downstream_switchboard_id}</Pill>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => onEdit(d, panelId)}><Edit size={16} className="text-blue-500" /></button>
              <button onClick={() => onDuplicate(d.id, panelId)}><Copy size={16} className="text-green-500" /></button>
              <button onClick={() => onDelete(d.id, panelId)}><Trash size={16} className="text-red-500" /></button>
              <button onClick={() => onSetMain(d.id, panelId, !d.is_main_incoming)}>{d.is_main_incoming ? 'Unset Main' : 'Set Main'}</button>
            </div>
          </div>
          {d.children?.length > 0 && <DeviceTree devices={d.children} panelId={panelId} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} onSetMain={onSetMain} level={level + 1} />}
        </li>
      ))}
      {devices.length === 0 && <li className="text-gray-500 text-sm italic">No devices yet - add one!</li>}
    </ul>
  );
}
