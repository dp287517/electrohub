// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle,
  ChevronDown, ChevronRight, ChevronLeft, X
} from 'lucide-react';

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
  in_amps: null,
  icu_ka: null,
  ics_ka: null,
  poles: null,
  voltage_v: null,
  trip_unit: '',
  position_number: '',
  settings: {
    ir: null,
    tr: null,
    isd: null,
    tsd: null,
    ii: null,
    ig: null,
    tg: null,
    zsi: false,
    erms: false,
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
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [showDownstreamSuggestions, setShowDownstreamSuggestions] = useState(false);
  const [showReferenceSuggestions, setShowReferenceSuggestions] = useState(false);

  // Search inputs - CORRECTION: Parent vide par défaut
  const [parentSearchInput, setParentSearchInput] = useState('');
  const [downstreamSearchInput, setDownstreamSearchInput] = useState('');

  // Chat sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // AI Tips state
  const [aiTip, setAiTip] = useState('');
  const [aiTipLoading, setAiTipLoading] = useState(false);
  const [aiTipOpen, setAiTipOpen] = useState(false);

  // Compteur devices (amélioration 1)
  const [deviceCounts, setDeviceCounts] = useState({});

  // Toasts (amélioration 3)
  const [toast, setToast] = useState(null); // { type: 'success'|'error'|'info', msg: string }
  const notify = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // Quick AI Search (amélioration 4)
  const [quickAiQuery, setQuickAiQuery] = useState('');

  // Debounce hook
  const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);
   
    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
     
      return () => {
        clearTimeout(handler);
      };
    }, [value, delay]);
   
    return debouncedValue;
  };

  const debouncedReferenceQuery = useDebounce(deviceForm.reference, 300);
  const debouncedParentQuery = useDebounce(parentSearchInput, 300);
  const debouncedDownstreamQuery = useDebounce(downstreamSearchInput, 300);

  const loadSwitchboards = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ ...q, pageSize, site }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      setRows(data?.data || []);
      setTotal(data?.total || 0);
      // Amélioration 1 : charger les counts après les rows
      const ids = (data?.data || []).map(r => r.id);
      loadDeviceCounts(ids);
    } catch (e) {
      console.error('Load switchboards failed:', e);
      notify('Failed to load switchboards. Please refresh the page.', 'error');
    }
  };

  const loadAllSwitchboards = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ site, pageSize: 1000 }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      setAllSwitchboards(data?.data || []);
    } catch (e) {
      console.error('Load all switchboards failed:', e);
    }
  };

  const loadDevices = async (panelId) => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ switchboard_id: panelId, site }).toString();
      const data = await get(`/api/switchboard/devices?${params}`);
      setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
    } catch (e) {
      console.error('Load devices failed:', e);
    }
  };

  // Amélioration 1 : loader pour les counts
  const loadDeviceCounts = async (ids=[]) => {
    try {
      const param = ids.length ? `?ids=${ids.join(',')}&site=${encodeURIComponent(site)}`
                               : `?site=${encodeURIComponent(site)}`;
      const data = await get(`/api/switchboard/devices-count${param}`);
      setDeviceCounts(data.counts || {});
    } catch (e) {
      console.error('Load device counts failed:', e);
    }
  };

  const loadDeviceReferences = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ site }).toString();
      const data = await get(`/api/switchboard/device-references?${params}`);
      setDeviceReferences(data.data || []);
    } catch (e) {
      console.error('Load device references failed:', e);
    }
  };

  // NOUVELLE FONCTION: Charger le nom du parent pour l'édition
  const loadParentName = async (parentId) => {
    if (!parentId || !currentPanelId || !site) return '';
    try {
      const params = new URLSearchParams({
        query: '',
        switchboard_id: currentPanelId,
        site
      }).toString();
      const data = await get(`/api/switchboard/search-parents?${params}`);
      const parent = data.suggestions?.find(p => p.id === parentId);
      return parent ? `${parent.name} (${parent.manufacturer} ${parent.reference})`.trim() : '';
    } catch (e) {
      console.error('Load parent name failed:', e);
      return '';
    }
  };

  // NOUVELLE FONCTION: Charger le nom du downstream pour l'édition
  const loadDownstreamName = async (downstreamId) => {
    if (!downstreamId || !site) return '';
    try {
      const params = new URLSearchParams({ query: '', site }).toString();
      const data = await get(`/api/switchboard/search-downstreams?${params}`);
      const downstream = data.suggestions?.find(sb => sb.id === downstreamId);
      return downstream ? `${downstream.name} (${downstream.code})`.trim() : '';
    } catch (e) {
      console.error('Load downstream name failed:', e);
      return '';
    }
  };

  useEffect(() => {
    if (site) {
      loadSwitchboards();
      loadAllSwitchboards();
      loadDeviceReferences();
    }
  }, [q.page, q.sort, q.dir, q.q, q.building, q.floor, q.room, site]);

  const toggleExpand = async (panelId) => {
    const isExpanded = expandedPanels[panelId];
    setExpandedPanels(prev => ({ ...prev, [panelId]: !isExpanded }));
   
    if (!isExpanded && !devices[panelId]) {
      await loadDevices(panelId);
    }
  };

  const resetSwitchboardModal = () => {
    setEditingSwitchboard(null);
    setSwitchboardForm({
      ...emptySwitchboardForm,
      meta: { ...emptySwitchboardForm.meta, site }
    });
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
    if (!switchboardForm.name.trim() || !switchboardForm.code.trim()) {
      return notify('Name and Code are required', 'error');
    }

    setBusy(true);
    try {
      if (editingSwitchboard) {
        await put(`/api/switchboard/boards/${editingSwitchboard.id}?site=${encodeURIComponent(site)}`, switchboardForm);
        notify('Switchboard updated successfully!', 'success');
      } else {
        await post(`/api/switchboard/boards?site=${encodeURIComponent(site)}`, switchboardForm);
        notify('Switchboard created successfully!', 'success');
      }
      setOpenSwitchboard(false);
      await loadSwitchboards();
    } catch (e) {
      console.error('Save switchboard failed:', e);
      notify('Failed to save switchboard: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // CORRECTION: Suppression des confirm() - action directe avec toast
  const duplicateSwitchboard = async (id) => {
    try {
      await post(`/api/switchboard/boards/${id}/duplicate?site=${encodeURIComponent(site)}`);
      await loadSwitchboards();
      notify('Switchboard duplicated successfully!', 'success');
    } catch (e) {
      console.error('Duplicate failed:', e);
      notify('Failed to duplicate switchboard', 'error');
    }
  };

  // CORRECTION: Suppression des confirm() - action directe avec toast
  const removeSwitchboard = async (id) => {
    try {
      await del(`/api/switchboard/boards/${id}?site=${encodeURIComponent(site)}`);
      await loadSwitchboards();
      notify('Switchboard deleted successfully!', 'success');
    } catch (e) {
      console.error('Delete failed:', e);
      notify('Failed to delete switchboard', 'error');
    }
  };

  // Device functions
  const resetDeviceModal = (panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(null);
    setDeviceForm({
      ...emptyDeviceForm,
      name: '',
      position_number: ''
    });
    setPhotoFile(null);
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
    setParentSearchInput(''); // CORRECTION: Toujours vide pour création
    setDownstreamSearchInput(''); // CORRECTION: Toujours vide pour création
    setQuickAiQuery(''); // CORRECTION: Vide pour création
    setOpenDevice(true);
  };

  // CORRECTION MAJEURE: Persistance complète + chargement parent/downstream
  const onEditDevice = async (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
   
    // Charger les noms parent/downstream en parallèle
    const [parentName, downstreamName] = await Promise.all([
      loadParentName(device.parent_id),
      loadDownstreamName(device.downstream_switchboard_id)
    ]);

    const safeSettings = device.settings || {};
    
    // CORRECTION: Préserver NULL pour tous les champs
    setDeviceForm({
      name: device.name || '',
      device_type: device.device_type || 'Low Voltage Circuit Breaker',
      manufacturer: device.manufacturer || '',
      reference: device.reference || '',
      in_amps: device.in_amps !== null && device.in_amps !== undefined ? Number(device.in_amps) : null,
      icu_ka: device.icu_ka !== null && device.icu_ka !== undefined ? Number(device.icu_ka) : null,
      ics_ka: device.ics_ka !== null && device.ics_ka !== undefined ? Number(device.ics_ka) : null,
      poles: device.poles !== null && device.poles !== undefined ? Number(device.poles) : null,
      voltage_v: device.voltage_v !== null && device.voltage_v !== undefined ? Number(device.voltage_v) : null,
      trip_unit: device.trip_unit || '',
      position_number: device.position_number || '',
      settings: {
        ir: safeSettings.ir !== null && safeSettings.ir !== undefined ? Number(safeSettings.ir) : null,
        tr: safeSettings.tr !== null && safeSettings.tr !== undefined ? Number(safeSettings.tr) : null,
        isd: safeSettings.isd !== null && safeSettings.isd !== undefined ? Number(safeSettings.isd) : null,
        tsd: safeSettings.tsd !== null && safeSettings.tsd !== undefined ? Number(safeSettings.tsd) : null,
        ii: safeSettings.ii !== null && safeSettings.ii !== undefined ? Number(safeSettings.ii) : null,
        ig: safeSettings.ig !== null && safeSettings.ig !== undefined ? Number(safeSettings.ig) : null,
        tg: safeSettings.tg !== null && safeSettings.tg !== undefined ? Number(safeSettings.tg) : null,
        zsi: safeSettings.zsi !== null && safeSettings.zsi !== undefined ? Boolean(safeSettings.zsi) : false,
        erms: safeSettings.erms !== null && safeSettings.erms !== undefined ? Boolean(safeSettings.erms) : false,
        curve_type: safeSettings.curve_type || ''
      },
      is_main_incoming: Boolean(device.is_main_incoming),
      parent_id: device.parent_id || null,
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      pv_tests: null,
      photos: []
    });
   
    // CORRECTION: Parent vide par défaut, seulement suggestions si on tape
    setParentSearchInput(parentName || '');
    setDownstreamSearchInput(downstreamName || '');
    setPhotoFile(null);
    setQuickAiQuery(''); // CORRECTION: Ne pré-remplit pas automatiquement
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
    setOpenDevice(true);
  };

  const safeUploadStrip = (form) => {
    const { pv_tests, photos, ...rest } = form;
    return { ...rest, pv_tests: null, photos: [] };
  };

  const saveDevice = async () => {
    if (!deviceForm.name.trim()) {
      return notify('Device name is required', 'error');
    }
    if (deviceForm.in_amps <= 0) {
      return notify('Rated current must be greater than 0', 'error');
    }
    setBusy(true);
    try {
      const payload = {
        ...safeUploadStrip(deviceForm),
        switchboard_id: currentPanelId
      };
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}?site=${encodeURIComponent(site)}`, payload);
        notify('Device updated successfully!', 'success');
      } else {
        await post(`/api/switchboard/devices?site=${encodeURIComponent(site)}`, payload);
        notify('Device created successfully!', 'success');
      }
      setOpenDevice(false);
      setPhotoFile(null);
      await loadDevices(currentPanelId);
      await loadDeviceReferences();
    } catch (e) {
      console.error('Save device failed:', e);
      notify('Failed to save device: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // CORRECTION: Suppression des confirm() - action directe avec toast
  const duplicateDevice = async (id, panelId) => {
    try {
      await post(`/api/switchboard/devices/${id}/duplicate?site=${encodeURIComponent(site)}`);
      await loadDevices(panelId);
      await loadDeviceReferences();
      notify('Device duplicated successfully!', 'success');
    } catch (e) {
      console.error('Duplicate device failed:', e);
      notify('Failed to duplicate device', 'error');
    }
  };

  // CORRECTION: Suppression des confirm() - action directe avec toast
  const removeDevice = async (id, panelId) => {
    try {
      await del(`/api/switchboard/devices/${id}?site=${encodeURIComponent(site)}`);
      await loadDevices(panelId);
      notify('Device deleted successfully!', 'success');
    } catch (e) {
      console.error('Delete device failed:', e);
      notify('Failed to delete device', 'error');
    }
  };

  // CORRECTION: Suppression des confirm() - action directe avec toast
  const setMainDevice = async (id, panelId, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main?site=${encodeURIComponent(site)}`, { is_main_incoming: isMain });
      await loadDevices(panelId);
      getAiTip(`User set device as main incoming: ${isMain ? 'enabled' : 'disabled'}.`);
      notify(`Device ${isMain ? 'set as main incoming' : 'unset as main incoming'} successfully!`, 'success');
    } catch (e) {
      console.error('Set main failed:', e);
      notify('Failed to update main incoming status', 'error');
    }
  };

  // Fonctions de sélection des suggestions
  const selectParent = (parent) => {
    setDeviceForm(f => ({ ...f, parent_id: parent.id }));
    setParentSearchInput(`${parent.name} (${parent.manufacturer} ${parent.reference})`.trim());
    setShowParentSuggestions(false);
    notify('Parent device selected', 'success');
  };

  const selectDownstream = (sb) => {
    setDeviceForm(f => ({ ...f, downstream_switchboard_id: sb.id }));
    setDownstreamSearchInput(`${sb.name} (${sb.code})`.trim());
    setShowDownstreamSuggestions(false);
    notify('Downstream switchboard selected', 'success');
  };

  const selectReferenceSuggestion = (ref) => {
    setDeviceForm(prev => ({
      ...prev,
      manufacturer: ref.manufacturer || prev.manufacturer,
      reference: ref.reference || prev.reference,
      device_type: ref.device_type || prev.device_type,
      in_amps: ref.in_amps !== null ? Number(ref.in_amps) : prev.in_amps,
      icu_ka: ref.icu_ka !== null ? Number(ref.icu_ka) : prev.icu_ka,
      ics_ka: ref.ics_ka !== null ? Number(ref.ics_ka) : prev.ics_ka,
      poles: ref.poles !== null ? Number(ref.poles) : prev.poles,
      voltage_v: ref.voltage_v !== null ? Number(ref.voltage_v) : prev.voltage_v,
      trip_unit: ref.trip_unit || prev.trip_unit,
      settings: { ...prev.settings, curve_type: ref.settings?.curve_type || prev.settings.curve_type }
    }));
    setShowReferenceSuggestions(false);
    notify(`Device specs loaded from database`, 'success');
  };

  // Reference Search - FIXED
  const searchDeviceReference = async () => {
    if (!deviceForm.reference.trim()) {
      return notify('Please enter a reference to search', 'info');
    }
   
    setDeviceSearchBusy(true);
    try {
      const query = `${deviceForm.manufacturer || ''} ${deviceForm.reference}`.trim();
      const data = await post(`/api/switchboard/search-device?site=${encodeURIComponent(site)}`, { query });
     
      if (data && data.manufacturer) {
        setDeviceForm(prev => ({
          ...prev,
          manufacturer: data.manufacturer || prev.manufacturer,
          device_type: data.device_type || prev.device_type,
          in_amps: data.in_amps !== null ? Number(data.in_amps) : prev.in_amps,
          icu_ka: data.icu_ka !== null ? Number(data.icu_ka) : prev.icu_ka,
          ics_ka: data.ics_ka !== null ? Number(data.ics_ka) : prev.ics_ka,
          poles: data.poles !== null ? Number(data.poles) : prev.poles,
          voltage_v: data.voltage_v !== null ? Number(data.voltage_v) : prev.voltage_v,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: {
            ...prev.settings,
            ...data.settings,
            ir: data.settings?.ir !== null ? Number(data.settings.ir) : prev.settings.ir,
            tr: data.settings?.tr !== null ? Number(data.settings.tr) : prev.settings.tr,
            isd: data.settings?.isd !== null ? Number(data.settings.isd) : prev.settings.isd,
            tsd: data.settings?.tsd !== null ? Number(data.settings.tsd) : prev.settings.tsd,
            ii: data.settings?.ii !== null ? Number(data.settings.ii) : prev.settings.ii,
            ig: data.settings?.ig !== null ? Number(data.settings.ig) : prev.settings.ig,
            tg: data.settings?.tg !== null ? Number(data.settings.tg) : prev.settings.tg,
            zsi: data.settings?.zsi !== undefined ? Boolean(data.settings.zsi) : prev.settings.zsi,
            erms: data.settings?.erms !== undefined ? Boolean(data.settings.erms) : prev.settings.erms,
            curve_type: data.settings?.curve_type || prev.settings.curve_type
          },
          is_main_incoming: Boolean(data.is_main_incoming)
        }));
        setShowReferenceSuggestions(false);
        notify(`✅ AI filled all fields for ${data.manufacturer} ${data.reference}!`, 'success');
        return;
      }
     
      notify('AI search completed. No exact match found.', 'info');
     
    } catch (e) {
      console.error('AI device search failed:', e);
      notify('AI search failed, trying database search...', 'info');
    } finally {
      setDeviceSearchBusy(false);
    }
   
    // Fallback to DB search
    await searchReferencesDB(deviceForm.reference);
  };

  const searchReferencesDB = async (query) => {
    if (!query.trim()) {
      setReferenceSuggestions([]);
      setShowReferenceSuggestions(false);
      return;
    }
   
    try {
      const params = new URLSearchParams({ query, site }).toString();
      const data = await get(`/api/switchboard/search-references?${params}`);
      setReferenceSuggestions(data.suggestions || []);
      setShowReferenceSuggestions(true);
     
      if (data.auto_fill) {
        const autoFill = data.auto_fill;
        setDeviceForm(prev => ({
          ...prev,
          manufacturer: autoFill.manufacturer || prev.manufacturer,
          reference: autoFill.reference || prev.reference,
          device_type: autoFill.device_type || prev.device_type,
          in_amps: autoFill.in_amps !== null ? Number(autoFill.in_amps) : prev.in_amps,
          icu_ka: autoFill.icu_ka !== null ? Number(autoFill.icu_ka) : prev.icu_ka,
          ics_ka: autoFill.ics_ka !== null ? Number(autoFill.ics_ka) : prev.ics_ka,
          poles: autoFill.poles !== null ? Number(autoFill.poles) : prev.poles,
          voltage_v: autoFill.voltage_v !== null ? Number(autoFill.voltage_v) : prev.voltage_v,
          trip_unit: autoFill.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, curve_type: autoFill.settings?.curve_type || prev.settings.curve_type }
        }));
        notify(`✅ Auto-filled from database: ${autoFill.manufacturer} ${autoFill.reference}`, 'success');
      }
    } catch (e) {
      console.error('Database reference search failed:', e);
    }
  };

  // Quick AI Search (amélioration 4)
  const quickAiSearch = async () => {
    if (!quickAiQuery.trim()) return notify('Enter a query first', 'info');
    setDeviceSearchBusy(true);
    try {
      const data = await post(`/api/switchboard/search-device?site=${encodeURIComponent(site)}`, { query: quickAiQuery });
      if (data && data.manufacturer) {
        setDeviceForm(prev => ({
          ...prev,
          manufacturer: data.manufacturer || prev.manufacturer,
          reference: data.reference || prev.reference,
          device_type: data.device_type || prev.device_type,
          in_amps: data.in_amps !== null ? Number(data.in_amps) : prev.in_amps,
          icu_ka: data.icu_ka !== null ? Number(data.icu_ka) : prev.icu_ka,
          ics_ka: data.ics_ka !== null ? Number(data.ics_ka) : prev.ics_ka,
          poles: data.poles !== null ? Number(data.poles) : prev.poles,
          voltage_v: data.voltage_v !== null ? Number(data.voltage_v) : prev.voltage_v,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: {
            ...prev.settings,
            ir: data.settings?.ir !== null ? Number(data.settings.ir) : prev.settings.ir,
            tr: data.settings?.tr !== null ? Number(data.settings.tr) : prev.settings.tr,
            isd: data.settings?.isd !== null ? Number(data.settings.isd) : prev.settings.isd,
            tsd: data.settings?.tsd !== null ? Number(data.settings.tsd) : prev.settings.tsd,
            ii: data.settings?.ii !== null ? Number(data.settings.ii) : prev.settings.ii,
            ig: data.settings?.ig !== null ? Number(data.settings.ig) : prev.settings.ig,
            tg: data.settings?.tg !== null ? Number(data.settings.tg) : prev.settings.tg,
            zsi: data.settings?.zsi !== undefined ? Boolean(data.settings.zsi) : prev.settings.zsi,
            erms: data.settings?.erms !== undefined ? Boolean(data.settings.erms) : prev.settings.erms,
            curve_type: data.settings?.curve_type || prev.settings.curve_type
          }
        }));
        notify(`AI filled specs for ${data.manufacturer} ${data.reference}`, 'success');
      } else {
        notify('AI search done but no exact match', 'info');
      }
    } catch (e) {
      console.error(e);
      notify('AI search failed', 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  // CORRECTION MAJEURE: Analyse photo avec pré-remplissage Quick AI Search
  const analyzePhoto = async () => {
    if (!photoFile) {
      return notify('Please select a photo first', 'info');
    }
    setDeviceSearchBusy(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      const switchboardIdParam = currentPanelId && Number.isInteger(currentPanelId) ? `&switchboard_id=${encodeURIComponent(currentPanelId)}` : '';
      const response = await fetch(`/api/switchboard/analyze-photo?site=${encodeURIComponent(site)}${switchboardIdParam}`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await response.json();
      if (data.error) {
        notify(`Photo analysis failed: ${data.error}`, 'error');
        return;
      }
      // Pré-remplir uniquement Quick AI Search avec manufacturer + reference
      if (data.manufacturer && data.reference) {
        const quickQuery = `${data.manufacturer} ${data.reference}`.trim();
        setQuickAiQuery(quickQuery);
        notify(`✅ Photo analyzed! Quick AI Search ready: "${quickQuery}". Click "Search (AI)" to complete fields.`, 'success');
      } else {
        notify('Photo analyzed but no clear manufacturer or reference identified.', 'info');
      }
      // Si un device a été créé automatiquement, recharger les devices
      if (data.created) {
        await loadDevices(currentPanelId);
        notify(`✅ Created new device: ${data.manufacturer} ${data.reference}. Added to switchboard!`, 'success');
        setOpenDevice(false);
      }
      setPhotoFile(null);
    } catch (e) {
      console.error('Photo analysis failed:', e);
      notify('Photo analysis failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  // AI Tip function
  const getAiTip = async (context) => {
    if (!context) return;
    setAiTipLoading(true);
    try {
      const response = await post(`/api/switchboard/ai-tip?site=${encodeURIComponent(site)}`, { query: context });
      setAiTip(response.tip || 'No tip available');
      setAiTipOpen(true);
    } catch (e) {
      console.error('AI tip failed:', e);
      setAiTip('AI tip unavailable');
    } finally {
      setAiTipLoading(false);
    }
  };

  // Chat functions
  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatBusy) return;
    
    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatInput('');
    setChatBusy(true);
    
    try {
      const response = await post(`/api/switchboard/ai-tip?site=${encodeURIComponent(site)}`, { 
        query: `Electrical engineering question: ${userMessage}` 
      });
      const aiResponse = response.tip || 'Sorry, I could not generate a response.';
      setChatMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
    } catch (e) {
      console.error('Chat failed:', e);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
    } finally {
      setChatBusy(false);
    }
  };

  // Search handlers
  useEffect(() => {
    if (debouncedParentQuery && currentPanelId) {
      const searchParents = async () => {
        try {
          const params = new URLSearchParams({
            query: debouncedParentQuery,
            switchboard_id: currentPanelId,
            site
          }).toString();
          const data = await get(`/api/switchboard/search-parents?${params}`);
          setParentSuggestions(data.suggestions || []);
          setShowParentSuggestions(true);
        } catch (e) {
          console.error('Parent search failed:', e);
        }
      };
      searchParents();
    } else {
      setParentSuggestions([]);
      setShowParentSuggestions(false);
    }
  }, [debouncedParentQuery, currentPanelId, site]);

  useEffect(() => {
    if (debouncedDownstreamQuery) {
      const searchDownstreams = async () => {
        try {
          const params = new URLSearchParams({
            query: debouncedDownstreamQuery,
            site
          }).toString();
          const data = await get(`/api/switchboard/search-downstreams?${params}`);
          setDownstreamSuggestions(data.suggestions || []);
          setShowDownstreamSuggestions(true);
        } catch (e) {
          console.error('Downstream search failed:', e);
        }
      };
      searchDownstreams();
    } else {
      setDownstreamSuggestions([]);
      setShowDownstreamSuggestions(false);
    }
  }, [debouncedDownstreamQuery, site]);

  useEffect(() => {
    searchReferencesDB(debouncedReferenceQuery);
  }, [debouncedReferenceQuery, site]);

  // Render
  return (
    <section className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Switchboards</h1>
          <p className="text-gray-600 mt-1">Manage electrical switchboards and devices</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={resetSwitchboardModal}
            className="btn bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-xl transition-all"
          >
            <Plus size={18} className="mr-2" /> Add Switchboard
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            <Search size={18} /> AI Assistant
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <input
              type="text"
              value={q.q}
              onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))}
              placeholder="Name or code..."
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Building</label>
            <input
              type="text"
              value={q.building}
              onChange={e => setQ(prev => ({ ...prev, building: e.target.value, page: 1 }))}
              placeholder="Building code..."
              className="input w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={q.floor}
                onChange={e => setQ(prev => ({ ...prev, floor: e.target.value, page: 1 }))}
                placeholder="Floor..."
                className="input flex-1"
              />
              <input
                type="text"
                value={q.room}
                onChange={e => setQ(prev => ({ ...prev, room: e.target.value, page: 1 }))}
                placeholder="Room..."
                className="input flex-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Switchboards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rows.map(row => (
          <div key={row.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-all">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-gray-900 truncate">{row.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{row.code}</p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <button
                    onClick={() => onEditSwitchboard(row)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => duplicateSwitchboard(row.id)}
                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => removeSwitchboard(row.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Location</span>
                  <span>{`${row.meta.building_code || '—'} / ${row.meta.floor || '—'} / ${row.meta.room || '—'}`}</span>
                </div>
                {row.regime_neutral && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Neutral</span>
                    <span className="font-medium">{row.regime_neutral}</span>
                  </div>
                )}
                {row.is_principal && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type</span>
                    <Pill color="green">Principal</Pill>
                  </div>
                )}
                <div className="flex justify-between pt-3 border-t border-gray-100">
                  <span className="text-gray-500">Created</span>
                  <span className="text-xs text-gray-400">{new Date(row.created_at).toLocaleDateString()}</span>
                </div>
                {/* Amélioration 1: Compteur devices */}
                <div className="flex justify-between pt-2">
                  <span className="text-gray-500">Devices</span>
                  <span className="font-medium">{deviceCounts[row.id] || 0}</span>
                </div>
              </div>
              
              {/* CORRECTION MAJEURE: Bouton Add Device + Toggle Expand */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => resetDeviceModal(row.id)}
                  className="flex-1 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium text-blue-700"
                >
                  <Plus size={16} /> Add Device
                </button>
                <button
                  onClick={() => toggleExpand(row.id)}
                  className="px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                >
                  {expandedPanels[row.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {expandedPanels[row.id] ? 'Hide' : 'Show'} Devices
                </button>
              </div>
            </div>
            
            {/* Devices Panel */}
            {expandedPanels[row.id] && (
              <div className="border-t border-gray-200 bg-gray-50">
                <DeviceTree 
                  devices={devices[row.id] || []} 
                  panelId={row.id} 
                  onEdit={onEditDevice}
                  onDuplicate={duplicateDevice}
                  onDelete={removeDevice}
                  onSetMain={setMainDevice}
                  level={0}
                  site={site}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-8">
          <div className="text-sm text-gray-700">
            Showing {(q.page - 1) * pageSize + 1} to {Math.min(q.page * pageSize, total)} of {total} results
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQ(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={q.page === 1}
              className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 bg-gray-100 rounded text-sm">{q.page}</span>
            <button
              onClick={() => setQ(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={q.page * pageSize >= total}
              className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit Switchboard' : 'New Switchboard'}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
              <input
                type="text"
                value={switchboardForm.name}
                onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))}
                className="input w-full"
                placeholder="Switchboard name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Code *</label>
              <input
                type="text"
                value={switchboardForm.code}
                onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))}
                className="input w-full"
                placeholder="Unique code"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Building</label>
              <input
                type="text"
                value={switchboardForm.meta.building_code}
                onChange={e => setSwitchboardForm(f => ({ 
                  ...f, 
                  meta: { ...f.meta, building_code: e.target.value } 
                }))}
                className="input w-full"
                placeholder="Building code"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Floor</label>
              <input
                type="text"
                value={switchboardForm.meta.floor}
                onChange={e => setSwitchboardForm(f => ({ 
                  ...f, 
                  meta: { ...f.meta, floor: e.target.value } 
                }))}
                className="input w-full"
                placeholder="Floor level"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Room</label>
              <input
                type="text"
                value={switchboardForm.meta.room}
                onChange={e => setSwitchboardForm(f => ({ 
                  ...f, 
                  meta: { ...f.meta, room: e.target.value } 
                }))}
                className="input w-full"
                placeholder="Room number"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Neutral Regime</label>
              <select
                value={switchboardForm.regime_neutral}
                onChange={e => setSwitchboardForm(f => ({ ...f, regime_neutral: e.target.value }))}
                className="input w-full"
              >
                {regimes.map(regime => (
                  <option key={regime} value={regime}>{regime}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={switchboardForm.is_principal}
                  onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="text-sm font-medium text-gray-700">Principal Switchboard</span>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              onClick={() => setOpenSwitchboard(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-xl disabled:opacity-50 transition-all"
              disabled={busy || !switchboardForm.name.trim() || !switchboardForm.code.trim()}
              onClick={saveSwitchboard}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Saving...
                </span>
              ) : editingSwitchboard ? 'Update Switchboard' : 'Create Switchboard'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'New Device'}>
        <div className="space-y-6">
          {/* Photo Upload + Quick AI Search */}
          <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-end">
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload Device Photo</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <button
                    onClick={analyzePhoto}
                    disabled={deviceSearchBusy || !photoFile}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-50"
                  >
                    {deviceSearchBusy ? 'Analyzing...' : 'Analyze Photo'}
                  </button>
                </div>
                {photoFile && (
                  <p className="text-xs text-gray-500 mt-1">Selected: {photoFile.name}</p>
                )}
              </div>
              <div className="lg:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Quick AI Search</label>
                <div className="relative">
                  <input
                    value={quickAiQuery}
                    onChange={e => setQuickAiQuery(e.target.value)}
                    placeholder="e.g. Schneider LV429310 100A MCCB"
                    className="input w-full pr-10"
                  />
                  <button
                    onClick={quickAiSearch}
                    disabled={deviceSearchBusy || !quickAiQuery.trim()}
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 p-1 text-indigo-600 hover:bg-indigo-100 rounded disabled:opacity-50"
                    title="AI Complete Fields"
                  >
                    <Search size={16} />
                  </button>
                </div>
                {deviceSearchBusy && (
                  <p className="text-xs text-indigo-600 mt-1 flex items-center gap-1">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600"></div>
                    AI searching...
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Device Name</label>
              <input
                type="text"
                value={deviceForm.name}
                onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
                className="input w-full"
                placeholder="Device name (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Position Number</label>
              <input
                type="text"
                value={deviceForm.position_number}
                onChange={e => setDeviceForm(f => ({ ...f, position_number: e.target.value }))}
                className="input w-full"
                placeholder="e.g., Slot 12 or A3 (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Device Type</label>
              <select
                value={deviceForm.device_type}
                onChange={e => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}
                className="input w-full"
              >
                {deviceTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Manufacturer</label>
              <input
                type="text"
                value={deviceForm.manufacturer}
                onChange={e => setDeviceForm(f => ({ ...f, manufacturer: e.target.value }))}
                className="input w-full pr-8"
                placeholder="Schneider"
              />
              <button
                onClick={searchDeviceReference}
                disabled={deviceSearchBusy || !deviceForm.reference.trim()}
                className="absolute right-2 top-9 transform -translate-y-1/2 p-1 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
                title="AI Search"
              >
                <Search size={14} />
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Reference *</label>
              <input
                type="text"
                value={deviceForm.reference}
                onChange={e => setDeviceForm(f => ({ ...f, reference: e.target.value }))}
                className="input w-full"
                placeholder="LV429310"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rated Current (A) *</label>
              <input
                type="number"
                min="0"
                value={deviceForm.in_amps ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, in_amps: e.target.value === '' ? null : Number(e.target.value) }))}
                className="input w-full"
                placeholder="100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Breaking Capacity Icu (kA)</label>
              <input
                type="number"
                step="0.1"
                value={deviceForm.icu_ka ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, icu_ka: e.target.value === '' ? null : Number(e.target.value) }))}
                className="input w-full"
                placeholder="25"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ics (kA)</label>
              <input
                type="number"
                step="0.1"
                value={deviceForm.ics_ka ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, ics_ka: e.target.value === '' ? null : Number(e.target.value) }))}
                className="input w-full"
                placeholder="20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Poles</label>
              <input
                type="number"
                min="1"
                value={deviceForm.poles ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, poles: e.target.value === '' ? null : Number(e.target.value) }))}
                className="input w-full"
                placeholder="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Voltage (V)</label>
              <input
                type="number"
                value={deviceForm.voltage_v ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, voltage_v: e.target.value === '' ? null : Number(e.target.value) }))}
                className="input w-full"
                placeholder="400"
              />
            </div>
          </div>

          {/* Parent Device Search - CORRECTION: Vide par défaut */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Parent Device (Upstream)</label>
            <div className="relative">
              <input
                type="text"
                value={parentSearchInput}
                onChange={e => {
                  setParentSearchInput(e.target.value);
                  setDeviceForm(f => ({ ...f, parent_id: null }));
                  setShowParentSuggestions(e.target.value.trim().length > 0); // CORRECTION: Seulement si on tape
                }}
                onFocus={() => {
                  if (parentSearchInput.trim().length > 0) {
                    setShowParentSuggestions(true);
                  }
                }}
                className="input w-full pr-8"
                placeholder="Search parent device... (optional)"
              />
              <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              {showParentSuggestions && parentSuggestions.length > 0 && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {parentSuggestions.map((parent, idx) => (
                    <div
                      key={idx}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectParent(parent)}
                    >
                      <div className="font-medium text-sm">{parent.name}</div>
                      <div className="text-xs text-gray-500 flex gap-2">
                        <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{parent.device_type}</span>
                        <span>{parent.manufacturer} {parent.reference}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Downstream Switchboard Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Downstream Switchboard</label>
            <div className="relative">
              <input
                type="text"
                value={downstreamSearchInput}
                onChange={e => {
                  setDownstreamSearchInput(e.target.value);
                  setDeviceForm(f => ({ ...f, downstream_switchboard_id: null }));
                  setShowDownstreamSuggestions(e.target.value.trim().length > 0);
                }}
                onFocus={() => {
                  if (downstreamSearchInput.trim().length > 0) {
                    setShowDownstreamSuggestions(true);
                  }
                }}
                className="input w-full pr-8"
                placeholder="Search downstream switchboard... (optional)"
              />
              <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              {showDownstreamSuggestions && downstreamSuggestions.length > 0 && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {downstreamSuggestions.map((sb, idx) => (
                    <div
                      key={idx}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectDownstream(sb)}
                    >
                      <div className="font-medium text-sm">{sb.name}</div>
                      <div className="text-xs text-gray-500 flex gap-2">
                        <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{sb.code}</span>
                        <span>{sb.building_code}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reference Suggestions */}
            {showReferenceSuggestions && referenceSuggestions.length > 0 && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 mb-2">Similar devices found:</p>
                <div className="space-y-1 max-h-20 overflow-y-auto">
                  {referenceSuggestions.map((ref, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2 bg-white rounded border cursor-pointer hover:bg-blue-50"
                      onClick={() => selectReferenceSuggestion(ref)}
                    >
                      {ref.manufacturer} {ref.reference} ({ref.in_amps}A, {ref.device_type})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Incoming with AI Tip */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 cursor-pointer flex-1" onClick={() => {
                const isMain = !deviceForm.is_main_incoming;
                setDeviceForm(f => ({ ...f, is_main_incoming: isMain }));
                getAiTip(`User set device as main incoming: ${isMain ? 'enabled' : 'disabled'}. Provide advice on next steps.`);
              }}>
                <input
                  type="checkbox"
                  checked={deviceForm.is_main_incoming}
                  onChange={() => {}} // Handled by parent div click
                  className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="font-medium text-blue-900">Main Incoming Device</span>
              </div>
              {aiTip && (
                <button
                  className="text-blue-600 hover:text-blue-700 text-sm ml-auto"
                  onClick={() => setAiTipOpen(!aiTipOpen)}
                >
                  {aiTipOpen ? 'Hide' : 'AI Tip'}
                </button>
              )}
              {aiTipOpen && (
                <div className="ml-auto bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72 absolute right-0 mt-2 z-10">
                  <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{aiTip}</p>
                  <button
                    className="text-xs text-gray-500 hover:text-gray-700 w-full text-left"
                    onClick={() => setAiTipOpen(false)}
                  >
                    Close tip
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Protection Settings */}
          <div className="md:col-span-2">
            <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-1">
              Protection Settings
              <HelpCircle size={14} className="text-gray-400" />
            </h4>
            <Tooltip content="Basic LSIG protection parameters">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Ir (xIn)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    className="input text-sm"
                    value={deviceForm.settings.ir ?? ''}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, ir: e.target.value === '' ? null : Number(e.target.value) }
                    }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Tr (s)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="input text-sm"
                    value={deviceForm.settings.tr ?? ''}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, tr: e.target.value === '' ? null : Number(e.target.value) }
                    }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Isd (xIr)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    className="input text-sm"
                    value={deviceForm.settings.isd ?? ''}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, isd: e.target.value === '' ? null : Number(e.target.value) }
                    }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Curve Type</label>
                  <input
                    className="input text-sm"
                    value={deviceForm.settings.curve_type}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, curve_type: e.target.value }
                    }))}
                    placeholder="B/C/D"
                  />
                </div>
              </div>
            </Tooltip>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              onClick={() => setOpenDevice(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-xl disabled:opacity-50 transition-all"
              disabled={busy || !deviceForm.name.trim() || deviceForm.in_amps <= 0}
              onClick={saveDevice}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Saving...
                </span>
              ) : editingDevice ? 'Update Device' : 'Create Device'}
            </button>
          </div>
        </div>
      </Modal>

      {/* AI Assistant Sidebar - amélioration 6 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)}>
          <div
            className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl transform transition-transform duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-purple-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Search size={20} className="text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">AI Assistant</h3>
                  <p className="text-xs text-gray-500">Ask about devices & standards</p>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
           
            <div className="p-4 overflow-y-auto overscroll-contain h-[calc(100vh-140px)] space-y-4">
              {chatMessages.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Search size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-sm mb-2">Ask me anything about electrical engineering</p>
                  <div className="text-xs text-gray-400 space-y-1">
                    <div>"Find Schneider 100A MCCB specs"</div>
                    <div>"What is TN-S grounding?"</div>
                    <div>"MCB vs MCCB differences"</div>
                  </div>
                </div>
              ) : (
                chatMessages.map((message, idx) => (
                  <div
                    key={idx}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] p-3 rounded-xl ${
                        message.role === 'user'
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
                    </div>
                  </div>
                ))
              )}
             
              {chatBusy && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 p-3 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                      <span className="text-sm text-gray-500">AI Assistant is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Amélioration 6 : footer sticky pour mobile */}
            <div className="p-4 border-t border-gray-200 sticky bottom-0 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2">
                <input
                  className="input flex-1 pr-10"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && !chatBusy && sendChatMessage()}
                  placeholder="Ask about devices, standards, configurations..."
                  disabled={chatBusy}
                  onFocus={e => { e.currentTarget.scrollIntoView({ block:'nearest', behavior:'smooth' }); }}
                />
                <Search size={16} className="absolute right-12 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
                <button
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${
                    chatBusy || !chatInput.trim()
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white'
                  }`}
                  disabled={chatBusy || !chatInput.trim()}
                  onClick={sendChatMessage}
                >
                  {chatBusy ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Amélioration 3 : UI des toasts */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm
          ${toast.type==='success' ? 'bg-green-600 text-white' :
            toast.type==='error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </section>
  );
}

function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0, site }) {
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
                {device.is_main_incoming && (
                  <Pill color="green">MAIN INCOMING</Pill>
                )}
                {device.downstream_switchboard_id && (
                  <Pill color="blue">SB #{device.downstream_switchboard_id}</Pill>
                )}
              </div>
              <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  {device.in_amps || '—'}A
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  Icu: {device.icu_ka || '—'}kA
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  {device.poles || '—'}P
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  Pos: {device.position_number || '—'}
                </span>
                {device.settings?.curve_type && (
                  <span className="flex items-center gap-1">
                    <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                    {device.settings.curve_type}
                  </span>
                )}
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
         
          {/* Children */}
          {device.children && device.children.length > 0 && (
            <div className={`mt-4 pt-3 border-t border-gray-100 ${level > 1 ? 'ml-4 pl-4 border-l border-gray-300' : ''}`}>
              <DeviceTree
                devices={device.children}
                panelId={panelId}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onSetMain={onSetMain}
                level={level + 1}
                site={site}
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
