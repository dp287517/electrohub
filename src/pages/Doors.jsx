import React, { useEffect, useMemo, useRef, useState } from "react";
import { get, post, del } from "../lib/api.js"; // réutilise tes helpers existants

/**
 * Doors.jsx — UI complète pour la maintenance des portes coupe-feu
 * Onglets: Contrôles | Calendrier | Paramètres
 *
 * Dépend des endpoints fournis par server_ddors.js / server_doors.js
 * - /api/doors (GET, POST)
 * - /api/doors/:id (DELETE)
 * - /api/doors/:id/start (POST)
 * - /api/doors/:id/next (GET)
 * - /api/doors/:id/complete (POST)
 * - /api/doors/:id/photo (POST, formData)
 * - /api/doors/:id/upload (POST, formData)
 * - /api/doors/:id/qrcodes.pdf (GET)
 * - /api/doors/inspections/:id/nc.pdf (GET)
 * - /api/doors/templates (GET, POST)
 * - /api/doors/templates/:id (PATCH)
 * - /api/doors/calendar (GET)
 * - /api/doors/alerts (GET)
 */

// -----------------------------
// Petits composants utilitaires
// -----------------------------
const cx = (...c) => c.filter(Boolean).join(" ");
const Spinner = () => (
  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4"></circle>
    <path className="opacity-75" d="M4 12a8 8 0 018-8" strokeWidth="4" strokeLinecap="round"></path>
  </svg>
);
const Badge = ({ children, tone = "gray" }) => (
  <span className={cx(
    "inline-flex items-center px-2 py-0.5 rounded text-xs border",
    tone === "green" && "bg-green-50 border-green-200 text-green-700",
    tone === "red" && "bg-red-50 border-red-200 text-red-700",
    tone === "amber" && "bg-amber-50 border-amber-200 text-amber-700",
    tone === "blue" && "bg-blue-50 border-blue-200 text-blue-700",
    tone === "gray" && "bg-gray-50 border-gray-200 text-gray-700"
  )}>{children}</span>
);

// -----------------------------
// Vue principale
// -----------------------------
export default function Doors() {
  const [tab, setTab] = useState("control");
  const [doors, setDoors] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [creating, setCreating] = useState({ name: "", location: "" });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [d, t, c, a] = await Promise.all([
        get("/api/doors"),
        get("/api/doors/templates"),
        get("/api/doors/calendar"),
        get("/api/doors/alerts"),
      ]);
      setDoors(d.items || []);
      setTemplates(t.items || []);
      setCalendar(c.events || []);
      setAlerts(a.alerts || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const filteredDoors = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (doors || [])
      .filter((d) => {
        if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
        if (!s) return true;
        return (
          String(d.name || "").toLowerCase().includes(s) ||
          String(d.location || "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [doors, search, statusFilter]);

  async function createDoor() {
    if (!creating.name.trim()) return alert("Nom requis");
    await post("/api/doors", creating);
    setCreating({ name: "", location: "" });
    await fetchAll();
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Portes coupe-feu – Maintenance</h1>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            fetchAll();
          }}
          className="text-sm text-gray-600 hover:text-black"
          title="Rafraîchir"
        >
          {loading ? <Spinner /> : "↻"}
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <TabBtn id="control" tab={tab} setTab={setTab}>
          Contrôles
        </TabBtn>
        <TabBtn id="calendar" tab={tab} setTab={setTab}>
          Calendrier
        </TabBtn>
        <TabBtn id="params" tab={tab} setTab={setTab}>
          Paramètres
        </TabBtn>
      </div>

      {tab === "control" && (
        <div className="space-y-6">
          {/* Create */}
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="text-lg font-semibold mb-2">Créer une porte</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                className="border rounded p-2"
                placeholder="Nom de la porte"
                value={creating.name}
                onChange={(e) => setCreating((v) => ({ ...v, name: e.target.value }))}
              />
              <input
                className="border rounded p-2"
                placeholder="Localisation (optionnel)"
                value={creating.location}
                onChange={(e) => setCreating((v) => ({ ...v, location: e.target.value }))}
              />
              <button className="bg-black text-white rounded p-2" onClick={createDoor}>
                Ajouter
              </button>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Badge tone="blue">Fréquence: {templates?.[0]?.months_interval ?? 12} mois</Badge>
                <a
                  className="underline"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setTab("params");
                  }}
                >
                  changer
                </a>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border rounded p-2 flex-1 min-w-[200px]"
              placeholder="Rechercher par nom ou localisation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="border rounded p-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Tous statuts</option>
              <option value="OK">OK</option>
              <option value="NC">NC</option>
              <option value="N/A">N/A</option>
            </select>
            {!!alerts.length && (
              <div className="ml-auto flex flex-wrap gap-2">
                {alerts.map((a) => (
                  <Badge key={a.inspection_id} tone={a.level === "overdue" ? "red" : a.level === "today" ? "amber" : "blue"}>
                    {a.name} • {a.due} {a.level === "overdue" ? "(retard)" : a.level === "today" ? "(aujourd'hui)" : a.level === "7d" ? "(≤7j)" : "(≤30j)"}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Doors grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredDoors.map((d) => (
              <DoorCard key={d.id} door={d} onChanged={fetchAll} />
            ))}
            {!filteredDoors.length && (
              <div className="text-sm text-gray-500">Aucune porte trouvée…</div>
            )}
          </div>
        </div>
      )}

      {tab === "calendar" && <CalendarPanel events={calendar} />}

      {tab === "params" && (
        <ParamsPanel templates={templates} onChanged={fetchAll} />
      )}
    </div>
  );
}

function TabBtn({ id, tab, setTab, children }) {
  const active = tab === id;
  return (
    <button
      onClick={() => setTab(id)}
      className={cx(
        "px-3 py-1.5 rounded-full border",
        active
          ? "bg-black text-white border-black"
          : "bg-white text-black border-gray-300 hover:border-black"
      )}
    >
      {children}
    </button>
  );
}

// -----------------------------
// Door card + actions
// -----------------------------
function DoorCard({ door, onChanged }) {
  const [next, setNext] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    (async () => {
      const r = await get(`/api/doors/${door.id}/next`);
      setNext(r.inspection || null);
    })();
  }, [door.id]);

  async function startControl() {
    setOpen(true); // la modale déclenchera le /start et chargera la checklist
  }

  async function deleteDoor() {
    const phrase = `DELETE ${door.name}`;
    const typed = prompt(`Suppression définitive. Tapez: ${phrase}`);
    if (typed !== phrase) return;
    setBusy(true);
    await del(`/api/doors/${door.id}?confirm=${encodeURIComponent(phrase)}`);
    setBusy(false);
    await onChanged();
  }

  return (
    <div ref={cardRef} id={`door-${door.id}`} className="bg-white rounded-xl p-4 shadow space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate">{door.name}</div>
          <div className="text-sm text-gray-600 truncate">{door.location || "—"}</div>
          <div className="text-sm mt-1 flex items-center gap-2">
            Statut:
            {door.status === "OK" && <Badge tone="green">OK</Badge>}
            {door.status === "NC" && <Badge tone="red">NC</Badge>}
            {door.status === "N/A" && <Badge>NA</Badge>}
          </div>
          <div className="text-sm text-gray-700 mt-1">
            Prochain contrôle: <b>{next?.due_date || "non planifié"}</b>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <a
            className="px-2 py-1 border rounded"
            href={`/api/doors/${door.id}/qrcodes.pdf?sizes=80,120,200`}
            target="_blank"
          >
            QR codes
          </a>
          <FileUploadButton
            label="+ pièce jointe"
            accept="*/*"
            onUpload={async (file) => {
              const fd = new FormData();
              fd.append("file", file);
              await fetch(`/api/doors/${door.id}/upload`, {
                method: "POST",
                body: fd,
                credentials: "include",
              });
              alert("Pièce jointe ajoutée");
            }}
          />
          <button className="px-2 py-1 border rounded" onClick={startControl}>
            Contrôler
          </button>
          <button
            className="px-2 py-1 border rounded text-red-600"
            onClick={deleteDoor}
            disabled={busy}
            title="Supprimer définitivement"
          >
            {busy ? <Spinner /> : "Supprimer"}
          </button>
        </div>
      </div>

      <Dropzone
        onFiles={async (files) => {
          for (const f of files) {
            const fd = new FormData();
            fd.append("file", f);
            await fetch(`/api/doors/${door.id}/upload`, {
              method: "POST",
              body: fd,
              credentials: "include",
            });
          }
          alert(`${files.length} fichier(s) attaché(s)`);
        }}
      />

      {open && (
        <ChecklistModal
          door={door}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function FileUploadButton({ label = "Choisir un fichier", accept = "*/*", onUpload }) {
  const inpRef = useRef();
  return (
    <button
      className="px-2 py-1 border rounded relative overflow-hidden"
      onClick={() => inpRef.current?.click()}
    >
      {label}
      <input
        ref={inpRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await onUpload(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function Dropzone({ onFiles }) {
  const [over, setOver] = useState(false);
  const ref = useRef();
  return (
    <div
      ref={ref}
      className={cx(
        "mt-2 border rounded p-3 text-sm text-gray-600",
        over ? "border-black bg-gray-50" : "border-dashed"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) await onFiles(files);
      }}
    >
      Glissez-déposez des fichiers ici pour les attacher à la porte.
    </div>
  );
}

// -----------------------------
// Checklist modal
// -----------------------------
function ChecklistModal({ door, onClose, onChanged }) {
  const [insp, setInsp] = useState(null);
  const [items, setItems] = useState([]); // {item_id,label,status,comment}
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    (async () => {
      const s = await post(`/api/doors/${door.id}/start`, {});
      const templateItems = s.items || [];
      setInsp(s.inspection);
      setItems(
        templateItems.map((it) => ({
          item_id: it.id,
          label: it.label,
          status: "conforme",
          comment: "",
        }))
      );
    })();
  }, [door.id]);

  async function submit() {
    if (!insp) return;
    setSaving(true);
    const r = await post(`/api/doors/${door.id}/complete`, {
      inspection_id: insp.id,
      results: items,
    });

    // Si NC: ouvrir le PDF et créer un follow-up SAP
    if (r.inspection?.status === "nc") {
      window.open(`/api/doors/inspections/${insp.id}/nc.pdf`, "_blank");
      try {
        await post(`/api/doors/${door.id}/followup`, {
          note: `NC générée pour inspection ${insp.id}`,
        });
      } catch {}
    }

    // Photo optionnelle
    if (photo) {
      const fd = new FormData();
      fd.append("photo", photo);
      await fetch(`/api/doors/${door.id}/photo`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
    }

    setSaving(false);
    onClose();
    await onChanged();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow max-w-2xl w-full p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-semibold">Contrôle — {door.name}</div>
          <button onClick={onClose} className="text-gray-600">✕</button>
        </div>

        {!insp ? (
          <div className="py-12 text-center text-gray-600">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
            {items.map((it, idx) => (
              <div key={idx} className="border rounded p-2">
                <div className="font-medium">{it.label}</div>
                <div className="flex flex-wrap items-center gap-4 mt-1 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`s${idx}`}
                      checked={it.status === "conforme"}
                      onChange={() =>
                        setItems((f) => f.map((x, i) => (i === idx ? { ...x, status: "conforme" } : x)))
                      }
                    />
                    Conforme
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`s${idx}`}
                      checked={it.status === "non_conforme"}
                      onChange={() =>
                        setItems((f) => f.map((x, i) => (i === idx ? { ...x, status: "non_conforme" } : x)))
                      }
                    />
                    Non conforme
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`s${idx}`}
                      checked={it.status === "na"}
                      onChange={() =>
                        setItems((f) => f.map((x, i) => (i === idx ? { ...x, status: "na" } : x)))
                      }
                    />
                    N/A
                  </label>
                </div>
                <textarea
                  className="mt-2 w-full border rounded p-2"
                  placeholder="Commentaire (optionnel)"
                  value={it.comment}
                  onChange={(e) =>
                    setItems((f) => f.map((x, i) => (i === idx ? { ...x, comment: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm flex items-center gap-2">
            Photo de la porte (optionnel)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            />
          </label>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded border" onClick={onClose} disabled={saving}>
              Annuler
            </button>
            <button
              className="px-3 py-2 rounded bg-black text-white"
              onClick={submit}
              disabled={saving || !insp}
            >
              {saving ? <Spinner /> : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Calendrier
// -----------------------------
function CalendarPanel({ events }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow">
      <div className="text-lg font-semibold mb-3">Calendrier des contrôles</div>
      {!events?.length ? (
        <div className="text-sm text-gray-500">Aucun événement planifié.</div>
      ) : (
        <ul className="divide-y">
          {events.map((ev) => (
            <li key={ev.id} className="py-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{ev.title}</div>
                <div className="text-sm text-gray-600">{ev.date}</div>
              </div>
              <a href={`#door-${ev.door_id}`} className="text-blue-600">
                Ouvrir la porte
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------
// Paramètres (templates & fréquence)
// -----------------------------
function ParamsPanel({ templates, onChanged }) {
  const [name, setName] = useState(`Checklist standard ${new Date().getFullYear()}`);
  const [items, setItems] = useState([
    { id: "1", label: "La porte se referme automatiquement", order: 1 },
    { id: "2", label: "Joints intacts sans déchirure", order: 2 },
    { id: "3", label: "Zone dégagée / pas d'obstacle", order: 3 },
  ]);
  const [interval, setInterval] = useState(12);
  const [saving, setSaving] = useState(false);

  async function addTemplate() {
    setSaving(true);
    await post("/api/doors/templates", {
      name,
      items,
      months_interval: interval,
      active: true,
    });
    setSaving(false);
    setName(`Checklist ${Date.now()}`);
    await onChanged();
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl p-4 shadow">
        <div className="text-lg font-semibold mb-2">Créer / modifier checklist</div>
        <label className="text-sm">Nom</label>
        <input
          className="border rounded p-2 w-full mb-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={it.id} className="flex gap-2 items-center">
              <input
                className="border rounded p-2 flex-1"
                value={it.label}
                onChange={(e) =>
                  setItems((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x))
                  )
                }
              />
              <button
                className="px-2 py-1 border rounded"
                onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}
              >
                —
              </button>
            </div>
          ))}
          <button
            className="px-2 py-1 border rounded"
            onClick={() =>
              setItems((arr) => [
                ...arr,
                { id: String(arr.length + 1), label: "Nouvel item", order: arr.length + 1 },
              ])
            }
          >
            + item
          </button>
        </div>
        <div className="mt-3">
          <label className="text-sm">Fréquence des contrôles</label>
          <select
            className="border rounded p-2 w-full"
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          >
            <option value={1}>1× / mois</option>
            <option value={3}>Tous les 3 mois</option>
            <option value={6}>2× / an</option>
            <option value={12}>1× / an</option>
            <option value={24}>1× / 2 ans</option>
          </select>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="px-3 py-2 rounded bg-black text-white"
            onClick={addTemplate}
            disabled={saving}
          >
            {saving ? <Spinner /> : "Sauvegarder la checklist"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow">
        <div className="text-lg font-semibold mb-2">Templates actifs</div>
        {!templates?.length ? (
          <div className="text-sm text-gray-500">Aucun template actif.</div>
        ) : (
          <ul className="divide-y">
            {templates.map((t) => (
              <li key={t.id} className="py-2">
                <div className="font-medium">{t.name}</div>
                <div className="text-sm text-gray-600">
                  {t.items?.length || 0} items • fréquence: {t.months_interval} mois
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
