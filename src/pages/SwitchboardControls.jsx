// src/pages/SwitchboardControls.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, API_BASE } from "../lib/api.js";
import { Zap, Cpu, Settings, Truck, Battery, Grid3X3, Package, PlusSquare, Database } from "lucide-react";
import NCResolutionModal from "../components/NCResolutionModal.jsx";

// ============================================================
// ANIMATIONS CSS
// ============================================================
const styles = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.animate-slideUp { animation: slideUp 0.4s ease-out; }
.animate-fadeIn { animation: fadeIn 0.3s ease-out; }
.animate-pulse-slow { animation: pulse 2s ease-in-out infinite; }
.animate-bounce-slow { animation: bounce 1.5s ease-in-out infinite; }
.gradient-animate {
  background-size: 200% 200%;
  animation: gradient 3s ease infinite;
}
`;

// Inject styles
if (typeof document !== 'undefined' && !document.getElementById('control-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'control-styles';
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

// ============================================================
// HELPER: Get equipment display name and link
// ============================================================
// Icons matching UnifiedEquipmentMap markers
const EQUIPMENT_ICONS = {
  meca: { Icon: Settings, color: 'text-orange-500', bg: 'bg-orange-100' },      // Gear icon like map marker
  vsd: { Icon: Cpu, color: 'text-emerald-500', bg: 'bg-emerald-100' },          // CPU/chip icon like map marker
  hv: { Icon: Zap, color: 'text-amber-500', bg: 'bg-amber-100' },               // Lightning bolt
  mobile: { Icon: Cpu, color: 'text-cyan-500', bg: 'bg-cyan-100' },             // CPU/chip icon
  glo: { Icon: Battery, color: 'text-emerald-500', bg: 'bg-emerald-100' },      // Battery icon
  datahub: { Icon: Database, color: 'text-purple-500', bg: 'bg-purple-100' },   // Database icon for datahub
  device: { Icon: Grid3X3, color: 'text-gray-500', bg: 'bg-gray-100' },
  switchboard: { Icon: Zap, color: 'text-amber-500', bg: 'bg-amber-100' },
  unknown: { Icon: Package, color: 'text-gray-500', bg: 'bg-gray-100' },
};

// Helper: Check if a due date is overdue (comparing DATE only, not time)
// This fixes the bug where "today" items were marked as overdue after midnight
const isDateOverdue = (dueDateStr) => {
  if (!dueDateStr) return false;
  // Get today's date at midnight in local timezone
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Parse the due date and set to midnight
  const dueDate = new Date(dueDateStr);
  dueDate.setHours(0, 0, 0, 0);
  // Only overdue if strictly before today (not today itself)
  return dueDate < today;
};

const getEquipmentDisplay = (item) => {
  // Determine equipment type and name
  if (item.meca_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.meca;
    return {
      name: item.meca_name || item.meca_equipment_name || item.equipment_name || `Équip. méca #${item.meca_equipment_id}`,
      type: 'meca',
      icon: <Icon size={16} className={color} />,
      link: `/app/meca?meca=${item.meca_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=meca&id=${item.meca_equipment_id}`,
      category: item.meca_category || item.category || ''
    };
  }
  if (item.vsd_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.vsd;
    return {
      name: item.vsd_name || item.vsd_equipment_name || item.equipment_name || `Variateur #${item.vsd_equipment_id}`,
      type: 'vsd',
      icon: <Icon size={16} className={color} />,
      link: `/app/vsd?vsd=${item.vsd_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=vsd&id=${item.vsd_equipment_id}`,
      category: ''
    };
  }
  if (item.hv_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.hv;
    return {
      name: item.hv_name || item.hv_equipment_name || item.equipment_name || `Équip. HT #${item.hv_equipment_id}`,
      type: 'hv',
      icon: <Icon size={16} className={color} />,
      link: `/app/hv?equipment=${item.hv_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=hv&id=${item.hv_equipment_id}`,
      category: item.hv_regime_neutral || ''
    };
  }
  if (item.mobile_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.mobile;
    return {
      name: item.mobile_equipment_name || item.equipment_name || `Équip. mobile #${item.mobile_equipment_id}`,
      type: 'mobile',
      icon: <Icon size={16} className={color} />,
      link: `/app/mobile-equipments?equipment=${item.mobile_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=mobile&id=${item.mobile_equipment_id}`,
      category: item.mobile_category || item.category || ''
    };
  }
  if (item.glo_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.glo;
    return {
      name: item.glo_equipment_name || item.equipment_name || `Équip. GLO #${item.glo_equipment_id}`,
      type: 'glo',
      icon: <Icon size={16} className={color} />,
      link: `/app/glo?glo=${item.glo_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=glo&id=${item.glo_equipment_id}`,
      category: item.glo_category || item.category || ''
    };
  }
  if (item.datahub_equipment_id) {
    const { Icon, color } = EQUIPMENT_ICONS.datahub;
    return {
      name: item.datahub_equipment_name || item.equipment_name || `Datahub #${item.datahub_equipment_id}`,
      type: 'datahub',
      icon: <Icon size={16} className={color} />,
      link: `/app/datahub?item=${item.datahub_equipment_id}`,
      mapLink: `/app/switchboard-controls/map?type=datahub&id=${item.datahub_equipment_id}`,
      category: item.datahub_category_name || ''
    };
  }
  if (item.device_id) {
    const { Icon, color } = EQUIPMENT_ICONS.device;
    const switchboardId = item.device_switchboard_id || item.switchboard_id;
    const switchboardCode = item.device_switchboard_code || '';
    const displayName = switchboardCode
      ? `${switchboardCode} - Disj. ${item.device_position || item.device_id}`
      : `Disj. ${item.device_position || item.device_id}`;
    return {
      name: displayName,
      type: 'device',
      icon: <Icon size={16} className={color} />,
      link: switchboardId ? `/app/switchboards?board=${switchboardId}` : null,
      mapLink: switchboardId ? `/app/switchboard-controls/map?type=switchboard&id=${switchboardId}` : null,
      category: ''
    };
  }
  if (item.switchboard_id) {
    const { Icon, color } = EQUIPMENT_ICONS.switchboard;
    return {
      name: item.switchboard_code || item.switchboard_name || `Tableau #${item.switchboard_id}`,
      type: 'switchboard',
      icon: <Icon size={16} className={color} />,
      link: `/app/switchboards?board=${item.switchboard_id}`,
      mapLink: `/app/switchboard-controls/map?type=switchboard&id=${item.switchboard_id}`,
      category: ''
    };
  }
  const { Icon, color } = EQUIPMENT_ICONS.unknown;
  return {
    name: item.equipment_name || 'Équipement inconnu',
    type: 'unknown',
    icon: <Icon size={16} className={color} />,
    link: null,
    mapLink: null,
    category: ''
  };
};

// ============================================================
// HELPER: Format frequency display
// ============================================================
const formatFrequency = (months) => {
  const m = Number(months) || 12;
  if (m === 1) return "Mensuel";
  if (m === 3) return "Trimestriel";
  if (m === 6) return "Semestriel";
  if (m === 12) return "Annuel";
  if (m >= 12 && m % 12 === 0) return `Tous les ${m / 12} ans`;
  return `Tous les ${m} mois`;
};

// ============================================================
// ANIMATED CARD COMPONENT
// ============================================================
const AnimatedCard = ({ children, delay = 0, className = '' }) => (
  <div
    className={`animate-slideUp ${className}`}
    style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
  >
    {children}
  </div>
);

// ============================================================
// STAT CARD WITH ANIMATION
// ============================================================
const StatCard = ({ icon, label, value, color, delay, onClick }) => (
  <AnimatedCard delay={delay}>
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-all duration-300 cursor-pointer group ${onClick ? 'hover:scale-[1.02]' : ''}`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-xl ${color} group-hover:scale-110 transition-transform`}>
          <span className="text-xl sm:text-2xl">{icon}</span>
        </div>
        <div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{value}</p>
          <p className="text-xs sm:text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  </AnimatedCard>
);

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function SwitchboardControls() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "dashboard");

  // User info from localStorage
  const [userInfo] = useState(() => {
    try {
      const ehUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
      return {
        email: ehUser.email || localStorage.getItem('user.email') || localStorage.getItem('email') || '',
        name: ehUser.name || localStorage.getItem('user.name') || localStorage.getItem('name') || ''
      };
    } catch {
      return { email: '', name: '' };
    }
  });
  const site = localStorage.getItem('site') || 'default';

  // Data states
  const [dashboard, setDashboard] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [records, setRecords] = useState([]);
  const [switchboards, setSwitchboards] = useState([]);
  const [datahubCategories, setDatahubCategories] = useState([]); // Categories with assign_to_controls=true
  const [mecaCategories, setMecaCategories] = useState([]); // Meca categories with assign_to_controls=true

  // Loading states
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showControlModal, setShowControlModal] = useState(false);
  const [showPdfExportModal, setShowPdfExportModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // Pre-selected board for schedule modal (from URL param newBoard)
  const [preSelectedBoardId, setPreSelectedBoardId] = useState(null);

  // Advanced filters state
  const [filters, setFilters] = useState({
    search: '',
    switchboardIds: [],
    templateIds: [],
    buildings: [],
    status: 'all', // all, overdue, upcoming, conform, non_conform
    dateFrom: '',
    dateTo: '',
    performers: [],
    // Equipment-specific filters from URL params
    equipmentType: null, // 'switchboard', 'vsd', 'meca', 'mobile_equipment', 'hv', 'glo'
    equipmentId: null    // The specific equipment ID to filter by
  });
  const [showFilters, setShowFilters] = useState(false);

  // Load data
  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.switchboardControls.dashboard();
      setDashboard(res);
    } catch (e) {
      console.error("Dashboard error:", e);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listTemplates();
      setTemplates(res.templates || []);
    } catch (e) {
      console.error("Templates error:", e);
    }
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listSchedules();
      setSchedules(res.schedules || []);
    } catch (e) {
      console.error("Schedules error:", e);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const res = await api.switchboardControls.listRecords({ limit: 100 });
      setRecords(res.records || []);
    } catch (e) {
      console.error("Records error:", e);
    }
  }, []);

  const loadSwitchboards = useCallback(async () => {
    try {
      const res = await api.switchboard.listBoards({ pageSize: 500 });
      setSwitchboards(res.data || []);
    } catch (e) {
      console.error("Switchboards error:", e);
    }
  }, []);

  const loadDatahubCategories = useCallback(async () => {
    try {
      const res = await api.datahub.listCategories();
      // Filter only categories with assign_to_controls = true
      const assignedCategories = (res.categories || []).filter(c => c.assign_to_controls);
      setDatahubCategories(assignedCategories);
    } catch (e) {
      console.error("Datahub categories error:", e);
    }
  }, []);

  const loadMecaCategories = useCallback(async () => {
    try {
      const res = await api.meca.listCategories();
      // Filter only categories with assign_to_controls = true
      const assignedCategories = (res.categories || []).filter(c => c.assign_to_controls);
      setMecaCategories(assignedCategories);
    } catch (e) {
      console.error("Meca categories error:", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadDashboard(),
      loadTemplates(),
      loadSchedules(),
      loadRecords(),
      loadSwitchboards(),
      loadDatahubCategories(),
      loadMecaCategories(),
    ]).finally(() => setLoading(false));
  }, [loadDashboard, loadTemplates, loadSchedules, loadRecords, loadSwitchboards, loadDatahubCategories, loadMecaCategories]);

  // Update URL when tab changes
  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  // Handle newBoard URL param - auto-open schedule modal
  useEffect(() => {
    const newBoardId = searchParams.get('newBoard');
    if (newBoardId && switchboards.length > 0) {
      setPreSelectedBoardId(Number(newBoardId));
      setShowScheduleModal(true);
      // Clear the URL param
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('newBoard');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, switchboards, setSearchParams]);

  // Handle schedule_id URL param - auto-open control modal for specific schedule
  useEffect(() => {
    const scheduleId = searchParams.get('schedule_id');
    if (scheduleId && schedules.length > 0 && !loading) {
      const found = schedules.find(s => s.id === Number(scheduleId));
      if (found) {
        setSelectedSchedule(found);
        setShowControlModal(true);
        // Clear the URL param
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('schedule_id');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, schedules, loading, setSearchParams]);

  // Handle equipment-specific URL params (from equipment pages "Gérer" button)
  // e.g., ?tab=schedules&equipment_type=vsd&vsd_equipment_id=123
  useEffect(() => {
    const equipmentType = searchParams.get('equipment_type');
    const switchboardId = searchParams.get('switchboard');

    // Check for specific equipment IDs
    const vsdId = searchParams.get('vsd_equipment_id');
    const mecaId = searchParams.get('meca_equipment_id');
    const mobileId = searchParams.get('mobile_equipment_id');
    const hvId = searchParams.get('hv_equipment_id');
    const gloId = searchParams.get('glo_equipment_id');

    let eqType = equipmentType;
    let eqId = null;

    if (switchboardId) {
      eqType = 'switchboard';
      eqId = switchboardId;
    } else if (vsdId) {
      eqType = 'vsd';
      eqId = vsdId;
    } else if (mecaId) {
      eqType = 'meca';
      eqId = mecaId;
    } else if (mobileId) {
      eqType = 'mobile_equipment';
      eqId = mobileId;
    } else if (hvId) {
      eqType = 'hv';
      eqId = hvId;
    } else if (gloId) {
      eqType = 'glo';
      eqId = gloId;
    }

    if (eqType || eqId) {
      setFilters(prev => ({
        ...prev,
        equipmentType: eqType || null,
        equipmentId: eqId || null
      }));
    }
  }, [searchParams]);

  // Stats from dashboard API - structure: { stats: { pending, overdue, completed_30d, templates }, upcoming, overdue_list }
  const overdueCount = dashboard?.stats?.overdue || 0;
  const pendingCount = dashboard?.stats?.pending || 0;
  const completedCount = dashboard?.stats?.completed_30d || 0;

  // Extract unique values for filter options
  const filterOptions = useMemo(() => {
    const buildings = new Set();
    const performers = new Set();

    switchboards.forEach(sb => {
      if (sb.meta?.building_code) buildings.add(sb.meta.building_code);
    });
    records.forEach(r => {
      if (r.performed_by) performers.add(r.performed_by);
    });

    return {
      buildings: Array.from(buildings).sort(),
      performers: Array.from(performers).sort(),
      templates: templates.map(t => ({ id: t.id, name: t.name })),
      switchboards: switchboards.map(sb => ({
        id: sb.id,
        code: sb.code,
        name: sb.name,
        building: sb.meta?.building_code
      }))
    };
  }, [switchboards, records, templates]);

  // Filter schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      // Use date-only comparison to fix "today" items being marked as overdue
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const dueDate = s.next_due_date ? new Date(s.next_due_date) : null;
      if (dueDate) dueDate.setHours(0, 0, 0, 0);

      // Search filter
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchSearch = (
          s.template_name?.toLowerCase().includes(q) ||
          s.switchboard_code?.toLowerCase().includes(q) ||
          s.switchboard_name?.toLowerCase().includes(q) ||
          s.device_switchboard_code?.toLowerCase().includes(q)
        );
        if (!matchSearch) return false;
      }

      // Switchboard filter - also includes device controls for those switchboards
      if (filters.switchboardIds.length > 0) {
        const matchesSwitchboard = filters.switchboardIds.includes(s.switchboard_id);
        const matchesDeviceSwitchboard = filters.switchboardIds.includes(s.device_switchboard_id);
        if (!matchesSwitchboard && !matchesDeviceSwitchboard) return false;
      }

      // Template filter
      if (filters.templateIds.length > 0 && !filters.templateIds.includes(s.template_id)) {
        return false;
      }

      // Equipment-specific filter (from URL params)
      if (filters.equipmentType && filters.equipmentId) {
        const eqType = filters.equipmentType;
        const eqId = filters.equipmentId;

        // Match based on equipment type
        // For switchboard filter: include both switchboard-level controls AND device controls for that switchboard
        if (eqType === 'switchboard') {
          const matchesSwitchboard = String(s.switchboard_id) === String(eqId);
          const matchesDeviceSwitchboard = String(s.device_switchboard_id) === String(eqId);
          if (!matchesSwitchboard && !matchesDeviceSwitchboard) return false;
        }
        if (eqType === 'vsd' && String(s.vsd_equipment_id) !== String(eqId)) return false;
        if (eqType === 'meca' && String(s.meca_equipment_id) !== String(eqId)) return false;
        if (eqType === 'mobile_equipment' && String(s.mobile_equipment_id) !== String(eqId)) return false;
        if (eqType === 'hv' && String(s.hv_equipment_id) !== String(eqId)) return false;
        if (eqType === 'glo' && String(s.glo_equipment_id) !== String(eqId)) return false;
      }

      // Status filter
      if (filters.status === 'overdue' && (!dueDate || dueDate >= now)) return false;
      if (filters.status === 'upcoming' && (!dueDate || dueDate < now)) return false;

      // Date range
      if (filters.dateFrom && dueDate && dueDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && dueDate && dueDate > new Date(filters.dateTo)) return false;

      return true;
    });
  }, [schedules, filters]);

  // Filter records (history)
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const performedDate = r.performed_at ? new Date(r.performed_at) : null;

      // Search filter
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchSearch = (
          r.template_name?.toLowerCase().includes(q) ||
          r.switchboard_code?.toLowerCase().includes(q) ||
          r.switchboard_name?.toLowerCase().includes(q) ||
          r.device_switchboard_code?.toLowerCase().includes(q) ||
          r.performed_by?.toLowerCase().includes(q)
        );
        if (!matchSearch) return false;
      }

      // Switchboard filter - also includes device records for those switchboards
      if (filters.switchboardIds.length > 0) {
        const matchesSwitchboard = filters.switchboardIds.includes(r.switchboard_id);
        const matchesDeviceSwitchboard = filters.switchboardIds.includes(r.device_switchboard_id);
        if (!matchesSwitchboard && !matchesDeviceSwitchboard) return false;
      }

      // Template filter
      if (filters.templateIds.length > 0 && !filters.templateIds.includes(r.template_id)) {
        return false;
      }

      // Equipment-specific filter (from URL params)
      if (filters.equipmentType && filters.equipmentId) {
        const eqType = filters.equipmentType;
        const eqId = filters.equipmentId;

        // Match based on equipment type
        // For switchboard filter: include both switchboard-level records AND device records for that switchboard
        if (eqType === 'switchboard') {
          const matchesSwitchboard = String(r.switchboard_id) === String(eqId);
          const matchesDeviceSwitchboard = String(r.device_switchboard_id) === String(eqId);
          if (!matchesSwitchboard && !matchesDeviceSwitchboard) return false;
        }
        if (eqType === 'vsd' && String(r.vsd_equipment_id) !== String(eqId)) return false;
        if (eqType === 'meca' && String(r.meca_equipment_id) !== String(eqId)) return false;
        if (eqType === 'mobile_equipment' && String(r.mobile_equipment_id) !== String(eqId)) return false;
        if (eqType === 'hv' && String(r.hv_equipment_id) !== String(eqId)) return false;
        if (eqType === 'glo' && String(r.glo_equipment_id) !== String(eqId)) return false;
      }

      // Status filter (conform/non_conform)
      if (filters.status === 'conform' && r.status !== 'conform') return false;
      if (filters.status === 'non_conform' && r.status !== 'non_conform') return false;

      // Performer filter
      if (filters.performers.length > 0 && !filters.performers.includes(r.performed_by)) {
        return false;
      }

      // Date range
      if (filters.dateFrom && performedDate && performedDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && performedDate && performedDate > new Date(filters.dateTo)) return false;

      return true;
    });
  }, [records, filters]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.switchboardIds.length > 0) count++;
    if (filters.templateIds.length > 0) count++;
    if (filters.buildings.length > 0) count++;
    if (filters.status !== 'all') count++;
    if (filters.dateFrom || filters.dateTo) count++;
    if (filters.performers.length > 0) count++;
    if (filters.equipmentType || filters.equipmentId) count++;
    return count;
  }, [filters]);

  // Get equipment filter label for display
  const getEquipmentFilterLabel = () => {
    if (!filters.equipmentType && !filters.equipmentId) return null;
    const typeLabels = {
      switchboard: 'Tableau',
      vsd: 'Variateur',
      meca: 'Équip. méca',
      mobile_equipment: 'Équip. mobile',
      hv: 'Haute tension',
      glo: 'GLO'
    };
    return `${typeLabels[filters.equipmentType] || filters.equipmentType} #${filters.equipmentId}`;
  };

  // Reset filters (clears URL equipment filters too)
  const resetFilters = () => {
    setFilters({
      search: '',
      switchboardIds: [],
      templateIds: [],
      buildings: [],
      status: 'all',
      dateFrom: '',
      dateTo: '',
      performers: [],
      equipmentType: null,
      equipmentId: null
    });
    // Clear equipment-specific URL params
    const newParams = new URLSearchParams(searchParams);
    ['equipment_type', 'switchboard', 'vsd_equipment_id', 'meca_equipment_id',
     'mobile_equipment_id', 'hv_equipment_id', 'glo_equipment_id'].forEach(p => newParams.delete(p));
    setSearchParams(newParams, { replace: true });
  };

  // Loading state (after all hooks)
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin border-t-blue-600" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl">⚡</span>
          </div>
        </div>
        <p className="text-gray-500 animate-pulse">Chargement des contrôles...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      {/* Header - Responsive */}
      <AnimatedCard>
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-4 sm:p-6 text-white shadow-lg gradient-animate">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-white/20 rounded-xl sm:rounded-2xl backdrop-blur-sm">
                <span className="text-3xl sm:text-4xl">📋</span>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">Contrôles Électriques</h1>
                <p className="text-white/80 text-sm sm:text-base">Suivi et planification des contrôles</p>
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={() => navigate('/app/switchboard-controls/map')}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium backdrop-blur-sm transition-all text-sm sm:text-base flex items-center justify-center gap-2"
              >
                <span>🗺️</span>
                <span className="hidden sm:inline">Voir le plan</span>
                <span className="sm:hidden">Plan</span>
              </button>
              <button
                onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-medium backdrop-blur-sm transition-all text-sm sm:text-base flex items-center justify-center gap-2"
              >
                <span>📝</span>
                <span className="hidden sm:inline">Nouveau modèle</span>
                <span className="sm:hidden">Modèle</span>
              </button>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex-1 sm:flex-none px-3 sm:px-4 py-2 sm:py-2.5 bg-white text-orange-600 hover:bg-orange-50 rounded-xl font-medium transition-all text-sm sm:text-base flex items-center justify-center gap-2 animate-pulse-slow"
              >
                <span>➕</span>
                <span className="hidden sm:inline">Planifier contrôle</span>
                <span className="sm:hidden">Planifier</span>
              </button>
            </div>
          </div>
        </div>
      </AnimatedCard>

      {/* Stats Cards - Responsive Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon="⚠️"
          label="En retard"
          value={overdueCount}
          color={overdueCount > 0 ? "bg-red-100" : "bg-gray-100"}
          delay={100}
          onClick={() => setActiveTab("overdue")}
        />
        <StatCard
          icon="📅"
          label="Planifiés"
          value={pendingCount}
          color="bg-blue-100"
          delay={150}
          onClick={() => setActiveTab("schedules")}
        />
        <StatCard
          icon="✅"
          label="Effectués"
          value={completedCount}
          color="bg-green-100"
          delay={200}
          onClick={() => setActiveTab("history")}
        />
        <StatCard
          icon="📋"
          label="Modèles"
          value={templates.length}
          color="bg-purple-100"
          delay={250}
          onClick={() => setActiveTab("templates")}
        />
      </div>

      {/* Alert Banner for Overdue */}
      {overdueCount > 0 && (
        <AnimatedCard delay={300}>
          <div
            onClick={() => setActiveTab("overdue")}
            className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl animate-bounce-slow">🚨</span>
              <div>
                <p className="font-bold text-red-800">Attention ! {overdueCount} contrôle(s) en retard</p>
                <p className="text-red-600 text-sm">Cliquez pour voir les détails</p>
              </div>
            </div>
            <span className="text-2xl">→</span>
          </div>
        </AnimatedCard>
      )}

      {/* Tabs - Responsive scrollable */}
      <AnimatedCard delay={350}>
        <div className="flex gap-1 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { id: "dashboard", label: "Tableau de bord", shortLabel: "TB" },
            { id: "schedules", label: `Planifies (${filteredSchedules.length})`, shortLabel: `P ${filteredSchedules.length}` },
            { id: "overdue", label: `En retard (${overdueCount})`, shortLabel: `R ${overdueCount}`, alert: overdueCount > 0 },
            { id: "history", label: `Historique (${filteredRecords.length})`, shortLabel: `H ${filteredRecords.length}` },
            { id: "templates", label: "Modeles", shortLabel: "M" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-medium transition-all whitespace-nowrap text-sm sm:text-base ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md"
                  : tab.alert
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </button>
          ))}
        </div>
      </AnimatedCard>

      {/* Advanced Filter Bar */}
      {(activeTab === "schedules" || activeTab === "history") && (
        <AnimatedCard delay={375}>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-4">
            {/* Search + Filter Toggle */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                <input
                  type="text"
                  placeholder="Rechercher tableau, modele, controleur..."
                  value={filters.search}
                  onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 bg-white text-gray-900"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors ${
                  showFilters || activeFilterCount > 0
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span>🎛️</span>
                Filtres
                {activeFilterCount > 0 && (
                  <span className="px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">{activeFilterCount}</span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="px-4 py-2.5 bg-red-100 text-red-700 rounded-xl font-medium hover:bg-red-200 flex items-center gap-2"
                >
                  ✕ Reset
                </button>
              )}
              {activeTab === "history" && (
                <button
                  onClick={() => setShowPdfExportModal(true)}
                  className="px-4 py-2.5 bg-emerald-100 text-emerald-700 rounded-xl font-medium hover:bg-emerald-200 flex items-center gap-2 ml-auto"
                >
                  <span>📄</span>
                  Exporter PDF
                </button>
              )}
            </div>

            {/* Expanded Filters */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Switchboard Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Tableaux</label>
                    <select
                      multiple
                      value={filters.switchboardIds.map(String)}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, o => Number(o.value));
                        setFilters(f => ({ ...f, switchboardIds: selected }));
                      }}
                      className="w-full border border-gray-200 rounded-lg p-2 text-sm bg-white text-gray-900 h-24"
                    >
                      {filterOptions.switchboards.map(sb => (
                        <option key={sb.id} value={sb.id}>{sb.code} - {sb.name}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">Ctrl+clic pour multi-selection</p>
                  </div>

                  {/* Template Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Modeles</label>
                    <select
                      multiple
                      value={filters.templateIds.map(String)}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, o => Number(o.value));
                        setFilters(f => ({ ...f, templateIds: selected }));
                      }}
                      className="w-full border border-gray-200 rounded-lg p-2 text-sm bg-white text-gray-900 h-24"
                    >
                      {filterOptions.templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Status Filter */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
                    <select
                      value={filters.status}
                      onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg p-2.5 text-sm bg-white text-gray-900"
                    >
                      <option value="all">Tous</option>
                      {activeTab === "schedules" && (
                        <>
                          <option value="overdue">En retard</option>
                          <option value="upcoming">A venir</option>
                        </>
                      )}
                      {activeTab === "history" && (
                        <>
                          <option value="conform">Conforme</option>
                          <option value="non_conform">Non conforme</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Date Range */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Periode</label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                        className="flex-1 border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-900"
                      />
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                        className="flex-1 border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                {/* History-specific: Performer filter */}
                {activeTab === "history" && filterOptions.performers.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Controleur</label>
                    <div className="flex flex-wrap gap-2">
                      {filterOptions.performers.map(p => (
                        <button
                          key={p}
                          onClick={() => {
                            setFilters(f => ({
                              ...f,
                              performers: f.performers.includes(p)
                                ? f.performers.filter(x => x !== p)
                                : [...f.performers, p]
                            }));
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                            filters.performers.includes(p)
                              ? 'bg-amber-500 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Filters */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400 self-center">Filtres rapides:</span>
                  <button
                    onClick={() => setFilters(f => ({ ...f, status: 'overdue' }))}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium hover:bg-red-200"
                  >
                    En retard
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
                      setFilters(f => ({
                        ...f,
                        dateFrom: today.toISOString().split('T')[0],
                        dateTo: nextWeek.toISOString().split('T')[0]
                      }));
                    }}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium hover:bg-blue-200"
                  >
                    7 prochains jours
                  </button>
                  <button
                    onClick={() => {
                      const today = new Date();
                      const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
                      setFilters(f => ({
                        ...f,
                        dateFrom: today.toISOString().split('T')[0],
                        dateTo: nextMonth.toISOString().split('T')[0]
                      }));
                    }}
                    className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium hover:bg-green-200"
                  >
                    30 prochains jours
                  </button>
                  {activeTab === "history" && (
                    <button
                      onClick={() => setFilters(f => ({ ...f, status: 'non_conform' }))}
                      className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium hover:bg-orange-200"
                    >
                      Non conformes
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Active Filters Summary */}
            {activeFilterCount > 0 && !showFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                {filters.switchboardIds.length > 0 && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center gap-1">
                    {filters.switchboardIds.length} tableau(x)
                    <button onClick={() => setFilters(f => ({ ...f, switchboardIds: [] }))} className="hover:text-blue-900">✕</button>
                  </span>
                )}
                {filters.templateIds.length > 0 && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs flex items-center gap-1">
                    {filters.templateIds.length} modele(s)
                    <button onClick={() => setFilters(f => ({ ...f, templateIds: [] }))} className="hover:text-purple-900">✕</button>
                  </span>
                )}
                {filters.status !== 'all' && (
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs flex items-center gap-1">
                    {filters.status}
                    <button onClick={() => setFilters(f => ({ ...f, status: 'all' }))} className="hover:text-amber-900">✕</button>
                  </span>
                )}
                {(filters.dateFrom || filters.dateTo) && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs flex items-center gap-1">
                    {filters.dateFrom || '...'} - {filters.dateTo || '...'}
                    <button onClick={() => setFilters(f => ({ ...f, dateFrom: '', dateTo: '' }))} className="hover:text-green-900">✕</button>
                  </span>
                )}
                {filters.performers.length > 0 && (
                  <span className="px-2 py-1 bg-teal-100 text-teal-700 rounded-full text-xs flex items-center gap-1">
                    {filters.performers.length} controleur(s)
                    <button onClick={() => setFilters(f => ({ ...f, performers: [] }))} className="hover:text-teal-900">✕</button>
                  </span>
                )}
                {(filters.equipmentType || filters.equipmentId) && (
                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs flex items-center gap-1">
                    📍 {getEquipmentFilterLabel()}
                    <button onClick={resetFilters} className="hover:text-orange-900">✕</button>
                  </span>
                )}
              </div>
            )}
          </div>
        </AnimatedCard>
      )}

      {/* Tab Content */}
      <AnimatedCard delay={400}>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {activeTab === "dashboard" && (
            <DashboardTab
              dashboard={dashboard}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
            />
          )}
          {activeTab === "schedules" && (
            <SchedulesTab
              schedules={filteredSchedules}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
              onDelete={async (id) => {
                if (confirm("Supprimer cette planification ?")) {
                  await api.switchboardControls.deleteSchedule(id);
                  loadSchedules();
                  loadDashboard();
                }
              }}
            />
          )}
          {activeTab === "overdue" && (
            <OverdueTab
              overdueList={dashboard?.overdue_list || []}
              navigate={navigate}
              onStartControl={(s) => { setSelectedSchedule(s); setShowControlModal(true); }}
            />
          )}
          {activeTab === "history" && (
            <HistoryTab records={filteredRecords} navigate={navigate} />
          )}
          {activeTab === "templates" && (
            <TemplatesTab
              templates={templates}
              onEdit={(t) => { setEditingTemplate(t); setShowTemplateModal(true); }}
              onDelete={async (id) => {
                if (confirm("Supprimer ce modèle ?")) {
                  await api.switchboardControls.deleteTemplate(id);
                  loadTemplates();
                }
              }}
            />
          )}
        </div>
      </AnimatedCard>

      {/* Modals */}
      {showTemplateModal && (
        <TemplateModal
          template={editingTemplate}
          datahubCategories={datahubCategories}
          mecaCategories={mecaCategories}
          onClose={() => { setShowTemplateModal(false); setEditingTemplate(null); }}
          onSave={async (data) => {
            if (editingTemplate) {
              await api.switchboardControls.updateTemplate(editingTemplate.id, data);
            } else {
              await api.switchboardControls.createTemplate(data);
            }
            loadTemplates();
            setShowTemplateModal(false);
            setEditingTemplate(null);
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleModal
          templates={templates}
          switchboards={switchboards}
          datahubCategories={datahubCategories}
          mecaCategories={mecaCategories}
          preSelectedBoardId={preSelectedBoardId}
          onClose={() => { setShowScheduleModal(false); setPreSelectedBoardId(null); }}
          onSave={async (data, shouldReload = true) => {
            await api.switchboardControls.createSchedule(data);
            // Only reload on last item to avoid too many requests
            if (shouldReload) {
              loadSchedules();
              loadDashboard();
              setShowScheduleModal(false);
              setPreSelectedBoardId(null);
            }
          }}
        />
      )}

      {showControlModal && selectedSchedule && (
        <ControlModal
          schedule={selectedSchedule}
          onClose={() => { setShowControlModal(false); setSelectedSchedule(null); }}
          onComplete={async () => {
            loadSchedules();
            loadRecords();
            loadDashboard();
            setShowControlModal(false);
            setSelectedSchedule(null);
          }}
          site={site}
          userEmail={userInfo.email}
          userName={userInfo.name}
        />
      )}

      {showPdfExportModal && (
        <PdfExportModal
          filters={filters}
          filterOptions={filterOptions}
          records={filteredRecords}
          onClose={() => setShowPdfExportModal(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// DASHBOARD TAB - Enhanced
// ============================================================
function DashboardTab({ dashboard, navigate, onStartControl }) {
  const overdue_list = dashboard?.overdue_list || [];
  const upcoming = dashboard?.upcoming || [];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Welcome Message */}
      <div className="text-center py-4 sm:py-6">
        <span className="text-4xl sm:text-5xl mb-4 block">👋</span>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Bienvenue dans vos contrôles</h2>
        <p className="text-gray-500 mt-2 text-sm sm:text-base">Gardez vos installations électriques sous contrôle</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: "⚡", label: "Tableaux", onClick: () => navigate("/app/switchboards"), color: "from-blue-400 to-blue-600" },
          { icon: "🗺️", label: "Plans", onClick: () => navigate("/app/switchboard-map"), color: "from-emerald-400 to-emerald-600" },
          { icon: "📊", label: "Schémas", onClick: () => navigate("/app/switchboards"), color: "from-violet-400 to-violet-600" },
          { icon: "📋", label: "Contrôles", onClick: () => {}, color: "from-amber-400 to-orange-500", active: true },
        ].map((action, idx) => (
          <button
            key={idx}
            onClick={action.onClick}
            className={`p-3 sm:p-4 rounded-xl text-white font-medium transition-all hover:scale-105 bg-gradient-to-br ${action.color} ${action.active ? 'ring-2 ring-offset-2 ring-orange-400' : ''}`}
          >
            <span className="text-2xl sm:text-3xl block mb-1">{action.icon}</span>
            <span className="text-xs sm:text-sm">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Overdue Section */}
      {overdue_list.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4">
          <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
            <span className="animate-bounce-slow">🚨</span> Contrôles en retard
          </h3>
          <div className="space-y-2">
            {overdue_list.slice(0, 3).map((s) => {
              const equipDisplay = getEquipmentDisplay(s);
              return (
                <div key={s.id} className="bg-white rounded-lg p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl flex-shrink-0">⚠️</span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{s.template_name}</p>
                      <p className="text-sm text-gray-500 truncate flex items-center gap-1">
                        <span>{equipDisplay.icon}</span>
                        {equipDisplay.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {equipDisplay.mapLink && (
                      <button
                        onClick={() => navigate(equipDisplay.mapLink)}
                        className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                        title="Voir sur le plan"
                      >
                        🗺️
                      </button>
                    )}
                    <button
                      onClick={() => onStartControl(s)}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                    >
                      Faire
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming Section */}
      {upcoming.length > 0 && (
        <div className="bg-blue-50 rounded-xl p-4">
          <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
            <span>📅</span> Prochains contrôles
          </h3>
          <div className="space-y-2">
            {upcoming.slice(0, 3).map((s) => {
              const equipDisplay = getEquipmentDisplay(s);
              return (
                <div key={s.id} className="bg-white rounded-lg p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl flex-shrink-0">📋</span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{s.template_name}</p>
                      <p className="text-sm text-gray-500 truncate flex items-center gap-1">
                        <span>{equipDisplay.icon}</span>
                        {equipDisplay.name} • {new Date(s.next_due_date).toLocaleDateString("fr-FR")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {equipDisplay.mapLink && (
                      <button
                        onClick={() => navigate(equipDisplay.mapLink)}
                        className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                        title="Voir sur le plan"
                      >
                        🗺️
                      </button>
                    )}
                    <button
                      onClick={() => onStartControl(s)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Faire
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {overdue_list.length === 0 && upcoming.length === 0 && (
        <div className="text-center py-8 sm:py-12">
          <span className="text-5xl sm:text-6xl block mb-4">🎉</span>
          <h3 className="text-lg sm:text-xl font-bold text-gray-800">Tout est sous contrôle !</h3>
          <p className="text-gray-500 mt-2">Aucun contrôle en attente. Planifiez vos prochains contrôles.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SCHEDULES TAB - Responsive
// ============================================================
function SchedulesTab({ schedules, onStartControl, onDelete, navigate }) {
  if (schedules.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📅</span>
        <p className="text-gray-500">Aucun contrôle planifié</p>
        <p className="text-sm text-gray-400 mt-2">Créez un nouveau contrôle pour commencer</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {schedules.map((s, idx) => {
        const isOverdue = isDateOverdue(s.next_due_date);
        const equipDisplay = getEquipmentDisplay(s);
        return (
          <div
            key={s.id}
            className={`p-4 hover:bg-gray-50 transition-colors animate-slideUp ${isOverdue ? 'bg-red-50' : ''}`}
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg">{isOverdue ? '⚠️' : '📋'}</span>
                  <span className="font-medium text-gray-900">{s.template_name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {isOverdue ? 'En retard' : 'À jour'}
                  </span>
                </div>
                <button
                  onClick={() => equipDisplay.link && navigate(equipDisplay.link)}
                  className="text-sm text-blue-600 hover:underline mt-1 flex items-center gap-1"
                >
                  <span>{equipDisplay.icon}</span>
                  {equipDisplay.name}
                </button>
                <p className="text-xs text-gray-500 mt-1">
                  Prochain: {s.next_due_date ? new Date(s.next_due_date).toLocaleDateString("fr-FR") : "-"}
                </p>
              </div>

              {/* Navigation Links - All equipment types */}
              {equipDisplay.link && (
                <div className="flex gap-1">
                  <button
                    onClick={() => navigate(equipDisplay.link)}
                    className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    title="Voir l'équipement"
                  >
                    {equipDisplay.icon}
                  </button>
                  {equipDisplay.mapLink && (
                    <button
                      onClick={() => navigate(equipDisplay.mapLink)}
                      className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                      title="Voir sur le plan"
                    >
                      🗺️
                    </button>
                  )}
                  {s.switchboard_id && (
                    <button
                      onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)}
                      className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200"
                      title="Voir le schéma"
                    >
                      📊
                    </button>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => onStartControl(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isOverdue
                      ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse-slow'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isOverdue ? '⚡ Faire maintenant' : 'Contrôler'}
                </button>
                <button
                  onClick={() => onDelete(s.id)}
                  className="p-2 text-red-500 hover:bg-red-100 rounded-lg"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// OVERDUE TAB - Enhanced
// ============================================================
function OverdueTab({ overdueList, onStartControl, navigate }) {
  if (overdueList.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-6xl block mb-4">✅</span>
        <h3 className="text-xl font-bold text-green-600">Félicitations !</h3>
        <p className="text-gray-500 mt-2">Aucun contrôle en retard</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="bg-red-100 rounded-xl p-4 text-center mb-4">
        <span className="text-4xl animate-bounce-slow inline-block">🚨</span>
        <p className="font-bold text-red-800 mt-2">{overdueList.length} contrôle(s) nécessite(nt) votre attention</p>
      </div>

      {overdueList.map((s, idx) => {
        const equipDisplay = getEquipmentDisplay(s);
        return (
          <div
            key={s.id}
            className="bg-white border-2 border-red-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all animate-slideUp"
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-3xl animate-bounce-slow">⚠️</span>
                <div className="min-w-0">
                  <p className="font-bold text-red-800">{s.template_name}</p>
                  <button
                    onClick={() => equipDisplay.link && navigate(equipDisplay.link)}
                    className="text-sm text-gray-600 hover:text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <span>{equipDisplay.icon}</span>
                    {equipDisplay.name}
                  </button>
                  <p className="text-xs text-red-600 mt-1">
                    En retard de {Math.ceil((new Date() - new Date(s.next_due_date)) / (1000 * 60 * 60 * 24))} jours
                  </p>
                </div>
              </div>

              {/* Navigation - All equipment types */}
              {equipDisplay.link && (
                <div className="flex gap-1">
                  <button onClick={() => navigate(equipDisplay.link)} className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" title="Voir l'équipement">{equipDisplay.icon}</button>
                  {equipDisplay.mapLink && (
                    <button onClick={() => navigate(equipDisplay.mapLink)} className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200" title="Voir sur le plan">🗺️</button>
                  )}
                  {s.switchboard_id && (
                    <button onClick={() => navigate(`/app/switchboards/${s.switchboard_id}/diagram`)} className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200" title="Schéma">📊</button>
                  )}
                </div>
              )}

              <button
                onClick={() => onStartControl(s)}
                className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 animate-pulse-slow whitespace-nowrap"
              >
                ⚡ Faire maintenant
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// HISTORY TAB - Responsive with improved PDF download
// ============================================================
function HistoryTab({ records, navigate }) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const statusConfig = {
    conform: { bg: "bg-green-100", text: "text-green-800", icon: "✅", label: "Conforme" },
    non_conform: { bg: "bg-red-100", text: "text-red-800", icon: "❌", label: "Non conforme" },
    partial: { bg: "bg-yellow-100", text: "text-yellow-800", icon: "⚠️", label: "Partiel" },
  };

  // Download PDF with proper error handling
  const handleDownloadPdf = async (record) => {
    setDownloadingId(record.id);
    setDownloadError(null);
    try {
      const url = api.switchboardControls.recordPdfUrl(record.id);
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur inconnue' }));
        throw new Error(errorData.error || `Erreur ${response.status}`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const equipName = record.switchboard_code || record.device_position || record.id;
      a.download = `controle_${equipName}_${new Date(record.performed_at).toLocaleDateString('fr-FR').replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (e) {
      console.error('PDF download error:', e);
      setDownloadError({ id: record.id, message: e.message });
    } finally {
      setDownloadingId(null);
    }
  };

  if (records.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📜</span>
        <p className="text-gray-500">Aucun contrôle effectué</p>
        <p className="text-sm text-gray-400 mt-2">L'historique apparaîtra ici</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {records.map((r, idx) => {
        const status = statusConfig[r.status] || statusConfig.partial;
        const equipDisplay = getEquipmentDisplay(r);
        const isDownloading = downloadingId === r.id;
        const hasError = downloadError?.id === r.id;

        return (
          <div
            key={r.id}
            className="p-4 hover:bg-gray-50 transition-colors animate-slideUp"
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Status Icon */}
              <span className="text-2xl">{status.icon}</span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{r.template_name || "-"}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${status.bg} ${status.text}`}>
                    {status.label}
                  </span>
                </div>
                <button
                  onClick={() => equipDisplay.link && navigate(equipDisplay.link)}
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  <span>{equipDisplay.icon}</span>
                  {equipDisplay.name}
                </button>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                  <span>📅 {new Date(r.performed_at).toLocaleDateString("fr-FR")}</span>
                  <span>👤 {r.performed_by}</span>
                </div>
                {hasError && (
                  <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <span>❌</span> {downloadError.message}
                  </div>
                )}
              </div>

              {/* Navigation - All equipment types */}
              {equipDisplay.link && (
                <div className="flex gap-1">
                  <button onClick={() => navigate(equipDisplay.link)} className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200" title="Voir l'équipement">{equipDisplay.icon}</button>
                  {equipDisplay.mapLink && (
                    <button onClick={() => navigate(equipDisplay.mapLink)} className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200" title="Voir sur le plan">🗺️</button>
                  )}
                  {r.switchboard_id && (
                    <button onClick={() => navigate(`/app/switchboards/${r.switchboard_id}/diagram`)} className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200" title="Schéma">📊</button>
                  )}
                </div>
              )}

              {/* PDF Button - Improved with error handling */}
              <button
                onClick={() => handleDownloadPdf(r)}
                disabled={isDownloading}
                className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
                  isDownloading
                    ? 'bg-gray-200 text-gray-500 cursor-wait'
                    : hasError
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {isDownloading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Chargement...
                  </>
                ) : (
                  <>📄 PDF</>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// TEMPLATES TAB - Responsive
// ============================================================
function TemplatesTab({ templates, onEdit, onDelete }) {
  if (templates.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center">
        <span className="text-5xl block mb-4">📝</span>
        <p className="text-gray-500">Aucun modèle de contrôle</p>
        <p className="text-sm text-gray-400 mt-2">Créez un modèle pour commencer</p>
      </div>
    );
  }

  return (
    <div className="p-4 grid gap-4 sm:grid-cols-2">
      {templates.map((t, idx) => (
        <div
          key={t.id}
          className="border rounded-xl p-4 hover:shadow-md transition-all animate-slideUp"
          style={{ animationDelay: `${idx * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-bold text-gray-900">{t.name}</h4>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  t.target_type === 'switchboard' ? 'bg-blue-100 text-blue-700' :
                  t.target_type === 'vsd' ? 'bg-slate-100 text-slate-700' :
                  t.target_type === 'meca' ? 'bg-orange-100 text-orange-700' :
                  t.target_type === 'mobile_equipment' ? 'bg-cyan-100 text-cyan-700' :
                  t.target_type === 'hv' ? 'bg-amber-100 text-amber-700' :
                  t.target_type === 'glo' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-purple-100 text-purple-700'
                }`}>
                  {t.target_type === 'switchboard' ? '⚡ Tableau' :
                   t.target_type === 'vsd' ? '⚙️ VSD' :
                   t.target_type === 'meca' ? '🔧 Mécanique' :
                   t.target_type === 'mobile_equipment' ? '🚜 Mobile' :
                   t.target_type === 'hv' ? '⚡ HT' :
                   t.target_type === 'glo' ? '🔋 GLO' :
                   '🔌 Disjoncteur'}
                </span>
                {t.element_filter === 'ddr' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                    DDR uniquement
                  </span>
                )}
                {t.element_filter === 'non_ddr' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    Non-DDR
                  </span>
                )}
              </div>
            </div>
            <span className="text-2xl">{
              t.target_type === 'switchboard' ? '⚡' :
              t.target_type === 'vsd' ? '⚙️' :
              t.target_type === 'meca' ? '🔧' :
              t.target_type === 'mobile_equipment' ? '🚜' :
              t.target_type === 'hv' ? '⚡' :
              t.target_type === 'glo' ? '🔋' :
              '🔌'
            }</span>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            📋 {(t.checklist_items || []).length} points de contrôle • 🔄 {formatFrequency(t.frequency_months)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(t)}
              className="flex-1 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium"
            >
              ✏️ Modifier
            </button>
            <button
              onClick={() => onDelete(t.id)}
              className="px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// TEMPLATE MODAL - Responsive
// ============================================================
function TemplateModal({ template, datahubCategories = [], mecaCategories = [], onClose, onSave }) {
  const [name, setName] = useState(template?.name || "");
  const [targetType, setTargetType] = useState(template?.target_type || "switchboard");
  const [elementFilter, setElementFilter] = useState(template?.element_filter || "");
  const [frequencyMonths, setFrequencyMonths] = useState(template?.frequency_months || 12);
  const [checklistItems, setChecklistItems] = useState(template?.checklist_items || []);
  const [saving, setSaving] = useState(false);

  const addItem = (type) => {
    setChecklistItems([...checklistItems, {
      id: Date.now().toString(),
      type,
      label: "",
      unit: type === "value" ? "" : undefined,
    }]);
  };

  const updateItem = (index, field, value) => {
    const updated = [...checklistItems];
    updated[index][field] = value;
    setChecklistItems(updated);
  };

  const removeItem = (index) => {
    setChecklistItems(checklistItems.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) return alert("Entrez un nom pour le modèle");
    if (checklistItems.length === 0) return alert("Ajoutez au moins un point de contrôle");

    setSaving(true);
    try {
      await onSave({
        name,
        target_type: targetType,
        element_filter: targetType === 'device' ? (elementFilter || null) : null,
        frequency_months: Number(frequencyMonths),
        checklist_items: checklistItems,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-hidden animate-slideUp">
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📝</span>
              <h2 className="text-lg sm:text-xl font-bold">{template ? "Modifier le modèle" : "Nouveau modèle"}</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh] space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Nom du modèle</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Contrôle annuel tableau principal"
            />
          </div>

          {/* Type & Frequency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type de cible</label>
              <select
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value);
                  if (e.target.value !== 'device') setElementFilter("");
                }}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              >
                <option value="switchboard">⚡ Tableau électrique</option>
                <option value="device">🔌 Disjoncteur</option>
                <option value="vsd">⚙️ Variateur (VSD)</option>
                {mecaCategories.length > 0 ? (
                  <optgroup label="🔧 Équip. Mécanique">
                    {mecaCategories.map(cat => (
                      <option key={cat.id} value={`meca_${cat.id}`}>
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option value="meca">🔧 Équip. Mécanique</option>
                )}
                <option value="mobile_equipment">🚜 Équip. Mobile</option>
                <option value="hv">⚡ Haute Tension (HT)</option>
                <option value="glo">🔋 Équip. GLO</option>
                {datahubCategories.length > 0 && (
                  <optgroup label="📦 Datahub">
                    {datahubCategories.map(cat => (
                      <option key={cat.id} value={`datahub_${cat.id}`}>
                        {cat.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Périodicité</label>
              <select
                value={frequencyMonths}
                onChange={(e) => setFrequencyMonths(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              >
                <option value={1}>Mensuel</option>
                <option value={3}>Trimestriel</option>
                <option value={6}>Semestriel</option>
                <option value={12}>Annuel</option>
                <option value={24}>Tous les 2 ans</option>
                <option value={36}>Tous les 3 ans</option>
                <option value={48}>Tous les 4 ans</option>
                <option value={60}>Tous les 5 ans</option>
                <option value={72}>Tous les 6 ans</option>
                <option value={84}>Tous les 7 ans</option>
                <option value={96}>Tous les 8 ans</option>
                <option value={108}>Tous les 9 ans</option>
                <option value={120}>Tous les 10 ans</option>
              </select>
            </div>
          </div>

          {/* Element Filter (only for device type) */}
          {targetType === 'device' && (
            <div>
              <label className="block text-sm font-medium mb-1">Filtre par type d'élément</label>
              <select
                value={elementFilter}
                onChange={(e) => setElementFilter(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              >
                <option value="">Tous les disjoncteurs</option>
                <option value="ddr">DDR uniquement (Dispositifs Différentiels)</option>
                <option value="non_ddr">Disjoncteurs non-DDR uniquement</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {elementFilter === 'ddr' && "Seuls les tableaux ayant des DDR seront proposés lors de la planification"}
                {elementFilter === 'non_ddr' && "Seuls les disjoncteurs non-différentiels seront comptabilisés"}
                {!elementFilter && "Tous les disjoncteurs du tableau seront inclus"}
              </p>
            </div>
          )}

          {/* Checklist Items */}
          <div>
            <label className="block text-sm font-medium mb-2">Points de contrôle</label>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => addItem("conform")} className="px-3 py-2 bg-green-100 text-green-700 rounded-xl text-sm hover:bg-green-200">
                + Conforme/Non conforme
              </button>
              <button onClick={() => addItem("value")} className="px-3 py-2 bg-blue-100 text-blue-700 rounded-xl text-sm hover:bg-blue-200">
                + Valeur numérique
              </button>
              <button onClick={() => addItem("text")} className="px-3 py-2 bg-purple-100 text-purple-700 rounded-xl text-sm hover:bg-purple-200">
                + Champ texte
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {checklistItems.map((item, idx) => (
                <div key={item.id} className="flex gap-2 items-center bg-gray-50 p-3 rounded-xl">
                  <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => updateItem(idx, "label", e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                    placeholder="Libellé du point de contrôle"
                  />
                  <span className={`px-2 py-1 rounded text-xs flex-shrink-0 ${
                    item.type === "conform" ? "bg-green-100 text-green-700" :
                    item.type === "value" ? "bg-blue-100 text-blue-700" :
                    "bg-purple-100 text-purple-700"
                  }`}>
                    {item.type === "conform" ? "C/NC" : item.type === "value" ? "Valeur" : "Texte"}
                  </span>
                  {item.type === "value" && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-gray-400 text-xs">en</span>
                      <input
                        type="text"
                        value={item.unit || ""}
                        onChange={(e) => updateItem(idx, "unit", e.target.value)}
                        className="w-20 border rounded-lg px-2 py-2 text-sm bg-white text-gray-900"
                        placeholder="V, A, °C..."
                      />
                    </div>
                  )}
                  <button onClick={() => removeItem(idx)} className="p-1 text-red-500 hover:bg-red-100 rounded">
                    ✕
                  </button>
                </div>
              ))}
              {checklistItems.length === 0 && (
                <p className="text-center text-gray-400 py-4">Ajoutez des points de contrôle ci-dessus</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "⏳ Enregistrement..." : "✓ Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCHEDULE MODAL - Multi-equipment support
// ============================================================
function ScheduleModal({ templates, switchboards, datahubCategories = [], mecaCategories = [], preSelectedBoardId, onClose, onSave }) {
  const [templateId, setTemplateId] = useState("");
  const [targetType, setTargetType] = useState("switchboard");
  // Initialize with pre-selected board if provided
  const [selectedIds, setSelectedIds] = useState(() => {
    if (preSelectedBoardId) {
      return new Set([preSelectedBoardId]);
    }
    return new Set();
  });
  const [nextDueDate, setNextDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Smart distribution for initial controls
  const [useSmartDistribution, setUseSmartDistribution] = useState(false);
  const [controlsPerMonth, setControlsPerMonth] = useState(15);
  const [startMonth, setStartMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear() + 1}-01`; // Default: January next year
  });

  // Equipment lists from different sources
  const [vsdEquipments, setVsdEquipments] = useState([]);
  const [mecaEquipments, setMecaEquipments] = useState([]);
  const [mobileEquipments, setMobileEquipments] = useState([]);
  const [hvEquipments, setHvEquipments] = useState([]);
  const [gloEquipments, setGloEquipments] = useState([]);
  const [datahubEquipments, setDatahubEquipments] = useState([]);
  const [loadingEquipments, setLoadingEquipments] = useState(false);

  // Device-specific states
  const [switchboardSchedules, setSwitchboardSchedules] = useState({}); // { switchboardId: { next_due_date, template_name } }
  const [devicesBySwitchboard, setDevicesBySwitchboard] = useState({}); // { switchboardId: [devices] }
  const [selectedSwitchboardsForDevices, setSelectedSwitchboardsForDevices] = useState(new Set());
  const [loadingDevices, setLoadingDevices] = useState(false);

  // DDR-specific states (for element_filter = 'ddr' templates)
  const [switchboardsWithDDR, setSwitchboardsWithDDR] = useState([]); // List of switchboards that have DDR devices
  const [ddrDevicesBySwitchboard, setDdrDevicesBySwitchboard] = useState({}); // { switchboardId: [ddr_devices] }
  const [loadingDDRData, setLoadingDDRData] = useState(false);

  // Date alignment states (for aligning controls with same frequency)
  const [existingDatesByFrequency, setExistingDatesByFrequency] = useState({}); // { frequency_months: date }
  const [existingControlsByFrequency, setExistingControlsByFrequency] = useState({}); // { frequency_months: { template_name, next_due_date } }
  const [hasExistingControls, setHasExistingControls] = useState(false);
  const [suggestedDate, setSuggestedDate] = useState(null);

  // Get selected template's element_filter
  const selectedTemplate = (templates || []).find(t => t.id === Number(templateId));
  const elementFilter = selectedTemplate?.element_filter || null;
  const isDDRControl = elementFilter === 'ddr';
  const isNonDDRControl = elementFilter === 'non_ddr';

  // Helper to check if targetType is a datahub category
  const isDatahubCategory = targetType.startsWith('datahub_');
  const datahubCategoryId = isDatahubCategory ? targetType.replace('datahub_', '') : null;

  // Helper to check if targetType is a meca category
  const isMecaCategory = targetType.startsWith('meca_');
  const mecaCategoryId = isMecaCategory ? targetType.replace('meca_', '') : null;

  // Load equipment when target type changes
  useEffect(() => {
    const isDatahub = targetType.startsWith('datahub_');
    const isMeca = targetType.startsWith('meca_');
    if (targetType === 'vsd' || targetType === 'meca' || targetType === 'mobile_equipment' || targetType === 'hv' || targetType === 'glo' || isDatahub || isMeca) {
      setLoadingEquipments(true);
      const apiType = isDatahub ? 'datahub' : isMeca ? 'meca' : (targetType === 'mobile_equipment' ? 'mobile_equipment' : targetType);
      api.switchboardControls.listEquipment(apiType)
        .then(res => {
          if (targetType === 'vsd') setVsdEquipments(res.vsd || []);
          else if (targetType === 'meca') setMecaEquipments(res.meca || []);
          else if (targetType === 'mobile_equipment') setMobileEquipments(res.mobile_equipment || []);
          else if (targetType === 'hv') setHvEquipments(res.hv || []);
          else if (targetType === 'glo') setGloEquipments(res.glo || []);
          else if (isDatahub) {
            // Filter by category ID
            const categoryId = targetType.replace('datahub_', '');
            const filtered = (res.datahub || []).filter(item =>
              item.category_id === categoryId ||
              (item.category_name && datahubCategories.find(c => c.id === categoryId)?.name === item.category_name)
            );
            setDatahubEquipments(filtered);
          }
          else if (isMeca) {
            // Filter by meca category ID
            const categoryId = targetType.replace('meca_', '');
            const filtered = (res.meca || []).filter(item =>
              item.category_id === categoryId ||
              (item.category_name && mecaCategories.find(c => c.id === categoryId)?.name === item.category_name)
            );
            setMecaEquipments(filtered);
          }
        })
        .catch(e => console.warn('Load equipment error:', e))
        .finally(() => setLoadingEquipments(false));
    }
    setSelectedIds(new Set()); // Reset selection when type changes
  }, [targetType, datahubCategories, mecaCategories]);

  // Load switchboard schedules when device type is selected
  useEffect(() => {
    if (targetType === 'device') {
      setLoadingDevices(true);
      // Load existing schedules for switchboards
      api.switchboardControls.listSchedules({ equipment_type: 'switchboard' })
        .then(res => {
          const scheduleMap = {};
          (res.schedules || res || []).forEach(s => {
            if (s.switchboard_id && s.next_due_date) {
              // Keep the earliest upcoming date if multiple schedules exist
              if (!scheduleMap[s.switchboard_id] || s.next_due_date < scheduleMap[s.switchboard_id].next_due_date) {
                scheduleMap[s.switchboard_id] = {
                  next_due_date: s.next_due_date,
                  template_name: s.template_name || 'Contrôle planifié'
                };
              }
            }
          });
          setSwitchboardSchedules(scheduleMap);
        })
        .catch(e => console.warn('Load schedules error:', e))
        .finally(() => setLoadingDevices(false));
    }
  }, [targetType]);

  // Load devices when switchboards are selected for device control
  useEffect(() => {
    if (targetType === 'device' && selectedSwitchboardsForDevices.size > 0) {
      const loadDevicesForBoards = async () => {
        const newDevicesMap = { ...devicesBySwitchboard };
        for (const boardId of selectedSwitchboardsForDevices) {
          // Skip invalid board IDs to prevent /api/switchboard/boards/undefined calls
          if (!boardId || boardId === 'undefined' || boardId === null) {
            console.warn('Skipping invalid boardId:', boardId);
            continue;
          }
          if (!newDevicesMap[boardId]) {
            try {
              const res = await api.switchboard.listDevices(boardId);
              newDevicesMap[boardId] = res.data || [];
            } catch (e) {
              console.warn(`Failed to load devices for board ${boardId}:`, e);
              newDevicesMap[boardId] = [];
            }
          }
        }
        setDevicesBySwitchboard(newDevicesMap);
      };
      loadDevicesForBoards();
    }
  }, [targetType, selectedSwitchboardsForDevices]);

  // Load switchboards with DDR when DDR template is selected
  useEffect(() => {
    if (targetType === 'device' && isDDRControl) {
      setLoadingDDRData(true);
      api.switchboardControls.listSwitchboardsWithDDR()
        .then(res => {
          setSwitchboardsWithDDR(res.switchboards || []);
        })
        .catch(e => console.warn('Load switchboards with DDR error:', e))
        .finally(() => setLoadingDDRData(false));
    }
  }, [targetType, isDDRControl]);

  // Load DDR devices when switchboards are selected for DDR control
  useEffect(() => {
    if (targetType === 'device' && isDDRControl && selectedSwitchboardsForDevices.size > 0) {
      const boardIds = Array.from(selectedSwitchboardsForDevices).filter(id => id && id !== 'undefined');
      if (boardIds.length > 0) {
        api.switchboardControls.listDDRDevices(boardIds)
          .then(res => {
            setDdrDevicesBySwitchboard(res.devices || {});
          })
          .catch(e => console.warn('Load DDR devices error:', e));
      }
    }
  }, [targetType, isDDRControl, selectedSwitchboardsForDevices]);

  // Load existing dates by frequency for date alignment
  useEffect(() => {
    if (targetType === 'device' && selectedSwitchboardsForDevices.size > 0) {
      // Load existing dates for the first selected switchboard
      const firstBoardId = Array.from(selectedSwitchboardsForDevices)[0];
      if (firstBoardId && firstBoardId !== 'undefined') {
        api.switchboardControls.getExistingDatesByBoard(firstBoardId)
          .then(res => {
            setExistingDatesByFrequency(res.dates_by_frequency || {});
            setExistingControlsByFrequency(res.controls_by_frequency || {});
            setHasExistingControls(res.has_controls || false);
          })
          .catch(e => console.warn('Load existing dates error:', e));
      }
    } else {
      // Reset when no switchboard selected
      setExistingDatesByFrequency({});
      setExistingControlsByFrequency({});
      setHasExistingControls(false);
      setSuggestedDate(null);
    }
  }, [targetType, selectedSwitchboardsForDevices]);

  // Update suggested date when template or existing dates change
  useEffect(() => {
    if (selectedTemplate && existingDatesByFrequency) {
      const freq = selectedTemplate.frequency_months;
      const existingDate = existingDatesByFrequency[freq];
      if (existingDate && existingDate !== suggestedDate) {
        setSuggestedDate(existingDate);
        // Auto-apply the suggested date
        setNextDueDate(existingDate);
      }
    }
  }, [templateId, existingDatesByFrequency, selectedTemplate]);

  // Filter templates: for datahub/meca categories, look for templates with target_type matching the category
  const filteredTemplates = (templates || []).filter((t) => {
    if (isDatahubCategory) {
      // Match templates with target_type = 'datahub' or 'datahub_<categoryId>'
      return t.target_type === targetType || t.target_type === 'datahub';
    }
    if (isMecaCategory) {
      // Match templates with target_type = 'meca' or 'meca_<categoryId>'
      return t.target_type === targetType || t.target_type === 'meca';
    }
    return t.target_type === targetType;
  });

  // Get current equipment list based on type
  const getCurrentEquipmentList = () => {
    if (targetType === 'switchboard') return switchboards || [];
    if (targetType === 'vsd') return vsdEquipments;
    if (targetType === 'meca') return mecaEquipments;
    if (targetType === 'mobile_equipment') return mobileEquipments;
    if (targetType === 'hv') return hvEquipments;
    if (targetType === 'glo') return gloEquipments;
    if (isDatahubCategory) return datahubEquipments;
    if (isMecaCategory) return mecaEquipments;
    return [];
  };

  // Filter equipment by search
  const filteredEquipment = getCurrentEquipmentList().filter(eq => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = eq.name || eq.code || '';
    const building = eq.building || eq.building_code || eq.meta?.building_code || '';
    return name.toLowerCase().includes(q) || building.toLowerCase().includes(q);
  });

  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredEquipment.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEquipment.map(eq => eq.id)));
    }
  };

  // Device-specific: toggle switchboard selection
  const toggleSwitchboardForDevices = (boardId) => {
    const newSet = new Set(selectedSwitchboardsForDevices);
    if (newSet.has(boardId)) {
      newSet.delete(boardId);
    } else {
      newSet.add(boardId);
    }
    setSelectedSwitchboardsForDevices(newSet);
  };

  // Device-specific: filter switchboards that have scheduled controls
  // For DDR control: use switchboards with DDR, otherwise use switchboards with scheduled controls
  const switchboardsForDeviceControl = isDDRControl
    ? switchboardsWithDDR
    : (switchboards || []).filter(sb => switchboardSchedules[sb.id]?.next_due_date);

  // Device-specific: filter by search
  const filteredSwitchboardsForDevices = switchboardsForDeviceControl.filter(sb => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (sb.code || '').toLowerCase().includes(q) ||
           (sb.name || '').toLowerCase().includes(q) ||
           (sb.building || sb.building_code || '').toLowerCase().includes(q);
  });

  // Device-specific: count total devices from selected switchboards
  // For DDR control: count only DDR devices
  // For non-DDR control: count only non-DDR devices
  const getTotalDevicesCount = () => {
    let count = 0;
    for (const boardId of selectedSwitchboardsForDevices) {
      if (isDDRControl) {
        // Count DDR devices from ddrDevicesBySwitchboard
        count += (ddrDevicesBySwitchboard[boardId] || []).length;
      } else if (isNonDDRControl) {
        // Count non-DDR devices
        const allDevices = devicesBySwitchboard[boardId] || [];
        count += allDevices.filter(d => !d.is_differential).length;
      } else {
        // Count all devices
        count += (devicesBySwitchboard[boardId] || []).length;
      }
    }
    return count;
  };

  // Get the appropriate device label based on element filter
  const getDeviceLabel = () => {
    if (isDDRControl) return 'DDR';
    if (isNonDDRControl) return 'disjoncteur(s) non-DDR';
    return 'disjoncteur(s)';
  };

  // Get equipment type label
  const getTypeLabel = () => {
    switch(targetType) {
      case 'switchboard': return 'tableaux';
      case 'vsd': return 'variateurs';
      case 'meca': return 'équipements mécaniques';
      case 'mobile_equipment': return 'équipements mobiles';
      case 'hv': return 'équipements haute tension';
      case 'glo': return 'équipements GLO';
      default:
        if (isDatahubCategory) {
          const cat = datahubCategories.find(c => c.id === datahubCategoryId);
          return cat ? `équipements ${cat.name}` : 'équipements Datahub';
        }
        if (isMecaCategory) {
          const cat = mecaCategories.find(c => c.id === mecaCategoryId);
          return cat ? `équipements ${cat.name}` : 'équipements Meca';
        }
        return 'équipements';
    }
  };

  // Calculate smart distribution dates - evenly distributed across 12 months
  const calculateSmartDistribution = () => {
    if ((targetType !== 'switchboard' && !isMecaCategory) || !useSmartDistribution) return null;

    const equipmentList = getCurrentEquipmentList();
    const selectedEquipment = equipmentList.filter(eq => selectedIds.has(eq.id));
    const total = selectedEquipment.length;

    if (total === 0) return null;

    // Sort equipment by building then floor for logical ordering
    const sortedEquipment = [...selectedEquipment].sort((a, b) => {
      const buildingA = a.building || a.building_code || '';
      const buildingB = b.building || b.building_code || '';
      if (buildingA !== buildingB) return buildingA.localeCompare(buildingB);
      const floorA = a.floor || '';
      const floorB = b.floor || '';
      return floorA.localeCompare(floorB);
    });

    // Calculate items per month - divide by 12 for even distribution
    const itemsPerMonth = Math.ceil(total / 12);
    const [year, month] = startMonth.split('-').map(Number);
    const dateMapping = {};

    // Track items per month for preview
    const monthData = {}; // { monthKey: { monthName, count } }

    // Distribute items evenly across months
    sortedEquipment.forEach((eq, index) => {
      const monthOffset = Math.floor(index / itemsPerMonth);
      const groupDate = new Date(year, month - 1 + monthOffset, 15);
      const dateStr = groupDate.toISOString().split('T')[0];
      const monthKey = dateStr.substring(0, 7);
      const monthName = groupDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

      dateMapping[eq.id] = dateStr;

      if (!monthData[monthKey]) {
        monthData[monthKey] = { monthName, count: 0 };
      }
      monthData[monthKey].count++;
    });

    // Convert to array for display
    const monthGroups = Object.entries(monthData).map(([key, data]) => ({
      monthKey: key,
      monthName: data.monthName,
      count: data.count
    }));

    return {
      dateMapping,
      groups: monthGroups,
      monthsNeeded: monthGroups.length,
      itemsPerMonth,
      totalItems: total
    };
  };

  // Get distribution preview for UI
  const distributionPreview = useSmartDistribution ? calculateSmartDistribution() : null;

  const handleSave = async () => {
    if (!templateId) return alert("Sélectionnez un modèle");

    // Special handling for devices - check switchboard selection
    if (targetType === 'device') {
      if (selectedSwitchboardsForDevices.size === 0) return alert("Sélectionnez au moins un tableau");
      const totalDevices = getTotalDevicesCount();
      const noDevicesMsg = isDDRControl
        ? "Aucun DDR trouvé dans les tableaux sélectionnés"
        : isNonDDRControl
          ? "Aucun disjoncteur non-DDR trouvé dans les tableaux sélectionnés"
          : "Aucun disjoncteur trouvé dans les tableaux sélectionnés";
      if (totalDevices === 0) return alert(noDevicesMsg);

      setSaving(true);
      setProgress({ current: 0, total: totalDevices });

      try {
        let successCount = 0;
        let currentIndex = 0;

        // Iterate through selected switchboards and their devices
        for (const boardId of selectedSwitchboardsForDevices) {
          // Get the appropriate device list based on element_filter
          let devices;
          if (isDDRControl) {
            // Use only DDR devices
            devices = ddrDevicesBySwitchboard[boardId] || [];
          } else if (isNonDDRControl) {
            // Use only non-DDR devices
            const allDevices = devicesBySwitchboard[boardId] || [];
            devices = allDevices.filter(d => !d.is_differential);
          } else {
            // Use all devices
            devices = devicesBySwitchboard[boardId] || [];
          }

          // For DDR controls, we can use a date directly (not from switchboard schedule)
          const schedule = isDDRControl ? null : switchboardSchedules[boardId];
          const deviceDate = schedule?.next_due_date || nextDueDate;

          for (const device of devices) {
            try {
              const payload = {
                template_id: Number(templateId),
                next_due_date: deviceDate,
                equipment_type: 'device',
                device_id: Number(device.id),
              };

              const isLast = currentIndex === totalDevices - 1;
              await onSave(payload, isLast);
              successCount++;
            } catch (e) {
              console.warn(`Failed to create schedule for device ${device.id}:`, e);
            }
            currentIndex++;
            setProgress({ current: currentIndex, total: totalDevices });
          }
        }

        if (successCount > 0) {
          alert(`✅ ${successCount} contrôle(s) de disjoncteurs planifié(s) avec succès!`);
        }
      } finally {
        setSaving(false);
      }
      return;
    }

    // Standard handling for other equipment types
    if (selectedIds.size === 0) return alert(`Sélectionnez au moins un ${getTypeLabel()}`);

    setSaving(true);
    setProgress({ current: 0, total: selectedIds.size });

    try {
      const ids = Array.from(selectedIds);
      let successCount = 0;

      // Get smart distribution mapping if enabled
      const distribution = useSmartDistribution && (targetType === 'switchboard' || isMecaCategory)
        ? calculateSmartDistribution()
        : null;

      // Create schedules for all selected items
      for (let i = 0; i < ids.length; i++) {
        try {
          // Use distributed date or default date
          const itemDate = distribution?.dateMapping?.[ids[i]] || nextDueDate;

          const payload = {
            template_id: Number(templateId),
            next_due_date: itemDate,
            equipment_type: targetType,
          };

          // Set the appropriate equipment ID
          if (targetType === 'switchboard') payload.switchboard_id = Number(ids[i]);
          else if (targetType === 'vsd') payload.vsd_equipment_id = Number(ids[i]);
          else if (targetType === 'meca') payload.meca_equipment_id = String(ids[i]); // UUID
          else if (targetType === 'mobile_equipment') payload.mobile_equipment_id = String(ids[i]); // UUID
          else if (targetType === 'hv') payload.hv_equipment_id = Number(ids[i]);
          else if (targetType === 'glo') payload.glo_equipment_id = String(ids[i]); // UUID
          else if (targetType.startsWith('datahub_')) {
            payload.datahub_equipment_id = String(ids[i]); // UUID
            payload.equipment_type = 'datahub'; // Store as datahub type in DB
          }
          else if (targetType.startsWith('meca_')) {
            payload.meca_equipment_id = String(ids[i]); // UUID
            payload.equipment_type = 'meca'; // Store as meca type in DB
          }

          await onSave(payload, i === ids.length - 1); // Only reload on last item
          successCount++;
        } catch (e) {
          console.warn(`Failed to create schedule for ${ids[i]}:`, e);
        }
        setProgress({ current: i + 1, total: ids.length });
      }

      if (successCount > 0) {
        alert(`✅ ${successCount} contrôle(s) planifié(s) avec succès!`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl animate-slideUp max-h-[90vh] flex flex-col">
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-green-500 to-emerald-600 text-white flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <h2 className="text-lg sm:text-xl font-bold">Planifier un contrôle</h2>
                {selectedIds.size > 0 && (
                  <p className="text-sm text-white/80">{selectedIds.size} tableau(x) sélectionné(s)</p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full">✕</button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium mb-1">Type d'équipement</label>
            <select
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTemplateId(""); setSelectedIds(new Set()); }}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
            >
              <option value="switchboard">⚡ Tableau électrique</option>
              <option value="device">🔌 Disjoncteur</option>
              <option value="vsd">⚙️ Variateur (VSD)</option>
              {mecaCategories.length > 0 ? (
                <optgroup label="🔧 Équip. Mécanique">
                  {mecaCategories.map(cat => (
                    <option key={cat.id} value={`meca_${cat.id}`}>
                      {cat.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option value="meca">🔧 Équip. Mécanique</option>
              )}
              <option value="mobile_equipment">🚜 Équip. Mobile</option>
              <option value="hv">⚡ Haute Tension (HT)</option>
              <option value="glo">🔋 Équip. GLO</option>
              {datahubCategories.length > 0 && (
                <optgroup label="📦 Datahub">
                  {datahubCategories.map(cat => (
                    <option key={cat.id} value={`datahub_${cat.id}`}>
                      {cat.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Modèle de contrôle</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
            >
              <option value="">-- Sélectionner un modèle --</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {filteredTemplates.length === 0 && (
              <p className="text-xs text-orange-600 mt-1">⚠️ Aucun modèle pour ce type. Créez-en un d'abord.</p>
            )}
          </div>

          {targetType !== "device" && (
            <div>
              <label className="block text-sm font-medium mb-1 capitalize">{getTypeLabel()} à contrôler</label>
              {/* Search and Select All */}
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="🔍 Rechercher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                />
                <button
                  onClick={selectAll}
                  className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 whitespace-nowrap"
                >
                  {selectedIds.size === filteredEquipment.length ? '✓ Désélectionner' : '☐ Tout'}
                </button>
              </div>
              {/* Loading state */}
              {loadingEquipments && (
                <div className="border rounded-xl p-4 text-center text-gray-500">
                  <div className="w-6 h-6 border-2 border-blue-200 rounded-full animate-spin border-t-blue-600 mx-auto mb-2" />
                  Chargement...
                </div>
              )}
              {/* Scrollable list with checkboxes */}
              {!loadingEquipments && (
                <div className="border rounded-xl max-h-48 overflow-y-auto divide-y">
                  {filteredEquipment.map((eq) => (
                    <label
                      key={eq.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedIds.has(eq.id) ? 'bg-green-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(eq.id)}
                        onChange={() => toggleSelection(eq.id)}
                        className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{eq.code || eq.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {eq.name !== eq.code && eq.name} {eq.building || eq.building_code || eq.meta?.building_code ? `• ${eq.building || eq.building_code || eq.meta?.building_code}` : ''}
                        </p>
                      </div>
                      {selectedIds.has(eq.id) && (
                        <span className="text-green-600">✓</span>
                      )}
                    </label>
                  ))}
                  {filteredEquipment.length === 0 && (
                    <p className="p-4 text-center text-gray-500 text-sm">Aucun équipement trouvé</p>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                💡 Sélectionnez plusieurs équipements pour leur attribuer le même contrôle
              </p>
            </div>
          )}

          {/* Device selection - linked to switchboard schedules */}
          {targetType === "device" && (
            <div>
              <label className="block text-sm font-medium mb-1">
                {isDDRControl ? 'Tableaux contenant des DDR' : 'Tableaux avec contrôles planifiés'}
              </label>

              {/* Info message based on control type */}
              {isDDRControl ? (
                <div className="p-2 bg-purple-50 border border-purple-200 rounded-lg mb-2">
                  <p className="text-xs text-purple-700">
                    <strong>Contrôle DDR :</strong> Seuls les tableaux ayant des DDR sont listés.
                    Le contrôle sera créé uniquement pour les disjoncteurs différentiels.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mb-2">
                  Les disjoncteurs hériteront de la date de contrôle de leur tableau
                </p>
              )}

              {/* Search */}
              <div className="mb-2">
                <input
                  type="text"
                  placeholder="🔍 Rechercher un tableau..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                />
              </div>

              {/* Loading state */}
              {(loadingDevices || loadingDDRData) && (
                <div className="border rounded-xl p-4 text-center text-gray-500">
                  <div className="w-6 h-6 border-2 border-blue-200 rounded-full animate-spin border-t-blue-600 mx-auto mb-2" />
                  Chargement des planifications...
                </div>
              )}

              {/* Switchboard list with their scheduled dates */}
              {!loadingDevices && !loadingDDRData && (
                <div className="border rounded-xl max-h-56 overflow-y-auto divide-y">
                  {filteredSwitchboardsForDevices.map((sb) => {
                    const schedule = switchboardSchedules[sb.id];
                    // For DDR controls, get DDR count from switchboardsWithDDR, otherwise use loaded devices
                    const ddrCount = isDDRControl ? (sb.ddr_count || 0) : 0;
                    const devices = devicesBySwitchboard[sb.id] || [];
                    const deviceCount = isDDRControl ? ddrCount : devices.length;
                    const isSelected = selectedSwitchboardsForDevices.has(sb.id);
                    const dateFormatted = !isDDRControl && schedule?.next_due_date
                      ? new Date(schedule.next_due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '';

                    return (
                      <label
                        key={sb.id}
                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                          isSelected ? 'bg-blue-50' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSwitchboardForDevices(sb.id)}
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{sb.code}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {sb.name} {sb.building || sb.building_code ? `• ${sb.building || sb.building_code}` : ''}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {dateFormatted && <p className="text-sm font-medium text-blue-700">{dateFormatted}</p>}
                          {isDDRControl && (
                            <p className="text-xs text-purple-600 font-medium">{ddrCount} DDR</p>
                          )}
                          {!isDDRControl && isSelected && devices.length > 0 && (
                            <p className="text-xs text-gray-500">{devices.length} disj.</p>
                          )}
                        </div>
                        {isSelected && <span className="text-blue-600">✓</span>}
                      </label>
                    );
                  })}
                  {filteredSwitchboardsForDevices.length === 0 && !loadingDevices && !loadingDDRData && (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      {isDDRControl ? (
                        <>
                          <p>Aucun tableau avec des DDR</p>
                          <p className="text-xs mt-1">Vérifiez que vos tableaux ont des disjoncteurs différentiels</p>
                        </>
                      ) : (
                        <>
                          <p>Aucun tableau avec contrôle planifié</p>
                          <p className="text-xs mt-1">Planifiez d'abord des contrôles sur les tableaux</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Summary of selected devices */}
              {selectedSwitchboardsForDevices.size > 0 && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">{selectedSwitchboardsForDevices.size}</span> tableau(x) sélectionné(s)
                    {getTotalDevicesCount() > 0 && (
                      <span> → <span className="font-medium">{getTotalDevicesCount()}</span> {getDeviceLabel()} à contrôler</span>
                    )}
                  </p>
                </div>
              )}

              {/* Date selector for DDR controls (they don't inherit from switchboard schedule) */}
              {isDDRControl && selectedSwitchboardsForDevices.size > 0 && selectedTemplate && (
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1">Date du prochain contrôle</label>

                  {/* Case 1: Aligned with existing control of same frequency */}
                  {suggestedDate && nextDueDate === suggestedDate && existingControlsByFrequency[selectedTemplate.frequency_months] && (
                    <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs text-green-700">
                        <strong>✓ Alignement automatique :</strong> Le tableau a déjà un contrôle "{existingControlsByFrequency[selectedTemplate.frequency_months].template_name}" prévu le {new Date(suggestedDate).toLocaleDateString('fr-FR')} avec la même périodicité ({selectedTemplate.frequency_months === 12 ? 'annuel' : selectedTemplate.frequency_months === 6 ? 'semestriel' : selectedTemplate.frequency_months === 3 ? 'trimestriel' : selectedTemplate.frequency_months === 1 ? 'mensuel' : `${selectedTemplate.frequency_months} mois`}).
                      </p>
                    </div>
                  )}

                  {/* Case 2: Has controls but different frequency */}
                  {hasExistingControls && !existingDatesByFrequency[selectedTemplate.frequency_months] && (
                    <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-700">
                        <strong>⚠ Périodicité différente :</strong> Le tableau a des contrôles planifiés mais avec une périodicité différente. Veuillez choisir une date pour ce nouveau contrôle {selectedTemplate.frequency_months === 12 ? 'annuel' : selectedTemplate.frequency_months === 6 ? 'semestriel' : selectedTemplate.frequency_months === 3 ? 'trimestriel' : selectedTemplate.frequency_months === 1 ? 'mensuel' : `tous les ${selectedTemplate.frequency_months} mois`}.
                      </p>
                      <div className="mt-1 text-xs text-amber-600">
                        Contrôles existants : {Object.values(existingControlsByFrequency).map(c => `${c.template_name} (${new Date(c.next_due_date).toLocaleDateString('fr-FR')})`).join(', ')}
                      </div>
                    </div>
                  )}

                  {/* Case 3: No existing controls */}
                  {!hasExistingControls && (
                    <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-700">
                        <strong>ℹ Premier contrôle :</strong> Aucun contrôle planifié sur ce tableau. Choisissez une date de référence pour les contrôles {selectedTemplate.frequency_months === 12 ? 'annuels' : selectedTemplate.frequency_months === 6 ? 'semestriels' : selectedTemplate.frequency_months === 3 ? 'trimestriels' : selectedTemplate.frequency_months === 1 ? 'mensuels' : `tous les ${selectedTemplate.frequency_months} mois`}.
                      </p>
                    </div>
                  )}

                  <input
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => {
                      setNextDueDate(e.target.value);
                      setSuggestedDate(null); // Clear suggestion when user manually changes
                    }}
                    className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
                  />
                </div>
              )}
            </div>
          )}

          {/* Smart Distribution Option - For switchboards and meca categories with 10+ selections */}
          {(targetType === 'switchboard' || isMecaCategory) && selectedIds.size >= 10 && (
            <div className="border rounded-xl p-4 bg-gradient-to-r from-amber-50 to-orange-50">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSmartDistribution}
                  onChange={(e) => setUseSmartDistribution(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <span className="font-medium text-gray-900">Répartition intelligente</span>
                  <p className="text-xs text-gray-600">Étaler les contrôles sur l'année, groupés par bâtiment</p>
                </div>
              </label>

              {useSmartDistribution && (
                <div className="mt-4 space-y-3 pt-3 border-t border-amber-200">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Mois de début</label>
                    <input
                      type="month"
                      value={startMonth}
                      onChange={(e) => setStartMonth(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                    />
                  </div>

                  {/* Distribution Preview */}
                  {distributionPreview && (
                    <div className="bg-white rounded-lg p-3 text-sm">
                      <p className="font-medium text-amber-800 mb-3">
                        {distributionPreview.totalItems} équipements sur {distributionPreview.monthsNeeded} mois
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {distributionPreview.groups.map((group, idx) => (
                          <div key={idx} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
                            <span className="font-medium text-amber-800 capitalize">{group.monthName}</span>
                            <span className="text-amber-600 ml-1">({group.count})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Standard date picker - hidden when smart distribution is enabled or for devices */}
          {!useSmartDistribution && targetType !== 'device' && (
            <div>
              <label className="block text-sm font-medium mb-1">Date du premier contrôle</label>
              <input
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              />
            </div>
          )}
        </div>

        {/* Progress bar when saving */}
        {saving && progress.total > 1 && (
          <div className="px-4 sm:px-6 py-2 bg-gray-100">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>Création en cours...</span>
              <span>{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (targetType === 'device' ? selectedSwitchboardsForDevices.size === 0 : selectedIds.size === 0)}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving
              ? `⏳ ${progress.current}/${progress.total}...`
              : targetType === 'device'
                ? `✓ Planifier (${getTotalDevicesCount()} ${getDeviceLabel()})`
                : `✓ Planifier (${selectedIds.size})`
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CONTROL MODAL - Enhanced with visible file upload
// Photos are saved immediately to Neon DB (no size limit)
// ============================================================

function ControlModal({ schedule, onClose, onComplete, site, userEmail, userName }) {
  const [template, setTemplate] = useState(null);
  const [results, setResults] = useState([]);
  const [globalNotes, setGlobalNotes] = useState("");
  const [status, setStatus] = useState("conform");
  const [saving, setSaving] = useState(false);
  // serverAttachments: attachments already saved to server {id, file_type, file_name, file_mime}
  const [serverAttachments, setServerAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  // NC Modal state
  const [showNCModal, setShowNCModal] = useState(false);
  const [ncItems, setNcItems] = useState([]);
  const [equipmentData, setEquipmentData] = useState(null);
  const [completedRecordId, setCompletedRecordId] = useState(null);

  // Load template and restore draft from server
  useEffect(() => {
    if (schedule.template_id) {
      Promise.all([
        api.switchboardControls.listTemplates(),
        api.switchboardControls.getDraft(schedule.id)
      ]).then(([templatesRes, draftRes]) => {
        const t = (templatesRes.templates || []).find((x) => x.id === schedule.template_id);
        if (t) {
          setTemplate(t);

          // Restore draft from server if exists
          if (draftRes.draft) {
            const draft = draftRes.draft;
            const savedResults = draft.checklist_results || [];

            // Restore results if they match the template
            if (savedResults.length === (t.checklist_items || []).length) {
              setResults(savedResults);
            } else {
              setResults(
                (t.checklist_items || []).map((item) => ({
                  item_id: item.id,
                  status: "conform",
                  value: "",
                  comment: "",
                }))
              );
            }

            // Restore notes and status
            if (draft.global_notes) setGlobalNotes(draft.global_notes);
            if (draft.status) setStatus(draft.status);

            // Restore attachments list (already on server)
            if (draftRes.attachments && draftRes.attachments.length > 0) {
              setServerAttachments(draftRes.attachments);
            }
          } else {
            // No draft - initialize fresh
            setResults(
              (t.checklist_items || []).map((item) => ({
                item_id: item.id,
                status: "conform",
                value: "",
                comment: "",
              }))
            );
          }
          setDraftLoaded(true);
        }
      }).catch(e => {
        console.error('Error loading template/draft:', e);
      });
    }
  }, [schedule.template_id, schedule.id]);

  // Auto-save draft to server (debounced) whenever results/notes change
  useEffect(() => {
    if (!draftLoaded || !template) return;

    // Debounce save to avoid too many requests
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      api.switchboardControls.saveDraft(schedule.id, {
        checklist_results: results,
        global_notes: globalNotes,
        status,
      }).catch(e => console.error('Error auto-saving draft:', e));
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [results, globalNotes, status, draftLoaded, template, schedule.id]);

  // Handle close - draft remains on server for later
  const handleClose = () => {
    onClose();
  };

  // Delete draft from server after successful completion
  const clearDraft = async () => {
    try {
      await api.switchboardControls.deleteDraft(schedule.id);
    } catch (e) {
      console.error('Error clearing draft:', e);
    }
  };

  const updateResult = (index, field, value) => {
    const updated = [...results];
    updated[index][field] = value;
    setResults(updated);

    const hasNonConform = updated.some((r) => r.status === "non_conform");
    const allConform = updated.every((r) => r.status === "conform" || r.status === "na");
    setStatus(hasNonConform ? "non_conform" : allConform ? "conform" : "partial");
  };

  // Upload file immediately to server (no size limit!)
  const handleFileAdd = async (e, fileType) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    e.target.value = "";
    setUploadingFile(true);

    try {
      for (const file of files) {
        const res = await api.switchboardControls.uploadDraftAttachment(schedule.id, file, {
          file_type: fileType,
        });
        if (res.attachment) {
          setServerAttachments((prev) => [...prev, res.attachment]);
        }
      }
    } catch (err) {
      console.error('Error uploading file:', err);
      alert('Erreur lors de l\'upload du fichier. Veuillez réessayer.');
    } finally {
      setUploadingFile(false);
    }
  };

  // Remove file from server
  const removeFile = async (attachmentId) => {
    try {
      await api.switchboardControls.deleteDraftAttachment(attachmentId);
      setServerAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      console.error('Error removing file:', err);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const recordRes = await api.switchboardControls.createRecord({
        schedule_id: schedule.id,
        template_id: schedule.template_id,
        switchboard_id: schedule.switchboard_id,
        device_id: schedule.device_id,
        vsd_equipment_id: schedule.vsd_equipment_id,
        meca_equipment_id: schedule.meca_equipment_id,
        mobile_equipment_id: schedule.mobile_equipment_id,
        glo_equipment_id: schedule.glo_equipment_id,
        equipment_type: schedule.equipment_type,
        checklist_results: results,
        global_notes: globalNotes,
        status,
        // Pass draft attachment IDs to be moved to the final record
        draft_attachment_ids: serverAttachments.map((a) => a.id),
      });

      // Clear draft after successful completion
      await clearDraft();

      // Check for non-conforming items
      const nonConformItems = [];
      if (template && template.checklist_items) {
        template.checklist_items.forEach((item, idx) => {
          if (item.type === 'conform' && results[idx]?.status === 'non_conform') {
            nonConformItems.push({
              name: item.label,
              note: results[idx]?.comment || ''
            });
          }
        });
      }

      // If there are NC items, show the NC resolution modal
      if (nonConformItems.length > 0) {
        setNcItems(nonConformItems);
        setCompletedRecordId(recordRes?.record?.id);
        // Build equipment data from schedule
        const equipDisplay = getEquipmentDisplay(schedule);
        setEquipmentData({
          id: schedule.switchboard_id || schedule.device_id || schedule.vsd_equipment_id ||
              schedule.meca_equipment_id || schedule.mobile_equipment_id || schedule.glo_equipment_id,
          name: equipDisplay.name,
          code: schedule.equipment_code || '',
          type: schedule.equipment_type,
          building_code: schedule.building_code || equipDisplay.building || '',
          floor: schedule.floor || '',
          zone: schedule.zone || '',
          room: schedule.room || ''
        });
        setShowNCModal(true);
      } else {
        await onComplete();
      }
    } finally {
      setSaving(false);
    }
  };

  // Handle NC modal close
  const handleNCModalClose = async (createdRecords) => {
    setShowNCModal(false);
    await onComplete();
  };

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-12 h-12 border-4 border-blue-200 rounded-full animate-spin border-t-blue-600 mx-auto" />
          <p className="mt-4 text-gray-500">Chargement du formulaire...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b bg-gradient-to-r from-amber-500 to-orange-500 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">📋</span>
                {template.name}
              </h2>
              <p className="text-white/80 text-sm mt-1 flex items-center gap-2">
                <span>{getEquipmentDisplay(schedule).icon}</span>
                {getEquipmentDisplay(schedule).name}
                {getEquipmentDisplay(schedule).category && (
                  <span className="bg-white/20 px-2 py-0.5 rounded text-xs">{getEquipmentDisplay(schedule).category}</span>
                )}
              </p>
            </div>
            <button onClick={handleClose} className="p-2 hover:bg-white/20 rounded-full">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[55vh] sm:max-h-[50vh] space-y-4">
          {/* Checklist */}
          {(template.checklist_items || []).map((item, idx) => (
            <div key={item.id} className="border rounded-xl p-4 bg-gray-50">
              <div className="flex items-start justify-between mb-3">
                <label className="font-medium text-gray-900">{idx + 1}. {item.label}</label>
                <span className={`px-2 py-0.5 rounded text-xs ${
                  item.type === "conform" ? "bg-green-100 text-green-700" :
                  item.type === "value" ? "bg-blue-100 text-blue-700" :
                  "bg-purple-100 text-purple-700"
                }`}>
                  {item.type === "conform" ? "C/NC/NA" : item.type === "value" ? "Valeur" : "Texte"}
                </span>
              </div>

              {item.type === "conform" && (
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "conform", label: "✓ Conforme", color: "bg-green-600" },
                    { key: "non_conform", label: "✗ Non conforme", color: "bg-red-600" },
                    { key: "na", label: "N/A", color: "bg-gray-600" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => updateResult(idx, "status", opt.key)}
                      className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        results[idx]?.status === opt.key
                          ? `${opt.color} text-white`
                          : "bg-white border hover:bg-gray-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {item.type === "value" && (
                <div className="flex items-center gap-2 bg-white border rounded-lg p-1">
                  <input
                    type="number"
                    value={results[idx]?.value || ""}
                    onChange={(e) => updateResult(idx, "value", e.target.value)}
                    className="border-0 rounded-lg px-3 py-2 w-32 bg-blue-50 text-gray-900 font-medium text-lg focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="0"
                  />
                  {item.unit && (
                    <span className="text-gray-600 font-medium pr-2">{item.unit}</span>
                  )}
                </div>
              )}

              {item.type === "text" && (
                <textarea
                  value={results[idx]?.value || ""}
                  onChange={(e) => updateResult(idx, "value", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 bg-white text-gray-900"
                  rows={2}
                  placeholder="Saisir le texte..."
                />
              )}

              <input
                type="text"
                value={results[idx]?.comment || ""}
                onChange={(e) => updateResult(idx, "comment", e.target.value)}
                className="w-full border rounded-lg px-3 py-2 mt-2 text-sm bg-white text-gray-900"
                placeholder="💬 Commentaire (optionnel)"
              />
            </div>
          ))}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-2">📝 Observations générales</label>
            <textarea
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 bg-white text-gray-900"
              rows={3}
              placeholder="Notes, remarques, actions à prévoir..."
            />
          </div>

          {/* STATUS SUMMARY */}
          <div className={`p-4 rounded-xl text-center ${
            status === "conform" ? "bg-green-100" :
            status === "non_conform" ? "bg-red-100" : "bg-yellow-100"
          }`}>
            <span className="text-3xl">{status === "conform" ? "✅" : status === "non_conform" ? "❌" : "⚠️"}</span>
            <p className={`font-bold mt-2 ${
              status === "conform" ? "text-green-800" :
              status === "non_conform" ? "text-red-800" : "text-yellow-800"
            }`}>
              {status === "conform" ? "Conforme" : status === "non_conform" ? "Non conforme" : "Partiel"}
            </p>
          </div>

          {/* FILE UPLOAD - VISIBLE SECTION */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
            <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
              📎 Pièces jointes
              <span className="text-xs font-normal text-gray-500">(optionnel)</span>
            </h4>

            {/* Upload Buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleFileAdd(e, "photo")}
                className="hidden"
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                multiple
                onChange={(e) => handleFileAdd(e, "document")}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 font-medium transition-all"
              >
                📷 Ajouter photos
              </button>
              <button
                onClick={() => docInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-purple-100 text-purple-700 rounded-xl hover:bg-purple-200 font-medium transition-all"
              >
                📄 Ajouter documents
              </button>
            </div>

            {/* Files Preview - from server */}
            {uploadingFile && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl text-blue-700 mb-3">
                <div className="w-5 h-5 border-2 border-blue-300 rounded-full animate-spin border-t-blue-600" />
                <span className="text-sm font-medium">Upload en cours...</span>
              </div>
            )}
            {serverAttachments.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {serverAttachments.map((att) => (
                  <div key={att.id} className="relative group bg-white rounded-lg p-2 border">
                    {att.file_mime?.startsWith('image/') ? (
                      <img
                        src={api.switchboardControls.draftAttachmentUrl(att.id, true)}
                        alt=""
                        className="w-full h-20 object-cover rounded"
                      />
                    ) : (
                      <div className="w-full h-20 bg-gray-100 rounded flex items-center justify-center">
                        <span className="text-3xl">📄</span>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-1 truncate">{att.file_name}</p>
                    <button
                      onClick={() => removeFile(att.id)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : !uploadingFile ? (
              <div className="text-center py-4 text-gray-400">
                <span className="text-4xl block mb-2">📷</span>
                <p className="text-sm">Ajoutez des photos ou documents</p>
                <p className="text-xs mt-1">Sauvegardées automatiquement sur le serveur</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t bg-gray-50 flex gap-3">
          <button onClick={handleClose} className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium">
            Annuler
          </button>
          <button
            onClick={handleComplete}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "⏳ Enregistrement..." : "✓ Valider le contrôle"}
          </button>
        </div>
      </div>

      {/* NC Resolution Modal */}
      <NCResolutionModal
        isOpen={showNCModal}
        onClose={handleNCModalClose}
        maintenanceId={completedRecordId}
        maintenanceName={template?.name}
        equipmentData={equipmentData}
        ncItems={ncItems}
        site={site}
        userEmail={userEmail}
        userName={userName}
      />
    </div>
  );
}

// ============================================================
// PDF EXPORT MODAL - Export controls with filters
// ============================================================
function PdfExportModal({ filters: currentFilters, filterOptions, records, onClose }) {
  const [exportFilters, setExportFilters] = useState({
    switchboardIds: currentFilters.switchboardIds || [],
    templateIds: currentFilters.templateIds || [],
    buildings: currentFilters.buildings || [],
    status: currentFilters.status || 'all',
    dateFrom: currentFilters.dateFrom || '',
    dateTo: currentFilters.dateTo || '',
    performers: currentFilters.performers || [],
    equipmentType: '', // 'switchboard', 'device', 'vsd', 'meca', 'mobile', 'hv', 'glo', 'datahub', 'infrastructure', or '' for all
    includeDevices: true, // Include device control tables for switchboard reports
  });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const equipmentTypes = [
    { value: '', label: 'Tous les types' },
    { value: 'switchboard', label: 'Tableaux electriques' },
    { value: 'device', label: 'Disjoncteurs' },
    { value: 'vsd', label: 'Variateurs (VSD)' },
    { value: 'meca', label: 'Equipements mecaniques' },
    { value: 'mobile', label: 'Equipements mobiles' },
    { value: 'hv', label: 'Haute tension (HT)' },
    { value: 'glo', label: 'GLO' },
    { value: 'datahub', label: 'DataHub' },
  ];

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const url = api.switchboardControls.reportPdfUrl({
        switchboard_ids: exportFilters.switchboardIds,
        template_ids: exportFilters.templateIds,
        buildings: exportFilters.buildings,
        status: exportFilters.status,
        date_from: exportFilters.dateFrom,
        date_to: exportFilters.dateTo,
        performers: exportFilters.performers,
        equipment_type: exportFilters.equipmentType,
        include_devices: exportFilters.includeDevices,
      });

      // Use fetch to handle errors properly
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur inconnue' }));
        throw new Error(errorData.error || `Erreur ${response.status}`);
      }

      // Download the PDF
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `rapport_controles_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      onClose();
    } catch (e) {
      console.error('PDF export error:', e);
      setError(e.message || 'Erreur lors de la generation du PDF');
    } finally {
      setExporting(false);
    }
  };

  // Preview count based on current filters
  const previewCount = records.length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-emerald-500 to-green-600 text-white p-5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📄</span>
              <div>
                <h2 className="text-xl font-bold">Exporter en PDF</h2>
                <p className="text-sm text-white/80">Generez un rapport de controles</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              <span className="text-2xl">✕</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Quick Stats */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-100 rounded-xl">
                <span className="text-2xl">📊</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{previewCount}</p>
                <p className="text-sm text-gray-500">controles seront inclus (filtres actuels)</p>
              </div>
            </div>
          </div>

          {/* Equipment Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type d'equipement</label>
            <select
              value={exportFilters.equipmentType}
              onChange={(e) => setExportFilters(f => ({ ...f, equipmentType: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl p-3 bg-white text-gray-900 focus:ring-2 focus:ring-emerald-500"
            >
              {equipmentTypes.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          {/* Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Statut</label>
              <select
                value={exportFilters.status}
                onChange={(e) => setExportFilters(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl p-3 bg-white text-gray-900 focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">Tous les statuts</option>
                <option value="conform">Conformes uniquement</option>
                <option value="non_conform">Non conformes uniquement</option>
                <option value="partial">Partiels uniquement</option>
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Periode</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={exportFilters.dateFrom}
                  onChange={(e) => setExportFilters(f => ({ ...f, dateFrom: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-xl p-3 text-sm bg-white text-gray-900"
                  placeholder="Du"
                />
                <input
                  type="date"
                  value={exportFilters.dateTo}
                  onChange={(e) => setExportFilters(f => ({ ...f, dateTo: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-xl p-3 text-sm bg-white text-gray-900"
                  placeholder="Au"
                />
              </div>
            </div>
          </div>

          {/* Switchboard Filter */}
          {filterOptions.switchboards?.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tableaux ({exportFilters.switchboardIds.length > 0 ? `${exportFilters.switchboardIds.length} selectionne(s)` : 'Tous'})
              </label>
              <select
                multiple
                value={exportFilters.switchboardIds.map(String)}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, o => Number(o.value));
                  setExportFilters(f => ({ ...f, switchboardIds: selected }));
                }}
                className="w-full border border-gray-200 rounded-xl p-2 bg-white text-gray-900 h-24"
              >
                {filterOptions.switchboards.map(sb => (
                  <option key={sb.id} value={sb.id}>{sb.code} - {sb.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Ctrl+clic pour multi-selection. Aucune selection = Tous</p>
            </div>
          )}

          {/* Building Filter */}
          {filterOptions.buildings?.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Batiments</label>
              <div className="flex flex-wrap gap-2">
                {filterOptions.buildings.map(b => (
                  <button
                    key={b}
                    onClick={() => {
                      setExportFilters(f => ({
                        ...f,
                        buildings: f.buildings.includes(b)
                          ? f.buildings.filter(x => x !== b)
                          : [...f.buildings, b]
                      }));
                    }}
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      exportFilters.buildings.includes(b)
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Include Devices Option */}
          <div className="bg-blue-50 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={exportFilters.includeDevices}
                onChange={(e) => setExportFilters(f => ({ ...f, includeDevices: e.target.checked }))}
                className="mt-1 w-5 h-5 text-emerald-500 rounded focus:ring-emerald-500"
              />
              <div>
                <p className="font-medium text-gray-900">Inclure les controles des disjoncteurs</p>
                <p className="text-sm text-gray-500">
                  Pour chaque tableau, affiche un tableau detaille avec les controles de chaque disjoncteur
                </p>
              </div>
            </label>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
              <span className="text-2xl">❌</span>
              <div>
                <p className="font-medium text-red-800">Erreur</p>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 p-4 border-t rounded-b-2xl flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-200 rounded-xl hover:bg-gray-300 font-medium transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
          >
            {exporting ? (
              <>
                <span className="animate-spin">⏳</span>
                Generation en cours...
              </>
            ) : (
              <>
                📄 Telecharger le PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
