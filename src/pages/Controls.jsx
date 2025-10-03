import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { motion } from "framer-motion";
import { Plus, X, Upload, RefreshCw } from "lucide-react";

export default function Controls() {
  const [tasks, setTasks] = useState([]);
  const [entities, setEntities] = useState([]);
  const [notPresent, setNotPresent] = useState([]);
  const [library, setLibrary] = useState({});
  const [selectedTask, setSelectedTask] = useState(null);
  const [attachments, setAttachments] = useState([]);

  // ---------------- Fetch helpers ----------------
  async function loadData() {
    const [t, e, n, l] = await Promise.all([
      api.controls.listTasks(),
      api.controls.listEntities(),
      api.controls.listNotPresent(),
      api.controls.library(),
    ]);
    setTasks(t.data || []);
    setEntities(e.data || []);
    setNotPresent(n || []);
    setLibrary(l.library || {});
  }

  useEffect(() => { loadData(); }, []);

  // ---------------- Attachments ----------------
  async function loadAttachments(taskId) {
    const list = await api.controls.listAttachments(taskId);
    setAttachments(list);
  }

  async function handleUpload(taskId, files) {
    const formData = new FormData();
    for (const f of files) formData.append("files", f);
    await api.controls.uploadAttachment(taskId, formData);
    loadAttachments(taskId);
  }

  async function handleDeleteAttachment(taskId, attId) {
    await api.controls.removeAttachment(taskId, attId);
    loadAttachments(taskId);
  }

  // ---------------- Render ----------------
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">⚡ Controls Management</h1>
        <Button variant="outline" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="tasks">
        <TabsList className="grid grid-cols-4 md:grid-cols-7 gap-2">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="notpresent">Not Present</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ---------------- Tasks ---------------- */}
        <TabsContent value="tasks">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tasks.map((t) => (
              <Card key={t.id} className="cursor-pointer hover:shadow-md transition"
                onClick={() => { setSelectedTask(t); loadAttachments(t.id); }}>
                <CardContent className="p-4">
                  <h2 className="font-semibold">{t.task_name}</h2>
                  <p className="text-sm text-gray-500">{t.status} — next: {t.next_control}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---------------- Catalog ---------------- */}
        <TabsContent value="catalog">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entities.map((e) => (
              <Card key={e.id}>
                <CardContent className="p-4">
                  <h2 className="font-semibold">{e.name}</h2>
                  <p className="text-sm text-gray-500">{e.equipment_type} — {e.building}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---------------- Not Present ---------------- */}
        <TabsContent value="notpresent">
          <div className="grid gap-4 md:grid-cols-2">
            {notPresent.map((n) => (
              <Card key={n.id}>
                <CardContent className="p-4">
                  <h2 className="font-semibold">{n.equipment_type}</h2>
                  <p className="text-sm text-gray-500">Building {n.building}</p>
                  <p className="text-xs">Note: {n.note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---------------- Attachments ---------------- */}
        <TabsContent value="attachments">
          {selectedTask ? (
            <div>
              <h2 className="font-bold mb-2">{selectedTask.task_name}</h2>
              <div className="flex gap-2">
                <input type="file" multiple onChange={(e) => handleUpload(selectedTask.id, e.target.files)} />
              </div>
              <ul className="mt-4 space-y-2">
                {attachments.map((a) => (
                  <li key={a.id} className="flex justify-between items-center border p-2 rounded">
                    <a href={`/api/controls/tasks/${selectedTask.id}/attachments/${a.id}`} className="text-blue-600 underline" download={a.filename}>
                      {a.filename}
                    </a>
                    <button onClick={() => handleDeleteAttachment(selectedTask.id, a.id)}>
                      <X className="w-4 h-4 text-red-600" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-gray-500">Select a task first.</p>
          )}
        </TabsContent>

        {/* ---------------- Library ---------------- */}
        <TabsContent value="library">
          {Object.entries(library).map(([type, items]) => (
            <div key={type} className="mb-6">
              <h2 className="text-lg font-bold mb-2">{type}</h2>
              <div className="space-y-2">
                {items.map((i) => (
                  <div key={i.id} className="border p-2 rounded bg-gray-50">
                    <strong>{i.label}</strong> — every {i.frequency_months} months
                    <p className="text-xs text-gray-500">{i.procedure_md}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* ---------------- History ---------------- */}
        <TabsContent value="history">
          <p className="text-gray-500">TODO: call api.controls.history() & render results</p>
        </TabsContent>

        {/* ---------------- Analytics ---------------- */}
        <TabsContent value="analytics">
          <p className="text-gray-500">TODO: charts (compliance rate, overdue tasks, etc.)</p>
        </TabsContent>
      </Tabs>

      {/* ---------------- Task Detail Modal ---------------- */}
      {selectedTask && (
        <Modal open={!!selectedTask} onClose={() => setSelectedTask(null)}>
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-6 rounded-xl shadow-xl max-w-lg mx-auto">
            <h2 className="text-xl font-bold mb-2">{selectedTask.task_name}</h2>
            <p>Status: {selectedTask.status}</p>
            <p>Next: {selectedTask.next_control}</p>
            <Button variant="outline" className="mt-4" onClick={() => setSelectedTask(null)}>Close</Button>
          </motion.div>
        </Modal>
      )}
    </div>
  );
}
