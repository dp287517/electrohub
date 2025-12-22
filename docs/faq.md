# FAQ - Questions fréquentes

Cette page répond aux questions les plus fréquemment posées sur ElectroHub.

---

## Général

### Qu'est-ce qu'ElectroHub ?

ElectroHub est une application web de gestion de la maintenance électrique industrielle (GMAO spécialisée). Elle permet de gérer les équipements électriques, planifier les contrôles et assurer la conformité réglementaire.

### Quels navigateurs sont compatibles ?

ElectroHub fonctionne sur tous les navigateurs modernes :
- Google Chrome (recommandé)
- Mozilla Firefox
- Microsoft Edge
- Safari

### ElectroHub fonctionne-t-il sur mobile ?

Oui, l'interface est responsive et s'adapte aux tablettes et smartphones.

### Faut-il installer quelque chose ?

Non, ElectroHub est une application web. Il suffit d'un navigateur et d'une connexion internet.

---

## Compte et connexion

### Comment créer un compte ?

Les comptes sont créés par les administrateurs. Contactez votre responsable pour obtenir un accès.

### J'ai oublié mon mot de passe

1. Sur la page de connexion, cliquez sur **Mot de passe oublié**
2. Entrez votre email
3. Suivez les instructions reçues par email

### Je ne peux pas me connecter

Vérifiez :
- Votre email est correct
- Votre mot de passe est correct (attention aux majuscules)
- Votre compte est actif

Contactez votre administrateur si le problème persiste.

### Comment changer mon mot de passe ?

1. Allez dans votre profil
2. Cliquez sur **Modifier le mot de passe**
3. Entrez l'ancien et le nouveau mot de passe

---

## Utilisation quotidienne

### Comment créer un équipement ?

1. Accédez au module concerné (ex: Tableaux, VSD...)
2. Cliquez sur **+ Nouveau**
3. Remplissez le formulaire
4. Enregistrez

Voir [Créer votre premier équipement](./demarrage/premier-equipement.md)

### Comment effectuer un contrôle ?

1. Ouvrez la fiche de l'équipement
2. Cliquez sur **Ajouter un contrôle**
3. Remplissez les informations
4. Enregistrez

Voir [Contrôles périodiques](./fonctionnalites-communes/controles.md)

### Comment positionner un équipement sur la carte ?

1. Ouvrez la fiche de l'équipement
2. Cliquez sur **Positionner sur carte**
3. Sélectionnez le plan
4. Cliquez sur l'emplacement

Voir [Cartographie interactive](./fonctionnalites-communes/cartographie.md)

### Comment exporter un rapport ?

1. Ouvrez la fiche ou la liste souhaitée
2. Cliquez sur **Exporter** ou l'icône PDF/Excel
3. Le fichier est téléchargé

Voir [Export PDF et Excel](./fonctionnalites-communes/exports.md)

---

## Équipements

### Comment retrouver un équipement ?

- Utilisez la **barre de recherche** avec le TAG ou le nom
- Utilisez les **filtres** (bâtiment, statut...)
- Consultez la **carte** pour localiser visuellement

### Comment dupliquer un équipement ?

1. Ouvrez la fiche de l'équipement
2. Menu actions → **Dupliquer**
3. Modifiez les informations de la copie
4. Enregistrez

### Comment supprimer un équipement ?

1. Ouvrez la fiche de l'équipement
2. Menu actions → **Supprimer**
3. Confirmez

⚠️ La suppression est définitive.

### Comment modifier plusieurs équipements à la fois ?

Actuellement, les modifications se font équipement par équipement. Contactez votre administrateur pour les imports en masse.

---

## Contrôles

### Que signifient les couleurs des contrôles ?

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | Prochain contrôle > 30 jours |
| 🟠 Orange | Contrôle à faire dans les 30 jours |
| 🔴 Rouge | Contrôle en retard |

### Comment modifier un contrôle déjà enregistré ?

1. Ouvrez la fiche de l'équipement
2. Section Historique → Cliquez sur le contrôle
3. Modifiez les informations
4. Enregistrez

### Puis-je antidater un contrôle ?

Oui, indiquez la date réelle du contrôle dans le formulaire.

### Comment planifier les contrôles ?

La planification est automatique basée sur :
- La périodicité définie
- La date du dernier contrôle

---

## Documents et fichiers

### Quels formats de fichiers sont acceptés ?

- Documents : PDF, DOCX, XLSX
- Images : PNG, JPG, JPEG

### Quelle est la taille maximale des fichiers ?

10 Mo par fichier.

### Comment supprimer un fichier ?

1. Localisez le fichier dans la fiche
2. Cliquez sur l'icône de suppression
3. Confirmez

---

## Cartes et plans

### Comment importer un plan ?

1. Onglet Carte/Plans
2. Cliquez sur **Ajouter un plan**
3. Sélectionnez le fichier (PDF ou image)
4. Nommez et classez le plan

### Les plans CAO (DWG) sont-ils supportés ?

Non directement. Exportez-les d'abord en PDF ou PNG.

### Comment déplacer un marqueur sur la carte ?

1. Cliquez sur le marqueur pour le sélectionner
2. Glissez-le vers le nouvel emplacement
3. Relâchez

---

## Rôles et accès

### Quels sont les différents rôles ?

| Rôle | Périmètre |
|------|-----------|
| Super Admin | Toute la plateforme |
| Admin | Son entreprise |
| Global | Tous les sites |
| Site | Son site uniquement |

Voir [Rôles et permissions](./administration/roles.md)

### Comment changer de site ?

Les utilisateurs Global/Admin peuvent changer de site depuis le tableau de bord en cliquant sur le sélecteur de site.

### Je ne vois pas certaines applications

Votre accès aux applications peut être restreint. Contactez votre administrateur.

---

## Performance et problèmes

### L'application est lente

Essayez :
1. Rafraîchir la page
2. Vider le cache du navigateur
3. Fermer les onglets inutiles
4. Utiliser un autre navigateur

### Une erreur s'affiche

1. Notez le message d'erreur
2. Rafraîchissez la page
3. Réessayez l'action
4. Contactez le support si le problème persiste

### Je ne vois pas mes données

Vérifiez :
- Que vous êtes sur le bon site
- Que les filtres ne masquent pas vos données
- Que vous avez les droits d'accès

---

## ATEX

### Comment lire un marquage ATEX ?

Voir [Module ATEX](./modules/atex.md) pour le détail du marquage.

### Quelle est la fréquence des contrôles ATEX ?

Généralement annuelle, mais vérifiez la réglementation applicable à votre site.

---

## Assistance

### Comment obtenir de l'aide ?

1. Consultez cette documentation
2. Utilisez l'assistant IA
3. Contactez votre administrateur
4. Contactez le support technique

### Comment signaler un bug ?

Contactez votre administrateur avec :
- Description du problème
- Capture d'écran si possible
- Étapes pour reproduire le problème

### Où trouver les mises à jour ?

Les mises à jour sont déployées automatiquement. Consultez les notes de version pour les nouveautés.

---

## Voir aussi

- [Glossaire](./glossaire.md)
- [Présentation](./introduction/presentation.md)
