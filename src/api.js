// Frontend ATEX API helpers (fetch-based). All responses use English UI.
const API_BASE = "/api/atex";

async function http(method, url, body, isForm = false) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (isForm) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = "Request failed";
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg + ` (${res.status})`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

// Equipment
export async function listEquipment() {
  return http("GET", `${API_BASE}/equipment`);
}
export async function createEquipment(payload) {
  return http("POST", `${API_BASE}/equipment`, payload);
}
export async function updateEquipment(id, payload) {
  return http("PUT", `${API_BASE}/equipment/${id}`, payload);
}
export async function deleteEquipment(id) {
  return http("DELETE", `${API_BASE}/equipment/${id}`);
}

// Assessments
export async function listAssessments() {
  return http("GET", `${API_BASE}/assessment`);
}
export async function createAssessment(payload) {
  return http("POST", `${API_BASE}/assessment`, payload);
}

// Import / Export
export async function exportExcel() {
  const res = await http("GET", `${API_BASE}/export`);
  return res; // Blob Response
}
export async function importExcel(file) {
  const fd = new FormData();
  fd.append("file", file);
  return http("POST", `${API_BASE}/import`, fd, true);
}
