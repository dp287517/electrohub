// src/pages/High_voltage.jsx
import { useEffect, useState, useCallback } from 'react';
import { api, get, del } from '../lib/api.js';
import {
  Edit, Trash, Plus, Search, SlidersHorizontal,
  ChevronDown, ChevronRight, X, Sparkles, Image as ImageIcon
} from 'lucide-react';

// Constants
const regimes = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const hvDeviceTypes = ['HV Cell','HV Disconnect Switch','HV Circuit Breaker','Transformer','HV Cable','Busbar','Relay','Meter'];
const insulationTypes = ['SF6','Vacuum','Air'];
const mechanicalEnduranceClasses = ['M1','M2'];
const electricalEnduranceClasses = ['E1','E2'];

function useUserSite() {
  try { return (JSON.parse(localStorage.getItem('eh_user') || '{}')?.site) || ''; } catch { return ''; }
}

function Pill({ children, color = 'blue' }) {
  const map = {
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200'
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${map[color]}`}>{children}</span>;
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200"><X size={20} /></button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// HV Equipment mapping
const emptyHvEquipmentForm = {
  name: '', code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S', is_principal: false,
  modes: { bypass:false, maintenance_mode:false, bus_coupling:false, genset_backup:false, ups_backup:false },
  quality: { thd:'', flicker:'' }
};

function rowToForm(row) {
  if (!row) return emptyHvEquipmentForm;
  return {
    name: row.name || '', code: row.code || '',
    meta: { site: row.site||'', building_code: row.building_code||'', floor: row.floor||'', room: row.room||'' },
    regime_neutral: row.regime_neutral || 'TN-S', is_principal: !!row.is_principal,
    modes: row.modes || {}, quality: row.quality || {}
  };
}
function formToPayload(f, site) {
  return {
    name: f.name, code: f.code,
    building_code: f.meta?.building_code || '',
    floor: f.meta?.floor || '',
    room: f.meta?.room || '',
    regime_neutral: f.regime_neutral,
    is_principal: f.is_principal,
    modes: f.modes || {}, quality: f.quality || {}, site
  };
}

// HV Devices
const emptyHvDeviceForm = {
  name:'', device_type:'HV Circuit Breaker', manufacturer:'', reference:'',
  voltage_class_kv:null, short_circuit_current_ka:null,
  insulation_type:'', mechanical_endurance_class:'', electrical_endurance_class:'',
  poles:null, settings:{ distance_zone:null, differential_bias:null, overcurrent:null },
  is_main_incoming:false, parent_id:null, downstream_hv_equipment_id:null, downstream_device_id:null
};

function buildDeviceTree(list) {
  const byId = new Map(); (list||[]).forEach(d => byId.set(d.id, { ...d, children: [] }));
  const roots = [];
  (list||[]).forEach(d => {
    const node = byId.get(d.id);
    if (d.parent_id && byId.has(d.parent_id)) byId.get(d.parent_id).children.push(node);
    else roots.push(node);
  });
  return roots;
}

export default function HighVoltage() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState({ q:'', building:'', floor:'', room:'', sort:'created_at', dir:'desc', page:1 });
  const [showFilters, setShowFilters] = useState(false);
  const [openHvEquipment, setOpenHvEquipment] = useState(false);
  const [editingHvEquipment, setEditingHvEquipment] = useState(null);
  const [hvEquipmentForm, setHvEquipmentForm] = useState(emptyHvEquipmentForm);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [total, setTotal] = useState(0);
  const [expandedPanels, setExpandedPanels] = useState({});
  const [hvDevices, setHvDevices] = useState({});
  const [openHvDevice, setOpenHvDevice] = useState(false);
  const [editingHvDevice, setEditingHvDevice] = useState(null);
  const [hvDeviceForm, setHvDeviceForm] = useState(emptyHvDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);
  const [downstreamBtSuggestions, setDownstreamBtSuggestions] = useState([]);
  const [showDownstreamBtSuggestions, setShowDownstreamBtSuggestions] = useState(false);
  const [toast, setToast] = useState(null);

  // Photos for AI (local before upload) — no preview
  const [localPhotos, setLocalPhotos] = useState([]); // File[]

  // Fetch list
  useEffect(() => {
    setBusy(true);
    api.hv.list(q).then((resp) => {
      const data = resp?.data || []; setRows(data); setTotal(resp?.total || 0);
    }).catch(e => setToast({ type:'error', msg: 'Failed to load HV equipments: ' + e.message }))
      .finally(() => setBusy(false));
  }, [q]);

  // Devices on expand
  useEffect(() => {
    Object.keys(expandedPanels).forEach(async (id) => {
      if (expandedPanels[id] && !hvDevices[id]) {
        try {
          const flat = await get(`/api/hv/equipments/${id}/devices`);
          setHvDevices(prev => ({ ...prev, [id]: buildDeviceTree(flat || []) }));
        } catch (e) { setToast({ type:'error', msg:'Failed to load devices' }); }
      }
    });
  }, [expandedPanels]); // eslint-disable-line

  // BT suggestions
  const fetchBtSuggestions = useCallback(async (query) => {
    try {
      const res = await get('/api/hv/lv-devices', { q: query || '' });
      setDownstreamBtSuggestions(res || []);
    } catch (e) {
      console.warn('[BT SUGGESTIONS ERROR]', e?.message || e);
      setDownstreamBtSuggestions([]);
    }
  }, []);

  // Submit Equipment
  const handleHvEquipmentSubmit = async () => {
    try {
      setBusy(true);
      const payload = formToPayload(hvEquipmentForm, site);
      if (editingHvEquipment) {
        const res = await api.hv.updateEquipment(editingHvEquipment.id, payload);
        setRows(rows.map(r => r.id === editingHvEquipment.id ? { ...r, ...res } : r));
      } else {
        const res = await api.hv.createEquipment(payload);
        setRows([...rows, res]);
      }
      setOpenHvEquipment(false);
      setEditingHvEquipment(null);
      setHvEquipmentForm(emptyHvEquipmentForm);
      setToast({ type:'success', msg:'HV Equipment saved' });
    } catch (e) { setToast({ type:'error', msg:'Failed to save HV Equipment: ' + e.message }); }
    finally { setBusy(false); }
  };

  // Submit Device
  const handleHvDeviceSubmit = async () => {
    if (!currentPanelId) { setToast({ type:'error', msg:'Invalid HV Equipment ID' }); return; }
    try {
      setBusy(true);
      const payload = { ...hvDeviceForm };
      if (editingHvDevice) {
        await api.hv.update(editingHvDevice.id, payload);
        const flat = await get(`/api/hv/equipments/${currentPanelId}/devices`);
        setHvDevices(prev => ({ ...prev, [currentPanelId]: buildDeviceTree(flat || []) }));
      } else {
        await api.hv.create(Number(currentPanelId), payload);
        const flat = await get(`/api/hv/equipments/${currentPanelId}/devices`);
        setHvDevices(prev => ({ ...prev, [currentPanelId]: buildDeviceTree(flat || []) }));
      }
      setOpenHvDevice(false);
      setEditingHvDevice(null);
      setHvDeviceForm(emptyHvDeviceForm);
      setLocalPhotos([]);
      setToast({ type:'success', msg:'HV Device saved' });
    } catch (e) { setToast({ type:'error', msg:'Failed to save HV Device: ' + e.message }); }
    finally { setBusy(false); }
  };

  // Photos handlers (no preview)
  const onPickPhotos = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    setLocalPhotos(files);
  };
  const removeLocalPhoto = (idx) => {
    setLocalPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  // AI from photos (upload files, no display)
  const handleAISuggestFromPhotos = async () => {
    try {
      setAnalyzing(true);
      const fd = new FormData();
      fd.append('manufacturer', hvDeviceForm.manufacturer || '');
      fd.append('reference', hvDeviceForm.reference || '');
      fd.append('device_type', hvDeviceForm.device_type || '');
      localPhotos.forEach(f => fd.append('photos', f));

      const res = await fetch('/api/hv/ai/specs', {
        method: 'POST',
        body: fd,
        headers: { 'X-Site': site }
      });

      if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch {}
        const msg = err?.error || `AI error (${res.status})`;
        const details = err?.details ? ` — ${err.details}` : '';
        setToast({ type: 'error', msg: `${msg}${details}`.slice(0, 300) });
        return;
      }

      let specs = {};
      try { specs = await res.json(); } catch { specs = {}; }

      // empty?
      const empty = !specs || Object.keys(specs).length === 0 ||
        Object.values(specs).every(v => v === null || v === '' || (typeof v === 'object' && Object.keys(v||{}).length===0));
      if (empty) {
        setToast({ type:'error', msg:'No specs extracted (photos unreadable or no visible data).' });
        return;
      }

      // compute diff to show useful feedback
      const before = hvDeviceForm;
      const after = { ...before, ...specs, settings: { ...(before.settings||{}), ...(specs?.settings||{}) } };
      const changed = [];
      for (const k of ['manufacturer','reference','device_type','voltage_class_kv','short_circuit_current_ka','insulation_type','mechanical_endurance_class','electrical_endurance_class','poles']) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k]) && after[k] !== undefined && after[k] !== null && `${after[k]}` !== '') {
          changed.push(k);
        }
      }

      setHvDeviceForm(after);
      setToast({ type: changed.length ? 'success' : 'error', msg: changed.length ? `Prefilled: ${changed.join(', ')}` : 'No new info detected from photos.' });
    } catch (e) {
      setToast({ type:'error', msg:'AI suggestion failed' });
    } finally { setAnalyzing(false); }
  };

  // Helpers
  const toggleExpand = (id) => setExpandedPanels(p => ({ ...p, [id]: !p[id] }));

  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">High Voltage Equipments</h1>
          <p className="text-gray-600">Manage HV cells, transformers, cables, and LV links.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFilters(v => !v)} className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 inline-flex items-center gap-2" disabled={busy}>
            <SlidersHorizontal size={16} /> Filters
          </button>
          <button
            onClick={() => { setEditingHvEquipment(null); setHvEquipmentForm(emptyHvEquipmentForm); setOpenHvEquipment(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" disabled={busy}>
            <Plus size={16} className="inline mr-1" /> Add HV Equipment
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-4 gap-4 bg-white p-4 border border-gray-200 rounded-xl shadow-sm">
          <div className="relative">
            <Search size={18} className="absolute top-2.5 left-3 text-gray-400" />
            <input type="text" placeholder="Search by name or code..." value={q.q}
              onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
              className="pl-10 pr-4 py-2 border rounded-lg w-full bg-white text-gray-900 placeholder-gray-400" disabled={busy}/>
          </div>
          <input type="text" placeholder="Building..." value={q.building}
            onChange={e => setQ({ ...q, building: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400" disabled={busy}/>
          <input type="text" placeholder="Floor..." value={q.floor}
            onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400" disabled={busy}/>
          <input type="text" placeholder="Room..." value={q.room}
            onChange={e => setQ({ ...q, room: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400" disabled={busy}/>
        </div>
      )}

      {busy && <div className="text-center py-4">Loading...</div>}
      {!busy && rows.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Plus size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-500">No HV equipments yet</p>
          <p className="text-xs text-gray-400">Add your first HV equipment using the button above</p>
        </div>
      )}

      {!busy && rows.length > 0 && (
        <div className="space-y-4">
          {rows.map(row => (
            <div key={row.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <button onClick={() => toggleExpand(row.id)} className="p-1 rounded hover:bg-gray-100" disabled={busy}>
                      {expandedPanels[row.id] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>
                    <span className="font-semibold text-gray-900">{row.name} ({row.code})</span>
                    {row.is_principal && <Pill color="green">Principal</Pill>}
                  </div>
                  <div className="text-sm text-gray-600 flex gap-3 flex-wrap">
                    <span>{row.building_code || '—'}</span>
                    <span>Floor: {row.floor || '—'}</span>
                    <span>Room: {row.room || '—'}</span>
                    <span>Regime: {row.regime_neutral || '—'}</span>
                    <span>Devices: {row.devices_count || 0}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingHvEquipment(row); setHvEquipmentForm(rowToForm(row)); setOpenHvEquipment(true); }}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" disabled={busy} title="Edit">
                    <Edit size={16} />
                  </button>
                  <button onClick={() => del(`/api/hv/equipments/${row.id}`).then(() => setRows(rows.filter(r => r.id !== row.id)))}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg" disabled={busy} title="Delete">
                    <Trash size={16} />
                  </button>
                </div>
              </div>

              {expandedPanels[row.id] && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => { setEditingHvDevice(null); setHvDeviceForm(emptyHvDeviceForm); setCurrentPanelId(row.id); setOpenHvDevice(true); }}
                    className="mb-4 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" disabled={busy}>
                    <Plus size={16} className="inline mr-1" /> Add Device
                  </button>
                  <HvDeviceTree
                    devices={hvDevices[row.id] || []}
                    panelId={row.id}
                    onEdit={(device, panelId) => {
                      setEditingHvDevice(device);
                      setHvDeviceForm({ ...emptyHvDeviceForm, ...device });
                      setCurrentPanelId(panelId);
                      setOpenHvDevice(true);
                    }}
                    onDelete={async (id, panelId) => {
                      await del(`/api/hv/devices/${id}`);
                      const flat = await get(`/api/hv/equipments/${panelId}/devices`);
                      setHvDevices(prev => ({ ...prev, [panelId]: buildDeviceTree(flat || []) }));
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* HV Equipment modal */}
      <Modal open={openHvEquipment} onClose={() => { setOpenHvEquipment(false); setEditingHvEquipment(null); setHvEquipmentForm(emptyHvEquipmentForm); }}
        title={editingHvEquipment ? 'Edit HV Equipment' : 'Add HV Equipment'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {['Name','Code','Building','Floor','Room'].map((label, idx) => {
            const map = ['name','code','building_code','floor','room'];
            const key = map[idx];
            const val = idx < 2 ? hvEquipmentForm[key] : hvEquipmentForm.meta?.[key] || '';
            const set = (v) => idx < 2
              ? setHvEquipmentForm({ ...hvEquipmentForm, [key]: v })
              : setHvEquipmentForm({ ...hvEquipmentForm, meta: { ...(hvEquipmentForm.meta||{}), [key]: v }});
            return (
              <div key={label}>
                <label className="block text-sm font-medium text-gray-700">{label}</label>
                <input type="text" value={val} onChange={e => set(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400" disabled={busy}/>
              </div>
            );
          })}
          <div>
            <label className="block text-sm font-medium text-gray-700">Neutral Regime</label>
            <select value={hvEquipmentForm.regime_neutral} onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, regime_neutral: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900" disabled={busy}>
              {regimes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="inline-flex items-center">
              <input type="checkbox" checked={hvEquipmentForm.is_principal} onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, is_principal: e.target.checked })}
                className="rounded border-gray-300" disabled={busy}/>
              <span className="ml-2 text-sm text-gray-700">Principal Equipment</span>
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={handleHvEquipmentSubmit} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* HV Device modal */}
      <Modal open={openHvDevice} onClose={() => {
        setOpenHvDevice(false); setEditingHvDevice(null); setHvDeviceForm(emptyHvDeviceForm);
        setLocalPhotos([]); setShowDownstreamBtSuggestions(false);
      }} title={editingHvDevice ? 'Edit HV Device' : 'Add HV Device'}>
        {/* 1) AI PHOTOS FIRST */}
        <div className="sm:col-span-2 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Photos (for AI)</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 cursor-pointer">
              <ImageIcon size={16} className="mr-2"/> Choose photos
              <input type="file" accept="image/*" multiple className="hidden" onChange={onPickPhotos} />
            </label>
            <button type="button" onClick={handleAISuggestFromPhotos}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              disabled={analyzing || localPhotos.length === 0}>
              <Sparkles size={16}/>{analyzing ? 'Analyzing…' : 'Analyze photos (AI)'}
            </button>
          </div>

          {/* Simple list of chosen files */}
          {localPhotos.length > 0 && (
            <ul className="mt-3 space-y-2">
              {localPhotos.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                  <span className="truncate">{f.name} {f.size ? `(${Math.round(f.size/1024)} KB)` : ''}</span>
                  <button onClick={() => removeLocalPhoto(i)} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">✕</button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 mt-2">Tip: nameplate, overall view, inside the cell…</p>
          <hr className="mt-6"/>
        </div>

        {/* 2) THEN THE FIELDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <FieldText label="Name" value={hvDeviceForm.name} onChange={v => setHvDeviceForm({ ...hvDeviceForm, name: v })} disabled={busy}/>
          <FieldSelect label="Device Type" value={hvDeviceForm.device_type} options={hvDeviceTypes} onChange={v => setHvDeviceForm({ ...hvDeviceForm, device_type: v })} disabled={busy}/>
          <FieldText label="Manufacturer" value={hvDeviceForm.manufacturer} onChange={v => setHvDeviceForm({ ...hvDeviceForm, manufacturer: v })} disabled={busy}/>
          <FieldText label="Reference" value={hvDeviceForm.reference} onChange={v => setHvDeviceForm({ ...hvDeviceForm, reference: v })} disabled={busy}/>
          <FieldNumber label="Voltage Class (kV)" value={hvDeviceForm.voltage_class_kv} onChange={v => setHvDeviceForm({ ...hvDeviceForm, voltage_class_kv: v })} disabled={busy}/>
          <FieldNumber label="Short-Circuit Current (kA)" value={hvDeviceForm.short_circuit_current_ka} onChange={v => setHvDeviceForm({ ...hvDeviceForm, short_circuit_current_ka: v })} disabled={busy}/>
          <FieldSelect label="Insulation Type" value={hvDeviceForm.insulation_type} options={['',...insulationTypes]} onChange={v => setHvDeviceForm({ ...hvDeviceForm, insulation_type: v })} disabled={busy}/>
          <FieldSelect label="Mechanical Endurance" value={hvDeviceForm.mechanical_endurance_class} options={['',...mechanicalEnduranceClasses]} onChange={v => setHvDeviceForm({ ...hvDeviceForm, mechanical_endurance_class: v })} disabled={busy}/>
          <FieldSelect label="Electrical Endurance" value={hvDeviceForm.electrical_endurance_class} options={['',...electricalEnduranceClasses]} onChange={v => setHvDeviceForm({ ...hvDeviceForm, electrical_endurance_class: v })} disabled={busy}/>
          <FieldNumber label="Poles" value={hvDeviceForm.poles} onChange={v => setHvDeviceForm({ ...hvDeviceForm, poles: v })} disabled={busy}/>

          {/* Downstream LV */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Downstream LV Device</label>
            <div className="relative">
              <input
                type="text"
                value={downstreamBtSuggestions.find(s => s.id === hvDeviceForm.downstream_device_id)?.name || ''}
                onFocus={() => { setShowDownstreamBtSuggestions(true); fetchBtSuggestions(''); }}
                onChange={e => { setHvDeviceForm({ ...hvDeviceForm, downstream_device_id: null }); fetchBtSuggestions(e.target.value); }}
                className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
                placeholder="Search LV device..."
                disabled={busy}
              />
              {showDownstreamBtSuggestions && (
                <ul className="absolute z-10 bg-white border rounded-lg max-h-40 overflow-y-auto w-full mt-1">
                  {downstreamBtSuggestions.map(s => (
                    <li key={s.id}
                      onClick={() => { setHvDeviceForm({ ...hvDeviceForm, downstream_device_id: s.id }); setShowDownstreamBtSuggestions(false); }}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-gray-900">
                      {s.name} {s.reference ? `(${s.reference})` : ''} {s.switchboard_name ? `— SB: ${s.switchboard_name}` : ''}
                    </li>
                  ))}
                  {downstreamBtSuggestions.length === 0 && <li className="px-3 py-2 text-gray-500">No results</li>}
                </ul>
              )}
            </div>
          </div>

          {/* Main incoming + Save */}
          <div className="sm:col-span-2 flex items-center justify-between">
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                checked={hvDeviceForm.is_main_incoming}
                onChange={e => setHvDeviceForm({ ...hvDeviceForm, is_main_incoming: e.target.checked })}
                className="rounded border-gray-300"
                disabled={busy}
              />
              <span className="ml-2 text-sm text-gray-700">Main Incoming</span>
            </label>
            <button onClick={handleHvDeviceSubmit} disabled={busy || !currentPanelId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </section>
  );
}

function FieldText({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
        className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400" disabled={disabled}/>
    </div>
  );
}
function FieldNumber({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
        disabled={disabled}
      />
    </div>
  );
}
function FieldSelect({ label, value, onChange, options, disabled }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900" disabled={disabled}>
        {options.map(o => <option key={o} value={o}>{o || 'Select...'}</option>)}
      </select>
    </div>
  );
}

function HvDeviceTree({ devices, panelId, onEdit, onDelete, level = 0 }) {
  return (
    <div className={`space-y-3 ${level > 0 ? 'ml-6 border-l border-gray-200 pl-4' : ''}`}>
      {devices.map(device => (
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
                {device.downstream_hv_equipment_id && <Pill color="blue">HV EQ #{device.downstream_hv_equipment_id}</Pill>}
                {device.downstream_device_id && <Pill color="blue">LV Device #{device.downstream_device_id}</Pill>}
              </div>
              <div className="text-xs text-gray-600 flex flex-wrap gap-3">
                <span>{device.voltage_class_kv ?? '—'} kV</span>
                <span>Isc: {device.short_circuit_current_ka ?? '—'} kA</span>
                <span>Insul: {device.insulation_type || '—'}</span>
                <span>Mech: {device.mechanical_endurance_class || '—'}</span>
                <span>Elec: {device.electrical_endurance_class || '—'}</span>
                <span>{device.poles ?? '—'}P</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => onEdit(device, panelId)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit"><Edit size={16}/></button>
              <button onClick={() => onDelete(device.id, panelId)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Delete"><Trash size={16}/></button>
            </div>
          </div>
          {device.children?.length > 0 && (
            <div className={`mt-4 pt-3 border-t border-gray-100 ${level > 1 ? 'ml-4 pl-4 border-l border-gray-300' : ''}`}>
              <HvDeviceTree devices={device.children} panelId={panelId} onEdit={onEdit} onDelete={onDelete} level={level+1}/>
            </div>
          )}
        </div>
      ))}
      {devices.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Plus size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-500">No devices yet</p>
        </div>
      )}
    </div>
  );
}
