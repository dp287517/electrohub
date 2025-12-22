# Gestion des utilisateurs

Cette page explique comment gérer les utilisateurs d'ElectroHub.

---

## Accéder à l'administration

### Prérequis

Seuls les utilisateurs avec les rôles suivants peuvent accéder à l'administration :
- **Super Admin**
- **Admin**

### Accès

1. Connectez-vous à ElectroHub
2. Cliquez sur **Admin** dans le menu ou la barre de navigation
3. La page d'administration s'affiche

![Page Admin](../assets/screenshots/admin-panel.png)
<!-- Capture d'écran recommandée : Page d'administration -->

---

## Liste des utilisateurs

### Affichage

La liste affiche tous les utilisateurs :

| Colonne | Description |
|---------|-------------|
| **Nom** | Nom complet |
| **Email** | Adresse email |
| **Rôle** | Niveau d'accès |
| **Site** | Site assigné |
| **Statut** | Actif / Inactif |
| **Actions** | Modifier, désactiver |

### Filtres

Filtrez par :
- Rôle
- Site
- Statut

### Recherche

Recherchez par nom ou email.

---

## Créer un utilisateur

### Formulaire de création

1. Cliquez sur **+ Nouvel utilisateur**
2. Remplissez les informations :

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| **Nom** | ✅ | Prénom et nom |
| **Email** | ✅ | Adresse email (identifiant) |
| **Mot de passe** | ✅ | Mot de passe initial |
| **Rôle** | ✅ | Niveau d'accès |
| **Site** | ✅* | Site assigné (*sauf Global/Admin) |
| **Département** | | Service |

3. Cliquez sur **Créer**

### Email de bienvenue

Un email est envoyé à l'utilisateur avec :
- Ses identifiants de connexion
- Le lien vers l'application
- Les premières instructions

---

## Modifier un utilisateur

### Procédure

1. Trouvez l'utilisateur dans la liste
2. Cliquez sur **Modifier** (icône ✏️)
3. Modifiez les informations souhaitées
4. Cliquez sur **Enregistrer**

### Champs modifiables

| Champ | Modifiable |
|-------|------------|
| Nom | ✅ |
| Email | ⚠️ (avec précaution) |
| Rôle | ✅ |
| Site | ✅ |
| Département | ✅ |
| Applications autorisées | ✅ |

### Modifier le mot de passe

1. Cliquez sur **Réinitialiser le mot de passe**
2. Un nouveau mot de passe est généré
3. L'utilisateur reçoit un email

---

## Rôles utilisateurs

### Hiérarchie des rôles

```
Super Admin
    └── Admin
        └── Global
            └── Site
```

### Détail des rôles

| Rôle | Périmètre | Capacités |
|------|-----------|-----------|
| **Super Admin** | Toutes entreprises | Tout faire |
| **Admin** | Son entreprise | Gérer utilisateurs et sites |
| **Global** | Tous sites de l'entreprise | Consulter et modifier |
| **Site** | Son site uniquement | Consulter et modifier |

### Attribuer un rôle

1. Éditez l'utilisateur
2. Sélectionnez le rôle approprié
3. Enregistrez

> **Principe de moindre privilège** : Attribuez le rôle minimum nécessaire.

---

## Applications autorisées

### Contrôle d'accès par application

Vous pouvez restreindre l'accès aux applications :

1. Éditez l'utilisateur
2. Section **Applications autorisées**
3. Cochez/décochez les applications
4. Enregistrez

### Applications disponibles

| Application | Description |
|-------------|-------------|
| ATEX | Gestion atmosphères explosives |
| Tableaux | Tableaux électriques |
| VSD | Variateurs |
| Portes CF | Portes coupe-feu |
| ... | Autres modules |

### Accès par défaut

Par défaut, un nouvel utilisateur a accès à toutes les applications.

---

## Désactiver un utilisateur

### Quand désactiver ?

- Départ de l'entreprise
- Changement de poste
- Accès temporairement suspendu

### Procédure

1. Trouvez l'utilisateur
2. Cliquez sur **Désactiver**
3. Confirmez

### Effet

- L'utilisateur ne peut plus se connecter
- Ses données et historique sont conservés
- Le compte peut être réactivé

### Réactiver

1. Filtrez les utilisateurs inactifs
2. Cliquez sur **Réactiver**

---

## Supprimer un utilisateur

### Attention

⚠️ La suppression est définitive et :
- Supprime le compte
- Conserve l'historique (actions passées)
- Ne peut pas être annulée

### Procédure

1. Désactivez d'abord l'utilisateur
2. Cliquez sur **Supprimer**
3. Confirmez avec précaution

### Recommandation

Préférez la désactivation à la suppression pour conserver la traçabilité.

---

## Import d'utilisateurs

### Import en masse

Pour créer plusieurs utilisateurs :

1. Préparez un fichier Excel avec les colonnes :
   - Nom
   - Email
   - Rôle
   - Site
   - Département

2. Cliquez sur **Importer**
3. Sélectionnez le fichier
4. Validez l'import

### Modèle

Téléchargez le modèle d'import pour respecter le format.

---

## Bonnes pratiques

### Création

- Utilisez les emails professionnels
- Attribuez les bons rôles dès le départ
- Informez les utilisateurs de leur création

### Maintenance

- Révisez régulièrement les accès
- Désactivez les comptes inutilisés
- Mettez à jour les sites et rôles

### Sécurité

- Exigez des mots de passe forts
- Réinitialisez les mots de passe en cas de doute
- Surveillez les connexions suspectes

---

## FAQ

### Un utilisateur a oublié son mot de passe

Utilisez **Réinitialiser le mot de passe** ou conseillez-lui le lien "Mot de passe oublié".

### Comment changer le site d'un utilisateur ?

Éditez l'utilisateur et modifiez le champ Site.

### Peut-on avoir plusieurs administrateurs ?

Oui, plusieurs utilisateurs peuvent avoir le rôle Admin.

### Les actions d'un utilisateur supprimé sont-elles conservées ?

Oui, l'historique est conservé avec mention de l'utilisateur.

---

## Voir aussi

- [Rôles et permissions](./roles.md)
- [Gestion multi-sites](./multi-sites.md)
