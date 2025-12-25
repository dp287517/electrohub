import { useState, useEffect } from 'react';
import {
  Plus, Search, Filter, FileText, AlertTriangle, Shield,
  Wrench, Play, PowerOff, CheckCircle, Book, Download,
  ChevronDown, Grid, List, Clock, User, Building,
  Sparkles, X, Loader2, FileSpreadsheet, Zap, Package, ClipboardList, FileCheck
} from 'lucide-react';
import { ProcedureCreator, ProcedureViewer } from '../components/Procedures';
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

// Procedure Card Component - Enhanced with animations
function ProcedureCard({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 hover:border-violet-300 hover:shadow-xl hover:shadow-violet-100/50 transition-all duration-300 cursor-pointer overflow-hidden group hover:-translate-y-1"
    >
      {/* Header with category color - animated gradient */}
      <div className="h-1.5 bg-gradient-to-r from-violet-500 via-purple-500 to-violet-600 bg-[length:200%_100%] group-hover:animate-gradient-x" />

      <div className="p-4 sm:p-5">
        {/* Top row */}
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-gradient-to-br from-violet-100 to-purple-100 rounded-xl flex items-center justify-center group-hover:from-violet-200 group-hover:to-purple-200 transition-all duration-300 group-hover:scale-110">
            <CategoryIcon className="w-5 h-5 text-violet-600" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.textColor} transition-transform hover:scale-105`}>
              {statusInfo.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor} transition-transform hover:scale-105`}>
              {riskInfo.label}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-violet-700 transition-colors">{procedure.title}</h3>

        {/* Description */}
        {procedure.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{procedure.description}</p>
        )}

        {/* Meta */}
        <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {procedure.step_count || 0} étapes
            </span>
            {procedure.equipment_count > 0 && (
              <span className="flex items-center gap-1">
                <Building className="w-3 h-3" />
                {procedure.equipment_count} équip.
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(procedure.id);
            }}
            className="p-1.5 hover:bg-violet-100 rounded-lg transition-all duration-200 hover:text-violet-600 hover:scale-110 active:scale-95"
            title="Télécharger PDF"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Procedure List Item Component - Enhanced with animations
function ProcedureListItem({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200/50 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-100/30 transition-all duration-300 cursor-pointer p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 group hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-10 h-10 bg-gradient-to-br from-violet-100 to-purple-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:from-violet-200 group-hover:to-purple-200 transition-all duration-300 group-hover:scale-110">
          <CategoryIcon className="w-5 h-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0 sm:hidden">
          <h3 className="font-medium text-gray-900 truncate group-hover:text-violet-700 transition-colors">{procedure.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{procedure.step_count || 0} étapes</span>
            <span>{new Date(procedure.updated_at).toLocaleDateString('fr-FR')}</span>
          </div>
        </div>
      </div>

      <div className="hidden sm:block flex-1 min-w-0">
        <h3 className="font-medium text-gray-900 truncate group-hover:text-violet-700 transition-colors">{procedure.title}</h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{procedure.step_count || 0} étapes</span>
          <span>{new Date(procedure.updated_at).toLocaleDateString('fr-FR')}</span>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-2 pl-13 sm:pl-0">
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.textColor} transition-transform hover:scale-105`}>
            {statusInfo.label}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor} transition-transform hover:scale-105`}>
            {riskInfo.label}
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
          <Download className="w-4 h-4 text-gray-400 group-hover:text-violet-500" />
        </button>
      </div>
    </div>
  );
}

export default function Procedures() {
  const [procedures, setProcedures] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // grid or list
  const [showCreator, setShowCreator] = useState(false);
  const [selectedProcedure, setSelectedProcedure] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(null); // 'rams' | 'method' | 'proc' | 'all' | null
  const [showDocMenu, setShowDocMenu] = useState(false);

  // Download specific example document
  const handleDownloadDocument = async (docType) => {
    setGeneratingDoc(docType);
    setShowDocMenu(false);
    try {
      switch (docType) {
        case 'rams':
          await downloadExampleRAMSPdf();
          break;
        case 'method':
          await downloadExampleWorkMethodPdf();
          break;
        case 'proc':
          await downloadExampleProcedurePdf();
          break;
        case 'all':
          await downloadAllExampleDocuments();
          break;
      }
    } catch (error) {
      console.error('Error generating document:', error);
      alert('Erreur lors de la génération du document. Veuillez réessayer.');
    } finally {
      setGeneratingDoc(null);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [proceduresData, categoriesData] = await Promise.all([
        listProcedures({
          category: selectedCategory,
          status: selectedStatus,
          search: searchTerm,
        }),
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
    setSelectedProcedure(procedure.id);
    loadData();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-violet-50/30 to-purple-50/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header - Responsive */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div className="animate-fade-in">
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
              Procédures Opérationnelles
            </h1>
            <p className="text-gray-500 mt-1 text-sm sm:text-base">Créez et gérez vos procédures de maintenance et sécurité</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Example Documents Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDocMenu(!showDocMenu)}
                disabled={generatingDoc !== null}
                className="px-3 sm:px-4 py-2 sm:py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-amber-200/50 disabled:opacity-50 hover:scale-105 active:scale-95"
                title="Télécharger les documents exemples"
              >
                {generatingDoc ? (
                  <Loader2 className="w-4 sm:w-5 h-4 sm:h-5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 sm:w-5 h-4 sm:h-5" />
                )}
                <span className="hidden sm:inline">{generatingDoc ? 'Génération...' : 'Exemples'}</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showDocMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu with animation */}
              {showDocMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-slide-down">
                  <div className="p-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase px-3 py-2">Documents Exemples</p>

                    <button
                      onClick={() => handleDownloadDocument('rams')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 rounded-lg transition-all duration-200 text-left hover:translate-x-1"
                    >
                      <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                        <FileSpreadsheet className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">RAMS</p>
                        <p className="text-xs text-gray-500">Analyse des risques (A3)</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleDownloadDocument('method')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 rounded-lg transition-all duration-200 text-left hover:translate-x-1"
                    >
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <ClipboardList className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Méthode de Travail</p>
                        <p className="text-xs text-gray-500">Méthodologie détaillée (A4)</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleDownloadDocument('proc')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-green-50 rounded-lg transition-all duration-200 text-left hover:translate-x-1"
                    >
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <FileCheck className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Procédure</p>
                        <p className="text-xs text-gray-500">Étapes à suivre (A4)</p>
                      </div>
                    </button>

                    <hr className="my-2 border-gray-100" />

                    <button
                      onClick={() => handleDownloadDocument('all')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50 rounded-lg transition-all duration-200 text-left hover:translate-x-1"
                    >
                      <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                        <Package className="w-4 h-4 text-violet-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Télécharger tout</p>
                        <p className="text-xs text-gray-500">Les 3 documents (ZIP)</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCreator(true)}
              className="px-4 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all flex items-center gap-2 shadow-lg shadow-violet-200/50 hover:scale-105 active:scale-95 hover:shadow-xl"
            >
              <Plus className="w-4 sm:w-5 h-4 sm:h-5" />
              <span className="hidden sm:inline">Nouvelle procédure</span>
              <span className="sm:hidden">Créer</span>
            </button>
          </div>
        </div>

        {/* Search and Filters - Responsive */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 p-3 sm:p-4 mb-6 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            {/* Search */}
            <div className="flex-1 relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-violet-500 transition-colors" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher une procédure..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-gray-50 focus:bg-white transition-all duration-200"
              />
            </div>

            <div className="flex gap-2 sm:gap-3">
              {/* Category Filter */}
              <div className="relative flex-1 sm:flex-none">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`w-full sm:w-auto px-4 py-2.5 border rounded-xl flex items-center justify-center gap-2 transition-all duration-200 ${
                    showFilters ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <Filter className="w-4 h-4" />
                  <span className="hidden sm:inline">Filtres</span>
                  {(selectedCategory || selectedStatus) && (
                    <span className="w-2 h-2 bg-violet-600 rounded-full animate-pulse" />
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showFilters ? 'rotate-180' : ''}`} />
                </button>

                {showFilters && (
                  <div className="absolute top-full left-0 sm:right-0 sm:left-auto mt-2 w-[calc(100vw-2rem)] sm:w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 z-50 animate-slide-down">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-4 bg-violet-500 rounded-full"></span>
                      Catégorie
                    </h4>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        onClick={() => setSelectedCategory(null)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-all duration-200 ${
                          !selectedCategory ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                            className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-1 transition-all duration-200 ${
                              selectedCategory === cat.id ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>

                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-4 bg-purple-500 rounded-full"></span>
                      Statut
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSelectedStatus(null)}
                        className={`px-3 py-1.5 rounded-full text-sm transition-all duration-200 ${
                          !selectedStatus ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Tous
                      </button>
                      {Object.entries(STATUS_LABELS).map(([key, status]) => (
                        <button
                          key={key}
                          onClick={() => setSelectedStatus(key)}
                          className={`px-3 py-1.5 rounded-full text-sm transition-all duration-200 ${
                            selectedStatus === key ? status.bgColor + ' ' + status.textColor + ' ring-2 ring-offset-1' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>

                    {(selectedCategory || selectedStatus) && (
                      <button
                        onClick={() => { setSelectedCategory(null); setSelectedStatus(null); }}
                        className="mt-4 text-sm text-violet-600 hover:text-violet-700 flex items-center gap-1 group"
                      >
                        <X className="w-3 h-3 group-hover:rotate-90 transition-transform" />
                        Réinitialiser les filtres
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* View Mode Toggle */}
              <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2.5 transition-all duration-200 ${viewMode === 'grid' ? 'bg-violet-100 text-violet-600 shadow-inner' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                >
                  <Grid className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2.5 transition-all duration-200 ${viewMode === 'list' ? 'bg-violet-100 text-violet-600 shadow-inner' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                >
                  <List className="w-5 h-5" />
                </button>
              </div>
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
            <p className="text-gray-500 animate-pulse">Chargement des procédures...</p>
          </div>
        ) : procedures.length === 0 ? (
          <div className="text-center py-16 sm:py-20 animate-fade-in">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-violet-100 to-purple-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-100">
              <FileText className="w-10 h-10 sm:w-12 sm:h-12 text-violet-400" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Aucune procédure trouvée</h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto px-4">
              {searchTerm || selectedCategory || selectedStatus
                ? 'Essayez de modifier vos critères de recherche'
                : 'Commencez par créer votre première procédure avec l\'assistant IA'}
            </p>
            <button
              onClick={() => setShowCreator(true)}
              className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all inline-flex items-center gap-2 shadow-lg shadow-violet-200/50 hover:scale-105 active:scale-95"
            >
              <Sparkles className="w-5 h-5" />
              Créer une procédure avec LIA
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {procedures.map((procedure, index) => (
              <div
                key={procedure.id}
                className="animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <ProcedureCard
                  procedure={procedure}
                  onClick={() => setSelectedProcedure(procedure.id)}
                  onDownload={handleDownload}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {procedures.map((procedure, index) => (
              <div
                key={procedure.id}
                className="animate-fade-in-up"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <ProcedureListItem
                  procedure={procedure}
                  onClick={() => setSelectedProcedure(procedure.id)}
                  onDownload={handleDownload}
                />
              </div>
            ))}
          </div>
        )}

        {/* Results count */}
        {!loading && procedures.length > 0 && (
          <div className="mt-6 text-center text-sm text-gray-500">
            {procedures.length} procédure{procedures.length > 1 ? 's' : ''} trouvée{procedures.length > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Modals with better animations */}
      {showCreator && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in">
          <div className="animate-scale-in w-full max-w-2xl max-h-[95vh] overflow-auto">
            <ProcedureCreator
              onProcedureCreated={handleProcedureCreated}
              onClose={() => setShowCreator(false)}
            />
          </div>
        </div>
      )}

      {selectedProcedure && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in">
          <div className="animate-scale-in w-full max-w-4xl max-h-[95vh] overflow-auto">
            <ProcedureViewer
              procedureId={selectedProcedure}
              onClose={() => setSelectedProcedure(null)}
              onDeleted={() => {
                setSelectedProcedure(null);
                loadData();
              }}
            />
          </div>
        </div>
      )}

      {/* Click outside to close filters */}
      {showFilters && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={() => setShowFilters(false)}
        />
      )}

      {/* Click outside to close doc menu */}
      {showDocMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDocMenu(false)}
        />
      )}
    </div>
  );
}
