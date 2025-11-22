import React, { useState, useEffect, useRef } from "react";
import { api } from "../lib/api.js";
import { 
  FaArrowRight, FaCheckCircle, FaExclamationTriangle, FaTimesCircle, 
  FaSearch, FaFileExcel, FaCamera, FaSpinner, FaDownload, FaChevronRight
} from "react-icons/fa";

// --- COMPOSANTS UI ---

const StepIndicator = ({ currentStep, steps }) => (
  <div className="mb-8">
    <div className="flex items-center justify-between relative">
      <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10" />
      {steps.map((step, idx) => {
        const isCompleted = currentStep > idx + 1;
        const isActive = currentStep === idx + 1;
        return (
          <div key={idx} className="flex flex-col items-center bg-white px-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors duration-300 ${
                isActive
                  ? "bg-blue-600 text-white ring-4 ring-blue-100"
                  : isCompleted
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {isCompleted ? <FaCheckCircle /> : idx + 1}
            </div>
            <span
              className={`mt-2 text-xs font-medium ${
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
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const FieldInstruction = ({ row, col, code, label, value, reason, mandatory }) => (
  <div className="flex flex-col sm:flex-row gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200 mb-3 hover:shadow-md transition-shadow">
    {/* Positionnement */}
    <div className="flex-shrink-0 flex flex-col items-center justify-center min-w-[80px] bg-white rounded border border-slate-200 p-2">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider">Excel</span>
      <div className="text-sm font-bold text-slate-700">Ligne {row}</div>
      <div className="text-lg font-black text-blue-600">{col}</div>
    </div>

    {/* Détails */}
    <div className="flex-grow space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">
          {code}
        </span>
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {mandatory && (
          <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold uppercase">
            Obligatoire
          </span>
        )}
      </div>
      
      <div className="flex items-start gap-3 mt-2">
        <div className="flex-1">
           <div className="text-xs text-gray-500 mb-1">Valeur à saisir :</div>
           <div className="bg-white border border-blue-200 text-blue-800 px-3 py-2 rounded font-mono text-sm font-medium select-all">
             {value}
           </div>
        </div>
      </div>

      {reason && (
        <div className="text-xs text-gray-500 italic flex items-center gap-1 mt-1">
          <FaChevronRight className="text-blue-400" size={10} />
          {reason}
        </div>
      )}
    </div>
  </div>
);

const ValidationItem = ({ type, title, detail, location }) => {
  const config = {
    critical: { icon: FaTimesCircle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
    warning: { icon: FaExclamationTriangle, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
    success: { icon: FaCheckCircle, color: "text-green-600", bg: "bg-green-50", border: "border-green-200" },
  };
  const style = config[type] || config.success;
  const Icon = style.icon;

  return (
    <div className={`flex gap-3 p-3 rounded-md border ${style.bg} ${style.border} mb-2`}>
      <Icon className={`mt-1 flex-shrink-0 ${style.color}`} />
      <div>
        <div className={`text-sm font-bold ${style.color}`}>{title}</div>
        <div className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{detail}</div>
        {location && (
          <div className="text-[10px] text-gray-500 mt-2 font-mono">
            📍 {location}
          </div>
        )}
      </div>
    </div>
  );
};

// --- LOGIQUE PRINCIPALE ---

export default function DCFWizard() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Data Step 1
  const [requestText, setRequestText] = useState("");

  // Data Step 2 (Recommendation)
  const [analysis, setAnalysis] = useState(null);

  // Data Step 3 (Instructions)
  const [instructions, setInstructions] = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotAnalysis, setScreenshotAnalysis] = useState(null);

  // Data Step 4 (Validation)
  const [validationFile, setValidationFile] = useState(null);
  const [validationReport, setValidationReport] = useState(null);
  const [validationParsing, setValidationParsing] = useState({ critical: [], warnings: [], suggestions: [] });

  // Initialisation session
  useEffect(() => {
    const initSession = async () => {
      try {
        const res = await api.dcf.startSession({ title: "Wizard DCF v4" });
        if (res?.sessionId) setSessionId(res.sessionId);
      } catch (e) { console.error("Session init error", e); }
    };
    initSession();
  }, []);

  // --- HANDLERS ---

  // ÉTAPE 1 -> 2 : ANALYSE DE LA DEMANDE
  const handleAnalyzeRequest = async () => {
    if (!requestText.trim()) return;
    setLoading(true);
    try {
      // On utilise l'IA pour simuler le moteur d'analyse v4
      const prompt = `
        AGIS COMME LE MOTEUR D'ANALYSE DCF v4.
        Analyse la demande utilisateur : "${requestText}".
        
        Réponds UNIQUEMENT en JSON strict avec ce format :
        {
          "action": "create_operation" | "modify_plan" | "unknown",
          "dcf_type": "Task List" | "Maintenance Plan" | "Equipment",
          "template_version": "4.06",
          "template_filename": "ERP_MDCF_Task_List_4_06.xlsm",
          "reasoning": "Explique pourquoi ce fichier en 1 phrase.",
          "similar_count": 12
        }
      `;
      
      const res = await api.dcf.chat({
        sessionId,
        message: prompt,
        mode: "guidage" // mode caché
      });

      let data;
      try {
        // Nettoyage du markdown code block si présent
        const jsonStr = res.answer.replace(/```json/g, "").replace(/```/g, "").trim();
        data = JSON.parse(jsonStr);
      } catch (e) {
        // Fallback si l'IA ne sort pas du JSON propre
        data = {
          action: "unknown",
          dcf_type: "Standard DCF",
          template_filename: "ERP_MDCF_Generic.xlsm",
          reasoning: res.answer,
          similar_count: 0
        };
      }

      setAnalysis(data);
      setStep(2);
    } catch (e) {
      alert("Erreur d'analyse: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ÉTAPE 2 -> 3 : GÉNÉRATION INSTRUCTIONS
  const handleGenerateInstructions = async () => {
    setLoading(true);
    try {
      // On demande à l'IA de générer les instructions étape par étape
      const prompt = `
        CONTEXTE: L'utilisateur veut "${requestText}" en utilisant le fichier "${analysis.template_filename}".
        
        Génère une liste d'instructions PRÉCISES pour remplir le fichier Excel.
        Réponds UNIQUEMENT en JSON strict (Array d'objets) :
        [
          {
            "row": "6",
            "col": "H",
            "code": "ACTION",
            "label": "Action Type",
            "value": "Create",
            "reason": "Action demandée",
            "mandatory": true
          },
          ...
        ]
        Invente des exemples réalistes basés sur la demande (ex: Work Center CH94...).
      `;

      const res = await api.dcf.chat({
        sessionId,
        message: prompt,
        mode: "guidage"
      });

      try {
        const jsonStr = res.answer.replace(/```json/g, "").replace(/```/g, "").trim();
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data)) setInstructions(data);
        else setInstructions([]);
      } catch (e) {
        // Fallback texte simple si JSON échoue
        setInstructions([]); 
      }
      setStep(3);
    } catch (e) {
      alert("Erreur génération: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ÉTAPE 3 : UPLOAD SCREENSHOT SAP
  const handleScreenshotUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoading(true);
    setScreenshot(file);
    
    try {
      // 1. Upload attachment
      const uploadRes = await api.dcf.uploadAttachments([file], sessionId);
      const attId = uploadRes.items[0].id;

      // 2. Ask AI to analyze
      const prompt = `
        Analyse cette capture d'écran SAP.
        Extrais les informations utiles pour mon DCF (Task List, Work Center, ID équipement, Plans).
        Réponds en format liste à puces simple et lisible.
      `;

      const chatRes = await api.dcf.chat({
        sessionId,
        message: prompt,
        attachmentIds: [attId],
        mode: "guidage"
      });

      setScreenshotAnalysis(chatRes.answer);
    } catch (e) {
      alert("Erreur analyse image: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ÉTAPE 4 : VALIDATION
  const handleValidationUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setValidationFile(file);
  };

  const runValidation = async () => {
    if (!validationFile) return;
    setLoading(true);
    try {
      // 1. Upload simple
      const upRes = await api.dcf.uploadExcel(validationFile);
      const fileId = upRes.file.id;

      // 2. Validate
      const valRes = await api.dcf.validate({ fileIds: [fileId], mode: "auto" });
      setValidationReport(valRes.report);

      // 3. Tentative de parsing basique du rapport texte (pour l'UI)
      // L'IA retourne souvent du texte libre, on va essayer de le catégoriser sommairement
      const lines = valRes.report.split('\n');
      const parsed = { critical: [], warnings: [], suggestions: [] };
      
      let currentCat = "suggestions";
      lines.forEach(line => {
        const l = line.toLowerCase();
        if (l.includes("critique") || l.includes("error")) currentCat = "critical";
        else if (l.includes("attention") || l.includes("warning")) currentCat = "warnings";
        else if (l.includes("suggestion")) currentCat = "suggestions";
        
        if (line.trim().length > 5 && !line.includes("---")) {
          parsed[currentCat].push(line.trim());
        }
      });
      setValidationParsing(parsed);

    } catch (e) {
      alert("Erreur validation: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERERS ---

  const renderStep1 = () => (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">Que dois-tu faire dans SAP ?</h2>
        <p className="text-gray-500">Décris ta tâche en langage naturel, je trouverai le bon template.</p>
      </div>

      <Card className="p-6 max-w-2xl mx-auto">
        <textarea
          className="w-full h-32 p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-700 text-base"
          placeholder="Ex: Je dois créer une nouvelle opération de vérification des sondes pour la chambre de stabilité 953..."
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
        />
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleAnalyzeRequest}
            disabled={loading || !requestText}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-200"
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaSearch />}
            Analyser ma demande
          </button>
        </div>
      </Card>

      {/* Historique factice pour l'UI v4 */}
      <div className="max-w-2xl mx-auto mt-8">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Dernières actions</h3>
        <div className="space-y-2">
          {["Création Task List Moteur VSD", "Ajout plan préventif HVAC"].map((item, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-white rounded border border-gray-100 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer">
              <span>{item}</span>
              <span className="text-xs text-gray-400">Il y a 2 jours</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">Analyse terminée !</h2>
        <p className="text-gray-500">Voici le fichier DCF recommandé pour ta tâche.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {/* Carte Fichier Recommandé */}
        <Card className="p-6 border-l-4 border-l-blue-500 relative">
          <div className="absolute top-4 right-4 text-blue-100">
            <FaFileExcel size={60} />
          </div>
          <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Fichier à utiliser</h3>
          <div className="text-xl font-bold text-gray-800 mb-2 break-all">
            {analysis?.template_filename || "Chargement..."}
          </div>
          <p className="text-sm text-gray-600 mb-6">
            {analysis?.reasoning || "Ce template correspond à la structure de données détectée."}
          </p>
          
          <div className="flex gap-3">
             <button className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded flex items-center justify-center gap-2 text-sm font-medium">
               <FaDownload /> Télécharger vierge
             </button>
          </div>
        </Card>

        {/* Carte Bibliothèque */}
        <Card className="p-6 bg-slate-50">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Intelligence Collective</h3>
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-green-100 text-green-700 p-2 rounded-full">
              <FaCheckCircle />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800">{analysis?.similar_count || 0}</div>
              <div className="text-xs text-slate-500">Exemples similaires trouvés</div>
            </div>
          </div>
          <p className="text-sm text-slate-600 italic">
            "Le système a identifié des opérations similaires créées le mois dernier pour le site de Nyon. Les valeurs par défaut seront adaptées."
          </p>
        </Card>
      </div>

      <div className="flex justify-center pt-6">
        <button
            onClick={handleGenerateInstructions}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-blue-200"
          >
            {loading ? <FaSpinner className="animate-spin" /> : "Commencer le guidage"} <FaArrowRight />
        </button>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-xl font-bold text-gray-800">Instructions de Remplissage</h2>
           <p className="text-sm text-gray-500">Suis ces étapes pour remplir {analysis?.template_filename}</p>
        </div>
        <button 
          onClick={() => setStep(4)} 
          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          Passer à la validation <FaArrowRight />
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Colonne gauche : Instructions */}
        <div className="lg:col-span-2 space-y-4">
          {loading && instructions.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64 text-gray-400">
               <FaSpinner className="animate-spin text-3xl mb-2" />
               <p>Génération des instructions...</p>
             </div>
          ) : (
            instructions.map((inst, idx) => (
              <FieldInstruction
                key={idx}
                row={inst.row}
                col={inst.col}
                code={inst.code}
                label={inst.label}
                value={inst.value}
                reason={inst.reason}
                mandatory={inst.mandatory}
              />
            ))
          )}
          {instructions.length === 0 && !loading && (
             <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
               L'IA n'a pas pu générer d'instructions structurées. Regarde le chat pour plus d'infos.
             </div>
          )}
        </div>

        {/* Colonne droite : Aide SAP + Screenshot */}
        <div className="space-y-4">
          <Card className="p-4 bg-blue-50 border-blue-100 sticky top-4">
            <h3 className="text-sm font-bold text-blue-800 mb-2 flex items-center gap-2">
              <FaSearch /> Info manquante ?
            </h3>
            <p className="text-xs text-blue-700 mb-4">
              Si tu ne sais pas quoi mettre, fais une capture d'écran de ta transaction SAP (IP02, IA05...) et glisse-la ici.
            </p>
            
            <label className="block w-full border-2 border-dashed border-blue-300 rounded-lg p-4 text-center cursor-pointer hover:bg-blue-100 transition-colors">
              <FaCamera className="mx-auto text-blue-400 mb-2" />
              <span className="text-xs font-medium text-blue-600">
                {screenshot ? screenshot.name : "Glisser ou cliquer pour uploader"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleScreenshotUpload} />
            </label>

            {loading && screenshot && (
              <div className="mt-3 text-xs text-gray-500 flex items-center justify-center gap-2">
                <FaSpinner className="animate-spin" /> Analyse de l'image...
              </div>
            )}

            {screenshotAnalysis && (
              <div className="mt-4 p-3 bg-white rounded border border-blue-100 shadow-sm">
                 <h4 className="text-xs font-bold text-gray-700 mb-1">Données extraites :</h4>
                 <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                   {screenshotAnalysis}
                 </div>
                 <button 
                    className="mt-2 w-full bg-blue-600 text-white text-xs py-1 rounded"
                    onClick={() => alert("Fonction v4: Les champs seraient remplis automatiquement.")}
                 >
                   Appliquer au formulaire
                 </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">Validation Finale</h2>
        <p className="text-gray-500">Vérifions ton fichier avant l'envoi à SAP.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mt-8">
        {/* Zone Upload */}
        <div className="space-y-4">
           <Card className="p-8 border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors flex flex-col items-center justify-center min-h-[300px]">
              {!validationFile ? (
                <>
                  <div className="bg-gray-100 p-4 rounded-full mb-4">
                    <FaFileExcel className="text-gray-400 text-3xl" />
                  </div>
                  <p className="text-sm font-medium text-gray-700">Glisse ton fichier Excel rempli ici</p>
                  <p className="text-xs text-gray-400 mt-1">ou clique pour parcourir</p>
                  <input 
                    type="file" 
                    accept=".xlsx,.xls,.xlsm" 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleValidationUpload}
                  />
                </>
              ) : (
                <div className="text-center">
                   <FaFileExcel className="text-green-500 text-5xl mx-auto mb-4" />
                   <p className="font-medium text-gray-800">{validationFile.name}</p>
                   <p className="text-xs text-gray-500 mb-6">{(validationFile.size / 1024).toFixed(0)} KB</p>
                   
                   <button 
                     onClick={runValidation}
                     disabled={loading}
                     className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-full font-medium shadow-lg shadow-green-100 flex items-center gap-2 mx-auto"
                   >
                     {loading ? <FaSpinner className="animate-spin" /> : "Lancer la validation"}
                   </button>
                   <button 
                     onClick={() => {setValidationFile(null); setValidationReport(null);}}
                     className="mt-4 text-xs text-gray-400 hover:text-gray-600 underline"
                   >
                     Changer de fichier
                   </button>
                </div>
              )}
           </Card>
        </div>

        {/* Zone Rapport */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Rapport d'analyse</h3>
          
          {!validationReport && !loading && (
            <div className="h-full bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 text-sm italic p-8">
              Le rapport apparaîtra ici après l'analyse.
            </div>
          )}

          {loading && validationFile && (
            <div className="space-y-3">
               <div className="h-12 bg-gray-100 rounded animate-pulse" />
               <div className="h-12 bg-gray-100 rounded animate-pulse" />
               <div className="h-24 bg-gray-100 rounded animate-pulse" />
            </div>
          )}

          {validationReport && (
             <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {/* On affiche les erreurs critiques d'abord */}
                {validationParsing.critical.length > 0 ? (
                  validationParsing.critical.map((item, i) => (
                    <ValidationItem key={`c-${i}`} type="critical" title="Erreur Critique" detail={item} />
                  ))
                ) : (
                  <ValidationItem type="success" title="Aucune erreur critique" detail="La structure du fichier est valide." />
                )}

                {/* Avertissements */}
                {validationParsing.warnings.map((item, i) => (
                    <ValidationItem key={`w-${i}`} type="warning" title="Avertissement" detail={item} />
                ))}

                {/* Suggestions (si pas d'erreur critique) */}
                {validationParsing.critical.length === 0 && validationParsing.suggestions.map((item, i) => (
                    <ValidationItem key={`s-${i}`} type="success" title="Suggestion" detail={item} />
                ))}
                
                {/* Fallback raw text si le parsing a échoué */}
                {(validationParsing.critical.length + validationParsing.warnings.length + validationParsing.suggestions.length === 0) && (
                  <pre className="text-xs bg-gray-50 p-3 rounded whitespace-pre-wrap">
                    {validationReport}
                  </pre>
                )}
             </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Assistant DCF SAP <span className="text-blue-600">v4.0</span></h1>
          <p className="text-slate-500">Laissez-vous guider de la demande à la validation.</p>
        </div>

        {/* Stepper */}
        <StepIndicator currentStep={step} steps={['Description', 'Recommandation', 'Guidage', 'Validation']} />

        {/* Main Content */}
        <div className="transition-all duration-500">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
      </div>
    </div>
  );
}
