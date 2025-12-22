# Projets

Le module **Projets** permet de gérer les projets électriques : études, chiffrages, et suivi financier.

---

## Présentation

![Vue Projets](../assets/screenshots/projects-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Projets -->

Ce module aide à structurer vos projets électriques :

- **Business case** : Justification économique
- **Chiffrage** : Estimation des coûts
- **WBS** : Structure de découpage
- **Offres** : Comparaison des devis

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Project**

---

## Cycle de vie d'un projet

```
Idée → Étude → Chiffrage → Validation → Réalisation → Clôture
```

### États du projet

| État | Description |
|------|-------------|
| **Brouillon** | En cours de définition |
| **À valider** | Soumis pour approbation |
| **Validé** | Approuvé, en attente |
| **En cours** | Réalisation active |
| **Terminé** | Projet achevé |
| **Annulé** | Projet abandonné |

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Liste** | Tous les projets |
| **Kanban** | Vue par état |
| **Calendrier** | Planning des projets |
| **Budget** | Synthèse financière |

---

## Créer un projet

### Informations générales

| Champ | Description |
|-------|-------------|
| **Titre** | Nom du projet |
| **Description** | Objectifs et périmètre |
| **Responsable** | Chef de projet |
| **Priorité** | Haute, Moyenne, Basse |
| **Date cible** | Échéance souhaitée |

### Contexte

| Champ | Description |
|-------|-------------|
| **Site** | Localisation |
| **Équipements** | Installations concernées |
| **Justification** | Raison du projet |
| **Risques** | Risques identifiés |

### Budget prévisionnel

| Poste | Montant |
|-------|---------|
| Études | € |
| Matériel | € |
| Main d'œuvre | € |
| Sous-traitance | € |
| Divers | € |
| **Total** | € |

---

## Business case

### Contenu

Document justifiant l'investissement :

1. **Contexte** : Situation actuelle
2. **Problème** : Enjeux à résoudre
3. **Solution** : Proposition technique
4. **Bénéfices** : Gains attendus
5. **Coûts** : Investissement requis
6. **ROI** : Retour sur investissement

### Calcul du ROI

```
ROI = (Gains - Coûts) / Coûts × 100
```

Exemple :
- Investissement : 50 000 €
- Économies annuelles : 15 000 €
- Payback : 3.3 ans
- ROI à 5 ans : 50%

---

## Chiffrage

### Structure WBS

Décomposez le projet en lots :

```
Projet : Remplacement TGBT
├── Lot 1 : Études
│   ├── 1.1 : Étude technique
│   └── 1.2 : Plans d'exécution
├── Lot 2 : Matériel
│   ├── 2.1 : Tableau
│   ├── 2.2 : Appareillage
│   └── 2.3 : Câbles
├── Lot 3 : Installation
│   ├── 3.1 : Dépose ancien
│   ├── 3.2 : Pose nouveau
│   └── 3.3 : Raccordements
└── Lot 4 : Mise en service
    ├── 4.1 : Essais
    └── 4.2 : Formation
```

### Estimation des coûts

Pour chaque lot :

| Lot | Main d'œuvre | Matériel | Sous-traitance | Total |
|-----|--------------|----------|----------------|-------|
| Études | 5 000 € | - | 3 000 € | 8 000 € |
| Matériel | - | 35 000 € | - | 35 000 € |
| Installation | 8 000 € | 2 000 € | - | 10 000 € |
| Mise en service | 2 000 € | - | - | 2 000 € |
| **Total** | 15 000 € | 37 000 € | 3 000 € | 55 000 € |

---

## Gestion des offres

### Demandes de devis

Envoyez des demandes à plusieurs fournisseurs :

1. **Nouvelle demande**
2. Définissez le périmètre
3. Sélectionnez les fournisseurs
4. Joignez le cahier des charges
5. Envoyez

### Comparaison des offres

| Fournisseur | Montant | Délai | Notes |
|-------------|---------|-------|-------|
| Fournisseur A | 52 000 € | 8 sem | Garanti 2 ans |
| Fournisseur B | 48 000 € | 10 sem | Hors transport |
| Fournisseur C | 55 000 € | 6 sem | Tout inclus |

### Sélection

Documentez le choix :
- Critères de sélection
- Justification
- Négociations

---

## Suivi d'avancement

### Planning

Définissez les jalons :

| Jalon | Date prévue | Date réelle | Statut |
|-------|-------------|-------------|--------|
| Lancement | 01/03 | 01/03 | ✅ |
| Fin études | 15/03 | 20/03 | ✅ (retard) |
| Commande matériel | 25/03 | 25/03 | ✅ |
| Livraison | 30/04 | - | ⏳ |
| Installation | 15/05 | - | ⏳ |
| Mise en service | 30/05 | - | ⏳ |

### Suivi budget

Comparez prévu vs réel :

| Poste | Budget | Engagé | Réel | Écart |
|-------|--------|--------|------|-------|
| Études | 8 000 € | 8 000 € | 9 200 € | +1 200 € |
| Matériel | 35 000 € | 33 000 € | - | -2 000 € |
| ... | ... | ... | ... | ... |

---

## Documents

### Documents types

- **Cahier des charges** : Spécifications
- **Devis** : Offres fournisseurs
- **Bon de commande** : Engagement
- **PV de réception** : Validation finale
- **Factures** : Paiements

### Gestion documentaire

Attachez tous les documents au projet pour traçabilité.

---

## Clôture

### Checklist de clôture

- [ ] Travaux terminés
- [ ] PV de réception signé
- [ ] Documentation à jour
- [ ] Formation effectuée
- [ ] Factures payées
- [ ] Retour d'expérience documenté

### Bilan projet

Documentez :
- Respect du budget
- Respect des délais
- Problèmes rencontrés
- Leçons apprises

---

## Bonnes pratiques

### Définition

- Définissez clairement le périmètre
- Identifiez les risques tôt
- Impliquez les parties prenantes

### Suivi

- Mettez à jour régulièrement
- Communiquez sur l'avancement
- Anticipez les dérives

### Documentation

- Conservez tous les documents
- Tracez les décisions
- Capitalisez les retours d'expérience

---

## FAQ

### Comment créer un projet multi-sites ?

Créez un projet principal et des sous-projets par site.

### Peut-on lier un projet à des équipements ?

Oui, dans la section "Équipements concernés".

### Comment exporter le budget ?

Export Excel disponible depuis la vue Budget.

---

## Voir aussi

- [Obsolescence](./obsolescence.md)
- [Export](../fonctionnalites-communes/exports.md)
