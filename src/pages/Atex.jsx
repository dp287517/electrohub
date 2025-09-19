// src/pages/Atex.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post, put, del } from '../lib/api.js';

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

export default function Atex() {
  const [tab, setTab] = useState('controls');

  // data
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [fBuilding, setFBuilding] = useState('');
  const [fRoom, setFRoom] = useState('');
  const [fType, setFType] = useState('');
  const [fManufacturer, setFManufacturer] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fGas, setFGas] = useState('');
  const [fDust, setFDust] = useState('');

  // sort
  const [sort, setSort] = useState({ by: 'updated_at', dir: 'desc' });

  // modals/drawers
  const [editItem, setEditItem] = useState(null);
  const [showDelete, setShowDelete] = useState(null);
  const [showAttach, setShowAttach] = useState(null);
  const [aiItem, setAiItem] = useState(null);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // CREATE form
  const [suggests, setSuggests] = useState({ building:[], room:[], component_type:[], manufacturer:[], manufacturer_ref:[], atex_ref:[] });
  const [createForm, setCreateForm] = useState({
    site: '',
    building: '', room: '',
    component_type: '',
    manufacturer: '', manufacturer_ref: '',
    atex_ref: '',
    zone_gas: '', zone_dust: '',
    comments: '',
    last_control: '',
    frequency_months: 36,
    next_control: '',
    attachments: [],
  });
  const [attName, setAttName] = useState('');
  const [attUrl, setAttUrl] = useState('');

  function cf(k, v) { setCreateForm(s => ({ ...s, [k]: v })); }

  // Load list & suggests
  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      if (fBuilding) params.building = fBuilding;
      if (fRoom) params.room = fRoom;
      if (fType) params.component_type = fType;
      if (fManufacturer) params.manufacturer = fManufacturer;
      if (fStatus) params.status = fStatus;
      if (fGas) params.zone_gas = fGas;
      if (fDust) params.zone_dust = fDust;
      if (sort.by) { params.sort = sort.by; params.dir = sort.dir; }
      const data = await get('/api/atex/equipments', params);
      setRows(data || []);
    } catch (e) {
      alert('Chargement impossible: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSuggests() {
    try {
      const s = await get('/api/atex/suggests');
      setSuggests(s || {});
    } catch { /* non-bloquant */ }
  }

  useEffect(() => { load(); }, [sort]); // tri
  useEffect(() => { loadSuggests(); }, []); // au mount

  const unique = useMemo(() => {
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
      alert('Suppression impossible: ' + e.message);
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
      alert('Mise à jour impossible: ' + e.message);
    }
  }

  async function runAI(item) {
    try {
      setAiItem(item); setAiLoading(true); setAiText('');
      const { analysis } = await post(`/api/atex/ai/${item.id}`, {});
      setAiText(analysis);
    } catch (e) {
      setAiText('Analyse impossible: ' + e.message);
    } finally {
      setAiLoading(false);
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
    // cast
    payload.zone_gas = payload.zone_gas ? Number(payload.zone_gas) : null;
    payload.zone_dust = payload.zone_dust ? Number(payload.zone_dust) : null;
    if (!payload.next_control) payload.next_control = computeNextControl();

    try {
      await post('/api/atex/equipments', payload);
      // reset simple
      setCreateForm({
        site: '',
        building: '', room: '',
        component_type: '',
        manufacturer: '', manufacturer_ref: '',
        atex_ref: '',
        zone_gas: '', zone_dust: '',
        comments: '',
        last_control: '',
        frequency_months: 36,
        next_control: '',
        attachments: [],
      });
      setAttName(''); setAttUrl('');
      await load();
      setTab('controls');
      alert('Équipement créé.');
    } catch (e) {
      alert('Création impossible: ' + e.message);
    }
  }

  function addAttachment() {
    if (!attUrl) return;
    cf('attachments', [...(createForm.attachments||[]), { name: attName || attUrl, url: attUrl }]);
    setAttName(''); setAttUrl('');
  }
  function removeAttachment(i) {
    const cp = [...(createForm.attachments||[])];
    cp.splice(i,1); cf('attachments', cp);
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
          {/* Filtres */}
          <div className="card p-4 grid md:grid-cols-4 gap-3">
            <input className="input" placeholder="Recherche textuelle…" value={q} onChange={e=>setQ(e.target.value)} />
            <select className="input" value={fBuilding} onChange={e=>setFBuilding(e.target.value)}>
              <option value="">Bâtiment (tous)</option>
              {unique.buildings.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input" value={fRoom} onChange={e=>setFRoom(e.target.value)}>
              <option value="">Local (tous)</option>
              {unique.rooms.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input" value={fType} onChange={e=>setFType(e.target.value)}>
              <option value="">Type de composant (tous)</option>
              {unique.types.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input" value={fManufacturer} onChange={e=>setFManufacturer(e.target.value)}>
              <option value="">Fabricant (tous)</option>
              {unique.manufacturers.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="input" value={fStatus} onChange={e=>setFStatus(e.target.value)}>
              <option value="">Statut (tous)</option>
              <option>Conforme</option>
              <option>Non conforme</option>
              <option>À vérifier</option>
            </select>
            <select className="input" value={fGas} onChange={e=>setFGas(e.target.value)}>
              <option value="">Zone gaz</option>
              <option value="0">0</option><option value="1">1</option><option value="2">2</option>
            </select>
            <select className="input" value={fDust} onChange={e=>setFDust(e.target.value)}>
              <option value="">Zone poussières</option>
              <option value="20">20</option><option value="21">21</option><option value="22">22</option>
            </select>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={load}>Rechercher</button>
              <button className="btn bg-gray-100" onClick={()=>{
                setQ(''); setFBuilding(''); setFRoom(''); setFType('');
                setFManufacturer(''); setFStatus(''); setFGas(''); setFDust('');
                setSort({by:'updated_at', dir:'desc'}); load();
              }}>Réinitialiser</button>
            </div>
          </div>

          {/* Tableau */}
          <div className="card p-0 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  {[
                    ['building','Bâtiment'],['room','Local'],['component_type','Composant'],
                    ['manufacturer','Fabricant'],['manufacturer_ref','Réf Fabricant'],
                    ['atex_ref','Réf ATEX'],['zone_gas','Zone Gaz'],['zone_dust','Zone Poussière'],
                    ['status','Statut'],['last_control','Dernier contrôle'],['next_control','Prochain contrôle']
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
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">Chargement…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500">Aucun équipement</td></tr>
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
                          <Tag tone={tone}>{dleft==null?'—': dleft<0? `${Math.abs(dleft)} j retard` : `${dleft} j`}</Tag>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button className="btn bg-gray-100" title="Modifier" onClick={()=>setEditItem(r)}>✏️</button>
                          <button className="btn bg-gray-100" title="Supprimer" onClick={()=>setShowDelete(r)}>🗑️</button>
                          <button className="btn bg-gray-100" title="Pièces jointes" onClick={()=>setShowAttach(r)}>📎</button>
                          <button className="btn bg-gray-100" title="Chat IA" onClick={()=>runAI(r)}>🤖</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Modale Edition */}
          {editItem && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-2xl">
                <h3 className="text-xl font-semibold mb-4">Modifier l’équipement #{editItem.id}</h3>
                <form className="grid md:grid-cols-2 gap-4" onSubmit={onSaveEdit}>
                  <input className="input" name="building" defaultValue={editItem.building} placeholder="Bâtiment" required/>
                  <input className="input" name="room" defaultValue={editItem.room} placeholder="Local" required/>
                  <input className="input" name="component_type" defaultValue={editItem.component_type} placeholder="Type de composant" required/>
                  <input className="input" name="manufacturer" defaultValue={editItem.manufacturer} placeholder="Fabricant"/>
                  <input className="input" name="manufacturer_ref" defaultValue={editItem.manufacturer_ref} placeholder="Réf fabricant"/>
                  <input className="input" name="atex_ref" defaultValue={editItem.atex_ref} placeholder="Marquage ATEX"/>
                  <select className="input" name="zone_gas" defaultValue={editItem.zone_gas ?? ''}>
                    <option value="">Zone gaz</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
                  </select>
                  <select className="input" name="zone_dust" defaultValue={editItem.zone_dust ?? ''}>
                    <option value="">Zone poussières</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
                  </select>
                  <select className="input" name="status" defaultValue={editItem.status}>
                    <option>Conforme</option><option>Non conforme</option><option>À vérifier</option>
                  </select>
                  <input className="input" type="date" name="last_control" defaultValue={formatDate(editItem.last_control)} />
                  <input className="input" type="date" name="next_control" defaultValue={formatDate(editItem.next_control)} />
                  <textarea className="input md:col-span-2" name="comments" placeholder="Commentaires" defaultValue={editItem.comments||''}/>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button type="button" className="btn bg-gray-100" onClick={()=>setEditItem(null)}>Annuler</button>
                    <button type="submit" className="btn btn-primary">Enregistrer</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Pop-up Suppression */}
          {showDelete && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-md">
                <h3 className="text-xl font-semibold mb-3">Confirmer la suppression</h3>
                <p className="text-gray-700 mb-6">
                  Supprimer l’équipement <b>#{showDelete.id}</b> — {showDelete.component_type} ({showDelete.building}/{showDelete.room}) ?
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn bg-gray-100" onClick={()=>setShowDelete(null)}>Annuler</button>
                  <button className="btn btn-primary" onClick={()=>onDelete(showDelete.id)}>Supprimer</button>
                </div>
              </div>
            </div>
          )}

          {/* Drawer Pièces jointes */}
          {showAttach && (
            <div className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center p-0 md:p-4">
              <div className="card p-6 w-full md:max-w-xl md:mx-auto md:rounded-2xl rounded-t-2xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-semibold">Pièces jointes – #{showAttach.id}</h3>
                  <button className="btn bg-gray-100" onClick={()=>setShowAttach(null)}>Fermer</button>
                </div>
                <ul className="space-y-2">
                  {(showAttach.attachments || []).length ? (
                    (showAttach.attachments || []).map((a,i)=>(
                      <li key={i} className="flex items-center justify-between">
                        <div className="truncate">{a.name || a.url || `Pièce ${i+1}`}</div>
                        <a className="btn btn-primary" href={a.url} download> Télécharger </a>
                      </li>
                    ))
                  ) : (
                    <li className="text-gray-600">Aucune pièce jointe.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* Modale Chat IA */}
          {aiItem && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
              <div className="card p-6 w-full max-w-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Diagnostic IA – #{aiItem.id}</h3>
                  <button className="btn bg-gray-100" onClick={()=>setAiItem(null)}>Fermer</button>
                </div>
                <div className="mt-4 whitespace-pre-wrap text-gray-800">
                  {aiLoading ? 'Analyse en cours…' : (aiText || '—')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div className="card p-6">
          <form className="grid md:grid-cols-2 gap-4" onSubmit={onCreate}>
            <input className="input" placeholder="Site" value={createForm.site} onChange={e=>cf('site', e.target.value)} />

            <div>
              <label className="label">Bâtiment</label>
              <input list="sug-building" className="input mt-1" value={createForm.building} onChange={e=>cf('building', e.target.value)} placeholder="Bâtiment" required/>
              <datalist id="sug-building">{(suggests.building||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Local</label>
              <input list="sug-room" className="input mt-1" value={createForm.room} onChange={e=>cf('room', e.target.value)} placeholder="Local" required/>
              <datalist id="sug-room">{(suggests.room||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Type de composant</label>
              <input list="sug-type" className="input mt-1" value={createForm.component_type} onChange={e=>cf('component_type', e.target.value)} placeholder="Ex: Moteur" required/>
              <datalist id="sug-type">{(suggests.component_type||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Fabricant</label>
              <input list="sug-man" className="input mt-1" value={createForm.manufacturer} onChange={e=>cf('manufacturer', e.target.value)} placeholder="Fabricant"/>
              <datalist id="sug-man">{(suggests.manufacturer||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Réf Fabricant</label>
              <input list="sug-manref" className="input mt-1" value={createForm.manufacturer_ref} onChange={e=>cf('manufacturer_ref', e.target.value)} placeholder="Référence"/>
              <datalist id="sug-manref">{(suggests.manufacturer_ref||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div className="md:col-span-2">
              <label className="label">Marquage ATEX</label>
              <input list="sug-atex" className="input mt-1" value={createForm.atex_ref} onChange={e=>cf('atex_ref', e.target.value)} placeholder="Ex: II 2G Ex d IIB T4 Gb"/>
              <datalist id="sug-atex">{(suggests.atex_ref||[]).map(v=><option key={v} value={v}/>)}</datalist>
            </div>

            <div>
              <label className="label">Zone ATEX (Gaz)</label>
              <select className="input mt-1" value={createForm.zone_gas} onChange={e=>cf('zone_gas', e.target.value)}>
                <option value="">—</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
              </select>
            </div>

            <div>
              <label className="label">Zone ATEX (Poussières)</label>
              <select className="input mt-1" value={createForm.zone_dust} onChange={e=>cf('zone_dust', e.target.value)}>
                <option value="">—</option><option value="20">20</option><option value="21">21</option><option value="22">22</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="label">Commentaires</label>
              <textarea className="input mt-1" value={createForm.comments} onChange={e=>cf('comments', e.target.value)} placeholder="Commentaires libres…" />
            </div>

            <div>
              <label className="label">Dernière inspection</label>
              <input type="date" className="input mt-1" value={createForm.last_control} onChange={e=>cf('last_control', e.target.value)} />
            </div>

            <div>
              <label className="label">Fréquence (mois)</label>
              <input type="number" min="1" className="input mt-1" value={createForm.frequency_months} onChange={e=>cf('frequency_months', e.target.value)} />
            </div>

            <div>
              <label className="label">Prochain contrôle</label>
              <input type="date" className="input mt-1" value={createForm.next_control || ''} onChange={e=>cf('next_control', e.target.value)} placeholder="Auto si vide" />
              <div className="text-xs text-gray-600 mt-1">Laissez vide pour calcul auto (Dernière inspection + fréquence).</div>
            </div>

            <div className="md:col-span-2">
              <label className="label">Pièces jointes (URL)</label>
              <div className="flex gap-2 mt-1">
                <input className="input flex-1" placeholder="Nom (optionnel)" value={attName} onChange={e=>setAttName(e.target.value)} />
                <input className="input flex-[2]" placeholder="https://… (pdf, photo)" value={attUrl} onChange={e=>setAttUrl(e.target.value)} />
                <button type="button" className="btn bg-gray-100" onClick={addAttachment}>Ajouter</button>
              </div>
              <ul className="mt-2 space-y-1">
                {(createForm.attachments||[]).map((a,i)=>(
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate">{a.name || a.url}</span>
                    <button type="button" className="text-red-600" onClick={()=>removeAttachment(i)}>supprimer</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" className="btn bg-gray-100" onClick={()=>setTab('controls')}>Annuler</button>
              <button type="submit" className="btn btn-primary">Créer l’équipement</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'import' && (
        <div className="card p-6">
          <p className="text-gray-600">Import/Export Excel à l’étape dédiée ✅</p>
        </div>
      )}

      {tab === 'assessment' && (
        <div className="card p-6">
          <p className="text-gray-600">Graphiques & analyse des risques à venir ✅</p>
        </div>
      )}
    </section>
  );
}
