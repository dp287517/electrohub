// src/pages/Atex.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");
import "../styles/atex-map.css";
import { api, API_BASE } from "../lib/api.js";
import AtexMap from "./Atex-map.jsx";
/* ----------------------------- UI utils ----------------------------- */
function Btn({ children, variant = "primary", className = "", ...p }) {
  const map = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
    ghost:
      "bg-white text-black border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
    danger:
      "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed",
    success:
      "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
    subtle:
      "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed",
    warn:
      "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed",
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
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
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
/* Drawer avec garde-fou si modifications non sauvegardées */
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
          <Btn variant="ghost" onClick={confirmClose}>
            Fermer
          </Btn>
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
/* ---- Dates pour <input type="date"> ---- */
function asDateInput(v) {
  if (!v) return "";
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}
/* ----------------------------- Status ----------------------------- */
const STATUS = {
  A_FAIRE: "a_faire",
  EN_COURS: "en_cours_30",
  EN_RETARD: "en_retard",
  FAIT: "fait",
};
function statusColor(s) {
  if (s === STATUS.A_FAIRE) return "green";
  if (s === STATUS.EN_COURS) return "orange";
  if (s === STATUS.EN_RETARD) return "red";
  if (s === STATUS.FAIT) return "blue";
  return "gray";
}
function statusLabel(s) {
  if (s === STATUS.A_FAIRE) return "À faire";
  if (s === STATUS.EN_COURS) return "≤90j";
  if (s === STATUS.EN_RETARD) return "En retard";
  if (s === STATUS.FAIT) return "Fait";
  return s || "—";
}
/* ----------------------------- Mini calendrier ----------------------------- */
function MonthCalendar({ events = [], onDayClick }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf("month"));
  const start = cursor.startOf("week");
  const end = cursor.endOf("month").endOf("week");
  const days = [];
  let d = start;
  while (d.isBefore(end)) {
    days.push(d);
    d = d.add(1, "day");
  }
  const map = new Map();
  for (const e of events) {
    const k = dayjs(e.date).format("YYYY-MM-DD");
    const arr = map.get(k) || [];
    arr.push(e);
    map.set(k, arr);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{cursor.format("MMMM YYYY")}</div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setCursor(cursor.subtract(1, "month"))}>
            ◀
          </Btn>
          <Btn variant="ghost" onClick={() => setCursor(dayjs().startOf("month"))}>Aujourd’hui</Btn>
          <Btn variant="ghost" onClick={() => setCursor(cursor.add(1, "month"))}>
            ▶
          </Btn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-gray-600 mb-1">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => (
          <div key={l} className="px-2 py-1">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const es = map.get(key) || [];
          const isCurMonth = day.month() === cursor.month();
          return (
            <button
              key={key}
              onClick={() => onDayClick?.({ date: key, events: es })}
              className={`border rounded-lg p-2 text-left min-h-[64px] ${isCurMonth ? "bg-white" : "bg-gray-50 text-gray-500"}`}
            >
              <div className="text-[11px] mb-1">{day.format("D")}</div>
              <div className="flex flex-wrap gap-1">
                {es.slice(0, 3).map((ev, i) => (
                  <span key={i} className="px-1 rounded bg-blue-100 text-blue-700 text-[10px]">
                    {ev.name || ev.equipment_name || ev.equipment_id}
                  </span>
                ))}
                {es.length > 3 && <span className="text-[10px] text-gray-500">+{es.length - 3}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
/* ----------------------------- Page principale ATEX ----------------------------- */
export default function Atex() {
  // Onglets
  const [tab, setTab] = useState("controls");
  // Liste équipements
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // Filtres
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [building, setBuilding] = useState("");
  const [zone, setZone] = useState("");
  const [compliance, setCompliance] = useState("");
  // Édition
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const initialRef = useRef(null); // snapshot pour dirty check
  // PJ list
  const [files, setFiles] = useState([]);
  // Historique des contrôles (audit trail)
  const [history, setHistory] = useState([]);
  // Calendrier
  const [calendar, setCalendar] = useState({ events: [] });
  // Toast
  const [toast, setToast] = useState("");
  // Plans
  const [plans, setPlans] = useState([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  // Tick de rafraîchissement carte (force remount)
  const [mapRefreshTick, setMapRefreshTick] = useState(0);

    // AJOUT : Indicateur de chargement global (tableau + plans)
    const [globalLoading, setGlobalLoading] = useState(false);
  /* ----------------------------- Helpers ----------------------------- */
  const debouncer = useRef(null);
  function triggerReloadDebounced() {
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(reload, 300);
  }
  function next36MonthsISO(dateStr) {
    if (!dateStr) return "";
    const d = dayjs(dateStr);
    return d.isValid() ? d.add(36, "month").format("YYYY-MM-DD") : "";
  }
  // Règle locale de conformité selon zonage + marquage
  function simpleConformityCheck({ zoning_gas, zoning_dust, atex_mark_gas, atex_mark_dust }) {
    const hasEx = (s) => typeof s === "string" && /Ex\s*[A-Za-z0-9]/.test(s);

    const gasZoned = zoning_gas != null;   // 0/1/2
    const dustZoned = zoning_dust != null; // 20/21/22

    // Pas de zonage du tout → conforme
    if (!gasZoned && !dustZoned) return "conforme";

    // Si zone gaz → il faut un marquage gaz lisible (contient "Ex…")
    if (gasZoned && !hasEx(atex_mark_gas)) return "non_conforme";

    // Si zone poussière → il faut un marquage poussière lisible
    if (dustZoned && !hasEx(atex_mark_dust)) return "non_conforme";

    // Zonage(s) respecté(s)
    return "conforme";
  }
  async function reload() {
    setGlobalLoading(true);
    setLoading(true);
    try {
      const res = await api.atex.listEquipments({
        q,
        status,
        building,
        zone,
        compliance,
      });
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
      setGlobalLoading(false);
    }
  }
  async function reloadCalendar() {
    try {
      const cal = await api.atex.calendar?.();
      if (Array.isArray(cal?.events)) {
        setCalendar({ events: cal.events });
        return;
      }
    } catch {}
    const evts = (items || [])
      .filter((it) => it?.next_check_date)
      .map((it) => ({
        date: dayjs(it.next_check_date).format("YYYY-MM-DD"),
        equipment_id: it.id,
        name: it.name,
      }));
    setCalendar({ events: evts });
  }
  // Normalise la shape renvoyée par le backend pour les fichiers
  async function reloadFiles(equipId) {
    if (!equipId) return;
    try {
      const res = await api.atex.listFiles(equipId).catch(() => ({}));
      const arr = Array.isArray(res?.files)
        ? res.files.map((f) => ({
            id: f.id,
            name: f.original_name || f.name || f.filename || `Fichier ${f.id}`,
            mime: f.mime,
            url:
              f.download_url ||
              f.inline_url ||
              `${API_BASE}/api/atex/files/${encodeURIComponent(f.id)}/download`,
          }))
        : Array.isArray(res?.items)
        ? res.items
        : [];
      setFiles(arr);
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      setFiles([]);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    triggerReloadDebounced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, building, zone, compliance]);
  useEffect(() => {
    reloadCalendar();
  }, [items]);
    // AJOUT : Rechargement du tableau quand le plan change (bâtiment/zone)
    useEffect(() => {
      const handler = async () => {
        await reload();
      };
      window.addEventListener("atex-plan-meta-updated", handler);
      return () => window.removeEventListener("atex-plan-meta-updated", handler);
    }, [q, status, building, zone, compliance]);
    // Merge helper : robuste contre objets imbriqués et champs manquants
    const mergeZones = (raw) => {
      if (!raw) return raw;

      const clean = { ...raw };

      // 🧹 Normalisation des champs texte (toujours string, jamais objet)
      const textFields = ["building", "zone", "equipment", "sub_equipment"];
      textFields.forEach((field) => {
        if (typeof clean[field] === "object" && clean[field] !== null) {
          clean[field] = clean[field].name || clean[field].equipment || clean[field].id || "";
        } else if (clean[field] == null) {
          clean[field] = "";
        } else {
          clean[field] = String(clean[field]);
        }
      });

      // 🗺️ Zonage gaz / poussière
      clean.zoning_gas = raw?.zones?.zoning_gas ?? raw?.zoning_gas ?? null;
      clean.zoning_dust = raw?.zones?.zoning_dust ?? raw?.zoning_dust ?? null;

      // ✅ Conformité : on force une valeur explicite pour éviter les retours vides
      // - On priorise : valeur backend (`compliance_state`) → décision IA → résultat historique
      // - Sinon, on met "na" pour éviter que le tableau affiche "—"
      clean.compliance_state =
        raw?.compliance_state ||
        raw?.decision ||
        raw?.last_result ||
        "na";

      return clean;
    };

  async function openEdit(equipment, reloadFn) {
    const base = mergeZones(equipment || {});
    setEditing(base);
    initialRef.current = base;
    setDrawerOpen(true);

    // Stocke la fonction reload pour usage global
    if (typeof reloadFn === "function") {
      window._atexReload = reloadFn;
    } else {
      delete window._atexReload;
    }

    if (base?.id) {
      try {
        // Recharge les données fraîches
        const res = await api.atex.getEquipment(base.id);
        const fresh = mergeZones(res?.equipment || {});

        setEditing((cur) => {
          const next = { ...(cur || {}), ...fresh };
          initialRef.current = next;
          return next;
        });

        // Historique
        const hist = await api.atex.getEquipmentHistory(base.id);
        setHistory(Array.isArray(hist?.checks) ? hist.checks : []);

        // Fichiers
        await reloadFiles(base.id);
      } catch (err) {
        console.warn("[ATEX] Erreur rechargement équipement :", err);
        setHistory([]);
        setFiles([]);
      }
    }
  }

  function closeEdit() {
    setEditing(null);
    setFiles([]);
    setHistory([]);
    // Nettoyage global : évite que reload() du plan reste accroché
    delete window._atexReload;
    setDrawerOpen(false);
    initialRef.current = null;
  }
  function isDirty() {
    if (!editing || !initialRef.current) return false;
    const A = editing;
    const B = initialRef.current;
    const keys = [
      "name",
      "building",
      "zone",
      "equipment",
      "sub_equipment",
      "type",
      "manufacturer",
      "manufacturer_ref",
      "atex_mark_gas",
      "atex_mark_dust",
      "comment",
      "installed_at",
      "last_check_date",
      "next_check_date",
      "zoning_gas",
      "zoning_dust",
    ];
    return keys.some((k) => {
      const va = A?.[k] ?? "";
      const vb = B?.[k] ?? "";
      return String(va) !== String(vb);
    });
  }

  const dirty = isDirty();

  async function saveBase() {
    if (!editing) return;

    // 🧩 Validation locale des marquages ATEX avant enregistrement (non bloquante si champ vide)
    // - On vérifie la forme du marquage ("Ex...") UNIQUEMENT si un marquage est saisi ET qu'il existe un zonage correspondant.
    // - L'absence de marquage n'empêche JAMAIS l'enregistrement : la conformité tranchera (non conforme si le zonage l'exige).
    const looksLikeAtexMark = (s) => s && /Ex\s*[A-Za-z0-9]/.test(s);

    const hasGasZone = editing.zoning_gas != null;
    const hasDustZone = editing.zoning_dust != null;

    // Si zoné gaz et un marquage gaz est saisi mais invalide → on bloque pour éviter de sauver un format faux
    if (hasGasZone && editing.atex_mark_gas && !looksLikeAtexMark(editing.atex_mark_gas)) {
      alert("⚠️ Le marquage gaz saisi semble incomplet (aucun code 'Ex' détecté).");
      return;
    }

    // Si zoné poussière et un marquage poussière est saisi mais invalide → on bloque
    if (hasDustZone && editing.atex_mark_dust && !looksLikeAtexMark(editing.atex_mark_dust)) {
      alert("⚠️ Le marquage poussière saisi semble incomplet (aucun code 'Ex' détecté).");
      return;
    }

    // 📝 Harmonisation locale de la conformité (sans bloquer l'enregistrement)
    // Règles :
    // - Si zone gaz/poussière et marquage correspondant manquant → non conforme
    // - Si aucun zonage → conforme
    // - Sinon, on conserve l'état courant (ou "na" par défaut)
    const missingGasMark = hasGasZone && !editing.atex_mark_gas;
    const missingDustMark = hasDustZone && !editing.atex_mark_dust;

    const nextCompliance =
      missingGasMark || missingDustMark
        ? "non_conforme"
        : (!hasGasZone && !hasDustZone ? "conforme" : (editing.compliance_state ?? "na"));

    setEditing((cur) => ({ ...(cur || {}), compliance_state: nextCompliance }));

    const payload = {
      name: editing.name || "",
      building: editing.building || "",
      zone: editing.zone || "",
      equipment: editing.equipment || "",
      sub_equipment: editing.sub_equipment || "",
      type: editing.type || "",
      manufacturer: editing.manufacturer || "",
      manufacturer_ref: editing.manufacturer_ref || "",
      atex_mark_gas: editing.atex_mark_gas || null,
      atex_mark_dust: editing.atex_mark_dust || null,
      comment: editing.comment || "",
      status: editing.status || STATUS.A_FAIRE,
      installed_at: editing.installed_at || editing.installation_date || null,
      last_check_date: editing.last_check_date || null,
      next_check_date: editing.next_check_date || null,
      zoning_gas: editing.zoning_gas ?? null,
      zoning_dust: editing.zoning_dust ?? null,
    };

    try {
      let updated;
      if (editing.id) {
        updated = await api.atex.updateEquipment(editing.id, payload);
      } else {
        updated = await api.atex.createEquipment(payload);
      }

      const eq = updated?.equipment || updated || null;
      if (eq?.id) {
        const fresh = mergeZones(eq);

        // 🧹 Corrige le type des champs objets potentiels
        fresh.equipment =
          typeof fresh.equipment === "object"
            ? fresh.equipment?.equipment || ""
            : fresh.equipment || "";
        fresh.sub_equipment =
          typeof fresh.sub_equipment === "object"
            ? fresh.sub_equipment?.name || ""
            : fresh.sub_equipment || "";

        setEditing(fresh);
        initialRef.current = fresh;
      }

      // ✅ Ces lignes doivent être DANS le try
      await reload();
      setToast("Fiche enregistrée");
    } catch (e) {
      console.error("[ATEX] Erreur lors de l'enregistrement :", e);
      setToast("Erreur enregistrement");
    }
  }

  async function deleteEquipment() {
    if (!editing?.id) return;
    const ok = window.confirm("Supprimer définitivement cet équipement ATEX ? Cette action est irréversible.");
    if (!ok) return;
    try {
      await api.atex.removeEquipment(editing.id);
      closeEdit();
      await reload();
      setMapRefreshTick((t) => t + 1);
      setToast("Équipement supprimé");
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      setToast("Suppression impossible");
    }
  }
  /* ----------------------------- Photos / pièces jointes ----------------------------- */
  async function uploadMainPhoto(file) {
    if (!editing?.id || !file) return;
    try {
      await api.atex.uploadPhoto(editing.id, file);
      // met à jour l’aperçu immédiatement (cache-bust)
      const url = api.atex.photoUrl(editing.id, { bust: true });
      setEditing((cur) => ({ ...(cur || {}), photo_url: url }));
      await reloadFiles(editing.id);
      await reload();
      setToast("Photo mise à jour");
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      setToast("Échec upload photo");
    }
  }
  async function uploadAttachments(filesArr) {
    if (!editing?.id || !filesArr?.length) return;
    try {
      await api.atex.uploadAttachments(editing.id, filesArr);
      await reloadFiles(editing.id);
      setToast(filesArr.length > 1 ? "Fichiers ajoutés" : "Fichier ajouté");
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      setToast("Échec upload fichiers");
    }
  }
  /* ----------------------------- IA ----------------------------- */
  async function analyzeFromPhotos(filesLike) {
    const list = Array.from(filesLike || []);
    if (!list.length) return;

    try {
      const res = await api.atex.analyzePhotoBatch(list);
      const s = res?.extracted || res || {};

      // 🧩 Fusion robuste : ne remplace que si la valeur IA est non vide et pertinente
      setEditing((x) => {
        const safe = { ...x };

        const applyIfValid = (field, value) => {
          if (value && typeof value === "string" && value.trim().length > 2 && value.trim() !== safe[field]) {
            safe[field] = value.trim();
          }
        };

        applyIfValid("manufacturer", s.manufacturer);
        applyIfValid("manufacturer_ref", s.manufacturer_ref);
        applyIfValid("atex_mark_gas", s.atex_mark_gas);
        applyIfValid("atex_mark_dust", s.atex_mark_dust);
        applyIfValid("type", s.type);

        return safe;
      });

      setToast("Analyse photos terminée");
    } catch (e) {
      console.error("[ATEX] Erreur analyse IA :", e);
      setToast("Analyse photos indisponible");
    }
  }

  async function analyzeCompliance() {
    if (!editing) return;
    try {
      const body = {
        atex_mark_gas: editing.atex_mark_gas || "",
        atex_mark_dust: editing.atex_mark_dust || "",
        target_gas: editing.zoning_gas ?? null,
        target_dust: editing.zoning_dust ?? null,
      };

      // 🧩 Validation locale du marquage : doit contenir au moins "Ex"
      const looksLikeAtexMark = (s) => s && /Ex\s*[A-Za-z0-9]/.test(s);
      if (!looksLikeAtexMark(body.atex_mark_gas) && !looksLikeAtexMark(body.atex_mark_dust)) {
        console.warn("[ATEX] Marquage incomplet détecté :", body);
        setEditing((cur) => ({ ...cur, compliance_state: "non_conforme" }));
        setToast("Marquage ATEX incomplet (aucun code 'Ex' détecté)");
        return;
      }

      const res =
        (api.atex.assessConformity && (await api.atex.assessConformity(body))) ||
        (api.atex.aiAnalyze && (await api.atex.aiAnalyze(body)));

      const decision = res?.decision || null;
      const rationale = res?.rationale || "";

      if (editing?.id && api.atex.applyCompliance) {
        try {
          await api.atex.applyCompliance(editing.id, {
            decision,
            rationale,
            source: res?.source || "unknown",
          });
        } catch {}
      }

      if (editing?.id) {
        const fresh = await api.atex.getEquipment(editing.id).catch(() => null);
        if (fresh?.equipment) {
          const merged = mergeZones(fresh.equipment);
          setEditing((cur) => ({ ...(cur || {}), ...merged }));
        }
      }

      await reload();

      setToast(
        decision
          ? `Conformité: ${
              decision === "conforme"
                ? "Conforme"
                : decision === "non_conforme"
                ? "Non conforme"
                : "Indéterminé"
            }`
          : res?.message || "Analyse conformité OK"
      );
    } catch (e) {
      console.error("[ATEX] Erreur analyse conformité :", e);
      setToast("Analyse conformité indisponible");
    }
  }

  // VÉRIFICATION IA (frontend) : pas de blocage si marquages manquants, combine IA + règle locale
  async function verifyComplianceIA() {
    if (!editing?.id) return;

    const before = { ...editing }; // snapshot avant IA (préserver les champs saisis)

    // --- Règle locale immédiate (zonage + marquages) ---
    const hasEx = (s) => typeof s === "string" && /Ex\s*[A-Za-z0-9]/.test(s);
    const gasZoned = editing.zoning_gas != null;   // 0/1/2 => zoné
    const dustZoned = editing.zoning_dust != null; // 20/21/22 => zoné
    const localDecision = (() => {
      if (!gasZoned && !dustZoned) return "conforme";         // pas de zonage => conforme
      if (gasZoned && !hasEx(editing.atex_mark_gas || "")) return "non_conforme";
      if (dustZoned && !hasEx(editing.atex_mark_dust || "")) return "non_conforme";
      return "conforme";
    })();

    try {
      // 1) Corps IA (aucune validation bloquante en amont)
      const body = {
        atex_mark_gas: editing.atex_mark_gas || "",
        atex_mark_dust: editing.atex_mark_dust || "",
        target_gas: editing.zoning_gas ?? null,
        target_dust: editing.zoning_dust ?? null,
      };

      // 2) Appel IA si dispo ; si ça échoue, on garde la décision locale
      let res = null;
      try {
        if (api.atex.assessConformity) {
          res = await api.atex.assessConformity(body);
        } else if (api.atex.aiAnalyze) {
          res = await api.atex.aiAnalyze(body);
        }
      } catch (e) {
        console.warn("[ATEX] IA indisponible, décision locale utilisée :", e);
      }

      // 3) Choix final : décision IA prioritaire si explicite, sinon décision locale
      const decision =
        res?.decision === "conforme" || res?.decision === "non_conforme"
          ? res.decision
          : localDecision;

      const rationale = res?.rationale || (decision === localDecision ? "Décision locale (zonage/marquage)" : "");

      // 4) Reporter la décision au backend si possible
      if (api.atex.applyCompliance) {
        await api.atex.applyCompliance(editing.id, {
          decision,
          rationale,
          source: res?.source || (res ? "ai" : "local_rule"),
        });
      }

      // 5) Recharger la fiche et fusionner prudemment (ne pas écraser les champs saisis par du vide)
      const updated = await api.atex.getEquipment(editing.id).catch(() => null);
      const merged = mergeZones(updated?.equipment || updated || {});

      setEditing((cur) => {
        const safe = { ...before };
        const next = { ...(merged || {}) };
        const isEmpty = (v) => v == null || (typeof v === "string" && v.trim() === "");

        ["type", "manufacturer", "manufacturer_ref", "atex_mark_gas", "atex_mark_dust"].forEach((field) => {
          if (isEmpty(next[field])) next[field] = safe[field] || "";
        });

        next.photo_url = safe.photo_url || next.photo_url || "";
        next.compliance_state = next.compliance_state || decision || safe.compliance_state || "na";
        return next;
      });

      // 6) Historique + rafraîchissement tableau
      try {
        const hist = await api.atex.getEquipmentHistory(editing.id);
        setHistory(Array.isArray(hist?.checks) ? hist.checks : []);
      } catch {}

      if (typeof window._atexReload === "function") {
        await window._atexReload();
      } else {
        await reload();
      }

      // 7) Feedback
      setToast(
        decision
          ? `Conformité: ${decision === "conforme" ? "Conforme" : "Non conforme"}`
          : "Analyse IA terminée"
      );
    } catch (e) {
      console.error("[ATEX] Échec vérification conformité IA :", e);
      setToast("Échec vérification conformité IA");
    }
  }

/* ----------------------------- Plans ----------------------------- */
async function loadPlans() {
  setMapsLoading(true);
  try {
    const r = await api.atexMaps.listPlans();
    setPlans(Array.isArray(r?.plans) ? r.plans : []);
  } finally {
    setMapsLoading(false);
  }
}

// 🧭 Chargement des plans quand on entre dans l’onglet
useEffect(() => {
  if (tab === "plans") {
    loadPlans();
  }
}, [tab]);

// 🧹 Nettoyage automatique : dès qu'on quitte l’onglet ou recharge les plans
useEffect(() => {
  if (tab !== "plans" && selectedPlan) {
    setSelectedPlan(null);
  }
}, [tab]);

// 🧹 Fermeture automatique si la liste des plans est rechargée
useEffect(() => {
  if (!mapsLoading && selectedPlan && !plans.find(p => p.logical_name === selectedPlan.logical_name)) {
    setSelectedPlan(null);
  }
}, [plans, mapsLoading]);

/* ---------- Optimistic zone merge helper (UI instantanée) ---------- */
function applyZonesLocally(id, zones) {
  if (!id) return;
  setItems((old) =>
    (old || []).map((it) =>
      it.id === id
        ? {
            ...it,
            zoning_gas: zones?.zoning_gas ?? it.zoning_gas,
            zoning_dust: zones?.zoning_dust ?? it.zoning_dust,
          }
        : it
    )
  );
  setEditing((cur) =>
    cur && cur.id === id
      ? {
          ...cur,
          zoning_gas: zones?.zoning_gas ?? cur.zoning_gas,
          zoning_dust: zones?.zoning_dust ?? cur.zoning_dust,
        }
      : cur
  );
}

/* --------- Onglet Plans (rendu JSX) --------- */
{tab === "plans" && (
  <div className="space-y-4" key={`plans-tab-${selectedPlan ? selectedPlan.logical_name : "none"}`}>
    {/* Barre d’import ZIP */}
    <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
      <div className="font-semibold">Plans PDF</div>
      <AtexZipImport
        disabled={mapsLoading}
        onDone={async () => {
          setToast("Plans importés");
          await loadPlans();
        }}
      />
    </div>

    {/* Liste des cartes de plans */}
    <PlanCards
      plans={plans}
      onRename={async (plan, name) => {
        await api.atexMaps.renamePlan(plan.logical_name, name);
        await loadPlans();
      }}
      onPick={(plan) => {
        // Si on reclique sur le même plan → toggle propre
        if (selectedPlan?.logical_name === plan.logical_name) {
          setSelectedPlan(null);
        } else {
          setSelectedPlan(plan);
          setMapRefreshTick((t) => t + 1);
        }
      }}
    />

    {/* ✅ Bandeau du plan sélectionné */}
    {selectedPlan && (
      <div
        key={`plan-view-${selectedPlan.logical_name}-${mapRefreshTick}`}
        className="bg-white rounded-2xl border shadow-sm p-3 transition-all duration-300 animate-fadeIn"
      >
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

        <AtexMap
          key={`${selectedPlan.logical_name}:${mapRefreshTick}`}
          plan={selectedPlan}
          onOpenEquipment={openEdit}
          onZonesApplied={async (id, zones) => {
            applyZonesLocally(id, zones);
            await reload();
            if (editing?.id === id) {
              try {
                const res = await api.atex.getEquipment(id);
                const fresh = mergeZones(res?.equipment || {});
                setEditing((cur) => ({ ...(cur || {}), ...fresh }));
              } catch {}
            }
          }}
          onMetaChanged={async () => {
            await reload();
            setToast("Plans et équipements mis à jour");
          }}
        />
      </div>
    )}
  </div>
)}

  /* ----------------------------- UI ----------------------------- */
  const StickyTabs = () => (
    <div className="sticky top-[12px] z-30 bg-gray-50/70 backdrop-blur py-2 -mt-2 mb-2">
      <div className="flex flex-wrap gap-2">
        <Btn variant={tab === "controls" ? "primary" : "ghost"} onClick={() => setTab("controls")}>
          Contrôles
        </Btn>
        <Btn variant={tab === "calendar" ? "primary" : "ghost"} onClick={() => setTab("calendar")}>
          Calendrier
        </Btn>
        <Btn variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>
          Plans
        </Btn>
        <Btn variant={tab === "settings" ? "primary" : "ghost"} onClick={() => setTab("settings")}>
          Paramètres
        </Btn>
      </div>
    </div>
  );
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <Toast text={toast} onClose={() => setToast("")} />
        {/* SPINNER GLOBAL */}
      {globalLoading && (
        <div className="fixed inset-0 bg-white/70 flex items-center justify-center z-[5000] backdrop-blur-sm">
          <div className="text-sm text-gray-600">Mise à jour en cours...</div>
        </div>
      )}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Équipements ATEX</h1>
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
          <div className="grid md:grid-cols-5 gap-3">
            <Input value={q} onChange={setQ} placeholder="Recherche (nom / marquage / ref…)" />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "Tous statuts" },
                { value: STATUS.A_FAIRE, label: "À faire (vert)" },
                { value: STATUS.EN_COURS, label: "En cours ≤90j (orange)" },
                { value: STATUS.EN_RETARD, label: "En retard (rouge)" },
                { value: STATUS.FAIT, label: "Fait (hist.)" },
              ]}
              placeholder="Tous statuts"
            />
            <Input value={building} onChange={setBuilding} placeholder="Bâtiment" />
            <Input value={zone} onChange={setZone} placeholder="Zone / Étage" />
            <Select
              value={compliance}
              onChange={setCompliance}
              options={[
                { value: "", label: "Tous états de conformité" },
                { value: "conforme", label: "Conforme" },
                { value: "non_conforme", label: "Non conforme" },
                { value: "na", label: "N/A" },
              ]}
              placeholder="Conformité"
            />
          </div>
          <div className="flex gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setQ("");
                setStatus("");
                setBuilding("");
                setZone("");
                setCompliance("");
              }}
            >
              Réinitialiser
            </Btn>
          </div>
          <div className="text-xs text-gray-500">Recherche automatique activée.</div>
        </div>
      )}
      {/* --------- Onglet Contrôles --------- */}
      {tab === "controls" && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-[12px] z-20 bg-gray-50/90 backdrop-blur supports-[backdrop-filter]:bg-gray-50/70">
                <tr className="text-left border-b">
                  <th className="px-4 py-3 font-semibold text-gray-700">Équipement</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Localisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Conformité</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Statut</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Prochain contrôle</th>
                  <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">
                      Chargement…
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-gray-500">
                      Aucun équipement.
                    </td>
                  </tr>
                )}
                {!loading &&
                  items.map((it, idx) => (
                    <tr
                      key={it.id}
                      className={`border-b hover:bg-gray-50 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"}`}
                    >
                      <td className="px-4 py-3 min-w-[260px]">
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center shrink-0">
                            {it.photo_url ? (
                              <img
                                src={api.atex.photoUrl(it.id)}
                                alt={it.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-[10px] text-gray-500 p-1 text-center">
                                Photo à
                                <br />
                                prendre
                              </span>
                            )}
                          </div>
                          <button className="text-blue-700 font-medium hover:underline" onClick={() => openEdit(it)}>
                            {it.name || it.type || "Équipement"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(it.building || "—") +
                          " • " +
                          (it.zone || "—") +
                          (it.equipment ? ` • ${it.equipment}` : "") +
                          (it.sub_equipment ? ` • ${it.sub_equipment}` : "")}
                      </td>
                      <td className="px-4 py-3">
                        {it.compliance_state === "conforme" ? (
                          <Badge color="green">Conforme</Badge>
                        ) : it.compliance_state === "non_conforme" ? (
                          <Badge color="red">Non conforme</Badge>
                        ) : (
                          <Badge>—</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={statusColor(it.status)}>{statusLabel(it.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Btn variant="ghost" onClick={() => openEdit(it)}>
                            Ouvrir
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {loading && <div className="p-4 text-gray-500">Chargement…</div>}
            {!loading && items.length === 0 && <div className="p-4 text-gray-500">Aucun équipement.</div>}
            {!loading &&
              items.map((it) => (
                <div key={it.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-16 rounded-lg border overflow-hidden bg-gray-50 flex items-center justify-center">
                        {it.photo_url ? (
                          <img src={api.atex.photoUrl(it.id)} alt={it.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[11px] text-gray-500 p-1 text-center">
                            Photo à
                            <br />
                            prendre
                          </span>
                        )}
                      </div>
                      <div>
                        <button className="text-blue-700 font-semibold hover:underline" onClick={() => openEdit(it)}>
                          {it.name || it.type || "Équipement"}
                        </button>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {it.building || "—"} • {it.zone || "—"} {it.equipment ? `• ${it.equipment}` : ""}{" "}
                          {it.sub_equipment ? `• ${it.sub_equipment}` : ""}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {it.compliance_state === "conforme" ? (
                            <Badge color="green">Conforme</Badge>
                          ) : it.compliance_state === "non_conforme" ? (
                            <Badge color="red">Non conforme</Badge>
                          ) : (
                            <Badge>—</Badge>
                          )}
                          <span className="text-xs text-gray-500">
                            Prochain contrôle: {it.next_check_date ? dayjs(it.next_check_date).format("DD/MM/YYYY") : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge color={statusColor(it.status)}>{statusLabel(it.status)}</Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn variant="ghost" onClick={() => openEdit(it)}>
                      Ouvrir
                    </Btn>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
      {/* --------- Onglet Calendrier --------- */}
      {tab === "calendar" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <MonthCalendar
            events={calendar.events}
            onDayClick={({ events }) => {
              const first = events?.[0];
              if (!first?.equipment_id) return;
              const it = items.find((x) => x.id === first.equipment_id);
              if (it) openEdit(it);
            }}
          />
        </div>
      )}
      {/* --------- Onglet Plans --------- */}
      {tab === "plans" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold">Plans PDF</div>
            <AtexZipImport
              disabled={mapsLoading}
              onDone={async () => {
                setToast("Plans importés");
                await loadPlans();
              }}
            />
          </div>

          {/* ✅ REMPLACEMENT ICI : On utilise PlanTree au lieu de PlanCards */}
          <PlanTree
            plans={plans}
            onRename={async (plan, name) => {
              await api.atexMaps.renamePlan(plan.logical_name, name);
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

              <AtexMap
                key={`${selectedPlan.logical_name}:${mapRefreshTick}`}
                plan={selectedPlan}
                onOpenEquipment={openEdit}
                onZonesApplied={async (id, zones) => {
                  applyZonesLocally(id, zones);
                  await reload();
                  if (editing?.id === id) {
                    try {
                      const res = await api.atex.getEquipment(id);
                      const fresh = mergeZones(res?.equipment || {});
                      setEditing((cur) => ({ ...(cur || {}), ...fresh }));
                    } catch {}
                  }
                }}
                onMetaChanged={async () => {
                  await reload();
                  setToast("Plans et équipements mis à jour");
                }}
              />
            </div>
          )}
        </div>
      )}
      {/* --------- Onglet Paramètres --------- */}
      {tab === "settings" && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-2">
          <div className="text-sm text-gray-600">
            Paramétrage ATEX (placeholder). On peut y mettre des gabarits ou préférences.
          </div>
        </div>
      )}
      {/* --------- Drawer Édition --------- */}
      {drawerOpen && editing && (
        <Drawer title={`ATEX • ${editing.name || "nouvel équipement"}`} onClose={closeEdit} dirty={dirty}>
          <div className="space-y-4">
            {/* Bâtiment & Zone — repris du plan (lecture seule) */}
            <div className="border rounded-2xl p-3 bg-white">
              <div className="grid sm:grid-cols-3 gap-3">
                <Labeled label="Bâtiment (depuis plan)">
                  <Input
                    value={editing.building || ""}
                    onChange={() => {}}
                    readOnly
                    className="bg-gray-50 text-gray-600"
                    title="Défini dans l'en-tête du plan PDF"
                  />
                </Labeled>
                <Labeled label="Zone (depuis plan)">
                  <Input
                    value={editing.zone || ""}
                    onChange={() => {}}
                    readOnly
                    className="bg-gray-50 text-gray-600"
                    title="Défini dans l'en-tête du plan PDF"
                  />
                </Labeled>
                <div className="flex items-end">
                  <Btn
                    variant={dirty ? "warn" : "ghost"}
                    className={dirty ? "animate-pulse" : ""}
                    onClick={saveBase}
                    disabled={!dirty}
                  >
                    {dirty ? "Enregistrer la fiche" : "Enregistré"}
                  </Btn>
                </div>
              </div>
            </div>
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
                  <Btn variant="subtle" onClick={verifyComplianceIA}>
                    Vérifier conformité (IA)
                  </Btn>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Conseils : photo nette de la plaque (gaz/poussière). Le zonage provient des zones du plan.
              </div>
            </div>
            {/* Métadonnées principales */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Nom">
                <Input value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
              </Labeled>
              <Labeled label="Type (interrupteur, luminaire, etc.)">
                <Input value={editing.type || ""} onChange={(v) => setEditing({ ...editing, type: v })} />
              </Labeled>
              <Labeled label="Fabricant">
                <Input
                  value={editing.manufacturer || ""}
                  onChange={(v) => setEditing({ ...editing, manufacturer: v })}
                />
              </Labeled>
              <Labeled label="Référence fabricant">
                <Input
                  value={editing.manufacturer_ref || ""}
                  onChange={(v) => setEditing({ ...editing, manufacturer_ref: v })}
                />
              </Labeled>
              <Labeled label="Marquage ATEX (gaz)">
                <Input
                  value={editing.atex_mark_gas || ""}
                  onChange={(v) => setEditing({ ...editing, atex_mark_gas: v })}
                />
              </Labeled>
              <Labeled label="Marquage ATEX (poussière)">
                <Input
                  value={editing.atex_mark_dust || ""}
                  onChange={(v) => setEditing({ ...editing, atex_mark_dust: v })}
                />
              </Labeled>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Équipement (macro)">
                <Input value={editing.equipment || ""} onChange={(v) => setEditing({ ...editing, equipment: v })} />
              </Labeled>
              <Labeled label="Sous-Équipement (depuis zones tracées)">
                <Input
                  value={editing.sub_equipment || ""}
                  onChange={(v) => setEditing({ ...editing, sub_equipment: v })}
                />
              </Labeled>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Labeled label="Zonage gaz (0 / 1 / 2)">
                <Input
                  value={editing.zoning_gas ?? ""}
                  onChange={(v) => setEditing({ ...editing, zoning_gas: v === "" ? null : Number(v) })}
                />
              </Labeled>
              <Labeled label="Zonage poussière (20 / 21 / 22)">
                <Input
                  value={editing.zoning_dust ?? ""}
                  onChange={(v) => setEditing({ ...editing, zoning_dust: v === "" ? null : Number(v) })}
                />
              </Labeled>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Labeled label="Date d’installation">
                <Input
                  type="date"
                  value={asDateInput(editing.installed_at || editing.installation_date)}
                  onChange={(v) => setEditing({ ...editing, installed_at: v })}
                />
              </Labeled>
              <Labeled label="Dernier contrôle">
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="flex-1"
                    value={asDateInput(editing.last_check_date)}
                    onChange={(v) => {
                      const nextAuto = next36MonthsISO(v);
                      setEditing((cur) => ({
                        ...(cur || {}),
                        last_check_date: v,
                        next_check_date: nextAuto || cur?.next_check_date || "",
                      }));
                    }}
                  />
                  {/* Bouton check rapide – évite double si IA déjà faite */}
                  {editing?.id && (
                    <Btn
                      variant="subtle"
                      title="Valider le contrôle aujourd'hui"
                      onClick={async () => {
                        try {
                          // Si conformité déjà définie par IA → on ne crée pas de check manuel
                          if (editing.compliance_state) {
                            setToast("Conformité déjà vérifiée par IA");
                            return;
                          }

                          await api.atex.quickCheckEquipment(editing.id);
                          const today = dayjs().format("YYYY-MM-DD");
                          const nextAuto = next36MonthsISO(today);

                          setEditing((cur) => ({
                            ...(cur || {}),
                            last_check_date: today,
                            next_check_date: nextAuto,
                            compliance_state: "conforme", // optionnel : marque comme conforme
                          }));

                          // Recharge historique
                          const res = await api.atex.getEquipmentHistory(editing.id);
                          setHistory(Array.isArray(res?.checks) ? res.checks : []);

                          // Recharge tableau
                          if (typeof window._atexReload === "function") {
                            await window._atexReload();
                          } else {
                            await reload();
                          }

                          setToast("Contrôle validé");
                        } catch (e) {
                          console.error(e);
                          setToast("Erreur validation rapide");
                        }
                      }}
                    >
                      ✅ 
                    </Btn>
                  )}
                </div>
              </Labeled>
              <Labeled label="Prochain contrôle (auto +36 mois, ajustable)">
                <Input
                  type="date"
                  value={asDateInput(editing.next_check_date)}
                  onChange={(v) => setEditing({ ...editing, next_check_date: v })}
                />
              </Labeled>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Statut</span>
                <Badge color={statusColor(editing.status)}>{statusLabel(editing.status)}</Badge>
                <span className="text-sm text-gray-600">• Conformité</span>
                {editing.compliance_state === "conforme" ? (
                  <Badge color="green">Conforme</Badge>
                ) : editing.compliance_state === "non_conforme" ? (
                  <Badge color="red">Non conforme</Badge>
                ) : (
                  <Badge>—</Badge>
                )}
              </div>
              <div className="text-sm text-gray-600">Alerte tableau: ≤90 jours avant l’échéance</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Btn
                variant={dirty ? "warn" : "ghost"}
                className={dirty ? "animate-pulse" : ""}
                onClick={saveBase}
                disabled={!dirty}
              >
                {dirty ? "Enregistrer la fiche" : "Aucune modif"}
              </Btn>
              {editing?.id && (
                <Btn variant="danger" onClick={deleteEquipment}>
                  Supprimer
                </Btn>
              )}
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
                    <img src={api.atex.photoUrl(editing.id, { bust: true })} alt="photo" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-500 p-2 text-center">Aucune photo</span>
                  )}
                </div>
              </div>
            )}
            {/* Pièces jointes & photos */}
            {editing?.id && (
              <div className="border rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Pièces jointes & photos</div>
                  <div className="flex items-center gap-2">
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
                </div>
                {/* Liste des pièces jointes */}
                <div className="mt-3 space-y-2">
                  {files.length === 0 && <div className="text-xs text-gray-500">Aucune pièce jointe.</div>}
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-sm border rounded-lg px-2 py-1">
                      <a
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
                          await api.atex.deleteFile(f.id);
                          reloadFiles(editing.id);
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Glisser-déposer supporté dans l’onglet Plans lors de la création in situ.
                </div>
              </div>
            )}
            {/* Historique des contrôles */}
            {editing?.id && (
              <div className="border rounded-2xl p-3 bg-white">
                <div className="font-semibold mb-2">Historique des contrôles</div>
                {history.length === 0 && (
                  <div className="text-xs text-gray-500">Aucun contrôle enregistré.</div>
                )}
                {history.length > 0 && (
                  <div className="text-sm divide-y border rounded-lg">
                    {history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1">
                        <div>
                          <div className="font-medium">
                            {dayjs(h.date || h.checked_at).format("DD/MM/YYYY")}
                          </div>
                          <div className="text-xs text-gray-500">
                            {h.user_name || h.user_email || "—"}
                          </div>
                        </div>
                        {(() => {
                          const decision = h.decision || h.result || h.compliance_state || "";
                          const isConforme = decision === "conforme";
                          const isNonConforme = decision === "non_conforme";
                          return (
                            <Badge color={isConforme ? "green" : isNonConforme ? "red" : "gray"}>
                              {isConforme
                                ? "Conforme"
                                : isNonConforme
                                ? "Non conforme"
                                : "—"}
                            </Badge>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="border rounded-2xl p-3">
              <div className="font-semibold mb-2">Commentaire</div>
              <Textarea
                rows={3}
                value={editing.comment || ""}
                onChange={(v) => setEditing({ ...editing, comment: v })}
                placeholder="Notes libres…"
              />
            </div>
          </div>
        </Drawer>
      )}
    </section>
  );
}
/* ----------------------------- Sous-composants locaux ----------------------------- */
function AtexZipImport({ disabled, onDone }) {
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
            await api.atexMaps.uploadZip(f);
            onDone?.();
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
/* ----------------------------- Vue Arborescence Plans ----------------------------- */
function PlanTree({ plans = [], onRename, onPick }) {
  // 1. Grouper par Bâtiment -> Zone
  const tree = useMemo(() => {
    const t = {};
    plans.forEach((p) => {
      const bat = (p.building || "Non classé").trim() || "Non classé";
      const zone = (p.zone || "Autres").trim() || "Autres";
      
      if (!t[bat]) t[bat] = {};
      if (!t[bat][zone]) t[bat][zone] = [];
      t[bat][zone].push(p);
    });
    // Trier les clés (alphabétique)
    const sortedBats = Object.keys(t).sort();
    const result = sortedBats.map((bat) => {
      const zonesObj = t[bat];
      const sortedZones = Object.keys(zonesObj).sort().map((z) => ({
        name: z,
        items: zonesObj[z].sort((a, b) => (a.display_name || a.logical_name).localeCompare(b.display_name || b.logical_name))
      }));
      return { name: bat, zones: sortedZones };
    });
    return result;
  }, [plans]);

  if (!plans.length) return <div className="text-gray-500 italic">Aucun plan importé.</div>;

  return (
    <div className="space-y-3">
      {tree.map((bat) => (
        <details key={bat.name} className="group bg-white border rounded-xl shadow-sm overflow-hidden" open>
          <summary className="flex items-center gap-2 px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition select-none">
            <span className="transform group-open:rotate-90 transition-transform text-gray-400">▶</span>
            <span className="font-bold text-gray-800">🏢 {bat.name}</span>
            <span className="text-xs text-gray-500 px-2 py-0.5 bg-white border rounded-full">
              {bat.zones.reduce((acc, z) => acc + z.items.length, 0)} plans
            </span>
          </summary>
          <div className="p-3 space-y-3">
            {bat.zones.map((z) => (
              <div key={z.name} className="pl-4 border-l-2 border-gray-100 ml-2">
                <div className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
                  📍 {z.name}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {z.items.map((p) => (
                    <PlanCard key={p.id || p.logical_name} plan={p} onRename={onRename} onPick={onPick} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
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
          <div className="text-[11px] mt-1">PDF</div>
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

