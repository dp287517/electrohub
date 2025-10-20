// Atex.jsx — PARTIE 1/2
// Helpers + UI components (réutilisables)
// La page principale (onglets Controls/Assessment/Import + Plans & Positions) arrive en PARTIE 2/2.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js'; // utilisé aussi en PARTIE 2/2
import * as XLSX from 'xlsx'; // utilisé en PARTIE 2/2 (export/import)
import '../styles/atex-map.css';

/* -------------------------------------------------------
   Adapter "Doors-like" pour les plans ATEX
   (mêmes primitives que Doors.jsx côté front)
------------------------------------------------------- */

export const atexMaps = {
  /**
   * Upload d’un ZIP de plans (PDF)
   * @param {File} fileZip
   */
  async uploadZip(fileZip) {
    const fd = new FormData();
    fd.append('file', fileZip);
    // Convention : endpoint d’import ZIP ATEX
    return upload(`${API_BASE}/api/atex/plans/import-zip`, fd);
  },

  /**
   * Liste des plans (aligné Doors : id, logical_name, display_name)
   * BE peut retourner tout autre payload → mapping ici.
   */
  async listPlans() {
    const list = await get(`${API_BASE}/api/atex/plans`);
    // Mapping souple : on normalise { id, logical_name, display_name, meta }
    return (list || []).map(p => ({
      id: p.id,
      logical_name: p.logical_name || p.name || `plan_${p.id}`,
      display_name: p.display_name || p.name || p.logical_name || `Plan #${p.id}`,
      building: p.building ?? null,
      room: p.room ?? null,
      // meta optionnel (première page, pageCount si le BE l’expose)
      ...('meta' in p ? { meta: p.meta } : {})
    }));
  },

  /**
   * URL de téléchargement/lecture du fichier PDF du plan
   * (comme Doors: planFileUrlAuto(plan))
   */
  planFileUrlAuto(plan) {
    // Convention : GET /file renvoie le PDF
    return `${API_BASE}/api/atex/plans/${plan.id}/file`;
  },

  /**
   * Renommer un plan (display_name)
   */
  async renamePlan(planId, newName) {
    return put(`${API_BASE}/api/atex/plans/${planId}`, { display_name: newName });
  },

  /**
   * Supprimer un plan
   */
  async deletePlan(planId) {
    return del(`${API_BASE}/api/atex/plans/${planId}`);
  }
};

/* -------------------------------------------------------
   Pdf.js utils (miniatures & rendu)
------------------------------------------------------- */

// Lazy init du worker pdf.js pour éviter les warnings bundler.
let _pdfjsReady = false;
async function ensurePdfjsWorker() {
  if (_pdfjsReady) return (await import('pdfjs-dist')).getDocument;
  const pdfjsLib = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker && worker.default ? worker.default : worker;
  _pdfjsReady = true;
  return pdfjsLib.getDocument;
}

/**
 * Rendu miniature de la 1ère page d’un PDF dans un <canvas>.
 * Props:
 *   src (string URL), width (px), height (px, optionnel), onReady, onError
 */
export function PdfThumb({ src, width = 180, height, className = '' , onReady, onError }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const getDocument = await ensurePdfjsWorker();
        const loadingTask = getDocument(src);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });

        const scale = width / viewport.width;
        const vp = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = vp.width;
        canvas.height = height ? height : vp.height;

        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        onReady?.();
      } catch (e) {
        console.error('PdfThumb render error', e);
        onError?.(e);
      }
    })();

    return () => { cancelled = true; };
  }, [src, width, height, onReady, onError]);

  return <canvas ref={canvasRef} className={classNames('rounded-md shadow-sm bg-white', className)} />;
}

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
  return {
    toast,
    notify,
    ToastEl: () =>
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
        <Button variant="ghost" className="px-3 py-1" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
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

/* ------------------------------------------
   Sous-composants locaux partagés
   (utilisés aussi par la PARTIE 2/2)
------------------------------------------- */

export function Th({ label, sortKey, sort, setSort }) {
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

export function Modal({ children, onClose, title, wide = false }) {
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

export function KpiCard({ title, value, tone = 'blue', sub }) {
  const border = { blue: 'border-blue-500', green: 'border-green-500', red: 'border-red-500' }[tone];
  const text = { blue: 'text-blue-600', green: 'text-green-600', red: 'text-red-600' }[tone];
  return (
    <div className={classNames('bg-white p-6 rounded-lg shadow border-l-4', border)}>
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className={classNames('text-3xl font-bold mt-1', text)}>{value}</p>
      {sub && <p className="text-sm text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function Field({ label, children, cols = 1 }) {
  return (
    <div className={cols === 2 ? 'col-span-1 sm:col-span-2' : ''}>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ---------------------------
   Plans — version "Doors-like"
   (Header d’import ZIP + liste avec miniatures PDF)
---------------------------- */

export function PlansHeader({ onUploadZip, onRefresh, busy = false }) {
  const inputRef = useRef(null);

  const handleZip = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await onUploadZip?.(file);
      onRefresh?.();
    } finally {
      // reset le champ pour permettre un ré-upload du même fichier
      e.target.value = '';
    }
  }, [onUploadZip, onRefresh]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-lg font-semibold">Plans</div>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="ghost"
          className="relative"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="Importer un ZIP de plans (PDF)"
        >
          📦 Import ZIP de plans
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleZip}
        />
        <Button variant="ghost" onClick={onRefresh} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
    </div>
  );
}

export function PlanCard({ plan, fileUrl, onSelect, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(plan.display_name || '');
  const [thumbReady, setThumbReady] = useState(false);

  return (
    <div className="border rounded-lg p-3 bg-white shadow-sm hover:shadow transition">
      <button className="w-full text-left" onClick={() => onSelect?.(plan)}>
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-gray-50 flex items-center justify-center">
          <PdfThumb
            src={fileUrl}
            width={280}
            className={classNames('max-w-full', thumbReady ? '' : 'opacity-60')}
            onReady={() => setThumbReady(true)}
          />
        </div>
        <div className="mt-2 font-medium truncate">{plan.display_name}</div>
        <div className="text-xs text-gray-500 truncate">
          {plan.building || '—'} · {plan.room || '—'}
        </div>
      </button>

      <div className="mt-2 flex items-center gap-2">
        {!renaming ? (
          <>
            <Button variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>
            <Button variant="ghost" onClick={() => onDelete?.(plan)} className="text-red-600">Delete</Button>
          </>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <input
              className="input flex-1"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <Button
              variant="primary"
              onClick={() => { onRename?.(plan, name); setRenaming(false); }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => { setName(plan.display_name || ''); setRenaming(false); }}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PlanListDoorsLike({ plans, onSelect, onRefresh, onRename, onDelete, onUploadZip, busy }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <PlansHeader onUploadZip={onUploadZip} onRefresh={onRefresh} busy={busy} />
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {(plans || []).length === 0 ? (
          <div className="text-sm text-gray-500">No plans yet. Import a ZIP to get started.</div>
        ) : (
          plans.map(p => (
            <PlanCard
              key={p.id}
              plan={p}
              fileUrl={atexMaps.planFileUrlAuto(p)}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
// Atex.jsx — PARTIE 2/2
// Page principale (onglets Controls/Assessment/Import + Plans & Positions)
// → S'appuie sur les composants et l'adapter définis dans la PARTIE 1/2.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';
import * as XLSX from 'xlsx';
import {
  classNames, formatDate, daysUntil, useToast, Button, Modal, Field, KpiCard,
  FilterBar, Pager, getStatusColor, getStatusDisplay,
  GAS_ZONES, DUST_ZONES, SITE_OPTIONS, STATUS_OPTIONS_UI, STATUS_MAP_TO_FR,
  Th, atexMaps
} from './Atex.jsx';

/* -------------------------------------------------------
   Zone form (métadonnées après dessin)
------------------------------------------------------- */

function ZoneFormInline({ onCancel, onCreate }) {
  const [label, setLabel] = useState('');
  const [componentType, setComponentType] = useState('');
  const [zoneGas, setZoneGas] = useState('');
  const [zoneDust, setZoneDust] = useState('');
  const [parentId, setParentId] = useState('');

  return (
    <div className="bg-white rounded-lg shadow p-3 border">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Label">
          <input className="input w-full" value={label} onChange={e => setLabel(e.target.value)} />
        </Field>
        <Field label="Component Type">
          <input className="input w-full" value={componentType} onChange={e => setComponentType(e.target.value)} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Gas Zone">
          <select className="input w-full" value={zoneGas} onChange={e => setZoneGas(e.target.value)}>
            <option value="">—</option>
            {GAS_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Dust Zone">
          <select className="input w-full" value={zoneDust} onChange={e => setZoneDust(e.target.value)}>
            <option value="">—</option>
            {DUST_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Parent Equipment ID (optional)">
          <input
            className="input w-full"
            value={parentId}
            onChange={e => setParentId(e.target.value)}
            placeholder="e.g. 123"
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 mt-3">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() =>
            onCreate({
              label,
              component_type: componentType,
              zone_gas: zoneGas ? Number(zoneGas) : null,
              zone_dust: zoneDust ? Number(zoneDust) : null,
              parent_id: parentId ? Number(parentId) : null
            })
          }
          disabled={!componentType}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   PDF Viewer + Annotation (rect / circle / freehand)
------------------------------------------------------- */

function PdfPlanViewer({
  plan, zones, onCreateZone, onDeleteZone, notify
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [renderSize, setRenderSize] = useState({ w: 0, h: 0 });
  const [scaleNatToDisp, setScaleNatToDisp] = useState({ kx: 1, ky: 1 }); // natural → display
  const [tool, setTool] = useState('select'); // 'select' | 'rect' | 'circle' | 'path'
  const [draft, setDraft] = useState(null);   // {kind, data...} in display coords
  const [pendingShape, setPendingShape] = useState(null); // shape in NATURAL coords waiting for metadata
  const [hoverId, setHoverId] = useState(null);

  const fileUrl = plan ? atexMaps.planFileUrlAuto(plan) : null;

  // Render page 1 of PDF to canvas; compute scale factors
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!plan || !canvasRef.current) return;
      setPdfLoading(true);
      try {
        const { default: pdfjsLib } = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default || worker;

        const loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);

        const containerW = canvasRef.current.parentElement.clientWidth || 800;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = containerW / unscaled.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        setRenderSize({ w: canvas.width, h: canvas.height });
        setScaleNatToDisp({ kx: canvas.width / unscaled.width, ky: canvas.height / unscaled.height });

        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        console.error('PDF render error', e);
        notify?.('Failed to render PDF', 'error');
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [plan, fileUrl, notify]);

  // Convert display coords → natural coords (PDF units at scale 1)
  function toNaturalRect(d) {
    const kx = scaleNatToDisp.kx, ky = scaleNatToDisp.ky;
    const x = Math.min(d.x0, d.x1) / kx;
    const y = Math.min(d.y0, d.y1) / ky;
    const w = Math.abs(d.x1 - d.x0) / kx;
    const h = Math.abs(d.y1 - d.y0) / ky;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }
  function toNaturalCircle(d) {
    const kx = scaleNatToDisp.kx, ky = scaleNatToDisp.ky;
    const cx = d.cx / kx;
    const cy = d.cy / ky;
    const rx = Math.abs(d.x - d.cx) / kx;
    const ry = Math.abs(d.y - d.cy) / ky;
    // cercle (on prend le rayon moyen)
    const r = Math.round((rx + ry) / 2);
    return { cx: Math.round(cx), cy: Math.round(cy), r };
  }
  function toNaturalPath(pointsDisp) {
    const kx = scaleNatToDisp.kx, ky = scaleNatToDisp.ky;
    return pointsDisp.map(p => ({ x: Math.round(p.x / kx), y: Math.round(p.y / ky) }));
  }

  // Display helpers: natural → display (for existing zones)
  function rectDisplay(z) {
    return {
      left: Math.round(z.shape.x * scaleNatToDisp.kx),
      top: Math.round(z.shape.y * scaleNatToDisp.ky),
      width: Math.round(z.shape.w * scaleNatToDisp.kx),
      height: Math.round(z.shape.h * scaleNatToDisp.ky)
    };
  }
  function circleDisplay(z) {
    return {
      cx: Math.round(z.shape.cx * scaleNatToDisp.kx),
      cy: Math.round(z.shape.cy * scaleNatToDisp.ky),
      r: Math.round(z.shape.r * Math.max(scaleNatToDisp.kx, scaleNatToDisp.ky))
    };
  }
  function pathDisplay(z) {
    return (z.shape.points || []).map(p => ({
      x: Math.round(p.x * scaleNatToDisp.kx),
      y: Math.round(p.y * scaleNatToDisp.ky)
    }));
  }

  // Mouse interactions on overlay (SVG)
  function onMouseDown(e) {
    if (tool === 'select') return;
    const box = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    if (tool === 'rect') {
      setDraft({ kind: 'rect', x0: x, y0: y, x1: x, y1: y });
    } else if (tool === 'circle') {
      setDraft({ kind: 'circle', cx: x, cy: y, x, y });
    } else if (tool === 'path') {
      setDraft({ kind: 'path', points: [{ x, y }] });
    }
  }

  function onMouseMove(e) {
    if (!draft) return;
    const box = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    setDraft(prev => {
      if (!prev) return prev;
      if (prev.kind === 'rect') return { ...prev, x1: x, y1: y };
      if (prev.kind === 'circle') return { ...prev, x, y };
      if (prev.kind === 'path') return { ...prev, points: [...prev.points, { x, y }] };
      return prev;
    });
  }

  function onMouseUp() {
    if (!draft) return;
    // Convert draft (display) → natural and open metadata form
    let shape = null;
    if (draft.kind === 'rect') {
      const r = toNaturalRect(draft);
      if (r.w > 10 && r.h > 10) shape = { kind: 'rect', ...r };
    } else if (draft.kind === 'circle') {
      const c = toNaturalCircle(draft);
      if (c.r > 6) shape = { kind: 'circle', ...c };
    } else if (draft.kind === 'path') {
      const pts = toNaturalPath(draft.points || []);
      if (pts.length > 3) shape = { kind: 'path', points: pts };
    }
    setDraft(null);
    if (shape) setPendingShape(shape);
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Tool:</span>
          {['select','rect','circle','path'].map(t => (
            <button
              key={t}
              type="button"
              className={classNames(
                'px-2 py-1 rounded border',
                tool === t ? 'bg-gray-800 text-white border-gray-800' : 'bg-white hover:bg-gray-50'
              )}
              onClick={() => setTool(t)}
              title={t === 'path' ? 'Freehand' : t.charAt(0).toUpperCase() + t.slice(1)}
            >
              {t === 'select' ? 'Select' : t === 'rect' ? 'Rect' : t === 'circle' ? 'Circle' : 'Freehand'}
            </button>
          ))}
        </div>
        <div className="text-sm text-gray-600 truncate">
          {plan?.display_name} {plan?.building ? `· ${plan.building}` : ''} {plan?.room ? `· ${plan.room}` : ''}
        </div>
      </div>

      {/* PDF Canvas */}
      <div className="relative w-full overflow-auto">
        {!plan ? (
          <div className="h-[24rem] flex items-center justify-center text-gray-500">
            Select a plan to view and annotate.
          </div>
        ) : (
          <div className="relative">
            <canvas ref={canvasRef} className="block max-w-full h-auto" />
            {/* Overlay for zones + drawing */}
            <svg
              ref={overlayRef}
              width={renderSize.w}
              height={renderSize.h}
              className="absolute left-0 top-0"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              {/* Existing zones */}
              {(zones || []).map(z => {
                const isHover = hoverId === z.id;
                const common = { stroke: isHover ? '#ef4444' : '#2563eb', fillOpacity: 0.12, strokeWidth: 2, fill: isHover ? '#ef4444' : '#2563eb' };
                if (z.shape?.kind === 'rect') {
                  const d = rectDisplay(z);
                  return (
                    <g key={z.id}>
                      <rect
                        x={d.left} y={d.top} width={d.width} height={d.height}
                        {...common} />
                      <title>{z.label || `Zone #${z.id}`}</title>
                      <text x={d.left + 4} y={Math.max(10, d.top + 12)} fontSize="10" fill="#fff" style={{ paintOrder: 'stroke' }}>
                        {z.label || `#${z.id}`}
                      </text>
                      <rect
                        x={d.left} y={d.top} width={d.width} height={d.height}
                        fill="transparent"
                        onMouseEnter={() => setHoverId(z.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete this zone?')) onDeleteZone?.(z); }}
                      />
                    </g>
                  );
                }
                if (z.shape?.kind === 'circle') {
                  const c = circleDisplay(z);
                  return (
                    <g key={z.id}>
                      <circle cx={c.cx} cy={c.cy} r={c.r} {...common} />
                      <title>{z.label || `Zone #${z.id}`}</title>
                      <circle
                        cx={c.cx} cy={c.cy} r={c.r}
                        fill="transparent"
                        onMouseEnter={() => setHoverId(z.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete this zone?')) onDeleteZone?.(z); }}
                      />
                    </g>
                  );
                }
                // path (polyline freehand)
                const pts = pathDisplay(z);
                return (
                  <g key={z.id}>
                    <polyline
                      points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                      {...common}
                      fill="none"
                    />
                    <title>{z.label || `Zone #${z.id}`}</title>
                    <polyline
                      points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={12}
                      onMouseEnter={() => setHoverId(z.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={(e) => { e.stopPropagation(); if (confirm('Delete this zone?')) onDeleteZone?.(z); }}
                    />
                  </g>
                );
              })}

              {/* Draft shape (during drawing) */}
              {draft && draft.kind === 'rect' && (
                <rect
                  x={Math.min(draft.x0, draft.x1)}
                  y={Math.min(draft.y0, draft.y1)}
                  width={Math.abs(draft.x1 - draft.x0)}
                  height={Math.abs(draft.y1 - draft.y0)}
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity="0.12"
                  strokeWidth="2"
                />
              )}
              {draft && draft.kind === 'circle' && (
                <circle
                  cx={draft.cx}
                  cy={draft.cy}
                  r={Math.hypot(draft.x - draft.cx, draft.y - draft.cy)}
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity="0.12"
                  strokeWidth="2"
                />
              )}
              {draft && draft.kind === 'path' && (
                <polyline
                  points={(draft.points || []).map(p => `${p.x},${p.y}`).join(' ')}
                  stroke="#f59e0b"
                  fill="none"
                  strokeWidth="2"
                />
              )}
            </svg>
          </div>
        )}
      </div>

      {/* Métadonnées de la zone à créer */}
      {pendingShape && (
        <div className="border-t p-3">
          <ZoneFormInline
            onCancel={() => setPendingShape(null)}
            onCreate={(payload) => {
              onCreateZone?.(pendingShape, payload);
              setPendingShape(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* =======================================================
   PAGE PRINCIPALE
======================================================= */

export default function Atex() {
  // Onglets
  const [tab, setTab] = useState('controls');

  // ====== Liste & filtres (équipements) ======
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

  // Pièces jointes
  const [attachments, setAttachments] = useState([]);
  const [modalAttachments, setModalAttachments] = useState([]);

  // UI
  const [showFilters, setShowFilters] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const { notify, ToastEl } = useToast();

  // ======== PLANS (Doors-like) =========
  const [plans, setPlans] = useState([]);
  const [plansBusy, setPlansBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [planZones, setPlanZones] = useState([]);

  // --- Plans API ---
  const refreshPlans = useCallback(async () => {
    setPlansBusy(true);
    try {
      const list = await atexMaps.listPlans();
      setPlans(list);
      // Si le plan sélectionné a disparu, on reset
      if (selectedPlan && !list.some(p => p.id === selectedPlan.id)) {
        setSelectedPlan(null);
        setPlanZones([]);
      }
    } catch (e) {
      console.error('listPlans failed', e);
      notify('Failed to load plans', 'error');
    } finally {
      setPlansBusy(false);
    }
  }, [notify, selectedPlan]);

  const openPlan = useCallback(async (p) => {
    setSelectedPlan(p);
    try {
      const z = await get(`${API_BASE}/api/atex/plans/${p.id}/zones`);
      setPlanZones(z || []);
    } catch (e) {
      console.error('load zones failed', e);
      notify('Failed to load plan zones', 'error');
    }
  }, [notify]);

  const uploadZip = useCallback(async (fileZip) => {
    setPlansBusy(true);
    try {
      await atexMaps.uploadZip(fileZip);
      notify('ZIP uploaded. Parsing...', 'success');
      await refreshPlans();
    } catch (e) {
      console.error('uploadZip failed', e);
      notify('Failed to import ZIP', 'error');
    } finally {
      setPlansBusy(false);
    }
  }, [notify, refreshPlans]);

  const renamePlan = useCallback(async (plan, name) => {
    try {
      await atexMaps.renamePlan(plan.id, name);
      notify('Plan renamed', 'success');
      await refreshPlans();
    } catch (e) {
      console.error('renamePlan failed', e);
      notify('Failed to rename plan', 'error');
    }
  }, [notify, refreshPlans]);

  const deletePlan = useCallback(async (plan) => {
    if (!confirm(`Delete plan "${plan.display_name}" ?`)) return;
    try {
      await atexMaps.deletePlan(plan.id);
      notify('Plan deleted', 'success');
      await refreshPlans();
    } catch (e) {
      console.error('deletePlan failed', e);
      notify('Failed to delete plan', 'error');
    }
  }, [notify, refreshPlans]);

  // Zones API
  const createPlanZone = useCallback(async (shape, payload) => {
    if (!selectedPlan) return;
    const body = {
      shape: { ...shape }, // {kind:'rect'|'circle'|'path', ...}
      label: payload.label,
      zone_gas: payload.zone_gas,
      zone_dust: payload.zone_dust,
      parent_id: payload.parent_id,
      component_type: payload.component_type
    };
    try {
      const created = await post(`${API_BASE}/api/atex/plans/${selectedPlan.id}/zones`, body);
      setPlanZones(prev => [...prev, { ...created.zone, sub_id: created?.sub_equipment?.id }]);
      notify('Zone created', 'success');
    } catch (e) {
      console.error('createPlanZone failed', e);
      notify('Failed to create zone', 'error');
    }
  }, [notify, selectedPlan]);

  const deletePlanZone = useCallback(async (z) => {
    try {
      await del(`${API_BASE}/api/atex/plan-zones/${z.id}`);
      setPlanZones(prev => prev.filter(x => x.id !== z.id));
      notify('Zone deleted', 'success');
    } catch (e) {
      console.error('deletePlanZone failed', e);
      notify('Failed to delete zone', 'error');
    }
  }, [notify]);

  useEffect(() => { refreshPlans(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showFilters ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'} />
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
                    <td colSpan="9" className="text-center py-4 text-gray-500">Loading...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">No equipment found</td>
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
                        {r.manufacturer_ref && <div className="text-xs text-gray-500">{r.manufacturer_ref}</div>}
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
                        <button className="text-blue-600 hover:text-blue-800 text-xs font-medium" onClick={() => onEdit(r)}>Edit</button>
                        <button className="text-red-600 hover:text-red-800 text-xs font-medium" onClick={() => setShowDelete(r.id)}>Delete</button>
                        <button
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          onClick={() => { setShowAttach(r.id); loadAttachments(r.id); }}
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

          {/* ===== Plans & Positions (Doors-like + annotations) ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4">
            <div className="space-y-4">
              {/* En-tête + Import ZIP + cartes avec miniatures PDF */}
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-lg font-semibold">Plans</div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        // input file (zip) on the fly
                        const i = document.createElement('input');
                        i.type = 'file';
                        i.accept = '.zip';
                        i.onchange = async (e) => {
                          const f = e.target.files?.[0];
                          if (f) await uploadZip(f);
                        };
                        i.click();
                      }}
                      disabled={plansBusy}
                    >
                      📦 Import ZIP
                    </Button>
                    <Button variant="ghost" onClick={refreshPlans} disabled={plansBusy}>
                      {plansBusy ? 'Loading…' : 'Refresh'}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 space-y-2 max-h-[60vh] overflow-auto pr-1">
                  {plans.length === 0 ? (
                    <div className="text-sm text-gray-500">No plans yet. Import a ZIP to get started.</div>
                  ) : (
                    plans.map(p => (
                      <div
                        key={p.id}
                        className={classNames(
                          'p-2 rounded border flex items-center justify-between',
                          selectedPlan?.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        )}
                      >
                        <button
                          className="text-left flex-1"
                          onClick={() => openPlan(p)}
                          title={`${p.building || ''} ${p.room || ''}`}
                        >
                          <div className="font-medium">{p.display_name || p.logical_name || `Plan #${p.id}`}</div>
                          <div className="text-xs text-gray-500">
                            {p.building || '—'} · {p.room || '—'}
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            className="text-xs text-gray-700 hover:text-gray-900"
                            onClick={async () => {
                              const n = prompt('New name', p.display_name || p.logical_name || '');
                              if (n && n.trim()) await renamePlan(p, n.trim());
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="text-xs text-red-600 hover:text-red-800"
                            onClick={() => deletePlan(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <PdfPlanViewer
                plan={selectedPlan}
                zones={planZones}
                onCreateZone={createPlanZone}
                onDeleteZone={deletePlanZone}
                notify={notify}
              />
            </div>
          </div>

          {/* Modale Delete */}
          {showDelete && (
            <Modal onClose={() => setShowDelete(null)} title="Confirm Delete">
              <p className="text-sm text-gray-600 mb-6">Are you sure you want to delete equipment #{showDelete}?</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowDelete(null)}>Cancel</Button>
                <Button variant="danger" onClick={() => deleteItem(showDelete)}>Delete</Button>
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
                      <button className="text-red-600 hover:text-red-800" onClick={() => deleteAttachment(showAttach, a.id)}>
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
              <p className="text-gray-700 mb-4">Use the following column order in your Excel file (first row headers):</p>
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
              <p className="text-xs text-gray-500 mt-3">Dates in YYYY-MM-DD format. Numbers for zones (0,1,2 for gas; 20,21,22 for dust).</p>
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
                {/* Les charts simples restent importés depuis PARTIE 1/2 si besoin */}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">Loading analytics...</div>
          )}
        </div>
      )}

      {/* Modale Edit/New */}
      {editItem && (
        <Modal
          onClose={() => { setEditItem(null); setModalAttachments([]); }}
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
                {SITE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <Field label="Building">
              <input className="input w-full" value={editItem.building || ''} onChange={e => setEditItem({ ...editItem, building: e.target.value })} />
            </Field>

            <Field label="Room">
              <input className="input w-full" value={editItem.room || ''} onChange={e => setEditItem({ ...editItem, room: e.target.value })} />
            </Field>

            <Field label="Component Type">
              <input className="input w-full" value={editItem.component_type || ''} onChange={e => setEditItem({ ...editItem, component_type: e.target.value })} />
            </Field>

            <Field label="Manufacturer">
              <input className="input w-full" value={editItem.manufacturer || ''} onChange={e => setEditItem({ ...editItem, manufacturer: e.target.value })} />
            </Field>

            <Field label="Manufacturer Ref">
              <input className="input w-full" value={editItem.manufacturer_ref || ''} onChange={e => setEditItem({ ...editItem, manufacturer_ref: e.target.value })} />
            </Field>

            <Field label="ATEX Marking" cols={2}>
              <input className="input w-full" value={editItem.atex_ref || ''} onChange={e => setEditItem({ ...editItem, atex_ref: e.target.value })} />
            </Field>

            <Field label="Gas Zone">
              <select
                className="input w-full"
                value={editItem.zone_gas ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_gas: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {GAS_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>

            <Field label="Dust Zone">
              <select
                className="input w-full"
                value={editItem.zone_dust ?? ''}
                onChange={e => setEditItem({ ...editItem, zone_dust: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {DUST_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>

            <Field label="Last Inspection">
              <input type="date" className="input w-full" value={editItem.last_control || ''} onChange={e => setEditItem({ ...editItem, last_control: e.target.value || null })} />
            </Field>

            <Field label="Next Inspection">
              <input type="date" className="input w-full" value={editItem.next_control || ''} onChange={e => setEditItem({ ...editItem, next_control: e.target.value || null })} />
            </Field>

            <Field label="Frequency (months)">
              <input
                type="number"
                className="input w-full"
                value={editItem.frequency_months || ''}
                onChange={e => setEditItem({ ...editItem, frequency_months: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>

            {/* Analyse photo + pièces jointes */}
            <div className="col-span-1 sm:col-span-2 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
              <label className="block text-sm font-medium mb-2">Upload Photo for Auto-Fill</label>
              <p className="text-xs text-gray-500 mb-2">
                Upload a clear photo of the equipment label to automatically fill Manufacturer, Mfr Ref, and ATEX Marking.
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
            <Button variant="ghost" onClick={() => { setEditItem(null); setModalAttachments([]); }}>
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
