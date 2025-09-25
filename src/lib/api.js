/** Base API */
const API_BASE = import.meta.env.VITE_API_BASE || "";

/** Get current site from client-side stored profile */
function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "";
  } catch {
    return "";
  }
}

/** Fetch JSON with automatic X-Site header */
async function jsonFetch(url, options = {}) {
  const site = currentSite();

  const res = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(site ? { "X-Site": site } : {}),
    },
    ...options,
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
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  return jsonFetch(`${path}${qs}`);
}

export async function post(path, body) {
  return jsonFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
}

export async function put(path, body) {
  return jsonFetch(path, { method: "PUT", body: JSON.stringify(body || {}) });
}

export async function del(path) {
  return jsonFetch(path, { method: "DELETE" });
}

/** Multipart upload */
export async function upload(path, formData) {
  const site = currentSite();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: {
      ...(site ? { "X-Site": site } : {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Base export */
export { API_BASE };

/** Convenience clients */
export const api = {
  switchboard: {
    list: (params) => get("/api/switchboard/boards", params),
    getOne: (id) => get(`/api/switchboard/boards/${id}`),
    create: (payload) => post("/api/switchboard/boards", payload),
    update: (id, payload) => put(`/api/switchboard/boards/${id}`, payload),
    duplicate: (id) => post(`/api/switchboard/boards/${id}/duplicate`),
    remove: (id) => del(`/api/switchboard/boards/${id}`),
  },
  selectivity: {
    listPairs: (params) => get("/api/selectivity/pairs", params),
    checkPair: (upstreamId, downstreamId) => get(`/api/selectivity/check?upstream=${upstreamId}&downstream=${downstreamId}`),
    getCurves: (upstreamId, downstreamId) => get(`/api/selectivity/curves?upstream=${upstreamId}&downstream=${downstreamId}`),
    getAiTip: (payload) => post("/api/selectivity/ai-tip", payload),
  },
  faultlevel: {
    listPoints: (params) => get("/api/faultlevel/points", params),
    checkPoint: (deviceId, switchboardId, phaseType = 'three') => 
      get(`/api/faultlevel/check?device=${deviceId}&switchboard=${switchboardId}&phase_type=${phaseType}`),
    getCurves: (deviceId, switchboardId, phaseType = 'three') => 
      get(`/api/faultlevel/curves?device=${deviceId}&switchboard=${switchboardId}&phase_type=${phaseType}`),
    getAiTip: (payload) => post("/api/faultlevel/ai-tip", payload),
    updateParameters: (payload) => post("/api/faultlevel/parameters", payload),
    reset: () => post("/api/faultlevel/reset", {}),
  },
  arcflash: {
    listPoints: (params) => get("/api/arcflash/points", params),
    checkPoint: (deviceId, switchboardId) => 
      get(`/api/arcflash/check?device=${deviceId}&switchboard=${switchboardId}`),
    getCurves: (deviceId, switchboardId) => 
      get(`/api/arcflash/curves?device=${deviceId}&switchboard=${switchboardId}`),
    getAiTip: (payload) => post("/api/arcflash/ai-tip", payload),
    updateParameters: (payload) => post("/api/arcflash/parameters", payload),
    reset: () => post("/api/arcflash/reset", {}),
  },
  obsolescence: {  // AJOUT SECTION OBSOLESCENCE
    listPoints: (params) => get("/api/obsolescence/points", params),
    checkPoint: (deviceId, switchboardId) => 
      get(`/api/obsolescence/check?device=${deviceId}&switchboard=${switchboardId}`),
    getGantt: () => get("/api/obsolescence/gantt"),
    getCapexForecast: () => get("/api/obsolescence/capex-forecast"),
    getAiTip: (payload) => post("/api/obsolescence/ai-tip", payload),
    updateParameters: (payload) => post("/api/obsolescence/parameters", payload),
    reset: () => post("/api/obsolescence/reset", {}),
    analyzePdf: (formData) => upload("/api/obsolescence/analyze-pdf", formData),
    exportPdf: () => get("/api/obsolescence/export-pdf"),
  },
};
