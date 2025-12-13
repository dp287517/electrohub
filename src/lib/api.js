/** src/lib/api.js - API complète ElectroHub */
/** VERSION 3.0 - AVEC RETRY ROBUSTE ET EXPONENTIAL BACKOFF */

/** Base API */
export const API_BASE = import.meta.env.VITE_API_BASE || "";

// ============================================================
// RETRY CONFIG - Exponential backoff pour requêtes qui échouent
// ============================================================
const RETRY_CONFIG = {
  maxRetries: 2,              // Nombre max de retries
  baseDelayMs: 1000,          // Délai initial (1s)
  maxDelayMs: 8000,           // Délai max (8s)
  retryableStatuses: [408, 429, 500, 502, 503, 504], // Status HTTP à retrier
};

/**
 * Calcule le délai avec exponential backoff + jitter
 */
function getRetryDelay(attempt) {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
    RETRY_CONFIG.maxDelayMs
  );
  // Ajoute un jitter de ±25% pour éviter les thundering herds
  return delay * (0.75 + Math.random() * 0.5);
}

/**
 * Vérifie si une erreur/status est retryable
 */
function isRetryable(error, status) {
  // Timeout côté client
  if (error?.name === 'AbortError' || error?.isTimeout) return true;

  // Erreurs réseau
  if (error?.message?.includes('Failed to fetch')) return true;
  if (error?.message?.includes('NetworkError')) return true;
  if (error?.message?.includes('ECONNRESET')) return true;

  // Status HTTP retryables
  if (status && RETRY_CONFIG.retryableStatuses.includes(status)) return true;

  return false;
}

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
    if (!email)
      email =
        localStorage.getItem("email") ||
        localStorage.getItem("user.email") ||
        null;
    if (!name)
      name =
        localStorage.getItem("name") ||
        localStorage.getItem("user.name") ||
        null;

    if ((!email || !name) && localStorage.getItem("user")) {
      try {
        const u = JSON.parse(localStorage.getItem("user"));
        if (!email && u?.email) email = String(u.email);
        if (!name && (u?.name || u?.displayName))
          name = String(u.name || u.displayName);
      } catch {}
    }

    if ((!email || !name) && localStorage.getItem("eh_user")) {
      try {
        const eu = JSON.parse(localStorage.getItem("eh_user"));
        const x = eu?.user || eu?.profile || eu;
        if (!email && x?.email) email = String(x.email);
        if (!name && (x?.name || x?.displayName))
          name = String(x.name || x.displayName);
      } catch {}
    }
  } catch {}

  // 3) fallback: dérive un nom depuis l'email
  if (!name && email) {
    const base = String(email).split("@")[0] || "";
    if (base) {
      name = base
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    }
  }

  email = email ? String(email).trim() : null;
  name = name ? String(name).trim() : null;
  return { email, name };
}

function identityHeaders(h = new Headers()) {
  const { email, name } = getIdentity();
  if (email && !h.has("X-User-Email")) h.set("X-User-Email", email);
  if (name && !h.has("X-User-Name")) h.set("X-User-Name", name);
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

/** UUID checker */
function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

/** Numeric ID checker */
function isNumericId(s) {
  return (
    (typeof s === "string" && /^\d+$/.test(s)) ||
    (typeof s === "number" && Number.isInteger(s))
  );
}

// ============================================================
// HELPER PRINCIPAL - VERSION 3.0 AVEC RETRY ET TIMEOUT
// ============================================================
async function jsonFetch(path, options = {}) {
  const site = currentSite();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  // En‑têtes avec identité + site
  const headers = identityHeaders(new Headers(options.headers || {}));
  headers.set("X-Site", site);

  // JSON par défaut si on envoie un body (sauf FormData)
  const hasBody = options.body !== undefined && options.body !== null;
  if (!headers.has("Content-Type") && hasBody && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  // Configuration
  const timeoutMs = options.timeout || 30000;
  const maxRetries = options.noRetry ? 0 : (options.retries ?? RETRY_CONFIG.maxRetries);

  let lastError;

  // ✅ BOUCLE DE RETRY avec exponential backoff
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions = {
      credentials: "include",
      ...options,
      headers,
      signal: controller.signal,
    };

    let res;
    try {
      res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const contentType = res.headers.get("Content-Type") || "";
      let data;

      // Gestion blob (PDF, images, etc.)
      if (options.isBlob || contentType.startsWith("image/") || contentType === "application/pdf") {
        data = await res.blob();
      } else if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      // Erreur HTTP → vérifier si retryable
      if (!res.ok) {
        const message = (data && data.error) || (data && data.message) || `HTTP ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        error.data = data;

        // ✅ Retry si status retryable et tentatives restantes
        if (attempt < maxRetries && isRetryable(null, res.status)) {
          const delay = getRetryDelay(attempt);
          console.warn(`[API] Retry ${attempt + 1}/${maxRetries} for ${path} (status ${res.status}) in ${Math.round(delay)}ms`);
          await new Promise(r => setTimeout(r, delay));
          lastError = error;
          continue;
        }

        throw error;
      }

      // ✅ Succès
      return data;

    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      // Créer une erreur timeout si c'est un AbortError
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`Timeout après ${timeoutMs/1000}s - Réessayez`);
        timeoutError.status = 408;
        timeoutError.isTimeout = true;
        lastError = timeoutError;
      }

      // ✅ Retry si erreur retryable et tentatives restantes
      if (attempt < maxRetries && isRetryable(err, err?.status)) {
        const delay = getRetryDelay(attempt);
        console.warn(`[API] Retry ${attempt + 1}/${maxRetries} for ${path} (${err.message}) in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw lastError;
    }
  }

  // Si on arrive ici, toutes les tentatives ont échoué
  throw lastError;
}

/** Utilitaire bas niveau pour appels JSON "bruts" */
export async function apiBaseFetchJSON(path, options = {}) {
  const finalUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = identityHeaders(new Headers(options.headers || {}));
  const site = currentSite();
  headers.set("X-Site", site);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(finalUrl, {
    credentials: "include",
    ...options,
    headers,
  });
  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const msg =
      typeof payload === "string"
        ? payload
        : payload?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload;
}

/** (Optionnel) Fetch binaire (blob) */
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
    ? `?${new URLSearchParams(
        Object.entries(params).filter(
          ([, v]) => v !== undefined && v !== null
        )
      )}`
    : "";
  return jsonFetch(`${path}${qs}`, { method: "GET" });
}

export async function post(path, body) {
  return jsonFetch(path, {
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
}

export async function put(path, body) {
  return jsonFetch(path, {
    method: "PUT",
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
}

export async function del(path) {
  return jsonFetch(path, { method: "DELETE" });
}

export async function upload(path, formData /* FormData */) {
  const site = currentSite();
  const url = `${API_BASE}${path}`;
  const headers = identityHeaders(new Headers({ "X-Site": site }));
  
  // ✅ Timeout pour uploads (60s pour les gros fichiers)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Upload timeout (60s) - Fichier trop volumineux ?');
    }
    throw err;
  }
  clearTimeout(timeoutId);
  
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : null;
}

/** Namespaced API */
export const api = {
  // Expose baseURL and site for components that need direct URLs
  get baseURL() { return API_BASE; },
  get site() { return currentSite(); },

  /** --- AUTH / PROFILE --- */
  auth: {
    me: () => get("/api/auth/me"),
    login: (payload) => post("/api/auth/login", payload),
    logout: () => post("/api/auth/logout", {}),
  },

  /** --- OIBT --- */
  oibt: {
    listProjects: (params) => get("/api/oibt/projects", params),
    getProject: (id) => get(`/api/oibt/projects/${id}`),
    createProject: (payload) => post("/api/oibt/projects", payload),
    updateProject: (id, payload) => put(`/api/oibt/projects/${id}`, payload),
    removeProject: (id) => del(`/api/oibt/projects/${id}`),

    uploadProjectActionFile: (id, action, formData) =>
      upload(
        `/api/oibt/projects/${id}/upload?action=${encodeURIComponent(action)}`,
        formData
      ),

    listPeriodics: (params) => get("/api/oibt/periodics", params),
    createPeriodic: (payload) => post("/api/oibt/periodics", payload),
    updatePeriodic: (id, payload) => put(`/api/oibt/periodics/${id}`, payload),
    removePeriodic: (id) => del(`/api/oibt/periodics/${id}`),

    uploadPeriodicFile: (id, type, formData) =>
      upload(
        `/api/oibt/periodics/${id}/upload?type=${encodeURIComponent(type)}`,
        formData
      ),

    listUpcoming: (params) => get("/api/oibt/periodics/upcoming", params),
    listBuildings: (params) => get("/api/oibt/periodics/buildings", params),
  },

  /** --- PROJECTS --- */
  projects: {
    list: (params) => get("/api/projects/projects", params),
    create: (payload) => post("/api/projects/projects", payload),
    update: (id, payload) => put(`/api/projects/projects/${id}`, payload),
    remove: (id) => del(`/api/projects/projects/${id}`),
    status: (id) => get(`/api/projects/projects/${id}/status`),
    setStatus: (id, payload) =>
      put(`/api/projects/projects/${id}/status`, payload),
    upload: (id, category, formData) =>
      upload(
        `/api/projects/projects/${id}/upload?category=${encodeURIComponent(
          category
        )}`,
        formData
      ),
    listFiles: (id, category) =>
      get(`/api/projects/projects/${id}/files`, { category }),
    downloadFile: (file_id) => get(`/api/projects/download`, { file_id }),
    lines: (id) => get(`/api/projects/projects/${id}/lines`),
    analysis: (id) => get(`/api/projects/projects/${id}/analysis`),
    assistant: (id, question) =>
      post(`/api/projects/projects/${id}/assistant`, { question }),
    health: () => get(`/api/projects/health`),
  },

  /** --- SWITCHBOARD CONTROLS v1.0 --- */
  switchboardControls: {
    // Dashboard
    dashboard: () => get("/api/switchboard/controls/dashboard"),
    status: (params) => get("/api/switchboard/controls/status", params),

    // Templates
    listTemplates: (params) => get("/api/switchboard/controls/templates", params),
    createTemplate: (data) => post("/api/switchboard/controls/templates", data),
    updateTemplate: (id, data) => put(`/api/switchboard/controls/templates/${id}`, data),
    deleteTemplate: (id) => del(`/api/switchboard/controls/templates/${id}`),

    // Schedules
    listSchedules: (params) => get("/api/switchboard/controls/schedules", params),
    createSchedule: (data) => post("/api/switchboard/controls/schedules", data),
    deleteSchedule: (id) => del(`/api/switchboard/controls/schedules/${id}`),

    // Records
    listRecords: (params) => get("/api/switchboard/controls/records", params),
    getRecord: (id) => get(`/api/switchboard/controls/records/${id}`),
    createRecord: (data) => post("/api/switchboard/controls/records", data),
    recordPdfUrl: (id) => `${API_BASE}/api/switchboard/controls/records/${id}/pdf?site=${currentSite()}`,

    // Attachments
    uploadAttachment: (recordId, file, extra = {}) => {
      const fd = new FormData();
      fd.append("file", file);
      if (extra.checklist_item_id) fd.append("checklist_item_id", extra.checklist_item_id);
      if (extra.caption) fd.append("caption", extra.caption);
      if (extra.file_type) fd.append("file_type", extra.file_type);
      return upload(`/api/switchboard/controls/records/${recordId}/attachments`, fd);
    },
    attachmentUrl: (id, thumbnail = false) =>
      `${API_BASE}/api/switchboard/controls/attachments/${id}/file?site=${currentSite()}${thumbnail ? "&thumbnail=true" : ""}`,
  },

  switchboardMaps: {
  listPlans: () => get("/api/switchboard/maps/listPlans"),
  planFileUrlAuto: (plan, { bust = true } = {}) => {
    const key = typeof plan === "string" ? plan : plan?.id || plan?.logical_name || "";
    const useId = isUuid(key) || isNumericId(key);
    const url = useId
      ? `${API_BASE}/api/switchboard/maps/planFile?id=${encodeURIComponent(key)}`
      : `${API_BASE}/api/switchboard/maps/planFile?logical_name=${encodeURIComponent(
          typeof plan === "string" ? plan : plan?.logical_name || ""
        )}`;
    return withBust(url, bust);
  },
  positionsAuto: (planOrKey, page_index = 0) => {
    const key = typeof planOrKey === "string"
      ? planOrKey
      : planOrKey?.id || planOrKey?.logical_name || "";
    if (isUuid(key) || isNumericId(key)) {
      return get("/api/switchboard/maps/positions", { id: key, page_index });
    }
    return get("/api/switchboard/maps/positions", { logical_name: key, page_index });
  },
  setPosition: (payload) => post("/api/switchboard/maps/setPosition", payload),
    placedIds: async () => {
    try {
      return await get("/api/switchboard-map/placed-ids");
    } catch (e) {
      // Compat: anciens backends exposent uniquement /api/switchboard/maps/placed
      return get("/api/switchboard/maps/placed");
    }
  },
},

  /** --- COMP-EXT --- */
  compExt: {
    list: (params) => get("/api/comp-ext/vendors", params),
    create: (payload) => post("/api/comp-ext/vendors", payload),
    update: (id, payload) =>
      put(`/api/comp-ext/vendors/${id}`, payload),
    remove: (id) => del(`/api/comp-ext/vendors/${id}`),
    calendar: () => get("/api/comp-ext/calendar"),
    stats: () => get("/api/comp-ext/stats"),
  },

  /** --- ASK VEEVA --- */
  askVeeva: {
    health: () => get("/api/ask-veeva/health"),
    job: (id) => get(`/api/ask-veeva/jobs/${id}`),
    me: () => get("/api/ask-veeva/me"),
    initUser: (payload) => post("/api/ask-veeva/initUser", payload),
    personalize: () => post("/api/ask-veeva/personalize", {}),
    logEvent: (payload) => post("/api/ask-veeva/logEvent", payload),
    feedback: (payload) => post("/api/ask-veeva/feedback", payload),
    updateSynonyms: (payload) =>
      post("/api/ask-veeva/synonyms/update", payload),
    search: (payload) => post("/api/ask-veeva/search", payload),
    findDocs: (q) => get("/api/ask-veeva/find-docs", { q }),
    ask: (payload) => post("/api/ask-veeva/ask", payload),
    pysearch: {
      health: () => get("/api/ask-veeva/pysearch/health"),
      compare: (payload) =>
        post("/api/ask-veeva/pysearch/compare", payload),
      reindex: (payload = {}) =>
        post("/api/ask-veeva/pysearch/reindex", payload),
    },
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
    chunked: {
      init: ({ filename, size }) =>
        post("/api/ask-veeva/chunked/init", { filename, size }),
      part: (uploadId, partNumber, blob) => {
        const fd = new FormData();
        fd.append("chunk", blob);
        return upload(
          `/api/ask-veeva/chunked/part?uploadId=${encodeURIComponent(
            uploadId
          )}&partNumber=${encodeURIComponent(partNumber)}`,
          fd
        );
      },
      complete: ({ uploadId, totalParts, originalName }) =>
        post("/api/ask-veeva/chunked/complete", {
          uploadId,
          totalParts,
          originalName,
        }),
      abort: ({ uploadId, upto }) =>
        post("/api/ask-veeva/chunked/abort", { uploadId, upto }),
    },
    fileMeta: (id) => get(`/api/ask-veeva/filemeta/${id}`),
    fileUrl: (id, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/ask-veeva/file/${encodeURIComponent(id)}`,
        bust
      ),
    previewUrl: (id, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/ask-veeva/preview/${encodeURIComponent(id)}`,
        bust
      ),
  },

  /** --- DOORS --- */
  doors: {
    list: (params) => get("/api/doors/doors", params),
    get: (id) =>
      get(`/api/doors/doors/${encodeURIComponent(id)}`),
    create: (payload) => post("/api/doors/doors", payload),
    update: (id, payload) =>
      put(`/api/doors/doors/${encodeURIComponent(id)}`, payload),
    remove: (id) =>
      del(`/api/doors/doors/${encodeURIComponent(id)}`),

    uploadPhoto: (id, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("photo", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/doors/doors/${encodeURIComponent(id)}/photo`,
        fd
      );
    },

    photoUrl: (id, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/doors/doors/${encodeURIComponent(id)}/photo`,
        bust
      ),

    listFiles: (id) =>
      get(`/api/doors/doors/${encodeURIComponent(id)}/files`),

    uploadFile: (id, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("file", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/doors/doors/${encodeURIComponent(id)}/files`,
        fd
      );
    },

    deleteFile: (fileId) =>
      del(`/api/doors/files/${encodeURIComponent(fileId)}`),

    startCheck: (doorId) =>
      post(
        `/api/doors/doors/${encodeURIComponent(doorId)}/checks`,
        { _user: getIdentity() }
      ),

    saveCheck: (doorId, checkId, payload = {}) => {
      if (payload?.files?.length) {
        const { email, name } = getIdentity();
        const fd = new FormData();
        if (payload.items)
          fd.append("items", JSON.stringify(payload.items));
        if (payload.close) fd.append("close", "true");
        if (email) fd.append("user_email", email);
        if (name) fd.append("user_name", name);
        (payload.files || []).forEach((f) =>
          fd.append("files", f)
        );
        return put(
          `/api/doors/doors/${encodeURIComponent(
            doorId
          )}/checks/${encodeURIComponent(checkId)}`,
          fd
        );
      }
      return put(
        `/api/doors/doors/${encodeURIComponent(
          doorId
        )}/checks/${encodeURIComponent(checkId)}`,
        {
          ...payload,
          _user: getIdentity(),
        }
      );
    },

    listHistory: (doorId) =>
      get(`/api/doors/doors/${encodeURIComponent(doorId)}/history`),

    qrUrl: (id, size = 256, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/doors/doors/${encodeURIComponent(
          id
        )}/qrcode?size=${encodeURIComponent(size)}`,
        bust
      ),

    qrcodesUrl: (id, sizes = "80,120,200", force = false, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/doors/doors/${encodeURIComponent(
          id
        )}/qrcodes?sizes=${encodeURIComponent(
          sizes
        )}${force ? "&force=1" : ""}`,
        bust
      ),

    nonConformPDF: (id, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/doors/doors/${encodeURIComponent(
          id
        )}/nonconformities.pdf`,
        bust
      ),
    nonConformitiesPdfUrl: (id, { bust = false } = {}) =>
      withBust(
        `${API_BASE}/api/doors/doors/${encodeURIComponent(
          id
        )}/nonconformities.pdf`,
        bust
      ),

    calendar: () => get(`/api/doors/calendar`),
    settingsGet: () => get(`/api/doors/settings`),
    settingsSet: (payload) => put(`/api/doors/settings`, payload),
    alerts: () => get(`/api/doors/alerts`),
  },

  /** --- DOORS MAPS --- */
  doorsMaps: {
    uploadZip: (file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("zip", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(`/api/doors/maps/uploadZip`, fd);
    },
    listPlans: () => get(`/api/doors/maps/plans`),
    renamePlan: (logical_name, display_name) =>
      put(
        `/api/doors/maps/plan/${encodeURIComponent(
          logical_name
        )}/rename`,
        { display_name }
      ),
    planFileUrl: (logical_name, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
          logical_name
        )}/file`,
        bust
      ),
    planFileUrlById: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
          id
        )}/file`,
        bust
      ),
    planFileUrlCompatById: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/doors/maps/plan-id/${encodeURIComponent(
          id
        )}/file`,
        bust
      ),
    planFileUrlAuto: (plan, { bust = true } = {}) => {
      if (typeof plan === "string") {
        if (isUuid(plan) || isNumericId(plan)) {
          return withBust(
            `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
              plan
            )}/file`,
            bust
          );
        }
        return withBust(
          `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
            plan
          )}/file`,
          bust
        );
      }
      if (plan && (isUuid(plan.id) || isNumericId(plan.id))) {
        return withBust(
          `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
            plan.id
          )}/file`,
          bust
        );
      }
      const logical = plan?.logical_name || "";
      return withBust(
        `${API_BASE}/api/doors/maps/plan/${encodeURIComponent(
          logical
        )}/file`,
        bust
      );
    },
    positions: (logical_name, page_index = 0) =>
      get(`/api/doors/maps/positions`, { logical_name, page_index }),
    positionsById: (id, page_index = 0) =>
      get(`/api/doors/maps/positions`, { id, page_index }),
    positionsAuto: (planOrKey, page_index = 0) => {
      const key =
        typeof planOrKey === "string"
          ? planOrKey
          : planOrKey?.id || planOrKey?.logical_name || "";
      if (isUuid(key) || isNumericId(key))
        return get(`/api/doors/maps/positions`, { id: key, page_index });
      return get(`/api/doors/maps/positions`, {
        logical_name: key,
        page_index,
      });
    },
    pendingPositions: (logical_name, page_index = 0) =>
      get(`/api/doors/maps/pending-positions`, {
        logical_name,
        page_index,
      }),
    setPosition: (doorId, payload) =>
      put(
        `/api/doors/maps/positions/${encodeURIComponent(doorId)}`,
        payload
      ),
  },

  /** --- ATEX --- */
  atex: {
    listEquipments: (params) => get(`/api/atex/equipments`, params),
    getEquipment: (id) =>
      get(`/api/atex/equipments/${encodeURIComponent(id)}`),
    createEquipment: (payload) =>
      post(`/api/atex/equipments`, payload),
    updateEquipment: (id, payload) =>
      put(`/api/atex/equipments/${encodeURIComponent(id)}`, payload),
    removeEquipment: (id) =>
      del(`/api/atex/equipments/${encodeURIComponent(id)}`),

    // 🚀 Support thumbnail pour optimisation mobile (thumb=1 -> image réduite)
    photoUrl: (equipmentId, { bust = true, thumb = false } = {}) =>
      withBust(
        `${API_BASE}/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/photo${thumb ? '?thumb=1' : ''}`,
        bust
      ),

    uploadPhoto: (equipmentId, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("photo", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/photo`,
        fd
      );
    },

    listFiles: (equipmentId) =>
      get(`/api/atex/equipments/${encodeURIComponent(equipmentId)}/files`),

    uploadFiles: (equipmentId, files = []) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("files", f));
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/files`,
        fd
      );
    },

    uploadAttachments: (equipmentId, files = [], label) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      (Array.isArray(files) ? files : [files]).forEach((f) =>
        fd.append("files", f)
      );
      if (label) fd.append("label", label);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/files`,
        fd
      );
    },

    deleteFile: (fileId) =>
      del(`/api/atex/files/${encodeURIComponent(fileId)}`),

    startCheck: (equipmentId) =>
      post(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/checks`,
        { _user: getIdentity() }
      ),

    saveCheck: (equipmentId, checkId, payload = {}) => {
      if (payload?.files?.length) {
        const { email, name } = getIdentity();
        const fd = new FormData();
        if (payload.items)
          fd.append("items", JSON.stringify(payload.items));
        if (payload.close) fd.append("close", "true");
        if (email) fd.append("user_email", email);
        if (name) fd.append("user_name", name);
        (payload.files || []).forEach((f) =>
          fd.append("files", f)
        );
        return put(
          `/api/atex/equipments/${encodeURIComponent(
            equipmentId
          )}/checks/${encodeURIComponent(checkId)}`,
          fd
        );
      }
      return put(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/checks/${encodeURIComponent(checkId)}`,
        {
          ...payload,
          _user: getIdentity(),
        }
      );
    },

    listHistory: (equipmentId) =>
      get(`/api/atex/equipments/${encodeURIComponent(equipmentId)}/history`),

    quickCheckEquipment: (id) =>
      post(
        `/api/atex/equipments/${encodeURIComponent(id)}/quickCheck`,
        {}
      ),

    calendar: () => get(`/api/atex/calendar`),
    settingsGet: () => get(`/api/atex/settings`),
    settingsSet: (payload) => put(`/api/atex/settings`, payload),

    extractFromPhotos: (files = []) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("files", f));
      return upload(`/api/atex/analyzePhotoBatch`, fd);
    },

    assessConformity: ({
      atex_mark_gas = "",
      atex_mark_dust = "",
      target_gas = null,
      target_dust = null,
    } = {}) =>
      post(`/api/atex/assess`, {
        atex_mark_gas,
        atex_mark_dust,
        target_gas,
        target_dust,
      }),

    applyCompliance: (
      equipmentId,
      { decision = null, rationale = "", source = null } = {}
    ) =>
      post(
        `/api/atex/equipments/${encodeURIComponent(
          equipmentId
        )}/compliance`,
        { decision, rationale, source }
      ),

    analyzePhotoBatch: (files = []) =>
      api.atex.extractFromPhotos(files),
    aiAnalyze: (payload) => api.atex.assessConformity(payload),

    getEquipmentHistory: (id) =>
      get(`/api/atex/equipments/${encodeURIComponent(id)}/history`),

    bulkRename: ({ field, from, to }) =>
      post("/api/atex/bulk/rename", { field, from, to }),
  },

  /** --- ATEX MAPS --- */
  atexMaps: {
    uploadZip: (file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("zip", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(`/api/atex/maps/uploadZip`, fd);
    },
    listPlans: () => get(`/api/atex/maps/listPlans`),
    listPlansCompat: () => get(`/api/atex/maps/plans`),
    renamePlan: (logical_name, display_name) =>
      put(`/api/atex/maps/renamePlan`, { logical_name, display_name }),
    planFileUrl: (logical_name, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/atex/maps/planFile?logical_name=${encodeURIComponent(
          logical_name
        )}`,
        bust
      ),
    planFileUrlById: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/atex/maps/planFile?id=${encodeURIComponent(id)}`,
        bust
      ),
    planFileUrlAuto: (plan, { bust = true } = {}) => {
      const key =
        typeof plan === "string"
          ? plan
          : plan?.id || plan?.logical_name || "";
      const url =
        isUuid(key) || isNumericId(key)
          ? `${API_BASE}/api/atex/maps/planFile?id=${encodeURIComponent(
              key
            )}`
          : `${API_BASE}/api/atex/maps/planFile?logical_name=${encodeURIComponent(
              key
            )}`;
      return withBust(url, bust);
    },
    positions: (logical_name, page_index = 0) =>
      get(`/api/atex/maps/positions`, { logical_name, page_index }),
    positionsAuto: (planOrKey, page_index = 0) => {
      const key =
        typeof planOrKey === "string"
          ? planOrKey
          : planOrKey?.id || planOrKey?.logical_name || "";
      if (isUuid(key) || isNumericId(key))
        return get(`/api/atex/maps/positions`, { id: key, page_index });
      return get(`/api/atex/maps/positions`, {
        logical_name: key,
        page_index,
      });
    },
    setPosition: (
      equipmentId,
      { logical_name, plan_id = null, page_index = 0, x_frac, y_frac }
    ) =>
      post(`/api/atex/maps/setPosition`, {
        equipment_id: equipmentId,
        logical_name,
        plan_id,
        page_index,
        x_frac,
        y_frac,
      }),

    listSubareas: (planKey, page_index = 0) => {
      const key =
        typeof planKey === "string"
          ? planKey
          : planKey?.id || planKey?.logical_name || "";
      if (isUuid(key) || isNumericId(key))
        return get(`/api/atex/maps/subareas`, { id: key, page_index });
      return get(`/api/atex/maps/subareas`, {
        logical_name: key,
        page_index,
      });
    },
    subareasStats: (logical_name, page_index = 0) =>
      get(`/api/atex/maps/subareas/stats`, { logical_name, page_index }),
    reindexZones: (logical_name, page_index = 0) =>
      post(`/api/atex/maps/reindexZones`, { logical_name, page_index }),
    purgeSubareas: async (logical_name, page_index = 0) => {
      const site = currentSite();
      const headers = identityHeaders(
        new Headers({ "X-Site": site, "X-Confirm": "purge" })
      );
      const url = `${API_BASE}/api/atex/maps/subareas/purge?${new URLSearchParams(
        { logical_name, page_index }
      )}`;
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      if (!res.ok)
        throw new Error(
          await res.text().catch(() => `HTTP ${res.status}`)
        );
      return res.json();
    },
    createSubarea: (payload) => {
      if (payload?.kind) return post(`/api/atex/maps/subareas`, payload);
      const {
        logical_name,
        page_index = 0,
        name = "",
        shape_type,
        geometry = {},
        zone_gas = null,
        zone_dust = null,
        plan_id = null,
      } = payload || {};
      const base = {
        logical_name,
        plan_id,
        page_index,
        name,
        zoning_gas: zone_gas,
        zoning_dust: zone_dust,
      };
      if (shape_type === "rect") {
        const { x1, y1, x2, y2 } = geometry || {};
        return post(`/api/atex/maps/subareas`, {
          ...base,
          kind: "rect",
          x1,
          y1,
          x2,
          y2,
        });
      }
      if (shape_type === "circle") {
        const { cx, cy, r } = geometry || {};
        return post(`/api/atex/maps/subareas`, {
          ...base,
          kind: "circle",
          cx,
          cy,
          r,
        });
      }
      const pts = (geometry?.points || []).map((p) =>
        Array.isArray(p) ? p : [p.x, p.y]
      );
      return post(`/api/atex/maps/subareas`, {
        ...base,
        kind: "poly",
        points: pts,
      });
    },
    updateSubarea: (id, patch = {}) => {
      const body = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.zone_gas !== undefined) body.zoning_gas = patch.zone_gas;
      if (patch.zoning_gas !== undefined)
        body.zoning_gas = patch.zoning_gas;
      if (patch.zone_dust !== undefined)
        body.zoning_dust = patch.zone_dust;
      if (patch.zoning_dust !== undefined)
        body.zoning_dust = patch.zoning_dust;
      if (patch.kind) body.kind = patch.kind;
      if (["rect", "circle", "poly"].includes(patch.kind)) {
        if (patch.kind === "rect") {
          if (patch.x1 !== undefined) body.x1 = patch.x1;
          if (patch.y1 !== undefined) body.y1 = patch.y1;
          if (patch.x2 !== undefined) body.x2 = patch.x2;
          if (patch.y2 !== undefined) body.y2 = patch.y2;
        } else if (patch.kind === "circle") {
          if (patch.cx !== undefined) body.cx = patch.cx;
          if (patch.cy !== undefined) body.cy = patch.cy;
          if (patch.r !== undefined) body.r = patch.r;
        } else if (patch.kind === "poly") {
          if (patch.points !== undefined) body.points = patch.points;
        }
      }
      return put(
        `/api/atex/maps/subareas/${encodeURIComponent(id)}`,
        body
      );
    },
    updateSubareaGeometry: (id, partial) =>
      put(
        `/api/atex/maps/subareas/${encodeURIComponent(
          id
        )}/geometry`,
        partial
      ),
    deleteSubarea: (id) =>
      del(`/api/atex/maps/subareas/${encodeURIComponent(id)}`),
    getMeta: (plan_key) =>
      get(`/api/atex/maps/meta`, { plan_key }),
    setMeta: (plan_key, payload) =>
      put(`/api/atex/maps/meta`, { plan_key, ...payload }),
    bulkRename: ({ field, from, to }) =>
      post("/api/atex/bulk/rename", { field, from, to }),
  },

  /** --- VSD --- */
  vsd: {
    listEquipments: (params) => get("/api/vsd/equipments", params),
    getEquipment: (id) => get(`/api/vsd/equipments/${encodeURIComponent(id)}`),
    createEquipment: (payload) => post("/api/vsd/equipments", payload),
    updateEquipment: (id, payload) =>
      put(`/api/vsd/equipments/${encodeURIComponent(id)}`, payload),
    deleteEquipment: (id) =>
      del(`/api/vsd/equipments/${encodeURIComponent(id)}`),

    photoUrl: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/vsd/equipments/${encodeURIComponent(id)}/photo`,
        bust
      ),
    uploadPhoto: (id, file) => {
      const fd = new FormData();
      fd.append("photo", file);
      return upload(`/api/vsd/equipments/${encodeURIComponent(id)}/photo`, fd);
    },

    listChecks: (equipmentId) =>
      get("/api/vsd/checks", { equipment_id: equipmentId }),
    createCheck: (payload) => post("/api/vsd/checks", payload),
    quickCheckEquipment: (id) =>
      post("/api/vsd/checks", {
        equipment_id: id,
        status: "fait",
        items: [],
        result: "conforme",
      }),

    listFiles: (equipmentId) =>
      get("/api/vsd/files", { equipment_id: equipmentId }),
    uploadFiles: (equipmentId, files = []) => {
      const fd = new FormData();
      fd.append("equipment_id", equipmentId);
      (files || []).forEach((f) => fd.append("files", f));
      return upload("/api/vsd/files", fd);
    },
    deleteFile: (id) => del(`/api/vsd/files/${encodeURIComponent(id)}`),

    calendar: () => get(`/api/vsd/calendar`),
    settingsGet: () => get(`/api/vsd/settings`),
    settingsSet: (payload) => put(`/api/vsd/settings`, payload),

    extractFromPhotos: (files = []) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("files", f));
      return upload(`/api/vsd/analyzePhotoBatch`, fd);
    },

    analyzePhotoBatch: (files = []) => api.vsd.extractFromPhotos(files),

    getEquipmentHistory: (id) =>
      get(`/api/vsd/equipments/${encodeURIComponent(id)}/history`),

    bulkRename: ({ field, from, to }) =>
      post("/api/vsd/bulk/rename", { field, from, to }),
  },

  /** --- VSD MAPS --- */
  vsdMaps: {
    uploadZip: (file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("zip", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(`/api/vsd/maps/uploadZip`, fd);
    },
    listPlans: () => get(`/api/vsd/maps/listPlans`),
    listPlansCompat: () => get(`/api/vsd/maps/plans`),
    renamePlan: (logical_name, display_name) =>
      put(`/api/vsd/maps/renamePlan`, { logical_name, display_name }),
    planFileUrl: (logical_name, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/vsd/maps/planFile?logical_name=${encodeURIComponent(
          logical_name
        )}`,
        bust
      ),
    planFileUrlById: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/vsd/maps/planFile?id=${encodeURIComponent(id)}`,
        bust
      ),
    planFileUrlAuto: (plan, { bust = true } = {}) => {
      const key =
        typeof plan === "string"
          ? plan
          : plan?.id || plan?.logical_name || "";
      const url =
        isUuid(key) || isNumericId(key)
          ? `${API_BASE}/api/vsd/maps/planFile?id=${encodeURIComponent(key)}`
          : `${API_BASE}/api/vsd/maps/planFile?logical_name=${encodeURIComponent(
              key
            )}`;
      return withBust(url, bust);
    },
    positions: (logical_name, page_index = 0) =>
      get(`/api/vsd/maps/positions`, { logical_name, page_index }),
    positionsAuto: (planOrKey, page_index = 0) => {
      const key =
        typeof planOrKey === "string"
          ? planOrKey
          : planOrKey?.id || planOrKey?.logical_name || "";
      if (isUuid(key) || isNumericId(key))
        return get(`/api/vsd/maps/positions`, { id: key, page_index });
      return get(`/api/vsd/maps/positions`, {
        logical_name: key,
        page_index,
      });
    },
    setPosition: (
      equipmentId,
      { logical_name, plan_id = null, page_index = 0, x_frac, y_frac }
    ) =>
      post(`/api/vsd/maps/setPosition`, {
        equipment_id: equipmentId,
        logical_name,
        plan_id,
        page_index,
        x_frac,
        y_frac,
      }),
    deletePosition: (positionId) =>
      del(`/api/vsd/maps/positions/${encodeURIComponent(positionId)}`),
    placedIds: async () => {
      try {
        return await get("/api/vsd/maps/placed-ids");
      } catch (e) {
        // Fallback: build from all plans
        try {
          const plans = await get("/api/vsd/maps/listPlans");
          const placed_ids = [];
          const placed_details = {};
          for (const plan of (plans?.plans || plans || [])) {
            const positions = await get("/api/vsd/maps/positions", { logical_name: plan.logical_name, page_index: 0 }).catch(() => ({}));
            for (const pos of (positions?.positions || [])) {
              if (pos.equipment_id && !placed_ids.includes(pos.equipment_id)) {
                placed_ids.push(pos.equipment_id);
                placed_details[pos.equipment_id] = { plans: [plan.logical_name] };
              } else if (pos.equipment_id && placed_details[pos.equipment_id]) {
                if (!placed_details[pos.equipment_id].plans.includes(plan.logical_name)) {
                  placed_details[pos.equipment_id].plans.push(plan.logical_name);
                }
              }
            }
          }
          return { placed_ids, placed_details };
        } catch {
          return { placed_ids: [], placed_details: {} };
        }
      }
    },
  },

  /** --- MECA --- */
  meca: {
    listEquipments: (params) => get("/api/meca/equipments", params),
    getEquipment: (id) => get(`/api/meca/equipments/${encodeURIComponent(id)}`),
    createEquipment: (payload) => post("/api/meca/equipments", payload),
    updateEquipment: (id, payload) =>
      put(`/api/meca/equipments/${encodeURIComponent(id)}`, payload),
    deleteEquipment: (id) =>
      del(`/api/meca/equipments/${encodeURIComponent(id)}`),

    photoUrl: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/meca/equipments/${encodeURIComponent(id)}/photo`,
        bust
      ),

    uploadPhoto: (id, file) => {
      const fd = new FormData();
      fd.append("photo", file);
      return upload(`/api/meca/equipments/${encodeURIComponent(id)}/photo`, fd);
    },

    listFiles: (equipmentId) =>
      get("/api/meca/files", { equipment_id: equipmentId }),

    uploadFiles: (equipmentId, files = []) => {
      const fd = new FormData();
      fd.append("equipment_id", equipmentId);
      (files || []).forEach((f) => fd.append("files", f));
      return upload("/api/meca/files", fd);
    },

    deleteFile: (fileId) =>
      del(`/api/meca/files/${encodeURIComponent(fileId)}`),
  },

  /** --- MECA MAPS --- */
  mecaMaps: {
    uploadZip: (file) => {
      const fd = new FormData();
      fd.append("zip", file);
      return upload(`/api/meca/maps/uploadZip`, fd);
    },

    listPlans: () => get(`/api/meca/maps/listPlans`),

    renamePlan: (logical_name, display_name) =>
      put(`/api/meca/maps/renamePlan`, { logical_name, display_name }),

    planFileUrl: (logical_name, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/meca/maps/planFile?logical_name=${encodeURIComponent(
          logical_name
        )}`,
        bust
      ),

    planFileUrlById: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/meca/maps/planFile?id=${encodeURIComponent(id)}`,
        bust
      ),

    planFileUrlAuto: (plan, { bust = true } = {}) => {
      const key =
        typeof plan === "string"
          ? plan
          : plan?.id || plan?.logical_name || "";

      const url =
        isUuid(key) || isNumericId(key)
          ? `${API_BASE}/api/meca/maps/planFile?id=${encodeURIComponent(key)}`
          : `${API_BASE}/api/meca/maps/planFile?logical_name=${encodeURIComponent(
              key
            )}`;

      return withBust(url, bust);
    },

    positions: (logical_name, page_index = 0) =>
      get(`/api/meca/maps/positions`, { logical_name, page_index }),

    positionsById: (id, page_index = 0) =>
      get(`/api/meca/maps/positions`, { id, page_index }),

    positionsAuto: (planOrKey, page_index = 0) => {
      const key =
        typeof planOrKey === "string"
          ? planOrKey
          : planOrKey?.id || planOrKey?.logical_name || "";

      if (isUuid(key) || isNumericId(key))
        return get(`/api/meca/maps/positions`, { id: key, page_index });

      return get(`/api/meca/maps/positions`, {
        logical_name: key,
        page_index,
      });
    },

    setPosition: (equipmentId, { logical_name, plan_id, page_index = 0, x_frac, y_frac }) =>
      post(`/api/meca/maps/setPosition`, {
        equipment_id: equipmentId,
        logical_name,
        plan_id,
        page_index,
        x_frac,
        y_frac,
      }),
    deletePosition: (positionId) =>
      del(`/api/meca/maps/positions/${encodeURIComponent(positionId)}`),
    placedIds: async () => {
      try {
        return await get("/api/meca/maps/placed-ids");
      } catch (e) {
        // Fallback: build from all plans
        try {
          const plans = await get("/api/meca/maps/listPlans");
          const placed_ids = [];
          const placed_details = {};
          for (const plan of (plans?.plans || plans || [])) {
            const positions = await get("/api/meca/maps/positions", { logical_name: plan.logical_name, page_index: 0 }).catch(() => ({}));
            for (const pos of (positions?.positions || [])) {
              if (pos.equipment_id && !placed_ids.includes(pos.equipment_id)) {
                placed_ids.push(pos.equipment_id);
                placed_details[pos.equipment_id] = { plans: [plan.logical_name] };
              } else if (pos.equipment_id && placed_details[pos.equipment_id]) {
                if (!placed_details[pos.equipment_id].plans.includes(plan.logical_name)) {
                  placed_details[pos.equipment_id].plans.push(plan.logical_name);
                }
              }
            }
          }
          return { placed_ids, placed_details };
        } catch {
          return { placed_ids: [], placed_details: {} };
        }
      }
    },
  },

  /** --- DCF ASSISTANT --- */
  dcf: {
    health: () => get("/api/dcf/health"),

    uploadExcelMulti: (formData) => upload("/api/dcf/uploadExcelMulti", formData),

    uploadExcel: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return upload("/api/dcf/uploadExcel", fd);
    },

    listFiles: () => get("/api/dcf/files"),

    getFile: async (id) => {
      const site = currentSite();
      const headers = identityHeaders(new Headers({ "X-Site": site }));
      const res = await fetch(`${API_BASE}/api/dcf/files/${id}`, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      return res.blob();
    },

    getFileDebug: (id) => get(`/api/dcf/files/${id}/debug`),

    startSession: (payload) => post("/api/dcf/startSession", payload),
    listSessions: () => get("/api/dcf/sessions"),
    getSession: (id) => get(`/api/dcf/session/${id}`),

    uploadAttachments: (files = [], sessionId = null) => {
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("files", f));
      if (sessionId) fd.append("sessionId", sessionId);
      return upload("/api/dcf/attachments/upload", fd);
    },

    chat: (payload) => post("/api/dcf/chat", payload),

    reference: {
      taskLists: () => get("/api/dcf/reference/tasklists"),
      plan: (planNumber) => get(`/api/dcf/reference/plan/${planNumber}`),
    },

    wizard: {
      analyze: async (messageOrFormData, sessionId) => {
        if (typeof messageOrFormData === "string") {
          return post("/api/dcf/wizard/analyze", { message: messageOrFormData, sessionId });
        }
        if (messageOrFormData instanceof FormData) {
          return upload("/api/dcf/wizard/analyze", messageOrFormData);
        }
        const fd = new FormData();
        fd.append("message", messageOrFormData.message || "");
        if (messageOrFormData.sessionId) fd.append("sessionId", messageOrFormData.sessionId);
        if (messageOrFormData.screenshots) {
          messageOrFormData.screenshots.forEach((f) => fd.append("screenshots", f));
        }
        return upload("/api/dcf/wizard/analyze", fd);
      },

      instructions: async (sessionId, requestText, templateFilename, attachmentIds = [], screenshots = []) => {
        if (!screenshots || screenshots.length === 0) {
          return post("/api/dcf/wizard/instructions", {
            sessionId,
            requestText,
            templateFilename,
            attachmentIds,
          });
        }
        const fd = new FormData();
        fd.append("sessionId", sessionId);
        fd.append("requestText", requestText);
        fd.append("templateFilename", templateFilename);
        fd.append("attachmentIds", JSON.stringify(attachmentIds));
        screenshots.forEach((f) => fd.append("screenshots", f));
        return upload("/api/dcf/wizard/instructions", fd);
      },

      autofill: async (templateFilename, instructions) => {
        const site = currentSite();
        const headers = identityHeaders(new Headers({ "X-Site": site }));
        headers.set("Content-Type", "application/json");

        const res = await fetch(`${API_BASE}/api/dcf/wizard/autofill`, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ templateFilename, instructions }),
        });

        if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
        return res.blob();
      },

      validate: (fileIds, useCase = null) =>
        post("/api/dcf/wizard/validate", { fileIds, useCase }),

      explain: (fileId) => post("/api/dcf/wizard/explain", { fileId }),
    },

    validate: ({ fileIds, mode = "auto" }) => post("/api/dcf/validate", { fileIds, mode }),
  },

  /** --- LEARN-EX --- */
  learnEx: {
    health: () => get("/api/learn-ex/health"),
    config: () => get("/api/learn-ex/config"),
    modules: () => get("/api/learn-ex/modules"),
    getModule: (id) => get(`/api/learn-ex/modules/${id}`),
    getModuleQuiz: (id) => get(`/api/learn-ex/modules/${id}/quiz`),
    checkModuleQuiz: (id, answers, sessionId) =>
      post(`/api/learn-ex/modules/${id}/quiz/check`, { answers, sessionId }),
    finalExam: () => get("/api/learn-ex/final-exam"),
    submitExam: (sessionId, answers, timeSpent) =>
      post("/api/learn-ex/final-exam/submit", { sessionId, answers, timeSpent }),
    getCurrentSession: () => get("/api/learn-ex/sessions/current"),
    getSession: (id) => get(`/api/learn-ex/sessions/${id}`),
    createSession: () => post("/api/learn-ex/sessions", {}),
    history: () => get("/api/learn-ex/history"),
    certificates: () => get("/api/learn-ex/certificates"),
    verifyCertificate: (number) =>
      get(`/api/learn-ex/certificates/verify/${number}`),
    certificatePdfUrl: (id) => `${API_BASE}/api/learn-ex/certificates/${id}/pdf`,
    stats: () => get("/api/learn-ex/stats"),
    imageUrl: (name) => `${API_BASE}/api/learn-ex/images/${name}`,
  },

  /* ======================================================================
     ====================== SWITCHBOARD (Tableaux électriques) ============
     ====================================================================== */

  /** --- SWITCHBOARD (Tableaux électriques & Disjoncteurs) --- */
  switchboard: {
    // ========================= TABLEAUX (BOARDS) =========================

    /** Liste tous les tableaux avec filtres et pagination */
    listBoards: (params) => get("/api/switchboard/boards", params),

    /** Récupère un tableau par son ID (inclut upstream_sources) */
    getBoard: (id) => get(`/api/switchboard/boards/${encodeURIComponent(id)}`),

    /** Crée un nouveau tableau */
    createBoard: (payload) => post("/api/switchboard/boards", payload),

    // Mettre à jour un tableau (timeout élargi à 60s pour les gros diagrammes)
    updateBoard: (id, payload, { timeout = 60000 } = {}) =>
      jsonFetch(`/api/switchboard/boards/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
        timeout
      }),

    // PATCH partiel d'un board (diagram_data, modes, quality seulement)
    patchBoard: (id, payload, { timeout = 15000 } = {}) =>
      jsonFetch(`/api/switchboard/boards/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        timeout
      }),

    /** Supprime un tableau et ses disjoncteurs associés */
    deleteBoard: (id) =>
      del(`/api/switchboard/boards/${encodeURIComponent(id)}`),

    /** Duplique un tableau (sans les disjoncteurs) */
    duplicateBoard: (id) =>
      post(`/api/switchboard/boards/${encodeURIComponent(id)}/duplicate`, {}),

    // ========================= PHOTO TABLEAU =========================

    /** URL de la photo du tableau (pour affichage <img>) */
    boardPhotoUrl: (id, { bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/switchboard/boards/${encodeURIComponent(id)}/photo?site=${currentSite()}`,
        bust
      ),

    /** Upload de la photo du tableau */
    uploadBoardPhoto: (id, file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("photo", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload(
        `/api/switchboard/boards/${encodeURIComponent(id)}/photo`,
        fd
      );
    },

    // ========================= PDF EXPORT (LISTING) =========================

    /** URL du PDF listing (téléchargement direct via lien <a>) */
    pdfUrl: (id) =>
      `${API_BASE}/api/switchboard/boards/${encodeURIComponent(id)}/pdf?site=${currentSite()}`,

    /** Télécharge le PDF listing (retourne un Blob) */
    downloadPdf: async (id) => {
      const site = currentSite();
      const headers = identityHeaders(new Headers({ "X-Site": site }));
      const res = await fetch(
        `${API_BASE}/api/switchboard/boards/${encodeURIComponent(id)}/pdf?site=${site}`,
        {
          method: "GET",
          headers,
          credentials: "include",
        }
      );
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      return res.blob();
    },

    // ========================= PDF SCHÉMA UNIFILAIRE =========================

    /** URL du PDF schéma unifilaire (téléchargement direct) */
    diagramPdfUrl: (id) =>
      `${API_BASE}/api/switchboard/boards/${encodeURIComponent(id)}/diagram-pdf?site=${currentSite()}`,

    /** Télécharge le PDF schéma unifilaire (retourne un Blob) */
    downloadDiagramPdf: async (id) => {
      const site = currentSite();
      const headers = identityHeaders(new Headers({ "X-Site": site }));
      const res = await fetch(
        `${API_BASE}/api/switchboard/boards/${encodeURIComponent(id)}/diagram-pdf?site=${site}`,
        {
          method: "GET",
          headers,
          credentials: "include",
        }
      );
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      return res.blob();
    },

    // ========================= SITE SETTINGS (Logo, Company) =========================

    /** Récupère les paramètres du site (logo, infos société) */
    getSettings: () => get("/api/switchboard/settings"),

    /** Met à jour les paramètres du site (infos société) */
    updateSettings: (payload) => put("/api/switchboard/settings", payload),

    /** Upload du logo de l'entreprise */
    uploadLogo: (file) => {
      const fd = new FormData();
      fd.append("logo", file);
      return upload("/api/switchboard/settings/logo", fd);
    },

    /** URL du logo (pour affichage <img>) */
    logoUrl: ({ bust = true } = {}) =>
      withBust(
        `${API_BASE}/api/switchboard/settings/logo?site=${currentSite()}`,
        bust
      ),

    /** Supprime le logo de l'entreprise */
    deleteLogo: () => del("/api/switchboard/settings/logo"),

    // ========================= DISJONCTEURS (DEVICES) =========================

    /** Liste tous les disjoncteurs d'un tableau (inclut infos downstream) */
    listDevices: (boardId, params) =>
      get(`/api/switchboard/boards/${encodeURIComponent(boardId)}/devices`, params),

    /** Récupère un disjoncteur par son ID */
    getDevice: (id) =>
      get(`/api/switchboard/devices/${encodeURIComponent(id)}`),

    /** Crée un nouveau disjoncteur */
    createDevice: (payload) => post("/api/switchboard/devices", payload),

    // Mettre à jour un disjoncteur (timeout élargi à 60s)
    updateDevice: (id, payload, { timeout = 60000 } = {}) =>
      jsonFetch(`/api/switchboard/devices/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
        timeout
      }),

    // Mettre à jour en bulk les positions des devices d'un board
    bulkUpdateDevicePositions: (boardId, devices, { timeout = 60000 } = {}) =>
      jsonFetch(`/api/switchboard/boards/${encodeURIComponent(boardId)}/devices/bulk-positions`, {
        method: 'PUT',
        body: JSON.stringify({ devices }),
        timeout
      }),


    /** Supprime un disjoncteur */
    deleteDevice: (id) =>
      del(`/api/switchboard/devices/${encodeURIComponent(id)}`),

    // ========================= IMPORT EXCEL =========================

    /** 
     * Import depuis fichier Excel (.xls ou .xlsx)
     * - Crée ou met à jour le tableau
     * - Détecte les doublons et les ignore
     * - Retourne: { success, already_exists, switchboard, devices_created, devices_skipped, existing_devices }
     */
    importExcel: (file) => {
      const { email, name } = getIdentity();
      const fd = new FormData();
      fd.append("file", file);
      if (email) fd.append("user_email", email);
      if (name) fd.append("user_name", name);
      return upload("/api/switchboard/import-excel", fd);
    },

    // ========================= COMPTAGES =========================

    /** 
     * Récupère le nombre de disjoncteurs (total et complets) pour une liste de tableaux
     * @param {number[]} boardIds - Liste des IDs de tableaux (vide = tous)
     * @returns {{ counts: { [boardId]: { total: number, complete: number } } }}
     */
    getDeviceCounts: (boardIds = []) =>
      post("/api/switchboard/devices-count", { board_ids: boardIds }),

    // ========================= IA PHOTO ANALYSIS =========================

    /** 
     * Analyse une photo de disjoncteur avec OpenAI Vision
     * Retourne: { manufacturer, reference, is_differential, in_amps, cache_suggestions[], ... }
     */
    analyzePhoto: (file) => {
      const fd = new FormData();
      fd.append("photo", file);
      return upload("/api/switchboard/analyze-photo", fd);
    },

    /** 
     * Recherche les spécifications d'un disjoncteur via requête texte (IA)
     * @param {string} query - Ex: "Schneider NSX250N Micrologic 5.2"
     */
    searchDevice: (query) =>
      post("/api/switchboard/search-device", { query }),

    /** 
     * Recherche les tableaux aval (pour liaison downstream)
     * @param {string} query - Texte de recherche (code ou nom)
     * @returns {{ suggestions: [{ id, name, code, building_code, floor, room }] }}
     */
    searchDownstreams: (query) =>
      get("/api/switchboard/search-downstreams", { query }),

    // ========================= CACHE PRODUITS SCANNÉS =========================

    /** 
     * Sauvegarde un produit scanné dans le cache (apprentissage IA)
     * Si le produit existe déjà (même référence+fabricant), met à jour et incrémente scan_count
     */
    saveScannedProduct: (payload) =>
      post("/api/switchboard/scanned-products", payload),

    /** 
     * Recherche dans le cache des produits scannés
     * @param {{ q?: string, manufacturer?: string, reference?: string }}
     */
    searchScannedProducts: (params) =>
      get("/api/switchboard/scanned-products/search", params),

    /** Liste tous les produits scannés (triés par popularité) */
    listScannedProducts: () =>
      get("/api/switchboard/scanned-products"),

    /** Supprime un produit du cache */
    deleteScannedProduct: (id) =>
      del(`/api/switchboard/scanned-products/${encodeURIComponent(id)}`),

    // ========================= GRAPH (Arborescence) =========================

    /** 
     * Récupère l'arborescence complète d'un tableau (devices + downstream recursif)
     * @returns {{ switchboard_id, devices: [{ ...device, children, downstream }] }}
     */
    getGraph: (id) =>
      get(`/api/switchboard/boards/${encodeURIComponent(id)}/graph`),

    // ========================= CALENDRIER & STATS =========================

    /** Récupère le calendrier des tableaux (pour vue planning) */
    calendar: () => get("/api/switchboard/calendar"),

    /** 
     * Statistiques globales du module
     * @returns {{ total_boards, total_devices, complete_devices, differential_devices }}
     */
    stats: () => get("/api/switchboard/stats"),

    /** Health check du service */
    health: () => get("/api/switchboard/health"),
  },

  /** --- 🔵 BUBBLE AUTH --- */
  bubble: {
    login: (token) => post("/api/auth/bubble", { token }),
  },
};

// Default export for convenience
export default api;
