# Équipements mobiles

Le module **Équipements mobiles** permet de gérer les contrôles réglementaires de l'outillage électrique portatif.

---

## Présentation

![Vue Mobile](../assets/screenshots/mobile-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Équipements mobiles -->

Les équipements électriques portatifs nécessitent des vérifications régulières :

- **Perceuses** et visseuses
- **Meuleuses** et disqueuses
- **Rallonges** et enrouleurs
- **Lampes** portatives
- **Transformateurs** de sécurité
- **Appareils** de mesure

---

## Réglementation

### Obligations de vérification

Selon le Code du travail (articles R4323-22 et suivants) :

- Vérifications périodiques obligatoires
- Maintien en état de conformité
- Registre de sécurité

### Fréquence recommandée

| Type d'équipement | Fréquence |
|-------------------|-----------|
| Appareils de classe I | Annuelle |
| Appareils de classe II | Annuelle |
| Rallonges et enrouleurs | 6 mois à 1 an |
| Appareils en environnement sévère | 6 mois |

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Mobile Equipments**

---

## Types d'équipements

### Classification par classe d'isolation

| Classe | Symbole | Protection |
|--------|---------|------------|
| **Classe I** | - | Mise à la terre |
| **Classe II** | ⧈ | Double isolation |
| **Classe III** | ⧇ | TBTS (< 50V) |

### Catégories d'équipements

#### Électroportatif

- Perceuses
- Visseuses
- Meuleuses
- Ponceuses
- Scies

#### Accessoires

- Rallonges
- Enrouleurs
- Multiprises
- Cordons prolongateurs

#### Éclairage

- Lampes baladeuses
- Projecteurs mobiles
- Guirlandes de chantier

#### Mesure et contrôle

- Multimètres
- Pinces ampèremétriques
- Appareils de mesure d'isolement

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Statistiques et alertes |
| **Liste** | Inventaire des équipements |
| **Carte** | Localisation / Attribution |
| **Calendrier** | Planning des contrôles |

### Filtres disponibles

- Type d'équipement
- Classe d'isolation
- Service / Utilisateur
- Statut de contrôle
- Conformité

---

## Créer un équipement

### Formulaire de création

![Formulaire Mobile](../assets/screenshots/mobile-create-form.png)
<!-- Capture d'écran recommandée : Formulaire de création -->

#### Identification

| Champ | Description |
|-------|-------------|
| **N° inventaire** | Identifiant unique (obligatoire) |
| **Désignation** | Type d'équipement |
| **Marque** | Fabricant |
| **Modèle** | Référence |
| **N° série** | Numéro de série |

#### Classification

| Champ | Description |
|-------|-------------|
| **Type** | Perceuse, meuleuse, rallonge... |
| **Classe** | I, II ou III |
| **Puissance** | W |
| **Tension** | V |

#### Attribution

| Champ | Description |
|-------|-------------|
| **Service** | Département utilisateur |
| **Responsable** | Utilisateur principal |
| **Localisation** | Lieu de rangement |

#### Contrôles

| Champ | Description |
|-------|-------------|
| **Périodicité** | Fréquence de contrôle |
| **Dernier contrôle** | Date |
| **Prochain contrôle** | Échéance |

---

## Contrôles des équipements

### Vérifications visuelles

À effectuer avant chaque utilisation :

- [ ] Cordon d'alimentation intact
- [ ] Fiche non endommagée
- [ ] Boîtier sans fissure
- [ ] Étiquettes lisibles
- [ ] Capot de protection présent (meuleuse)

### Vérifications périodiques

#### Points de contrôle

| Vérification | Méthode |
|--------------|---------|
| **Continuité du PE** | Mesure < 0.3 Ω |
| **Isolement** | Mesure > 1 MΩ (500V DC) |
| **Fonctionnement** | Test en charge |
| **État mécanique** | Inspection visuelle |
| **Marquage** | Lisibilité |

#### Mesures à effectuer

**Classe I (mise à la terre)**
- Continuité du conducteur de protection
- Résistance d'isolement (phase-terre, neutre-terre)

**Classe II (double isolation)**
- Résistance d'isolement uniquement

### Résultats des mesures

| Paramètre | Valeur acceptable |
|-----------|-------------------|
| Continuité PE | < 0.3 Ω (câble < 5m) |
| Résistance d'isolement | > 1 MΩ |
| Courant de fuite | < 3.5 mA |

---

## Enregistrer un contrôle

### Procédure

1. Fiche équipement → **Ajouter un contrôle**
2. Renseignez :
   - Date du contrôle
   - Contrôleur
   - Type de contrôle
   - Mesures effectuées
   - Résultat global
3. Indiquez la prochaine échéance
4. Apposez une étiquette sur l'équipement

### Données à saisir

| Champ | Type |
|-------|------|
| Continuité PE | Ω |
| Isolement | MΩ |
| Courant de fuite | mA |
| Observations | Texte |
| Photos | Fichiers |

---

## Gestion des non-conformités

### Actions selon le résultat

| Résultat | Action |
|----------|--------|
| **Conforme** | Apposer étiquette verte |
| **Non conforme mineur** | Réparer et recontrôler |
| **Non conforme majeur** | Retirer du service |
| **Hors service** | Réformer ou réparer |

### Traçabilité

Pour chaque non-conformité :
1. Documenter l'anomalie
2. Retirer l'équipement du service
3. Planifier la réparation ou réforme
4. Vérifier après réparation
5. Clôturer l'action

---

## Étiquetage

### Système d'étiquettes

Après chaque contrôle, apposez une étiquette indiquant :

- Date du contrôle
- Date limite de validité
- N° de l'équipement
- Signature du contrôleur

### Codes couleur suggérés

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | Conforme |
| 🟡 Jaune | Contrôle proche |
| 🔴 Rouge | Non conforme / Hors service |

---

## Gestion du parc

### Attribution

Tracez qui utilise quel équipement :

- Attribution à un service
- Attribution nominative
- Localisation de rangement

### Prêt / Retour

Si vous gérez des prêts :
1. Enregistrez le prêt (date, emprunteur)
2. Vérifiez l'état au retour
3. Notez les anomalies

### Réforme

Processus de mise au rebut :
1. Identifier l'équipement à réformer
2. Documenter la raison
3. Retirer physiquement du parc
4. Archiver la fiche

---

## Export et rapports

### Rapport de contrôle

Export PDF avec :
- Identification de l'équipement
- Mesures effectuées
- Résultat et observations
- Prochaine échéance

### Inventaire

Export Excel du parc :
- Liste complète des équipements
- Statut de conformité
- Dates de contrôle
- Attributions

### Registre de sécurité

Document récapitulatif pour les vérifications réglementaires.

---

## Vue cartographique

![Carte Mobile](../assets/screenshots/mobile-map.png)
<!-- Capture d'écran recommandée : Vue carte / attribution -->

La carte permet de visualiser :
- Localisation des équipements
- Attribution par service
- Statut de conformité

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
[TYPE]-[SERVICE]-[NUMERO]
```

Exemples :
- `PERC-MAINT-001` : Perceuse maintenance n°1
- `MEUL-PROD-003` : Meuleuse production n°3
- `RALL-UTIL-010` : Rallonge utilités n°10

### Organisation

- Rangez les équipements dans un lieu dédié
- Facilitez l'identification visuelle
- Groupez par service ou par type

### Formation

- Sensibilisez les utilisateurs aux vérifications avant usage
- Formez les contrôleurs aux mesures électriques
- Affichez les consignes de sécurité

---

## FAQ

### À quelle fréquence contrôler les équipements ?

Au minimum annuellement. Plus souvent en environnement difficile (humidité, poussière, chocs).

### Qui peut effectuer les contrôles ?

Personnel électricien formé, ou organisme externe agréé selon l'exigence réglementaire.

### Que faire d'un équipement non conforme ?

Le retirer immédiatement du service. Soit le réparer et recontrôler, soit le réformer.

### Comment gérer les équipements personnels ?

Les équipements personnels utilisés professionnellement doivent être vérifiés de la même manière.

---

## Voir aussi

- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
- [Tableaux électriques](./tableaux-electriques.md)
