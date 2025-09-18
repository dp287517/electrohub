import { useEffect, useMemo, useState } from 'react';
import AtexChatPanel from '../components/AtexChatPanel.jsx';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function Atex() {
  const [activeTab, setActiveTab] = useState('conformity');
  const [chatOpen, setChatOpen] = useState(false);

  // ====== Données ======
  const [list, setList] = useState([]);             // liste des équipements pour Conformity & Edit
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ====== Conformity tab ======
  const [refQuery, setRefQuery] = useState('');
  const filtered = useMemo(() => {
    const q = refQuery.trim().toLowerCase();
    if (!q) return [];
    return list.filter(e => (e.reference || '').toLowerCase().includes(q));
  }, [refQuery, list]);
  const todayISO = new Date().toISOString().slice(0, 10);

  // ====== CREATE tab ======
  const [createForm, setCreateForm] = useState({
    reference: '',
    name: '',
    building: '',
    zone: 'Zone 2',
    last_control_date: '',
    status: 'conforme',
    risk_level: 3,
    comment: '',
  });
  const [createFiles, setCreateFiles] = useState([]);

  // ====== EDIT tab ======
  const [editPick, setEditPick] = useState(null);   // équipement sélectionné (objet complet)
  const [editForm, setEditForm] = useState(null);   // copie éditable
  const [editFiles, setEditFiles] = useState([]);

  // ====== Excel tab (resté simple) ======
  const [excelUploading, setExcelUploading] = useState(false);

  // ====== Assessment (graph) ======
  const assessmentData = useMemo(() => {
    // Compter les non conformes par zone sur la liste actuelle
    const zones = ['Zone 0', 'Zone 1', 'Zone 2', 'Zone 20', 'Zone 21', 'Zone 22'];
    const counts = zones.map(z =>
      list.filter(e => (e.zone === z) && !isConform(e)).length
    );
    return {
      labels: zones,
      datasets: [
        { label: 'Équipements non conformes', data: counts }
      ]
    };
  }, [list]);

  const assessmentOptions = {
    responsive: true,
    plugins: { legend: { position: 'top' }, title: { display: true, text: 'Analyse ATEX' } },
  };

  // ================== Helpers ==================
  const fetchJSON = async (url, opts={}) => {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  const loadList = async () => {
    setLoading(true); setError('');
    try {
      const data = await fetchJSON('/api/atex');
      setList(data || []);
    } catch (e) {
      setError('Chargement impossible: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const isConform = (e) => {
    // conforme si statut = 'conforme' ET next_control_date >= aujourd’hui
    const okStatus = (e.status || '').toLowerCase() === 'conforme';
    const next = (e.next_control_date || '').slice(0,10);
    return okStatus && next >= todayISO;
  };

  useEffect(() => { loadList(); }, []);

  // ================== CREATE ==================
  const submitCreate = async (ev) => {
    ev.preventDefault();
    setError('');
    try {
      // 1) créer l'équipement
      const created = await fetchJSON('/api/atex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      // 2) uploader pièces jointes (optionnel)
      for (const f of createFiles) {
        const fd = new FormData();
        fd.append('file', f);
        await fetchJSON(`/api/atex/${created.id}/files`, { method: 'POST', body: fd });
      }

      // 3) refresh list + reset
      await loadList();
      setCreateForm({
        reference: '',
        name: '',
        building: '',
        zone: 'Zone 2',
        last_control_date: '',
        status: 'conforme',
        risk_level: 3,
        comment: '',
      });
      setCreateFiles([]);
      alert('Équipement créé avec succès.');
      setActiveTab('conformity');
    } catch (e) {
      setError('Création impossible: ' + e.message);
    }
  };

  // ================== EDIT ==================
  const pickForEdit = (equipmentId) => {
    const e = list.find(x => x.id === Number(equipmentId));
    setEditPick(e || null);
    setEditFiles([]);
    if (e) {
      // on clone dans un form éditable
      setEditForm({
        reference: e.reference || '',
        name: e.name || '',
        building: e.building || '',
        zone: e.zone || 'Zone 2',
        last_control_date: (e.last_control_date || '').slice(0,10),
        status: e.status || 'conforme',
        risk_level: e.risk_level ?? 3,
        comment: e.comment || '',
      });
    } else {
      setEditForm(null);
    }
  };

  const submitEdit = async (ev) => {
    ev.preventDefault();
    if (!editPick) return;
    setError('');
    try {
      // 1) update
      const updated = await fetchJSON(`/api/atex/${editPick.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      // 2) pièces jointes ajoutées (optionnel)
      for (const f of editFiles) {
        const fd = new FormData();
        fd.append('file', f);
        await fetchJSON(`/api/atex/${updated.id}/files`, { method: 'POST', body: fd });
      }

      await loadList();
      alert('Équipement mis à jour.');
    } catch (e) {
      setError('Mise à jour impossible: ' + e.message);
    }
  };

  // ================== Excel ==================
  const importExcel = async (ev) => {
    ev.preventDefault();
    const file = ev.currentTarget?.elements?.file?.files?.[0];
    if (!file) return alert('Sélectionne un fichier .xlsx');
    setExcelUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await fetchJSON('/api/atex/upload', { method: 'POST', body: fd });
      await loadList();
      alert('Import Excel terminé.');
    } catch (e) {
      setError('Import impossible: ' + e.message);
    } finally {
      setExcelUploading(false);
    }
  };

  const exportExcel = () => {
    window.location.href = '/api/atex/export';
  };

  // ================== UI ==================
  return (
    <section className="container-narrow py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">ATEX Management</h1>
        <button onClick={() => setChatOpen(true)} className="btn btn-primary">💬 Assistant IA</button>
      </div>

      {/* Onglets */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {[
          ['conformity','Conformité'],
          ['edit','Modifier'],
          ['create','Créer'],
          ['excel','Excel'],
          ['assessment','Assessment'],
        ].map(([key,label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-xl ${activeTab===key?'bg-brand-600 text-white':'bg-gray-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!!error && <div className="card p-4 mb-4 text-red-700 bg-red-50 border border-red-200">{error}</div>}
      {loading && <div className="card p-4 mb-4">Chargement…</div>}

      {/* ================== TAB: Conformity ================== */}
      {activeTab === 'conformity' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Vérifier la conformité</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Référence équipement</label>
              <input
                className="input mt-1"
                placeholder="Ex: EX-1234"
                value={refQuery}
                onChange={e => setRefQuery(e.target.value)}
              />
              <p className="text-sm text-gray-600 mt-2">
                Recherche insensible à la casse. Tape au moins une partie de la référence.
              </p>
            </div>
            <div className="self-end">
              <button type="button" className="btn" onClick={loadList}>🔄 Recharger la liste</button>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-4">Référence</th>
                  <th className="py-2 pr-4">Nom</th>
                  <th className="py-2 pr-4">Bâtiment</th>
                  <th className="py-2 pr-4">Zone</th>
                  <th className="py-2 pr-4">Dernier contrôle</th>
                  <th className="py-2 pr-4">Prochain contrôle</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2 pr-4">Conformité</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-t">
                    <td className="py-2 pr-4">{e.reference}</td>
                    <td className="py-2 pr-4">{e.name}</td>
                    <td className="py-2 pr-4">{e.building}</td>
                    <td className="py-2 pr-4">{e.zone}</td>
                    <td className="py-2 pr-4">{(e.last_control_date || '').slice(0,10)}</td>
                    <td className="py-2 pr-4">{(e.next_control_date || '').slice(0,10)}</td>
                    <td className="py-2 pr-4">{e.status}</td>
                    <td className="py-2 pr-4">
                      {isConform(e)
                        ? <span className="px-2 py-1 rounded-lg bg-green-100 text-green-800">Conforme</span>
                        : <span className="px-2 py-1 rounded-lg bg-red-100 text-red-800">Non conforme</span>}
                    </td>
                  </tr>
                ))}
                {!refQuery && (
                  <tr><td colSpan="8" className="py-4 text-gray-500">Tape une référence pour lancer la recherche.</td></tr>
                )}
                {refQuery && filtered.length===0 && (
                  <tr><td colSpan="8" className="py-4 text-gray-500">Aucun résultat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================== TAB: CREATE ================== */}
      {activeTab === 'create' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Créer un nouvel équipement</h2>
          <form className="grid md:grid-cols-2 gap-4" onSubmit={submitCreate}>
            <div>
              <label className="label">Référence *</label>
              <input className="input mt-1" required
                value={createForm.reference}
                onChange={e=>setCreateForm(p=>({...p,reference:e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Nom équipement *</label>
              <input className="input mt-1" required
                value={createForm.name}
                onChange={e=>setCreateForm(p=>({...p,name:e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Bâtiment *</label>
              <input className="input mt-1" required
                value={createForm.building}
                onChange={e=>setCreateForm(p=>({...p,building:e.target.value}))}
              />
            </div>
            <div>
              <label className="label">Zone ATEX *</label>
              <select className="input mt-1" required
                value={createForm.zone}
                onChange={e=>setCreateForm(p=>({...p,zone:e.target.value}))}
              >
                {['Zone 0','Zone 1','Zone 2','Zone 20','Zone 21','Zone 22'].map(z=><option key={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date dernier contrôle *</label>
              <input className="input mt-1" required type="date"
                value={createForm.last_control_date}
                onChange={e=>setCreateForm(p=>({...p,last_control_date:e.target.value}))}
              />
              <p className="text-xs text-gray-600 mt-1">
                La prochaine date sera calculée automatiquement (+3 ans).
              </p>
            </div>
            <div>
              <label className="label">Statut *</label>
              <select className="input mt-1" required
                value={createForm.status}
                onChange={e=>setCreateForm(p=>({...p,status:e.target.value}))}
              >
                <option value="conforme">Conforme</option>
                <option value="non conforme">Non conforme</option>
              </select>
            </div>
            <div>
              <label className="label">Niveau de risque (1–5)</label>
              <input className="input mt-1" type="number" min="1" max="5"
                value={createForm.risk_level}
                onChange={e=>setCreateForm(p=>({...p,risk_level: Number(e.target.value) })) }
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Commentaire</label>
              <textarea className="input mt-1" rows={3}
                value={createForm.comment}
                onChange={e=>setCreateForm(p=>({...p,comment:e.target.value}))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Pièces jointes (multiples)</label>
              <input className="input mt-1" type="file" multiple
                onChange={e=>setCreateFiles(Array.from(e.target.files || []))}
              />
              <p className="text-xs text-gray-600 mt-1">Photos, PDF, Word…</p>
            </div>

            <div className="md:col-span-2 flex gap-2">
              <button className="btn btn-primary" type="submit">Créer</button>
              <button className="btn bg-gray-100" type="button" onClick={()=>{ setCreateForm({
                reference:'', name:'', building:'', zone:'Zone 2', last_control_date:'', status:'conforme', risk_level:3, comment:''
              }); setCreateFiles([]); }}>Réinitialiser</button>
            </div>
          </form>
        </div>
      )}

      {/* ================== TAB: EDIT ================== */}
      {activeTab === 'edit' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Modifier un équipement</h2>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="label">Choisir l’équipement</label>
              <select className="input mt-1"
                value={editPick?.id || ''}
                onChange={e=>pickForEdit(e.target.value)}
              >
                <option value="">— Sélectionner —</option>
                {list.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.reference} — {e.name} ({e.zone})
                  </option>
                ))}
              </select>
            </div>
            <div className="self-end">
              <button className="btn" onClick={loadList}>🔄 Recharger</button>
            </div>
          </div>

          {!editForm && <p className="text-gray-600">Sélectionne un équipement pour l’éditer.</p>}

          {editForm && (
            <form className="grid md:grid-cols-2 gap-4" onSubmit={submitEdit}>
              <div>
                <label className="label">Référence *</label>
                <input className="input mt-1" required
                  value={editForm.reference}
                  onChange={e=>setEditForm(p=>({...p,reference:e.target.value}))}
                />
              </div>
              <div>
                <label className="label">Nom équipement *</label>
                <input className="input mt-1" required
                  value={editForm.name}
                  onChange={e=>setEditForm(p=>({...p,name:e.target.value}))}
                />
              </div>
              <div>
                <label className="label">Bâtiment *</label>
                <input className="input mt-1" required
                  value={editForm.building}
                  onChange={e=>setEditForm(p=>({...p,building:e.target.value}))}
                />
              </div>
              <div>
                <label className="label">Zone ATEX *</label>
                <select className="input mt-1" required
                  value={editForm.zone}
                  onChange={e=>setEditForm(p=>({...p,zone:e.target.value}))}
                >
                  {['Zone 0','Zone 1','Zone 2','Zone 20','Zone 21','Zone 22'].map(z=><option key={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date dernier contrôle *</label>
                <input className="input mt-1" required type="date"
                  value={editForm.last_control_date}
                  onChange={e=>setEditForm(p=>({...p,last_control_date:e.target.value}))}
                />
              </div>
              <div>
                <label className="label">Statut *</label>
                <select className="input mt-1" required
                  value={editForm.status}
                  onChange={e=>setEditForm(p=>({...p,status:e.target.value}))}
                >
                  <option value="conforme">Conforme</option>
                  <option value="non conforme">Non conforme</option>
                </select>
              </div>
              <div>
                <label className="label">Niveau de risque (1–5)</label>
                <input className="input mt-1" type="number" min="1" max="5"
                  value={editForm.risk_level}
                  onChange={e=>setEditForm(p=>({...p,risk_level:Number(e.target.value)}))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">Commentaire</label>
                <textarea className="input mt-1" rows={3}
                  value={editForm.comment}
                  onChange={e=>setEditForm(p=>({...p,comment:e.target.value}))}
                />
              </div>

              <div className="md:col-span-2">
                <label className="label">Ajouter des pièces jointes</label>
                <input className="input mt-1" type="file" multiple
                  onChange={e=>setEditFiles(Array.from(e.target.files || []))}
                />
                <p className="text-xs text-gray-600 mt-1">Les nouvelles pièces s’ajouteront aux existantes.</p>
              </div>

              <div className="md:col-span-2 flex gap-2">
                <button className="btn btn-primary" type="submit">Enregistrer</button>
                <button className="btn bg-gray-100" type="button" onClick={()=>{ pickForEdit(editPick.id); }}>Réinitialiser</button>
              </div>

              {/* Récap dates calculées */}
              <div className="md:col-span-2 text-sm text-gray-700 mt-2">
                <span className="font-medium">Prochain contrôle (DB):</span>{' '}
                {(list.find(x=>x.id===editPick.id)?.next_control_date || '').slice(0,10) || '—'}
              </div>
            </form>
          )}
        </div>
      )}

      {/* ================== TAB: Excel ================== */}
      {activeTab === 'excel' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Import / Export Excel</h2>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={importExcel}>
            <input className="input" name="file" type="file" accept=".xlsx" />
            <button className="btn btn-primary" disabled={excelUploading}>
              {excelUploading ? 'Import…' : 'Importer'}
            </button>
            <a href="/atex_template.xlsx" className="text-brand-700">📄 Télécharger le modèle</a>
          </form>
          <div className="mt-4">
            <button className="btn" onClick={exportExcel}>📥 Exporter toutes les données</button>
          </div>
        </div>
      )}

      {/* ================== TAB: Assessment ================== */}
      {activeTab === 'assessment' && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold mb-4">Évaluation des risques</h2>
          <Bar options={assessmentOptions} data={assessmentData} />
        </div>
      )}

      {/* Panneau Chat IA */}
      <AtexChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </section>
  );
}
