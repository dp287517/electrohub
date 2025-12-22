# Gestion des fichiers

ElectroHub permet d'associer des fichiers (documents, photos) à vos équipements.

---

## Types de fichiers

### Documents

| Type | Extensions | Usage |
|------|------------|-------|
| **PDF** | .pdf | Notices, rapports, schémas |
| **Word** | .docx | Procédures, documentation |
| **Excel** | .xlsx | Tableaux, données |

### Images

| Type | Extensions | Usage |
|------|------------|-------|
| **Photos** | .jpg, .jpeg, .png | Documentation visuelle |
| **Schémas** | .png | Plans, diagrammes |

### Plans

| Type | Extensions | Usage |
|------|------------|-------|
| **PDF** | .pdf | Plans d'implantation |
| **Images** | .png, .jpg | Plans numérisés |

---

## Télécharger un fichier

### Depuis la fiche équipement

1. Ouvrez la fiche de l'équipement
2. Section **Documents** ou **Fichiers**
3. Cliquez sur **Ajouter** ou **+**
4. Sélectionnez le fichier
5. Le fichier est téléchargé et associé

### Glisser-déposer

1. Ouvrez la fiche de l'équipement
2. Glissez le fichier depuis votre explorateur
3. Déposez dans la zone prévue
4. Le fichier est téléchargé

### Téléchargement multiple

Sélectionnez plusieurs fichiers pour les télécharger en une fois.

---

## Limites et restrictions

### Taille

| Limite | Valeur |
|--------|--------|
| **Par fichier** | 10 Mo maximum |
| **Par équipement** | Pas de limite (raisonnable) |

### Formats

Seuls les formats autorisés sont acceptés :
- Documents : PDF, DOCX, XLSX
- Images : PNG, JPG, JPEG

---

## Organiser les fichiers

### Catégorisation

Les fichiers peuvent être organisés par type :

| Catégorie | Contenu |
|-----------|---------|
| **Schémas** | Plans électriques, unifilaires |
| **Notices** | Documentation constructeur |
| **Rapports** | Rapports de contrôle, d'analyse |
| **Photos** | Documentation visuelle |
| **Certificats** | Attestations, certificats |

### Nommage

Adoptez une convention de nommage claire :

```
[TYPE]_[EQUIPEMENT]_[DATE].[ext]
```

Exemples :
- `Schema_TGBT-A-01_2024.pdf`
- `Photo_VSD-B-03_face.jpg`
- `Notice_ACS880.pdf`

---

## Consulter les fichiers

### Affichage

Les fichiers associés apparaissent dans la section **Documents** :

| Fichier | Type | Taille | Date | Actions |
|---------|------|--------|------|---------|
| Schema_unifilaire.pdf | PDF | 2.3 MB | 15/03/24 | 👁️ ⬇️ 🗑️ |
| Photo_plaque.jpg | Image | 1.1 MB | 15/03/24 | 👁️ ⬇️ 🗑️ |

### Prévisualisation

Cliquez sur l'icône 👁️ ou sur le nom du fichier pour prévisualiser :
- **PDF** : Visionneuse intégrée
- **Images** : Affichage agrandi (lightbox)

### Téléchargement

Cliquez sur l'icône ⬇️ pour télécharger le fichier sur votre ordinateur.

---

## Galerie photos

### Affichage en galerie

Les photos sont affichées sous forme de vignettes :

![Galerie photos](../assets/screenshots/photo-gallery.png)
<!-- Capture d'écran recommandée : Galerie de photos d'un équipement -->

### Navigation

- Cliquez sur une vignette pour agrandir
- Utilisez les flèches pour naviguer
- Appuyez sur Échap pour fermer

### Photo principale

Définissez une photo principale qui apparaîtra sur la fiche :
1. Survolez la photo souhaitée
2. Cliquez sur **Définir comme principale**

---

## Supprimer un fichier

### Procédure

1. Localisez le fichier dans la liste
2. Cliquez sur l'icône 🗑️ (supprimer)
3. Confirmez la suppression

### Attention

- La suppression est définitive
- L'action est tracée dans l'historique
- Vérifiez avant de supprimer

---

## Fichiers et contrôles

### Joindre des fichiers à un contrôle

Lors d'un contrôle, ajoutez des fichiers :

1. Formulaire de contrôle → Section **Photos/Documents**
2. Ajoutez les fichiers
3. Ils sont associés au contrôle

### Consultation

Les fichiers du contrôle apparaissent dans :
- Le détail du contrôle
- L'historique de l'équipement

---

## Recherche de fichiers

### Par équipement

Les fichiers sont accessibles depuis la fiche de l'équipement.

### Par type

Filtrez les fichiers par type (PDF, images...).

### Par date

Triez par date de téléchargement.

---

## Stockage et sécurité

### Hébergement

Les fichiers sont stockés de manière sécurisée :
- Serveurs protégés
- Sauvegardes régulières
- Accès contrôlé

### Accès

Seuls les utilisateurs autorisés peuvent :
- Voir les fichiers de leur périmètre
- Ajouter des fichiers
- Supprimer des fichiers

### Confidentialité

- Respectez la politique de confidentialité
- N'uploadez pas de données sensibles non autorisées
- Les fichiers sont visibles par tous les utilisateurs ayant accès à l'équipement

---

## Bonnes pratiques

### Qualité des fichiers

- Utilisez des fichiers lisibles
- Optimisez la taille des images
- Préférez le PDF pour les documents

### Organisation

- Nommez clairement les fichiers
- Catégorisez correctement
- Supprimez les fichiers obsolètes

### Photos

- Prenez des photos nettes
- Incluez des repères visuels
- Photographiez les plaques signalétiques

---

## Dépannage

### Le fichier ne s'uploade pas

- Vérifiez la taille (< 10 Mo)
- Vérifiez le format (autorisé ?)
- Réessayez après quelques secondes

### Le fichier ne s'affiche pas

- Le format n'est peut-être pas pris en charge pour la prévisualisation
- Téléchargez le fichier pour l'ouvrir localement

### Fichier corrompu

Si un fichier semble corrompu :
- Supprimez-le
- Re-téléchargez l'original

---

## FAQ

### Puis-je modifier un fichier en ligne ?

Non, les fichiers sont en lecture seule. Téléchargez, modifiez, puis re-uploadez.

### Les fichiers sont-ils sauvegardés ?

Oui, des sauvegardes régulières sont effectuées.

### Puis-je récupérer un fichier supprimé ?

Contactez votre administrateur. Selon la politique de rétention, une restauration peut être possible.

---

## Voir aussi

- [Export PDF et Excel](./exports.md)
- [Contrôles périodiques](./controles.md)
