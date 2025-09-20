// src/lib/api.js

/** Base API (déjà présent chez toi) */
const API_BASE = import.meta.env.VITE_API_BASE || "";

/** Récupère le site courant depuis le profil stocké côté client */
function currentSite() {
  try {
    const u = JSON.parse(localStorage.getItem("eh_user") || "{}");
    return u?.site || "";
  } catch {
    return "";
  }
}

/** Fetch JSON avec en-tête X-Site automatique (compatible avec ton backend/proxy) */
async function jsonFetch(url, options = {}) {
  const site = currentSite();

  const res = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(site ? { "X-Site": site } : {}), // ➕ ajoute le site si dispo
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

/** Helpers génériques (identiques à ton implémentation actuelle) */
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

/** Upload multipart (on ne définit pas Content-Type pour laisser le navigateur gérer) */
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

/** Export de base conservé */
export { API_BASE };

/* -------------------------------------------------------------------------- */
/*  Clients “confort” (optionnels) — n’impactent pas le code existant        */
/*  Tu peux les utiliser dans Switchboards.jsx ou rester sur get/post/put/del */
/* -------------------------------------------------------------------------- */

export const api = {
  switchboard: {
    /** Liste paginée + filtres (site ajouté automatiquement via header) */
    list: (params) => get("/api/switchboard/boards", params),

    /** Lecture unitaire */
    getOne: (id) => get(`/api/switchboard/boards/${id}`),

    /** Création */
    create: (payload) => post("/api/switchboard/boards", payload),

    /** Mise à jour */
    update: (id, payload) => put(`/api/switchboard/boards/${id}`, payload),

    /** Duplication */
    duplicate: (id) => post(`/api/switchboard/boards/${id}/duplicate`),

    /** Suppression */
    remove: (id) => del(`/api/switchboard/boards/${id}`),
  },
};
