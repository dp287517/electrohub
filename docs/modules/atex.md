# ATEX

Le module **ATEX** permet de gérer les équipements installés en zones à risque d'explosion (atmosphères explosives).

---

## Présentation

![Vue ATEX](../assets/screenshots/atex-overview.png)
<!-- Capture d'écran recommandée : Page principale du module ATEX -->

La réglementation ATEX impose une gestion rigoureuse des équipements en zones explosives. Ce module permet de :

- **Inventorier** les équipements ATEX
- **Vérifier** la conformité des certifications
- **Planifier** les contrôles périodiques
- **Documenter** les inspections
- **Visualiser** les zones sur plans

---

## Qu'est-ce que l'ATEX ?

### Définition

**ATEX** = **AT**mosphères **EX**plosives

Les directives ATEX (94/9/CE et 99/92/CE) encadrent :
- La fabrication des équipements pour zones explosives
- L'utilisation de ces équipements sur les sites

### Zones explosives

#### Gaz et vapeurs

| Zone | Définition | Fréquence |
|------|------------|-----------|
| **Zone 0** | ATEX permanente ou fréquente | > 1000 h/an |
| **Zone 1** | ATEX occasionnelle | 10 à 1000 h/an |
| **Zone 2** | ATEX rare et de courte durée | < 10 h/an |

#### Poussières combustibles

| Zone | Définition | Fréquence |
|------|------------|-----------|
| **Zone 20** | ATEX permanente ou fréquente | > 1000 h/an |
| **Zone 21** | ATEX occasionnelle | 10 à 1000 h/an |
| **Zone 22** | ATEX rare et de courte durée | < 10 h/an |

---

## Accéder au module

1. Tableau de bord → **Utilitaires & Outils**
2. Cliquez sur **ATEX**

---

## Interface du module

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue synthétique, statistiques, alertes |
| **Équipements** | Liste des équipements ATEX |
| **Plans** | Cartographie des zones ATEX |
| **Calendrier** | Planning des contrôles |
| **Analyse** | Graphiques et indicateurs |

### Tableau de bord ATEX

![Dashboard ATEX](../assets/screenshots/atex-dashboard.png)
<!-- Capture d'écran recommandée : Le dashboard avec les statistiques -->

Indicateurs affichés :
- Total équipements
- Conformes / Non conformes
- Contrôles en retard
- À faire sous 30 jours
- Répartition par zone

---

## Équipements ATEX

### Caractéristiques d'un équipement ATEX

![Fiche ATEX](../assets/screenshots/atex-equipment-detail.png)
<!-- Capture d'écran recommandée : Fiche détaillée d'un équipement ATEX -->

#### Identification

| Champ | Description | Exemple |
|-------|-------------|---------|
| **TAG** | Identifiant unique | ATEX-BAT-A-001 |
| **Désignation** | Description | Moteur pompe transfert |
| **N° certificat** | Référence ATEX | INERIS 12 ATEX 0025 X |

#### Localisation

| Champ | Description |
|-------|-------------|
| **Bâtiment** | Localisation principale |
| **Zone** | Zone du bâtiment |
| **Zone ATEX gaz** | 0, 1 ou 2 |
| **Zone ATEX poussières** | 20, 21 ou 22 |

#### Marquage ATEX

Le marquage complet selon la directive :

```
⟨Ex⟩ II 2 G Ex d IIB T4 Gb
```

| Élément | Signification |
|---------|---------------|
| **⟨Ex⟩** | Marquage CE ATEX |
| **II** | Groupe (II = industries de surface) |
| **2** | Catégorie (2 = zone 1 ou 21) |
| **G** | Atmosphère (G = gaz, D = poussières) |
| **Ex d** | Mode de protection |
| **IIB** | Groupe de gaz |
| **T4** | Classe de température |
| **Gb** | Niveau de protection |

#### Modes de protection

| Code | Mode | Description |
|------|------|-------------|
| **d** | Enveloppe antidéflagrante | Contient l'explosion |
| **e** | Sécurité augmentée | Évite les étincelles |
| **i** | Sécurité intrinsèque | Énergie limitée |
| **p** | Surpression interne | Gaz inerte |
| **m** | Encapsulage | Noyé dans résine |
| **o** | Immersion dans huile | Bain d'huile |
| **q** | Remplissage pulvérulent | Sable, quartz |
| **n** | Non incendiaire | Zone 2 uniquement |

#### Groupes de gaz

| Groupe | Gaz typiques | MESG (mm) |
|--------|--------------|-----------|
| **IIA** | Propane, butane, essence | > 0.9 |
| **IIB** | Éthylène, éther | 0.5 - 0.9 |
| **IIC** | Hydrogène, acétylène | < 0.5 |

#### Classes de température

| Classe | T° max surface | Gaz typiques |
|--------|----------------|--------------|
| **T1** | 450°C | Hydrogène |
| **T2** | 300°C | Acétylène |
| **T3** | 200°C | Essence |
| **T4** | 135°C | Acétaldéhyde |
| **T5** | 100°C | - |
| **T6** | 85°C | Disulfure de carbone |

---

## Créer un équipement ATEX

### Formulaire de création

1. **+ Nouveau** dans la liste
2. Remplir les sections :

#### Section Identification

- TAG (obligatoire)
- Désignation
- N° certificat ATEX

#### Section Localisation

- Bâtiment
- Zone / Local
- Zone ATEX gaz (0, 1, 2 ou Non concerné)
- Zone ATEX poussières (20, 21, 22 ou Non concerné)

#### Section Marquage

- Groupe (I ou II)
- Catégorie (1, 2 ou 3)
- Atmosphère (G et/ou D)
- Mode(s) de protection
- Groupe de gaz
- Classe de température

#### Section Contrôles

- Périodicité (généralement annuelle)
- Date du dernier contrôle
- Prochaine échéance

### Documents à attacher

- **Certificat ATEX** : Document officiel
- **Attestation de conformité** : Déclaration fabricant
- **Notice** : Instructions d'utilisation en zone ATEX
- **Photos** : Plaque signalétique, marquage

---

## Contrôles ATEX

### Réglementation

Les contrôles des équipements ATEX sont obligatoires (arrêté du 8 juillet 2003).

### Types d'inspection

| Type | Description | Fréquence |
|------|-------------|-----------|
| **Visuelle** | Sans outil, équipement en service | Continue |
| **Rapprochée** | Avec outils simples | Périodique |
| **Détaillée** | Avec démontage partiel | Selon besoin |

### Checklist de contrôle

#### Vérifications générales

- [ ] Marquage lisible et conforme
- [ ] Pas de modification non autorisée
- [ ] Câbles et presse-étoupes conformes
- [ ] Enveloppe intègre (pas de fissure, corrosion)
- [ ] Boulonnerie complète et serrée

#### Mode "d" (antidéflagrante)

- [ ] Joints de bride en bon état
- [ ] Surfaces d'accouplement propres
- [ ] Couvercles correctement serrés

#### Mode "e" (sécurité augmentée)

- [ ] Bornes propres et serrées
- [ ] Distances d'isolement respectées
- [ ] Ventilation correcte

#### Mode "i" (sécurité intrinsèque)

- [ ] Câbles séparés des autres circuits
- [ ] Barrières de sécurité en place
- [ ] Mise à la terre conforme

### Enregistrer un contrôle

1. Fiche équipement → **Ajouter un contrôle**
2. Type : Inspection ATEX
3. Résultat : Conforme / Non conforme
4. Observations détaillées
5. Photos des anomalies
6. Prochaine échéance

---

## Gestion des non-conformités

### Niveaux de gravité

| Niveau | Description | Action |
|--------|-------------|--------|
| **Critique** | Risque immédiat | Arrêt immédiat |
| **Majeure** | Risque potentiel | Correction sous 30 jours |
| **Mineure** | Écart sans risque immédiat | Correction planifiée |

### Suivi des actions

Pour chaque non-conformité :
1. Documenter l'écart
2. Définir l'action corrective
3. Attribuer un responsable
4. Fixer une échéance
5. Vérifier la correction

---

## Cartographie des zones

### Plans ATEX

![Carte ATEX](../assets/screenshots/atex-map.png)
<!-- Capture d'écran recommandée : Vue cartographique avec zonage ATEX -->

L'onglet **Plans** permet de :

- Visualiser le zonage ATEX
- Positionner les équipements sur les plans
- Identifier les zones par couleur

### Code couleur

| Couleur | Zone |
|---------|------|
| 🔴 Rouge | Zone 0 / 20 |
| 🟠 Orange | Zone 1 / 21 |
| 🟡 Jaune | Zone 2 / 22 |
| ⚪ Blanc | Hors zone |

### Importer un plan

1. Onglet **Plans** → **Ajouter un plan**
2. Chargez le fichier (PDF ou image)
3. Nommez le plan (ex: "Bâtiment A - RDC - Zonage ATEX")
4. Le plan est disponible pour positionner les équipements

---

## DRPCE

### Document Relatif à la Protection Contre les Explosions

Le module peut aider à documenter le DRPCE :

- Inventaire des zones ATEX
- Liste des équipements par zone
- Historique des contrôles
- Actions correctives

### Export pour le DRPCE

1. Onglet **Analyse** → **Export DRPCE**
2. Sélectionnez la période
3. Générez le rapport

---

## Analyse IA

Le module propose une analyse automatique par IA :

### Vérification de cohérence

- Le mode de protection est-il adapté à la zone ?
- La classe de température est-elle suffisante ?
- Le groupe de gaz est-il compatible ?

### Suggestions

L'IA peut suggérer :
- Des contrôles supplémentaires
- Des remplacements d'équipements
- Des améliorations du zonage

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
ATEX-[BATIMENT]-[ZONE]-[NUMERO]
```

Exemples :
- `ATEX-A-Z1-001` : Équipement zone 1 bâtiment A
- `ATEX-B-Z2-015` : Équipement zone 2 bâtiment B

### Documentation

- Conservez les certificats originaux
- Photographiez systématiquement le marquage
- Archivez les modifications (réparations ATEX)

### Formation

- Sensibilisez le personnel aux risques ATEX
- Formez les intervenants (voir [Formation ATEX](./formation-atex.md))
- Affichez les consignes de sécurité

---

## FAQ

### Comment vérifier si un équipement est compatible avec une zone ?

Comparez le marquage :
- Catégorie 1 → Zones 0, 1, 2 (ou 20, 21, 22)
- Catégorie 2 → Zones 1, 2 (ou 21, 22)
- Catégorie 3 → Zone 2 (ou 22) uniquement

### Que faire si le marquage est illisible ?

L'équipement doit être déclassé jusqu'à identification. Contactez le fabricant avec le numéro de série.

### Les équipements non-électriques sont-ils concernés ?

Oui, les équipements mécaniques peuvent aussi générer des étincelles ou des surfaces chaudes.

---

## Voir aussi

- [Formation ATEX](./formation-atex.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
- [Cartographie](../fonctionnalites-communes/cartographie.md)
