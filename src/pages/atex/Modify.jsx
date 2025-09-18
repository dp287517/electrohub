import { useEffect, useState } from 'react';
import { AtexApi } from '../../lib/atexApi';

const GAS = [0,1,2];
const DUST = [20,21,22];
const CATG = ['1G','2G','3G'];
const CATD = ['1D','2D','3D'];

export default function Modify({ id }){
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load(){
    const list = await AtexApi.list({});
    setItems(list);
    if (id){
      const found = list.find(x=>x.id===id);
      setSel(found || null);
    }
  }
  useEffect(()=>{ load(); },[id]);

  function h(k,v){ setSel(s=> ({...s, [k]: v})); }

  async function save(){
    setBusy(true);
    const p = { ...sel };
    await AtexApi.update(sel.id, p);
    setBusy(false);
    alert('Modifié');
  }
  async function remove(){
    if (!sel) return;
    if (!confirm('Supprimer cet équipement ?')) return;
    await AtexApi.remove(sel.id);
    setSel(null);
    await load();
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <input className="border rounded px-3 py-2 w-full mb-2" placeholder="Filtrer..." onChange={async e=> setItems(await AtexApi.list({ q: e.target.value }))} />
        <div className="max-h-[70vh] overflow-auto divide-y border rounded">
          {items.map(it => (
            <div key={it.id} className={"p-2 cursor-pointer " + (sel?.id===it.id ? 'bg-gray-100' : '')}
                 onClick={()=> setSel(it)}>
              <div className="font-medium">{it.reference}</div>
              <div className="text-xs text-gray-600">{it.brand} • {it.building}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="md:col-span-2">
        {sel ? (
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="border rounded px-3 py-2" value={sel.reference||''} onChange={e=>h('reference', e.target.value)} />
              <input className="border rounded px-3 py-2" value={sel.brand||''} onChange={e=>h('brand', e.target.value)} />
            </div>
            <input className="border rounded px-3 py-2" value={sel.designation||''} onChange={e=>h('designation', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="border rounded px-3 py-2" value={sel.atex_reference||''} onChange={e=>h('atex_reference', e.target.value)} />
              <input className="border rounded px-3 py-2" value={sel.marking||''} onChange={e=>h('marking', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="border rounded px-3 py-2" value={sel.building||''} onChange={e=>h('building', e.target.value)} />
              <input className="border rounded px-3 py-2" value={sel.room||''} onChange={e=>h('room', e.target.value)} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <select className="border rounded px-3 py-2" value={sel.category_g||''} onChange={e=>h('category_g', e.target.value||null)}>
                <option value="">Catégorie G</option>
                {CATG.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="border rounded px-3 py-2" value={sel.category_d||''} onChange={e=>h('category_d', e.target.value||null)}>
                <option value="">Catégorie D</option>
                {CATD.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="border rounded px-3 py-2" value={sel.zone_gas??''} onChange={e=>h('zone_gas', e.target.value===''? null: Number(e.target.value))}>
                <option value="">Zone gaz</option>
                {GAS.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="border rounded px-3 py-2" value={sel.zone_dust??''} onChange={e=>h('zone_dust', e.target.value===''? null: Number(e.target.value))}>
                <option value="">Zone poussière</option>
                {DUST.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className="border rounded px-3 py-2" value={sel.last_inspection_date||''} onChange={e=>h('last_inspection_date', e.target.value||null)} />
              <input className="border rounded px-3 py-2" value={sel.comments||''} onChange={e=>h('comments', e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={save} disabled={busy}>Enregistrer</button>
              <button className="px-4 py-2 rounded bg-red-600 text-white" onClick={remove} disabled={busy}>Supprimer</button>
            </div>
          </div>
        ) : <div className="text-gray-600">Sélectionnez un équipement</div>}
      </div>
    </div>
  );
}
