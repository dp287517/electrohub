// SwitchboardDiagram.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Text, Cylinder, Html } from '@react-three/drei';
import * as THREE from 'three';
import { 
  ArrowLeft, Save, Printer, Edit2, 
  X, Layers, Zap, AlertCircle, ArrowUpRight, Check, Cuboid
} from 'lucide-react';
import { api } from '../lib/api';

// ==================== CONSTANTS ====================
const DEVICES_PER_FOLIO = 12;
const FOLIO_WIDTH = 2000;
const DEVICE_SPACING = 140;

// ==================== 3D COMPONENTS ====================

// Câble animé (Courant)
const AnimatedCable = ({ start, end, color = "#fbbf24" }) => {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) {
      ref.current.offset.x -= 0.02;
    }
  });

  const points = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(...start),
      new THREE.Vector3(start[0], start[1] - 0.5, start[2]),
      new THREE.Vector3(end[0], end[1] + 0.5, end[2]),
      new THREE.Vector3(...end)
    ]);
    return curve.getPoints(20);
  }, [start, end]);

  return (
    <mesh>
      <tubeGeometry args={[new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p.x, p.y, p.z))), 20, 0.05, 8, false]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
    </mesh>
  );
};

// Disjoncteur 3D
const Breaker3D = ({ position, label, isIncoming, isDiff, amperage }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={position}>
      <Box args={[0.8, 1.2, 0.5]} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
        <meshStandardMaterial color={isIncoming ? "#f59e0b" : hovered ? "#3b82f6" : "#f3f4f6"} />
      </Box>
      <Box position={[0, 0.1, 0.26]} args={[0.2, 0.4, 0.1]}>
        <meshStandardMaterial color="#1f2937" />
      </Box>
      <Html position={[0, -0.8, 0]} center distanceFactor={10} transform>
        <div className="bg-white/90 px-2 py-1 rounded text-[8px] font-bold border border-gray-300 whitespace-nowrap text-center select-none pointer-events-none">
          {label}
          <div className="text-[6px] text-gray-500">{amperage}A {isDiff ? 'DDR' : ''}</div>
        </div>
      </Html>
    </group>
  );
};

// Armoire 3D
const Switchboard3DScene = ({ devices, boardName }) => {
  const feeders = devices.filter(d => !d.is_main_incoming);
  const mainIncoming = devices.find(d => d.is_main_incoming);
  const width = Math.max(4, feeders.length * 1.2);
  
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <OrbitControls minPolarAngle={0} maxPolarAngle={Math.PI / 1.8} />
      <Box position={[0, 0, -0.5]} args={[width + 2, 6, 0.2]}>
        <meshStandardMaterial color="#e5e7eb" />
      </Box>
      <Text position={[0, 3.5, 0]} fontSize={0.3} color="#1f2937">
        {boardName}
      </Text>
      <Box position={[0, 1.5, 0]} args={[width, 0.2, 0.1]}>
        <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.2} />
      </Box>
      {mainIncoming && (
        <>
          <Breaker3D position={[-width/2 + 1, 1.5, 0.5]} label="Arrivée" amperage={mainIncoming.in_amps} isIncoming={true} />
          <AnimatedCable start={[-width/2 + 1, 1.5, 0.5]} end={[0, 1.5, 0]} color="#ef4444" />
        </>
      )}
      {feeders.map((dev, i) => {
        const x = -width/2 + 2.5 + (i * 1.2);
        return (
          <group key={dev.id}>
            <AnimatedCable start={[x, 1.5, 0]} end={[x, 0.1, 0]} color="#fbbf24" />
            <Breaker3D position={[x, -0.5, 0.3]} label={dev.name || dev.reference} amperage={dev.in_amps} isDiff={dev.is_differential} />
            <Cylinder position={[x, -1.5, 0.3]} args={[0.05, 0.05, 1]} rotation={[0,0,0]}>
               <meshStandardMaterial color="#374151" />
            </Cylinder>
          </group>
        );
      })}
      <gridHelper args={[20, 20, 0xff0000, 'teal']} position={[0, -4, 0]} />
    </>
  );
};

// ==================== 2D DIAGRAM LOGIC ====================

const IECSymbols = {
  Breaker: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><line x1="10" y1="5" x2="22" y2="27" /><line x1="22" y1="5" x2="10" y2="27" /><line x1="16" y1="0" x2="16" y2="5" /><line x1="16" y1="27" x2="16" y2="32" /><path d="M 12 5 L 16 0 L 20 5" fill="currentColor" stroke="none" /></g>),
  Switch: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><circle cx="16" cy="27" r="2" /><line x1="16" y1="0" x2="16" y2="10" /><line x1="16" y1="27" x2="16" y2="32" /><line x1="16" y1="10" x2="26" y2="24" /><line x1="12" y1="10" x2="20" y2="10" /></g>),
  Contactor: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><rect x="6" y="6" width="20" height="20" rx="2" /><path d="M 10 26 A 6 6 0 0 1 22 26" /><line x1="16" y1="0" x2="16" y2="6" /><line x1="16" y1="26" x2="16" y2="32" /></g>),
  Fuse: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><rect x="10" y="6" width="12" height="20" /><line x1="16" y1="0" x2="16" y2="6" /><line x1="16" y1="26" x2="16" y2="32" /><line x1="16" y1="6" x2="16" y2="26" /></g>),
  Differential: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><ellipse cx="16" cy="16" rx="12" ry="8" /><line x1="16" y1="0" x2="16" y2="32" /></g>),
  ThermalRelay: () => (<g stroke="currentColor" strokeWidth="2" fill="none"><rect x="6" y="6" width="20" height="20" /><path d="M 8 20 L 12 12 L 16 20 L 20 12 L 24 20" /><line x1="16" y1="0" x2="16" y2="6" /><line x1="16" y1="26" x2="16" y2="32" /></g>)
};

const SourceNode = ({ data }) => (
  <div className="flex flex-col items-center">
    <div className="bg-white border-2 border-gray-900 px-4 py-2 rounded-sm shadow-sm min-w-[140px] text-center relative">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-1"><Zap size={16} className="text-amber-500 fill-amber-500" /></div>
      <div className="font-bold text-sm text-gray-900">{data.label}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{data.subLabel}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-900 !w-3 !h-3 !rounded-none -bottom-1.5" />
    </div>
    <div className="h-8 w-0.5 bg-gray-900"></div>
  </div>
);

const BusbarNode = ({ data }) => (
  <div className="relative">
    <div className="h-6 bg-gradient-to-b from-amber-600 via-amber-400 to-amber-700 shadow-md border-x-2 border-amber-800 flex items-center justify-center relative" style={{ width: data.width || 300, borderRadius: '2px' }}>
      <Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full" />
      <span className="text-[10px] text-amber-900 font-bold tracking-[0.3em] uppercase drop-shadow-sm select-none">Jeu de Barres 400V</span>
    </div>
    {data.isBreak && <div className="absolute right-[-20px] top-1/2 -translate-y-1/2 text-gray-400 text-xs">&gt;&gt;</div>}
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
      <div className="h-6 w-0.5 bg-gray-800 relative"><Handle type="target" position={Position.Top} className="!opacity-0 w-full h-full top-0" /></div>
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
        {!isComplete && <div className="absolute top-0 left-0 p-0.5"><AlertCircle size={10} className="text-orange-500 fill-orange-100" /></div>}
      </div>
      <div className="h-8 w-0.5 bg-gray-800 relative flex flex-col items-center">
         <Handle type="source" position={Position.Bottom} className="!opacity-0 w-full h-full bottom-0" />
         <div className="absolute top-2 left-2 text-[8px] text-gray-400 font-mono whitespace-nowrap bg-white px-0.5 rotate-90 origin-left border border-gray-200">
            {data.in_amps < 20 ? '3G2.5' : data.in_amps < 40 ? '5G6' : '5G16'}
         </div>
      </div>
      {data.downstreamLabel ? (
        <div className="absolute -bottom-10 bg-green-50 text-green-800 text-[9px] border border-green-200 px-2 py-1 rounded-sm whitespace-nowrap shadow-sm font-bold flex items-center gap-1">
          <ArrowUpRight size={10} /> {data.downstreamLabel}
        </div>
      ) : (
        <div className="absolute -bottom-6 text-[9px] text-gray-400 font-mono">X{data.position?.replace(/\./g, '') || '?'}-1</div>
      )}
    </div>
  );
};

const nodeTypes = { source: SourceNode, busbar: BusbarNode, breaker: DeviceNode };

// ==================== PROPERTY SIDEBAR ====================
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

  useEffect(() => {
    const search = async () => {
      if (!downstreamSearch) { setDownstreamResults([]); return; }
      try { const res = await api.switchboard.searchDownstreams(downstreamSearch); setDownstreamResults(res.suggestions || []); } 
      catch (err) { console.error(err); }
    };
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [downstreamSearch]);

  if (!selectedNode || selectedNode.type !== 'breaker') return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-96 bg-white border-l shadow-2xl z-50 flex flex-col animate-slideLeft">
      <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex items-center justify-center relative">
        <h3 className="font-bold flex items-center gap-2"><Edit2 size={16} /> Édition Disjoncteur</h3>
        <button onClick={onClose} className="absolute right-4 p-1 hover:bg-white/20 rounded-full text-white"><X size={18} /></button>
      </div>
      <div className="p-5 space-y-5 flex-1 overflow-y-auto bg-gray-50">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Identification</h4>
          <div className="grid grid-cols-3 gap-3">
             <div className="col-span-1"><label className="block text-xs font-medium text-gray-500 mb-1">Repère</label><input type="text" value={formData.position_number} onChange={e => setFormData({...formData, position_number: e.target.value})} className={`${inputBaseClass} font-mono font-bold text-center`} /></div>
             <div className="col-span-2"><label className="block text-xs font-medium text-gray-500 mb-1">Référence</label><input type="text" value={formData.reference} onChange={e => setFormData({...formData, reference: e.target.value})} className={inputBaseClass} /></div>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Désignation</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputBaseClass} /></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Type</label><select value={formData.device_type} onChange={e => setFormData({...formData, device_type: e.target.value})} className={inputBaseClass}><option value="Low Voltage Circuit Breaker">Disjoncteur</option><option value="Switch Disconnector">Interrupteur</option><option value="Contactor">Contacteur</option><option value="Thermal Relay">Relais Thermique</option><option value="Fuse">Fusible</option></select></div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Données Électriques</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Calibre (A)</label><input type="number" value={formData.in_amps} onChange={e => setFormData({...formData, in_amps: e.target.value})} className={inputBaseClass} /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Pdc (kA)</label><input type="number" value={formData.icu_ka} onChange={e => setFormData({...formData, icu_ka: e.target.value})} className={inputBaseClass} /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Pôles</label><select value={formData.poles} onChange={e => setFormData({...formData, poles: e.target.value})} className={inputBaseClass}><option value="1">1P</option><option value="2">2P</option><option value="3">3P</option><option value="4">4P</option></select></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Tension (V)</label><input type="number" value={formData.voltage_v} onChange={e => setFormData({...formData, voltage_v: e.target.value})} className={inputBaseClass} /></div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100 cursor-pointer" onClick={() => setFormData({...formData, is_differential: !formData.is_differential})}><div className={`w-5 h-5 rounded border flex items-center justify-center ${formData.is_differential ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>{formData.is_differential && <Check size={14} className="text-white" />}</div><span className="text-sm font-medium text-purple-900">Bloc Différentiel (Vigi)</span></div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
           <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><ArrowUpRight size={14}/> Alimentation Aval</h4>
           {formData.downstream_switchboard_id ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 p-3 rounded-lg"><div className="text-sm font-bold text-green-800">{formData.downstream_name}</div><button onClick={() => setFormData({...formData, downstream_switchboard_id: null, downstream_name: ''})} className="text-green-600 hover:text-red-500"><X size={16}/></button></div>
           ) : (
              <div className="relative"><input type="text" value={downstreamSearch} onChange={e => { setDownstreamSearch(e.target.value); setShowDownstreamResults(true); }} placeholder="Rechercher tableau..." className={inputBaseClass} />{showDownstreamResults && downstreamResults.length > 0 && (<div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto">{downstreamResults.map(b => (<div key={b.id} onClick={() => { setFormData({...formData, downstream_switchboard_id: b.id, downstream_name: b.name}); setDownstreamSearch(''); setShowDownstreamResults(false); }} className="p-2 hover:bg-gray-100 cursor-pointer text-sm font-medium text-gray-800">{b.name}</div>))}</div>)}</div>
           )}
        </div>
      </div>
      <div className="p-4 border-t bg-white flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50">Annuler</button>
        <button onClick={() => onSave(selectedNode.id, formData)} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center justify-center gap-2"><Save size={18} /> Enregistrer</button>
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
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [viewMode, setViewMode] = useState('2d');
  const [totalFolios, setTotalFolios] = useState(1);
  const [deviceData, setDeviceData] = useState([]); 
  
  const { fitView, setViewport } = useReactFlow();

  useEffect(() => { api.switchboard.getSettings().then(setSettings).catch(console.error); }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const boardRes = await api.switchboard.getBoard(id);
      setBoard(boardRes);
      const devicesRes = await api.switchboard.listDevices(id);
      const devices = devicesRes.data || [];
      setDeviceData(devices);

      const upstreamSources = boardRes.upstream_sources || [];
      if (upstreamSources.length === 0) upstreamSources.push({ id: 'src-def', source_board_name: boardRes.is_principal ? 'Réseau' : 'Amont', name: 'Arrivée' });
      
      const mainIncoming = devices.find(d => d.is_main_incoming);
      const feeders = devices.filter(d => !d.is_main_incoming);
      const totalPages = Math.max(1, Math.ceil(feeders.length / DEVICES_PER_FOLIO));
      setTotalFolios(totalPages);

      const newNodes = []; const newEdges = [];
      const mkEdge = (s, t, main=false) => ({ id: `e-${s}-${t}`, source: s, target: t, type: 'step', style: { stroke: main ? '#b45309' : '#1f2937', strokeWidth: main ? 3 : 2 } });

      for (let folio = 0; folio < totalPages; folio++) {
        const xOffset = folio * FOLIO_WIDTH;
        if (folio === 0) {
          upstreamSources.forEach((src, idx) => { newNodes.push({ id: `source-${idx}`, type: 'source', position: { x: (idx * 200), y: 0 }, data: { label: src.source_board_name, subLabel: src.name } }); });
        } else {
          newNodes.push({ id: `folio-con-in-${folio}`, type: 'source', position: { x: xOffset, y: 100 }, data: { label: `Venant Folio ${folio}`, subLabel: 'L1/L2/L3/N' } });
        }

        const startIdx = folio * DEVICES_PER_FOLIO;
        const pageFeeders = feeders.slice(startIdx, startIdx + DEVICES_PER_FOLIO);
        const busbarWidth = Math.max(400, pageFeeders.length * DEVICE_SPACING + 100);
        const busbarX = xOffset + (pageFeeders.length * DEVICE_SPACING)/2 - busbarWidth/2 + (DEVICE_SPACING/2);

        newNodes.push({ id: `busbar-${folio}`, type: 'busbar', position: { x: busbarX, y: 180 }, data: { label: `${boardRes.code} (Folio ${folio+1})`, width: busbarWidth, isBreak: folio < totalPages-1 } });

        if (folio === 0 && mainIncoming) {
           const incId = `dev-${mainIncoming.id}`;
           newNodes.push({ id: incId, type: 'breaker', position: { x: 50, y: 80 }, data: { ...mapDeviceToData(mainIncoming), isIncoming: true } });
           upstreamSources.forEach((_, i) => newEdges.push(mkEdge(`source-${i}`, incId, true)));
           newEdges.push(mkEdge(incId, `busbar-0`, true));
        } else if (folio === 0) {
           upstreamSources.forEach((_, i) => newEdges.push(mkEdge(`source-${i}`, `busbar-0`, true)));
        }

        pageFeeders.forEach((dev, i) => {
           const devId = `dev-${dev.id}`;
           const localX = (i * DEVICE_SPACING);
           const finalX = busbarX + 50 + localX - (busbarWidth/2) + 150;
           const savedPos = dev.diagram_data?.position;
           newNodes.push({ id: devId, type: 'breaker', position: savedPos || { x: finalX, y: 300 }, data: mapDeviceToData(dev) });
           newEdges.push(mkEdge(`busbar-${folio}`, devId));
        });
      }

      setNodes(newNodes); setEdges(newEdges);
      setTimeout(() => fitView({ padding: 0.1, duration: 800, nodes: newNodes.slice(0, 5) }), 100);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [id, setNodes, setEdges, fitView]);

  useEffect(() => { loadData(); }, [loadData]);

  const mapDeviceToData = (dev) => ({
    name: dev.name, reference: dev.reference, type: dev.device_type, in_amps: dev.in_amps, icu_ka: dev.icu_ka,
    poles: dev.poles, voltage_v: dev.voltage_v, isDifferential: dev.is_differential, isComplete: dev.is_complete,
    position: dev.position_number, downstreamLabel: dev.downstream_switchboard_name || dev.downstream_switchboard_code,
    downstreamId: dev.downstream_switchboard_id
  });

  // --- CORRECTION NAVIGATION ---
  const handleBack = () => {
    navigate(`/switchboards?board=${id}`);
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
      setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...newData, type: newData.device_type, isDifferential: newData.is_differential, downstreamLabel: newData.downstream_name } } : n));
    } catch(e) { alert("Erreur sauvegarde"); }
  };

  const handleSaveLayout = async () => {
    setSaving(true);
    const updates = nodes.filter(n => n.type === 'breaker').map(n => {
       const did = parseInt(n.id.replace('dev-', ''));
       return !isNaN(did) ? api.switchboard.updateDevice(did, { diagram_data: { position: n.position } }) : null;
    }).filter(Boolean);
    await Promise.all(updates);
    await api.switchboard.updateBoard(id, { diagram_data: { layout: 'custom' } });
    setSaving(false); alert("Disposition sauvegardée !");
  };

  // --- CORRECTION EXPORT PDF HD ---
  const handleExportPDF = async () => {
    if (reactFlowWrapper.current === null) return;
    const flowElement = document.querySelector('.react-flow');
    const originalBg = flowElement.style.background;
    flowElement.style.background = '#fff';
    
    document.querySelectorAll('.react-flow__controls, .react-flow__panel, .title-block-overlay').forEach(el => el.style.display = 'none');

    try {
      // PDF A3 Paysage
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      const contentWidth = pageWidth - 20;
      const contentHeight = pageHeight - 40;

      for (let i = 0; i < totalFolios; i++) {
        if (i > 0) pdf.addPage();
        
        // Calculer la zone à capturer pour ce folio
        const xStart = i * FOLIO_WIDTH;
        const xEnd = (i + 1) * FOLIO_WIDTH;
        
        const folioNodes = nodes.filter(n => n.position.x >= xStart - 100 && n.position.x < xEnd + 100);
        if(folioNodes.length === 0) continue;

        // Bounding Box
        const minX = Math.min(...folioNodes.map(n => n.position.x));
        const maxX = Math.max(...folioNodes.map(n => n.position.x + (n.width || 100)));
        const minY = Math.min(...folioNodes.map(n => n.position.y));
        const maxY = Math.max(...folioNodes.map(n => n.position.y + (n.height || 300)));
        
        const width = maxX - minX + 200;
        const height = maxY - minY + 200;

        // Capture HD
        const dataUrl = await toPng(reactFlowWrapper.current, {
          backgroundColor: '#fff',
          width: width,
          height: height,
          style: {
            width: width + 'px',
            height: height + 'px',
            transform: `translate(${-minX + 100}px, ${-minY + 100}px) scale(1)`
          },
          pixelRatio: 4 // Qualité maximale
        });

        // Ratio Aspect
        const ratio = Math.min(contentWidth / width, contentHeight / height);
        const imgW = width * ratio;
        const imgH = height * ratio;
        
        // Centrer
        const posX = 10 + (contentWidth - imgW) / 2;
        const posY = 10 + (contentHeight - imgH) / 2;

        pdf.addImage(dataUrl, 'PNG', posX, posY, imgW, imgH, undefined, 'FAST');
        
        // Cartouche
        const tbX = pageWidth - 130, tbY = pageHeight - 35;
        pdf.setFillColor(255); pdf.rect(tbX, tbY, 120, 25, 'F'); pdf.setLineWidth(0.3); pdf.rect(tbX, tbY, 120, 25);
        pdf.line(tbX + 80, tbY, tbX + 80, tbY + 25); pdf.line(tbX, tbY + 12, tbX + 120, tbY + 12);
        
        pdf.setFontSize(7); pdf.setTextColor(100); 
        pdf.text("CLIENT / PROJET", tbX + 2, tbY + 4); 
        pdf.text("TITRE", tbX + 2, tbY + 16);
        
        pdf.setFontSize(10); pdf.setTextColor(0); pdf.setFont("helvetica", "bold");
        pdf.text(settings?.company_name || "Client", tbX + 2, tbY + 9); 
        pdf.text(board?.name || "Schéma Unifilaire", tbX + 2, tbY + 21);
        
        pdf.setFontSize(8); 
        pdf.text("FOLIO: " + (i + 1) + "/" + totalFolios, tbX + 82, tbY + 21);
        pdf.text("DATE: " + new Date().toLocaleDateString(), tbX + 82, tbY + 9);
      }
      
      pdf.save(`${board?.code}_schema.pdf`);
    } catch (e) { 
      console.error(e); alert("Erreur Export PDF: " + e.message); 
    } finally {
      flowElement.style.background = originalBg;
      document.querySelectorAll('.react-flow__controls, .react-flow__panel, .title-block-overlay').forEach(el => el.style.display = '');
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Chargement...</div>;

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={20} className="text-gray-600" /></button>
          <div><h1 className="font-bold text-gray-800 text-sm md:text-base flex items-center gap-2"><Layers size={16} className="text-blue-600" />{board?.name} <span className="text-gray-400 font-normal">| {board?.code}</span></h1></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded text-sm font-medium transition-colors">
            {viewMode === '2d' ? <Cuboid size={16} /> : <Layers size={16} />} {viewMode === '2d' ? 'Vue 3D' : 'Schéma 2D'}
          </button>
          {viewMode === '2d' && (
            <>
              <button onClick={handleSaveLayout} disabled={saving} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm shadow-sm transition-colors disabled:opacity-50"><Save size={16} /><span className="hidden md:inline">Sauvegarder</span></button>
              <button onClick={handleExportPDF} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm shadow-sm transition-colors"><Printer size={16} /><span className="hidden md:inline">PDF</span></button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 relative flex overflow-hidden" ref={reactFlowWrapper}>
        {viewMode === '2d' ? (
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => setSelectedNode(node)} nodeTypes={nodeTypes} fitView snapToGrid snapGrid={[20, 20]} minZoom={0.1} maxZoom={4} nodesConnectable={false}>
            <Background color="#cbd5e1" gap={20} size={1} />
            <Controls />
            <Panel position="bottom-center" className="bg-white/90 backdrop-blur px-4 py-2 rounded-full border shadow-sm text-xs text-gray-600 flex gap-4">
               <span className="flex items-center gap-1 font-bold">Folios: {totalFolios}</span>
            </Panel>
          </ReactFlow>
        ) : (
          <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
             <Switchboard3DScene devices={deviceData} boardName={board?.name} />
          </Canvas>
        )}

        {viewMode === '2d' && selectedNode && selectedNode.type === 'breaker' && (
          <PropertySidebar selectedNode={selectedNode} onClose={() => setSelectedNode(null)} onSave={handleNodeSave} />
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
