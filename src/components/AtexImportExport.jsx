import React, { useRef } from "react";
import { exportExcel, importExcel } from "../api.js";

export default function AtexImportExport() {
  const ref = useRef();

  const doExport = async () => {
    try {
      const res = await exportExcel();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "atex_export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    }
  };

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importExcel(file);
      alert("Import completed");
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button className="px-4 py-2 rounded bg-black text-white" onClick={doExport}>
        Export to Excel
      </button>
      <input type="file" accept=".xlsx" ref={ref} onChange={doImport} />
    </div>
  );
}
