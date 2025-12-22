# Tableaux électriques

Le module **Tableaux électriques** permet de gérer l'ensemble des armoires et tableaux de distribution électrique de votre installation.

---

## Présentation

![Vue d'ensemble Tableaux](../assets/screenshots/switchboards-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Tableaux avec la liste -->

Les tableaux électriques sont les points centraux de distribution de l'énergie électrique. Ce module vous permet de :

- **Inventorier** tous vos tableaux (TGBT, TD, coffrets...)
- **Documenter** les caractéristiques techniques
- **Planifier** les contrôles périodiques
- **Suivre** la conformité et les interventions
- **Visualiser** l'emplacement sur plans

---

## Accéder au module

1. Depuis le tableau de bord, dépliez **Contrôles Électriques**
2. Cliquez sur **Tableaux électriques**

---

## Interface du module

### Onglets disponibles

| Onglet | Description |
|--------|-------------|
| **Tableau de bord** | Vue synthétique avec statistiques |
| **Liste** | Liste complète des tableaux |
| **Carte** | Visualisation sur plans |
| **Calendrier** | Planning des contrôles |
| **Analyse** | Graphiques et statistiques |

### Barre d'outils

![Barre d'outils](../assets/screenshots/switchboards-toolbar.png)
<!-- Capture d'écran recommandée : La barre de recherche et filtres -->

- **Recherche** : Filtrer par nom, TAG ou localisation
- **Filtres** : Par bâtiment, statut, conformité
- **+ Nouveau** : Créer un nouveau tableau

---

## Tableau de bord du module

![Dashboard Tableaux](../assets/screenshots/switchboards-dashboard.png)
<!-- Capture d'écran recommandée : Le tableau de bord avec les cartes statistiques -->

Le tableau de bord présente :

### Statistiques générales

| Indicateur | Description |
|------------|-------------|
| **Total** | Nombre total de tableaux |
| **Conformes** | Tableaux sans anomalie |
| **Non conformes** | Tableaux avec écarts |
| **En retard** | Contrôles à effectuer |

### Alertes

- Tableaux avec contrôles en retard (clignotant rouge)
- Tableaux à contrôler dans les 30 jours (orange)

### Actions rapides

- Accès direct aux tableaux prioritaires
- Export des données

---

## Liste des tableaux

![Liste des tableaux](../assets/screenshots/switchboards-list.png)
<!-- Capture d'écran recommandée : La liste des tableaux avec les colonnes -->

### Colonnes affichées

| Colonne | Description |
|---------|-------------|
| **Nom / TAG** | Identifiant du tableau |
| **Bâtiment** | Localisation |
| **Étage / Zone** | Précision localisation |
| **Statut** | À faire, Sous 30j, En retard |
| **Prochain contrôle** | Date prévue |
| **Actions** | Voir, Modifier, Supprimer |

### Tri et filtrage

- Cliquez sur l'en-tête d'une colonne pour trier
- Utilisez les filtres pour affiner la liste

### Actions sur un tableau

Cliquez sur les trois points (**⋮**) ou le menu d'actions :

| Action | Description |
|--------|-------------|
| **Voir** | Ouvrir la fiche détaillée |
| **Modifier** | Éditer les informations |
| **Dupliquer** | Créer une copie |
| **Supprimer** | Supprimer le tableau |

---

## Créer un tableau

### Étape 1 : Cliquer sur "+ Nouveau"

Le formulaire de création s'ouvre.

### Étape 2 : Remplir les informations

![Formulaire création](../assets/screenshots/switchboard-create-form.png)
<!-- Capture d'écran recommandée : Le formulaire de création complet -->

#### Informations générales

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Nom / TAG** | ✅ | Identifiant unique (ex: TGBT-A-01) |
| **Description** | | Détails complémentaires |
| **Bâtiment** | ✅ | Localisation principale |
| **Étage / Zone** | | Précision de localisation |
| **Local** | | Pièce exacte |

#### Caractéristiques techniques

| Champ | Description |
|-------|-------------|
| **Tension nominale** | 230V, 400V, etc. |
| **Intensité nominale** | Courant max (A) |
| **Régime de neutre** | TT, TN-S, TN-C, IT |
| **Marque / Fabricant** | Constructeur |
| **Année d'installation** | Date de mise en service |

#### Contrôles

| Champ | Description |
|-------|-------------|
| **Périodicité** | Fréquence des contrôles |
| **Dernier contrôle** | Date du dernier contrôle |
| **Prochain contrôle** | Calculé automatiquement |

### Étape 3 : Enregistrer

Cliquez sur **Enregistrer** pour créer le tableau.

---

## Fiche détaillée

![Fiche tableau](../assets/screenshots/switchboard-detail.png)
<!-- Capture d'écran recommandée : La fiche détaillée d'un tableau -->

La fiche d'un tableau présente :

### En-tête

- Nom et TAG
- Badges de statut (conforme/non conforme, contrôle)
- Dernière modification

### Section Informations

- Localisation complète
- Caractéristiques techniques
- Notes et observations

### Section Contrôles

- Historique des contrôles effectués
- Prochain contrôle prévu
- Bouton "Ajouter un contrôle"

### Section Documents

- Plans et schémas
- Photos
- Rapports de contrôle
- Bouton "Ajouter un fichier"

### Section Historique

- Journal des modifications
- Qui a fait quoi et quand

---

## Effectuer un contrôle

### Méthode 1 : Depuis la fiche

1. Ouvrez la fiche du tableau
2. Cliquez sur **Ajouter un contrôle**
3. Remplissez le formulaire

### Méthode 2 : Contrôle rapide

1. Dans la liste, cliquez sur l'icône de contrôle rapide (**✓**)
2. Confirmez le contrôle

### Formulaire de contrôle

![Formulaire contrôle](../assets/screenshots/switchboard-check-form.png)
<!-- Capture d'écran recommandée : Le formulaire d'enregistrement de contrôle -->

| Champ | Description |
|-------|-------------|
| **Date du contrôle** | Quand le contrôle a été fait |
| **Type de contrôle** | Visuel, Fonctionnel, Réglementaire |
| **Résultat** | Conforme / Non conforme |
| **Observations** | Remarques et constats |
| **Photos** | Documentation visuelle |
| **Prochain contrôle** | Prochaine échéance |

---

## Gestion des appareillages

Chaque tableau peut contenir plusieurs appareillages :

### Types d'appareillages

- Disjoncteurs
- Contacteurs
- Relais de protection
- Fusibles
- Appareils de mesure

### Ajouter un appareillage

1. Ouvrez la fiche du tableau
2. Section **Appareillages**, cliquez sur **Ajouter**
3. Remplissez les caractéristiques

### Informations d'un appareillage

| Champ | Description |
|-------|-------------|
| **Repère** | Identification dans le tableau |
| **Type** | Disjoncteur, contacteur, etc. |
| **Marque** | Fabricant |
| **Calibre** | Caractéristique électrique |
| **Circuit alimenté** | Destination |

---

## Vue cartographique

![Carte tableaux](../assets/screenshots/switchboards-map.png)
<!-- Capture d'écran recommandée : La vue carte avec les tableaux positionnés -->

L'onglet **Carte** permet de :

### Visualiser les tableaux

- Marqueurs sur les plans de bâtiments
- Code couleur selon le statut
- Info-bulles au survol

### Positionner un tableau

1. Sélectionnez le plan du bâtiment
2. Cliquez sur **Positionner**
3. Cliquez sur l'emplacement du tableau

> Voir [Cartographie interactive](../fonctionnalites-communes/cartographie.md)

---

## Diagramme unifilaire

![Diagramme unifilaire](../assets/screenshots/switchboard-diagram.png)
<!-- Capture d'écran recommandée : Le schéma unifilaire d'un tableau -->

ElectroHub peut générer un schéma unifilaire simplifié :

1. Ouvrez la fiche du tableau
2. Cliquez sur **Voir le schéma** ou l'onglet **Diagramme**
3. Le schéma s'affiche avec les départs

### Éléments du diagramme

- Arrivée principale
- Appareillage de tête
- Départs (avec repères et calibres)
- Liaisons

---

## Export et rapports

### Export Excel

1. Dans la liste, cliquez sur **Exporter**
2. Choisissez le format Excel
3. Le fichier est téléchargé

### Export PDF

1. Ouvrez la fiche d'un tableau
2. Cliquez sur **Exporter PDF**
3. Le rapport est généré

### Contenu du rapport

- Informations générales
- Caractéristiques techniques
- Historique des contrôles
- Photos et documents

---

## Bonnes pratiques

### Nommage

Adoptez une convention claire :
```
[TYPE]-[BATIMENT]-[NIVEAU]-[NUMERO]
```

Exemples :
- `TGBT-A-RDC-01` : Tableau Général BT
- `TD-B-N1-03` : Tableau Divisionnaire
- `COFFRET-C-EXT-01` : Coffret extérieur

### Documentation

- Attachez toujours le schéma unifilaire
- Photographiez le tableau (porte ouverte/fermée)
- Scannez les étiquettes et plaques signalétiques

### Contrôles

- Respectez la périodicité définie
- Documentez systématiquement les anomalies
- Planifiez les actions correctives

---

## FAQ du module

### Comment retrouver un tableau rapidement ?

Utilisez la barre de recherche avec le TAG ou le nom.

### Comment voir les tableaux en retard de contrôle ?

Filtrez par statut "En retard" ou regardez les badges sur le tableau de bord.

### Comment dupliquer un tableau ?

Ouvrez le menu actions (**⋮**) et sélectionnez **Dupliquer**.

---

## Voir aussi

- [Haute Tension](./haute-tension.md)
- [Cartographie](../fonctionnalites-communes/cartographie.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
