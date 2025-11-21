// src/pages/Dcf.jsx
import React, { useEffect, useState } from "react";
import api from "../lib/api.js";

export default function DcfPage() {
  const [tab, setTab] = useState("chat"); // "files" | "chat"
  const [excelFile, setExcelFile] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // ---------------------------------------------------------------------------
  // Load fichiers DCF
  // ---------------------------------------------------------------------------
  async function refreshFiles() {
    try {
      const res = await api.dcf.listFiles();
      const fs = res?.files || [];
      setFiles(fs);
      if (!selectedFileId && fs[0]) {
        setSelectedFileId(fs[0].id);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du chargement des fichiers DCF");
    }
  }

  useEffect(() => {
    refreshFiles();
  }, []);

  // ---------------------------------------------------------------------------
  // Upload Excel
  // ---------------------------------------------------------------------------
  async function handleUploadExcel() {
    if (!excelFile) return;
    setUploadBusy(true);
    setError("");
    try {
      const res = await api.dcf.uploadExcel(excelFile);
      if (res?.file?.id) {
        setSelectedFileId(res.file.id);
      }
      await refreshFiles();
      setTab("chat");
      setExcelFile(null);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'envoi du fichier Excel");
    } finally {
      setUploadBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Envoi message chat
  // ---------------------------------------------------------------------------
  async function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    setSending(true);
    setError("");

    try {
      let attachmentIds = [];
      if (attachments.length) {
        const ret = await api.dcf.uploadAttachments(attachments);
        attachmentIds = (ret?.items || []).map((it) => it.id);
      }

      const res = await api.dcf.chat({
        sessionId,
        message: input.trim(),
        fileId: selectedFileId,
        attachmentIds,
      });

      const newSessionId = res?.sessionId || sessionId;
      if (!sessionId && newSessionId) setSessionId(newSessionId);

      const answer = res?.answer || res?.text || "";

      setMessages((msgs) => [
        ...msgs,
        { role: "user", content: input.trim() },
        { role: "assistant", content: answer },
      ]);

      setInput("");
      setAttachments([]);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'appel à l'IA");
    } finally {
      setSending(false);
    }
  }

  function onAttachmentChange(e) {
    const files = Array.from(e.target.files || []);
    setAttachments(files);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assistant DCF – SAP</h1>
          <p className="text-sm text-gray-600">
            Importe tes fichiers DCF (XLSM/XLSX) et discute avec l&apos;IA pour
            savoir quoi remplir et où, étape par étape.
          </p>
        </div>
      </header>

      {/* Onglets */}
      <div className="border-b border-gray-200 flex gap-4">
        <button
          className={`pb-2 text-sm font-medium border-b-2 ${
            tab === "chat"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("chat")}
        >
          Assistant DCF
        </button>
        <button
          className={`pb-2 text-sm font-medium border-b-2 ${
            tab === "files"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("files")}
        >
          Fichiers DCF SAP
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      {tab === "files" ? (
        <section className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
            <h2 className="text-lg font-medium">Importer un fichier DCF</h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <input
                type="file"
                accept=".xls,.xlsx,.xlsm"
                onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
                className="block w-full text-sm"
              />
              <button
                onClick={handleUploadExcel}
                disabled={!excelFile || uploadBusy}
                className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-60"
              >
                {uploadBusy ? "Envoi…" : "Importer"}
              </button>
            </div>
            {excelFile && (
              <p className="text-xs text-gray-500">
                Fichier sélectionné : {excelFile.name}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="text-lg font-medium mb-3">Historique des fichiers</h2>
            {files.length === 0 ? (
              <p className="text-sm text-gray-500">
                Aucun fichier DCF importé pour le moment.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1">Fichier</th>
                    <th className="py-1">Feuilles</th>
                    <th className="py-1">Importé le</th>
                    <th className="py-1 text-right">Contexte</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr
                      key={f.id}
                      className={`border-b last:border-0 ${
                        selectedFileId === f.id ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="py-1 pr-2">{f.filename}</td>
                      <td className="py-1 pr-2 text-xs text-gray-600">
                        {(f.sheet_names || []).join(", ")}
                      </td>
                      <td className="py-1 pr-2 text-xs text-gray-500">
                        {f.uploaded_at &&
                          new Date(f.uploaded_at).toLocaleString()}
                      </td>
                      <td className="py-1 text-right">
                        <button
                          className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
                          onClick={() => {
                            setSelectedFileId(f.id);
                            setTab("chat");
                          }}
                        >
                          Utiliser dans le chat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {/* Bandeau contexte fichier */}
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <div className="text-xs uppercase text-gray-500 mb-1">
                Fichier DCF utilisé comme contexte
              </div>
              <select
                className="w-full sm:w-auto border rounded-md px-2 py-1 text-sm"
                value={selectedFileId || ""}
                onChange={(e) =>
                  setSelectedFileId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              >
                <option value="">(Aucun – mode général)</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.filename}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                L&apos;assistant se base sur ce fichier pour te dire quoi
                remplir dans le DCF et dans SAP.
              </p>
            </div>
          </div>

          {/* Zone de messages */}
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col h-[560px]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
              {messages.length === 0 && (
                <div className="text-sm text-gray-500">
                  Pose ta première question, par exemple :
                  <ul className="mt-2 list-disc list-inside space-y-1">
                    <li>
                      &quot;Pour ce ticket, quelles lignes DCF je dois remplir
                      et dans quel onglet ?&quot;
                    </li>
                    <li>
                      &quot;Donne-moi les étapes détaillées pour créer
                      l&apos;opération 20 dans le plan SAP.&quot;
                    </li>
                  </ul>
                </div>
              )}
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[75%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Formulaire message */}
            <form
              onSubmit={handleSend}
              className="border-t pt-3 mt-2 space-y-2"
            >
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm resize-y min-h-[80px]"
                placeholder="Explique ton ticket, colle les short/long text ou ce que tu vois dans SAP…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={onAttachmentChange}
                    className="text-xs"
                  />
                  {attachments.length > 0 && (
                    <span>
                      {attachments.length} pièce
                      {attachments.length > 1 ? "s" : ""} jointe
                      {attachments.length > 1 ? "s" : ""} sélectionnée
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-60"
                >
                  {sending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
