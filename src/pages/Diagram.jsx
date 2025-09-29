// src/pages/Diagram.jsx
import { useEffect, useRef, useState } from 'react';
import createEngine, { DefaultNodeModel, DiagramModel } from '@projectstorm/react-diagrams';
import { CanvasWidget } from '@projectstorm/react-canvas-core';
import { RightAngleLinkFactory, PathFindingLinkFactory, PathFindingLinkModel } from '@projectstorm/react-diagrams-routing';
import '@projectstorm/react-canvas-core/dist/style.min.css';
import '@projectstorm/react-diagrams/dist/style.min.css';
import { api } from '../lib/api.js';

const COLORS = {
  switchboard: 'rgb(59,130,246)',
  device: 'rgb(15,118,110)',
  hv_equipment: 'rgb(168,85,247)',
  hv_device: 'rgb(124,45,18)',
};

function buildModelFromGraph(graph) {
  const model = new DiagramModel();
  const idToNode = new Map();

  for (const n of (graph.nodes || [])) {
    const color = COLORS[n.type] || 'rgb(51,65,85)';
    const node = new DefaultNodeModel({ name: n?.data?.label || n.id, color });
    const inPort = node.addInPort('in');
    const outPort = node.addOutPort('out');
    const px = n?.position?.x ?? 0;
    const py = n?.position?.y ?? 0;
    node.setPosition(px, py);
    node.getOptions().extras = { ...n.data, nodeType: n.type };
    idToNode.set(n.id, { node, inPort, outPort });
    model.addNode(node);
  }

  for (const e of (graph.edges || [])) {
    const src = idToNode.get(e.source);
    const dst = idToNode.get(e.target);
    if (!src || !dst) continue;
    const link = new PathFindingLinkModel(); // smart orthogonal path
    link.setSourcePort(src.outPort);
    link.setTargetPort(dst.inPort);
    model.addLink(link);
  }
  return model;
}

export default function Diagram() {
  const [mode, setMode] = useState('all');
  const [building, setBuilding] = useState('');
  const [depth, setDepth] = useState(3);
  const [rootSwitch, setRootSwitch] = useState('');
  const [rootHv, setRootHv] = useState('');
  const [loading, setLoading] = useState(false);

  const engineRef = useRef(null);
  const readyRef = useRef(false);

  if (!engineRef.current) {
    const engine = createEngine();
    engine.getLinkFactories().registerFactory(new RightAngleLinkFactory());
    engine.getLinkFactories().registerFactory(new PathFindingLinkFactory());
    // IMPORTANT: set an initial empty model so CanvasWidget never receives a null model
    const initial = new DiagramModel();
    engine.setModel(initial);
    engineRef.current = engine;
    readyRef.current = true;
  }
  const engine = engineRef.current;

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
      const model = buildModelFromGraph(data);
      engine.setModel(model);
      // Zoom-to-fit after layout
      setTimeout(() => {
        try {
          const canvas = document.querySelector('.storm-diagrams-canvas, .react-canvas-core__canvas');
          if (canvas) {
            // crude fit: center + zoom level
            engine.getModel().setZoomLevel(80);
          }
          engine.repaintCanvas();
        } catch {}
      }, 10);
    } catch (e) {
      console.error(e);
      alert('Failed to load diagram: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGraph(); /* eslint-disable-next-line */ }, []);

  // Guard: never render without an engine + model
  const hasModel = !!engine && !!engine.getModel();
  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Mode</label>
          <select className="border rounded-md px-2 py-1" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="all">LV + HV</option>
            <option value="lv">LV only</option>
            <option value="hv">HV only</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Building (filter)</label>
          <input className="border rounded-md px-2 py-1" placeholder="e.g. B1" value={building} onChange={e => setBuilding(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Depth</label>
          <input type="number" min={1} max={8} className="border rounded-md px-2 py-1 w-24" value={depth} onChange={e => setDepth(parseInt(e.target.value || 3))} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root Switchboard ID</label>
          <input className="border rounded-md px-2 py-1 w-36" placeholder="numeric id" value={rootSwitch} onChange={e => setRootSwitch(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root HV Equipment ID</label>
          <input className="border rounded-md px-2 py-1 w-36" placeholder="numeric id" value={rootHv} onChange={e => setRootHv(e.target.value)} />
        </div>
        <button className="px-3 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50" disabled={loading} onClick={fetchGraph}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ width: '100%', height: '72vh' }} className="border rounded-xl overflow-hidden">
        {hasModel ? <CanvasWidget engine={engine} className="w-full h-full bg-white" /> : <div className="p-6 text-sm">Initializing…</div>}
      </div>
    </div>
  );
}
