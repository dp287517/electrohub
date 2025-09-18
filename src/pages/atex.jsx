import { useState } from 'react';
import AtexChatPanel from '../components/AtexChatPanel.jsx';
import { post } from '../lib/api.js';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function Atex() {
  const [activeTab, setActiveTab] = useState('conformity');
  const [chatOpen, setChatOpen] = useState(false);

  // Exemple dataset pour le graphique
  const data = {
    labels: ['Zone 0', 'Zone 1', 'Zone 2', 'Zone 20', 'Zone 21', 'Zone 22'],
    datasets: [
      {
        label: 'Equipements non conformes',
        data: [2, 5, 3, 1, 4, 2],
        backgroundColor: '#1f73ff',
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: { legend: { position: 'top' }, title: { display: true, text: 'Analyse ATEX' } },
  };

  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">ATEX Management</h1>
        <button
          onClick={() => setChatOpen(true)}
          className="btn btn-primary"
        >
          💬 Assistant IA
        </button>
      </div>

      {/* Onglets */}
      <div className="flex gap-3 mb-6">
        {['conformity', 'edit', 'create', 'excel', 'assessment'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl ${
              activeTab === tab ? 'bg-brand-600 text-white' : 'bg-gray-100'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Contenu par onglet */}
      {activeTab === 'conformity' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Vérifier la conformité</h2>
          <form className="space-y-4">
            <div>
              <label className="label">Référence équipement</label>
              <input className="input mt-1" placeholder="Ex: EX-1234" />
            </div>
            <button type="submit" className="btn btn-primary">Vérifier</button>
          </form>
        </div>
      )}

      {activeTab === 'edit' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Modifier un équipement</h2>
          <p>Formulaire édition ici…</p>
        </div>
      )}

      {activeTab === 'create' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Créer un nouvel équipement</h2>
          <p>Formulaire création ici…</p>
        </div>
      )}

      {activeTab === 'excel' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Import / Export Excel</h2>
          <form className="space-y-4">
            <input type="file" accept=".xlsx" />
            <button className="btn btn-primary">Importer</button>
          </form>
          <button className="btn mt-4">📥 Télécharger toutes les données</button>
          <a href="/atex_template.xlsx" className="text-sm text-brand-700 block mt-2">
            Télécharger modèle Excel
          </a>
        </div>
      )}

      {activeTab === 'assessment' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Évaluation des risques</h2>
          <Bar options={options} data={data} />
        </div>
      )}

      {/* Panneau Chat IA */}
      <AtexChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </section>
  );
}
