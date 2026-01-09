// EquipmentSearchModal - Recherche intelligente d'équipement pour dépannage
// Supporte la recherche sémantique, les synonymes et la sélection multiple
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, X, Check, Plus, Loader2, Building2, MapPin,
  Wrench, Zap, ChevronRight, AlertTriangle, Trash2,
  HelpCircle, Sparkles
} from 'lucide-react';
import { get } from '../lib/api';
import TroubleshootingWizard from './TroubleshootingWizard';

// Icons pour les types d'équipements
const EQUIPMENT_ICONS = {
  switchboard: Zap,
  vsd: Zap,
  meca: Wrench,
  mobile: Wrench,
  hv: Zap,
  glo: Zap,
  datahub: Building2,
  atex: AlertTriangle
};

// Couleurs pour les types
const EQUIPMENT_COLORS = {
  switchboard: 'bg-blue-100 text-blue-600',
  vsd: 'bg-purple-100 text-purple-600',
  meca: 'bg-orange-100 text-orange-600',
  mobile: 'bg-green-100 text-green-600',
  hv: 'bg-red-100 text-red-600',
  glo: 'bg-yellow-100 text-yellow-600',
  datahub: 'bg-cyan-100 text-cyan-600',
  atex: 'bg-amber-100 text-amber-600'
};

export default function EquipmentSearchModal({ isOpen, onClose, onSuccess }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState([]);
  const [confirmEquipment, setConfirmEquipment] = useState(null);
  const [expandedTerms, setExpandedTerms] = useState([]);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [error, setError] = useState(null);

  const searchInputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus sur l'input à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
      setSearchQuery('');
      setResults([]);
      setSelectedEquipment([]);
      setConfirmEquipment(null);
      setExpandedTerms([]);
      setError(null);
    }
  }, [isOpen]);

  // Recherche avec debounce
  const performSearch = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setResults([]);
      setExpandedTerms([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await get(`/api/troubleshooting/equipment/smart-search?q=${encodeURIComponent(query)}&limit=15`);

      if (response?.success) {
        setResults(response.results || []);
        setExpandedTerms(response.expandedTerms || []);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('Erreur lors de la recherche');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounce de la recherche
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  // Sélectionner un équipement (affiche confirmation)
  const handleSelectEquipment = (equipment) => {
    setConfirmEquipment(equipment);
  };

  // Confirmer la sélection
  const handleConfirmEquipment = () => {
    if (!confirmEquipment) return;

    // Vérifier si déjà sélectionné
    const alreadySelected = selectedEquipment.some(eq =>
      eq.id === confirmEquipment.id && eq.equipment_type === confirmEquipment.equipment_type
    );

    if (!alreadySelected) {
      setSelectedEquipment(prev => [...prev, confirmEquipment]);
    }

    setConfirmEquipment(null);
    setSearchQuery('');
    setResults([]);
  };

  // Retirer un équipement de la sélection
  const handleRemoveEquipment = (equipment) => {
    setSelectedEquipment(prev =>
      prev.filter(eq => !(eq.id === equipment.id && eq.equipment_type === equipment.equipment_type))
    );
  };

  // Ouvrir le wizard de dépannage
  const handleStartTroubleshooting = () => {
    if (selectedEquipment.length === 0) return;
    setShowTroubleshooting(true);
  };

  // Callback après création du dépannage
  const handleTroubleshootingSuccess = (record) => {
    setShowTroubleshooting(false);
    onSuccess?.(record);
    onClose();
  };

  if (!isOpen) return null;

  // Si on affiche le wizard
  if (showTroubleshooting && selectedEquipment.length > 0) {
    const primaryEquipment = selectedEquipment[0];
    const additionalEquipment = selectedEquipment.slice(1).map(eq => ({
      equipment_id: eq.id,
      equipment_type: eq.equipment_type,
      equipment_name: eq.name,
      equipment_code: eq.code,
      building_code: eq.building
    }));

    return (
      <TroubleshootingWizard
        isOpen={true}
        onClose={() => {
          setShowTroubleshooting(false);
          onClose();
        }}
        equipment={{
          id: primaryEquipment.id,
          name: primaryEquipment.name,
          code: primaryEquipment.code,
          building_code: primaryEquipment.building,
          floor: primaryEquipment.floor,
          zone: primaryEquipment.zone
        }}
        equipmentType={primaryEquipment.equipment_type}
        additionalEquipment={additionalEquipment}
        onSuccess={handleTroubleshootingSuccess}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 p-4 sm:p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Wrench size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Nouveau dépannage</h2>
                <p className="text-white/80 text-sm">Recherche l'équipement concerné</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Barre de recherche */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tape un nom, code, bâtiment, ou même un problème (fuite, froid, luminaire...)"
              className="w-full pl-12 pr-4 py-4 text-lg border border-gray-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
            />
            {isSearching && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-orange-500 animate-spin" />
            )}
          </div>

          {/* Termes étendus (synonymes trouvés) */}
          {expandedTerms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-gray-500">Recherche élargie:</span>
              {expandedTerms.slice(0, 6).map((term, i) => (
                <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-600 text-xs rounded-full">
                  {term}
                </span>
              ))}
              {expandedTerms.length > 6 && (
                <span className="text-xs text-gray-400">+{expandedTerms.length - 6}</span>
              )}
            </div>
          )}

          {/* Mini modal de confirmation */}
          {confirmEquipment && (
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-2xl p-4 animate-in slide-in-from-top-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-100 rounded-xl">
                  <HelpCircle className="w-5 h-5 text-orange-600" />
                </div>
                <span className="font-semibold text-gray-900">C'est bien cet équipement ?</span>
              </div>

              <div className="bg-white rounded-xl p-4 border border-orange-100 mb-4">
                <div className="flex items-start gap-3">
                  {(() => {
                    const IconComponent = EQUIPMENT_ICONS[confirmEquipment.equipment_type] || Wrench;
                    return (
                      <div className={`p-2 rounded-lg ${EQUIPMENT_COLORS[confirmEquipment.equipment_type] || 'bg-gray-100 text-gray-600'}`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-lg">{confirmEquipment.name}</p>
                    {confirmEquipment.code && (
                      <p className="text-sm text-gray-500 font-mono">{confirmEquipment.code}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">
                        {confirmEquipment.type_label || confirmEquipment.equipment_type}
                      </span>
                      {confirmEquipment.building && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {confirmEquipment.building}
                        </span>
                      )}
                      {confirmEquipment.floor && (
                        <span>Étage {confirmEquipment.floor}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmEquipment(null)}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Non, chercher autre
                </button>
                <button
                  onClick={handleConfirmEquipment}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all flex items-center justify-center gap-2"
                >
                  <Check className="w-5 h-5" />
                  Oui, c'est ça !
                </button>
              </div>
            </div>
          )}

          {/* Résultats de recherche */}
          {!confirmEquipment && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 px-2">
                {results.length} équipement{results.length > 1 ? 's' : ''} trouvé{results.length > 1 ? 's' : ''}
              </p>
              {results.map((eq, idx) => {
                const isSelected = selectedEquipment.some(
                  sel => sel.id === eq.id && sel.equipment_type === eq.equipment_type
                );
                const IconComponent = EQUIPMENT_ICONS[eq.equipment_type] || Wrench;

                return (
                  <button
                    key={`${eq.equipment_type}-${eq.id}-${idx}`}
                    onClick={() => !isSelected && handleSelectEquipment(eq)}
                    disabled={isSelected}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-green-300 bg-green-50 cursor-not-allowed'
                        : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${EQUIPMENT_COLORS[eq.equipment_type] || 'bg-gray-100 text-gray-600'}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 truncate">{eq.name}</p>
                          {isSelected && (
                            <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                            {eq.type_label || eq.equipment_type}
                          </span>
                          {eq.code && <span className="font-mono">{eq.code}</span>}
                          {eq.building && (
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3" />
                              {eq.building}
                            </span>
                          )}
                        </div>
                      </div>
                      {!isSelected && (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Message si pas de résultats */}
          {!confirmEquipment && !isSearching && searchQuery.length >= 2 && results.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">Aucun équipement trouvé</p>
              <p className="text-sm mt-1">Essaie avec d'autres termes ou un code</p>
            </div>
          )}

          {/* Aide initiale */}
          {!confirmEquipment && searchQuery.length < 2 && results.length === 0 && selectedEquipment.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Sparkles className="w-12 h-12 mx-auto mb-3 text-orange-300" />
              <p className="font-medium text-gray-700">Recherche intelligente</p>
              <p className="text-sm mt-2 max-w-md mx-auto">
                Tape un <strong>nom d'équipement</strong>, un <strong>code</strong>, un <strong>bâtiment</strong>,
                ou même un <strong>problème</strong> (fuite, froid, luminaire...)
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {['luminaire', 'fuite eau', 'porte B12', 'VSD', 'tableau'].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setSearchQuery(ex)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-orange-100 text-gray-600 hover:text-orange-700 text-sm rounded-full transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Équipements sélectionnés */}
          {selectedEquipment.length > 0 && !confirmEquipment && (
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">
                  Équipement{selectedEquipment.length > 1 ? 's' : ''} sélectionné{selectedEquipment.length > 1 ? 's' : ''}
                </h3>
                <span className="px-2 py-1 bg-orange-100 text-orange-700 text-sm font-medium rounded-full">
                  {selectedEquipment.length}
                </span>
              </div>
              <div className="space-y-2">
                {selectedEquipment.map((eq, idx) => {
                  const IconComponent = EQUIPMENT_ICONS[eq.equipment_type] || Wrench;
                  return (
                    <div
                      key={`selected-${eq.equipment_type}-${eq.id}`}
                      className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200"
                    >
                      <div className={`p-1.5 rounded-lg ${EQUIPMENT_COLORS[eq.equipment_type] || 'bg-gray-100 text-gray-600'}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{eq.name}</p>
                        <p className="text-xs text-gray-500">
                          {eq.type_label} {eq.building && `• ${eq.building}`}
                        </p>
                      </div>
                      {idx === 0 && selectedEquipment.length > 1 && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          Principal
                        </span>
                      )}
                      <button
                        onClick={() => handleRemoveEquipment(eq)}
                        className="p-1.5 hover:bg-red-100 rounded-lg transition-colors group"
                      >
                        <Trash2 className="w-4 h-4 text-gray-400 group-hover:text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Bouton ajouter plus */}
              <button
                onClick={() => searchInputRef.current?.focus()}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-xl hover:border-orange-300 hover:text-orange-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Ajouter un autre équipement
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer - Bouton démarrer */}
        {selectedEquipment.length > 0 && !confirmEquipment && (
          <div className="p-4 sm:p-6 border-t bg-gray-50">
            <button
              onClick={handleStartTroubleshooting}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white text-lg font-bold rounded-2xl hover:from-orange-600 hover:to-red-600 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
            >
              <Wrench className="w-6 h-6" />
              Créer le dépannage
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Export du bouton pour l'intégrer facilement
export function TroubleshootingSearchButton({ onSuccess, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all shadow-lg hover:shadow-xl ${className}`}
      >
        <Wrench size={18} />
        <span>Faire un dépannage</span>
      </button>

      <EquipmentSearchModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSuccess={(record) => {
          onSuccess?.(record);
          setIsOpen(false);
        }}
      />
    </>
  );
}
