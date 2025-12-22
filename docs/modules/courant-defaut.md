# Courant de défaut

Le module **Courant de défaut** (Fault Level Assessment) permet de documenter les études de court-circuit de vos installations.

---

## Présentation

![Vue Courant défaut](../assets/screenshots/fault-level-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Courant de défaut -->

Les études de courant de défaut sont essentielles pour :

- **Dimensionner** les protections (Pdc)
- **Calculer** les contraintes thermiques
- **Vérifier** la tenue des équipements
- **Étudier** la sélectivité
- **Analyser** le risque d'arc flash

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Fault Level Assessment**

---

## Notions fondamentales

### Types de défauts

| Type | Notation | Description |
|------|----------|-------------|
| **Triphasé** | Ik3, Icc3 | Court-circuit 3 phases |
| **Biphasé** | Ik2, Icc2 | Court-circuit 2 phases |
| **Monophasé** | Ik1, Icc1 | Court-circuit phase-neutre |
| **Phase-terre** | Ief | Défaut d'isolement |

### Grandeurs caractéristiques

| Grandeur | Description | Unité |
|----------|-------------|-------|
| **Ik"** | Courant initial (sous-transitoire) | kA |
| **Ik** | Courant permanent | kA |
| **ip** | Courant de crête | kA |
| **Ith** | Courant thermique équivalent | kA |

### Formules de base

**Court-circuit triphasé** :
```
Ik3 = Un / (√3 × Zcc)
```

**Court-circuit biphasé** :
```
Ik2 = Ik3 × (√3/2) ≈ 0.87 × Ik3
```

**Court-circuit monophasé** :
```
Ik1 = Un / (Z1 + Z2 + Z0)
```

---

## Interface du module

### Onglets

| Onglet | Description |
|--------|-------------|
| **Études** | Liste des études de court-circuit |
| **Points de calcul** | Résultats par emplacement |
| **Schéma** | Vue de l'installation |

---

## Créer une étude

### Étape 1 : Nouvelle étude

1. Cliquez sur **+ Nouvelle étude**
2. Renseignez les informations générales

### Informations de l'étude

| Champ | Description |
|-------|-------------|
| **Titre** | Nom de l'étude |
| **Périmètre** | Installation concernée |
| **Date** | Date de réalisation |
| **Auteur** | Bureau d'études |
| **Logiciel** | Outil utilisé (Caneco, ETAP...) |

### Étape 2 : Hypothèses

Documentez les données d'entrée :

#### Source d'alimentation

| Paramètre | Description |
|-----------|-------------|
| **Pcc réseau** | Puissance de court-circuit (MVA) |
| **Un réseau** | Tension nominale (kV) |
| **Cos φcc** | Facteur de puissance du réseau |

#### Transformateur

| Paramètre | Description |
|-----------|-------------|
| **Puissance** | kVA ou MVA |
| **Tension HT/BT** | V |
| **Ucc** | Tension de court-circuit (%) |
| **Pertes cuivre** | W |

#### Câbles et liaisons

| Paramètre | Description |
|-----------|-------------|
| **Section** | mm² |
| **Longueur** | m |
| **Matériau** | Cuivre / Aluminium |
| **Configuration** | Monoconducteur / Multiconducteur |

---

## Points de calcul

### Définir les points

Les courants de défaut sont calculés à différents points :

- Jeu de barres TGBT
- Départs principaux
- Tableaux divisionnaires
- Points critiques

### Résultats par point

| Point | Ik3 (kA) | Ik1 (kA) | ip (kA) | Ith (kA) |
|-------|----------|----------|---------|----------|
| TGBT | 42.5 | 38.2 | 89.3 | 40.1 |
| TD Atelier | 18.3 | 15.8 | 38.5 | 17.2 |
| TD Bureaux | 12.1 | 10.5 | 25.4 | 11.4 |

### Enregistrer un point

1. **+ Nouveau point**
2. Renseignez :
   - Identification (tableau, départ)
   - Valeurs calculées
   - Pdc requis
   - Observations

---

## Vérifications

### Pouvoir de coupure

Le Pdc du disjoncteur doit être supérieur à l'Icc au point d'installation :

```
Pdc ≥ Ik (au point d'installation)
```

### Tenue thermique

Les câbles et jeux de barres doivent supporter la contrainte thermique :

```
S × √t ≥ Ith × √t
```

### Contraintes électrodynamiques

Les équipements doivent supporter le courant de crête :

```
Ipk (équipement) ≥ ip (calculé)
```

---

## Documentation

### Rapports attachés

Importez les documents d'étude :

- **Rapport complet** : Étude détaillée (PDF)
- **Note de calcul** : Hypothèses et résultats
- **Schéma unifilaire** : Avec les valeurs d'Icc

### Export

Exportez les résultats pour :
- Dimensionnement des protections
- Étude de sélectivité
- Analyse Arc Flash

---

## Mise à jour

### Quand refaire l'étude ?

- Modification de la source (nouveau transfo)
- Ajout de charges importantes
- Extension de l'installation
- Changement de la configuration réseau

### Processus de mise à jour

1. Identifiez les modifications
2. Mettez à jour les hypothèses
3. Recalculez les Icc
4. Vérifiez les équipements
5. Documentez les changements

---

## Lien avec autres modules

### Sélectivité

Les valeurs d'Icc sont utilisées pour :
- Vérifier la sélectivité
- Consulter les tables constructeur
- Dimensionner les protections

### Arc Flash

L'énergie incidente dépend de :
- Courant de défaut
- Durée de l'arc
- Distance de travail

### Tableaux électriques

Chaque tableau documente :
- Pdc de l'appareillage
- Icc calculé au point

---

## Outils de calcul

### Logiciels spécialisés

| Logiciel | Éditeur |
|----------|---------|
| Caneco BT | ALPI |
| Ecodial | Schneider |
| DOC | ABB |
| ETAP | ETAP |
| SIMARIS | Siemens |

### Calcul simplifié

Pour estimations rapides, méthode des impédances :

1. Calculez l'impédance de la source
2. Ajoutez les impédances des éléments
3. Déduisez les courants de défaut

---

## Bonnes pratiques

### Hypothèses

- Utilisez des valeurs réalistes
- Considérez le pire cas (Icc max)
- Documentez les sources des données

### Documentation

- Conservez les études d'origine
- Archivez les mises à jour
- Tracez les modifications

### Validation

- Faites valider par un bureau d'études
- Vérifiez la cohérence des résultats
- Comparez avec les mesures terrain si possible

---

## FAQ

### Quelle est la différence entre Ik3 et Ik" ?

- Ik" : Courant initial (régime sous-transitoire)
- Ik3 : Courant triphasé permanent

### Pourquoi le Pdc doit être supérieur à l'Icc ?

Pour que le disjoncteur puisse couper le défaut en toute sécurité.

### Les valeurs diminuent-elles en s'éloignant de la source ?

Oui, l'impédance augmente avec la distance, donc l'Icc diminue.

---

## Voir aussi

- [Sélectivité](./selectivite.md)
- [Arc Flash](./arc-flash.md)
- [Tableaux électriques](./tableaux-electriques.md)
