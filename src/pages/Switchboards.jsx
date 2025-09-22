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
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [showDownstreamSuggestions, setShowDownstreamSuggestions] = useState(false);
  const [showReferenceSuggestions, setShowReferenceSuggestions] = useState(false);

  // Search inputs
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

  const duplicateSwitchboard = async (id) => {
    if (!confirm('Duplicate this switchboard and all its devices?')) return;
    try {
      await post(`/api/switchboard/boards/${id}/duplicate?site=${encodeURIComponent(site)}`);
      await loadSwitchboards();
      notify('Switchboard duplicated successfully!', 'success');
    } catch (e) {
      console.error('Duplicate failed:', e);
      notify('Failed to duplicate switchboard', 'error');
    }
  };

  const removeSwitchboard = async (id) => {
    if (!confirm('Delete this switchboard and all its devices? This cannot be undone.')) return;
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
    setDeviceForm({ ...emptyDeviceForm, name: '' });
    setPhotoFile(null);
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
    setParentSearchInput('');
    setDownstreamSearchInput('');
    setQuickAiQuery('');
    setOpenDevice(true);
  };

  const onEditDevice = (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
   
    const safeSettings = device.settings || {};
    setDeviceForm({
      name: device.name || '',
      device_type: device.device_type || 'Low Voltage Circuit Breaker',
      manufacturer: device.manufacturer || '',
      reference: device.reference || '',
      in_amps: Number(device.in_amps) || 0,
      icu_kA: Number(device.icu_kA) || 0,
      ics_kA: Number(device.ics_kA) || 0,
      poles: Number(device.poles) || 3,
      voltage_V: Number(device.voltage_V) || 400,
      trip_unit: device.trip_unit || '',
      settings: {
        ir: Number(safeSettings.ir) || 1,
        tr: Number(safeSettings.tr) || 10,
        isd: Number(safeSettings.isd) || 6,
        tsd: Number(safeSettings.tsd) || 0.1,
        ii: Number(safeSettings.ii) || 10,
        ig: Number(safeSettings.ig) || 0.5,
        tg: Number(safeSettings.tg) || 0.2,
        zsi: Boolean(safeSettings.zsi),
        erms: Boolean(safeSettings.erms),
        curve_type: safeSettings.curve_type || ''
      },
      is_main_incoming: Boolean(device.is_main_incoming),
      parent_id: device.parent_id || null,
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      pv_tests: null,
      photos: []
    });
   
    setParentSearchInput(device.name || '');
    setDownstreamSearchInput('');
    setPhotoFile(null);
    setQuickAiQuery('');
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

  const duplicateDevice = async (id, panelId) => {
    if (!confirm('Duplicate this device?')) return;
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

  const removeDevice = async (id, panelId) => {
    if (!confirm('Delete this device? This cannot be undone.')) return;
    try {
      await del(`/api/switchboard/devices/${id}?site=${encodeURIComponent(site)}`);
      await loadDevices(panelId);
      notify('Device deleted successfully!', 'success');
    } catch (e) {
      console.error('Delete device failed:', e);
      notify('Failed to delete device', 'error');
    }
  };

  const setMainDevice = async (id, panelId, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main?site=${encodeURIComponent(site)}`, { is_main_incoming: isMain });
      await loadDevices(panelId);
      getAiTip(`User set device as main incoming: ${isMain ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      console.error('Set main failed:', e);
      notify('Failed to update main incoming status', 'error');
    }
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
          in_amps: Number(data.in_amps) || prev.in_amps,
          icu_kA: Number(data.icu_kA) || prev.icu_kA,
          ics_kA: Number(data.ics_kA) || prev.ics_kA,
          poles: Number(data.poles) || prev.poles,
          voltage_V: Number(data.voltage_V) || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: {
            ...prev.settings,
            ...data.settings,
            ir: Number(data.settings?.ir) || prev.settings.ir,
            tr: Number(data.settings?.tr) || prev.settings.tr,
            isd: Number(data.settings?.isd) || prev.settings.isd,
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
          in_amps: Number(autoFill.in_amps) || prev.in_amps,
          icu_kA: Number(autoFill.icu_kA) || prev.icu_kA,
          ics_kA: Number(autoFill.ics_kA) || prev.ics_kA,
          poles: Number(autoFill.poles) || prev.poles,
          voltage_V: Number(autoFill.voltage_V) || prev.voltage_V,
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
          in_amps: Number(data.in_amps) || prev.in_amps,
          icu_kA: Number(data.icu_kA) || prev.icu_kA,
          ics_kA: Number(data.ics_kA) || prev.ics_kA,
          poles: Number(data.poles) || prev.poles,
          voltage_V: Number(data.voltage_V) || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, ...data.settings }
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

  // Photo analysis - FIXED
  const analyzePhoto = async () => {
    if (!photoFile) {
      return notify('Please select a photo first', 'info');
    }
   
    setDeviceSearchBusy(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
     
      const response = await fetch(`/api/switchboard/analyze-photo?site=${encodeURIComponent(site)}&switchboard_id=${encodeURIComponent(currentPanelId || '')}`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
     
      const data = await response.json();
     
      if (data.error) {
        notify(`Photo analysis failed: ${data.error}`, 'error');
        return;
      }
     
      if (data.existing_id) {
        // Existing device found, load it
        setDeviceForm(prev => ({
          ...prev,
          name: data.name || prev.name,
          manufacturer: data.manufacturer || prev.manufacturer,
          reference: data.reference || prev.reference,
          device_type: data.device_type || prev.device_type,
          in_amps: Number(data.in_amps) || prev.in_amps,
          icu_kA: Number(data.icu_kA) || prev.icu_kA,
          ics_kA: Number(data.ics_kA) || prev.ics_kA,
          poles: Number(data.poles) || prev.poles,
          voltage_V: Number(data.voltage_V) || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, ...data.settings },
          is_main_incoming: Boolean(data.is_main_incoming)
        }));
        notify(`✅ Found existing device: ${data.manufacturer} ${data.reference}. Form pre-filled!`, 'success');
      } else if (data.created) {
        // New device created successfully
        await loadDevices(currentPanelId);
        notify(`✅ Created new device: ${data.manufacturer} ${data.reference}. Added to switchboard!`, 'success');
        setOpenDevice(false);
      } else if (data.requires_switchboard) {
        // Specs ready, but needs switchboard - prefill form
        setDeviceForm(prev => ({
          ...prev,
          name: data.name || data.reference || prev.name,
          manufacturer: data.manufacturer || prev.manufacturer,
          reference: data.reference || prev.reference,
          device_type: data.device_type || prev.device_type,
          in_amps: Number(data.in_amps) || prev.in_amps,
          icu_kA: Number(data.icu_kA) || prev.icu_kA,
          ics_kA: Number(data.ics_kA) || prev.ics_kA,
          poles: Number(data.poles) || prev.poles,
          voltage_V: Number(data.voltage_V) || prev.voltage_V,
          trip_unit: data.trip_unit || prev.trip_unit,
          settings: { ...prev.settings, ...data.settings }
        }));
        notify(`✅ Photo analyzed! Form pre-filled with: ${data.manufacturer} ${data.reference}. Ready to save.`, 'success');
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
    if (debouncedReferenceQuery) {
      searchReferencesDB(debouncedReferenceQuery);
    }
  }, [debouncedReferenceQuery]);

  const selectParent = (parent) => {
    setDeviceForm(prev => ({ ...prev, parent_id: parent.id }));
    setParentSearchInput(parent.name);
    setShowParentSuggestions(false);
  };

  const selectDownstream = (switchboard) => {
    setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: switchboard.id }));
    setDownstreamSearchInput(switchboard.name);
    setShowDownstreamSuggestions(false);
  };

  const selectReferenceSuggestion = (ref) => {
    setDeviceForm(prev => ({
      ...prev,
      manufacturer: ref.manufacturer || prev.manufacturer,
      reference: ref.reference || prev.reference,
      device_type: ref.device_type || prev.device_type,
      in_amps: Number(ref.in_amps) || prev.in_amps,
      icu_kA: Number(ref.icu_kA) || prev.icu_kA,
      ics_kA: Number(ref.ics_kA) || prev.ics_kA,
      poles: Number(ref.poles) || prev.poles,
      voltage_V: Number(ref.voltage_V) || prev.voltage_V,
      trip_unit: ref.trip_unit || prev.trip_unit,
      settings: { ...prev.settings, ...ref.settings }
    }));
    setShowReferenceSuggestions(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatBusy) return;
   
    const userMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setChatBusy(true);
   
    try {
      const response = await post(`/api/switchboard/ai-tip?site=${encodeURIComponent(site)}`, {
        query: chatInput
      });
      const aiMessage = { role: 'assistant', content: response.tip || 'Sorry, I could not generate a response.' };
      setChatMessages(prev => [...prev, aiMessage]);
    } catch (e) {
      console.error('Chat failed:', e);
      const errorMessage = { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <section className="p-6 max-w-7xl mx-auto">
      {/* Header avec bouton Add Device */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Switchboards</h1>
          <p className="text-gray-600 mt-1">Manage your electrical distribution boards</p>
        </div>
        <button
          onClick={resetSwitchboardModal}
          className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
        >
          <Plus size={20} />
          Add Switchboard
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search switchboards..."
              value={q.q}
              onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))}
              className="input pl-10 w-full"
            />
          </div>
          <input
            type="text"
            placeholder="Building"
            value={q.building}
            onChange={e => setQ(prev => ({ ...prev, building: e.target.value, page: 1 }))}
            className="input w-full"
          />
          <input
            type="text"
            placeholder="Floor"
            value={q.floor}
            onChange={e => setQ(prev => ({ ...prev, floor: e.target.value, page: 1 }))}
            className="input w-full"
          />
          <input
            type="text"
            placeholder="Room"
            value={q.room}
            onChange={e => setQ(prev => ({ ...prev, room: e.target.value, page: 1 }))}
            className="input w-full"
          />
        </div>
      </div>

      {/* Switchboards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rows.map(row => (
          <div key={row.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{row.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">Code: {row.code}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {row.meta.building_code && <Pill color="blue">{row.meta.building_code}</Pill>}
                    {row.meta.floor && <Pill color="gray">{row.meta.floor}</Pill>}
                    {row.meta.room && <Pill color="gray">{row.meta.room}</Pill>}
                    {row.is_principal && <Pill color="green">PRINCIPAL</Pill>}
                  </div>
                </div>
                <div className="flex gap-2 ml-2">
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
             
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Regime: {row.regime_neutral}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                  Created: {new Date(row.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Amélioration 1 : bouton Show/Hide avec compteur correct */}
              <button
                onClick={() => toggleExpand(row.id)}
                className="w-full mt-4 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 transition-colors flex items-center justify-center gap-2 text-sm font-medium text-gray-700"
              >
                {expandedPanels[row.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>
                  {expandedPanels[row.id] ? 'Hide Devices' : 'Show Devices'}
                  {' '}
                  ({expandedPanels[row.id] ? (devices[row.id]?.length || deviceCounts[row.id] || 0)
                                           : (deviceCounts[row.id] || 0)})
                </span>
              </button>
            </div>

            {/* Devices Panel - expansible */}
            {expandedPanels[row.id] && (
              <div className="border-t border-gray-100 p-6 bg-gray-50">
                <DeviceTree
                  devices={devices[row.id] || []}
                  panelId={row.id}
                  onEdit={onEditDevice}
                  onDuplicate={duplicateDevice}
                  onDelete={removeDevice}
                  onSetMain={setMainDevice}
                  site={site}
                />
              </div>
            )}

            {/* Bouton Add Device principal pour chaque carte */}
            {!expandedPanels[row.id] && (
              <div className="border-t border-gray-100 p-4">
                <button
                  onClick={() => resetDeviceModal(row.id)}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-blue-50 border-2 border-dashed border-blue-200 rounded-lg text-blue-600 hover:bg-blue-100 transition-colors"
                >
                  <Plus size={16} />
                  <span className="text-sm font-medium">Add Device to {row.name}</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex justify-between items-center mt-8">
          <div className="text-sm text-gray-700">
            Showing {((q.page - 1) * pageSize) + 1} to {Math.min(q.page * pageSize, total)} of {total} results
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setQ(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={q.page === 1}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">{q.page}</span>
            <button
              onClick={() => setQ(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={q.page * pageSize >= total}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Toggle */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-40"
        title="AI Assistant"
      >
        <Search size={20} />
      </button>

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
                placeholder="Main Distribution Board"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Code *</label>
              <input
                type="text"
                value={switchboardForm.code}
                onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))}
                className="input w-full"
                placeholder="MDB-01"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Building</label>
              <input
                type="text"
                value={switchboardForm.meta.building_code}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, building_code: e.target.value } }))}
                className="input w-full"
                placeholder="B1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Floor</label>
              <input
                type="text"
                value={switchboardForm.meta.floor}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, floor: e.target.value } }))}
                className="input w-full"
                placeholder="Ground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Room</label>
              <input
                type="text"
                value={switchboardForm.meta.room}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, room: e.target.value } }))}
                className="input w-full"
                placeholder="Electrical Room"
              />
            </div>
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
          </div>

          <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <input
              type="checkbox"
              checked={switchboardForm.is_principal}
              onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))}
              className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <span className="font-medium text-blue-900">This is the principal switchboard</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { key: 'bypass', label: 'Bypass Mode' },
              { key: 'maintenance_mode', label: 'Maintenance' },
              { key: 'bus_coupling', label: 'Bus Coupling' },
              { key: 'genset_backup', label: 'Genset Backup' },
              { key: 'ups_backup', label: 'UPS Backup' }
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={switchboardForm.modes[key]}
                  onChange={e => setSwitchboardForm(f => ({
                    ...f,
                    modes: { ...f.modes, [key]: e.target.checked }
                  }))}
                  className="rounded border-gray-300 text-gray-600 focus:ring-gray-500 h-4 w-4"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'New Device'}>
        <div className="space-y-6">
          {/* Photo Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-gray-400 transition-colors">
            <input
              type="file"
              accept="image/*"
              onChange={e => setPhotoFile(e.target.files?.[0] || null)}
              className="hidden"
              id="photo-upload"
            />
            <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                <Info size={20} className="text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900">
                {photoFile ? photoFile.name : 'Upload device photo'}
              </p>
              <p className="text-xs text-gray-500">
                Click to upload or drag and drop (AI will analyze it)
              </p>
            </label>
            {photoFile && (
              <div className="flex items-center justify-center gap-3 mt-3">
                <button
                  onClick={analyzePhoto}
                  disabled={deviceSearchBusy}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {deviceSearchBusy ? 'Analyzing...' : 'Analyze with AI'}
                </button>
                <button
                  onClick={() => setPhotoFile(null)}
                  className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300 transition-colors"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Amélioration 4 : Quick AI Search */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Quick AI Search</label>
              <input
                value={quickAiQuery}
                onChange={e => setQuickAiQuery(e.target.value)}
                placeholder="e.g. Schneider LV429310 100A MCCB"
                className="input w-full"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={quickAiSearch}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm w-full"
                disabled={deviceSearchBusy || !quickAiQuery.trim()}
              >
                {deviceSearchBusy ? 'Searching...' : 'Search (AI)'}
              </button>
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
                value={deviceForm.in_amps}
                onChange={e => setDeviceForm(f => ({ ...f, in_amps: Number(e.target.value) || 0 }))}
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
                value={deviceForm.icu_kA}
                onChange={e => setDeviceForm(f => ({ ...f, icu_kA: Number(e.target.value) || 0 }))}
                className="input w-full"
                placeholder="25"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ics (kA)</label>
              <input
                type="number"
                step="0.1"
                value={deviceForm.ics_kA}
                onChange={e => setDeviceForm(f => ({ ...f, ics_kA: Number(e.target.value) || 0 }))}
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
                value={deviceForm.poles}
                onChange={e => setDeviceForm(f => ({ ...f, poles: Number(e.target.value) || 3 }))}
                className="input w-full"
                placeholder="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Voltage (V)</label>
              <input
                type="number"
                value={deviceForm.voltage_V}
                onChange={e => setDeviceForm(f => ({ ...f, voltage_V: Number(e.target.value) || 400 }))}
                className="input w-full"
                placeholder="400"
              />
            </div>
          </div>

          {/* Parent Device Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Parent Device (Upstream)</label>
            <div className="relative">
              <input
                type="text"
                value={parentSearchInput}
                onChange={e => {
                  setParentSearchInput(e.target.value);
                  setDeviceForm(f => ({ ...f, parent_id: null }));
                }}
                onFocus={() => setShowParentSuggestions(true)}
                className="input w-full pr-8"
                placeholder="Search parent device..."
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
                }}
                onFocus={() => setShowDownstreamSuggestions(true)}
                className="input w-full pr-8"
                placeholder="Search downstream switchboard..."
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
                    value={deviceForm.settings.ir}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, ir: Number(e.target.value) || 1 }
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
                    value={deviceForm.settings.tr}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, tr: Number(e.target.value) || 10 }
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
                    value={deviceForm.settings.isd}
                    onChange={e => setDeviceForm(f => ({
                      ...f,
                      settings: { ...f.settings, isd: Number(e.target.value) || 6 }
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

// DeviceTree Component (amélioration 2 : suppression du bouton redondant)
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
                  Icu: {device.icu_kA || '—'}kA
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  {device.poles || '—'}P
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
          <p className="text-xs text-gray-400">Add your first device above</p>
        </div>
      )}
    </div>
  );
}
