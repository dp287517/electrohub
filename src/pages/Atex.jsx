import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

export default function Atex() {
  const [tab, setTab] = useState('status');
  const [query, setQuery] = useState('');
  const [equipment, setEquipment] = useState(null);
  const [assessment, setAssessment] = useState([]);

  const handleSearch = async () => {
    const res = await fetch(`/api/atex/search?ref=${query}`);
    const data = await res.json();
    setEquipment(data);
  };

  useEffect(() => {
    if (tab === 'assessment') {
      fetch('/api/atex/assessment').then(r => r.json()).then(d => setAssessment(d.stats || []));
    }
  }, [tab]);

  return (
    <section className="container-narrow py-10">
      <h1 className="text-3xl font-bold mb-6">ATEX</h1>
      <div className="flex gap-4 mb-6">
        <button className={tab==='status'?'btn btn-primary':'btn'} onClick={()=>setTab('status')}>Conformity Status</button>
        <button className={tab==='modify'?'btn btn-primary':'btn'} onClick={()=>setTab('modify')}>Modify Equipment</button>
        <button className={tab==='create'?'btn btn-primary':'btn'} onClick={()=>setTab('create')}>Create Equipment</button>
        <button className={tab==='excel'?'btn btn-primary':'btn'} onClick={()=>setTab('excel')}>Import/Export Excel</button>
        <button className={tab==='assessment'?'btn btn-primary':'btn'} onClick={()=>setTab('assessment')}>Assessment</button>
      </div>

      {tab==='status' && (
        <div>
          <div className="card p-6 mb-4">
            <label className="label">Equipment reference</label>
            <div className="flex gap-2 mt-2">
              <input className="input flex-1" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Enter reference" />
              <button className="btn btn-primary" onClick={handleSearch}>Search</button>
            </div>
          </div>
          {equipment && (
            <div className="card p-6">
              <h2 className="text-xl font-semibold mb-2">Result</h2>
              <p><b>Ref:</b> {equipment.ref}</p>
              <p><b>Installation Zone:</b> {equipment.installation_zone}</p>
              <p><b>Certification Zones:</b> {equipment.certification_zones.join(', ')}</p>
              <p><b>Last Control:</b> {equipment.last_control}</p>
              <p><b>Comments:</b> {equipment.comments}</p>
              <div className="mt-2">
                <b>Attachments:</b>
                <ul>
                  {equipment.attachments.map(a=>(
                    <li key={a.id}><a className="text-brand-700 underline" href={a.url}>{a.filename}</a></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='assessment' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Assessment</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={assessment}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="installation_zone" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
