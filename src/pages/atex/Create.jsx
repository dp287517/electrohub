import { useState } from 'react';
import { AtexApi } from '../../lib/atexApi';

const GAS = [0,1,2];
const DUST = [20,21,22];
const CATG = ['1G','2G','3G'];
const CATD = ['1D','2D','3D'];

export default function Create({ onCreated }){
  const [form, setForm] = useState({ reference:'', brand:'', designation:'', atex_reference:'', marking:'', building:'', room:'', zone_gas:'', zone_dust:'', category_g:'', category_d:'', last_inspection_date:'', comments:'' });
  const [busy, setBusy] = useState(false);
  function h(k,v){ setForm(s=> ({...s, [k]: v})); }
  async function submit(){
    setBusy(true);
    const payload = {
      ...form,
      zone_gas: form.zone_gas===''? null: Number(form.zone_gas),
      zone_dust: form.zone_dust===''? null: Number(form.zone_dust),
      category_g: form.category_g || null,
      category_d: form.category_d || null,
      last_inspection_date: form.last_inspection_date || null
    };
    const r = await AtexApi.create(payload);
    setBusy(false);
    alert('Équipement créé');
    onCreated && onCreated(r.id);
  }
  return (
    <div className="grid gap-3 max-w-3xl">
      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded px-3 py-2" placeholder="Référence *" value={form.reference} onChange={e=>h('reference', e.target.value)} />
        <input className="border rounded px-3 py-2" placeholder="Marque *" value={form.brand} onChange={e=>h('brand', e.target.value)} />
      </div>
      <input className="border rounded px-3 py-2" placeholder="Désignation / Type *" value={form.designation} onChange={e=>h('designation', e.target.value)} />
      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded px-3 py-2" placeholder="Réf. ATEX (facultatif)" value={form.atex_reference} onChange={e=>h('atex_reference', e.target.value)} />
        <input className="border rounded px-3 py-2" placeholder="Marquage (facultatif)" value={form.marking} onChange={e=>h('marking', e.target.value)} />
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded px-3 py-2" placeholder="Bâtiment *" value={form.building} onChange={e=>h('building', e.target.value)} />
        <input className="border rounded px-3 py-2" placeholder="Local" value={form.room} onChange={e=>h('room', e.target.value)} />
      </div>
      <div className="grid md:grid-cols-4 gap-2">
        <select className="border rounded px-3 py-2" value={form.category_g} onChange={e=>h('category_g', e.target.value)}>
          <option value="">Catégorie G</option>
          {CATG.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={form.category_d} onChange={e=>h('category_d', e.target.value)}>
          <option value="">Catégorie D</option>
          {CATD.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={form.zone_gas} onChange={e=>h('zone_gas', e.target.value)}>
          <option value="">Zone gaz</option>
          {GAS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className="border rounded px-3 py-2" value={form.zone_dust} onChange={e=>h('zone_dust', e.target.value)}>
          <option value="">Zone poussière</option>
          {DUST.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        <input type="date" className="border rounded px-3 py-2" value={form.last_inspection_date} onChange={e=>h('last_inspection_date', e.target.value)} />
        <input className="border rounded px-3 py-2" placeholder="Commentaire" value={form.comments} onChange={e=>h('comments', e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={submit} disabled={busy || !form.reference || !form.brand || !form.designation || !form.building}>Créer</button>
      </div>
    </div>
  );
}
