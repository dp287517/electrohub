import React from "react";
import { deleteEquipment } from "../api.js";

export default function AtexEquipmentList({ items, onEdit, onRefresh }) {
  const removeItem = async (id) => {
    if (!confirm("Delete this equipment?")) return;
    try {
      await deleteEquipment(id);
      onRefresh?.();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="overflow-auto">
      <table className="min-w-full border text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-2 py-1 text-left">Name</th>
            <th className="border px-2 py-1 text-left">Area</th>
            <th className="border px-2 py-1 text-left">Zone</th>
            <th className="border px-2 py-1 text-left">Category</th>
            <th className="border px-2 py-1 text-left">Marking</th>
            <th className="border px-2 py-1 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="border px-2 py-1">{it.name}</td>
              <td className="border px-2 py-1">{it.area}</td>
              <td className="border px-2 py-1">{it.zone}</td>
              <td className="border px-2 py-1">{it.category}</td>
              <td className="border px-2 py-1">{it.marking}</td>
              <td className="border px-2 py-1">
                <button className="px-2 py-1 border rounded mr-2" onClick={() => onEdit?.(it)}>Modify</button>
                <button className="px-2 py-1 border rounded" onClick={() => removeItem(it.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
