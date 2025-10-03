// src/pages/Project.jsx
</div>
</div>
);
}


function ProjectCharts({ analysis, lines }) {
const data = useMemo(()=>{
const spent = (lines?.invoices||[]).slice().reverse();
let cum = 0; const points = spent.map(x=>{ cum += Number(x.amount)||0; return { x: new Date(x.invoiced_at||Date.now()), y: cum }; });
return {
datasets: [{ label: 'Cumul factures (€)', data: points, parsing:false, tension:0.2 }]
};
}, [lines]);


return (
<div className="grid gap-4">
<div className="p-4 rounded border bg-white">
<div className="font-semibold mb-2">Courbe cumulative des factures</div>
<Line data={data} options={{ responsive:true, scales:{ x:{ type:'time', time:{ unit:'month' } }, y:{ beginAtZero:true }}}} />
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
