// src/pages/Vsd.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import "../styles/vsd-map.css";
import { api, API_BASE } from "../lib/api.js";

/* ----------------------------- UI utils ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle: "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed",
    warn: "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed",
  };
  return (
    <button
      className={`px-3 py-2 rounded-lg text-sm transition ${map[variant] || map.primary} ${className}`}
      {...p}
    >
      {children}
    </button>
  );
}

function Input({ value, onChange, className = "", ...p }) {
  return (
    <input
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black placeholder-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

function Textarea({ value, onChange, className = "", ...p }) {
  return (
    <textarea
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      {...p}
    />
  );
}

function Select({ value, onChange, options = [], className = "", placeholder }) {
  return (
    <select
      className={`border rounded-lg px-3 py-2 text-sm w-full focus:ring focus:ring-blue-100 bg-white text-black ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>{o}</option>
        ) : (
          <option key={o.value} value={o.value}>{o.label}</option>
        )
      )}
    </select>
  );
}

function Badge({ color = "gray", children, className = "" }) {
  const map = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-emerald-100 text-emerald-700",
    orange: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color] || map.gray} ${className}`}>
      {children}
    </span>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="text-sm space-y-1">
      <div className="text-gray-600">{label}</div>
      {children}
    </label>
  );
}

/* Drawer */
function Drawer({ title, children, onClose, dirty = false }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") confirmClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function confirmClose() {
    if (dirty) {
      const ok = window.confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?");
      if (!ok) return;
    }
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[6000]">
      <div className="absolute inset-0 bg-black/30" onClick={confirmClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[760px] bg-white shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold truncate pr-3">{title}</h3>
          <Btn variant="ghost" onClick={confirmClose}>Fermer</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ text, onClose }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000]">
      <div className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg">{text}</div>
    </div>
  );
}

/* ----------------------------- Page principale VSD ----------------------------- */
export default function Vsd() {
  // Onglets
  const [tab, setTab] = useState("tree");

  // Liste équipements
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filtres
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");

  // Édition
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const initialRef = useRef(null);

  // PJ list
  const [files, setFiles] = useState([]);

  // Toast
  const [toast, setToast] = useState("");

  // Plans
  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

  // Indicateur global
  const [globalLoading, setGlobalLoading] = useState(false);

  /* ----------------------------- Helpers ----------------------------- */
  const debouncer = useRef(null);
  function triggerReloadDebounced() {
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(reload, 300);
  }

  function normalizeListResponse(res) {
    if (Array.isArray(res?.items)) return res.items;
    if (Array.isArray(res?.equipments)) return res.equipments;
    if (Array.isArray(res)) return res;
    return [];
  }

  async function reload() {
    setGlobalLoading(true);
    setLoading(true);
    try {
      const res = await api.vsd.listEquipments({ q, building, floor, zone });
      setItems(normalizeListResponse(res));
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
      setGlobalLoading(false);
    }
  }

  // Fichiers
  async function reloadFiles(equipId) {
    if (!equipId) return;
    try {
      const res = await api.vsd.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url: f.download_url || f.inline_url || `${API_BASE}/api/vsd/files/${encodeURIComponent(f.id)}/download`,
          }))
        : [];
      setFiles(arr);
    } catch (e) {
      console.error(e);
      setFiles([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    triggerReloadDebounced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, building, floor, zone]);

  /* ----------------------------- Édition ----------------------------- */
  const mergeZones = (raw) => {
    if (!raw) return raw;
    const clean = { ...raw };
    for (const field of ["building", "floor", "zone", "location"]) {
      if (typeof clean[field] === "object" && clean[field] !== null) {
        clean[field] = clean[field].name || clean[field].id || "";
      } else if (clean[field] == null) {
        clean[field] = "";
      } else {
        clean[field] = String(clean[field]);
      }
    }
    return clean;
  };

  async function openEdit(equipment, reloadFn) {
    const base = mergeZones(equipment || {});
    setEditing(base);
    initialRef.current = base;
    setDrawerOpen(true);

    if (typeof reloadFn === "function") {
      window._vsdReload = reloadFn;
    } else {
      delete window._vsdReload;
    }

    if (base?.id) {
      try {
        const res = await api.vsd.getEquipment(base.id);
        const fresh = mergeZones(res?.equipment || res || {});
        setEditing((cur) => {
          const next = { ...(cur || {}), ...fresh };
          initialRef.current = next;
          return next;
        });

        await reloadFiles(base.id);
      } catch (err) {
        console.warn("[VSD] Erreur rechargement équipement :", err);
        setFiles([]);
      }
    }
  }

  function closeEdit() {
    setEditing(null);
    setFiles([]);
    delete window._vsdReload;
    setDrawerOpen(false);
    initialRef.current = null;
  }

  function isDirty() {
    if (!editing || !initialRef.current) return false;
    const A = editing;
    const B = initialRef.current;
    const keys = [
      "name", "tag", "manufacturer", "model", "reference", "serial_number",
      "power_kw", "current_a", "voltage", "ip_address", "protocol",
      "building", "floor", "zone", "location", "panel",
      "status", "criticality", "comments"
    ];
    return keys.some((k) => String(A?.[k] ?? "") !== String(B?.[k] ?? ""));
  }

  const dirty = isDirty();

  async function saveBase() {
    if (!editing) return;
    const payload = {
      name: editing.name || "",
      tag: editing.tag || "",
      manufacturer: editing.manufacturer || "",
      model: editing.model || "",
      reference: editing.reference || "",
      serial_number: editing.serial_number || "",
      power_kw: editing.power_kw ?? null,
      current_a: editing.current_a ?? null,
      voltage: editing.voltage || "",
      ip_address: editing.ip_address || "",
      protocol: editing.protocol || "",
      building: editing.building || "",
      floor: editing.floor || "",
      zone: editing.zone || "",
      location: editing.location || "",
      panel: editing.panel || "",
      status: editing.status || "",
      criticality: editing.criticality || "",
      comments: editing.comments || "",
    };

    try {
      let updated;
      if (editing.id) {
        updated = await api.vsd.updateEquipment(editing.id, payload);
      } else {
        updated = await api.vsd.createEquipment(payload);
      }
      const eq = updated?.equipment || updated || null;
      if (eq?.id) {
        const fresh = mergeZones(eq);
        setEditing(fresh);
        initialRef.current = fresh;
      }
      await reload();
      setToast("Fiche enregistrée");
    } catch (e) {
      console.error("[VSD] Erreur lors de l'enregistrement :", e);
      setToast("Erreur enregistrement");
    }
  }

  async function deleteEquipment() {
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement ce variateur ? Cette action est irréversible.");
    if (!ok) return;
    try {
      await api.vsd.deleteEquipment(editing.id);
      closeEdit();
      await reload();
      setMapRefreshTick((t) => t + 1);
      setToast("Équipement supprimé");
    } catch (e) {
      console.error(e);
      setToast("Suppression impossible");
    }
  }

  /* ----------------------------- Photos / fichiers ----------------------------- */
  async function uploadMainPhoto(file) {
    if (!editing?.id || !file) return;
    try {
      await api.vsd.uploadPhoto(editing.id, file);
      const url = api.vsd.photoUrl(editing.id, { bust: true });
      setEditing((cur) => ({ ...(cur || {}), photo_url: url }));
      await reloadFiles(editing.id);
      await reload();
      setToast("Photo mise à jour");
    } catch (e) {
      console.error(e);
      setToast("Échec upload photo");
    }
  }

  async function uploadAttachments(filesArr) {
    if (!editing?.id || !filesArr?.length) return;
    try {
      await api.vsd.uploadFiles(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch (e) {
      console.error(e);
      setToast("Échec upload fichiers");
    }
  }

  /* ----------------------------- IA Analyse photo ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;

    try {
      const res = await api.vsd.extractFromPhotos(list);
      const s = res?.extracted || res || {};

      setEditing((x) => {
        const safe = { ...x };
        const applyIfValid = (field, value) => {
          if (value && typeof value === "string" && value.trim().length > 2 && value.trim() !== safe[field]) {
            safe[field] = value.trim();
          }
        };

        applyIfValid("manufacturer", s.manufacturer);
        applyIfValid("model", s.model);
        applyIfValid("reference", s.reference);
        applyIfValid("serial_number", s.serial_number);
        applyIfValid("voltage", s.voltage);
        applyIfValid("protocol", s.protocol);

        if (s.power_kw != null && !isNaN(Number(s.power_kw))) {
          safe.power_kw = Number(s.power_kw);
        }
        if (s.current_a != null && !isNaN(Number(s.current_a))) {
          safe.current_a = Number(s.current_a);
        }

        return safe;
      });

      setToast("Analyse IA terminée");
    } catch (e) {
      console.error("[VSD] Erreur analyse IA :", e);
      setToast("Analyse IA indisponible");
    }
  }

  /* ----------------------------- Plans ----------------------------- */
  async function loadPlans() {
    setMapsLoading(true);
    try {
      const r = await api.vsdMaps.listPlans();
      setPlans(Array.isArray(r?.plans) ? r.plans : []);
    } finally {
      setMapsLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "plans") loadPlans();
  }, [tab]);

  useEffect(() => {
    if (tab !== "plans" && selectedPlan) setSelectedPlan(null);
  }, [tab, selectedPlan]);

  useEffect(() => {
    if (!mapsLoading && selectedPlan && !plans.find((p) => p.logical_name === selectedPlan.logical_name)) {
      setSelectedPlan(null);
    }
  }, [plans, mapsLoading, selectedPlan]);

  /* ----------------------------- Arborescence par bâtiment ----------------------------- */
  const buildingTree = useMemo(() => {
    const tree = {};
    (items || []).forEach((item) => {
      const b = (item.building || "Sans bâtiment").trim();
      if (!tree[b]) tree[b] = [];
      tree[b].push(item);
    });
    return tree;
  }, [items]);

  /* ----------------------------- UI ----------------------------- */
  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "tree" ? "primary" : "ghost"} onClick={() => setTab("tree")}>
          🏢 Arborescence
        </Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>
          🗺️ Plans
        </Btn>
      </div>
    </div>
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />

      {globalLoading && (
        <div className="fixed inset-0 bg-white/70 flex items-center justify-center z-[5000] backdrop-blur-sm">
          <div className="text-sm text-gray-600">Mise à jour en cours…</div>
        </div>
      )}

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Variateurs de fréquence</h1>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setFiltersOpen((v) => !v)}>
            {filtersOpen ? "Masquer les filtres" : "Filtres"}
          </Btn>
        </div>
      </header>

      <StickyTabs />

      {filtersOpen && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / tag / fabricant…)" />
            <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
            <Input value={floor} onChange={setFloor} placeholder="Étage" />
            <Input value={zone} onChange={setZone} placeholder="Zone" />
          </div>
          <div className="flex gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setQ("");
                setBuilding("");
                setFloor("");
                setZone("");
              }}
            >
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}

      {/* --------- Onglet Arborescence --------- */}
      {tab === "tree" && (
        <div className="space-y-4">
          {loading && (
            <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Chargement…</div>
          )}
          {!loading && Object.keys(buildingTree).length === 0 && (
            <div className="bg-white rounded-2xl border shadow-sm p-4 text-gray-500">Aucun variateur.</div>
          )}
          {!loading &&
            Object.keys(buildingTree)
              .sort()
              .map((buildingName) => (
                <BuildingSection
                  key={buildingName}
                  buildingName={buildingName}
                  equipments={buildingTree[buildingName]}
                  onOpenEquipment={openEdit}
                />
              ))}
        </div>
      )}

      {/* --------- Onglet Plans --------- */}
      {tab === "plans" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold">Plans PDF</div>
            <VsdZipImport
              disabled={mapsLoading}
              onDone={async () => {
                setToast("Plans importés");
                await loadPlans();
              }}
            />
          </div>

          <PlanCards
            plans={plans}
            onRename={async (plan, name) => {
              await api.vsdMaps.renamePlan(plan.logical_name, name);
              await loadPlans();
            }}
            onPick={(plan) => {
              setSelectedPlan(plan);
              setMapRefreshTick((t) => t + 1);
            }}
          />

          {selectedPlan && (
            <div className="bg-white rounded-2xl border shadow-sm p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold truncate pr-3">
                  {selectedPlan.display_name || selectedPlan.logical_name}
                </div>
                <div className="flex items-center gap-2">
                  <Btn
                    variant="ghost"
                    onClick={() => {
                      setSelectedPlan(null);
                      setMapRefreshTick((t) => t + 1);
                    }}
                  >
                    Fermer le plan
                  </Btn>
                </div>
              </div>

              <VsdMap
                key={`${selectedPlan.logical_name}:${mapRefreshTick}`}
                plan={selectedPlan}
                onOpenEquipment={openEdit}
                onMetaChanged={async () => {
                  await reload();
                  setToast("Plans et équipements mis à jour");
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* --------- Drawer Édition --------- */}
      {drawerOpen && editing && (
        <Drawer title={`VSD • ${editing.name || "nouvel équipement"}`} onClose={closeEdit} dirty={dirty}>
          <div className="space-y-4">
            {/* Ajout & Analyse IA */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold">Ajout & Analyse IA</div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 rounded-lg text-sm bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => e.target.files?.length && analyzeFromPhotos(e.target.files)}
                    />
                    Analyser des photos (IA)
                  </label>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Conseils : photo nette de la plaque signalétique. L'IA remplira automatiquement les champs (fabricant, modèle, puissance, tension…).
              </div>
            </div>

            {/* Photo principale */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Photo principale</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadMainPhoto(e.target.files[0])}
                    />
                    Mettre à jour
                  </label>
                </div>
                <div className="w-40 h-40 rounded-xl border overflow-hidden bg-gray-50 flex items-center justify-center">
                  {editing.photo_url ? (
                    <img
                      src={api.vsd.photoUrl(editing.id, { bust: true })}
                      alt="photo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>
                  )}
                </div>
              </div>
            )}

            {/* Identification */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Identification</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Nom">
                  <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
                </Labeled>
                <Labeled label="Tag / Repère">
                  <Input value={editing.tag || ""} onChange={(v) => setEditing({ ...editing, tag: v })} />
                </Labeled>
                <Labeled label="Fabricant">
                  <Input value={editing.manufacturer || ""} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
                </Labeled>
                <Labeled label="Modèle">
                  <Input value={editing.model || ""} onChange={(v) => setEditing({ ...editing, model: v })} />
                </Labeled>
                <Labeled label="Référence">
                  <Input value={editing.reference || ""} onChange={(v) => setEditing({ ...editing, reference: v })} />
                </Labeled>
                <Labeled label="Numéro de série">
                  <Input value={editing.serial_number || ""} onChange={(v) => setEditing({ ...editing, serial_number: v })} />
                </Labeled>
              </div>
            </div>

            {/* Caractéristiques électriques */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Caractéristiques électriques</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Puissance (kW)">
                  <Input
                    type="number"
                    step="0.1"
                    value={editing.power_kw ?? ""}
                    onChange={(v) => setEditing({ ...editing, power_kw: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Courant (A)">
                  <Input
                    type="number"
                    step="0.1"
                    value={editing.current_a ?? ""}
                    onChange={(v) => setEditing({ ...editing, current_a: v === "" ? null : Number(v) })}
                  />
                </Labeled>
                <Labeled label="Tension">
                  <Input value={editing.voltage || ""} onChange={(v) => setEditing({ ...editing, voltage: v })} />
                </Labeled>
                <Labeled label="Adresse IP">
                  <Input value={editing.ip_address || ""} onChange={(v) => setEditing({ ...editing, ip_address: v })} />
                </Labeled>
                <Labeled label="Protocole">
                  <Input
                    value={editing.protocol || ""}
                    onChange={(v) => setEditing({ ...editing, protocol: v })}
                    placeholder="Modbus, Profibus…"
                  />
                </Labeled>
              </div>
            </div>

            {/* Localisation */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Localisation</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Bâtiment">
                  <Input value={editing.building || ""} onChange={(v) => setEditing({ ...editing, building: v })} />
                </Labeled>
                <Labeled label="Étage">
                  <Input value={editing.floor || ""} onChange={(v) => setEditing({ ...editing, floor: v })} />
                </Labeled>
                <Labeled label="Zone">
                  <Input value={editing.zone || ""} onChange={(v) => setEditing({ ...editing, zone: v })} />
                </Labeled>
                <Labeled label="Local / Machine">
                  <Input value={editing.location || ""} onChange={(v) => setEditing({ ...editing, location: v })} />
                </Labeled>
                <Labeled label="Tableau / Coffret">
                  <Input value={editing.panel || ""} onChange={(v) => setEditing({ ...editing, panel: v })} />
                </Labeled>
              </div>
            </div>

            {/* Statut & Criticité */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="font-semibold mb-2">Statut & Criticité</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label="Statut">
                  <Select
                    value={editing.status || ""}
                    onChange={(v) => setEditing({ ...editing, status: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "en_service", label: "En service" },
                      { value: "hors_service", label: "Hors service" },
                      { value: "spare", label: "Spare" },
                    ]}
                  />
                </Labeled>
                <Labeled label="Criticité">
                  <Select
                    value={editing.criticality || ""}
                    onChange={(v) => setEditing({ ...editing, criticality: v })}
                    options={[
                      { value: "", label: "—" },
                      { value: "critique", label: "Critique" },
                      { value: "important", label: "Important" },
                      { value: "standard", label: "Standard" },
                    ]}
                  />
                </Labeled>
              </div>
            </div>

            {/* Commentaires */}
            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">Commentaires</div>
              <Textarea
                rows={3}
                value={editing.comments || ""}
                onChange={(v) => setEditing({ ...editing, comments: v })}
                placeholder="Notes libres…"
              />
            </div>

            {/* Pièces jointes */}
            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes</div>
                  <label className="px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => e.target.files?.length && uploadAttachments(Array.from(e.target.files))}
                    />
                    Ajouter
                  </label>
                </div>
                <div className="mt-3 space-y-2">
                  {files.length === 0 && <div className="text-xs text-gray-500">Aucune pièce jointe.</div>}
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm border rounded-lg px-2 py-1">
                      
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:underline truncate max-w-[70%]"
                        title={f.name}
                      >
                        {f.name}
                      </a>
                      <button
                        className="text-rose-600 hover:underline"
                        onClick={async () => {
                          await api.vsd.deleteFile(f.id);
                          reloadFiles(editing.id);
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Btn variant={dirty ? "warn" : "ghost"} className={dirty ? "animate-pulse" : ""} onClick={saveBase} disabled={!dirty}>
                {dirty ? "Enregistrer la fiche" : "Aucune modif"}
              </Btn>
              {editing?.id && (
                <Btn variant="danger" onClick={deleteEquipment}>
                  Supprimer
                </Btn>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </section>
  );
}

/* ----------------------------- Sous-composants locaux ----------------------------- */
function BuildingSection({ buildingName, equipments = [], onOpenEquipment }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold">{buildingName}</span>
          <Badge color="blue">{equipments.length}</Badge>
        </div>
        <span className="text-gray-500">{collapsed ? "▼" : "▲"}</span>
      </button>

      {!collapsed && (
        <div className="divide-y">
          {equipments.map((eq) => (
            <div key={eq.id} className="p-4 hover:bg-gray-50 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                    {eq.photo_url ? (
                      <img src={api.vsd.photoUrl(eq.id)} alt={eq.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-gray-500 p-1 text-center">
                        Photo à<br />prendre
                      </span>
                    )}
                  </div>
                  <div>
                    <button className="text-blue-700 font-semibold hover:underline" onClick={() => onOpenEquipment(eq)}>
                      {eq.name || eq.tag || "VSD"}
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {eq.floor ? `${eq.floor} • ` : ""}
                      {eq.zone ? `${eq.zone} • ` : ""}
                      {eq.location || "—"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {eq.manufacturer || "—"} {eq.model ? `• ${eq.model}` : ""} {eq.power_kw ? `• ${eq.power_kw} kW` : ""}
                    </div>
                  </div>
                </div>
                <Btn variant="ghost" onClick={() => onOpenEquipment(eq)}>
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

function VsdZipImport({ disabled, onDone }) {
  const inputRef = useRef(null);
  return (
    <div className="flex items-center gap-2">
      <Btn variant="ghost" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Import ZIP de plans
      </Btn>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            await api.vsdMaps.uploadZip(f);
            onDone?.();
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PlanCards({ plans = [], onRename, onPick }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {!plans.length && <div className="text-gray-500">Aucun plan importé.</div>}
      {plans.map((p) => (
        <PlanCard key={p.id || p.logical_name} plan={p} onRename={onRename} onPick={onPick} />
      ))}
    </div>
  );
}

function PlanCard({ plan, onRename, onPick }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(plan.display_name || plan.logical_name || "");

  return (
    <div className="border rounded-2xl bg-white shadow-sm hover:shadow transition overflow-hidden">
      <div className="relative aspect-video bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center justify-center text-gray-500">
          <div className="text-4xl leading-none">PDF</div>
          <div className="text-[11px] mt-1">Plan</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate text-center">
          {name}
        </div>
      </div>
      <div className="p-3">
        {!edit ? (
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium truncate" title={name}>
              {name || "—"}
            </div>
            <div className="flex items-center gap-1">
              <Btn variant="ghost" aria-label="Renommer le plan" onClick={() => setEdit(true)}>
                ✏️
              </Btn>
              <Btn variant="subtle" onClick={() => onPick(plan)}>
                Ouvrir
              </Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input value={name} onChange={setName} />
            <Btn
              variant="subtle"
              onClick={async () => {
                await onRename(plan, (name || "").trim());
                setEdit(false);
              }}
            >
              OK
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                setName(plan.display_name || plan.logical_name || "");
                setEdit(false);
              }}
            >
              Annuler
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
