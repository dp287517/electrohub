// src/pages/High_voltage.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle,
  ChevronDown, ChevronRight, ChevronLeft, X
} from 'lucide-react';

// Utilities (similaires à Switchboards)
const regimes = ['TN-S', 'TN-C-S', 'IT', 'TT'];
const hvDeviceTypes = [  // Adapté HV
  'HV Cell', 'HV Disconnect Switch', 'HV Circuit Breaker', 'Transformer',
  'HV Cable', 'Busbar', 'SEPAM Relay', 'Meter'
];

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
      <div className="absolute z-10 invisible peer-hover:visible bg-gray-800 text-white text-xs rounded py-1 px-2 -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
        {content}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
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
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="flex justify-end px-6 py-4 border-t bg-gray-50 gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
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

const emptyHvEquipmentForm = {  // Adapté
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  is_principal: false,
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

const emptyHvDeviceForm = {  // Adapté avec champs HV et downstream_device_id
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
  settings: {  // Adapté HV protections
    distance_zone: null,
    differential_bias: null,
    overcurrent: null,
    // ...
  },
  is_main_incoming: false,
  parent_id: null,
  downstream_hv_equipment_id: null,
  downstream_device_id: null,  // Liaison BT
  pv_tests: null,
  photos: []
};

export default function HighVoltage() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [allHvEquipments, setAllHvEquipments] = useState([]);
  const [q, setQ] = useState({ q: '', building: '', floor: '', room: '', sort: 'created_at', dir: 'desc', page: 1 });
  const [openHvEquipment, setOpenHvEquipment] = useState(false);
  const [editingHvEquipment, setEditingHvEquipment] = useState(null);
  const [hvEquipmentForm, setHvEquipmentForm] = useState(emptyHvEquipmentForm);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 18;

  // HV Device states
  const [expandedPanels, setExpandedPanels] = useState({});
  const [hvDevices, setHvDevices] = useState({});
  const [openHvDevice, setOpenHvDevice] = useState(false);
  const [editingHvDevice, setEditingHvDevice] = useState(null);
  const [hvDeviceForm, setHvDeviceForm] = useState(emptyHvDeviceForm);
  const [currentPanelId, setCurrentPanelId] = useState(null);
  const [hvDeviceReferences, setHvDeviceReferences] = useState([]);
  const [hvDeviceSearchBusy, setHvDeviceSearchBusy] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [parentSuggestions, setParentSuggestions] = useState([]);
  const [downstreamSuggestions, setDownstreamSuggestions] = useState([]);
  const [downstreamBtSuggestions, setDownstreamBtSuggestions] = useState([]);  // Suggestions BT
  const [referenceSuggestions, setReferenceSuggestions] = useState([]);
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [showDownstreamSuggestions, setShowDownstreamSuggestions] = useState(false);
  const [showDownstreamBtSuggestions, setShowDownstreamBtSuggestions] = useState(false);  // Pour BT
  const [showReferenceSuggestions, setShowReferenceSuggestions] = useState(false);

  // Fetch HV equipments
  useEffect(() => {
    setBusy(true);
    api.hv.list(q).then(({ data, total }) => {
      setRows(data);
      setTotal(total);
      setBusy(false);
    }).catch(() => setBusy(false));
  }, [q]);

  // Fetch all for suggestions
  useEffect(() => {
    api.hv.list({ pageSize: 1000 }).then(({ data }) => setAllHvEquipments(data));
  }, []);

  // Fetch LV devices for BT suggestions
  const fetchBtSuggestions = useCallback(async (query) => {
    try {
      const res = await get('/api/hv/lv-devices', { q: query });
      setDownstreamBtSuggestions(res);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // ... (Autres fetches similaires pour parents, references, etc.)

  // Form handlers (adaptés avec downstream_device_id)
  const handleHvDeviceSubmit = async () => {
    // ... Similaire à Switchboards, inclure downstream_device_id
    const payload = { ...hvDeviceForm };
    if (editingHvDevice) {
      await api.hv.update(editingHvDevice.id, payload);
    } else {
      await api.hv.create(currentPanelId, payload);
    }
    // Refresh
  };

  return (
    <section className="container-narrow py-10">
      {/* UI similaire à Switchboards, avec inputs supplémentaires pour HV champs et downstream BT */}
      {/* Dans modal device : Input pour downstream BT avec suggestions */}
      <input
        type="text"
        onFocus={() => setShowDownstreamBtSuggestions(true)}
        onChange={(e) => fetchBtSuggestions(e.target.value)}
        // ...
      />
      {showDownstreamBtSuggestions && (
        <ul>
          {downstreamBtSuggestions.map(s => (
            <li key={s.id} onClick={() => setHvDeviceForm({ ...hvDeviceForm, downstream_device_id: s.id })}>
              {s.name} ({s.reference}) - SB: {s.switchboard_name}
            </li>
          ))}
        </ul>
      )}
      {/* DeviceTree adapté avec display liens BT */}
    </section>
  );
}

function HvDeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0, site }) {
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
                {device.downstream_device_id && <Pill color="blue">BT Device #{device.downstream_device_id}</Pill>}  {/* Affichage lien BT */}
              </div>
              <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                <span>{device.voltage_class_kv || '—'} kV</span>
                <span>Isc: {device.short_circuit_current_ka || '—'} kA</span>
                <span>Insul: {device.insulation_type || '—'}</span>
                <span>Mech: {device.mechanical_endurance_class || '—'}</span>
                <span>Elec: {device.electrical_endurance_class || '—'}</span>
                <span>{device.poles || '—'}P</span>
              </div>
            </div>
            {/* Buttons similaires */}
          </div>
          {/* Children similaire */}
        </div>
      ))}
      {/* No devices message similaire */}
    </div>
  );
}
