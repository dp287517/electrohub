import { useState } from 'react';
import { AtexApi } from '../../lib/atexApi';

export default function ImportExport(){
  const [file, setFile] = useState(null);
  async function doImport(){
    if (!file) return;
    const r = await AtexApi.import(file);
    alert(`Import: ${r.inserted || 0} lignes`);
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <a className="px-4 py-2 rounded border" href={AtexApi.template()}>Télécharger le modèle Excel</a>
        <a className="px-4 py-2 rounded border" href={AtexApi.export()}>Exporter tout (Excel)</a>
      </div>
      <div className="flex items-center gap-2">
        <input type="file" accept=".xlsx" onChange={e=> setFile(e.target.files?.[0] || null)} />
        <button className="px-4 py-2 rounded bg-blue-600 text-white" onClick={doImport} disabled={!file}>Importer</button>
      </div>
    </div>
  );
}
