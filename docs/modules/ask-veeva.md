# Ask Veeva

Le module **Ask Veeva** permet d'interroger vos documents grâce à l'intelligence artificielle.

---

## Présentation

![Vue Ask Veeva](../assets/screenshots/askveeva-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Ask Veeva -->

Ask Veeva utilise l'IA pour :

- **Indexer** vos documents (PDF, notices, procédures)
- **Rechercher** par mots-clés ou questions
- **Répondre** à vos questions en langage naturel
- **Citer** les sources utilisées

---

## Accéder au module

1. Tableau de bord → **Utilitaires & Outils**
2. Cliquez sur **Ask Veeva**

---

## Fonctionnalités

### Recherche documentaire intelligente

Posez une question en langage naturel :

> "Quelle est la procédure de consignation du TGBT ?"

L'IA analyse vos documents et fournit une réponse avec les sources.

### Indexation des documents

Téléchargez vos documents pour les rendre consultables :
- Notices techniques
- Procédures
- Normes internes
- Rapports
- Plans

---

## Interface

### Zone de recherche

![Recherche Ask Veeva](../assets/screenshots/askveeva-search.png)
<!-- Capture d'écran recommandée : Barre de recherche avec question -->

Tapez votre question et appuyez sur Entrée.

### Résultats

L'IA affiche :
1. **Réponse synthétique** : Résumé de l'information
2. **Sources** : Documents utilisés
3. **Extraits** : Passages pertinents
4. **Actions** : Ouvrir le document, poser une question de suivi

---

## Télécharger des documents

### Formats acceptés

| Format | Extension |
|--------|-----------|
| PDF | .pdf |
| Word | .docx |
| Excel | .xlsx |
| Texte | .txt |
| Images | .png, .jpg (avec OCR) |

### Procédure

1. Cliquez sur **Télécharger**
2. Sélectionnez le(s) fichier(s)
3. Ajoutez des métadonnées (optionnel) :
   - Catégorie
   - Tags
   - Description
4. Validez l'upload

### Indexation

Après l'upload, le document est indexé automatiquement :
- Extraction du texte
- Analyse du contenu
- Création des embeddings

Le document devient consultable en quelques minutes.

---

## Poser des questions

### Types de questions

| Type | Exemple |
|------|---------|
| **Factuelle** | "Quel est le calibre du disjoncteur principal ?" |
| **Procédurale** | "Comment faire la maintenance du VSD ?" |
| **Comparative** | "Quelle différence entre Ex d et Ex e ?" |
| **Recherche** | "Documents sur les transformateurs" |

### Bonnes pratiques

- Soyez précis dans vos questions
- Utilisez les termes techniques appropriés
- Si la réponse est incomplète, reformulez

### Exemples de questions

> "Quelle est la tension nominale du tableau TD-A-01 ?"

> "Où trouver la procédure de remplacement des batteries UPS ?"

> "Quels sont les EPI requis pour intervention sur cellule HT ?"

---

## Réponses de l'IA

### Structure de la réponse

```
Réponse :
La procédure de consignation du TGBT comprend 5 étapes...

Sources :
- [Procédure consignation.pdf] Page 3
- [Manuel maintenance.pdf] Page 15

Extraits pertinents :
"Avant toute intervention, procéder à la consignation..."
```

### Qualité des réponses

L'IA répond uniquement avec les informations présentes dans vos documents. Si l'information n'existe pas, elle l'indique.

### Questions de suivi

Vous pouvez enchaîner les questions pour approfondir :

1. "Quelle est la procédure de consignation ?"
2. "Qui est habilité à la réaliser ?"
3. "Quelle est la fréquence de révision de cette procédure ?"

---

## Gestion des documents

### Bibliothèque

Consultez tous les documents indexés :

| Document | Catégorie | Date upload | Taille |
|----------|-----------|-------------|--------|
| Procédure consignation.pdf | Procédures | 15/03/2024 | 2.3 MB |
| Notice VSD ACS880.pdf | Notices | 10/02/2024 | 5.1 MB |
| Schéma TGBT.pdf | Plans | 20/01/2024 | 1.8 MB |

### Actions

| Action | Description |
|--------|-------------|
| **Voir** | Ouvrir le document |
| **Télécharger** | Télécharger localement |
| **Modifier** | Changer les métadonnées |
| **Supprimer** | Retirer de l'index |

### Catégorisation

Organisez vos documents par catégories :
- Procédures
- Notices techniques
- Plans et schémas
- Normes
- Rapports
- Formations

---

## Cas d'usage

### Maintenance

> "Quelle est la périodicité de maintenance du compresseur ?"

L'IA trouve la notice et indique les fréquences recommandées.

### Dépannage

> "Que signifie l'alarme F0003 sur le variateur Siemens ?"

L'IA recherche dans les manuels et explique le code d'erreur.

### Sécurité

> "Quels sont les risques d'intervention sur le transformateur ?"

L'IA compile les informations de sécurité des documents.

### Formation

> "Expliquer le principe de la sélectivité"

L'IA fournit une explication basée sur vos documents techniques.

---

## Limites

### Ce que l'IA peut faire

- Rechercher dans les documents indexés
- Synthétiser l'information
- Citer les sources
- Répondre en français ou anglais

### Ce que l'IA ne peut pas faire

- Inventer des informations
- Accéder à Internet
- Modifier les documents
- Remplacer un expert

### Vérification

Vérifiez toujours les réponses importantes en consultant le document source.

---

## Confidentialité

### Sécurité des données

- Documents stockés de manière sécurisée
- Accès limité aux utilisateurs autorisés
- Pas de partage avec des tiers
- Indexation sur infrastructure dédiée

### Recommandations

- Ne téléchargez pas de documents confidentiels sensibles
- Respectez les règles de classification de votre entreprise
- Limitez l'accès au module selon les besoins

---

## Bonnes pratiques

### Documents

- Téléchargez des documents de qualité (texte lisible)
- Catégorisez correctement
- Mettez à jour les versions obsolètes
- Supprimez les documents périmés

### Questions

- Formulez des questions claires
- Précisez le contexte si nécessaire
- Consultez les sources citées
- Signalez les réponses incorrectes

---

## FAQ

### Combien de documents puis-je télécharger ?

Pas de limite stricte, mais les performances optimales sont atteintes avec quelques centaines de documents.

### Les images dans les PDF sont-elles analysées ?

Oui, avec la reconnaissance de caractères (OCR) si le texte est lisible.

### Puis-je poser des questions en anglais ?

Oui, l'IA répond dans la langue de la question.

### Comment améliorer la qualité des réponses ?

Téléchargez des documents complets et bien structurés.

---

## Voir aussi

- [Assistant IA](../fonctionnalites-communes/assistant-ia.md)
- [Gestion des fichiers](../fonctionnalites-communes/fichiers.md)
