import { useEffect, useState, useCallback, useRef } from 'react';
import { get, post, put, del } from '../lib/api.js';
import { Edit, Copy, Trash, Plus, Search, ChevronDown, ChevronRight, X, ImagePlus, Sparkles } from 'lucide-react';

/**
 * High Voltage — Frontend UI (React)
 *
 * Changes in this version (EN):
 * - All UI text in EN only
 * - Professional theme: white background, black text, subtle borders (no dark buttons)
 * - Fixed API layer + base path override (window.__HV_BASE or "/api/hv")
 * - Full CRUD for HV Equipments & HV Devices
 * - Upstream link (parent HV device), downstream HV equipment (e.g., transformer), and LV link (switchboard device by name)
 * - Multi-photos upload + previews
 * - AI "Suggest specs" with safe merges
 * - Proper refresh after create/update/delete
 */

const NEUTRAL_REGIMES = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const HV_DEVICE_TYPES = [
  'HV Cell', 'HV Disconnect Switch', 'HV Circuit Breaker', 'Transformer',
  'HV Cable', 'Busbar', 'SEPAM Relay', 'Meter'
];

function Chip({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-800">
      {children}
    </span>
  );
}

function Modal({ open, onClose, children, title, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
          <h3 className="text-xl font-semibold text-black">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)] bg-white">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-white gap-2">{footer}</div>
      </div>
    </div>
  );
}

function useUserSite() {
  try { return JSON.parse(localStorage.getItem('eh_user') || '{}')?.site || ''; } catch { return ''; }
}

// --- API layer --------------------------------------------------------------
export function useHvApi() {
  const site = useUserSite();
  const BASE = (typeof window !== 'undefined' && window.__HV_BASE) || '/api/hv';
  const withSite = (path, params) => {
    const u = new URL(path.startsWith('http') ? path : `${BASE}${path.replace(/^\/api\/hv/, '')}`, window.location.origin);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
    }
    if (site) u.searchParams.set('site', site); // fallback if X-Site header isn’t set in helpers
    return u.pathname + u.search;
  };

  const api = {
    hv: {
      // HV Equipments
      list: (q) => get(withSite('/equipments', q)),
      getOne: (id) => get(withSite(`/equipments/${id}`)),
      createEq: (body) => post(withSite('/equipments'), body),
      updateEq: (id, body) => put(withSite(`/equipments/${id}`), body),
      deleteEq: (id) => del(withSite(`/equipments/${id}`)),
      duplicateEq: (id) => post(withSite(`/equipments/${id}/duplicate`)),

      // HV Devices
      listDevices: (hvEquipmentId) => get(withSite(`/equipments/${hvEquipmentId}/devices`)),
      createDevice: (hvEquipmentId, body) => post(withSite(`/equipments/${hvEquipmentId}/devices`), body),
      updateDevice: (id, body) => put(withSite(`/devices/${id}`), body),
      deleteDevice: (id) => del(withSite(`/devices/${id}`)),

      // Suggestions
      searchHvDevices: (q) => get(withSite('/devices/search', { q })),
      searchHvEquipments: (q) => get(withSite('/equipments/search', { q })),
      lvSuggestions: (q) => get(withSite('/lv-devices', { q })),

      // Photos
      uploadPhotos: async (deviceId, files) => {
        const form = new FormData();
        [...files].forEach(f => form.append('photos', f));
        const url = withSite(`/devices/${deviceId}/photos`);
        const res = await fetch(url, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      photoUrl: (deviceId, idx) => withSite(`/devices/${deviceId}/photos/${idx}`),

      // AI
      suggestSpecs: (payload) => post(withSite('/devices/suggest-specs'), payload),
      analyzeDevice: (id, payload) => post(withSite(`/devices/${id}/analyze`), payload),
    }
  };
  return api;
}

const EMPTY_EQ = {
  name: '', code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S', is_principal: false,
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

const EMPTY_DEV = {
  name: '', device_type: 'HV Circuit Breaker', manufacturer: '', reference: '',
  voltage_class_kv: '', short_circuit_current_ka: '', insulation_type: '',
  mechanical_endurance_class: '', electrical_endurance_class: '', poles: '',
  settings: { distance_zone: '', differential_bias: '', overcurrent: '' },
  is_main_incoming: false,
  parent_id: null,
  downstream_hv_equipment_id: null,
  downstream_device_id: null,
  photos: []
};

export default function HighVoltage() {
  const site = useUserSite();
  const api = useHvApi();

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1, pageSize: 18 });
  const [total, setTotal] = useState(0);

  const [openEq, setOpenEq] = useState(false);
  const [editingEq, setEditingEq] = useState(null);
  const [eqForm, setEqForm] = useState(EMPTY_EQ);

  const [expanded, setExpanded] = useState({});
  const [panelDevices, setPanelDevices] = useState({});
  const [openDev, setOpenDev] = useState(false);
  const [editingDev, setEditingDev] = useState(null);
  const [devForm, setDevForm] = useState(EMPTY_DEV);
  const [currentPanelId, setCurrentPanelId] = useState(null);

  const [parentSugs, setParentSugs] = useState([]);
  const [downstreamEqSugs, setDownstreamEqSugs] = useState([]);
  const [downstreamBtSugs, setDownstreamBtSugs] = useState([]);
  const [showParent, setShowParent] = useState(false);
  const [showDownEq, setShowDownEq] = useState(false);
  const [showDownBt, setShowDownBt] = useState(false);

  const fileInputRef = useRef(null);

  // Load equipments
  useEffect(() => {
    api.hv.list(q).then(({ data, total }) => { setRows(data); setTotal(total); }).catch(console.error);
  }, [q.page, q.q, q.building, q.floor, q.room, q.sort, q.dir]);

  const toggleExpand = async (panelId) => {
    setExpanded(prev => ({ ...prev, [panelId]: !prev[panelId] }));
    if (!panelDevices[panelId]) {
      const devs = await api.hv.listDevices(panelId);
      setPanelDevices(prev => ({ ...prev, [panelId]: devs }));
    }
  };

  const refreshPanel = async (panelId) => {
    const devs = await api.hv.listDevices(panelId);
    setPanelDevices(prev => ({ ...prev, [panelId]: devs }));
  };

  // Suggestions
  const fetchBtSugs = useCallback(async (term) => {
    if (!term) return setDownstreamBtSugs([]);
    try { setDownstreamBtSugs(await api.hv.lvSuggestions(term)); } catch (e) { console.error(e); }
  }, []);

  const fetchParentSugs = useCallback(async (term) => {
    if (!term) return setParentSugs([]);
    try { setParentSugs(await api.hv.searchHvDevices(term)); } catch (e) { console.error(e); }
  }, []);

  const fetchDownEqSugs = useCallback(async (term) => {
    if (!term) return setDownstreamEqSugs([]);
    try { setDownstreamEqSugs(await api.hv.searchHvEquipments(term)); } catch (e) { console.error(e); }
  }, []);

  // Equipment form handlers
  const openCreateEq = () => { setEditingEq(null); setEqForm({ ...EMPTY_EQ, meta: { ...EMPTY_EQ.meta, site } }); setOpenEq(true); };
  const openEditEq = (eq) => {
    setEditingEq(eq);
    setEqForm({
      name: eq.name || '', code: eq.code || '',
      meta: { site: eq.site, building_code: eq.building_code || '', floor: eq.floor || '', room: eq.room || '' },
      regime_neutral: eq.regime_neutral || 'TN-S', is_principal: !!eq.is_principal, modes: eq.modes || {}, quality: eq.quality || {}
    });
    setOpenEq(true);
  };

  const saveEq = async () => {
    const body = {
      name: eqForm.name.trim(), code: eqForm.code.trim(),
      building_code: eqForm.meta.building_code, floor: eqForm.meta.floor, room: eqForm.meta.room,
      regime_neutral: eqForm.regime_neutral, is_principal: eqForm.is_principal,
      modes: eqForm.modes, quality: eqForm.quality
    };
    if (editingEq) await api.hv.updateEq(editingEq.id, body);
    else await api.hv.createEq(body);
    setOpenEq(false);
    setQ(q => ({ ...q }));
  };

  // Device form handlers
  const openCreateDev = (panelId) => { setCurrentPanelId(panelId); setEditingDev(null); setDevForm(EMPTY_DEV); setOpenDev(true); };
  const openEditDev = (panelId, device) => {
    setCurrentPanelId(panelId);
    setEditingDev(device);
    setDevForm({
      name: device.name || '', device_type: device.device_type || 'HV Circuit Breaker',
      manufacturer: device.manufacturer || '', reference: device.reference || '',
      voltage_class_kv: device.voltage_class_kv ?? '', short_circuit_current_ka: device.short_circuit_current_ka ?? '',
      insulation_type: device.insulation_type || '', mechanical_endurance_class: device.mechanical_endurance_class || '', electrical_endurance_class: device.electrical_endurance_class || '',
      poles: device.poles ?? '', settings: device.settings || { distance_zone: '', differential_bias: '', overcurrent: '' },
      is_main_incoming: !!device.is_main_incoming,
      parent_id: device.parent_id || null,
      downstream_hv_equipment_id: device.downstream_hv_equipment_id || null,
      downstream_device_id: device.downstream_device_id || null,
      photos: []
    });
    setOpenDev(true);
  };

  const submitDev = async () => {
    const payload = {
      ...devForm,
      voltage_class_kv: devForm.voltage_class_kv === '' ? null : Number(devForm.voltage_class_kv),
      short_circuit_current_ka: devForm.short_circuit_current_ka === '' ? null : Number(devForm.short_circuit_current_ka),
      poles: devForm.poles === '' ? null : Number(devForm.poles),
    };
    if (editingDev) await api.hv.updateDevice(editingDev.id, payload);
    else await api.hv.createDevice(currentPanelId, payload);
    await refreshPanel(currentPanelId);
    setOpenDev(false);
  };

  const deleteDev = async (deviceId) => {
    if (!window.confirm('Delete this device?')) return;
    await api.hv.deleteDevice(deviceId);
    await refreshPanel(currentPanelId);
  };

  const uploadPhotos = async (files) => {
    if (!editingDev) { alert('Save the device first, then upload photos.'); return; }
    await api.hv.uploadPhotos(editingDev.id, files);
    await refreshPanel(currentPanelId);
  };

  const suggestSpecs = async () => {
    const desc = { name: devForm.name, manufacturer: devForm.manufacturer, reference: devForm.reference, device_type_hint: devForm.device_type };
    const res = await api.hv.suggestSpecs({ description: desc });
    setDevForm(f => ({
      ...f,
      device_type: res.device_type || f.device_type,
      voltage_class_kv: res.voltage_class_kv ?? f.voltage_class_kv,
      short_circuit_current_ka: res.short_circuit_current_ka ?? f.short_circuit_current_ka,
      insulation_type: res.insulation_type || f.insulation_type,
      mechanical_endurance_class: res.mechanical_endurance_class || f.mechanical_endurance_class,
      electrical_endurance_class: res.electrical_endurance_class || f.electrical_endurance_class,
      poles: res.poles ?? f.poles,
      settings: { ...f.settings, ...(res.settings || {}) }
    }));
  };

  return (
    <section className="container mx-auto max-w-6xl py-8 bg-white">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold text-black">High Voltage Equipments</h2>
          <Chip>Site: {site || '—'}</Chip>
        </div>
        <button onClick={openCreateEq} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-black bg-white hover:bg-gray-100">
          <Plus size={16}/> New HV Board
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <div className="col-span-2 flex items-center border border-gray-300 rounded-lg px-3 bg-white">
          <Search size={16} className="mr-2 text-gray-500"/>
          <input className="w-full py-2 outline-none bg-white text-black" placeholder="Search (name, code)" value={q.q} onChange={(e)=>setQ(v=>({ ...v, q: e.target.value, page:1 }))}/>
        </div>
        <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Building" value={q.building} onChange={(e)=>setQ(v=>({ ...v, building:e.target.value, page:1 }))}/>
        <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Floor" value={q.floor} onChange={(e)=>setQ(v=>({ ...v, floor:e.target.value, page:1 }))}/>
        <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Room" value={q.room} onChange={(e)=>setQ(v=>({ ...v, room:e.target.value, page:1 }))}/>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map(eq => (
          <div key={eq.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-black">{eq.name}</div>
                <div className="text-sm text-gray-700">{eq.code} · Bldg {eq.building_code || '—'} · Floor {eq.floor || '—'} · Room {eq.room || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {eq.is_principal && <Chip>Principal</Chip>}
                  <Chip>Neutral {eq.regime_neutral}</Chip>
                  <Chip>{eq.devices_count || 0} devices</Chip>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-black hover:bg-gray-100" onClick={()=>openEditEq(eq)}><Edit size={16}/></button>
                <button className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-black hover:bg-gray-100" onClick={()=>api.hv.duplicateEq(eq.id).then(()=>setQ(q=>({ ...q })))}><Copy size={16}/></button>
                <button className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-black hover:bg-gray-100" onClick={()=>toggleExpand(eq.id)}>{expanded[eq.id]?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
              </div>
            </div>

            {expanded[eq.id] && (
              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm text-gray-700">HV Devices</div>
                  <button className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-gray-300 bg-white text-black hover:bg-gray-100" onClick={()=>openCreateDev(eq.id)}>
                    <Plus size={14}/> Add device
                  </button>
                </div>
                <HvDeviceList
                  devices={panelDevices[eq.id] || []}
                  onEdit={(d)=>openEditDev(eq.id, d)}
                  onDelete={(id)=>{ setCurrentPanelId(eq.id); deleteDev(id); }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Equipment Modal */}
      <Modal
        open={openEq}
        onClose={()=>setOpenEq(false)}
        title={editingEq? 'Edit HV Board' : 'New HV Board'}
        footer={(
          <>
            <button onClick={()=>setOpenEq(false)} className="px-4 py-2 text-sm font-medium text-black bg-white border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
            <button onClick={saveEq} className="px-4 py-2 text-sm font-medium text-black bg-white border border-gray-900 rounded-lg hover:bg-gray-100">Save</button>
          </>
        )}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Name" value={eqForm.name} onChange={(e)=>setEqForm(f=>({ ...f, name:e.target.value }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Code" value={eqForm.code} onChange={(e)=>setEqForm(f=>({ ...f, code:e.target.value }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Building" value={eqForm.meta.building_code} onChange={(e)=>setEqForm(f=>({ ...f, meta:{ ...f.meta, building_code:e.target.value } }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Floor" value={eqForm.meta.floor} onChange={(e)=>setEqForm(f=>({ ...f, meta:{ ...f.meta, floor:e.target.value } }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 md:col-span-2 bg-white text-black" placeholder="Room" value={eqForm.meta.room} onChange={(e)=>setEqForm(f=>({ ...f, meta:{ ...f.meta, room:e.target.value } }))}/>
          <select className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" value={eqForm.regime_neutral} onChange={(e)=>setEqForm(f=>({ ...f, regime_neutral:e.target.value }))}>
            {NEUTRAL_REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-black">
            <input type="checkbox" checked={eqForm.is_principal} onChange={(e)=>setEqForm(f=>({ ...f, is_principal:e.target.checked }))}/>
            Principal board
          </label>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal
        open={openDev}
        onClose={()=>setOpenDev(false)}
        title={editingDev? 'Edit HV Device' : 'New HV Device'}
        footer={(
          <>
            <button onClick={()=>setOpenDev(false)} className="px-4 py-2 text-sm font-medium text-black bg-white border border-gray-300 rounded-lg hover:bg-gray-100">Cancel</button>
            <button onClick={suggestSpecs} className="px-4 py-2 text-sm font-medium text-black bg-white border border-gray-900 rounded-lg hover:bg-gray-100 inline-flex items-center gap-2"><Sparkles size={16}/> Suggest with AI</button>
            <button onClick={submitDev} className="px-4 py-2 text-sm font-medium text-black bg-white border border-gray-900 rounded-lg hover:bg-gray-100">Save</button>
          </>
        )}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Name" value={devForm.name} onChange={(e)=>setDevForm(f=>({ ...f, name:e.target.value }))}/>
          <select className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" value={devForm.device_type} onChange={(e)=>setDevForm(f=>({ ...f, device_type:e.target.value }))}>
            {HV_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Manufacturer" value={devForm.manufacturer} onChange={(e)=>setDevForm(f=>({ ...f, manufacturer:e.target.value }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Reference" value={devForm.reference} onChange={(e)=>setDevForm(f=>({ ...f, reference:e.target.value }))}/>

          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Rated voltage (kV)" value={devForm.voltage_class_kv} onChange={(e)=>setDevForm(f=>({ ...f, voltage_class_kv:e.target.value }))}/>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Short circuit (kA)" value={devForm.short_circuit_current_ka} onChange={(e)=>setDevForm(f=>({ ...f, short_circuit_current_ka:e.target.value }))}/>

          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Insulation (SF6/Vacuum/Air)" value={devForm.insulation_type} onChange={(e)=>setDevForm(f=>({ ...f, insulation_type:e.target.value }))}/>
          <div className="grid grid-cols-2 gap-3">
            <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Mechanical class (M1/M2)" value={devForm.mechanical_endurance_class} onChange={(e)=>setDevForm(f=>({ ...f, mechanical_endurance_class:e.target.value }))}/>
            <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Electrical class (E1/E2)" value={devForm.electrical_endurance_class} onChange={(e)=>setDevForm(f=>({ ...f, electrical_endurance_class:e.target.value }))}/>
          </div>
          <input className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Poles" value={devForm.poles} onChange={(e)=>setDevForm(f=>({ ...f, poles:e.target.value }))}/>

          {/* Upstream (parent HV device) */}
          <div className="relative md:col-span-2">
            <label className="block text-sm font-medium mb-1 text-black">Upstream (parent) — type a HV device name</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="e.g., HV Cell A1" onFocus={()=>setShowParent(true)} onChange={(e)=>fetchParentSugs(e.target.value)} />
            {showParent && parentSugs.length>0 && (
              <ul className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {parentSugs.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer" onClick={()=>{ setDevForm(f=>({ ...f, parent_id: s.id })); setShowParent(false); }}>
                    {s.name || `${s.manufacturer||'—'} ${s.reference||''}`} — {s.device_type}
                  </li>
                ))}
              </ul>
            )}
            {devForm.parent_id && <div className="text-xs text-gray-600 mt-1">Parent selected: #{devForm.parent_id}</div>}
          </div>

          {/* Downstream HV equipment */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1 text-black">Downstream HV (transformer / HV board)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Type a HV board name/code" onFocus={()=>setShowDownEq(true)} onChange={(e)=>fetchDownEqSugs(e.target.value)} />
            {showDownEq && downstreamEqSugs.length>0 && (
              <ul className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {downstreamEqSugs.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer" onClick={()=>{ setDevForm(f=>({ ...f, downstream_hv_equipment_id: s.id })); setShowDownEq(false); }}>
                    {s.name} — {s.code}
                  </li>
                ))}
              </ul>
            )}
            {devForm.downstream_hv_equipment_id && <div className="text-xs text-gray-600 mt-1">Downstream HV selected: board #{devForm.downstream_hv_equipment_id}</div>}
          </div>

          {/* LV link (switchboard device by name) */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1 text-black">LV link (switchboard device by name)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-black" placeholder="Type device name/reference" onFocus={()=>setShowDownBt(true)} onChange={(e)=>fetchBtSugs(e.target.value)} />
            {showDownBt && downstreamBtSugs.length>0 && (
              <ul className="absolute z-10 bg-white border border-gray-200 rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {downstreamBtSugs.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer" onClick={()=>{ setDevForm(f=>({ ...f, downstream_device_id: s.id })); setShowDownBt(false); }}>
                    {s.name} ({s.reference}) — SB: {s.switchboard_name}
                  </li>
                ))}
              </ul>
            )}
            {devForm.downstream_device_id && <div className="text-xs text-gray-600 mt-1">LV link selected: device #{devForm.downstream_device_id}</div>}
          </div>

          {/* Photos */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2 text-black">Photos (multiple)</label>
            <div className="flex items-center gap-3">
              <input type="file" multiple ref={fileInputRef} onChange={(e)=>uploadPhotos(e.target.files)} className="hidden"/>
              <button type="button" onClick={()=>fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white text-black hover:bg-gray-100">
                <ImagePlus size={16}/> Add photos
              </button>
            </div>
            {editingDev && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <img key={idx} alt="photo" className="w-full h-28 object-cover rounded-lg border border-gray-200"
                       src={api.hv.photoUrl(editingDev.id, idx)}
                       onError={(e)=>{ e.currentTarget.style.display='none'; }}/>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-black md:col-span-2">
            <input type="checkbox" checked={devForm.is_main_incoming} onChange={(e)=>setDevForm(f=>({ ...f, is_main_incoming:e.target.checked }))}/>
            Main incoming
          </label>
        </div>
      </Modal>
    </section>
  );
}

function HvDeviceList({ devices, onEdit, onDelete }) {
  return (
    <div className="space-y-3">
      {(devices || []).map(device => (
        <div key={device.id} className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                <span className="font-semibold text-black text-sm truncate max-w-[200px] sm:max-w-none">
                  {device.name || `${device.manufacturer || '—'} ${device.reference || ''}`.trim() || 'Unnamed Device'}
                </span>
                <span className="text-xs bg-white text-gray-800 px-2 py-0.5 rounded-full border border-gray-300 whitespace-nowrap">
                  {device.device_type}
                </span>
                {device.is_main_incoming && <Chip>MAIN INCOMING</Chip>}
                {device.downstream_hv_equipment_id && <Chip>Downstream HV: #{device.downstream_hv_equipment_id}</Chip>}
                {device.downstream_device_id && <Chip>LV link: Device #{device.downstream_device_id}</Chip>}
              </div>
              <div className="text-xs text-gray-700 flex flex-wrap gap-3">
                <span>{device.voltage_class_kv ?? '—'} kV</span>
                <span>Isc: {device.short_circuit_current_ka ?? '—'} kA</span>
                <span>Insul: {device.insulation_type || '—'}</span>
                <span>Mech: {device.mechanical_endurance_class || '—'}</span>
                <span>Elec: {device.electrical_endurance_class || '—'}</span>
                <span>{device.poles ?? '—'}P</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-black hover:bg-gray-100" onClick={()=>onEdit(device)}><Edit size={16}/></button>
              <button className="px-2 py-1 border border-gray-300 rounded-lg bg-white text-black hover:bg-gray-100" onClick={()=>onDelete(device.id)}><Trash size={16}/></button>
            </div>
          </div>
        </div>
      ))}
      {(!devices || devices.length === 0) && (
        <div className="text-sm text-gray-700">No device on this HV board yet.</div>
      )}
    </div>
  );
}
