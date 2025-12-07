import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, { 
  useNodesState, 
  useEdgesState, 
  Controls, 
  Background,
  Handle, 
  Position,
  useReactFlow,
  ReactFlowProvider,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { 
  ArrowLeft, Save, RefreshCw, Download, Zap, Edit2, 
  X, Printer, Settings, Layers, Box, AlertCircle, ShieldCheck, ArrowUpRight, Check
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== CONSTANTS ====================
const DEVICES_PER_FOLIO = 12;
const FOLIO_WIDTH = 2000; // Largeur virtuelle d'une page en pixels ReactFlow
const DEVICE_SPACING = 140;

// ==================== SYMBOLS (IEC STANDARD) ====================
// Symboles SVG vectoriels pour un rendu net
const IECSymbols = {
  Breaker: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="10" y1="5" x2="22" y2="27" />
      <line x1="22" y1="5" x2="10" y2="27" />
      <line x1="16" y1="0" x2="16" y2="5" />
      <line x1="16" y1="27" x2="16" y2="32" />
      <path d="M 12 5 L 16 0 L 20 5" fill="currentColor" stroke="none" />
    </g>
  ),
  Switch: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <circle cx="16" cy="27" r="2" />
      <line x1="16" y1="0" x2="16" y2="10" />
      <line x1="16" y1="27" x2="16" y2="32" />
      <line x1="16" y1="10" x2="26" y2="24" />
      <line x1="12" y1="10" x2="20" y2="10" />
    </g>
  ),
  Contactor: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="6" y="6" width="20" height="20" rx="2" />
      <path d="M 10 26 A 6 6 0 0 1 22 26" />
      <line x1="16" y1="0" x2="16" y2="6" />
      <line x1="16" y1="26" x2="16" y2="32" />
    </g>
  ),
  Fuse: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="10" y="6" width="12" height="20" />
      <line x1="16" y1="0" x2="16" y2="6" />
      <line x1="16" y1="26" x2="16" y2="32" />
      <line x1="16" y1="6" x2="16" y2="26" />
    </g>
  ),
  Differential: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <ellipse cx="16" cy="16" rx="12" ry="8" />
      <line x1="16" y1="0" x2="16" y2="32" />
    </g>
  ),
  ThermalRelay: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="6" y="6" width="20" height="20" />
      <path d="M 8 20 L 12 12 L 16 20 L 20 12 L 24 20" />
      <line x1="16" y1="0" x2="16" y2="6" />
      <line x1="16" y1="26" x2="16" y2="32" />
    </g>
  )
};

// ==================== CUSTOM NODES ====================

const SourceNode = ({ data }) => (
  <div className="flex flex-col items-center">
    <div className="bg-white border-2 border-gray-900 px-4 py-2 rounded-sm shadow-sm min-w-[140px] text-center relative">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-1">
        <Zap size={16} className="text-amber-500 fill-amber-500" />
      </div>
      <div className="font-bold text-sm text-gray-900">{data.label}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{data.subLabel}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-900 !w-3 !h-3 !rounded-none -bottom-1.5" />
    </div>
    <div className="h-8 w-0.5 bg-gray-900"></div>
  </div>
);

const BusbarNode = ({ data }) => (
  <div className="relative">
    <div 
      className="h-6 bg-gradient-to-b from-amber-600 via-amber-400 to-amber-700 shadow-md border-x-2 border-amber-800 flex items-center justify-center relative"
      style={{ width: data.width || 300, borderRadius: '2px' }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full" />
      <span className="text-[10px] text-amber-900 font-bold tracking-[0.3em] uppercase drop-shadow-sm select-none">
        Jeu de Barres 400V
      </span>
    </div>
    {/* Page Break Indicator if needed */}
    {data.isBreak && (
      <div className="absolute right-[-20px] top-1/2 -translate-y-1/2 text-gray-400 text-xs">
        &gt;&gt;
      </div>
    )}
  </div>
);

const DeviceNode = ({ data }) => {
  const { isIncoming, isDifferential, isComplete, type } = data;
  
  const getSymbol = () => {
    const t = (type || '').toLowerCase();
    if (t.includes('contactor')) return <IECSymbols.Contactor />;
    if (t.includes('switch')) return <IECSymbols.Switch />;
    if (t.includes('fuse')) return <IECSymbols.Fuse />;
    if (t.includes('relay')) return <IECSymbols.ThermalRelay />;
    return <IECSymbols.Breaker />;
  };

  const strokeColor = isIncoming ? "text-amber-600" : isDifferential ? "text-purple-600" : "text-gray-800";
  const boxBorder = isIncoming ? "border-amber-500 shadow-amber-100" : "border-gray-300";

  return (
    <div className="flex flex-col items-center group relative">
      <div className="h-6 w-0.5 bg-gray-800 relative">
        <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full top-0" />
      </div>

      <div className={`bg-white border-2 ${boxBorder} shadow-sm p-1 rounded-sm w-28 transition-all group-hover:shadow-md group-hover:border-blue-400 relative`}>
        <div className="absolute top-0 right-0 bg-gray-100 text-[8px] px-1 text-gray-500 font-mono">{data.poles}P</div>
        
        <div className="bg-gray-50 border-b border-gray-100 p-1 text-center mb-1 mt-2 min-h-[24px] flex items-center justify-center">
           <div className="text-[10px] font-bold text-gray-800 truncate w-full" title={data.name}>
             {data.position ? <span className="mr-1 bg-gray-800 text-white px-1 rounded-sm">{data.position}</span> : null}
             {data.name || data.reference || '?'}
           </div>
        </div>

        <div className={`h-12 w-full flex items-center justify-center ${strokeColor}`}>
           <svg width="32" height="32" viewBox="0 0 32 32" overflow="visible">
              {isDifferential && <IECSymbols.Differential />}
              {getSymbol()}
           </svg>
        </div>

        <div className="text-[9px] text-center font-mono leading-tight text-gray-600 mt-1 border-t border-gray-100 pt-1">
          <div className="font-bold">{data.reference}</div>
          <div>{data.in_amps ? `${data.in_amps}A` : ''} {data.icu_ka ? `• ${data.icu_ka}kA` : ''}</div>
        </div>
        
        {!isComplete && (
           <div className="absolute top-0 left-0 p-0.5">
             <AlertCircle size={10} className="text-orange-500 fill-orange-100" />
           </div>
        )}
      </div>

      <div className="h-8 w-0.5 bg-gray-800 relative flex flex-col items-center">
         <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full bottom-0" />
         <div className="absolute top-2 left-2 text-[8px] text-gray-400 font-mono whitespace-nowrap bg-white px-0.5 rotate-90 origin-left border border-gray-200">
            {/* Simulation section câble */}
            {data.in_amps < 20 ? '3G2.5' : data.in_amps < 40 ? '5G6' : '5G16'}
         </div>
      </div>

      {data.downstreamLabel ? (
        <div className="absolute -bottom-10 bg-green-50 text-green-800 text-[9px] border border-green-200 px-2 py-1 rounded-sm whitespace-nowrap shadow-sm font-bold flex items-center gap-1">
          <ArrowUpRight size={10} /> {data.downstreamLabel}
        </div>
      ) : (
        <div className="absolute -bottom-6 text-[9px] text-gray-400 font-mono">
           X{data.position?.replace(/\./g, '') || '?'}-1
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  source: SourceNode,
  busbar: BusbarNode,
  breaker: DeviceNode,
};

// ==================== SIDEBAR PROPERTY EDITOR (STYLED LIKE MAIN PAGE) ====================

const inputBaseClass = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none";

const PropertySidebar = ({ selectedNode, onClose, onSave }) => {
  const [formData, setFormData] = useState({});
  const [downstreamSearch, setDownstreamSearch] = useState('');
  const [downstreamResults, setDownstreamResults] = useState([]);
  const [showDownstreamResults, setShowDownstreamResults] = useState(false);

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        name: selectedNode.data.name || '',
        reference: selectedNode.data.reference || '',
        device_type: selectedNode.data.type || 'Low Voltage Circuit Breaker',
        in_amps: selectedNode.data.in_amps || '',
        icu_ka: selectedNode.data.icu_ka || '',
        poles: selectedNode.data.poles || 3,
        voltage_v: selectedNode.data.voltage_v || 400,
        position_number: selectedNode.data.position || '',
        is_differential: selectedNode.data.isDifferential || false,
        downstream_switchboard_id: selectedNode.data.downstreamId || null,
        downstream_name: selectedNode.data.downstreamLabel || ''
      });
    }
  }, [selectedNode]);

  // Downstream Search
  useEffect(() => {
    const search = async () => {
      if (!downstreamSearch) {
        setDownstreamResults([]);
        return;
      }
      try {
        const res = await api.switchboard.searchDownstreams(downstreamSearch);
        setDownstreamResults(res.suggestions || []);
      } catch (err) {
        console.error(err);
      }
    };
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [downstreamSearch]);

  if (!selectedNode || selectedNode.type !== 'breaker') return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-96 bg-white border-l shadow-2xl z-50 flex flex-col animate-slideLeft">
      <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex items-center justify-center relative">
        <h3 className="font-bold flex items-center gap-2">
          <Edit2 size={16} /> Édition Disjoncteur
        </h3>
        <button onClick={onClose} className="absolute right-4 p-1 hover:bg-white/20 rounded-full text-white">
          <X size={18} />
        </button>
      </div>
      
      <div className="p-5 space-y-5 flex-1 overflow-y-auto bg-gray-50">
        
        {/* IDENTIFICATION */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Identification</h4>
          <div className="grid grid-cols-3 gap-3">
             <div className="col-span-1">
               <label className="block text-xs font-medium text-gray-500 mb-1">Repère</label>
               <input type="text" value={formData.position_number} onChange={e => setFormData({...formData, position_number: e.target.value})} className={`${inputBaseClass} font-mono font-bold text-center`} />
             </div>
             <div className="col-span-2">
               <label className="block text-xs font-medium text-gray-500 mb-1">Référence</label>
               <input type="text" value={formData.reference} onChange={e => setFormData({...formData, reference: e.target.value})} className={inputBaseClass} />
             </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Désignation</label>
            <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputBaseClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select value={formData.device_type} onChange={e => setFormData({...formData, device_type: e.target.value})} className={inputBaseClass}>
              <option value="Low Voltage Circuit Breaker">Disjoncteur</option>
              <option value="Switch Disconnector">Interrupteur</option>
              <option value="Contactor">Contacteur</option>
              <option value="Thermal Relay">Relais Thermique</option>
              <option value="Fuse">Fusible</option>
            </select>
          </div>
        </div>

        {/* DONNÉES ÉLECTRIQUES */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Données Électriques</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Calibre (A)</label>
              <input type="number" value={formData.in_amps} onChange={e => setFormData({...formData, in_amps: e.target.value})} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pdc (kA)</label>
              <input type="number" value={formData.icu_ka} onChange={e => setFormData({...formData, icu_ka: e.target.value})} className={inputBaseClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pôles</label>
              <select value={formData.poles} onChange={e => setFormData({...formData, poles: e.target.value})} className={inputBaseClass}>
                <option value="1">1P</option><option value="2">2P</option><option value="3">3P</option><option value="4">4P</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tension (V)</label>
              <input type="number" value={formData.voltage_v} onChange={e => setFormData({...formData, voltage_v: e.target.value})} className={inputBaseClass} />
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100 cursor-pointer" onClick={() => setFormData({...formData, is_differential: !formData.is_differential})}>
            <div className={`w-5 h-5 rounded border flex items-center justify-center ${formData.is_differential ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>
              {formData.is_differential && <Check size={14} className="text-white" />}
            </div>
            <span className="text-sm font-medium text-purple-900">Bloc Différentiel (Vigi)</span>
          </div>
        </div>

        {/* ALIMENTATION AVAL */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
           <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><ArrowUpRight size={14}/> Alimentation Aval</h4>
           
           {formData.downstream_switchboard_id ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 p-3 rounded-lg">
                <div className="text-sm font-bold text-green-800">{formData.downstream_name}</div>
                <button onClick={() => setFormData({...formData, downstream_switchboard_id: null, downstream_name: ''})} className="text-green-600 hover:text-red-500"><X size={16}/></button>
              </div>
           ) : (
              <div className="relative">
                <input 
                  type="text" 
                  value={downstreamSearch} 
                  onChange={e => { setDownstreamSearch(e.target.value); setShowDownstreamResults(true); }}
                  placeholder="Rechercher tableau..." 
                  className={inputBaseClass} 
                />
                {showDownstreamResults && downstreamResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto">
                    {downstreamResults.map(b => (
                      <div key={b.id} onClick={() => {
                        setFormData({...formData, downstream_switchboard_id: b.id, downstream_name: b.name});
                        setDownstreamSearch('');
                        setShowDownstreamResults(false);
                      }} className="p-2 hover:bg-gray-100 cursor-pointer text-sm font-medium text-gray-800">
                        {b.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
           )}
        </div>

      </div>

      <div className="p-4 border-t bg-white flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={() => onSave(selectedNode.id, formData)} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center justify-center gap-2">
          <Save size={18} /> Enregistrer
        </button>
      </div>
    </div>
  );
};

// ==================== TITLE BLOCK (CARTOUCHE) ====================

// Ce composant est affiché à l'écran mais MASQUÉ lors de l'export PDF (via className)
const TitleBlockOverlay = ({ board, settings, folio, totalFolios }) => (
  <div className="title-block-overlay absolute bottom-4 right-4 bg-white border-2 border-gray-900 p-0 shadow-lg z-10 w-96 hidden md:block select-none pointer-events-none">
    <div className="grid grid-cols-3 border-b border-gray-900">
      <div className="col-span-2 p-2 border-r border-gray-900">
        <div className="text-[10px] uppercase text-gray-500">Projet / Client</div>
        <div className="font-bold text-sm truncate">{settings?.company_name || 'Mon Entreprise'}</div>
        <div className="text-xs truncate">{settings?.company_address}</div>
      </div>
      <div className="p-2 flex items-center justify-center">
        {/* Placeholder Logo */}
        <Box size={24} className="text-gray-300" />
      </div>
    </div>
    <div className="grid grid-cols-4">
      <div className="col-span-3 p-2 border-r border-gray-900">
        <div className="text-[10px] uppercase text-gray-500">Titre du Plan</div>
        <div className="font-bold text-lg leading-tight truncate">{board?.name}</div>
        <div className="text-xs font-mono">{board?.code}</div>
      </div>
      <div className="col-span-1">
        <div className="p-1 border-b border-gray-900 text-center">
          <div className="text-[8px] text-gray-500">Date</div>
          <div className="text-xs">{new Date().toLocaleDateString()}</div>
        </div>
        <div className="p-1 text-center bg-gray-100">
          <div className="text-[8px] text-gray-500">Folio</div>
          <div className="font-bold text-sm">{folio || 1} / {totalFolios || 1}</div>
        </div>
      </div>
    </div>
  </div>
);

// ==================== MAIN COMPONENT ====================

const DiagramContent = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [board, setBoard] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [currentFolio, setCurrentFolio] = useState(1);
  const [totalFolios, setTotalFolios] = useState(1);
  
  const { fitView, setViewport, getViewport } = useReactFlow();

  // Load Settings
  useEffect(() => {
    api.switchboard.getSettings().then(setSettings).catch(console.error);
  }, []);

  // Load Data & Build Folios
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const boardRes = await api.switchboard.getBoard(id);
      setBoard(boardRes);
      const devicesRes = await api.switchboard.listDevices(id);
      const devices = devicesRes.data || [];

      // Identify elements
      const upstreamSources = boardRes.upstream_sources || [];
      if (upstreamSources.length === 0) {
        upstreamSources.push({ id: 'src-def', source_board_name: boardRes.is_principal ? 'Réseau' : 'Amont', name: 'Arrivée' });
      }
      const mainIncoming = devices.find(d => d.is_main_incoming);
      const feeders = devices.filter(d => !d.is_main_incoming);

      // --- Pagination Logic ---
      const totalPages = Math.max(1, Math.ceil(feeders.length / DEVICES_PER_FOLIO));
      setTotalFolios(totalPages);

      const newNodes = [];
      const newEdges = [];

      // Helper to create edges
      const mkEdge = (s, t, main=false) => ({
        id: `e-${s}-${t}`, source: s, target: t, type: 'step',
        style: { stroke: main ? '#b45309' : '#1f2937', strokeWidth: main ? 3 : 2 }
      });

      // --- Build Nodes per Folio ---
      for (let folio = 0; folio < totalPages; folio++) {
        const xOffset = folio * FOLIO_WIDTH;
        
        // 1. Sources (Repeat on Page 1 or all? Let's put Main Source only on Page 1)
        if (folio === 0) {
          upstreamSources.forEach((src, idx) => {
            newNodes.push({
              id: `source-${idx}`,
              type: 'source',
              position: { x: (idx * 200), y: 0 },
              data: { label: src.source_board_name, subLabel: src.name }
            });
          });
        } else {
          // Visual connector from previous page
          newNodes.push({
            id: `folio-con-in-${folio}`,
            type: 'source', // Reusing source style for simplicity
            position: { x: xOffset, y: 100 },
            data: { label: `Venant Folio ${folio}`, subLabel: 'L1/L2/L3/N' }
          });
        }

        // 2. Busbar Segment
        const startIdx = folio * DEVICES_PER_FOLIO;
        const pageFeeders = feeders.slice(startIdx, startIdx + DEVICES_PER_FOLIO);
        const busbarWidth = Math.max(400, pageFeeders.length * DEVICE_SPACING + 100);
        
        // Center busbar relative to feeders on this page
        const busbarX = xOffset + (pageFeeders.length * DEVICE_SPACING)/2 - busbarWidth/2 + (DEVICE_SPACING/2);

        newNodes.push({
          id: `busbar-${folio}`,
          type: 'busbar',
          position: { x: busbarX, y: 180 },
          data: { label: `${boardRes.code} (Folio ${folio+1})`, width: busbarWidth, isBreak: folio < totalPages-1 }
        });

        // Link Main Incoming to Busbar 0
        if (folio === 0 && mainIncoming) {
           const incId = `dev-${mainIncoming.id}`;
           newNodes.push({
             id: incId, type: 'breaker', position: { x: 50, y: 80 },
             data: { ...mapDeviceToData(mainIncoming), isIncoming: true }
           });
           upstreamSources.forEach((_, i) => newEdges.push(mkEdge(`source-${i}`, incId, true)));
           newEdges.push(mkEdge(incId, `busbar-0`, true));
        } else if (folio === 0) {
           upstreamSources.forEach((_, i) => newEdges.push(mkEdge(`source-${i}`, `busbar-0`, true)));
        }

        // 3. Feeders Placement
        pageFeeders.forEach((dev, i) => {
           const devId = `dev-${dev.id}`;
           // Absolute X position calculation
           // Local X on page + Page Offset
           const localX = (i * DEVICE_SPACING);
           const absoluteX = xOffset + localX; 
           
           // Center group under busbar start
           const finalX = busbarX + 50 + localX - (busbarWidth/2) + 150; // Approximative centering

           // Override with saved pos if exists (GLOBAL coords)
           const savedPos = dev.diagram_data?.position;

           newNodes.push({
             id: devId,
             type: 'breaker',
             position: savedPos || { x: finalX, y: 300 },
             data: mapDeviceToData(dev)
           });

           newEdges.push(mkEdge(`busbar-${folio}`, devId));
        });
      }

      setNodes(newNodes);
      setEdges(newEdges);
      
      // Initial Fit View
      setTimeout(() => fitView({ padding: 0.1, duration: 800, nodes: newNodes.slice(0, 5) }), 100);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id, setNodes, setEdges, fitView]);

  useEffect(() => { loadData(); }, [loadData]);

  // Helpers
  const mapDeviceToData = (dev) => ({
    name: dev.name,
    reference: dev.reference,
    type: dev.device_type,
    in_amps: dev.in_amps,
    icu_ka: dev.icu_ka,
    poles: dev.poles,
    voltage_v: dev.voltage_v,
    isDifferential: dev.is_differential,
    isComplete: dev.is_complete,
    position: dev.position_number,
    downstreamLabel: dev.downstream_switchboard_name || dev.downstream_switchboard_code,
    downstreamId: dev.downstream_switchboard_id
  });

  // Navigation Handlers
  const handleBack = () => {
    // Force specific path to avoid "Home" redirect issue
    if (board && board.id) {
        navigate(`/switchboards?board=${board.id}`);
    } else {
        navigate('/switchboards');
    }
  };

  const handleNodeSave = async (nodeId, newData) => {
    const dbId = parseInt(nodeId.replace('dev-', ''));
    if (isNaN(dbId)) return;
    try {
      await api.switchboard.updateDevice(dbId, {
        name: newData.name, reference: newData.reference, device_type: newData.device_type,
        in_amps: newData.in_amps, icu_ka: newData.icu_ka, poles: newData.poles, voltage_v: newData.voltage_v,
        position_number: newData.position_number, is_differential: newData.is_differential,
        downstream_switchboard_id: newData.downstream_switchboard_id
      });
      // Local Update
      setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...newData, type: newData.device_type, isDifferential: newData.is_differential, downstreamLabel: newData.downstream_name } } : n));
    } catch(e) { alert("Erreur sauvegarde"); }
  };

  const handleSaveLayout = async () => {
    setSaving(true);
    const updates = getNodes().filter(n => n.type === 'breaker').map(n => {
       const did = parseInt(n.id.replace('dev-', ''));
       return !isNaN(did) ? api.switchboard.updateDevice(did, { diagram_data: { position: n.position } }) : null;
    }).filter(Boolean);
    await Promise.all(updates);
    await api.switchboard.updateBoard(id, { diagram_data: { layout: 'custom' } });
    setSaving(false);
    alert("Disposition sauvegardée !");
  };

  // 🖨️ PDF EXPORT MULTI-PAGES (Fixes Double Title Block)
  const handleExportPDF = async () => {
    if (reactFlowWrapper.current === null) return;
    
    const flowElement = document.querySelector('.react-flow');
    const originalBg = flowElement.style.background;
    flowElement.style.background = '#fff';

    // Hide Overlay UI
    document.querySelectorAll('.react-flow__controls, .react-flow__panel, .title-block-overlay').forEach(el => el.style.display = 'none');

    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < totalFolios; i++) {
        if (i > 0) pdf.addPage();

        // 1. Move Viewport to specific Folio Area
        const xPos = i * FOLIO_WIDTH;
        // We define a fixed window for the folio
        const w = FOLIO_WIDTH;
        const h = 1000; // Estimated height of diagram content
        
        await setViewport({ x: -xPos + 50, y: 50, zoom: 1 }); // Shift viewport to current folio
        
        // Wait for render
        await new Promise(r => setTimeout(r, 500));

        // 2. Capture Viewport
        const dataUrl = await toPng(reactFlowWrapper.current, {
           backgroundColor: '#fff',
           pixelRatio: 2,
           width: reactFlowWrapper.current.offsetWidth, // Capture visible screen
           height: reactFlowWrapper.current.offsetHeight 
        });

        // 3. Add to PDF (Fit to Page)
        pdf.addImage(dataUrl, 'PNG', 10, 10, pdfW - 20, pdfH - 40);

        // 4. Draw Vector Title Block (Clean, No Double)
        drawTitleBlock(pdf, i + 1, totalFolios, pdfW, pdfH);
      }

      pdf.save(`${board?.code}_schema.pdf`);

    } catch (e) {
      console.error(e);
      alert("Erreur Export PDF");
    } finally {
      // Restore UI
      flowElement.style.background = originalBg;
      document.querySelectorAll('.react-flow__controls, .react-flow__panel, .title-block-overlay').forEach(el => el.style.display = '');
      fitView(); // Reset view
    }
  };

  const drawTitleBlock = (pdf, folio, total, w, h) => {
    const tbW = 140; const tbH = 30; const x = w - tbW - 10; const y = h - tbH - 10;
    
    pdf.setFillColor(255); pdf.rect(x, y, tbW, tbH, 'F'); 
    pdf.setDrawColor(0); pdf.setLineWidth(0.3); pdf.rect(x, y, tbW, tbH);
    
    // Grid
    pdf.line(x + 90, y, x + 90, y + tbH); // Vert separator
    pdf.line(x, y + 15, x + tbW, y + 15); // Horiz separator

    // Text
    pdf.setFontSize(7); pdf.setTextColor(100);
    pdf.text("CLIENT / PROJET", x + 2, y + 4);
    pdf.text("TITRE DU DOCUMENT", x + 2, y + 19);
    
    pdf.setFontSize(10); pdf.setTextColor(0); pdf.setFont("helvetica", "bold");
    pdf.text(settings?.company_name || "Mon Entreprise", x + 2, y + 9);
    pdf.text(board?.name || "Schéma Électrique", x + 2, y + 24);
    
    pdf.setFontSize(8); pdf.setFont("helvetica", "normal");
    pdf.text(settings?.company_address || "", x + 2, y + 13);
    pdf.text(`Code: ${board?.code}`, x + 2, y + 28);

    // Meta
    pdf.setFontSize(7); pdf.setTextColor(100);
    pdf.text("DATE", x + 92, y + 4);
    pdf.text("FOLIO", x + 92, y + 19);
    
    pdf.setFontSize(10); pdf.setTextColor(0);
    pdf.text(new Date().toLocaleDateString(), x + 92, y + 10);
    pdf.text(`${folio} / ${total}`, x + 92, y + 25);
  };

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Chargement...</div>;

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Navbar */}
      <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-800 text-sm md:text-base flex items-center gap-2">
              <Layers size={16} className="text-blue-600" />
              {board?.name} <span className="text-gray-400 font-normal">| {board?.code}</span>
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSaveLayout} disabled={saving} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow-sm transition-colors disabled:opacity-50">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            <span className="hidden md:inline">Sauvegarder</span>
          </button>
          <button onClick={handleExportPDF} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm shadow-sm transition-colors">
            <Printer size={16} /> <span className="hidden md:inline">PDF</span>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative flex overflow-hidden" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedNode(node)}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[20, 20]}
          minZoom={0.1}
          maxZoom={4}
          nodesConnectable={false} // Read-only connections for now
        >
          <Background color="#cbd5e1" gap={20} size={1} />
          <Controls />
          <Panel position="bottom-center" className="bg-white/90 backdrop-blur px-4 py-2 rounded-full border shadow-sm text-xs text-gray-600 flex gap-4">
             <span className="flex items-center gap-1"><div className="w-3 h-3 bg-amber-500 rounded-sm"></div> Arrivée</span>
             <span className="flex items-center gap-1"><div className="w-3 h-3 border-2 border-purple-500 rounded-full"></div> Différentiel</span>
             <span className="flex items-center gap-1 font-bold">Folios: {totalFolios}</span>
          </Panel>
        </ReactFlow>

        {/* Overlay Title Block (Visible on Screen Only) */}
        <TitleBlockOverlay board={board} settings={settings} folio={1} totalFolios={totalFolios} />

        {/* Property Sidebar */}
        {selectedNode && selectedNode.type === 'breaker' && (
          <PropertySidebar 
            selectedNode={selectedNode} 
            onClose={() => setSelectedNode(null)} 
            onSave={handleNodeSave} 
          />
        )}
      </div>
    </div>
  );
};

export default function SwitchboardDiagram() {
  return (
    <ReactFlowProvider>
      <DiagramContent />
    </ReactFlowProvider>
  );
}
