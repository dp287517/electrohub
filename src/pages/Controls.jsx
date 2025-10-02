// src/pages/Controls.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { get, post, del, upload } from '../lib/api.js';
import {
  Plus, Trash2, CheckCircle2, History as HistoryIcon, BarChart2, Calendar, Sparkles, FileText,
  Layers3, ShieldAlert, Building2, Filter, Upload as UploadIcon, X, RefreshCcw, ChevronLeft, ChevronRight
} from 'lucide-react';

/* ------------------ Petits composants UI ------------------ */
function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      type="button"
    >
      {children}
    </button>
  );
}

function Badge({ tone='default', children }) {
  const cls = {
    default: 'bg-gray-100 text-gray-800',
    ok: 'bg-green-100 text-green-800',
    warn: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
  }[tone] || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{children}</span>;
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-48 text-sm text-gray-600">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Input({ type='text', ...props }) {
  return <input type={type} {...props} className={`h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm ${props.className||''}`} />;
}

function Select({ children, ...props }) {
  return <select {...props} className={`h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm ${props.className||''}`}>{children}</select>;
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200" type="button"><X size={18} /></button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">{children}</div>
        <div className="px-4 py-3 border-t bg-gray-50">{footer}</div>
      </div>
    </div>
  );
}

/* ------------------ Pagination ------------------ */
function Pagination({ page, totalPages, onChange }) {
  return (
    <div className="flex justify-end gap-2 mt-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 hover:bg-gray-300"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="px-3 py-1 text-sm">{page} of {totalPages}</span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="px-3 py-1 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 hover:bg-gray-300"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ------------------ Constantes côté front ------------------ */
const STATUS_OPTIONS = ['open', 'completed', 'overdue'];

/* ------------------ Page principale ------------------ */
export default function Controls() {
  const [tab, setTab] = useState('controls'); // controls | catalog | analytics | history | roadmap | tsd
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtres tâches
  const [fBuilding, setFBuilding] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [q, setQ] = useState('');

  // Données principales
  const [buildings, setBuildings] = useState([]);
  const [types, setTypes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [history, setHistory] = useState([]);
  const [roadmap, setRoadmap] = useState([]);
  const [library, setLibrary] = useState({ types: [], library: {} });
  const [totalTasks, setTotalTasks] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Catalogues équipements & Non présent
  const [catalog, setCatalog] = useState([]);
  const [notPresent, setNotPresent] = useState([]);

  // Détail tâche & PJ
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskItem, setTaskItem] = useState(null);
  const [equipOfTask, setEquipOfTask] = useState(null);
  const [resultForm, setResultForm] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [aiRiskScore, setAiRiskScore] = useState(null);
  const [aiTags, setAiTags] = useState([]);

  // Modaux
  const [openAddEquip, setOpenAddEquip] = useState(false);
  const [equipDraft, setEquipDraft] = useState({ building: '', equipment_type: '', name: '', code: '' });

  const [openDeclareNP, setOpenDeclareNP] = useState(false);
  const [npDraft, setNpDraft] = useState({ building: '', equipment_type: '', note: '' });

  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState('');

  function notify(msg, type = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  /* ------------------ Charges initiales ------------------ */
  async function loadCatalog() {
    const data = await get('/api/controls/catalog');
    setCatalog(data.data || []);
    setBuildings(data.buildings || []);
    setTypes(data.types || []);
  }

  async function loadTasks(pageNum = 1) {
    setLoading(true);
    const params = {
      site: 'Default',
      building: fBuilding || '',
      type: fType || '',
      status: fStatus || '',
      q: q || '',
      page: pageNum,
      pageSize
    };
    const data = await get('/api/controls/tasks', params);
    setTasks(data.data || []);
    setTotalTasks(data.total || 0);
    setLoading(false);
  }

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([
        loadCatalog(),
        loadTasks(page),
        get('/api/controls/analytics').then(setAnalytics),
        get('/api/controls/history', { page, pageSize }).then(setHistory),
        get('/api/controls/roadmap').then(setRoadmap),
        get('/api/controls/library').then(setLibrary),
        get('/api/controls/not-present').then(setNotPresent)
      ]);
    } catch (e) {
      notify('Failed to load data', 'error');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, [fBuilding, fType, fStatus, q, page]);

  /* ------------------ Actions ------------------ */
  const createEquip = async () => {
    if (!equipDraft.building || !equipDraft.equipment_type || !equipDraft.name) {
      notify('Missing required fields', 'error');
      return;
    }
    try {
      await post('/api/controls/catalog', equipDraft);
      setOpenAddEquip(false);
      setEquipDraft({ building: '', equipment_type: '', name: '', code: '' });
      loadCatalog();
      notify('Equipment added', 'success');
    } catch (e) {
      notify('Failed to add equipment', 'error');
    }
  };

  const declareNotPresent = async () => {
    if (!npDraft.building || !npDraft.equipment_type) {
      notify('Missing required fields', 'error');
      return;
    }
    try {
      await post('/api/controls/not-present', { ...npDraft, site: 'Default' });
      setOpenDeclareNP(false);
      setNpDraft({ building: '', equipment_type: '', note: '' });
      loadAll();
      notify('Declared as not present', 'success');
    } catch (e) {
      notify('Failed to declare', 'error');
    }
  };

  const assessNotPresent = async (id) => {
    try {
      await post(`/api/controls/not-present/${id}/assess`, { user: 'current_user', note: 'Annual assessment' });
      loadAll();
      notify('Assessment completed', 'success');
    } catch (e) {
      notify('Failed to assess', 'error');
    }
  };

  const deleteEquip = async (id) => {
    if (window.confirm('Are you sure you want to delete this equipment?')) {
      try {
        await del(`/api/controls/catalog/${id}`);
        loadCatalog();
        notify('Equipment deleted', 'success');
      } catch (e) {
        notify('Failed to delete equipment', 'error');
      }
    }
  };

  const handleTaskSelect = async (taskId) => {
    const data = await get(`/api/controls/tasks/${taskId}/details`);
    setSelectedTask(data);
    setTaskItem(data.tsd_item);
    setEquipOfTask(data.equipment);
    setResultForm(data.results || {});
    setAttachments(data.attachments || []);
    setAiRiskScore(data.ai_risk_score || null);
    setAiTags(data.results?.verdict?.tags || []);
  };

  const saveResult = async () => {
    if (!selectedTask) return;
    try {
      await post(`/api/controls/tasks/${selectedTask.id}/complete`, {
        user: 'current_user',
        results: resultForm,
        ai_risk_score: aiRiskScore
      });
      setSelectedTask(null);
      loadTasks(page);
      notify('Task completed', 'success');
    } catch (e) {
      notify('Failed to complete task', 'error');
    }
  };

  const uploadFiles = async (event) => {
    if (!selectedTask) return;
    const files = event.target.files;
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));
    try {
      await upload(`/api/controls/tasks/${selectedTask.id}/upload`, formData);
      const data = await get(`/api/controls/tasks/${selectedTask.id}/details`);
      setAttachments(data.attachments || []);
      notify('Files uploaded', 'success');
      // Trigger AI analysis
      analyzePhotos();
    } catch (e) {
      notify('Failed to upload files', 'error');
    }
  };

  const deleteAttachment = async (attId) => {
    if (!selectedTask) return;
    if (window.confirm('Are you sure you want to delete this attachment?')) {
      try {
        await del(`/api/controls/attachments/${selectedTask.id}/${attId}`);
        const data = await get(`/api/controls/tasks/${selectedTask.id}/details`);
        setAttachments(data.attachments || []);
        notify('Attachment deleted', 'success');
      } catch (e) {
        notify('Failed to delete attachment', 'error');
      }
    }
  };

  const analyzePhotos = async () => {
    if (!selectedTask || !attachments.length) return;
    setAiBusy(true);
    const formData = new FormData();
    attachments.forEach((att, idx) => {
      const blob = new Blob([att.data], { type: att.mimetype });
      formData.append('files', blob, att.filename);
    });
    try {
      const response = await post('/api/controls/ai/vision-score', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setAiRiskScore(response.ai_risk_score);
      setAiTags(response.tags);
      notify('Photo analysis completed', 'success');
    } catch (e) {
      notify('Photo analysis failed', 'error');
    }
    setAiBusy(false);
  };

  const getAIAssistant = async () => {
    if (!selectedTask) return;
    setAiBusy(true);
    try {
      const lang = navigator.language || 'en';
      const response = await post('/api/controls/ai/assistant', { mode: 'text', text: 'Provide maintenance advice for this task', lang });
      setAiReply(response.reply);
      notify('AI advice received', 'success');
    } catch (e) {
      notify('Failed to get AI advice', 'error');
    }
    setAiBusy(false);
  };

  /* ------------------ Render ------------------ */
  return (
    <section className="p-6 bg-gray-50 min-h-screen">
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        } text-white text-sm`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex justify-between items-center">
        <div className="flex space-x-2">
          <Tab active={tab === 'controls'} onClick={() => setTab('controls')}>Controls</Tab>
          <Tab active={tab === 'catalog'} onClick={() => setTab('catalog')}>Catalog</Tab>
          <Tab active={tab === 'analytics'} onClick={() => setTab('analytics')}>Analytics</Tab>
          <Tab active={tab === 'history'} onClick={() => setTab('history')}>History</Tab>
          <Tab active={tab === 'roadmap'} onClick={() => setTab('roadmap')}>Roadmap</Tab>
          <Tab active={tab === 'tsd'} onClick={() => setTab('tsd')}>TSD Library</Tab>
        </div>
        {tab === 'controls' && (
          <button
            onClick={() => loadTasks(page)}
            className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <RefreshCcw size={16} />
          </button>
        )}
      </div>

      {loading && <div className="text-center py-4">Loading...</div>}

      {/* ------------------ Controls Tab ------------------ */}
      {tab === 'controls' && (
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
            <Input
              placeholder="Search..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full sm:w-64"
            />
            <Select value={fBuilding} onChange={(e) => setFBuilding(e.target.value)}>
              <option value="">All Buildings</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
            <Select value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">All Types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">All Status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="space-y-4">
            {tasks.map(t => (
              <div
                key={t.id}
                className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer"
                onClick={() => handleTaskSelect(t.id)}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{t.title}</span>
                  <Badge tone={t.status === 'overdue' ? 'danger' : t.status === 'completed' ? 'ok' : 'default'}>{t.status}</Badge>
                </div>
                <div className="text-sm text-gray-600">Due: {t.due_date}</div>
              </div>
            ))}
            {tasks.length === 0 && <div className="text-center py-4 text-gray-500">No tasks found</div>}
          </div>
          <Pagination
            page={page}
            totalPages={Math.ceil(totalTasks / pageSize)}
            onChange={setPage}
          />
        </div>
      )}

      {/* ------------------ Catalog Tab ------------------ */}
      {tab === 'catalog' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Equipment Catalog</h2>
          <button
            onClick={() => setOpenAddEquip(true)}
            className="mb-4 px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={16} /> Add Equipment
          </button>
          <div className="space-y-4">
            {catalog.map(e => (
              <div key={e.id} className="p-4 border rounded-lg flex justify-between items-center">
                <div>
                  <div>{e.name} ({e.equipment_type})</div>
                  <div className="text-sm text-gray-600">Building: {e.building}, Code: {e.code || 'N/A'}</div>
                </div>
                <button
                  onClick={() => deleteEquip(e.id)}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {catalog.length === 0 && <div className="text-center py-4 text-gray-500">No equipment</div>}
          </div>
        </div>
      )}

      {/* ------------------ Analytics Tab ------------------ */}
      {tab === 'analytics' && analytics && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Analytics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h3>Total Tasks</h3>
              <p className="text-2xl">{analytics.total}</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3>Completed</h3>
              <p className="text-2xl">{analytics.completed}</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3>Open</h3>
              <p className="text-2xl">{analytics.open}</p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3>Overdue</h3>
              <p className="text-2xl">{analytics.overdue}</p>
            </div>
          </div>
          <div className="mt-4">
            <h3>Gaps</h3>
            <ul className="list-disc pl-5">
              {analytics.gaps.map(g => <li key={g}>{g}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* ------------------ History Tab ------------------ */}
      {tab === 'history' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">History</h2>
          <div className="space-y-4">
            {history.map(h => (
              <div key={h.id} className="p-4 border rounded-lg">
                <div>Task: {h.results?.title || 'N/A'}</div>
                <div className="text-sm text-gray-600">User: {h.user}, Date: {new Date(h.date).toLocaleString()}</div>
                <div>Result: {h.results?.verdict?.status || 'N/A'}</div>
              </div>
            ))}
            {history.length === 0 && <div className="text-center py-4 text-gray-500">No history</div>}
          </div>
          <Pagination
            page={page}
            totalPages={Math.ceil(history.length / pageSize)}
            onChange={setPage}
          />
        </div>
      )}

      {/* ------------------ Roadmap Tab ------------------ */}
      {tab === 'roadmap' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Roadmap</h2>
          <div className="space-y-4">
            {roadmap.map(r => (
              <div key={r.id} className="p-4 border rounded-lg">
                <div>{r.title}</div>
                <div className="text-sm text-gray-600">Start: {r.start}, End: {r.end}</div>
              </div>
            ))}
            {roadmap.length === 0 && <div className="text-center py-4 text-gray-500">No roadmap data</div>}
          </div>
        </div>
      )}

      {/* ------------------ TSD Tab ------------------ */}
      {tab === 'tsd' && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">TSD Library</h2>
          <div className="space-y-6">
            {library.types.map(tp => (
              <div key={tp} className="border rounded-lg p-3">
                <div className="font-semibold mb-2">{tp}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="p-2">Label</th>
                      <th className="p-2">Field</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Comparator</th>
                      <th className="p-2">Threshold</th>
                      <th className="p-2">Unit</th>
                      <th className="p-2">Frequency (months)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(library.library[tp] || []).map(it => (
                      <tr key={it.id} className="border-b">
                        <td className="p-2">{it.label}</td>
                        <td className="p-2">{it.field}</td>
                        <td className="p-2">{it.type}</td>
                        <td className="p-2">{it.comparator || '—'}</td>
                        <td className="p-2">{it.threshold != null ? String(it.threshold) : '—'}</td>
                        <td className="p-2">{it.unit || '—'}</td>
                        <td className="p-2">{it.frequency_months}</td>
                      </tr>
                    ))}
                    {(library.library[tp] || []).length === 0 && (
                      <tr><td className="p-2 text-gray-500" colSpan={7}>No items</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------ Task Detail Modal ------------------ */}
      <Modal
        open={!!selectedTask}
        title={selectedTask?.title || 'Task Details'}
        onClose={() => setSelectedTask(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              onClick={() => setSelectedTask(null)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              onClick={saveResult}
              disabled={!selectedTask}
            >
              Save
            </button>
          </div>
        }
      >
        {selectedTask && (
          <div className="space-y-4">
            <Row label="Equipment">{equipOfTask?.name || 'N/A'}</Row>
            <Row label="Type">{selectedTask.equipment_type}</Row>
            <Row label="Status">
              <Select value={resultForm.status || selectedTask.status} onChange={(e) => setResultForm({ ...resultForm, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Row>
            {taskItem && taskItem.type === 'number' && (
              <Row label={taskItem.label}>
                <Input
                  type="number"
                  value={resultForm[taskItem.field] || ''}
                  onChange={(e) => setResultForm({ ...resultForm, [taskItem.field]: e.target.value })}
                  placeholder={`Enter ${taskItem.unit || 'value'}`}
                />
              </Row>
            )}
            {taskItem && taskItem.type === 'check' && (
              <Row label={taskItem.label}>
                <input
                  type="checkbox"
                  checked={resultForm[taskItem.field] || false}
                  onChange={(e) => setResultForm({ ...resultForm, [taskItem.field]: e.target.checked })}
                />
              </Row>
            )}
            <Row label="Attachments">
              <div className="flex gap-2">
                <input type="file" multiple onChange={uploadFiles} className="hidden" id="fileUpload" />
                <label htmlFor="fileUpload" className="px-3 py-1 bg-green-600 text-white rounded-md cursor-pointer hover:bg-green-700">
                  <UploadIcon size={16} /> Upload
                </label>
                {attachments.map((a, idx) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <a href={`/api/controls/tasks/${selectedTask.id}/attachments/${idx}`} download={a.filename} className="text-blue-600 underline">
                      {a.filename}
                    </a>
                    <button onClick={() => deleteAttachment(idx)} className="text-red-600 hover:text-red-800">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </Row>
            <Row label="AI Risk Score">
              <input
                type="number"
                value={aiRiskScore || ''}
                onChange={(e) => setAiRiskScore(e.target.value ? Number(e.target.value) : null)}
                step="0.01"
                min="0"
                max="1"
                className="w-20"
                placeholder="0.00-1.00"
              />
              {aiTags.length > 0 && <span className="ml-2 text-sm text-gray-600">Tags: {aiTags.join(', ')}</span>}
              <button
                onClick={analyzePhotos}
                disabled={aiBusy || !attachments.length}
                className="ml-2 px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {aiBusy ? 'Analyzing...' : 'Analyze Photos'}
              </button>
            </Row>
            <Row label="AI Assistant">
              <button
                onClick={getAIAssistant}
                disabled={aiBusy}
                className="px-2 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                {aiBusy ? 'Thinking...' : 'Get Advice'}
              </button>
              {aiReply && <div className="mt-2 text-sm text-gray-700">{aiReply}</div>}
            </Row>
          </div>
        )}
      </Modal>

      {/* ------------------ Add Equipment Modal ------------------ */}
      <Modal
        open={openAddEquip}
        title="Add Equipment"
        onClose={() => setOpenAddEquip(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenAddEquip(false)} type="button">Cancel</button>
            <button className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700" onClick={createEquip} type="button">Add</button>
          </div>
        }
      >
        <div className="space-y-3">
          <Row label="Building">
            <Select value={equipDraft.building} onChange={(e) => setEquipDraft(prev => ({ ...prev, building: e.target.value }))}>
              <option value="">Choose...</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select value={equipDraft.equipment_type} onChange={(e) => setEquipDraft(prev => ({ ...prev, equipment_type: e.target.value }))}>
              <option value="">Choose...</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Row>
          <Row label="Name">
            <Input value={equipDraft.name} onChange={(e) => setEquipDraft(prev => ({ ...prev, name: e.target.value }))} placeholder="Displayed name" />
          </Row>
          <Row label="Code">
            <Input value={equipDraft.code} onChange={(e) => setEquipDraft(prev => ({ ...prev, code: e.target.value }))} placeholder="Internal code (optional)" />
          </Row>
        </div>
      </Modal>

      {/* ------------------ Declare Not Present Modal ------------------ */}
      <Modal
        open={openDeclareNP}
        title="Declare as Not Present"
        onClose={() => setOpenDeclareNP(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button className="h-9 px-3 rounded-md border text-sm hover:bg-gray-50" onClick={() => setOpenDeclareNP(false)} type="button">Cancel</button>
            <button className="h-9 px-3 rounded-md bg-gray-800 text-white text-sm hover:bg-black" onClick={declareNotPresent} type="button">Declare</button>
          </div>
        }
      >
        <div className="space-y-3">
          <Row label="Building">
            <Select value={npDraft.building} onChange={(e) => setNpDraft(prev => ({ ...prev, building: e.target.value }))}>
              <option value="">Choose...</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select value={npDraft.equipment_type} onChange={(e) => setNpDraft(prev => ({ ...prev, equipment_type: e.target.value }))}>
              <option value="">Choose...</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Row>
          <Row label="Note">
            <Input value={npDraft.note} onChange={(e) => setNpDraft(prev => ({ ...prev, note: e.target.value }))} placeholder="Context/remediations..." />
          </Row>
        </div>
      </Modal>
    </section>
  );
}
