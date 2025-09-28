// Selectivity.jsx
// Améliorations : bouton afficher/masquer les filtres (design conservé),
// datasets Chart.js en (x,y) pour axe X logarithmique, debounce sur slider,
// clé de statut composée upstreamId-downstreamId, nettoyage import.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Legend
);

const API_BASE = process.env.REACT_APP_API_BASE || '';

function keyFor(upId, downId) {
  return `${upId}-${downId}`;
}

export default function Selectivity() {
  const [pairs, setPairs] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(false);

  const [selectedPair, setSelectedPair] = useState(null);
  const [curves, setCurves] = useState(null);
  const [faultCurrent, setFaultCurrent] = useState(null);

  // Filtres (masqués par défaut, design conservé)
  const [showFilters, setShowFilters] = useState(false);

  // exemples de filtres existants (garde le markup identique dans ton code)
  const [search, setSearch] = useState('');
  const [onlyNonSelective, setOnlyNonSelective] = useState(false);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const fetchPairs = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/pairs`, { credentials: 'include' });
        const data = await r.json();
        setPairs(data.pairs || []);
      } catch (e) {
        console.error(e);
      }
    };
    fetchPairs();
  }, []);

  // Déclenche un check pour une paire (option : à un courant de défaut précis)
  const handleCheck = async (upstreamId, downstreamId, currentOverride) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/check-selectivity`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upstreamId,
          downstreamId,
          faultCurrent: currentOverride ?? faultCurrent ?? undefined,
        }),
      });
      const data = await r.json();

      // Enregistre statut avec clé composée
      setStatuses((prev) => ({
        ...prev,
        [keyFor(upstreamId, downstreamId)]: data.status,
      }));

      // Si la paire est sélectionnée, on met à jour les courbes
      if (
        selectedPair &&
        selectedPair.upstreamId === upstreamId &&
        selectedPair.downstreamId === downstreamId
      ) {
        setCurves(data.curves || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Sélection d’une paire -> charge les courbes
  const onSelectPair = async (pair) => {
    setSelectedPair(pair);
    setCurves(null);
    await handleCheck(pair.upstream_id || pair.upstreamId, pair.downstream_id || pair.downstreamId);
  };

  // Données Chart.js en (x,y) pour axe log X ; clamp du Y pour lisibilité PDF
  const chartData = useMemo(() => {
    if (!curves) return null;
    const clampY = (t) => Math.min(t, 1000); // 1000s max visuel
    return {
      datasets: [
        {
          label: 'Upstream',
          data: (curves.upstream || []).map((p) => ({ x: p.current, y: clampY(p.time) })),
          borderWidth: 2,
          fill: false,
          tension: 0.1,
          pointRadius: 0,
        },
        {
          label: 'Downstream',
          data: (curves.downstream || []).map((p) => ({ x: p.current, y: clampY(p.time) })),
          borderWidth: 2,
          fill: false,
          tension: 0.1,
          pointRadius: 0,
        },
      ],
    };
  }, [curves]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false, // IMPORTANT: on fournit déjà (x,y)
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Courant (A)' },
          ticks: { callback: (v) => v },
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Temps (s)' },
        },
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const x = ctx.parsed.x;
              const y = ctx.parsed.y;
              return `${ctx.dataset.label}: I=${x.toFixed(2)} A, t=${y.toFixed(3)} s`;
            },
          },
        },
      },
    }),
    []
  );

  // (Re)crée le chart à chaque changement de data
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;

    // détruire l’instance précédente
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }
    if (!chartData) return;

    chartInstanceRef.current = new Chart(canvas, {
      type: 'line',
      data: chartData,
      options: chartOptions,
    });
  }, [chartData, chartOptions]);

  // Export PDF
  const exportPDF = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    let y = margin;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.text('Analyse de sélectivité', margin, y);
    y += 24;

    if (selectedPair) {
      doc.setFontSize(11);
      doc.text(
        `Paire: Upstream #${selectedPair.upstream_id || selectedPair.upstreamId}  —  Downstream #${
          selectedPair.downstream_id || selectedPair.downstreamId
        }`,
        margin,
        y
      );
      y += 18;
    }

    // Ajoute l’image du chart
    const canvas = chartRef.current;
    if (canvas) {
      const img = canvas.toDataURL('image/png', 1.0);
      const imgW = doc.internal.pageSize.getWidth() - margin * 2;
      const imgH = (canvas.height / canvas.width) * imgW;
      doc.addImage(img, 'PNG', margin, y, imgW, imgH, undefined, 'FAST');
      y += imgH + 20;
    }

    // Ajoute statut
    if (selectedPair) {
      const st =
        statuses[keyFor(selectedPair.upstream_id || selectedPair.upstreamId, selectedPair.downstream_id || selectedPair.downstreamId)];
      doc.setFontSize(12);
      doc.text(`Statut: ${st || 'indéterminé'}`, margin, y);
      y += 16;
    }

    doc.save('selectivity.pdf');
  };

  // Filtrage local (UX inchangée)
  const filteredPairs = useMemo(() => {
    const q = (search || '').toLowerCase();
    return (pairs || []).filter((p) => {
      const k = `${p.upstream_id || p.upstreamId}-${p.downstream_id || p.downstreamId}`;
      const st = (statuses[k] || '').toLowerCase();
      const txt = JSON.stringify(p).toLowerCase();
      if (q && !txt.includes(q)) return false;
      if (onlyNonSelective && st && st !== 'non-selective') return false;
      return true;
    });
  }, [pairs, statuses, search, onlyNonSelective]);

  // Slider de courant de défaut — debounce pour ne pas spammer le backend
  const onChangeFaultCurrent = (val) => {
    const v = Number(val);
    setFaultCurrent(v);
    if (!selectedPair) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleCheck(
        selectedPair.upstream_id || selectedPair.upstreamId,
        selectedPair.downstream_id || selectedPair.downstreamId,
        v
      );
    }, 250);
  };

  return (
    <div className="p-4">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Sélectivité</h1>

        {/* Bouton afficher/masquer les filtres (design conservé, juste caché/affiché) */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm"
          aria-expanded={showFilters}
          aria-controls="filters-panel"
        >
          {showFilters ? 'Masquer les filtres' : 'Afficher les filtres'}
        </button>
      </header>

      {/* Bloc filtres existant, simplement masqué par défaut */}
      {showFilters && (
        <div id="filters-panel" className="mb-4 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border rounded-md"
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyNonSelective}
              onChange={(e) => setOnlyNonSelective(e.target.checked)}
            />
            Non-sélectives uniquement
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Liste des paires */}
        <div className="md:col-span-1 border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">Paires</h2>
            {loading && <span className="text-xs opacity-60">…</span>}
          </div>
          <ul className="divide-y">
            {filteredPairs.map((p) => {
              const upId = p.upstream_id || p.upstreamId;
              const downId = p.downstream_id || p.downstreamId;
              const st = statuses[keyFor(upId, downId)];
              const isSelected =
                selectedPair &&
                (selectedPair.upstream_id || selectedPair.upstreamId) === upId &&
                (selectedPair.downstream_id || selectedPair.downstreamId) === downId;

              return (
                <li key={keyFor(upId, downId)} className="py-2 flex items-center justify-between">
                  <button
                    className={`text-left hover:underline ${isSelected ? 'font-semibold' : ''}`}
                    onClick={() => onSelectPair({ upstream_id: upId, downstream_id: downId })}
                  >
                    #{upId} → #{downId}
                  </button>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      st === 'selective'
                        ? 'bg-green-100 text-green-700'
                        : st === 'non-selective'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {st || '–'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Graphe + réglages */}
        <div className="md:col-span-2 border rounded-lg p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">Courbes</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={exportPDF}
                className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm"
                disabled={!curves}
              >
                Export PDF
              </button>
            </div>
          </div>

          <div className="h-72">
            <canvas ref={chartRef} />
          </div>

          {/* Slider courant de défaut (déboursé) */}
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm">Courant de défaut (A)</label>
            <input
              type="range"
              min="10"
              max="100000"
              step="10"
              value={faultCurrent || 10}
              onChange={(e) => onChangeFaultCurrent(e.target.value)}
              className="flex-1"
              disabled={!selectedPair}
            />
            <input
              type="number"
              min="1"
              value={faultCurrent || 10}
              onChange={(e) => onChangeFaultCurrent(e.target.value)}
              className="w-28 px-2 py-1 border rounded-md text-sm"
              disabled={!selectedPair}
            />
            <button
              onClick={() =>
                selectedPair &&
                handleCheck(
                  selectedPair.upstream_id || selectedPair.upstreamId,
                  selectedPair.downstream_id || selectedPair.downstreamId,
                  faultCurrent
                )
              }
              className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm"
              disabled={!selectedPair}
            >
              Tester
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
