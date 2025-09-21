// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';

// Simple SVG Icons (no external dependency)
const EditIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const InfoIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const HelpCircleIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

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
      <div className="absolute z-10 invisible group-hover:visible bg-gray-800 text-white text-xs rounded py-1 px-2 -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
        {content}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
      </div>
    </div>
  );
}

function Popover({ trigger, content }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <div onClick={() => setOpen(!open)} className="cursor-pointer">{trigger}</div>
      {open && (
        <div className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-64 mt-2 right-0">
          <div className="text-sm text-gray-700 mb-2">{content}</div>
          <button 
            className="text-xs text-gray-500 hover:text-gray-700" 
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
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
            <XIcon />
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

  // Chat sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // AI Tips state
  const [aiTip, setAiTip] = useState('');
  const [aiTipLoading, setAiTipLoading] = useState(false);

  const loadSwitchboards = async () => {
    try {
      const params = { ...q, pageSize, site };
      const data = await get('/api/switchboard/boards', params);
      setRows(data?.data || []);
      setTotal(data?.total || 0);
    } catch (e) {
      console.error('Load switchboards failed:', e);
    }
  };

  const loadAllSwitchboards = async () => {
    try {
      const data = await get('/api/switchboard/boards', { site, pageSize: 1000 });
      setAllSwitchboards(data?.data || []);
    } catch (e) {
      console.error('Load all switchboards failed:', e);
    }
  };

  const loadDevices = async (panelId) => {
    try {
      const data = await get('/api/switchboard/devices', { switchboard_id: panelId });
      setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
    } catch (e) {
      console.error('Load devices failed:', e);
    }
  };

  const loadDeviceReferences = async () => {
    try {
      const data = await get('/api/switchboard/device-references');
      setDeviceReferences(data.data || []);
    } catch (e) {
      console.error('Load device references failed:', e);
    }
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
    } catch (e) {
      console.error('Save switchboard failed:', e);
      alert('Failed to save switchboard');
    } finally { 
      setBusy(false); 
    }
  };

  const duplicateSwitchboard = async (id) => {
    try {
      await post(`/api/switchboard/boards/${id}/duplicate`);
      await loadSwitchboards();
    } catch (e) {
      console.error('Duplicate failed:', e);
      alert('Failed to duplicate switchboard');
    }
  };

  const removeSwitchboard = async (id) => {
    if (!confirm('Delete this switchboard and all its devices?')) return;
    try {
      await del(`/api/switchboard/boards/${id}`);
      await loadSwitchboards();
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Failed to delete switchboard');
    }
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
    } catch (e) {
      console.error('Save device failed:', e);
      alert('Failed to save device');
    } finally { 
      setBusy(false); 
    }
  };

  const duplicateDevice = async (id, panelId) => {
    try {
      await post(`/api/switchboard/devices/${id}/duplicate`);
      await loadDevices(panelId);
    } catch (e) {
      console.error('Duplicate device failed:', e);
      alert('Failed to duplicate device');
    }
  };

  const removeDevice = async (id, panelId) => {
    if (!confirm('Delete this device?')) return;
    try {
      await del(`/api/switchboard/devices/${id}`);
      await loadDevices(panelId);
    } catch (e) {
      console.error('Delete device failed:', e);
      alert('Failed to delete device');
    }
  };

  const setMainDevice = async (id, panelId, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main`, { is_main_incoming: isMain });
      await loadDevices(panelId);
      // Trigger AI tip
      getAiTip(`User set device ${id} as main incoming: ${isMain}. Provide advice on next steps.`);
    } catch (e) {
      console.error('Set main failed:', e);
    }
  };

  const searchDeviceReference = async () => {
    if (!deviceForm.manufacturer && !deviceForm.reference) return;
    
    setDeviceSearchBusy(true);
    try {
      const data = await post('/api/switchboard/search-device', { 
        query: `${deviceForm.manufacturer} ${deviceForm.reference}`.trim() 
      });
      fillDeviceForm(data);
    } catch (e) {
      console.error('Device search failed:', e);
      alert('Search failed. Please check your input.');
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
      
      const data = await fetch('/api/switchboard/analyze-photo', {
        method: 'POST',
        credentials: 'include',
        body: formData
      }).then(r => r.json());
      
      fillDeviceForm(data);
      if (data.existing_id) {
        alert('✅ Matched existing device! Auto-linking.');
      } else if (data.created) {
        alert('🎉 New device created from photo analysis!');
      }
    } catch (e) {
      console.error('Photo analysis failed:', e);
      alert('Photo analysis failed. Please try again.');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  const fillDeviceForm = (data) => {
    if (data && data.manufacturer) {
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
      
      // Trigger AI tip for new device
      getAiTip(`New device added: ${data.manufacturer} ${data.reference}. Suggest next steps.`);
    }
  };

  // Autocomplete searches
  const searchParents = async (query) => {
    if (!query.trim()) {
      setParentSuggestions([]);
      setShowParentSuggestions(false);
      return;
    }
    
    try {
      const data = await get('/api/switchboard/search-parents', { 
        query, 
        switchboard_id: currentPanelId 
      });
      setParentSuggestions(data.suggestions || []);
      setShowParentSuggestions(true);
    } catch (e) {
      console.error('Search parents failed:', e);
    }
  };

  const searchDownstreams = async (query) => {
    if (!query.trim()) {
      setDownstreamSuggestions([]);
      setShowDownstreamSuggestions(false);
      return;
    }
    
    try {
      const data = await get('/api/switchboard/search-downstreams', { query });
      setDownstreamSuggestions(data.suggestions || []);
      setShowDownstreamSuggestions(true);
    } catch (e) {
      console.error('Search downstreams failed:', e);
    }
  };

  const searchReferences = async (query) => {
    if (!query.trim()) {
      setReferenceSuggestions([]);
      setShowReferenceSuggestions(false);
      return;
    }
    
    try {
      const data = await get('/api/switchboard/search-references', { query });
      setReferenceSuggestions(data.suggestions || []);
      setShowReferenceSuggestions(true);
      
      // Auto-fill if exact match
      if (data.auto_fill) {
        fillDeviceForm(data.auto_fill);
      }
    } catch (e) {
      console.error('Search references failed:', e);
    }
  };

  const selectReference = (ref) => {
    setDeviceForm(prev => ({ 
      ...prev, 
      manufacturer: ref.manufacturer, 
      reference: ref.reference 
    }));
    setShowReferenceSuggestions(false);
    searchDeviceReference(); // Auto-fill full details
  };

  const selectParent = (parent) => {
    setDeviceForm(prev => ({ ...prev, parent_id: parent.id }));
    setShowParentSuggestions(false);
  };

  const selectDownstream = (downstream) => {
    setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: downstream.id }));
    setShowDownstreamSuggestions(false);
  };

  // Chat functions
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatBusy(true);
    
    try {
      const data = await post('/api/switchboard/search-device', { query: chatInput });
      const assistantMessage = { 
        role: 'assistant', 
        content: `Found: ${data.manufacturer || 'No match'} ${data.reference || ''}\n\nFull specs:\n${JSON.stringify(data, null, 2)}` 
      };
      setChatMessages(prev => [...prev, assistantMessage]);
      
      // Auto-fill if in device modal
      if (openDevice && data.manufacturer) {
        fillDeviceForm(data);
      }
    } catch (e) {
      console.error('Chat failed:', e);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
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
      setAiTip('Consider checking device connections and safety standards.');
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

  const totalPages = Math.ceil(total / pageSize);

  return (
    <section className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-gray-900">Switchboards</h1>
            <InfoIcon className="text-blue-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:from-blue-600 hover:to-blue-700 transition-all"
              onClick={resetSwitchboardModal}
            >
              <PlusIcon /> Add Switchboard
            </button>
            <button 
              className="btn bg-gradient-to-r from-indigo-500 to-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:from-indigo-600 hover:to-indigo-700 transition-all"
              onClick={() => setSidebarOpen(true)}
            >
              <SearchIcon /> AI Assistant
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card bg-white shadow-sm rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input 
              className="input" 
              placeholder="Search by name or code..." 
              value={q.q} 
              onChange={e => setQ({ ...q, q: e.target.value, page: 1 })} 
            />
            <input 
              className="input" 
              placeholder="Building..." 
              value={q.building} 
              onChange={e => setQ({ ...q, building: e.target.value, page: 1 })} 
            />
            <input 
              className="input" 
              placeholder="Floor..." 
              value={q.floor} 
              onChange={e => setQ({ ...q, floor: e.target.value, page: 1 })} 
            />
            <input 
              className="input" 
              placeholder="Room..." 
              value={q.room} 
              onChange={e => setQ({ ...q, room: e.target.value, page: 1 })} 
            />
          </div>
        </div>

        {/* Switchboards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {rows.map(row => (
            <div key={row.id} className="card bg-white shadow-md hover:shadow-xl rounded-xl overflow-hidden transition-all duration-300">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900 mb-1">{row.name}</h3>
                    <p className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full inline-block">
                      {row.code}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => onEditSwitchboard(row)} 
                      className="p-2 rounded-lg hover:bg-blue-50 transition-colors"
                      title="Edit"
                    >
                      <EditIcon />
                    </button>
                    <button 
                      onClick={() => duplicateSwitchboard(row.id)} 
                      className="p-2 rounded-lg hover:bg-green-50 transition-colors"
                      title="Duplicate"
                    >
                      <CopyIcon />
                    </button>
                    <button 
                      onClick={() => removeSwitchboard(row.id)} 
                      className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                    <a 
                      href={`/api/switchboard/boards/${row.id}/report`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="p-2 rounded-lg hover:bg-purple-50 transition-colors"
                      title="Download PDF"
                    >
                      <DownloadIcon />
                    </a>
                  </div>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Location:</span>
                    <span className="font-medium">
                      {row.meta.building_code || '—'} • {row.meta.floor || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Regime:</span>
                    <span className="font-medium">{row.regime_neutral}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Principal:</span>
                    <span className={`font-medium ${row.is_principal ? 'text-green-600' : 'text-gray-500'}`}>
                      {row.is_principal ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>

                <button 
                  className="w-full flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 py-2 rounded-lg border border-blue-200 hover:bg-blue-50 transition-all"
                  onClick={() => toggleExpand(row.id)}
                >
                  {expandedPanels[row.id] ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <span className="font-medium">View Devices</span>
                </button>

                {/* Devices Panel */}
                {expandedPanels[row.id] && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-semibold text-gray-900">Devices ({devices[row.id]?.length || 0})</h4>
                      <button 
                        className="btn bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg text-sm flex items-center gap-1"
                        onClick={() => resetDeviceModal(row.id)}
                      >
                        <PlusIcon className="w-3 h-3" /> Add Device
                      </button>
                    </div>
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
            </div>
          ))}
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex justify-center items-center gap-4 mb-8">
            <button 
              disabled={q.page <= 1} 
              onClick={() => setQ({ ...q, page: q.page - 1 })} 
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700">
              Page {q.page} of {totalPages}
            </span>
            <button 
              disabled={q.page >= totalPages} 
              onClick={() => setQ({ ...q, page: q.page + 1 })} 
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {rows.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No switchboards yet</h3>
            <p className="text-gray-500 mb-4">Get started by creating your first switchboard.</p>
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 mx-auto"
              onClick={resetSwitchboardModal}
            >
              <PlusIcon /> Create First Switchboard
            </button>
          </div>
        )}
      </div>

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit Switchboard' : 'New Switchboard'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Name <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Unique descriptive name for the switchboard (e.g., 'Main Distribution Board')">
                <input 
                  className="input w-full" 
                  value={switchboardForm.name} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))} 
                  placeholder="e.g., Main Distribution Board"
                />
              </Tooltip>
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Code <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Short unique identifier (e.g., 'MDB-01')">
                <input 
                  className="input w-full" 
                  value={switchboardForm.code} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))} 
                  placeholder="e.g., MDB-01"
                />
              </Tooltip>
            </div>
            <div className="md:col-span-2">
              <label className="label flex items-center gap-1 mb-1">
                Location <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Building and room location for organization">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input 
                    className="input" 
                    placeholder="Building code" 
                    value={switchboardForm.meta.building_code} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, building_code: e.target.value } }))} 
                  />
                  <input 
                    className="input" 
                    placeholder="Floor" 
                    value={switchboardForm.meta.floor} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, floor: e.target.value } }))} 
                  />
                  <input 
                    className="input" 
                    placeholder="Room" 
                    value={switchboardForm.meta.room} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, room: e.target.value } }))} 
                  />
                </div>
              </Tooltip>
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Neutral Regime <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Earthing system type (TN-S, TN-C-S, IT, TT)">
                <select 
                  className="input w-full" 
                  value={switchboardForm.regime_neutral} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, regime_neutral: e.target.value }))}
                >
                  {regimes.map(regime => (
                    <option key={regime} value={regime}>{regime}</option>
                  ))}
                </select>
              </Tooltip>
            </div>
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Principal Board <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Main incoming board for the facility">
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    checked={switchboardForm.is_principal} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))} 
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Mark as principal</span>
                </label>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button 
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              onClick={() => setOpenSwitchboard(false)}
            >
              Cancel
            </button>
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg disabled:opacity-50"
              disabled={busy || !switchboardForm.name || !switchboardForm.code}
              onClick={saveSwitchboard}
            >
              {busy ? 'Saving...' : editingSwitchboard ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'New Device'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Name <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Descriptive name for the device (e.g., 'Main Incoming Breaker')">
                <input 
                  className="input w-full" 
                  value={deviceForm.name} 
                  onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))} 
                  placeholder="e.g., Main Incoming Breaker"
                />
              </Tooltip>
            </div>
            
            <div>
              <label className="label flex items-center gap-1 mb-1">
                Type <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Device category (Circuit Breaker, MCCB, etc.)">
                <select 
                  className="input w-full" 
                  value={deviceForm.device_type} 
                  onChange={e => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}
                >
                  {deviceTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </Tooltip>
            </div>

            <div>
              <label className="label flex items-center gap-1 mb-1">
                Manufacturer <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Device manufacturer (e.g., Schneider, ABB, Siemens)">
                <input 
                  className="input w-full" 
                  value={deviceForm.manufacturer} 
                  onChange={e => setDeviceForm(f => ({ ...f, manufacturer: e.target.value }))} 
                  placeholder="e.g., Schneider"
                />
              </Tooltip>
            </div>

            <div className="md:col-span-2 relative">
              <label className="label flex items-center gap-1 mb-1">
                Reference <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Model number or catalog reference">
                <div className="flex gap-2">
                  <input 
                    className="input flex-1" 
                    value={deviceForm.reference} 
                    onChange={e => {
                      setDeviceForm(f => ({ ...f, reference: e.target.value }));
                      searchReferences(e.target.value);
                    }} 
                    placeholder="e.g., NSX100N"
                  />
                  <button 
                    className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                      deviceSearchBusy 
                        ? 'bg-gray-300 cursor-not-allowed' 
                        : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                    }`}
                    disabled={deviceSearchBusy || !deviceForm.reference}
                    onClick={searchDeviceReference}
                  >
                    {deviceSearchBusy ? '...' : 'AI Fill'}
                  </button>
                </div>
              </Tooltip>
              
              {/* Reference Suggestions */}
              {showReferenceSuggestions && referenceSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {referenceSuggestions.map((suggestion, idx) => (
                    <div 
                      key={idx}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectReference(suggestion)}
                    >
                      <div className="font-medium">{suggestion.manufacturer} - {suggestion.reference}</div>
                      <div className="text-sm text-gray-500">
                        {suggestion.device_type} • {suggestion.in_amps}A
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Photo Analysis */}
            <div className="md:col-span-2">
              <label className="label flex items-center gap-1 mb-1">
                Photo Analysis <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Upload a device photo - AI will automatically extract specs and match existing devices">
                <div className="space-y-2">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    onChange={e => setPhotoFile(e.target.files[0])}
                  />
                  <button 
                    className={`w-full py-2 rounded-lg text-sm transition-colors ${
                      deviceSearchBusy || !photoFile
                        ? 'bg-gray-300 cursor-not-allowed' 
                        : 'bg-purple-500 hover:bg-purple-600 text-white'
                    }`}
                    disabled={deviceSearchBusy || !photoFile}
                    onClick={analyzePhoto}
                  >
                    {deviceSearchBusy ? 'Analyzing Photo...' : '🔍 Analyze Photo & Auto-Fill'}
                  </button>
                </div>
              </Tooltip>
            </div>

            <div>
              <label className="label">Rated Current (A)</label>
              <input 
                type="number" 
                className="input w-full" 
                value={deviceForm.in_amps} 
                onChange={e => setDeviceForm(f => ({ ...f, in_amps: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 100"
              />
            </div>

            <div>
              <label className="label">Icu (kA)</label>
              <input 
                type="number" 
                step="0.1" 
                className="input w-full" 
                value={deviceForm.icu_kA} 
                onChange={e => setDeviceForm(f => ({ ...f, icu_kA: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 25"
              />
            </div>

            <div>
              <label className="label">Ics (kA)</label>
              <input 
                type="number" 
                step="0.1" 
                className="input w-full" 
                value={deviceForm.ics_kA} 
                onChange={e => setDeviceForm(f => ({ ...f, ics_kA: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 20"
              />
            </div>

            <div>
              <label className="label">Poles</label>
              <input 
                type="number" 
                min="1" 
                max="4" 
                className="input w-full" 
                value={deviceForm.poles} 
                onChange={e => setDeviceForm(f => ({ ...f, poles: Number(e.target.value) || 3 }))} 
              />
            </div>

            <div>
              <label className="label">Voltage (V)</label>
              <input 
                type="number" 
                className="input w-full" 
                value={deviceForm.voltage_V} 
                onChange={e => setDeviceForm(f => ({ ...f, voltage_V: Number(e.target.value) || 400 }))} 
                placeholder="e.g., 400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="label">Trip Unit</label>
              <input 
                className="input w-full" 
                value={deviceForm.trip_unit} 
                onChange={e => setDeviceForm(f => ({ ...f, trip_unit: e.target.value }))} 
                placeholder="e.g., Micrologic 2.2"
              />
            </div>

            {/* Parent Device with Search */}
            <div className="md:col-span-2 relative">
              <label className="label flex items-center gap-1 mb-1">
                Parent Device <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Search for parent device by name or type (leave empty for top-level)">
                <input 
                  className="input w-full pr-10" 
                  placeholder="Search parent device..."
                  onFocus={() => searchParents(deviceForm.name || '')}
                  onChange={e => searchParents(e.target.value)}
                  onClick={() => searchParents(deviceForm.name || '')}
                />
                <div className="absolute right-2 top-10 text-gray-400">
                  <SearchIcon />
                </div>
              </Tooltip>
              
              {showParentSuggestions && parentSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {parentSuggestions.map((parent, idx) => (
                    <div 
                      key={idx}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectParent(parent)}
                    >
                      <div className="font-medium">{parent.name || `${parent.manufacturer} ${parent.reference}`}</div>
                      <div className="text-sm text-gray-500">{parent.device_type}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Downstream Switchboard with Search */}
            <div className="md:col-span-2 relative">
              <label className="label flex items-center gap-1 mb-1">
                Downstream Switchboard <HelpCircleIcon className="text-gray-400" />
              </label>
              <Tooltip content="Link to downstream board (search by name or code)">
                <input 
                  className="input w-full pr-10" 
                  placeholder="Search downstream switchboard..."
                  onFocus={() => searchDownstreams('')}
                  onChange={e => searchDownstreams(e.target.value)}
                  onClick={() => searchDownstreams('')}
                />
                <div className="absolute right-2 top-10 text-gray-400">
                  <SearchIcon />
                </div>
              </Tooltip>
              
              {showDownstreamSuggestions && downstreamSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {downstreamSuggestions.map((sb, idx) => (
                    <div 
                      key={idx}
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectDownstream(sb)}
                    >
                      <div className="font-medium">{sb.name} ({sb.code})</div>
                      <div className="text-sm text-gray-500">{sb.building_code}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Main Incoming with AI Tip */}
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <Popover 
                trigger={
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={deviceForm.is_main_incoming} 
                      onChange={e => {
                        setDeviceForm(f => ({ ...f, is_main_incoming: e.target.checked }));
                        getAiTip(`User selected main incoming: ${e.target.checked ? 'true' : 'false'}. Provide advice on board connections.`);
                      }} 
                      className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-blue-900">Main Incoming Device</span>
                  </label>
                } 
                content={aiTipLoading ? 'Loading AI advice...' : aiTip}
              />
            </div>

            {/* Quick Protection Settings */}
            <div className="md:col-span-2">
              <label className="label mb-2 block">Protection Settings</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Ir (xIn)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="input text-sm" 
                    value={deviceForm.settings.ir} 
                    onChange={e => setDeviceForm(f => ({ 
                      ...f, 
                      settings: { ...f.settings, ir: Number(e.target.value) || 1 } 
                    }))} 
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Tr (s)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="input text-sm" 
                    value={deviceForm.settings.tr} 
                    onChange={e => setDeviceForm(f => ({ 
                      ...f, 
                      settings: { ...f.settings, tr: Number(e.target.value) || 10 } 
                    }))} 
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Isd (xIr)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="input text-sm" 
                    value={deviceForm.settings.isd} 
                    onChange={e => setDeviceForm(f => ({ 
                      ...f, 
                      settings: { ...f.settings, isd: Number(e.target.value) || 6 } 
                    }))} 
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Curve</label>
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
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex justify-end gap-3">
            <button 
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              onClick={() => setOpenDevice(false)}
            >
              Cancel
            </button>
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-2 rounded-lg disabled:opacity-50"
              disabled={busy || !deviceForm.name || deviceForm.in_amps <= 0}
              onClick={saveDevice}
            >
              {busy ? 'Saving...' : editingDevice ? 'Update Device' : 'Create Device'}
            </button>
          </div>
        </div>
      </Modal>

      {/* AI Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)}>
          <div 
            className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl transform transition-transform duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">🤖 AI Assistant</h3>
              <button 
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100"
              >
                <XIcon />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto h-[calc(100vh-140px)] space-y-3">
              {chatMessages.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <SearchIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Ask me about electrical devices, standards, or configurations</p>
                  <div className="text-xs mt-2 text-gray-400">
                    Try: "Find Schneider 100A MCCB specs"
                  </div>
                </div>
              ) : (
                chatMessages.map((message, idx) => (
                  <div 
                    key={idx} 
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`max-w-[80%] p-3 rounded-lg ${
                        message.role === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                ))
              )}
              
              {chatBusy && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 p-3 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                      <span className="text-sm text-gray-500">AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200">
              <div className="flex gap-2">
                <input 
                  className="input flex-1" 
                  value={chatInput} 
                  onChange={e => setChatInput(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && !chatBusy && sendChatMessage()}
                  placeholder="Ask about devices, standards, or configurations..."
                  disabled={chatBusy}
                />
                <button 
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    chatBusy 
                      ? 'bg-gray-300 cursor-not-allowed' 
                      : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                  }`}
                  disabled={chatBusy || !chatInput.trim()}
                  onClick={sendChatMessage}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// DeviceTree Component
function DeviceTree({ devices, panelId, onEdit, onDuplicate, onDelete, onSetMain, level = 0 }) {
  return (
    <div className={`space-y-3 ${level > 0 ? 'ml-6' : ''}`}>
      {devices.map(device => (
        <div key={device.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-900 text-sm">
                  {device.name || `${device.manufacturer || '—'} ${device.reference || ''}`.trim() || 'Unnamed Device'}
                </span>
                <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                  {device.device_type}
                </span>
                {device.is_main_incoming && (
                  <Pill color="green">MAIN INCOMING</Pill>
                )}
                {device.downstream_switchboard_id && (
                  <Pill color="blue">LINKED SB #{device.downstream_switchboard_id}</Pill>
                )}
              </div>
              <div className="text-xs text-gray-500 flex flex-wrap gap-2">
                <span>⚡ {device.in_amps || '—'}A</span>
                <span>🔌 Icu: {device.icu_kA || '—'}kA</span>
                <span>🔒 Poles: {device.poles || '—'}</span>
                {device.settings?.curve_type && (
                  <span>📈 {device.settings.curve_type}</span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              <button 
                onClick={() => onEdit(device, panelId)}
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Edit"
              >
                <EditIcon />
              </button>
              <button 
                onClick={() => onDuplicate(device.id, panelId)}
                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                title="Duplicate"
              >
                <CopyIcon />
              </button>
              <button 
                onClick={() => onDelete(device.id, panelId)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete"
              >
                <TrashIcon />
              </button>
              <button 
                onClick={() => onSetMain(device.id, panelId, !device.is_main_incoming)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
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
            <div className={`mt-3 pt-3 border-t border-gray-100 ${level > 2 ? 'ml-4 pl-4 border-l border-gray-200' : ''}`}>
              <DeviceTree 
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
        <div className="text-center py-4 text-sm text-gray-500 italic">
          No devices yet - add your first one above!
        </div>
      )}
    </div>
  );
}
