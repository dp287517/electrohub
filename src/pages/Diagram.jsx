import { useEffect, useRef, useState } from 'react';
import createEngine, { DefaultNodeModel, DiagramModel } from '@projectstorm/react-diagrams';
import { CanvasWidget } from '@projectstorm/react-canvas-core';
import {
  RightAngleLinkFactory,
  RightAngleLinkModel,
  PathFindingLinkFactory,
  PathFindingLinkModel,
} from '@projectstorm/react-diagrams-routing';
import { api } from '../lib/api.js';

const COLORS = {
  switchboard: 'rgb(59,130,246)',
  device: 'rgb(15,118,110)',
  hv_equipment: 'rgb(168,85,247)',
  hv_device: 'rgb(124,45,18)',
};

function buildModelFromGraph(graph, useSmart = false) {
  const model = new DiagramModel();
  const idToNode = new Map();

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  for (const n of nodes) {
    const color = COLORS[n.type] || 'rgb(51,65,85)';
    const node = new DefaultNodeModel({ name: n?.data?.label || n.id, color });
    const inPort = node.addInPort('in');
    const outPort = node.addOutPort('out');
    const px = Number.isFinite(n?.position?.x) ? n.position.x : 0;
    const py = Number.isFinite(n?.position?.y) ? n.position.y : 0;
    node.setPosition(px, py);
    node.getOptions().extras = { ...n.data, nodeType: n.type };
    idToNode.set(n.id, { node, inPort, outPort });
    model.addNode(node);
  }

  const safeSmart = useSmart && nodes.length >= 2; // avoid PathFinding when graph is tiny/empty

  for (const e of edges) {
    const src = idToNode.get(e.source);
    const dst = idToNode.get(e.target);
    if (!src || !dst) continue;
    let link;
    try {
      link = safeSmart ? new PathFindingLinkModel() : new RightAngleLinkModel();
    } catch {
      link = new RightAngleLinkModel();
    }
    link.setSourcePort(src.outPort);
    link.setTargetPort(dst.inPort);
    model.addLink(link);
  }

  return model;
}

export default function Diagram() {
  const [site, setSite] = useState('Nyon'); // pass explicit site
  const [mode, setMode] = useState('all');
  const [building, setBuilding] = useState('');
  const [depth, setDepth] = useState(3);
  const [rootSwitch, setRootSwitch] = useState('');
  const [rootHv, setRootHv] = useState('');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [smart, setSmart] = useState(false); // OFF by default to avoid crash on empty

  const engineRef = useRef(null);
  if (!engineRef.current) {
    const engine = createEngine();
    engine.getLinkFactories().registerFactory(new RightAngleLinkFactory());
    engine.getLinkFactories().registerFactory(new PathFindingLinkFactory());
    engine.setModel(new DiagramModel()); // never null
    engineRef.current = engine;
  }
  const engine = engineRef.current;

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const params = {
        site: site?.trim() || undefined,
        mode,
        depth,
        building: building?.trim() || undefined,
        root_switchboard: rootSwitch?.trim() || undefined,
        root_hv: rootHv?.trim() || undefined,
        include_metrics: true,
      };

      const data = await api.diagram.view(params);
      const nodesCount = Array.isArray(data?.nodes) ? data.nodes.length : 0;

      if (data?.warning) setBanner(data.warning);

      if (!nodesCount) {
        engine.setModel(new DiagramModel());
        setBanner((prev) => prev || 'No nodes found for current site/filters');
        return;
      }

      const model = buildModelFromGraph(data, smart);
      engine.setModel(model);
      setBanner('');

      setTimeout(() => {
        try {
          engine.getModel().setZoomLevel(80);
          engine.repaintCanvas();
        } catch {}
      }, 10);
    } catch (e) {
      console.error(e);
      setBanner('Failed to load diagram: ' + (e?.message || 'unknown error'));
      engine.setModel(new DiagramModel());
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
          <label className="text-xs font-medium mb-1">Site</label>
          <input
            className="border rounded-md px-2 py-1 w-40"
            placeholder="ex: Nyon"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Mode</label>
          <select
            className="border rounded-md px-2 py-1"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="all">LV + HV</option>
            <option value="lv">LV only</option>
            <option value="hv">HV only</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Building (filter)</label>
          <input
            className="border rounded-md px-2 py-1"
            placeholder="e.g. 20"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Depth</label>
          <input
            type="number"
            min={1}
            max={8}
            className="border rounded-md px-2 py-1 w-24"
            value={depth}
            onChange={(e) => setDepth(parseInt(e.target.value || 3, 10))}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root Switchboard ID</label>
          <input
            className="border rounded-md px-2 py-1 w-36"
            placeholder="numeric id"
            value={rootSwitch}
            onChange={(e) => setRootSwitch(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Root HV Equipment ID</label>
          <input
            className="border rounded-md px-2 py-1 w-36"
            placeholder="numeric id"
            value={rootHv}
            onChange={(e) => setRootHv(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="smart"
            type="checkbox"
            checked={smart}
            onChange={(e) => setSmart(e.target.checked)}
          />
          <label htmlFor="smart" className="text-sm">
            Smart routing
          </label>
        </div>
        <button
          className="px-3 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50"
          disabled={loading}
          onClick={fetchGraph}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-2 text-xs text-amber-700" style={{ minHeight: '1.25rem' }}>
        {banner && (
          <span className="inline-block bg-amber-50 border border-amber-300 rounded px-2 py-1">
            {banner}
          </span>
        )}
      </div>

      <div style={{ width: '100%', height: '72vh' }} className="border rounded-xl overflow-hidden">
        <CanvasWidget engine={engine} className="w-full h-full bg-white" />
      </div>
    </div>
  );
}
