import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, { 
  useNodesState, 
  useEdgesState, 
  addEdge, 
  Controls, 
  Background,
  MarkerType,
  Handle, 
  Position,
  useReactFlow,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import { 
  ArrowLeft, Save, RefreshCw, Download, Zap, ShieldCheck, 
  AlertCircle, Settings, GitBranch // <--- Ajouté ici !
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== CUSTOM NODES ====================

// 1. Source Node (Amont)
const SourceNode = ({ data }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-amber-100 border-2 border-amber-300 text-amber-800 text-center min-w-[150px]">
    <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-amber-500" />
    <div className="flex flex-col items-center">
      <Zap size={20} className="mb-1" />
      <span className="font-bold text-sm">{data.label}</span>
      <span className="text-xs">{data.subLabel}</span>
    </div>
  </div>
);

// 2. Busbar Node (Jeu de barres)
const BusbarNode = ({ data }) => (
  <div className="w-full h-4 bg-gray-700 rounded-sm shadow-sm relative flex items-center justify-center min-w-[300px]">
    <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-900 !rounded-none" />
    <Handle type="source" position={Position.Bottom} className="w-full h-1 !bg-transparent !border-0 rounded-none opacity-0" />
    <span className="text-[10px] text-white font-mono tracking-widest absolute -top-4">JEU DE BARRES 400V</span>
  </div>
);

// 3. Breaker Node (Disjoncteur)
const BreakerNode = ({ data }) => {
  const isIncoming = data.isIncoming;
  const isDiff = data.isDifferential;
  const isComplete = data.isComplete;

  return (
    <div className={`relative group w-32 flex flex-col items-center bg-white rounded-lg shadow-sm border-2 transition-all hover:shadow-md
      ${isIncoming ? 'border-amber-500 bg-amber-50' : isDiff ? 'border-purple-300' : 'border-gray-300'}
    `}>
      {/* Input Handle */}
      <Handle type="target" position={Position.Top} className="!bg-gray-400 w-2 h-2" />

      {/* Electrical Symbol Area */}
      <div className="h-16 w-full flex items-center justify-center border-b border-gray-100 relative">
        <div className="w-0.5 h-full bg-gray-300 absolute top-0"></div>
        {/* Symbol Body */}
        <div className="z-10 bg-white p-1">
           {isDiff ? (
             <div className="w-8 h-12 border-2 border-purple-500 rounded-full flex items-center justify-center bg-white relative">
                <span className="text-purple-600 font-bold text-xs">Δ</span>
                <div className="absolute -right-1 -bottom-1 w-3 h-3 bg-purple-500 rounded-full"></div>
             </div>
           ) : (
             <div className="w-8 h-8 border-2 border-gray-800 rotate-45 bg-white flex items-center justify-center">
                <span className="text-gray-800 font-bold text-xs -rotate-45">X</span>
             </div>
           )}
        </div>
      </div>

      {/* Info Area */}
      <div className="w-full p-2 text-center">
        <div className="font-bold text-sm text-gray-800 truncate" title={data.name}>{data.name || data.reference || '?'}</div>
        <div className="flex justify-center gap-1 mt-1 text-xs font-mono text-gray-500">
          <span>{data.in_amps ? `${data.in_amps}A` : '-'}</span>
          <span className="text-gray-300">|</span>
          <span>{data.poles ? `${data.poles}P` : '-'}</span>
        </div>
        {!isComplete && (
           <div className="mt-1 flex justify-center">
             <AlertCircle size={12} className="text-orange-500" />
           </div>
        )}
      </div>

      {/* Output Handle */}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 w-2 h-2" />
      
      {/* Position Badge */}
      <div className="absolute -top-2 -left-2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded-md font-mono shadow-sm">
        {data.position || '#'}
      </div>
    </div>
  );
};

// 4. Downstream Board Node (Aval)
const DownstreamNode = ({ data }) => (
  <div className="px-3 py-2 shadow-sm rounded-md bg-green-50 border-2 border-green-300 text-green-800 text-center min-w-[120px]">
    <Handle type="target" position={Position.Top} className="w-3 h-3 bg-green-500" />
    <div className="flex flex-col items-center">
      <span className="font-bold text-sm">{data.label}</span>
      <span className="text-[10px] text-green-600">Tableau Aval</span>
    </div>
  </div>
);

const nodeTypes = {
  source: SourceNode,
  busbar: BusbarNode,
  breaker: BreakerNode,
  downstream: DownstreamNode,
};

// ==================== LAYOUT ENGINE (DAGRE) ====================

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 150;
  const nodeHeight = 150;

  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    // If node already has user position (from DB), keep it, otherwise use dagre
    if (node.data.userPosition) {
        return node;
    }
    
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes: layoutedNodes, edges };
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
  const [saving, setSaving] = useState(false);
  const { fitView, getNodes, getViewport } = useReactFlow();

  // Load Data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get Board Info (includes upstream sources)
      const boardRes = await api.switchboard.getBoard(id);
      setBoard(boardRes);

      // 2. Get Devices (includes downstream info)
      const devicesRes = await api.switchboard.listDevices(id);
      const devices = devicesRes.data || [];

      // 3. Build Graph Elements
      const newNodes = [];
      const newEdges = [];
      
      // -- A. Upstream Sources --
      const upstreamSources = boardRes.upstream_sources || [];
      if (upstreamSources.length === 0 && !boardRes.is_principal) {
        // Fake source if none
        upstreamSources.push({ id: 'src-unknown', source_board_name: 'Source Inconnue', name: '?' });
      } else if (boardRes.is_principal) {
        upstreamSources.push({ id: 'src-grid', source_board_name: 'Réseau / TGBT', name: 'Arrivée Générale' });
      }

      upstreamSources.forEach((src, idx) => {
        newNodes.push({
          id: `source-${idx}`,
          type: 'source',
          position: { x: 0 + (idx * 200), y: 0 },
          data: { label: src.source_board_name, subLabel: src.name }
        });
      });

      // -- B. Main Incoming Breaker (if any) --
      const mainIncoming = devices.find(d => d.is_main_incoming);
      let busbarInputId = null;

      if (mainIncoming) {
        // Source -> Main Incoming
        const incomerId = `dev-${mainIncoming.id}`;
        newNodes.push({
          id: incomerId,
          type: 'breaker',
          position: { x: 0, y: 150 },
          data: { 
            name: mainIncoming.name, 
            reference: mainIncoming.reference,
            in_amps: mainIncoming.in_amps,
            poles: mainIncoming.poles,
            isIncoming: true,
            isDifferential: mainIncoming.is_differential,
            isComplete: mainIncoming.is_complete,
            position: mainIncoming.position_number,
            userPosition: mainIncoming.diagram_data?.position // Load saved position
          }
        });
        
        // Connect all sources to Main Incoming
        upstreamSources.forEach((_, idx) => {
          newEdges.push({ 
            id: `e-src${idx}-incomer`, 
            source: `source-${idx}`, 
            target: incomerId, 
            type: 'smoothstep', 
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 }
          });
        });
        
        busbarInputId = incomerId;
      } else {
        // No main incoming, connect sources directly to busbar (virtually)
        busbarInputId = upstreamSources.length > 0 ? `source-0` : null; // Simplified logic
      }

      // -- C. Busbar --
      const busbarId = 'busbar';
      newNodes.push({
        id: busbarId,
        type: 'busbar',
        position: { x: 0, y: 300 }, // Initial pos, will be adjusted by layout
        data: { label: 'Busbar' },
        style: { width: Math.max(300, devices.length * 100) } // Dynamic width
      });

      if (busbarInputId) {
        newEdges.push({ 
          id: `e-${busbarInputId}-busbar`, 
          source: busbarInputId, 
          target: busbarId, 
          type: 'smoothstep',
          style: { stroke: '#374151', strokeWidth: 3 }
        });
      }

      // -- D. Outgoing Feeders (Devices) --
      const feeders = devices.filter(d => !d.is_main_incoming);
      
      feeders.forEach((dev, idx) => {
        const nodeId = `dev-${dev.id}`;
        // Check for saved position
        const savedPos = dev.diagram_data?.position;

        newNodes.push({
          id: nodeId,
          type: 'breaker',
          position: savedPos || { x: (idx * 160) - ((feeders.length * 160)/2), y: 450 }, // Grid fallback
          data: { 
            name: dev.name, 
            reference: dev.reference,
            in_amps: dev.in_amps,
            poles: dev.poles,
            isIncoming: false,
            isDifferential: dev.is_differential,
            isComplete: dev.is_complete,
            position: dev.position_number,
            userPosition: savedPos // Mark as user positioned
          }
        });

        // Connect Busbar -> Device
        newEdges.push({ 
          id: `e-busbar-${nodeId}`, 
          source: busbarId, 
          target: nodeId, 
          type: 'smoothstep', // Orthogonal lines
          style: { stroke: '#9ca3af', strokeWidth: 1.5 }
        });

        // -- E. Downstream Targets --
        if (dev.downstream_switchboard_id) {
          const downId = `down-${dev.downstream_switchboard_id}-${dev.id}`;
          newNodes.push({
            id: downId,
            type: 'downstream',
            position: { x: (idx * 160), y: 650 },
            data: { label: dev.downstream_switchboard_name || dev.downstream_switchboard_code || 'Tableau' }
          });

          newEdges.push({
            id: `e-${nodeId}-${downId}`,
            source: nodeId,
            target: downId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#10b981' }
          });
        }
      });

      // Apply saved positions where available, else basic grid
      setNodes(newNodes);
      setEdges(newEdges);

      // If no saved positions at all, trigger auto layout once
      const hasSavedPositions = devices.some(d => d.diagram_data?.position);
      if (!hasSavedPositions && boardRes?.diagram_data?.layout !== 'custom') {
        setTimeout(() => handleAutoLayout(newNodes, newEdges), 50);
      }

    } catch (err) {
      console.error("Error loading diagram:", err);
    } finally {
      setLoading(false);
    }
  }, [id, setNodes, setEdges]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto Layout
  const handleAutoLayout = useCallback((currentNodes, currentEdges) => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      currentNodes || nodes,
      currentEdges || edges
    );
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [nodes, edges, setNodes, setEdges, fitView]);

  // Save Positions
  const handleSave = async () => {
    setSaving(true);
    try {
      const currentNodes = getNodes();
      
      // Update Board Layout Metadata
      await api.switchboard.updateBoard(id, {
        name: board.name, 
        code: board.code, 
        diagram_data: { layout: 'custom' }
      });

      // Update Each Device Position
      const updates = currentNodes
        .filter(n => n.type === 'breaker')
        .map(n => {
          const deviceId = parseInt(n.id.replace('dev-', ''));
          if (isNaN(deviceId)) return null;
          return api.switchboard.updateDevice(deviceId, {
            diagram_data: { position: n.position }
          });
        })
        .filter(Boolean);

      await Promise.all(updates);
      alert('Disposition sauvegardée !');
    } catch (err) {
      console.error('Save failed:', err);
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // Export Image
  const handleExport = () => {
    if (reactFlowWrapper.current === null) return;

    toPng(reactFlowWrapper.current, { backgroundColor: '#f9fafb' })
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.setAttribute('download', `${board.code || 'schema'}_unifilaire.png`);
        a.setAttribute('href', dataUrl);
        a.click();
      });
  };

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-500">Chargement du schéma...</div>;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header Toolbar */}
      <div className="h-16 bg-white border-b shadow-sm flex items-center justify-between px-6 z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/switchboards?board=${id}`)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2">
              <GitBranch size={20} className="text-violet-600" />
              Schéma Unifilaire
            </h1>
            <p className="text-xs text-gray-500">{board?.name} ({board?.code})</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => handleAutoLayout()} 
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            title="Réorganiser automatiquement"
          >
            <RefreshCw size={16} /> Auto
          </button>
          <button 
            onClick={handleExport} 
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            title="Télécharger image"
          >
            <Download size={16} /> PNG
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="flex items-center gap-2 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium shadow-sm transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Sauvegarder
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 w-full h-full" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
          snapToGrid={true}
          snapGrid={[15, 15]}
        >
          <Controls />
          <Background color="#e5e7eb" gap={20} size={1} />
        </ReactFlow>
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
