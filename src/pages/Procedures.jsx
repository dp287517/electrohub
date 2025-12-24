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

// Procedure Card Component
function ProcedureCard({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 hover:border-violet-300 hover:shadow-lg transition-all cursor-pointer overflow-hidden group"
    >
      {/* Header with category color */}
      <div className="h-2 bg-gradient-to-r from-violet-500 to-purple-500" />

      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center group-hover:bg-violet-200 transition-colors">
            <CategoryIcon className="w-5 h-5 text-violet-600" />
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.textColor}`}>
              {statusInfo.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor}`}>
              {riskInfo.label}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{procedure.title}</h3>

        {/* Description */}
        {procedure.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{procedure.description}</p>
        )}

        {/* Meta */}
        <div className="flex items-center justify-between text-xs text-gray-400">
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
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Télécharger PDF"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Procedure List Item Component
function ProcedureListItem({ procedure, onClick, onDownload }) {
  const CategoryIcon = CATEGORY_ICONS[procedure.category] || FileText;
  const riskInfo = RISK_LEVELS[procedure.risk_level] || RISK_LEVELS.low;
  const statusInfo = STATUS_LABELS[procedure.status] || STATUS_LABELS.draft;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 hover:border-violet-300 hover:shadow transition-all cursor-pointer p-4 flex items-center gap-4"
    >
      <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center flex-shrink-0">
        <CategoryIcon className="w-5 h-5 text-violet-600" />
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-900 truncate">{procedure.title}</h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{procedure.step_count || 0} étapes</span>
          <span>{new Date(procedure.updated_at).toLocaleDateString('fr-FR')}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.textColor}`}>
          {statusInfo.label}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskInfo.bgColor} ${riskInfo.textColor}`}>
          {riskInfo.label}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload(procedure.id);
          }}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Télécharger PDF"
        >
          <Download className="w-4 h-4 text-gray-400" />
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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Procédures Opérationnelles</h1>
            <p className="text-gray-500 mt-1">Créez et gérez vos procédures de maintenance et sécurité</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Example Documents Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDocMenu(!showDocMenu)}
                disabled={generatingDoc !== null}
                className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-amber-200 disabled:opacity-50"
                title="Télécharger les documents exemples"
              >
                {generatingDoc ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-5 h-5" />
                )}
                {generatingDoc ? 'Génération...' : 'Exemples'}
                <ChevronDown className={`w-4 h-4 transition-transform ${showDocMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {showDocMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
                  <div className="p-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase px-3 py-2">Documents Exemples</p>

                    <button
                      onClick={() => handleDownloadDocument('rams')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 rounded-lg transition-colors text-left"
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 rounded-lg transition-colors text-left"
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-green-50 rounded-lg transition-colors text-left"
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50 rounded-lg transition-colors text-left"
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
              className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium hover:from-violet-700 hover:to-purple-700 transition-all flex items-center gap-2 shadow-lg shadow-violet-200"
            >
              <Plus className="w-5 h-5" />
              Nouvelle procédure
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-xl border p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="flex-1 min-w-64 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher une procédure..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            {/* Category Filter */}
            <div className="relative">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg flex items-center gap-2 hover:bg-gray-50"
              >
                <Filter className="w-4 h-4" />
                Filtres
                {(selectedCategory || selectedStatus) && (
                  <span className="w-2 h-2 bg-violet-600 rounded-full" />
                )}
                <ChevronDown className="w-4 h-4" />
              </button>

              {showFilters && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border p-4 z-50">
                  <h4 className="font-medium text-gray-900 mb-3">Catégorie</h4>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className={`px-3 py-1.5 rounded-full text-sm ${
                        !selectedCategory ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
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
                          className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-1 ${
                            selectedCategory === cat.id ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>

                  <h4 className="font-medium text-gray-900 mb-3">Statut</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedStatus(null)}
                      className={`px-3 py-1.5 rounded-full text-sm ${
                        !selectedStatus ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      Tous
                    </button>
                    {Object.entries(STATUS_LABELS).map(([key, status]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedStatus(key)}
                        className={`px-3 py-1.5 rounded-full text-sm ${
                          selectedStatus === key ? status.bgColor + ' ' + status.textColor : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {status.label}
                      </button>
                    ))}
                  </div>

                  {(selectedCategory || selectedStatus) && (
                    <button
                      onClick={() => { setSelectedCategory(null); setSelectedStatus(null); }}
                      className="mt-4 text-sm text-violet-600 hover:text-violet-700"
                    >
                      Réinitialiser les filtres
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2.5 ${viewMode === 'grid' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2.5 ${viewMode === 'list' ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
          </div>
        ) : procedures.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune procédure trouvée</h3>
            <p className="text-gray-500 mb-6">
              {searchTerm || selectedCategory || selectedStatus
                ? 'Essayez de modifier vos critères de recherche'
                : 'Commencez par créer votre première procédure'}
            </p>
            <button
              onClick={() => setShowCreator(true)}
              className="px-5 py-2.5 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 transition-colors inline-flex items-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Créer une procédure avec l'IA
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {procedures.map((procedure) => (
              <ProcedureCard
                key={procedure.id}
                procedure={procedure}
                onClick={() => setSelectedProcedure(procedure.id)}
                onDownload={handleDownload}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {procedures.map((procedure) => (
              <ProcedureListItem
                key={procedure.id}
                procedure={procedure}
                onClick={() => setSelectedProcedure(procedure.id)}
                onDownload={handleDownload}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreator && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <ProcedureCreator
            onProcedureCreated={handleProcedureCreated}
            onClose={() => setShowCreator(false)}
          />
        </div>
      )}

      {selectedProcedure && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <ProcedureViewer
            procedureId={selectedProcedure}
            onClose={() => setSelectedProcedure(null)}
            onDeleted={() => {
              setSelectedProcedure(null);
              loadData();
            }}
          />
        </div>
      )}

      {/* Click outside to close filters */}
      {showFilters && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}
