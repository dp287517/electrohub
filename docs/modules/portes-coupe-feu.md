# Portes coupe-feu

Le module **Portes coupe-feu** permet de gérer les contrôles annuels des blocs-portes et dispositifs coupe-feu de vos installations.

---

## Présentation

![Vue Portes CF](../assets/screenshots/doors-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Portes coupe-feu -->

Les portes coupe-feu sont des éléments essentiels de la sécurité incendie. Ce module permet de :

- **Inventorier** toutes les portes coupe-feu
- **Planifier** les contrôles annuels obligatoires
- **Documenter** les non-conformités
- **Générer** des QR codes pour identification terrain
- **Suivre** les actions correctives

---

## Réglementation

Les portes coupe-feu doivent être contrôlées régulièrement selon la réglementation :

- **Code du travail** : Articles R4227-1 et suivants
- **ERP** : Règlement de sécurité contre l'incendie
- **APSAD** : Règles techniques

### Fréquence des contrôles

| Type d'établissement | Fréquence minimale |
|---------------------|-------------------|
| ERP | Annuelle |
| Industrie / Tertiaire | Annuelle recommandée |
| ICPE | Selon arrêté préfectoral |

---

## Accéder au module

1. Tableau de bord → **Utilitaires & Outils**
2. Cliquez sur **Fire Doors**

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue d'ensemble, statistiques |
| **Liste** | Inventaire des portes |
| **Carte** | Localisation sur plans |
| **Calendrier** | Planning des contrôles |

### Vue Dashboard

![Dashboard Portes](../assets/screenshots/doors-dashboard.png)
<!-- Capture d'écran recommandée : Tableau de bord avec statistiques -->

Indicateurs :
- Nombre total de portes
- Conformes / Non conformes
- Contrôles en retard
- À contrôler sous 30 jours

---

## Caractéristiques d'une porte

### Informations générales

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Référence** | Identifiant unique | PCF-A-RDC-001 |
| **Désignation** | Description | Porte local technique |
| **Bâtiment** | Localisation | Bâtiment A |
| **Étage** | Niveau | RDC |
| **Local** | Pièce | Couloir 1 |

### Caractéristiques techniques

| Champ | Description | Valeurs |
|-------|-------------|---------|
| **Type** | Configuration | Simple, Double, Coulissante |
| **Résistance au feu** | Classement | EI30, EI60, EI90, EI120 |
| **Dimensions** | Largeur x Hauteur | 900 x 2100 mm |
| **Sens d'ouverture** | Direction | Poussant / Tirant |
| **Ferme-porte** | Équipement | Oui / Non |
| **Sélecteur de fermeture** | Pour doubles | Oui / Non |

### Classification EI

| Classement | Résistance | Usage typique |
|------------|------------|---------------|
| **EI30** | 30 minutes | Locaux techniques |
| **EI60** | 60 minutes | Circulations |
| **EI90** | 90 minutes | Coupe-feu de compartimentage |
| **EI120** | 120 minutes | Haute protection |

> **E** = Étanchéité aux flammes
> **I** = Isolation thermique

---

## Créer une porte

### Formulaire de création

![Formulaire porte](../assets/screenshots/doors-create-form.png)
<!-- Capture d'écran recommandée : Formulaire de création d'une porte -->

1. **+ Nouvelle porte** dans la liste
2. Remplir les sections :

#### Identification

- Référence (obligatoire)
- Désignation
- Bâtiment (obligatoire)
- Étage / Zone
- Local

#### Caractéristiques

- Type de porte
- Résistance au feu
- Dimensions
- Équipements (ferme-porte, sélecteur)

#### Contrôles

- Périodicité (12 mois par défaut)
- Date du dernier contrôle
- Prochaine échéance

#### Photos

- Photo de la porte fermée
- Photo de la plaque signalétique
- Photo du PV de classement

---

## Contrôles annuels

### Points de vérification

Le contrôle annuel doit vérifier :

#### État général

- [ ] Porte en bon état (pas de déformation, fissure)
- [ ] Huisserie correctement fixée
- [ ] Pas de jour excessif (joints)
- [ ] Serrure fonctionnelle

#### Fermeture

- [ ] Ferme-porte fonctionnel
- [ ] Fermeture complète automatique
- [ ] Vitesse de fermeture adaptée
- [ ] Sélecteur de fermeture (doubles portes)

#### Signalétique

- [ ] Plaque d'identification présente
- [ ] Mention "Porte coupe-feu" visible
- [ ] Consigne "Maintenir fermée" (si applicable)

#### Quincaillerie

- [ ] Poignées en bon état
- [ ] Paumelles non grippées
- [ ] Verrous fonctionnels

### Enregistrer un contrôle

1. Fiche porte → **Ajouter un contrôle**
2. Renseignez :
   - Date du contrôle
   - Contrôleur
   - Résultat global
   - Points vérifiés (checklist)
   - Observations
   - Photos des anomalies
3. Prochaine échéance (12 mois)

---

## Gestion des non-conformités

### Types d'anomalies courantes

| Anomalie | Gravité | Action |
|----------|---------|--------|
| Joint décollé | Mineure | Remplacer le joint |
| Ferme-porte HS | Majeure | Remplacer sous 30j |
| Porte déformée | Critique | Condamner et remplacer |
| Plaque absente | Mineure | Poser nouvelle plaque |
| Jour excessif | Majeure | Régler ou remplacer |

### Suivi des actions

Pour chaque non-conformité :

1. **Documenter** : Description, photo
2. **Qualifier** : Niveau de gravité
3. **Planifier** : Action corrective, échéance
4. **Attribuer** : Responsable
5. **Clôturer** : Vérification après correction

---

## QR Codes

### Génération

Chaque porte peut avoir un QR code :

1. Fiche porte → **Générer QR Code**
2. Le QR code est créé
3. Téléchargez pour impression

![QR Code porte](../assets/screenshots/doors-qrcode.png)
<!-- Capture d'écran recommandée : Exemple de QR code généré -->

### Utilisation terrain

- Collez le QR code sur ou près de la porte
- Scannez avec un smartphone
- Accédez directement à la fiche dans ElectroHub
- Visualisez l'historique et le statut

### Avantages

- Identification rapide sur le terrain
- Accès instantané aux informations
- Facilite les rondes de contrôle

---

## Vue cartographique

![Carte Portes](../assets/screenshots/doors-map.png)
<!-- Capture d'écran recommandée : Vue carte avec les portes positionnées -->

L'onglet **Carte** permet de :

### Visualiser les portes

- Marqueurs sur les plans d'étage
- Code couleur selon le statut
- Info-bulle avec détails

### Positionner une porte

1. Sélectionnez le plan (bâtiment, étage)
2. Cliquez sur **Positionner**
3. Cliquez sur l'emplacement de la porte
4. Le marqueur est enregistré

### Légende

| Couleur | Statut |
|---------|--------|
| 🟢 Vert | Conforme, prochain contrôle > 30j |
| 🟠 Orange | Contrôle à venir < 30j |
| 🔴 Rouge | En retard ou non conforme |

---

## Export et rapports

### Rapport de contrôle

1. Fiche porte → **Exporter PDF**
2. Le rapport contient :
   - Identification de la porte
   - Caractéristiques techniques
   - Historique des contrôles
   - Photos
   - Non-conformités en cours

### Export Excel

1. Liste → **Exporter**
2. Obtenez un fichier Excel avec :
   - Inventaire complet
   - Statut de chaque porte
   - Dates de contrôle
   - Non-conformités

### Synthèse annuelle

Générez un rapport de synthèse pour :
- Le registre de sécurité
- Les audits externes
- Le suivi réglementaire

---

## Intégration SAP

Si votre site utilise SAP pour la maintenance :

### Création d'ordres de travail

Les non-conformités peuvent générer des demandes dans SAP :

1. Non-conformité détectée
2. Fiche NC → **Créer OT SAP** (si configuré)
3. L'ordre est créé dans SAP

### Synchronisation

- Les statuts peuvent être synchronisés
- L'historique est tracé dans les deux systèmes

> Voir [DCF SAP](./dcf-sap.md) pour la configuration

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
PCF-[BATIMENT]-[ETAGE]-[NUMERO]
```

Exemples :
- `PCF-A-RDC-001` : Porte bâtiment A, RDC, n°1
- `PCF-B-N2-015` : Porte bâtiment B, niveau 2, n°15

### Documentation

- Photographiez chaque porte lors du premier inventaire
- Conservez les PV de classement au feu
- Archivez les attestations de maintenance

### Terrain

- Posez les QR codes de manière visible
- Formez le personnel à signaler les anomalies
- Vérifiez que les portes ne sont pas calées ouvertes

---

## FAQ

### À quelle fréquence contrôler les portes ?

Au minimum une fois par an. Plus fréquemment si beaucoup de passage.

### Qui peut effectuer les contrôles ?

Personnel formé interne ou organisme externe. Les contrôles réglementaires nécessitent souvent un organisme agréé.

### Comment gérer une porte bloquée ouverte ?

1. Documenter la non-conformité (photo)
2. Qualifier en gravité "Majeure" ou "Critique"
3. Demander la correction immédiate
4. Informer le responsable sécurité

---

## Voir aussi

- [DCF SAP](./dcf-sap.md)
- [Cartographie](../fonctionnalites-communes/cartographie.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
