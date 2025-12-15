// src/pages/Learn_ex.jsx — Formation ATEX Niveau 0
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  Flame,
  AlertTriangle,
  ClipboardCheck,
  Ban,
  Wrench,
  UserCheck,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Clock,
  Award,
  Play,
  Pause,
  RotateCcw,
  Download,
  Trophy,
  Target,
  Zap,
  Shield,
  FileText,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  Home,
  GraduationCap,
  Star,
  Timer,
  Lock,
  Unlock,
  Eye,
  Volume2,
  VolumeX,
  Maximize2,
  Menu,
  Info,
  Lightbulb,
  AlertCircle,
} from 'lucide-react';
import Confetti from 'react-confetti';
import { api } from '../lib/api';

// ============================================================================
// CONSTANTES & CONFIG
// ============================================================================

const ICON_MAP = {
  BookOpen,
  Flame,
  AlertTriangle,
  ClipboardCheck,
  Ban,
  Wrench,
  UserCheck,
};

// ============================================================================
// COMPOSANTS UTILITAIRES
// ============================================================================

function ProgressBar({ value, max = 100, color = '#3B82F6', height = 8, showLabel = false }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full">
      <div
        className="w-full bg-gray-200 rounded-full overflow-hidden"
        style={{ height }}
      >
        <div
          className="h-full transition-all duration-500 ease-out rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <div className="text-xs text-gray-500 mt-1 text-right">{Math.round(pct)}%</div>
      )}
    </div>
  );
}

function Badge({ children, color = 'blue', size = 'sm' }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    purple: 'bg-purple-100 text-purple-800',
    gray: 'bg-gray-100 text-gray-800',
  };
  const sizes = {
    xs: 'text-xs px-1.5 py-0.5',
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1',
  };
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${colors[color]} ${sizes[size]}`}>
      {children}
    </span>
  );
}

function Card({ children, className = '', onClick, hover = false }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 ${
        hover ? 'hover:shadow-md hover:border-gray-300 cursor-pointer transition-all' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  icon: Icon,
  iconRight = false,
  fullWidth = false,
  loading = false,
}) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
    success: 'bg-green-600 hover:bg-green-700 text-white shadow-sm',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm',
    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
  };
  const sizes = {
    xs: 'text-xs px-2 py-1',
    sm: 'text-sm px-3 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-base px-6 py-3',
    xl: 'text-lg px-8 py-4',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all
        ${variants[variant]} ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4\" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {Icon && !iconRight && !loading && <Icon className="w-4 h-4" />}
      {children}
      {Icon && iconRight && !loading && <Icon className="w-4 h-4" />}
    </button>
  );
}

function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    full: 'max-w-[95vw]',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] overflow-hidden flex flex-col`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function LearnEx() {
  // États principaux
  const [view, setView] = useState('home'); // home, modules, module, quiz, exam, result, certificate
  const [config, setConfig] = useState(null);
  const [modules, setModules] = useState([]);
  const [session, setSession] = useState(null);
  const [currentModule, setCurrentModule] = useState(null);
  const [currentSection, setCurrentSection] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // États quiz
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResults, setQuizResults] = useState(null);
  const [quizMode, setQuizMode] = useState('module'); // module ou final

  // États examen final
  const [examQuestions, setExamQuestions] = useState([]);
  const [examAnswers, setExamAnswers] = useState({});
  const [examResults, setExamResults] = useState(null);
  const [examTimeLeft, setExamTimeLeft] = useState(30 * 60); // 30 minutes
  const [examStarted, setExamStarted] = useState(false);
  const examTimerRef = useRef(null);

  // États certificat
  const [certificate, setCertificate] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // États UI
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [history, setHistory] = useState([]);

  // ============================================================================
  // CHARGEMENT INITIAL
  // ============================================================================

  useEffect(() => {
    loadInitialData();
    return () => {
      if (examTimerRef.current) clearInterval(examTimerRef.current);
    };
  }, []);

  async function loadInitialData() {
    setLoading(true);
    try {
      // 🔥 Utiliser l'API layer avec headers d'identification (X-User-Email, X-Site)
      const [configRes, modulesRes, sessionRes, historyRes] = await Promise.all([
        api.learnEx.config(),
        api.learnEx.modules(),
        api.learnEx.getCurrentSession(),
        api.learnEx.history(),
      ]);

      setConfig(configRes);
      setModules(modulesRes);
      setSession(sessionRes);
      setHistory(historyRes);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Erreur lors du chargement de la formation');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  async function openModule(moduleId) {
    setLoading(true);
    try {
      const moduleData = await api.learnEx.getModule(moduleId);
      setCurrentModule(moduleData);
      setCurrentSection(0);
      setView('module');
    } catch (err) {
      console.error('Error loading module:', err);
      setError('Erreur lors du chargement du module');
    } finally {
      setLoading(false);
    }
  }

  function nextSection() {
    if (currentModule && currentSection < currentModule.sections.length - 1) {
      setCurrentSection((s) => s + 1);
    } else {
      // Fin du module -> Quiz
      startModuleQuiz();
    }
  }

  function prevSection() {
    if (currentSection > 0) {
      setCurrentSection((s) => s - 1);
    }
  }

  // ============================================================================
  // QUIZ MODULE
  // ============================================================================

  async function startModuleQuiz() {
    if (!currentModule) return;
    setQuizMode('module');
    setQuizQuestions(currentModule.quiz);
    setQuizAnswers({});
    setQuizResults(null);
    setView('quiz');
  }

  async function submitModuleQuiz() {
    setLoading(true);
    try {
      const results = await api.learnEx.checkModuleQuiz(currentModule.id, quizAnswers, session?.id);
      setQuizResults(results);

      // Recharger la session pour mettre à jour la progression
      const sessionRes = await api.learnEx.getCurrentSession();
      setSession(sessionRes);
    } catch (err) {
      console.error('Error submitting quiz:', err);
      setError('Erreur lors de la soumission du quiz');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // EXAMEN FINAL
  // ============================================================================

  async function startFinalExam() {
    setLoading(true);
    try {
      const data = await api.learnEx.finalExam();
      setExamQuestions(data.questions);
      setExamAnswers({});
      setExamResults(null);
      setExamTimeLeft(data.timeLimit * 60);
      setExamStarted(true);
      setView('exam');

      // Démarrer le timer
      examTimerRef.current = setInterval(() => {
        setExamTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(examTimerRef.current);
            submitFinalExam();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Error starting exam:', err);
      setError("Erreur lors du démarrage de l'examen");
    } finally {
      setLoading(false);
    }
  }

  async function submitFinalExam() {
    if (examTimerRef.current) clearInterval(examTimerRef.current);
    setLoading(true);
    try {
      const results = await api.learnEx.submitExam(session?.id, examAnswers, 30 * 60 - examTimeLeft);
      setExamResults(results);
      setView('result');

      if (results.passed) {
        setCertificate(results.certificate);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 8000);
      }

      // Recharger l'historique
      const historyRes = await api.learnEx.history();
      setHistory(historyRes);
    } catch (err) {
      console.error('Error submitting exam:', err);
      setError("Erreur lors de la soumission de l'examen");
    } finally {
      setLoading(false);
    }
  }

  function downloadCertificate() {
    if (certificate) {
      // Utiliser l'URL avec le site pour l'identification
      window.open(api.learnEx.certificatePdfUrl(certificate.id), '_blank');
    }
  }

  // Nouvelle fonction - Génération automatique du certificat basée sur les quiz
  async function generateAndDownloadCertificate() {
    setLoading(true);
    try {
      const result = await api.learnEx.autoCertificate();

      if (result.success && result.certificate) {
        setCertificate(result.certificate);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 8000);

        // Recharger l'historique
        const historyRes = await api.learnEx.history();
        setHistory(historyRes);

        // Ouvrir le PDF automatiquement
        window.open(api.learnEx.certificatePdfUrl(result.certificate.id), '_blank');
      }
    } catch (err) {
      console.error('Error generating certificate:', err);
      const message = err.message || "Erreur lors de la génération du certificat";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // Vérifier si l'utilisateur a déjà un certificat valide
  function hasValidCertificate() {
    return history.some(h => h.certificate_number && new Date(h.valid_until) > new Date());
  }

  // Récupérer le certificat valide
  function getValidCertificate() {
    return history.find(h => h.certificate_number && new Date(h.valid_until) > new Date());
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  function getModuleProgress(moduleId) {
    if (!session?.moduleProgress) return null;
    return session.moduleProgress.find((p) => p.module_id === moduleId);
  }

  function isModuleLocked(moduleId) {
    // Le premier module est toujours déverrouillé
    if (moduleId === 1) return false;
    // Les autres modules nécessitent que le précédent soit complété
    const prevProgress = getModuleProgress(moduleId - 1);
    return !prevProgress?.completed_at;
  }

  function canTakeExam() {
    // Tous les modules doivent être complétés
    return modules.every((m) => getModuleProgress(m.id)?.completed_at);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================================
  // RENDU - ÉCRAN D'ACCUEIL
  // ============================================================================

  function renderHome() {
    const completedModules = modules.filter((m) => getModuleProgress(m.id)?.completed_at).length;
    const progressPct = modules.length ? (completedModules / modules.length) * 100 : 0;

    return (
      <div className="space-y-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white p-8 md:p-12">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-30" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-white/20 rounded-xl backdrop-blur">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <Badge color="yellow" size="md">Formation obligatoire</Badge>
            </div>
            
            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              {config?.title || 'Sensibilisation ATEX Niveau 0'}
            </h1>
            <p className="text-lg text-blue-100 mb-6 max-w-2xl">
              Formation pour intervenants travaillant dans une zone ATEX sans réaliser de travaux sur du matériel ATEX.
            </p>

            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                <Clock className="w-4 h-4" />
                <span>{config?.duration || '2 heures'}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                <BookOpen className="w-4 h-4" />
                <span>{modules.length} modules</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                <Award className="w-4 h-4" />
                <span>Certificat valide {config?.validity || '3 ans'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Progression */}
        {session && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Votre progression</h2>
              <Badge color={progressPct === 100 ? 'green' : 'blue'}>
                {completedModules}/{modules.length} modules
              </Badge>
            </div>
            <ProgressBar value={progressPct} color="#3B82F6" height={12} />
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {progressPct === 100
                  ? (hasValidCertificate()
                      ? 'Formation complète ! Votre certificat est disponible.'
                      : 'Formation terminée ! Obtenez votre certificat.')
                  : `${Math.round(progressPct)}% complété`}
              </span>
              {progressPct === 100 && (
                hasValidCertificate() ? (
                  <Button
                    onClick={() => window.open(api.learnEx.certificatePdfUrl(getValidCertificate().id), '_blank')}
                    icon={Download}
                    variant="success"
                  >
                    Télécharger mon certificat
                  </Button>
                ) : (
                  <Button onClick={generateAndDownloadCertificate} icon={Award}>
                    Obtenir mon certificat
                  </Button>
                )
              )}
            </div>
          </Card>
        )}

        {/* Grille des modules */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Modules de formation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((module) => {
              const Icon = ICON_MAP[module.icon] || BookOpen;
              const progress = getModuleProgress(module.id);
              const locked = isModuleLocked(module.id);
              const completed = progress?.completed_at;

              return (
                <Card
                  key={module.id}
                  hover={!locked}
                  onClick={() => !locked && openModule(module.id)}
                  className={`p-5 ${locked ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="p-3 rounded-xl"
                      style={{ backgroundColor: `${module.color}20` }}
                    >
                      {locked ? (
                        <Lock className="w-6 h-6 text-gray-400" />
                      ) : (
                        <Icon className="w-6 h-6" style={{ color: module.color }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-400">
                          Module {module.id}
                        </span>
                        {completed && (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        )}
                      </div>
                      <h3 className="font-semibold text-gray-900 truncate">
                        {module.title}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">{module.subtitle}</p>
                      <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {module.duration}
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {module.sectionsCount} sections
                        </span>
                      </div>
                      {progress?.quiz_score !== undefined && (
                        <div className="mt-2">
                          <Badge
                            color={progress.quiz_score >= 70 ? 'green' : 'red'}
                            size="xs"
                          >
                            Quiz : {progress.quiz_score}%
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Certificat - Afficher quand tous les modules sont complétés */}
        {canTakeExam() && (
          hasValidCertificate() ? (
            <Card className="p-6 border-2 border-green-400 bg-green-50">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-green-500 rounded-xl">
                  <Award className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Certificat obtenu</h3>
                  <p className="text-sm text-gray-600">
                    Votre certificat ATEX Niveau 0 est valable 3 ans.
                    N'oubliez pas de le renouveler avant expiration.
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Valide jusqu'au {new Date(getValidCertificate().valid_until).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <Button
                  onClick={() => window.open(api.learnEx.certificatePdfUrl(getValidCertificate().id), '_blank')}
                  variant="success"
                  size="lg"
                  icon={Download}
                >
                  Télécharger
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 border-2 border-blue-400 bg-blue-50">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-500 rounded-xl">
                  <GraduationCap className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Formation terminée !</h3>
                  <p className="text-sm text-gray-600">
                    Vous avez complété tous les modules avec succès.
                    Obtenez votre certificat ATEX Niveau 0 (valable 3 ans).
                  </p>
                </div>
                <Button onClick={generateAndDownloadCertificate} variant="primary" size="lg" icon={Award}>
                  Obtenir mon certificat
                </Button>
              </div>
            </Card>
          )
        )}

        {/* Certificats obtenus */}
        {history.filter((h) => h.certificate_number).length > 0 && (
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Vos certificats</h2>
            <div className="space-y-3">
              {history
                .filter((h) => h.certificate_number)
                .map((h) => (
                  <Card key={h.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-green-100 rounded-xl">
                          <Award className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            Certificat ATEX Niveau 0
                          </p>
                          <p className="text-sm text-gray-500">
                            N° {h.certificate_number}
                          </p>
                          <p className="text-xs text-gray-400">
                            Valide jusqu'au{' '}
                            {new Date(h.valid_until).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge color="green">{h.final_score}%</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          icon={Download}
                          onClick={() =>
                            window.open(
                              api.learnEx.certificatePdfUrl(h.certificate_number),
                              '_blank'
                            )
                          }
                        >
                          PDF
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDU - MODULE
  // ============================================================================

  function renderModule() {
    if (!currentModule) return null;

    const section = currentModule.sections[currentSection];
    const Icon = ICON_MAP[currentModule.icon] || BookOpen;
    const isLastSection = currentSection === currentModule.sections.length - 1;

    return (
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar navigation */}
        <div className="lg:w-72 flex-shrink-0">
          <Card className="p-4 sticky top-4">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${currentModule.color}20` }}
              >
                <Icon className="w-5 h-5" style={{ color: currentModule.color }} />
              </div>
              <div>
                <p className="text-xs text-gray-400">Module {currentModule.id}</p>
                <h3 className="font-semibold text-gray-900">{currentModule.title}</h3>
              </div>
            </div>

            <nav className="space-y-1">
              {currentModule.sections.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentSection(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    idx === currentSection
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : idx < currentSection
                      ? 'text-gray-500 hover:bg-gray-50'
                      : 'text-gray-400'
                  }`}
                >
                  {idx < currentSection ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : idx === currentSection ? (
                    <div className="w-4 h-4 rounded-full border-2 border-blue-500 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                  )}
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
              <div className="pt-2 border-t mt-2">
                <button
                  onClick={startModuleQuiz}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    currentSection >= currentModule.sections.length
                      ? 'bg-yellow-50 text-yellow-700 font-medium'
                      : 'text-gray-400'
                  }`}
                >
                  <HelpCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Quiz de validation</span>
                </button>
              </div>
            </nav>

            <div className="mt-4 pt-4 border-t">
              <ProgressBar
                value={currentSection + 1}
                max={currentModule.sections.length}
                color={currentModule.color}
                height={6}
              />
              <p className="text-xs text-gray-500 mt-2 text-center">
                {currentSection + 1} / {currentModule.sections.length} sections
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              fullWidth
              className="mt-4"
              icon={ChevronLeft}
              onClick={() => {
                setCurrentModule(null);
                setView('home');
              }}
            >
              Retour aux modules
            </Button>
          </Card>
        </div>

        {/* Contenu principal */}
        <div className="flex-1 min-w-0">
          <Card className="overflow-hidden">
            {/* Image de la section */}
            {section.image && (
              <div className="h-64 bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
                <img
                  src={api.learnEx.imageUrl(section.image)}
                  alt={section.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <div className="absolute bottom-4 left-6 right-6">
                  <h2 className="text-2xl font-bold text-white">{section.title}</h2>
                </div>
              </div>
            )}

            {/* Contenu texte */}
            <div className="p-6 lg:p-8">
              {!section.image && (
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{section.title}</h2>
              )}

              <div className="prose prose-blue max-w-none">
                {section.content.split('\n').map((para, idx) => {
                  // Gestion des titres markdown
                  if (para.trim().startsWith('**') && para.trim().endsWith('**')) {
                    return (
                      <h4 key={idx} className="font-semibold text-gray-900 mt-6 mb-3">
                        {para.replace(/\*\*/g, '')}
                      </h4>
                    );
                  }
                  // Gestion des listes
                  if (para.trim().startsWith('- ') || para.trim().startsWith('• ')) {
                    return (
                      <li key={idx} className="text-gray-700 ml-4">
                        {para.replace(/^[-•]\s*/, '')}
                      </li>
                    );
                  }
                  // Gestion des checkboxes
                  if (para.trim().startsWith('- [ ]') || para.trim().startsWith('- [x]')) {
                    const checked = para.includes('[x]');
                    return (
                      <div key={idx} className="flex items-start gap-2 ml-4 my-1">
                        {checked ? (
                          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <div className="w-5 h-5 border-2 border-gray-300 rounded flex-shrink-0 mt-0.5" />
                        )}
                        <span className="text-gray-700">
                          {para.replace(/- \[.\]\s*/, '')}
                        </span>
                      </div>
                    );
                  }
                  // Gestion des tableaux (simplifié)
                  if (para.trim().startsWith('|')) {
                    return null; // Les tableaux seraient rendus différemment
                  }
                  // Paragraphe normal
                  if (para.trim()) {
                    return (
                      <p key={idx} className="text-gray-700 my-3">
                        {para.split('**').map((part, i) =>
                          i % 2 === 1 ? (
                            <strong key={i} className="font-semibold text-gray-900">
                              {part}
                            </strong>
                          ) : (
                            part
                          )
                        )}
                      </p>
                    );
                  }
                  return null;
                })}
              </div>

              {/* Points clés */}
              {section.keyPoints && section.keyPoints.length > 0 && (
                <div className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-5 h-5 text-blue-600" />
                    <h4 className="font-semibold text-blue-900">Points clés à retenir</h4>
                  </div>
                  <ul className="space-y-2">
                    {section.keyPoints.map((point, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-blue-800">
                        <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={prevSection}
                disabled={currentSection === 0}
                icon={ChevronLeft}
              >
                Précédent
              </Button>

              <span className="text-sm text-gray-500">
                Section {currentSection + 1} / {currentModule.sections.length}
              </span>

              <Button
                onClick={nextSection}
                icon={isLastSection ? HelpCircle : ChevronRight}
                iconRight={!isLastSection}
                variant={isLastSection ? 'success' : 'primary'}
              >
                {isLastSection ? 'Passer au quiz' : 'Suivant'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU - QUIZ
  // ============================================================================

  function renderQuiz() {
    const questions = quizMode === 'module' ? quizQuestions : examQuestions;
    const answers = quizMode === 'module' ? quizAnswers : examAnswers;
    const setAnswers = quizMode === 'module' ? setQuizAnswers : setExamAnswers;
    const results = quizMode === 'module' ? quizResults : examResults;

    if (results) {
      return renderQuizResults();
    }

    const answeredCount = Object.keys(answers).length;
    const allAnswered = answeredCount === questions.length;

    return (
      <div className="max-w-3xl mx-auto">
        <Card className="overflow-hidden">
          {/* Header */}
          <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <HelpCircle className="w-6 h-6" />
                <h2 className="text-xl font-bold">
                  {quizMode === 'module' ? `Quiz - ${currentModule?.title}` : 'Examen final'}
                </h2>
              </div>
              {quizMode === 'final' && (
                <div className="flex items-center gap-2 bg-white/20 rounded-lg px-4 py-2">
                  <Timer className="w-5 h-5" />
                  <span className="font-mono text-lg">{formatTime(examTimeLeft)}</span>
                </div>
              )}
            </div>
            <ProgressBar
              value={answeredCount}
              max={questions.length}
              color="#ffffff"
              height={8}
            />
            <p className="text-sm text-blue-100 mt-2">
              {answeredCount} / {questions.length} questions répondues
            </p>
          </div>

          {/* Questions */}
          <div className="p-6 space-y-8">
            {questions.map((q, qIdx) => (
              <div key={q.id} className="space-y-4">
                <div className="flex items-start gap-3">
                  <span
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      answers[q.id] !== undefined
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {qIdx + 1}
                  </span>
                  <p className="text-gray-900 font-medium pt-1">{q.question}</p>
                </div>

                <div className="ml-11 space-y-2">
                  {q.options.map((option, optIdx) => (
                    <button
                      key={optIdx}
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                      }
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        answers[q.id] === optIdx
                          ? 'border-blue-500 bg-blue-50 text-blue-900'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-medium ${
                            answers[q.id] === optIdx
                              ? 'border-blue-500 bg-blue-500 text-white'
                              : 'border-gray-300 text-gray-500'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}
                        </span>
                        <span>{option}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-6 bg-gray-50 border-t flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                if (quizMode === 'module') {
                  setView('module');
                } else {
                  if (confirm('Êtes-vous sûr de vouloir abandonner l\'examen ?')) {
                    clearInterval(examTimerRef.current);
                    setView('home');
                  }
                }
              }}
            >
              Annuler
            </Button>

            <Button
              onClick={quizMode === 'module' ? submitModuleQuiz : submitFinalExam}
              disabled={!allAnswered}
              variant="success"
              icon={Check}
              loading={loading}
            >
              {allAnswered ? 'Valider mes réponses' : `${questions.length - answeredCount} question(s) restante(s)`}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // RENDU - RÉSULTATS QUIZ
  // ============================================================================

  function renderQuizResults() {
    const results = quizMode === 'module' ? quizResults : examResults;
    if (!results) return null;

    const { correct, total, score, passed } = results;

    return (
      <div className="max-w-3xl mx-auto">
        <Card className="overflow-hidden">
          {/* Header avec résultat */}
          <div
            className={`p-8 text-center text-white ${
              passed
                ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                : 'bg-gradient-to-br from-red-500 to-rose-600'
            }`}
          >
            <div
              className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
                passed ? 'bg-white/20' : 'bg-white/20'
              }`}
            >
              {passed ? (
                <Trophy className="w-10 h-10" />
              ) : (
                <XCircle className="w-10 h-10" />
              )}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {passed ? 'Félicitations !' : 'Continuez vos efforts'}
            </h2>
            <p className="text-white/80 mb-4">
              {passed
                ? quizMode === 'module'
                  ? 'Vous avez réussi ce module !'
                  : 'Vous avez obtenu votre certification !'
                : 'Vous n\'avez pas atteint le score minimum de 70%'}
            </p>

            <div className="flex items-center justify-center gap-8">
              <div>
                <p className="text-4xl font-bold">{score}%</p>
                <p className="text-sm text-white/60">Score obtenu</p>
              </div>
              <div className="w-px h-12 bg-white/30" />
              <div>
                <p className="text-4xl font-bold">
                  {correct}/{total}
                </p>
                <p className="text-sm text-white/60">Bonnes réponses</p>
              </div>
            </div>
          </div>

          {/* Détail des réponses */}
          <div className="p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 mb-4">Détail des réponses</h3>
            {results.results.map((r, idx) => {
              const q =
                quizMode === 'module'
                  ? quizQuestions.find((x) => x.id === r.questionId)
                  : examQuestions.find((x) => x.id === r.questionId);

              return (
                <div
                  key={r.questionId}
                  className={`p-4 rounded-xl border-2 ${
                    r.isCorrect
                      ? 'border-green-200 bg-green-50'
                      : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {r.isCorrect ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 mb-2">
                        {q?.question || `Question ${idx + 1}`}
                      </p>
                      {!r.isCorrect && (
                        <div className="text-sm space-y-1">
                          <p className="text-red-700">
                            Votre réponse : {q?.options?.[r.userAnswer] || 'Non répondu'}
                          </p>
                          <p className="text-green-700">
                            Bonne réponse : {q?.options?.[r.correctAnswer]}
                          </p>
                        </div>
                      )}
                      {r.explanation && (
                        <p className="text-sm text-gray-600 mt-2 p-2 bg-white rounded">
                          💡 {r.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="p-6 bg-gray-50 border-t flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                setQuizResults(null);
                setExamResults(null);
                setView('home');
              }}
              icon={Home}
            >
              Retour à l'accueil
            </Button>

            {passed ? (
              quizMode === 'module' ? (
                <Button
                  onClick={() => {
                    // Passer au module suivant
                    const nextModuleId = currentModule.id + 1;
                    const nextModule = modules.find((m) => m.id === nextModuleId);
                    if (nextModule) {
                      openModule(nextModuleId);
                    } else {
                      setView('home');
                    }
                  }}
                  icon={ArrowRight}
                  iconRight
                >
                  Module suivant
                </Button>
              ) : (
                <Button onClick={downloadCertificate} variant="success" icon={Download}>
                  Télécharger le certificat
                </Button>
              )
            ) : (
              <Button
                onClick={() => {
                  setQuizResults(null);
                  setExamResults(null);
                  if (quizMode === 'module') {
                    setQuizAnswers({});
                    setView('quiz');
                  } else {
                    startFinalExam();
                  }
                }}
                icon={RotateCcw}
              >
                Réessayer
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // RENDU - RÉSULTAT FINAL
  // ============================================================================

  function renderResult() {
    if (!examResults) {
      return <div>Chargement...</div>;
    }

    return renderQuizResults();
  }

  // ============================================================================
  // RENDU PRINCIPAL
  // ============================================================================

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Chargement de la formation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Erreur</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={loadInitialData} icon={RotateCcw}>
            Réessayer
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="pb-12">
      {/* Confetti pour la réussite */}
      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={500}
        />
      )}

      {/* Header avec navigation */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <button
            onClick={() => setView('home')}
            className="hover:text-blue-600 transition-colors"
          >
            Formation ATEX
          </button>
          {view !== 'home' && (
            <>
              <ChevronRight className="w-4 h-4" />
              <span className="text-gray-900">
                {view === 'module' && currentModule?.title}
                {view === 'quiz' && (quizMode === 'module' ? 'Quiz' : 'Examen final')}
                {view === 'exam' && 'Examen final'}
                {view === 'result' && 'Résultats'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Contenu selon la vue */}
      {view === 'home' && renderHome()}
      {view === 'module' && renderModule()}
      {view === 'quiz' && renderQuiz()}
      {view === 'exam' && renderQuiz()}
      {view === 'result' && renderResult()}
    </div>
  );
}
