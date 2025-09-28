import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle,
  ChevronDown, ChevronRight, ChevronLeft, X, ImagePlus, Sparkles
} from 'lucide-react';

/**
 * High Voltage — Frontend UI (React)
 *
 * Corrections & améliorations majeures:
 * - Ajout d'un objet `api` (corrige ReferenceError: api is not defined)
 * - Tous les appels envoient aussi `?site=` en fallback (si vos helpers n'ajoutent pas X-Site)
 * - CRUD complet HV Equipments + HV Devices
 * - Suggestions parent (HV), downstream HV Equipment, et lien BT (devices LV par nom)
 * - Upload multi-photos + preview via endpoints /photos
 * - Bouton "Générer via IA" (suggest-specs) pour préremplir les champs
 * - Refresh cohérent après create/update/delete
 * - UI propre (pills, modals, listes)
 */

// Utilities (similaires à Switchboards)
const regimes = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const hvDeviceTypes = [
  'HV Cell', 'HV Disconnect Switch', 'HV Circuit Breaker', 'Transformer',
  'HV Cable', 'Busbar', 'SEPAM Relay', 'Meter'
];

function Pill({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function Modal({ open, onClose, children, title, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors" aria-label="Fermer">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-gray-50 gap-2">{footer}</div>
      </div>
    </div>
  );
}

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

// --- API layer --------------------------------------------------------------
export function useHvApi() {
  const site = useUserSite();
  const withSite = (url, params) => {
    // Fallback si vos helpers n'ajoutent pas X-Site: on ajoute ?site=
    const u = new URL(url, window.location.origin);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
      });
    }
    if (site) u.searchParams.set('site', site);
    return u.pathname + u.search;
  };

  const api = {
    hv: {
      // HV Equipments
      list: (q) => get(withSite('/api/hv/equipments', q)),
      getOne: (id) => get(withSite(`/api/hv/equipments/${id}`)),
      createEq: (body) => post(withSite('/api/hv/equipments'), body),
      updateEq: (id, body) => put(withSite(`/api/hv/equipments/${id}`), body),
      deleteEq: (id) => del(withSite(`/api/hv/equipments/${id}`)),
      duplicateEq: (id) => post(withSite(`/api/hv/equipments/${id}/duplicate`)),

      // HV Devices
      listDevices: (hvEquipmentId) => get(withSite(`/api/hv/equipments/${hvEquipmentId}/devices`)),
      createDevice: (hvEquipmentId, body) => post(withSite(`/api/hv/equipments/${hvEquipmentId}/devices`), body),
      updateDevice: (id, body) => put(withSite(`/api/hv/devices/${id}`), body),
      deleteDevice: (id) => del(withSite(`/api/hv/devices/${id}`)),

      // Suggestions
      searchHvDevices: (q) => get(withSite('/api/hv/devices/search', { q })),
      searchHvEquipments: (q) => get(withSite('/api/hv/equipments/search', { q })),
      lvSuggestions: (q) => get(withSite('/api/hv/lv-devices', { q })),

      // Photos
      uploadPhotos: async (deviceId, files) => {
        const form = new FormData();
        [...files].forEach(f => form.append('photos', f));
        const url = withSite(`/api/hv/devices/${deviceId}/photos`);
        const res = await fetch(url, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      photoUrl: (deviceId, idx) => withSite(`/api/hv/devices/${deviceId}/photos/${idx}`),

      // AI
      suggestSpecs: (payload) => post(withSite('/api/hv/devices/suggest-specs'), payload),
      analyzeDevice: (id, payload) => post(withSite(`/api/hv/devices/${id}/analyze`), payload),
    }
  };
  return api;
}

const emptyHvEquipmentForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  is_principal: false,
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

const emptyHvDeviceForm = {
  name: '',
  device_type: 'HV Circuit Breaker',
  manufacturer: '',
  reference: '',
  voltage_class_kv: '',
  short_circuit_current_ka: '',
  insulation_type: '',
  mechanical_endurance_class: '',
  electrical_endurance_class: '',
  poles: '',
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
  const [allHvEquipments, setAllHvEquipments] = useState([]);
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1, pageSize: 18 });
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);

  const [openHvEquipment, setOpenHvEquipment] = useState(false);
  const [editingHvEquipment, setEditingHvEquipment] = useState(null);
  const [hvEquipmentForm, setHvEquipmentForm] = useState(emptyHvEquipmentForm);

  // HV Device states
  const [expandedPanels, setExpandedPanels] = useState({});
  const [hvDevices, setHvDevices] = useState({}); // map panelId -> array
  const [openHvDevice, setOpenHvDevice] = useState(false);
  const [editingHvDevice, setEditingHvDevice] = useState(null);
  const [hvDeviceForm, setHvDeviceForm] = useState(emptyHvDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);

  // Suggestions
  const [parentSuggestions, setParentSuggestions] = useState([]);
  const [downstreamSuggestions, setDownstreamSuggestions] = useState([]); // HV eq
  const [downstreamBtSuggestions, setDownstreamBtSuggestions] = useState([]); // LV devices
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [showDownstreamSuggestions, setShowDownstreamSuggestions] = useState(false);
  const [showDownstreamBtSuggestions, setShowDownstreamBtSuggestions] = useState(false);

  const fileInputRef = useRef(null);

  // Fetch HV equipments (paged)
  useEffect(() => {
    let alive = true; setBusy(true);
    api.hv.list(q).then(({ data, total }) => { if (!alive) return; setRows(data); setTotal(total); setBusy(false); })
      .catch(() => setBusy(false));
    return () => { alive = false; };
  }, [q.page, q.q, q.building, q.floor, q.room, q.sort, q.dir]);

  // Fetch all equipments for suggestions (first load)
  useEffect(() => {
    api.hv.list({ pageSize: 1000, page: 1 }).then(({ data }) => setAllHvEquipments(data)).catch(() => {});
  }, []);

  // Expand panel & fetch devices
  const toggleExpand = async (panelId) => {
    setExpandedPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
    if (!hvDevices[panelId]) {
      const devs = await api.hv.listDevices(panelId);
      setHvDevices(prev => ({ ...prev, [panelId]: devs }));
    }
  };

  const refreshPanel = async (panelId) => {
    const devs = await api.hv.listDevices(panelId);
    setHvDevices(prev => ({ ...prev, [panelId]: devs }));
  };

  // LV BT suggestions by name
  const fetchBtSuggestions = useCallback(async (term) => {
    if (!term) return setDownstreamBtSuggestions([]);
    try { setDownstreamBtSuggestions(await api.hv.lvSuggestions(term)); }
    catch (e) { console.error(e); }
  }, []);

  // Parent suggestions (HV devices)
  const fetchParentSuggestions = useCallback(async (term) => {
    if (!term) return setParentSuggestions([]);
    try { setParentSuggestions(await api.hv.searchHvDevices(term)); }
    catch (e) { console.error(e); }
  }, []);

  // Downstream HV equipment suggestions
  const fetchDownstreamSuggestions = useCallback(async (term) => {
    if (!term) return setDownstreamSuggestions([]);
    try { setDownstreamSuggestions(await api.hv.searchHvEquipments(term)); }
    catch (e) { console.error(e); }
  }, []);

  // Equipment form handlers
  const openCreateEq = () => { setEditingHvEquipment(null); setHvEquipmentForm({ ...emptyHvEquipmentForm, meta: { ...emptyHvEquipmentForm.meta, site } }); setOpenHvEquipment(true); };
  const openEditEq = (eq) => { setEditingHvEquipment(eq); setHvEquipmentForm({
    name: eq.name || '', code: eq.code || '',
    meta: { site: eq.site, building_code: eq.building_code || '', floor: eq.floor || '', room: eq.room || '' },
    regime_neutral: eq.regime_neutral || 'TN-S', is_principal: !!eq.is_principal, modes: eq.modes || {}, quality: eq.quality || {}
  }); setOpenHvEquipment(true); };

  const saveEq = async () => {
    const body = {
      name: hvEquipmentForm.name.trim(), code: hvEquipmentForm.code.trim(),
      building_code: hvEquipmentForm.meta.building_code, floor: hvEquipmentForm.meta.floor, room: hvEquipmentForm.meta.room,
      regime_neutral: hvEquipmentForm.regime_neutral, is_principal: hvEquipmentForm.is_principal,
      modes: hvEquipmentForm.modes, quality: hvEquipmentForm.quality
    };
    if (editingHvEquipment) await api.hv.updateEq(editingHvEquipment.id, body);
    else await api.hv.createEq(body);
    setOpenHvEquipment(false);
    setQ(q => ({ ...q })); // trigger reload
  };

  // Device form handlers
  const openCreateDevice = (panelId) => { setCurrentPanelId(panelId); setEditingHvDevice(null); setHvDeviceForm(emptyHvDeviceForm); setOpenHvDevice(true); };
  const openEditDevice = (panelId, device) => {
    setCurrentPanelId(panelId);
    setEditingHvDevice(device);
    setHvDeviceForm({
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
    setOpenHvDevice(true);
  };

  const handleHvDeviceSubmit = async () => {
    const payload = {
      ...hvDeviceForm,
      voltage_class_kv: hvDeviceForm.voltage_class_kv === '' ? null : Number(hvDeviceForm.voltage_class_kv),
      short_circuit_current_ka: hvDeviceForm.short_circuit_current_ka === '' ? null : Number(hvDeviceForm.short_circuit_current_ka),
      poles: hvDeviceForm.poles === '' ? null : Number(hvDeviceForm.poles),
    };
    if (editingHvDevice) await api.hv.updateDevice(editingHvDevice.id, payload);
    else await api.hv.createDevice(currentPanelId, payload);
    await refreshPanel(currentPanelId);
    setOpenHvDevice(false);
  };

  const onDeleteDevice = async (deviceId) => {
    if (!window.confirm('Supprimer ce device ?')) return;
    await api.hv.deleteDevice(deviceId);
    await refreshPanel(currentPanelId);
  };

  const onUploadPhotos = async (files) => {
    if (!editingHvDevice) {
      alert('Enregistrez d’abord le device, puis uploadez les photos.');
      return;
    }
    await api.hv.uploadPhotos(editingHvDevice.id, files);
    // Rien d’autre à faire ici, les previews utilisent l’endpoint direct
    await refreshPanel(currentPanelId);
  };

  const onSuggestSpecs = async () => {
    const desc = {
      name: hvDeviceForm.name,
      manufacturer: hvDeviceForm.manufacturer,
      reference: hvDeviceForm.reference,
      device_type_hint: hvDeviceForm.device_type
    };
    const res = await api.hv.suggestSpecs({ description: desc });
    // Merge dans le form avec garde-fous
    setHvDeviceForm(f => ({
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
    <section className="container mx-auto max-w-6xl py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">High Voltage Equipments</h2>
          <Pill color="gray">Site: {site || '—'}</Pill>
        </div>
        <button onClick={openCreateEq} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-800">
          <Plus size={16}/> Nouveau tableau HT
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <div className="col-span-2 flex items-center border rounded-lg px-3">
          <Search size={16} className="mr-2 text-gray-500"/>
          <input className="w-full py-2 outline-none" placeholder="Rechercher (nom, code)" value={q.q} onChange={(e)=>setQ(v=>({ ...v, q: e.target.value, page:1 }))}/>
        </div>
        <input className="border rounded-lg px-3 py-2" placeholder="Bâtiment" value={q.building} onChange={(e)=>setQ(v=>({ ...v, building:e.target.value, page:1 }))}/>
        <input className="border rounded-lg px-3 py-2" placeholder="Étage" value={q.floor} onChange={(e)=>setQ(v=>({ ...v, floor:e.target.value, page:1 }))}/>
        <input className="border rounded-lg px-3 py-2" placeholder="Local" value={q.room} onChange={(e)=>setQ(v=>({ ...v, room:e.target.value, page:1 }))}/>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map(eq => (
          <div key={eq.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-gray-900">{eq.name}</div>
                <div className="text-sm text-gray-600">{eq.code} · Bât {eq.building_code || '—'} · Étage {eq.floor || '—'} · Local {eq.room || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {eq.is_principal && <Pill color="green">Principal</Pill>}
                  <Pill>Régime {eq.regime_neutral}</Pill>
                  <Pill>{eq.devices_count || 0} appareils</Pill>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 border rounded-lg" onClick={()=>openEditEq(eq)}><Edit size={16}/></button>
                <button className="px-2 py-1 border rounded-lg" onClick={()=>api.hv.duplicateEq(eq.id).then(()=>setQ(q=>({ ...q })))}><Copy size={16}/></button>
                <button className="px-2 py-1 border rounded-lg" onClick={()=>toggleExpand(eq.id)}>{expandedPanels[eq.id]?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
              </div>
            </div>

            {/* Devices tree */}
            {expandedPanels[eq.id] && (
              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm text-gray-600">Appareils HT</div>
                  <button className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border" onClick={()=>openCreateDevice(eq.id)}>
                    <Plus size={14}/> Ajouter un appareil
                  </button>
                </div>
                <HvDeviceTree
                  devices={hvDevices[eq.id] || []}
                  panelId={eq.id}
                  onEdit={(d)=>openEditDevice(eq.id, d)}
                  onDelete={(id)=>{ setCurrentPanelId(eq.id); onDeleteDevice(id); }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Equipment Modal */}
      <Modal
        open={openHvEquipment}
        onClose={()=>setOpenHvEquipment(false)}
        title={editingHvEquipment? 'Modifier le tableau HT' : 'Nouveau tableau HT'}
        footer={(
          <>
            <button onClick={()=>setOpenHvEquipment(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Annuler</button>
            <button onClick={saveEq} className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800">Enregistrer</button>
          </>
        )}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="border rounded-lg px-3 py-2" placeholder="Nom" value={hvEquipmentForm.name} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, name:e.target.value }))}/>
          <input className="border rounded-lg px-3 py-2" placeholder="Code" value={hvEquipmentForm.code} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, code:e.target.value }))}/>
          <input className="border rounded-lg px-3 py-2" placeholder="Bâtiment" value={hvEquipmentForm.meta.building_code} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, meta:{ ...f.meta, building_code:e.target.value } }))}/>
          <input className="border rounded-lg px-3 py-2" placeholder="Étage" value={hvEquipmentForm.meta.floor} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, meta:{ ...f.meta, floor:e.target.value } }))}/>
          <input className="border rounded-lg px-3 py-2 md:col-span-2" placeholder="Local" value={hvEquipmentForm.meta.room} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, meta:{ ...f.meta, room:e.target.value } }))}/>
          <select className="border rounded-lg px-3 py-2" value={hvEquipmentForm.regime_neutral} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, regime_neutral:e.target.value }))}>
            {regimes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={hvEquipmentForm.is_principal} onChange={(e)=>setHvEquipmentForm(f=>({ ...f, is_principal:e.target.checked }))}/>
            Principal
          </label>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal
        open={openHvDevice}
        onClose={()=>setOpenHvDevice(false)}
        title={editingHvDevice? 'Modifier l\'appareil HT' : 'Nouvel appareil HT'}
        footer={(
          <>
            <button onClick={()=>setOpenHvDevice(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Annuler</button>
            <button onClick={onSuggestSpecs} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2"><Sparkles size={16}/> Générer via IA</button>
            <button onClick={handleHvDeviceSubmit} className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800">Enregistrer</button>
          </>
        )}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="border rounded-lg px-3 py-2" placeholder="Nom" value={hvDeviceForm.name} onChange={(e)=>setHvDeviceForm(f=>({ ...f, name:e.target.value }))}/>
          <select className="border rounded-lg px-3 py-2" value={hvDeviceForm.device_type} onChange={(e)=>setHvDeviceForm(f=>({ ...f, device_type:e.target.value }))}>
            {hvDeviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <input className="border rounded-lg px-3 py-2" placeholder="Fabricant" value={hvDeviceForm.manufacturer} onChange={(e)=>setHvDeviceForm(f=>({ ...f, manufacturer:e.target.value }))}/>
          <input className="border rounded-lg px-3 py-2" placeholder="Référence" value={hvDeviceForm.reference} onChange={(e)=>setHvDeviceForm(f=>({ ...f, reference:e.target.value }))}/>

          <input className="border rounded-lg px-3 py-2" placeholder="Classe de tension (kV)" value={hvDeviceForm.voltage_class_kv} onChange={(e)=>setHvDeviceForm(f=>({ ...f, voltage_class_kv:e.target.value }))}/>
          <input className="border rounded-lg px-3 py-2" placeholder="Icc (kA)" value={hvDeviceForm.short_circuit_current_ka} onChange={(e)=>setHvDeviceForm(f=>({ ...f, short_circuit_current_ka:e.target.value }))}/>

          <input className="border rounded-lg px-3 py-2" placeholder="Isolation (SF6/Vacuum/Air)" value={hvDeviceForm.insulation_type} onChange={(e)=>setHvDeviceForm(f=>({ ...f, insulation_type:e.target.value }))}/>
          <div className="grid grid-cols-2 gap-3">
            <input className="border rounded-lg px-3 py-2" placeholder="Classe M (M1/M2)" value={hvDeviceForm.mechanical_endurance_class} onChange={(e)=>setHvDeviceForm(f=>({ ...f, mechanical_endurance_class:e.target.value }))}/>
            <input className="border rounded-lg px-3 py-2" placeholder="Classe E (E1/E2)" value={hvDeviceForm.electrical_endurance_class} onChange={(e)=>setHvDeviceForm(f=>({ ...f, electrical_endurance_class:e.target.value }))}/>
          </div>
          <input className="border rounded-lg px-3 py-2" placeholder="Pôles" value={hvDeviceForm.poles} onChange={(e)=>setHvDeviceForm(f=>({ ...f, poles:e.target.value }))}/>

          {/* Parent (amont) — taper un nom de device HV */}
          <div className="relative md:col-span-2">
            <label className="block text-sm font-medium mb-1">Amont (parent) — taper un nom d\'appareil HT</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Ex: Cellule HTA 1"
              onFocus={()=>setShowParentSuggestions(true)}
              onChange={(e)=>fetchParentSuggestions(e.target.value)}
            />
            {showParentSuggestions && parentSuggestions.length>0 && (
              <ul className="absolute z-10 bg-white border rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {parentSuggestions.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                      onClick={()=>{ setHvDeviceForm(f=>({ ...f, parent_id: s.id })); setShowParentSuggestions(false); }}>
                    {s.name || `${s.manufacturer||'—'} ${s.reference||''}`} — {s.device_type}
                  </li>
                ))}
              </ul>
            )}
            {hvDeviceForm.parent_id && <div className="text-xs text-gray-600 mt-1">Parent sélectionné: #{hvDeviceForm.parent_id}</div>}
          </div>

          {/* Downstream HV equipment (transformateur, autre tableau HT) */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1">Aval HV (transformateur / autre tableau HT)</label>
            <input className="w-full border rounded-lg px-3 py-2" placeholder="Nom/code de tableau HT" onFocus={()=>setShowDownstreamSuggestions(true)} onChange={(e)=>fetchDownstreamSuggestions(e.target.value)}/>
            {showDownstreamSuggestions && downstreamSuggestions.length>0 && (
              <ul className="absolute z-10 bg-white border rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {downstreamSuggestions.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer" onClick={()=>{ setHvDeviceForm(f=>({ ...f, downstream_hv_equipment_id: s.id })); setShowDownstreamSuggestions(false); }}>
                    {s.name} — {s.code}
                  </li>
                ))}
              </ul>
            )}
            {hvDeviceForm.downstream_hv_equipment_id && <div className="text-xs text-gray-600 mt-1">Aval HV sélectionné: tableau #{hvDeviceForm.downstream_hv_equipment_id}</div>}
          </div>

          {/* Lien BT (sélection d\'un device de switchboard par son nom) */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1">Lien BT (device de TGBT par nom)</label>
            <input className="w-full border rounded-lg px-3 py-2" placeholder="Taper nom / référence"
                   onFocus={()=>setShowDownstreamBtSuggestions(true)}
                   onChange={(e)=>fetchBtSuggestions(e.target.value)} />
            {showDownstreamBtSuggestions && downstreamBtSuggestions.length>0 && (
              <ul className="absolute z-10 bg-white border rounded-lg mt-1 w-full max-h-56 overflow-auto">
                {downstreamBtSuggestions.map(s => (
                  <li key={s.id} className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                      onClick={()=>{ setHvDeviceForm(f=>({ ...f, downstream_device_id: s.id })); setShowDownstreamBtSuggestions(false); }}>
                    {s.name} ({s.reference}) — SB: {s.switchboard_name}
                  </li>
                ))}
              </ul>
            )}
            {hvDeviceForm.downstream_device_id && <div className="text-xs text-gray-600 mt-1">Lien BT sélectionné: device #{hvDeviceForm.downstream_device_id}</div>}
          </div>

          {/* Upload photos */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Photos (multi)</label>
            <div className="flex items-center gap-3">
              <input type="file" multiple ref={fileInputRef} onChange={(e)=>onUploadPhotos(e.target.files)} className="hidden"/>
              <button type="button" onClick={()=>fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border">
                <ImagePlus size={16}/> Ajouter des photos
              </button>
            </div>
            {editingHvDevice && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <img key={idx} alt="photo" className="w-full h-28 object-cover rounded-lg border"
                       src={api.hv.photoUrl(editingHvDevice.id, idx)}
                       onError={(e)=>{ e.currentTarget.style.display='none'; }}/>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
            <input type="checkbox" checked={hvDeviceForm.is_main_incoming} onChange={(e)=>setHvDeviceForm(f=>({ ...f, is_main_incoming:e.target.checked }))}/>
            Arrivée principale (Main Incoming)
          </label>
        </div>
      </Modal>
    </section>
  );
}

function HvDeviceTree({ devices, panelId, onEdit, onDelete, level = 0 }) {
  // On affiche la liste à plat (les ids parent peuvent être utilisés côté serveur pour rebuild l'arbre si besoin)
  return (
    <div className={`space-y-3 ${level > 0 ? 'ml-6 border-l border-gray-200 pl-4' : ''}`}>
      {(devices || []).map(device => (
        <div key={device.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-all">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                <span className="font-semibold text-gray-900 text-sm truncate max-w-[200px] sm:max-w-none">
                  {device.name || `${device.manufacturer || '—'} ${device.reference || ''}`.trim() || 'Unnamed Device'}
                </span>
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {device.device_type}
                </span>
                {device.is_main_incoming && <Pill color="green">MAIN INCOMING</Pill>}
                {device.downstream_hv_equipment_id && <Pill color="blue">Aval HV: EQ #{device.downstream_hv_equipment_id}</Pill>}
                {device.downstream_device_id && <Pill color="blue">Lien BT: Device #{device.downstream_device_id}</Pill>}
              </div>
              <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                <span>{device.voltage_class_kv ?? '—'} kV</span>
                <span>Isc: {device.short_circuit_current_ka ?? '—'} kA</span>
                <span>Insul: {device.insulation_type || '—'}</span>
                <span>Mech: {device.mechanical_endurance_class || '—'}</span>
                <span>Elec: {device.electrical_endurance_class || '—'}</span>
                <span>{device.poles ?? '—'}P</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded-lg" onClick={()=>onEdit(device)}><Edit size={16}/></button>
              <button className="px-2 py-1 border rounded-lg" onClick={()=>onDelete(device.id)}><Trash size={16}/></button>
            </div>
          </div>
        </div>
      ))}
      {(!devices || devices.length === 0) && (
        <div className="text-sm text-gray-500">Aucun appareil pour ce tableau HT.</div>
      )}
    </div>
  );
}
