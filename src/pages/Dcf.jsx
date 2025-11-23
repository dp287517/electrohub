import React, { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { 
  FaArrowRight, FaCheckCircle, FaExclamationTriangle, FaTimesCircle, 
  FaSearch, FaFileExcel, FaCamera, FaSpinner, FaDownload, FaChevronRight,
  FaArrowLeft, FaInfoCircle
} from "react-icons/fa";

// --- COMPOSANTS UI ---

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
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const FieldInstruction = ({ row, col, code, label, value, reason, mandatory }) => (
  <div className="flex flex-col sm:flex-row gap-4 p-4 bg-white rounded-lg border border-slate-200 mb-3 hover:border-blue-300 transition-colors shadow-sm">
    {/* Positionnement Excel */}
    <div className="flex-shrink-0 flex flex-col items-center justify-center min-w-[70px] bg-slate-50 rounded border border-slate-200 p-2">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Ligne</div>
      <div className="text-xl font-black text-slate-700">{row}</div>
      <div className="w-full h-px bg-slate-200 my-1"></div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Col</div>
      <div className="text-xl font-black text-blue-600">{col}</div>
    </div>

    {/* Détails Instruction */}
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
         <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide font-medium">Valeur à saisir :</div>
         <div className="bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 rounded font-mono text-sm font-medium select-all break-words">
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

// --- MAIN WIZARD ---

export default function DCFWizard() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // STEP 1 Data
  const [requestText, setRequestText] = useState("");

  // STEP 2 Data (Recommandation Multi-fichiers)
  const [analysis, setAnalysis] = useState(null);
  
  // STEP 3 Data (Guidage)
  const [activeFile, setActiveFile] = useState(null); // Le fichier en cours de remplissage
  const [instructions, setInstructions] = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotAnalysis, setScreenshotAnalysis] = useState(null);

  // STEP 4 Data (Validation)
  const [validationFiles, setValidationFiles] = useState([]); // Array de fichiers uploadés
  const [validationReport, setValidationReport] = useState(null);

  // Init Session
  useEffect(() => {
    const init = async () => {
      try {
        const res = await api.dcf.startSession({ title: "Wizard DCF v4" });
        if (res?.sessionId) setSessionId(res.sessionId);
      } catch (e) { console.error(e); }
    };
    init();
  }, []);

  // --- HANDLERS ---

  // 1. ANALYSER LA DEMANDE
  const handleAnalyzeRequest = async () => {
    if (!requestText.trim()) return;
    setLoading(true);
    setAnalysis(null);
    try {
      const res = await api.dcf.wizard.analyze(requestText, sessionId);
      setAnalysis(res); // Contient { is_manual, required_files: [...] }
      setStep(2);
    } catch (e) {
      alert("Erreur analyse: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. CHOISIR UN FICHIER & GÉNÉRER INSTRUCTIONS
  const handleSelectFile = async (fileObj) => {
    setActiveFile(fileObj);
    setLoading(true);
    setInstructions([]);
    setScreenshotAnalysis(null);
    
    try {
      // Appel API pour générer les instructions spécifiques à CE template
      const data = await api.dcf.wizard.instructions(
        sessionId, 
        requestText, 
        fileObj.template_filename
      );
      setInstructions(data);
      setStep(3);
    } catch (e) {
      alert("Erreur génération instructions: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 3. UPLOAD SCREENSHOT (Aide contextuelle)
  const handleScreenshotUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setScreenshot(file);
    try {
      // Upload
      const upRes = await api.dcf.uploadAttachments([file], sessionId);
      const attId = upRes.items[0].id;
      
      // Analyse via Chat générique (le backend v4 n'a pas de route wizard dédiée image, on utilise le chat)
      const res = await api.dcf.chat({
        sessionId,
        message: "Analyse cette capture pour m'aider à remplir le DCF (valeurs techniques).",
        attachmentIds: [attId],
        mode: "guidage"
      });
      setScreenshotAnalysis(res.answer);
    } catch (e) {
      alert("Erreur image: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 4. VALIDATION FINALE
  const handleValidationUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) setValidationFiles(files);
  };

  const runValidation = async () => {
    if (!validationFiles.length) return;
    setLoading(true);
    setValidationReport(null);
    try {
      // 1. Upload des fichiers
      const fd = new FormData();
      validationFiles.forEach(f => fd.append("files", f));
      const upRes = await api.dcf.uploadExcelMulti(fd);
      
      // 2. Validation
      const fileIds = upRes.files.map(f => f.id);
      const valRes = await api.dcf.wizard.validate(fileIds);
      setValidationReport(valRes); // { report, critical: [], warnings: [] }
    } catch (e) {
      alert("Erreur validation: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERERS ---

  const renderStep1_Describe = () => (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Que veux-tu faire ?</h2>
        <p className="text-gray-500">Décris ta tâche comme tu le ferais à Charles.</p>
      </div>

      <Card className="p-6">
        <textarea
          className="w-full h-32 p-4 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-700 text-base mb-4"
          placeholder="Ex: Je dois retirer la cuve C1602 et ses plans de maintenance..."
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            onClick={handleAnalyzeRequest}
            disabled={loading || !requestText}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50 shadow-md"
          >
            {loading ? <FaSpinner className="animate-spin" /> : <FaSearch />}
            Analyser ma demande
          </button>
        </div>
      </Card>
    </div>
  );

  const renderStep2_Recommend = () => {
    // CAS MANUEL (Pas de DCF)
    if (analysis?.is_manual) {
      return (
        <div className="animate-fade-in text-center py-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 text-green-600 rounded-full mb-6 text-4xl shadow-sm">
            <FaCheckCircle />
          </div>
          <h2 className="text-3xl font-bold text-gray-800 mb-2">Pas besoin de DCF !</h2>
          <p className="text-gray-600 text-lg mb-8">
            Cette modification est trop simple ou doit être faite manuellement.
          </p>
          
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm text-left mb-8 relative overflow-hidden">
             <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>
             <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
               <FaInfoCircle className="text-green-500"/> Conseil de l'assistant :
             </h3>
             <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{analysis.reasoning}</p>
          </div>

          <button onClick={() => setStep(1)} className="text-blue-600 font-medium hover:underline">
            ← Faire une autre demande
          </button>
        </div>
      );
    }

    // CAS STANDARD (1 ou plusieurs fichiers)
    return (
      <div className="animate-fade-in space-y-8">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {analysis?.required_files?.length > 1 ? "Plusieurs fichiers nécessaires" : "Fichier recommandé"}
          </h2>
          <p className="text-gray-600">{analysis?.reasoning}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {analysis?.required_files?.map((file, idx) => (
            <Card key={idx} className="flex flex-col h-full border-t-4 border-t-blue-500 hover:shadow-md transition-shadow">
              <div className="p-6 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded uppercase">
                    {file.type}
                  </div>
                  <FaFileExcel className="text-green-600 text-2xl" />
                </div>
                
                <h3 className="font-bold text-gray-800 mb-2 break-all leading-tight">
                  {file.template_filename}
                </h3>
                
                <div className="bg-gray-50 rounded p-3 text-sm text-gray-600 mt-4 border border-gray-100">
                  <span className="font-semibold block mb-1 text-gray-700">Usage :</span>
                  {file.usage}
                </div>
              </div>

              <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-2">
                 {/* Bouton téléchargement (Simulé pour l'exemple, pointerait vers un lien réel) */}
                 <button className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2" title="Télécharger le template vierge">
                   <FaDownload /> Vierge
                 </button>
                 
                 <button 
                   onClick={() => handleSelectFile(file)}
                   className="flex-1 bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-2 shadow-sm"
                 >
                   Remplir <FaArrowRight />
                 </button>
              </div>
            </Card>
          ))}
        </div>
        
        <div className="text-center">
          <button onClick={() => setStep(1)} className="text-sm text-gray-400 hover:text-gray-600">
            Retour à la description
          </button>
        </div>
      </div>
    );
  };

  const renderStep3_Guide = () => (
    <div className="animate-fade-in max-w-7xl mx-auto">
      {/* Header Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-200">
        <div>
           <button onClick={() => setStep(2)} className="text-xs font-bold text-gray-400 uppercase tracking-wider hover:text-blue-600 mb-1 flex items-center gap-1">
             <FaArrowLeft /> Retour aux fichiers
           </button>
           <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
             <FaFileExcel className="text-green-600"/> 
             {activeFile?.template_filename}
           </h2>
           <p className="text-sm text-gray-500">Mode Guidage Interactif</p>
        </div>
        <button 
          onClick={() => setStep(4)}
          className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center gap-2 shadow-sm"
        >
          J'ai fini ce fichier, passer à la validation <FaArrowRight />
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        
        {/* COLONNE GAUCHE : Instructions */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
             <div className="h-64 flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
               <FaSpinner className="animate-spin text-3xl mb-3 text-blue-500" />
               <p>L'IA analyse la structure du fichier...</p>
             </div>
          ) : instructions.length > 0 ? (
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
          ) : (
            <div className="p-8 bg-yellow-50 border border-yellow-100 rounded-xl text-yellow-800 text-center">
               <FaExclamationTriangle className="mx-auto text-2xl mb-2 opacity-50"/>
               <p>Aucune instruction spécifique générée. Vérifie que le fichier est bien un standard DCF.</p>
            </div>
          )}
        </div>

        {/* COLONNE DROITE : Assistant Contextuel */}
        <div className="space-y-6">
          <div className="sticky top-6">
            <Card className="p-5 bg-gradient-to-b from-blue-50 to-white border-blue-100">
              <h3 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                <FaSearch className="text-blue-500"/> Info manquante ?
              </h3>
              <p className="text-xs text-blue-700 mb-4 leading-relaxed">
                Prends une capture d'écran de ta transaction SAP (IP02, IA05...) et dépose-la ici pour que je trouve les valeurs.
              </p>
              
              <label className="block w-full border-2 border-dashed border-blue-300 bg-white/50 rounded-lg p-6 text-center cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all group">
                <FaCamera className="mx-auto text-blue-400 mb-2 text-xl group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-blue-600 block">
                  {screenshot ? screenshot.name : "Glisser une capture SAP"}
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleScreenshotUpload} />
              </label>

              {loading && screenshot && (
                <div className="mt-4 text-xs text-blue-600 flex items-center justify-center gap-2 animate-pulse">
                  <FaSpinner className="animate-spin" /> Analyse OCR en cours...
                </div>
              )}

              {screenshotAnalysis && !loading && (
                <div className="mt-4 bg-white p-3 rounded border border-blue-100 shadow-sm animate-fade-in">
                   <div className="text-[10px] text-gray-400 uppercase font-bold mb-1">Résultat analyse</div>
                   <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                     {screenshotAnalysis}
                   </div>
                </div>
              )}
            </Card>

            {/* Note d'aide */}
            <div className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500">
              <p>💡 <strong>Astuce :</strong> Tu peux naviguer entre les fichiers à l'étape 2 sans perdre ta session.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep4_Validate = () => (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Validation Finale</h2>
        <p className="text-gray-500">Upload tes fichiers remplis pour une dernière vérification.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Zone Upload */}
        <Card className="p-8 border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors flex flex-col items-center justify-center min-h-[300px]">
           {validationFiles.length === 0 ? (
             <>
               <div className="bg-gray-100 p-4 rounded-full mb-4">
                 <FaFileExcel className="text-gray-400 text-4xl" />
               </div>
               <p className="text-base font-medium text-gray-700">Glisse tes fichiers Excel ici</p>
               <p className="text-xs text-gray-400 mt-1">Accepte plusieurs fichiers à la fois</p>
               <input 
                 type="file" 
                 accept=".xlsx,.xls,.xlsm" 
                 multiple
                 className="absolute inset-0 opacity-0 cursor-pointer"
                 onChange={handleValidationUpload}
               />
             </>
           ) : (
             <div className="w-full text-center">
                <div className="mb-4 space-y-2">
                  {validationFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-center gap-2 text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      <FaFileExcel className="text-green-600"/> {f.name}
                    </div>
                  ))}
                </div>
                
                <button 
                  onClick={runValidation}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-2 rounded-full font-medium shadow-lg shadow-green-200 flex items-center gap-2 mx-auto disabled:opacity-50"
                >
                  {loading ? <FaSpinner className="animate-spin" /> : "Lancer la validation"}
                </button>
                
                <button 
                  onClick={() => { setValidationFiles([]); setValidationReport(null); }}
                  className="mt-4 text-xs text-gray-400 underline hover:text-gray-600"
                >
                  Annuler la sélection
                </button>
             </div>
           )}
        </Card>

        {/* Rapport */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
             <h3 className="font-bold text-gray-800 uppercase tracking-wide text-sm">Rapport d'analyse</h3>
             {validationReport && (
               <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">
                 Généré par IA
               </span>
             )}
          </div>
          
          {!validationReport ? (
            <div className="h-[300px] bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 text-sm italic p-8 text-center">
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <FaSpinner className="animate-spin text-2xl"/>
                  Analyse des données en cours...
                </div>
              ) : (
                "Le rapport apparaîtra ici après l'upload."
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
               {/* Sections structurées */}
               <div className="max-h-[400px] overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  
                  {/* Critiques */}
                  {validationReport.critical?.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                      <h4 className="text-red-800 font-bold text-xs uppercase mb-2 flex items-center gap-2">
                        <FaTimesCircle/> Erreurs Critiques ({validationReport.critical.length})
                      </h4>
                      <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                        {validationReport.critical.map((err, i) => <li key={i}>{err}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Warnings */}
                  {validationReport.warnings?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <h4 className="text-amber-800 font-bold text-xs uppercase mb-2 flex items-center gap-2">
                        <FaExclamationTriangle/> Avertissements ({validationReport.warnings.length})
                      </h4>
                      <ul className="list-disc list-inside text-xs text-amber-700 space-y-1">
                        {validationReport.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Suggestions */}
                  {validationReport.suggestions?.length > 0 && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <h4 className="text-blue-800 font-bold text-xs uppercase mb-2 flex items-center gap-2">
                        <FaInfoCircle/> Suggestions
                      </h4>
                      <ul className="list-disc list-inside text-xs text-blue-700 space-y-1">
                        {validationReport.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Fallback Texte global */}
                  <div className="text-xs text-gray-600 border-t pt-3 mt-2 whitespace-pre-wrap">
                    {validationReport.report}
                  </div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // --- RENDER FINAL ---

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">
            Assistant DCF <span className="text-blue-600">v4</span>
          </h1>
          <p className="text-slate-500 text-sm">De la demande métier à la validation technique.</p>
        </header>

        {/* Stepper */}
        <StepIndicator currentStep={step} steps={['Besoin', 'Analyse', 'Guidage', 'Validation']} />

        {/* Content Area */}
        <div className="transition-all duration-300">
          {step === 1 && renderStep1_Describe()}
          {step === 2 && renderStep2_Recommend()}
          {step === 3 && renderStep3_Guide()}
          {step === 4 && renderStep4_Validate()}
        </div>

      </div>
      
      {/* Footer minimal */}
      <div className="fixed bottom-4 right-4 text-[10px] text-gray-300 pointer-events-none">
        Powered by OpenAI & Node.js
      </div>
    </div>
  );
}
