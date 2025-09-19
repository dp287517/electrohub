// src/lib/api.js
const API_BASE = import.meta.env.VITE_API_BASE || '';

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(text || `HTTP ${res.status}`);
  }
  // Peut être no-content
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export async function get(path, params) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  return jsonFetch(`${path}${qs}`);
}

export async function post(path, body) {
  return jsonFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
}

export async function put(path, body) {
  return jsonFetch(path, { method: 'PUT', body: JSON.stringify(body || {}) });
}

export async function del(path) {
  return jsonFetch(path, { method: 'DELETE' });
}

export { API_BASE };
