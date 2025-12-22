# Équipements globaux

Le module **Équipements globaux** (GLO) permet de gérer les onduleurs, batteries de compensation et systèmes d'éclairage de sécurité.

---

## Présentation

![Vue GLO](../assets/screenshots/glo-overview.png)
<!-- Capture d'écran recommandée : Page principale du module Équipements globaux -->

Les équipements globaux sont essentiels pour :

- **Continuité électrique** : Onduleurs (UPS)
- **Qualité du réseau** : Batteries de compensation
- **Sécurité des personnes** : Éclairage de sécurité

---

## Accéder au module

1. Tableau de bord → **Contrôles Électriques**
2. Cliquez sur **Global Electrical Equipments**

---

## Types d'équipements

### Onduleurs (UPS)

![Fiche UPS](../assets/screenshots/glo-ups-detail.png)
<!-- Capture d'écran recommandée : Fiche d'un onduleur -->

| Champ | Description |
|-------|-------------|
| **Type** | Online, Line-interactive, Offline |
| **Puissance** | kVA |
| **Autonomie** | Minutes à pleine charge |
| **Technologie batteries** | Plomb, Li-ion |
| **Âge batteries** | Date de mise en service |
| **Bypass** | Manuel / Automatique |

### Batteries de compensation

| Champ | Description |
|-------|-------------|
| **Puissance réactive** | kVAR |
| **Nombre de gradins** | Étapes de compensation |
| **Type de régulation** | Automatique / Manuel |
| **Condensateurs** | Nombre et capacité |
| **Année installation** | Date |

### Éclairage de sécurité

| Champ | Description |
|-------|-------------|
| **Type** | BAES, BAEH, bloc autonome |
| **Technologie** | LED, fluorescent |
| **Autonomie** | 1h, 5h... |
| **Mode** | Évacuation, ambiance, habitation |
| **Adressable** | Oui / Non |

---

## Interface

### Onglets

| Onglet | Description |
|--------|-------------|
| **Dashboard** | Vue synthétique |
| **Liste** | Inventaire des équipements |
| **Carte** | Localisation sur plans |
| **Calendrier** | Planning des contrôles |

### Filtres

Filtrez par :
- Type d'équipement (UPS, compensation, éclairage)
- Bâtiment
- Statut de contrôle

---

## Onduleurs (UPS)

### Caractéristiques détaillées

#### Électriques

| Champ | Unité |
|-------|-------|
| Puissance nominale | kVA |
| Facteur de puissance | cos φ |
| Tension entrée | V |
| Tension sortie | V |
| Rendement | % |

#### Batteries

| Champ | Description |
|-------|-------------|
| Type | Plomb-acide, Li-ion, NiCd |
| Nombre | Quantité de batteries |
| Tension | V par élément |
| Capacité | Ah |
| Date installation | Année |
| Durée de vie | Années |

### Contrôles spécifiques

| Contrôle | Fréquence | Description |
|----------|-----------|-------------|
| **Visuel** | Mensuel | État général, voyants |
| **Test autonomie** | Trimestriel | Test de décharge |
| **Mesure batteries** | Semestriel | Tension, impédance |
| **Maintenance** | Annuel | Nettoyage, resserrage |
| **Remplacement batteries** | 3-5 ans | Changement préventif |

### Points de vérification

- [ ] Voyants normaux (vert)
- [ ] Pas d'alarme active
- [ ] Batteries en charge
- [ ] Ventilation fonctionnelle
- [ ] Température ambiante OK
- [ ] Connexions serrées

---

## Batteries de compensation

### Fonction

Les batteries de condensateurs compensent l'énergie réactive et :
- Réduisent les pénalités du fournisseur
- Améliorent la qualité du réseau
- Libèrent de la puissance

### Caractéristiques

| Champ | Description |
|-------|-------------|
| Puissance totale | kVAR |
| Nombre de gradins | Étapes |
| Tension | V |
| Courant nominal | A |
| Type de filtre | Sans / Anti-harmoniques |

### Contrôles spécifiques

| Contrôle | Fréquence |
|----------|-----------|
| **Visuel** | Mensuel |
| **Mesure cos φ** | Trimestriel |
| **Vérification gradins** | Semestriel |
| **Thermographie** | Annuel |
| **Mesure condensateurs** | Annuel |

### Points de vérification

- [ ] Tous les gradins fonctionnels
- [ ] Pas de gonflement des condensateurs
- [ ] Régulateur opérationnel
- [ ] Contacteurs en bon état
- [ ] Ventilation efficace
- [ ] Cos φ dans les objectifs

---

## Éclairage de sécurité

### Réglementation

L'éclairage de sécurité est obligatoire (Code du travail, ERP).

| Type | Application |
|------|-------------|
| **BAES** | Bloc Autonome d'Éclairage de Sécurité |
| **BAEH** | Bloc Autonome d'Éclairage pour Habitation |
| **LSC** | Luminaire sur Source Centrale |

### Caractéristiques

| Champ | Description |
|-------|-------------|
| Type | BAES évacuation, ambiance, BAEH |
| Flux lumineux | lm |
| Autonomie | 1h standard, 5h si requis |
| Technologie | LED, fluorescent |
| Adressage | Oui / Non (SATI) |

### Contrôles réglementaires

| Contrôle | Fréquence | Responsable |
|----------|-----------|-------------|
| **Fonctionnement** | Mensuel | Exploitant |
| **Autonomie** | Semestriel ou annuel | Exploitant |
| **Maintenance** | Annuel | Technicien |

### Points de vérification

- [ ] Voyant de charge visible
- [ ] Allumage à la coupure secteur
- [ ] Pictogramme lisible
- [ ] Flux lumineux suffisant
- [ ] Autonomie respectée (test)
- [ ] Propreté du bloc

---

## Enregistrer un contrôle

### Procédure générale

1. Fiche équipement → **Ajouter un contrôle**
2. Sélectionnez le type de contrôle
3. Renseignez les mesures effectuées
4. Indiquez le résultat (OK / Anomalie)
5. Joignez photos ou rapport
6. Définissez la prochaine échéance

### Données spécifiques par type

#### UPS

- Tension batteries (V)
- Courant de charge (A)
- Autonomie mesurée (min)
- Alarmes actives

#### Compensation

- Cos φ mesuré
- Puissance réactive (kVAR)
- Gradins actifs
- Température condensateurs

#### Éclairage

- Test d'allumage OK/NOK
- Autonomie vérifiée
- Blocs défectueux (liste)

---

## Vue cartographique

![Carte GLO](../assets/screenshots/glo-map.png)
<!-- Capture d'écran recommandée : Vue carte avec les équipements globaux -->

Positionnez les équipements sur plans :

- **UPS** : Souvent en local technique
- **Compensation** : Proche des tableaux
- **BAES** : Dispersés dans les circulations

### Légende

| Icône | Type |
|-------|------|
| 🔋 | Onduleur |
| ⚡ | Compensation |
| 💡 | Éclairage sécurité |

---

## Maintenance préventive

### UPS

| Intervention | Fréquence |
|--------------|-----------|
| Nettoyage filtres | Trimestriel |
| Vérification connexions | Semestriel |
| Test batteries | Semestriel |
| Maintenance complète | Annuel |
| Remplacement batteries | 3-5 ans |

### Compensation

| Intervention | Fréquence |
|--------------|-----------|
| Nettoyage | Semestriel |
| Resserrage connexions | Annuel |
| Remplacement condensateurs | 10-15 ans |

### Éclairage sécurité

| Intervention | Fréquence |
|--------------|-----------|
| Nettoyage | Annuel |
| Remplacement batteries | 4-5 ans |
| Remplacement bloc | 10 ans |

---

## Bonnes pratiques

### Nommage

Convention suggérée :
```
[TYPE]-[BATIMENT]-[LOCAL]-[NUMERO]
```

Exemples :
- `UPS-A-INFO-01` : Onduleur salle info bât A
- `COMP-B-TGBT-01` : Compensation TGBT bât B
- `BAES-A-COUL-001` : BAES couloir bât A

### Suivi batteries

- Notez les dates de mise en service
- Planifiez les remplacements préventifs
- Stockez des batteries de rechange

### Documentation

- Conservez les notices d'utilisation
- Archivez les rapports de maintenance
- Gardez les certificats de conformité

---

## FAQ

### Quelle autonomie prévoir pour un UPS ?

Dépend de l'application :
- IT : 10-15 min (temps de basculer sur groupe)
- Critique : 30-60 min
- Avec groupe : 5-10 min (temps démarrage groupe)

### Comment savoir si les batteries sont usées ?

Signes d'usure :
- Autonomie réduite
- Tension faible
- Impédance élevée
- Gonflement visible

### Les BAES doivent-ils tous être testés ?

Oui, la réglementation impose un test mensuel de tous les blocs.

---

## Voir aussi

- [Tableaux électriques](./tableaux-electriques.md)
- [Contrôles périodiques](../fonctionnalites-communes/controles.md)
- [Cartographie](../fonctionnalites-communes/cartographie.md)
