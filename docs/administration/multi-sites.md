# Gestion multi-sites

Cette page explique comment gérer les sites et l'organisation multi-sites dans ElectroHub.

---

## Structure organisationnelle

### Hiérarchie

```
Entreprise
├── Site 1
│   ├── Bâtiment A
│   └── Bâtiment B
├── Site 2
│   └── Bâtiment C
└── Site 3
    ├── Bâtiment D
    └── Bâtiment E
```

### Définitions

| Niveau | Description | Exemple |
|--------|-------------|---------|
| **Entreprise** | Entité juridique | Pharma Industries SA |
| **Site** | Implantation géographique | Usine de Nyon |
| **Bâtiment** | Structure physique | Bâtiment Production |

---

## Gérer les sites

### Accéder à la gestion des sites

1. Menu **Admin**
2. Section **Sites**

![Gestion des sites](../assets/screenshots/admin-sites.png)
<!-- Capture d'écran recommandée : Liste des sites -->

### Créer un site

1. Cliquez sur **+ Nouveau site**
2. Remplissez les informations :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom du site |
| **Adresse** | Localisation |
| **Entreprise** | Entreprise de rattachement |
| **Description** | Notes optionnelles |

3. Cliquez sur **Créer**

### Modifier un site

1. Cliquez sur le site dans la liste
2. Modifiez les informations
3. Enregistrez

### Supprimer un site

⚠️ La suppression d'un site supprime tous les équipements associés.

1. Cliquez sur **Supprimer**
2. Confirmez en tapant le nom du site
3. Validez

---

## Départements

### Définition

Les départements organisent les équipes au sein d'un site :
- Maintenance
- Production
- Qualité
- Logistique
- etc.

### Créer un département

1. Admin → **Départements**
2. **+ Nouveau département**
3. Renseignez le nom
4. Créez

### Attribution aux utilisateurs

Chaque utilisateur peut être assigné à un département via son profil.

---

## Isolation des données

### Principe

Les données sont strictement isolées par site :

| Données | Isolation |
|---------|-----------|
| Équipements | Par site |
| Documents | Par équipement (donc par site) |
| Historique | Par site |
| Plans | Par site |

### Pour les utilisateurs Site

Un utilisateur Site ne voit que les données de son site.

### Pour les utilisateurs Global/Admin

Ils peuvent voir tous les sites, mais les données restent organisées par site.

---

## Changer de site

### Pour les utilisateurs Global/Admin

1. Sur le tableau de bord, localisez le sélecteur de site
2. Cliquez dessus
3. Sélectionnez le site souhaité
4. L'interface se met à jour

![Sélecteur de site](../assets/screenshots/site-selector.png)
<!-- Capture d'écran recommandée : Menu de sélection de site -->

### Effet du changement

- Les listes d'équipements affichent le nouveau site
- Les statistiques sont recalculées
- Les plans concernent le nouveau site

---

## Configuration par site

### Paramètres spécifiques

Certains paramètres peuvent être configurés par site :

| Paramètre | Niveau |
|-----------|--------|
| Logo | Entreprise |
| Notifications | Utilisateur |
| Périodicités par défaut | Site |

### Accéder aux paramètres

1. Admin → **Paramètres**
2. Sélectionnez le site concerné
3. Modifiez les paramètres
4. Enregistrez

---

## Utilisateurs et sites

### Attribution d'un site

Pour un utilisateur Site :
1. Éditez l'utilisateur
2. Sélectionnez son site
3. Enregistrez

### Utilisateurs multi-sites

Les rôles Global et Admin ont automatiquement accès à tous les sites.

### Changement de site

Si un utilisateur change de site de travail :
1. Éditez son profil
2. Changez le site assigné
3. Enregistrez

---

## Reporting multi-sites

### Vue consolidée

Les Admins peuvent générer des rapports consolidant plusieurs sites :

1. Sélectionnez **Tous les sites** dans les filtres
2. Les statistiques agrègent les données
3. Exportez le rapport

### Comparaison entre sites

Comparez les indicateurs entre sites :
- Taux de conformité par site
- Nombre d'équipements par site
- Contrôles en retard par site

---

## Bonnes pratiques

### Nommage des sites

Utilisez des noms explicites :
- ✅ "Usine de Nyon"
- ✅ "Siège social Genève"
- ❌ "Site 1"

### Organisation

- Créez les sites avant d'importer les équipements
- Attribuez les utilisateurs aux bons sites
- Documentez les spécificités de chaque site

### Maintenance

- Révisez régulièrement la liste des sites
- Archivez les sites fermés plutôt que de les supprimer
- Mettez à jour les informations (adresse, contacts)

---

## Migration entre sites

### Transférer un équipement

Si un équipement change de site :

1. Ouvrez la fiche de l'équipement
2. Modifiez le champ **Site**
3. Mettez à jour la localisation
4. Enregistrez

### Attention

- L'historique reste associé à l'équipement
- Vérifiez les droits d'accès des utilisateurs

---

## FAQ

### Combien de sites puis-je créer ?

Pas de limite technique. Créez autant de sites que nécessaire.

### Un utilisateur peut-il appartenir à plusieurs sites ?

Avec le rôle Site : non, un seul site.
Avec le rôle Global : accès à tous les sites.

### Comment fusionner deux sites ?

Transférez manuellement les équipements d'un site vers l'autre, puis supprimez le site vide.

### Les données sont-elles partagées entre sites ?

Non, les données sont isolées. Seuls les utilisateurs Global/Admin peuvent voir plusieurs sites.

---

## Voir aussi

- [Gestion des utilisateurs](./utilisateurs.md)
- [Rôles et permissions](./roles.md)
- [Architecture multi-sites](../introduction/multi-sites.md)
