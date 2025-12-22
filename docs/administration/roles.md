# Rôles et permissions

Cette page détaille les différents rôles et leurs permissions dans ElectroHub.

---

## Vue d'ensemble des rôles

ElectroHub propose quatre niveaux de rôles :

| Rôle | Icône | Périmètre |
|------|-------|-----------|
| **Super Admin** | 👑 | Toute la plateforme |
| **Admin** | 🛡️ | Son entreprise |
| **Global** | 🌍 | Tous les sites de l'entreprise |
| **Site** | 📍 | Son site uniquement |

---

## Super Admin

### Description

Le Super Admin a le contrôle total sur la plateforme.

### Permissions

| Action | Autorisé |
|--------|----------|
| Gérer les entreprises | ✅ |
| Gérer tous les utilisateurs | ✅ |
| Gérer tous les sites | ✅ |
| Accéder à toutes les données | ✅ |
| Configurer la plateforme | ✅ |
| Voir les logs système | ✅ |

### Usage

- Administrateurs techniques de la plateforme
- Équipe de support

### Précautions

- Limiter le nombre de Super Admins
- Utiliser uniquement pour les tâches nécessitant ce niveau

---

## Admin

### Description

L'Admin gère son entreprise et tous ses sites.

### Permissions

| Action | Autorisé |
|--------|----------|
| Gérer les utilisateurs de l'entreprise | ✅ |
| Gérer les sites de l'entreprise | ✅ |
| Accéder à tous les sites | ✅ |
| Configurer les paramètres entreprise | ✅ |
| Créer/modifier tous les équipements | ✅ |
| Exporter les données | ✅ |

### Usage

- Responsables maintenance au niveau entreprise
- Directeurs techniques
- Administrateurs fonctionnels

### Limitations

- Ne peut pas gérer d'autres entreprises
- Ne peut pas accéder aux fonctions Super Admin

---

## Global

### Description

L'utilisateur Global a accès à tous les sites de son entreprise en lecture et écriture.

### Permissions

| Action | Autorisé |
|--------|----------|
| Consulter tous les sites | ✅ |
| Modifier les équipements de tous les sites | ✅ |
| Effectuer des contrôles sur tous les sites | ✅ |
| Exporter les données | ✅ |
| Changer de site depuis le tableau de bord | ✅ |
| Gérer les utilisateurs | ❌ |
| Gérer les sites | ❌ |

### Usage

- Ingénieurs méthodes multi-sites
- Responsables techniques itinérants
- Auditeurs internes

### Avantage

Peut basculer entre les sites sans changer de compte.

---

## Site

### Description

L'utilisateur Site travaille uniquement sur son site assigné.

### Permissions

| Action | Autorisé |
|--------|----------|
| Consulter les équipements de son site | ✅ |
| Modifier les équipements de son site | ✅ |
| Effectuer des contrôles sur son site | ✅ |
| Exporter les données de son site | ✅ |
| Accéder aux autres sites | ❌ |
| Gérer les utilisateurs | ❌ |

### Usage

- Techniciens de maintenance
- Électriciens
- Opérateurs terrain

### Configuration

L'utilisateur Site doit avoir un site assigné dans son profil.

---

## Matrice des permissions

### Gestion des données

| Action | Super Admin | Admin | Global | Site |
|--------|:-----------:|:-----:|:------:|:----:|
| Voir équipements de son site | ✅ | ✅ | ✅ | ✅ |
| Voir équipements d'autres sites | ✅ | ✅ | ✅ | ❌ |
| Créer équipement | ✅ | ✅ | ✅ | ✅ |
| Modifier équipement | ✅ | ✅ | ✅ | ✅ |
| Supprimer équipement | ✅ | ✅ | ✅ | ✅ |
| Effectuer un contrôle | ✅ | ✅ | ✅ | ✅ |
| Exporter données | ✅ | ✅ | ✅ | ✅ |

### Administration

| Action | Super Admin | Admin | Global | Site |
|--------|:-----------:|:-----:|:------:|:----:|
| Voir liste utilisateurs | ✅ | ✅ | ❌ | ❌ |
| Créer utilisateur | ✅ | ✅ | ❌ | ❌ |
| Modifier utilisateur | ✅ | ✅ | ❌ | ❌ |
| Supprimer utilisateur | ✅ | ✅ | ❌ | ❌ |
| Gérer les sites | ✅ | ✅ | ❌ | ❌ |
| Configurer paramètres | ✅ | ✅ | ❌ | ❌ |
| Accéder aux logs | ✅ | ✅ | ❌ | ❌ |

### Navigation

| Action | Super Admin | Admin | Global | Site |
|--------|:-----------:|:-----:|:------:|:----:|
| Changer de site | ✅ | ✅ | ✅ | ❌ |
| Voir toutes les entreprises | ✅ | ❌ | ❌ | ❌ |
| Accéder à l'admin | ✅ | ✅ | ❌ | ❌ |

---

## Permissions par application

### Contrôle d'accès fin

En plus des rôles, vous pouvez restreindre l'accès par application :

| Utilisateur | ATEX | Tableaux | VSD | Portes CF |
|-------------|:----:|:--------:|:---:|:---------:|
| Technicien A | ✅ | ✅ | ✅ | ❌ |
| Technicien B | ❌ | ✅ | ✅ | ✅ |
| Responsable | ✅ | ✅ | ✅ | ✅ |

### Configuration

1. Admin → Utilisateurs
2. Éditez l'utilisateur
3. Section "Applications autorisées"
4. Cochez/décochez les applications

---

## Héritage des permissions

### Principe

Un rôle supérieur inclut les permissions des rôles inférieurs :

```
Super Admin
    ↓ inclut
Admin
    ↓ inclut
Global
    ↓ inclut
Site
```

### En pratique

- Un Admin peut faire tout ce qu'un Global peut faire
- Un Global peut faire tout ce qu'un Site peut faire

---

## Bonnes pratiques

### Attribution des rôles

| Situation | Rôle recommandé |
|-----------|-----------------|
| Technicien de maintenance | Site |
| Responsable d'équipe site | Site |
| Ingénieur méthodes multi-sites | Global |
| Responsable maintenance entreprise | Admin |
| Support technique plateforme | Super Admin |

### Principe de moindre privilège

- Attribuez le rôle minimum nécessaire
- Évitez de multiplier les admins
- Réévaluez régulièrement les droits

### Séparation des tâches

- Distinguez les utilisateurs et les administrateurs
- Tracez toutes les actions d'administration
- Revoyez les accès périodiquement

---

## FAQ

### Peut-on créer des rôles personnalisés ?

Non, les rôles sont fixes. Utilisez les permissions par application pour affiner.

### Un utilisateur peut-il avoir plusieurs rôles ?

Non, un seul rôle par utilisateur. Le rôle définit le périmètre maximal.

### Comment promouvoir un utilisateur ?

Éditez l'utilisateur et changez son rôle.

### Les permissions sont-elles rétroactives ?

Les changements de permissions s'appliquent immédiatement à la prochaine action de l'utilisateur.

---

## Voir aussi

- [Gestion des utilisateurs](./utilisateurs.md)
- [Gestion multi-sites](./multi-sites.md)
