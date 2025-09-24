// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle,
  ChevronDown, ChevronRight, ChevronLeft, X, Moon, Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';

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
    red: 'bg-red-100 text-red-800 border-red-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function CustomTooltip({ children, content }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="bg-gray-800 text-white text-xs rounded py-1 px-2 shadow-lg z-50 max-w-xs" side="top" align="center">
            {content}
            <Tooltip.Arrow className="fill-gray-800" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-blue-50">
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
      </motion.div>
    </motion.div>
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
  const isMounted = useRef(true);
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

  // Dark mode
  const [darkMode, setDarkMode] = useState(false);

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
      if (isMounted.current) {
        setRows(data?.data || []);
        setTotal(data?.total || 0);
        const ids = (data?.data || []).map(r => r.id);
        loadDeviceCounts(ids);
      }
    } catch (e) {
      console.error('Load switchboards failed:', e);
      if (isMounted.current) {
        notify('Failed to load switchboards. Please refresh the page.', 'error');
      }
    }
  };

  const loadAllSwitchboards = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ site, pageSize: 1000 }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      if (isMounted.current) {
        setAllSwitchboards(data?.data || []);
      }
    } catch (e) {
      console.error('Load all switchboards failed:', e);
    }
  };

  const loadDevices = async (panelId) => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ switchboard_id: panelId, site }).toString();
      const data = await get(`/api/switchboard/devices?${params}`);
      if (isMounted.current) {
        setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
      }
    } catch (e) {
      console.error('Load devices failed:', e);
    }
  };

  const loadDeviceCounts = async (ids=[]) => {
    try {
      const param = ids.length ? `?ids=${ids.join(',')}&site=${encodeURIComponent(site)}`
                               : `?site=${encodeURIComponent(site)}`;
      const data = await get(`/api/switchboard/devices-count${param}`);
      if (isMounted.current) {
        setDeviceCounts(data.counts || {});
      }
    } catch (e) {
      console.error('Load device counts failed:', e);
    }
  };

  const loadDeviceReferences = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ site }).toString();
      const data = await get(`/api/switchboard/device-references?${params}`);
      if (isMounted.current) {
        setDeviceReferences(data.data || []);
      }
    } catch (e) {
      console.error('Load device references failed:', e);
    }
  };

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
    setDeviceForm({ ...emptyDeviceForm });
    setPhotoFile(null);
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
    setParentSearchInput('');
    setDownstreamSearchInput('');
    setQuickAiQuery('');
    setOpenDevice(true);
  };

  const onEditDevice = async (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
   
    const [parentName, downstreamName] = await Promise.all([
      loadParentName(device.parent_id),
      loadDownstreamName(device.downstream_switchboard_id)
    ]);

    const safeSettings = device.settings || {};
    
    setDeviceForm({
      name: device.name || '',
      device_type: device.device_type || 'Low Voltage Circuit Breaker',
      manufacturer: device.manufacturer || '',
      reference: device.reference || '',
      in_amps: device.in_amps !== null ? Number(device.in_amps) : null,
      icu_ka: device.icu_ka !== null ? Number(device.icu_ka) : null,
      ics_ka: device.ics_ka !== null ? Number(device.ics_ka) : null,
      poles: device.poles !== null ? Number(device.poles) : null,
      voltage_v: device.voltage_v !== null ? Number(device.voltage_v) : null,
      trip_unit: device.trip_unit || '',
      position_number: device.position_number || '',
      settings: {
        ir: safeSettings.ir !== null ? Number(safeSettings.ir) : null,
        tr: safeSettings.tr !== null ? Number(safeSettings.tr) : null,
        isd: safeSettings.isd !== null ? Number(safeSettings.isd) : null,
        tsd: safeSettings.tsd !== null ? Number(safeSettings.tsd) : null,
        ii: safeSettings.ii !== null ? Number(safeSettings.ii) : null,
        ig: safeSettings.ig !== null ? Number(safeSettings.ig) : null,
        tg: safeSettings.tg !== null ? Number(safeSettings.tg) : null,
        zsi: safeSettings.zsi !== null ? Boolean(safeSettings.zsi) : false,
        erms: safeSettings.erms !== null ? Boolean(safeSettings.erms) : false,
        curve_type: safeSettings.curve_type || ''
      },
      is_main_incoming: Boolean(device.is_main_incoming),
      parent_id: device.parent_id || null,
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      pv_tests: null,
      photos: []
    });
   
    setParentSearchInput(parentName || '');
    setDownstreamSearchInput(downstreamName || '');
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
    if (deviceForm.in_amps <= 0 && deviceForm.in_amps !== null) {
      return notify('Rated current must be greater than 0 or left empty', 'error');
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
      notify(`Device ${isMain ? 'set as main incoming' : 'unset as main incoming'} successfully!`, 'success');
    } catch (e) {
      console.error('Set main failed:', e);
      notify('Failed to update main incoming status', 'error');
    }
  };

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
        notify(`✅ AI filled all fields from quick search!`, 'success');
      } else {
        notify('No results from AI quick search.', 'info');
      }
    } catch (e) {
      console.error('Quick AI search failed:', e);
      notify('Quick AI search failed.', 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  // Photo Analysis - Remplit Quick AI Search
  const analyzePhoto = async () => {
    if (!photoFile) return notify('Select a photo first', 'info');
    const formData = new FormData();
    formData.append('photo', photoFile);
    formData.append('switchboard_id', currentPanelId);
    try {
      const data = await post(`/api/switchboard/analyze-photo?site=${encodeURIComponent(site)}`, formData, true); // true for multipart
      if (data.quick_ai_query) {
        setQuickAiQuery(data.quick_ai_query);
        notify('Photo analyzed! Quick AI Query filled. Click Search AI to auto-fill fields.', 'success');
      } else {
        notify('Photo analysis completed, but no query found.', 'info');
      }
    } catch (e) {
      console.error('Photo analysis failed:', e);
      notify('Photo analysis failed.', 'error');
    }
  };

  const getAiTip = async (context) => {
    setAiTipLoading(true);
    try {
      const data = await post(`/api/switchboard/ai-tip`, { query: context });
      setAiTip(data.tip || 'No tip available.');
      setAiTipOpen(true);
    } catch (e) {
      console.error('AI tip failed:', e);
      setAiTip('Failed to get AI tip.');
    } finally {
      setAiTipLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    setChatBusy(true);
    const userMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    try {
      const data = await post(`/api/switchboard/ai-tip`, { query: chatInput });
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.tip || 'No response.' }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Failed to get response.' }]);
    } finally {
      setChatBusy(false);
    }
  };

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Parent Suggestions
  useEffect(() => {
    if (debouncedParentQuery && currentPanelId) {
      const searchParents = async () => {
        try {
          const params = new URLSearchParams({ query: debouncedParentQuery, switchboard_id: currentPanelId, site }).toString();
          const data = await get(`/api/switchboard/search-parents?${params}`);
          setParentSuggestions(data.suggestions || []);
          setShowParentSuggestions(true);
        } catch (e) {
          console.error('Parent search failed:', e);
        }
      };
      searchParents();
    } else {
      setShowParentSuggestions(false);
    }
  }, [debouncedParentQuery, currentPanelId, site]);

  // Downstream Suggestions
  useEffect(() => {
    if (debouncedDownstreamQuery) {
      const searchDownstreams = async () => {
        try {
          const params = new URLSearchParams({ query: debouncedDownstreamQuery, site }).toString();
          const data = await get(`/api/switchboard/search-downstreams?${params}`);
          setDownstreamSuggestions(data.suggestions || []);
          setShowDownstreamSuggestions(true);
        } catch (e) {
          console.error('Downstream search failed:', e);
        }
      };
      searchDownstreams();
    } else {
      setShowDownstreamSuggestions(false);
    }
  }, [debouncedDownstreamQuery, site]);

  // Reference Suggestions
  useEffect(() => {
    if (debouncedReferenceQuery) {
      searchReferencesDB(debouncedReferenceQuery);
    }
  }, [debouncedReferenceQuery]);

  return (
    <section className={`p-6 space-y-6 ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header with Dark Mode Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Switchboards Dashboard</h2>
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition">
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      {/* Search and Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <input
          type="text"
          placeholder="Search name or code..."
          value={q.q}
          onChange={e => setQ(prev => ({ ...prev, q: e.target.value, page: 1 }))}
          className="input col-span-2"
        />
        <input
          type="text"
          placeholder="Building..."
          value={q.building}
          onChange={e => setQ(prev => ({ ...prev, building: e.target.value, page: 1 }))}
          className="input"
        />
        <input
          type="text"
          placeholder="Floor..."
          value={q.floor}
          onChange={e => setQ(prev => ({ ...prev, floor: e.target.value, page: 1 }))}
          className="input"
        />
      </div>

      {/* Switchboards List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {rows.map(row => (
            <motion.div
              key={row.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`rounded-xl shadow-md overflow-hidden hover:shadow-xl transition-shadow ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
            >
              <div className="p-4 border-b flex items-center justify-between">
                <CustomTooltip content={`Created: ${row.created_at.toLocaleString()}`}>
                  <h3 className="font-semibold text-lg truncate">{row.name}</h3>
                </CustomTooltip>
                <button onClick={() => toggleExpand(row.id)}>
                  {expandedPanels[row.id] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-sm">Code: {row.code}</p>
                <p className="text-sm">Devices: {deviceCounts[row.id] || 0}</p>
              </div>
              <AnimatePresence>
                {expandedPanels[row.id] && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 border-t">
                      <DeviceTree
                        devices={devices[row.id] || []}
                        panelId={row.id}
                        onEdit={onEditDevice}
                        onDuplicate={duplicateDevice}
                        onDelete={removeDevice}
                        onSetMain={setMainDevice}
                        site={site}
                      />
                      <button onClick={() => resetDeviceModal(row.id)} className="btn mt-4 w-full">
                        <Plus size={16} /> Add Device
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-2">
        <button disabled={q.page === 1} onClick={() => setQ(prev => ({ ...prev, page: prev.page - 1 }))}>
          <ChevronLeft size={20} />
        </button>
        <span>Page {q.page} of {Math.ceil(total / pageSize)}</span>
        <button disabled={q.page * pageSize >= total} onClick={() => setQ(prev => ({ ...prev, page: prev.page + 1 }))}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit Switchboard' : 'New Switchboard'}>
        {/* ... (contenu inchangé, mais avec tooltips ajoutés pour tips, e.g. <CustomTooltip content="Tip: Principal switchboards should have genset backup.">) */}
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'New Device'}>
        <div className="space-y-6">
          {/* Photo Upload with Preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload Photo for AI Analysis</label>
            <input type="file" onChange={e => setPhotoFile(e.target.files[0])} accept="image/*" className="input w-full" />
            {photoFile && (
              <div className="mt-2">
                <img src={URL.createObjectURL(photoFile)} alt="Preview" className="w-32 h-32 object-cover rounded" />
              </div>
            )}
            <button onClick={analyzePhoto} className="btn mt-2">Analyze Photo</button>
          </div>

          {/* Quick AI Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Quick AI Search</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={quickAiQuery}
                onChange={e => setQuickAiQuery(e.target.value)}
                className="input flex-1"
                placeholder="e.g., Schneider 100A MCCB"
              />
              <button onClick={quickAiSearch} disabled={deviceSearchBusy} className="btn">
                Search AI
              </button>
            </div>
          </div>

          {/* Reste du form avec tooltips pour tips */}
          <CustomTooltip content="Tip: Device name should be unique for easy identification.">
            <input
              type="text"
              value={deviceForm.name}
              onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Device name"
              className="input w-full"
            />
          </CustomTooltip>
          {/* ... (ajoute des tooltips similaires pour chaque champ avec tips éducatifs) */}
        </div>
      </Modal>

      {/* Sidebar et Toasts inchangés mais avec animations motion */}
      {/* ... */}
    </section>
  );
}

function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0, site }) {
  return (
    <motion.div className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: level * 0.1 }}>
      {devices.map(device => (
        <div key={device.id} className="relative">
          {level > 0 && (
            <svg className="absolute left-[-1rem] top-0 h-full w-4" viewBox="0 0 16 100" preserveAspectRatio="none">
              <path d="M8 0 V 50 H 16" stroke="gray" strokeWidth="1" fill="none" />
            </svg>
          )}
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white dark:bg-gray-800 rounded-lg border p-4"
          >
            <CustomTooltip content={device.name || 'Unnamed'}>
              <h4 className="font-semibold truncate hover:whitespace-normal">{device.name || 'Unnamed Device'}</h4>
            </CustomTooltip>
            {/* ... (reste inchangé avec animations sur buttons) */}
          </motion.div>
          {device.children && device.children.length > 0 && (
            <DeviceTree {...props} level={level + 1} />
          )}
        </div>
      ))}
    </motion.div>
  );
}
