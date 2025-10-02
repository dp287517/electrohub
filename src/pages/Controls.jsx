// src/pages/Controls.jsx
import { useEffect, useState } from "react";
import { get, post, upload } from "../lib/api.js";
import {
  Plus, CheckCircle, XCircle, Upload, History, BarChart2, Calendar, Sparkles, FileText
} from "lucide-react";
import { Line, Pie } from "react-chartjs-2";
import "chart.js/auto";

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium ${
        active ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

export default function Controls() {
  const [tab, setTab] = useState("controls");
  const [suggests, setSuggests] = useState({});
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [checklistResults, setChecklistResults] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [roadmap, setRoadmap] = useState([]);
  const [aiReply, setAiReply] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // ---------- LOAD DATA ----------
  useEffect(() => {
    get("/api/controls/suggests").then(setSuggests).catch(console.error);
    loadTasks();
    loadHistory();
    loadAnalytics();
    loadRoadmap();
  }, []);

  const loadTasks = () => get("/api/controls/tasks").then(setTasks).catch(console.error);
  const loadHistory = () => get("/api/controls/history").then(setHistory).catch(console.error);
  const loadAnalytics = () => get("/api/controls/analytics").then(setAnalytics).catch(console.error);
  const loadRoadmap = () => get("/api/controls/roadmap").then(setRoadmap).catch(console.error);

  // ---------- TASK ACTIONS ----------
  const openTask = async (t) => {
    const details = await get(`/api/controls/tasks/${t.id}/details`);
    setSelectedTask(details);
    setChecklistResults({});
    const atts = await get(`/api/controls/tasks/${t.id}/attachments`);
    setAttachments(atts || []);
  };

  const completeTask = async () => {
    if (!selectedTask) return;
    await post(`/api/controls/tasks/${selectedTask.id}/complete`, {
      user: "demo_user",
      results: checklistResults
    });
    setSelectedTask(null);
    loadTasks();
    loadHistory();
  };

  const uploadFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    const formData = new FormData();
    files.forEach(f => formData.append("files", f));
    await upload(`/api/controls/tasks/${selectedTask.id}/upload`, formData);
    const atts = await get(`/api/controls/tasks/${selectedTask.id}/attachments`);
    setAttachments(atts || []);
  };

  // ---------- AI ----------
  const askAI = async (msg) => {
    setAiBusy(true);
    try {
      const res = await post("/api/controls/ai/assistant", { mode: "text", text: msg });
      setAiReply(res.reply || "No response");
    } catch {
      setAiReply("AI error");
    } finally {
      setAiBusy(false);
    }
  };

  // ---------- RENDER ----------
  return (
    <section className="container mx-auto py-8">
      <div className="flex gap-2 mb-6">
        <TabButton active={tab === "controls"} onClick={() => setTab("controls")}>
          <CheckCircle size={16} className="inline mr-1" /> Controls
        </TabButton>
        <TabButton active={tab === "roadmap"} onClick={() => setTab("roadmap")}>
          <Calendar size={16} className="inline mr-1" /> Roadmap
        </TabButton>
        <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")}>
          <BarChart2 size={16} className="inline mr-1" /> Analytics
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          <History size={16} className="inline mr-1" /> History
        </TabButton>
      </div>

      {/* ---------- CONTROLS TAB ---------- */}
      {tab === "controls" && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Task list */}
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold text-lg mb-3">Tasks</h2>
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  onClick={() => openTask(t)}
                  className="p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                >
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-gray-500">{t.building} • {t.category}</div>
                  <div className="text-xs">
                    Status:{" "}
                    {t.locked ? (
                      <span className="text-green-600">Completed</span>
                    ) : (
                      <span className="text-orange-600">Open</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Task detail */}
          <div className="bg-white rounded-xl shadow p-4">
            {selectedTask ? (
              <>
                <h2 className="font-semibold text-lg mb-3">{selectedTask.title}</h2>
                <ul className="space-y-2 mb-4">
                  {selectedTask.checklist.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={selectedTask.locked}
                        onChange={(e) =>
                          setChecklistResults((prev) => ({
                            ...prev,
                            [item]: e.target.checked
                          }))
                        }
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mb-3">
                  <input type="file" multiple onChange={uploadFiles} disabled={selectedTask.locked} />
                  <ul className="mt-2 text-sm text-gray-600">
                    {attachments.map((a) => (
                      <li key={a.id}>📎 {a.filename} ({a.size} bytes)</li>
                    ))}
                  </ul>
                </div>
                {!selectedTask.locked && (
                  <button
                    onClick={completeTask}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Complete Task
                  </button>
                )}
              </>
            ) : (
              <p className="text-gray-500">Select a task to see details</p>
            )}
          </div>
        </div>
      )}

      {/* ---------- ROADMAP ---------- */}
      {tab === "roadmap" && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">Roadmap</h2>
          <ul className="divide-y">
            {roadmap.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-medium">{r.title}</span>
                <span className="ml-2 text-gray-500 text-sm">
                  {r.start} → {r.end}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- ANALYTICS ---------- */}
      {tab === "analytics" && analytics && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold mb-2">Status Overview</h2>
            <Pie
              data={{
                labels: ["Completed", "Open"],
                datasets: [
                  {
                    data: [analytics.completed, analytics.open],
                    backgroundColor: ["#10B981", "#F59E0B"]
                  }
                ]
              }}
            />
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-semibold mb-2">Tasks per Building</h2>
            <Line
              data={{
                labels: Object.keys(analytics.byBuilding),
                datasets: [
                  {
                    label: "Tasks",
                    data: Object.values(analytics.byBuilding),
                    borderColor: "#3B82F6",
                    backgroundColor: "#93C5FD"
                  }
                ]
              }}
            />
          </div>
        </div>
      )}

      {/* ---------- HISTORY ---------- */}
      {tab === "history" && (
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-lg mb-3">History</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Task ID</th>
                <th className="p-2">User</th>
                <th className="p-2">Date</th>
                <th className="p-2">Results</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="p-2">{h.task_id}</td>
                  <td className="p-2">{h.user}</td>
                  <td className="p-2">{h.date}</td>
                  <td className="p-2 text-gray-600">{JSON.stringify(h.results)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <a
            href="/api/controls/history/export"
            className="mt-4 inline-flex items-center px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
          >
            <FileText size={16} className="mr-2" /> Export CSV
          </a>
        </div>
      )}

      {/* ---------- AI Assistant ---------- */}
      <div className="bg-white rounded-xl shadow p-4 mt-6">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Sparkles size={18} /> AI Assistant
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 border rounded-lg px-3 py-2"
            placeholder="Ask AI..."
            onKeyDown={(e) => e.key === "Enter" && askAI(e.target.value)}
          />
          <button
            onClick={() => askAI("Give me a tip for HV inspection")}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            disabled={aiBusy}
          >
            Ask
          </button>
        </div>
        {aiReply && <p className="mt-2 text-gray-700">{aiReply}</p>}
      </div>
    </section>
  );
}
