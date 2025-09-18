import React, { useEffect, useState } from "react";
import { createEquipment, updateEquipment } from "../api.js";

export default function AtexEquipmentForm({ selected, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: "", area: "", zone: "", category: "",
    temperatureClass: "", protectionLevel: "", marking: "", notes: ""
  });
  useEffect(() => {
    if (selected) setForm({
      name: selected.name || "",
      area: selected.area || "",
      zone: selected.zone || "",
      category: selected.category || "",
      temperatureClass: selected.temperatureClass || "",
      protectionLevel: selected.protectionLevel || "",
      marking: selected.marking || "",
      notes: selected.notes || ""
    });
  }, [selected]);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (selected?.id) {
        await updateEquipment(selected.id, form);
      } else {
        await createEquipment(form);
      }
      onSaved?.();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <h3 className="text-lg font-semibold">
        {selected?.id ? "Modify Equipment" : "Create Equipment"}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col text-sm">
          Name
          <input name="name" value={form.name} onChange={onChange} required className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Area
          <input name="area" value={form.area} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Zone
          <input name="zone" value={form.zone} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Category
          <input name="category" value={form.category} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Temperature class
          <input name="temperatureClass" value={form.temperatureClass} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Protection level
          <input name="protectionLevel" value={form.protectionLevel} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm">
          Marking
          <input name="marking" value={form.marking} onChange={onChange} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col text-sm col-span-2">
          Notes
          <textarea name="notes" value={form.notes} onChange={onChange} className="border p-2 rounded" rows={3} />
        </label>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 rounded bg-black text-white">
          {selected?.id ? "Save changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded border">
          Cancel
        </button>
      </div>
    </form>
  );
}
