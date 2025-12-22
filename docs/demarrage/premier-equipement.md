# Créer votre premier équipement

Ce guide vous accompagne dans la création de votre premier équipement dans ElectroHub.

---

## Choisir le bon module

Avant de créer un équipement, identifiez le module approprié :

| Type d'équipement | Module à utiliser |
|-------------------|-------------------|
| Armoire électrique, tableau de distribution | **Tableaux électriques** |
| Cellule HT, transformateur | **Haute Tension** |
| Variateur de fréquence | **Variateurs (VSD)** |
| Pompe, ventilateur, moteur | **Équipements mécaniques** |
| Équipement en zone ATEX | **ATEX** |
| Porte coupe-feu | **Portes coupe-feu** |
| Onduleur, batterie de compensation | **Équipements globaux** |
| Perceuse, meuleuse | **Équipements mobiles** |

> Pour cet exemple, nous utiliserons le module **Tableaux électriques**, mais la procédure est similaire pour les autres modules.

---

## Étape 1 : Accéder au module

1. Depuis le **tableau de bord**, dépliez la section **Contrôles Électriques**
2. Cliquez sur la carte **Tableaux électriques**

![Accès au module Tableaux](../assets/screenshots/access-switchboards.png)
<!-- Capture d'écran recommandée : La carte Tableaux électriques sur le tableau de bord -->

---

## Étape 2 : Ouvrir le formulaire de création

1. Sur la page du module, repérez le bouton **+ Nouveau** ou **Ajouter**
2. Cliquez sur ce bouton

![Bouton Nouveau](../assets/screenshots/button-new-equipment.png)
<!-- Capture d'écran recommandée : Le bouton d'ajout d'équipement -->

Un panneau ou une fenêtre de création s'ouvre.

---

## Étape 3 : Remplir les informations de base

![Formulaire de création](../assets/screenshots/create-equipment-form.png)
<!-- Capture d'écran recommandée : Le formulaire de création d'équipement -->

### Informations obligatoires

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Nom / TAG** | Identifiant unique de l'équipement | `TGBT-BAT-A-01` |
| **Bâtiment** | Localisation géographique | `Bâtiment A` |

### Informations recommandées

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Zone / Étage** | Précision de localisation | `RDC` |
| **Local** | Pièce ou emplacement exact | `Local technique` |
| **Description** | Détails supplémentaires | `Tableau général basse tension` |

### Informations techniques (selon le module)

Les champs varient selon le type d'équipement :

- **Tableaux** : Tension, intensité nominale, type de régime de neutre
- **VSD** : Puissance, tension d'entrée/sortie, marque
- **ATEX** : Mode de protection, groupe de gaz, classe de température

---

## Étape 4 : Définir les contrôles

![Section contrôles](../assets/screenshots/create-equipment-controls.png)
<!-- Capture d'écran recommandée : La section des contrôles périodiques -->

### Périodicité des contrôles

Définissez la fréquence des vérifications :

| Périodicité | Usage typique |
|-------------|---------------|
| **Mensuel** | Inspections visuelles |
| **Trimestriel** | Contrôles fonctionnels |
| **Semestriel** | Vérifications intermédiaires |
| **Annuel** | Contrôles réglementaires |
| **5 ans** | Vérifications approfondies |

### Date du dernier contrôle

Si l'équipement a déjà été contrôlé, indiquez la date du dernier contrôle. Le système calculera automatiquement la prochaine échéance.

### Prochain contrôle

La date est calculée automatiquement, mais vous pouvez la modifier manuellement si nécessaire.

---

## Étape 5 : Ajouter des documents (optionnel)

![Section documents](../assets/screenshots/create-equipment-files.png)
<!-- Capture d'écran recommandée : La zone d'upload de fichiers -->

Vous pouvez associer des documents à l'équipement :

1. Cliquez sur la zone d'upload ou le bouton **Ajouter un fichier**
2. Sélectionnez le fichier sur votre ordinateur
3. Le fichier est téléchargé et associé à l'équipement

### Types de fichiers acceptés

- **Images** : PNG, JPG, JPEG
- **Documents** : PDF
- **Schémas** : Plans électriques en PDF

> **Astuce** : Vous pouvez ajouter des documents plus tard, après la création de l'équipement.

---

## Étape 6 : Enregistrer l'équipement

1. Vérifiez les informations saisies
2. Cliquez sur le bouton **Enregistrer** ou **Créer**

![Bouton Enregistrer](../assets/screenshots/save-equipment-button.png)
<!-- Capture d'écran recommandée : Le bouton d'enregistrement -->

### Confirmation

Un message confirme la création :

> ✅ "Équipement créé avec succès"

L'équipement apparaît maintenant dans la liste.

---

## Étape 7 : Vérifier la création

Après la création :

1. L'équipement apparaît dans la **liste des équipements**
2. Vous pouvez le rechercher par son nom
3. Cliquez dessus pour voir ses détails

![Équipement dans la liste](../assets/screenshots/equipment-in-list.png)
<!-- Capture d'écran recommandée : L'équipement nouvellement créé dans la liste -->

---

## Fiche de l'équipement

La fiche de l'équipement présente toutes les informations :

![Fiche équipement](../assets/screenshots/equipment-detail.png)
<!-- Capture d'écran recommandée : La fiche détaillée d'un équipement -->

### Sections de la fiche

| Section | Contenu |
|---------|---------|
| **En-tête** | Nom, statut, badges |
| **Informations générales** | Localisation, caractéristiques |
| **Contrôles** | Historique et prochaines échéances |
| **Documents** | Fichiers associés |
| **Historique** | Modifications et actions |

### Actions disponibles

- **Modifier** : Éditer les informations
- **Dupliquer** : Créer une copie
- **Supprimer** : Supprimer l'équipement
- **Ajouter un contrôle** : Enregistrer un nouveau contrôle

---

## Positionner sur la carte

Pour localiser visuellement votre équipement :

1. Cliquez sur l'onglet **Carte** ou **Plans**
2. Sélectionnez le plan correspondant au bâtiment
3. Cliquez sur **Placer l'équipement**
4. Cliquez sur l'emplacement souhaité sur le plan

> Voir [Cartographie interactive](../fonctionnalites-communes/cartographie.md) pour plus de détails.

---

## Bonnes pratiques

### Nommage des équipements

Adoptez une convention de nommage cohérente :

```
[TYPE]-[BATIMENT]-[ETAGE]-[NUMERO]
```

Exemples :
- `TGBT-A-RDC-01` : Tableau général BT, Bâtiment A, RDC, n°1
- `VSD-B-N1-03` : Variateur, Bâtiment B, Niveau 1, n°3
- `MOT-C-SS-12` : Moteur, Bâtiment C, Sous-sol, n°12

### Complétude des informations

- Remplissez le maximum de champs
- Ajoutez des photos de l'équipement
- Attachez les documents pertinents (schémas, notices)

### Cohérence des localisations

- Utilisez les mêmes noms de bâtiments/zones
- Respectez la nomenclature de votre site

---

## Erreurs courantes

### "Le nom existe déjà"

Chaque équipement doit avoir un nom unique. Modifiez le nom proposé.

### Champs obligatoires manquants

Remplissez tous les champs marqués d'un astérisque (*).

### Fichier trop volumineux

Réduisez la taille des images ou documents avant upload (limite généralement à 10 Mo).

---

## Prochaines étapes

- [Effectuer un contrôle](../fonctionnalites-communes/controles.md) : Enregistrer votre premier contrôle
- [Positionner sur la carte](../fonctionnalites-communes/cartographie.md) : Localiser l'équipement
- [Explorer le module](../modules/tableaux-electriques.md) : Découvrir toutes les fonctionnalités
