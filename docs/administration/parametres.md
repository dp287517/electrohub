# Paramètres généraux

Cette page décrit les paramètres de configuration d'ElectroHub.

---

## Accéder aux paramètres

1. Menu **Admin**
2. Section **Paramètres**

> Accès réservé aux rôles Admin et Super Admin.

---

## Paramètres de l'entreprise

### Informations générales

| Paramètre | Description |
|-----------|-------------|
| **Nom de l'entreprise** | Raison sociale |
| **Logo** | Image affichée dans l'interface |
| **Adresse** | Siège social |
| **Contact** | Email de contact principal |

### Modifier le logo

1. Section **Logo**
2. Cliquez sur **Changer**
3. Sélectionnez l'image (PNG, JPG, max 2 Mo)
4. Validez

Le logo apparaît dans :
- La barre de navigation
- Les rapports PDF exportés
- Les emails envoyés

---

## Paramètres des contrôles

### Périodicités par défaut

Configurez les périodicités suggérées par défaut :

| Type d'équipement | Périodicité par défaut |
|-------------------|------------------------|
| Tableaux électriques | 12 mois |
| VSD | 12 mois |
| ATEX | 12 mois |
| Portes coupe-feu | 12 mois |
| Équipements mobiles | 12 mois |

### Alertes

Configurez quand alerter :

| Alerte | Par défaut |
|--------|------------|
| **Préavis contrôle** | 30 jours avant |
| **Alerte retard** | Dès le jour suivant |
| **Rappel** | 7 jours après retard |

---

## Paramètres des notifications

### Notifications par email

| Notification | Destinataire |
|--------------|--------------|
| Contrôle à venir | Responsable équipement |
| Contrôle en retard | Responsable + Admin |
| Non-conformité critique | Admin |
| Nouveau compte | Utilisateur créé |

### Activer/Désactiver

Cochez ou décochez les notifications souhaitées.

### Fréquence

| Option | Description |
|--------|-------------|
| **Immédiat** | Dès l'événement |
| **Quotidien** | Résumé chaque jour |
| **Hebdomadaire** | Résumé chaque semaine |

---

## Paramètres de sécurité

### Politique de mot de passe

| Paramètre | Valeur recommandée |
|-----------|-------------------|
| **Longueur minimale** | 8 caractères |
| **Complexité** | Majuscule + minuscule + chiffre |
| **Expiration** | 90 jours (optionnel) |
| **Historique** | 5 derniers mots de passe |

### Session

| Paramètre | Valeur par défaut |
|-----------|-------------------|
| **Durée de session** | 8 heures |
| **Déconnexion automatique** | Après 2h d'inactivité |

### Connexion

| Paramètre | Description |
|-----------|-------------|
| **Tentatives max** | 5 avant blocage temporaire |
| **Durée blocage** | 15 minutes |

---

## Paramètres d'affichage

### Langue

Langue de l'interface :
- Français
- English

### Fuseau horaire

Configurez le fuseau horaire du site pour les horodatages.

### Format de date

| Option | Exemple |
|--------|---------|
| **JJ/MM/AAAA** | 15/03/2024 |
| **AAAA-MM-JJ** | 2024-03-15 |
| **MM/JJ/AAAA** | 03/15/2024 |

---

## Intégrations

### SAP

Configuration de la connexion SAP :

| Paramètre | Description |
|-----------|-------------|
| **Serveur** | Adresse du serveur SAP |
| **Mandant** | Numéro de mandant |
| **Utilisateur technique** | Compte de service |
| **Mot de passe** | Mot de passe technique |

### API

Gestion des clés API pour les intégrations :

1. Section **API**
2. **Générer une clé**
3. Copiez la clé (affichée une seule fois)
4. Configurez les droits de la clé

### Webhooks

Configurez des webhooks pour être notifié d'événements :

| Événement | URL de callback |
|-----------|-----------------|
| Nouveau contrôle | https://... |
| Non-conformité | https://... |

---

## Sauvegarde et export

### Export des données

Exportez l'intégralité de vos données :

1. Section **Export**
2. Sélectionnez le périmètre
3. Choisissez le format (JSON, Excel)
4. Lancez l'export

### Politique de rétention

Configurez la durée de conservation :

| Données | Rétention recommandée |
|---------|----------------------|
| Équipements | Illimitée |
| Contrôles | 10 ans |
| Historique | 5 ans |
| Fichiers | 5 ans |

---

## Maintenance

### Mode maintenance

Activez le mode maintenance pour les interventions :

1. Section **Maintenance**
2. Activez le mode
3. Les utilisateurs voient un message d'indisponibilité

### Logs

Consultez les logs techniques :
- Erreurs système
- Performances
- Connexions

---

## Personnalisation

### Textes personnalisés

Personnalisez certains libellés :

| Élément | Personnalisable |
|---------|-----------------|
| Titre de l'application | ✅ |
| Message d'accueil | ✅ |
| Pied de page | ✅ |

### Thème

Personnalisation visuelle limitée :
- Couleur principale
- Logo

---

## Bonnes pratiques

### Configuration initiale

1. Configurez les informations entreprise
2. Définissez les périodicités par défaut
3. Configurez les notifications
4. Appliquez la politique de sécurité

### Maintenance

- Revoyez les paramètres périodiquement
- Mettez à jour les intégrations si nécessaire
- Vérifiez les logs en cas de problème

### Documentation

- Documentez vos choix de configuration
- Informez les utilisateurs des changements
- Conservez un historique des modifications

---

## FAQ

### Les paramètres s'appliquent-ils immédiatement ?

La plupart oui. Certains (sécurité) s'appliquent à la prochaine connexion.

### Puis-je revenir aux paramètres par défaut ?

Oui, un bouton **Réinitialiser** est disponible pour chaque section.

### Qui peut modifier les paramètres ?

Uniquement les rôles Admin et Super Admin.

---

## Voir aussi

- [Gestion des utilisateurs](./utilisateurs.md)
- [Rôles et permissions](./roles.md)
