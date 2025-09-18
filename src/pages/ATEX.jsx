import { useState } from 'react';
import Controls from './atex/Controls';
import Create from './atex/Create';
import Modify from './atex/Modify';
import Assessment from './atex/Assessment';
import ImportExport from './atex/ImportExport';

export default function ATEX(){
  const [tab, setTab] = useState('Controls');
  const [editId, setEditId] = useState(null);

  const tabs = ['Controls','Create','Modify','Assessment','Import/Export'];
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">ATEX</h1>
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t} onClick={()=> setTab(t)}
            className={"px-3 py-2 rounded border " + (tab===t ? "bg-gray-900 text-white border-gray-900":"bg-white hover:bg-gray-50 border-gray-200")}>
            {t}
          </button>
        ))}
      </div>

      {tab==='Controls' && <Controls onModify={(id)=>{ setEditId(id); setTab('Modify'); }} />}
      {tab==='Create' && <Create onCreated={(id)=>{ setEditId(id); setTab('Modify'); }} />}
      {tab==='Modify' && <Modify id={editId} />}
      {tab==='Assessment' && <Assessment />}
      {tab==='Import/Export' && <ImportExport />}
    </div>
  );
}
