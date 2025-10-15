/** src/lib/api.js */

/** Base API */
export const API_BASE = import.meta.env.VITE_API_BASE || "";

/* ---------------- Identity helpers (cookies/localStorage) ---------------- */
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function getIdentity() {
  // 1) cookies
  let email = getCookie("email") || null;
  let name = getCookie("name") || null;

  // 2) localStorage keys & JSON
  try {
    if (!email) email = localStorage.getItem("email") || localStorage.getItem("user.email") || null;
    if (!name)  name  = localStorage.getItem("name")  || localStorage.getItem("user.name")  || null;

    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && (u?.name || u?.displayName)) name = String(u.name || u.displayName);
      } catch {}
    }
    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName)) name = String(x.name || x.displayName);
      } catch {}
    }
  } catch {}

  // 3) fallback: dérive un nom depuis l’email
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) {
      name = base.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    }
  }

  email = email ? String(email).trim() : null;
  name  = name  ? String(name).trim()  : null;
  return { email, name };
}
function identityHeaders(h = new Headers()) {
  const { email, name } = getIdentity();
  if (email && !h.has("X-User-Email")) h.set("X-User-Email", email);
  if (name  && !h.has("X-User-Name"))  h.set("X-User-Name",  name);
  return h;
}

/** Get current site from client-side stored profile (fallback to "Default") */
function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "Default";
  } catch {
    return "Default";
  }
}

/** Small helper: add cache-busting `v=timestamp` param to a URL */
function withBust(url, enabled = true) {
  if (!enabled) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

/** UUID checker (pour choisir la bonne route PDF des plans) */
function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

/** Fetch JSON with automatic X-Site + Identity headers */
async function jsonFetch(url, options = {}) {
  const site = currentSite();
  const finalUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const headers = identityHeaders(new Headers(options.headers || {})); // <-- inject identity
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
    const msg = text || `HTTP ${res.status}${res.statusText ? " " + res.statusText : ""}`;
    throw new Error(msg);
  }

  const ct = res.headers.get("content-type") || "";
  if (res.status === 204) return null;
  return ct.includes("application/json") ? res.json() : null;
}

/** 🔹 Utilitaire bas niveau pour appels JSON "bruts" (multipart S3, etc.) */
export async function apiBaseFetchJSON(path, options = {}) {
  const finalUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = identityHeaders(new Headers(options.headers || {}));
  // 🔧 ajouter le site comme dans jsonFetch()
  const site = currentSite();
  headers.set("X-Site", site);

  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(finalUrl, { credentials: "include", ...options, headers });
  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof payload === "string" ? payload : (payload?.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return payload;
}

/** (Optionnel) Fetch binaire (blob) — pratique pour tester un PDF inline si besoin */
export async function getBlob(path) {
  const site = currentSite();
  const finalUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = identityHeaders(new Headers());
  headers.set("X-Site", site);
  const res = await fetch(finalUrl, { credentials: "include", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
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
  const headers = identityHeaders(new Headers({ "X-Site": site })); // <-- inject identity pour multipart
  const res = await fetch(url, { method: "POST", body: formData, credentials: "include", headers });
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
    list: (params) => get("/api/projects/projects", params),
    create: (payload) => post("/api/projects/projects", payload),
    update: (id, payload) => put(`/api/projects/projects/${id}`, payload),
    remove: (id) => del(`/api/projects/projects/${id}`),

    status: (id) => get(`/api/projects/projects/${id}/status`),
    setStatus: (id, payload) => put(`/api/projects/projects/${id}/status`, payload),

    upload: (id, category, formData) =>
      upload(`/api/projects/projects/${id}/upload?category=${encodeURIComponent(category)}`, formData),
    listFiles: (id, category) => get(`/api/projects/projects/${id}/files`, { category }),
    downloadFile: (file_id) => get(`/api/projects/download`, { file_id }),

    addOffer: (id, payload) => post(`/api/projects/projects/${id}/offer`, payload),
    addOrder: (id, payload) => post(`/api/projects/projects/${id}/order`, payload),
    addInvoice: (id, payload) => post(`/api/projects/projects/${id}/invoice`, payload),
    lines: (id) => get(`/api/projects/projects/${id}/lines`),

    analysis: (id) => get(`/api/projects/projects/${id}/analysis`),
    assistant: (id, question) => post(`/api/projects/projects/${id}/assistant`, { question }),
    health: () => get(`/api/projects/health`),
  },

  /** --- CONTROLS (MIS À NIVEAU) --- */
  controls: {
    hierarchyTree: (params) => get("/api/controls/hierarchy/tree", { ...(params || {}) }),
    hierarchyDebug: () => get("/api/controls/hierarchy/debug"),
    tsdMeta: () => get("/api/controls/tsd"),

    autoLink: ({ create = 1, seed = 1 } = {}) =>
      get("/api/controls/bootstrap/auto-link", { create, seed }),

    listTasks: (params) => get("/api/controls/tasks", { ...(params || {}) }),
    tasksByEntity: (entity_id, q = "") => get("/api/controls/tasks", { entity_id, q }),
    taskSchema: (id) => get(`/api/controls/tasks/${id}/schema`),
    closeTask: (id, payload) => put(`/api/controls/tasks/${id}/close`, payload),

    attachToTask: (taskId, file) => {
      const fd = new FormData();
      fd.append("file", file);
      return upload(`/api/controls/tasks/${taskId}/attachments`, fd);
    },

    health: () => get(`/api/controls/health`),

    // alias rétro-compat
    tree: (params) => get("/api/controls/hierarchy/tree", { ...(params || {}) }),
    catalog: (params) => get("/api/controls/tsd", { ...(params || {}) }),
    sync: ({ create = 1, seed = 1 } = {}) =>
      get("/api/controls/bootstrap/auto-link", { create, seed }),
    taskDetails: (id) => get(`/api/controls/tasks/${id}/schema`),
    completeTask: (id, payload) => put(`/api/controls/tasks/${id}/close`, payload),
    uploadAttachments: (taskId, files, label) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("file", f));
      if (label) fd.append("label", label);
      return upload(`/api/controls/tasks/${taskId}/attachments`, fd);
    },
    analyze: (taskId) => post(`/api/controls/tasks/${taskId}/analyze`, {}),
    assistant: (taskId, question) => post(`/api/controls/tasks/${taskId}/assistant`, { question }),
    history: (params) => get("/api/controls/history", params),
    records: (params) => get("/api/controls/records", params),
  },

  /** --- COMP-EXT (Prestataires externes) — NOUVEAU --- */
  compExt: {
    list: (params) => get("/api/comp-ext/vendors", params),
    create: (payload) => post("/api/comp-ext/vendors", payload),
    update: (id, payload) => put(`/api/comp-ext/vendors/${id}`, payload),
    remove: (id) => del(`/api/comp-ext/vendors/${id}`),

    calendar: () => get("/api/comp-ext/calendar"),
    stats: () => get("/api/comp-ext/stats"),
  },

  /** --- ASK VEEVA (upload + search/ask + nouveaux endpoints) --- */
  askVeeva: {
    // Santé / jobs
    health: () => get("/api/ask-veeva/health"),
    job: (id) => get(`/api/ask-veeva/jobs/${id}`),

    // Profil & personnalisation
    me: () => get("/api/ask-veeva/me"),
    initUser: (payload) => post("/api/ask-veeva/initUser", payload), // {name, role, sector, (opt) email}
    personalize: () => post("/api/ask-veeva/personalize", {}),

    // Journalisation & feedback
    logEvent: (payload) => post("/api/ask-veeva/logEvent", payload),
    feedback: (payload) => post("/api/ask-veeva/feedback", payload),

    // Synonymes
    updateSynonyms: (payload) => post("/api/ask-veeva/synonyms/update", payload),

    // Recherche / suggestion de documents
    search: (payload) => post("/api/ask-veeva/search", payload),
    findDocs: (q) => get("/api/ask-veeva/find-docs", { q }),

    // Q/R
    ask: (payload) => post("/api/ask-veeva/ask", payload),

    // Pysearch bridge
    pysearch: {
      health: () => get("/api/ask-veeva/pysearch/health"),
      compare: (payload) => post("/api/ask-veeva/pysearch/compare", payload),
      reindex: (payload = {}) => post("/api/ask-veeva/pysearch/reindex", payload),
    },

    // Upload simple (ZIP ou fichier)
    uploadZip: (file) => {
      const fd = new FormData();
      fd.append("zip", file);
      return upload("/api/ask-veeva/uploadZip", fd);
    },
    uploadFile: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return upload("/api/ask-veeva/uploadFile", fd);
    },

    // Upload chunké (ZIP splitté côté client)
    chunked: {
      init: ({ filename, size }) => post("/api/ask-veeva/chunked/init", { filename, size }),
      part: (uploadId, partNumber, blob) => {
        const fd = new FormData();
        fd.append("chunk", blob);
        // NB: query params pour partNumber
        return upload(`/api/ask-veeva/chunked/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${encodeURIComponent(partNumber)}`, fd);
      },
      complete: ({ uploadId, totalParts, originalName }) =>
        post("/api/ask-veeva/chunked/complete", { uploadId, totalParts, originalName }),
      abort: ({ uploadId, upto }) =>
        post("/api/ask-veeva/chunked/abort", { uploadId, upto }),
    },

    // Fichiers / preview
    fileMeta: (id) => get(`/api/ask-veeva/filemeta/${id}`),
    fileUrl: (id, { bust = false } = {}) => withBust(`${API_BASE}/api/ask-veeva/file/${encodeURIComponent(id)}`, bust),
    previewUrl: (id, { bust = false } = {}) => withBust(`${API_BASE}/api/ask-veeva/preview/${encodeURIComponent(id)}`, bust),
  },

  /** --- DOORS (Portes coupe-feu) — MIS À JOUR POUR server_doors.js --- */
  doors: {
    // CRUD portes
    list: (params) => get("/api/doors/doors", params),
    get:   (id) => get(`/api/doors/doors/${encodeURIComponent(id)}`),
    create: (payload) => post("/api/doors/doors", payload),
    update: (id, payload) => put(`/api/doors/doors/${encodeURIComponent(id)}`, payload),
    remove: (id) => del(`/api/doors/doors/${encodeURIComponent(id)}`),

    // Photo vignette (upload + URL) — ajoute identité aussi dans le FormData (fallback backend)
    uploadPhoto: (id, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("photo", file);
      if (email) fd.append("user_email", email);
      if (name)  fd.append("user_name",  name);
      return upload(`/api/doors/doors/${encodeURIComponent(id)}/photo`, fd);
    },
    photoUrl: (id, { bust = false } = {}) =>
      withBust(`${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/photo`, bust),

    // Fichiers attachés à la porte — ajoute identité également (aligné Doors.jsx)
    listFiles: (id) => get(`/api/doors/doors/${encodeURIComponent(id)}/files`),
    uploadFile: (id, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("file", file);
      if (email) fd.append("user_email", email);
      if (name)  fd.append("user_name",  name);
      return upload(`/api/doors/doors/${encodeURIComponent(id)}/files`, fd);
    },
    deleteFile: (fileId) => del(`/api/doors/files/${encodeURIComponent(fileId)}`),

    // Checklists (workflow) — injecte _user (JSON) et user_email/name (multipart)
    startCheck: (doorId) => post(`/api/doors/doors/${encodeURIComponent(doorId)}/checks`, { _user: getIdentity() }),
    saveCheck: (doorId, checkId, payload = {}) => {
      if (payload?.files?.length) {
        const { email, name } = getIdentity();
        const fd = new FormData();
        if (payload.items) fd.append("items", JSON.stringify(payload.items));
        if (payload.close) fd.append("close", "true");
        if (email) fd.append("user_email", email);
        if (name)  fd.append("user_name",  name);
        (payload.files || []).forEach((f) => fd.append("files", f));
        return put(`/api/doors/doors/${encodeURIComponent(doorId)}/checks/${encodeURIComponent(checkId)}`, fd);
      }
      return put(`/api/doors/doors/${encodeURIComponent(doorId)}/checks/${encodeURIComponent(checkId)}`, {
        ...payload,
        _user: getIdentity(),
      });
    },
    listHistory: (doorId) => get(`/api/doors/doors/${encodeURIComponent(doorId)}/history`),

    // QR / PDF
    qrUrl: (id, size = 256, { bust = false } = {}) =>
      withBust(`${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/qrcode?size=${encodeURIComponent(size)}`, bust),
    qrcodesUrl: (id, sizes = "80,120,200", force = false, { bust = false } = {}) =>
      withBust(`${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/qrcodes.pdf?sizes=${encodeURIComponent(sizes)}${force ? "&force=1" : ""}`, bust),
    nonConformPDF: (id, { bust = false } = {}) =>
      withBust(`${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/nonconformities.pdf`, bust),
    nonConformitiesPdfUrl: (id, { bust = false } = {}) =>
      withBust(`${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/nonconformities.pdf`, bust),

    // Calendrier / settings / alertes
    calendar: () => get(`/api/doors/calendar`),
    settingsGet: () => get(`/api/doors/settings`),
    settingsSet: (payload) => put(`/api/doors/settings`, payload),
    alerts: () => get(`/api/doors/alerts`),
  },

  /** --- DOORS MAPS (Plans PDF + positions) — logical_name & UUID --- */
  doorsMaps: {
    uploadZip: (file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("zip", file);
      // (pas requis par le backend, mais on aligne avec le reste)
      if (email) fd.append("user_email", email);
      if (name)  fd.append("user_name",  name);
      return upload(`/api/doors/maps/uploadZip`, fd);
    },

    listPlans: () => get(`/api/doors/maps/plans`),

    renamePlan: (logical_name, display_name) =>
      put(`/api/doors/maps/plan/${encodeURIComponent(logical_name)}/rename`, { display_name }),

    /** Flux PDF (backend: /plan/:logical/file) */
    planFileUrl: (logical_name, { bust = true } = {}) =>
      withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(logical_name)}/file`, bust),

    /** 🔁 MAJ: par ID/UUID -> nouvelle route native */
    planFileUrlById: (id, { bust = true } = {}) =>
      withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(id)}/file`, bust),

    /** Compat (ancienne route) au cas où */
    planFileUrlCompatById: (id, { bust = true } = {}) =>
      withBust(`${API_BASE}/api/doors/maps/plan-id/${encodeURIComponent(id)}/file`, bust),

    /**
     * Helper AUTO: accepte soit un objet plan {id, logical_name},
     * soit une simple string (UUID ou logical_name).
     */
    planFileUrlAuto: (plan, { bust = true } = {}) => {
      if (typeof plan === "string") {
        return isUuid(plan)
          ? withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(plan)}/file`, bust)
          : withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(plan)}/file`, bust);
      }
      if (plan && isUuid(plan.id)) {
        return withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(plan.id)}/file`, bust);
      }
      const logical = plan?.logical_name || "";
      return withBust(`${API_BASE}/api/doors/maps/plan/${encodeURIComponent(logical)}/file`, bust);
    },

    /** Positions — lecture/écriture */
    positions: (logical_name, page_index = 0) =>
      get(`/api/doors/maps/positions`, { logical_name, page_index }),

    // 🆕 Lecture par UUID
    positionsById: (id, page_index = 0) =>
      get(`/api/doors/maps/positions`, { id, page_index }),

    // 🆕 Auto: détecte logical_name ou UUID
    positionsAuto: (planOrKey, page_index = 0) => {
      const key =
        typeof planOrKey === "string"
          ? planOrKey
          : planOrKey?.id || planOrKey?.logical_name || "";
      if (isUuid(key)) return get(`/api/doors/maps/positions`, { id: key, page_index });
      return get(`/api/doors/maps/positions`, { logical_name: key, page_index });
    },

    // 🆕 Portes non positionnées
    pendingPositions: (logical_name, page_index = 0) =>
      get(`/api/doors/maps/pending-positions`, { logical_name, page_index }),

    setPosition: (doorId, payload) =>
      put(`/api/doors/maps/positions/${encodeURIComponent(doorId)}`, payload),
  },
};
