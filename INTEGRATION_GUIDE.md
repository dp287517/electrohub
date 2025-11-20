# Guide d'Intégration d'une Nouvelle Catégorie d'Équipement

Ce document est le guide de référence pour ajouter un nouveau type d'équipement (ex: UPS, Génératrice, Transformateur) à la plateforme Electrohub. Il garantit que toutes les couches de l'application (Base de données, Backend, TSD, Frontend) sont correctement mises à jour.

## 🎯 Aperçu des Fichiers à Modifier

| Fichier | Section | Rôle |
| :--- | :--- | :--- |
| **SQL** | `CREATE TABLE` | Stockage des équipements |
| **`tsd_library.js`** | `categories` | Définition des contrôles et fréquences |
| **`server_controls.js`** | 4 fonctions/routes | Logique d'accès et construction de l'arbre |
| **`Controls.jsx`** | `EQUIPMENT_TYPES` & `HierarchyTree` | Affichage des filtres et de l'arborescence |

---

## Étape 1 : Base de Données (SQL) 🐘

Créez la table pour stocker les équipements.

### 1.1 Création de la table

Exécutez cette requête (ou une similaire) dans votre console ou outil SQL.

```sql
CREATE TABLE ups_equipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    building VARCHAR(50),
    zone VARCHAR(100),
    equipment VARCHAR(255),
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    power_kva NUMERIC,
    install_date DATE,
    photo_path TEXT,
    status VARCHAR(50) DEFAULT 'a_faire'
);

Étape 2 : Définition des Contrôles (tsd_library.js) 📚
Modifiez le tableau tsdLibrary.categories dans tsd_library.js pour ajouter votre nouvelle catégorie.

2.1 Ajout du bloc de catégorie
key : L'identifiant interne de la catégorie (ex: "ups").

db_table : Le nom de la table SQL créée à l'Étape 1 (ex: "ups_equipments").

// Dans tsd_library.js, dans le tableau 'categories'

{
  "key": "ups", // <-- IDENTIFIANT CLE (utilisé dans tout le code)
  "label": "UPS (Uninterruptible Power Supply)",
  "db_table": "ups_equipments", // <-- NOM DE LA TABLE SQL
  "fallback_note_if_missing": "Aucun UPS trouvé.",
  "controls": [
    {
      "type": "Battery Check",
      "frequency": { "interval": 12, "unit": "months" },
      "checklist": [
        "Vérifier les voyants et les alarmes",
        "Nettoyer les ventilations et filtres",
        "Vérifier les connexions des batteries"
      ]
    },
    {
      "type": "Test de décharge",
      "frequency": { "interval": 36, "unit": "months" },
      "checklist": [
        "Effectuer un test de décharge avec charge réelle ou simulée",
        "Vérifier l'autonomie conforme aux spécifications"
      ]
    }
  ]
},
// ... autres catégories

Étape 3 : Backend (server_controls.js) ⚙️
Effectuez 4 modifications obligatoires dans server_controls.js pour intégrer la nouvelle logique.

3.1 Mapping Table (Ligne ~100)

function tableFromEntityType(type) {
  if (type === "switchboard") return "switchboards";
  if (type === "vsd") return "vsd_equipments";
  if (type === "ups") return "ups_equipments"; // <--- AJOUT
  return null;
}

3.2 Autorisation (Ligne ~550)

function isControlAllowedForEntity(cat, ent) {
  // ...
  if (cat.key === "ups") {
    return true; // <--- AJOUT
  }
  // ...
}

3.3 Forçage Tâches (Ligne ~1340)

const forceFullControls =
  cat.key === "lv_switchgear" ||
  cat.key === "lv_switchgear_devices" ||
  cat.key === "distribution_boards" ||
  cat.key === "vsd" ||
  cat.key === "ups"; // <--- AJOUT

3.4 Construction de l'Arbre (Route /hierarchy/tree - Ligne ~900)
Insérez le bloc de lecture pour les UPS dans la boucle for (const bRow of buildingRows) :

// ... après le bloc VSD

      // ---------- UPS ----------
      let upsRows = [];
      try {
        const { rows } = await client.query(
          `SELECT * FROM ups_equipments WHERE building = $1`, // <--- VOTRE TABLE SQL
          [bRow.code]
        );
        upsRows = rows || [];
      } catch (e) { 
        console.error("[Controls] hierarchy/tree UPS query error:", e.message || e);
        upsRows = [];
      }

      // Initialisation du tableau dans l'objet bâtiment
      building.ups = []; 

      for (const u of upsRows) {
        // ... (Vérification position et plan, similaire au VSD)
        
        // Tâches UPS
        const { rows: upsTasksRaw } = await client.query(
          `SELECT ct.*, EXISTS(SELECT 1 FROM controls_task_positions ctp WHERE ctp.task_id = ct.id) as positioned
           FROM controls_tasks ct
           WHERE ct.entity_id = $1 
             AND ct.entity_type = 'ups'`, // <--- VOTRE IDENTIFIANT CLE
          [u.id]
        );
        const upsTasks = filterTasks(upsTasksRaw);

        // Ajout à l'arborescence
        building.ups.push({
          id: u.id,
          label: u.name || u.equipment,
          positioned: posCheck[0]?.positioned || false,
          entity_type: "ups",
          building_code: bRow.code,
          tasks: upsTasks,
          ...(upsPlan || {}),
        });
      }
      
      // Mise à jour du Filtre final bâtiment
      if (
        building.hv.length > 0 ||
        building.switchboards.length > 0 ||
        building.vsds.length > 0 ||
        building.ups.length > 0 // <--- AJOUT
      ) {
        buildings.push(building);
      }

Étape 4 : Frontend (Controls.jsx) 💻
4.1 Mise à jour de la constante des Filtres
Ajoutez le type dans la constante EQUIPMENT_TYPES (vers le début de Controls.jsx).

const EQUIPMENT_TYPES = [
  { key: "all", label: "Vue d'ensemble", icon: null },
  { key: "hv", label: "Haute Tension", icon: "Zap" },
  { key: "switchboard", label: "Tableaux BT", icon: "Box" },
  { key: "vsd", label: "Variateurs (VSD)", icon: "Activity" },
  { key: "ups", label: "UPS / Onduleurs", icon: "Battery" }, // <--- AJOUT
];

4.2 Affichage dans l'Arbre (HierarchyTree)
Dans le composant HierarchyTree, ajoutez le bloc d'affichage des UPS :

// Dans Controls.jsx, dans le composant HierarchyTree, dans le renderBuildingItem (vers ligne 700)

{/* Section UPS */}
{building.ups && building.ups.length > 0 && (typeFilter === "all" || typeFilter === "ups") && (
  <div className="mb-2">
    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 pl-2">
      UPS / Onduleurs
    </div>
    {building.ups.map(ups => (
      <HierarchyItem 
        key={ups.id} 
        entity={ups} 
        icon={Battery} // (L'icône Battery doit être importée depuis 'lucide-react')
        // ... props standards
      />
    ))}
  </div>
)}

