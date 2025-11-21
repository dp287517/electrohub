// src/pages/Switchboards.jsx - VERSION MOBILE PARFAITE
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';
import {
  Edit, Copy, Trash, Plus, Search, ChevronDown, ChevronRight, X,
  Building2, Layers, Zap, Menu, List, Home, AlertCircle, CheckCircle2
} from 'lucide-react';

/** ============================== UTILITIES ============================== */
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

const emptySwitchboardForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  is_principal: false,
  modes: {},
  quality: {}
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
    ir: null, tr: null, isd: null, tsd: null, ii: null, ig: null, tg: null,
    zsi: false, erms: false, curve_type: ''
  },
  is_main_incoming: false,
  parent_id: null,
  downstream_switchboard_id: null
};

function Pill({ children, color = 'blue', size = 'sm' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800'
  };
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm'
  };
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${colors[color]} ${sizes[size]}`}>
      {children}
    </span>
  );
}

/** ============================== MOBILE DRAWER ============================== */
function MobileDrawer({ open, onClose, children }) {
  if (!open) return null;
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 w-full sm:w-80 bg-white z-50 lg:hidden transform transition-transform duration-300 ease-out overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-gray-900">Navigation</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <X size={24} />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </>
  );
}

/** ============================== MOBILE TREE ============================== */
function MobileTree({ 
  buildings, 
  selectedSwitchboard,
  onSelectSwitchboard,
  expandedBuildings,
  toggleBuilding,
  expandedFloors,
  toggleFloor,
  onDrawerClose
}) {
  return (
    <div className="space-y-3">
      {buildings.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Building2 size={48} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">Aucun tableau</p>
        </div>
      ) : (
        buildings.map(building => (
          <div key={building.name} className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
            <button
              onClick={() => toggleBuilding(building.name)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expandedBuildings[building.name] ? 
                  <ChevronDown size={20} className="text-gray-600" /> : 
                  <ChevronRight size={20} className="text-gray-600" />
                }
                <Building2 size={20} className="text-blue-600" />
                <span className="font-semibold text-gray-900">{building.name || 'Sans Bâtiment'}</span>
              </div>
              <Pill color="blue" size="md">{building.count}</Pill>
            </button>
            
            {expandedBuildings[building.name] && (
              <div className="border-t border-gray-100 bg-gray-50">
                {building.floors.map(floor => (
                  <div key={floor.name}>
                    <button
                      onClick={() => toggleFloor(building.name, floor.name)}
                      className="w-full flex items-center justify-between p-4 pl-8 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {expandedFloors[`${building.name}-${floor.name}`] ?
                          <ChevronDown size={18} className="text-gray-600" /> :
                          <ChevronRight size={18} className="text-gray-600" />
                        }
                        <Layers size={18} className="text-indigo-600" />
                        <span className="font-medium text-gray-900">{floor.name || 'Sans Étage'}</span>
                      </div>
                      <Pill color="blue">{floor.count}</Pill>
                    </button>
                    
                    {expandedFloors[`${building.name}-${floor.name}`] && (
                      <div className="bg-white border-t border-gray-100">
                        {floor.switchboards.map(sb => (
                          <button
                            key={sb.id}
                            onClick={() => {
                              onSelectSwitchboard(sb);
                              onDrawerClose();
                            }}
                            className={`w-full flex items-center justify-between p-4 pl-12 transition-colors ${
                              selectedSwitchboard?.id === sb.id
                                ? 'bg-blue-50 border-l-4 border-blue-500'
                                : 'hover:bg-gray-50 active:bg-gray-100 border-l-4 border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Zap size={16} className="text-green-600 flex-shrink-0" />
                              <div className="text-left flex-1 min-w-0">
                                <div className="font-semibold text-gray-900 truncate">{sb.name}</div>
                                <div className="text-xs text-gray-500 truncate">{sb.code}</div>
                              </div>
                            </div>
                            {sb.is_principal && <Pill color="green">P</Pill>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** ============================== MOBILE DEVICE CARD ============================== */
function MobileDeviceCard({ device, onEdit, onDuplicate, onDelete, onSetMain }) {
  const [showActions, setShowActions] = useState(false);
  
  return (
    <div className={`rounded-xl border-2 p-4 ${
      device.is_main_incoming ? 'border-green-400 bg-green-50/50' : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {device.is_main_incoming && <Pill color="green" size="md">MAIN</Pill>}
            {device.position_number && <Pill color="yellow" size="md">Pos: {device.position_number}</Pill>}
          </div>
          <h3 className="font-bold text-gray-900 text-base mb-1 leading-tight">
            {device.name || `${device.manufacturer || '—'} ${device.reference || ''}`.trim() || 'Sans nom'}
          </h3>
          <Pill color="blue">{device.device_type}</Pill>
        </div>
        <button
          onClick={() => setShowActions(!showActions)}
          className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 ml-2 flex-shrink-0"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Quick Actions (collapsible) */}
      {showActions && (
        <div className="grid grid-cols-2 gap-2 mb-3 pb-3 border-b border-gray-200">
          <button
            onClick={() => { onEdit(); setShowActions(false); }}
            className="flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg active:bg-blue-100 font-medium"
          >
            <Edit size={16} />
            Modifier
          </button>
          <button
            onClick={() => { onDuplicate(); setShowActions(false); }}
            className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg active:bg-green-100 font-medium"
          >
            <Copy size={16} />
            Dupliquer
          </button>
          <button
            onClick={() => { onSetMain(!device.is_main_incoming); setShowActions(false); }}
            className={`flex items-center justify-center gap-2 p-3 rounded-lg font-medium ${
              device.is_main_incoming
                ? 'bg-red-50 text-red-700 active:bg-red-100'
                : 'bg-green-50 text-green-700 active:bg-green-100'
            }`}
          >
            <Zap size={16} />
            {device.is_main_incoming ? 'Retirer Main' : 'Définir Main'}
          </button>
          <button
            onClick={() => { onDelete(); setShowActions(false); }}
            className="flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg active:bg-red-100 font-medium"
          >
            <Trash size={16} />
            Supprimer
          </button>
        </div>
      )}

      {/* Info Grid */}
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500 text-xs block">Fabricant</span>
            <span className="font-medium text-gray-900">{device.manufacturer || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Référence</span>
            <span className="font-medium text-gray-900">{device.reference || '—'}</span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500 text-xs block">Courant nominal</span>
            <span className="font-semibold text-blue-600">{device.in_amps || '—'}A</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Pouvoir de coupure</span>
            <span className="font-semibold text-blue-600">{device.icu_ka || '—'}kA</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500 text-xs block">Pôles</span>
            <span className="font-medium text-gray-900">{device.poles || '—'}P</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Tension</span>
            <span className="font-medium text-gray-900">{device.voltage_v || '—'}V</span>
          </div>
        </div>

        {device.trip_unit && (
          <div>
            <span className="text-gray-500 text-xs block">Déclencheur</span>
            <span className="font-medium text-gray-900 text-xs">{device.trip_unit}</span>
          </div>
        )}

        {/* Settings preview */}
        {device.settings && Object.values(device.settings).some(v => v !== null && v !== false && v !== '') && (
          <div className="pt-2 border-t border-gray-200">
            <div className="flex flex-wrap gap-2 text-xs text-gray-600">
              {device.settings.ir !== null && <span className="bg-gray-100 px-2 py-1 rounded">Ir: {device.settings.ir}×In</span>}
              {device.settings.tr !== null && <span className="bg-gray-100 px-2 py-1 rounded">Tr: {device.settings.tr}s</span>}
              {device.settings.curve_type && <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">{device.settings.curve_type}</span>}
              {device.settings.zsi && <span className="bg-green-100 text-green-700 px-2 py-1 rounded font-medium">ZSI</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** ============================== MOBILE MODAL ============================== */
function MobileModal({ open, onClose, children, title }) {
  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
      {/* Sticky Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200"
        >
          <X size={24} />
        </button>
      </div>
      
      {/* Content */}
      <div className="pb-24">
        {children}
      </div>
    </div>
  );
}

/** ============================== MAIN COMPONENT ============================== */
export default function Switchboards() {
  const site = useUserSite();
  
  // Data
  const [allSwitchboards, setAllSwitchboards] = useState([]);
  const [selectedSwitchboard, setSelectedSwitchboard] = useState(null);
  const [devices, setDevices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tree state
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedFloors, setExpandedFloors] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // View mode
  const [viewMode, setViewMode] = useState('devices'); // 'devices' | 'list'
  
  // Modals
  const [openSwitchboard, setOpenSwitchboard] = useState(false);
  const [editingSwitchboard, setEditingSwitchboard] = useState(null);
  const [switchboardForm, setSwitchboardForm] = useState(emptySwitchboardForm);
  const [openDevice, setOpenDevice] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  
  // Device helpers
  const [deviceSearchBusy, setDeviceSearchBusy] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [quickAiQuery, setQuickAiQuery] = useState('');
  
  // UI
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  
  const notify = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /** ============================== API ============================== */
  const loadAllSwitchboards = async () => {
    try {
      if (!site) return;
      const params = new URLSearchParams({ site, pageSize: 1000 }).toString();
      const data = await get(`/api/switchboard/boards?${params}`);
      setAllSwitchboards(data?.data || []);
      
      // Auto-expand first building & floor
      if (data?.data?.length > 0) {
        const buildings = buildHierarchy(data.data);
        if (buildings.length > 0) {
          const firstBuilding = buildings[0].name;
          setExpandedBuildings({ [firstBuilding]: true });
          if (buildings[0].floors.length > 0) {
            const firstFloor = buildings[0].floors[0].name;
            setExpandedFloors({ [`${firstBuilding}-${firstFloor}`]: true });
          }
        }
      }
    } catch (e) {
      console.error(e);
      notify('Erreur de chargement', 'error');
    }
  };

  const loadDevices = async (switchboardId) => {
    try {
      if (!site || !switchboardId) return;
      const params = new URLSearchParams({ switchboard_id: switchboardId, site }).toString();
      const data = await get(`/api/switchboard/devices?${params}`);
      setDevices(data?.data || []);
    } catch (e) {
      console.error(e);
      notify('Erreur de chargement des dispositifs', 'error');
    }
  };

  useEffect(() => {
    if (site) loadAllSwitchboards();
  }, [site]);

  useEffect(() => {
    if (selectedSwitchboard) loadDevices(selectedSwitchboard.id);
  }, [selectedSwitchboard]);

  /** ============================== HIERARCHY ============================== */
  const buildHierarchy = (switchboards) => {
    const filtered = searchQuery
      ? switchboards.filter(sb =>
          sb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          sb.code.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : switchboards;

    const buildingsMap = {};
    
    filtered.forEach(sb => {
      const building = sb.meta?.building_code || 'Sans Bâtiment';
      const floor = sb.meta?.floor || 'Sans Étage';
      
      if (!buildingsMap[building]) {
        buildingsMap[building] = { name: building, floors: {}, count: 0 };
      }
      
      if (!buildingsMap[building].floors[floor]) {
        buildingsMap[building].floors[floor] = { name: floor, switchboards: [], count: 0 };
      }
      
      buildingsMap[building].floors[floor].switchboards.push(sb);
      buildingsMap[building].floors[floor].count++;
      buildingsMap[building].count++;
    });

    return Object.values(buildingsMap).map(building => ({
      ...building,
      floors: Object.values(building.floors)
    }));
  };

  const buildings = buildHierarchy(allSwitchboards);

  const toggleBuilding = (name) => {
    setExpandedBuildings(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleFloor = (buildingName, floorName) => {
    const key = `${buildingName}-${floorName}`;
    setExpandedFloors(prev => ({ ...prev, [key]: !prev[key] }));
  };

  /** ============================== ACTIONS ============================== */
  const resetSwitchboardModal = () => {
    setEditingSwitchboard(null);
    setSwitchboardForm({ ...emptySwitchboardForm, meta: { ...emptySwitchboardForm.meta, site } });
    setOpenSwitchboard(true);
  };

  const saveSwitchboard = async () => {
    if (!switchboardForm.name.trim() || !switchboardForm.code.trim()) {
      return notify('Nom et code requis', 'error');
    }
    setBusy(true);
    try {
      if (editingSwitchboard) {
        await put(`/api/switchboard/boards/${editingSwitchboard.id}?site=${encodeURIComponent(site)}`, switchboardForm);
        notify('✅ Tableau mis à jour', 'success');
      } else {
        await post(`/api/switchboard/boards?site=${encodeURIComponent(site)}`, switchboardForm);
        notify('✅ Tableau créé', 'success');
      }
      setOpenSwitchboard(false);
      await loadAllSwitchboards();
    } catch (e) {
      notify('❌ Erreur', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetDeviceModal = () => {
    setEditingDevice(null);
    setDeviceForm({ ...emptyDeviceForm });
    setPhotoFile(null);
    setQuickAiQuery('');
    setOpenDevice(true);
  };

  const handleEditDevice = async (device) => {
    setEditingDevice(device);
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
        zsi: Boolean(safeSettings.zsi),
        erms: Boolean(safeSettings.erms),
        curve_type: safeSettings.curve_type || ''
      },
      is_main_incoming: Boolean(device.is_main_incoming),
      parent_id: device.parent_id || null,
      downstream_switchboard_id: device.downstream_switchboard_id || null
    });
    setQuickAiQuery('');
    setOpenDevice(true);
  };

  const saveDevice = async () => {
    if (!deviceForm.name.trim()) {
      return notify('❌ Nom requis', 'error');
    }
    if (!deviceForm.in_amps || deviceForm.in_amps <= 0) {
      return notify('❌ Courant invalide', 'error');
    }
    setBusy(true);
    try {
      const { pv_tests, photos, ...payload } = deviceForm;
      payload.switchboard_id = selectedSwitchboard.id;
      
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}?site=${encodeURIComponent(site)}`, payload);
        notify('✅ Dispositif mis à jour', 'success');
      } else {
        await post(`/api/switchboard/devices?site=${encodeURIComponent(site)}`, payload);
        notify('✅ Dispositif créé', 'success');
      }
      setOpenDevice(false);
      await loadDevices(selectedSwitchboard.id);
    } catch (e) {
      notify('❌ Erreur', 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicateDevice = async (id) => {
    try {
      await post(`/api/switchboard/devices/${id}/duplicate?site=${encodeURIComponent(site)}`);
      await loadDevices(selectedSwitchboard.id);
      notify('✅ Dupliqué', 'success');
    } catch (e) {
      notify('❌ Erreur', 'error');
    }
  };

  const deleteDevice = async (id) => {
    try {
      await del(`/api/switchboard/devices/${id}?site=${encodeURIComponent(site)}`);
      await loadDevices(selectedSwitchboard.id);
      notify('✅ Supprimé', 'success');
    } catch (e) {
      notify('❌ Erreur', 'error');
    }
  };

  const setMainDevice = async (id, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main?site=${encodeURIComponent(site)}`, { is_main_incoming: isMain });
      await loadDevices(selectedSwitchboard.id);
      notify(`✅ Main ${isMain ? 'défini' : 'retiré'}`, 'success');
    } catch (e) {
      notify('❌ Erreur', 'error');
    }
  };

  const quickAiSearch = async () => {
    if (!quickAiQuery.trim()) return notify('Entrez une requête', 'info');
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
          settings: { ...prev.settings, ...data.settings }
        }));
        notify('✅ IA complété', 'success');
      } else {
        notify('Aucune correspondance', 'info');
      }
    } catch (e) {
      notify('❌ IA échoué', 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  const analyzePhoto = async () => {
    if (!photoFile) return notify('Sélectionnez une photo', 'info');
    setDeviceSearchBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', photoFile);
      const res = await fetch(
        `/api/switchboard/analyze-photo?site=${encodeURIComponent(site)}&switchboard_id=${encodeURIComponent(selectedSwitchboard.id)}`,
        { method: 'POST', credentials: 'include', body: fd }
      );
      const data = await res.json();
      if (data.error) {
        notify(`❌ ${data.error}`, 'error');
      } else if (data.manufacturer && data.reference) {
        setQuickAiQuery(`${data.manufacturer} ${data.reference}`.trim());
        notify(`✅ Photo analysée!`, 'success');
      } else {
        notify('Photo analysée', 'info');
      }
      setPhotoFile(null);
    } catch (e) {
      notify('❌ Analyse échouée', 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  // Sorted devices
  const sortedDevices = [...devices].sort((a, b) => {
    if (a.is_main_incoming && !b.is_main_incoming) return -1;
    if (!a.is_main_incoming && b.is_main_incoming) return 1;
    const posA = a.position_number || '';
    const posB = b.position_number || '';
    return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
  });

  /** ============================== RENDER ============================== */
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Mobile Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200"
        >
          <Menu size={24} />
        </button>
        <h1 className="text-lg font-semibold text-gray-900 truncate flex-1 mx-3">
          {selectedSwitchboard ? selectedSwitchboard.name : 'Tableaux'}
        </h1>
        {selectedSwitchboard && (
          <button
            onClick={resetDeviceModal}
            className="p-2 bg-blue-600 text-white rounded-lg active:bg-blue-700"
          >
            <Plus size={24} />
          </button>
        )}
      </div>

      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={20} className="text-blue-600" />
              <h2 className="font-semibold text-gray-900">Arborescence</h2>
            </div>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={resetSwitchboardModal}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700"
            >
              <Plus size={16} />
              <span className="text-sm font-medium">Nouveau Tableau</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <MobileTree
              buildings={buildings}
              selectedSwitchboard={selectedSwitchboard}
              onSelectSwitchboard={setSelectedSwitchboard}
              expandedBuildings={expandedBuildings}
              toggleBuilding={toggleBuilding}
              expandedFloors={expandedFloors}
              toggleFloor={toggleFloor}
              onDrawerClose={() => {}}
            />
          </div>
        </div>

        {/* Desktop Devices Panel */}
        <div className="flex-1 flex flex-col">
          {!selectedSwitchboard ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Zap size={64} className="mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium text-gray-600 mb-2">Sélectionnez un tableau</p>
                <p className="text-sm text-gray-500">Choisissez un tableau pour voir ses dispositifs</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white border-b border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold text-gray-900">{selectedSwitchboard.name}</h2>
                      {selectedSwitchboard.is_principal && <Pill color="green" size="md">Principal</Pill>}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>{selectedSwitchboard.code}</span>
                      <span>•</span>
                      <span>{selectedSwitchboard.meta?.building_code || '—'}</span>
                      <span>•</span>
                      <span>Étage {selectedSwitchboard.meta?.floor || '—'}</span>
                    </div>
                  </div>
                  <button
                    onClick={resetDeviceModal}
                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700"
                  >
                    <Plus size={18} />
                    Ajouter
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {sortedDevices.length === 0 ? (
                  <div className="text-center py-12">
                    <Zap size={48} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-gray-600 mb-4">Aucun dispositif</p>
                    <button
                      onClick={resetDeviceModal}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg"
                    >
                      <Plus size={16} />
                      Ajouter
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sortedDevices.map(device => (
                      <MobileDeviceCard
                        key={device.id}
                        device={device}
                        onEdit={() => handleEditDevice(device)}
                        onDuplicate={() => duplicateDevice(device.id)}
                        onDelete={() => deleteDevice(device.id)}
                        onSetMain={isMain => setMainDevice(device.id, isMain)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile Content */}
      <div className="flex-1 overflow-y-auto lg:hidden">
        {!selectedSwitchboard ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <Zap size={64} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-600 mb-2">Sélectionnez un tableau</p>
            <p className="text-sm text-gray-500 mb-6">Appuyez sur le menu pour naviguer</p>
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg active:bg-blue-700"
            >
              <Menu size={20} />
              Ouvrir le menu
            </button>
          </div>
        ) : (
          <div className="p-4">
            {/* Switchboard Info Card */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedSwitchboard.is_principal && <Pill color="green" size="md">Principal</Pill>}
                    {selectedSwitchboard.regime_neutral && <Pill color="blue">{selectedSwitchboard.regime_neutral}</Pill>}
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">{selectedSwitchboard.name}</h2>
                  <p className="text-sm text-gray-500">{selectedSwitchboard.code}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500 text-xs block">Bâtiment</span>
                  <span className="font-medium">{selectedSwitchboard.meta?.building_code || '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs block">Étage</span>
                  <span className="font-medium">{selectedSwitchboard.meta?.floor || '—'}</span>
                </div>
              </div>
            </div>

            {/* Devices */}
            {sortedDevices.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-gray-300">
                <Zap size={48} className="mx-auto mb-3 text-gray-300" />
                <p className="text-gray-600 font-medium mb-1">Aucun dispositif</p>
                <p className="text-sm text-gray-500 mb-4">Ajoutez votre premier dispositif</p>
                <button
                  onClick={resetDeviceModal}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg active:bg-blue-700 font-medium"
                >
                  <Plus size={20} />
                  Ajouter un dispositif
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedDevices.map(device => (
                  <MobileDeviceCard
                    key={device.id}
                    device={device}
                    onEdit={() => handleEditDevice(device)}
                    onDuplicate={() => duplicateDevice(device.id)}
                    onDelete={() => deleteDevice(device.id)}
                    onSetMain={isMain => setMainDevice(device.id, isMain)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="mb-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-10 pr-3 py-3 text-base border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <button
          onClick={() => {
            resetSwitchboardModal();
            setDrawerOpen(false);
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg active:from-green-600 active:to-green-700 mb-4 font-medium"
        >
          <Plus size={20} />
          Nouveau Tableau
        </button>
        <MobileTree
          buildings={buildings}
          selectedSwitchboard={selectedSwitchboard}
          onSelectSwitchboard={setSelectedSwitchboard}
          expandedBuildings={expandedBuildings}
          toggleBuilding={toggleBuilding}
          expandedFloors={expandedFloors}
          toggleFloor={toggleFloor}
          onDrawerClose={() => setDrawerOpen(false)}
        />
      </MobileDrawer>

      {/* Switchboard Modal */}
      <MobileModal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Modifier' : 'Nouveau tableau'}>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nom *</label>
            <input
              type="text"
              value={switchboardForm.name}
              onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Nom du tableau"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Code *</label>
            <input
              type="text"
              value={switchboardForm.code}
              onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Code unique"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bâtiment</label>
            <input
              type="text"
              value={switchboardForm.meta.building_code}
              onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, building_code: e.target.value } }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Code bâtiment"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Étage</label>
            <input
              type="text"
              value={switchboardForm.meta.floor}
              onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, floor: e.target.value } }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Niveau"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Salle</label>
            <input
              type="text"
              value={switchboardForm.meta.room}
              onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, room: e.target.value } }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="N° salle"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Régime de neutre</label>
            <select
              value={switchboardForm.regime_neutral}
              onChange={e => setSwitchboardForm(f => ({ ...f, regime_neutral: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {regimes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
            <input
              type="checkbox"
              checked={switchboardForm.is_principal}
              onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500 h-6 w-6"
            />
            <span className="text-base font-medium text-green-900">Tableau principal</span>
          </label>
        </div>
        
        {/* Sticky Bottom Buttons */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex gap-3">
          <button
            onClick={() => setOpenSwitchboard(false)}
            disabled={busy}
            className="flex-1 px-4 py-3 text-base font-medium text-gray-700 bg-white border border-gray-300 rounded-lg active:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={saveSwitchboard}
            disabled={busy || !switchboardForm.name.trim() || !switchboardForm.code.trim()}
            className="flex-1 px-4 py-3 text-base font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg active:from-blue-600 active:to-blue-700 disabled:opacity-50"
          >
            {busy ? 'Enregistrement...' : editingSwitchboard ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      </MobileModal>

      {/* Device Modal */}
      <MobileModal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Modifier' : 'Nouveau dispositif'}>
        <div className="p-4 space-y-4">
          {/* AI Tools */}
          <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">📸 Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:text-white active:file:bg-indigo-700"
                />
                {photoFile && (
                  <button
                    onClick={analyzePhoto}
                    disabled={deviceSearchBusy}
                    className="mt-2 w-full px-4 py-2 bg-indigo-600 text-white rounded-lg active:bg-indigo-700 disabled:opacity-50 font-medium"
                  >
                    {deviceSearchBusy ? '⏳ Analyse...' : 'Analyser'}
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">🤖 Recherche IA</label>
                <div className="flex gap-2">
                  <input
                    value={quickAiQuery}
                    onChange={e => setQuickAiQuery(e.target.value)}
                    placeholder="ex: Schneider LV429310"
                    className="flex-1 px-4 py-2 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={quickAiSearch}
                    disabled={deviceSearchBusy || !quickAiQuery.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg active:bg-blue-700 disabled:opacity-50"
                  >
                    🔍
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nom *</label>
            <input
              type="text"
              value={deviceForm.name}
              onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Nom du dispositif"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
            <input
              type="text"
              value={deviceForm.position_number}
              onChange={e => setDeviceForm(f => ({ ...f, position_number: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="ex: A12"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <select
              value={deviceForm.device_type}
              onChange={e => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {deviceTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Fabricant</label>
            <input
              type="text"
              value={deviceForm.manufacturer}
              onChange={e => setDeviceForm(f => ({ ...f, manufacturer: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Schneider"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Référence *</label>
            <input
              type="text"
              value={deviceForm.reference}
              onChange={e => setDeviceForm(f => ({ ...f, reference: e.target.value }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="LV429310"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Courant nominal (A) *</label>
            <input
              type="number"
              min="0"
              value={deviceForm.in_amps ?? ''}
              onChange={e => setDeviceForm(f => ({ ...f, in_amps: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pouvoir de coupure Icu (kA)</label>
            <input
              type="number"
              step="0.1"
              value={deviceForm.icu_ka ?? ''}
              onChange={e => setDeviceForm(f => ({ ...f, icu_ka: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="25"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pôles</label>
            <input
              type="number"
              min="1"
              value={deviceForm.poles ?? ''}
              onChange={e => setDeviceForm(f => ({ ...f, poles: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tension (V)</label>
            <input
              type="number"
              value={deviceForm.voltage_v ?? ''}
              onChange={e => setDeviceForm(f => ({ ...f, voltage_v: e.target.value === '' ? null : Number(e.target.value) }))}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="400"
            />
          </div>

          <label className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
            <input
              type="checkbox"
              checked={deviceForm.is_main_incoming}
              onChange={e => setDeviceForm(f => ({ ...f, is_main_incoming: e.target.checked }))}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500 h-6 w-6"
            />
            <span className="text-base font-medium text-green-900">Main Incoming</span>
          </label>

          {/* Protection Settings (collapsible) */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 mb-3">Réglages protection</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Ir (×In)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={deviceForm.settings.ir ?? ''}
                    onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, ir: e.target.value === '' ? null : Number(e.target.value) }}))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Tr (s)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={deviceForm.settings.tr ?? ''}
                    onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, tr: e.target.value === '' ? null : Number(e.target.value) }}))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Courbe</label>
                <input
                  type="text"
                  value={deviceForm.settings.curve_type}
                  onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, curve_type: e.target.value }}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  placeholder="B/C/D"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Bottom Buttons */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 flex gap-3">
          <button
            onClick={() => setOpenDevice(false)}
            disabled={busy}
            className="flex-1 px-4 py-3 text-base font-medium text-gray-700 bg-white border border-gray-300 rounded-lg active:bg-gray-50"
          >
            Annuler
          </button>
          <button
            onClick={saveDevice}
            disabled={busy || !deviceForm.name.trim() || !deviceForm.in_amps}
            className="flex-1 px-4 py-3 text-base font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg active:from-blue-600 active:to-blue-700 disabled:opacity-50"
          >
            {busy ? '⏳' : editingDevice ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      </MobileModal>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 left-6 lg:left-auto lg:w-auto z-50 px-6 py-4 rounded-xl shadow-2xl text-base font-medium flex items-center gap-3 ${
          toast.type === 'success' ? 'bg-green-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-gray-900 text-white'
        }`}>
          {toast.type === 'success' && <CheckCircle2 size={20} />}
          {toast.type === 'error' && <AlertCircle size={20} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
