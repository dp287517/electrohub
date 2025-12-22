# Datahub

Le module **Datahub** permet de gérer des données personnalisées avec visualisation sur plans.

---

## Présentation

![Vue Datahub](../assets/screenshots/datahub-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Datahub -->

Le Datahub est un module flexible pour gérer des données qui ne rentrent pas dans les autres catégories :

- **Points de mesure** personnalisés
- **Données environnementales**
- **Marqueurs** sur plans
- **Informations** spécifiques au site

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Datahub**

---

## Fonctionnalités

### Données personnalisables

Créez vos propres catégories de données :

| Exemple | Usage |
|---------|-------|
| Points de mesure | Capteurs, sondes |
| Vannes | Équipements process |
| Extincteurs | Sécurité incendie |
| Accès | Points d'entrée |
| Custom | Tout autre besoin |

### Visualisation sur carte

Positionnez vos données sur les plans :
- Marqueurs colorés par catégorie
- Info-bulles avec détails
- Filtrage par type

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Liste** | Inventaire des données |
| **Carte** | Visualisation sur plans |
| **Catégories** | Gestion des types |

### Vue liste

Colonnes personnalisables selon vos besoins.

### Vue carte

![Carte Datahub](../assets/screenshots/datahub-map.png)
<!-- Capture d'écran recommandée : Vue carte avec marqueurs personnalisés -->

---

## Créer une catégorie

### Configuration

1. Onglet **Catégories** → **+ Nouvelle catégorie**
2. Définissez :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom de la catégorie |
| **Icône** | Symbole pour les marqueurs |
| **Couleur** | Couleur des marqueurs |
| **Champs** | Attributs personnalisés |

### Champs personnalisés

Ajoutez les champs nécessaires :

| Type | Usage |
|------|-------|
| Texte | Descriptions, références |
| Nombre | Valeurs numériques |
| Date | Dates, échéances |
| Liste | Choix prédéfinis |
| Booléen | Oui/Non |

---

## Ajouter des données

### Formulaire

1. **+ Nouveau** dans la liste
2. Sélectionnez la catégorie
3. Remplissez les champs
4. Optionnel : Positionnez sur la carte

### Exemple

Pour un point de mesure :

| Champ | Valeur |
|-------|--------|
| Référence | PM-A-001 |
| Type | Température |
| Unité | °C |
| Plage | 0 - 100 |
| Localisation | Bâtiment A, Local technique |

---

## Positionner sur la carte

### Procédure

1. Ouvrez la fiche de l'élément
2. Cliquez sur **Positionner sur carte**
3. Sélectionnez le plan
4. Cliquez à l'emplacement souhaité
5. Enregistrez

### Légende

Les marqueurs utilisent les couleurs définies par catégorie.

---

## Import / Export

### Import de données

Importez des données depuis un fichier :
1. Préparez un fichier Excel/CSV
2. **Importer** → Sélectionnez le fichier
3. Mappez les colonnes
4. Validez l'import

### Export

Exportez vos données :
- Format Excel
- Format CSV
- Format PDF (avec carte)

---

## Cas d'usage

### Inventaire d'extincteurs

| Champ | Type |
|-------|------|
| Référence | Texte |
| Type | Liste (Eau, CO2, Poudre) |
| Capacité | Nombre (kg/L) |
| Date vérification | Date |
| Conforme | Booléen |

### Points de mesure process

| Champ | Type |
|-------|------|
| TAG | Texte |
| Grandeur | Liste (T, P, Débit...) |
| Unité | Texte |
| Min/Max | Nombre |
| Seuils alarme | Nombre |

### Vannes manuelles

| Champ | Type |
|-------|------|
| Repère | Texte |
| Type | Liste (Vanne, Robinet, Clapet) |
| DN | Nombre |
| Position normale | Liste (Ouverte, Fermée) |
| Fonction | Texte |

---

## Bonnes pratiques

### Organisation

- Définissez des catégories claires
- Utilisez des codes couleur cohérents
- Nommez de façon explicite

### Données

- Renseignez tous les champs utiles
- Mettez à jour régulièrement
- Vérifiez la cohérence

### Cartographie

- Positionnez systématiquement sur les plans
- Vérifiez la précision des emplacements
- Utilisez des plans à jour

---

## FAQ

### Comment ajouter un nouveau champ à une catégorie existante ?

Allez dans Catégories, modifiez la catégorie, ajoutez le champ.

### Les données existantes perdent-elles le nouveau champ ?

Non, le champ sera simplement vide pour les éléments existants.

### Peut-on lier des données Datahub à d'autres modules ?

Non directement, mais vous pouvez noter les références croisées.

---

## Voir aussi

- [Cartographie](../fonctionnalites-communes/cartographie.md)
- [Export](../fonctionnalites-communes/exports.md)
