import React, { useEffect, useState } from "react";
import { listEquipment, listAssessments, createAssessment } from "../api.js";
import AtexEquipmentForm from "../components/AtexEquipmentForm.jsx";
import AtexEquipmentList from "../components/AtexEquipmentList.jsx";
import AtexImportExport from "../components/AtexImportExport.jsx";

export default function AtexPage() {
  const [equip, setEquip] = useState([]);
  const [assess, setAssess] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [newAssess, setNewAssess] = useState({ equipmentId: "", riskLevel: "Unknown", probability: "", consequence: "", measures: "", reviewer: "" });

  const refresh = async () => {
    const e = await listEquipment();
    setEquip(e.items || []);
    const a = await listAssessments();
    setAssess(a.items || []);
  };

  useEffect(() => { refresh(); }, []);

  const startCreate = () => { setEditing(null); setShowForm(true); };
  const startEdit = (row) => { setEditing(row); setShowForm(true); };

  const saveAssessment = async (e) => {
    e.preventDefault();
    try {
      await createAssessment({
        equipmentId: newAssess.equipmentId,
        riskLevel: newAssess.riskLevel,
        probability: newAssess.probability ? Number(newAssess.probability) : null,
        consequence: newAssess.consequence ? Number(newAssess.consequence) : null,
        measures: newAssess.measures,
        reviewer: newAssess.reviewer
      });
      setNewAssess({ equipmentId: "", riskLevel: "Unknown", probability: "", consequence: "", measures: "", reviewer: "" });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">ATEX Management</h1>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Equipment</h2>
          <div className="flex gap-2">
            <button className="px-3 py-2 border rounded" onClick={startCreate}>Create Equipment</button>
            <AtexImportExport />
          </div>
        </div>

        {!showForm && (
          <AtexEquipmentList items={equip} onEdit={startEdit} onRefresh={refresh} />
        )}

        {showForm && (
          <div className="rounded border p-4">
            <AtexEquipmentForm
              selected={editing}
              onSaved={() => { setShowForm(false); refresh(); }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Risk Assessments</h2>
        <form className="grid grid-cols-6 gap-3" onSubmit={saveAssessment}>
          <label className="flex flex-col text-sm col-span-2">
            Equipment
            <select value={newAssess.equipmentId} onChange={(e)=>setNewAssess({...newAssess, equipmentId: e.target.value})} required className="border p-2 rounded">
              <option value="">Select equipment</option>
              {equip.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            Risk level
            <select value={newAssess.riskLevel} onChange={(e)=>setNewAssess({...newAssess, riskLevel: e.target.value})} className="border p-2 rounded">
              <option>Unknown</option>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Critical</option>
            </select>
          </label>
          <label className="flex flex-col text-sm">
            Probability (1-5)
            <input value={newAssess.probability} onChange={(e)=>setNewAssess({...newAssess, probability: e.target.value})} className="border p-2 rounded" />
          </label>
          <label className="flex flex-col text-sm">
            Consequence (1-5)
            <input value={newAssess.consequence} onChange={(e)=>setNewAssess({...newAssess, consequence: e.target.value})} className="border p-2 rounded" />
          </label>
          <label className="flex flex-col text-sm col-span-6">
            Measures
            <textarea value={newAssess.measures} onChange={(e)=>setNewAssess({...newAssess, measures: e.target.value})} className="border p-2 rounded" rows={3} />
          </label>
          <label className="flex flex-col text-sm col-span-3">
            Reviewer
            <input value={newAssess.reviewer} onChange={(e)=>setNewAssess({...newAssess, reviewer: e.target.value})} className="border p-2 rounded" />
          </label>
          <div className="col-span-6">
            <button className="px-4 py-2 rounded bg-black text-white">Add assessment</button>
          </div>
        </form>

        <div className="overflow-auto">
          <table className="min-w-full border text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="border px-2 py-1 text-left">Equipment</th>
                <th className="border px-2 py-1 text-left">Risk level</th>
                <th className="border px-2 py-1 text-left">Probability</th>
                <th className="border px-2 py-1 text-left">Consequence</th>
                <th className="border px-2 py-1 text-left">Measures</th>
                <th className="border px-2 py-1 text-left">Reviewer</th>
              </tr>
            </thead>
            <tbody>
              {assess.map((a) => {
                const eq = equip.find(e => e.id === a.equipmentId);
                return (
                  <tr key={a.id}>
                    <td className="border px-2 py-1">{eq ? eq.name : a.equipmentId}</td>
                    <td className="border px-2 py-1">{a.riskLevel}</td>
                    <td className="border px-2 py-1">{a.probability ?? ""}</td>
                    <td className="border px-2 py-1">{a.consequence ?? ""}</td>
                    <td className="border px-2 py-1">{a.measures}</td>
                    <td className="border px-2 py-1">{a.reviewer}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
