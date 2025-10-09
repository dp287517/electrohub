import React, { useState, useRef } from "react";

export default function AskVeeva() {
  const [zipName, setZipName] = useState("");
  const [status, setStatus] = useState("Aucun index");
  const [isUploading, setIsUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [matches, setMatches] = useState([]);
  const fileInputRef = useRef(null);

  async function uploadZip(file) {
    if (!file) return;
    setIsUploading(true);
    setStatus("Upload en cours…");
    const formData = new FormData();
    formData.append("zip", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Échec upload");
      setZipName(file.name);
      setStatus(`Index créé (${data.stats.chunks} chunks, ${data.stats.files} fichiers)`);
    } catch (e) {
      console.error(e);
      setStatus("Erreur : " + e.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function runSearch(q) {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, k: 5 }),
    });
    const data = await res.json();
    setMatches(data.matches || []);
    return data.matches || [];
  }

  async function ask() {
    if (!question.trim()) return;
    setAnswer({ loading: true });
    try {
      // Optionnel : prévisualiser les meilleurs passages avant la réponse finale
      const top = await runSearch(question);

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAnswer(data);
    } catch (e) {
      setAnswer({ error: e.message });
    }
  }

  function onPickFile(e) {
    const f = e.target.files?.[0];
    if (f) uploadZip(f);
  }

  return (
    <div className="min-h-screen w-full flex items-start justify-center p-6 bg-gray-50">
      <div className="w-full max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Ask Veeva – Lecture & Q/R Documents</h1>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50"
            disabled={isUploading}
          >
            {isUploading ? "Import…" : "Téléverser un .zip"}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".zip"
            onChange={onPickFile}
          />
        </header>

        <div className="p-4 rounded-2xl bg-white shadow-sm border">
          <div className="text-sm text-gray-600">Statut : {status}</div>
          {zipName && <div className="text-xs text-gray-500">Dernier fichier : {zipName}</div>}
        </div>

        <div className="p-4 rounded-2xl bg-white shadow-sm border space-y-3">
          <label className="block text-sm font-medium">Posez une question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ex : Où est abordée la conformité GxP ?"
            className="w-full p-3 rounded-xl border focus:outline-none"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={ask}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white"
            >
              Demander à Ask Veeva
            </button>
            <button
              onClick={() => runSearch(question)}
              className="px-4 py-2 rounded-xl bg-gray-200"
            >
              Voir les sources probables
            </button>
          </div>
        </div>

        {matches?.length > 0 && (
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <h2 className="font-medium mb-2">Passages les plus pertinents</h2>
            <ul className="space-y-3">
              {matches.map((m, i) => (
                <li key={i} className="text-sm">
                  <div className="text-gray-900">{m.snippet}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {m.meta?.filename} {typeof m.meta?.page === 'number' ? `(p. ${m.meta.page})` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {answer && (
          <div className="p-4 rounded-2xl bg-white shadow-sm border space-y-3">
            <h2 className="font-medium">Réponse</h2>
            {answer.loading && <div>Génération en cours…</div>}
            {answer.error && <div className="text-red-600">Erreur : {answer.error}</div>}
            {answer.text && (
              <div className="prose max-w-none">
                <p>{answer.text}</p>
              </div>
            )}
            {answer.citations?.length ? (
              <div>
                <h3 className="font-medium mt-2">Citations</h3>
                <ul className="text-sm list-disc pl-5">
                  {answer.citations.map((c, i) => (
                    <li key={i}>
                      {c.filename}
                      {typeof c.page === 'number' ? ` (p. ${c.page})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
