import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api, API_BASE } from "../lib/api.js";
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
  FaUpload,
  FaQuestionCircle,
  FaFilter,
  FaBug,
  FaEdit,
  FaSave,
  FaPlus,
  FaTrash,
  FaEye,
  FaImage,
  FaCog,
  FaClipboardList,
} from "react-icons/fa";

/* ============================================================================
   HELPER: Convert File to Data URL (CSP-safe alternative to blob URLs)
============================================================================ */

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/* ============================================================================
   UI COMPONENTS
============================================================================ */

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
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
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
                isActive ? "text-blue-600 font-bold" : "text-gray-500"
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
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Badge = ({ type = "info", children }) => {
  const colors = {
    info: "bg-blue-100 text-blue-800 border-blue-200",
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
    error: "bg-red-100 text-red-800 border-red-200",
    neutral: "bg-gray-100 text-gray-800 border-gray-200",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${colors[type]}`}>
      {children}
    </span>
  );
};

const Toasts = ({ toasts, onClose }) => (
  <div className="fixed right-4 top-4 z-50 flex flex-col gap-2 w-[360px] max-w-[90vw]">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`rounded-xl shadow-lg border px-4 py-3 animate-fade-in-up ${
          t.type === "error"
            ? "bg-red-50 border-red-200 text-red-900"
            : t.type === "warn"
            ? "bg-yellow-50 border-yellow-200 text-yellow-900"
            : "bg-emerald-50 border-emerald-200 text-emerald-900"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-bold">{t.title}</div>
          <button onClick={() => onClose(t.id)} className="text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
        {t.message && <div className="text-xs mt-1 whitespace-pre-wrap">{t.message}</div>}
      </div>
    ))}
  </div>
);

/* ============================================================================
   EDITABLE FIELD INSTRUCTION COMPONENT
============================================================================ */

const EditableFieldInstruction = ({
  row,
  col,
  code,
  label,
  value,
  reason,
  mandatory,
  sheet,
  editable,
  onValueChange,
  index,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");

  const handleSave = () => {
    onValueChange(index, editValue);
    setIsEditing(false);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4 p-4 bg-white rounded-lg border border-slate-200 mb-3 hover:border-blue-300 transition-colors shadow-sm group">
      {/* Cell Reference */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center min-w-[70px] bg-slate-50 rounded border border-slate-200 p-2">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Ligne</div>
        <div className="text-xl font-black text-slate-700">{row}</div>
        <div className="w-full h-px bg-slate-200 my-1"></div>
        <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Col</div>
        <div className="text-xl font-black text-blue-600">{col}</div>
      </div>

      {/* Content */}
      <div className="flex-grow space-y-2">
        <div className="flex items-center flex-wrap gap-2">
          {sheet && <Badge type="neutral">{sheet}</Badge>}
          <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 font-bold">
            {code}
          </span>
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          {mandatory ? <Badge type="error">Obligatoire</Badge> : <Badge type="warning">Optionnel</Badge>}
          {editable && <Badge type="info">Éditable</Badge>}
        </div>

        {/* Value Display/Edit */}
        <div>
          <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide font-medium flex items-center justify-between">
            <span>Valeur à saisir :</span>
            {editable && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <FaEdit size={12} /> Modifier
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border border-blue-300 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-400 outline-none"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
              />
              <button
                onClick={handleSave}
                className="bg-green-600 text-white px-3 py-2 rounded text-sm font-bold hover:bg-green-700 flex items-center gap-1"
              >
                <FaSave /> OK
              </button>
              <button
                onClick={() => {
                  setEditValue(value || "");
                  setIsEditing(false);
                }}
                className="bg-gray-300 text-gray-700 px-3 py-2 rounded text-sm hover:bg-gray-400"
              >
                Annuler
              </button>
            </div>
          ) : (
            <div
              className={`px-3 py-2 rounded font-mono text-sm font-medium select-all break-words shadow-inner ${
                value
                  ? "bg-blue-50 border border-blue-200 text-blue-900"
                  : "bg-yellow-50 border border-yellow-200 text-yellow-800 italic"
              }`}
            >
              {value || "À renseigner..."}
            </div>
          )}
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
};

/* ============================================================================
   SAP EXTRACTED DATA DISPLAY
============================================================================ */

const SAPExtractedData = ({ data = [] }) => {
  if (!data.length) return null;

  return (
    <Card className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
      <div className="flex items-center gap-2 mb-3">
        <FaCheckCircle className="text-green-600" />
        <h4 className="font-bold text-green-900 text-sm">Données extraites des captures SAP</h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.map((item, idx) => (
          <div
            key={idx}
            className="bg-white border border-green-200 rounded-lg px-3 py-1.5 text-sm flex items-center gap-2"
          >
            <span className="font-mono text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">
              {item.code}
            </span>
            <span className="text-gray-800 font-medium">{item.value}</span>
            {item.confidence === "high" && (
              <FaCheckCircle className="text-green-500 text-xs" />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

/* ============================================================================
   SCREENSHOT UPLOAD ZONE
============================================================================ */

const ScreenshotUploadZone = ({ onUpload, loading, count = 0, compact = false }) => (
  <Card className={`${compact ? "p-4" : "p-6"} bg-gradient-to-b from-blue-50 to-white border-blue-200`}>
    <h3 className={`${compact ? "text-xs" : "text-sm"} font-bold text-blue-900 mb-2 flex items-center gap-2`}>
      <FaCamera className="text-blue-600" /> Captures SAP (Vision IA)
    </h3>
    {!compact && (
      <p className="text-xs text-blue-800 mb-4 leading-relaxed">
        Envoie des screenshots SAP (IP02, IA05, IP18...) pour extraire automatiquement les données.
      </p>
    )}

    <label className="block w-full border-2 border-dashed border-blue-300 bg-white/80 rounded-xl p-6 text-center cursor-pointer hover:bg-blue-50 hover:border-blue-500 transition-all group relative">
      {loading ? (
        <FaSpinner className="animate-spin mx-auto text-blue-500 text-2xl" />
      ) : (
        <>
          <FaCamera className="mx-auto text-blue-400 mb-2 text-2xl group-hover:scale-110 transition-transform" />
          <span className="text-sm font-bold text-blue-600 block">
            {count > 0 ? `${count} capture(s) - Ajouter plus` : "Déposer des captures ici"}
          </span>
          <span className="text-xs text-blue-400">PNG, JPG, etc.</span>
        </>
      )}
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onUpload}
        disabled={loading}
      />
    </label>
  </Card>
);

/* ============================================================================
   SCREENSHOT PREVIEW COMPONENT (uses data URLs instead of blob URLs)
============================================================================ */

const ScreenshotPreview = ({ screenshots, onRemove }) => {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadPreviews = async () => {
      const results = await Promise.all(
        screenshots.map(async (file) => {
          try {
            const dataUrl = await fileToDataURL(file);
            return { name: file.name, dataUrl };
          } catch {
            return { name: file.name, dataUrl: null };
          }
        })
      );
      if (!cancelled) {
        setPreviews(results);
      }
    };

    loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [screenshots]);

  if (!previews.length) return null;

  return (
    <div className="mt-4 grid grid-cols-4 gap-2">
      {previews.map((preview, i) => (
        <div key={i} className="relative">
          {preview.dataUrl ? (
            <img
              src={preview.dataUrl}
              alt={preview.name}
              className="w-full h-20 object-cover rounded border"
            />
          ) : (
            <div className="w-full h-20 bg-gray-200 rounded border flex items-center justify-center">
              <FaImage className="text-gray-400" />
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
          >
            ×
          </button>
          <div className="text-[9px] text-gray-500 truncate mt-1">{preview.name}</div>
        </div>
      ))}
    </div>
  );
};

/* ============================================================================
   USE CASE EXPLANATION
============================================================================ */

const UseCaseExplanation = ({ useCase, description }) => {
  const useCaseIcons = {
    modify_operation: FaEdit,
    create_operation: FaPlus,
    add_equipment_to_plan: FaCog,
    modify_equipment: FaCog,
    create_plan: FaClipboardList,
    assign_equipment_existing_plan: FaClipboardList,
    delete_operation: FaTrash,
    delete_plan: FaTrash,
  };

  const Icon = useCaseIcons[useCase] || FaQuestionCircle;

  const colors = {
    modify_operation: "bg-amber-100 text-amber-800 border-amber-200",
    create_operation: "bg-green-100 text-green-800 border-green-200",
    add_equipment_to_plan: "bg-purple-100 text-purple-800 border-purple-200",
    modify_equipment: "bg-blue-100 text-blue-800 border-blue-200",
    create_plan: "bg-indigo-100 text-indigo-800 border-indigo-200",
    delete_operation: "bg-red-100 text-red-800 border-red-200",
    delete_plan: "bg-red-100 text-red-800 border-red-200",
  };

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${colors[useCase] || "bg-gray-100"}`}>
      <Icon className="text-xl" />
      <div>
        <div className="font-bold text-sm">{useCase?.replace(/_/g, " ").toUpperCase()}</div>
        <div className="text-xs">{description}</div>
      </div>
    </div>
  );
};

/* ============================================================================
   MAIN COMPONENT
============================================================================ */

export default function DCFWizardV8() {
  const stepsLabel = ["Demande + Captures", "Choix fichier(s)", "Instructions", "Validation"];

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const notify = useCallback((type, title, message = "") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);
  const closeToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // Library
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [uploadingLib, setUploadingLib] = useState(false);

  // Step 1
  const [requestText, setRequestText] = useState("");
  const [step1Screenshots, setStep1Screenshots] = useState([]);
  const [uploadingStep1, setUploadingStep1] = useState(false);

  // Step 2
  const [analysis, setAnalysis] = useState(null);
  const [fillingTemplate, setFillingTemplate] = useState(null);

  // Step 3
  const [activeFile, setActiveFile] = useState(null);
  const [instructions, setInstructions] = useState([]);
  const [sapExtracted, setSapExtracted] = useState([]);
  const [missingData, setMissingData] = useState([]);
  const [step3Screenshots, setStep3Screenshots] = useState([]);
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [hideOptional, setHideOptional] = useState(false);

  // Step 4
  const [validationFiles, setValidationFiles] = useState([]);
  const [validationReport, setValidationReport] = useState(null);

  const mountedRef = useRef(true);

  /* --------------------------------------------------------------------------
     HELPERS
  -------------------------------------------------------------------------- */

  const toLine = (x) => {
    if (typeof x === "string") return x;
    if (!x || typeof x !== "object") return String(x ?? "");
    return JSON.stringify(x);
  };

  const excelColToNumber = (col = "") => {
    let n = 0;
    const s = String(col).toUpperCase().trim();
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) - 64;
      if (c < 1 || c > 26) continue;
      n = n * 26 + c;
    }
    return n || 0;
  };

  const safeRowNumber = (r) => {
    const m = String(r || "").match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };

  /* --------------------------------------------------------------------------
     INSTRUCTIONS PROCESSING
  -------------------------------------------------------------------------- */

  const normalizedInstructions = useMemo(() => {
    if (!Array.isArray(instructions)) return [];
    return instructions.map((inst, idx) => ({
      index: idx,
      row: toLine(inst?.row),
      col: toLine(inst?.col),
      code: toLine(inst?.code),
      label: toLine(inst?.label),
      value: toLine(inst?.value),
      reason: inst?.reason ? toLine(inst.reason) : "",
      mandatory: Boolean(inst?.mandatory),
      sheet: inst?.sheet ? toLine(inst.sheet) : "",
      editable: inst?.editable !== false,
    }));
  }, [instructions]);

  const filteredSortedInstructions = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    let list = normalizedInstructions;

    if (hideOptional) list = list.filter((x) => x.mandatory);

    if (q) {
      list = list.filter((x) => {
        const hay = `${x.sheet} ${x.row} ${x.col} ${x.code} ${x.label} ${x.value} ${x.reason}`.toLowerCase();
        return hay.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const sa = (a.sheet || "").toLowerCase();
      const sb = (b.sheet || "").toLowerCase();
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      const ra = safeRowNumber(a.row);
      const rb = safeRowNumber(b.row);
      if (ra !== rb) return ra - rb;
      return excelColToNumber(a.col) - excelColToNumber(b.col);
    });
  }, [normalizedInstructions, searchQ, hideOptional]);

  const handleValueChange = (index, newValue) => {
    setInstructions((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], value: newValue };
      }
      return updated;
    });
  };

  /* --------------------------------------------------------------------------
     INIT
  -------------------------------------------------------------------------- */

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      try {
        const res = await api.dcf.startSession({ title: "Wizard DCF v8" });
        if (mountedRef.current && res?.sessionId) setSessionId(res.sessionId);
        refreshLibrary();
      } catch (e) {
        console.error(e);
        notify("error", "Erreur démarrage session", e.message);
      }
    };

    init();
    return () => { mountedRef.current = false; };
  }, [notify]);

  const refreshLibrary = async () => {
    try {
      const res = await api.dcf.listFiles();
      if (mountedRef.current) setLibraryFiles(res?.files || []);
    } catch (e) {
      console.error(e);
    }
  };

  /* --------------------------------------------------------------------------
     HANDLERS
  -------------------------------------------------------------------------- */

  const handleLibraryUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingLib(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      await api.dcf.uploadExcelMulti(fd);
      await refreshLibrary();
      notify("ok", "Templates ajoutés", `${files.length} fichier(s)`);
    } catch (e2) {
      notify("error", "Erreur upload", e2.message);
    } finally {
      setUploadingLib(false);
      e.target.value = "";
    }
  };

  const handleStep1ScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setStep1Screenshots((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const removeStep1Screenshot = (index) => {
    setStep1Screenshots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyzeRequest = async () => {
    if (!requestText.trim()) return;

    setLoading(true);
    setAnalysis(null);

    try {
      // Créer FormData avec message et screenshots
      const fd = new FormData();
      fd.append("message", requestText);
      if (sessionId) fd.append("sessionId", sessionId);
      step1Screenshots.forEach((f) => fd.append("screenshots", f));

      // Appel API avec FormData
      const res = await fetch(`${API_BASE}/api/dcf/wizard/analyze`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `HTTP ${res.status}`);
      }
      
      const data = await res.json();

      if (!mountedRef.current) return;

      setAnalysis(data);
      setSapExtracted(data.sap_extracted || []);
      setStep(2);
    } catch (e) {
      console.error("Analyze error:", e);
      notify("error", "Erreur analyse", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = async (fileObj) => {
    setFillingTemplate(fileObj?.template_filename);
    setActiveFile(fileObj);
    setLoading(true);
    setInstructions([]);
    setMissingData([]);
    setStep3Screenshots([]);

    try {
      const res = await api.dcf.wizard.instructions(sessionId, requestText, fileObj.template_filename, []);

      if (!mountedRef.current) return;

      setInstructions(res.steps || []);
      setMissingData(res.missing_data || []);
      if (res.sap_extracted) setSapExtracted(res.sap_extracted);
      setStep(3);
    } catch (e) {
      notify("error", "Erreur génération instructions", e.message);
    } finally {
      setLoading(false);
      setFillingTemplate(null);
    }
  };

  const handleStep3ScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (!activeFile?.template_filename) {
      notify("warn", "Template non sélectionné");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setStep3Screenshots((prev) => [...prev, ...files]);

    try {
      // Upload avec FormData
      const fd = new FormData();
      fd.append("sessionId", sessionId);
      fd.append("requestText", requestText);
      fd.append("templateFilename", activeFile.template_filename);
      files.forEach((f) => fd.append("screenshots", f));

      const res = await fetch(`${API_BASE}/api/dcf/wizard/instructions`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `HTTP ${res.status}`);
      }
      
      const data = await res.json();

      if (!mountedRef.current) return;

      setInstructions(data.steps || []);
      setMissingData(data.missing_data || []);
      if (data.sap_extracted) setSapExtracted(data.sap_extracted);
      notify("ok", "Captures analysées", `${files.length} nouvelle(s) capture(s)`);
    } catch (e2) {
      notify("error", "Erreur analyse image", e2.message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const removeStep3Screenshot = (index) => {
    setStep3Screenshots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAutofill = async () => {
    if (!filteredSortedInstructions.length || !activeFile?.template_filename) return;

    setAutofillLoading(true);

    try {
      const safeSteps = filteredSortedInstructions.map((s) => ({
        row: String(s.row || "").trim(),
        col: String(s.col || "").trim(),
        code: String(s.code || "").trim(),
        value: s.value ?? "",
        sheet: s.sheet || "",
      }));

      const blob = await api.dcf.wizard.autofill(activeFile.template_filename, safeSteps);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = activeFile.template_filename.toLowerCase().endsWith(".xlsm") ? ".xlsm" : ".xlsx";
      a.download = `FILLED_${activeFile.template_filename.replace(/\.(xlsm|xlsx)$/i, "")}${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      notify("ok", "Fichier généré", "Téléchargement lancé");
    } catch (e) {
      notify("error", "Erreur génération Excel", e.message);
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
      const fileIds = (upRes?.files || []).map((f) => f.id).filter(Boolean);

      if (!fileIds.length) throw new Error("Aucun fichier valide");

      const valRes = await api.dcf.wizard.validate(fileIds, analysis?.action);

      if (!mountedRef.current) return;
      setValidationReport(valRes);
      notify("ok", "Validation terminée");
    } catch (e) {
      notify("error", "Erreur validation", e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadBlankTemplate = async (file) => {
    try {
      const id = file.file_id || file.id;
      if (!id) {
        notify("warn", "Template vierge indisponible");
        return;
      }
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
      }
    } catch (e) {
      notify("warn", "Téléchargement échoué", e.message);
    }
  };

  /* --------------------------------------------------------------------------
     RENDERERS
  -------------------------------------------------------------------------- */

  const renderLibrary = () => (
    <div className="bg-slate-100 border-b border-slate-200 p-4 rounded-xl mb-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
          <FaDatabase className="text-blue-600" /> Bibliothèque ({libraryFiles.length})
        </h3>
        <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-slate-600 text-sm">
          Fermer
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 border-dashed border-2 border-blue-200 bg-blue-50 flex flex-col items-center">
          <FaUpload className="text-blue-400 text-2xl mb-2" />
          <p className="text-sm font-bold text-blue-800 mb-2">Importer Templates</p>
          <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded cursor-pointer text-sm font-medium">
            {uploadingLib ? <FaSpinner className="animate-spin inline" /> : "Sélectionner Excel"}
            <input type="file" accept=".xlsx,.xls,.xlsm" multiple className="hidden" onChange={handleLibraryUpload} />
          </label>
        </Card>

        <div className="bg-white rounded-xl border max-h-48 overflow-y-auto">
          {libraryFiles.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm italic">Aucun template</div>
          ) : (
            <ul className="divide-y">
              {libraryFiles.map((f) => (
                <li key={f.id} className="px-4 py-2 text-xs flex justify-between hover:bg-slate-50">
                  <span className="truncate font-medium flex items-center gap-2">
                    <FaFileExcel className="text-green-600" /> {f.filename}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800">Décris ton besoin + Captures SAP</h2>
        <p className="text-gray-500">Upload tes screenshots SAP dès maintenant pour extraction automatique</p>
      </div>

      <Card className="p-6">
        <textarea
          className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900 placeholder-gray-400 text-base mb-4"
          placeholder="Ex: Je dois ajouter l'opération de vérification des sondes dans le plan 30482333..."
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
        />

        {/* Screenshot Upload Zone */}
        <ScreenshotUploadZone
          onUpload={handleStep1ScreenshotUpload}
          loading={uploadingStep1}
          count={step1Screenshots.length}
        />

        {/* Preview des screenshots avec data URLs */}
        <ScreenshotPreview 
          screenshots={step1Screenshots} 
          onRemove={removeStep1Screenshot} 
        />

        <div className="flex justify-between items-center mt-4">
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <FaRobot /> DCF Assistant v8.0
          </div>
          <button
            onClick={handleAnalyzeRequest}
            disabled={loading || !requestText.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaSearch />}
            Analyser
          </button>
        </div>
      </Card>

      <div className="text-center">
        <button onClick={() => setShowLibrary((v) => !v)} className="text-sm text-blue-700 hover:underline">
          {showLibrary ? "Fermer" : "Voir"} la bibliothèque
        </button>
      </div>

      {showLibrary && renderLibrary()}
    </div>
  );

  const renderStep2 = () => {
    if (analysis?.is_manual) {
      return (
        <div className="animate-fade-in text-center py-12 max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full mb-6 text-5xl">
            <FaCheckCircle />
          </div>
          <h2 className="text-3xl font-bold text-gray-800 mb-3">Pas besoin de DCF !</h2>
          <p className="text-gray-600 mb-8">{toLine(analysis.reasoning)}</p>
          <button onClick={() => setStep(1)} className="text-blue-600 font-bold hover:underline">
            ← Nouvelle demande
          </button>
        </div>
      );
    }

    const files = analysis?.required_files || [];

    return (
      <div className="animate-fade-in space-y-6 max-w-5xl mx-auto">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Fichiers DCF requis</h2>
          {analysis?.action && (
            <UseCaseExplanation useCase={analysis.action} description={analysis.description} />
          )}
        </div>

        {/* SAP Extracted Data */}
        {sapExtracted.length > 0 && <SAPExtractedData data={sapExtracted} />}

        {/* Reference Info */}
        {analysis?.reference_info && (
          <Card className="p-4 bg-indigo-50 border-indigo-200">
            <div className="flex items-center gap-2 mb-2">
              <FaDatabase className="text-indigo-600" />
              <h4 className="font-bold text-indigo-900 text-sm">Données du référentiel</h4>
            </div>
            <p className="text-sm text-indigo-800 whitespace-pre-wrap">{analysis.reference_info}</p>
          </Card>
        )}

        {/* Questions */}
        {analysis?.questions?.length > 0 && (
          <Card className="p-4 bg-yellow-50 border-yellow-200">
            <div className="flex items-center gap-2 mb-2">
              <FaQuestionCircle className="text-yellow-600" />
              <h4 className="font-bold text-yellow-900 text-sm">Questions de clarification</h4>
            </div>
            <ul className="list-disc ml-5 text-sm text-yellow-900">
              {analysis.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Card>
        )}

        {/* Files Grid */}
        {files.length === 0 ? (
          <Card className="p-8 text-center">
            <FaExclamationTriangle className="mx-auto text-yellow-500 text-3xl mb-3" />
            <p className="font-bold text-gray-800">Aucun template trouvé</p>
            <p className="text-sm text-gray-600">Ajoute les templates DCF dans la bibliothèque</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {files.map((file, idx) => (
              <Card key={idx} className="flex flex-col border-t-4 border-t-blue-500 hover:shadow-lg transition-all">
                <div className="p-6 flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <Badge type="info">{toLine(file.type)}</Badge>
                    <FaFileExcel className="text-emerald-600 text-2xl" />
                  </div>
                  <h3 className="font-bold text-gray-800 mb-2">{toLine(file.template_filename)}</h3>
                  {file.rules?.length > 0 && (
                    <div className="text-xs text-gray-500">
                      Règles: {file.rules.map((r) => r.split(".")[1]).join(", ")}
                    </div>
                  )}
                </div>
                <div className="p-4 bg-gray-50 border-t flex gap-3">
                  <button
                    onClick={() => downloadBlankTemplate(file)}
                    className="flex-1 bg-white border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 flex items-center justify-center gap-2"
                  >
                    <FaDownload /> Vierge
                  </button>
                  <button
                    onClick={() => handleSelectFile(file)}
                    disabled={loading || fillingTemplate === file.template_filename}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {fillingTemplate === file.template_filename ? (
                      <FaSpinner className="animate-spin" />
                    ) : (
                      <>
                        Remplir <FaArrowRight />
                      </>
                    )}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="text-center">
          <button onClick={() => setStep(1)} className="text-sm text-gray-400 hover:text-gray-600 underline">
            Modifier ma demande
          </button>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
    <div className="animate-fade-in max-w-[1600px] 2xl:max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b">
        <div>
          <button onClick={() => setStep(2)} className="text-xs font-bold text-gray-400 hover:text-blue-600 mb-1 flex items-center gap-1">
            <FaArrowLeft /> Retour
          </button>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FaFileExcel className="text-emerald-600" />
            <span className="truncate max-w-md">{toLine(activeFile?.template_filename)}</span>
          </h2>
          <div className="text-xs text-gray-500 mt-1">
            {normalizedInstructions.length} instruction(s) • {sapExtracted.length} donnée(s) SAP extraites
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAutofill}
            disabled={autofillLoading || !filteredSortedInstructions.length}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-lg font-bold hover:from-blue-700 hover:to-indigo-700 flex items-center gap-2 shadow-lg disabled:opacity-50"
          >
            {autofillLoading ? <FaSpinner className="animate-spin" /> : <FaMagic className="text-yellow-300" />}
            Générer Excel rempli
          </button>
          <button
            onClick={() => setStep(4)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            Validation <FaArrowRight />
          </button>
        </div>
      </div>

      {/* SAP Data Display */}
      {sapExtracted.length > 0 && (
        <div className="mb-6">
          <SAPExtractedData data={sapExtracted} />
        </div>
      )}

      {/* Missing Data Warning */}
      {missingData.length > 0 && (
        <Card className="p-4 mb-6 bg-yellow-50 border-yellow-200">
          <div className="flex items-center gap-2 mb-2">
            <FaExclamationTriangle className="text-yellow-600" />
            <h4 className="font-bold text-yellow-900 text-sm">Données manquantes</h4>
          </div>
          <ul className="list-disc ml-5 text-sm text-yellow-900">
            {missingData.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <p className="text-xs text-yellow-800 mt-2">
            Ajoute des captures SAP pour compléter automatiquement ces champs.
          </p>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-3 mb-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex items-center gap-2 flex-1">
            <FaSearch className="text-gray-400" />
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none"
              placeholder="Rechercher..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
          <button
            onClick={() => setHideOptional((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-bold border flex items-center gap-2 ${
              hideOptional ? "bg-slate-900 text-white" : "bg-white text-slate-700 border-slate-200"
            }`}
          >
            <FaFilter />
            {hideOptional ? "Obligatoires only" : "Tout afficher"}
          </button>
        </div>
      </Card>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Instructions List */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="font-bold text-gray-700 text-lg">
            Instructions ({filteredSortedInstructions.length})
          </h3>

          {loading ? (
            <div className="h-80 flex flex-col items-center justify-center bg-white rounded-xl border border-dashed">
              <FaSpinner className="animate-spin text-4xl mb-4 text-blue-500" />
              <p className="font-medium text-gray-500">Analyse en cours...</p>
            </div>
          ) : filteredSortedInstructions.length > 0 ? (
            filteredSortedInstructions.map((inst) => (
              <EditableFieldInstruction
                key={inst.index}
                {...inst}
                onValueChange={handleValueChange}
              />
            ))
          ) : (
            <div className="p-10 bg-yellow-50 border border-yellow-100 rounded-xl text-center">
              <FaExclamationTriangle className="mx-auto text-3xl mb-3 text-yellow-500" />
              <p className="font-bold">Aucune instruction à afficher</p>
            </div>
          )}
        </div>

        {/* Sidebar - Screenshot Upload */}
        <div className="space-y-6">
          <div className="sticky top-6">
            <ScreenshotUploadZone
              onUpload={handleStep3ScreenshotUpload}
              loading={loading}
              count={step3Screenshots.length}
            />

            {step3Screenshots.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase">Captures ajoutées</h4>
                {step3Screenshots.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-700 bg-white p-2 rounded border">
                    <FaCheckCircle className="text-green-500" />
                    <span className="truncate flex-1">{s.name}</span>
                    <button 
                      onClick={() => removeStep3Screenshot(i)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <FaTrash size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Validation Qualité</h2>
        <p className="text-gray-500 text-sm">Importe les fichiers FILLED pour vérification</p>
      </div>

      <Card className="p-6">
        <label className="block w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-all">
          <FaFileExcel className="mx-auto text-green-600 mb-3 text-3xl" />
          <span className="text-sm font-bold text-gray-700 block">Déposer les fichiers FILLED</span>
          <span className="text-xs text-gray-400">.xlsx / .xlsm</span>
          <input type="file" accept=".xlsx,.xls,.xlsm" multiple className="hidden" onChange={handleValidationUpload} />
        </label>

        {validationFiles.length > 0 && (
          <div className="mt-4 text-sm text-gray-700">
            <strong>{validationFiles.length}</strong> fichier(s) prêt(s)
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={runValidation}
            disabled={loading || !validationFiles.length}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
            Valider
          </button>
        </div>
      </Card>

      {validationReport && (
        <Card className="p-6 space-y-4">
          <h3 className="font-bold text-gray-800 text-lg">Rapport</h3>

          {validationReport.report && <p className="text-sm text-gray-700">{validationReport.report}</p>}

          {validationReport.critical?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="font-bold text-red-800 mb-2 flex items-center gap-2">
                <FaTimesCircle /> Erreurs critiques
              </div>
              <ul className="list-disc ml-5 text-sm text-red-900 space-y-1">
                {validationReport.critical.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {validationReport.warnings?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="font-bold text-yellow-800 mb-2 flex items-center gap-2">
                <FaExclamationTriangle /> Avertissements
              </div>
              <ul className="list-disc ml-5 text-sm text-yellow-900 space-y-1">
                {validationReport.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {validationReport.suggestions?.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                <FaInfoCircle /> Suggestions
              </div>
              <ul className="list-disc ml-5 text-sm text-blue-900 space-y-1">
                {validationReport.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="text-center">
        <button onClick={() => setStep(3)} className="text-sm text-blue-700 hover:underline">
          ← Retour aux instructions
        </button>
      </div>
    </div>
  );

  /* --------------------------------------------------------------------------
     MAIN RENDER
  -------------------------------------------------------------------------- */

  return (
    <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
      <Toasts toasts={toasts} onClose={closeToast} />
      <StepIndicator currentStep={step} steps={stepsLabel} />

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </div>
  );
}
