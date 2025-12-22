# Sélectivité

Le module **Sélectivité** permet de documenter et vérifier la coordination des protections électriques.

---

## Présentation

![Vue Sélectivité](../assets/screenshots/selectivity-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Sélectivité -->

La sélectivité des protections est essentielle pour :

- **Limiter** l'impact des défauts (coupure minimale)
- **Garantir** la continuité de service
- **Protéger** les installations et les personnes
- **Faciliter** la localisation des défauts

---

## Qu'est-ce que la sélectivité ?

### Définition

La sélectivité est la capacité d'une installation électrique à isoler uniquement la partie en défaut, tout en maintenant l'alimentation des autres parties saines.

### Types de sélectivité

| Type | Description |
|------|-------------|
| **Ampèremétrique** | Basée sur les seuils de courant |
| **Chronométrique** | Basée sur les temporisations |
| **Logique (ZSI)** | Communication entre protections |
| **Différentielle** | Basée sur les seuils différentiels |
| **Par zone** | Découpage en zones de protection |

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Selectivity**

---

## Interface

### Vue principale

Le module présente :

- **Schéma de l'installation** : Vue hiérarchique des protections
- **Tables de sélectivité** : Coordination entre protections
- **Études** : Documents de référence

### Onglets

| Onglet | Description |
|--------|-------------|
| **Schéma** | Vue arborescente des protections |
| **Tables** | Tables de sélectivité constructeur |
| **Études** | Documents d'étude |
| **Réglages** | Paramètres des protections |

---

## Arborescence des protections

### Représentation

```
Arrivée TGBT (DPX 1600A - 50kA)
├── Départ Atelier (DPX 630A - 36kA)
│   ├── Machine 1 (NSX 100A - 25kA)
│   ├── Machine 2 (NSX 100A - 25kA)
│   └── Éclairage (iC60 16A - 6kA)
├── Départ Bureaux (DPX 250A - 36kA)
│   ├── Prises (iC60 20A - 6kA)
│   └── Clim (iC60 32A - 6kA)
└── Départ Stockage (NSX 160A - 36kA)
```

### Informations par protection

| Champ | Description |
|-------|-------------|
| **Référence** | Type de disjoncteur |
| **Calibre** | Courant nominal (A) |
| **Pdc** | Pouvoir de coupure (kA) |
| **Réglages** | Ir, Isd, Ii, Ig |
| **Amont** | Protection amont |
| **Aval** | Protection(s) aval |

---

## Réglages des protections

### Paramètres types (disjoncteur électronique)

| Paramètre | Description | Plage typique |
|-----------|-------------|---------------|
| **Ir** | Seuil thermique (Long Retard) | 0.4 - 1 × In |
| **tr** | Temporisation thermique | 5 - 30 s |
| **Isd** | Seuil court-retard | 2 - 10 × Ir |
| **tsd** | Temporisation court-retard | 0 - 0.5 s |
| **Ii** | Seuil instantané | 2 - 15 × In |
| **Ig** | Seuil terre | 0.2 - 1 × In |
| **tg** | Temporisation terre | 0 - 1 s |

### Documenter les réglages

1. Sélectionnez la protection dans l'arborescence
2. Cliquez sur **Modifier les réglages**
3. Renseignez les valeurs actuelles
4. Enregistrez

---

## Vérification de la sélectivité

### Tables constructeur

Les tables de sélectivité permettent de vérifier la coordination :

![Table sélectivité](../assets/screenshots/selectivity-table.png)
<!-- Capture d'écran recommandée : Exemple de table de sélectivité -->

Lecture de la table :
- **T** : Sélectivité totale
- **P** : Sélectivité partielle (limite en kA)
- **N** : Non sélectif

### Études de sélectivité

Importez vos études réalisées avec des logiciels spécialisés :
- Fichiers PDF
- Rapports d'étude
- Courbes de déclenchement

---

## Coordination des protections

### Règles de base

#### Sélectivité ampèremétrique

Le rapport des seuils instantanés doit être suffisant :
- **Règle** : Ii amont > 1.6 × Ii aval

#### Sélectivité chronométrique

Écart de temporisation entre amont et aval :
- **Règle** : Δt > temps de coupure aval + marge

#### Sélectivité différentielle

Décalage des seuils et temporisations :
- IΔn amont > 3 × IΔn aval
- t amont > t aval

### Vérification

1. Identifiez la cascade de protections
2. Comparez les réglages
3. Vérifiez avec les tables constructeur
4. Documentez les résultats

---

## Documentation

### Créer une étude

1. Onglet **Études** → **Nouvelle étude**
2. Renseignez :
   - Titre de l'étude
   - Périmètre (tableau, installation)
   - Date
   - Auteur
3. Attachez les documents :
   - Rapport d'étude
   - Schémas unifilaires
   - Tables de sélectivité
   - Courbes

### Contenu type d'une étude

- Présentation de l'installation
- Hypothèses (Icc, paramètres)
- Choix des protections
- Réglages préconisés
- Vérification de la sélectivité
- Conclusions et limites

---

## Lien avec d'autres modules

### Tableaux électriques

La sélectivité est liée aux tableaux :
- Chaque protection appartient à un tableau
- La hiérarchie suit l'architecture de l'installation

### Courant de défaut

Les études de sélectivité utilisent les valeurs d'Icc :
- Icc3 (triphasé)
- Icc2 (biphasé)
- Icc1 (monophasé)

> Voir [Courant de défaut](./courant-defaut.md)

### Arc Flash

La sélectivité impacte l'énergie incidente :
- Temporisations → durée du défaut
- Durée → énergie incidente

> Voir [Arc Flash](./arc-flash.md)

---

## Bonnes pratiques

### Conception

- Étudiez la sélectivité dès la conception
- Privilégiez les gammes offrant de bonnes performances
- Considérez la sélectivité logique pour les installations critiques

### Documentation

- Conservez les études d'origine
- Mettez à jour après chaque modification
- Archivez les réglages actuels

### Maintenance

- Vérifiez les réglages après intervention
- Documentez les modifications
- Refaites l'étude si changements majeurs

---

## FAQ

### Quelle différence entre sélectivité totale et partielle ?

- **Totale** : Sélectivité assurée jusqu'au Pdc du disjoncteur aval
- **Partielle** : Sélectivité assurée jusqu'à une limite d'Icc

### Faut-il refaire l'étude après changement de disjoncteur ?

Oui, si les caractéristiques changent significativement.

### Comment améliorer la sélectivité d'une installation existante ?

- Ajuster les réglages (si réglables)
- Remplacer les protections
- Utiliser la sélectivité logique

---

## Voir aussi

- [Tableaux électriques](./tableaux-electriques.md)
- [Courant de défaut](./courant-defaut.md)
- [Arc Flash](./arc-flash.md)
