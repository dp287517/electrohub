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

  /** --- CONTROLS (NOUVEAU) --- */
  controls: {
    // Catalogue / Arborescence
    tree: (params) => get("/api/controls/tree", { site: currentSite(), ...(params || {}) }),
    catalog: (params) => get("/api/controls/catalog", { site: currentSite(), ...(params || {}) }),

    // Sync: lit toutes les sources (read_site=*) et insère sous le site courant
    sync: ({ site = currentSite(), source = "db" } = {}) =>
      post(`/api/controls/sync?source=${encodeURIComponent(source)}&read_site=*`, { site }),

    // Tasks
    listTasks: (params) => get("/api/controls/tasks", { site: currentSite(), ...(params || {}) }),
    tasksByEntity: (entity_id, q = "") =>
      get("/api/controls/tasks", { site: currentSite(), entity_id, q }),

    taskDetails: (id) => get(`/api/controls/tasks/${id}/details`),
    completeTask: (id, payload) => post(`/api/controls/tasks/${id}/complete`, payload),

    // Pièces jointes
    listAttachments: (taskId) => get(`/api/controls/tasks/${taskId}/attachments`),
    uploadAttachments: (taskId, files, label) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("files", f));
      if (label) fd.append("label", label);
      return upload(`/api/controls/tasks/${taskId}/upload`, fd);
    },

    // IA
    analyze: (taskId) => post(`/api/controls/tasks/${taskId}/analyze`, {}),
    assistant: (taskId, question) => post(`/api/controls/tasks/${taskId}/assistant`, { question }),

    // Logs
    history: (params) => get("/api/controls/history", { site: currentSite(), ...(params || {}) }),
    records: (params) => get("/api/controls/records", { site: currentSite(), ...(params || {}) }),

    // Health
    health: () => get(`/api/controls/health`),
  },
};
