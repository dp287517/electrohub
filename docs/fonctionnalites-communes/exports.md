# Export PDF et Excel

ElectroHub permet d'exporter vos données sous différents formats pour le reporting et l'analyse.

---

## Formats disponibles

| Format | Extension | Usage |
|--------|-----------|-------|
| **PDF** | .pdf | Rapports, documentation officielle |
| **Excel** | .xlsx | Analyse, traitement de données |

---

## Export PDF

### Fiche d'équipement

Générez un rapport PDF complet d'un équipement :

1. Ouvrez la fiche de l'équipement
2. Cliquez sur **Exporter PDF** ou l'icône 📄
3. Le PDF est généré et téléchargé

#### Contenu du rapport

![Exemple rapport PDF](../assets/screenshots/pdf-report-example.png)
<!-- Capture d'écran recommandée : Page d'un rapport PDF -->

| Section | Contenu |
|---------|---------|
| **En-tête** | Logo, titre, date |
| **Identification** | TAG, nom, description |
| **Localisation** | Bâtiment, zone, local |
| **Caractéristiques** | Données techniques |
| **Statut** | Conformité, prochain contrôle |
| **Historique** | Derniers contrôles |
| **Photos** | Images associées |
| **Position** | Extrait de plan (si positionné) |

### Liste d'équipements

Exportez une liste complète :

1. Dans la liste des équipements
2. Appliquez les filtres souhaités
3. Cliquez sur **Exporter** → **PDF**
4. Choisissez les colonnes à inclure

### Rapport de contrôle

Après un contrôle, générez un rapport :

1. Fiche de contrôle → **Exporter**
2. Le rapport inclut :
   - Informations du contrôle
   - Résultats
   - Observations
   - Photos
   - Signature (si configuré)

---

## Export Excel

### Liste des équipements

1. Affichez la liste des équipements
2. Appliquez les filtres désirés
3. Cliquez sur **Exporter** → **Excel**

#### Contenu du fichier

| Colonne | Description |
|---------|-------------|
| TAG | Identifiant |
| Nom | Désignation |
| Bâtiment | Localisation |
| Zone | Précision localisation |
| Statut | État de conformité |
| Prochain contrôle | Date |
| Dernier contrôle | Date |
| ... | Autres colonnes selon le module |

### Historique des contrôles

Exportez l'historique :

1. Vue **Historique** ou **Calendrier**
2. Filtrez la période
3. **Exporter Excel**

#### Contenu

| Colonne | Description |
|---------|-------------|
| Date | Date du contrôle |
| Équipement | TAG |
| Type | Type de contrôle |
| Résultat | Conforme/Non conforme |
| Contrôleur | Utilisateur |
| Observations | Notes |

### Statistiques

Exportez les données pour analyse :

1. Onglet **Analyse** ou **Dashboard**
2. **Exporter les données**
3. Fichier Excel avec les statistiques

---

## Personnalisation des exports

### Choisir les colonnes

Pour les exports Excel :

1. Cliquez sur **Exporter** → **Personnaliser**
2. Cochez les colonnes souhaitées
3. Ordonnez par glisser-déposer
4. Validez

### Filtrer les données

Les exports respectent les filtres actifs :
- Filtrez d'abord dans l'interface
- L'export ne contient que les données filtrées

### Période

Pour les historiques :
- Définissez les dates de début et fin
- L'export couvre uniquement cette période

---

## Modèles de rapports

### Rapports standards

| Rapport | Contenu |
|---------|---------|
| **Inventaire** | Liste complète des équipements |
| **Statut des contrôles** | État des échéances |
| **Non-conformités** | Anomalies ouvertes |
| **Historique** | Actions sur une période |

### Rapports spécifiques

Certains modules proposent des rapports dédiés :

- **ATEX** : Inventaire zone par zone
- **Portes CF** : Synthèse annuelle
- **Obsolescence** : Plan de remplacement
- **Arc Flash** : Étiquettes à imprimer

---

## Qualité des PDF

### Résolution

Les PDF sont générés en haute qualité :
- Photos en résolution optimisée
- Graphiques vectoriels
- Mise en page professionnelle

### En-tête et pied de page

| Zone | Contenu |
|------|---------|
| **En-tête** | Logo, nom du rapport |
| **Pied de page** | Date, pagination, utilisateur |

### Logo

Le logo de l'entreprise peut être configuré par l'administrateur.

---

## Planification des exports

### Export automatique (si configuré)

Certains rapports peuvent être programmés :
- Fréquence : quotidien, hebdomadaire, mensuel
- Destinataires : par email
- Format : PDF ou Excel

### Demander un rapport

Contactez votre administrateur pour :
- Configurer des exports automatiques
- Créer des modèles personnalisés

---

## Conseils d'utilisation

### Pour les audits

- Exportez l'inventaire complet
- Incluez l'historique des contrôles
- Joignez les rapports de non-conformités

### Pour l'analyse

- Utilisez Excel pour les manipulations
- Créez des tableaux croisés dynamiques
- Générez vos propres graphiques

### Pour la communication

- Utilisez les PDF pour les documents officiels
- Personnalisez selon le destinataire
- Vérifiez avant diffusion

---

## Dépannage

### Le PDF ne se génère pas

- Vérifiez votre connexion
- Réessayez après quelques secondes
- Contactez le support si le problème persiste

### Excel incorrect

- Vérifiez les filtres appliqués
- Assurez-vous d'avoir les droits
- Essayez avec moins de données

### Fichier trop volumineux

- Réduisez la période
- Appliquez des filtres
- Excluez les photos (si option)

---

## FAQ

### Puis-je modifier un PDF généré ?

Le PDF est en lecture seule. Pour modifications, utilisez l'export Excel puis convertissez.

### Les exports sont-ils horodatés ?

Oui, la date et l'heure de génération apparaissent.

### Qui peut exporter ?

Tous les utilisateurs peuvent exporter les données auxquelles ils ont accès.

### Les exports sont-ils tracés ?

Oui, chaque export est enregistré dans l'historique d'audit.

---

## Voir aussi

- [Historique et audit](./historique.md)
- [Gestion des fichiers](./fichiers.md)
