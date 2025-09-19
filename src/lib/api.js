// src/lib/api.js
const API_BASE = import.meta.env.VITE_API_BASE || '';

async function jsonFetch(url, options = {}) {
  const token = localStorage.getItem('eh_token');
  
  // AJOUT AUTOMATIQUE DE L'AUTHORIZATION HEADER
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    headers,
    ...options,
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  
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

// Upload multipart (ne **pas** définir Content-Type, mais ajoute quand même l'auth)
export async function upload(path, formData) {
  const token = localStorage.getItem('eh_token');
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });
  
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export { API_BASE };
