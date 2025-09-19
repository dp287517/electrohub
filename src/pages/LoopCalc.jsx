// src/pages/LoopCalc.jsx
import { useState } from 'react';
import { post, get } from '../lib/api.js';
import jsPDF from 'jspdf';

export default function LoopCalc() {
  const [form, setForm] = useState({
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
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  function cf(k, v) {
    setForm(s => ({ ...s, [k]: v }));
  }

  async function calculate() {
    try {
      const res = await post('/api/loopcalc/calculations', form);
      setResult(res);
      const h = await get('/api/loopcalc/calculations');
      setHistory(h);
    } catch (e) {
      alert('Calculation failed: ' + e.message);
    }
  }

  function exportPDF() {
    if (!result) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('ElectroHub – Loop Calculation Report', 14, 20);
    doc.setFontSize(12);
    doc.text(`Project: ${form.project || '—'}`, 14, 35);
    doc.text(`Source voltage: ${form.voltage} V`, 14, 45);
    doc.text(`Cable: ${form.cableType}`, 14, 55);
    doc.text(`Distance: ${form.distance} m`, 14, 65);
    doc.text(`Resistance: ${form.resistance} Ω/km`, 14, 75);
    doc.text(`Capacitance: ${form.capacitance} nF/km`, 14, 85);
    doc.text(`Inductance: ${form.inductance} mH/km`, 14, 95);
    doc.text(`Safety factor: ${form.safetyFactor}`, 14, 105);
    doc.text(`Compliance: ${result.compliance}`, 14, 120);
    doc.save(`loopcalc_${Date.now()}.pdf`);
  }

  return (
    <section className="container-narrow py-8">
      <h1 className="text-3xl font-bold mb-6">Loop Calculation</h1>

      {/* ---- Inputs ---- */}
      <div className="card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Inputs</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Project name</label>
            <input className="input mt-1" value={form.project} onChange={e=>cf('project', e.target.value)} />
          </div>
          <div>
            <label className="label">Source voltage (V)</label>
            <input type="number" className="input mt-1" value={form.voltage} onChange={e=>cf('voltage', e.target.value)} />
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
            <input type="number" className="input mt-1" value={form.distance} onChange={e=>cf('distance', e.target.value)} />
          </div>
          <div>
            <label className="label">Resistance (Ω/km)</label>
            <input type="number" className="input mt-1" value={form.resistance} onChange={e=>cf('resistance', e.target.value)} />
          </div>
          <div>
            <label className="label">Capacitance (nF/km)</label>
            <input type="number" className="input mt-1" value={form.capacitance} onChange={e=>cf('capacitance', e.target.value)} />
          </div>
          <div>
            <label className="label">Inductance (mH/km)</label>
            <input type="number" className="input mt-1" value={form.inductance} onChange={e=>cf('inductance', e.target.value)} />
          </div>
          <div>
            <label className="label">Max current (A)</label>
            <input type="number" className="input mt-1" value={form.maxCurrent} onChange={e=>cf('maxCurrent', e.target.value)} />
          </div>
          <div>
            <label className="label">Safety factor</label>
            <input type="number" step="0.1" className="input mt-1" value={form.safetyFactor} onChange={e=>cf('safetyFactor', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end mt-4 gap-2">
          <button className="btn bg-gray-100" onClick={()=>setForm({...form})}>Reset</button>
          <button className="btn btn-primary" onClick={calculate}>Calculate</button>
        </div>
      </div>

      {/* ---- Results ---- */}
      {result && (
        <div className="card p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Result</h2>
          <div className={`px-4 py-2 rounded text-white ${result.compliance==='Compliant'?'bg-green-500':'bg-red-500'}`}>
            {result.compliance}
          </div>
          <div className="mt-4">
            <button className="btn btn-primary" onClick={exportPDF}>Export PDF</button>
          </div>
        </div>
      )}

      {/* ---- History ---- */}
      {history.length > 0 && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Past calculations</h2>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">Project</th>
                <th className="px-4 py-2 text-left">Voltage</th>
                <th className="px-4 py-2 text-left">Distance</th>
                <th className="px-4 py-2 text-left">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h,i)=>(
                <tr key={i} className="border-t">
                  <td className="px-4 py-2">{h.project}</td>
                  <td className="px-4 py-2">{h.voltage} V</td>
                  <td className="px-4 py-2">{h.distance} m</td>
                  <td className={`px-4 py-2 ${h.compliance==='Compliant'?'text-green-600':'text-red-600'}`}>
                    {h.compliance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
