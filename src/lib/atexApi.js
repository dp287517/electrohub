const API = import.meta.env.VITE_API_BASE || '/api';
const json = {'Content-Type':'application/json'};

export const AtexApi = {
  list: async (params={}) => {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`${API}/atex/equipments?${qs}`, { credentials: 'include' });
    if (!r.ok) throw new Error('List failed');
    return r.json();
  },
  getFiles: async (id) => {
    const r = await fetch(`${API}/atex/equipments/${id}/files`, { credentials: 'include' });
    if (!r.ok) throw new Error('Get files failed');
    return r.json();
  },
  create: async (payload) => {
    const r = await fetch(`${API}/atex/equipments`, { method:'POST', headers: json, body: JSON.stringify(payload), credentials: 'include' });
    if (!r.ok) throw new Error('Create failed');
    return r.json();
  },
  update: async (id, payload) => {
    const r = await fetch(`${API}/atex/equipments/${id}`, { method:'PUT', headers: json, body: JSON.stringify(payload), credentials: 'include' });
    if (!r.ok) throw new Error('Update failed');
    return r.json();
  },
  remove: async (id) => {
    const r = await fetch(`${API}/atex/equipments/${id}`, { method:'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error('Delete failed');
    return r.json();
  },
  upload: async (id, files) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const r = await fetch(`${API}/atex/equipments/${id}/files`, { method:'POST', body: form, credentials: 'include' });
    if (!r.ok) throw new Error('Upload failed');
    return r.json();
  },
  downloadFile: (fileId) => `${API}/atex/files/${fileId}`,
  template: () => `${API}/atex/template`,
  import: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const r = await fetch(`${API}/atex/import`, { method:'POST', body: form, credentials: 'include' });
    if (!r.ok) throw new Error('Import failed');
    return r.json();
  },
  export: () => `${API}/atex/export`,
  assist: async (id) => {
    const r = await fetch(`${API}/atex/assist/${id}`, { method:'POST', credentials: 'include' });
    if (!r.ok) throw new Error('Assist failed');
    return r.json();
  }
};
