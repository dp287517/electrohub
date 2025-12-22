# Concepts clés

Avant d'utiliser ElectroHub, il est important de comprendre quelques concepts fondamentaux qui structurent l'application.

---

## Organisation hiérarchique

ElectroHub organise les données selon une hiérarchie claire :

```
Entreprise (Company)
└── Site
    └── Bâtiment (Building)
        └── Étage / Zone
            └── Local / Pièce
                └── Équipement
```

### Entreprise (Company)

Le niveau le plus haut de l'organisation. Une entreprise peut posséder plusieurs sites industriels.

**Exemple** : *Pharma Industries SA*

### Site

Une implantation géographique de l'entreprise. Chaque site a ses propres équipements et équipes.

**Exemples** : *Usine de Nyon*, *Site de Genève*, *Entrepôt de Lausanne*

### Bâtiment

Une structure physique au sein d'un site.

**Exemples** : *Bâtiment A*, *Atelier mécanique*, *Station de pompage*

### Zone / Étage

Une subdivision d'un bâtiment.

**Exemples** : *RDC*, *Étage 1*, *Zone de production*, *Zone ATEX*

### Équipement

L'élément de base géré dans ElectroHub. Chaque équipement possède :

- Une identification unique (TAG, référence SAP...)
- Des caractéristiques techniques
- Un historique de maintenance
- Des documents associés

---

## Types d'équipements

ElectroHub gère différents types d'équipements, chacun avec ses spécificités :

### Tableaux électriques

![Exemple de tableau](../assets/screenshots/tableau-exemple.png)
<!-- Capture d'écran recommandée : Fiche d'un tableau électrique -->

Les armoires de distribution électrique contenant :
- Disjoncteurs
- Contacteurs
- Relais de protection
- Appareillage de mesure

### Équipements ATEX

Équipements certifiés pour fonctionner en atmosphères explosives :
- Mode de protection (Ex d, Ex e, Ex i...)
- Groupe de gaz (IIA, IIB, IIC)
- Classe de température (T1 à T6)
- Zone d'implantation (0, 1, 2 pour gaz ; 20, 21, 22 pour poussières)

### Variateurs de vitesse (VSD)

Convertisseurs de fréquence pour le contrôle des moteurs :
- Puissance nominale
- Tension d'alimentation
- Type de moteur associé
- Paramètres de configuration

### Portes coupe-feu

Éléments de sécurité incendie :
- Type de porte (simple, double, coulissante...)
- Degré de résistance au feu (EI30, EI60, EI120...)
- État de conformité
- Historique des contrôles annuels

---

## Cycle de vie et statuts

Chaque équipement passe par différents états tout au long de sa vie :

### Statuts de contrôle

| Statut | Signification | Couleur |
|--------|---------------|---------|
| **À faire** | Prochain contrôle dans plus de 30 jours | 🟢 Vert |
| **Sous 30j** | Contrôle à effectuer dans les 30 prochains jours | 🟠 Orange |
| **En retard** | Date de contrôle dépassée | 🔴 Rouge |
| **Fait** | Contrôle effectué récemment | 🔵 Bleu |

### États de conformité

| État | Description |
|------|-------------|
| **Conforme** | L'équipement répond aux exigences |
| **Non conforme** | Des écarts ont été identifiés |
| **En attente** | Conformité à évaluer |

### Cycle de vie (Obsolescence)

| Phase | Description |
|-------|-------------|
| **Actif** | Équipement en service, pièces disponibles |
| **En surveillance** | Fin de vie annoncée par le fabricant |
| **Obsolète** | Plus de support ni de pièces |
| **À remplacer** | Remplacement planifié |

---

## Contrôles périodiques

Les contrôles sont au cœur d'ElectroHub. Ils permettent de s'assurer du bon fonctionnement et de la conformité des équipements.

### Types de contrôles

| Type | Fréquence typique | Description |
|------|-------------------|-------------|
| **Visuel** | Mensuel | Inspection visuelle de l'état général |
| **Fonctionnel** | Trimestriel | Test de fonctionnement |
| **Réglementaire** | Annuel | Vérification selon la réglementation |
| **Approfondi** | 5 ans | Contrôle complet avec mesures |

### Enregistrement d'un contrôle

Lors d'un contrôle, vous renseignez :

1. **Date du contrôle** : Quand a-t-il été effectué ?
2. **Type de contrôle** : Quel type de vérification ?
3. **Résultat** : Conforme ou non conforme ?
4. **Observations** : Remarques et constats
5. **Photos** : Documentation visuelle
6. **Prochaine échéance** : Date du prochain contrôle

---

## Documents et fichiers

ElectroHub permet d'associer des documents à chaque équipement :

### Types de documents

- **Plans** : Schémas électriques, plans d'implantation
- **Notices** : Documentation constructeur
- **Certificats** : Certificats ATEX, de conformité
- **Rapports** : Rapports de contrôle, d'analyse
- **Photos** : Documentation visuelle

### Organisation

Les documents sont organisés par équipement et accessibles depuis la fiche de l'équipement.

---

## Cartographie

La cartographie permet de visualiser les équipements sur des plans :

![Exemple de carte](../assets/screenshots/carte-exemple.png)
<!-- Capture d'écran recommandée : Vue cartographique avec marqueurs -->

### Fonctionnalités

- **Visualisation** : Voir où se situent les équipements
- **Positionnement** : Placer les équipements sur le plan
- **Navigation** : Cliquer sur un marqueur pour voir les détails
- **Filtrage** : Afficher/masquer par type ou statut

### Plans

Les plans peuvent être :
- Importés au format image (PNG, JPG)
- Importés au format PDF
- Organisés par bâtiment/étage

---

## Audit et traçabilité

ElectroHub enregistre automatiquement toutes les actions :

### Informations tracées

- **Qui** : L'utilisateur qui a effectué l'action
- **Quoi** : Le type d'action (création, modification, suppression)
- **Quand** : Date et heure précise
- **Détails** : Les valeurs avant/après modification

### Utilité

- Conformité réglementaire
- Investigation en cas de problème
- Suivi des modifications

---

## Prochaines étapes

- [Architecture multi-sites](./multi-sites.md) : Comprendre la gestion de plusieurs sites
- [Connexion](../demarrage/connexion.md) : Se connecter à l'application
