# Cartographie interactive

La cartographie permet de visualiser et positionner vos équipements sur des plans.

---

## Présentation

![Vue cartographie](../assets/screenshots/map-overview.png)
<!-- Capture d'écran recommandée : Vue carte avec équipements positionnés -->

La fonctionnalité de cartographie est disponible dans plusieurs modules :

- ATEX
- Tableaux électriques
- Variateurs (VSD)
- Équipements mécaniques
- Portes coupe-feu
- Équipements globaux
- Haute Tension
- Datahub

Elle permet de :

- **Visualiser** l'emplacement des équipements
- **Naviguer** rapidement vers un équipement
- **Identifier** les zones et bâtiments
- **Filtrer** par type ou statut

---

## Accéder à la carte

### Depuis un module

1. Ouvrez le module concerné (ex: ATEX, VSD...)
2. Cliquez sur l'onglet **Carte** ou **Plans**

### Depuis un équipement

1. Ouvrez la fiche de l'équipement
2. Cliquez sur **Voir sur la carte**

---

## Interface de la carte

### Composants

![Interface carte](../assets/screenshots/map-interface.png)
<!-- Capture d'écran recommandée : Interface complète avec annotations -->

| Zone | Description |
|------|-------------|
| **Sélecteur de plan** | Choisir le plan à afficher |
| **Zone de carte** | Affichage du plan avec marqueurs |
| **Légende** | Signification des couleurs |
| **Outils** | Zoom, filtre, plein écran |
| **Liste** | Équipements du plan actuel |

### Outils de navigation

| Outil | Fonction |
|-------|----------|
| **Zoom +/-** | Agrandir / Réduire |
| **Molette souris** | Zoom rapide |
| **Glisser** | Déplacer la vue |
| **Double-clic** | Centrer sur un point |
| **Plein écran** | Mode immersif |

---

## Gestion des plans

### Importer un plan

1. Onglet **Plans** → **Ajouter un plan**
2. Sélectionnez le fichier (PDF ou image)
3. Renseignez les informations :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom du plan |
| **Bâtiment** | Bâtiment concerné |
| **Étage** | Niveau du plan |
| **Description** | Notes optionnelles |

4. Validez l'import

### Formats acceptés

| Format | Extension | Notes |
|--------|-----------|-------|
| PDF | .pdf | Première page utilisée |
| PNG | .png | Recommandé |
| JPEG | .jpg, .jpeg | Acceptable |

### Organiser les plans

Les plans sont organisés par :
- Bâtiment
- Étage / Niveau

Naviguez dans l'arborescence pour trouver le bon plan.

### Supprimer un plan

1. Sélectionnez le plan
2. Menu **⋮** → **Supprimer**
3. Confirmez (les positions des équipements seront perdues)

---

## Marqueurs d'équipement

### Apparence

Les marqueurs représentent les équipements sur le plan :

| Élément | Signification |
|---------|---------------|
| **Forme** | Type d'équipement |
| **Couleur** | Statut (conforme, alerte, retard) |
| **Taille** | Peut varier selon le zoom |
| **Icône** | Symbole du type |

### Code couleur standard

| Couleur | Statut |
|---------|--------|
| 🟢 **Vert** | Conforme, contrôle OK |
| 🟠 **Orange** | Contrôle à venir (< 30j) |
| 🔴 **Rouge** | En retard, non conforme |
| 🔵 **Bleu** | Sélectionné |
| ⚫ **Gris** | Statut inconnu |

### Interaction avec les marqueurs

| Action | Résultat |
|--------|----------|
| **Survol** | Affiche une info-bulle |
| **Clic** | Sélectionne et affiche les détails |
| **Double-clic** | Ouvre la fiche complète |

---

## Positionner un équipement

### Méthode 1 : Depuis la carte

1. Affichez le plan concerné
2. Cliquez sur **Mode positionnement** ou **Placer**
3. Sélectionnez l'équipement dans la liste
4. Cliquez sur l'emplacement souhaité
5. Le marqueur apparaît

### Méthode 2 : Depuis la fiche

1. Ouvrez la fiche de l'équipement
2. Section **Localisation** → **Positionner sur carte**
3. Sélectionnez le plan
4. Cliquez sur l'emplacement
5. Enregistrez

### Déplacer un marqueur

1. Cliquez sur le marqueur pour le sélectionner
2. Glissez-le vers le nouvel emplacement
3. Relâchez
4. Confirmez le déplacement

### Supprimer une position

1. Sélectionnez le marqueur
2. Cliquez sur **Supprimer la position** ou icône 🗑️
3. L'équipement reste dans la base mais n'apparaît plus sur la carte

---

## Filtrer les équipements

### Filtres disponibles

| Filtre | Options |
|--------|---------|
| **Type** | Par catégorie d'équipement |
| **Statut** | Conforme, En retard, etc. |
| **Zone** | Par zone du bâtiment |
| **Recherche** | Par nom ou TAG |

### Appliquer un filtre

1. Cliquez sur l'icône de filtre 🔍
2. Sélectionnez les critères
3. La carte affiche uniquement les équipements correspondants

### Réinitialiser

Cliquez sur **Effacer les filtres** pour tout afficher.

---

## Info-bulles et détails

### Info-bulle au survol

Au survol d'un marqueur :

```
┌─────────────────────────┐
│ 🔧 VSD-A-PROD-01        │
│ Variateur pompe P-101   │
│ ────────────────────    │
│ Statut: ✅ Conforme     │
│ Prochain contrôle: 15/04│
└─────────────────────────┘
```

### Panneau de détails

Au clic sur un marqueur, le panneau latéral affiche :

- Informations principales
- Statut et alertes
- Actions rapides (voir fiche, contrôle rapide)
- Historique récent

---

## Mesures et distances

### Outil de mesure

Certains modules proposent un outil de mesure :

1. Activez l'outil **Mesurer**
2. Cliquez sur le point de départ
3. Cliquez sur le point d'arrivée
4. La distance s'affiche

> Note : Nécessite un plan calibré (échelle définie).

### Calibration du plan

1. Menu du plan → **Calibrer**
2. Tracez une distance connue sur le plan
3. Indiquez la distance réelle
4. Le plan est calibré

---

## Export de la carte

### Capture d'écran

1. Affichez la vue souhaitée
2. Cliquez sur **Exporter** ou **Télécharger**
3. Format PNG ou PDF

### Inclure dans un rapport

Les exports PDF des équipements peuvent inclure leur position sur carte.

---

## Bonnes pratiques

### Plans

- Utilisez des plans à jour
- Préférez le format PNG haute résolution
- Nommez clairement (Bâtiment A - RDC)
- Organisez par bâtiment et étage

### Positionnement

- Positionnez systématiquement les équipements
- Vérifiez la précision des positions
- Mettez à jour après déplacement d'équipement

### Visualisation

- Utilisez les filtres pour clarifier
- Zoomez pour les zones denses
- Profitez du mode plein écran

---

## Dépannage

### Le plan ne s'affiche pas

- Vérifiez le format du fichier
- Réduisez la taille si > 10 Mo
- Essayez un autre navigateur

### Les marqueurs sont mal placés

- Le plan a peut-être été remplacé
- Repositionnez les équipements concernés

### Performance lente

- Réduisez le nombre de marqueurs affichés (filtres)
- Utilisez un plan de résolution moindre
- Fermez les autres onglets

---

## FAQ

### Puis-je avoir plusieurs plans pour un même bâtiment ?

Oui, par exemple un plan par étage.

### Les positions sont-elles partagées entre utilisateurs ?

Oui, les positions sont enregistrées dans la base et visibles par tous.

### Puis-je importer des plans CAO (DWG) ?

Non directement. Exportez d'abord en PDF ou PNG.

---

## Voir aussi

- [Gestion des fichiers](./fichiers.md)
- [Export PDF et Excel](./exports.md)
