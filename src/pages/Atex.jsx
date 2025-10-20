// Atex.jsx — PARTIE 1/2
// Helpers + UI components (réutilisables)
// La page principale (onglets Controls/Assessment/Import + modales) arrive en PARTIE 2/2.

import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';
import * as XLSX from 'xlsx';
import '../styles/atex-map.css';

/* -------------------------------------------------------
   Constantes
------------------------------------------------------- */

// Garder en phase avec SignUp si tu ajoutes des sites
export const SITE_OPTIONS = ['Nyon', 'Levice', 'Aprilia'];

export const GAS_ZONES = ['0', '1', '2'];
export const DUST_ZONES = ['20', '21', '22'];

// Backend stocke FR, UI affiche EN (comme avant)
export const STATUS_MAP_DISPLAY = {
  'Conforme': 'Compliant',
  'Non conforme': 'Non-compliant',
  'À vérifier': 'To review'
};

export const STATUS_OPTIONS_UI = ['Compliant', 'Non-compliant', 'To review'];
export const STATUS_MAP_TO_FR = {
  'Compliant': 'Conforme',
  'Non-compliant': 'Non conforme',
  'To review': 'À vérifier'
};

/* -------------------------------------------------------
   Utils
------------------------------------------------------- */

export function classNames(...a) {
  return a.filter(Boolean).join(' ');
}

export function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toISOString().slice(0, 10);
}

export function daysUntil(d) {
  if (!d) return null;
  const target = new Date(d);
  const now = new Date();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function useOutsideClose(ref, onClose) {
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

export function useDebouncedValue(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* -------------------------------------------------------
   Petits composants UI
------------------------------------------------------- */

export function Tag({ children, tone = 'default', className = '' }) {
  const toneClass = {
    default: 'bg-gray-100 text-gray-800',
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800'
  }[tone] || 'bg-gray-100 text-gray-800';
  return (
    <span className={classNames('px-2 py-0.5 rounded text-xs font-medium', toneClass, className)}>
      {children}
    </span>
  );
}

export function Spinner({ className = '' }) {
  return (
    <svg className={classNames('animate-spin h-5 w-5 text-blue-600', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V1.5C5.648 1.5 1.5 5.648 1.5 12H4z" />
    </svg>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors';
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-600 px-4 py-2',
    ghost: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-2',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-600 px-4 py-2'
  }[variant];
  return (
    <button className={classNames(base, styles, className)} {...props}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------
   Filtres compacts (MultiSelect / Segmented)
------------------------------------------------------- */

export function MultiSelect({ label, values, setValues, options }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);
  useOutsideClose(wrapRef, () => setOpen(false));

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? options.filter(o => String(o).toLowerCase().includes(s)) : options;
  }, [options, search]);

  function toggle(v) {
    setValues(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }
  function clearAll() {
    setValues([]);
    setSearch('');
  }
  const labelText = values.length ? `${label} · ${values.length}` : label;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm flex items-center gap-2 hover:border-gray-400"
        title={label}
      >
        <span className="truncate max-w-[10rem]">{labelText}</span>
        <svg className="w-4 h-4 opacity-60" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-3 sm:w-64">
          <div className="flex items-center gap-2">
            <input
              className="input h-9 flex-1"
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="text-xs text-gray-600 hover:text-gray-900" onClick={clearAll} type="button">
              Clear
            </button>
          </div>
          <div className="max-h-56 overflow-auto mt-2 pr-1">
            {filtered.length ? (
              filtered.map(v => (
                <label key={v} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={values.includes(v)} onChange={() => toggle(v)} />
                  <span className="text-sm truncate">{v}</span>
                </label>
              ))
            ) : (
              <div className="text-sm text-gray-500 py-2 px-1">No results</div>
            )}
          </div>
          {!!values.length && (
            <div className="flex flex-wrap gap-1 mt-2">
              {values.map(v => (
                <span key={v} className="px-2 py-0.5 rounded bg-gray-100 text-xs">
                  {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Segmented({ label, values, setValues, options }) {
  function toggle(v) {
    setValues(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex rounded-md border border-gray-300 overflow-hidden">
        {options.map(v => (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            className={classNames(
              'px-2.5 h-8 text-sm border-r last:border-r-0',
              values.includes(v) ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Barre de filtres (compose MultiSelect + Segmented)
------------------------------------------------------- */

export function FilterBar({
  q, setQ,
  fBuilding, setFBuilding,
  fRoom, setFRoom,
  fType, setFType,
  fManufacturer, setFManufacturer,
  fStatus, setFStatus,
  fGas, setFGas,
  fDust, setFDust,
  uniques,
  onSearch, onReset
}) {
  return (
    <div className="card p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-72">
            <input
              className="h-9 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm"
              placeholder="Search text (building, room, ref...)"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <svg className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z" />
            </svg>
          </div>
          <Button variant="primary" className="h-9 w-full sm:w-auto" onClick={onSearch}>
            Search
          </Button>
          <Button variant="ghost" className="h-9 w-full sm:w-auto" onClick={onReset} type="button">
            Reset
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <MultiSelect label="Building" values={fBuilding} setValues={setFBuilding} options={uniques.buildings} />
          <MultiSelect label="Room" values={fRoom} setValues={setFRoom} options={uniques.rooms} />
          <MultiSelect label="Type" values={fType} setValues={setFType} options={uniques.types} />
          <MultiSelect label="Manufacturer" values={fManufacturer} setValues={setFManufacturer} options={uniques.manufacturers} />
          {/* UI en EN → convertira plus tard en FR côté requêtes si besoin */}
          <MultiSelect label="Status" values={fStatus} setValues={setFStatus} options={STATUS_OPTIONS_UI} />
          <Segmented label="Gas" values={fGas} setValues={setFGas} options={GAS_ZONES} />
          <Segmented label="Dust" values={fDust} setValues={setFDust} options={DUST_ZONES} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Charts simples (SVG)
------------------------------------------------------- */

export function SimpleBarChart({ data, title, yLabel = 'Count' }) {
  const maxValue = Math.max(...data.map(d => Number(d.value) || 0), 1);

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full"
                style={{ width: `${(Number(item.value) / maxValue) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-700 w-12">{item.value}</span>
            <span className="text-sm text-gray-600 min-w-0 truncate">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2">{yLabel}</p>
    </div>
  );
}

export function DoughnutChart({ data, title }) {
  const total = Math.max(0, data.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  const centerRadius = 60;
  const colors = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];

  const cumulativeAngles = data.reduce((acc, item, i) => {
    const startAngle = acc[i - 1]?.endAngle || 0;
    const endAngle = total === 0 ? startAngle : startAngle + (Number(item.value) / total) * 2 * Math.PI;
    acc[i] = { startAngle, endAngle, ...item };
    return acc;
  }, []);

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="relative flex justify-center">
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={centerRadius} fill="white" stroke="white" strokeWidth="2" />
          {cumulativeAngles.map((segment, i) => {
            const x1 = 100 + centerRadius * Math.cos(segment.startAngle - Math.PI / 2);
            const y1 = 100 + centerRadius * Math.sin(segment.startAngle - Math.PI / 2);
            const x2 = 100 + centerRadius * Math.cos(segment.endAngle - Math.PI / 2);
            const y2 = 100 + centerRadius * Math.sin(segment.endAngle - Math.PI / 2);
            const largeArc = segment.endAngle - segment.startAngle > Math.PI ? 1 : 0;

            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A ${centerRadius} ${centerRadius} 0 ${largeArc} 1 ${x2} ${y2} L 100 100 Z`}
                fill={colors[i % colors.length]}
                stroke="white"
                strokeWidth="1"
              />
            );
          })}
          <text x="100" y="95" textAnchor="middle" className="font-bold text-lg" fill="#374151">
            {total}
          </text>
          <text x="100" y="115" textAnchor="middle" className="text-xs" fill="#6B7280">
            Total
          </text>
        </svg>
      </div>
      <div className="mt-4 space-y-1">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="text-sm">
              {item.label}: {item.value} {total ? `(${Math.round((Number(item.value) / total) * 100)}%)` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Helpers statut
------------------------------------------------------- */

export function getStatusColor(status) {
  return {
    'Conforme': 'bg-green-100 text-green-800',
    'Non conforme': 'bg-red-100 text-red-800',
    'À vérifier': 'bg-yellow-100 text-yellow-800'
  }[status] || 'bg-gray-100 text-gray-800';
}

export function getStatusDisplay(status) {
  return STATUS_MAP_DISPLAY[status] || status;
}

/* -------------------------------------------------------
   Toast simple
------------------------------------------------------- */

export function useToast() {
  const [toast, setToast] = useState(null);
  const notify = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };
  return { toast, notify, ToastEl: () =>
    toast ? (
      <div
        className={classNames(
          'fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm text-white',
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        )}
      >
        {toast.msg}
      </div>
    ) : null
  };
}

/* -------------------------------------------------------
   Pagination compacte
------------------------------------------------------- */

export function Pager({ page, setPage, pageSize, total }) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="px-4 py-3 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="text-sm text-gray-500">
        Showing {total ? from : 0} to {to} of {total} entries
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="px-3 py-1"
          disabled={page === 1}
          onClick={() => setPage(p => p - 1)}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          className="px-3 py-1"
          disabled={page * pageSize >= total}
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function Atex() {
  // Onglets
  const [tab, setTab] = useState('controls');

  // Liste & filtres
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [fBuilding, setFBuilding] = useState([]);
  const [fRoom, setFRoom] = useState([]);
  const [fType, setFType] = useState([]);
  const [fManufacturer, setFManufacturer] = useState([]);
  const [fStatus, setFStatus] = useState([]); // UI (EN), converti vers FR côté API
  const [fGas, setFGas] = useState([]);
  const [fDust, setFDust] = useState([]);

  const [sort, setSort] = useState({ by: 'id', dir: 'desc' });

  // Pagination locale (API renvoie toute la page, total approximé)
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [total, setTotal] = useState(0);

  // Uniques (suggests)
  const [uniques, setUniques] = useState({
    buildings: [],
    rooms: [],
    types: [],
    manufacturers: [],
    refs: [],
    atex_refs: []
  });

  // Analytics
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // État modales
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);

  // Pièces jointes (modale Attach + modale Edit)
  const [attachments, setAttachments] = useState([]);
  const [modalAttachments, setModalAttachments] = useState([]);

  // UI
  const [showFilters, setShowFilters] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const { toast, notify, ToastEl } = useToast();

  // ------ Chargements ------
  async function loadSuggests() {
    try {
      const data = await get(`${API_BASE}/api/atex/suggests`);
      setUniques({
        buildings: data.building || [],
        rooms: data.room || [],
        types: data.component_type || [],
        manufacturers: data.manufacturer || [],
        refs: data.manufacturer_ref || [],
        atex_refs: data.atex_ref || []
      });
    } catch (e) {
      console.error('Load suggests failed:', e);
    }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const data = await get(`${API_BASE}/api/atex/analytics`);
      setAnalytics(data);
    } catch (e) {
      console.error('Load analytics failed:', e);
      notify('Failed to load analytics', 'error');
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      // Convertit le filtre Status (UI EN) -> FR attendu par l’API
      const statusFr = fStatus.map(s => STATUS_MAP_TO_FR[s] || s);

      const params = new URLSearchParams({
        q,
        building: fBuilding,
        room: fRoom,
        component_type: fType,
        manufacturer: fManufacturer,
        status: statusFr,
        zone_gas: fGas,
        zone_dust: fDust,
        sort: sort.by,
        dir: sort.dir,
        page,
        pageSize
      }).toString();

      const data = await get(`${API_BASE}/api/atex/equipments?${params}`);
      setRows(data || []);
      setTotal(data?.length || 0); // si besoin, ajuster si l’API renvoie un total séparé
    } catch (e) {
      console.error('Load data failed:', e);
      notify('Failed to load equipment data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadAttachments(id) {
    try {
      const data = await get(`${API_BASE}/api/atex/equipments/${id}/attachments`);
      setAttachments(data || []);
      if (editItem && editItem.id === id) {
        setModalAttachments(data.map(a => ({ ...a, file: null })) || []);
      }
    } catch (e) {
      console.error('Load attachments failed:', e);
      notify('Failed to load attachments', 'error');
    }
  }

  // ------ CRUD ------
  async function saveItem() {
    setLoading(true);
    try {
      const payload = {
        ...editItem,
        zone_gas: editItem.zone_gas === '' ? null : editItem.zone_gas,
        zone_dust: editItem.zone_dust === '' ? null : editItem.zone_dust
      };
      let equipmentId = editItem.id;
      if (editItem.id) {
        await put(`${API_BASE}/api/atex/equipments/${editItem.id}`, payload);
        notify('Equipment updated successfully', 'success');
      } else {
        const response = await post(`${API_BASE}/api/atex/equipments`, payload);
        equipmentId = response.id;
        notify('Equipment created successfully', 'success');
      }

      if (modalAttachments.length > 0) {
        const formData = new FormData();
        modalAttachments.forEach(a => {
          if (a.file) formData.append('files', a.file);
        });
        if ([...formData.keys()].length) {
          await upload(`${API_BASE}/api/atex/equipments/${equipmentId}/attachments`, formData);
        }
      }

      setEditItem(null);
      setModalAttachments([]);
      await loadData();
    } catch (e) {
      console.error('Save failed:', e);
      notify(`Failed to save equipment: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(id) {
    setLoading(true);
    try {
      await del(`${API_BASE}/api/atex/equipments/${id}`);
      notify('Equipment deleted successfully', 'success');
      setShowDelete(null);
      await loadData();
    } catch (e) {
      console.error('Delete failed:', e);
      notify('Failed to delete equipment', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ------ Pièces jointes ------
  async function uploadAttachmentsAction(id, files) {
    setLoading(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      await upload(`${API_BASE}/api/atex/equipments/${id}/attachments`, formData);
      notify('Attachments uploaded successfully', 'success');
      await loadAttachments(id);
    } catch (e) {
      console.error('Upload attachments failed:', e);
      notify('Failed to upload attachments', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteAttachment(id, attId) {
    setLoading(true);
    try {
      await del(`${API_BASE}/api/atex/attachments/${attId}`);
      notify('Attachment deleted successfully', 'success');
      await loadAttachments(id);
      if (editItem && editItem.id === id) {
        setModalAttachments(prev => prev.filter(x => x.id !== attId));
      }
    } catch (e) {
      console.error('Delete attachment failed:', e);
      notify('Failed to delete attachment', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ------ Import / Export ------
  async function exportToExcel() {
    try {
      const { data } = await get(`${API_BASE}/api/atex/export`);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ATEX Equipment');
      XLSX.writeFile(wb, 'atex_equipment.xlsx'); // writeFile côté navigateur
    } catch (e) {
      console.error('Export failed:', e);
      notify('Failed to export data', 'error');
    }
  }

  async function importFromExcel(e) {
    setLoading(true);
    try {
      const file = e.target.files[0];
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws);

      for (const row of json) {
        await post(`${API_BASE}/api/atex/equipments`, {
          site: row.site || null,
          building: row.building || '',
          room: row.room || '',
          component_type: row.component_type || '',
          manufacturer: row.manufacturer || null,
          manufacturer_ref: row.manufacturer_ref || null,
          atex_ref: row.atex_ref || null,
          zone_gas: row.zone_gas ? Number(row.zone_gas) : null,
          zone_dust: row.zone_dust ? Number(row.zone_dust) : null,
          last_control: row.last_control || null,
          next_control: row.next_control || null,
          comments: row.comments || null,
          frequency_months: row.frequency_months ? Number(row.frequency_months) : 36
        });
      }

      notify('Data imported successfully', 'success');
      await loadData();
    } catch (e) {
      console.error('Import failed:', e);
      notify('Failed to import data', 'error');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  // ------ UI helpers ------
  function onEdit(row) {
    setEditItem({
      id: row.id,
      site: row.site || '',
      building: row.building || '',
      room: row.room || '',
      component_type: row.component_type || '',
      manufacturer: row.manufacturer || '',
      manufacturer_ref: row.manufacturer_ref || '',
      atex_ref: row.atex_ref || '',
      zone_gas: row.zone_gas ?? '',
      zone_dust: row.zone_dust ?? '',
      last_control: row.last_control ? row.last_control.split('T')[0] : '',
      next_control: row.next_control ? row.next_control.split('T')[0] : '',
      comments: row.comments || '',
      frequency_months: row.frequency_months || 36
    });
    loadAttachments(row.id);
  }

  function onReset() {
    setQ('');
    setFBuilding([]);
    setFRoom([]);
    setFType([]);
    setFManufacturer([]);
    setFStatus([]);
    setFGas([]);
    setFDust([]);
    setPage(1);
    setSort({ by: 'id', dir: 'desc' });
  }

  // Mount + refresh à chaque changement de filtres/tri/page
  useEffect(() => {
    loadData();
    loadSuggests();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fBuilding, fRoom, fType, fManufacturer, fStatus, fGas, fDust, sort.by, sort.dir, page]);

  return (
    <section className="p-4 sm:p-6 space-y-6 max-w-full">
      {/* Header + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {['controls', 'assessment', 'import'].map(k => (
            <button
              key={k}
              className={classNames(
                'px-4 py-2 text-sm font-medium rounded-lg',
                tab === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
              onClick={() => setTab(k)}
            >
              {k === 'controls' ? 'Controls' : k === 'assessment' ? 'Assessment' : 'Import/Export'}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          className="flex items-center gap-2 w-full sm:w-auto"
          onClick={() =>
            setEditItem({
              id: null,
              site: '',
              building: '',
              room: '',
              component_type: '',
              manufacturer: '',
              manufacturer_ref: '',
              atex_ref: '',
              zone_gas: '',
              zone_dust: '',
              last_control: '',
              next_control: '',
              comments: '',
              frequency_months: 36
            })
          }
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Equipment
        </Button>
      </div>

      {/* Onglet Controls */}
      {tab === 'controls' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-2xl font-semibold">ATEX Equipment Controls</h2>
            <button
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? 'Hide Filters' : 'Show Filters'}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={showFilters ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
                />
              </svg>
            </button>
          </div>

          {showFilters && (
            <FilterBar
              q={q}
              setQ={setQ}
              fBuilding={fBuilding}
              setFBuilding={setFBuilding}
              fRoom={fRoom}
              setFRoom={setFRoom}
              fType={fType}
              setFType={setFType}
              fManufacturer={fManufacturer}
              setFManufacturer={setFManufacturer}
              fStatus={fStatus}
              setFStatus={setFStatus}
              fGas={fGas}
              setFGas={setFGas}
              fDust={fDust}
              setFDust={setFDust}
              uniques={uniques}
              onSearch={loadData}
              onReset={onReset}
            />
          )}

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th label="ID" sortKey="id" sort={sort} setSort={setSort} />
                  <Th label="Equipment" sortKey="component_type" sort={sort} setSort={setSort} />
                  <Th label="Location" sortKey="building" sort={sort} setSort={setSort} />
                  <Th label="Manufacturer" sortKey="manufacturer" sort={sort} setSort={setSort} />
                  <Th label="ATEX" sortKey="atex_ref" sort={sort} setSort={setSort} />
                  <th className="px-4 py-2 text-left font-medium">Zones</th>
                  <Th label="Status" sortKey="status" sort={sort} setSort={setSort} />
                  <Th label="Next Inspection" sortKey="next_control" sort={sort} setSort={setSort} />
                  <th className="px-4 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">
                      No equipment found
                    </td>
                  </tr>
                ) : (
                  rows.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2 font-mono text-sm">#{r.id}</td>
                      <td className="px-4 py-2">{r.component_type}</td>
                      <td className="px-4 py-2">
                        <div>{r.building}</div>
                        <div className="text-xs text-gray-500">Room {r.room}</div>
                      </td>
                      <td className="px-4 py-2">
                        {r.manufacturer || '—'}
                        {r.manufacturer_ref && (
                          <div className="text-xs text-gray-500">{r.manufacturer_ref}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.atex_ref || '—'}</td>
                      <td className="px-4 py-2">
                        <div className="text-xs">Gas: {r.zone_gas ?? '—'}</div>
                        <div className="text-xs">Dust: {r.zone_dust ?? '—'}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={classNames('px-2 py-1 rounded text-xs', getStatusColor(r.status))}>
                          {getStatusDisplay(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2">{formatDate(r.next_control)}</td>
                      <td className="px-4 py-2 flex gap-2 flex-wrap">
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          onClick={() => onEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                          onClick={() => setShowDelete(r.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          onClick={() => {
                            setShowAttach(r.id);
                            loadAttachments(r.id);
                          }}
                        >
                          Attach
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <Pager page={page} setPage={setPage} pageSize={pageSize} total={total} />
          </div>

          {/* Modale Delete */}
          {showDelete && (
            <Modal onClose={() => setShowDelete(null)} title="Confirm Delete">
              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete equipment #{showDelete}?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowDelete(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => deleteItem(showDelete)}>
                  Delete
                </Button>
              </div>
            </Modal>
          )}

          {/* Modale Attach */}
          {showAttach && (
            <Modal onClose={() => setShowAttach(null)} title={`Attachments for #${showAttach}`}>
              <input
                type="file"
                multiple
                className="input mb-4 w-full"
                onChange={e => uploadAttachmentsAction(showAttach, Array.from(e.target.files))}
              />
              {attachments.length === 0 ? (
                <p className="text-sm text-gray-500">No attachments</p>
              ) : (
                <ul className="space-y-2">
                  {attachments.map(a => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <a
                        href={`${API_BASE}/api/atex/attachments/${a.id}/download`}
                        className="text-blue-600 hover:text-blue-800 truncate"
                      >
                        {a.filename}
                      </a>
                      <button
                        className="text-red-600 hover:text-red-800"
                        onClick={() => deleteAttachment(showAttach, a.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Modal>
          )}
        </div>
      )}

      {/* Onglet Import/Export */}
      {tab === 'import' && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Import/Export Data</h2>
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">Excel Template Instructions</h3>
              <p className="text-gray-700 mb-4">
                Use the following column order in your Excel file (first row headers):
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left border">Column</th>
                      <th className="px-4 py-2 text-left border">Example</th>
                      <th className="px-4 py-2 text-left border">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['site', 'Nyon', 'No'],
                      ['building', '20', 'Yes'],
                      ['room', '112', 'Yes'],
                      ['component_type', 'Compressor', 'Yes'],
                      ['manufacturer', 'Schneider', 'No'],
                      ['manufacturer_ref', '218143RT', 'No'],
                      ['atex_ref', 'II 2G Ex ib IIC T4 Gb', 'No'],
                      ['zone_gas', '2', 'No'],
                      ['zone_dust', '21', 'No'],
                      ['comments', 'Installed 2023', 'No'],
                      ['last_control', '2025-09-19', 'No'],
                      ['frequency_months', '36', 'No'],
                      ['next_control', '2028-09-19', 'No']
                    ].map(([c, ex, req]) => (
                      <tr key={c}>
                        <td className="px-4 py-2 border">{c}</td>
                        <td className="px-4 py-2 border">{ex}</td>
                        <td className="px-4 py-2 border">{req}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Dates in YYYY-MM-DD format. Numbers for zones (0,1,2 for gas; 20,21,22 for dust).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button variant="primary" className="w-full" onClick={exportToExcel}>
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Current Equipment Data
              </Button>
              <div>
                <label className="block text-sm font-medium mb-1">Import Equipment Data</label>
                <input className="input w-full" type="file" accept=".xlsx,.xls" onChange={importFromExcel} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onglet Assessment */}
      {tab === 'assessment' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-2xl font-semibold">Assessment & Analytics</h2>
            <div className="text-sm text-gray-500">
              Updated: {analytics?.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : 'Loading...'}
            </div>
          </div>

          {analyticsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white p-4 rounded-lg shadow animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                </div>
              ))}
            </div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KpiCard title="Total Equipment" value={analytics.stats.total} tone="blue" />
                <KpiCard
                  title="Compliant"
                  value={analytics.stats.compliant}
                  tone="green"
                  sub={`${Math.round((analytics.stats.compliant / Math.max(1, analytics.stats.total)) * 100)}% compliance rate`}
                />
                <KpiCard title="Overdue Inspections" value={analytics.stats.overdue} tone="red" sub="Immediate action required" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DoughnutChart
                  data={[
                    { label: 'Compliant', value: Number(analytics.stats.compliant || 0) },
                    { label: 'Non-compliant', value: Number(analytics.stats.non_compliant || 0) },
                    { label: 'To review', value: Number(analytics.stats.to_review || 0) }
                  ]}
                  title="Compliance Status Distribution"
                />
                <SimpleBarChart
                  data={(analytics.byType || []).map(item => ({
                    label: (item.component_type || '').slice(0, 20) + ((item.component_type || '').length > 20 ? '...' : ''),
                    value: parseInt(item.count, 10) || 0
                  }))}
                  title="Top Equipment Types"
                />
                <SimpleBarChart
                  data={[
                    { label: 'Overdue', value: Number(analytics.stats.overdue || 0) },
                    { label: 'Due 90 days', value: Number(analytics.stats.due_90_days || 0) },
                    { label: 'Future', value: Number(analytics.stats.future || 0) }
                  ]}
                  title="Inspection Timeline"
                />
                <SimpleBarChart
                  data={(analytics.complianceByZone || []).map(item => ({
                    label: `Zone ${item.zone}`,
                    value: parseInt(item.compliant, 10) || 0
                  }))}
                  title="Compliant Equipment by Gas Zone"
                  yLabel="Compliant Count"
                />
              </div>

              {(analytics.riskEquipment || []).length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <div className="px-6 py-4 border-b bg-gray-50">
                    <h3 className="text-lg font-medium">
                      High Priority Equipment ({analytics.riskEquipment.length})
                    </h3>
                    <p className="text-sm text-gray-600">Overdue inspections and due within next 90 days</p>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">ID</th>
                        <th className="px-4 py-2 text-left font-medium">Equipment</th>
                        <th className="px-4 py-2 text-left font-medium">Location</th>
                        <th className="px-4 py-2 text-left font-medium">Zones</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-left font-medium">Next Inspection</th>
                        <th className="px-4 py-2 text-left font-medium">Days</th>
                        <th className="px-4 py-2 text-left font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.riskEquipment.map(r => {
                        const dleft = daysUntil(r.next_control);
                        const risk = dleft < 0 ? 'High' : 'Medium';
                        const riskColor = risk === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-4 py-2 font-mono text-sm">#{r.id}</td>
                            <td className="px-4 py-2">{r.component_type}</td>
                            <td className="px-4 py-2">
                              <div>{r.building}</div>
                              <div className="text-xs text-gray-500">Room {r.room}</div>
                            </td>
                            <td className="px-4 py-2">
                              <div className="text-xs">Gas: {r.zone_gas ?? '—'}</div>
                              <div className="text-xs">Dust: {r.zone_dust ?? '—'}</div>
                            </td>
                            <td className="px-4 py-2">
                              <span className={classNames('px-2 py-1 rounded text-xs', getStatusColor(r.status))}>
                                {getStatusDisplay(r.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2">{formatDate(r.next_control)}</td>
                            <td className="px-4 py-2">
                              <span className={classNames('px-2 py-1 rounded text-xs', riskColor)}>
                                {dleft < 0 ? `${Math.abs(dleft)} days late` : `${dleft} days`}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <button
                                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                onClick={() => setTab('controls')}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">Loading analytics...</div>
          )}
        </div>
      )}

      {/* Modale Edit/New */}
      {editItem && (
        <Modal
          onClose={() => {
            setEditItem(null);
            setModalAttachments([]);
          }}
          title={editItem.id ? 'Edit Equipment' : 'New Equipment'}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Site</label>
              <select
                className="input w-full bg-white text-gray-900 border-gray-300 focus:ring-blue-500"
                value={editItem.site || ''}
                onChange={e => setEditItem({ ...editItem, site: e.target.value })}
              >
                <option value="">Select site</option>
                {SITE_OPTIONS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <Field label="Building">
              <input
                className="input w-full"
                value={editItem.building || ''}
                onChange={e => setEditItem({ ...editItem, building: e.target.value })}
              />
            </Field>

            <Field label="Room">
              <input
                className="input w-full"
                value={editItem.room || ''}
                onChange={e => setEditItem({ ...editItem, room: e.target.value })}
              />
            </Field>

            <Field label="Component Type">
              <input
                className="input w-full"
                value={editItem.component_type || ''}
                onChange={e => setEditItem({ ...editItem, component_type: e.target.value })}
              />
            </Field>

            <Field label="Manufacturer">
              <input
                className="input w-full"
                value={editItem.manufacturer || ''}
                onChange={e => setEditItem({ ...editItem, manufacturer: e.target.value })}
              />
            </Field>

            <Field label="Manufacturer Ref">
              <input
                className="input w-full"
                value={editItem.manufacturer_ref || ''}
                onChange={e => setEditItem({ ...editItem, manufacturer_ref: e.target.value })}
              />
            </Field>

            <Field label="ATEX Marking" cols={2}>
              <input
                className="input w-full"
                value={editItem.atex_ref || ''}
                onChange={e => setEditItem({ ...editItem, atex_ref: e.target.value })}
              />
            </Field>

            <Field label="Gas Zone">
              <select
                className="input w-full"
                value={editItem.zone_gas ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_gas: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {GAS_ZONES.map(z => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Dust Zone">
              <select
                className="input w-full"
                value={editItem.zone_dust ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_dust: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {DUST_ZONES.map(z => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Last Inspection">
              <input
                type="date"
                className="input w-full"
                value={editItem.last_control || ''}
                onChange={e => setEditItem({ ...editItem, last_control: e.target.value || null })}
              />
            </Field>

            <Field label="Next Inspection">
              <input
                type="date"
                className="input w-full"
                value={editItem.next_control || ''}
                onChange={e => setEditItem({ ...editItem, next_control: e.target.value || null })}
              />
            </Field>

            <Field label="Frequency (months)">
              <input
                type="number"
                className="input w-full"
                value={editItem.frequency_months || ''}
                onChange={e =>
                  setEditItem({ ...editItem, frequency_months: e.target.value ? Number(e.target.value) : null })
                }
              />
            </Field>

            {/* Bloc Analyse photo + pièces jointes */}
            <div className="col-span-1 sm:col-span-2 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <label className="block text-sm font-medium mb-2">Upload Photo for Auto-Fill</label>
              <p className="text-xs text-gray-500 mb-2">
                Upload a clear photo of the equipment label to automatically fill Manufacturer, Mfr Ref, and
                ATEX Marking.
              </p>
              <input
                type="file"
                accept="image/*"
                className="input text-sm w-full bg-white text-gray-900 border-gray-300"
                disabled={photoLoading}
                onChange={async e => {
                  const file = e.target.files[0];
                  if (!file) return;

                  setPhotoLoading(true);
                  const formData = new FormData();
                  formData.append('photo', file);

                  try {
                    const analysis = await upload(`${API_BASE}/api/atex/photo-analysis`, formData);
                    setEditItem(prev => ({
                      ...prev,
                      manufacturer: analysis.manufacturer || prev.manufacturer,
                      manufacturer_ref: analysis.manufacturer_ref || prev.manufacturer_ref,
                      atex_ref: analysis.atex_ref || prev.atex_ref
                    }));
                    notify('Photo analyzed successfully! Fields updated.', 'success');
                  } catch (err) {
                    console.error('Photo analysis failed:', err);
                    notify('Failed to analyze photo. Try a clearer image.', 'error');
                  } finally {
                    setPhotoLoading(false);
                    e.target.value = '';
                  }
                }}
              />
              {photoLoading && (
                <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                  <Spinner className="h-4 w-4" /> Analyzing photo...
                </div>
              )}
            </div>

            <div className="col-span-1 sm:col-span-2 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <label className="block text-sm font-medium mb-2">Attachments</label>
              <p className="text-xs text-gray-500 mb-2">Upload files to attach to this equipment.</p>
              <input
                type="file"
                multiple
                className="input text-sm w-full bg-white text-gray-900 border-gray-300"
                disabled={loading}
                onChange={e => {
                  const files = Array.from(e.target.files);
                  if (files.length === 0) return;
                  setModalAttachments(prev => [
                    ...prev,
                    ...files.map(f => ({ file: f, filename: f.name, id: `temp-${Math.random().toString(36).slice(2)}` }))
                  ]);
                  e.target.value = '';
                }}
              />
              {modalAttachments.length === 0 ? (
                <p className="text-sm text-gray-500 mt-2">No attachments</p>
              ) : (
                <ul className="space-y-2 mt-2">
                  {modalAttachments.map(a => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-blue-600 truncate">{a.filename}</span>
                      <button
                        className="text-red-600 hover:text-red-800"
                        onClick={() => setModalAttachments(prev => prev.filter(x => x.id !== a.id))}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Field label="Comments" cols={2}>
              <textarea
                className="input w-full min-h-[100px]"
                value={editItem.comments || ''}
                onChange={e => setEditItem({ ...editItem, comments: e.target.value || null })}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button
              variant="ghost"
              onClick={() => {
                setEditItem(null);
                setModalAttachments([]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={loading || !editItem.building || !editItem.room || !editItem.component_type}
              onClick={saveItem}
            >
              {loading ? 'Saving...' : editItem.id ? 'Update' : 'Create'}
            </Button>
          </div>
        </Modal>
      )}

      <ToastEl />
    </section>
  );
}

/* ------------------------------------------
   Sous-composants locaux (PARTIE 2/2)
------------------------------------------- */

function Th({ label, sortKey, sort, setSort }) {
  const active = sort.by === sortKey;
  const dirIcon =
    active && sort.dir === 'asc'
      ? 'M5 15l7-7 7 7'
      : active && sort.dir === 'desc'
      ? 'M19 9l-7 7-7-7'
      : null;

  return (
    <th className="px-4 py-2 text-left font-medium">
      <button
        className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"
        onClick={() => {
          if (active) {
            setSort({ by: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
          } else {
            setSort({ by: sortKey, dir: 'asc' });
          }
        }}
      >
        {label}
        {dirIcon && (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={dirIcon} />
          </svg>
        )}
      </button>
    </th>
  );
}

function Modal({ children, onClose, title, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={classNames(
          'bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto',
          wide ? 'max-w-4xl sm:max-w-2xl' : 'max-w-md'
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button className="p-1 rounded-lg hover:bg-gray-200" onClick={onClose}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, tone = 'blue', sub }) {
  const border = {
    blue: 'border-blue-500',
    green: 'border-green-500',
    red: 'border-red-500'
  }[tone];
  const text = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600'
  }[tone];
  return (
    <div className={classNames('bg-white p-6 rounded-lg shadow border-l-4', border)}>
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className={classNames('text-3xl font-bold mt-1', text)}>{value}</p>
      {sub && <p className="text-sm text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function Field({ label, children, cols = 1 }) {
  return (
    <div className={cols === 2 ? 'col-span-1 sm:col-span-2' : ''}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

// Atex.jsx — PARTIE 2/2
// Écran principal + tables + Analytics + Import/Export
// INCLUS: panneau Plans & Positions (même page, comme Doors.jsx)

import React, { useEffect, useState } from 'react';
import {
  SITE_OPTIONS, GAS_ZONES, DUST_ZONES,
  STATUS_OPTIONS_UI, STATUS_MAP_TO_FR,
  classNames, formatDate, daysUntil,
  getStatusColor, getStatusDisplay,
  useToast, Button, Pager,
  FilterBar, SimpleBarChart, DoughnutChart,
  PlanList, PlanCanvas, ZoneForm
} from './Atex.jsx';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';
import * as XLSX from 'xlsx';

/* ------------------------------------------
   Sous-composants locaux
------------------------------------------- */

function Th({ label, sortKey, sort, setSort }) {
  const active = sort.by === sortKey;
  const dirIcon =
    active && sort.dir === 'asc'
      ? 'M5 15l7-7 7 7'
      : active && sort.dir === 'desc'
      ? 'M19 9l-7 7-7-7'
      : null;

  return (
    <th className="px-4 py-2 text-left font-medium">
      <button
        className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900"
        onClick={() => {
          if (active) {
            setSort({ by: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
          } else {
            setSort({ by: sortKey, dir: 'asc' });
          }
        }}
      >
        {label}
        {dirIcon && (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={dirIcon} />
          </svg>
        )}
      </button>
    </th>
  );
}

function Modal({ children, onClose, title, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={classNames(
          'bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto',
          wide ? 'max-w-4xl sm:max-w-2xl' : 'max-w-md'
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button className="p-1 rounded-lg hover:bg-gray-200" onClick={onClose}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, tone = 'blue', sub }) {
  const border = {
    blue: 'border-blue-500',
    green: 'border-green-500',
    red: 'border-red-500'
  }[tone];
  const text = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600'
  }[tone];
  return (
    <div className={classNames('bg-white p-6 rounded-lg shadow border-l-4', border)}>
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className={classNames('text-3xl font-bold mt-1', text)}>{value}</p>
      {sub && <p className="text-sm text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function Field({ label, children, cols = 1 }) {
  return (
    <div className={cols === 2 ? 'col-span-1 sm:col-span-2' : ''}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

/* =======================================================
   ÉCRAN PRINCIPAL
======================================================= */

export default function Atex() {
  // Onglets
  const [tab, setTab] = useState('controls');

  // Liste & filtres
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [fBuilding, setFBuilding] = useState([]);
  const [fRoom, setFRoom] = useState([]);
  const [fType, setFType] = useState([]);
  const [fManufacturer, setFManufacturer] = useState([]);
  const [fStatus, setFStatus] = useState([]); // UI (EN), converti vers FR côté API
  const [fGas, setFGas] = useState([]);
  const [fDust, setFDust] = useState([]);

  const [sort, setSort] = useState({ by: 'id', dir: 'desc' });

  // Pagination locale
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [total, setTotal] = useState(0);

  // Uniques (suggests)
  const [uniques, setUniques] = useState({
    buildings: [],
    rooms: [],
    types: [],
    manufacturers: [],
    refs: [],
    atex_refs: []
  });

  // Analytics
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // État modales
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);

  // Pièces jointes (modale Attach + modale Edit)
  const [attachments, setAttachments] = useState([]);
  const [modalAttachments, setModalAttachments] = useState([]);

  // UI
  const [showFilters, setShowFilters] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const { notify, ToastEl } = useToast();

  // ======== PLANS & POSITIONS (dans Controls) =========
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [planZones, setPlanZones] = useState([]); // existantes
  const [pendingRect, setPendingRect] = useState(null); // rect à créer -> ZoneForm visible

  async function loadPlans() {
    try {
      // GET /api/atex/plans -> [{id,name,building,room,...}]
      const data = await get(`${API_BASE}/api/atex/plans`);
      setPlans(data || []);
      // garder sélection si encore présent
      if (selectedPlanId && !(data || []).some(p => p.id === selectedPlanId)) {
        setSelectedPlanId(null);
      }
    } catch (e) {
      console.error('loadPlans failed', e);
      notify('Failed to load plans', 'error');
    }
  }

  async function loadPlanDetail(planId) {
    if (!planId) {
      setSelectedPlan(null);
      setPlanZones([]);
      return;
    }
    try {
      const p = await get(`${API_BASE}/api/atex/plans/${planId}`);
      setSelectedPlan(p);
      const z = await get(`${API_BASE}/api/atex/plans/${planId}/zones`);
      setPlanZones(z || []);
    } catch (e) {
      console.error('loadPlanDetail failed', e);
      notify('Failed to load plan detail', 'error');
    }
  }

  async function createPlanZone(rect, payload) {
    // POST /api/atex/plans/:id/zones  body: {shape:{x,y,w,h,kind}, label, zone_gas, zone_dust, parent_id, component_type}
    const body = {
      shape: { x: rect.x, y: rect.y, w: rect.w, h: rect.h, kind: 'rect' },
      label: payload.label,
      zone_gas: payload.zone_gas,
      zone_dust: payload.zone_dust,
      parent_id: payload.parent_id,
      component_type: payload.component_type
    };
    try {
      const created = await post(`${API_BASE}/api/atex/plans/${selectedPlanId}/zones`, body);
      // l’API crée aussi le sous-équipement et renvoie {zone:..., sub_equipment:{id:...}}
      setPlanZones(prev => [...prev, { ...created.zone, sub_id: created?.sub_equipment?.id }]);
      setPendingRect(null);
      notify('Sub-equipment created from plan area');
    } catch (e) {
      console.error('createPlanZone failed', e);
      notify('Failed to create sub-equipment', 'error');
    }
  }

  async function deletePlanZone(z) {
    try {
      // DELETE /api/atex/plan-zones/:zoneId  (et éventuellement /sub-equipments/:id si tu veux en cascade côté API)
      await del(`${API_BASE}/api/atex/plan-zones/${z.id}`);
      setPlanZones(prev => prev.filter(x => x.id !== z.id));
      notify('Zone deleted');
    } catch (e) {
      console.error('deletePlanZone failed', e);
      notify('Failed to delete zone', 'error');
    }
  }

  useEffect(() => { loadPlans(); }, []);
  useEffect(() => { loadPlanDetail(selectedPlanId); }, [selectedPlanId]);

  // ------ Chargements liste & analytics ------
  async function loadSuggests() {
    try {
      const data = await get(`${API_BASE}/api/atex/suggests`);
      setUniques({
        buildings: data.building || [],
        rooms: data.room || [],
        types: data.component_type || [],
        manufacturers: data.manufacturer || [],
        refs: data.manufacturer_ref || [],
        atex_refs: data.atex_ref || []
      });
    } catch (e) {
      console.error('Load suggests failed:', e);
    }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const data = await get(`${API_BASE}/api/atex/analytics`);
      setAnalytics(data);
    } catch (e) {
      console.error('Load analytics failed:', e);
      notify('Failed to load analytics', 'error');
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const statusFr = fStatus.map(s => STATUS_MAP_TO_FR[s] || s);
      const params = new URLSearchParams({
        q,
        building: fBuilding,
        room: fRoom,
        component_type: fType,
        manufacturer: fManufacturer,
        status: statusFr,
        zone_gas: fGas,
        zone_dust: fDust,
        sort: sort.by,
        dir: sort.dir,
        page,
        pageSize
      }).toString();

      const data = await get(`${API_BASE}/api/atex/equipments?${params}`);
      setRows(data || []);
      setTotal(data?.length || 0);
    } catch (e) {
      console.error('Load data failed:', e);
      notify('Failed to load equipment data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadAttachments(id) {
    try {
      const data = await get(`${API_BASE}/api/atex/equipments/${id}/attachments`);
      setAttachments(data || []);
      if (editItem && editItem.id === id) {
        setModalAttachments(data.map(a => ({ ...a, file: null })) || []);
      }
    } catch (e) {
      console.error('Load attachments failed:', e);
      notify('Failed to load attachments', 'error');
    }
  }

  // ------ CRUD ------
  async function saveItem() {
    setLoading(true);
    try {
      const payload = {
        ...editItem,
        zone_gas: editItem.zone_gas === '' ? null : editItem.zone_gas,
        zone_dust: editItem.zone_dust === '' ? null : editItem.zone_dust
      };
      let equipmentId = editItem.id;
      if (editItem.id) {
        await put(`${API_BASE}/api/atex/equipments/${editItem.id}`, payload);
        notify('Equipment updated successfully', 'success');
      } else {
        const response = await post(`${API_BASE}/api/atex/equipments`, payload);
        equipmentId = response.id;
        notify('Equipment created successfully', 'success');
      }

      if (modalAttachments.length > 0) {
        const formData = new FormData();
        modalAttachments.forEach(a => {
          if (a.file) formData.append('files', a.file);
        });
        if ([...formData.keys()].length) {
          await upload(`${API_BASE}/api/atex/equipments/${equipmentId}/attachments`, formData);
        }
      }

      setEditItem(null);
      setModalAttachments([]);
      await loadData();
    } catch (e) {
      console.error('Save failed:', e);
      notify(`Failed to save equipment: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(id) {
    setLoading(true);
    try {
      await del(`${API_BASE}/api/atex/equipments/${id}`);
      notify('Equipment deleted successfully', 'success');
      setShowDelete(null);
      await loadData();
    } catch (e) {
      console.error('Delete failed:', e);
      notify('Failed to delete equipment', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ------ Pièces jointes ------
  async function uploadAttachmentsAction(id, files) {
    setLoading(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      await upload(`${API_BASE}/api/atex/equipments/${id}/attachments`, formData);
      notify('Attachments uploaded successfully', 'success');
      await loadAttachments(id);
    } catch (e) {
      console.error('Upload attachments failed:', e);
      notify('Failed to upload attachments', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteAttachment(id, attId) {
    setLoading(true);
    try {
      await del(`${API_BASE}/api/atex/attachments/${attId}`);
      notify('Attachment deleted successfully', 'success');
      await loadAttachments(id);
      if (editItem && editItem.id === id) {
        setModalAttachments(prev => prev.filter(x => x.id !== attId));
      }
    } catch (e) {
      console.error('Delete attachment failed:', e);
      notify('Failed to delete attachment', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ------ Import / Export ------
  async function exportToExcel() {
    try {
      const { data } = await get(`${API_BASE}/api/atex/export`);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ATEX Equipment');
      XLSX.writeFile(wb, 'atex_equipment.xlsx');
    } catch (e) {
      console.error('Export failed:', e);
      notify('Failed to export data', 'error');
    }
  }

  async function importFromExcel(e) {
    setLoading(true);
    try {
      const file = e.target.files[0];
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws);

      for (const row of json) {
        await post(`${API_BASE}/api/atex/equipments`, {
          site: row.site || null,
          building: row.building || '',
          room: row.room || '',
          component_type: row.component_type || '',
          manufacturer: row.manufacturer || null,
          manufacturer_ref: row.manufacturer_ref || null,
          atex_ref: row.atex_ref || null,
          zone_gas: row.zone_gas ? Number(row.zone_gas) : null,
          zone_dust: row.zone_dust ? Number(row.zone_dust) : null,
          last_control: row.last_control || null,
          next_control: row.next_control || null,
          comments: row.comments || null,
          frequency_months: row.frequency_months ? Number(row.frequency_months) : 36
        });
      }

      notify('Data imported successfully', 'success');
      await loadData();
    } catch (e) {
      console.error('Import failed:', e);
      notify('Failed to import data', 'error');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  // ------ UI helpers ------
  function onEdit(row) {
    setEditItem({
      id: row.id,
      site: row.site || '',
      building: row.building || '',
      room: row.room || '',
      component_type: row.component_type || '',
      manufacturer: row.manufacturer || '',
      manufacturer_ref: row.manufacturer_ref || '',
      atex_ref: row.atex_ref || '',
      zone_gas: row.zone_gas ?? '',
      zone_dust: row.zone_dust ?? '',
      last_control: row.last_control ? row.last_control.split('T')[0] : '',
      next_control: row.next_control ? row.next_control.split('T')[0] : '',
      comments: row.comments || '',
      frequency_months: row.frequency_months || 36
    });
    loadAttachments(row.id);
  }

  function onReset() {
    setQ('');
    setFBuilding([]);
    setFRoom([]);
    setFType([]);
    setFManufacturer([]);
    setFStatus([]);
    setFGas([]);
    setFDust([]);
    setPage(1);
    setSort({ by: 'id', dir: 'desc' });
  }

  // Mount + refresh à chaque changement de filtres/tri/page
  useEffect(() => {
    loadData();
    loadSuggests();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fBuilding, fRoom, fType, fManufacturer, fStatus, fGas, fDust, sort.by, sort.dir, page]);

  return (
    <section className="p-4 sm:p-6 space-y-6 max-w-full">
      {/* Header + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex gap-2 flex-wrap">
          {['controls', 'assessment', 'import'].map(k => (
            <button
              key={k}
              className={classNames(
                'px-4 py-2 text-sm font-medium rounded-lg',
                tab === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
              onClick={() => setTab(k)}
            >
              {k === 'controls' ? 'Controls' : k === 'assessment' ? 'Assessment' : 'Import/Export'}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          className="flex items-center gap-2 w-full sm:w-auto"
          onClick={() =>
            setEditItem({
              id: null,
              site: '',
              building: '',
              room: '',
              component_type: '',
              manufacturer: '',
              manufacturer_ref: '',
              atex_ref: '',
              zone_gas: '',
              zone_dust: '',
              last_control: '',
              next_control: '',
              comments: '',
              frequency_months: 36
            })
          }
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Equipment
        </Button>
      </div>

      {/* Onglet Controls */}
      {tab === 'controls' && (
        <div className="space-y-6">
          {/* Filtres + Table */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-2xl font-semibold">ATEX Equipment Controls</h2>
            <button
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? 'Hide Filters' : 'Show Filters'}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={showFilters ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
                />
              </svg>
            </button>
          </div>

          {showFilters && (
            <FilterBar
              q={q}
              setQ={setQ}
              fBuilding={fBuilding}
              setFBuilding={setFBuilding}
              fRoom={fRoom}
              setFRoom={setFRoom}
              fType={fType}
              setFType={setFType}
              fManufacturer={fManufacturer}
              setFManufacturer={setFManufacturer}
              fStatus={fStatus}
              setFStatus={setFStatus}
              fGas={fGas}
              setFGas={setFGas}
              fDust={fDust}
              setFDust={setFDust}
              uniques={uniques}
              onSearch={loadData}
              onReset={onReset}
            />
          )}

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th label="ID" sortKey="id" sort={sort} setSort={setSort} />
                  <Th label="Equipment" sortKey="component_type" sort={sort} setSort={setSort} />
                  <Th label="Location" sortKey="building" sort={sort} setSort={setSort} />
                  <Th label="Manufacturer" sortKey="manufacturer" sort={sort} setSort={setSort} />
                  <Th label="ATEX" sortKey="atex_ref" sort={sort} setSort={setSort} />
                  <th className="px-4 py-2 text-left font-medium">Zones</th>
                  <Th label="Status" sortKey="status" sort={sort} setSort={setSort} />
                  <Th label="Next Inspection" sortKey="next_control" sort={sort} setSort={setSort} />
                  <th className="px-4 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">
                      No equipment found
                    </td>
                  </tr>
                ) : (
                  rows.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2 font-mono text-sm">#{r.id}</td>
                      <td className="px-4 py-2">{r.component_type}</td>
                      <td className="px-4 py-2">
                        <div>{r.building}</div>
                        <div className="text-xs text-gray-500">Room {r.room}</div>
                      </td>
                      <td className="px-4 py-2">
                        {r.manufacturer || '—'}
                        {r.manufacturer_ref && (
                          <div className="text-xs text-gray-500">{r.manufacturer_ref}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.atex_ref || '—'}</td>
                      <td className="px-4 py-2">
                        <div className="text-xs">Gas: {r.zone_gas ?? '—'}</div>
                        <div className="text-xs">Dust: {r.zone_dust ?? '—'}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={classNames('px-2 py-1 rounded text-xs', getStatusColor(r.status))}>
                          {getStatusDisplay(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2">{formatDate(r.next_control)}</td>
                      <td className="px-4 py-2 flex gap-2 flex-wrap">
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          onClick={() => onEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                          onClick={() => setShowDelete(r.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          onClick={() => {
                            setShowAttach(r.id);
                            loadAttachments(r.id);
                          }}
                        >
                          Attach
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <Pager page={page} setPage={setPage} pageSize={pageSize} total={total} />
          </div>

          {/* ===== Plans & Positions (même page) ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
            <PlanList
              plans={plans}
              selectedPlanId={selectedPlanId}
              setSelectedPlanId={setSelectedPlanId}
              onRefresh={loadPlans}
              notify={notify}
            />

            <div className="space-y-4">
              <PlanCanvas
                plan={selectedPlan}
                zones={planZones}
                setZonesLocal={setPlanZones}
                onCreateZone={(rect) => setPendingRect(rect)}
                onDeleteZone={deletePlanZone}
              />

              {/* Formulaire de création de sous-équipement depuis la zone dessinée */}
              {pendingRect && selectedPlan && (
                <ZoneForm
                  draftRect={pendingRect}
                  parentIdDefault={null}
                  onCancel={() => setPendingRect(null)}
                  onCreate={(payload) => createPlanZone(pendingRect, payload)}
                />
              )}
            </div>
          </div>

          {/* Modale Delete */}
          {showDelete && (
            <Modal onClose={() => setShowDelete(null)} title="Confirm Delete">
              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete equipment #{showDelete}?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowDelete(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => deleteItem(showDelete)}>
                  Delete
                </Button>
              </div>
            </Modal>
          )}

          {/* Modale Attach */}
          {showAttach && (
            <Modal onClose={() => setShowAttach(null)} title={`Attachments for #${showAttach}`}>
              <input
                type="file"
                multiple
                className="input mb-4 w-full"
                onChange={e => uploadAttachmentsAction(showAttach, Array.from(e.target.files))}
              />
              {attachments.length === 0 ? (
                <p className="text-sm text-gray-500">No attachments</p>
              ) : (
                <ul className="space-y-2">
                  {attachments.map(a => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <a
                        href={`${API_BASE}/api/atex/attachments/${a.id}/download`}
                        className="text-blue-600 hover:text-blue-800 truncate"
                      >
                        {a.filename}
                      </a>
                      <button
                        className="text-red-600 hover:text-red-800"
                        onClick={() => deleteAttachment(showAttach, a.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Modal>
          )}
        </div>
      )}

      {/* Onglet Import/Export */}
      {tab === 'import' && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Import/Export Data</h2>
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">Excel Template Instructions</h3>
              <p className="text-gray-700 mb-4">
                Use the following column order in your Excel file (first row headers):
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left border">Column</th>
                      <th className="px-4 py-2 text-left border">Example</th>
                      <th className="px-4 py-2 text-left border">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['site', 'Nyon', 'No'],
                      ['building', '20', 'Yes'],
                      ['room', '112', 'Yes'],
                      ['component_type', 'Compressor', 'Yes'],
                      ['manufacturer', 'Schneider', 'No'],
                      ['manufacturer_ref', '218143RT', 'No'],
                      ['atex_ref', 'II 2G Ex ib IIC T4 Gb', 'No'],
                      ['zone_gas', '2', 'No'],
                      ['zone_dust', '21', 'No'],
                      ['comments', 'Installed 2023', 'No'],
                      ['last_control', '2025-09-19', 'No'],
                      ['frequency_months', '36', 'No'],
                      ['next_control', '2028-09-19', 'No']
                    ].map(([c, ex, req]) => (
                      <tr key={c}>
                        <td className="px-4 py-2 border">{c}</td>
                        <td className="px-4 py-2 border">{ex}</td>
                        <td className="px-4 py-2 border">{req}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Dates in YYYY-MM-DD format. Numbers for zones (0,1,2 for gas; 20,21,22 for dust).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button variant="primary" className="w-full" onClick={exportToExcel}>
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Current Equipment Data
              </Button>
              <div>
                <label className="block text-sm font-medium mb-1">Import Equipment Data</label>
                <input className="input w-full" type="file" accept=".xlsx,.xls" onChange={importFromExcel} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Onglet Assessment */}
      {tab === 'assessment' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-2xl font-semibold">Assessment & Analytics</h2>
            <div className="text-sm text-gray-500">
              Updated: {analytics?.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : 'Loading...'}
            </div>
          </div>

          {analyticsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white p-4 rounded-lg shadow animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                </div>
              ))}
            </div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <KpiCard title="Total Equipment" value={analytics.stats.total} tone="blue" />
                <KpiCard
                  title="Compliant"
                  value={analytics.stats.compliant}
                  tone="green"
                  sub={`${Math.round((analytics.stats.compliant / Math.max(1, analytics.stats.total)) * 100)}% compliance rate`}
                />
                <KpiCard title="Overdue Inspections" value={analytics.stats.overdue} tone="red" sub="Immediate action required" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <DoughnutChart
                  data={[
                    { label: 'Compliant', value: Number(analytics.stats.compliant || 0) },
                    { label: 'Non-compliant', value: Number(analytics.stats.non_compliant || 0) },
                    { label: 'To review', value: Number(analytics.stats.to_review || 0) }
                  ]}
                  title="Compliance Status Distribution"
                />
                <SimpleBarChart
                  data={(analytics.byType || []).map(item => ({
                    label: (item.component_type || '').slice(0, 20) + ((item.component_type || '').length > 20 ? '...' : ''),
                    value: parseInt(item.count, 10) || 0
                  }))}
                  title="Top Equipment Types"
                />
                <SimpleBarChart
                  data={[
                    { label: 'Overdue', value: Number(analytics.stats.overdue || 0) },
                    { label: 'Due 90 days', value: Number(analytics.stats.due_90_days || 0) },
                    { label: 'Future', value: Number(analytics.stats.future || 0) }
                  ]}
                  title="Inspection Timeline"
                />
                <SimpleBarChart
                  data={(analytics.complianceByZone || []).map(item => ({
                    label: `Zone ${item.zone}`,
                    value: parseInt(item.compliant, 10) || 0
                  }))}
                  title="Compliant Equipment by Gas Zone"
                  yLabel="Compliant Count"
                />
              </div>

              {(analytics.riskEquipment || []).length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <div className="px-6 py-4 border-b bg-gray-50">
                    <h3 className="text-lg font-medium">
                      High Priority Equipment ({analytics.riskEquipment.length})
                    </h3>
                    <p className="text-sm text-gray-600">Overdue inspections and due within next 90 days</p>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">ID</th>
                        <th className="px-4 py-2 text-left font-medium">Equipment</th>
                        <th className="px-4 py-2 text-left font-medium">Location</th>
                        <th className="px-4 py-2 text-left font-medium">Zones</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                        <th className="px-4 py-2 text-left font-medium">Next Inspection</th>
                        <th className="px-4 py-2 text-left font-medium">Days</th>
                        <th className="px-4 py-2 text-left font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.riskEquipment.map(r => {
                        const dleft = daysUntil(r.next_control);
                        const risk = dleft < 0 ? 'High' : 'Medium';
                        const riskColor = risk === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-4 py-2 font-mono text-sm">#{r.id}</td>
                            <td className="px-4 py-2">{r.component_type}</td>
                            <td className="px-4 py-2">
                              <div>{r.building}</div>
                              <div className="text-xs text-gray-500">Room {r.room}</div>
                            </td>
                            <td className="px-4 py-2">
                              <div className="text-xs">Gas: {r.zone_gas ?? '—'}</div>
                              <div className="text-xs">Dust: {r.zone_dust ?? '—'}</div>
                            </td>
                            <td className="px-4 py-2">
                              <span className={classNames('px-2 py-1 rounded text-xs', getStatusColor(r.status))}>
                                {getStatusDisplay(r.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2">{formatDate(r.next_control)}</td>
                            <td className="px-4 py-2">
                              <span className={classNames('px-2 py-1 rounded text-xs', riskColor)}>
                                {dleft < 0 ? `${Math.abs(dleft)} days late` : `${dleft} days`}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <button
                                className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                onClick={() => setTab('controls')}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">Loading analytics...</div>
          )}
        </div>
      )}

      {/* Modale Edit/New */}
      {editItem && (
        <Modal
          onClose={() => {
            setEditItem(null);
            setModalAttachments([]);
          }}
          title={editItem.id ? 'Edit Equipment' : 'New Equipment'}
          wide
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Site</label>
              <select
                className="input w-full bg-white text-gray-900 border-gray-300 focus:ring-blue-500"
                value={editItem.site || ''}
                onChange={e => setEditItem({ ...editItem, site: e.target.value })}
              >
                <option value="">Select site</option>
                {SITE_OPTIONS.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <Field label="Building">
              <input
                className="input w-full"
                value={editItem.building || ''}
                onChange={e => setEditItem({ ...editItem, building: e.target.value })}
              />
            </Field>

            <Field label="Room">
              <input
                className="input w-full"
                value={editItem.room || ''}
                onChange={e => setEditItem({ ...editItem, room: e.target.value })}
              />
            </Field>

            <Field label="Component Type">
              <input
                className="input w-full"
                value={editItem.component_type || ''}
                onChange={e => setEditItem({ ...editItem, component_type: e.target.value })}
              />
            </Field>

            <Field label="Manufacturer">
              <input
                className="input w-full"
                value={editItem.manufacturer || ''}
                onChange={e => setEditItem({ ...editItem, manufacturer: e.target.value })}
              />
            </Field>

            <Field label="Manufacturer Ref">
              <input
                className="input w-full"
                value={editItem.manufacturer_ref || ''}
                onChange={e => setEditItem({ ...editItem, manufacturer_ref: e.target.value })}
              />
            </Field>

            <Field label="ATEX Marking" cols={2}>
              <input
                className="input w-full"
                value={editItem.atex_ref || ''}
                onChange={e => setEditItem({ ...editItem, atex_ref: e.target.value })}
              />
            </Field>

            <Field label="Gas Zone">
              <select
                className="input w-full"
                value={editItem.zone_gas ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_gas: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {GAS_ZONES.map(z => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Dust Zone">
              <select
                className="input w-full"
                value={editItem.zone_dust ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_dust: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {DUST_ZONES.map(z => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Last Inspection">
              <input
                type="date"
                className="input w-full"
                value={editItem.last_control || ''}
                onChange={e => setEditItem({ ...editItem, last_control: e.target.value || null })}
              />
            </Field>

            <Field label="Next Inspection">
              <input
                type="date"
                className="input w-full"
                value={editItem.next_control || ''}
                onChange={e => setEditItem({ ...editItem, next_control: e.target.value || null })}
              />
            </Field>

            <Field label="Frequency (months)">
              <input
                type="number"
                className="input w-full"
                value={editItem.frequency_months || ''}
                onChange={e =>
                  setEditItem({ ...editItem, frequency_months: e.target.value ? Number(e.target.value) : null })
                }
              />
            </Field>

            {/* Bloc Analyse photo + pièces jointes */}
            <div className="col-span-1 sm:col-span-2 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <label className="block text-sm font-medium mb-2">Upload Photo for Auto-Fill</label>
              <p className="text-xs text-gray-500 mb-2">
                Upload a clear photo of the equipment label to automatically fill Manufacturer, Mfr Ref, and
                ATEX Marking.
              </p>
              <input
                type="file"
                accept="image/*"
                className="input text-sm w-full bg-white text-gray-900 border-gray-300"
                disabled={photoLoading}
                onChange={async e => {
                  const file = e.target.files[0];
                  if (!file) return;

                  setPhotoLoading(true);
                  const formData = new FormData();
                  formData.append('photo', file);

                  try {
                    const analysis = await upload(`${API_BASE}/api/atex/photo-analysis`, formData);
                    setEditItem(prev => ({
                      ...prev,
                      manufacturer: analysis.manufacturer || prev.manufacturer,
                      manufacturer_ref: analysis.manufacturer_ref || prev.manufacturer_ref,
                      atex_ref: analysis.atex_ref || prev.atex_ref
                    }));
                    notify('Photo analyzed successfully! Fields updated.', 'success');
                  } catch (err) {
                    console.error('Photo analysis failed:', err);
                    notify('Failed to analyze photo. Try a clearer image.', 'error');
                  } finally {
                    setPhotoLoading(false);
                    e.target.value = '';
                  }
                }}
              />
              {photoLoading && (
                <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing photo...
                </div>
              )}
            </div>

            <div className="col-span-1 sm:col-span-2 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <label className="block text-sm font-medium mb-2">Attachments</label>
              <p className="text-xs text-gray-500 mb-2">Upload files to attach to this equipment.</p>
              <input
                type="file"
                multiple
                className="input text-sm w-full bg-white text-gray-900 border-gray-300"
                onChange={e => {
                  const files = Array.from(e.target.files);
                  if (files.length === 0) return;
                  setModalAttachments(prev => [
                    ...prev,
                    ...files.map(f => ({ file: f, filename: f.name, id: `temp-${Math.random().toString(36).slice(2)}` }))
                  ]);
                  e.target.value = '';
                }}
              />
              {modalAttachments.length === 0 ? (
                <p className="text-sm text-gray-500 mt-2">No attachments</p>
              ) : (
                <ul className="space-y-2 mt-2">
                  {modalAttachments.map(a => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-blue-600 truncate">{a.filename}</span>
                      <button
                        className="text-red-600 hover:text-red-800"
                        onClick={() => setModalAttachments(prev => prev.filter(x => x.id !== a.id))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Field label="Comments" cols={2}>
              <textarea
                className="input w-full min-h-[100px]"
                value={editItem.comments || ''}
                onChange={e => setEditItem({ ...editItem, comments: e.target.value || null })}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button
              variant="ghost"
              onClick={() => {
                setEditItem(null);
                setModalAttachments([]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={loading || !editItem.building || !editItem.room || !editItem.component_type}
              onClick={saveItem}
            >
              {loading ? 'Saving...' : editItem.id ? 'Update' : 'Create'}
            </Button>
          </div>
        </Modal>
      )}

      <ToastEl />
    </section>
  );
}
