// src/pages/Meca.jsx
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// On utilise le CSS global mais on surcharge les couleurs inline ou via classes
import "../styles/vsd-map.css";

import { api } from "../lib/api.js";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
pdfjsLib.setVerbosity?.(pdfjsLib.VerbosityLevel.ERRORS);

/* ----------------------------- UI Components (Thème Orange/Amber) ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-orange-600 text-white hover:bg-orange-700 shadow-sm disabled:opacity-50",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50",
    subtle: "bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 disabled:opacity-50",
    warn: "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50",
  };
  return <button className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`} {...p}>{children}</button>;
}

function Input({ value, onChange, className = "", ...p }) {
  return <input className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-orange-100 bg-white text-black ${className}`} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} {...p} />;
}

function Textarea({ value, onChange, className = "", ...p }) {
  return <textarea className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-orange-100 bg-white text-black ${className}`} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} {...p} />;
}

function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-orange-100 bg-white text-black ${className}`} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Badge({ children, className = "" }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 ${className}`}>{children}</span>;
}

function Labeled({ label, children }) {
  return <label className="text-sm space-y-1"><div className="text-gray-600">{label}</div>{children}</label>;
}

function Drawer({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[6000]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[760px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold truncate pr-3 text-orange-800">{title}</h3>
          <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------- Map Viewer ----------------------------- */
const MecaLeafletViewer = forwardRef(({ fileUrl, pageIndex = 0, initialPoints = [], onReady, onMovePoint, onClickPoint, onCreatePoint }, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Marqueur Orange pour la Mécanique
  function makeIcon() {
    const s = 22;
    const html = `<div style="width:${s}px;height:${s}px;background:#ea580c;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`;
    return L.divIcon({ className: "meca-marker", html, iconSize: [s, s], iconAnchor: [s/2, s/2] });
  }

  const drawMarkers = useCallback((list, w, h) => {
    const g = markersLayerRef.current;
    if (!mapRef.current || !g || w===0) return;
    g.clearLayers();
    (list||[]).forEach(p => {
      const x = Number(p.x_frac ?? 0) * w;
      const y = Number(p.y_frac ?? 0) * h;
      const mk = L.marker([y, x], { icon: makeIcon(), draggable: true });
      mk.on("dragend", () => onMovePoint?.(p.equipment_id, { x: mk.getLatLng().lng / w, y: mk.getLatLng().lat / h }));
      mk.on("click", () => onClickPoint?.(p));
      mk.addTo(g);
    });
  }, [onMovePoint, onClickPoint]);

  useImperativeHandle(ref, () => ({
    drawMarkers: (l) => drawMarkers(l, imgSize.w, imgSize.h),
    adjust: () => mapRef.current?.fitBounds(L.latLngBounds([[0,0], [imgSize.h, imgSize.w]]))
  }));

  useEffect(() => {
    if(!fileUrl || !wrapRef.current) return;
    let active = true;
    
    (async () => {
      if(mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      
      const task = pdfjsLib.getDocument(fileUrl);
      const pdf = await task.promise;
      const page = await pdf.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 2 });
      const cvs = document.createElement("canvas");
      cvs.width = vp.width; cvs.height = vp.height;
      await page.render({ canvasContext: cvs.getContext("2d"), viewport: vp }).promise;
      
      if(!active) return;
      setImgSize({ w: vp.width, h: vp.height });

      const m = L.map(wrapRef.current, { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomControl: false });
      const bounds = [[0,0], [vp.height, vp.width]];
      L.imageOverlay(cvs.toDataURL(), bounds).addTo(m);
      m.fitBounds(bounds);
      
      markersLayerRef.current = L.layerGroup().addTo(m);
      mapRef.current = m;
      
      const AddCtrl = L.Control.extend({
        onAdd: () => {
          const btn = L.DomUtil.create("button", "bg-white border p-1 shadow font-bold rounded text-orange-600");
          btn.innerHTML = "+";
          btn.onclick = (e) => { L.DomEvent.stop(e); onCreatePoint?.(); };
          return btn;
        },
        options: { position: 'topright' }
      });
      m.addControl(new AddCtrl());

      drawMarkers(initialPoints, vp.width, vp.height);
      onReady?.();
    })();
    return () => { active = false; };
  }, [fileUrl, pageIndex]);

  return <div ref={wrapRef} className="w-full h-[600px] border rounded-xl bg-gray-50 relative z-0" />;
});

/* ----------------------------- Main Page ----------------------------- */
function getNormalized(eq) {
  return {
    id: eq.id || null,
    name: eq.name || "",
    tag: eq.tag || "",
    manufacturer: eq.manufacturer || "",
    model: eq.model || "",
    serial_number: eq.serial_number || "",
    // CHAMPS MECA SPECIFIQUES
    device_type: eq.device_type || "",
    fluid_type: eq.fluid_type || "",
    year_of_manufacture: eq.year_of_manufacture || "",
    power_kw: eq.power_kw ?? null,
    
    building: eq.building || "",
    floor: eq.floor || "",
    zone: eq.zone || "",
    location: eq.location || "",
    criticality: eq.criticality || "",
    ui_status: eq.ui_status || "",
    comment: eq.comment || "",
    photo_url: eq.photo_url || null
  };
}

export default function Meca() {
  const [tab, setTab] = useState("tree");
  const [items, setItems] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  
  // Maps
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [positions, setPositions] = useState([]);
  const viewerRef = useRef(null);

  // Filtres
  const [filters, setFilters] = useState({ q: "", building: "" });

  async function reload() {
    // Appel explicite à api.meca
    const res = await api.meca.listEquipments(filters);
    setItems(res.equipments || []);
  }

  useEffect(() => { reload(); }, [filters]);

  async function loadFiles(id) {
    if(!id) return;
    const res = await api.meca.listFiles(id);
    setFiles(res.files || []);
  }

  const openEdit = (item) => {
    setEditing(getNormalized(item));
    setDrawerOpen(true);
    if(item?.id) loadFiles(item.id);
    else setFiles([]);
  };

  async function save() {
    if (!editing) return;
    try {
      let res;
      if (editing.id) res = await api.meca.updateEquipment(editing.id, editing);
      else res = await api.meca.createEquipment(editing);
      setEditing(getNormalized(res.equipment));
      reload();
    } catch (e) { console.error(e); alert("Erreur lors de l'enregistrement"); }
  }

  async function del() {
    if(!confirm("Supprimer cet équipement mécanique ?")) return;
    await api.meca.deleteEquipment(editing.id);
    setDrawerOpen(false);
    reload();
  }

  async function analyze(fileList) {
    setAnalyzing(true);
    try {
      const res = await api.meca.extractFromPhotos(Array.from(fileList));
      const ex = res.extracted;
      setEditing(prev => ({
        ...prev,
        manufacturer: ex.manufacturer || prev.manufacturer,
        model: ex.model || prev.model,
        serial_number: ex.serial_number || prev.serial_number,
        // Mapping spécifique MECA
        device_type: ex.device_type || prev.device_type,
        fluid_type: ex.fluid_type || prev.fluid_type,
        year_of_manufacture: ex.year_of_manufacture || prev.year_of_manufacture,
        power_kw: ex.power_kw ?? prev.power_kw
      }));
    } catch (e) { alert("Erreur IA"); }
    setAnalyzing(false);
  }

  async function uploadPhoto(f) {
    await api.meca.uploadPhoto(editing.id, f);
    setEditing(prev => ({...prev, photo_url: api.meca.photoUrl(prev.id, {bust:true})}));
    reload();
  }

  // --- MAPS LOGIC ---
  useEffect(() => { if(tab==="plans") api.mecaMaps.listPlans().then(r => setPlans(r.plans)); }, [tab]);
  
  useEffect(() => {
    if(selectedPlan) {
        api.mecaMaps.positionsAuto(selectedPlan.logical_name).then(r => {
            setPositions(r.positions);
            viewerRef.current?.drawMarkers(r.positions);
        });
    }
  }, [selectedPlan]);

  const onMovePoint = async (eqId, xy) => {
    await api.mecaMaps.setPosition(eqId, {
        logical_name: selectedPlan.logical_name,
        plan_id: selectedPlan.id,
        x_frac: xy.x, y_frac: xy.y
    });
  };

  const createOnMap = async () => {
      const res = await api.meca.createEquipment({ 
          name: "Nouvel Équipement", 
          location: `Plan ${selectedPlan.display_name}`,
          device_type: "Non défini"
      });
      await api.mecaMaps.setPosition(res.equipment.id, {
          logical_name: selectedPlan.logical_name,
          plan_id: selectedPlan.id,
          x_frac: 0.5, y_frac: 0.5
      });
      const r = await api.mecaMaps.positionsAuto(selectedPlan.logical_name);
      setPositions(r.positions);
      viewerRef.current?.drawMarkers(r.positions);
      openEdit(res.equipment);
  };

  const grouped = useMemo(() => {
    const g = {};
    items.forEach(i => {
      const k = i.building || "Autre";
      if(!g[k]) g[k] = [];
      g[k].push(i);
    });
    return g;
  }, [items]);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      <div className="flex justify-between items-end">
        <h1 className="text-3xl font-bold text-orange-900">Maintenance Mécanique</h1>
        <div className="flex gap-2">
          <Btn variant={tab==="tree"?"primary":"ghost"} onClick={()=>setTab("tree")}>Liste</Btn>
          <Btn variant={tab==="plans"?"primary":"ghost"} onClick={()=>setTab("plans")}>Plans</Btn>
        </div>
      </div>

      {/* FILTRES */}
      <div className="bg-white p-3 rounded-xl border flex gap-3">
          <Input placeholder="Rechercher (Nom, Tag, Marque)..." value={filters.q} onChange={v=>setFilters({...filters, q:v})} />
          <Input placeholder="Bâtiment" value={filters.building} onChange={v=>setFilters({...filters, building:v})} />
          <Btn onClick={()=>openEdit({})}>+ Créer</Btn>
      </div>

      {tab === "tree" && (
        <div className="space-y-4">
          {Object.keys(grouped).sort().map(b => (
            <div key={b} className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 font-bold border-b flex justify-between">
                  <span>{b}</span>
                  <Badge>{grouped[b].length}</Badge>
              </div>
              <div className="divide-y">
                {grouped[b].map(item => (
                  <div key={item.id} className="p-3 flex justify-between items-center hover:bg-orange-50/30">
                    <div className="flex gap-3 items-center">
                        <div className="w-12 h-12 bg-gray-200 rounded overflow-hidden flex items-center justify-center text-gray-400 text-xs">
                            {item.photo_url ? <img src={item.photo_url} className="w-full h-full object-cover" alt="" /> : "Photo"}
                        </div>
                        <div>
                            <div className="font-bold text-orange-900">{item.name} <span className="text-gray-400 font-normal text-xs">({item.device_type || "N/A"})</span></div>
                            <div className="text-xs text-gray-500">{item.floor} • {item.zone} • {item.location}</div>
                        </div>
                    </div>
                    <Btn variant="subtle" onClick={()=>openEdit(item)}>Ouvrir</Btn>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "plans" && (
          <div className="space-y-4">
              {!selectedPlan ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center p-6 cursor-pointer hover:bg-gray-50 relative">
                          <span className="text-gray-500">+ Importer ZIP</span>
                          <input type="file" className="absolute inset-0 opacity-0" onChange={e=>e.target.files[0] && api.mecaMaps.uploadZip(e.target.files[0]).then(()=>api.mecaMaps.listPlans().then(r=>setPlans(r.plans)))} />
                      </div>
                      {plans.map(p => (
                          <div key={p.id} onClick={()=>setSelectedPlan(p)} className="bg-white border rounded-xl p-4 cursor-pointer hover:shadow-md">
                              <div className="font-bold">{p.display_name}</div>
                              <div className="text-xs text-gray-400">PDF</div>
                          </div>
                      ))}
                  </div>
              ) : (
                  <div className="bg-white border rounded-xl p-4">
                      <div className="flex justify-between mb-2">
                          <h3 className="font-bold">{selectedPlan.display_name}</h3>
                          <Btn variant="ghost" onClick={()=>setSelectedPlan(null)}>Retour</Btn>
                      </div>
                      <MecaLeafletViewer 
                        ref={viewerRef}
                        fileUrl={api.mecaMaps.planFileUrlAuto(selectedPlan)}
                        initialPoints={positions}
                        onMovePoint={onMovePoint}
                        onClickPoint={(p) => openEdit(items.find(i=>i.id===p.equipment_id) || {id:p.equipment_id})}
                        onCreatePoint={createOnMap}
                      />
                  </div>
              )}
          </div>
      )}

      {drawerOpen && editing && (
        <Drawer title={editing.name || "Nouveau"} onClose={()=>setDrawerOpen(false)}>
            <div className="space-y-5">
                {/* Photo & IA */}
                <div className="flex gap-4">
                    <div className="w-32 h-32 bg-gray-100 rounded-lg border overflow-hidden relative shrink-0 flex items-center justify-center">
                        {editing.photo_url ? <img src={editing.photo_url} className="w-full h-full object-cover" alt="" /> : <span className="text-xs text-gray-400">No Photo</span>}
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e=>e.target.files[0] && uploadPhoto(e.target.files[0])} />
                    </div>
                    <div className="flex-1 bg-orange-50 p-3 rounded-xl border border-orange-100">
                        <div className="text-sm font-bold text-orange-800 mb-2">Assistant IA Méca</div>
                        <label className="block w-full text-center py-2 bg-white border border-orange-200 rounded cursor-pointer hover:bg-orange-100 text-sm">
                            {analyzing ? "Analyse en cours..." : "Analyser une photo"}
                            <input type="file" multiple className="hidden" onChange={e=>e.target.files.length && analyze(e.target.files)} />
                        </label>
                        <div className="text-xs text-orange-600 mt-2">Détecte : Type, Marque, Modèle, Fluide, Puissance...</div>
                    </div>
                </div>

                {/* Champs Mécaniques */}
                <div className="grid sm:grid-cols-2 gap-3">
                    <Labeled label="Nom"><Input value={editing.name} onChange={v=>setEditing({...editing, name:v})} /></Labeled>
                    <Labeled label="Tag / Repère"><Input value={editing.tag} onChange={v=>setEditing({...editing, tag:v})} /></Labeled>
                </div>
                
                <div className="grid sm:grid-cols-2 gap-3">
                    <Labeled label="Type d'Appareil">
                        <Input placeholder="ex: Pompe, Ventilateur, Compresseur" value={editing.device_type} onChange={v=>setEditing({...editing, device_type:v})} />
                    </Labeled>
                    <Labeled label="Type de Fluide">
                        <Input placeholder="ex: Eau, Huile, Air comprimé" value={editing.fluid_type} onChange={v=>setEditing({...editing, fluid_type:v})} />
                    </Labeled>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                    <Labeled label="Marque"><Input value={editing.manufacturer} onChange={v=>setEditing({...editing, manufacturer:v})} /></Labeled>
                    <Labeled label="Modèle"><Input value={editing.model} onChange={v=>setEditing({...editing, model:v})} /></Labeled>
                    <Labeled label="N° Série"><Input value={editing.serial_number} onChange={v=>setEditing({...editing, serial_number:v})} /></Labeled>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                     <Labeled label="Année Fab."><Input value={editing.year_of_manufacture} onChange={v=>setEditing({...editing, year_of_manufacture:v})} /></Labeled>
                     <Labeled label="Puissance (kW)"><Input type="number" step="0.1" value={editing.power_kw} onChange={v=>setEditing({...editing, power_kw:v})} /></Labeled>
                </div>

                <div className="border-t pt-4 grid sm:grid-cols-3 gap-3">
                     <Labeled label="Bâtiment"><Input value={editing.building} onChange={v=>setEditing({...editing, building:v})} /></Labeled>
                     <Labeled label="Étage"><Input value={editing.floor} onChange={v=>setEditing({...editing, floor:v})} /></Labeled>
                     <Labeled label="Zone"><Input value={editing.zone} onChange={v=>setEditing({...editing, zone:v})} /></Labeled>
                     <Labeled label="Localisation"><Input className="sm:col-span-3" value={editing.location} onChange={v=>setEditing({...editing, location:v})} /></Labeled>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <Labeled label="Statut">
                        <Select value={editing.ui_status} onChange={v=>setEditing({...editing, ui_status:v})} options={["en_service","hors_service","spare"]} placeholder="-" />
                    </Labeled>
                    <Labeled label="Criticité">
                        <Select value={editing.criticality} onChange={v=>setEditing({...editing, criticality:v})} options={["critique","important","standard"]} placeholder="-" />
                    </Labeled>
                </div>
                
                <Labeled label="Commentaire">
                    <Textarea rows={3} value={editing.comment} onChange={v=>setEditing({...editing, comment:v})} />
                </Labeled>

                <div className="space-y-2 pt-4 border-t">
                    <div className="font-bold text-sm">Pièces Jointes</div>
                    <div className="flex flex-wrap gap-2">
                        {files.map(f => <a key={f.id} href={f.url} target="_blank" className="text-xs bg-gray-100 px-2 py-1 rounded border hover:bg-gray-200 truncate max-w-[150px]">{f.original_name}</a>)}
                         <label className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded border border-orange-200 cursor-pointer hover:bg-orange-100">
                            + Ajouter
                            <input type="file" multiple className="hidden" onChange={e=>e.target.files.length && api.meca.uploadFiles(editing.id, Array.from(e.target.files)).then(()=>loadFiles(editing.id))} />
                        </label>
                    </div>
                </div>

                <div className="flex justify-between pt-6">
                    <Btn variant="danger" onClick={del}>Supprimer</Btn>
                    <Btn onClick={save}>Enregistrer</Btn>
                </div>
            </div>
        </Drawer>
      )}
    </div>
  );
}
