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
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf'; // Nécessite npm install jspdf
import { 
  ArrowLeft, Save, RefreshCw, Download, Zap, Edit2, 
  X, Printer, Settings, Layers, Box
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== SYMBOLS (IEC STANDARD - EXTENDED) ====================

const IECSymbols = {
  // Disjoncteur
  Breaker: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="10" y1="5" x2="22" y2="27" />
      <line x1="22" y1="5" x2="10" y2="27" />
      <line x1="16" y1="0" x2="16" y2="5" />
      <line x1="16" y1="27" x2="16" y2="32" />
      <path d="M 12 5 L 16 0 L 20 5" fill="currentColor" stroke="none" /> {/* Petit clapet pour disjoncteur */}
    </g>
  ),
  // Interrupteur / Sectionneur
  Switch: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <circle cx="16" cy="27" r="2" />
      <line x1="16" y1="0" x2="16" y2="10" />
      <line x1="16" y1="27" x2="16" y2="32" />
      <line x1="16" y1="10" x2="26" y2="24" />
      <line x1="12" y1="10" x2="20" y2="10" /> {/* Barre de coupure */}
    </g>
  ),
  // Contacteur (Rectangle avec demi-cercle)
  Contactor: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="6" y="6" width="20" height="20" rx="2" />
      <path d="M 10 26 A 6 6 0 0 1 22 26" />
      <line x1="16" y1="0" x2="16" y2="6" />
      <line x1="16" y1="26" x2="16" y2="32" />
    </g>
  ),
  // Fusible
  Fuse: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="10" y="6" width="12" height="20" />
      <line x1="16" y1="0" x2="16" y2="6" />
      <line x1="16" y1="26" x2="16" y2="32" />
      <line x1="16" y1="6" x2="16" y2="26" />
    </g>
  ),
  // Différentiel (Ellipse)
  Differential: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <ellipse cx="16" cy="16" rx="12" ry="8" />
      <line x1="16" y1="0" x2="16" y2="32" />
    </g>
  ),
  // Relais Thermique
  ThermalRelay: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="6" y="6" width="20" height="20" />
      <path d="M 8 20 L 12 12 L 16 20 L 20 12 L 24 20" /> {/* Dent de scie */}
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
  <div 
    className="h-6 bg-gradient-to-b from-amber-600 via-amber-400 to-amber-700 shadow-md border-x-2 border-amber-800 flex items-center justify-center relative"
    style={{ width: data.width || 300, borderRadius: '2px' }}
  >
    <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full" />
    <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full" />
    <span className="text-[10px] text-amber-900 font-bold tracking-[0.3em] uppercase drop-shadow-sm select-none">
      Jeu de Barres 400V - {data.label}
    </span>
  </div>
);

// Composant Device Unifié (Disjoncteur, Contacteur, etc.)
const DeviceNode = ({ data }) => {
  const { isIncoming, isDifferential, isComplete, type } = data;
  
  // Logic to choose symbol
  const getSymbol = () => {
    // Si c'est un disjoncteur
    if (type?.toLowerCase().includes('contactor') || type?.toLowerCase().includes('contacteur')) return <IECSymbols.Contactor />;
    if (type?.toLowerCase().includes('switch') || type?.toLowerCase().includes('interrupteur')) return <IECSymbols.Switch />;
    if (type?.toLowerCase().includes('fuse') || type?.toLowerCase().includes('fusible')) return <IECSymbols.Fuse />;
    if (type?.toLowerCase().includes('relay') || type?.toLowerCase().includes('relais')) return <IECSymbols.ThermalRelay />;
    return <IECSymbols.Breaker />; // Default
  };

  const strokeColor = isIncoming ? "text-amber-600" : isDifferential ? "text-purple-600" : "text-gray-800";
  const boxBorder = isIncoming ? "border-amber-500 shadow-amber-100" : "border-gray-300";

  return (
    <div className="flex flex-col items-center group relative">
      {/* Wire In */}
      <div className="h-6 w-0.5 bg-gray-800 relative">
        <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full top-0" />
      </div>

      {/* Box */}
      <div className={`bg-white border-2 ${boxBorder} shadow-sm p-1 rounded-sm w-28 transition-all group-hover:shadow-md group-hover:border-blue-400 relative`}>
        {/* Type Badge */}
        <div className="absolute top-0 right-0 bg-gray-100 text-[8px] px-1 text-gray-500">{data.poles}P</div>

        {/* Header Name */}
        <div className="bg-gray-50 border-b border-gray-100 p-1 text-center mb-1 mt-2">
           <div className="text-[10px] font-bold text-gray-800 truncate" title={data.name}>
             {data.position ? <span className="mr-1 bg-gray-800 text-white px-1 rounded-sm">{data.position}</span> : null}
             {data.name || data.reference || '?'}
           </div>
        </div>

        {/* Symbol */}
        <div className={`h-12 w-full flex items-center justify-center ${strokeColor}`}>
           <svg width="32" height="32" viewBox="0 0 32 32" overflow="visible">
              {isDifferential && <IECSymbols.Differential />}
              {getSymbol()}
           </svg>
        </div>

        {/* Specs */}
        <div className="text-[9px] text-center font-mono leading-tight text-gray-600 mt-1 border-t border-gray-100 pt-1">
          <div className="font-bold">{data.reference}</div>
          <div>{data.in_amps ? `${data.in_amps}A` : ''} {data.icu_ka ? `• ${data.icu_ka}kA` : ''}</div>
        </div>
      </div>

      {/* Wire Out */}
      <div className="h-8 w-0.5 bg-gray-800 relative flex flex-col items-center">
         <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full bottom-0" />
         
         {/* Cable Info Placeholder (Simulation de départ) */}
         <div className="absolute top-2 left-2 text-[8px] text-gray-400 font-mono whitespace-nowrap bg-white px-0.5 rotate-90 origin-left">
            {data.in_amps < 20 ? '3G2.5' : data.in_amps < 40 ? '5G6' : '5G16'} {/* Placeholder logic */}
         </div>
      </div>

      {/* Destination Label */}
      {data.downstreamLabel ? (
        <div className="absolute -bottom-10 bg-green-50 text-green-800 text-[9px] border border-green-200 px-2 py-1 rounded-sm whitespace-nowrap shadow-sm font-bold flex items-center gap-1">
          <ArrowLeft size={8} className="rotate-180" /> {data.downstreamLabel}
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
  breaker: DeviceNode, // On utilise le même node générique pour tout device
};

// ==================== SIDEBAR PROPERTY EDITOR ====================

const PropertySidebar = ({ selectedNode, onClose, onSave }) => {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        name: selectedNode.data.name || '',
        reference: selectedNode.data.reference || '',
        device_type: selectedNode.data.type || 'Low Voltage Circuit Breaker',
        in_amps: selectedNode.data.in_amps || '',
        position_number: selectedNode.data.position || '',
        is_differential: selectedNode.data.isDifferential || false
      });
    }
  }, [selectedNode]);

  if (!selectedNode || selectedNode.type !== 'breaker') return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-white border-l shadow-2xl z-20 flex flex-col animate-slideLeft">
      <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Edit2 size={16} /> Propriétés
        </h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded text-gray-500">
          <X size={18} />
        </button>
      </div>
      
      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase">Type d'appareil</label>
          <select 
            value={formData.device_type}
            onChange={e => setFormData({...formData, device_type: e.target.value})}
            className="w-full mt-1 p-2 border rounded-md text-sm bg-white"
          >
            <option value="Low Voltage Circuit Breaker">Disjoncteur</option>
            <option value="Switch Disconnector">Interrupteur / Sectionneur</option>
            <option value="Contactor">Contacteur</option>
            <option value="Thermal Relay">Relais Thermique</option>
            <option value="Fuse">Fusible</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase">Référence</label>
          <input 
            type="text" 
            value={formData.reference} 
            onChange={e => setFormData({...formData, reference: e.target.value})}
            className="w-full mt-1 p-2 border rounded-md text-sm" 
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase">Désignation</label>
          <textarea 
            rows={3}
            value={formData.name} 
            onChange={e => setFormData({...formData, name: e.target.value})}
            className="w-full mt-1 p-2 border rounded-md text-sm" 
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase">Calibre (A)</label>
            <input 
              type="number" 
              value={formData.in_amps} 
              onChange={e => setFormData({...formData, in_amps: e.target.value})}
              className="w-full mt-1 p-2 border rounded-md text-sm" 
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase">Repère</label>
            <input 
              type="text" 
              value={formData.position_number} 
              onChange={e => setFormData({...formData, position_number: e.target.value})}
              className="w-full mt-1 p-2 border rounded-md text-sm font-mono" 
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 p-3 bg-gray-50 rounded-md border">
          <input 
            type="checkbox" 
            checked={formData.is_differential}
            onChange={e => setFormData({...formData, is_differential: e.target.checked})}
            className="w-4 h-4 text-blue-600 rounded" 
          />
          <span className="text-sm text-gray-700">Bloc Différentiel (Vigi)</span>
        </div>
      </div>

      <div className="p-4 border-t bg-gray-50">
        <button 
          onClick={() => onSave(selectedNode.id, formData)}
          className="w-full py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
        >
          <Save size={16} /> Enregistrer
        </button>
      </div>
    </div>
  );
};

// ==================== TITLE BLOCK (CARTOUCHE) ====================

const TitleBlock = ({ board, settings }) => (
  <div className="absolute bottom-4 right-4 bg-white border-2 border-gray-900 p-0 shadow-lg z-10 w-96 hidden md:block">
    <div className="grid grid-cols-3 border-b border-gray-900">
      <div className="col-span-2 p-2 border-r border-gray-900">
        <div className="text-[10px] uppercase text-gray-500">Projet / Client</div>
        <div className="font-bold text-sm truncate">{settings?.company_name || 'Mon Entreprise'}</div>
        <div className="text-xs truncate">{settings?.company_address}</div>
      </div>
      <div className="p-2 flex items-center justify-center">
        {settings?.logo ? <img src={settings.logo} className="max-h-10 max-w-full" alt="Logo" /> : <Box size={24} />}
      </div>
    </div>
    <div className="grid grid-cols-4">
      <div className="col-span-3 p-2 border-r border-gray-900">
        <div className="text-[10px] uppercase text-gray-500">Titre du Plan</div>
        <div className="font-bold text-lg leading-tight">{board?.name}</div>
        <div className="text-xs font-mono">{board?.code}</div>
      </div>
      <div className="col-span-1">
        <div className="p-1 border-b border-gray-900 text-center">
          <div className="text-[8px] text-gray-500">Date</div>
          <div className="text-xs">{new Date().toLocaleDateString()}</div>
        </div>
        <div className="p-1 text-center bg-gray-100">
          <div className="text-[8px] text-gray-500">Folio</div>
          <div className="font-bold text-sm">01 / 01</div>
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
  
  const { fitView, getNodes, getViewport } = useReactFlow();

  // Load Settings
  useEffect(() => {
    api.switchboard.getSettings().then(setSettings).catch(console.error);
  }, []);

  // Load Data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const boardRes = await api.switchboard.getBoard(id);
      setBoard(boardRes);
      const devicesRes = await api.switchboard.listDevices(id);
      const devices = devicesRes.data || [];

      // --- Construction ---
      const newNodes = [];
      const newEdges = [];
      
      // 1. Sources
      const upstreamSources = boardRes.upstream_sources || [];
      if (upstreamSources.length === 0) {
        upstreamSources.push({ 
          id: 'src-default', 
          source_board_name: boardRes.is_principal ? 'Réseau' : 'Amont', 
          name: 'Arrivée' 
        });
      }

      upstreamSources.forEach((src, idx) => {
        newNodes.push({
          id: `source-${idx}`,
          type: 'source',
          position: { x: (idx * 200), y: 0 },
          data: { label: src.source_board_name, subLabel: src.name }
        });
      });

      // 2. Busbar
      const feeders = devices.filter(d => !d.is_main_incoming);
      const busbarWidth = Math.max(400, feeders.length * 160 + 100);
      
      const busbarNode = {
        id: 'busbar',
        type: 'busbar',
        position: { x: 0, y: 180 },
        data: { label: boardRes.code, width: busbarWidth },
        draggable: false
      };
      
      // 3. Main Incoming
      const mainIncoming = devices.find(d => d.is_main_incoming);
      if (mainIncoming) {
        const incomerId = `dev-${mainIncoming.id}`;
        newNodes.push({
          id: incomerId,
          type: 'breaker',
          position: { x: 50, y: 80 },
          data: { ...mapDeviceToData(mainIncoming), isIncoming: true }
        });
        
        upstreamSources.forEach((_, idx) => {
          newEdges.push(createEdge(`source-${idx}`, incomerId, true));
        });
        newEdges.push(createEdge(incomerId, 'busbar'));
      } else {
        upstreamSources.forEach((_, idx) => {
          newEdges.push(createEdge(`source-${idx}`, 'busbar'));
        });
      }

      // 4. Feeders
      feeders.forEach((dev, idx) => {
        const nodeId = `dev-${dev.id}`;
        const startX = -(feeders.length * 160) / 2 + 80; 
        const xPos = startX + (idx * 160);
        const savedPos = dev.diagram_data?.position;
        
        newNodes.push({
          id: nodeId,
          type: 'breaker',
          position: savedPos || { x: xPos, y: 300 }, 
          data: mapDeviceToData(dev)
        });

        newEdges.push({
          id: `e-bus-${nodeId}`,
          source: 'busbar',
          target: nodeId,
          type: 'step',
          style: { stroke: '#1f2937', strokeWidth: 2 },
        });
      });

      newNodes.push(busbarNode);

      if (!devices.some(d => d.diagram_data?.position) && boardRes.diagram_data?.layout !== 'custom') {
         busbarNode.position.x = -(busbarWidth / 2);
      }

      setNodes(newNodes);
      setEdges(newEdges);
      
      setTimeout(() => fitView({ padding: 0.1, duration: 800 }), 100);

    } catch (err) {
      console.error("Load diagram error:", err);
    } finally {
      setLoading(false);
    }
  }, [id, setNodes, setEdges, fitView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const createEdge = (source, target, main = false) => ({
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'step',
    style: { stroke: main ? '#b45309' : '#1f2937', strokeWidth: main ? 3 : 2 },
  });

  const mapDeviceToData = (dev) => ({
    name: dev.name,
    reference: dev.reference,
    type: dev.device_type, // Important pour le symbole
    in_amps: dev.in_amps,
    icu_ka: dev.icu_ka,
    poles: dev.poles,
    isDifferential: dev.is_differential,
    isComplete: dev.is_complete,
    position: dev.position_number,
    downstreamLabel: dev.downstream_switchboard_name || dev.downstream_switchboard_code
  });

  // Handle Save
  const handleNodeSave = async (nodeId, newData) => {
    const dbId = parseInt(nodeId.replace('dev-', ''));
    if (isNaN(dbId)) return;

    try {
      await api.switchboard.updateDevice(dbId, {
        name: newData.name,
        reference: newData.reference,
        device_type: newData.device_type,
        in_amps: newData.in_amps ? Number(newData.in_amps) : null,
        position_number: newData.position_number,
        is_differential: newData.is_differential
      });
      
      setNodes(nds => nds.map(n => {
        if (n.id === nodeId) {
          return {
            ...n,
            data: { 
              ...n.data, 
              ...newData, 
              type: newData.device_type, // Met à jour le symbole
              position: newData.position_number, 
              isDifferential: newData.is_differential 
            }
          };
        }
        return n;
      }));
    } catch (e) {
      alert("Erreur de sauvegarde");
    }
  };

  const handleSaveLayout = async () => {
    setSaving(true);
    const currentNodes = getNodes();
    const updates = currentNodes
      .filter(n => n.type === 'breaker')
      .map(n => {
        const did = parseInt(n.id.replace('dev-', ''));
        if (isNaN(did)) return null;
        return api.switchboard.updateDevice(did, { diagram_data: { position: n.position } });
      })
      .filter(Boolean);
    
    await Promise.all(updates);
    await api.switchboard.updateBoard(id, { diagram_data: { layout: 'custom' } });
    setSaving(false);
    alert("Disposition sauvegardée !");
  };

  // 🖨️ EXPORT PDF (Nouveau !)
  const handleExportPDF = async () => {
    if (reactFlowWrapper.current === null) return;
    
    // 1. Snapshot PNG haute def
    const flowElement = document.querySelector('.react-flow');
    const originalBg = flowElement.style.background;
    flowElement.style.background = '#fff';

    try {
      const dataUrl = await toPng(reactFlowWrapper.current, { 
        backgroundColor: '#fff', 
        pixelRatio: 2,
        filter: (node) => !node.classList?.contains('react-flow__controls')
      });
      
      // 2. Création PDF avec jsPDF
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a3' // Format plan
      });

      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Marges
      const margin = 10;
      const contentWidth = pdfWidth - (margin * 2);
      const contentHeight = pdfHeight - (margin * 2);
      
      // Scale image to fit
      const ratio = Math.min(contentWidth / imgProps.width, contentHeight / imgProps.height);
      const w = imgProps.width * ratio;
      const h = imgProps.height * ratio;
      const x = (pdfWidth - w) / 2;
      const y = (pdfHeight - h) / 2;

      // Dessin
      pdf.addImage(dataUrl, 'PNG', x, y, w, h);
      
      // Cadre
      pdf.rect(margin, margin, contentWidth, contentHeight);

      // Cartouche Vectoriel (Dessiné en PDF)
      const tbHeight = 35;
      const tbWidth = 120;
      const tbX = pdfWidth - margin - tbWidth;
      const tbY = pdfHeight - margin - tbHeight;

      pdf.setFillColor(255, 255, 255);
      pdf.rect(tbX, tbY, tbWidth, tbHeight, 'F'); // Fond blanc
      pdf.rect(tbX, tbY, tbWidth, tbHeight); // Contour

      // Lignes cartouche
      pdf.line(tbX, tbY + 15, tbX + tbWidth, tbY + 15); // Séparateur horizontal
      pdf.line(tbX + 80, tbY, tbX + 80, tbY + 15); // Séparateur vertical haut

      // Textes
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text("PROJET / CLIENT", tbX + 2, tbY + 4);
      pdf.text("TITRE", tbX + 2, tbY + 19);
      
      pdf.setFontSize(12);
      pdf.setTextColor(0);
      pdf.setFont("helvetica", "bold");
      pdf.text(settings?.company_name || "Client", tbX + 2, tbY + 10);
      pdf.text(board?.name || "Schéma Unifilaire", tbX + 2, tbY + 25);
      
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(board?.code || "-", tbX + 2, tbY + 30);

      // Date
      pdf.setFontSize(8);
      pdf.text("DATE: " + new Date().toLocaleDateString(), tbX + 82, tbY + 10);

      pdf.save(`${board?.code}_schema.pdf`);

    } catch (e) {
      console.error("PDF Export failed", e);
      alert("Erreur lors de l'export PDF");
    } finally {
      flowElement.style.background = originalBg;
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Génération du schéma...</div>;

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Top Bar */}
      <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/switchboards?board=${id}`)} className="p-2 hover:bg-gray-100 rounded-full">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <h1 className="font-bold text-gray-800 text-sm md:text-base flex items-center gap-2">
              <Layers size={16} className="text-blue-600" />
              {board?.name} <span className="text-gray-400 font-normal">| Schéma Unifilaire</span>
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

      {/* Main Canvas Area */}
      <div className="flex-1 relative flex" ref={reactFlowWrapper}>
        <div className="flex-1">
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
          >
            <Background color="#cbd5e1" gap={20} size={1} />
            <Controls />
            {/* Légende rapide en bas */}
            <Panel position="bottom-center" className="bg-white/90 backdrop-blur px-4 py-2 rounded-full border shadow-sm text-xs text-gray-600 flex gap-4">
               <span className="flex items-center gap-1"><div className="w-3 h-3 bg-amber-500 rounded-sm"></div> Arrivée</span>
               <span className="flex items-center gap-1"><div className="w-3 h-3 border-2 border-purple-500 rounded-full"></div> Différentiel</span>
               <span className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded-sm"></div> Départ Aval</span>
            </Panel>
          </ReactFlow>
        </div>

        {/* Title Block Visible Overlay (Bottom Right) */}
        <TitleBlock board={board} settings={settings} />

        {/* Sidebar Property Editor */}
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
