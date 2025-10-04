// src/pages/Project.jsx
import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../lib/api.js';
import {
  Plus, UploadCloud, BarChart3, AlertTriangle, CheckCircle2, XCircle,
  Paperclip, Bot, ChevronDown, Download, X
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

/* ----------------------------- UI helpers ----------------------------- */
const inputCls =
  'w-full bg-white border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';
const btn = 'px-3 py-2 rounded bg-gray-900 text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary =
  'px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';

const gbp = (n) =>
  Number(n || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });

function DropInput({ label = 'Drag & drop or click', onFiles, accept = undefined, multiple = true }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(files);
      }}
      className={`cursor-pointer border-2 rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${
        drag ? 'border-blue-500 bg-blue-50' : 'border-dashed border-gray-300 bg-white'
      }`}
    >
      <UploadCloud />
      <span>{label}</span>
      <input
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

/* ----------------------------- Toast (inspired by OIBT) ----------------------------- */
function Toast({ msg, type = 'info', onClose }) {
  if (!msg) return null;
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warn: 'bg-amber-500',
  };
  return (
    <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${colors[type]}`}>
      <div className="flex items-center gap-3">
        <span dangerouslySetInnerHTML={{ __html: msg }} />
        <button onClick={onClose} className="bg-white/20 rounded px-2 py-0.5">
          OK
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- Page -------------------------------- */
export default function Project() {
  const [list, setList] = useState([]);
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null); // project row
  const [status, setStatus] = useState(null);
  const [lines, setLines] = useState({ offers: [], orders: [], invoices: [] });
  const [analysis, setAnalysis] = useState(null);
  const [aiAnswer, setAiAnswer] = useState('');

  // edit fields (controlled)
  const [editWbs, setEditWbs] = useState('');
  const [editBudget, setEditBudget] = useState('');

  // toast
  const [toast, setToast] = useState(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // sync controlled fields when opening a project
    if (!selected) return;
    setEditWbs(selected.wbs_number || '');
    setEditBudget(selected.budget_amount ?? '');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    try {
      setBusy(true);
      const data = await get('/api/projects/projects', q ? { q } : undefined);
      setList(data?.data || []);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = title.trim();
    if (!name) return;
    try {
      setBusy(true);
      const row = await post('/api/projects/projects', { title: name });
      setTitle('');
      setQ(''); // avoid filter hiding the new card
      setList((s) => [row, ...s]);
      setToast({ msg: `Project <b>${row.title}</b> created.`, type: 'success' });
      await openProject(row); // open the newly created project
    } catch (e) {
      console.error(e);
      setToast({ msg: 'Creation failed: ' + (e?.message || e), type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function openProject(p) {
    setSelected(p);
    try {
      const s = await get(`/api/projects/projects/${p.id}/status`);
      setStatus(s || {});
    } catch {
      setStatus({});
    }
    try {
      const l = await get(`/api/projects/projects/${p.id}/lines`);
      setLines(l || { offers: [], orders: [], invoices: [] });
    } catch {
      setLines({ offers: [], orders: [], invoices: [] });
    }
    try {
      const a = await get(`/api/projects/projects/${p.id}/analysis`);
      setAnalysis(a || null);
    } catch {
      setAnalysis(null);
    }
  }

  // local PUT helper (keeps credentials)
  async function put(url, body) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || `HTTP ${r.status}`);
    }
    return r.json();
  }

  async function saveHeaderFields() {
    if (!selected) return;
    try {
      const payload = {
        wbs_number: editWbs || null,
        budget_amount: editBudget === '' ? null : Number(editBudget),
      };
      const updated = await put(`/api/projects/projects/${selected.id}`, payload);
      // mark WBS recorded if newly filled
      if ((payload.wbs_number && !status?.wbs_recorded) || (payload.budget_amount && !status?.wbs_recorded)) {
        const nextStatus = { ...(status || {}), wbs_recorded: true };
        const st = await put(`/api/projects/projects/${selected.id}/status`, nextStatus);
        setStatus(st);
      }
      // reflect everywhere
      setSelected(updated);
      setList((s) => s.map((x) => (x.id === updated.id ? updated : x)));
      setToast({ msg: 'Header saved.', type: 'success' });
      // refresh KPIs/analysis
      await openProject(updated);
    } catch (e) {
      setToast({ msg: 'Save failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function uploadFiles(p, category, files) {
    if (!files?.length) return;
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await post(
          `/api/projects/projects/${p.id}/upload?category=${encodeURIComponent(category)}`,
          fd
        );
      }
      setToast({
        msg: files.length > 1 ? `${files.length} files uploaded.` : 'File uploaded.',
        type: 'success',
      });
      await openProject(p);
    } catch (e) {
      setToast({ msg: 'Upload failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function addLine(kind, amount, vendor) {
    if (!selected) return;
    if (!amount) return;
    try {
      await post(`/api/projects/projects/${selected.id}/${kind}`, {
        amount: Number(amount),
        vendor: vendor || null,
      });
      setToast({ msg: `${kind.charAt(0).toUpperCase() + kind.slice(1)} added.`, type: 'success' });
      await openProject(selected);
    } catch (e) {
      setToast({ msg: 'Operation failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function toggleStatus(key) {
    if (!selected) return;
    const next = { ...(status || {}) };
    next[key] = !next[key];
    try {
      const js = await put(`/api/projects/projects/${selected.id}/status`, next);
      setStatus(js);
      setToast({ msg: 'Status updated.', type: 'success' });
    } catch (e) {
      setToast({ msg: 'Status update failed: ' + (e?.message || e), type: 'error' });
    }
  }

  async function askAI(question) {
    if (!selected) return;
    const r = await post(`/api/projects/projects/${selected.id}/assistant`, { question });
    setAiAnswer(r?.answer || '');
  }

  const filtered = useMemo(() => {
    const s = (list || []).filter((p) =>
      !q ? true : (p.title || '').toLowerCase().includes(q.toLowerCase())
    );
    return s;
  }, [list, q]);

  return (
    <section className="max-w-7xl mx-auto px-4 py-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 /> Project Manager
        </h1>
        <p className="text-gray-600">
          Credit-card style project cards, financial tracking (offers, orders, invoices), WBS, drag-and-drop
          attachments, audit trail, KPIs, alerts, and AI assistant.
        </p>
      </header>

      <div className="flex gap-2 flex-wrap items-center mb-4">
        <input className={inputCls} placeholder="Filter by title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input
          className={inputCls}
          placeholder="New project title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className={btnPrimary} onClick={create} disabled={busy || !title.trim()}>
          <Plus className="inline mr-1" />
          Create
        </button>
        <button className={btn} onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p) => {
          const k = p.kpi || {};
          const st = p.status || {};
          const health = st?.last_analysis?.health || 'ok';
          const color =
            health === 'critical' ? 'ring-rose-300' : health === 'warn' ? 'ring-amber-300' : 'ring-emerald-300';
          return (
            <div key={p.id} className={`relative p-4 rounded-2xl border bg-white shadow-sm ring-2 ${color}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    WBS: {p.wbs_number || '—'} · Budget: {p.budget_amount != null ? gbp(p.budget_amount) : '—'}
                  </div>
                </div>
                <button className="text-blue-600 hover:underline" onClick={() => openProject(p)}>
                  View
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 rounded bg-gray-50">
                  <div className="text-gray-500">Offers</div>
                  <div className="font-semibold">{gbp(k.offers_total || 0)}</div>
                </div>
                <div className="p-2 rounded bg-gray-50">
                  <div className="text-gray-500">Orders</div>
                  <div className="font-semibold">{gbp(k.orders_total || 0)}</div>
                </div>
                <div className="p-2 rounded bg-gray-50">
                  <div className="text-gray-500">Invoices</div>
                  <div className="font-semibold">{gbp(k.invoices_total || 0)}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600 items-center">
                {st.business_case_done ? (
                  <CheckCircle2 className="text-emerald-600" size={14} />
                ) : (
                  <XCircle className="text-rose-600" size={14} />
                )}
                Business case
                {st.pip_done ? (
                  <CheckCircle2 className="text-emerald-600 ml-2" size={14} />
                ) : (
                  <XCircle className="text-rose-600 ml-2" size={14} />
                )}
                PIP
                {st.offers_received ? (
                  <CheckCircle2 className="text-emerald-600 ml-2" size={14} />
                ) : (
                  <XCircle className="text-rose-600 ml-2" size={14} />
                )}
                Offers
                {st.wbs_recorded ? (
                  <CheckCircle2 className="text-emerald-600 ml-2" size={14} />
                ) : (
                  <XCircle className="text-rose-600 ml-2" size={14} />
                )}
                WBS
                {st.orders_placed ? (
                  <CheckCircle2 className="text-emerald-600 ml-2" size={14} />
                ) : (
                  <XCircle className="text-rose-600 ml-2" size={14} />
                )}
                Orders
                {st.invoices_received ? (
                  <CheckCircle2 className="text-emerald-600 ml-2" size={14} />
                ) : (
                  <XCircle className="text-rose-600 ml-2" size={14} />
                )}
                Invoices
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Drawer / Modal (scrollable) ===== */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 overflow-y-auto"
          onClick={() => setSelected(null)}
          aria-modal="true"
          role="dialog"
        >
          <div className="mx-auto my-6 w-full max-w-4xl px-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="text-xl font-semibold">{selected.title}</h3>
                <button className="text-gray-600 hover:text-gray-800" onClick={() => setSelected(null)} title="Close">
                  <X />
                </button>
              </div>

              {/* Body (scrollable) */}
              <div className="p-6 grid gap-6 overflow-y-auto">
                {/* Steps & attachments */}
                <div>
                  <h4 className="font-semibold mb-2">Steps & attachments</h4>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      ['business_case', 'Business case'],
                      ['pip', 'PIP'],
                      ['offer', 'Offers (PDF, emails…)'],
                      ['wbs', 'WBS / Budget'],
                      ['order', 'Orders'],
                      ['invoice', 'Invoices'],
                    ].map(([key, label]) => (
                      <div key={key} className="p-3 rounded border bg-gray-50">
                        <div className="text-sm font-medium mb-2 flex items-center gap-2">
                          <Paperclip size={16} />
                          {label}
                        </div>
                        <DropInput
                          label="Drop files here"
                          onFiles={(files) => uploadFiles(selected, key, files)}
                          accept={'.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'}
                          multiple
                        />
                        <div className="mt-2 text-xs text-gray-500">
                          Files are versioned and the corresponding step is ticked automatically.
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WBS & Budget */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <input
                    className={inputCls}
                    placeholder="WBS number"
                    value={editWbs}
                    onChange={(e) => setEditWbs(e.target.value)}
                    onBlur={saveHeaderFields}
                  />
                  <input
                    className={inputCls}
                    placeholder="Budget amount (£)"
                    type="number"
                    value={editBudget}
                    onChange={(e) => setEditBudget(e.target.value)}
                    onBlur={saveHeaderFields}
                  />
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <ChevronDown size={16} />
                    Milestones: preparation, start, close (1 month each)
                  </div>
                </div>

                {/* Financial lines */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <AddLine title="Add offer" onSubmit={(amount, vendor) => addLine('offer', amount, vendor)} />
                  <AddLine title="Add order" onSubmit={(amount, vendor) => addLine('order', amount, vendor)} />
                  <AddLine title="Add invoice" onSubmit={(amount, vendor) => addLine('invoice', amount, vendor)} />
                </div>

                {/* KPI & Chart */}
                <ProjectCharts analysis={analysis} lines={lines} />

                {/* Alerts (overrun vs offers/budget) */}
                <Alerts analysis={analysis} />

                {/* AI Assistant */}
                <div className="p-4 rounded border bg-indigo-50">
                  <div className="font-semibold mb-2 flex items-center gap-2">
                    <Bot /> AI Assistant
                  </div>
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      placeholder="Ask a question (e.g., where is the risk of overrun?)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') askAI(e.currentTarget.value);
                      }}
                    />
                    <button
                      className={btn}
                      onClick={() => askAI('Quick risk assessment with prioritized actions')}
                    >
                      Quick advice
                    </button>
                  </div>
                  {aiAnswer && <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{aiAnswer}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <Toast {...toast} onClose={() => setToast(null)} />
    </section>
  );
}

/* ------------------------------ Subcomponents ------------------------------ */
function AddLine({ title, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  return (
    <div className="p-3 rounded border bg-white">
      <div className="text-sm font-medium mb-2">{title}</div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="Amount £"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Vendor (optional)"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
        <button
          className={btnPrimary}
          onClick={() => {
            if (!amount) return;
            onSubmit(amount, vendor);
            setAmount('');
            setVendor('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function formatMonth(d) {
  const dt = new Date(d);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
}

function ProjectCharts({ analysis, lines }) {
  const data = useMemo(() => {
    const inv = (lines?.invoices || []).slice().reverse();
    let cum = 0;
    const labels = [];
    const values = [];
    for (const x of inv) {
      cum += Number(x.amount) || 0;
      labels.push(formatMonth(x.invoiced_at || Date.now()));
      values.push(cum);
    }
    return {
      labels,
      datasets: [{ label: 'Cumulative invoices (£)', data: values, tension: 0.2 }],
    };
  }, [lines]);

  return (
    <div className="grid gap-4">
      <div className="p-4 rounded border bg-white">
        <div className="font-semibold mb-2">Cumulative invoice curve</div>
        <Line data={data} options={{ responsive: true, scales: { y: { beginAtZero: true } } }} />
      </div>
      {analysis && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Offers</div>
            <div className="text-xl font-semibold">{gbp(analysis.variance_vs_offer || 0)}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-sm text-gray-500">Variance vs Budget</div>
            <div className="text-xl font-semibold">{gbp(analysis.variance_vs_budget || 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Alerts({ analysis }) {
  if (!analysis) return null;
  const items = [];
  if (analysis.risk_overrun_offer) items.push({ level: 'warn', text: 'Overrun risk vs Offers (>5%).' });
  if (analysis.risk_overrun_budget) items.push({ level: 'error', text: 'Likely overrun vs Budget (>5%).' });
  if (!items.length) items.push({ level: 'ok', text: 'No alerts — situation under control.' });

  return (
    <div className="grid gap-2">
      {items.map((a, i) => (
        <div
          key={i}
          className={`px-3 py-2 rounded border flex items-center gap-2 ${
            a.level === 'error'
              ? 'bg-rose-100 text-rose-800 border-rose-200'
              : a.level === 'warn'
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200'
          }`}
        >
          {a.level === 'error' ? <AlertTriangle /> : a.level === 'warn' ? <AlertTriangle /> : <CheckCircle2 />}
          <span className="text-sm">{a.text}</span>
        </div>
      ))}
    </div>
  );
}
