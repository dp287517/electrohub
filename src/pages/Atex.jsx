import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, del, upload, API_BASE } from '../lib/api.js';
import * as XLSX from 'xlsx';

// Garder en phase avec SignUp si tu ajoutes des sites
const SITE_OPTIONS = ['Nyon','Levice','Aprilia'];

/* ---------- Petits utilitaires UI ---------- */
function Tag({ children, tone='default' }) {
  const toneClass = {
    default: 'bg-gray-100 text-gray-800',
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
  }[tone] || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${toneClass}`}>{children}</span>;
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toISOString().slice(0,10);
}
function daysUntil(d) {
  if (!d) return null;
  const target = new Date(d);
  const now = new Date();
  return Math.ceil((target - now) / (1000*60*60*24));
}

function useOutsideClose(ref, onClose) {
  useEffect(() => {
    function handler(e){ if(ref.current && !ref.current.contains(e.target)) onClose?.(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

/* ---------- Filtres pro/compacts ---------- */
function MultiSelect({ label, values, setValues, options }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);
  useOutsideClose(wrapRef, () => setOpen(false));

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? options.filter(o => String(o).toLowerCase().includes(s)) : options;
  }, [options, search]);

  function toggle(v) {
    setValues(prev => prev.includes(v) ? prev.filter(x => x!==v) : [...prev, v]);
  }
  function clearAll() { setValues([]); setSearch(''); }
  const labelText = values.length ? `${label} · ${values.length}` : label;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={()=>setOpen(o=>!o)}
        className="h-9 px-3 rounded-md border border-gray-300 bg-white text-sm flex items-center gap-2 hover:border-gray-400"
        title={label}
      >
        <span className="truncate max-w-[10rem]">{labelText}</span>
        <svg className="w-4 h-4 opacity-60" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"/></svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
          <div className="flex items-center gap-2">
            <input
              className="input h-9 flex-1"
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
            <button className="text-xs text-gray-600 hover:text-gray-900" onClick={clearAll} type="button">Clear</button>
          </div>
          <div className="max-h-56 overflow-auto mt-2 pr-1">
            {filtered.length ? filtered.map(v=>(
              <label key={v} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={values.includes(v)} onChange={()=>toggle(v)} />
                <span className="text-sm truncate">{v}</span>
              </label>
            )) : <div className="text-sm text-gray-500 py-2 px-1">No results</div>}
          </div>
          {!!values.length && (
            <div className="flex flex-wrap gap-1 mt-2">
              {values.map(v=>(
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

function Segmented({ label, values, setValues, options }) {
  function toggle(v) { setValues(prev => prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]); }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex rounded-md border border-gray-300 overflow-hidden">
        {options.map(v=>(
          <button
            key={v}
            type="button"
            onClick={()=>toggle(v)}
            className={`px-2.5 h-8 text-sm border-r last:border-r-0 ${values.includes(v) ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterBar({
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              className="h-9 w-72 rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm"
              placeholder="Search text (building, room, ref...)"
              value={q}
              onChange={e=>setQ(e.target.value)}
            />
            <svg className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"/></svg>
          </div>
          <button className="btn btn-primary h-9" onClick={onSearch}>Search</button>
          <button className="h-9 px-3 rounded-md border bg-white text-sm hover:bg-gray-50" onClick={onReset} type="button">Reset</button>
        </div>

        <div className="flex flex-wrap gap-2">
          <MultiSelect label="Building" values={fBuilding} setValues={setFBuilding} options={uniques.buildings}/>
          <MultiSelect label="Room" values={fRoom} setValues={setFRoom} options={uniques.rooms}/>
          <MultiSelect label="Type" values={fType} setValues={setFType} options={uniques.types}/>
          <MultiSelect label="Manufacturer" values={fManufacturer} setValues={setFManufacturer} options={uniques.manufacturers}/>
          <MultiSelect label="Status" values={fStatus} setValues={setFStatus} options={['Compliant','Non-compliant','To review']}/>
          <Segmented label="Gas" values={fGas} setValues={setFGas} options={['0','1','2']}/>
          <Segmented label="Dust" values={fDust} setValues={setFDust} options={['20','21','22']}/>
        </div>
      </div>
    </div>
  );
}

/* ---------- Simple Bar Chart Component ---------- */
function SimpleBarChart({ data, title, yLabel = 'Count' }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barWidth = 100 / data.length;

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 bg-gray-100 rounded-full h-3">
              <div 
                className="bg-blue-500 h-3 rounded-full" 
                style={{ width: `${(item.value / maxValue) * 100}%` }}
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

/* ---------- Doughnut Chart Component ---------- */
function DoughnutChart({ data, title }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = 60;
  const centerRadius = 30;
  const colors = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];
  
  // Calculate cumulative angles
  const cumulativeAngles = data.reduce((acc, item, i) => {
    const startAngle = acc[i-1]?.endAngle || 0;
    const endAngle = startAngle + (item.value / total) * 2 * Math.PI;
    acc[i] = { startAngle, endAngle, ...item };
    return acc;
  }, []);

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">{title}</h3>
      <div className="relative flex justify-center">
        <svg width="200" height="200" viewBox="0 0 200 200">
          {/* Center circle */}
          <circle 
            cx="100" 
            cy="100" 
            r={centerRadius} 
            fill="white" 
            stroke="white" 
            strokeWidth="2"
          />
          
          {/* Doughnut segments */}
          {cumulativeAngles.map((segment, i) => {
            const x1 = 100 + centerRadius * Math.cos(segment.startAngle - Math.PI/2);
            const y1 = 100 + centerRadius * Math.sin(segment.startAngle - Math.PI/2);
            const x2 = 100 + centerRadius * Math.cos(segment.endAngle - Math.PI/2);
            const y2 = 100 + centerRadius * Math.sin(segment.endAngle - Math.PI/2);
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
          
          {/* Center text */}
          <text x="100" y="95" textAnchor="middle" className="font-bold text-lg fill-gray-700">
            {total}
          </text>
          <text x="100" y="115" textAnchor="middle" className="text-xs fill-gray-500">
            Total
          </text>
        </svg>
      </div>
      
      {/* Legend */}
      <div className="mt-4 space-y-1">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            <span className="text-sm">
              {item.label}: {item.value} ({Math.round((item.value / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ */

export default function Atex() {
  const [tab, setTab] = useState('controls');
  const [showFilters, setShowFilters] = useState(false);

  // data
  const [rows, setRows] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  // filters (multi)
  const [q, setQ] = useState('');
  const [fBuilding, setFBuilding] = useState([]);
  const [fRoom, setFRoom] = useState([]);
  const [fType, setFType] = useState([]);
  const [fManufacturer, setFManufacturer] = useState([]);
  const [fStatus, setFStatus] = useState([]);
  const [fGas, setFGas] = useState([]);     // ['0','1','2']
  const [fDust, setFDust] = useState([]);   // ['20','21','22']

  // ✅ sort SÛR par défaut (évite 500 si "updated_at" n'existe pas encore en DB)
  const [sort, setSort] = useState({ by: 'id', dir: 'desc' });

  // modals/drawers
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);

  // Photo analysis
  const [photoLoading, setPhotoLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Notify function for toast
  function notify(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ... (reste du code pour loadData, loadAnalytics, exportToExcel, etc. reste inchangé)

  return (
    <section className="p-4 md:p-6 space-y-6">
      {/* Modal pour edit/new */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-gray-100">
              <h3 className="text-xl font-semibold text-gray-800">{editItem.id ? 'Edit Equipment' : 'New Equipment'}</h3>
              <button
                onClick={() => setEditItem(null)}
                className="p-1 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Site</label>
                  <select
                    className="input"
                    value={editItem.site || ''}
                    onChange={e => setEditItem({ ...editItem, site: e.target.value })}
                  >
                    <option value="">Select site</option>
                    {SITE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Building</label>
                  <input
                    className="input"
                    value={editItem.building || ''}
                    onChange={e => setEditItem({ ...editItem, building: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Room</label>
                  <input
                    className="input"
                    value={editItem.room || ''}
                    onChange={e => setEditItem({ ...editItem, room: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Component Type</label>
                  <input
                    className="input"
                    value={editItem.component_type || ''}
                    onChange={e => setEditItem({ ...editItem, component_type: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Manufacturer</label>
                  <input
                    className="input"
                    value={editItem.manufacturer || ''}
                    onChange={e => setEditItem({ ...editItem, manufacturer: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Manufacturer Ref</label>
                  <input
                    className="input"
                    value={editItem.manufacturer_ref || ''}
                    onChange={e => setEditItem({ ...editItem, manufacturer_ref: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">ATEX Marking</label>
                  <input
                    className="input"
                    value={editItem.atex_ref || ''}
                    onChange={e => setEditItem({ ...editItem, atex_ref: e.target.value })}
                  />
                </div>
                <div className="col-span-2 mt-4 p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                  <label className="block text-sm font-medium mb-2">Upload Photo for Auto-Fill</label>
                  <p className="text-xs text-gray-500 mb-2">Upload a clear photo of the equipment label to automatically fill Manufacturer, Mfr Ref, and ATEX Marking.</p>
                  <input
                    type="file"
                    accept="image/*"
                    className="input text-sm w-full"
                    disabled={photoLoading}
                    onChange={async (e) => {
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
                        e.target.value = ''; // Reset input
                      }
                    }}
                  />
                  {photoLoading && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing photo...
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gas Zone</label>
                  <select
                    className="input"
                    value={editItem.zone_gas ?? ''}
                    onChange={e => setEditItem({ ...editItem, zone_gas: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">—</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Dust Zone</label>
                  <select
                    className="input"
                    value={editItem.zone_dust ?? ''}
                    onChange={e => setEditItem({ ...editItem, zone_dust: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">—</option>
                    <option value="20">20</option>
                    <option value="21">21</option>
                    <option value="22">22</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Last Control</label>
                  <input
                    type="date"
                    className="input"
                    value={editItem.last_control || ''}
                    onChange={e => setEditItem({ ...editItem, last_control: e.target.value || null })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Next Control</label>
                  <input
                    type="date"
                    className="input"
                    value={editItem.next_control || ''}
                    onChange={e => setEditItem({ ...editItem, next_control: e.target.value || null })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Frequency (months)</label>
                  <input
                    type="number"
                    className="input"
                    value={editItem.frequency_months || ''}
                    onChange={e => setEditItem({ ...editItem, frequency_months: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Comments</label>
                  <textarea
                    className="input min-h-[100px]"
                    value={editItem.comments || ''}
                    onChange={e => setEditItem({ ...editItem, comments: e.target.value || null })}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 border-t bg-gray-50 gap-2">
              <button
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                onClick={() => setEditItem(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                disabled={loading || !editItem.building || !editItem.room || !editItem.component_type}
                onClick={() => {
                  // ... (logique de sauvegarde inchangée)
                }}
              >
                {loading ? 'Saving...' : editItem.id ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast pour photo analysis */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ... (reste du code JSX inchangé : onglets, FilterBar, tableaux, etc.) */}
    </section>
  );
}
