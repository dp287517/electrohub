// src/pages/Meca.jsx
import { useEffect, useMemo, useRef, useState, forwardRef, useCallback, useImperativeHandle } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/vsd-map.css"; // On garde le CSS map pour la structure

import { api } from "../lib/api.js";

/* ----------------------------- PDF.js Config ----------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ----------------------------- UI Components (Orange Theme) ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-orange-600 text-white hover:bg-orange-700 shadow-sm disabled:opacity-50",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50",
    subtle: "bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 disabled:opacity-50",
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

function Toast({ text, onClose }) {
  useEffect(() => { if(text) setTimeout(onClose, 4000); }, [text]);
  if (!text) return null;
  return <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000] px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>;
}

/* ----------------------------- Map Viewer (Couleur Orange) ----------------------------- */
const MecaLeafletViewer = forwardRef(({ fileUrl, pageIndex = 0, initialPoints = [], onReady, onMovePoint, onClickPoint, onCreatePoint }, ref) => {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  function makeIcon() {
    const s = 22;
    // MARQUEUR ORANGE (#ea580c)
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
          const btn = L.DomUtil.create("button", "bg-white border p-1 shadow font-bold rounded text-orange-600 text-lg w-8 h-8 flex items-center justify-center");
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
// Normalisation des données (champs Meca uniquement)
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
    power_kw: eq.power_kw ?? "",
    
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
  const [loading, setLoading] = useState(false);
  
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ q: "", building: "", floor: "", zone: "" });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState("");
  
  // Maps
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [positions, setPositions] = useState([]);
  const viewerRef = useRef(null);

  // Chargement Liste
  async function reload() {
    setLoading(true);
    try {
      const res = await api.meca.listEquipments(filters);
      setItems(res.equipments || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [filters]);

  // Fichiers
  async function loadFiles(id) {
    if(!id) return;
    const res = await api.meca.listFiles(id);
    setFiles(res.files || []);
  }

  // Ouverture Drawer
  const openEdit = (item) => {
    setEditing(getNormalized(item));
    setDrawerOpen(true);
    if(item?.id) loadFiles(item.id);
    else setFiles([]);
  };

  // Sauvegarde
  async function save() {
    if (!editing) return;
    try {
      let res;
      if (editing.id) res = await api.meca.updateEquipment(editing.id, editing);
      else res = await api.meca.createEquipment(editing);
      setEditing(getNormalized(res.equipment));
      await reload();
      setToast("Enregistré !");
    } catch (e) { console.error(e); alert("Erreur lors de l'enregistrement"); }
  }

  // Suppression
  async function del() {
    if(!confirm("Supprimer cet équipement mécanique ?")) return;
    await api.meca.deleteEquipment(editing.id);
    setDrawerOpen(false);
    await reload();
    setToast("Supprimé");
  }

  // IA
  async function analyze(fileList) {
    setAnalyzing(true);
    try {
      const res = await api.meca.extractFromPhotos(Array.from(fileList));
      const ex = res.extracted || {};
      setEditing(prev => ({
        ...prev,
        manufacturer: ex.manufacturer || prev.manufacturer,
        model: ex.model || prev.model,
        serial_number: ex.serial_number || prev.serial_number,
        device_type: ex.device_type || prev.device_type,
        fluid_type: ex.fluid_type || prev.fluid_type,
        year_of_manufacture: ex.year_of_manufacture || prev.year_of_manufacture,
        power_kw: ex.power_kw ?? prev.power_kw
      }));
      setToast("Données extraites par IA");
    } catch (e) { alert("Erreur IA"); }
    setAnalyzing(false);
  }

  async function uploadPhoto(f) {
    if(!editing.id) return alert("Sauvegardez d'abord");
    await api.meca.uploadPhoto(editing.id, f);
    setEditing(prev => ({...prev, photo_url: api.meca.photoUrl(prev.id, {bust:true})}));
    await reload();
    setToast("Photo mise à jour");
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

  // Groupement pour l'Arbre
  const buildingTree = useMemo(() => {
    const tree = {};
    items.forEach((item) => {
      const b = (item.building || "Sans bâtiment").trim();
      if (!tree[b]) tree[b] = [];
      tree[b].push(item);
    });
    return tree;
  }, [items]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-orange-900">Maintenance Mécanique</h1>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>
            {filtersOpen ? "Masquer filtres" : "Filtres"}
          </Btn>
          <Btn onClick={() => openEdit({})}>+ Créer</Btn>
        </div>
      </header>

      {/* ONGLETS */}
      <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2 flex gap-2">
        <Btn variant={tab === "tree" ? "primary" : "ghost"} onClick={() => setTab("tree")}>🏢 Arborescence</Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>🗺️ Plans</Btn>
      </div>

      {/* FILTRES */}
      {filtersOpen && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <Input value={filters.q} onChange={v=>setFilters({...filters, q:v})} placeholder="Recherche..." />
            <Input value={filters.building} onChange={v=>setFilters({...filters, building:v})} placeholder="Bâtiment" />
            <Input value={filters.floor} onChange={v=>setFilters({...filters, floor:v})} placeholder="Étage" />
            <Input value={filters.zone} onChange={v=>setFilters({...filters, zone:v})} placeholder="Zone" />
          </div>
        </div>
      )}

      {/* VUE ARBORESCENCE */}
      {tab === "tree" && (
        <div className="space-y-4">
          {Object.keys(buildingTree).sort().map((b) => (
            <MecaBuildingSection 
              key={b} 
              buildingName={b} 
              equipments={buildingTree[b]} 
              onOpenEquipment={openEdit} 
            />
          ))}
        </div>
      )}

      {/* VUE PLANS */}
      {tab === "plans" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-3 flex justify-between">
             <div className="font-bold text-orange-900">Plans PDF</div>
             <label className="cursor-pointer text-sm text-orange-600 hover:underline">
                Importer un ZIP
                <input type="file" className="hidden" onChange={e=>e.target.files[0] && api.mecaMaps.uploadZip(e.target.files[0]).then(()=>api.mecaMaps.listPlans().then(r=>setPlans(r.plans)))} />
             </label>
          </div>

          {!selectedPlan ? (
             <PlanCards plans={plans} onPick={(p) => { setSelectedPlan(p); }} />
          ) : (
             <div className="bg-white rounded-2xl border shadow-sm p-3">
                <div className="flex justify-between mb-2">
                   <div className="font-bold">{selectedPlan.display_name}</div>
                   <Btn variant="ghost" onClick={()=>setSelectedPlan(null)}>Fermer le plan</Btn>
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

      {/* DRAWER ÉDITION */}
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
    </section>
  );
}

/* ----------------------------- Sub-Components (Restored from VSD Logic) ----------------------------- */

function MecaBuildingSection({ buildingName, equipments = [], onOpenEquipment }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-orange-900">{buildingName}</span>
          <Badge>{equipments.length}</Badge>
        </div>
        <span className="text-gray-500">{collapsed ? "▼" : "▲"}</span>
      </button>

      {!collapsed && (
        <div className="divide-y">
          {equipments.map((eq) => (
            <div key={eq.id} className="p-4 hover:bg-orange-50/30 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                    {eq.photo_url ? (
                      <img src={eq.photo_url} alt={eq.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-gray-500 p-1 text-center">Photo</span>
                    )}
                  </div>
                  <div>
                    <button className="text-orange-700 font-semibold hover:underline text-left" onClick={() => onOpenEquipment(eq)}>
                      {eq.name || eq.tag || "Équipement"}
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {eq.floor ? `${eq.floor} • ` : ""}
                      {eq.zone ? `${eq.zone} • ` : ""}
                      {eq.location || "—"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {eq.device_type || "Type inconnu"} {eq.manufacturer ? `• ${eq.manufacturer}` : ""} {eq.fluid_type ? `• ${eq.fluid_type}` : ""}
                    </div>
                  </div>
                </div>
                <Btn variant="subtle" onClick={() => onOpenEquipment(eq)}>
                  Ouvrir
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCards({ plans = [], onPick }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {!plans.length && <div className="text-gray-500 col-span-full">Aucun plan importé.</div>}
      {plans.map((p) => (
        <div key={p.id} onClick={() => onPick(p)} className="border rounded-2xl bg-white shadow-sm hover:shadow transition cursor-pointer overflow-hidden group">
          <div className="aspect-video bg-gray-100 flex items-center justify-center group-hover:bg-orange-50 transition">
            <div className="text-center text-gray-400 group-hover:text-orange-400">
              <div className="text-4xl">📄</div>
              <div className="text-xs mt-1">PDF</div>
            </div>
          </div>
          <div className="p-3">
             <div className="font-bold truncate" title={p.display_name}>{p.display_name}</div>
             <div className="text-xs text-gray-400">v{p.version}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
