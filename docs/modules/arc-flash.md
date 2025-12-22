# Arc Flash

Le module **Arc Flash** permet de documenter les analyses de risque d'arc électrique et de définir les équipements de protection individuelle (EPI) requis.

---

## Présentation

![Vue Arc Flash](../assets/screenshots/arcflash-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Arc Flash -->

L'arc électrique est un phénomène violent pouvant causer :

- **Brûlures graves** (thermiques)
- **Projection** de particules
- **Onde de pression** (blast)
- **Bruit intense** (> 140 dB)
- **Flash lumineux** (cécité temporaire)

Ce module permet de gérer ces risques.

---

## Qu'est-ce que l'Arc Flash ?

### Définition

Un arc électrique se produit lorsqu'un courant traverse l'air entre deux conducteurs. La température peut atteindre 20 000°C.

### Énergie incidente

L'**énergie incidente** (Incident Energy) est la quantité d'énergie thermique par unité de surface à une distance donnée.

**Unité** : cal/cm² ou J/cm²

### Catégories d'EPI (NFPA 70E)

| Catégorie | Énergie incidente | EPI requis |
|-----------|-------------------|------------|
| **1** | 4 - 8 cal/cm² | Vêtement FR simple couche |
| **2** | 8 - 25 cal/cm² | Vêtement FR + écran facial |
| **3** | 25 - 40 cal/cm² | Vêtement FR multicouche |
| **4** | > 40 cal/cm² | Combinaison complète |

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Arc Flash**

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue d'ensemble des risques |
| **Études** | Analyses Arc Flash |
| **Points** | Résultats par emplacement |
| **Étiquettes** | Gestion des étiquettes de danger |

---

## Créer une étude Arc Flash

### Informations générales

| Champ | Description |
|-------|-------------|
| **Titre** | Nom de l'étude |
| **Périmètre** | Installation analysée |
| **Date** | Date de l'étude |
| **Auteur** | Bureau d'études |
| **Norme** | IEEE 1584, NFPA 70E |

### Hypothèses

#### Données électriques

| Paramètre | Description |
|-----------|-------------|
| **Tension** | V |
| **Courant de défaut (Ibf)** | kA |
| **Temps d'élimination** | s |
| **Distance de travail** | cm |

#### Configuration

| Paramètre | Options |
|-----------|---------|
| **Type d'équipement** | Tableau, cellule, câble... |
| **Configuration** | Ouvert, fermé |
| **Espace d'arc** | mm |

---

## Calcul de l'énergie incidente

### Méthode IEEE 1584-2018

La norme IEEE 1584 définit les équations de calcul.

#### Étapes

1. **Courant d'arc (Iarc)** : Calculé à partir de Ibf
2. **Énergie normalisée (E_n)** : Pour arc de 0.2s à 610mm
3. **Énergie incidente (E)** : Ajustée pour t et D réels
4. **Frontière Arc Flash (AFB)** : Distance de sécurité

#### Formule simplifiée

```
E = E_n × (t/0.2) × (610/D)²
```

Où :
- E : Énergie incidente (cal/cm²)
- t : Temps d'arc (s)
- D : Distance de travail (mm)

---

## Résultats par point

### Tableau des résultats

| Point | Ibf (kA) | Iarc (kA) | t (s) | E (cal/cm²) | Cat. | AFB (m) |
|-------|----------|-----------|-------|-------------|------|---------|
| TGBT Principal | 42.5 | 38.2 | 0.15 | 12.8 | 2 | 1.2 |
| TD Atelier | 18.3 | 14.6 | 0.25 | 8.5 | 2 | 0.8 |
| TD Bureaux | 12.1 | 9.8 | 0.35 | 6.2 | 1 | 0.6 |

### Enregistrer un point

1. **+ Nouveau point**
2. Renseignez :
   - Identification (tableau, cellule)
   - Données d'entrée
   - Résultats calculés
   - Catégorie EPI
   - Frontière Arc Flash

---

## Étiquettes de danger

### Contenu réglementaire

Les étiquettes doivent indiquer :

- ⚠️ Danger Arc Flash
- Énergie incidente (cal/cm²)
- Frontière Arc Flash (m)
- Catégorie EPI requise
- Niveau de tension

### Modèle d'étiquette

```
┌─────────────────────────────────────┐
│       ⚠️ DANGER ARC FLASH          │
├─────────────────────────────────────┤
│ Énergie incidente : 12.8 cal/cm²   │
│ Catégorie EPI : 2                   │
│ Frontière Arc Flash : 1.2 m        │
│ Tension : 400 V                     │
├─────────────────────────────────────┤
│ EPI requis :                        │
│ - Vêtement FR 8 cal/cm²            │
│ - Écran facial                      │
│ - Gants isolants                    │
│ - Casque avec écran                 │
└─────────────────────────────────────┘
```

### Générer des étiquettes

1. Fiche du point → **Générer étiquette**
2. Téléchargez le PDF
3. Imprimez et posez sur l'équipement

---

## Mesures de réduction du risque

### Réduire l'énergie incidente

| Mesure | Impact |
|--------|--------|
| **Réduire le temps d'arc** | Temporisations, relais rapides |
| **Réduire le courant** | Limiteurs, fusibles rapides |
| **Augmenter la distance** | Télécommande, outils isolés |
| **Mode maintenance** | Réglages temporaires |

### Solutions techniques

- **Relais Arc Flash** : Détection optique + coupure ultrarapide
- **Fusibles limiteurs** : Limitation du courant de crête
- **Mode maintenance** : Temporisations réduites pendant travaux
- **Portes fermées** : Confinement de l'arc

---

## Procédures de travail

### Avant intervention

1. Vérifier l'étiquette Arc Flash
2. Identifier la catégorie EPI
3. S'équiper correctement
4. Respecter la frontière Arc Flash

### EPI par catégorie

#### Catégorie 1 (4-8 cal/cm²)

- Chemise et pantalon FR
- Lunettes de sécurité
- Gants en cuir

#### Catégorie 2 (8-25 cal/cm²)

- Vêtement FR (8-25 cal/cm²)
- Écran facial arc flash
- Cagoule balaclava FR
- Gants isolants

#### Catégorie 3 (25-40 cal/cm²)

- Combinaison FR multicouche
- Capuche arc flash
- Gants isolants classe appropriée
- Sous-vêtements FR

#### Catégorie 4 (> 40 cal/cm²)

- Combinaison intégrale arc flash
- Protection respiratoire si nécessaire
- Gants multicouches

---

## Mise à jour des études

### Quand refaire l'étude ?

- Modification des réglages de protection
- Changement de puissance de court-circuit
- Modification de la configuration
- Tous les 5 ans (bonne pratique)

### Processus

1. Identifier les changements
2. Mettre à jour les calculs
3. Générer nouvelles étiquettes
4. Remplacer les étiquettes terrain
5. Former le personnel

---

## Lien avec autres modules

### Courant de défaut

Les valeurs d'Ibf proviennent des études de court-circuit.

### Sélectivité

Les temporisations impactent le temps d'arc et donc l'énergie incidente.

### Tableaux électriques

Chaque tableau peut avoir une analyse Arc Flash associée.

---

## Normes de référence

| Norme | Description |
|-------|-------------|
| **IEEE 1584-2018** | Guide de calcul Arc Flash |
| **NFPA 70E** | Sécurité électrique travail |
| **CSA Z462** | Équivalent canadien |
| **EN 50110** | Exploitation installations (EU) |

---

## Bonnes pratiques

### Études

- Réalisez les études par un bureau d'études qualifié
- Mettez à jour régulièrement
- Documentez les hypothèses

### Étiquetage

- Posez les étiquettes sur tous les équipements
- Assurez leur lisibilité
- Remplacez les étiquettes endommagées

### Formation

- Formez le personnel au risque Arc Flash
- Démontrez l'utilisation des EPI
- Réalisez des exercices

---

## FAQ

### Quelle différence entre Arc Flash et électrisation ?

- **Arc Flash** : Brûlure thermique par l'arc
- **Électrisation** : Passage du courant dans le corps

### Faut-il des EPI Arc Flash pour les travaux hors tension ?

Si l'équipement est consigné et vérifié hors tension, non. Mais pendant la vérification d'absence de tension, oui.

### Peut-on travailler si la catégorie dépasse 4 ?

Non, il faut réduire le risque (consignation, mode maintenance) avant intervention.

---

## Voir aussi

- [Courant de défaut](./courant-defaut.md)
- [Sélectivité](./selectivite.md)
- [Tableaux électriques](./tableaux-electriques.md)
