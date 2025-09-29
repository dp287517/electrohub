import { useEffect, useRef, useState, useMemo } from 'react';
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

function buildModelFromGraph(graph, useSmart = false, onNodeClick) {
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
    node.getOptions().extras = { ...n.data, nodeType: n.type, nodeId: n.id };
    // Hook click → panneau détails
    node.registerListener({
      selectionChanged: (e) => {
        if (e.isSelected) {
          onNodeClick?.({ id: n.id, type: n.type, data: n.data });
        }
      },
    });
    idToNode.set(n.id, { node, inPort, outPort });
    model.addNode(node);
  }

  const safeSmart = useSmart && nodes.length >= 2; // évite PathFinding si graphe trop petit

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
  // Filtres & options
  const [site, setSite] = useState('Nyon');
  const [mode, setMode] = useState('all');
  const [building, setBuilding] = useState(''); // ← vide = "voir tout" par défaut
  const [depth, setDepth] = useState(3);
  const [rootSwitch, setRootSwitch] = useState('');
  const [rootHv, setRootHv] = useState('');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [smart, setSmart] = useState(false); // OFF par défaut

  // Détails / panneau latéral
  const [activeNode, setActiveNode] = useState(null);
  const [tab, setTab] = useState('details'); // details | selectivity | arc | fla
  const [analysis, setAnalysis] = useState({ loading: false, data: null, error: '' });

  const engineRef = useRef(null);
  if (!engineRef.current) {
    const engine = createEngine();
    engine.getLinkFactories().registerFactory(new RightAngleLinkFactory());
    engine.getLinkFactories().registerFactory(new PathFindingLinkFactory());
    engine.setModel(new DiagramModel());
    engineRef.current = engine;
  }
  const engine = engineRef.current;

  const hasFilters = useMemo(() => !!(building || rootSwitch || rootHv), [building, rootSwitch, rootHv]);

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const params = {
        site: site?.trim() || undefined,
        mode,
        depth,
        // IMPORTANT : si aucun filtre → on n’envoie PAS building/root → on affiche tout
        building: building?.trim() || undefined,
        root_switchboard: rootSwitch?.trim() || undefined,
        root_hv: rootHv?.trim() || undefined,
        include_metrics: true,
      };

      const data = await api.diagram.view(params);
      const nodesCount = Array.isArray(data?.nodes) ? data.nodes.length : 0;

      if (data?.warning) setBanner(data.warning); else setBanner('');

      if (!nodesCount) {
        engine.setModel(new DiagramModel());
        setBanner((prev) => prev || 'No nodes found for current site/filters');
        return;
      }

      const model = buildModelFromGraph(data, smart, setActiveNode);
      engine.setModel(model);

      // Zoom doux
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
    // Au premier chargement → affiche TOUT le site (building vide)
    fetchGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)charger quand on change un filtre important
  useEffect(() => {
    fetchGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, mode]);

  const onClear = () => {
    setBuilding('');
    setRootSwitch('');
    setRootHv('');
    setTimeout(fetchGraph, 0);
  };

  // --- Chargement des analyses (sélectivité / arc flash / FLA) ---
  const runAnalysis = async (kind, node) => {
    if (!node?.id) return;
    setAnalysis({ loading: true, data: null, error: '' });
    try {
      let res;
      if (kind === 'selectivity') res = await api.selectivity.node(node.id);
      else if (kind === 'arc') res = await api.arcflash.node(node.id);
      else if (kind === 'fla') res = await api.fla.node(node.id);
      setAnalysis({ loading: false, data: res, error: '' });
    } catch (e) {
      setAnalysis({ loading: false, data: null, error: e?.message || 'analysis failed' });
    }
  };

  useEffect(() => {
    // recharge l’onglet d’analyse lorsqu’on change de node ou d’onglet
    if (!activeNode) return;
    if (tab === 'details') return setAnalysis({ loading: false, data: null, error: '' });
    runAnalysis(tab, activeNode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNode, tab]);

  return (
    <div className="p-4 grid grid-cols-12 gap-4">
      {/* Barre de filtres */}
      <div className="col-span-12 flex flex-wrap items-end gap-3">
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
          <label className="text-xs font-medium mb-1">Building</label>
          <input
            className="border rounded-md px-2 py-1"
            placeholder="(vide = tout)"
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
          <input id="smart" type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
          <label htmlFor="smart" className="text-sm">Smart routing</label>
        </div>
        <button className="px-3 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50" disabled={loading} onClick={fetchGraph}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {hasFilters && (
          <button className="px-3 py-2 rounded-md bg-slate-200" onClick={onClear}>Clear filters</button>
        )}
      </div>

      {/* Messages */}
      <div className="col-span-12 text-xs text-amber-700" style={{ minHeight: '1.25rem' }}>
        {banner && (
          <span className="inline-block bg-amber-50 border border-amber-300 rounded px-2 py-1">{banner}</span>
        )}
      </div>

      {/* Canvas + Panneau latéral */}
      <div className="col-span-9 border rounded-xl overflow-hidden" style={{ height: '75vh' }}>
        <CanvasWidget engine={engine} className="w-full h-full bg-white" />
      </div>
      <div className="col-span-3 border rounded-xl p-3 space-y-3" style={{ height: '75vh', overflow: 'auto' }}>
        <h3 className="font-semibold">Détails</h3>
        {!activeNode && <div className="text-sm text-slate-500">Clique un nœud pour voir les détails.</div>}
        {activeNode && (
          <>
            <div className="text-sm">
              <div><span className="font-medium">ID:</span> {activeNode.id}</div>
              <div><span className="font-medium">Type:</span> {activeNode.type}</div>
              {activeNode?.data?.label && <div><span className="font-medium">Label:</span> {activeNode.data.label}</div>}
              {activeNode?.data?.code && <div><span className="font-medium">Code:</span> {activeNode.data.code}</div>}
              {activeNode?.data?.building_code && <div><span className="font-medium">Building:</span> {activeNode.data.building_code}</div>}
              {activeNode?.data?.status && (
                <div className="mt-1">
                  <span className="font-medium">Status:</span>{' '}
                  <span className="px-2 py-0.5 rounded text-xs border">
                    {activeNode.data.status}
                  </span>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mt-3 text-sm">
              {['details','selectivity','arc','fla'].map(k => (
                <button
                  key={k}
                  className={`px-2 py-1 rounded border ${tab===k? 'bg-slate-900 text-white':'bg-white'}`}
                  onClick={() => setTab(k)}
                >
                  {k === 'details' && 'Détails'}
                  {k === 'selectivity' && 'Sélectivité'}
                  {k === 'arc' && 'Arc Flash'}
                  {k === 'fla' && 'Fault Level'}
                </button>
              ))}
            </div>

            <div className="mt-2 text-sm">
              {tab === 'details' && (
                <pre className="text-xs bg-slate-50 p-2 rounded border overflow-auto">{JSON.stringify(activeNode.data, null, 2)}</pre>
              )}
              {tab !== 'details' && (
                <div>
                  {analysis.loading && <div>Analyse en cours…</div>}
                  {analysis.error && <div className="text-red-600">{analysis.error}</div>}
                  {!analysis.loading && !analysis.error && analysis.data && (
                    <pre className="text-xs bg-slate-50 p-2 rounded border overflow-auto">{JSON.stringify(analysis.data, null, 2)}</pre>
                  )}
                  {!analysis.loading && !analysis.error && !analysis.data && (
                    <div className="text-slate-500">Sélectionne un onglet pour lancer l’analyse.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
