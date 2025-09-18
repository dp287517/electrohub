// Atex.jsx
import { useState } from 'react';
import AtexCreate from './AtexCreate.jsx';
import AtexEdit from './AtexEdit.jsx';

export default function Atex() {
  const [tab, setTab] = useState('create'); // 'create' | 'edit'

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">ATEX – Gestion des équipements</h1>

      <div className="flex gap-2 mb-6">
        <button
          className={`btn ${tab === 'create' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('create')}
        >
          Créer
        </button>
        <button
          className={`btn ${tab === 'edit' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('edit')}
        >
          Modifier
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-4">
        {tab === 'create' ? <AtexCreate /> : <AtexEdit />}
      </div>
    </div>
  );
}
