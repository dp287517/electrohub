// src/pages/Dcf.jsx – v3 simplifiée

import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api.js";

export default function DcfPage() {
  // ------------------ ÉTAT ------------------
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [files, setFiles] = useState([]);
  const [excelFiles, setExcelFiles] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  const [validationRunning, setValidationRunning] = useState(false);
  const [validationReport, setValidationReport] = useState(null);

  const [mode, setMode] = useState("guidage"); // "guidage" | "chat" | "validation"
  const [useCase, setUseCase] = useCaseState();
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const messagesEndRef = useRef(null);

  // Petit hook pour mémoriser le last useCase dans localStorage
  function useCaseState() {
    const [state, setState] = useState(() => {
      try {
        return localStorage.getItem("dcf_use_case") || "";
      } catch {
        return "";
      }
    });
    function update(v) {
      setState(v);
      try {
        localStorage.setItem("dcf_use_case", v);
      } catch {}
    }
    return [state, update];
  }

  // ------------------ HELPERS ------------------
  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(scrollToBottom, [messages]);

  async function loadFiles() {
    setLoadingFiles(true);
    setError("");
    try {
      const res = await api.dcf.listFiles();
      const fs = res?.files || [];
      setFiles(fs);
      if (fs.length && selectedFileIds.length === 0) {
        setSelectedFileIds([fs[0].id]);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du chargement des fichiers DCF");
    } finally {
      setLoadingFiles(false);
    }
  }

  async function loadSessions() {
    try {
      const res = await api.dcf.listSessions();
      setSessions(res?.sessions || []);
    } catch (e) {
      console.error(e);
      // pas bloquant
    }
  }

  async function loadSession(id) {
    setError("");
    try {
      const res = await api.dcf.getSession(id);
      const sess = res?.session;
      const msgs = res?.messages || [];
      setSessionId(id);
      setMessages(
        msgs.map((m) => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        }))
      );
      if (sess?.context_file_ids?.length) {
        setSelectedFileIds(sess.context_file_ids);
      }
      setInfo(`Session chargée : ${sess?.title || id}`);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du chargement de la session");
    }
  }

  function resetSession() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setInfo("Nouvelle conversation DCF");
  }

  useEffect(() => {
    loadFiles();
    loadSessions();
  }, []);

  // ------------------ UPLOAD EXCEL ------------------
  async function handleUploadExcel() {
    if (!excelFiles.length) return;
    setError("");
    setInfo("");
    try {
      const fd = new FormData();
      excelFiles.forEach((f) => fd.append("files", f));

      const res =
        (await api.dcf.uploadExcelMulti(fd)) ||
        (await api.dcf.uploadExcel(excelFiles[0]));

      const uploaded =
        res?.files || (res?.file ? [res.file] : []);

      if (uploaded.length) {
        const newIds = uploaded.map((f) => f.id);
        setSelectedFileIds((prev) => [
          ...new Set([...prev, ...newIds]),
        ]);
      }

      await loadFiles();
      setExcelFiles([]);
      setInfo(
        `${uploaded.length} fichier(s) DCF importé(s) avec succès`
      );
    } catch (e) {
      console.error(e);
      setError(
        e.message || "Erreur lors de l'envoi des fichiers Excel"
      );
    }
  }

  function toggleFileSelection(id) {
    setSelectedFileIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  }

  // ------------------ VALIDATION ------------------
  async function handleValidate() {
    if (!selectedFileIds.length) {
      setError("Sélectionne au moins un fichier à valider");
      return;
    }
    setError("");
    setInfo("");
    setValidationReport(null);
    setValidationRunning(true);
    try {
      const res = await api.dcf.validate({
        fileIds: selectedFileIds,
        mode: "auto",
      });
      setValidationReport(res?.report || "Aucun rapport généré.");
      setInfo(
        `Validation effectuée pour ${selectedFileIds.length} fichier(s)`
      );
    } catch (e) {
      console.error(e);
      setError(
        e.message || "Erreur lors de la validation des fichiers"
      );
    } finally {
      setValidationRunning(false);
    }
  }

  // ------------------ CHAT ------------------
  function handleAttachmentChange(e) {
    const fs = Array.from(e.target.files || []);
    setAttachments(fs);
  }

  async function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    setSending(true);
    setError("");
    setInfo("");

    try:
    {
      // Upload pièces jointes si présentes
      let attachmentIds = [];
      if (attachments.length) {
        const res = await api.dcf.uploadAttachments(
          attachments,
          sessionId
        );
        attachmentIds = (res?.items || []).map((it) => it.id);
      }

      const res = await api.dcf.chat({
        sessionId,
        message: input.trim(),
        fileIds: selectedFileIds,
        attachmentIds,
        mode,
        useCase: useCase || null,
      });

      const newSessionId = res?.sessionId || sessionId;
      if (!sessionId && newSessionId) {
        setSessionId(newSessionId);
        await loadSessions();
      }

      const answer = res?.answer || res?.text || "";
      const newMsgs = [
        ...messages,
        { role: "user", content: input.trim() },
        { role: "assistant", content: answer },
      ];
      setMessages(newMsgs);
      setInput("");
      setAttachments([]);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'appel à l'assistant");
    } finally {
      setSending(false);
    }
  }

  // ------------------ RENDU ------------------
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* En-tête */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Assistant DCF – SAP v3
          </h1>
          <p className="text-sm text-gray-600">
            3 étapes : ① Fichiers DCF ② Validation ③ Assistant
            ultra-précis (ligne/colonne)
          </p>
        </div>
        <div className="text-xs text-gray-500 space-y-1 sm:text-right">
          <div>Mode assistant :</div>
          <div className="flex flex-wrap gap-2 justify-end">
            <ModeButton
              label="🧭 Guidage SAP"
              value="guidage"
              current={mode}
              onClick={setMode}
            />
            <ModeButton
              label="💬 Chat général"
              value="chat"
              current={mode}
              onClick={setMode}
            />
            <ModeButton
              label="✅ Validation"
              value="validation"
              current={mode}
              onClick={setMode}
            />
          </div>
        </div>
      </header>

      {/* Messages global */}
      {(error || info) && (
        <div className="space-y-2">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
          {info && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-md text-sm">
              {info}
            </div>
          )}
        </div>
      )}

      {/* Layout principal : 2 colonnes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Colonne de gauche : Fichiers + Validation */}
        <div className="space-y-4 lg:col-span-1">
          {/* Étape 1 : Import fichiers */}
          <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold">
              ① Fichiers DCF (Excel)
            </h2>
            <p className="text-xs text-gray-600">
              Importe un ou plusieurs fichiers DCF SAP (Task List,
              Maintenance Plan, Equipment…).
            </p>

            <div className="space-y-2">
              <input
                type="file"
                accept=".xls,.xlsx,.xlsm"
                multiple
                onChange={(e) =>
                  setExcelFiles(Array.from(e.target.files || []))
                }
                className="block w-full text-xs"
              />
              <button
                onClick={handleUploadExcel}
                disabled={!excelFiles.length}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-60"
              >
                Importer {excelFiles.length || ""} fichier
                {excelFiles.length > 1 ? "s" : ""}
              </button>
              {excelFiles.length > 0 && (
                <p className="text-xs text-gray-500">
                  Sélection :{" "}
                  {excelFiles.map((f) => f.name).join(", ")}
                </p>
              )}
            </div>

            <div className="border-t pt-3 mt-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-700">
                  Fichiers analysés
                </h3>
                <button
                  onClick={loadFiles}
                  disabled={loadingFiles}
                  className="text-[11px] text-gray-500 hover:text-gray-700"
                >
                  {loadingFiles ? "Rafraîchissement…" : "Rafraîchir"}
                </button>
              </div>
              {files.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Aucun fichier DCF importé pour le moment.
                </p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-auto pr-1">
                  {files.map((f) => {
                    const checked =
                      selectedFileIds.includes(f.id);
                    return (
                      <label
                        key={f.id}
                        className={`flex items-start gap-2 border rounded-md px-2 py-1.5 cursor-pointer text-xs ${
                          checked
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() =>
                            toggleFileSelection(f.id)
                          }
                        />
                        <div className="flex-1">
                          <div className="font-medium">
                            {f.filename}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            Feuilles :{" "}
                            {(f.sheet_names || []).join(", ") ||
                              "non détecté"}
                          </div>
                          {f.uploaded_at && (
                            <div className="text-[11px] text-gray-400">
                              Importé le{" "}
                              {new Date(
                                f.uploaded_at
                              ).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Étape 2 : Validation */}
          <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold">
              ② Validation automatique
            </h2>
            <p className="text-xs text-gray-600">
              L’IA analyse la structure SAP (lignes / colonnes /
              champs obligatoires) et remonte les erreurs.
            </p>

            <button
              onClick={handleValidate}
              disabled={
                validationRunning || !selectedFileIds.length
              }
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium disabled:opacity-60"
            >
              {validationRunning
                ? "Validation en cours…"
                : selectedFileIds.length
                ? `Valider ${selectedFileIds.length} fichier(s)`
                : "Sélectionne d’abord un fichier DCF"}
            </button>

            {validationReport && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-gray-700 mb-1">
                  Rapport de validation
                </h3>
                <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded-md p-2 max-h-56 overflow-auto whitespace-pre-wrap">
                  {validationReport}
                </pre>
              </div>
            )}
          </section>

          {/* Sessions (optionnel, discret) */}
          <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-700">
                🗂️ Conversations
              </h2>
              <button
                onClick={resetSession}
                className="text-[11px] px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200"
              >
                Nouvelle
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-[11px] text-gray-400">
                Aucune conversation enregistrée pour le moment.
              </p>
            ) : (
              <select
                value={sessionId || ""}
                onChange={(e) =>
                  e.target.value
                    ? loadSession(e.target.value)
                    : resetSession()
                }
                className="w-full text-xs border border-gray-300 rounded-md px-2 py-1"
              >
                <option value="">
                  — Reprendre une conversation —
                </option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.id} •{" "}
                    {new Date(
                      s.created_at
                    ).toLocaleDateString()}
                  </option>
                ))}
              </select>
            )}
          </section>
        </div>

        {/* Colonne de droite : Assistant */}
        <div className="lg:col-span-2 space-y-4">
          {/* Contextes */}
          <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  ③ Assistant DCF SAP
                </h2>
                <p className="text-xs text-gray-600">
                  Pose ta question, l’assistant répond avec{" "}
                  <strong>ligne / colonne / code SAP</strong>.
                </p>
              </div>
              <div className="flex flex-col items-start md:items-end gap-1">
                <label className="text-[11px] text-gray-500">
                  Cas d’usage (facultatif)
                </label>
                <select
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  className="text-xs border border-gray-300 rounded-md px-2 py-1"
                >
                  <option value="">
                    — Choisir un cas d’usage —
                  </option>
                  <option value="create_operation">
                    Créer une nouvelle opération
                  </option>
                  <option value="modify_operation">
                    Modifier une opération existante
                  </option>
                  <option value="add_to_plan">
                    Ajouter au plan de maintenance
                  </option>
                  <option value="validate_structure">
                    Vérifier / valider un DCF
                  </option>
                </select>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="text-[11px] text-gray-500">
                Fichiers DCF en contexte :{" "}
                {selectedFileIds.length
                  ? selectedFileIds.length
                  : "aucun"}
              </div>
              {selectedFileIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedFileIds.map((id) => {
                    const f = files.find((x) => x.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px]"
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
              {selectedFileIds.length === 0 && (
                <p className="text-[11px] text-gray-400">
                  Sélectionne au moins un fichier DCF à gauche pour
                  avoir des réponses ultra-précises.
                </p>
              )}
            </div>
          </section>

          {/* Chat */}
          <section className="bg-white rounded-xl shadow-sm p-4 flex flex-col h-[480px]">
            <div className="flex-1 overflow-auto mb-3 space-y-2 pr-1">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-gray-400 text-center max-w-xs">
                    Commence par une question, par exemple :<br />
                    <code className="text-[11px] bg-gray-50 px-2 py-1 rounded">
                      "Créer l&apos;opération 0020 pour vérification
                      des sondes dans la TL CH940015"
                    </code>
                  </p>
                </div>
              ) : (
                messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`text-xs whitespace-pre-wrap rounded-md px-3 py-2 ${
                      m.role === "user"
                        ? "bg-blue-50 text-gray-800 self-end ml-8"
                        : "bg-gray-50 text-gray-800 self-start mr-8"
                    }`}
                  >
                    {m.content}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Zone de saisie */}
            <form
              onSubmit={handleSend}
              className="border-t pt-2 space-y-2"
            >
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Pose ta question (ex: 'Ajouter la vérification des sondes au plan 30482333')"
                className="w-full text-xs border border-gray-300 rounded-md px-2 py-1 resize-none"
              />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <span className="px-2 py-1 border border-dashed border-gray-300 rounded-md hover:bg-gray-50">
                      + Capture SAP (image)
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleAttachmentChange}
                    />
                  </label>
                  {attachments.length > 0 && (
                    <span className="text-gray-500">
                      {attachments.length} image
                      {attachments.length > 1 ? "s" : ""} prête(s)
                      (OCR)
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={
                    sending || !input.trim() || !selectedFileIds.length
                  }
                  className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-60"
                >
                  {sending ? "Envoi…" : "Envoyer au DCF Assistant"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ label, value, current, onClick }) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`px-2 py-1 rounded-md text-xs ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
