// src/pages/Comp.jsx
// Gestion des prestataires + Gantt + Calendrier + Graphs + Pièces jointes (multi, drag&drop)
// Dépendances : gantt-task-react, chart.js, react-chartjs-2, dayjs
// (Utilise classes type Tailwind pour le style; adapte si besoin)

import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Gantt, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement,
} from "chart.js";
ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

// ----------------- Helpers UI -----------------
function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded px-2 py-1 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""} onChange={(e)=>onChange(e.target.value)} {...p}
    />
  );
}
function Select({ value, onChange, options=[], placeholder, className="" }) {
  return (
    <select
      className={`border rounded px-2 py-1 text-sm w-full focus:ring focus:ring-blue-100 ${className}`}
      value={value ?? ""} onChange={(e)=>onChange(e.target.value)}
    >
      <option value="">{placeholder || "—"}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Badge({ children, color="gray" }) {
  const map = {
    gray:   "bg-gray-100 text-gray-700",
    blue:   "bg-blue-100 text-blue-700",
    green:  "bg-emerald-100 text-emerald-700",
    yellow: "bg-amber-100 text-amber-700",
    red:    "bg-rose-100 text-rose-700",
    purple: "bg-violet-100 text-violet-700",
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[color] || map.gray}`}>{children}</span>;
}
const statusColor = {
  offre: (s) => s === "po_faite" ? "green" : s?.startsWith("re") ? "blue" : "yellow",
  jsa:   (s) => s === "signe" ? "green" : s === "receptionne" ? "blue" : "yellow",
  access:(s) => s === "fait" ? "green" : "red",
};

// ----------------- API -----------------
const API = {
  list: async (params={}) => {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`/api/comp-ext/vendors${qs ? `?${qs}` : ""}`, { credentials: "include" });
    return r.json();
  },
  create: async (payload) => (await fetch(`/api/comp-ext/vendors`, {
    method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include", body: JSON.stringify(payload)
  })).json(),
  update: async (id, payload) => (await fetch(`/api/comp-ext/vendors/${id}`, {
    method:"PUT", headers:{ "Content-Type":"application/json" }, credentials:"include", body: JSON.stringify(payload)
  })).json(),
  remove: async (id) => (await fetch(`/api/comp-ext/vendors/${id}`, { method:"DELETE", credentials:"include" })).json(),
  calendar: async () => (await fetch(`/api/comp-ext/calendar`, { credentials:"include" })).json(),
  stats: async () => (await fetch(`/api/comp-ext/stats`, { credentials:"include" })).json(),
  // Files
  listFiles: async (id, category) => (await fetch(`/api/comp-ext/vendors/${id}/files${category ? `?category=${encodeURIComponent(category)}` : ""}`, { credentials:"include" })).json(),
  uploadFiles: async (id, files, category="general", onProgress) => {
    // XMLHttpRequest pour suivre la progression (fetch ne permet pas le progress)
    const fd = new FormData();
    (files || []).forEach(f => fd.append("files", f));
    return new Promise((resolve, reject)=>{
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/comp-ext/vendors/${id}/upload?category=${encodeURIComponent(category)}`, true);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e)=>{ if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded/e.total)*100)); };
      xhr.onload = ()=> {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = ()=> reject(new Error("network_error"));
      xhr.send(fd);
    });
  },
  deleteFile: async (fileId) => (await fetch(`/api/comp-ext/files/${fileId}`, { method:"DELETE", credentials:"include" })).json(),
};

// ----------------- Page -----------------
export default function Comp() {
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState({ q: "" });
  const [creating, setCreating] = useState({ name: "" });
  const [calendar, setCalendar] = useState({ tasks: [], events: [] });
  const [viewMode, setViewMode] = useState(ViewMode.Month);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const offerOptions = ["en_attente", "reçue", "po_faite"];
  const jsaOptions   = ["transmis", "receptionne", "signe"];
  const accessOptions= ["a_faire", "fait"];

  async function reload() {
    setLoading(true);
    try {
      const data = await API.list(filter);
      setList(Array.isArray(data.items) ? data.items : []);
      setCalendar(await API.calendar());
      setStats(await API.stats());
    } finally { setLoading(false); }
  }
  useEffect(()=>{ reload(); }, []); // mount

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Prestataires externes</h1>
          <p className="text-gray-500 text-sm">Suivi complet : offres, JSA, PP, accès, visites, WO SAP & pièces jointes</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={filter.q} onChange={(v)=>setFilter(s=>({...s, q:v}))} placeholder="Recherche (nom)…" />
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 transition" onClick={()=>{ setFilter({q:""}); reload(); }}>Réinitialiser</button>
            <button className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition" onClick={reload}>Actualiser</button>
          </div>
        </div>
      </div>

      {/* Création rapide */}
      <div className="bg-white rounded-2xl border shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <Input value={creating.name} onChange={(v)=>setCreating({...creating, name:v})} placeholder="Nom du prestataire" />
          <button className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition w-full sm:w-auto"
            onClick={async ()=>{
              if (!creating.name?.trim()) return;
              await API.create({ name: creating.name.trim() });
              setCreating({ name:"" });
              await reload();
            }}>Ajouter</button>
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
            <tr>
              <th className="p-2 text-left">Nom</th>
              <th className="p-2 text-left">Offre</th>
              <th className="p-2 text-left">JSA</th>
              <th className="p-2 text-left">Plan de prévention</th>
              <th className="p-2 text-left">Demande d’accès</th>
              <th className="p-2 text-left">Plan maintenance SAP (WO)</th>
              <th className="p-2 text-left">Visites</th>
              <th className="p-2 text-left">Owner</th>
              <th className="p-2 text-left">Pièces jointes</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map(v => (
              <Row key={v.id}
                v={v}
                offerOptions={offerOptions}
                jsaOptions={jsaOptions}
                accessOptions={accessOptions}
                onChange={async (nv)=>{ await API.update(v.id, nv); await reload(); }}
                onDelete={async ()=>{ await API.remove(v.id); await reload(); }}
              />
            ))}
            {!loading && (!list || list.length === 0) && <tr><td colSpan={10} className="p-4 text-gray-500">Aucun prestataire.</td></tr>}
            {loading && <tr><td colSpan={10} className="p-4 text-gray-500">Chargement…</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Graphs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Offres"><Doughnut data={buildDonut(stats?.counts?.offer || { en_attente:0, recue:0, po_faite:0 })} /></Card>
        <Card title="JSA"><Doughnut data={buildDonut(stats?.counts?.jsa || { transmis:0, receptionne:0, signe:0 })} /></Card>
        <Card title="Accès"><Bar data={buildBar(stats?.counts?.access || { a_faire:0, fait:0 })} /></Card>
      </div>

      {/* Gantt + Calendrier */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Diagramme de Gantt" actions={
          <select className="border rounded px-2 py-1 text-sm"
            value={Object.keys(ViewMode).find(k=>ViewMode[k]===viewMode) || "Month"}
            onChange={(e)=>setViewMode({Week:ViewMode.Week,Month:ViewMode.Month,Year:ViewMode.Year}[e.target.value] || ViewMode.Month)}>
            <option value="Week">Week</option>
            <option value="Month">Month</option>
            <option value="Year">Year</option>
          </select>
        }>
          <div className="h-[420px] overflow-x-auto">
            {calendar?.tasks?.length ? <Gantt tasks={calendar.tasks} viewMode={viewMode} /> : <div className="text-sm text-gray-500">Aucune visite planifiée.</div>}
          </div>
        </Card>

        <Card title="Calendrier (évènements)">
          <div className="space-y-1 max-h-[420px] overflow-auto text-sm">
            {calendar?.events?.length ? calendar.events.map((e,i)=>(
              <div key={i} className="flex items-center gap-2">
                <Badge color="purple">{dayjs(e.date).format("DD/MM/YYYY")}</Badge> <span>{e.label}</span>
              </div>
            )) : <div className="text-gray-500">Aucun évènement.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, actions, children }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Row({ v, onChange, onDelete, offerOptions, jsaOptions, accessOptions }) {
  const [edit, setEdit] = useState(v);
  const [count, setCount] = useState(v?.visits?.length || 1);
  const [attachOpen, setAttachOpen] = useState(false);

  useEffect(()=>{ setEdit(v); setCount(v?.visits?.length || 1); }, [v?.id]);

  useEffect(()=>{
    const arr = Array.from({ length: count }).map((_, i)=>({
      index: i+1,
      start: edit.visits?.[i]?.start || "",
      end: edit.visits?.[i]?.end || edit.visits?.[i]?.start || "",
    }));
    setEdit(e => ({ ...e, visits: arr }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const saveOnBlur = ()=> onChange(edit);

  return (
    <tr className="border-t border-gray-100 align-top hover:bg-gray-50/50 transition">
      <td className="p-2 min-w-[180px]">
        <Input value={edit.name||""} onChange={(x)=>setEdit({...edit,name:x})} onBlur={saveOnBlur} />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select value={edit.offer_status||"en_attente"} onChange={(x)=>{ setEdit({...edit,offer_status:x}); onChange({...edit,offer_status:x}); }} options={offerOptions} />
          <Badge color={statusColor.offre(edit.offer_status||"en_attente")}>{edit.offer_status||"en_attente"}</Badge>
        </div>
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select value={edit.jsa_status||"transmis"} onChange={(x)=>{ setEdit({...edit,jsa_status:x}); onChange({...edit,jsa_status:x}); }} options={jsaOptions} />
          <Badge color={statusColor.jsa(edit.jsa_status||"transmis")}>{edit.jsa_status||"transmis"}</Badge>
        </div>
      </td>
      <td className="p-2">
        <label className="flex items-center gap-2 mb-1 text-sm">
          <input type="checkbox" checked={!!edit.pp_applicable}
            onChange={(e)=>{ const nv={...edit,pp_applicable:e.target.checked}; setEdit(nv); onChange(nv); }} />
          Applicable
        </label>
        {edit.pp_applicable && (
          <Input value={edit.pp_link||""} onChange={(x)=>setEdit({...edit,pp_link:x})} onBlur={saveOnBlur} placeholder="Lien SafePermit" />
        )}
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <Select value={edit.access_status||"a_faire"} onChange={(x)=>{ setEdit({...edit,access_status:x}); onChange({...edit,access_status:x}); }} options={accessOptions} />
          <Badge color={statusColor.access(edit.access_status||"a_faire")}>{edit.access_status||"a_faire"}</Badge>
        </div>
      </td>
      <td className="p-2">
        <Input value={edit.sap_wo||""} onChange={(x)=>setEdit({...edit,sap_wo:x})} onBlur={saveOnBlur} placeholder="WO à venir" />
      </td>
      <td className="p-2 min-w-[260px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-600">Nb visites</span>
          <input type="number" min={1} className="border rounded px-2 py-1 text-sm w-20"
            value={count} onChange={(e)=>setCount(Math.max(1, Number(e.target.value||1)))} />
        </div>
        <div className="space-y-2">
          {(edit.visits||[]).map((vis,i)=>(
            <div key={i} className="grid grid-cols-2 gap-2">
              <input type="date" className="border rounded px-2 py-1 text-sm" value={vis.start||""}
                onChange={(e)=>{ const v2=[...edit.visits]; v2[i]={...v2[i],start:e.target.value}; setEdit({...edit,visits:v2}); }}
                onBlur={saveOnBlur} />
              <input type="date" className="border rounded px-2 py-1 text-sm" value={vis.end||""}
                onChange={(e)=>{ const v2=[...edit.visits]; v2[i]={...v2[i],end:e.target.value}; setEdit({...edit,visits:v2}); }}
                onBlur={saveOnBlur} />
            </div>
          ))}
        </div>
      </td>
      <td className="p-2">
        <Input value={edit.owner||""} onChange={(x)=>setEdit({...edit,owner:x})} onBlur={saveOnBlur} placeholder="Owner" />
      </td>
      <td className="p-2">
        <button className="px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 transition"
          onClick={()=>setAttachOpen(s=>!s)}>
          📎 PJ {v.files_count ? <Badge color="purple">{v.files_count}</Badge> : null}
        </button>
        {attachOpen && <AttachmentsPanel vendorId={v.id} onChanged={async ()=>{ await API.update(v.id, {}); }} />}
      </td>
      <td className="p-2">
        <div className="flex gap-2">
          <button className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  );
}

// ----------------- Attachments Panel -----------------
function AttachmentsPanel({ vendorId, onChanged }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("general");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const dzRef = useRef(null);
  const [isOver, setIsOver] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await API.listFiles(vendorId, category);
      setFiles(data.files || []);
    } finally { setLoading(false); }
  }
  useEffect(()=>{ load(); }, [vendorId, category]);

  async function handleUpload(fileList) {
    if (!fileList || !fileList.length) return;
    setProgress(0);
    await API.uploadFiles(vendorId, Array.from(fileList), category, setProgress);
    await load();
    if (onChanged) onChanged();
  }

  function onDrop(e) {
    e.preventDefault();
    setIsOver(false);
    const dt = e.dataTransfer;
    if (dt?.files?.length) handleUpload(dt.files);
  }

  return (
    <div className="mt-2 bg-white border rounded-xl p-3 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Catégorie</span>
          <Select value={category} onChange={setCategory} options={["general","offre","jsa","pp","acces","sap","autre"]} className="w-40" />
        </div>
        <div className="text-xs text-gray-500">Glisser-déposer des fichiers ou cliquer</div>
      </div>

      <div
        ref={dzRef}
        onDragOver={(e)=>{ e.preventDefault(); setIsOver(true); }}
        onDragLeave={()=>setIsOver(false)}
        onDrop={onDrop}
        className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition
          ${isOver ? "bg-blue-50 border-blue-300" : "bg-gray-50 border-gray-200"}`}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="text-3xl">📂</div>
          <div className="text-sm text-gray-600">Déposez vos fichiers ici</div>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition">
            <input type="file" multiple className="hidden" onChange={(e)=>handleUpload(e.target.files)} />
            <span>Choisir des fichiers</span>
          </label>
        </div>
        {!!progress && progress<100 && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-gray-500 mt-1">Téléversement… {progress}%</div>
          </div>
        )}
      </div>

      {/* Liste des fichiers */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading && <div className="text-gray-500">Chargement…</div>}
        {!loading && files.length === 0 && <div className="text-gray-500">Aucun fichier.</div>}
        {files.map(f => <FileItem key={f.id} f={f} onDelete={async ()=>{
          await API.deleteFile(f.id);
          await load();
          if (onChanged) onChanged();
        }} />)}
      </div>
    </div>
  );
}

function FileItem({ f, onDelete }) {
  const isImage = (f.mime || "").startsWith("image/");
  return (
    <div className="border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow transition">
      <div className="aspect-video bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage ? <img src={f.url} alt={f.original_name} className="w-full h-full object-cover" /> : <div className="text-4xl">📄</div>}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={f.original_name}>{f.original_name}</div>
        <div className="text-xs text-gray-500 mt-0.5">{(f.size_bytes/1024).toFixed(1)} Ko • {f.mime || "fichier"}</div>
        <div className="flex items-center gap-2 mt-2">
          <a href={f.url} className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition" download>
            Télécharger
          </a>
          <button onClick={onDelete} className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition">
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------- Charts builders -----------------
function buildDonut(obj) {
  const labels = Object.keys(obj);
  const data = labels.map(k => obj[k] || 0);
  return { labels, datasets: [{ data }] };
}
function buildBar(obj) {
  const labels = Object.keys(obj);
  const data = labels.map(k => obj[k] || 0);
  return { labels, datasets: [{ label: "Accès", data }] };
}
