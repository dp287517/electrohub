// src/pages/Diagram.jsx
import { useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../lib/api.js';
import { CheckCircle, AlertTriangle, HelpCircle, Zap } from 'lucide-react';

const statusIcon = (status) => {
  if (status === 'safe') return <CheckCircle className="w-3 h-3 inline-block" />;
  if (status === 'at-risk') return <AlertTriangle className="w-3 h-3 inline-block" />;
  if (status === 'incomplete') return <HelpCircle className="w-3 h-3 inline-block" />;
  return <HelpCircle className="w-3 h-3 inline-block" />;
};

function DeviceNode({ data }) {
  const af = data?.metrics?.arc;
  const fl = data?.metrics?.fault;
  const afStatus = af?.status || 'unknown';
  const flStatus = fl?.status || 'unknown';

  const bg =
    data.isMain ? 'bg-emerald-50 border-emerald-400' :
    afStatus === 'at-risk' || flStatus === 'at-risk' ? 'bg-red-50 border-red-400' :
    afStatus === 'incomplete' || flStatus === 'incomplete' ? 'bg-yellow-50 border-yellow-400' :
    'bg-white border-slate-300';

  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm ${bg}`}>
      <div className="text-sm font-medium">{data.label}</div>
      <div className="text-[11px] opacity-80">{data.device_type}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        <span title="Arc flash">{statusIcon(afStatus)}</span>
        <span title="Fault level">{statusIcon(flStatus)}</span>
        {af?.ppe_category != null && <span className="inline-flex items-center gap-1"><Zap className="w-3 h-3" /> PPE {af.ppe_category}</span>}
      </div>
    </div>
  );
}

function SwitchboardNode({ data }) {
  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm bg-sky-50 border-sky-400`}>
      <div className="text-sm font-semibold">{data.label}</div>
      <div className="text-[11px] opacity-80">{[data.building, data.floor, data.room].filter(Boolean).join(' · ')}</div>
      {data.isPrincipal && <div className="text-[11px] mt-1">Principal</div>}
    </div>
  );
}

function HvEquipmentNode({ data }) {
  return (
    <div className="rounded-xl border px-3 py-2 shadow-sm bg-purple-50 border-purple-400">
      <div className="text-sm font-semibold">{data.label}</div>
      <div className="text-[11px] opacity-80">{data.building || ''}</div>
    </div>
  );
}

const nodeTypes = {
  device: DeviceNode,
  switchboard: SwitchboardNode,
  hv_equipment: HvEquipmentNode,
  hv_device: DeviceNode,
};

export default function Diagram() {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('all'); // lv | hv | all
  const [building, setBuilding] = useState('');
  const [depth, setDepth] = useState(3);
  const [rootSwitch, setRootSwitch] = useState('');
  const [rootHv, setRootHv] = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const params = {
        mode,
        depth,
        building: building || undefined,
        root_switchboard: rootSwitch || undefined,
        root_hv: rootHv || undefined,
        include_metrics: true,
      };
      const data = await api.diagram.view(params);
      setNodes(data.nodes);
      setEdges(data.edges.map(e => ({ ...e, markerEnd: 'arrowclosed' })));
    } catch (e) {
      console.error(e);
      alert('Erreur de chargement du diagramme');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Mode</label>
          <select className="border rounded-md px-2 py-1" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="all">BT + HT</option>
            <option value="lv">BT uniquement</option>
            <option value="hv">HT uniquement</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Bâtiment (filtre)</label>
          <input className="border rounded-md px-2 py-1" placeholder="ex: B1" value={building} onChange={e => setBuilding(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Profondeur</label>
          <input type="number" min={1} max={8} className="border rounded-md px-2 py-1 w-24" value={depth} onChange={e => setDepth(parseInt(e.target.value || 3))} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root Switchboard ID</label>
          <input className="border rounded-md px-2 py-1 w-36" placeholder="id numérique" value={rootSwitch} onChange={e => setRootSwitch(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root HV Equipment ID</label>
          <input className="border rounded-md px-2 py-1 w-36" placeholder="id numérique" value={rootHv} onChange={e => setRootHv(e.target.value)} />
        </div>
        <button
          className="px-3 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50"
          disabled={loading}
          onClick={fetchGraph}
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
        <div className="ml-auto text-sm opacity-70">
          Légende: <CheckCircle className="w-3 h-3 inline-block" /> Conforme · <AlertTriangle className="w-3 h-3 inline-block" /> Non conforme · <HelpCircle className="w-3 h-3 inline-block" /> Incomplet
        </div>
      </div>

      <div style={{ width: '100%', height: '72vh' }} className="border rounded-xl overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <MiniMap />
          <Controls />
          <Background gap={24} />
        </ReactFlow>
      </div>
    </div>
  );
}
