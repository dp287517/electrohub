// src/pages/High_voltage.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Download, Plus, Search, SlidersHorizontal,
  ChevronDown, ChevronRight, ChevronLeft, X, Sparkles
} from 'lucide-react';

// Utilities
const regimes = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const hvDeviceTypes = [
  'HV Cell', 'HV Disconnect Switch', 'HV Circuit Breaker', 'Transformer',
  'HV Cable', 'Busbar', 'SEPAM Relay', 'Meter'
];
const insulationTypes = ['SF6', 'Vacuum', 'Air'];
const mechanicalEnduranceClasses = ['M1', 'M2'];
const electricalEnduranceClasses = ['E1', 'E2'];

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch {
    return '';
  }
}

function Pill({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function Tooltip({ children, content }) {
  return (
    <div className="relative inline-block group">
      <div className="peer">{children}</div>
      <div className="absolute z-10 invisible peer-hover:visible bg-gray-800 text-white text-xs rounded py-1 px-2 -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
        {content}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
      </div>
    </div>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-gray-50 gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Form shapes + mappers ----------
const emptyHvEquipmentForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  is_principal: false,
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

function rowToForm(row) {
  if (!row) return emptyHvEquipmentForm;
  return {
    name: row.name || '',
    code: row.code || '',
    meta: {
      site: row.site || '',
      building_code: row.building_code || '',
      floor: row.floor || '',
      room: row.room || ''
    },
    regime_neutral: row.regime_neutral || 'TN-S',
    is_principal: !!row.is_principal,
    modes: row.modes || {},
    quality: row.quality || {}
  };
}
function formToPayload(form, site) {
  const f = form || emptyHvEquipmentForm;
  return {
    name: f.name,
    code: f.code,
    building_code: f.meta?.building_code || '',
    floor: f.meta?.floor || '',
    room: f.meta?.room || '',
    regime_neutral: f.regime_neutral,
    is_principal: f.is_principal,
    modes: f.modes || {},
    quality: f.quality || {},
    site // utile si le backend le lit dans le body (sinon X-Site couvre)
  };
}

const emptyHvDeviceForm = {
  name: '',
  device_type: 'HV Circuit Breaker',
  manufacturer: '',
  reference: '',
  voltage_class_kv: null,
  short_circuit_current_ka: null,
  insulation_type: '',
  mechanical_endurance_class: '',
  electrical_endurance_class: '',
  poles: null,
  settings: {
    distance_zone: null,
    differential_bias: null,
    overcurrent: null,
  },
  is_main_incoming: false,
  parent_id: null,
  downstream_hv_equipment_id: null,
  downstream_device_id: null,
  pv_tests: null,
  photos: []
};

// util: construit un arbre depuis une liste plate {id,parent_id}
function buildDeviceTree(list) {
  const byId = new Map();
  list.forEach(d => byId.set(d.id, { ...d, children: [] }));
  const roots = [];
  list.forEach(d => {
    const node = byId.get(d.id);
    if (d.parent_id && byId.has(d.parent_id)) {
      byId.get(d.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export default function HighVoltage() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [allHvEquipments, setAllHvEquipments] = useState([]);
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1 });
  const [showFilters, setShowFilters] = useState(false);

  const [openHvEquipment, setOpenHvEquipment] = useState(false);
  const [editingHvEquipment, setEditingHvEquipment] = useState(null);
  const [hvEquipmentForm, setHvEquipmentForm] = useState(emptyHvEquipmentForm);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 18;

  // HV Device states
  const [expandedPanels, setExpandedPanels] = useState({});
  const [hvDevices, setHvDevices] = useState({}); // id -> tree[]
  const [openHvDevice, setOpenHvDevice] = useState(false);
  const [editingHvDevice, setEditingHvDevice] = useState(null);
  const [hvDeviceForm, setHvDeviceForm] = useState(emptyHvDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);
  const [downstreamBtSuggestions, setDownstreamBtSuggestions] = useState([]);
  const [showDownstreamBtSuggestions, setShowDownstreamBtSuggestions] = useState(false);
  const [toast, setToast] = useState(null);

  // Fetch HV equipments
  useEffect(() => {
    setBusy(true);
    api.hv.list(q)
      .then((response) => {
        if (!response) throw new Error('No data returned from API');
        const { data = [], total = 0 } = response;
        setRows(data);
        setTotal(total);
      })
      .catch(e => {
        console.error('[HV LIST ERROR]', e);
        setToast({ msg: 'Failed to load HV equipments: ' + e.message, type: 'error' });
      })
      .finally(() => setBusy(false));
  }, [q]);

  // Fetch all for suggestions
  useEffect(() => {
    api.hv.list({ pageSize: 1000 })
      .then((response) => response && setAllHvEquipments(response.data || []))
      .catch(e => console.error('[HV SUGGESTIONS ERROR]', e));
  }, []);

  // Fetch HV devices when a panel expands (build tree from flat list)
  useEffect(() => {
    Object.keys(expandedPanels).forEach(async (id) => {
      if (expandedPanels[id] && !hvDevices[id]) {
        try {
          const flat = await get(`/api/hv/equipments/${id}/devices`);
          setHvDevices(prev => ({ ...prev, [id]: buildDeviceTree(flat || []) }));
        } catch (e) {
          console.error('[HV DEVICES ERROR]', e);
          setToast({ msg: 'Failed to load devices', type: 'error' });
        }
      }
    });
  }, [expandedPanels]); // eslint-disable-line

  // Fetch LV devices for BT suggestions
  const fetchBtSuggestions = useCallback(async (query) => {
    try {
      const res = await get('/api/hv/lv-devices', { q: query });
      setDownstreamBtSuggestions(res || []);
    } catch (e) {
      console.error('[BT SUGGESTIONS ERROR]', e);
      setToast({ msg: 'Failed to load BT devices', type: 'error' });
    }
  }, []);

  // --- Submit handlers ---
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
      setToast({ msg: 'HV Equipment saved', type: 'success' });
    } catch (e) {
      console.error('[HV EQUIPMENT SUBMIT ERROR]', e);
      setToast({ msg: 'Failed to save HV Equipment: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleHvDeviceSubmit = async () => {
    if (!currentPanelId || isNaN(Number(currentPanelId))) {
      setToast({ msg: 'Invalid HV Equipment ID', type: 'error' });
      return;
    }
    try {
      setBusy(true);
      const payload = { ...hvDeviceForm };
      if (editingHvDevice) {
        const res = await api.hv.update(editingHvDevice.id, payload);
        setHvDevices(prev => ({
          ...prev,
          [currentPanelId]: buildDeviceTree(
            flattenTreeReplace(prev[currentPanelId] || [], res, editingHvDevice.id)
          )
        }));
      } else {
        const res = await api.hv.create(Number(currentPanelId), payload);
        // re-fetch flat then rebuild for consistency
        const flat = await get(`/api/hv/equipments/${currentPanelId}/devices`);
        setHvDevices(prev => ({ ...prev, [currentPanelId]: buildDeviceTree(flat || []) }));
      }
      setOpenHvDevice(false);
      setEditingHvDevice(null);
      setHvDeviceForm(emptyHvDeviceForm);
      setToast({ msg: 'HV Device saved', type: 'success' });
    } catch (e) {
      console.error('[HV DEVICE SUBMIT ERROR]', e);
      setToast({ msg: 'Failed to save HV Device: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // helper: remplace un device dans l’arbre (pour edit)
  function flattenTreeReplace(tree, newNode, targetId) {
    const flat = [];
    const walk = (nodes, parent_id = null) => {
      nodes.forEach(n => {
        const base = { ...n, parent_id };
        delete base.children;
        flat.push(base.id === targetId ? { ...base, ...newNode } : base);
        if (n.children?.length) walk(n.children, n.id);
      });
    };
    walk(tree);
    return flat;
  }

  // Handle delete
  const handleDeleteHvEquipment = async (id) => {
    try {
      setBusy(true);
      await api.hv.removeEquipment(id);
      setRows(rows.filter(r => r.id !== id));
      setToast({ msg: 'HV Equipment deleted', type: 'success' });
    } catch (e) {
      console.error('[HV EQUIPMENT DELETE ERROR]', e);
      setToast({ msg: 'Failed to delete HV Equipment: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteHvDevice = async (id, panelId) => {
    try {
      setBusy(true);
      await api.hv.remove(id);
      const flat = await get(`/api/hv/equipments/${panelId}/devices`);
      setHvDevices(prev => ({ ...prev, [panelId]: buildDeviceTree(flat || []) }));
      setToast({ msg: 'HV Device deleted', type: 'success' });
    } catch (e) {
      console.error('[HV DEVICE DELETE ERROR]', e);
      setToast({ msg: 'Failed to delete HV Device: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Handle duplicate (still stub)
  const handleDuplicateHvDevice = async () => {
    setToast({ msg: 'Duplicate not implemented', type: 'error' });
  };

  const handleSetMainHvDevice = async (id, panelId, isMain) => {
    try {
      setBusy(true);
      await api.hv.update(id, { is_main_incoming: isMain });
      const flat = await get(`/api/hv/equipments/${panelId}/devices`);
      setHvDevices(prev => ({ ...prev, [panelId]: buildDeviceTree(flat || []) }));
      setToast({ msg: isMain ? 'Set as Main' : 'Unset as Main', type: 'success' });
    } catch (e) {
      console.error('[HV SET MAIN ERROR]', e);
      setToast({ msg: 'Failed to update main status: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // IA: suggestion de specs pour Device
  const handleAISuggest = async () => {
    try {
      setBusy(true);
      const desc = {
        device_type: hvDeviceForm.device_type,
        manufacturer: hvDeviceForm.manufacturer,
        reference: hvDeviceForm.reference
      };
      const specs = await post('/api/hv/ai/specs', desc);
      setHvDeviceForm(prev => ({
        ...prev,
        ...specs,
        settings: { ...(prev.settings || {}), ...(specs?.settings || {}) }
      }));
      setToast({ msg: 'Specs suggested by AI', type: 'success' });
    } catch (e) {
      console.error('[AI SPECS ERROR]', e);
      setToast({ msg: 'AI suggestion failed: ' + e.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Render
  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">High Voltage Equipments</h1>
          <p className="text-gray-600">Manage HV cells, transformers, cables, busbars, and BT links.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-2"
            disabled={busy}
          >
            <SlidersHorizontal size={16} /> Filters
          </button>
          <button
            onClick={() => {
              setEditingHvEquipment(null);
              setHvEquipmentForm(emptyHvEquipmentForm);
              setOpenHvEquipment(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            disabled={busy}
          >
            <Plus size={16} className="inline mr-1" /> Add HV Equipment
          </button>
        </div>
      </div>

      {/* Filters (toggle) */}
      {showFilters && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-4 gap-4 bg-white p-4 border border-gray-200 rounded-xl shadow-sm">
          <div className="relative">
            <Search size={18} className="absolute top-2.5 left-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or code..."
              value={q.q}
              onChange={e => setQ({ ...q, q: e.target.value, page: 1 })}
              className="pl-10 pr-4 py-2 border rounded-lg w-full bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <input
            type="text"
            placeholder="Building..."
            value={q.building}
            onChange={e => setQ({ ...q, building: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400"
            disabled={busy}
          />
          <input
            type="text"
            placeholder="Floor..."
            value={q.floor}
            onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400"
            disabled={busy}
          />
          <input
            type="text"
            placeholder="Room..."
            value={q.room}
            onChange={e => setQ({ ...q, room: e.target.value, page: 1 })}
            className="px-4 py-2 border rounded-lg bg-white text-gray-900 placeholder-gray-400"
            disabled={busy}
          />
        </div>
      )}

      {/* List */}
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
                    <button
                      onClick={() => setExpandedPanels(prev => ({ ...prev, [row.id]: !prev[row.id] }))}
                      className="p-1 rounded hover:bg-gray-100"
                      disabled={busy}
                    >
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
                  <Tooltip content="Edit">
                    <button
                      onClick={() => {
                        setEditingHvEquipment(row);
                        setHvEquipmentForm(rowToForm(row));
                        setOpenHvEquipment(true);
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      disabled={busy}
                    >
                      <Edit size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Delete">
                    <button
                      onClick={() => handleDeleteHvEquipment(row.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      disabled={busy}
                    >
                      <Trash size={16} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              {expandedPanels[row.id] && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setEditingHvDevice(null);
                      setHvDeviceForm(emptyHvDeviceForm);
                      setCurrentPanelId(row.id);
                      setOpenHvDevice(true);
                    }}
                    className="mb-4 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    disabled={busy}
                  >
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
                    onDuplicate={handleDuplicateHvDevice}
                    onDelete={handleDeleteHvDevice}
                    onSetMain={handleSetMainHvDevice}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* HV Equipment Modal */}
      <Modal
        open={openHvEquipment}
        onClose={() => {
          setOpenHvEquipment(false);
          setEditingHvEquipment(null);
          setHvEquipmentForm(emptyHvEquipmentForm);
        }}
        title={editingHvEquipment ? 'Edit HV Equipment' : 'Add HV Equipment'}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={hvEquipmentForm.name}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, name: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Code</label>
            <input
              type="text"
              value={hvEquipmentForm.code}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, code: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Building</label>
            <input
              type="text"
              value={hvEquipmentForm.meta?.building_code || ''}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, meta: { ...(hvEquipmentForm.meta || {}), building_code: e.target.value } })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Floor</label>
            <input
              type="text"
              value={hvEquipmentForm.meta?.floor || ''}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, meta: { ...(hvEquipmentForm.meta || {}), floor: e.target.value } })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Room</label>
            <input
              type="text"
              value={hvEquipmentForm.meta?.room || ''}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, meta: { ...(hvEquipmentForm.meta || {}), room: e.target.value } })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Regime Neutral</label>
            <select
              value={hvEquipmentForm.regime_neutral}
              onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, regime_neutral: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900"
              disabled={busy}
            >
              {regimes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                checked={hvEquipmentForm.is_principal}
                onChange={e => setHvEquipmentForm({ ...hvEquipmentForm, is_principal: e.target.checked })}
                className="rounded border-gray-300"
                disabled={busy}
              />
              <span className="ml-2 text-sm text-gray-700">Principal Equipment</span>
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleHvEquipmentSubmit}
            disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* HV Device Modal */}
      <Modal
        open={openHvDevice}
        onClose={() => {
          setOpenHvDevice(false);
          setEditingHvDevice(null);
          setHvDeviceForm(emptyHvDeviceForm);
          setShowDownstreamBtSuggestions(false);
        }}
        title={editingHvDevice ? 'Edit HV Device' : 'Add HV Device'}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={hvDeviceForm.name}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, name: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Device Type</label>
            <select
              value={hvDeviceForm.device_type}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, device_type: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900"
              disabled={busy}
            >
              {hvDeviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Manufacturer</label>
            <input
              type="text"
              value={hvDeviceForm.manufacturer}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, manufacturer: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Reference</label>
            <input
              type="text"
              value={hvDeviceForm.reference}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, reference: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Voltage Class (kV)</label>
            <input
              type="number"
              value={hvDeviceForm.voltage_class_kv ?? ''}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, voltage_class_kv: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Short-Circuit Current (kA)</label>
            <input
              type="number"
              value={hvDeviceForm.short_circuit_current_ka ?? ''}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, short_circuit_current_ka: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Insulation Type</label>
            <select
              value={hvDeviceForm.insulation_type}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, insulation_type: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900"
              disabled={busy}
            >
              <option value="">Select...</option>
              {insulationTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Mechanical Endurance</label>
            <select
              value={hvDeviceForm.mechanical_endurance_class}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, mechanical_endurance_class: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900"
              disabled={busy}
            >
              <option value="">Select...</option>
              {mechanicalEnduranceClasses.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Electrical Endurance</label>
            <select
              value={hvDeviceForm.electrical_endurance_class}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, electrical_endurance_class: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900"
              disabled={busy}
            >
              <option value="">Select...</option>
              {electricalEnduranceClasses.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Poles</label>
            <input
              type="number"
              value={hvDeviceForm.poles ?? ''}
              onChange={e => setHvDeviceForm({ ...hvDeviceForm, poles: e.target.value })}
              className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Downstream BT Device</label>
            <div className="relative">
              <input
                type="text"
                value={downstreamBtSuggestions.find(s => s.id === hvDeviceForm.downstream_device_id)?.name || ''}
                onFocus={() => {
                  setShowDownstreamBtSuggestions(true);
                  fetchBtSuggestions('');
                }}
                onChange={e => {
                  setHvDeviceForm({ ...hvDeviceForm, downstream_device_id: null });
                  fetchBtSuggestions(e.target.value);
                }}
                className="mt-1 block w-full border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400"
                placeholder="Search BT device..."
                disabled={busy}
              />
              {showDownstreamBtSuggestions && (
                <ul className="absolute z-10 bg-white border rounded-lg max-h-40 overflow-y-auto w-full mt-1">
                  {downstreamBtSuggestions.map(s => (
                    <li
                      key={s.id}
                      onClick={() => {
                        setHvDeviceForm({ ...hvDeviceForm, downstream_device_id: s.id });
                        setShowDownstreamBtSuggestions(false);
                      }}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-gray-900"
                    >
                      {s.name} ({s.reference}) — SB: {s.switchboard_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="col-span-2 flex items-center justify-between">
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

            <button
              type="button"
              onClick={handleAISuggest}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              disabled={busy}
              title="Let AI suggest specs from Manufacturer / Reference"
            >
              <Sparkles size={16} /> Suggest specs (AI)
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleHvDeviceSubmit}
            disabled={busy || !currentPanelId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
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

function HvDeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0 }) {
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
                {device.downstream_device_id && <Pill color="blue">BT Device #{device.downstream_device_id}</Pill>}
              </div>
              <div className="text-xs text-gray-600 flex flex-wrap gap-3">
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>{device.voltage_class_kv ?? '—'} kV</span>
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>Isc: {device.short_circuit_current_ka ?? '—'} kA</span>
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>Insul: {device.insulation_type || '—'}</span>
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>Mech: {device.mechanical_endurance_class || '—'}</span>
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>Elec: {device.electrical_endurance_class || '—'}</span>
                <span className="flex items-center gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full"></span>{device.poles ?? '—'}P</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => onEdit(device, panelId)}
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Edit Device"
              >
                <Edit size={16} />
              </button>
              <button
                onClick={() => onDuplicate(device.id, panelId)}
                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                title="Duplicate Device"
              >
                <Copy size={16} />
              </button>
              <button
                onClick={() => onDelete(device.id, panelId)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete Device"
              >
                <Trash size={16} />
              </button>
              <button
                onClick={() => onSetMain(device.id, panelId, !device.is_main_incoming)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  device.is_main_incoming
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}
              >
                {device.is_main_incoming ? 'Unset Main' : 'Set Main'}
              </button>
            </div>
          </div>

          {device.children?.length > 0 && (
            <div className={`mt-4 pt-3 border-t border-gray-100 ${level > 1 ? 'ml-4 pl-4 border-l border-gray-300' : ''}`}>
              <HvDeviceTree
                devices={device.children}
                panelId={panelId}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onSetMain={onSetMain}
                level={level + 1}
              />
            </div>
          )}
        </div>
      ))}

      {devices.length === 0 && (
        <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Plus size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-500">No devices yet</p>
          <p className="text-xs text-gray-400">Add your first device using the button above</p>
        </div>
      )}
    </div>
  );
}
