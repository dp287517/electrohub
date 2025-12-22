# Calcul de boucle

Le module **Calcul de boucle** (Loop Calculation) permet de documenter les études de sécurité intrinsèque pour les installations ATEX.

---

## Présentation

![Vue Calcul boucle](../assets/screenshots/loopcalc-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Calcul de boucle -->

La sécurité intrinsèque (Ex i) est un mode de protection ATEX basé sur la limitation de l'énergie. Le calcul de boucle vérifie que l'ensemble de la chaîne de mesure respecte les limites.

---

## Qu'est-ce que la sécurité intrinsèque ?

### Principe

La sécurité intrinsèque limite l'énergie disponible dans le circuit à un niveau insuffisant pour provoquer une inflammation de l'atmosphère explosive.

### Catégories

| Catégorie | Zone | Description |
|-----------|------|-------------|
| **Ex ia** | 0, 1, 2 | Double défaut toléré |
| **Ex ib** | 1, 2 | Simple défaut toléré |
| **Ex ic** | 2 | Fonctionnement normal |

### Composants d'une boucle SI

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Barrière   │────►│    Câble     │────►│  Capteur SI  │
│   de sécurité│     │   terrain    │     │  (Ex ia/ib)  │
│  (zone sûre) │     │ (zone ATEX)  │     │  (zone ATEX) │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Loop Calculation**

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Boucles** | Liste des boucles SI |
| **Calculs** | Détail des vérifications |
| **Équipements** | Matériels SI du site |

---

## Paramètres d'une boucle SI

### Équipement de terrain (capteur/actionneur)

| Paramètre | Description | Unité |
|-----------|-------------|-------|
| **Ui** | Tension max admissible | V |
| **Ii** | Courant max admissible | mA |
| **Pi** | Puissance max admissible | W |
| **Ci** | Capacité interne | nF |
| **Li** | Inductance interne | µH |

### Barrière de sécurité

| Paramètre | Description | Unité |
|-----------|-------------|-------|
| **Uo** | Tension de sortie max | V |
| **Io** | Courant de sortie max | mA |
| **Po** | Puissance de sortie max | W |
| **Co** | Capacité max admissible | nF |
| **Lo** | Inductance max admissible | µH |

### Câble

| Paramètre | Description | Unité |
|-----------|-------------|-------|
| **Longueur** | Longueur totale | m |
| **Cc** | Capacité par unité | nF/m |
| **Lc** | Inductance par unité | µH/m |

---

## Vérification de compatibilité

### Règles de base

Pour qu'une boucle soit valide :

1. **Tension** : Uo ≤ Ui
2. **Courant** : Io ≤ Ii
3. **Puissance** : Po ≤ Pi
4. **Capacité** : Ci + Cc × L ≤ Co
5. **Inductance** : Li + Lc × L ≤ Lo

### Exemple de calcul

| Paramètre | Barrière (sortie) | Câble (100m) | Capteur (entrée) | Vérification |
|-----------|-------------------|--------------|------------------|--------------|
| Tension | Uo = 28V | - | Ui = 30V | ✅ 28 ≤ 30 |
| Courant | Io = 93mA | - | Ii = 100mA | ✅ 93 ≤ 100 |
| Capacité | Co = 180nF | Cc = 100nF | Ci = 10nF | ✅ 10+100 ≤ 180 |
| Inductance | Lo = 2mH | Lc = 0.5mH | Li = 0.1mH | ✅ 0.1+0.5 ≤ 2 |

---

## Créer une boucle

### Formulaire

1. **+ Nouvelle boucle**
2. Renseignez les sections :

#### Identification

| Champ | Description |
|-------|-------------|
| **Référence** | TAG de la boucle |
| **Désignation** | Description fonctionnelle |
| **Type** | Mesure température, pression, niveau... |
| **Zone ATEX** | Zone d'implantation |

#### Barrière de sécurité

| Champ | Description |
|-------|-------------|
| **Marque/Modèle** | Référence de la barrière |
| **Certificat** | N° certificat ATEX |
| **Uo, Io, Po** | Paramètres de sortie |
| **Co, Lo** | Limites de câble |

#### Câble

| Champ | Description |
|-------|-------------|
| **Type** | Référence du câble |
| **Longueur** | Mètres |
| **Cc, Lc** | Paramètres par mètre |

#### Équipement de terrain

| Champ | Description |
|-------|-------------|
| **Marque/Modèle** | Référence du capteur |
| **Certificat** | N° certificat ATEX |
| **Ui, Ii, Pi** | Limites d'entrée |
| **Ci, Li** | Paramètres internes |

---

## Vérification automatique

### Résultat du calcul

ElectroHub vérifie automatiquement la compatibilité :

| Critère | Condition | Résultat |
|---------|-----------|----------|
| Tension | Uo ≤ Ui | ✅ OK |
| Courant | Io ≤ Ii | ✅ OK |
| Puissance | Po ≤ Pi | ✅ OK |
| Capacité totale | Ci + Cc×L ≤ Co | ✅ OK |
| Inductance totale | Li + Lc×L ≤ Lo | ❌ NOK |

### En cas de non-conformité

Si le calcul échoue :
- Réduire la longueur de câble
- Changer de type de câble
- Utiliser une barrière différente
- Choisir un capteur avec des limites plus élevées

---

## Documentation

### Documents à attacher

- **Certificats ATEX** : Barrière et capteur
- **Fiches techniques** : Paramètres SI
- **Schéma de boucle** : Câblage complet
- **Note de calcul** : Vérification détaillée

### Export

Générez un rapport PDF contenant :
- Identification de la boucle
- Paramètres des composants
- Calculs de vérification
- Conclusion (conforme/non conforme)

---

## Gestion du parc

### Inventaire des barrières

Listez toutes les barrières SI installées :
- Localisation (armoire, tableau)
- Référence et certificat
- Date d'installation
- État de fonctionnement

### Inventaire des capteurs SI

Listez tous les équipements de terrain SI :
- Localisation (zone ATEX)
- Référence et certificat
- Boucle associée
- État de conformité

---

## Contrôles périodiques

### Points de vérification

| Vérification | Fréquence |
|--------------|-----------|
| **Visuelle barrières** | Annuelle |
| **Continuité câblage** | Annuelle |
| **Mesure isolement** | Selon besoin |
| **Vérification marquage** | Annuelle |
| **Conformité documentation** | Annuelle |

### Enregistrer un contrôle

1. Fiche boucle → **Ajouter un contrôle**
2. Renseignez les vérifications effectuées
3. Indiquez le résultat global
4. Planifiez le prochain contrôle

---

## Bonnes pratiques

### Installation

- Séparez les câbles SI des autres circuits
- Utilisez des couleurs distinctives (bleu clair)
- Identifiez clairement les borniers SI
- Respectez les instructions fabricant

### Documentation

- Conservez les certificats originaux
- Mettez à jour les notes de calcul
- Documentez les modifications

### Maintenance

- Ne modifiez jamais une boucle sans recalculer
- Utilisez uniquement des composants certifiés
- Formez le personnel intervenant

---

## FAQ

### Peut-on mélanger Ex ia et Ex ib dans une boucle ?

Oui, mais le niveau global sera celui du composant le moins contraignant (Ex ib).

### Comment choisir la longueur max de câble ?

Résolvez : L_max = (Co - Ci) / Cc et prenez aussi en compte Lo.

### Faut-il recalculer si on change de capteur ?

Oui, les paramètres Ui, Ii, Ci, Li peuvent différer.

---

## Voir aussi

- [ATEX](./atex.md)
- [Tableaux électriques](./tableaux-electriques.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
