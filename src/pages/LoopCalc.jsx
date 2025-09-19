// src/pages/LoopCalc.jsx
import { useEffect, useMemo, useState } from 'react';

// Local helpers (on évite la dépendance à lib/api.js pour être autonome)
async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(path, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function LoopCalc() {
  const [form, setForm] = useState({
    project: '',
    voltage: 24,
    cableType: 'Standard',
    resistance: 20,     // Ω/km
    capacitance: 200,   // nF/km
    inductance: 0.5,    // mH/km
    distance: 100,      // m
    maxCurrent: 0.02,   // A
    safetyFactor: 1.5,
  });
  const [result, setResult] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // List state (filters/sort/pagination)
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(''); // '', 'Compliant', 'Non-compliant'
  const [sort, setSort] = useState('created_at'); // created_at | project | voltage | distance | compliance
  const [dir, setDir] = useState('desc');         // asc | desc
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  function cf(k, v) { setForm(s => ({ ...s, [k]: v })); }

  async function loadList() {
    const params = new URLSearchParams({ page, pageSize, sort, dir });
    if (q) params.set('q', q);
    if (filter) params.set('compliance', filter);
    const data = await apiGet(`/api/loopcalc/calculations?${params.toString()}`);
    setRows(data.data || []);
    setTotal(data.total || 0);
  }

  async function calculate() {
    const r = await apiPost('/api/loopcalc/calculations', form);
    setResult(r);
    setPage(1);
    await loadList();
  }

  async function loadForEdit(id) {
    try {
      const data = await apiGet(`/api/loopcalc/calculations/${id}`);
      setForm({
        project: data.project || '',
        voltage: data.voltage,
        cableType: data.cable_type || 'Standard',
        resistance: data.resistance,
        capacitance: data.capacitance,
        inductance: data.inductance,
        distance: data.distance,
        maxCurrent: data.max_current,
        safetyFactor: data.safety_factor,
      });
      setEditingId(id);
      setResult(null); // Clear previous result
    } catch (e) {
      console.error('Load for edit failed:', e);
    }
  }

  async function updateCalculation() {
    try {
      const payload = {
        project: form.project || null,
        voltage: Number(form.voltage),
        cableType: String(form.cableType || ''),
        resistance: Number(form.resistance),
        capacitance: Number(form.capacitance),
        inductance: Number(form.inductance),
        distance: Number(form.distance),
        maxCurrent: Number(form.maxCurrent),
        safetyFactor: Number(form.safetyFactor)
      };
      
      const r = await apiPatch(`/api/loopcalc/calculations/${editingId}`, payload);
      setResult(r);
      setEditingId(null);
      setForm({
        project: '',
        voltage: 24,
        cableType: 'Standard',
        resistance: 20,
        capacitance: 200,
        inductance: 0.5,
        distance: 100,
        maxCurrent: 0.02,
        safetyFactor: 1.5,
      });
      await loadList();
    } catch (e) {
      console.error('Update failed:', e);
    }
  }

  async function deleteCalculation(id) {
    if (!confirm('Are you sure you want to delete this calculation?')) return;
    
    try {
      await apiDelete(`/api/loopcalc/calculations/${id}`);
      if (editingId === id) {
        setEditingId(null);
        setForm({
          project: '',
          voltage: 24,
          cableType: 'Standard',
          resistance: 20,
          capacitance: 200,
          inductance: 0.5,
          distance: 100,
          maxCurrent: 0.02,
          safetyFactor: 1.5,
        });
        setResult(null);
      }
      await loadList();
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Failed to delete calculation');
    }
  }

  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [q, filter, sort, dir, page, pageSize]);

  const changeSort = (col) => {
    if (sort === col) setDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setDir('asc'); }
  };

  const isEditing = editingId !== null;

  return (
    <section className="container-narrow py-8">
      <h1 className="text-3xl font-bold mb-6">Loop Calculation</h1>

      {/* Inputs */}
      <div className="card p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-semibold">{isEditing ? 'Edit Calculation' : 'Inputs'}</h2>
          {isEditing && (
            <div className="flex gap-2">
              <button 
                className="btn bg-gray-100 hover:bg-gray-200 text-sm px-3 py-1" 
                onClick={() => {
                  setEditingId(null);
                  setForm({
                    project: '',
                    voltage: 24,
                    cableType: 'Standard',
                    resistance: 20,
                    capacitance: 200,
                    inductance: 0.5,
                    distance: 100,
                    maxCurrent: 0.02,
                    safetyFactor: 1.5,
                  });
                  setResult(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Project name</label>
            <input className="input mt-1" value={form.project} onChange={e=>cf('project', e.target.value)} />
          </div>
          <div>
            <label className="label">Source voltage (V)</label>
            <input type="number" className="input mt-1" value={form.voltage} onChange={e=>cf('voltage', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Cable type</label>
            <select className="input mt-1" value={form.cableType} onChange={e=>cf('cableType', e.target.value)}>
              <option>Standard</option>
              <option>Shielded</option>
              <option>Low capacitance</option>
            </select>
          </div>
          <div>
            <label className="label">Distance (m)</label>
            <input type="number" className="input mt-1" value={form.distance} onChange={e=>cf('distance', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Resistance (Ω/km)</label>
            <input type="number" className="input mt-1" value={form.resistance} onChange={e=>cf('resistance', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Capacitance (nF/km)</label>
            <input type="number" className="input mt-1" value={form.capacitance} onChange={e=>cf('capacitance', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Inductance (mH/km)</label>
            <input type="number" className="input mt-1" value={form.inductance} onChange={e=>cf('inductance', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Max current (A)</label>
            <input type="number" step="0.001" className="input mt-1" value={form.maxCurrent} onChange={e=>cf('maxCurrent', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Safety factor</label>
            <input type="number" step="0.1" className="input mt-1" value={form.safetyFactor} onChange={e=>cf('safetyFactor', Number(e.target.value))} />
          </div>
        </div>
        <div className="flex justify-end mt-4 gap-2">
          <button className="btn bg-gray-100" onClick={()=>setForm({ ...form })}>Reset</button>
          {isEditing ? (
            <button className="btn btn-primary" onClick={updateCalculation}>Update & Save</button>
          ) : (
            <button className="btn btn-primary" onClick={calculate}>Calculate & Save</button>
          )}
        </div>
      </div>

      {result && (
        <div className="card p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Last result</h2>
          <div className={`px-4 py-2 rounded text-white ${result.compliance==='Compliant'?'bg-green-500':'bg-red-500'}`}>
            {result.compliance}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3 items-center">
          <input
            className="input"
            placeholder="Search (project, cable)"
            value={q}
            onChange={e=>{ setQ(e.target.value); setPage(1); }}
          />
          <select
            className="input"
            value={filter}
            onChange={e=>{ setFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="Compliant">Compliant</option>
            <option value="Non-compliant">Non-compliant</option>
          </select>
        </div>
      </div>

      {/* History table */}
      <div className="card p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold">Calculations history</h2>
          <div className="text-sm text-gray-600">{total} records</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {[
                  ['created_at','Date'],
                  ['project','Project'],
                  ['voltage','Voltage (V)'],
                  ['distance','Distance (m)'],
                  ['compliance','Compliance'],
                ].map(([key,label])=>(
                  <th
                    key={key}
                    className="px-3 py-2 text-left cursor-pointer select-none whitespace-nowrap"
                    onClick={()=>changeSort(key)}
                  >
                    {label}{sort===key ? (dir==='asc'?' ▲':' ▼') : ''}
                  </th>
                ))}
                <th className="px-3 py-2 text-left whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-xs">{new Date(r.created_at).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500">{new Date(r.created_at).toLocaleTimeString()}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="max-w-32 truncate" title={r.project || '—'}>
                      {r.project || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.voltage}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.distance}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${r.compliance==='Compliant'?'text-green-600 font-medium':'text-red-600 font-medium'}`}>
                    {r.compliance}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        className="btn bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                        onClick={() => loadForEdit(r.id)}
                        title="Edit calculation"
                        disabled={editingId !== null}
                      >
                        Edit
                      </button>
                      <a
                        className="btn bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded transition-colors"
                        href={`/api/loopcalc/${r.id}/report`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open professional PDF report"
                      >
                        PDF
                      </a>
                      <button
                        className="btn bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded transition-colors"
                        onClick={() => deleteCalculation(r.id)}
                        title="Delete calculation"
                        disabled={editingId !== null}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length===0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-600">Page {page} / {totalPages}</div>
          <div className="flex gap-2">
            <button className="btn bg-gray-100" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>
              Prev
            </button>
            <button className="btn bg-gray-100" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
