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

// --------- helper for multi-line captions on nodes ----------
function caption(n) {
  const d = n?.data || {};
  const L1 = d.label || n.id;
  const L2 = d.code ? `(${d.code})` : '';
  const L3a = d.building_code || d.building || '';
  const L3b = d.room ? `Rm ${d.room}` : (d.floor ? `Fl ${d.floor}` : '');
  const L3 = L3a || L3b ? [L3a, L3b].filter(Boolean).join(' · ') : '';
  const L4 = d.regime ? `Regime: ${d.regime}` : '';
  return [ `${L1} ${L2}`.trim(), L3, L4 ].filter(Boolean).join('\n');
}

function buildModelFromGraph(graph, useSmart = false, onNodeSelect) {
  const model = new DiagramModel();
  const idToNode = new Map();

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  for (const n of nodes) {
    const color = COLORS[n.type] || 'rgb(51,65,85)';
    const node = new DefaultNodeModel({ name: caption(n), color });
    const inPort = node.addInPort('in');
    const outPort = node.addOutPort('out');
    node.setPosition(n?.position?.x || 0, n?.position?.y || 0);

    node.getOptions().extras = { ...n.data, __id: n.id, __type: n.type };
    node.registerListener({
      selectionChanged: (e) => { if (e.isSelected) onNodeSelect?.({ id: n.id, type: n.type, data: n.data }); }
    });

    idToNode.set(n.id, { node, inPort, outPort });
    model.addNode(node);
  }

  const safeSmart = useSmart && nodes.length >= 2;
  for (const e of edges) {
    const src = idToNode.get(e.source);
    const dst = idToNode.get(e.target);
    if (!src || !dst) continue;
    let link;
    try { link = safeSmart ? new PathFindingLinkModel() : new RightAngleLinkModel(); }
    catch { link = new RightAngleLinkModel(); }
    link.setSourcePort(src.outPort);
    link.setTargetPort(dst.inPort);
    model.addLink(link);
  }
  return model;
}

export default function Diagram() {
  const [site, setSite] = useState('Nyon');
  const [mode, setMode] = useState('all');
  const [building, setBuilding] = useState(''); // empty => show all
  const [depth, setDepth] = useState(3);
  const [rootSwitch, setRootSwitch] = useState('');
  const [rootHv, setRootHv] = useState('');
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [smart, setSmart] = useState(false);

  const [activeNode, setActiveNode] = useState(null);
  const [tab, setTab] = useState('details');
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
        ...(building ? { building: building.trim() } : {}),
        ...(rootSwitch ? { root_switchboard: rootSwitch.trim() } : {}),
        ...(rootHv ? { root_hv: rootHv.trim() } : {}),
        include_metrics: true,
      };
      const data = await api.diagram.view(params);
      if (data?.warning) setBanner(data.warning); else setBanner('');
      if (!data?.nodes?.length) {
        engine.setModel(new DiagramModel());
        setBanner('No nodes found for current site/filters');
        return;
      }
      const model = buildModelFromGraph(data, smart, setActiveNode);
      engine.setModel(model);
      setTimeout(() => { try { engine.getModel().setZoomLevel(80); engine.repaintCanvas(); } catch {} }, 10);
    } catch (e) {
      console.error(e);
      setBanner('Failed to load diagram: ' + (e?.message || 'unknown error'));
      engine.setModel(new DiagramModel());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGraph(); }, []);         // initial show-all
  useEffect(() => { fetchGraph(); }, [site, mode]);

  const onClear = () => { setBuilding(''); setRootSwitch(''); setRootHv(''); setTimeout(fetchGraph, 0); };

  // --- Analyses (using your api.js methods) ---
  const runSelectivityForNode = async (node) => {
    const devId = Number(node?.data?.id || String(node?.id||'').split(':')[1]);
    const sbId = Number(node?.data?.switchboard_id);
    if (!devId || !sbId) return { error: 'Missing device/switchboard id' };
    const pairs = await api.selectivity.listPairs({ switchboard: sbId, pageSize: 100 });
    const hit = (pairs?.data || []).find(p => p.downstream_id === devId) || (pairs?.data || []).find(p => p.upstream_id === devId);
    if (!hit) return { error: 'No selectivity pair found for this device' };
    return api.selectivity.checkPair(hit.upstream_id, hit.downstream_id);
  };

  const runArcForNode = (node) => api.arcflash.checkPoint(node?.data?.id, node?.data?.switchboard_id);
  const runFlaForNode = (node) => api.faultlevel.checkPoint(node?.data?.id, node?.data?.switchboard_id);

  const runAnalysis = async (kind, node) => {
    if (!node?.id) return;
    setAnalysis({ loading: true, data: null, error: '' });
    try {
      let res;
      if (kind === 'selectivity') res = await runSelectivityForNode(node);
      else if (kind === 'arc') res = await runArcForNode(node);
      else if (kind === 'fla') res = await runFlaForNode(node);
      setAnalysis({ loading: false, data: res, error: '' });
    } catch (e) {
      setAnalysis({ loading: false, data: null, error: e?.message || 'analysis failed' });
    }
  };

  useEffect(() => {
    if (!activeNode) return;
    if (tab === 'details') return setAnalysis({ loading: false, data: null, error: '' });
    runAnalysis(tab, activeNode);
  }, [activeNode, tab]); // eslint-disable-line

  return (
    <div className="p-4 grid grid-cols-12 gap-4">
      <style>{`
        .srd-default-node__name, .rdl-default-node__name { 
          white-space: pre-wrap; line-height: 1.1; font-size: 12px;
        }
      `}</style>

      {/* filters */}
      <div className="col-span-12 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Site</label>
          <input className="border rounded-md px-2 py-1 w-40" value={site} onChange={(e) => setSite(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Mode</label>
          <select className="border rounded-md px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">LV + HV</option>
            <option value="lv">LV only</option>
            <option value="hv">HV only</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Building</label>
          <input className="border rounded-md px-2 py-1" placeholder="(empty = all)" value={building} onChange={(e) => setBuilding(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium mb-1">Depth</label>
          <input type="number" min={1} max={8} className="border rounded-md px-2 py-1 w-24" value={depth} onChange={(e) => setDepth(parseInt(e.target.value || 3, 10))} />
        </div>
        <div className="flex items-center gap-2">
          <input id="smart" type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
          <label htmlFor="smart" className="text-sm">Smart routing</label>
        </div>
        <button className="px-3 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50" disabled={loading} onClick={fetchGraph}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {hasFilters && (<button className="px-3 py-2 rounded-md bg-slate-200" onClick={onClear}>Clear filters</button>)}
      </div>

      {/* banner */}
      <div className="col-span-12 text-xs text-amber-700" style={{ minHeight: '1.25rem' }}>
        {banner && (<span className="inline-block bg-amber-50 border border-amber-300 rounded px-2 py-1">{banner}</span>)}
      </div>

      {/* diagram + side panel */}
      <div className="col-span-9 border rounded-xl overflow-hidden" style={{ height: '75vh' }}>
        <CanvasWidget engine={engine} className="w-full h-full bg-white" />
      </div>
      <div className="col-span-3 border rounded-xl p-3 space-y-3" style={{ height: '75vh', overflow: 'auto' }}>
        <h3 className="font-semibold">Details</h3>
        {!activeNode && <div className="text-sm text-slate-500">Click a node to see details.</div>}
        {activeNode && (
          <>
            <div className="text-sm space-y-1">
              <div><b>ID:</b> {activeNode.id}</div>
              <div><b>Type:</b> {activeNode.type}</div>
              {activeNode?.data?.label && <div><b>Label:</b> {activeNode.data.label}</div>}
              {activeNode?.data?.code && <div><b>Code:</b> {activeNode.data.code}</div>}
              {activeNode?.data?.building && <div><b>Building:</b> {activeNode.data.building}</div>}
              {activeNode?.data?.room && <div><b>Room:</b> {activeNode.data.room}</div>}
              {activeNode?.data?.floor && <div><b>Floor:</b> {activeNode.data.floor}</div>}
              {activeNode?.data?.regime && <div><b>Regime:</b> {activeNode.data.regime}</div>}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mt-3 text-sm">
              {['details','selectivity','arc','fla'].map(k => (
                <button key={k} className={`px-2 py-1 rounded border ${tab===k? 'bg-slate-900 text-white':'bg-white'}`} onClick={() => setTab(k)}>
                  {k === 'details' && 'Details'}
                  {k === 'selectivity' && 'Selectivity'}
                  {k === 'arc' && 'Arc Flash'}
                  {k === 'fla' && 'Fault Level'}
                </button>
              ))}
            </div>

            <div className="mt-2 text-sm">
              {tab === 'details' && (<pre className="text-xs bg-slate-50 p-2 rounded border overflow-auto">{JSON.stringify(activeNode.data, null, 2)}</pre>)}
              {tab !== 'details' && (
                <div>
                  {analysis.loading && <div>Running analysis…</div>}
                  {analysis.error && <div className="text-red-600">{analysis.error}</div>}
                  {!analysis.loading && !analysis.error && analysis.data && (<pre className="text-xs bg-slate-50 p-2 rounded border overflow-auto">{JSON.stringify(analysis.data, null, 2)}</pre>)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
