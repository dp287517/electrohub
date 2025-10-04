// src/pages/Project.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api.js';
import { Plus, UploadCloud, BarChart3, AlertTriangle, CheckCircle2, XCircle, Paperclip, Bot } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const inputCls = 'w-full bg-white border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary = 'px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';

function DropInput({ label = 'Glissez-déposez ou cliquez', onFiles, accept = undefined, multiple = true }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e)=>{e.preventDefault(); setDrag(true);}}
      onDragLeave={() => setDrag(false)}
      onDrop={(e)=>{ e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files||[]); if (files.length) onFiles(files); }}
      className={`cursor-pointer border-2 rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${drag? 'border-blue-500 bg-blue-50':'border-dashed border-gray-300 bg-white'}`}
    >
      <UploadCloud /><span>{label}</span>
      <input type="file" className="hidden" multiple={multiple} accept={accept} onChange={e=>{ const files = Array.from(e.target.files||[]); if (files.length) onFiles(files); }} />
    </label>
  );
}

export default function Project() {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null); // project row
  const [status, setStatus] = useState(null);
  const [lines, setLines] = useState({ offers: [], orders: [], invoices: [] });
  const [analysis, setAnalysis] = useState(null);
  const [aiAnswer, setAiAnswer] = useState('');

  useEffect(()=>{ load(); },[]);

  async function load() {
    try {
      setBusy(true);
      const data = await get('/api/projects/projects', q? { q } : undefined);
      setList(data?.data || []);
    } finally { setBusy(false); }
  }

  async function create() {
    const name = title.trim();
    if (!name) return;
    try {
      setBusy(true);
      const row = await post('/api/projects/projects', { title: name });
      setTitle('');
      setQ('');                         // évite que le filtre masque le nouveau projet
      setList(s => [row, ...s]);        // feedback immédiat dans la grille
      await openProject(row);           // ouvre la fiche nouvellement créée
    } catch (e) {
      console.error(e);
      alert('Création impossible : ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(p) {
    setSelected(p);
    const s = await get(`/api/projects/projects/${p.id}/status`);
    setStatus(s || {});
    const l = await get(`/api/projects/projects/${p.id}/lines`);
    setLines(l || {offers:[],orders:[],invoices:[]});
    const a = await get(`/api/projects/projects/${p.id}/analysis`);
    setAnalysis(a || null);
  }

  async function uploadFiles(p, category, files) {
    for (const file of files) {
      const fd = new FormData(); fd.append('file', file);
      // utiliser post() pour conserver l'en-tête X-Site côté client
      await post(`/api/projects/projects/${p.id}/upload?category=${encodeURIComponent(category)}`, fd);
    }
    await openProject(p);
  }

  async function addLine(kind, amount, vendor) {
    if (!selected) return;
    await post(`/api/projects/projects/${selected.id}/${kind}`, { amount: Number(amount), vendor: vendor || null });
    await openProject(selected);
  }

  async function toggleStatus(key) {
    if (!selected) return;
    const next = { ...(status || {}) };
    next[key] = !next[key];
    const upd = await fetch(`/api/projects/projects/${selected.id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(next), credentials:'include' });
    const js = await upd.json();
    setStatus(js);
  }

  async function askAI(question) {
    if (!selected) return;
    const r = await post(`/api/projects/projects/${selected.id}/assistant`, { question });
    setAiAnswer(r?.answer || '');
  }

  const filtered = useMemo(() => {
    const s = (list||[]).filter(p => !q ? true : (p.title||'').toLowerCase().includes(q.toLowerCase()));
    return s;
  }, [list, q]);

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2"><BarChart3/> Project Manager</h1>
        <p className="text-gray-600">Cartes type « carte bancaire », gestion financière (offres, commandes, factures), WBS, pièces jointes en drag-&-drop, audit, KPI, alertes, IA.</p>
      </header>

      <div className="flex gap-2 flex-wrap items-center mb-4">
        <input className={inputCls} placeholder="Filtrer par titre…" value={q} onChange={e=>setQ(e.target.value)} />
        <input
          className={inputCls}
          placeholder="Nouveau projet"
          value={title}
          onChange={e=>setTitle(e.target.value)}
          onKeyDown={(e)=>{ if(e.key==='Enter') create(); }}
        />
        <button className={btnPrimary} onClick={create} disabled={busy || !title.trim()}>
          <Plus className="inline mr-1"/>Créer
        </button>
        <button className={btn} onClick={load} disabled={busy}>Rafraîchir</button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => {
          const k = p.kpi || {}; const st = p.status || {}; const health = st?.last_analysis?.health || 'ok';
          const color = health==='critical' ? 'ring-rose-300' : health==='warn' ? 'ring-amber-300' : 'ring-emerald-300';
          return (
            <div key={p.id} className={`relative p-4 rounded-2xl border bg-white shadow-sm ring-2 ${color}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{p.title}</div>
                  <div className="text-xs text-gray-500">WBS : {p.wbs_number || '—'} · Budget : {p.budget_amount || '—'}</div>
                </div>
                <button className="text-blue-600 hover:underline" onClick={()=>openProject(p)}>Voir</button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-gray-50"><div className="text-gray-500">Offres</div><div className="font-semibold">{(k.offers_total||0).toLocaleString()} €</div></div>
                <div className="p-2 rounded bg-gray-50"><div className="text-gray-500">Commandes</div><div className="font-semibold">{(k.orders_total||0).toLocaleString()} €</div></div>
                <div className="p-2 rounded bg-gray-50"><div className="text-gray-500">Factures</div><div className="font-semibold">{(k.invoices_total||0).toLocaleString()} €</div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-gray-600">
                {st.business_case_done ? <CheckCircle2 className="text-emerald-600" size={14}/> : <XCircle className="text-rose-600" size={14}/>} Business case
                {st.pip_done ? <CheckCircle2 className="text-emerald-600 ml-2" size={14}/> : <XCircle className="text-rose-600 ml-2" size={14}/>} PIP
                {st.offers_received ? <CheckCircle2 className="text-emerald-600 ml-2" size={14}/> : <XCircle className="text-rose-600 ml-2" size={14}/>} Offres
                {st.wbs_recorded ? <CheckCircle2 className="text-emerald-600 ml-2" size={14}/> : <XCircle className="text-rose-600 ml-2" size={14}/>} WBS
                {st.orders_placed ? <CheckCircle2 className="text-emerald-600 ml-2" size={14}/> : <XCircle className="text-rose-600 ml-2" size={14}/>} Commandes
                {st.invoices_received ? <CheckCircle2 className="text-emerald-600 ml-2" size={14}/> : <XCircle className="text-rose-600 ml-2" size={14}/>} Factures
              </div>
            </div>
          );
        })}
      </div>

      {/* Drawer simple */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" onClick={()=>setSelected(null)}>
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-semibold">{selected.title}</h3>
              <button className="text-gray-600 hover:underline" onClick={()=>setSelected(null)}>Fermer</button>
            </div>

            <div className="p-6 grid gap-6">
              {/* Étapes + pièces jointes */}
              <div>
                <h4 className="font-semibold mb-2">Étapes & pièces jointes</h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    ['business_case','Business case'],
                    ['pip','PIP'],
                    ['offer','Offres (PDF, emails…)'],
                    ['wbs','WBS / Budget'],
                    ['order','Commandes'],
                    ['invoice','Factures'],
                  ].map(([key,label]) => (
                    <div key={key} className="p-3 rounded border bg-gray-50">
                      <div className="text-sm font-medium mb-2 flex items-center gap-2"><Paperclip size={16}/>{label}</div>
                      <DropInput label="Glisser des fichiers ici" onFiles={(files)=>uploadFiles(selected, key, files)} accept={'.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'} multiple/>
                      <div className="mt-2 text-xs text-gray-500">Les fichiers sont historisés et cochera automatiquement l’étape correspondante.</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* WBS & Budget */}
              <div className="grid sm:grid-cols-3 gap-3">
                <input className={inputCls} placeholder="N° WBS" defaultValue={selected.wbs_number||''} onBlur={async (e)=>{ await fetch(`/api/projects/projects/${selected.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ wbs_number: e.target.value }), credentials:'include' }); await openProject(selected); }} />
                <input className={inputCls} placeholder="Montant budget (€)" type="number" defaultValue={selected.budget_amount||''} onBlur={async (e)=>{ await fetch(`/api/projects/projects/${selected.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ budget_amount: Number(e.target.value)||null }), credentials:'include' }); await openProject(selected); }} />
                <div className="flex items-center gap-2">
                  <label className="text-sm">Jalons (prépa, démarrage, clôture)</label>
                </div>
              </div>

              {/* Lignes financières */}
              <div className="grid sm:grid-cols-3 gap-3">
                <AddLine title="Ajouter une offre" onSubmit={(amount,vendor)=>addLine('offer',amount,vendor)} />
                <AddLine title="Ajouter une commande" onSubmit={(amount,vendor)=>addLine('order',amount,vendor)} />
                <AddLine title="Ajouter une facture" onSubmit={(amount,vendor)=>addLine('invoice',amount,vendor)} />
              </div>

              {/* KPI & Graph */}
              <ProjectCharts analysis={analysis} lines={lines} />

              {/* Alertes (dépassement vs offres/factures) */}
              <Alerts analysis={analysis} />

              {/* Assistant IA */}
              <div className="p-4 rounded border bg-indigo-50">
                <div className="font-semibold mb-2 flex items-center gap-2"><Bot/> Assistant OpenAI</div>
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Pose une question (ex: où est le risque de dépassement ?)" onKeyDown={e=>{ if(e.key==='Enter') askAI(e.currentTarget.value); }} />
                  <button className={btn} onClick={()=>askAI('Analyse rapide des risques et actions priorisées')}>Conseil rapide</button>
                </div>
                {aiAnswer && <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{aiAnswer}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AddLine({ title, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  return (
    <div className="p-3 rounded border bg-white">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Montant €" type="number" value={amount} onChange={e=>setAmount(e.target.value)} />
        <input className={inputCls} placeholder="Fournisseur (optionnel)" value={vendor} onChange={e=>setVendor(e.target.value)} />
        <button className={btnPrimary} onClick={()=>{ if(!amount) return; onSubmit(amount, vendor); setAmount(''); setVendor(''); }}>Ajouter</button>
      </div>
    </div>
  );
}

function formatMonth(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getFullYear()).slice(-2)}`;
}

function ProjectCharts({ analysis, lines }) {
  // Construire des labels mensuels sans adapter "time"
  const data = useMemo(()=>{
    const inv = (lines?.invoices||[]).slice().reverse();
    let cum = 0;
    const labels = [];
    const values = [];
    for (const x of inv) {
      cum += Number(x.amount) || 0;
      labels.push(formatMonth(x.invoiced_at || Date.now()));
      values.push(cum);
    }
    return {
      labels,
      datasets: [{ label: 'Cumul factures (€)', data: values, tension: 0.2 }]
    };
  }, [lines]);

  return (
    <div className="grid gap-4">
      <div className="p-4 rounded border bg-white">
        <div className="font-semibold mb-2">Courbe cumulative des factures</div>
        <Line data={data} options={{ responsive:true, scales:{ y:{ beginAtZero:true }}}} />
      </div>
      {analysis && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Offres</div>
            <div className="text-xl font-semibold">{Number(analysis.variance_vs_offer||0).toLocaleString()} €</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Budget</div>
            <div className="text-xl font-semibold">{Number(analysis.variance_vs_budget||0).toLocaleString()} €</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Alerts({ analysis }) {
  if (!analysis) return null;
  const items = [];
  if (analysis.risk_overrun_offer) items.push({ level:'warn', text:'Risque de dépassement vs total Offres (>5%).' });
  if (analysis.risk_overrun_budget) items.push({ level:'error', text:'Dépassement probable vs Budget (>5%).' });
  if (!items.length) items.push({ level:'ok', text:'Aucune alerte — situation maîtrisée.' });

  return (
    <div className="grid gap-2">
      {items.map((a,i)=> (
        <div key={i} className={`px-3 py-2 rounded border flex items-center gap-2 ${a.level==='error'?'bg-rose-100 text-rose-800 border-rose-200': a.level==='warn'?'bg-amber-100 text-amber-800 border-amber-200':'bg-emerald-100 text-emerald-800 border-emerald-200'}`}>
          {a.level==='error'? <AlertTriangle/> : a.level==='warn'? <AlertTriangle/> : <CheckCircle2/>}
          <span className="text-sm">{a.text}</span>
        </div>
      ))}
    </div>
  );
}
