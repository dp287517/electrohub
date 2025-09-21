// src/pages/Switchboards.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { get, post, put, del } from '../lib/api.js';
import { Edit, Copy, Trash, Download, Plus, Search, Info, HelpCircle, ChevronDown, ChevronRight, X } from 'lucide-react';

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

function Popover({ trigger, content, isOpen, onClose }) {
  return (
    <div className="relative inline-block">
      <div onClick={() => !isOpen && setIsOpen(true)} className="cursor-pointer">{trigger}</div>
      {isOpen && (
        <div className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72 mt-2 right-0">
          <div className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{content}</div>
          <button 
            className="text-xs text-gray-500 hover:text-gray-700 w-full text-left" 
            onClick={() => onClose && onClose()}
          >
            Close tip
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

  // Chat sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // AI Tips state
  const [aiTip, setAiTip] = useState('');
  const [aiTipLoading, setAiTipLoading] = useState(false);
  const [aiTipOpen, setAiTipOpen] = useState(false);

  // Debounce hook
  const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
      const handler = setTimeout(() => setDebouncedValue(value), delay);
      return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
  };

  const debouncedReferenceQuery = useDebounce(deviceForm.reference, 300);
  const debouncedParentQuery = useDebounce(parentSearchInput, 300);
  const debouncedDownstreamQuery = useDebounce(downstreamSearchInput, 300);

  const [parentSearchInput, setParentSearchInput] = useState('');
  const [downstreamSearchInput, setDownstreamSearchInput] = useState('');

  const loadSwitchboards = async () => {
    try {
      const params = new URLSearchParams({ ...q, pageSize, site }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      setRows(data?.data || []);
      setTotal(data?.total || 0);
    } catch (e) {
      console.error('Load switchboards failed:', e);
      alert('Failed to load switchboards. Please refresh the page.');
    }
  };

  const loadAllSwitchboards = async () => {
    try {
      const params = new URLSearchParams({ site, pageSize: 1000 }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      setAllSwitchboards(data?.data || []);
    } catch (e) {
      console.error('Load all switchboards failed:', e);
    }
  };

  const loadDevices = async (panelId) => {
    try {
      const params = new URLSearchParams({ switchboard_id: panelId, site }).toString();
      const data = await get(`/api/switchboard/devices?${params}`);
      setDevices(prev => ({ ...prev, [panelId]: data?.data || [] }));
    } catch (e) {
      console.error('Load devices failed:', e);
    }
  };

  const loadDeviceReferences = async () => {
    try {
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
    setExpandedPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
    if (!devices[panelId] && !expandedPanels[panelId]) {
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
      return alert('Name and Code are required');
    }

    setBusy(true);
    try {
      if (editingSwitchboard) {
        await put(`/api/switchboard/boards/${editingSwitchboard.id}`, switchboardForm);
        alert('Switchboard updated successfully!');
      } else {
        await post('/api/switchboard/boards', switchboardForm);
        alert('Switchboard created successfully!');
      }
      setOpenSwitchboard(false);
      await loadSwitchboards();
    } catch (e) {
      console.error('Save switchboard failed:', e);
      alert('Failed to save switchboard: ' + (e.message || 'Unknown error'));
    } finally { 
      setBusy(false); 
    }
  };

  const duplicateSwitchboard = async (id) => {
    if (!confirm('Duplicate this switchboard and all its devices?')) return;
    try {
      await post(`/api/switchboard/boards/${id}/duplicate`);
      await loadSwitchboards();
      alert('Switchboard duplicated successfully!');
    } catch (e) {
      console.error('Duplicate failed:', e);
      alert('Failed to duplicate switchboard');
    }
  };

  const removeSwitchboard = async (id) => {
    if (!confirm('Delete this switchboard and all its devices? This cannot be undone.')) return;
    try {
      await del(`/api/switchboard/boards/${id}`);
      await loadSwitchboards();
      alert('Switchboard deleted successfully!');
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Failed to delete switchboard');
    }
  };

  // Device functions
  const resetDeviceModal = (panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(null);
    setDeviceForm({ ...emptyDeviceForm, name: '' }); // Name remains empty for manual entry
    setPhotoFile(null);
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
    setOpenDevice(true);
  };

  const onEditDevice = (device, panelId) => {
    setCurrentPanelId(panelId);
    setEditingDevice(device);
    
    // Robust loading with fallbacks for ALL fields
    const safeSettings = device.settings || {};
    setDeviceForm({
      name: device.name || '', // Keep manual name
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
    setPhotoFile(null);
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
      return alert('Device name is required');
    }
    if (deviceForm.in_amps <= 0) {
      return alert('Rated current must be greater than 0');
    }

    setBusy(true);
    try {
      const payload = { 
        ...safeUploadStrip(deviceForm), 
        switchboard_id: currentPanelId 
      };
      
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}`, payload);
        alert('Device updated successfully!');
      } else {
        await post('/api/switchboard/devices', payload);
        alert('Device created successfully!');
      }
      
      setOpenDevice(false);
      setPhotoFile(null);
      await loadDevices(currentPanelId);
      await loadDeviceReferences();
    } catch (e) {
      console.error('Save device failed:', e);
      alert('Failed to save device: ' + (e.message || 'Unknown error'));
    } finally { 
      setBusy(false); 
    }
  };

  const duplicateDevice = async (id, panelId) => {
    if (!confirm('Duplicate this device?')) return;
    try {
      await post(`/api/switchboard/devices/${id}/duplicate`);
      await loadDevices(panelId);
      await loadDeviceReferences(); // Refresh to avoid duplicate suggestions
      alert('Device duplicated successfully!');
    } catch (e) {
      console.error('Duplicate device failed:', e);
      alert('Failed to duplicate device');
    }
  };

  const removeDevice = async (id, panelId) => {
    if (!confirm('Delete this device? This cannot be undone.')) return;
    try {
      await del(`/api/switchboard/devices/${id}`);
      await loadDevices(panelId);
      alert('Device deleted successfully!');
    } catch (e) {
      console.error('Delete device failed:', e);
      alert('Failed to delete device');
    }
  };

  const setMainDevice = async (id, panelId, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main`, { is_main_incoming: isMain });
      await loadDevices(panelId);
      getAiTip(`User set device as main incoming: ${isMain ? 'true' : 'false'}. Suggest next steps for board hierarchy.`);
    } catch (e) {
      console.error('Set main failed:', e);
      alert('Failed to update main incoming status');
    }
  };

  // CRITICAL: Fixed Reference Search - DB suggestions + OpenAI full fill
  const searchDeviceReference = async () => {
    if (!deviceForm.reference.trim()) {
      return alert('Please enter a reference to search');
    }
    
    setDeviceSearchBusy(true);
    try {
      // First try OpenAI for full specs (fills EVERYTHING except name)
      const query = `${deviceForm.manufacturer || ''} ${deviceForm.reference}`.trim();
      const data = await post('/api/switchboard/search-device', { query });
      
      if (data && data.manufacturer) {
        // Fill ALL fields except name (manual)
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
          // name stays manual/empty
        }));
        setShowReferenceSuggestions(false);
        alert(`✅ AI filled all fields for ${data.manufacturer} ${data.reference}!`);
        return; // Don't show DB suggestions if AI succeeded
      }
      
      // Fallback: Show DB suggestions if OpenAI didn't find anything
      alert('AI search completed. Showing database matches below...');
      
    } catch (e) {
      console.error('AI device search failed:', e);
      alert('AI search failed, falling back to database search...');
      // Continue to DB search even if AI fails
    } finally {
      setDeviceSearchBusy(false);
    }
    
    // Always show DB suggestions for manual selection
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
      
      // Auto-fill if exact match found in DB
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
        alert(`✅ Auto-filled from database: ${autoFill.manufacturer} ${autoFill.reference}`);
      }
    } catch (e) {
      console.error('Database reference search failed:', e);
    }
  };

  // FIXED: Photo analysis with proper site param
  const analyzePhoto = async () => {
    if (!photoFile) {
      return alert('Please select a photo first');
    }
    
    setDeviceSearchBusy(true);
    try {
      const formData = new FormData();
      formData.append('photo', photoFile);
      
      const response = await fetch(`/api/switchboard/analyze-photo?site=${encodeURIComponent(site)}`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      fillDeviceForm(data);
      
      if (data.existing_id) {
        alert(`✅ Matched existing device #${data.existing_id}! Fields auto-filled.`);
        setDeviceForm(prev => ({ ...prev, parent_id: data.existing_id })); // Auto-link as child
      } else if (data.created) {
        alert(`🎉 New device #${data.id} created from photo analysis!`);
      } else {
        alert('📸 Photo analyzed successfully! Check the auto-filled fields.');
      }
    } catch (e) {
      console.error('Photo analysis failed:', e);
      alert(`Photo analysis failed: ${e.message}`);
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
        }
      }));
    }
  };

  // Parent and downstream searches
  const searchParents = async (query) => {
    if (!query.trim() || !currentPanelId) {
      setParentSuggestions([]);
      setShowParentSuggestions(false);
      return;
    }
    
    try {
      const params = new URLSearchParams({ query, switchboard_id: currentPanelId, site }).toString();
      const data = await get(`/api/switchboard/search-parents?${params}`);
      setParentSuggestions(data.suggestions || []);
      setShowParentSuggestions(true);
    } catch (e) {
      console.error('Search parents failed:', e);
      setParentSuggestions([]);
    }
  };

  const searchDownstreams = async (query) => {
    if (!query.trim()) {
      setDownstreamSuggestions([]);
      setShowDownstreamSuggestions(false);
      return;
    }
    
    try {
      const params = new URLSearchParams({ query, site }).toString();
      const data = await get(`/api/switchboard/search-downstreams?${params}`);
      setDownstreamSuggestions(data.suggestions || []);
      setShowDownstreamSuggestions(true);
    } catch (e) {
      console.error('Search downstreams failed:', e);
    }
  };

  useEffect(() => {
    if (debouncedReferenceQuery) {
      searchReferencesDB(debouncedReferenceQuery);
    }
  }, [debouncedReferenceQuery]);

  useEffect(() => {
    if (debouncedParentQuery) {
      searchParents(debouncedParentQuery);
    }
  }, [debouncedParentQuery]);

  useEffect(() => {
    if (debouncedDownstreamQuery) {
      searchDownstreams(debouncedDownstreamQuery);
    }
  }, [debouncedDownstreamQuery]);

  const selectReference = (ref) => {
    setDeviceForm(prev => ({ 
      ...prev, 
      manufacturer: ref.manufacturer, 
      reference: ref.reference,
      device_type: ref.device_type || prev.device_type,
      in_amps: Number(ref.in_amps) || prev.in_amps,
      icu_kA: Number(ref.icu_kA) || prev.icu_kA,
      ics_kA: Number(ref.ics_kA) || prev.ics_kA,
      poles: Number(ref.poles) || prev.poles,
      voltage_V: Number(ref.voltage_V) || prev.voltage_V,
      trip_unit: ref.trip_unit || prev.trip_unit
    }));
    setShowReferenceSuggestions(false);
  };

  const selectParent = (parent) => {
    setDeviceForm(prev => ({ ...prev, parent_id: parent.id }));
    setParentSearchInput(parent.name || `${parent.manufacturer} ${parent.reference}` || '');
    setShowParentSuggestions(false);
  };

  const selectDownstream = (downstream) => {
    setDeviceForm(prev => ({ ...prev, downstream_switchboard_id: downstream.id }));
    setDownstreamSearchInput(`${downstream.name} (${downstream.code})`);
    setShowDownstreamSuggestions(false);
  };

  // Chat functions - for advanced questions
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    const currentInput = chatInput;
    setChatInput('');
    setChatBusy(true);
    
    try {
      // For advanced questions, use OpenAI directly
      const data = await post('/api/switchboard/search-device', { query: currentInput });
      const assistantMessage = { 
        role: 'assistant', 
        content: `I found information about: ${data.manufacturer || 'No specific device'} ${data.reference || ''}\n\n**Key Specs:**\n• Type: ${data.device_type || 'N/A'}\n• Rating: ${data.in_amps || 'N/A'}A\n• Icu: ${data.icu_kA || 'N/A'}kA\n• Poles: ${data.poles || 'N/A'}\n\n**Protection Settings:**\n${JSON.stringify(data.settings || {}, null, 2)}\n\nNeed more details? Ask me about standards, calculations, or configurations!` 
      };
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (e) {
      console.error('Chat failed:', e);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Sorry, I couldn't process that request. Try asking about specific devices like "Schneider NSX100 specs" or electrical standards. Error: ${e.message}` 
      }]);
    } finally {
      setChatBusy(false);
    }
  };

  // AI Tip function
  const getAiTip = async (context) => {
    setAiTipLoading(true);
    try {
      const data = await post('/api/switchboard/ai-tip', { query: context });
      setAiTip(data.tip || 'Consider checking device coordination and safety standards.');
      setAiTipOpen(true);
    } catch (e) {
      console.error('AI tip failed:', e);
      setAiTip('Remember to verify all protection settings and downstream connections.');
      setAiTipOpen(true);
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
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-gray-900">Switchboards</h1>
            <Info size={20} className="text-blue-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg"
              onClick={resetSwitchboardModal}
            >
              <Plus size={16} /> Add Switchboard
            </button>
            <button 
              className="btn bg-gradient-to-r from-indigo-500 to-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:from-indigo-600 hover:to-indigo-700 transition-all shadow-lg"
              onClick={() => setSidebarOpen(true)}
            >
              <Search size={16} /> AI Assistant
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card bg-white shadow-sm rounded-xl p-4 mb-6 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <input 
                className="input pr-10" 
                placeholder="Search by name or code..." 
                value={q.q} 
                onChange={e => setQ({ ...q, q: e.target.value, page: 1 })} 
              />
              <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            </div>
            <input 
              className="input" 
              placeholder="Building code..." 
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
            <div key={row.id} className="card bg-white shadow-md hover:shadow-xl rounded-xl overflow-hidden transition-all duration-300 border border-gray-200">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg text-gray-900 mb-1 truncate">{row.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        {row.code}
                      </span>
                      {row.is_principal && (
                        <Pill color="green">Principal</Pill>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-3 flex-shrink-0">
                    <button 
                      onClick={() => onEditSwitchboard(row)} 
                      className="p-2 rounded-lg hover:bg-blue-50 transition-colors"
                      title="Edit Switchboard"
                    >
                      <Edit size={16} className="text-blue-600" />
                    </button>
                    <button 
                      onClick={() => duplicateSwitchboard(row.id)} 
                      className="p-2 rounded-lg hover:bg-green-50 transition-colors"
                      title="Duplicate"
                    >
                      <Copy size={16} className="text-green-600" />
                    </button>
                    <button 
                      onClick={() => removeSwitchboard(row.id)} 
                      className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash size={16} className="text-red-600" />
                    </button>
                    <a 
                      href={`/api/switchboard/boards/${row.id}/report?site=${encodeURIComponent(site)}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="p-2 rounded-lg hover:bg-purple-50 transition-colors"
                      title="Download PDF Report"
                    >
                      <Download size={16} className="text-purple-600" />
                    </a>
                  </div>
                </div>
                
                <div className="space-y-2 mb-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Location:</span>
                    <span className="font-medium text-gray-900">
                      {row.meta.building_code || '—'} • {row.meta.floor || '—'} • {row.meta.room || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Neutral Regime:</span>
                    <span className="font-medium">{row.regime_neutral || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Site:</span>
                    <span className="font-medium text-blue-600">{row.meta.site}</span>
                  </div>
                </div>

                <button 
                  className="w-full flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 py-3 rounded-lg border-2 border-blue-200 hover:bg-blue-50 transition-all font-medium"
                  onClick={() => toggleExpand(row.id)}
                >
                  {expandedPanels[row.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>View {devices[row.id]?.length || 0} Devices</span>
                </button>

                {/* Devices Panel */}
                {expandedPanels[row.id] && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="font-semibold text-gray-900 text-lg">Device Inventory</h4>
                      <button 
                        className="btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 shadow-md"
                        onClick={() => resetDeviceModal(row.id)}
                      >
                        <Plus size={14} className="w-4 h-4" /> Add Device
                      </button>
                    </div>
                    <DeviceTree 
                      devices={buildTree(devices[row.id] || [])} 
                      panelId={row.id} 
                      onEdit={onEditDevice} 
                      onDuplicate={duplicateDevice} 
                      onDelete={removeDevice} 
                      onSetMain={setMainDevice} 
                      site={site}
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
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-sm"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 font-medium">
              Page {q.page} of {totalPages} ({total} total)
            </span>
            <button 
              disabled={q.page >= totalPages} 
              onClick={() => setQ({ ...q, page: q.page + 1 })} 
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-sm"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {rows.length === 0 && !q.q && !q.building && !q.floor && !q.room && (
          <div className="text-center py-16">
            <div className="text-gray-400 mb-6">
              <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Switchboards Yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Start by creating your first switchboard to manage electrical distribution panels and devices.
            </p>
            <button 
              className="btn bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-3 rounded-lg flex items-center gap-2 mx-auto shadow-lg hover:shadow-xl transition-all"
              onClick={resetSwitchboardModal}
            >
              <Plus size={18} /> Create First Switchboard
            </button>
          </div>
        )}

        {rows.length === 0 && (q.q || q.building || q.floor || q.room) && (
          <div className="text-center py-12">
            <Search size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Results Found</h3>
            <p className="text-gray-500 mb-4">Try adjusting your search criteria</p>
            <button 
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              onClick={() => setQ({ q: '', building: '', floor: '', room: '', page: 1 })}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Edit Switchboard' : 'New Switchboard'}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Switchboard Name</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Unique descriptive name for identification (e.g., 'Main Distribution Panel')">
                <input 
                  className="input w-full pr-10" 
                  value={switchboardForm.name} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))} 
                  placeholder="e.g., Main Distribution Panel"
                />
              </Tooltip>
            </div>
            
            <div>
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Code</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Short unique identifier for quick reference (e.g., 'MDB-01')">
                <input 
                  className="input w-full pr-10" 
                  value={switchboardForm.code} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))} 
                  placeholder="e.g., MDB-01"
                />
              </Tooltip>
            </div>

            <div className="md:col-span-2">
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Location</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Physical location details for maintenance and documentation">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input 
                    className="input" 
                    placeholder="Building (e.g., Block A)" 
                    value={switchboardForm.meta.building_code} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, building_code: e.target.value } }))} 
                  />
                  <input 
                    className="input" 
                    placeholder="Floor (e.g., 2nd)" 
                    value={switchboardForm.meta.floor} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, floor: e.target.value } }))} 
                  />
                  <input 
                    className="input" 
                    placeholder="Room (e.g., Electrical Room)" 
                    value={switchboardForm.meta.room} 
                    onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, room: e.target.value } }))} 
                  />
                </div>
              </Tooltip>
            </div>

            <div>
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Neutral Regime</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Grounding system type according to electrical standards">
                <select 
                  className="input w-full" 
                  value={switchboardForm.regime_neutral} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, regime_neutral: e.target.value }))}
                >
                  {regimes.map(regime => (
                    <option key={regime} value={regime}>
                      {regime} {regime === 'TN-S' && '(Recommended)'}
                    </option>
                  ))}
                </select>
              </Tooltip>
            </div>

            <div className="flex items-center">
              <label className="label flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={switchboardForm.is_principal} 
                  onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))} 
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="font-medium text-gray-700">Main Distribution Board</span>
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Mark as the primary incoming board for the facility">
                <div className="ml-2 invisible group-hover:visible">
                  <div className="absolute z-10 bg-gray-800 text-white text-xs rounded py-1 px-2 -top-8 right-0 whitespace-nowrap">
                    Primary incoming board
                  </div>
                </div>
              </Tooltip>
            </div>
          </div>

          {/* Operating Modes */}
          <div>
            <label className="label flex items-center gap-1 mb-3 block font-medium">
              Operating Modes <HelpCircle size={14} className="text-gray-400" />
            </label>
            <Tooltip content="Configure special operating modes for maintenance or backup">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                {[
                  { key: 'bypass', label: 'Bypass Mode' },
                  { key: 'maintenance_mode', label: 'Maintenance' },
                  { key: 'bus_coupling', label: 'Bus Coupling' },
                  { key: 'genset_backup', label: 'Genset Backup' },
                  { key: 'ups_backup', label: 'UPS Backup' }
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={switchboardForm.modes[key]} 
                      onChange={e => setSwitchboardForm(f => ({ 
                        ...f, 
                        modes: { ...f.modes, [key]: e.target.checked } 
                      }))} 
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                    />
                    <span className="text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </Tooltip>
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

      {/* Device Modal - FIXED */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Edit Device' : 'New Device'}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Device Name - Always Manual */}
            <div>
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Device Name</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Manual descriptive name (AI won't override this)">
                <input 
                  className="input w-full" 
                  value={deviceForm.name} 
                  onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))} 
                  placeholder="e.g., Main Incoming Breaker, Feeder 1, Lighting Circuit"
                />
              </Tooltip>
            </div>

            {/* Device Type */}
            <div>
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Device Type</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Category of protective device">
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

            {/* CRITICAL: Fixed Reference Field - DB + OpenAI */}
            <div className="md:col-span-2">
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Reference / Manufacturer</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Enter reference for AI auto-fill (fills all specs) or select from database">
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <input 
                      className="input flex-1" 
                      value={deviceForm.reference} 
                      onChange={e => setDeviceForm(f => ({ ...f, reference: e.target.value }))} 
                      placeholder="e.g., NSX100N, Compact NSX, Schneider"
                    />
                    <button 
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-all shadow-sm ${
                        deviceSearchBusy 
                          ? 'bg-gray-300 cursor-not-allowed' 
                          : 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-600 hover:to-indigo-700'
                      }`}
                      disabled={deviceSearchBusy || !deviceForm.reference.trim()}
                      onClick={searchDeviceReference}
                    >
                      {deviceSearchBusy ? (
                        <span className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          AI...
                        </span>
                      ) : 'AI Fill'}
                    </button>
                  </div>
                  
                  {/* Database Suggestions */}
                  {showReferenceSuggestions && referenceSuggestions.length > 0 && (
                    <div className="relative">
                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                        {referenceSuggestions.map((suggestion, idx) => (
                          <div 
                            key={idx}
                            className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                            onClick={() => selectReference(suggestion)}
                          >
                            <div className="font-medium text-sm text-gray-900">
                              {suggestion.manufacturer} - {suggestion.reference}
                            </div>
                            <div className="text-xs text-gray-500 flex gap-4">
                              <span>{suggestion.device_type}</span>
                              <span>{suggestion.in_amps}A</span>
                              <span>{suggestion.poles}P</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Tooltip>
            </div>

            {/* Photo Analysis */}
            <div className="md:col-span-2">
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Photo Analysis</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Upload device photo - AI extracts specs and matches existing devices">
                <div className="space-y-2">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    onChange={e => setPhotoFile(e.target.files[0])}
                  />
                  <button 
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                      deviceSearchBusy || !photoFile
                        ? 'bg-gray-300 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700'
                    }`}
                    disabled={deviceSearchBusy || !photoFile}
                    onClick={analyzePhoto}
                  >
                    {deviceSearchBusy ? (
                      <span className="flex items-center gap-2 justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Analyzing Photo...
                      </span>
                    ) : '🔍 Analyze Photo & Auto-Fill'}
                  </button>
                  {photoFile && (
                    <p className="text-xs text-gray-500 text-center">
                      Selected: {photoFile.name}
                    </p>
                  )}
                </div>
              </Tooltip>
            </div>

            {/* Electrical Ratings */}
            <div>
              <label className="label mb-2 block font-medium">Rated Current (A)</label>
              <input 
                type="number" 
                className="input w-full" 
                value={deviceForm.in_amps} 
                onChange={e => setDeviceForm(f => ({ ...f, in_amps: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 100"
                min="0"
                step="1"
              />
            </div>

            <div>
              <label className="label mb-2 block font-medium">Icu Breaking Capacity (kA)</label>
              <input 
                type="number" 
                step="0.1" 
                className="input w-full" 
                value={deviceForm.icu_kA} 
                onChange={e => setDeviceForm(f => ({ ...f, icu_kA: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 25"
                min="0"
                step="0.1"
              />
            </div>

            <div>
              <label className="label mb-2 block font-medium">Ics Service Capacity (kA)</label>
              <input 
                type="number" 
                step="0.1" 
                className="input w-full" 
                value={deviceForm.ics_kA} 
                onChange={e => setDeviceForm(f => ({ ...f, ics_kA: Number(e.target.value) || 0 }))} 
                placeholder="e.g., 20"
                min="0"
                step="0.1"
              />
            </div>

            <div>
              <label className="label mb-2 block font-medium">Number of Poles</label>
              <input 
                type="number" 
                min="1" 
                max="4" 
                className="input w-full" 
                value={deviceForm.poles} 
                onChange={e => setDeviceForm(f => ({ ...f, poles: Math.max(1, Math.min(4, Number(e.target.value) || 3)) }))} 
              />
            </div>

            <div>
              <label className="label mb-2 block font-medium">Voltage Rating (V)</label>
              <input 
                type="number" 
                className="input w-full" 
                value={deviceForm.voltage_V} 
                onChange={e => setDeviceForm(f => ({ ...f, voltage_V: Number(e.target.value) || 400 }))} 
                placeholder="e.g., 400"
                min="0"
                step="10"
              />
            </div>

            <div className="md:col-span-2">
              <label className="label mb-2 block font-medium">Trip Unit / Relay Type</label>
              <input 
                className="input w-full" 
                value={deviceForm.trip_unit} 
                onChange={e => setDeviceForm(f => ({ ...f, trip_unit: e.target.value }))} 
                placeholder="e.g., Micrologic 2.2, Thermal-Magnetic, Electronic"
              />
            </div>

            {/* Parent Device Search */}
            <div className="md:col-span-2 relative">
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Parent Device</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Search for upstream device (leave empty for top-level)">
                <div className="relative">
                  <input 
                    className="input w-full pr-10" 
                    placeholder="Search parent device by name or reference..."
                    value={parentSearchInput}
                    onChange={e => setParentSearchInput(e.target.value)}
                  />
                  <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
              </Tooltip>
              
              {showParentSuggestions && parentSuggestions.length > 0 && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {parentSuggestions.map((parent, idx) => (
                    <div 
                      key={idx}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      onClick={() => selectParent(parent)}
                    >
                      <div className="font-medium text-sm">
                        {parent.name || `${parent.manufacturer || ''} ${parent.reference || ''}`.trim() || 'Unnamed'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {parent.device_type} • {parent.in_amps}A
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Downstream Switchboard Search */}
            <div className="md:col-span-2 relative">
              <label className="label flex items-center gap-1 mb-2">
                <span className="font-medium">Downstream Switchboard</span> 
                <HelpCircle size={14} className="text-gray-400" />
              </label>
              <Tooltip content="Link to downstream board for hierarchy (optional)">
                <div className="relative">
                  <input 
                    className="input w-full pr-10" 
                    placeholder="Search downstream switchboard..."
                    value={downstreamSearchInput}
                    onChange={e => setDownstreamSearchInput(e.target.value)}
                  />
                  <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
              </Tooltip>
              
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

            {/* Main Incoming with AI Tip */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <Popover 
                  trigger={
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input 
                        type="checkbox" 
                        checked={deviceForm.is_main_incoming} 
                        onChange={e => {
                          const isMain = e.target.checked;
                          setDeviceForm(f => ({ ...f, is_main_incoming: isMain }));
                          getAiTip(`User selected main incoming for device: ${isMain ? 'enabled' : 'disabled'}. Provide advice on next steps like adding downstream devices or checking coordination.`);
                        }} 
                        className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <span className="font-medium text-blue-900">Main Incoming Device</span>
                    </label>
                  } 
                  content={aiTipLoading ? 'Loading AI advice...' : aiTip}
                  isOpen={aiTipOpen}
                  onClose={() => setAiTipOpen(false)}
                />
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

      {/* AI Assistant Sidebar */}
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
            
            <div className="p-4 overflow-y-auto h-[calc(100vh-140px)] space-y-4">
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

            <div className="p-4 border-t border-gray-200">
              <div className="flex gap-2">
                <input 
                  className="input flex-1 pr-10" 
                  value={chatInput} 
                  onChange={e => setChatInput(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && !chatBusy && sendChatMessage()}
                  placeholder="Ask about devices, standards, configurations..."
                  disabled={chatBusy}
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
    </section>
  );
}

// DeviceTree Component - Updated
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
