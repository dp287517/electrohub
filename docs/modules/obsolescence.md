# Obsolescence

Le module **Obsolescence** permet de gérer le cycle de vie des équipements et de planifier leur remplacement.

---

## Présentation

![Vue Obsolescence](../assets/screenshots/obsolescence-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Obsolescence -->

La gestion de l'obsolescence est cruciale pour :

- **Anticiper** les remplacements avant les pannes
- **Budgétiser** les investissements
- **Sécuriser** la disponibilité des installations
- **Optimiser** les achats de pièces de rechange

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Obsolescence**

---

## États d'obsolescence

### Définition des états

| État | Description | Couleur |
|------|-------------|---------|
| **Actif** | Équipement supporté, pièces disponibles | 🟢 Vert |
| **En surveillance** | Fin de vie annoncée | 🟡 Jaune |
| **Obsolète** | Plus de support fabricant | 🟠 Orange |
| **Critique** | Plus de pièces, risque élevé | 🔴 Rouge |
| **Remplacé** | Équipement changé | 🔵 Bleu |

### Cycle de vie typique

```
Actif → En surveillance → Obsolète → Critique → Remplacé
        (2-5 ans)        (variable)   (urgent)
```

---

## Interface

### Vue Dashboard

![Dashboard Obsolescence](../assets/screenshots/obsolescence-dashboard.png)
<!-- Capture d'écran recommandée : Tableau de bord avec répartition par état -->

Indicateurs :
- Répartition par état (graphique)
- Équipements critiques
- Remplacements planifiés
- Budget prévisionnel

### Liste des équipements

Colonnes :
- Équipement (lien vers la fiche)
- Type
- Âge
- État d'obsolescence
- Criticité
- Remplacement prévu
- Actions

---

## Évaluer l'obsolescence

### Critères d'évaluation

| Critère | Description | Impact |
|---------|-------------|--------|
| **Âge** | Années depuis mise en service | Fort |
| **Support fabricant** | Disponibilité SAV | Fort |
| **Pièces de rechange** | Disponibilité et délai | Fort |
| **Fiabilité** | Historique de pannes | Moyen |
| **Performance** | Adéquation aux besoins | Moyen |
| **Réglementation** | Conformité aux normes | Fort |

### Matrice de criticité

| | Impact faible | Impact moyen | Impact fort |
|---|---|---|---|
| **Probabilité haute** | Moyen | Élevé | Critique |
| **Probabilité moyenne** | Faible | Moyen | Élevé |
| **Probabilité faible** | Très faible | Faible | Moyen |

---

## Créer une fiche obsolescence

### Depuis un équipement existant

1. Ouvrez la fiche d'un équipement (VSD, tableau, etc.)
2. Cliquez sur **Évaluer obsolescence**
3. Remplissez le formulaire

### Formulaire d'évaluation

![Formulaire obsolescence](../assets/screenshots/obsolescence-form.png)
<!-- Capture d'écran recommandée : Formulaire d'évaluation -->

#### Section État actuel

| Champ | Description |
|-------|-------------|
| **État** | Actif, En surveillance, Obsolète, Critique |
| **Date fin de vie** | Annoncée par le fabricant |
| **Disponibilité pièces** | Oui / Partielle / Non |
| **Support fabricant** | Actif / Limité / Arrêté |

#### Section Criticité

| Champ | Description |
|-------|-------------|
| **Impact arrêt** | Faible / Moyen / Élevé / Critique |
| **Redondance** | Équipement de secours disponible ? |
| **Délai remplacement** | Temps nécessaire |

#### Section Remplacement

| Champ | Description |
|-------|-------------|
| **Solution envisagée** | Équipement de remplacement |
| **Coût estimé** | Budget prévisionnel |
| **Date prévue** | Échéance de remplacement |

---

## Planification des remplacements

### Vue calendrier

![Calendrier remplacements](../assets/screenshots/obsolescence-calendar.png)
<!-- Capture d'écran recommandée : Vue calendrier des remplacements -->

Visualisez :
- Remplacements planifiés
- Échéances de fin de vie
- Budget par période

### Priorisation

Priorisez les remplacements selon :

1. **Criticité** : Impact sur la production
2. **Risque** : Probabilité de panne
3. **Coût** : Budget disponible
4. **Synergie** : Grouper les remplacements similaires

---

## Suivi budgétaire

### Budget par année

| Année | Équipements | Budget estimé | Réalisé |
|-------|-------------|---------------|---------|
| 2024 | 15 | 120 000 € | 95 000 € |
| 2025 | 22 | 180 000 € | En cours |
| 2026 | 18 | 150 000 € | Prévision |

### Export pour budget

1. **Exporter** → **Prévisions budgétaires**
2. Format Excel avec :
   - Liste des remplacements
   - Coûts estimés
   - Échéances
   - Criticité

---

## Actions de mitigation

En attendant le remplacement :

### Stock de pièces

- Identifier les pièces critiques
- Constituer un stock de sécurité
- Suivre les consommations

### Maintenance renforcée

- Augmenter la fréquence des contrôles
- Surveiller les signes de défaillance
- Documenter les interventions

### Solutions alternatives

- Identifier des fournisseurs alternatifs
- Évaluer la réparation vs remplacement
- Considérer le reconditionnement

---

## Analyse et reporting

### Graphiques disponibles

- **Répartition par état** : Camembert
- **Évolution dans le temps** : Courbe
- **Par type d'équipement** : Histogramme
- **Budget prévisionnel** : Barres empilées

### Rapports

#### Rapport de synthèse

Exportez un rapport PDF contenant :
- Vue d'ensemble du parc
- Équipements critiques
- Plan de remplacement
- Budget prévisionnel

#### Tableau de bord direction

Pour les comités d'investissement :
- Indicateurs clés
- Risques identifiés
- Propositions d'actions

---

## Intégration avec autres modules

### Lien avec les équipements

Chaque fiche d'obsolescence est liée à un équipement :
- Tableaux électriques
- Variateurs (VSD)
- Équipements mécaniques
- Haute Tension
- Équipements globaux

### Historique

L'historique de maintenance de l'équipement alimente l'analyse :
- Fréquence des pannes
- Coûts de maintenance
- Disponibilité

---

## Bonnes pratiques

### Veille fabricant

- Abonnez-vous aux newsletters fabricants
- Surveillez les annonces de fin de vie
- Participez aux formations produits

### Anticipation

- Évaluez l'obsolescence dès l'achat
- Prévoyez le remplacement à 10-15 ans
- Budgétisez progressivement

### Documentation

- Conservez les références exactes
- Notez les équivalences connues
- Documentez les retours d'expérience

---

## FAQ

### Comment définir la date de fin de vie ?

Basez-vous sur :
- Annonce officielle du fabricant
- Âge moyen des équipements similaires
- État technique constaté

### Faut-il remplacer un équipement obsolète qui fonctionne ?

Pas nécessairement immédiat, mais planifiez le remplacement et constituez un stock de pièces.

### Comment justifier le budget de remplacement ?

Présentez :
- Risques en cas de panne
- Coûts de maintenance actuels
- Gains attendus (fiabilité, énergie)

---

## Voir aussi

- [Tableaux électriques](./tableaux-electriques.md)
- [Variateurs (VSD)](./variateurs.md)
- [Équipements mécaniques](./equipements-mecaniques.md)
