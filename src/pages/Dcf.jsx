// src/pages/Dcf.jsx v2
import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api.js";

export default function DcfPage() {
  const [tab, setTab] = useState("chat"); // "files" | "chat" | "validation" | "sessions"
  const [excelFiles, setExcelFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("chat"); // "chat" | "validation" | "guidage"

  const [validationReport, setValidationReport] = useState(null);
  const [validating, setValidating] = useState(false);

  const messagesEndRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Load fichiers DCF
  // ---------------------------------------------------------------------------
  async function refreshFiles() {
    try {
      const res = await api.dcf.listFiles();
      const fs = res?.files || [];
      setFiles(fs);
      if (selectedFileIds.length === 0 && fs[0]) {
        setSelectedFileIds([fs[0].id]);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du chargement des fichiers DCF");
    }
  }

  async function refreshSessions() {
    try {
      const res = await api.dcf.listSessions?.() || { sessions: [] };
      setSessions(res.sessions || []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refreshFiles();
    refreshSessions();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Upload Excel MULTI
  // ---------------------------------------------------------------------------
  async function handleUploadExcel() {
    if (!excelFiles.length) return;
    setUploadBusy(true);
    setError("");

    try {
      const fd = new FormData();
      excelFiles.forEach((f) => fd.append("files", f));

      const res = await api.dcf.uploadExcelMulti?.(fd) || 
                  await api.dcf.uploadExcel(excelFiles[0]);

      const uploadedFiles = res?.files || (res?.file ? [res.file] : []);

      if (uploadedFiles.length > 0) {
        const newIds = uploadedFiles.map((f) => f.id);
        setSelectedFileIds((prev) => [...new Set([...prev, ...newIds])]);
      }

      await refreshFiles();
      setTab("chat");
      setExcelFiles([]);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'envoi des fichiers Excel");
    } finally {
      setUploadBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Validation DCF
  // ---------------------------------------------------------------------------
  async function handleValidation() {
    if (selectedFileIds.length === 0) {
      setError("Sélectionne au moins un fichier à valider");
      return;
    }

    setValidating(true);
    setError("");
    setValidationReport(null);

    try {
      const res = await api.dcf.validate({ fileIds: selectedFileIds });
      setValidationReport(res?.report || "Aucun rapport généré");
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de la validation");
    } finally {
      setValidating(false);
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
        const ret = await api.dcf.uploadAttachments(attachments, sessionId);
        attachmentIds = (ret?.items || []).map((it) => it.id);
      }

      const res = await api.dcf.chat({
        sessionId,
        message: input.trim(),
        fileIds: selectedFileIds,
        attachmentIds,
        mode,
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
      await refreshSessions();
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

  function toggleFileSelection(fileId) {
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) {
        return prev.filter((id) => id !== fileId);
      }
      return [...prev, fileId];
    });
  }

  async function loadSession(sid) {
    try {
      const res = await api.dcf.getSession(sid);
      setSessionId(sid);
      setMessages(
        (res?.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
        }))
      );
      if (res?.session?.context_file_ids?.length) {
        setSelectedFileIds(res.session.context_file_ids);
      }
      setTab("chat");
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du chargement de la session");
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setTab("chat");
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assistant DCF – SAP v2</h1>
          <p className="text-sm text-gray-600">
            Multi-fichiers • Validation automatique • Guidage SAP • OCR images
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
          💬 Assistant DCF
        </button>
        <button
          className={`pb-2 text-sm font-medium border-b-2 ${
            tab === "validation"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("validation")}
        >
          ✅ Validation DCF
        </button>
        <button
          className={`pb-2 text-sm font-medium border-b-2 ${
            tab === "files"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("files")}
        >
          📁 Fichiers DCF
        </button>
        <button
          className={`pb-2 text-sm font-medium border-b-2 ${
            tab === "sessions"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900"
          }`}
          onClick={() => setTab("sessions")}
        >
          🗂️ Sessions ({sessions.length})
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* ==================== ONGLET FICHIERS ==================== */}
      {tab === "files" && (
        <section className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
            <h2 className="text-lg font-medium">📤 Importer des fichiers DCF</h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <input
                type="file"
                accept=".xls,.xlsx,.xlsm"
                multiple
                onChange={(e) =>
                  setExcelFiles(Array.from(e.target.files || []))
                }
                className="block w-full text-sm"
              />
              <button
                onClick={handleUploadExcel}
                disabled={!excelFiles.length || uploadBusy}
                className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-60 whitespace-nowrap"
              >
                {uploadBusy ? "Envoi…" : "Importer"}
              </button>
            </div>
            {excelFiles.length > 0 && (
              <p className="text-xs text-gray-500">
                {excelFiles.length} fichier{excelFiles.length > 1 ? "s" : ""}{" "}
                sélectionné{excelFiles.length > 1 ? "s" : ""} :{" "}
                {excelFiles.map((f) => f.name).join(", ")}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="text-lg font-medium mb-3">📚 Historique des fichiers</h2>
            {files.length === 0 ? (
              <p className="text-sm text-gray-500">
                Aucun fichier DCF importé pour le moment.
              </p>
            ) : (
              <div className="space-y-2">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className={`border rounded-lg p-3 ${
                      selectedFileIds.includes(f.id)
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedFileIds.includes(f.id)}
                            onChange={() => toggleFileSelection(f.id)}
                            className="rounded"
                          />
                          <span className="font-medium text-sm">{f.filename}</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-600 space-y-1">
                          <div>
                            Feuilles: {(f.sheet_names || []).join(", ")}
                          </div>
                          {f.total_sheets && (
                            <div>Total feuilles: {f.total_sheets}</div>
                          )}
                          <div>
                            Importé le:{" "}
                            {f.uploaded_at &&
                              new Date(f.uploaded_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <button
                        className="text-xs px-3 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
                        onClick={() => {
                          if (!selectedFileIds.includes(f.id)) {
                            setSelectedFileIds((prev) => [...prev, f.id]);
                          }
                          setTab("chat");
                        }}
                      >
                        Utiliser
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== ONGLET VALIDATION ==================== */}
      {tab === "validation" && (
        <section className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
            <h2 className="text-lg font-medium">✅ Validation automatique DCF</h2>
            <p className="text-sm text-gray-600">
              Sélectionne les fichiers à valider (dans l&apos;onglet Fichiers), puis
              lance la validation. L&apos;IA identifiera les erreurs, champs manquants
              et incohérences.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={handleValidation}
                disabled={validating || selectedFileIds.length === 0}
                className="inline-flex items-center px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium disabled:opacity-60"
              >
                {validating
                  ? "Validation en cours…"
                  : `Valider ${selectedFileIds.length} fichier${
                      selectedFileIds.length > 1 ? "s" : ""
                    }`}
              </button>
              {selectedFileIds.length === 0 && (
                <span className="text-sm text-gray-500">
                  Aucun fichier sélectionné
                </span>
              )}
            </div>

            {selectedFileIds.length > 0 && (
              <div className="border-t pt-3">
                <div className="text-xs font-medium text-gray-500 mb-1">
                  Fichiers sélectionnés:
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedFileIds.map((id) => {
                    const f = files.find((file) => file.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs"
                      >
                        {f?.filename || `ID ${id}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {validationReport && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h3 className="text-lg font-medium mb-3">📋 Rapport de validation</h3>
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-md">
                  {validationReport}
                </pre>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ==================== ONGLET SESSIONS ==================== */}
      {tab === "sessions" && (
        <section className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">🗂️ Historique des sessions</h2>
              <button
                onClick={newSession}
                className="text-sm px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                + Nouvelle session
              </button>
            </div>

            {sessions.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune session enregistrée.</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => loadSession(s.id)}
                  >
                    <div className="font-medium text-sm">{s.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Créée le: {new Date(s.created_at).toLocaleString()}
                    </div>
                    {s.context_file_ids?.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {s.context_file_ids.length} fichier
                        {s.context_file_ids.length > 1 ? "s" : ""} en contexte
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ==================== ONGLET CHAT ==================== */}
      {tab === "chat" && (
        <section className="space-y-4">
          {/* Mode de conversation */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-xs uppercase text-gray-500 mb-2">Mode</div>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("chat")}
                className={`px-3 py-1 text-sm rounded-md ${
                  mode === "chat"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                💬 Chat général
              </button>
              <button
                onClick={() => setMode("guidage")}
                className={`px-3 py-1 text-sm rounded-md ${
                  mode === "guidage"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                🧭 Guidage SAP
              </button>
              <button
                onClick={() => setMode("validation")}
                className={`px-3 py-1 text-sm rounded-md ${
                  mode === "validation"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                ✅ Validation
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {mode === "chat" &&
                "Mode standard: questions générales sur DCF et SAP"}
              {mode === "guidage" &&
                "Mode guidage: instructions détaillées étape par étape pour SAP"}
              {mode === "validation" &&
                "Mode validation: identification des erreurs dans les DCF"}
            </p>
          </div>

          {/* Contexte fichiers */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-xs uppercase text-gray-500 mb-2">
              Fichiers DCF en contexte ({selectedFileIds.length})
            </div>
            {selectedFileIds.length === 0 ? (
              <p className="text-sm text-gray-500">
                Aucun fichier sélectionné. Va dans l&apos;onglet Fichiers pour en
                sélectionner.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedFileIds.map((id) => {
                  const f = files.find((file) => file.id === id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-2 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs"
                    >
                      {f?.filename || `ID ${id}`}
                      <button
                        onClick={() => toggleFileSelection(id)}
                        className="hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Boutons session */}
          <div className="flex gap-2">
            <button
              onClick={newSession}
              className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200"
            >
              + Nouvelle session
            </button>
            {sessionId && (
              <span className="text-xs px-3 py-1 rounded-md bg-green-50 text-green-700">
                Session active
              </span>
            )}
          </div>

          {/* Zone de messages */}
          <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col h-[560px]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
              {messages.length === 0 && (
                <div className="text-sm text-gray-500">
                  <p className="font-medium mb-2">Exemples de questions:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    {mode === "chat" && (
                      <>
                        <li>
                          &quot;Pour ce ticket, quelles lignes DCF je dois
                          remplir?&quot;
                        </li>
                        <li>
                          &quot;Explique-moi ce que signifie le work center
                          ELEC01&quot;
                        </li>
                      </>
                    )}
                    {mode === "guidage" && (
                      <>
                        <li>
                          &quot;Guide-moi pour créer une opération 20 dans
                          IP02&quot;
                        </li>
                        <li>
                          &quot;Étapes détaillées pour modifier la durée dans un
                          plan SAP&quot;
                        </li>
                      </>
                    )}
                    {mode === "validation" && (
                      <>
                        <li>&quot;Valide ce DCF et trouve les erreurs&quot;</li>
                        <li>
                          &quot;Quels champs obligatoires manquent dans ce
                          fichier?&quot;
                        </li>
                      </>
                    )}
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
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Formulaire message */}
            <form onSubmit={handleSend} className="border-t pt-3 mt-2 space-y-2">
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm resize-y min-h-[80px]"
                placeholder={
                  mode === "guidage"
                    ? "Décris ce que tu veux faire dans SAP, je te guide étape par étape…"
                    : "Pose ta question, colle les données du DCF, joins des captures SAP…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    handleSend(e);
                  }
                }}
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
                      {attachments.length} pièce{attachments.length > 1 ? "s" : ""}{" "}
                      jointe{attachments.length > 1 ? "s" : ""} (OCR auto)
                    </span>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-60"
                >
                  {sending ? "Envoi…" : "Envoyer (Ctrl+Enter)"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
