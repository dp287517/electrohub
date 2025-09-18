import { useEffect, useMemo, useState } from 'react';
import { AtexApi } from '../../lib/atexApi';

const GAS = [0,1,2];
const DUST = [20,21,22];
const CATG = ['1G','2G','3G'];
const CATD = ['1D','2D','3D'];

export default function Controls({ onModify }){
  const [filters, setFilters] = useState({ q:'', building:'', zone_gas:'', zone_dust:'', category_g:'', category_d:'', status:'' });
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState({ col:'updated_at', dir:'desc' });
  const [page, setPage] = useState(1);

  async function load(){
    const data = await AtexApi.list({ ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!=='')), sort: `${sort.col}:${sort.dir}`, page });
    setRows(data);
  }
  useEffect(()=>{ load(); }, [sort, page]);

  const buildings = useMemo(()=> Array.from(new Set(rows.map(r=>r.building))).sort(), [rows]);

  function changeSort(col){
    setSort(s => s.col===col ? ({ col, dir: s.dir==='asc'?'desc':'asc' }) : ({ col, dir:'asc' }));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input className="border rounded px-3 py-2" placeholder="Recherche (réf/marque/désignation)" value={filters.q} onChange={e=>setFilters(s=>({...s,q:e.target.value}))} />
        <select className="border rounded px-3 py-2" value={filters.building} onChange={e=>setFilters(s=>({...s,building:e.target.value}))}>
          <option value="">Bâtiment</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={filters.zone_gas} onChange={e=>setFilters(s=>({...s,zone_gas:e.target.value}))}>
          <option value="">Zone gaz</option>
          {GAS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={filters.zone_dust} onChange={e=>setFilters(s=>({...s,zone_dust:e.target.value}))}>
          <option value="">Zone poussière</option>
          {DUST.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={filters.category_g} onChange={e=>setFilters(s=>({...s,category_g:e.target.value}))}>
          <option value="">Cat. G</option>
          {CATG.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={filters.category_d} onChange={e=>setFilters(s=>({...s,category_d:e.target.value}))}>
          <option value="">Cat. D</option>
          {CATD.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <select className="border rounded px-3 py-2" value={filters.status} onChange={e=>setFilters(s=>({...s,status:e.target.value}))}>
          <option value="">Tous</option>
          <option value="compliant">Conformes</option>
          <option value="noncompliant">Non conformes</option>
        </select>
        <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={()=>{ setPage(1); load(); }}>Appliquer</button>
        <button className="px-3 py-2 rounded border" onClick={()=>{ setFilters({ q:'', building:'', zone_gas:'', zone_dust:'', category_g:'', category_d:'', status:''}); setPage(1); load(); }}>Réinitialiser</button>
      </div>

      <div className="overflow-auto border rounded">
        <table className="min-w-[960px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['reference','brand','designation','building','room','zone','category','last_inspection_date','next_due_date','status','actions'].map((h, idx)=>(
                <th key={idx} className="text-left px-3 py-2 font-medium uppercase tracking-wide">
                  {['actions','status','zone','category'].includes(h) ? h.replace('_',' ') :
                    <button onClick={()=> changeSort(h==='reference'?'reference': h==='brand'?'brand': h==='building'?'building': h==='last_inspection_date'?'last_inspection_date': h==='next_due_date'?'next_due_date':'updated_at')}>
                      {h.replace('_',' ')}
                    </button>
                  }
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-medium">{r.reference}</td>
                <td className="px-3 py-2">{r.brand}</td>
                <td className="px-3 py-2">{r.designation}</td>
                <td className="px-3 py-2">{r.building}</td>
                <td className="px-3 py-2">{r.room || '—'}</td>
                <td className="px-3 py-2">{(r.zone_gas ?? '—') + ' / ' + (r.zone_dust ?? '—')}</td>
                <td className="px-3 py-2">{(r.category_g || '—') + ' / ' + (r.category_d || '—')}</td>
                <td className="px-3 py-2">{r.last_inspection_date || '—'}</td>
                <td className="px-3 py-2">{r.next_due_date || '—'}</td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-2 py-1 rounded text-xs " + (r.compliant ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                    {r.compliant ? "Conforme" : "Non conforme"}
                  </span>
                </td>
                <td className="px-3 py-2 space-x-2">
                  {!r.compliant && <button className="px-2 py-1 rounded border" onClick={async()=>{
                    const a = await AtexApi.assist(r.id); alert(a.answer || a.message || 'OK');
                  }}>IA</button>}
                  <button className="px-2 py-1 rounded border" onClick={()=> onModify(r.id)}>Modifier</button>
                  <button className="px-2 py-1 rounded border bg-red-600 text-white" onClick={async()=>{
                    if (!confirm('Supprimer ?')) return;
                    await AtexApi.remove(r.id); await load();
                  }}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button className="px-3 py-1 rounded border" onClick={()=> setPage(p=> Math.max(1,p-1))}>Préc.</button>
        <div className="text-sm">Page {page}</div>
        <button className="px-3 py-1 rounded border" onClick={()=> setPage(p=> p+1)}>Suiv.</button>
      </div>
    </div>
  );
}
