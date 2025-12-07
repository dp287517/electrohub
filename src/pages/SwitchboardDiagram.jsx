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
import { 
  ArrowLeft, Save, RefreshCw, Download, Zap, Settings, 
  Maximize, X, Check, Edit2, ZoomIn, Printer
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== SYMBOLS (IEC STANDARD) ====================

const IECSymbols = {
  Breaker: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="10" y1="5" x2="22" y2="27" />
      <line x1="22" y1="5" x2="10" y2="27" />
      <line x1="16" y1="0" x2="16" y2="5" />
      <line x1="16" y1="27" x2="16" y2="32" />
    </g>
  ),
  Switch: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <circle cx="16" cy="27" r="2" />
      <line x1="16" y1="0" x2="16" y2="10" />
      <line x1="16" y1="27" x2="16" y2="32" />
      <line x1="16" y1="10" x2="26" y2="24" />
    </g>
  ),
  Differential: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <ellipse cx="16" cy="16" rx="12" ry="8" />
      <line x1="16" y1="0" x2="16" y2="32" />
    </g>
  ),
  Earth: () => (
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <line x1="8" y1="0" x2="24" y2="0" />
      <line x1="11" y1="4" x2="21" y2="4" />
      <line x1="14" y1="8" x2="18" y2="8" />
      <line x1="16" y1="-8" x2="16" y2="0" />
    </g>
  )
};

// ==================== CUSTOM NODES ====================

// 1. Source Node (Arrivée Réseau/TGBT)
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
    {/* Line to busbar visual */}
    <div className="h-8 w-0.5 bg-gray-900"></div>
  </div>
);

// 2. Busbar Node (Barre de cuivre réaliste)
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
    {/* Mounting holes visual */}
    <div className="absolute left-2 w-2 h-2 rounded-full bg-amber-900/30"></div>
    <div className="absolute right-2 w-2 h-2 rounded-full bg-amber-900/30"></div>
  </div>
);

// 3. Breaker Node (Symbole normalisé)
const BreakerNode = ({ data }) => {
  const isDiff = data.isDifferential;
  const isIncoming = data.isIncoming;
  
  // Determine color based on function
  const strokeColor = isIncoming ? "text-amber-600" : isDiff ? "text-purple-600" : "text-gray-800";
  const boxBorder = isIncoming ? "border-amber-500 shadow-amber-100" : "border-gray-300";

  return (
    <div className="flex flex-col items-center group relative">
      {/* Top Wire */}
      <div className="h-6 w-0.5 bg-gray-800 relative">
        <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full top-0" />
      </div>

      {/* Device Box */}
      <div className={`bg-white border-2 ${boxBorder} shadow-sm p-1 rounded-sm w-24 transition-all group-hover:shadow-md group-hover:border-blue-400`}>
        {/* Header Info */}
        <div className="bg-gray-50 border-b border-gray-100 p-1 text-center mb-1">
           <div className="text-[9px] font-bold text-gray-700 truncate" title={data.name}>
             {data.position ? <span className="mr-1 bg-gray-200 px-1 rounded text-gray-800">{data.position}</span> : null}
             {data.reference || '?'}
           </div>
        </div>

        {/* Symbol Area */}
        <div className={`h-12 w-full flex items-center justify-center ${strokeColor}`}>
           <svg width="32" height="32" viewBox="0 0 32 32" overflow="visible">
              {isDiff && <IECSymbols.Differential />}
              <IECSymbols.Breaker />
           </svg>
        </div>

        {/* Footer Specs */}
        <div className="text-[9px] text-center font-mono leading-tight text-gray-500 mt-1">
          <div>{data.in_amps}A {data.curve ? `Type ${data.curve}` : ''}</div>
          <div>{data.icu_ka ? `${data.icu_ka}kA` : ''} {data.poles}P</div>
        </div>
      </div>

      {/* Bottom Wire & Handle */}
      <div className="h-6 w-0.5 bg-gray-800 relative">
         <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full bottom-0" />
      </div>

      {/* Downstream Label if exists */}
      {data.downstreamLabel && (
        <div className="absolute -bottom-8 bg-green-50 text-green-800 text-[9px] border border-green-200 px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm">
          Vers: {data.downstreamLabel}
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  source: SourceNode,
  busbar: BusbarNode,
  breaker: BreakerNode,
};

// ==================== SIDEBAR PROPERTY EDITOR ====================

const PropertySidebar = ({ selectedNode, onClose, onSave }) => {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        name: selectedNode.data.name || '',
        reference: selectedNode.data.reference || '',
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
          <label className="block text-xs font-medium text-gray-500 uppercase">Référence</label>
          <input 
            type="text" 
            value={formData.reference} 
            onChange={e => setFormData({...formData, reference: e.target.value})}
            className="w-full mt-1 p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase">Désignation</label>
          <textarea 
            rows={3}
            value={formData.name} 
            onChange={e => setFormData({...formData, name: e.target.value})}
            className="w-full mt-1 p-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
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
          <span className="text-sm text-gray-700">Protection Différentielle</span>
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

// ==================== MAIN COMPONENT ====================

const DiagramContent = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [settings, setSettings] = useState(null);
  
  const { fitView, getNodes } = useReactFlow();

  // Load Settings (Logo, Company)
  useEffect(() => {
    api.switchboard.getSettings().then(setSettings).catch(console.error);
  }, []);

  // Load Diagram Data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const boardRes = await api.switchboard.getBoard(id);
      setBoard(boardRes);
      const devicesRes = await api.switchboard.listDevices(id);
      const devices = devicesRes.data || [];

      // --- Construction du Graphe ---
      const newNodes = [];
      const newEdges = [];
      
      // 1. Sources (Amont)
      const upstreamSources = boardRes.upstream_sources || [];
      // Fallback si pas de source
      if (upstreamSources.length === 0) {
        upstreamSources.push({ 
          id: 'src-default', 
          source_board_name: boardRes.is_principal ? 'Réseau Distributeur' : 'Amont Inconnu', 
          name: 'Arrivée' 
        });
      }

      // Positionnement sources
      upstreamSources.forEach((src, idx) => {
        newNodes.push({
          id: `source-${idx}`,
          type: 'source',
          position: { x: (idx * 200), y: 0 },
          data: { label: src.source_board_name, subLabel: src.name }
        });
      });

      // 2. Busbar (Calcul largeur)
      const feeders = devices.filter(d => !d.is_main_incoming);
      const busbarWidth = Math.max(400, feeders.length * 140 + 100);
      const busbarX = (upstreamSources.length * 200) / 2 - (busbarWidth / 2); // Center relative to sources roughly
      
      const busbarNode = {
        id: 'busbar',
        type: 'busbar',
        position: { x: 0, y: 180 }, // Fixed Y for busbar
        data: { label: boardRes.code, width: busbarWidth },
        draggable: false // Busbar is the backbone
      };
      
      // 3. Arrivée Principale (Main Incoming)
      const mainIncoming = devices.find(d => d.is_main_incoming);
      if (mainIncoming) {
        const incomerId = `dev-${mainIncoming.id}`;
        // Place incoming breaker between source and busbar
        newNodes.push({
          id: incomerId,
          type: 'breaker',
          position: { x: 50, y: 80 }, // Manually tweak later with layout
          data: { 
            ...mapDeviceToData(mainIncoming),
            isIncoming: true
          }
        });
        
        // Links
        upstreamSources.forEach((_, idx) => {
          newEdges.push(createEdge(`source-${idx}`, incomerId, true));
        });
        newEdges.push(createEdge(incomerId, 'busbar'));
      } else {
        // Direct link sources to busbar
        upstreamSources.forEach((_, idx) => {
          newEdges.push(createEdge(`source-${idx}`, 'busbar'));
        });
      }

      // 4. Départs (Feeders)
      feeders.forEach((dev, idx) => {
        const nodeId = `dev-${dev.id}`;
        // Calculate X position specifically for schema look
        // Center the group of feeders under the busbar
        const startX = -(feeders.length * 140) / 2 + 70; 
        const xPos = startX + (idx * 140);

        // Saved position override?
        const savedPos = dev.diagram_data?.position;
        
        newNodes.push({
          id: nodeId,
          type: 'breaker',
          position: savedPos || { x: xPos, y: 300 }, 
          data: mapDeviceToData(dev)
        });

        // Edge Busbar -> Breaker
        newEdges.push({
          id: `e-bus-${nodeId}`,
          source: 'busbar',
          target: nodeId,
          type: 'step', // IMPORTANT: Orthogonal lines
          style: { stroke: '#1f2937', strokeWidth: 2 },
        });
      });

      // Add Busbar last to control Z-index if needed (though ReactFlow handles it)
      newNodes.push(busbarNode);

      // Si pas de positions sauvegardées, on applique un layout auto simple
      if (!devices.some(d => d.diagram_data?.position) && boardRes.diagram_data?.layout !== 'custom') {
         // On laisse le calcul manuel ci-dessus faire le job "initial" qui est déjà pas mal
         // On ajuste juste la barre
         busbarNode.position.x = -(busbarWidth / 2);
      }

      setNodes(newNodes);
      setEdges(newEdges);
      
      // Delay fit view to allow render
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

  // Helper: Create standardized edge
  const createEdge = (source, target, main = false) => ({
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'step', // Orthogonal
    style: { stroke: main ? '#b45309' : '#1f2937', strokeWidth: main ? 3 : 2 },
  });

  // Helper: Map DB device to Node Data
  const mapDeviceToData = (dev) => ({
    name: dev.name,
    reference: dev.reference,
    in_amps: dev.in_amps,
    icu_ka: dev.icu_ka,
    poles: dev.poles,
    curve: dev.settings?.curve_type,
    isDifferential: dev.is_differential,
    isComplete: dev.is_complete,
    position: dev.position_number,
    downstreamLabel: dev.downstream_switchboard_name || dev.downstream_switchboard_code
  });

  // Save Node Changes
  const handleNodeSave = async (nodeId, newData) => {
    const dbId = parseInt(nodeId.replace('dev-', ''));
    if (isNaN(dbId)) return;

    try {
      await api.switchboard.updateDevice(dbId, {
        name: newData.name,
        reference: newData.reference,
        in_amps: newData.in_amps ? Number(newData.in_amps) : null,
        position_number: newData.position_number,
        is_differential: newData.is_differential
      });
      
      // Update local state to reflect changes instantly
      setNodes(nds => nds.map(n => {
        if (n.id === nodeId) {
          return {
            ...n,
            data: { ...n.data, ...newData, position: newData.position_number, isDifferential: newData.is_differential }
          };
        }
        return n;
      }));
      
      // Close sidebar
      // setSelectedNode(null); // Optional: keep open if user wants to verify
    } catch (e) {
      alert("Erreur de sauvegarde");
    }
  };

  // Save Layout Positions
  const handleSaveLayout = async () => {
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
    // Mark board as having custom layout
    await api.switchboard.updateBoard(id, { diagram_data: { layout: 'custom' } });
    alert("Disposition sauvegardée !");
  };

  // Export to Image with Title Block (Cartouche)
  const handleExport = async () => {
    if (reactFlowWrapper.current === null) return;
    
    // 1. Force white background for snapshot
    const flowElement = document.querySelector('.react-flow');
    const originalBg = flowElement.style.background;
    flowElement.style.background = '#fff';

    try {
      const dataUrl = await toPng(reactFlowWrapper.current, { 
        backgroundColor: '#fff', 
        pixelRatio: 2, // High res
        filter: (node) => !node.classList?.contains('react-flow__controls') // Hide controls
      });
      
      // 2. Create a temporary canvas to add Title Block (Cartouche)
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const footerHeight = 120;
        
        canvas.width = img.width;
        canvas.height = img.height + footerHeight;
        
        // Draw Diagram
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        // Draw Cartouche Border
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
        
        // Draw Title Block Area
        const tbY = canvas.height - footerHeight - 20;
        ctx.beginPath();
        ctx.moveTo(20, tbY);
        ctx.lineTo(canvas.width - 20, tbY);
        ctx.stroke();
        
        // Title Block Content
        ctx.fillStyle = "#000000";
        ctx.font = "bold 24px Arial";
        ctx.fillText(board?.name || "Schéma Unifilaire", 40, tbY + 40);
        
        ctx.font = "16px Arial";
        ctx.fillText(`Code: ${board?.code || '-'}`, 40, tbY + 70);
        ctx.fillText(`Localisation: ${board?.meta?.building_code || ''} / ${board?.meta?.floor || ''}`, 40, tbY + 90);
        
        // Company Info (Right side)
        if (settings?.company_name) {
          ctx.textAlign = "right";
          ctx.font = "bold 18px Arial";
          ctx.fillText(settings.company_name, canvas.width - 40, tbY + 40);
          ctx.font = "14px Arial";
          if(settings.company_email) ctx.fillText(settings.company_email, canvas.width - 40, tbY + 65);
          ctx.fillText(new Date().toLocaleDateString(), canvas.width - 40, tbY + 90);
        }

        // Add Logo if available (requires CORS handling usually, skipping for simplicity or needs Base64)
        // ...

        // Download
        const link = document.createElement('a');
        link.download = `${board?.code}_schema.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      };
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
              <RefreshCw size={16} className="text-blue-600" />
              {board?.name}
            </h1>
            <span className="text-xs text-gray-500 font-mono">{board?.code} • {board?.regime_neutral}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSaveLayout} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow-sm transition-colors">
            <Save size={16} /> <span className="hidden md:inline">Sauvegarder Vue</span>
          </button>
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm shadow-sm transition-colors">
            <Printer size={16} /> <span className="hidden md:inline">Exporter Plan</span>
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
            <Panel position="bottom-center" className="bg-white/80 backdrop-blur px-3 py-1 rounded-full border shadow-sm text-xs text-gray-500">
              {nodes.filter(n => n.type === 'breaker').length} départs • Régime {board?.regime_neutral || 'TN'}
            </Panel>
          </ReactFlow>
        </div>

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
