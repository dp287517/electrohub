import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Filter, FileText, AlertTriangle, Shield,
  Wrench, Play, PowerOff, CheckCircle, Book, Download,
  ChevronDown, Grid, List, Clock, User, Building,
  Sparkles, X, Loader2, FileSpreadsheet, Zap, Package, ClipboardList, FileCheck,
  ChevronRight, Eye, MoreVertical, ArrowRight, HardHat
} from 'lucide-react';
import { ProcedureCreator, ProcedureViewer, SafetyEquipmentManager } from '../components/Procedures';
import { useProcedureCapture } from '../contexts/ProcedureCaptureContext';
import {
  listProcedures,
  getCategories,
  downloadProcedurePdf,
  downloadExampleRAMSPdf,
  downloadExampleWorkMethodPdf,
  downloadExampleProcedurePdf,
  downloadAllExampleDocuments,
  generateExampleMethodStatement,
  RISK_LEVELS,
  STATUS_LABELS,
} from '../lib/procedures-api';

// Category icons mapping
const CATEGORY_ICONS = {
  general: FileText,
  maintenance: Wrench,
  securite: Shield,
  mise_en_service: Play,
  mise_hors_service: PowerOff,
  urgence: AlertTriangle,
  controle: CheckCircle,
  formation: Book,
};

// Mobile Card Component - Touch-optimized
function MobileCard({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-3xl border border-gray-100 shadow-sm active:scale-[0.98] transition-all duration-200 overflow-hidden touch-manipulation"
    >
      {/* Gradient header */}
      <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500" />

      <div className="p-4">
        {/* Top section */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-200">
            <CategoryIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-base leading-tight line-clamp-2">{procedure.title}</h3>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide ${statusInfo.bgColor} ${statusInfo.textColor}`}>
                {statusInfo.label}
              </span>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide ${riskInfo.bgColor} ${riskInfo.textColor}`}>
                {riskInfo.label}
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        {procedure.description && (
          <p className="text-sm text-gray-500 line-clamp-2 mb-3">{procedure.description}</p>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center">
                <FileText className="w-3 h-3 text-violet-600" />
              </div>
              {procedure.step_count || 0} étapes
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center">
                <Clock className="w-3 h-3 text-gray-500" />
              </div>
              {new Date(procedure.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(procedure.id);
              }}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 active:bg-violet-100 transition-colors"
            >
              <Download className="w-4 h-4 text-gray-600" />
            </button>
            <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-violet-100">
              <ChevronRight className="w-5 h-5 text-violet-600" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Desktop Card Component
function DesktopCard({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 hover:border-violet-300 hover:shadow-xl hover:shadow-violet-100/50 transition-all duration-300 cursor-pointer overflow-hidden group hover:-translate-y-1"
    >
      <div className="h-1.5 bg-gradient-to-r from-violet-500 via-purple-500 to-violet-600 bg-[length:200%_100%] group-hover:animate-gradient-x" />

      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="w-11 h-11 bg-gradient-to-br from-violet-100 to-purple-100 rounded-xl flex items-center justify-center group-hover:from-violet-200 group-hover:to-purple-200 transition-all duration-300 group-hover:scale-110">
            <CategoryIcon className="w-5 h-5 text-violet-600" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.textColor}`}>
              {statusInfo.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor}`}>
              {riskInfo.label}
            </span>
          </div>
        </div>

        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-violet-700 transition-colors">{procedure.title}</h3>

        {procedure.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{procedure.description}</p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              {procedure.step_count || 0} étapes
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(procedure.id);
            }}
            className="p-2 hover:bg-violet-100 rounded-lg transition-all duration-200 hover:text-violet-600 hover:scale-110 active:scale-95"
            title="Télécharger PDF"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Bottom Sheet Component for Mobile
function BottomSheet({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 animate-slide-up max-h-[85vh] overflow-hidden">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
        {/* Content */}
        <div className="px-5 pb-8 overflow-y-auto max-h-[calc(85vh-80px)]">
          {children}
        </div>
      </div>
    </>
  );
}

// Quick Stats Component - Responsive grid (2x2 on small screens, 4 on large)
function QuickStats({ procedures, loading }) {
  if (loading) return null;

  const stats = {
    total: procedures.length,
    approved: procedures.filter(p => p.status === 'approved').length,
    draft: procedures.filter(p => p.status === 'draft').length,
    high_risk: procedures.filter(p => ['high', 'critical'].includes(p.risk_level)).length,
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      {/* Row 1: Total, Validées */}
      <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-3 text-center shadow-lg shadow-violet-200">
        <p className="text-2xl sm:text-3xl font-bold text-white">{stats.total}</p>
        <p className="text-[10px] sm:text-xs text-violet-100 uppercase tracking-wider font-medium">Total</p>
      </div>
      <div className="bg-white rounded-2xl p-3 text-center border border-green-100 shadow-sm">
        <p className="text-2xl sm:text-3xl font-bold text-green-600">{stats.approved}</p>
        <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-medium">Validées</p>
      </div>
      {/* Row 2: Brouillons, Risque+ */}
      <div className="bg-white rounded-2xl p-3 text-center border border-gray-100 shadow-sm">
        <p className="text-2xl sm:text-3xl font-bold text-gray-600">{stats.draft}</p>
        <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-medium">Brouillons</p>
      </div>
      <div className="bg-white rounded-2xl p-3 text-center border border-orange-100 shadow-sm">
        <p className="text-2xl sm:text-3xl font-bold text-orange-600">{stats.high_risk}</p>
        <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-medium">Risque+</p>
      </div>
    </div>
  );
}

export default function Procedures() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [procedures, setProcedures] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [showCreator, setShowCreator] = useState(false);
  const [selectedProcedure, setSelectedProcedure] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showDocMenu, setShowDocMenu] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(null);
  const [showEquipmentManager, setShowEquipmentManager] = useState(false);
  const [aiGuidedMode, setAiGuidedMode] = useState(false);

  // FIX: Get capture context to reopen modal after photo capture
  const { shouldReopenModal, clearReopenSignal, shouldMinimizeModal, clearMinimizeSignal, captureCount, procedureInfo, isCapturing } = useProcedureCapture();

  // FIX: Reopen the creator modal when returning from photo capture
  useEffect(() => {
    if (shouldReopenModal) {
      console.log('[Procedures] Reopening modal after capture, captureCount:', captureCount);
      setShowCreator(true);
      clearReopenSignal();
    }
  }, [shouldReopenModal, clearReopenSignal, captureCount]);

  // FIX: Close the modal when user clicks "minimize" to navigate freely
  useEffect(() => {
    if (shouldMinimizeModal) {
      console.log('[Procedures] Minimizing modal to allow free navigation');
      setShowCreator(false);
      clearMinimizeSignal();
    }
  }, [shouldMinimizeModal, clearMinimizeSignal]);

  // CRITICAL: Auto-reopen modal if there's an active session in localStorage
  // This handles the case where user minimizes the app and comes back
  // BUT: Don't reopen if user is already using the floating capture widget (isCapturing = true)
  useEffect(() => {
    // FIX: If user is in capture mode with the floating widget, don't auto-reopen the modal
    // The user can manually expand via the widget when they're ready
    if (isCapturing) {
      console.log('[Procedures] Capture mode active (widget visible), skipping auto-reopen');
      return;
    }

    const savedSession = localStorage.getItem('activeProcedureSession');
    if (savedSession && !showCreator) {
      try {
        const session = JSON.parse(savedSession);
        // Only restore if session is less than 24 hours old
        if (session.sessionId && (Date.now() - session.timestamp) < 24 * 60 * 60 * 1000) {
          console.log('[Procedures] Found active session in localStorage, reopening modal:', session.sessionId);
          setShowCreator(true);
        }
      } catch (e) {
        console.error('Error checking active session:', e);
        localStorage.removeItem('activeProcedureSession');
      }
    }
  }, [isCapturing]); // Run on mount and when isCapturing changes

  // Handle URL parameters for deep linking from QR codes
  useEffect(() => {
    const procedureId = searchParams.get('id');
    const aiMode = searchParams.get('ai') === 'true';

    if (procedureId) {
      setSelectedProcedure(procedureId);
      setAiGuidedMode(aiMode);
      // Clear URL params after handling
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const handleDownloadDocument = async (docType) => {
    setGeneratingDoc(docType);
    setShowDocMenu(false);
    try {
      switch (docType) {
        case 'rams': await downloadExampleRAMSPdf(); break;
        case 'method': await downloadExampleWorkMethodPdf(); break;
        case 'proc': await downloadExampleProcedurePdf(); break;
        case 'all': await downloadAllExampleDocuments(); break;
      }
    } catch (error) {
      console.error('Error generating document:', error);
      alert('Erreur lors de la génération du document.');
    } finally {
      setGeneratingDoc(null);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [proceduresData, categoriesData] = await Promise.all([
        listProcedures({ category: selectedCategory, status: selectedStatus, search: searchTerm }),
        getCategories(),
      ]);
      setProcedures(proceduresData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error loading procedures:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCategory, selectedStatus, searchTerm]);

  const handleDownload = async (procedureId) => {
    try {
      await downloadProcedurePdf(procedureId);
    } catch (error) {
      console.error('Error downloading PDF:', error);
    }
  };

  const handleProcedureCreated = (procedure) => {
    setShowCreator(false);
    if (procedure?.id) {
      setSelectedProcedure(procedure.id);
    }
    loadData();
  };

  // Handle modal close - also refresh if it was a background creation
  const handleCreatorClose = (result) => {
    setShowCreator(false);
    // If closed after background processing started, refresh after a delay
    // to allow the procedure to be created in the background
    if (result?.background) {
      console.log('[Procedures] Background creation started, will refresh in 3s');
      // Immediate refresh in case it's already done
      loadData();
      // Also refresh after 3s and 8s to catch slower creations
      setTimeout(() => loadData(), 3000);
      setTimeout(() => loadData(), 8000);
    }
  };

  const activeFiltersCount = (selectedCategory ? 1 : 0) + (selectedStatus ? 1 : 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* === MOBILE LAYOUT === */}
      <div className="lg:hidden">
        {/* Sticky Header */}
        <div className="sticky top-0 z-30 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 safe-area-top">
          <div className="px-4 pt-4 pb-5">
            {/* Title row */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-white">Procédures</h1>
                <p className="text-violet-200 text-xs">Gérez vos procédures opérationnelles</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Equipment Manager Button */}
                <button
                  onClick={() => setShowEquipmentManager(true)}
                  className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center active:bg-white/30 transition-colors"
                  title="Équipements de sécurité"
                >
                  <HardHat className="w-5 h-5 text-white" />
                </button>
                <button
                  onClick={() => setShowDocMenu(true)}
                  disabled={generatingDoc !== null}
                  className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center active:bg-white/30 transition-colors"
                >
                  {generatingDoc ? (
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-5 h-5 text-white" />
                  )}
                </button>
              </div>
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-12 pr-4 py-3.5 bg-white rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/50 shadow-lg"
              />
              <button
                onClick={() => setShowFilters(true)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  activeFiltersCount > 0 ? 'bg-violet-100' : 'bg-gray-100'
                }`}
              >
                <Filter className={`w-5 h-5 ${activeFiltersCount > 0 ? 'text-violet-600' : 'text-gray-500'}`} />
                {activeFiltersCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-violet-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-4 pb-24">
          {/* Quick Stats */}
          <QuickStats procedures={procedures} loading={loading} />

          {/* Loading */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 relative">
                <div className="absolute inset-0 rounded-full border-4 border-violet-200 animate-ping" />
                <div className="absolute inset-2 rounded-full border-4 border-violet-400 animate-pulse" />
                <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-violet-600" />
              </div>
              <p className="text-gray-500 mt-4 font-medium">Chargement...</p>
            </div>
          ) : procedures.length === 0 ? (
            /* Empty state */
            <div className="text-center py-12">
              <div className="w-24 h-24 bg-gradient-to-br from-violet-100 to-purple-100 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-lg">
                <FileText className="w-12 h-12 text-violet-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Aucune procédure</h3>
              <p className="text-gray-500 mb-6 px-8">
                {searchTerm || activeFiltersCount > 0
                  ? 'Modifiez vos critères de recherche'
                  : 'Créez votre première procédure avec LIA'}
              </p>
              <button
                onClick={() => setShowCreator(true)}
                className="px-6 py-3.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-2xl font-semibold inline-flex items-center gap-2 shadow-xl shadow-violet-200 active:scale-95 transition-transform"
              >
                <Sparkles className="w-5 h-5" />
                Créer avec LIA
              </button>
            </div>
          ) : (
            /* Procedures list */
            <div className="space-y-3">
              {procedures.map((procedure, index) => (
                <div
                  key={procedure.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <MobileCard
                    procedure={procedure}
                    onClick={() => setSelectedProcedure(procedure.id)}
                    onDownload={handleDownload}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* FAB - Floating Action Button */}
        <button
          onClick={() => setShowCreator(true)}
          className="fixed bottom-6 right-4 w-16 h-16 bg-gradient-to-r from-violet-600 to-purple-600 rounded-full flex items-center justify-center shadow-2xl shadow-violet-400/50 z-40 active:scale-90 transition-transform"
        >
          <Plus className="w-7 h-7 text-white" />
        </button>

        {/* Filter Bottom Sheet */}
        <BottomSheet isOpen={showFilters} onClose={() => setShowFilters(false)} title="Filtres">
          <div className="space-y-6">
            {/* Categories */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-5 bg-violet-500 rounded-full"></span>
                Catégorie
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    !selectedCategory
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                      : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                  }`}
                >
                  Toutes
                </button>
                {categories.map((cat) => {
                  const Icon = CATEGORY_ICONS[cat.id] || FileText;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
                        selectedCategory === cat.id
                          ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                          : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Status */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-5 bg-purple-500 rounded-full"></span>
                Statut
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedStatus(null)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    !selectedStatus
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-200'
                      : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                  }`}
                >
                  Tous
                </button>
                {Object.entries(STATUS_LABELS).map(([key, status]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedStatus(key)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      selectedStatus === key
                        ? `${status.bgColor} ${status.textColor} ring-2 ring-offset-2 ring-gray-200`
                        : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                    }`}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Apply Button */}
            <button
              onClick={() => setShowFilters(false)}
              className="w-full py-4 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-2xl font-semibold text-center shadow-lg shadow-violet-200 active:scale-[0.98] transition-transform"
            >
              Appliquer les filtres
            </button>

            {/* Reset */}
            {activeFiltersCount > 0 && (
              <button
                onClick={() => { setSelectedCategory(null); setSelectedStatus(null); }}
                className="w-full py-3 text-violet-600 font-medium"
              >
                Réinitialiser tous les filtres
              </button>
            )}
          </div>
        </BottomSheet>

        {/* Documents Bottom Sheet */}
        <BottomSheet isOpen={showDocMenu} onClose={() => setShowDocMenu(false)} title="Documents Exemples">
          <div className="space-y-2">
            <button
              onClick={() => handleDownloadDocument('rams')}
              className="w-full flex items-center gap-4 p-4 bg-amber-50 rounded-2xl active:bg-amber-100 transition-colors"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">RAMS</p>
                <p className="text-sm text-gray-500">Analyse des risques (A3)</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </button>

            <button
              onClick={() => handleDownloadDocument('method')}
              className="w-full flex items-center gap-4 p-4 bg-blue-50 rounded-2xl active:bg-blue-100 transition-colors"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                <ClipboardList className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">Méthode de Travail</p>
                <p className="text-sm text-gray-500">Méthodologie détaillée (A4)</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </button>

            <button
              onClick={() => handleDownloadDocument('proc')}
              className="w-full flex items-center gap-4 p-4 bg-green-50 rounded-2xl active:bg-green-100 transition-colors"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                <FileCheck className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">Procédure</p>
                <p className="text-sm text-gray-500">Étapes à suivre (A4)</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-400" />
            </button>

            <div className="pt-2">
              <button
                onClick={() => handleDownloadDocument('all')}
                className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl active:opacity-90 transition-opacity"
              >
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-white">Télécharger tout</p>
                  <p className="text-sm text-violet-200">Les 3 documents (ZIP)</p>
                </div>
                <Download className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </BottomSheet>
      </div>

      {/* === DESKTOP LAYOUT === */}
      <div className="hidden lg:block">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Procédures Opérationnelles
              </h1>
              <p className="text-gray-500 mt-1">Créez et gérez vos procédures de maintenance et sécurité</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Equipment Manager Button */}
              <button
                onClick={() => setShowEquipmentManager(true)}
                className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-amber-200/50 hover:scale-105 active:scale-95"
                title="Gérer les équipements de sécurité"
              >
                <HardHat className="w-5 h-5" />
                Équipements
              </button>

              {/* Example Documents Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowDocMenu(!showDocMenu)}
                  disabled={generatingDoc !== null}
                  className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-amber-200/50 disabled:opacity-50 hover:scale-105 active:scale-95"
                >
                  {generatingDoc ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-5 h-5" />
                  )}
                  {generatingDoc ? 'Génération...' : 'Exemples'}
                  <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showDocMenu ? 'rotate-180' : ''}`} />
                </button>

                {showDocMenu && (
                  <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-slide-down">
                    <div className="p-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase px-3 py-2">Documents Exemples</p>
                      <button onClick={() => handleDownloadDocument('rams')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 rounded-lg transition-all text-left hover:translate-x-1">
                        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center"><FileSpreadsheet className="w-4 h-4 text-amber-600" /></div>
                        <div><p className="font-medium text-gray-900">RAMS</p><p className="text-xs text-gray-500">Analyse des risques (A3)</p></div>
                      </button>
                      <button onClick={() => handleDownloadDocument('method')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 rounded-lg transition-all text-left hover:translate-x-1">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"><ClipboardList className="w-4 h-4 text-blue-600" /></div>
                        <div><p className="font-medium text-gray-900">Méthode de Travail</p><p className="text-xs text-gray-500">Méthodologie détaillée (A4)</p></div>
                      </button>
                      <button onClick={() => handleDownloadDocument('proc')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-green-50 rounded-lg transition-all text-left hover:translate-x-1">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center"><FileCheck className="w-4 h-4 text-green-600" /></div>
                        <div><p className="font-medium text-gray-900">Procédure</p><p className="text-xs text-gray-500">Étapes à suivre (A4)</p></div>
                      </button>
                      <hr className="my-2 border-gray-100" />
                      <button onClick={() => handleDownloadDocument('all')} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50 rounded-lg transition-all text-left hover:translate-x-1">
                        <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center"><Package className="w-4 h-4 text-violet-600" /></div>
                        <div><p className="font-medium text-gray-900">Télécharger tout</p><p className="text-xs text-gray-500">Les 3 documents (ZIP)</p></div>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowCreator(true)}
                className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all flex items-center gap-2 shadow-lg shadow-violet-200/50 hover:scale-105 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Nouvelle procédure
              </button>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-4 mb-6 shadow-sm">
            <div className="flex gap-4">
              <div className="flex-1 relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-violet-500 transition-colors" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Rechercher une procédure..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-gray-50 focus:bg-white transition-all"
                />
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-4 py-2.5 border rounded-xl flex items-center gap-2 transition-all ${
                    showFilters ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Filter className="w-4 h-4" />
                  Filtres
                  {activeFiltersCount > 0 && (
                    <span className="w-5 h-5 bg-violet-600 text-white text-xs rounded-full flex items-center justify-center">{activeFiltersCount}</span>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                {showFilters && (
                  <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 z-50 animate-slide-down">
                    <h4 className="font-semibold text-gray-900 mb-3">Catégorie</h4>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button onClick={() => setSelectedCategory(null)} className={`px-3 py-1.5 rounded-full text-sm ${!selectedCategory ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Toutes</button>
                      {categories.map((cat) => {
                        const Icon = CATEGORY_ICONS[cat.id] || FileText;
                        return (
                          <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-1 ${selectedCategory === cat.id ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            <Icon className="w-3 h-3" />{cat.name}
                          </button>
                        );
                      })}
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-3">Statut</h4>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setSelectedStatus(null)} className={`px-3 py-1.5 rounded-full text-sm ${!selectedStatus ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Tous</button>
                      {Object.entries(STATUS_LABELS).map(([key, status]) => (
                        <button key={key} onClick={() => setSelectedStatus(key)} className={`px-3 py-1.5 rounded-full text-sm ${selectedStatus === key ? status.bgColor + ' ' + status.textColor : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{status.label}</button>
                      ))}
                    </div>
                    {activeFiltersCount > 0 && (
                      <button onClick={() => { setSelectedCategory(null); setSelectedStatus(null); }} className="mt-4 text-sm text-violet-600 hover:text-violet-700 flex items-center gap-1">
                        <X className="w-3 h-3" />Réinitialiser
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                <button onClick={() => setViewMode('grid')} className={`p-2.5 transition-all ${viewMode === 'grid' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-100'}`}><Grid className="w-5 h-5" /></button>
                <button onClick={() => setViewMode('list')} className={`p-2.5 transition-all ${viewMode === 'list' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-100'}`}><List className="w-5 h-5" /></button>
              </div>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-violet-200 rounded-full animate-pulse" />
                <Loader2 className="w-8 h-8 text-violet-600 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-gray-500">Chargement des procédures...</p>
            </div>
          ) : procedures.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-24 h-24 bg-gradient-to-br from-violet-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                <FileText className="w-12 h-12 text-violet-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucune procédure trouvée</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">{searchTerm || activeFiltersCount > 0 ? 'Modifiez vos critères' : 'Créez votre première procédure avec LIA'}</p>
              <button onClick={() => setShowCreator(true)} className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all inline-flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95">
                <Sparkles className="w-5 h-5" />Créer une procédure avec LIA
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {procedures.map((procedure, index) => (
                <div key={procedure.id} className="animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
                  <DesktopCard procedure={procedure} onClick={() => setSelectedProcedure(procedure.id)} onDownload={handleDownload} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {procedures.map((procedure, index) => (
                <div key={procedure.id} className="animate-fade-in-up" style={{ animationDelay: `${index * 30}ms` }}>
                  <DesktopCard procedure={procedure} onClick={() => setSelectedProcedure(procedure.id)} onDownload={handleDownload} />
                </div>
              ))}
            </div>
          )}

          {!loading && procedures.length > 0 && (
            <div className="mt-6 text-center text-sm text-gray-500">
              {procedures.length} procédure{procedures.length > 1 ? 's' : ''} trouvée{procedures.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreator && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end lg:items-center justify-center z-50 animate-fade-in">
          <div className="w-full lg:max-w-lg lg:mx-4 overflow-hidden bg-white rounded-t-3xl lg:rounded-2xl lg:shadow-2xl animate-slide-up lg:animate-scale-in">
            <ProcedureCreator onProcedureCreated={handleProcedureCreated} onClose={handleCreatorClose} />
          </div>
        </div>
      )}

      {selectedProcedure && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end lg:items-center justify-center z-50 animate-fade-in">
          <div className="w-full lg:max-w-4xl lg:mx-4 max-h-[95vh] lg:max-h-[90vh] overflow-auto bg-white rounded-t-3xl lg:rounded-2xl animate-slide-up lg:animate-scale-in">
            <ProcedureViewer procedureId={selectedProcedure} aiGuidedMode={aiGuidedMode} onClose={() => { setSelectedProcedure(null); setAiGuidedMode(false); }} onDeleted={() => { setSelectedProcedure(null); setAiGuidedMode(false); loadData(); }} />
          </div>
        </div>
      )}

      {/* Desktop overlays */}
      {showFilters && <div className="hidden lg:block fixed inset-0 z-40" onClick={() => setShowFilters(false)} />}
      {showDocMenu && <div className="hidden lg:block fixed inset-0 z-40" onClick={() => setShowDocMenu(false)} />}

      {/* Safety Equipment Manager */}
      <SafetyEquipmentManager
        isOpen={showEquipmentManager}
        onClose={() => setShowEquipmentManager(false)}
      />
    </div>
  );
}
