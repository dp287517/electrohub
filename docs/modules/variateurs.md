# Variateurs de vitesse (VSD)

Le module **Variateurs de vitesse** (Variable Speed Drives) permet de gérer les variateurs de fréquence et leurs contrôles périodiques.

---

## Présentation

![Vue VSD](../assets/screenshots/vsd-overview.png)
<!-- Capture d'écran recommandée : Page principale du module VSD -->

Les variateurs de vitesse sont essentiels pour le contrôle des moteurs électriques. Ce module permet de :

- **Inventorier** tous les variateurs
- **Documenter** les caractéristiques techniques
- **Planifier** les maintenances préventives
- **Suivre** les interventions et remplacements
- **Visualiser** sur plans

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Variable Speed Drives**

---

## Interface

### Onglets disponibles

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Statistiques et KPIs |
| **Liste** | Inventaire des variateurs |
| **Carte** | Localisation sur plans |
| **Calendrier** | Planning des contrôles |
| **Analyse** | Graphiques et tendances |

### Vue liste

![Liste VSD](../assets/screenshots/vsd-list.png)
<!-- Capture d'écran recommandée : Liste des variateurs -->

Colonnes affichées :
- TAG / Nom
- Puissance (kW)
- Marque / Modèle
- Localisation
- Statut de contrôle
- Actions

---

## Caractéristiques d'un variateur

### Informations générales

| Champ | Description | Exemple |
|-------|-------------|---------|
| **TAG** | Identifiant unique | VSD-BAT-A-01 |
| **Désignation** | Description fonctionnelle | Variateur pompe process |
| **Bâtiment** | Localisation | Bâtiment A |
| **Zone** | Précision | Zone production |

### Données techniques

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Marque** | Fabricant | ABB, Siemens, Schneider |
| **Modèle** | Référence | ACS880-01 |
| **Puissance** | Puissance nominale | 55 kW |
| **Tension d'entrée** | Alimentation | 400V AC |
| **Tension de sortie** | Vers moteur | 0-400V AC |
| **Courant nominal** | Intensité | 106 A |
| **IP** | Indice de protection | IP54 |

### Paramétrage

| Champ | Description |
|-------|-------------|
| **Fréquence min/max** | Plage de fonctionnement |
| **Temps d'accélération** | Rampe de montée |
| **Temps de décélération** | Rampe de descente |
| **Mode de contrôle** | V/f, Vectoriel, etc. |

### Moteur associé

| Champ | Description |
|-------|-------------|
| **TAG moteur** | Lien vers équipement mécanique |
| **Puissance moteur** | kW |
| **Vitesse nominale** | tr/min |
| **Type de moteur** | Asynchrone, synchrone |

---

## Créer un variateur

### Étape 1 : Nouveau variateur

Cliquez sur **+ Nouveau** dans la liste.

### Étape 2 : Remplir le formulaire

![Formulaire VSD](../assets/screenshots/vsd-create-form.png)
<!-- Capture d'écran recommandée : Formulaire de création VSD -->

1. **Identification** : TAG, désignation
2. **Localisation** : Bâtiment, zone, local
3. **Technique** : Marque, modèle, puissance
4. **Moteur** : Association avec équipement mécanique
5. **Contrôles** : Périodicité, dates

### Étape 3 : Enregistrer

Le variateur apparaît dans la liste.

---

## Contrôles des variateurs

### Types de contrôles recommandés

| Contrôle | Fréquence | Points vérifiés |
|----------|-----------|-----------------|
| **Visuel** | Mensuel | État général, voyants, ventilation |
| **Thermique** | Trimestriel | Température, thermographie |
| **Électrique** | Annuel | Mesures, paramètres |
| **Préventif** | Selon fabricant | Ventilateurs, condensateurs |

### Points de contrôle

#### Inspection visuelle

- [ ] État du boîtier (fissures, traces d'échauffement)
- [ ] Propreté (poussière, dépôts)
- [ ] État des connexions
- [ ] Fonctionnement des voyants
- [ ] Ventilation (bruit, vibration)

#### Vérification électrique

- [ ] Tension d'alimentation
- [ ] Courant absorbé
- [ ] Fréquence de sortie
- [ ] Défauts mémorisés
- [ ] Paramètres de configuration

### Enregistrer un contrôle

1. Fiche du variateur → **Ajouter un contrôle**
2. Remplir le formulaire :
   - Date et type
   - Résultat (OK / Anomalie)
   - Observations détaillées
   - Photos si nécessaire
3. Définir la prochaine échéance

---

## Gestion des défauts

### Historique des alarmes

Le module permet de tracer les défauts survenus :

| Champ | Description |
|-------|-------------|
| **Date/Heure** | Moment du défaut |
| **Code défaut** | Code constructeur |
| **Description** | Nature du problème |
| **Action** | Correction apportée |

### Défauts courants

| Code | Signification | Action |
|------|---------------|--------|
| **OC** | Surintensité | Vérifier charge, câbles |
| **OV** | Surtension | Vérifier freinage, alimentation |
| **UV** | Sous-tension | Vérifier alimentation |
| **OH** | Surchauffe | Nettoyer, vérifier ventilation |
| **EF** | Défaut terre | Vérifier câblage moteur |

---

## Documentation

### Documents à associer

- **Datasheet** : Fiche technique constructeur
- **Manuel** : Notice d'utilisation
- **Paramétrage** : Export des paramètres
- **Schéma** : Raccordement électrique
- **Photos** : État visuel, plaque signalétique

### Export PDF

Générez un rapport contenant :
- Caractéristiques complètes
- Historique des contrôles
- Liste des défauts
- Recommandations

---

## Vue cartographique

![Carte VSD](../assets/screenshots/vsd-map.png)
<!-- Capture d'écran recommandée : Vue carte avec les variateurs -->

L'onglet **Carte** permet de :

- Visualiser l'implantation des variateurs
- Identifier rapidement les équipements
- Voir le statut de chaque variateur
- Accéder aux fiches depuis le plan

### Positionnement

1. Sélectionnez le plan du bâtiment
2. Cliquez sur **Placer**
3. Cliquez à l'emplacement du variateur
4. Le marqueur est enregistré

---

## Lien avec équipements mécaniques

Les variateurs pilotent des moteurs. Créez des liens :

### Depuis le variateur

1. Fiche variateur → Section **Moteur associé**
2. Recherchez l'équipement mécanique
3. Créez le lien

### Avantages

- Navigation directe variateur ↔ moteur
- Vue d'ensemble de la chaîne cinématique
- Coordination des maintenances

> Voir [Équipements mécaniques](./equipements-mecaniques.md)

---

## Obsolescence

Les variateurs ont une durée de vie limitée (10-15 ans typiquement).

### Indicateurs à surveiller

- Âge de l'équipement
- Disponibilité des pièces
- Nombre de défauts
- État des composants (condensateurs, ventilateurs)

### Planification du remplacement

Utilisez le module [Obsolescence](./obsolescence.md) pour :
- Évaluer la criticité
- Planifier les remplacements
- Budgétiser les investissements

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
VSD-[BATIMENT]-[ZONE]-[NUMERO]
```

Exemples :
- `VSD-A-PROD-01` : Variateur production
- `VSD-B-UTIL-03` : Variateur utilités
- `VSD-C-CVC-02` : Variateur CVC

### Maintenance

- Nettoyez régulièrement (poussière = surchauffe)
- Vérifiez les ventilateurs
- Sauvegardez les paramètres
- Gardez des pièces de rechange

### Documentation

- Exportez les paramètres après chaque modification
- Photographiez les configurations
- Tracez les interventions

---

## FAQ

### Comment retrouver un variateur par son TAG ?

Utilisez la barre de recherche avec le TAG exact.

### Comment voir les variateurs en alarme ?

Filtrez par statut "Non conforme" ou recherchez les défauts récents.

### Comment dupliquer la configuration ?

Exportez les paramètres d'un variateur et importez-les sur un autre (hors ElectroHub, via l'outil constructeur).

---

## Voir aussi

- [Équipements mécaniques](./equipements-mecaniques.md)
- [Obsolescence](./obsolescence.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
