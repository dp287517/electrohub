// ============================================================
// CustomModule.jsx - Dynamic Custom Module Page
// Adapts to any custom module based on URL slug
// ============================================================

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import MiniElectro from "../components/MiniElectro";
import {
  Plus, Search, Filter, Building2, MapPin, Trash2, Edit2, Save, X, Upload,
  ChevronDown, ChevronRight, RefreshCw, FileText, Image, Download, Map,
  Circle, Square, Triangle, Star, Heart, Zap, Power, Battery, Wrench,
  Factory, Server, Cpu, Wifi, Shield, Flag, Home, Box, Clock, Calendar,
  Bell, Folder, File, Eye, Lock, Check, Flame, Package, Tag, Bookmark, Award,
  User, Users, AlertCircle, Info, Loader2
} from "lucide-react";

// Icon mapping
const ICON_MAP = {
  circle: Circle, square: Square, triangle: Triangle, star: Star, heart: Heart,
  zap: Zap, power: Power, battery: Battery, wrench: Wrench, factory: Factory,
  server: Server, cpu: Cpu, wifi: Wifi, shield: Shield, flag: Flag, home: Home,
  box: Box, clock: Clock, calendar: Calendar, bell: Bell, folder: Folder,
  file: File, eye: Eye, lock: Lock, check: Check, flame: Flame, package: Package,
  tag: Tag, bookmark: Bookmark, award: Award, user: User, users: Users,
  alertcircle: AlertCircle, info: Info, building: Building2, mappin: MapPin
};

// Get icon component by name
function getIconComponent(iconName) {
  return ICON_MAP[iconName?.toLowerCase()] || Box;
}

// Lightbox component
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const handleEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-gray-300 z-50">
        <X size={32} />
      </button>
      <img src={src} alt="Preview" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// Category filter chips
function CategoryFilterChips({ categories, selectedCategories, onToggle, onClearAll }) {
  if (!categories?.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {selectedCategories.length > 0 && (
        <button onClick={onClearAll} className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300">
          Tout afficher
        </button>
      )}
      {categories.map((cat) => {
        const isSelected = selectedCategories.includes(cat.id);
        const IconComp = getIconComponent(cat.icon);
        return (
          <button
            key={cat.id}
            onClick={() => onToggle(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all ${
              isSelected
                ? "ring-2 ring-offset-1 shadow-md"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            style={isSelected ? { backgroundColor: cat.color + "20", color: cat.color, ringColor: cat.color } : {}}
          >
            <IconComp size={12} />
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}

export default function CustomModule() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Module data
  const [module, setModule] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [expandedBuildings, setExpandedBuildings] = useState({});
  const [selectedItem, setSelectedItem] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // Form state
  const [formData, setFormData] = useState({});
  const [categoryFormData, setCategoryFormData] = useState({});
  const [saving, setSaving] = useState(false);

  // Load module data
  const loadModule = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    try {
      const [moduleRes, categoriesRes, itemsRes] = await Promise.all([
        api.customModules.getModule(slug),
        api.customModules.listCategories(slug),
        api.customModules.listItems(slug)
      ]);

      setModule(moduleRes.module);
      setCategories(categoriesRes.categories || []);
      setItems(itemsRes.items || []);

      // Check for item selection from URL
      const itemId = searchParams.get("item");
      if (itemId) {
        const item = (itemsRes.items || []).find(i => String(i.id) === itemId);
        if (item) setSelectedItem(item);
      }
    } catch (e) {
      console.error("Error loading module:", e);
      setError(e.message || "Failed to load module");
    } finally {
      setLoading(false);
    }
  }, [slug, searchParams]);

  useEffect(() => {
    loadModule();
  }, [loadModule]);

  // Filter items
  const filteredItems = useMemo(() => {
    let result = items;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.name?.toLowerCase().includes(q) ||
          i.code?.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q)
      );
    }

    if (selectedCategories.length > 0) {
      result = result.filter((i) => selectedCategories.includes(i.category_id));
    }

    return result;
  }, [items, searchQuery, selectedCategories]);

  // Group items by building
  const itemsByBuilding = useMemo(() => {
    const grouped = {};
    filteredItems.forEach((item) => {
      const building = item.building || "Sans bâtiment";
      if (!grouped[building]) grouped[building] = [];
      grouped[building].push(item);
    });
    return grouped;
  }, [filteredItems]);

  // Toggle category filter
  const toggleCategory = (catId) => {
    setSelectedCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Toggle building expansion
  const toggleBuilding = (building) => {
    setExpandedBuildings((prev) => ({ ...prev, [building]: !prev[building] }));
  };

  // Create item
  const handleCreateItem = async () => {
    if (!formData.name?.trim()) return;
    setSaving(true);

    try {
      const res = await api.customModules.createItem(slug, formData);
      setItems((prev) => [...prev, res.item]);
      setShowCreateModal(false);
      setFormData({});
      setSelectedItem(res.item);
    } catch (e) {
      console.error("Error creating item:", e);
      alert("Erreur: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Update item
  const handleUpdateItem = async () => {
    if (!selectedItem || !formData.name?.trim()) return;
    setSaving(true);

    try {
      const res = await api.customModules.updateItem(slug, selectedItem.id, formData);
      setItems((prev) => prev.map((i) => (i.id === selectedItem.id ? { ...i, ...res.item } : i)));
      setSelectedItem({ ...selectedItem, ...res.item });
      setShowEditModal(false);
    } catch (e) {
      console.error("Error updating item:", e);
      alert("Erreur: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete item
  const handleDeleteItem = async (item) => {
    if (!confirm(`Supprimer "${item.name}" ?`)) return;

    try {
      await api.customModules.deleteItem(slug, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (selectedItem?.id === item.id) setSelectedItem(null);
    } catch (e) {
      console.error("Error deleting item:", e);
      alert("Erreur: " + e.message);
    }
  };

  // Create category
  const handleCreateCategory = async () => {
    if (!categoryFormData.name?.trim()) return;
    setSaving(true);

    try {
      const res = await api.customModules.createCategory(slug, categoryFormData);
      setCategories((prev) => [...prev, res.category]);
      setShowCategoryModal(false);
      setCategoryFormData({});
    } catch (e) {
      console.error("Error creating category:", e);
      alert("Erreur: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Upload photo
  const handlePhotoUpload = async (file) => {
    if (!selectedItem) return;

    try {
      await api.customModules.uploadPhoto(slug, selectedItem.id, file);
      // Refresh item
      const res = await api.customModules.getItem(slug, selectedItem.id);
      setSelectedItem(res.item);
      setItems((prev) => prev.map((i) => (i.id === selectedItem.id ? { ...i, has_photo: true } : i)));
    } catch (e) {
      console.error("Error uploading photo:", e);
      alert("Erreur: " + e.message);
    }
  };

  // Navigate to map
  const navigateToMap = (item = null) => {
    const url = item ? `/app/m/${slug}/map?item=${item.id}` : `/app/m/${slug}/map`;
    navigate(url);
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Erreur</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button onClick={() => navigate("/dashboard")} className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">
            Retour au dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Module non trouvé</h2>
          <p className="text-gray-600 mb-4">Le module "{slug}" n'existe pas.</p>
          <button onClick={() => navigate("/dashboard")} className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">
            Retour au dashboard
          </button>
        </div>
      </div>
    );
  }

  const ModuleIcon = getIconComponent(module.icon);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg"
                style={{ background: `linear-gradient(135deg, ${module.color}, ${module.color}dd)` }}
              >
                <ModuleIcon size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{module.name}</h1>
                <p className="text-sm text-gray-500">
                  {items.length} élément{items.length !== 1 ? "s" : ""} • {categories.length} catégorie{categories.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => navigateToMap()}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2"
              >
                <Map size={18} />
                <span className="hidden sm:inline">Carte</span>
              </button>
              <button
                onClick={() => setShowCategoryModal(true)}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 flex items-center gap-2"
              >
                <Folder size={18} />
                <span className="hidden sm:inline">Catégorie</span>
              </button>
              <button
                onClick={() => {
                  setFormData({});
                  setShowCreateModal(true);
                }}
                className="px-4 py-2 rounded-xl text-white font-medium flex items-center gap-2 shadow-lg hover:shadow-xl transition-shadow"
                style={{ backgroundColor: module.color }}
              >
                <Plus size={18} />
                <span className="hidden sm:inline">Ajouter</span>
              </button>
            </div>
          </div>

          {/* Search and filters */}
          <div className="mt-4 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>
            <CategoryFilterChips
              categories={categories}
              selectedCategories={selectedCategories}
              onToggle={toggleCategory}
              onClearAll={() => setSelectedCategories([])}
            />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Items list */}
          <div className="lg:col-span-2 space-y-4">
            {Object.keys(itemsByBuilding).length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center">
                <Box className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Aucun élément</h3>
                <p className="text-gray-500 mb-4">Commencez par ajouter un élément à ce module.</p>
                <button
                  onClick={() => {
                    setFormData({});
                    setShowCreateModal(true);
                  }}
                  className="px-4 py-2 rounded-xl text-white font-medium"
                  style={{ backgroundColor: module.color }}
                >
                  Ajouter un élément
                </button>
              </div>
            ) : (
              Object.entries(itemsByBuilding).map(([building, buildingItems]) => (
                <div key={building} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => toggleBuilding(building)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 size={18} className="text-gray-500" />
                      <span className="font-semibold text-gray-800">{building}</span>
                      <span className="text-sm text-gray-500">({buildingItems.length})</span>
                    </div>
                    {expandedBuildings[building] !== false ? (
                      <ChevronDown size={18} className="text-gray-400" />
                    ) : (
                      <ChevronRight size={18} className="text-gray-400" />
                    )}
                  </button>

                  {expandedBuildings[building] !== false && (
                    <div className="divide-y">
                      {buildingItems.map((item) => {
                        const category = categories.find((c) => c.id === item.category_id);
                        const CatIcon = getIconComponent(category?.icon);

                        return (
                          <div
                            key={item.id}
                            onClick={() => setSelectedItem(item)}
                            className={`px-4 py-3 cursor-pointer transition-colors ${
                              selectedItem?.id === item.id ? "bg-violet-50" : "hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                                  style={{ backgroundColor: category?.color || module.color }}
                                >
                                  <CatIcon size={16} />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">{item.name}</div>
                                  <div className="text-sm text-gray-500">
                                    {item.code && <span className="mr-2">{item.code}</span>}
                                    {item.floor && <span>Étage {item.floor}</span>}
                                    {item.location && <span> • {item.location}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {item.has_photo && <Image size={16} className="text-gray-400" />}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigateToMap(item);
                                  }}
                                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-violet-600"
                                >
                                  <MapPin size={16} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteItem(item);
                                  }}
                                  className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-1">
            {selectedItem ? (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden sticky top-32">
                {/* Photo */}
                {selectedItem.has_photo ? (
                  <div
                    className="h-48 bg-gray-100 cursor-pointer"
                    onClick={() => setLightboxSrc(api.customModules.photoUrl(slug, selectedItem.id))}
                  >
                    <img
                      src={api.customModules.photoUrl(slug, selectedItem.id)}
                      alt={selectedItem.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <label className="h-32 bg-gray-100 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors">
                    <Upload size={24} className="text-gray-400 mb-2" />
                    <span className="text-sm text-gray-500">Ajouter une photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])}
                    />
                  </label>
                )}

                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">{selectedItem.name}</h3>
                    <button
                      onClick={() => {
                        setFormData({
                          name: selectedItem.name,
                          code: selectedItem.code,
                          description: selectedItem.description,
                          building: selectedItem.building,
                          floor: selectedItem.floor,
                          location: selectedItem.location,
                          category_id: selectedItem.category_id,
                          status: selectedItem.status
                        });
                        setShowEditModal(true);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                    >
                      <Edit2 size={18} />
                    </button>
                  </div>

                  {selectedItem.code && (
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Code:</span> {selectedItem.code}
                    </div>
                  )}

                  {selectedItem.description && (
                    <p className="text-sm text-gray-600">{selectedItem.description}</p>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Bâtiment</span>
                      <p className="font-medium">{selectedItem.building || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Étage</span>
                      <p className="font-medium">{selectedItem.floor || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Local</span>
                      <p className="font-medium">{selectedItem.location || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Statut</span>
                      <p className="font-medium">{selectedItem.status || "active"}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => navigateToMap(selectedItem)}
                    className="w-full py-2 rounded-xl text-white font-medium flex items-center justify-center gap-2"
                    style={{ backgroundColor: module.color }}
                  >
                    <MapPin size={18} />
                    Voir sur la carte
                  </button>

                  {/* MiniElectro AI */}
                  <div className="pt-4 border-t">
                    <MiniElectro
                      equipment={{ id: selectedItem.id, name: selectedItem.name, ...selectedItem }}
                      equipmentType="custom"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-8 text-center">
                <Box className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Sélectionnez un élément pour voir les détails</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || showEditModal) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {showEditModal ? "Modifier" : "Nouvel élément"}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setShowEditModal(false);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                  <input
                    type="text"
                    value={formData.name || ""}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    placeholder="Nom de l'élément"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                  <input
                    type="text"
                    value={formData.code || ""}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    placeholder="Code unique"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                  <select
                    value={formData.category_id || ""}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value || null })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">Sans catégorie</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    rows={3}
                    placeholder="Description..."
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bâtiment</label>
                    <input
                      type="text"
                      value={formData.building || ""}
                      onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                      className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                      placeholder="Ex: A1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Étage</label>
                    <input
                      type="text"
                      value={formData.floor || ""}
                      onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                      className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                      placeholder="Ex: 0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local</label>
                    <input
                      type="text"
                      value={formData.location || ""}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                      placeholder="Ex: B102"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setShowEditModal(false);
                    }}
                    className="flex-1 py-2 border rounded-xl font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={showEditModal ? handleUpdateItem : handleCreateItem}
                    disabled={saving || !formData.name?.trim()}
                    className="flex-1 py-2 rounded-xl text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: module.color }}
                  >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {showEditModal ? "Enregistrer" : "Créer"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Nouvelle catégorie</h2>
                <button onClick={() => setShowCategoryModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                  <input
                    type="text"
                    value={categoryFormData.name || ""}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-violet-500"
                    placeholder="Nom de la catégorie"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Couleur</label>
                  <input
                    type="color"
                    value={categoryFormData.color || "#6366f1"}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, color: e.target.value })}
                    className="w-full h-10 rounded-xl cursor-pointer"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowCategoryModal(false)}
                    className="flex-1 py-2 border rounded-xl font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleCreateCategory}
                    disabled={saving || !categoryFormData.name?.trim()}
                    className="flex-1 py-2 rounded-xl text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: module.color }}
                  >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    Créer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
