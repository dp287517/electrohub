# Équipements mécaniques

Le module **Équipements mécaniques** (MECA) permet de gérer les pompes, ventilateurs, moteurs et autres équipements rotatifs.

---

## Présentation

![Vue MECA](../assets/screenshots/meca-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Équipements mécaniques -->

Les équipements mécaniques sont au cœur des process industriels. Ce module couvre :

- **Pompes** : Centrifuges, volumétriques, vide
- **Ventilateurs** : Extraction, soufflage, process
- **Moteurs** : Électriques, associés ou indépendants
- **Compresseurs** : Air comprimé, process
- **Convoyeurs** : Bandes, rouleaux, chaînes
- **Agitateurs** : Cuves, réacteurs

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Mechanical Equipments**

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue d'ensemble et statistiques |
| **Liste** | Inventaire des équipements |
| **Carte** | Localisation sur plans |
| **Calendrier** | Planning des contrôles |

### Filtres

Filtrez par :
- Type d'équipement (pompe, ventilateur...)
- Bâtiment / Zone
- Statut de contrôle
- Criticité

---

## Types d'équipements

### Pompes

![Fiche pompe](../assets/screenshots/meca-pump-detail.png)
<!-- Capture d'écran recommandée : Fiche détaillée d'une pompe -->

| Champ | Description |
|-------|-------------|
| **Type** | Centrifuge, volumétrique, vide |
| **Débit** | m³/h |
| **HMT** | Hauteur manométrique (m) |
| **Fluide** | Nature du fluide pompé |
| **Matériaux** | Corps, roue, garnitures |
| **Étanchéité** | Presse-étoupe, garniture mécanique |

### Ventilateurs

| Champ | Description |
|-------|-------------|
| **Type** | Centrifuge, axial, hélicoïde |
| **Débit** | m³/h |
| **Pression** | Pa ou mmCE |
| **Application** | Extraction, soufflage, ATEX |
| **Entraînement** | Direct, courroies |

### Moteurs

| Champ | Description |
|-------|-------------|
| **Puissance** | kW |
| **Tension** | V |
| **Vitesse** | tr/min |
| **Rendement** | IE1, IE2, IE3, IE4 |
| **Protection** | IP |
| **Mode de démarrage** | Direct, étoile-triangle, VSD |

### Compresseurs

| Champ | Description |
|-------|-------------|
| **Type** | Vis, piston, scroll |
| **Débit** | m³/min ou l/s |
| **Pression** | bar |
| **Huile** | Lubrifié ou sec |

---

## Créer un équipement

### Formulaire de création

![Formulaire MECA](../assets/screenshots/meca-create-form.png)
<!-- Capture d'écran recommandée : Formulaire de création -->

1. **+ Nouveau** dans la liste
2. Sélectionnez le **type d'équipement**
3. Remplissez les sections :

#### Identification

| Champ | Obligatoire |
|-------|-------------|
| TAG | ✅ |
| Désignation | ✅ |
| Type | ✅ |

#### Localisation

| Champ | Obligatoire |
|-------|-------------|
| Bâtiment | ✅ |
| Zone | |
| Local | |

#### Caractéristiques

Selon le type d'équipement, les champs varient.

#### Moteur associé

- Puissance
- Tension
- Vitesse
- Lien vers variateur (si applicable)

#### Contrôles

- Périodicité
- Dernière date
- Prochaine échéance

---

## Contrôles des équipements mécaniques

### Types de contrôles

| Contrôle | Fréquence | Description |
|----------|-----------|-------------|
| **Ronde** | Quotidien/Hebdo | Inspection rapide |
| **Visuel** | Mensuel | État général approfondi |
| **Vibratoire** | Trimestriel | Analyse vibrations |
| **Thermique** | Trimestriel | Thermographie |
| **Préventif** | Annuel | Maintenance complète |

### Points de contrôle - Pompes

- [ ] Étanchéité (fuites)
- [ ] Bruit anormal
- [ ] Vibrations
- [ ] Température paliers
- [ ] Pression refoulement
- [ ] Débit (si mesurable)

### Points de contrôle - Ventilateurs

- [ ] Bruit anormal
- [ ] Vibrations
- [ ] État des courroies (si applicable)
- [ ] Équilibrage roue
- [ ] Débit / Pression

### Points de contrôle - Moteurs

- [ ] Température
- [ ] Bruit
- [ ] Vibrations
- [ ] Courant absorbé
- [ ] Isolement (périodique)

---

## Analyse vibratoire

L'analyse vibratoire est clé pour la maintenance prédictive :

### Enregistrer une mesure

1. Fiche équipement → **Ajouter un contrôle**
2. Type : "Analyse vibratoire"
3. Renseignez :
   - Vitesse vibratoire (mm/s)
   - Accélération (g)
   - Déplacement (µm)
   - Points de mesure (palier AR, AV...)
4. Attachez le rapport de mesure

### Seuils d'alerte

| Niveau | Vitesse (mm/s) | Action |
|--------|----------------|--------|
| Bon | < 2.8 | RAS |
| Acceptable | 2.8 - 4.5 | Surveillance |
| Limite | 4.5 - 7.1 | Planifier intervention |
| Inacceptable | > 7.1 | Intervention urgente |

*(Selon ISO 10816)*

---

## Lien avec variateurs

Si l'équipement est piloté par un variateur :

### Créer le lien

1. Fiche équipement → Section **Entraînement**
2. Champ **Variateur** → Rechercher le VSD
3. Enregistrer

### Avantages

- Navigation bidirectionnelle
- Vue système complète
- Corrélation des défauts

> Voir [Variateurs (VSD)](./variateurs.md)

---

## Vue cartographique

![Carte MECA](../assets/screenshots/meca-map.png)
<!-- Capture d'écran recommandée : Vue carte des équipements mécaniques -->

Visualisez l'implantation :

- Marqueurs par type (pompe, ventilateur, moteur)
- Code couleur par statut
- Info-bulle avec caractéristiques principales

### Légende

| Icône | Type |
|-------|------|
| 🔵 | Pompe |
| 🟢 | Ventilateur |
| 🟠 | Moteur |
| ⚫ | Autre |

---

## Gestion des pièces de rechange

### Pièces critiques

Pour chaque équipement, identifiez :
- Roulements
- Garnitures
- Courroies
- Joints
- Roues / Turbines

### Stock recommandé

Documentez dans les notes de l'équipement :
- Références des pièces
- Fournisseurs
- Délais d'approvisionnement
- Stock disponible (lien avec votre gestion de stock)

---

## Historique et tendances

### Graphiques disponibles

L'onglet **Analyse** présente :

- Évolution du nombre de défauts
- Tendance des mesures vibratoires
- Répartition par type d'équipement
- Taux de conformité

### Exploitation des données

- Identifiez les équipements problématiques
- Planifiez les remplacements
- Optimisez la maintenance

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
[TYPE]-[BATIMENT]-[PROCESS]-[NUMERO]
```

Exemples :
- `PMP-A-EAU-01` : Pompe eau bâtiment A
- `VEN-B-EXT-03` : Ventilateur extraction
- `MOT-C-CONV-02` : Moteur convoyeur

### Fiabilité

- Suivez les recommandations fabricant
- Analysez les historiques de pannes
- Standardisez les équipements
- Gardez un stock de pièces critiques

### Documentation

- Photographiez les plaques signalétiques
- Archivez les courbes constructeur
- Documentez les modifications

---

## FAQ

### Comment lier un moteur à sa pompe ?

Créez deux équipements distincts et utilisez les champs de liaison.

### Comment suivre les heures de fonctionnement ?

Ajoutez l'information dans les contrôles réguliers (relevé compteur).

### Comment planifier un arrêt pour maintenance ?

Utilisez le calendrier pour visualiser les échéances et coordonnez avec la production.

---

## Voir aussi

- [Variateurs (VSD)](./variateurs.md)
- [Obsolescence](./obsolescence.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
