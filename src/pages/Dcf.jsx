import React, { useState, useEffect, useMemo, useRef } from "react";
import { api } from "../lib/api.js";
import {
  FaArrowRight,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaSearch,
  FaFileExcel,
  FaCamera,
  FaSpinner,
  FaDownload,
  FaArrowLeft,
  FaInfoCircle,
  FaMagic,
  FaRobot,
  FaDatabase,
  FaUpload
} from "react-icons/fa";

// -----------------------------------------------------------------------------
// UI COMPONENTS
// -----------------------------------------------------------------------------

const StepIndicator = ({ currentStep, steps }) => (
  <div className="mb-8 px-4">
    <div className="flex items-center justify-between relative max-w-4xl mx-auto">
      <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10" />
      {steps.map((step, idx) => {
        const stepNum = idx + 1;
        const isCompleted = currentStep > stepNum;
        const isActive = currentStep === stepNum;
        return (
          <div key={idx} className="flex flex-col items-center bg-slate-50 px-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                isActive
                  ? "bg-blue-600 text-white ring-4 ring-blue-100 scale-110"
                  : isCompleted
                  ? "bg-green-500 text-white"
                  : "bg-gray-300 text-gray-600"
              }`}
            >
              {isCompleted ? <FaCheckCircle /> : stepNum}
            </div>
            <span
              className={`mt-2 text-xs font-medium hidden sm:block ${
                isActive ? "text-blue-600" : "text-gray-500"
              }`}
            >
              {step}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

const Card = ({ children, className = "" }) => (
  <div
    className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}
  >
    {children}
  </div>
);

const FieldInstruction = ({
  row,
  col,
  code,
  label,
  value,
  reason,
  mandatory
}) => (
  <div className="flex flex-col sm:flex-row gap-4 p-4 bg-white rounded-lg border border-slate-200 mb-3 hover:border-blue-300 transition-colors shadow-sm animate-fade-in-up group">
    <div className="flex-shrink-0 flex flex-col items-center justify-center min-w-[70px] bg-slate-50 rounded border border-slate-200 p-2 group-hover:bg-blue-50 transition-colors">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">
        Ligne
      </div>
      <div className="text-xl font-black text-slate-700">{row}</div>
      <div className="w-full h-px bg-slate-200 my-1"></div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">
        Col
      </div>
      <div className="text-xl font-black text-blue-600">{col}</div>
    </div>
    <div className="flex-grow space-y-2">
      <div className="flex items-center flex-wrap gap-2">
        <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 font-bold">
          {code}
        </span>
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {mandatory && (
          <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
            Obligatoire
          </span>
        )}
      </div>
      <div>
        <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide font-medium">
          Valeur à saisir :
        </div>
        <div className="bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 rounded font-mono text-sm font-medium select-all break-words shadow-inner">
          {value}
        </div>
      </div>
      {reason && (
        <div className="text-xs text-gray-500 italic flex items-start gap-1">
          <FaInfoCircle className="mt-0.5 text-blue-400 flex-shrink-0" />
          {reason}
        </div>
      )}
    </div>
  </div>
);

// -----------------------------------------------------------------------------
// MAIN WIZARD v7.4.6 FRONTEND
// -----------------------------------------------------------------------------

export default function DCFWizard() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // LIBRARY
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [uploadingLib, setUploadingLib] = useState(false);

  // STEP 1
  const [requestText, setRequestText] = useState("");

  // STEP 2
  const [analysis, setAnalysis] = useState(null);

  // STEP 3
  const [activeFile, setActiveFile] = useState(null);
  const [instructions, setInstructions] = useState([]);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [autofillLoading, setAutofillLoading] = useState(false);

  // STEP 4
  const [validationFiles, setValidationFiles] = useState([]);
  const [validationReport, setValidationReport] = useState(null);

  const mountedRef = useRef(true);

  // ---------------------------------------------------------------------------
  // Helpers robustes
  // ---------------------------------------------------------------------------

  const toLine = (x) => {
    if (typeof x === "string") return x;
    if (!x || typeof x !== "object") return String(x ?? "");
    const sheet = x.sheet ? `[${x.sheet}] ` : "";
    const col = x.column ? `${x.column}: ` : "";
    const msg =
      x.suggestion ??
      x.warning ??
      x.message ??
      x.reason ??
      "";
    const line = `${sheet}${col}${msg}`.trim();
    return line || JSON.stringify(x);
  };

  // ✅ useCase frontend (mêmes règles que backend)
  const inferUseCase = (text = "") => {
    const m = String(text).toLowerCase();
    if (/(décommission|decommission|retirer|supprimer équipement|retirer equipement)/.test(m))
      return "decommission";
    if (/(ajout|ajouter|rajouter|créer|creer).*(opération|operation|contrôle|controle|inspection|check).*(plan)/.test(m))
      return "add_operation_in_plan";
    if (/(ajout|ajouter|rajouter).*(équipement|equipement).*(plan)/.test(m))
      return "add_equipment_in_plan";
    if (/(modif|modifier|changer).*(texte|short text|long text)/.test(m))
      return "text_only_change";
    return "unknown";
  };

  const normalizedInstructions = useMemo(() => {
    if (!Array.isArray(instructions)) return [];
    return instructions.map((inst) => ({
      row: toLine(inst?.row),
      col: toLine(inst?.col),
      code: toLine(inst?.code),
      label: toLine(inst?.label),
      value: toLine(inst?.value),
      reason: inst?.reason ? toLine(inst.reason) : "",
      mandatory: Boolean(inst?.mandatory),
      sheet: inst?.sheet
    }));
  }, [instructions]);

  const normalizedAnalysis = useMemo(() => {
    if (!analysis || typeof analysis !== "object") return null;
    const required = Array.isArray(analysis.required_files)
      ? analysis.required_files
      : analysis.required_files
      ? [analysis.required_files]
      : [];
    return { ...analysis, required_files: required };
  }, [analysis]);

  const normalizedValidation = useMemo(() => {
    if (!validationReport || typeof validationReport !== "object") return null;
    return {
      report: validationReport.report ?? "",
      critical: (validationReport.critical || []).map(toLine),
      warnings: (validationReport.warnings || []).map(toLine),
      suggestions: (validationReport.suggestions || []).map(toLine)
    };
  }, [validationReport]);

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      try {
        const res = await api.dcf.startSession({ title: "Wizard DCF v7.4.6" });
        if (mountedRef.current && res?.sessionId) setSessionId(res.sessionId);
        refreshLibrary();
      } catch (e) {
        console.error(e);
      }
    };

    init();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshLibrary = async () => {
    try {
      const res = await api.dcf.listFiles();
      if (!mountedRef.current) return;
      setLibraryFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------------------------------------------------------------------
  // Library handlers
  // ---------------------------------------------------------------------------

  const handleLibraryUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingLib(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      await api.dcf.uploadExcelMulti(fd);
      await refreshLibrary();
      alert(`${files.length} fichier(s) ajouté(s) à la bibliothèque !`);
    } catch (e2) {
      alert("Erreur upload: " + e2.message);
    } finally {
      setUploadingLib(false);
      e.target.value = "";
    }
  };

  // ---------------------------------------------------------------------------
  // Wizard handlers
  // ---------------------------------------------------------------------------

  const handleAnalyzeRequest = async () => {
    if (!requestText.trim()) return;
    setLoading(true);
    setAnalysis(null);
    try {
      const res = await api.dcf.wizard.analyze(requestText, sessionId);
      if (!mountedRef.current) return;
      setAnalysis(res);
      setStep(2);
    } catch (e) {
      alert("Erreur analyse: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async (fileObj) => {
    setActiveFile(fileObj);
    setLoading(true);
    setInstructions([]);
    setAttachmentIds([]);
    setScreenshots([]);
    try {
      const data = await api.dcf.wizard.instructions(
        sessionId,
        requestText,
        fileObj.template_filename,
        []
      );
      if (!mountedRef.current) return;
      setInstructions(Array.isArray(data) ? data : []);
      setStep(3);
    } catch (e) {
      alert("Erreur génération instructions: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (!activeFile?.template_filename) {
      alert("Sélectionne d'abord un fichier template.");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setScreenshots((prev) => [...prev, ...files]);
    try {
      const upRes = await api.dcf.uploadAttachments(files, sessionId);
      const newIds = (upRes?.items || []).map((i) => i.id).filter(Boolean);
      const allIds = [...attachmentIds, ...newIds];
      setAttachmentIds(allIds);

      const data = await api.dcf.wizard.instructions(
        sessionId,
        requestText,
        activeFile.template_filename,
        allIds
      );
      if (!mountedRef.current) return;
      setInstructions(Array.isArray(data) ? data : []);
    } catch (e2) {
      alert("Erreur analyse image: " + e2.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const handleAutofill = async () => {
    if (!normalizedInstructions.length || !activeFile?.template_filename) return;

    setAutofillLoading(true);
    try {
      const safeSteps = normalizedInstructions.map((s) => ({
        ...s,
        row: String(s.row || "").trim(),
        col: String(s.col || "").trim(),
        code: String(s.code || "").trim(),
        value: s.value ?? ""
      }));

      const blob = await api.dcf.wizard.autofill(
        activeFile.template_filename,
        safeSteps
      );

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = activeFile.template_filename
        .toLowerCase()
        .endsWith(".xlsm")
        ? ".xlsm"
        : ".xlsx";
      a.download = `FILLED_${activeFile.template_filename
        .replace(/\.xlsm$/i, "")
        .replace(/\.xlsx$/i, "")}${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      alert("Erreur génération fichier: " + e.message);
    } finally {
      setAutofillLoading(false);
    }
  };

  const handleValidationUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setValidationFiles(files);
      setValidationReport(null);
    }
  };

  const runValidation = async () => {
    if (!validationFiles.length) return;
    setLoading(true);
    setValidationReport(null);

    try {
      const fd = new FormData();
      validationFiles.forEach((f) => fd.append("files", f));

      const upRes = await api.dcf.uploadExcelMulti(fd);
      const uploaded = upRes?.files || (upRes?.file ? [upRes.file] : []);
      const fileIds = uploaded.map((f) => f.id).filter(Boolean);

      if (!fileIds.length) throw new Error("Aucun fichier valide reçu du serveur.");

      const useCase = inferUseCase(requestText);

      // ✅ backend v7.4.6 supporte useCase pour validate
      const valRes = await api.dcf.wizard.validate(fileIds, useCase);

      if (!mountedRef.current) return;
      setValidationReport(valRes);
    } catch (e) {
      alert("Erreur validation: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Future-proof blank download
  const downloadBlankTemplate = async (file) => {
    try {
      if (!file?.file_id && !file?.id) {
        alert("Template vierge indisponible (id manquant).");
        return;
      }
      const id = file.file_id || file.id;
      const res = await api.dcf.getFile(id);
      if (res instanceof Blob) {
        const url = window.URL.createObjectURL(res);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.template_filename || file.filename || `template_${id}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        return;
      }
      alert("Route de téléchargement vierge pas encore disponible côté backend.");
    } catch {
      alert("Route de téléchargement vierge pas encore disponible côté backend.");
    }
  };

  // ---------------------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------------------

  const renderLibrary = () => (
    <div className="bg-slate-100 border-b border-slate-200 p-4 animate-slide-down mb-6 rounded-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
          <FaDatabase className="text-blue-600" /> Bibliothèque de Templates (
          {libraryFiles.length})
        </h3>
        <button
          onClick={() => setShowLibrary(false)}
          className="text-slate-400 hover:text-slate-600 text-sm"
        >
          Fermer
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 border-dashed border-2 border-blue-200 bg-blue-50 flex flex-col items-center justify-center text-center">
          <FaUpload className="text-blue-400 text-3xl mb-2" />
          <p className="text-sm font-bold text-blue-800 mb-1">
            Importer des Templates vierges
          </p>
          <p className="text-xs text-blue-600 mb-4">
            Task Lists, Plans, Équipements...
          </p>

          <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded cursor-pointer text-sm font-medium shadow-sm transition-all hover:scale-105">
            {uploadingLib ? (
              <FaSpinner className="animate-spin inline" />
            ) : (
              "Sélectionner Excel"
            )}
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm"
              multiple
              className="hidden"
              onChange={handleLibraryUpload}
            />
          </label>
        </Card>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
          {libraryFiles.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm italic">
              Aucun template. Importez-en !
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {libraryFiles.map((f) => (
                <li
                  key={f.id}
                  className="px-4 py-2 text-xs flex justify-between items-center hover:bg-slate-50"
                >
                  <span className="truncate font-medium text-slate-700 flex items-center gap-2">
                    <FaFileExcel className="text-green-600" /> {f.filename}
                  </span>
                  <span className="text-gray-400">
                    {f.uploaded_at
                      ? new Date(f.uploaded_at).toLocaleDateString()
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  const renderStep1_Describe = () => (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          Quel est le besoin ?
        </h2>
        <p className="text-gray-500">
          Décris ta tâche technique (ajout, suppression, modif...).
        </p>
      </div>

      <Card className="p-6 shadow-lg border-blue-100">
        <textarea
          className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 bg-white placeholder-gray-400 text-base mb-4 shadow-inner font-medium"
          placeholder="Exemple : Je dois ajouter l'opération de vérification des sondes dans le plan 30482333..."
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
        />
        <div className="flex justify-between items-center mt-2">
          <div className="text-xs text-gray-400 italic">
            <FaRobot className="inline mr-1" /> Analyse IA SAP v7.4.6
          </div>
          <button
            onClick={handleAnalyzeRequest}
            disabled={loading || !requestText.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 transition-all disabled:opacity-50 shadow-md transform hover:scale-105 active:scale-95"
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaSearch />}
            Analyser
          </button>
        </div>
      </Card>
    </div>
  );

  const renderStep2_Recommend = () => {
    if (normalizedAnalysis?.is_manual) {
      return (
        <div className="animate-fade-in text-center py-12 max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full mb-6 text-5xl shadow-sm animate-bounce-slow">
            <FaCheckCircle />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-800 mb-3">
            Pas besoin de fichier DCF !
          </h2>
          <p className="text-gray-600 text-lg mb-8 font-medium">
            Cette modification est trop simple pour nécessiter un import de masse.
          </p>
          <div className="bg-white p-8 rounded-2xl border border-emerald-100 shadow-sm text-left mb-8 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500"></div>
            <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2 text-lg">
              <FaInfoCircle className="text-emerald-500" /> L'avis de l'Expert :
            </h3>
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed text-base">
              {toLine(normalizedAnalysis.reasoning)}
            </p>
          </div>
          <button
            onClick={() => setStep(1)}
            className="text-blue-600 font-bold hover:underline hover:text-blue-800 transition-colors"
          >
            ← Faire une autre demande
          </button>
        </div>
      );
    }

    const files = normalizedAnalysis?.required_files || [];
    if (files.length === 0) {
      return (
        <div className="animate-fade-in text-center py-12 max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-yellow-100 text-yellow-600 rounded-full mb-6 text-5xl shadow-sm">
            <FaExclamationTriangle />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">
            Aucun template recommandé
          </h2>
          <p className="text-gray-600 text-base mb-8 font-medium">
            Vérifie ta demande ou ajoute les templates nécessaires dans la bibliothèque.
          </p>
          <button
            onClick={() => {
              setShowLibrary(true);
              setStep(1);
            }}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-md hover:bg-blue-700"
          >
            Ouvrir la bibliothèque
          </button>
        </div>
      );
    }

    return (
      <div className="animate-fade-in space-y-8">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {files.length > 1 ? "Pack de fichiers nécessaire" : "Fichier recommandé"}
          </h2>
          <p className="text-gray-600 bg-blue-50 inline-block px-4 py-1 rounded-full text-sm border border-blue-100">
            {toLine(normalizedAnalysis?.reasoning)}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {files.map((file, idx) => (
            <Card
              key={idx}
              className="flex flex-col h-full border-t-4 border-t-blue-500 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="p-6 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                    {toLine(file.type)}
                  </div>
                  <FaFileExcel className="text-emerald-600 text-3xl" />
                </div>
                <h3 className="font-bold text-gray-800 mb-3 break-words leading-tight text-lg">
                  {toLine(file.template_filename)}
                </h3>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 mt-2 border border-gray-100">
                  <span className="font-bold block mb-1 text-gray-800 text-xs uppercase">
                    Action prévue :
                  </span>
                  {toLine(file.usage)}
                </div>
              </div>
              <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
                <button
                  onClick={() => downloadBlankTemplate(file)}
                  className="flex-1 bg-white border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 hover:text-gray-800 flex items-center justify-center gap-2 transition-colors"
                >
                  <FaDownload /> Vierge
                </button>
                <button
                  onClick={() => handleSelectFile(file)}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-md transition-colors"
                >
                  Remplir <FaArrowRight />
                </button>
              </div>
            </Card>
          ))}
        </div>
        <div className="text-center pt-4">
          <button
            onClick={() => setStep(1)}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Modifier ma demande
          </button>
        </div>
      </div>
    );
  };

  const renderStep3_Guide = () => (
    <div className="animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-200">
        <div>
          <button
            onClick={() => setStep(2)}
            className="text-xs font-bold text-gray-400 uppercase tracking-wider hover:text-blue-600 mb-1 flex items-center gap-1 transition-colors"
          >
            <FaArrowLeft /> Retour aux fichiers
          </button>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mt-1">
            <FaFileExcel className="text-emerald-600" />{" "}
            <span className="truncate max-w-md">
              {toLine(activeFile?.template_filename)}
            </span>
          </h2>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleAutofill}
            disabled={autofillLoading || loading || !normalizedInstructions.length}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-lg font-bold hover:from-blue-700 hover:to-indigo-700 flex items-center gap-2 shadow-lg disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
          >
            {autofillLoading ? (
              <FaSpinner className="animate-spin" />
            ) : (
              <FaMagic className="text-yellow-300" />
            )}{" "}
            Générer le fichier Excel rempli
          </button>
          <button
            onClick={() => setStep(4)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 flex items-center gap-2 transition-colors"
          >
            Validation <FaArrowRight />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-gray-700 text-lg">
              Instructions ({normalizedInstructions.length})
            </h3>
            {attachmentIds.length > 0 && (
              <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold flex items-center gap-1 border border-green-200">
                <FaCheckCircle /> Données extraites de l'image
              </span>
            )}
          </div>
          {loading ? (
            <div className="h-80 flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-gray-300 text-gray-400 animate-pulse">
              <FaSpinner className="animate-spin text-4xl mb-4 text-blue-500" />
              <p className="font-medium">Analyse intelligente en cours...</p>
              <p className="text-xs mt-2">
                Lecture structure Excel + Vision SAP
              </p>
            </div>
          ) : normalizedInstructions.length > 0 ? (
            <div className="space-y-3">
              {normalizedInstructions.map((inst, idx) => (
                <FieldInstruction key={idx} {...inst} />
              ))}
            </div>
          ) : (
            <div className="p-10 bg-yellow-50 border border-yellow-100 rounded-xl text-yellow-800 text-center">
              <FaExclamationTriangle className="mx-auto text-3xl mb-3 opacity-50" />
              <p className="font-bold">Aucune instruction générée.</p>
              <p className="text-sm mt-1">
                Vérifie que le fichier sélectionné est bien un template DCF valide.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="sticky top-6">
            <Card className="p-6 bg-gradient-to-b from-blue-50 to-white border-blue-200 shadow-md">
              <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                <FaCamera className="text-blue-600 text-lg" /> Capture SAP
                (Vision)
              </h3>
              <p className="text-xs text-blue-800 mb-5 leading-relaxed font-medium">
                Ne recopie pas les données ! Fais un screenshot SAP
                (ex: IP02, IA05). L'IA va lire les ID et mettre à jour les instructions.
              </p>
              <label className="block w-full border-2 border-dashed border-blue-300 bg-white/80 rounded-xl p-8 text-center cursor-pointer hover:bg-blue-50 hover:border-blue-500 transition-all group relative overflow-hidden">
                <div className="relative z-10">
                  <FaCamera className="mx-auto text-blue-400 mb-3 text-3xl group-hover:scale-110 transition-transform duration-300" />
                  <span className="text-sm font-bold text-blue-600 block">
                    Déposer une capture ici
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleScreenshotUpload}
                />
              </label>
              {screenshots.length > 0 && (
                <div className="mt-5 space-y-2 border-t border-blue-100 pt-4">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Fichiers analysés
                  </h4>
                  {screenshots.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-gray-700 bg-white p-2 rounded border border-gray-200 shadow-sm"
                    >
                      <FaCheckCircle className="text-green-500 flex-shrink-0" />{" "}
                      <span className="truncate">{s.name}</span>
                    </div>
                  ))}
                  {loading && (
                    <div className="text-xs text-blue-600 animate-pulse text-center mt-2 font-medium">
                      Mise à jour des instructions...
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep4_Validate = () => (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">
          Validation Finale
        </h2>
        <p className="text-gray-500">
          Dernière vérification avant l'envoi au support SAP.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-8 items-start">
        <Card className="p-8 border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors flex flex-col items-center justify-center min-h-[400px]">
          {validationFiles.length === 0 ? (
            <>
              <div className="bg-gray-100 p-6 rounded-full mb-6">
                <FaFileExcel className="text-gray-400 text-5xl" />
              </div>
              <p className="text-lg font-medium text-gray-700 mb-1">
                Glisse tes fichiers Excel ici
              </p>
              <p className="text-sm text-gray-400 mb-6">
                Accepte les fichiers .xlsm générés
              </p>
              <label className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg cursor-pointer font-medium transition-colors shadow-sm">
                Parcourir mes fichiers
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  multiple
                  className="hidden"
                  onChange={handleValidationUpload}
                />
              </label>
            </>
          ) : (
            <div className="w-full text-center">
              <div className="mb-6 space-y-3 max-h-60 overflow-auto">
                {validationFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center gap-3 text-sm text-gray-700 bg-gray-50 p-3 rounded border border-gray-200"
                  >
                    <FaFileExcel className="text-green-600 text-lg" />{" "}
                    <span className="font-medium">{f.name}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={runValidation}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white px-10 py-3 rounded-full font-bold shadow-lg shadow-green-200 flex items-center gap-2 mx-auto disabled:opacity-50 transform transition-transform hover:scale-105"
              >
                {loading ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  "Lancer la validation"
                )}
              </button>
              <button
                onClick={() => {
                  setValidationFiles([]);
                  setValidationReport(null);
                }}
                className="mt-6 text-xs text-gray-400 underline hover:text-gray-600"
              >
                Annuler la sélection
              </button>
            </div>
          )}
        </Card>

        <div className="space-y-4 h-full">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-800 uppercase tracking-wide text-sm">
              Rapport Qualité v7.4.6
            </h3>
            {validationReport && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold">
                Predictive Check Active
              </span>
            )}
          </div>

          {!normalizedValidation ? (
            <div className="h-[400px] bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 text-sm italic p-8 text-center">
              {loading ? (
                <div className="flex flex-col items-center gap-4">
                  <FaSpinner className="animate-spin text-3xl text-blue-500" />
                  <p className="font-medium text-gray-600">
                    Validation en cours...
                  </p>
                </div>
              ) : (
                "Le rapport apparaîtra ici après l'analyse."
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-[400px] flex flex-col">
              <div className="overflow-y-auto p-5 space-y-5 custom-scrollbar flex-1">
                {normalizedValidation.critical?.length > 0 ? (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                    <h4 className="text-red-800 font-bold text-sm uppercase mb-3 flex items-center gap-2">
                      <FaTimesCircle className="text-lg" /> Erreurs Critiques
                    </h4>
                    <ul className="list-disc list-inside text-xs text-red-700 space-y-2 font-medium">
                      {normalizedValidation.critical.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4 text-center">
                    <FaCheckCircle className="text-green-500 text-2xl mx-auto mb-2" />
                    <p className="text-green-800 font-bold text-sm">
                      Aucune erreur critique détectée
                    </p>
                  </div>
                )}

                {(normalizedValidation.warnings?.length > 0 ||
                  normalizedValidation.suggestions?.length > 0) && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
                    <h4 className="text-amber-800 font-bold text-sm uppercase mb-3 flex items-center gap-2">
                      <FaExclamationTriangle /> Points d'attention
                    </h4>
                    <ul className="list-disc list-inside text-xs text-amber-800 space-y-2">
                      {normalizedValidation.warnings?.map((w, i) => (
                        <li key={`w-${i}`}>{w}</li>
                      ))}
                      {normalizedValidation.suggestions?.map((s, i) => (
                        <li key={`s-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-xs text-gray-600 border-t pt-4 mt-2 whitespace-pre-wrap leading-relaxed">
                  <span className="font-bold text-gray-800 block mb-1">
                    Résumé Global :
                  </span>
                  {normalizedValidation.report}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="mb-10 text-center relative">
          <button
            onClick={() => setShowLibrary(!showLibrary)}
            className="absolute right-0 top-0 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-full transition-colors flex items-center gap-2"
          >
            <FaDatabase /> Gérer la bibliothèque
          </button>
          <h1 className="text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">
            Assistant DCF <span className="text-blue-600">v7 Ultimate</span>
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Architecture "Full Database" • Génération Automatique • Vision SAP • Memory v7.4.6
          </p>
        </header>

        {showLibrary && renderLibrary()}

        <StepIndicator
          currentStep={step}
          steps={["Besoin", "Analyse", "Guidage & Auto-fill", "Validation"]}
        />

        <div className="transition-all duration-500 ease-in-out">
          {step === 1 && renderStep1_Describe()}
          {step === 2 && renderStep2_Recommend()}
          {step === 3 && renderStep3_Guide()}
          {step === 4 && renderStep4_Validate()}
        </div>
      </div>

      <div className="fixed bottom-4 right-4 text-[11px] text-gray-400 pointer-events-none font-medium bg-white/80 px-2 py-1 rounded backdrop-blur-sm border border-gray-100">
        © Copyright Daniel Palha
      </div>
    </div>
  );
}
