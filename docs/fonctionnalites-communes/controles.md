# Contrôles périodiques

Les contrôles périodiques sont au cœur d'ElectroHub. Cette page explique comment les gérer efficacement.

---

## Présentation

Les contrôles permettent de :

- **Vérifier** l'état des équipements
- **Documenter** les inspections
- **Planifier** les prochaines échéances
- **Tracer** l'historique des interventions

---

## Cycle de contrôle

```
Planification → Réalisation → Enregistrement → Analyse → Planification...
```

### États des contrôles

| État | Couleur | Description |
|------|---------|-------------|
| **À faire** | 🟢 Vert | Prochain contrôle > 30 jours |
| **Sous 30j** | 🟠 Orange | Contrôle dans les 30 prochains jours |
| **En retard** | 🔴 Rouge | Date de contrôle dépassée |
| **Fait** | 🔵 Bleu | Contrôle récemment effectué |

---

## Types de contrôles

### Par fréquence

| Fréquence | Usage typique |
|-----------|---------------|
| **Quotidien** | Rondes, inspections visuelles |
| **Hebdomadaire** | Vérifications de fonctionnement |
| **Mensuel** | Contrôles visuels approfondis |
| **Trimestriel** | Contrôles fonctionnels |
| **Semestriel** | Vérifications intermédiaires |
| **Annuel** | Contrôles réglementaires |
| **5 ans** | Vérifications approfondies |

### Par nature

| Type | Description |
|------|-------------|
| **Visuel** | Inspection sans outil |
| **Fonctionnel** | Test de fonctionnement |
| **Mesure** | Avec appareils de mesure |
| **Réglementaire** | Selon la réglementation |
| **Approfondi** | Démontage, analyse détaillée |

---

## Planifier un contrôle

### Configuration initiale

Lors de la création d'un équipement :

1. Définissez la **périodicité** (mensuel, annuel...)
2. Indiquez la date du **dernier contrôle** (si existant)
3. Le système calcule le **prochain contrôle**

### Calcul automatique

```
Prochain contrôle = Dernier contrôle + Périodicité
```

Exemple :
- Dernier contrôle : 15/01/2024
- Périodicité : 12 mois
- Prochain contrôle : 15/01/2025

### Modifier la planification

1. Ouvrez la fiche de l'équipement
2. Section **Contrôles**
3. Modifiez la périodicité ou la date

---

## Effectuer un contrôle

### Accès au formulaire

**Méthode 1** : Depuis la fiche équipement
1. Ouvrez la fiche
2. Cliquez sur **Ajouter un contrôle**

**Méthode 2** : Depuis le calendrier
1. Cliquez sur l'équipement planifié
2. Cliquez sur **Effectuer le contrôle**

**Méthode 3** : Contrôle rapide
1. Dans la liste, cliquez sur l'icône ✓
2. Confirmez le contrôle

### Formulaire de contrôle

![Formulaire de contrôle](../assets/screenshots/check-form.png)
<!-- Capture d'écran recommandée : Formulaire d'enregistrement de contrôle -->

| Section | Champs |
|---------|--------|
| **Informations** | Date, type, contrôleur |
| **Résultat** | Conforme / Non conforme |
| **Observations** | Notes et remarques |
| **Mesures** | Valeurs mesurées (selon type) |
| **Photos** | Documentation visuelle |
| **Prochaine échéance** | Date du prochain contrôle |

### Champs obligatoires

- Date du contrôle
- Résultat (Conforme / Non conforme)
- Prochaine échéance (ou recalcul automatique)

---

## Documenter les observations

### Bonnes pratiques

- Décrivez précisément les constats
- Notez les valeurs mesurées
- Mentionnez les écarts par rapport à la normale
- Indiquez les actions recommandées

### Exemple de rédaction

**Observation bien rédigée** :
> "Léger échauffement détecté sur le contacteur Q12 (45°C, normal < 40°C). Serrage des connexions effectué. À surveiller au prochain contrôle."

**Observation insuffisante** :
> "RAS"

---

## Joindre des photos

### Importance des photos

Les photos permettent de :
- Documenter l'état visuel
- Prouver les constats
- Comparer l'évolution dans le temps
- Faciliter l'analyse à distance

### Comment ajouter des photos

1. Section **Photos** du formulaire
2. Cliquez sur **Ajouter** ou glissez-déposez
3. Formats acceptés : PNG, JPG

### Conseils photo

- Photographiez les plaques signalétiques
- Capturez les anomalies détectées
- Incluez des repères visuels
- Assurez une bonne luminosité

---

## Résultats et suivi

### Contrôle conforme

- L'équipement passe au statut "À faire"
- La prochaine échéance est calculée
- L'historique est mis à jour

### Contrôle non conforme

1. Décrivez la non-conformité
2. Qualifiez la gravité (mineure, majeure, critique)
3. Définissez les actions correctives
4. Planifiez le suivi

### Actions correctives

| Gravité | Délai typique | Action |
|---------|---------------|--------|
| **Mineure** | 30-90 jours | Correction planifiée |
| **Majeure** | 7-30 jours | Correction prioritaire |
| **Critique** | Immédiat | Mise hors service |

---

## Calendrier des contrôles

### Vue calendrier

![Calendrier des contrôles](../assets/screenshots/calendar-controls.png)
<!-- Capture d'écran recommandée : Vue calendrier mensuelle -->

Le calendrier affiche :
- Contrôles planifiés
- Contrôles en retard
- Contrôles effectués

### Filtres

- Par équipement
- Par statut
- Par type de contrôle
- Par période

### Export

Exportez le calendrier pour planification :
- Format PDF
- Format Excel

---

## Historique des contrôles

### Consulter l'historique

1. Fiche de l'équipement
2. Section **Historique** ou onglet **Contrôles**
3. Liste chronologique des contrôles

### Informations disponibles

| Donnée | Description |
|--------|-------------|
| **Date** | Date du contrôle |
| **Type** | Nature du contrôle |
| **Résultat** | Conforme / Non conforme |
| **Contrôleur** | Qui a effectué |
| **Observations** | Notes enregistrées |
| **Documents** | Photos et fichiers |

### Export de l'historique

Générez un rapport d'historique :
- Toutes les interventions
- Graphiques d'évolution
- Statistiques

---

## Alertes et notifications

### Alertes automatiques

Le système alerte sur :
- Contrôles arrivant à échéance (J-30, J-7)
- Contrôles en retard
- Non-conformités non clôturées

### Visualisation

Les alertes apparaissent :
- Sur le tableau de bord (badges)
- Dans le module concerné
- Par email (si configuré)

---

## Statistiques

### Indicateurs clés

| Indicateur | Description |
|------------|-------------|
| **Taux de conformité** | % équipements conformes |
| **Retard moyen** | Jours de retard moyen |
| **Contrôles effectués** | Nombre par période |
| **Non-conformités** | Nombre et tendance |

### Graphiques

- Évolution du taux de conformité
- Répartition par statut
- Tendance des non-conformités

---

## Bonnes pratiques

### Planification

- Respectez les périodicités réglementaires
- Anticipez les périodes chargées
- Regroupez les contrôles par zone

### Réalisation

- Utilisez des checklists
- Documentez systématiquement
- Photographiez les anomalies
- Renseignez les observations

### Suivi

- Traitez les non-conformités rapidement
- Analysez les tendances
- Améliorez les processus

---

## FAQ

### Comment modifier un contrôle déjà enregistré ?

Ouvrez l'historique, cliquez sur le contrôle, puis **Modifier**.

### Puis-je antidater un contrôle ?

Oui, indiquez la date réelle dans le formulaire.

### Comment gérer un contrôle effectué par un externe ?

Enregistrez-le de la même façon, en notant l'intervenant dans les observations.

### Que faire si la périodicité change ?

Modifiez la périodicité dans la fiche équipement. Le prochain contrôle sera recalculé.

---

## Voir aussi

- [Historique et audit](./historique.md)
- [Export PDF et Excel](./exports.md)
