// src/pages/Switchboards.jsx - VERSION HIÉRARCHIQUE COMPLÈTE
import { useEffect, useState } from 'react';
import { get, post, put, del, upload } from '../lib/api.js';
import {
  Edit, Copy, Trash, Plus, Search, ChevronDown, ChevronRight, X,
  Building2, Layers, Zap, Menu, HelpCircle, AlertCircle, CheckCircle2
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
    ir: null, tr: null, isd: null, tsd: null, ii: null, ig: null, tg: null,
    zsi: false, erms: false, curve_type: ''
  },
  is_main_incoming: false,
  parent_id: null,
  downstream_switchboard_id: null,
  pv_tests: null,
  photos: []
};

function Pill({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800'
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function Modal({ open, onClose, children, title, size = 'max-w-4xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className={`w-full ${size} bg-white rounded-2xl shadow-2xl my-8`}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>{children}</div>
      </div>
    </div>
  );
}

/** ============================== TREE SIDEBAR ============================== */
function TreeSidebar({ 
  buildings, 
  selectedSwitchboard, 
  onSelectSwitchboard, 
  expandedBuildings, 
  toggleBuilding,
  expandedFloors, 
  toggleFloor,
  collapsed,
  onToggleCollapse,
  onAddSwitchboard,
  onEditSwitchboard,
  searchQuery,
  onSearchChange
}) {
  if (collapsed) {
    return (
      <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-4">
        <button
          onClick={onToggleCollapse}
          className="p-3 rounded-lg hover:bg-gray-100 transition-colors"
          title="Expand sidebar"
        >
          <Menu size={20} className="text-gray-700" />
        </button>
        <button
          onClick={onAddSwitchboard}
          className="p-3 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
          title="Add Switchboard"
        >
          <Plus size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Building2 size={20} className="text-blue-600" />
            <h2 className="font-semibold text-gray-900">Arborescence</h2>
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
            title="Collapse sidebar"
          >
            <Menu size={18} className="text-gray-700" />
          </button>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Rechercher..."
            className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <button
          onClick={onAddSwitchboard}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-sm"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">Nouveau Tableau</span>
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {buildings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Building2 size={48} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">Aucun tableau</p>
          </div>
        ) : (
          buildings.map(building => (
            <BuildingNode
              key={building.name}
              building={building}
              expanded={expandedBuildings[building.name]}
              onToggle={() => toggleBuilding(building.name)}
              expandedFloors={expandedFloors}
              onToggleFloor={toggleFloor}
              selectedSwitchboard={selectedSwitchboard}
              onSelectSwitchboard={onSelectSwitchboard}
              onEditSwitchboard={onEditSwitchboard}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BuildingNode({ 
  building, 
  expanded, 
  onToggle, 
  expandedFloors, 
  onToggleFloor,
  selectedSwitchboard,
  onSelectSwitchboard,
  onEditSwitchboard
}) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Building2 size={18} className="text-blue-600" />
          <span className="font-medium text-gray-900">{building.name || 'Sans Bâtiment'}</span>
        </div>
        <Pill color="blue">{building.count}</Pill>
      </button>
      
      {expanded && (
        <div className="border-t border-gray-200 bg-gray-50">
          {building.floors.map(floor => (
            <FloorNode
              key={floor.name}
              floor={floor}
              buildingName={building.name}
              expanded={expandedFloors[`${building.name}-${floor.name}`]}
              onToggle={() => onToggleFloor(building.name, floor.name)}
              selectedSwitchboard={selectedSwitchboard}
              onSelectSwitchboard={onSelectSwitchboard}
              onEditSwitchboard={onEditSwitchboard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FloorNode({ 
  floor, 
  buildingName, 
  expanded, 
  onToggle,
  selectedSwitchboard,
  onSelectSwitchboard,
  onEditSwitchboard
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-2.5 pl-8 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Layers size={16} className="text-indigo-600" />
          <span className="text-sm font-medium text-gray-900">{floor.name || 'Sans Étage'}</span>
        </div>
        <Pill color="blue">{floor.count}</Pill>
      </button>
      
      {expanded && (
        <div className="bg-white">
          {floor.switchboards.map(sb => (
            <div
              key={sb.id}
              className={`flex items-center justify-between p-2.5 pl-14 hover:bg-blue-50 cursor-pointer transition-colors border-l-2 ${
                selectedSwitchboard?.id === sb.id
                  ? 'bg-blue-50 border-blue-500'
                  : 'border-transparent'
              }`}
              onClick={() => onSelectSwitchboard(sb)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-green-600 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-900 truncate">{sb.name}</span>
                </div>
                <div className="text-xs text-gray-500 ml-5">{sb.code}</div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                {sb.is_principal && <Pill color="green">P</Pill>}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onEditSwitchboard(sb);
                  }}
                  className="p-1 rounded hover:bg-blue-100 transition-colors"
                  title="Modifier"
                >
                  <Edit size={12} className="text-blue-600" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** ============================== DEVICES PANEL ============================== */
function DevicesPanel({ 
  switchboard, 
  devices, 
  onAddDevice, 
  onEditDevice, 
  onDuplicateDevice, 
  onDeleteDevice,
  onSetMainDevice,
  onRefresh
}) {
  if (!switchboard) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Zap size={64} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-600 mb-2">Sélectionnez un tableau</p>
          <p className="text-sm text-gray-500">Choisissez un tableau dans l'arborescence pour voir ses dispositifs</p>
        </div>
      </div>
    );
  }

  // Tri intelligent : Main incoming d'abord, puis par position
  const sortedDevices = [...devices].sort((a, b) => {
    if (a.is_main_incoming && !b.is_main_incoming) return -1;
    if (!a.is_main_incoming && b.is_main_incoming) return 1;
    
    const posA = a.position_number || '';
    const posB = b.position_number || '';
    return posA.localeCompare(posB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">{switchboard.name}</h2>
              {switchboard.is_principal && <Pill color="green">Principal</Pill>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Building2 size={14} />
                {switchboard.meta?.building_code || '—'}
              </span>
              <span className="flex items-center gap-1">
                <Layers size={14} />
                {switchboard.meta?.floor || '—'}
              </span>
              {switchboard.meta?.room && (
                <span>Salle {switchboard.meta.room}</span>
              )}
              <span className="flex items-center gap-1">
                <Zap size={14} />
                {switchboard.code}
              </span>
              {switchboard.regime_neutral && (
                <Pill color="blue">{switchboard.regime_neutral}</Pill>
              )}
            </div>
          </div>
          <button
            onClick={onAddDevice}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl"
          >
            <Plus size={18} />
            <span className="font-medium">Ajouter un dispositif</span>
          </button>
        </div>
      </div>

      {/* Devices List */}
      <div className="flex-1 overflow-y-auto p-6">
        {sortedDevices.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-gray-300">
            <Zap size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg font-medium text-gray-600 mb-1">Aucun dispositif</p>
            <p className="text-sm text-gray-500 mb-4">Ajoutez votre premier dispositif à ce tableau</p>
            <button
              onClick={onAddDevice}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus size={16} />
              Ajouter un dispositif
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedDevices.map(device => (
              <DeviceCard
                key={device.id}
                device={device}
                onEdit={() => onEditDevice(device)}
                onDuplicate={() => onDuplicateDevice(device.id)}
                onDelete={() => onDeleteDevice(device.id)}
                onSetMain={isMain => onSetMainDevice(device.id, isMain)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceCard({ device, onEdit, onDuplicate, onDelete, onSetMain }) {
  return (
    <div className={`bg-white rounded-xl border-2 p-5 hover:shadow-md transition-all ${
      device.is_main_incoming ? 'border-green-400 bg-green-50/30' : 'border-gray-200'
    }`}>
      <div className="flex flex-col lg:flex-row justify-between gap-4">
        {/* Info principale */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {device.is_main_incoming && (
              <Pill color="green">MAIN INCOMING</Pill>
            )}
            {device.position_number && (
              <Pill color="yellow">Pos: {device.position_number}</Pill>
            )}
            <Pill color="blue">{device.device_type}</Pill>
            {device.downstream_switchboard_id && (
              <Pill color="blue">→ SB</Pill>
            )}
          </div>
          
          <h3 className="text-lg font-semibold text-gray-900 mb-2 truncate">
            {device.name || `${device.manufacturer || '—'} ${device.reference || ''}`.trim() || 'Sans nom'}
          </h3>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500 text-xs">Fabricant</span>
              <div className="font-medium">{device.manufacturer || '—'}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Référence</span>
              <div className="font-medium">{device.reference || '—'}</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Courant nominal</span>
              <div className="font-medium">{device.in_amps || '—'}A</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Pouvoir de coupure</span>
              <div className="font-medium">Icu: {device.icu_ka || '—'}kA</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Pôles</span>
              <div className="font-medium">{device.poles || '—'}P</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Tension</span>
              <div className="font-medium">{device.voltage_v || '—'}V</div>
            </div>
            {device.trip_unit && (
              <div className="col-span-2">
                <span className="text-gray-500 text-xs">Déclencheur</span>
                <div className="font-medium truncate">{device.trip_unit}</div>
              </div>
            )}
          </div>

          {/* Settings preview */}
          {device.settings && Object.values(device.settings).some(v => v !== null && v !== false && v !== '') && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {device.settings.ir !== null && <span>Ir: {device.settings.ir}×In</span>}
                {device.settings.tr !== null && <span>Tr: {device.settings.tr}s</span>}
                {device.settings.isd !== null && <span>Isd: {device.settings.isd}×Ir</span>}
                {device.settings.curve_type && <span>Courbe: {device.settings.curve_type}</span>}
                {device.settings.zsi && <span className="text-green-600">ZSI</span>}
                {device.settings.erms && <span className="text-blue-600">ERMS</span>}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex lg:flex-col items-center lg:items-end gap-2">
          <button
            onClick={onEdit}
            className="p-2.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Modifier"
          >
            <Edit size={18} />
          </button>
          <button
            onClick={onDuplicate}
            className="p-2.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
            title="Dupliquer"
          >
            <Copy size={18} />
          </button>
          <button
            onClick={onDelete}
            className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Supprimer"
          >
            <Trash size={18} />
          </button>
          <button
            onClick={() => onSetMain(!device.is_main_incoming)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              device.is_main_incoming
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {device.is_main_incoming ? 'Retirer Main' : 'Définir Main'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ============================== MAIN COMPONENT ============================== */
export default function Switchboards() {
  const site = useUserSite();
  
  // Data state
  const [allSwitchboards, setAllSwitchboards] = useState([]);
  const [selectedSwitchboard, setSelectedSwitchboard] = useState(null);
  const [devices, setDevices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Tree state
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [expandedFloors, setExpandedFloors] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
  const [parentSuggestions, setParentSuggestions] = useState([]);
  const [downstreamSuggestions, setDownstreamSuggestions] = useState([]);
  const [referenceSuggestions, setReferenceSuggestions] = useState([]);
  const [showParentSuggestions, setShowParentSuggestions] = useState(false);
  const [showDownstreamSuggestions, setShowDownstreamSuggestions] = useState(false);
  const [showReferenceSuggestions, setShowReferenceSuggestions] = useState(false);
  const [parentSearchInput, setParentSearchInput] = useState('');
  const [downstreamSearchInput, setDownstreamSearchInput] = useState('');
  const [quickAiQuery, setQuickAiQuery] = useState('');

  // UI state
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  
  const notify = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

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

  /** ============================== API CALLS ============================== */
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
      console.error('Load switchboards failed:', e);
      notify('Échec du chargement des tableaux', 'error');
    }
  };

  const loadDevices = async (switchboardId) => {
    try {
      if (!site || !switchboardId) return;
      const params = new URLSearchParams({ switchboard_id: switchboardId, site }).toString();
      const data = await get(`/api/switchboard/devices?${params}`);
      setDevices(data?.data || []);
    } catch (e) {
      console.error('Load devices failed:', e);
      notify('Échec du chargement des dispositifs', 'error');
    }
  };

  useEffect(() => {
    if (site) loadAllSwitchboards();
  }, [site]);

  useEffect(() => {
    if (selectedSwitchboard) loadDevices(selectedSwitchboard.id);
  }, [selectedSwitchboard]);

  /** ============================== HIERARCHY BUILDER ============================== */
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

  /** ============================== ACTIONS ============================== */
  const toggleBuilding = (name) => {
    setExpandedBuildings(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleFloor = (buildingName, floorName) => {
    const key = `${buildingName}-${floorName}`;
    setExpandedFloors(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectSwitchboard = (sb) => {
    setSelectedSwitchboard(sb);
  };

  const resetSwitchboardModal = () => {
    setEditingSwitchboard(null);
    setSwitchboardForm({ ...emptySwitchboardForm, meta: { ...emptySwitchboardForm.meta, site } });
    setOpenSwitchboard(true);
  };

  const handleEditSwitchboard = (sb) => {
    setEditingSwitchboard(sb);
    setSwitchboardForm({
      name: sb.name || '',
      code: sb.code || '',
      meta: {
        site: sb.meta?.site || site,
        building_code: sb.meta?.building_code || '',
        floor: sb.meta?.floor || '',
        room: sb.meta?.room || ''
      },
      regime_neutral: sb.regime_neutral || 'TN-S',
      is_principal: !!sb.is_principal,
      modes: {
        bypass: !!sb.modes?.bypass,
        maintenance_mode: !!sb.modes?.maintenance_mode,
        bus_coupling: !!sb.modes?.bus_coupling,
        genset_backup: !!sb.modes?.genset_backup,
        ups_backup: !!sb.modes?.ups_backup
      },
      quality: {
        thd: sb.quality?.thd ?? '',
        flicker: sb.quality?.flicker ?? ''
      }
    });
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
        notify('Tableau mis à jour', 'success');
      } else {
        await post(`/api/switchboard/boards?site=${encodeURIComponent(site)}`, switchboardForm);
        notify('Tableau créé', 'success');
      }
      setOpenSwitchboard(false);
      await loadAllSwitchboards();
    } catch (e) {
      console.error(e);
      notify('Erreur: ' + (e.message || 'Unknown'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetDeviceModal = () => {
    setEditingDevice(null);
    setDeviceForm({ ...emptyDeviceForm });
    setPhotoFile(null);
    setParentSearchInput('');
    setDownstreamSearchInput('');
    setQuickAiQuery('');
    setReferenceSuggestions([]);
    setShowReferenceSuggestions(false);
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
      downstream_switchboard_id: device.downstream_switchboard_id || null,
      pv_tests: null,
      photos: []
    });
    
    setParentSearchInput('');
    setDownstreamSearchInput('');
    setPhotoFile(null);
    setQuickAiQuery('');
    setOpenDevice(true);
  };

  const saveDevice = async () => {
    if (!deviceForm.name.trim()) {
      return notify('Nom du dispositif requis', 'error');
    }
    if (!deviceForm.in_amps || deviceForm.in_amps <= 0) {
      return notify('Courant nominal invalide', 'error');
    }
    setBusy(true);
    try {
      const { pv_tests, photos, ...payload } = deviceForm;
      payload.switchboard_id = selectedSwitchboard.id;
      
      if (editingDevice) {
        await put(`/api/switchboard/devices/${editingDevice.id}?site=${encodeURIComponent(site)}`, payload);
        notify('Dispositif mis à jour', 'success');
      } else {
        await post(`/api/switchboard/devices?site=${encodeURIComponent(site)}`, payload);
        notify('Dispositif créé', 'success');
      }
      setOpenDevice(false);
      await loadDevices(selectedSwitchboard.id);
    } catch (e) {
      console.error(e);
      notify('Erreur: ' + (e.message || 'Unknown'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicateDevice = async (id) => {
    try {
      await post(`/api/switchboard/devices/${id}/duplicate?site=${encodeURIComponent(site)}`);
      await loadDevices(selectedSwitchboard.id);
      notify('Dispositif dupliqué', 'success');
    } catch (e) {
      notify('Erreur de duplication', 'error');
    }
  };

  const deleteDevice = async (id) => {
    try {
      await del(`/api/switchboard/devices/${id}?site=${encodeURIComponent(site)}`);
      await loadDevices(selectedSwitchboard.id);
      notify('Dispositif supprimé', 'success');
    } catch (e) {
      notify('Erreur de suppression', 'error');
    }
  };

  const setMainDevice = async (id, isMain) => {
    try {
      await put(`/api/switchboard/devices/${id}/set-main?site=${encodeURIComponent(site)}`, { is_main_incoming: isMain });
      await loadDevices(selectedSwitchboard.id);
      notify(`Main incoming ${isMain ? 'défini' : 'retiré'}`, 'success');
    } catch (e) {
      notify('Erreur', 'error');
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
        notify('Spécifications IA complétées', 'success');
      } else {
        notify('Aucune correspondance exacte', 'info');
      }
    } catch (e) {
      notify('Recherche IA échouée', 'error');
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
        notify(`Analyse échouée: ${data.error}`, 'error');
      } else if (data.manufacturer && data.reference) {
        setQuickAiQuery(`${data.manufacturer} ${data.reference}`.trim());
        notify(`Photo analysée! Recherche IA prête: "${data.manufacturer} ${data.reference}"`, 'success');
      } else {
        notify('Photo analysée mais aucun fabricant/référence identifié', 'info');
      }
      setPhotoFile(null);
    } catch (e) {
      notify('Analyse photo échouée', 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  };

  // Search handlers (debounced)
  useEffect(() => {
    if (debouncedParentQuery && selectedSwitchboard) {
      (async () => {
        try {
          const params = new URLSearchParams({ query: debouncedParentQuery, switchboard_id: selectedSwitchboard.id, site }).toString();
          const data = await get(`/api/switchboard/search-parents?${params}`);
          setParentSuggestions(data.suggestions || []);
          setShowParentSuggestions(true);
        } catch (e) {
          console.error(e);
        }
      })();
    } else {
      setParentSuggestions([]);
      setShowParentSuggestions(false);
    }
  }, [debouncedParentQuery, selectedSwitchboard, site]);

  useEffect(() => {
    if (debouncedDownstreamQuery) {
      (async () => {
        try {
          const params = new URLSearchParams({ query: debouncedDownstreamQuery, site }).toString();
          const data = await get(`/api/switchboard/search-downstreams?${params}`);
          setDownstreamSuggestions(data.suggestions || []);
          setShowDownstreamSuggestions(true);
        } catch (e) {
          console.error(e);
        }
      })();
    } else {
      setDownstreamSuggestions([]);
      setShowDownstreamSuggestions(false);
    }
  }, [debouncedDownstreamQuery, site]);

  const selectParent = (parent) => {
    setDeviceForm(f => ({ ...f, parent_id: parent.id }));
    setParentSearchInput(`${parent.name} (${parent.manufacturer} ${parent.reference})`.trim());
    setShowParentSuggestions(false);
    notify('Dispositif parent sélectionné', 'success');
  };

  const selectDownstream = (sb) => {
    setDeviceForm(f => ({ ...f, downstream_switchboard_id: sb.id }));
    setDownstreamSearchInput(`${sb.name} (${sb.code})`.trim());
    setShowDownstreamSuggestions(false);
    notify('Tableau aval sélectionné', 'success');
  };

  /** ============================== RENDER ============================== */
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Tree Sidebar */}
      <TreeSidebar
        buildings={buildings}
        selectedSwitchboard={selectedSwitchboard}
        onSelectSwitchboard={handleSelectSwitchboard}
        expandedBuildings={expandedBuildings}
        toggleBuilding={toggleBuilding}
        expandedFloors={expandedFloors}
        toggleFloor={toggleFloor}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onAddSwitchboard={resetSwitchboardModal}
        onEditSwitchboard={handleEditSwitchboard}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Devices Panel */}
      <DevicesPanel
        switchboard={selectedSwitchboard}
        devices={devices}
        onAddDevice={resetDeviceModal}
        onEditDevice={handleEditDevice}
        onDuplicateDevice={duplicateDevice}
        onDeleteDevice={deleteDevice}
        onSetMainDevice={setMainDevice}
        onRefresh={() => selectedSwitchboard && loadDevices(selectedSwitchboard.id)}
      />

      {/* Switchboard Modal */}
      <Modal open={openSwitchboard} onClose={() => setOpenSwitchboard(false)} title={editingSwitchboard ? 'Modifier le tableau' : 'Nouveau tableau'}>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nom *</label>
              <input
                type="text"
                value={switchboardForm.name}
                onChange={e => setSwitchboardForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Nom du tableau"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Code *</label>
              <input
                type="text"
                value={switchboardForm.code}
                onChange={e => setSwitchboardForm(f => ({ ...f, code: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Code unique"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Bâtiment</label>
              <input
                type="text"
                value={switchboardForm.meta.building_code}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, building_code: e.target.value } }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Code bâtiment"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Étage</label>
              <input
                type="text"
                value={switchboardForm.meta.floor}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, floor: e.target.value } }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Niveau"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Salle</label>
              <input
                type="text"
                value={switchboardForm.meta.room}
                onChange={e => setSwitchboardForm(f => ({ ...f, meta: { ...f.meta, room: e.target.value } }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="N° salle"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Régime de neutre</label>
              <select
                value={switchboardForm.regime_neutral}
                onChange={e => setSwitchboardForm(f => ({ ...f, regime_neutral: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {regimes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={switchboardForm.is_principal}
                  onChange={e => setSwitchboardForm(f => ({ ...f, is_principal: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-5 w-5"
                />
                <span className="text-sm font-medium text-gray-700">Tableau principal</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={() => setOpenSwitchboard(false)}
              disabled={busy}
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={saveSwitchboard}
              disabled={busy || !switchboardForm.name.trim() || !switchboardForm.code.trim()}
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 transition-all shadow-lg"
            >
              {busy ? 'Enregistrement...' : editingSwitchboard ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Device Modal */}
      <Modal open={openDevice} onClose={() => setOpenDevice(false)} title={editingDevice ? 'Modifier le dispositif' : 'Nouveau dispositif'} size="max-w-5xl">
        <div className="p-6 space-y-6">
          {/* AI Quick Tools */}
          <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">📸 Analyse photo</label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                  <button
                    onClick={analyzePhoto}
                    disabled={deviceSearchBusy || !photoFile}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50 whitespace-nowrap"
                  >
                    {deviceSearchBusy ? '⏳' : 'Analyser'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">🤖 Recherche IA rapide</label>
                <div className="flex gap-2">
                  <input
                    value={quickAiQuery}
                    onChange={e => setQuickAiQuery(e.target.value)}
                    placeholder="ex: Schneider LV429310"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={quickAiSearch}
                    disabled={deviceSearchBusy || !quickAiQuery.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
                  >
                    Rechercher
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Device Form */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Nom du dispositif *</label>
              <input
                type="text"
                value={deviceForm.name}
                onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Nom descriptif"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
              <input
                type="text"
                value={deviceForm.position_number}
                onChange={e => setDeviceForm(f => ({ ...f, position_number: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="ex: A12"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type de dispositif</label>
              <select
                value={deviceForm.device_type}
                onChange={e => setDeviceForm(f => ({ ...f, device_type: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Schneider"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Référence *</label>
              <input
                type="text"
                value={deviceForm.reference}
                onChange={e => setDeviceForm(f => ({ ...f, reference: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="LV429310"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Courant nominal (A) *</label>
              <input
                type="number"
                min="0"
                value={deviceForm.in_amps ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, in_amps: e.target.value === '' ? null : Number(e.target.value) }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Icu (kA)</label>
              <input
                type="number"
                step="0.1"
                value={deviceForm.icu_ka ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, icu_ka: e.target.value === '' ? null : Number(e.target.value) }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tension (V)</label>
              <input
                type="number"
                value={deviceForm.voltage_v ?? ''}
                onChange={e => setDeviceForm(f => ({ ...f, voltage_v: e.target.value === '' ? null : Number(e.target.value) }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="400"
              />
            </div>
          </div>

          {/* Parent & Downstream */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Dispositif parent (amont)</label>
              <div className="relative">
                <input
                  type="text"
                  value={parentSearchInput}
                  onChange={e => {
                    setParentSearchInput(e.target.value);
                    setDeviceForm(f => ({ ...f, parent_id: null }));
                  }}
                  className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Rechercher..."
                />
                <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </div>
              {showParentSuggestions && parentSuggestions.length > 0 && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {parentSuggestions.map((p, i) => (
                    <div key={i} className="px-4 py-2 hover:bg-gray-50 cursor-pointer" onClick={() => selectParent(p)}>
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.manufacturer} {p.reference}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Tableau aval</label>
              <div className="relative">
                <input
                  type="text"
                  value={downstreamSearchInput}
                  onChange={e => {
                    setDownstreamSearchInput(e.target.value);
                    setDeviceForm(f => ({ ...f, downstream_switchboard_id: null }));
                  }}
                  className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Rechercher..."
                />
                <Search size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </div>
              {showDownstreamSuggestions && downstreamSuggestions.length > 0 && (
                <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                  {downstreamSuggestions.map((sb, i) => (
                    <div key={i} className="px-4 py-2 hover:bg-gray-50 cursor-pointer" onClick={() => selectDownstream(sb)}>
                      <div className="font-medium text-sm">{sb.name}</div>
                      <div className="text-xs text-gray-500">{sb.code}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Incoming */}
          <div className="flex items-center gap-2 p-4 bg-green-50 rounded-lg border border-green-200">
            <input
              type="checkbox"
              checked={deviceForm.is_main_incoming}
              onChange={e => setDeviceForm(f => ({ ...f, is_main_incoming: e.target.checked }))}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500 h-5 w-5"
            />
            <span className="font-medium text-green-900">Main Incoming Device</span>
          </div>

          {/* Protection Settings */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
              Réglages de protection
              <HelpCircle size={14} className="text-gray-400" />
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Ir (×In)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.ir ?? ''}
                  onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, ir: e.target.value === '' ? null : Number(e.target.value) }}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Tr (s)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.tr ?? ''}
                  onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, tr: e.target.value === '' ? null : Number(e.target.value) }}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Isd (×Ir)</label>
                <input
                  type="number"
                  step="0.1"
                  value={deviceForm.settings.isd ?? ''}
                  onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, isd: e.target.value === '' ? null : Number(e.target.value) }}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Courbe</label>
                <input
                  type="text"
                  value={deviceForm.settings.curve_type}
                  onChange={e => setDeviceForm(f => ({ ...f, settings: { ...f.settings, curve_type: e.target.value }}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="B/C/D"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={() => setOpenDevice(false)}
              disabled={busy}
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={saveDevice}
              disabled={busy || !deviceForm.name.trim() || !deviceForm.in_amps}
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 transition-all shadow-lg"
            >
              {busy ? 'Enregistrement...' : editingDevice ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-6 py-4 rounded-xl shadow-2xl text-sm font-medium flex items-center gap-3 ${
          toast.type === 'success' ? 'bg-green-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-gray-900 text-white'
        }`}>
          {toast.type === 'success' && <CheckCircle2 size={18} />}
          {toast.type === 'error' && <AlertCircle size={18} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
