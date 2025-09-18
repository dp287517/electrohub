import { useEffect, useMemo, useState } from 'react';
import { AtexApi } from '../../lib/atexApi';
import { ResponsiveContainer, PieChart, Pie, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend } from 'recharts';

export default function Assessment(){
  const [items, setItems] = useState([]);
  useEffect(()=>{ (async ()=> setItems(await AtexApi.list({ pageSize: 500 })))(); },[]);

  const derived = useMemo(()=>{
    const counts = { compliant:0, non:0 };
    const byBuilding = {};
    const byZoneG = {};
    const byZoneD = {};
    const dueSoon = { '0-30':0, '31-90':0, '>90':0 };
    const monthly = {};

    const today = new Date();
    items.forEach(i=>{
      if (i.compliant) counts.compliant++; else counts.non++;
      byBuilding[i.building] = (byBuilding[i.building]||0)+1;
      if (i.zone_gas!=null) byZoneG[i.zone_gas] = (byZoneG[i.zone_gas]||0)+1;
      if (i.zone_dust!=null) byZoneD[i.zone_dust] = (byZoneD[i.zone_dust]||0)+1;
      if (i.next_due_date){
        const dd = new Date(i.next_due_date);
        const diff = Math.ceil((dd - today)/(1000*3600*24));
        if (diff<=30) dueSoon['0-30']++; else if (diff<=90) dueSoon['31-90']++; else dueSoon['>90']++;
      }
      const m = (i.last_inspection_date || '').slice(0,7);
      if (m) monthly[m] = (monthly[m]||0)+1;
    });
    return {
      counts,
      byBuilding: Object.entries(byBuilding).map(([k,v])=>({ name:k, count:v })),
      byZoneG: Object.entries(byZoneG).map(([k,v])=>({ name:k, count:v })),
      byZoneD: Object.entries(byZoneD).map(([k,v])=>({ name:k, count:v })),
      due: Object.entries(dueSoon).map(([k,v])=>({ range:k, count:v })),
      monthly: Object.entries(monthly).map(([k,v])=>({ month:k, inspections:v }))
    };
  },[items]);

  return (
    <div className="grid gap-6">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded border">
          <div className="text-sm text-gray-600">Total</div>
          <div className="text-2xl font-semibold">{items.length}</div>
        </div>
        <div className="p-4 rounded border">
          <div className="text-sm text-gray-600">Conformes</div>
          <div className="text-2xl font-semibold">{derived.counts.compliant}</div>
        </div>
        <div className="p-4 rounded border">
          <div className="text-sm text-gray-600">Non conformes</div>
          <div className="text-2xl font-semibold">{derived.counts.non}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="p-4 rounded border">
          <div className="font-medium mb-2">Répartition conformité</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={[{name:'Conformes', value: derived.counts.compliant},{name:'Non conformes', value: derived.counts.non}]} dataKey="value" nameKey="name" outerRadius={100} label />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="p-4 rounded border">
          <div className="font-medium mb-2">Équipements par bâtiment</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={derived.byBuilding}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="p-4 rounded border">
          <div className="font-medium mb-2">Zones gaz</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={derived.byZoneG}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="p-4 rounded border">
          <div className="font-medium mb-2">Zones poussières</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={derived.byZoneD}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4 rounded border">
        <div className="font-medium mb-2">Tendance mensuelle (derniers contrôles)</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={derived.monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey="inspections" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
