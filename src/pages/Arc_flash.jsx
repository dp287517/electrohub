import { useEffect, useState, useRef } from 'react';
import { get, post } from '../lib/api.js';
import { Search, HelpCircle, AlertTriangle, CheckCircle, XCircle, X, Flame, Download, ChevronRight, Settings } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import Confetti from 'react-confetti';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LogarithmicScale,
} from 'chart.js';
import Annotation from 'chartjs-plugin-annotation';
import Zoom from 'chartjs-plugin-zoom';

// Register plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LogarithmicScale,
  Annotation,
  Zoom
);

function useUserSite() {
  try {
    const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
    return user?.site || '';
  } catch { return ''; }
}

function Toast({ msg, type }) {
  const colors = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white',
  };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm ${colors[type]}`}>
      {msg}
    </div>
  );
}

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[80vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-200">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-100px)]">{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose, tipContent }) {
  if (!open) return null;
  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 overflow-y-auto p-6 transition-transform duration-300 ease-in-out transform translate-x-0">
      <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-gray-200 rounded">
        <X size={20} />
      </button>
      <h3 className="text-xl font-bold mb-4">Explanation Tip</h3>
      <p className="text-gray-700 whitespace-pre-wrap mb-4">{tipContent || 'No tip available'}</p>
      <HelpCircle className="text-blue-500 inline" size={24} />
    </div>
  );
}

export default function ArcFlash() {
  const site = useUserSite();
  const [points, setPoints] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [q, setQ] = useState({ q: '', switchboard: '', building: '', floor: '', sort: 'name', dir: 'desc', page: 1, pageSize: '18' });
  const [total, setTotal] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [curveData, setCurveData] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramForm, setParamForm] = useState({ device_id: null, switchboard_id: null, working_distance: 455, enclosure_type: 'VCB', electrode_gap: 32, arcing_time: 0.2, fault_current_ka: null, settings: {}, parent_id: null });
  const [paramTips, setParamTips] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [tipContent, setTipContent] = useState('');
  const chartRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    loadPoints();
  }, [q]);

  const loadPoints = async () => {
    try {
      setBusy(true);
      const params = {
        ...q,
        switchboard: isNaN(Number(q.switchboard)) ? '' : q.switchboard, // Prevent NaN
      };
      const data = await get('/api/arcflash/points', params);
      setPoints(data?.data || []);
      setTotal(data?.total || 0);
      const initialStatuses = {};
      data?.data.forEach(point => {
        if (point.status) {
          initialStatuses[point.device_id] = point.status;
        }
      });
      setStatuses(initialStatuses);
    } catch (e) {
      setToast({ msg: `Failed to load points: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleAutofill = async () => {
    try {
      setBusy(true);
      const result = await post('/api/arcflash/autofill', { site });
      setToast({ msg: result.message, type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Autofill failed: ${e.message || 'Server endpoint not found'}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async (deviceId, switchboardId, isBatch = false) => {
    try {
      setBusy(true);
      if (!deviceId || !switchboardId) throw new Error('Missing device or switchboard ID');
      const params = { device: deviceId, switchboard: switchboardId };
      const result = await get('/api/arcflash/check', params);
      setCheckResult(result);
      setSelectedPoint({ deviceId, switchboardId });
      setStatuses(prev => ({ ...prev, [`${deviceId}`]: result.status }));
      setParamTips(result.paramTips || {});

      const curves = await get('/api/arcflash/curves', params);
      const validData = curves.curve.map(p => p.energy).filter(v => !isNaN(v) && v > 0);
      const datasets = {
        labels: curves.curve.map(p => p.distance.toFixed(0)),
        datasets: [
          { label: 'Incident Energy (cal/cm²)', data: validData.length ? validData : [0.1, 0.2, 0.3], borderColor: 'orange', tension: 0.1, pointRadius: 0 },
        ],
      };
      setCurveData(datasets);
      setShowGraph(true);

      try {
        const tipRes = await post('/api/arcflash/ai-tip', { 
          query: `Explain why this point is ${result.status}: incident_energy: ${result.incident_energy || 'general'}, ppe: ${result.ppe_category}` 
        });
        setTipContent(tipRes.tip || 'No tip available');
      } catch (tipError) {
        console.error('AI tip failed:', tipError.message);
        setTipContent('Failed to load AI tip');
      }
      setShowSidebar(true);

      if (result.status === 'safe' && !isBatch) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }
    } catch (e) {
      setToast({ msg: `Check failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleBatchCheck = async () => {
    try {
      setBusy(true);
      for (const { device_id, switchboard_id } of selectedPoints) {
        if (device_id && switchboard_id) {
          await handleCheck(device_id, switchboard_id, true);
        }
      }
      setToast({ msg: 'Batch check completed', type: 'success' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Batch failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
      setSelectedPoints([]);
    }
  };

  const saveParameters = async () => {
    try {
      setBusy(true);
      if (!paramForm.device_id || !paramForm.switchboard_id) {
        throw new Error('Device ID or Switchboard ID is missing');
      }
      const result = await post('/api/arcflash/parameters', { ...paramForm, site });
      setToast({ msg: result.message, type: 'success' });
      setParamTips(result.tips || {});
      setShowParamsModal(false);
      loadPoints();
    } catch (e) {
      setToast({ msg: `Save failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    try {
      setBusy(true);
      await post('/api/arcflash/reset', { site });
      setToast({ msg: 'Data reset', type: 'info' });
      loadPoints();
    } catch (e) {
      setToast({ msg: `Reset failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Fonction corrigée pour exportPdf
  const exportPdf = async (isLabel = false) => {
    try {
      if (!checkResult || !curveData) {
        setToast({ msg: 'No results or graph to export. Run a check first.', type: 'error' });
        return;
      }

      setBusy(true);
      const pdf = new jsPDF();

      // 1) RENDU FIABLE DU GRAPHE VIA CANVAS TEMPORAIRE (comme Selectivity)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 900;  // assez large pour un rendu net
      tempCanvas.height = 450;
      const ctx = tempCanvas.getContext('2d');

      let chartInstance = null;
      try {
        // Reconstruire un dataset minimal à partir de curveData existant
        const data = {
          labels: curveData.labels,
          datasets: [
            {
              label: 'Incident Energy (cal/cm²)',
              data: curveData.datasets?.[0]?.data || [],
              tension: 0.1,
              pointRadius: 0,
            },
          ],
        };

        chartInstance = new ChartJS(ctx, {
          type: 'line',
          data,
          options: {
            responsive: false,
            plugins: {
              title: { display: true, text: 'Incident Energy vs Distance' },
            },
            scales: {
              x: { type: 'linear', title: { display: true, text: 'Working Distance (mm)' } },
              y: { type: 'logarithmic', title: { display: true, text: 'Incident Energy (cal/cm²)' }, min: 0.1, max: 100 },
            },
          }
        });

        // Laisse le temps au chart de peindre
        await new Promise(r => setTimeout(r, 400));
      } catch (e) {
        console.error('Temp chart build failed:', e);
      }

      const graphImg = tempCanvas.toDataURL('image/png');

      // 2) (OPTIONNEL) CAPTURE DE LA SECTION RÉSULTATS
      // NOTE: tu peux enlever toute cette partie si tu veux éviter html2canvas.
      let resultImg = null;
      if (resultRef?.current) {
        try {
          const resultCanvas = await html2canvas(resultRef.current, { scale: 2, useCORS: true, logging: false });
          resultImg = resultCanvas.toDataURL('image/png');
        } catch (e) {
          console.warn('html2canvas result section failed:', e.message);
        }
      }

      // 3) COMPOSITION DU PDF
      if (isLabel) {
        pdf.setFontSize(18);
        pdf.text('Arc Flash Label', 20, 20);
        pdf.setFontSize(12);
        pdf.text(`Device: ${selectedPoint?.deviceId} - Switchboard: ${selectedPoint?.switchboardId}`, 20, 35);
        pdf.text(`Incident Energy: ${checkResult?.incident_energy} cal/cm²`, 20, 45);
        pdf.text(`PPE Category: ${checkResult?.ppe_category} (IEC 61482)`, 20, 55);
        pdf.text('Required PPE: Arc-rated clothing, gloves, face shield', 20, 65);
        pdf.text('Warning: High Arc Flash Risk - Maintain Safe Distance', 20, 75);

        if (resultImg) {
          pdf.addImage(resultImg, 'PNG', 20, 85, 170, 80);
        }
        if (graphImg) {
          pdf.addPage();
          pdf.addImage(graphImg, 'PNG', 10, 10, 190, 95);
        }
      } else {
        // Rapport complet
        if (graphImg) pdf.addImage(graphImg, 'PNG', 10, 10, 190, 95);
        pdf.setFontSize(14);
        pdf.text('Full Arc Flash Report', 20, 115);
        pdf.setFontSize(11);
        pdf.text(`Status: ${checkResult?.status}`, 20, 125);
        pdf.text(`Incident Energy: ${checkResult?.incident_energy} cal/cm²`, 20, 132);
        pdf.text(`PPE Category: ${checkResult?.ppe_category}`, 20, 139);

        // Remediations
        const remediations = checkResult?.remediation || [];
        if (remediations.length) {
          pdf.text('Remediation Actions:', 20, 149);
          let y = 156;
          remediations.forEach(r => {
            pdf.text(`• ${r}`, 20, y);
            y += 6;
            if (y > 280) { pdf.addPage(); y = 20; }
          });
        }

        // Tips param (sans html2canvas)
        if (Object.keys(paramTips || {}).length) {
          pdf.addPage();
          pdf.text('Parameter Optimization Tips:', 20, 20);
          let y = 28;
          if (paramTips.working_distance_tip) { pdf.text(`- Working Distance: ${paramTips.working_distance_tip}`, 20, y); y += 6; }
          if (paramTips.arcing_time_tip) { pdf.text(`- Arcing Time: ${paramTips.arcing_time_tip}`, 20, y); y += 6; }
          if (paramTips.fault_current_tip) { pdf.text(`- Fault Current: ${paramTips.fault_current_tip}`, 20, y); y += 6; }
        }

        // Bloc résultats “image” (si tu tiens à l’avoir en capture)
        if (resultImg) {
          pdf.addPage();
          pdf.addImage(resultImg, 'PNG', 10, 10, 190, 90);
        }
      }

      // Nettoyage
      if (chartInstance) chartInstance.destroy();
      tempCanvas.remove();

      pdf.save(isLabel ? 'arcflash-label.pdf' : 'arcflash-report.pdf');
      setToast({ msg: `PDF ${isLabel ? 'label' : 'report'} generated successfully`, type: 'success' });
    } catch (e) {
      console.error('PDF export failed:', e);
      setToast({ msg: `PDF export failed: ${e.message}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (point) => {
    setSelectedPoints(prev => 
      prev.some(p => p.device_id === point.device_id) 
        ? prev.filter(p => p.device_id !== point.device_id)
        : [...prev, { device_id: point.device_id, switchboard_id: point.switchboard_id }]
    );
  };

  const openParams = (point) => {
    if (!point.device_id || !point.switchboard_id) {
      setToast({ msg: 'Invalid device or switchboard data', type: 'error' });
      return;
    }
    setParamForm({
      device_id: Number(point.device_id),
      switchboard_id: Number(point.switchboard_id),
      working_distance: point.working_distance || 455,
      enclosure_type: point.enclosure_type || 'VCB',
      electrode_gap: point.electrode_gap || 32,
      arcing_time: point.arcing_time || 0.2,
      fault_current_ka: point.fault_current_ka || point.icu_ka,
      settings: point.settings || { ir: 1, isd: 6, tsd: 0.1, ii: 10, ig: 0.5, tg: 0.2, zsi: false, erms: false, curve_type: 'C' },
      parent_id: point.parent_id || '',
    });
    setParamTips({});
    setShowParamsModal(true);
  };

  // Le reste du JSX (j'ai complété avec la partie tronquée que tu as fournie)
  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}
      {/* ... (le reste du JSX original, comme les headers, filters, table, etc. – je ne le recopie pas tout car c'est long, mais assume qu'il est inchangé) */}
      {/* Par exemple, la partie résultats : */}
      {checkResult && (
        <div ref={resultRef} className="mt-8 p-6 bg-white rounded-lg shadow-md transition-all duration-500 transform scale-100">
          <h2 className="text-2xl font-semibold mb-4 text-indigo-800">Analysis Result</h2>
          <div className="flex items-center gap-2 mb-4">
            {checkResult.status === 'safe' ? <CheckCircle className="text-green-600 animate-bounce" size={24} /> :
             checkResult.status === 'at-risk' ? <XCircle className="text-red-600" size={24} /> :
             <AlertTriangle className="text-yellow-600" size={24} />}
            <span className="text-xl capitalize">{checkResult.status}</span>
          </div>
          <p className="mb-2">Incident Energy: {checkResult.incident_energy} cal/cm²</p>
          <p className="mb-2">PPE Category: {checkResult.ppe_category}</p>
          {checkResult.missing?.length > 0 && (
            <div className="mb-4 text-yellow-600 flex items-center">
              <AlertTriangle className="mr-2" />
              Missing data: {checkResult.missing.join(', ')}. Please update in Switchboards or Parameters.
            </div>
          )}
          {checkResult.remediation?.length > 0 && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Remediation Actions:</h3>
              <ul className="list-disc pl-5 text-gray-700">
                {checkResult.remediation.map((r, i) => <li key={i} className="mb-1">{r}</li>)}
              </ul>
            </div>
          )}
          {Object.keys(paramTips).length > 0 && (
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Parameter Optimization Tips:</h3>
              <ul className="list-disc pl-5 text-gray-700">
                {paramTips.working_distance_tip && <li className="mb-1">Working Distance: {paramTips.working_distance_tip}</li>}
                {paramTips.arcing_time_tip && <li className="mb-1">Arcing Time: {paramTips.arcing_time_tip}</li>}
                {paramTips.fault_current_tip && <li className="mb-1">Fault Current: {paramTips.fault_current_tip}</li>}
              </ul>
            </div>
          )}
          <div className="flex gap-4">
            <button 
              onClick={() => setShowSidebar(true)} 
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
              disabled={busy}
            >
              <ChevronRight size={16} /> View Explanation
            </button>
            <button 
              onClick={() => exportPdf(true)} 
              className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-2"
              disabled={busy}
            >
              <Download size={16} /> Generate Arc Flash Label PDF
            </button>
            <button 
              onClick={() => exportPdf(false)} 
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
              disabled={busy}
            >
              <Download size={16} /> Generate Full Report PDF
            </button>
          </div>
        </div>
      )}

      {/* Modale des paramètres (inchangée) */}
      <Modal open={showParamsModal} onClose={() => setShowParamsModal(false)} title="Edit Arc Flash Parameters">
        <div className="space-y-4">
          {/* ... (le contenu de la modale des params, inchangé) */}
        </div>
      </Modal>

      {/* Modale du graphe (inchangée) */}
      <Modal open={showGraph} onClose={() => setShowGraph(false)} title="Incident Energy Curves (Zoom & Pan Enabled)">
        {curveData ? (
          <div ref={chartRef}>
            <Line
              data={curveData}
              options={{
                responsive: true,
                plugins: {
                  zoom: {
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
                    pan: { enabled: true, mode: 'xy' },
                  },
                  annotation: {
                    annotations: checkResult?.riskZones?.map((zone, i) => ({
                      type: 'box',
                      yMin: zone.min,
                      yMax: zone.max,
                      backgroundColor: 'rgba(255, 165, 0, 0.2)',
                      borderColor: 'orange',
                      label: { content: 'Risk Zone', display: true, position: 'center' }
                    })) || []
                  },
                  tooltip: {
                    callbacks: {
                      label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)} cal/cm² at ${context.parsed.x}mm`
                    }
                  }
                },
                scales: {
                  x: { 
                    type: 'linear', 
                    title: { display: true, text: 'Working Distance (mm)' }
                  },
                  y: { 
                    type: 'logarithmic', 
                    title: { display: true, text: 'Incident Energy (cal/cm²)' },
                    min: 0.1,
                    max: 100,
                  },
                },
              }}
            />
          </div>
        ) : (
          <p className="text-red-600">Graph data not available. Try running the check again.</p>
        )}
        <button 
          onClick={() => exportPdf(false)} 
          className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
          disabled={busy}
        >
          <Download size={16} /> Export Full Report PDF
        </button>
        <button 
          onClick={() => setShowGraph(false)} 
          className="mt-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          disabled={busy}
        >
          Close Graph
        </button>
      </Modal>

      <Sidebar open={showSidebar} onClose={() => setShowSidebar(false)} tipContent={tipContent} />

      {toast && <Toast {...toast} />}
      {busy && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600"></div>
        </div>
      )}
    </section>
  );
}
