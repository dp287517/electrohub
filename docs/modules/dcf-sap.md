# DCF SAP

Le module **DCF SAP** permet d'assurer le support et l'intégration avec le système SAP pour la maintenance.

---

## Présentation

![Vue DCF](../assets/screenshots/dcf-overview.png)
<!-- Capture d'écran recommandée : Page principale du module DCF SAP -->

Ce module fait le lien entre ElectroHub et SAP :

- **Synchronisation** des données d'équipements
- **Création** d'ordres de travail (OT)
- **Suivi** des interventions SAP
- **Reporting** consolidé

---

## Accéder au module

1. Tableau de bord → **Utilitaires & Outils**
2. Cliquez sur **Dcf**

---

## Fonctionnalités

### Synchronisation des équipements

| Direction | Description |
|-----------|-------------|
| **SAP → ElectroHub** | Import des postes techniques |
| **ElectroHub → SAP** | Export des modifications |

### Ordres de travail

Créez des ordres de maintenance depuis ElectroHub :
- OT préventif (plan de maintenance)
- OT correctif (suite à anomalie)
- OT curatif (réparation)

### Suivi des interventions

Consultez le statut des OT en cours :
- Créé
- Planifié
- En cours
- Terminé
- Clôturé

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue d'ensemble |
| **Équipements** | Mapping avec SAP |
| **Ordres** | OT en cours |
| **Historique** | Interventions passées |

---

## Mapping des équipements

### Correspondance ElectroHub / SAP

| ElectroHub | SAP |
|------------|-----|
| Équipement | Poste technique |
| TAG | Numéro d'équipement |
| Localisation | Emplacement fonctionnel |
| Type | Catégorie d'équipement |

### Configuration du mapping

1. Onglet **Équipements**
2. Sélectionnez un équipement ElectroHub
3. Associez le poste technique SAP correspondant
4. Validez le mapping

---

## Créer un ordre de travail

### Depuis une anomalie

1. Identifiez l'anomalie dans ElectroHub
2. Cliquez sur **Créer OT SAP**
3. Renseignez les informations :

| Champ | Description |
|-------|-------------|
| **Équipement** | Poste technique |
| **Type d'OT** | Préventif, correctif, curatif |
| **Priorité** | 1 (urgent) à 4 (planifiable) |
| **Description** | Nature de l'intervention |
| **Date souhaitée** | Échéance |

4. Validez la création

### Depuis un contrôle

Après un contrôle avec non-conformité :
1. Fiche de contrôle → **Créer action SAP**
2. L'OT est pré-rempli avec les informations du contrôle
3. Complétez et validez

---

## Suivi des ordres

### Liste des OT

| N° OT | Équipement | Type | Statut | Priorité | Date |
|-------|------------|------|--------|----------|------|
| 4001234 | TGBT-A-01 | Correctif | En cours | 2 | 15/03 |
| 4001235 | VSD-B-03 | Préventif | Planifié | 3 | 20/03 |
| 4001236 | PMP-C-01 | Curatif | Terminé | 1 | 10/03 |

### Détail d'un OT

Consultez :
- Informations de l'OT
- Équipement concerné
- Opérations prévues
- Pièces commandées
- Historique des statuts

---

## Reporting

### Indicateurs

| Indicateur | Description |
|------------|-------------|
| **OT créés** | Nombre par période |
| **OT clôturés** | Interventions terminées |
| **Délai moyen** | Temps de traitement |
| **Taux de respect** | Respect des délais |

### Export

Exportez les données pour analyse :
- Format Excel
- Format PDF
- Extraction SAP

---

## Configuration

### Paramètres de connexion

La connexion SAP est configurée par l'administrateur :

| Paramètre | Description |
|-----------|-------------|
| **Serveur** | Adresse du serveur SAP |
| **Mandant** | Numéro de mandant |
| **Utilisateur** | Compte technique |
| **Mot de passe** | Mot de passe technique |

### Paramètres métier

| Paramètre | Description |
|-----------|-------------|
| **Centre de coûts** | Imputation par défaut |
| **Groupe planificateur** | Équipe de maintenance |
| **Atelier** | Atelier de rattachement |

---

## Synchronisation

### Automatique

La synchronisation peut être programmée :
- Fréquence : Quotidienne, hebdomadaire
- Heure : Généralement la nuit
- Périmètre : Complet ou incrémental

### Manuelle

Déclenchez une synchronisation à la demande :
1. **Synchroniser maintenant**
2. Sélectionnez le périmètre
3. Lancez la synchronisation

### Résolution des conflits

En cas de conflit (modification des deux côtés) :
- L'utilisateur est alerté
- Choix : SAP ou ElectroHub prioritaire
- Validation manuelle

---

## Bonnes pratiques

### Mapping

- Mappez tous les équipements critiques
- Vérifiez régulièrement la cohérence
- Mettez à jour les nouveaux équipements

### Ordres de travail

- Créez les OT dès l'identification du besoin
- Renseignez des descriptions claires
- Suivez les OT jusqu'à clôture

### Synchronisation

- Planifiez des synchros régulières
- Vérifiez les erreurs de synchro
- Résolvez les conflits rapidement

---

## Dépannage

### OT non créé

Vérifiez :
- Mapping équipement correct
- Connexion SAP active
- Droits utilisateur suffisants

### Synchronisation en erreur

Causes possibles :
- Connexion réseau
- Timeout SAP
- Données invalides

Actions :
1. Consultez le log d'erreur
2. Corrigez les données
3. Relancez la synchro

---

## FAQ

### Faut-il une licence SAP pour utiliser ce module ?

L'accès technique à SAP est géré par un compte de service. Les utilisateurs ElectroHub n'ont pas besoin de licence SAP individuelle.

### Les modifications dans SAP sont-elles visibles dans ElectroHub ?

Oui, après synchronisation (automatique ou manuelle).

### Puis-je créer un OT sans mapping préalable ?

Non, l'équipement doit être mappé avec un poste technique SAP.

---

## Voir aussi

- [Tableaux électriques](./tableaux-electriques.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
