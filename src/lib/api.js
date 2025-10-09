/** Base API */
export const API_BASE = import.meta.env.VITE_API_BASE || "";

/** Get current site from client-side stored profile (fallback to "Default") */
function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "Default";
  } catch {
    return "Default";
  }
}

/** Fetch JSON with automatic X-Site header */
async function jsonFetch(url, options = {}) {
  const site = currentSite();
  const finalUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const headers = new Headers(options.headers || {});
  headers.set("X-Site", site);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(finalUrl, {
    credentials: "include",
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

/** Generic helpers */
export async function get(path, params) {
  const qs = params
    ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))}`
    : "";
  return jsonFetch(`${path}${qs}`, { method: "GET" });
}
export async function post(path, body) {
  return jsonFetch(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) });
}
export async function put(path, body) {
  return jsonFetch(path, { method: "PUT", body: body instanceof FormData ? body : JSON.stringify(body) });
}
export async function del(path) {
  return jsonFetch(path, { method: "DELETE" });
}
export async function upload(path, formData /* FormData */) {
  // ne pas fixer Content-Type: le browser s’en charge (multipart boundary)
  const site = currentSite();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { method: "POST", body: formData, credentials: "include", headers: { "X-Site": site } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

/** Namespaced API */
export const api = {
  /** --- AUTH / PROFILE (si utilisés dans l’app) --- */
  auth: {
    me: () => get("/api/auth/me"),
    login: (payload) => post("/api/auth/login", payload),
    logout: () => post("/api/auth/logout", {}),
  },

  /** --- OIBT (existant) --- */
  oibt: {
    listProjects: (params) => get("/api/oibt/projects", params),
    getProject: (id) => get(`/api/oibt/projects/${id}`),
    createProject: (payload) => post("/api/oibt/projects", payload),
    updateProject: (id, payload) => put(`/api/oibt/projects/${id}`, payload),
    removeProject: (id) => del(`/api/oibt/projects/${id}`),
    uploadProjectActionFile: (id, action, formData) =>
      upload(`/api/oibt/projects/${id}/upload?action=${encodeURIComponent(action)}`, formData),

    listPeriodics: (params) => get("/api/oibt/periodics", params),
    createPeriodic: (payload) => post("/api/oibt/periodics", payload),
    updatePeriodic: (id, payload) => put(`/api/oibt/periodics/${id}`, payload),
    removePeriodic: (id) => del(`/api/oibt/periodics/${id}`),
    uploadPeriodicFile: (id, type, formData) =>
      upload(`/api/oibt/periodics/${id}/upload?type=${encodeURIComponent(type)}`, formData),
  },

  /** --- PROJECTS (NOUVEAU) --- */
  projects: {
    // Projets
    list: (params) => get("/api/projects/projects", params),
    create: (payload) => post("/api/projects/projects", payload),
    update: (id, payload) => put(`/api/projects/projects/${id}`, payload),
    remove: (id) => del(`/api/projects/projects/${id}`),

    // Statut (étapes)
    status: (id) => get(`/api/projects/projects/${id}/status`),
    setStatus: (id, payload) => put(`/api/projects/projects/${id}/status`, payload),

    // Upload multi-fichiers historisés par catégorie
    upload: (id, category, formData) =>
      upload(`/api/projects/projects/${id}/upload?category=${encodeURIComponent(category)}`, formData),
    listFiles: (id, category) => get(`/api/projects/projects/${id}/files`, { category }),
    downloadFile: (file_id) => get(`/api/projects/download`, { file_id }), // renvoie le flux; pour télécharger directement utiliser window.location

    // Lignes financières
    addOffer: (id, payload) => post(`/api/projects/projects/${id}/offer`, payload),
    addOrder: (id, payload) => post(`/api/projects/projects/${id}/order`, payload),
    addInvoice: (id, payload) => post(`/api/projects/projects/${id}/invoice`, payload),
    lines: (id) => get(`/api/projects/projects/${id}/lines`),

    // Analyse & IA
    analysis: (id) => get(`/api/projects/projects/${id}/analysis`),
    assistant: (id, question) => post(`/api/projects/projects/${id}/assistant`, { question }),
    health: () => get(`/api/projects/health`),
  },

  /** --- CONTROLS (MIS À NIVEAU) --- */
  controls: {
    // ---- Hiérarchie & TSD ----
    // Nouvelle arborescence (site -> HV / Switchboards / Devices / ATEX -> tâches)
    hierarchyTree: (params) =>
      get("/api/controls/hierarchy/tree", { ...(params || {}) }),

    // Debug de détection colonnes (utile en cas d'équipements vides)
    hierarchyDebug: () => get("/api/controls/hierarchy/debug"),

    // Métadonnées TSD (catégories/contrôles)
    tsdMeta: () => get("/api/controls/tsd"),

    // ---- Bootstrap / Auto-link ----
    // Relie entités ↔ équipements et seed (create=1/0, seed=1/0)
    autoLink: ({ create = 1, seed = 1 } = {}) =>
      get("/api/controls/bootstrap/auto-link", { create, seed }),

    // ---- Tâches ----
    // Liste paginée/filtrée
    listTasks: (params) =>
      get("/api/controls/tasks", { ...(params || {}) }),

    // Tâches d'une entité spécifique
    tasksByEntity: (entity_id, q = "") =>
      get("/api/controls/tasks", { entity_id, q }),

    // Schéma détaillé de la tâche (checklist, obs, procédure, etc.)
    taskSchema: (id) => get(`/api/controls/tasks/${id}/schema`),

    // Clôture + replanification d'une tâche
    closeTask: (id, payload) => put(`/api/controls/tasks/${id}/close`, payload),

    // Pièce jointe sur une tâche
    attachToTask: (taskId, file /* File */) => {
      const fd = new FormData();
      fd.append("file", file);
      return upload(`/api/controls/tasks/${taskId}/attachments`, fd);
    },

    // ---- Health ----
    health: () => get(`/api/controls/health`),

    // ---- ALIAS RÉTRO-COMPAT (ne change rien ailleurs) ----
    // (Si des écrans plus anciens appellent encore ces fonctions)
    tree: (params) => get("/api/controls/hierarchy/tree", { ...(params || {}) }),
    catalog: (params) => get("/api/controls/tsd", { ...(params || {}) }),
    sync: ({ create = 1, seed = 1 } = {}) =>
      get("/api/controls/bootstrap/auto-link", { create, seed }),
    taskDetails: (id) => get(`/api/controls/tasks/${id}/schema`),
    completeTask: (id, payload) => put(`/api/controls/tasks/${id}/close`, payload),
    uploadAttachments: (taskId, files, label) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("file", f));
      if (label) fd.append("label", label); // ignoré côté backend actuel (sans impact)
      return upload(`/api/controls/tasks/${taskId}/attachments`, fd);
    },
    analyze: (taskId) => post(`/api/controls/tasks/${taskId}/analyze`, {}),   // laissé tel quel si déjà utilisé
    assistant: (taskId, question) => post(`/api/controls/tasks/${taskId}/assistant`, { question }), // idem
    history: (params) => get("/api/controls/history", params), // si route absente => 404 contrôlé au runtime
    records: (params) => get("/api/controls/records", params), // idem
  },

  /** --- COMP-EXT (Prestataires externes) — NOUVEAU --- */
  compExt: {
    // Prestataires (vendors)
    list: (params) => get("/api/comp-ext/vendors", params),                 // params: { q? }
    create: (payload) => post("/api/comp-ext/vendors", payload),            // { name, offer_status, jsa_status, pp_applicable, pp_link, access_status, sap_wo, visits[], owner }
    update: (id, payload) => put(`/api/comp-ext/vendors/${id}`, payload),   // mêmes champs qu'au create (visites remplacées si fourni)
    remove: (id) => del(`/api/comp-ext/vendors/${id}`),

    // Planning
    calendar: () => get("/api/comp-ext/calendar"),                          // { tasks[], events[] }
    stats: () => get("/api/comp-ext/stats"),                                // agrégats pour graphes
  },

  /** --- ASK VEEVA (Lecture & Q/R Documents) — AJOUT --- */
  askVeeva: {
    /** Vérification de l’état du microservice */
    health: () => get("/api/ask-veeva/health"),

    /** Upload d’un .zip contenant les docs (clé de champ: 'zip') */
    uploadZip: (formData /* FormData */) =>
      upload("/api/ask-veeva/upload", formData),

    /** Recherche sémantique simple, renvoie les meilleurs passages */
    search: (query, k = 5) =>
      post("/api/ask-veeva/search", { query, k }),

    /** Pose une question libre ; la réponse inclut des citations */
    ask: (question) =>
      post("/api/ask-veeva/ask", { question }),
  },
};
