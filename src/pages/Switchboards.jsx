import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';

/** Utilities */
const regimes = ['TN-S','TN-C-S','IT','TT'];

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Pill({ children }) {
  return <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">{children}</span>;
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg border px-2 py-1 text-sm">Close</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const emptyForm = {
  name: '',
  code: '',
  meta: { site: '', building_code: '', floor: '', room: '' },
  regime_neutral: 'TN-S',
  modes: { bypass: false, maintenance_mode: false, bus_coupling: false, genset_backup: false, ups_backup: false },
  quality: { thd: '', flicker: '' }
};

export default function Switchboards() {
  const site = useUserSite();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState({ q:'', building:'', floor:'', room:'', sort:'created_at', dir:'desc', page:1 });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 18;

  const load = async () => {
    const params = { ...q, pageSize, site };
    const data = await get('/api/switchboard/boards', params);
    setRows(data?.data || []);
    setTotal(data?.total || 0);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q.page, q.sort, q.dir]);

  const resetAndOpen = () => {
    setEditing(null);
    setForm({ ...emptyForm, meta: { ...emptyForm.meta, site } });
    setOpen(true);
  };

  const onEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || '',
      code: row.code || '',
      meta: {
        site: row.meta?.site || site,
        building_code: row.meta?.building_code || '',
        floor: row.meta?.floor || '',
        room: row.meta?.room || '',
      },
      regime_neutral: row.regime_neutral || 'TN-S',
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
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await put(`/api/switchboard/boards/${editing.id}`, form);
      } else {
        await post('/api/switchboard/boards', form);
      }
      setOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  const duplicate = async (id) => {
    await post(`/api/switchboard/boards/${id}/duplicate`);
    await load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this switchboard?')) return;
    await del(`/api/switchboard/boards/${id}`);
    await load();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="container-narrow py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Electrical Switchboards</h1>
          <p className="text-sm text-gray-500">Site-scoped to <b>{site || '—'}</b>. Manage location, neutral regime, modes, and quality metrics.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={()=>setQ(p=>({ ...p, page:1 }))}>Refresh</button>
          <button className="btn btn-primary" onClick={resetAndOpen}>+ Switchboard</button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid md:grid-cols-5 gap-3 card p-4">
        <input className="input" placeholder="Search name/code" value={q.q} onChange={e=>setQ(p=>({ ...p, q:e.target.value }))} />
        <input className="input" placeholder="Building" value={q.building} onChange={e=>setQ(p=>({ ...p, building:e.target.value }))} />
        <input className="input" placeholder="Floor" value={q.floor} onChange={e=>setQ(p=>({ ...p, floor:e.target.value }))} />
        <input className="input" placeholder="Room" value={q.room} onChange={e=>setQ(p=>({ ...p, room:e.target.value }))} />
        <button className="btn" onClick={()=>setQ(p=>({ ...p, page:1 }))}>Apply</button>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map(row => (
          <div key={row.id} className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{row.name} <span className="text-gray-400">({row.code})</span></h3>
                <p className="text-xs text-gray-500">{row.meta?.site} • {row.meta?.building_code} • {row.meta?.floor} • {row.meta?.room}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill>Neutral: {row.regime_neutral}</Pill>
                  {'quality' in row && row.quality?.thd !== null && row.quality?.thd !== undefined && row.quality?.thd !== '' ? <Pill>THD: {row.quality.thd}%</Pill> : null}
                  {'quality' in row && row.quality?.flicker !== null && row.quality?.flicker !== undefined && row.quality?.flicker !== '' ? <Pill>Flicker: {row.quality.flicker}</Pill> : null}
                  {row.modes?.bypass ? <Pill>Bypass</Pill> : null}
                  {row.modes?.maintenance_mode ? <Pill>Maintenance</Pill> : null}
                  {row.modes?.bus_coupling ? <Pill>Bus Coupling</Pill> : null}
                  {row.modes?.genset_backup ? <Pill>GEN Backup</Pill> : null}
                  {row.modes?.ups_backup ? <Pill>UPS Backup</Pill> : null}
                </div>
              </div>
              <div className="flex gap-1">
                <button className="icon-btn" title="Edit" onClick={()=>onEdit(row)}>✏️</button>
                <button className="icon-btn" title="Duplicate" onClick={()=>duplicate(row.id)}>⎘</button>
                <button className="icon-btn" title="Delete" onClick={()=>remove(row.id)}>🗑️</button>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <a href={`/app/fault-level?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Fault Level</a>
              <a href={`/app/arc-flash?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Arc-Flash</a>
              <a href={`/app/selectivity?switchboard=${row.id}`} className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs">Selectivity</a>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-sm text-gray-500">Total: {total}</div>
        <div className="flex items-center gap-2">
          <button className="btn" disabled={q.page<=1} onClick={()=>setQ(p=>({ ...p, page:p.page-1 }))}>Prev</button>
          <span className="text-sm">Page {q.page} / {totalPages}</span>
          <button className="btn" disabled={q.page>=totalPages} onClick={()=>setQ(p=>({ ...p, page:p.page+1 }))}>Next</button>
        </div>
      </div>

      {/* Modal form */}
      <Modal open={open} onClose={()=>setOpen(false)} title={editing ? 'Edit switchboard' : 'Create switchboard'}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={e=>setForm(f=>({ ...f, name:e.target.value }))} />
          </div>
          <div>
            <label className="label">Code</label>
            <input className="input" value={form.code} onChange={e=>setForm(f=>({ ...f, code:e.target.value }))} placeholder="e.g., LVB-A-01" />
          </div>

          <div>
            <label className="label">Building</label>
            <input className="input" value={form.meta.building_code} onChange={e=>setForm(f=>({ ...f, meta:{...f.meta, building_code:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Floor</label>
            <input className="input" value={form.meta.floor} onChange={e=>setForm(f=>({ ...f, meta:{...f.meta, floor:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Room</label>
            <input className="input" value={form.meta.room} onChange={e=>setForm(f=>({ ...f, meta:{...f.meta, room:e.target.value} }))} />
          </div>

          <div>
            <label className="label">Neutral regime</label>
            <select className="input" value={form.regime_neutral} onChange={e=>setForm(f=>({ ...f, regime_neutral:e.target.value }))}>
              {regimes.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2 grid grid-cols-2 gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.modes.bypass} onChange={e=>setForm(f=>({ ...f, modes:{...f.modes, bypass:e.target.checked} }))} /> Bypass
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.modes.maintenance_mode} onChange={e=>setForm(f=>({ ...f, modes:{...f.modes, maintenance_mode:e.target.checked} }))} /> Maintenance mode
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.modes.bus_coupling} onChange={e=>setForm(f=>({ ...f, modes:{...f.modes, bus_coupling:e.target.checked} }))} /> Bus coupling
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.modes.genset_backup} onChange={e=>setForm(f=>({ ...f, modes:{...f.modes, genset_backup:e.target.checked} }))} /> GEN backup
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.modes.ups_backup} onChange={e=>setForm(f=>({ ...f, modes:{...f.modes, ups_backup:e.target.checked} }))} /> UPS backup
            </label>
          </div>

          <div>
            <label className="label">THD (%)</label>
            <input className="input" value={form.quality.thd} onChange={e=>setForm(f=>({ ...f, quality:{...f.quality, thd:e.target.value} }))} />
          </div>
          <div>
            <label className="label">Flicker</label>
            <input className="input" value={form.quality.flicker} onChange={e=>setForm(f=>({ ...f, quality:{...f.quality, flicker:e.target.value} }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={()=>setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !form.name || !form.code} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>
    </section>
  );
}
