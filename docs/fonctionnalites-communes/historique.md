# Historique et audit

ElectroHub trace automatiquement toutes les actions pour assurer la traçabilité et la conformité.

---

## Présentation

L'historique d'audit permet de :

- **Tracer** qui a fait quoi et quand
- **Vérifier** les modifications apportées
- **Prouver** la conformité réglementaire
- **Analyser** les actions passées

---

## Types d'actions tracées

### Actions sur les équipements

| Action | Description |
|--------|-------------|
| **Création** | Nouvel équipement ajouté |
| **Modification** | Changement d'informations |
| **Suppression** | Équipement supprimé |
| **Duplication** | Copie créée |

### Actions sur les contrôles

| Action | Description |
|--------|-------------|
| **Contrôle effectué** | Nouveau contrôle enregistré |
| **Contrôle modifié** | Modification d'un contrôle |
| **Contrôle rapide** | Validation rapide |

### Actions sur les fichiers

| Action | Description |
|--------|-------------|
| **Upload** | Fichier téléchargé |
| **Suppression** | Fichier supprimé |

### Actions utilisateur

| Action | Description |
|--------|-------------|
| **Connexion** | Connexion à l'application |
| **Déconnexion** | Fin de session |
| **Modification profil** | Changement de paramètres |

---

## Consulter l'historique

### Historique d'un équipement

1. Ouvrez la fiche de l'équipement
2. Cliquez sur l'onglet **Historique** ou le bouton **Voir l'historique**

![Historique équipement](../assets/screenshots/equipment-history.png)
<!-- Capture d'écran recommandée : Liste de l'historique d'un équipement -->

### Historique global (admin)

Les administrateurs peuvent consulter l'historique global :
1. Menu **Administration**
2. Section **Audit**

---

## Informations tracées

### Pour chaque action

| Information | Description |
|-------------|-------------|
| **Date/Heure** | Horodatage précis |
| **Utilisateur** | Qui a effectué l'action |
| **Action** | Type d'action |
| **Objet** | Équipement ou élément concerné |
| **Détails** | Valeurs avant/après (pour les modifications) |
| **IP** | Adresse IP (pour la sécurité) |

### Exemple d'entrée

```
📅 15/03/2024 14:32:45
👤 jean.dupont@entreprise.com
🔧 Modification
📍 Équipement: VSD-A-01

Changements:
- Puissance: 45 kW → 55 kW
- Tension: 380V → 400V
```

---

## Filtrer l'historique

### Critères de filtrage

| Filtre | Options |
|--------|---------|
| **Période** | Dates de début et fin |
| **Utilisateur** | Sélection d'un utilisateur |
| **Type d'action** | Création, modification, suppression... |
| **Équipement** | Recherche par TAG ou nom |

### Appliquer un filtre

1. Cliquez sur l'icône de filtre
2. Sélectionnez les critères
3. Appliquez

---

## Détail des modifications

### Comparaison avant/après

Pour les modifications, le système enregistre :

| Champ | Avant | Après |
|-------|-------|-------|
| Puissance | 45 kW | 55 kW |
| Tension | 380V | 400V |
| Dernière modification | 10/02/2024 | 15/03/2024 |

### Visualisation

Cliquez sur une entrée pour voir le détail complet des changements.

---

## Badge "Dernière modification"

### Affichage

Sur chaque fiche d'équipement, un badge indique :

```
Modifié le 15/03/2024 par Jean Dupont
```

### Informations

- Date de dernière modification
- Nom de l'utilisateur
- Lien vers l'historique complet

---

## Export de l'historique

### Format disponibles

| Format | Usage |
|--------|-------|
| **PDF** | Rapport officiel |
| **Excel** | Analyse et traitement |

### Contenu de l'export

- Liste chronologique des actions
- Détails des modifications
- Informations utilisateur
- Horodatages

### Procédure

1. Filtrez l'historique souhaité
2. Cliquez sur **Exporter**
3. Choisissez le format
4. Téléchargez le fichier

---

## Cas d'usage

### Audit réglementaire

Lors d'un audit, fournissez l'historique pour prouver :
- La réalisation des contrôles
- Le suivi des non-conformités
- La traçabilité des modifications

### Investigation

En cas de problème, analysez l'historique pour :
- Identifier les dernières modifications
- Comprendre l'évolution d'un équipement
- Retrouver une information passée

### Amélioration continue

Utilisez l'historique pour :
- Analyser les tendances
- Identifier les équipements problématiques
- Optimiser les processus

---

## Conservation des données

### Durée de conservation

L'historique est conservé selon votre politique de rétention :
- Minimum recommandé : 5 ans
- Réglementaire : selon la législation applicable

### Archivage

Les anciennes données peuvent être archivées pour :
- Libérer de l'espace
- Maintenir les performances
- Conserver la traçabilité légale

---

## Sécurité et intégrité

### Protection des données

- L'historique ne peut pas être modifié
- Les suppressions sont elles-mêmes tracées
- Horodatage serveur (non modifiable)

### Accès

- Lecture : utilisateurs autorisés
- Export : selon les droits
- Suppression : administrateurs uniquement (avec trace)

---

## Bonnes pratiques

### Pour les utilisateurs

- Renseignez des descriptions claires lors des modifications
- Vérifiez vos actions avant validation
- Consultez l'historique en cas de doute

### Pour les administrateurs

- Définissez une politique de rétention
- Formez les utilisateurs à la traçabilité
- Exportez régulièrement pour archivage

---

## FAQ

### Puis-je supprimer une entrée de l'historique ?

Non, l'historique est immuable pour garantir son intégrité.

### L'historique impacte-t-il les performances ?

Non significativement. Les anciennes données peuvent être archivées si nécessaire.

### Qui peut voir l'historique ?

Tous les utilisateurs autorisés sur l'équipement peuvent voir son historique.

---

## Voir aussi

- [Contrôles périodiques](./controles.md)
- [Export PDF et Excel](./exports.md)
- [Gestion des utilisateurs](../administration/utilisateurs.md)
