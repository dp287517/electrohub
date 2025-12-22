# Haute Tension (HT)

Le module **Haute Tension** permet de gérer les équipements HT de votre installation : cellules, transformateurs, câbles et jeux de barres.

---

## Présentation

![Vue HT](../assets/screenshots/hv-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Haute Tension -->

Les installations haute tension (généralement > 1000V) nécessitent une gestion rigoureuse. Ce module couvre :

- **Cellules HT** : Arrivée, départ, protection, mesure
- **Transformateurs** : HT/BT ou HT/HT
- **Câbles HT** : Liaisons souterraines ou aériennes
- **Jeux de barres** : Distribution HT

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **High Voltage Equipment**

---

## Types d'équipements HT

### Cellules HT

![Cellule HT](../assets/screenshots/hv-cell-detail.png)
<!-- Capture d'écran recommandée : Fiche d'une cellule HT -->

| Champ | Description |
|-------|-------------|
| **Type** | Arrivée, Départ, Protection, Mesure, Couplage |
| **Tension nominale** | 10kV, 15kV, 20kV, etc. |
| **Intensité nominale** | Courant assigné (A) |
| **Pouvoir de coupure** | Capacité de coupure (kA) |
| **Fabricant** | Schneider, ABB, Siemens... |
| **Année** | Mise en service |

### Transformateurs

![Transformateur](../assets/screenshots/hv-transformer-detail.png)
<!-- Capture d'écran recommandée : Fiche d'un transformateur -->

| Champ | Description |
|-------|-------------|
| **Puissance** | kVA ou MVA |
| **Tension primaire** | Côté HT |
| **Tension secondaire** | Côté BT |
| **Couplage** | Dyn11, Yyn0, etc. |
| **Type de refroidissement** | ONAN, ONAF, sec |
| **Huile** | Quantité et type |

### Câbles HT

| Champ | Description |
|-------|-------------|
| **Section** | mm² |
| **Type d'isolant** | XLPE, EPR, papier |
| **Longueur** | Mètres |
| **Pose** | Enterré, caniveau, aérien |
| **Extrémités** | Type de raccordement |

### Jeux de barres

| Champ | Description |
|-------|-------------|
| **Matériau** | Cuivre, aluminium |
| **Section** | Dimensions |
| **Courant nominal** | Intensité max |
| **Traitement de surface** | Argenté, étamé, nu |

---

## Interface du module

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Statistiques et alertes |
| **Cellules** | Liste des cellules HT |
| **Transformateurs** | Liste des transformateurs |
| **Câbles** | Liste des câbles |
| **Barres** | Jeux de barres |
| **Carte** | Vue cartographique |

### Navigation

- Utilisez les onglets pour naviguer entre les types d'équipements
- La recherche filtre le type d'équipement actif

---

## Créer un équipement HT

### Cellule HT

1. Onglet **Cellules** → **+ Nouvelle cellule**
2. Remplissez le formulaire :

| Section | Champs |
|---------|--------|
| **Identification** | Nom, TAG, Description |
| **Localisation** | Poste, Travée, Position |
| **Technique** | Type, Tension, Intensité, Pdc |
| **Contrôles** | Périodicité, Dates |

### Transformateur

1. Onglet **Transformateurs** → **+ Nouveau**
2. Remplissez les caractéristiques :
   - Puissance et tensions
   - Couplage et groupe horaire
   - Données huile (si applicable)

### Documents spécifiques

Pour les équipements HT, attachez :
- Procès-verbal de mise en service
- Rapport d'analyse d'huile
- Thermographie infrarouge
- Schémas unifilaires

---

## Contrôles spécifiques HT

### Types de contrôles

| Contrôle | Fréquence | Description |
|----------|-----------|-------------|
| **Visuel** | Mensuel | Inspection générale |
| **Thermographie** | Annuel | Détection de points chauds |
| **Analyse d'huile** | Annuel | État du diélectrique |
| **Essais diélectriques** | 5 ans | Test d'isolement |
| **Vérification manœuvres** | Annuel | Test des mécanismes |

### Enregistrer une analyse d'huile

1. Ouvrez la fiche du transformateur
2. **Ajouter un contrôle** → Type "Analyse d'huile"
3. Renseignez les résultats :
   - Rigidité diélectrique (kV)
   - Teneur en eau (ppm)
   - Acidité (mg KOH/g)
   - Gaz dissous (si applicable)

### Thermographie

1. Effectuez l'inspection thermographique
2. **Ajouter un contrôle** → Type "Thermographie"
3. Attachez le rapport et les images thermiques
4. Indiquez les anomalies détectées

---

## Analyse des risques

Le module permet de documenter :

### Études de sélectivité

Lien vers le module [Sélectivité](./selectivite.md) pour :
- Coordination des protections HT/BT
- Réglages des relais

### Courants de défaut

Lien vers [Courant de défaut](./courant-defaut.md) pour :
- Calcul des Icc au niveau HT
- Dimensionnement des protections

### Arc Flash

Lien vers [Arc Flash](./arc-flash.md) pour :
- Énergie incidente côté HT
- EPI requis pour les interventions

---

## Vue cartographique

![Carte HT](../assets/screenshots/hv-map.png)
<!-- Capture d'écran recommandée : Vue cartographique des équipements HT -->

Visualisez l'implantation de vos équipements HT :

- **Postes de transformation**
- **Parcours des câbles**
- **Cellules et tableaux HT**

### Légende des marqueurs

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | Équipement conforme |
| 🟠 Orange | Contrôle à venir |
| 🔴 Rouge | Contrôle en retard |
| 🔵 Bleu | Sélectionné |

---

## Gestion de l'obsolescence

Les équipements HT ont une durée de vie importante. Le module permet de suivre :

### Indicateurs d'obsolescence

- Âge de l'équipement
- Disponibilité des pièces de rechange
- État technique
- Historique des pannes

### Lien avec le module Obsolescence

> Voir [Obsolescence](./obsolescence.md) pour la gestion du cycle de vie

---

## Export et documentation

### Rapport d'équipement

Générez un rapport PDF contenant :
- Caractéristiques techniques complètes
- Historique des contrôles
- Résultats d'analyses
- Photos et schémas

### Export de la liste

Exportez au format Excel :
- Inventaire complet des équipements HT
- Statut des contrôles
- Alertes et non-conformités

---

## Sécurité

### Consignes importantes

Les interventions sur équipements HT présentent des risques majeurs :

⚠️ **Habilitation électrique requise** (H1, H2, HC, BR...)

⚠️ **Procédures de consignation obligatoires**

⚠️ **EPI adaptés au niveau de tension**

### Documentation de sécurité

Attachez aux équipements :
- Fiches de consignation
- Procédures d'intervention
- Plans de prévention

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
[TYPE]-[POSTE]-[NUMERO]
```

Exemples :
- `CELLULE-POSTE1-AR01` : Cellule arrivée
- `TRANSFO-POSTE1-T01` : Transformateur n°1
- `CABLE-P1-P2-01` : Câble entre postes

### Documentation

- Conservez tous les PV de mise en service
- Archivez les analyses d'huile successives
- Documentez les incidents et réparations

### Contrôles

- Planifiez les arrêts pour maintenance préventive
- Coordonnez avec l'exploitant du réseau
- Tracez tous les essais effectués

---

## Voir aussi

- [Tableaux électriques](./tableaux-electriques.md)
- [Sélectivité](./selectivite.md)
- [Courant de défaut](./courant-defaut.md)
- [Arc Flash](./arc-flash.md)
