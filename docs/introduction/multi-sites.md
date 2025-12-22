# Architecture multi-sites

ElectroHub est conçu pour gérer des organisations complexes avec plusieurs sites industriels. Cette page explique comment fonctionne la gestion multi-sites.

---

## Principe général

L'architecture multi-sites permet à une entreprise de :

- Gérer plusieurs sites depuis une seule plateforme
- Isoler les données entre les sites
- Attribuer des droits d'accès par site
- Consolider les informations au niveau global

```
┌─────────────────────────────────────────────────┐
│                   ENTREPRISE                     │
│              (Pharma Industries SA)              │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │  Site Nyon  │  │ Site Genève │  │Site Bâle │ │
│  │  (Usine A)  │  │  (Usine B)  │  │(Entrepôt)│ │
│  └─────────────┘  └─────────────┘  └──────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Rôles utilisateurs

ElectroHub propose quatre niveaux de rôles, chacun avec un périmètre d'accès différent :

### Super Admin

![Badge Super Admin](../assets/icons/role-superadmin.png)
<!-- Capture d'écran recommandée : Badge du rôle dans l'interface -->

- **Périmètre** : Accès à toutes les entreprises et tous les sites
- **Capacités** :
  - Créer/modifier des entreprises
  - Créer/modifier des sites
  - Gérer tous les utilisateurs
  - Accéder à toutes les données

> **Usage** : Réservé aux administrateurs de la plateforme

### Admin

![Badge Admin](../assets/icons/role-admin.png)

- **Périmètre** : Accès à tous les sites de son entreprise
- **Capacités** :
  - Gérer les utilisateurs de son entreprise
  - Accéder à tous les sites
  - Configurer les paramètres

> **Usage** : Responsables maintenance au niveau entreprise

### Global

![Badge Global](../assets/icons/role-global.png)

- **Périmètre** : Accès à tous les sites de son entreprise
- **Capacités** :
  - Consulter et modifier les équipements de tous les sites
  - Changer de site depuis le tableau de bord
  - Voir les données consolidées

> **Usage** : Ingénieurs méthodes, responsables techniques multi-sites

### Site

![Badge Site](../assets/icons/role-site.png)

- **Périmètre** : Accès uniquement à son site assigné
- **Capacités** :
  - Consulter et modifier les équipements de son site
  - Effectuer les contrôles
  - Gérer les documents

> **Usage** : Techniciens de maintenance, électriciens

---

## Changement de site

Les utilisateurs avec un rôle **Global** ou **Admin** peuvent changer de site :

### Comment changer de site ?

1. Sur le tableau de bord, repérez le bouton **Site** (en haut à droite)
2. Cliquez sur le bouton pour ouvrir la liste des sites
3. Sélectionnez le site souhaité
4. L'interface se met à jour avec les données du nouveau site

![Sélecteur de site](../assets/screenshots/site-switcher.png)
<!-- Capture d'écran recommandée : Le menu déroulant de sélection de site -->

### Ce qui change

Lorsque vous changez de site :

- La liste des équipements affiche ceux du site sélectionné
- Les statistiques sont recalculées pour ce site
- Les plans et cartes montrent ce site
- Vos actions sont enregistrées pour ce site

### Ce qui reste

- Votre profil utilisateur
- Vos préférences
- L'accès aux autres sites (si vous y êtes autorisé)

---

## Isolation des données

Les données sont strictement isolées entre les sites :

### Équipements

Chaque équipement appartient à un site unique. Un utilisateur Site ne peut voir que les équipements de son site.

### Documents

Les documents sont associés à des équipements, donc indirectement à des sites. L'isolation est automatique.

### Utilisateurs

Un utilisateur peut être assigné à :
- Un seul site (rôle Site)
- Tous les sites de l'entreprise (rôle Global ou Admin)

### Historique

L'historique d'audit est filtré par site pour les utilisateurs Site.

---

## Configuration de votre profil

Lors de votre première connexion, configurez votre profil :

### Informations à renseigner

1. **Site** : Votre site de rattachement
2. **Département** : Votre service (Maintenance, Production, etc.)

### Comment faire ?

1. Cliquez sur votre avatar dans le tableau de bord
2. Sélectionnez votre site dans la liste déroulante
3. Sélectionnez votre département
4. Cliquez sur **Enregistrer**

![Modal de profil](../assets/screenshots/profile-modal.png)
<!-- Capture d'écran recommandée : La fenêtre de modification du profil -->

---

## Bonnes pratiques

### Pour les administrateurs

- **Nommez clairement les sites** : Utilisez des noms explicites (ex: "Usine Nyon" plutôt que "Site 1")
- **Définissez les rôles appropriés** : N'accordez pas plus de droits que nécessaire
- **Documentez l'organisation** : Maintenez un annuaire des sites et responsables

### Pour les utilisateurs Global

- **Vérifiez le site actif** : Avant toute action, confirmez que vous êtes sur le bon site
- **Utilisez les filtres** : Pour retrouver rapidement les équipements d'un site
- **Communiquez** : Prévenez les équipes locales de vos interventions

### Pour les utilisateurs Site

- **Restez sur votre périmètre** : Vos actions n'impactent que votre site
- **Signalez les besoins** : Si vous avez besoin d'accès à d'autres sites, contactez votre admin

---

## Exemple concret

Prenons l'exemple de **Pharma Industries SA** avec 3 sites :

| Site | Utilisateurs | Équipements |
|------|--------------|-------------|
| Nyon | 5 techniciens (Site) | 450 équipements |
| Genève | 3 techniciens (Site) | 280 équipements |
| Bâle | 2 techniciens (Site) | 120 équipements |

L'entreprise a également :
- 1 Responsable maintenance (Admin) qui supervise les 3 sites
- 2 Ingénieurs méthodes (Global) qui interviennent sur tous les sites

### Scénario 1 : Technicien à Nyon

Jean-Pierre, technicien à Nyon :
- Voit uniquement les 450 équipements de Nyon
- Effectue les contrôles sur ces équipements
- Ne peut pas accéder aux données de Genève ou Bâle

### Scénario 2 : Ingénieur Global

Marie, ingénieure méthodes :
- Peut basculer entre les 3 sites
- Consulte les statistiques de chaque site
- Harmonise les pratiques entre les sites

### Scénario 3 : Responsable Admin

Pierre, responsable maintenance :
- Gère les comptes utilisateurs des 3 sites
- Consulte les tableaux de bord consolidés
- Configure les paramètres globaux

---

## Prochaines étapes

- [Connexion](../demarrage/connexion.md) : Se connecter à ElectroHub
- [Configuration du profil](../demarrage/profil.md) : Configurer votre site et département
