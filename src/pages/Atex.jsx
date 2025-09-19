// src/pages/Atex.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, del, upload } from '../lib/api.js';

const SITE_OPTIONS = ['Nyon','Levice','Aprilia']; // keep in sync with SignUp

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

// ---------- FilterBar (pro, compact, multi) ----------
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

// ------------------------------------------------------

export default function Atex() {
  const [tab, setTab] = useState('controls');

  // data
  const [rows, setRows] = useState([]);
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

  // sort
  const [sort, setSort] = useState({ by: 'updated_at', dir: 'desc' });

  // modals/drawers
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);
  const [attachments, setAttachments] = useState([]); // list for drawer
  const [aiItem, setAiItem] = useState(null);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // CREATE form
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const defaultSite = user?.site || '';
  const [suggests, setSuggests] = useState({ building:[], room:[], component_type:[], manufacturer:[], manufacturer_ref:[], atex_ref:[] });
  const [createForm, setCreateForm] = useState({
    site: defaultSite,
    building: '', room: '',
    component_type: '',
    manufacturer: '', manufacturer_ref: '',
    atex_ref: '',
    zone_gas: '', zone_dust: '',
    comments: '',
    last_control: '',
    frequency_months: 36,
    next_control: '',
  });
  const [files, setFiles] = useState([]);

  function cf(k, v) { setCreateForm(s => ({ ...s, [k]: v })); }

  // Load list & suggests
  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      fBuilding.forEach(v => (params.building = [...(params.building||[]), v]));
      fRoom.forEach(v => (params.room = [...(params.room||[]), v]));
      fType.forEach(v => (params.component_type = [...(params.component_type||[]), v]));
      fManufacturer.forEach(v => (params.manufacturer = [...(params.manufacturer||[]), v]));
      // map UI statuses -> backend statuses
      const mapStatus = { 'Compliant':'Conforme', 'Non-compliant':'Non conforme', 'To review':'À vérifier' };
      fStatus.forEach(v => (params.status = [...(params.status||[]), mapStatus[v] || v]));
      fGas.forEach(v => (params.zone_gas = [...(params.zone_gas||[]), v]));
      fDust.forEach(v => (params.zone_dust = [...(params.zone_dust||[]), v]));
      if (sort.by) { params.sort = sort.by; params.dir = sort.dir; }
      const data = await get('/api/atex/equipments', params);
      setRows(data || []);
    } catch (e) {
      alert('Load failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSuggests() {
    try {
      const s = await get('/api/atex/suggests');
      setSuggests(s || {});
    } catch { /* non-blocking */ }
  }

  useEffect(() => { load(); }, [sort]); // when sort changes
  useEffect(() => { loadSuggests(); }, []); // on mount

  const uniques = useMemo(() => {
    const u = (key) => Array.from(new Set(rows.map(r => r[key]).filter(Boolean))).sort();
    return {
      buildings: u('building'),
      rooms: u('room'),
      types: u('component_type'),
      manufacturers: u('manufacturer'),
    };
  }, [rows]);

  function toggleSort(col) {
    setSort(prev => prev.by===col ? { by: col, dir: prev.dir==='asc'?'desc':'asc' } : { by: col, dir:'asc' });
  }

  // actions
  async function onDelete(id) {
    try {
      await del(`/api/atex/equipments/${id}`);
      setShowDelete(null);
      load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function onSaveEdit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.zone_gas = payload.zone_gas ? Number(payload.zone_gas) : null;
    payload.zone_dust = payload.zone_dust ? Number(payload.zone_dust) : null;

    try {
      await put(`/api/atex/equipments/${editItem.id}`, payload);
      setEditItem(null);
      load();
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }

  async function runAI(item) {
    try {
      setAiItem(item); setAiLoading(true); setAiText('');
      const { analysis } = await post(`/api/atex/ai/${item.id}`, {});
      setAiText(analysis);
    } catch (e) {
      setAiText('AI failed: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  // Attachments drawer
  async function openAttachments(item) {
    setShowAttach(item);
    try {
      const list = await get(`/api/atex/equipments/${item.id}/attachments`);
      setAttachments(list || []);
    } catch (e) {
      setAttachments([]);
    }
  }

  // CREATE helpers
  function computeNextControl() {
    const d = createForm.last_control ? new Date(createForm.last_control) : null;
    if (!d) return '';
    const m = Number(createForm.frequency_months || 36);
    d.setMonth(d.getMonth() + m);
    return d.toISOString().slice(0,10);
  }

  async function onCreate(e) {
    e.preventDefault();
    const payload = { ...createForm };
    payload.zone_gas = payload.zone_gas ? Number(payload.zone_gas) : null;
    payload.zone_dust = payload.zone_dust ? Number(payload.zone_dust) : null;
    if (!payload.next_control) payload.next_control = computeNextControl();

    try {
      const created = await post('/api/atex/equipments', payload);
      if (files.length) {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        await upload(`/api/atex/equipments/${created.id}/attachments`, fd);
      }
      // reset
      setCreateForm({
        site: defaultSite,
        building: '', room: '',
        component_type: '',
        manufacturer: '', manufacturer_ref: '',
        atex_ref: '',
        zone_gas: '', zone_dust: '',
        comments: '',
        last_control: '',
        frequency_months: 36,
        next_control: '',
      });
      setFiles([]);
      await load();
      setTab('controls');
      alert('Equipment created.');
    } catch (e) {
      alert('Create failed: ' + e.message);
    }
  }

  return (
    <section className="container-narrow py-8">
      <h1 className="text-3xl font-bold mb-4">ATEX</h1>

      <div className="flex gap-2 mb-6">
        {[
          {key:'controls',label:'Controls'},
          {key:'create',label:'Create'},
          {key:'import',label:'Import / Export'},
          {key:'assessment',label:'Assessment'}
        ].map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} className={`btn ${tab===t.key ? 'btn-primary' : 'bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'controls' && (
        <div className="space-y-4">
          <FilterBar
            q={q} setQ={setQ}
            fBuilding={fBuilding} setFBuilding={setFBuilding}
            fRoom={fRoom} setFRoom={setFRoom}
            fType={fType} setFType={setFType}
            fManufacturer={fManufacturer} setFManufacturer={setFManufacturer}
            fStatus={fStatus} setFStatus={setFStatus}
            fGas={fGas} setFGas={setFGas}
            fDust={fDust} setFDust={setFDust}
            uniques={uniques}
            onSearch={load}
            onReset={()=>{
              setQ(''); setFBuilding([]); setFRoom([]); setFType([]); setFManufacturer([]); setFStatus([]); setFGas([]); setFDust([]);
              setSort({by:'updated_at', dir:'desc'}); load();
            }}
          />

          <div className="card p-0 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  {[
                    ['building','Building'],['room','Room'],['component_type','Component'],
                    ['manufacturer','Manufacturer'],['manufacturer_ref','Mfr Ref'],
                    ['atex_ref','ATEX Ref'],['zone_gas','Gas Zone'],['zone_dust','Dust Zone'],
                    ['status','Status'],['last_control','Last inspection'],['next_control','Next inspection']
                  ].map(([key,label])=>(
                    <th key={key} className="px-4 py-3 cursor-pointer select-none" onClick={()=>toggleSort(key)}>
                      {label}{' '}{sort.by===key ? (sort.dir==='asc'?'▲':'▼') : ''}
                    </th>
                  ))}
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">No equipment found</td></tr>
                ) : rows.map(r=>{
                  const dleft = daysUntil(r.next_control);
                  const tone = dleft==null ? 'default' : dleft < 0 ? 'danger' : dleft <= 90 ? 'warn' : 'ok';
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2">{r.building}</td>
                      <td className="px-4 py-2">{r.room}</td>
                      <td className="px-4 py-2">{r.component_type}</td>
                      <td className="px-4 py-2">{r.manufacturer}</td>
                      <td className="px-4 py-2">{r.manufacturer_ref}</td>
                      <td className="px-4 py-2">{r.atex_ref}</td>
                      <td className="px-4 py-2">{r.zone_gas ?? '—'}</td>
                      <td className="px-4 py-2">{r.zone_dust ?? '—'}</td>
                      <td className="px-4 py-2">{r.status}</td>
                      <td className="px-4 py-2">{formatDate(r.last_control)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span>{formatDate(r.next_control)}</span>
                          <Tag tone={tone}>{dleft==null?'—': dleft<0? `${Math.abs(dleft)} d late` : `${dleft} d`}</Tag>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button className="btn bg-gray-100" title="Edit" onClick={()=>setEditItem(r)}>✏️</button>
                          <button className="btn bg-gray-100" title="Delete" onClick={()=>setShowDelete(r)}>🗑️</button>
                          <button className="btn bg-gray-100" title="Attachments" onClick={()=>openAttachments(r)}>📎</button>
                          <button className="btn bg-gray-100" title="AI Check" onClick={()=>runAI(r)}>🤖</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Edit modal */}
          {editItem && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-2xl">
                <h3 className="text-xl font-semibold mb-4">Edit equipment #{editItem.id}</h3>
                <form className="grid md:grid-cols-2 gap-4" onSubmit={onSaveEdit}>
                  <input className="input" name="building" defaultValue={editItem.building} placeholder="Building" required/>
                  <input className="input" name="room" defaultValue={editItem.room} placeholder="Room" required/>
                  <input className="input" name="component_type" defaultValue={editItem.component_type} placeholder="Component type" required/>
                  <input className="input" name="manufacturer" defaultValue={editItem.manufacturer} placeholder="Manufacturer"/>
                  <input className="input" name="manufacturer_ref" defaultValue={editItem.manufacturer_ref} placeholder="Manufacturer ref"/>
                  <input className="input" name="atex_ref" defaultValue={editItem.atex_ref} placeholder="ATEX marking"/>
                  <select className="input" name="zone_gas" defaultValue={editItem.zone_gas ?? ''}>
                    <option value="">Gas zone</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
                  </select>
                  <select className="input" name="zone_dust" defaultValue={editItem.zone_dust ?? ''}>
                    <option value="">Dust zone</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
                  </select>
                  <select className="input" name="status" defaultValue={editItem.status}>
                    <option>Conforme</option><option>Non conforme</option><option>À vérifier</option>
                  </select>
                  <div>
                    <label className="label">Last inspection</label>
                    <input className="input mt-1" type="date" name="last_control" defaultValue={formatDate(editItem.last_control)} />
                  </div>
                  <div>
                    <label className="label">Next inspection</label>
                    <input className="input mt-1" type="date" name="next_control" defaultValue={formatDate(editItem.next_control)} />
                  </div>
                  <textarea className="input md:col-span-2" name="comments" placeholder="Comments" defaultValue={editItem.comments||''}/>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button type="button" className="btn bg-gray-100" onClick={()=>setEditItem(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete pop-up */}
          {showDelete && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-md">
                <h3 className="text-xl font-semibold mb-3">Confirm deletion</h3>
                <p className="text-gray-700 mb-6">
                  Delete equipment <b>#{showDelete.id}</b> — {showDelete.component_type} ({showDelete.building}/{showDelete.room})?
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn bg-gray-100" onClick={()=>setShowDelete(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={()=>onDelete(showDelete.id)}>Delete</button>
                </div>
              </div>
            </div>
          )}

          {/* Attachments drawer */}
          {showAttach && (
            <div className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4">
              <div className="card p-6 w-full md:max-w-xl md:mx-auto md:rounded-2xl rounded-t-2xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-semibold">Attachments — #{showAttach.id}</h3>
                  <button className="btn bg-gray-100" onClick={()=>{ setShowAttach(null); setAttachments([]); }}>Close</button>
                </div>
                <ul className="space-y-2">
                  {(attachments||[]).length ? attachments.map(a=>(
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <div className="truncate">{a.filename} <span className="text-xs text-gray-500">({Math.round((a.size||0)/1024)} KB)</span></div>
                      <div className="flex gap-2">
                        <a className="btn btn-primary" href={`/api/atex/attachments/${a.id}/download`} target="_blank" rel="noreferrer">Download</a>
                        <button className="btn bg-gray-100" onClick={async()=>{
                          await del(`/api/atex/attachments/${a.id}`);
                          const list = await get(`/api/atex/equipments/${showAttach.id}/attachments`);
                          setAttachments(list||[]);
                        }}>Remove</button>
                      </div>
                    </li>
                  )) : (
                    <li className="text-gray-600">No attachments.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* AI modal */}
          {aiItem && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">AI assessment — #{aiItem.id}</h3>
                  <button className="btn bg-gray-100" onClick={()=>setAiItem(null)}>Close</button>
                </div>
                <div className="mt-4 whitespace-pre-wrap text-gray-800">
                  {aiLoading ? 'Analysing…' : (aiText || '—')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div className="card p-6">
          <form className="grid md:grid-cols-2 gap-4" onSubmit={onCreate}>
            <div>
              <label className="label">Site</label>
              <select className="input mt-1" value={createForm.site} onChange={e=>cf('site', e.target.value)}>
                <option value="">—</option>
                {SITE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="text-xs text-gray-600 mt-1">Pre-filled from your session.</div>
            </div>

            <div>
              <label className="label">Building</label>
              <input list="sug-building" className="input mt-1" value={createForm.building} onChange={e=>cf('building', e.target.value)} placeholder="Building" required/>
              <datalist id="sug-building">{(suggests.building||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Room</label>
              <input list="sug-room" className="input mt-1" value={createForm.room} onChange={e=>cf('room', e.target.value)} placeholder="Room" required/>
              <datalist id="sug-room">{(suggests.room||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Component type</label>
              <input list="sug-type" className="input mt-1" value={createForm.component_type} onChange={e=>cf('component_type', e.target.value)} placeholder="e.g., Motor" required/>
              <datalist id="sug-type">{(suggests.component_type||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Manufacturer</label>
              <input list="sug-man" className="input mt-1" value={createForm.manufacturer} onChange={e=>cf('manufacturer', e.target.value)} placeholder="Manufacturer"/>
              <datalist id="sug-man">{(suggests.manufacturer||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Manufacturer ref</label>
              <input list="sug-manref" className="input mt-1" value={createForm.manufacturer_ref} onChange={e=>cf('manufacturer_ref', e.target.value)} placeholder="Reference"/>
              <datalist id="sug-manref">{(suggests.manufacturer_ref||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div className="md:col-span-2">
              <label className="label">ATEX marking</label>
              <input list="sug-atex" className="input mt-1" value={createForm.atex_ref} onChange={e=>cf('atex_ref', e.target.value)} placeholder="e.g., II 2G Ex d IIB T4 Gb"/>
              <datalist id="sug-atex">{(suggests.atex_ref||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Gas zone</label>
              <select className="input mt-1" value={createForm.zone_gas} onChange={e=>cf('zone_gas', e.target.value)}>
                <option value="">—</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
              </select>
            </div>

            <div>
              <label className="label">Dust zone</label>
              <select className="input mt-1" value={createForm.zone_dust} onChange={e=>cf('zone_dust', e.target.value)}>
                <option value="">—</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="label">Comments</label>
              <textarea className="input mt-1" value={createForm.comments} onChange={e=>cf('comments', e.target.value)} placeholder="Notes…" />
            </div>

            <div>
              <label className="label">Last inspection</label>
              {/* native calendar date-picker */}
              <input type="date" className="input mt-1" value={createForm.last_control} onChange={e=>cf('last_control', e.target.value)} />
            </div>

            <div>
              <label className="label">Frequency (months)</label>
              <input type="number" min="1" className="input mt-1" value={createForm.frequency_months} onChange={e=>cf('frequency_months', e.target.value)} />
            </div>

            <div>
              <label className="label">Next inspection</label>
              <input type="date" className="input mt-1" value={createForm.next_control || ''} onChange={e=>cf('next_control', e.target.value)} placeholder="Auto if empty" />
              <div className="text-xs text-gray-600 mt-1">Leave empty to auto-compute (Last inspection + Frequency).</div>
            </div>

            <div className="md:col-span-2">
              <label className="label">Attachments</label>
              <input type="file" multiple className="input mt-1" onChange={(e)=>setFiles(Array.from(e.target.files||[]))} />
              <div className="text-xs text-gray-600 mt-1">{files.length ? `${files.length} file(s) selected` : 'PDF, images… (max 25 MB/file)'}</div>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" className="btn bg-gray-100" onClick={()=>setTab('controls')}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create equipment</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'import' && (
        <div className="card p-6">
          <p className="text-gray-600">Import/Export to be implemented in the next step.</p>
        </div>
      )}

      {tab === 'assessment' && (
        <div className="card p-6">
          <p className="text-gray-600">Risk charts and insights will come later.</p>
        </div>
      )}
    </section>
  );
}
