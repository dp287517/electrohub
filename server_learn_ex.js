// server_learn_ex.js — Formation ATEX Niveau 0 pour Intervenants
// Port: 3040

import express from "express";
import dotenv from "dotenv";
import pg from "pg";
import cors from "cors";
import PDFDocument from "pdfkit";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// ============================================================================
// CONFIGURATION DE LA FORMATION
// ============================================================================

const FORMATION_CONFIG = {
  id: "atex-level-0",
  title: "Sensibilisation ATEX Niveau 0",
  subtitle: "Formation pour intervenants en zone ATEX",
  duration: "2 heures",
  validity: "3 ans",
  passingScore: 70, // % minimum pour obtenir le certificat
  totalModules: 7,
  version: "1.0.0",
};

// ============================================================================
// CONTENU DES MODULES DE FORMATION
// ============================================================================

const FORMATION_MODULES = [
  {
    id: 1,
    slug: "introduction",
    title: "Introduction",
    subtitle: "Objectifs et définitions",
    duration: "10 min",
    icon: "BookOpen",
    color: "#3B82F6",
    sections: [
      {
        id: "intro-1",
        title: "Objectifs de la formation",
        content: `
Cette formation a pour but de vous sensibiliser aux risques liés aux atmosphères explosives (ATEX) 
et de vous permettre de travailler en toute sécurité dans ces zones.

**À l'issue de cette formation, vous serez capable de :**
- Identifier une zone ATEX et comprendre sa signalisation
- Reconnaître les dangers et risques spécifiques
- Appliquer les bonnes pratiques et procédures
- Connaître les équipements autorisés et interdits
- Réagir correctement en cas d'incident
        `,
        image: "intro-objectives",
        keyPoints: [
          "Formation obligatoire pour tout intervenant en zone ATEX",
          "Validité de 3 ans",
          "QCM de validation en fin de formation",
        ],
      },
      {
        id: "intro-2",
        title: "Qu'est-ce qu'une ATEX ?",
        content: `
**ATEX** signifie **AT**mosphère **EX**plosive.

Une atmosphère explosive est un mélange d'air avec des substances inflammables 
(gaz, vapeurs, brouillards ou poussières) dans des proportions telles qu'une 
source d'inflammation peut provoquer une explosion.

**Cadre réglementaire :**
- Directive européenne 1999/92/CE (ATEX 137)
- Directive 2014/34/UE (ATEX 114)
- Code du travail français (Articles R. 4227-42 à R. 4227-54)
        `,
        image: "intro-atex-definition",
        keyPoints: [
          "ATEX = ATmosphère EXplosive",
          "Mélange air + substance inflammable",
          "Réglementation européenne stricte",
        ],
      },
    ],
    quiz: [
      {
        id: "q1-1",
        question: "Que signifie l'acronyme ATEX ?",
        options: [
          "Atmosphère Explosive",
          "Attention Explosion",
          "Air Toxique Explosif",
          "Alarme Technique Externe",
        ],
        correct: 0,
        explanation:
          "ATEX est l'abréviation de ATmosphère EXplosive, désignant un mélange d'air et de substances inflammables.",
      },
      {
        id: "q1-2",
        question: "Quelle est la durée de validité de cette formation ?",
        options: ["1 an", "2 ans", "3 ans", "5 ans"],
        correct: 2,
        explanation:
          "La formation ATEX niveau 0 est valide pendant 3 ans, après quoi un recyclage est nécessaire.",
      },
    ],
  },
  {
    id: 2,
    slug: "explosions",
    title: "Sensibilisation aux explosions",
    subtitle: "Mécanismes et dangers",
    duration: "20 min",
    icon: "Flame",
    color: "#EF4444",
    sections: [
      {
        id: "exp-1",
        title: "Le triangle du feu",
        content: `
Pour qu'un feu se déclenche, trois éléments doivent être présents simultanément :

**1. COMBUSTIBLE** (ce qui brûle)
- Gaz : méthane, propane, hydrogène...
- Liquides : essence, solvants, alcools...
- Solides : poussières de bois, métaux, céréales...

**2. COMBURANT** (ce qui permet de brûler)
- Généralement l'oxygène de l'air (21%)
- Certains produits chimiques oxydants

**3. ÉNERGIE D'ACTIVATION** (ce qui déclenche)
- Flamme, étincelle, surface chaude
- Électricité statique
- Réaction chimique
        `,
        image: "triangle-feu",
        keyPoints: [
          "Combustible + Comburant + Énergie = FEU",
          "Supprimer un élément = pas de feu",
          "Base de la prévention incendie",
        ],
      },
      {
        id: "exp-2",
        title: "L'hexagone de l'explosion",
        content: `
Une explosion nécessite **6 conditions** simultanées (hexagone de l'explosion) :

**Les 3 éléments du feu :**
1. Combustible
2. Comburant (oxygène)
3. Source d'inflammation

**+ 3 conditions supplémentaires :**
4. **Domaine d'explosivité** : concentration entre LIE et LSE
5. **Confinement** : espace clos ou semi-clos
6. **Mélange homogène** : dispersion suffisante

**LIE** = Limite Inférieure d'Explosivité
**LSE** = Limite Supérieure d'Explosivité

Exemple du méthane : LIE = 5% / LSE = 15%
En dessous de 5% : mélange trop pauvre
Au-dessus de 15% : mélange trop riche
        `,
        image: "hexagone-explosion",
        keyPoints: [
          "6 conditions nécessaires pour une explosion",
          "Concentration entre LIE et LSE",
          "Le confinement amplifie les effets",
        ],
      },
      {
        id: "exp-3",
        title: "Effets d'une explosion",
        content: `
Une explosion ATEX peut produire des effets dévastateurs :

**Effets thermiques :**
- Températures de plusieurs milliers de degrés
- Brûlures graves voire mortelles
- Propagation d'incendies

**Effets de pression (souffle) :**
- Onde de choc destructrice
- Projection de débris
- Effondrement de structures
- Lésions internes (poumons, oreilles)

**Effets toxiques :**
- Gaz de combustion nocifs
- Asphyxie par manque d'oxygène

**Statistiques :**
- En France : ~100 explosions ATEX/an en milieu industriel
- Conséquences souvent graves ou mortelles
        `,
        image: "effets-explosion",
        keyPoints: [
          "Effets thermiques, mécaniques et toxiques",
          "Conséquences souvent irréversibles",
          "~100 accidents ATEX/an en France",
        ],
      },
      {
        id: "exp-4",
        title: "L'électricité statique",
        content: `
L'électricité statique est une source d'inflammation souvent sous-estimée.

**Comment elle se forme :**
- Frottement entre matériaux différents
- Écoulement de liquides dans des tuyaux
- Transport de poudres et granulés
- Déplacement de personnes

**Énergie d'inflammation :**
- Étincelle humaine : 10-20 mJ (millijoules)
- Inflammation hydrogène : 0,02 mJ
- Inflammation méthane : 0,28 mJ

➡️ **Une simple décharge humaine peut enflammer la plupart des gaz !**

**Prévention :**
- Mise à la terre des équipements
- Vêtements et chaussures antistatiques
- Humidification de l'air
- Liaisons équipotentielles
        `,
        image: "electricite-statique",
        keyPoints: [
          "Danger souvent invisible",
          "Très faible énergie suffisante",
          "Équipements antistatiques obligatoires",
        ],
      },
      {
        id: "exp-5",
        title: "Substances les plus dangereuses",
        content: `
**GAZ inflammables courants :**
| Gaz | LIE | LSE | Danger |
|-----|-----|-----|--------|
| Hydrogène (H₂) | 4% | 75% | Très large domaine, très réactif |
| Méthane (CH₄) | 5% | 15% | Gaz naturel, mines |
| Propane (C₃H₈) | 2,1% | 9,5% | Plus lourd que l'air |
| Acétylène (C₂H₂) | 2,5% | 80% | Extrêmement dangereux |

**POUSSIÈRES explosives :**
- Farine, sucre, amidon
- Poussières de bois
- Charbon, soufre
- Métaux (aluminium, magnésium)
- Produits pharmaceutiques

⚠️ **Les poussières sont souvent plus dangereuses que les gaz** car l'explosion 
peut soulever des dépôts et provoquer des explosions secondaires en chaîne.
        `,
        image: "substances-dangereuses",
        keyPoints: [
          "Hydrogène et acétylène très dangereux",
          "Poussières organiques explosives",
          "Explosions secondaires possibles",
        ],
      },
    ],
    quiz: [
      {
        id: "q2-1",
        question:
          "Combien d'éléments composent l'hexagone de l'explosion ?",
        options: ["3", "4", "5", "6"],
        correct: 3,
        explanation:
          "L'hexagone de l'explosion comprend 6 éléments : les 3 du triangle du feu + domaine d'explosivité, confinement et mélange homogène.",
      },
      {
        id: "q2-2",
        question: "Que signifie LIE ?",
        options: [
          "Limite Inférieure d'Explosivité",
          "Limite d'Inflammation Externe",
          "Ligne d'Intervention d'Urgence",
          "Limite Industrielle Européenne",
        ],
        correct: 0,
        explanation:
          "LIE = Limite Inférieure d'Explosivité. C'est la concentration minimale de combustible dans l'air pour qu'une explosion soit possible.",
      },
      {
        id: "q2-3",
        question:
          "Quelle est la principale source d'inflammation souvent sous-estimée ?",
        options: [
          "Les flammes nues",
          "L'électricité statique",
          "Les surfaces chaudes",
          "Les réactions chimiques",
        ],
        correct: 1,
        explanation:
          "L'électricité statique est souvent sous-estimée car invisible. Une simple décharge humaine (10-20 mJ) peut enflammer la plupart des gaz.",
      },
      {
        id: "q2-4",
        question: "Pourquoi les poussières sont-elles particulièrement dangereuses ?",
        options: [
          "Elles sont toujours toxiques",
          "Elles peuvent provoquer des explosions en chaîne",
          "Elles sont plus chaudes",
          "Elles sont invisibles",
        ],
        correct: 1,
        explanation:
          "Les explosions de poussières peuvent soulever des dépôts et provoquer des explosions secondaires en chaîne, souvent plus violentes que la première.",
      },
    ],
  },
  {
    id: 3,
    slug: "marquage",
    title: "Le marquage ATEX",
    subtitle: "Identifier les zones et équipements",
    duration: "15 min",
    icon: "AlertTriangle",
    color: "#F59E0B",
    sections: [
      {
        id: "mark-1",
        title: "Le panneau ATEX",
        content: `
Le panneau de signalisation ATEX est **obligatoire** à l'entrée de toute zone explosive.

**Caractéristiques :**
- Forme triangulaire
- Fond jaune
- Bordure noire
- Lettres "EX" noires au centre

Ce panneau vous indique que vous entrez dans une zone où des mesures 
de sécurité particulières s'appliquent.

**À retenir :**
- Vérifiez toujours la présence de ce panneau
- Respectez les consignes affichées
- En cas de doute, demandez avant d'entrer
        `,
        image: "panneau-atex",
        keyPoints: [
          "Triangle jaune avec EX noir",
          "Obligatoire à l'entrée des zones",
          "Indique des règles spéciales",
        ],
      },
      {
        id: "mark-2",
        title: "Les zones ATEX",
        content: `
Les zones ATEX sont classées selon la **fréquence** et la **durée** de présence 
de l'atmosphère explosive.

**ZONES GAZ/VAPEURS :**
| Zone | Présence ATEX | Exemple |
|------|---------------|---------|
| **Zone 0** | Permanente ou fréquente | Intérieur de cuves |
| **Zone 1** | Occasionnelle en fonctionnement normal | Abords d'équipements |
| **Zone 2** | Rare et de courte durée | Zone éloignée, fuite accidentelle |

**ZONES POUSSIÈRES :**
| Zone | Présence ATEX | Exemple |
|------|---------------|---------|
| **Zone 20** | Permanente (nuage) | Intérieur silos |
| **Zone 21** | Occasionnelle | Postes de chargement |
| **Zone 22** | Rare et courte durée | Accumulation accidentelle |

➡️ **Plus le chiffre est bas, plus le danger est élevé**
        `,
        image: "zones-atex",
        keyPoints: [
          "Zones 0, 1, 2 pour les gaz",
          "Zones 20, 21, 22 pour les poussières",
          "Chiffre bas = danger élevé",
        ],
      },
      {
        id: "mark-3",
        title: "Marquage des équipements ATEX",
        content: `
Les équipements certifiés ATEX portent un marquage spécifique.

**Symbole de base :**
- Hexagone jaune contenant "Ex" 
- Suivi du marquage détaillé

**Exemple de marquage :**
\`II 2 G Ex d IIB T4\`

**Décodage :**
- **II** : Groupe d'équipement (II = surface, I = mines)
- **2** : Catégorie (1, 2 ou 3 selon le niveau de protection)
- **G** : Type d'atmosphère (G = Gaz, D = Dust/poussières)
- **Ex d** : Mode de protection (d = enveloppe antidéflagrante)
- **IIB** : Groupe de gaz (IIA, IIB ou IIC par dangerosité croissante)
- **T4** : Classe de température (T1 à T6)

**Groupes de gaz :**
- **IIA** : Propane, méthane (moins dangereux)
- **IIB** : Éthylène, solvants
- **IIC** : Hydrogène, acétylène (plus dangereux)
        `,
        image: "marquage-equipement",
        keyPoints: [
          "Hexagone Ex = équipement certifié",
          "IIA < IIB < IIC en dangerosité",
          "Toujours vérifier la compatibilité zone/équipement",
        ],
      },
    ],
    quiz: [
      {
        id: "q3-1",
        question: "Quelle zone présente le risque le plus élevé ?",
        options: ["Zone 0", "Zone 1", "Zone 2", "Zone 22"],
        correct: 0,
        explanation:
          "La Zone 0 présente le risque le plus élevé car l'atmosphère explosive y est présente en permanence ou très fréquemment.",
      },
      {
        id: "q3-2",
        question: "Que signifie la lettre 'G' dans le marquage ATEX ?",
        options: [
          "Groupe",
          "Gaz",
          "Garantie",
          "Grade",
        ],
        correct: 1,
        explanation:
          "G signifie Gas (Gaz). D signifierait Dust (Poussières). Cela indique le type d'atmosphère explosive concerné.",
      },
      {
        id: "q3-3",
        question: "Quel groupe de gaz est le plus dangereux ?",
        options: ["IIA", "IIB", "IIC", "Ils sont équivalents"],
        correct: 2,
        explanation:
          "IIC est le plus dangereux (hydrogène, acétylène). Un équipement certifié IIC peut être utilisé en IIA et IIB, mais pas l'inverse.",
      },
    ],
  },
  {
    id: 4,
    slug: "procedures",
    title: "Procédures en zone ATEX",
    subtitle: "Ce qu'il faut faire",
    duration: "15 min",
    icon: "ClipboardCheck",
    color: "#10B981",
    sections: [
      {
        id: "proc-1",
        title: "Avant d'entrer en zone ATEX",
        content: `
**Vérifications obligatoires avant toute entrée :**

✅ **Autorisation de travail**
- Avez-vous l'autorisation d'intervenir ?
- Le permis de travail est-il signé ?

✅ **Équipements de protection**
- Vêtements antistatiques homologués
- Chaussures de sécurité antistatiques (marquage ESD)
- EPI spécifiques si nécessaire

✅ **Matériel autorisé uniquement**
- Pas de téléphone portable standard
- Pas de montre connectée
- Outillage certifié si intervention

✅ **Connaissance des consignes**
- Lire les affichages à l'entrée
- Connaître les issues de secours
- Savoir qui contacter en cas de problème
        `,
        image: "avant-entree",
        keyPoints: [
          "Toujours vérifier son autorisation",
          "Porter les EPI antistatiques",
          "Laisser les appareils non certifiés",
        ],
      },
      {
        id: "proc-2",
        title: "Le permis de feu",
        content: `
Le **permis de feu** est un document obligatoire pour tout travail générant 
des points chauds en zone ATEX ou à proximité.

**Travaux concernés :**
- Soudure, découpe, meulage
- Utilisation de flammes nues
- Travaux générant des étincelles

**Contenu du permis :**
- Identification de la zone et des risques
- Mesures de prévention (consignation, ventilation, détection)
- Durée de validité (généralement 8h max)
- Signatures du demandeur et du responsable

**Procédure type :**
1. Demande au responsable de zone
2. Évaluation des risques
3. Mise en place des mesures de sécurité
4. Contrôle atmosphère avant, pendant, après
5. Surveillance post-travaux (2h minimum)

⚠️ **JAMAIS de travaux par points chauds sans permis de feu validé**
        `,
        image: "permis-feu",
        keyPoints: [
          "Obligatoire pour tout point chaud",
          "Validité limitée dans le temps",
          "Surveillance 2h après les travaux",
        ],
      },
      {
        id: "proc-3",
        title: "EPI antistatiques",
        content: `
En zone ATEX, les équipements de protection individuelle (EPI) doivent 
empêcher l'accumulation d'électricité statique.

**Vêtements de travail :**
- Tissus antistatiques (fibres conductrices)
- Pas de matières synthétiques classiques
- Fermetures non métalliques ou protégées
- Marquage EN 1149-5

**Chaussures de sécurité :**
- Semelles conductrices ou antistatiques
- Marquage ESD ou antistatique
- Résistance < 100 MΩ
- Vérification régulière de la conductivité

**Autres EPI si nécessaire :**
- Gants antistatiques
- Casque antistatique
- Lunettes de protection

**Bonnes pratiques :**
- Porter l'ensemble vêtement + chaussures antistatiques
- Éviter les sous-vêtements synthétiques
- Ne pas modifier les vêtements (couture, etc.)
        `,
        image: "epi-antistatique",
        keyPoints: [
          "Vêtements EN 1149-5",
          "Chaussures ESD obligatoires",
          "Ensemble complet nécessaire",
        ],
      },
      {
        id: "proc-4",
        title: "Procédure d'urgence",
        content: `
**En cas de détection de gaz ou d'anomalie :**

**1. ALERTER**
- Prévenir immédiatement les personnes à proximité
- Activer l'alarme si disponible
- Appeler le numéro d'urgence du site

**2. ÉVACUER**
- Quitter la zone par le chemin le plus court
- Ne pas courir (risque d'étincelle statique)
- Aider les personnes en difficulté
- Se regrouper au point de rassemblement

**3. NE PAS**
- Utiliser d'interrupteurs électriques
- Utiliser de téléphone non certifié dans la zone
- Retourner chercher des affaires
- Tenter d'intervenir soi-même sur la fuite

**Numéros d'urgence à connaître :**
- Numéro interne du site : __________
- SAMU : 15
- Pompiers : 18
- Numéro européen : 112
        `,
        image: "procedure-urgence",
        keyPoints: [
          "Alerter - Évacuer - Ne pas intervenir",
          "Connaître les numéros d'urgence",
          "Point de rassemblement obligatoire",
        ],
      },
    ],
    quiz: [
      {
        id: "q4-1",
        question: "Quelle est la durée minimale de surveillance après des travaux par points chauds ?",
        options: ["30 minutes", "1 heure", "2 heures", "4 heures"],
        correct: 2,
        explanation:
          "La surveillance post-travaux doit durer au minimum 2 heures pour détecter tout départ de feu tardif.",
      },
      {
        id: "q4-2",
        question: "Quel marquage doivent porter les chaussures en zone ATEX ?",
        options: ["CE", "ESD ou antistatique", "ATEX", "ISO 9001"],
        correct: 1,
        explanation:
          "Les chaussures doivent être marquées ESD (Electrostatic Discharge) ou antistatiques pour évacuer les charges statiques.",
      },
      {
        id: "q4-3",
        question: "Que faire en premier en cas de détection de gaz ?",
        options: [
          "Éteindre les machines",
          "Alerter et évacuer",
          "Chercher l'origine de la fuite",
          "Appeler son responsable",
        ],
        correct: 1,
        explanation:
          "La priorité est d'alerter les personnes autour et d'évacuer rapidement. Ne jamais tenter d'intervenir sur la fuite.",
      },
    ],
  },
  {
    id: 5,
    slug: "interdits",
    title: "Ce qu'il ne faut pas faire",
    subtitle: "Comportements à risque",
    duration: "15 min",
    icon: "Ban",
    color: "#DC2626",
    sections: [
      {
        id: "int-1",
        title: "Appareils électroniques interdits",
        content: `
**Téléphones portables et appareils connectés :**

❌ **INTERDITS en zone ATEX :**
- Smartphones personnels
- Montres connectées
- Tablettes, laptops
- Écouteurs Bluetooth
- Appareils photo numériques

**Pourquoi ?**
- Batteries lithium : risque d'échauffement
- Circuits électroniques : étincelles possibles
- Ondes radio : peuvent déclencher des équipements

✅ **Alternative autorisée :**
- Téléphones certifiés ATEX (ex: zones 1/21 ou 2/22)
- Talkies-walkies certifiés
- Détecteurs de gaz portables certifiés

**Sanction possible :**
L'introduction d'un appareil non certifié en zone ATEX peut entraîner :
- Sanctions disciplinaires
- Responsabilité pénale en cas d'accident
        `,
        image: "appareils-interdits",
        keyPoints: [
          "Téléphones personnels INTERDITS",
          "Montres connectées INTERDITES",
          "Seuls appareils certifiés ATEX autorisés",
        ],
      },
      {
        id: "int-2",
        title: "Sources d'inflammation à éviter",
        content: `
**Toutes les sources d'étincelles sont dangereuses :**

❌ **Chocs mécaniques :**
- Chute d'outils métalliques
- Frottement métal contre métal
- Impact violent sur le sol

❌ **Sources électriques :**
- Interrupteurs non certifiés
- Prises de courant standard
- Câbles dénudés ou abîmés

❌ **Flammes et points chauds :**
- Cigarettes, briquets, allumettes
- Meuleuses, chalumeaux (sans permis)
- Surfaces chaudes > 200°C

❌ **Autres :**
- Télécommandes infrarouges
- Flash d'appareil photo
- Lampes non certifiées

**Comportement sûr :**
- Manipuler les équipements avec précaution
- Signaler tout équipement endommagé
- Utiliser uniquement le matériel fourni
        `,
        image: "sources-inflammation",
        keyPoints: [
          "Éviter tout choc mécanique",
          "Ne jamais fumer en zone ATEX",
          "Signaler les équipements abîmés",
        ],
      },
      {
        id: "int-3",
        title: "Véhicules en zone ATEX",
        content: `
**Règles pour les véhicules :**

❌ **INTERDIT :**
- Entrer en véhicule non autorisé
- Stationner moteur allumé
- Faire le plein en zone ATEX
- Utiliser le klaxon

⚠️ **En cas de nappe de gaz visible :**
- NE PAS démarrer de véhicule
- NE PAS arrêter un véhicule en fonctionnement dans la nappe
- S'éloigner à pied, face au vent
- Prévenir les secours à distance de la zone

**Véhicules autorisés :**
- Engins certifiés ATEX (chariots élévateurs, etc.)
- Véhicules avec pare-étincelles sur l'échappement
- Autorisation écrite du responsable

**Bonnes pratiques :**
- Vérifier l'état du véhicule avant entrée
- Respecter les itinéraires balisés
- Vitesse réduite obligatoire
        `,
        image: "vehicules-atex",
        keyPoints: [
          "Véhicules certifiés uniquement",
          "Ne jamais traverser une nappe de gaz",
          "Autorisation préalable obligatoire",
        ],
      },
      {
        id: "int-4",
        title: "Dégradation du matériel ATEX",
        content: `
**Un équipement ATEX endommagé perd sa certification !**

**Exemples de dégradations critiques :**
- Boîtier fissuré ou percé
- Joint d'étanchéité abîmé
- Vis manquantes sur un capot
- Câble d'alimentation dénudé
- Peinture antidéflagrante écaillée

**Conséquences d'un équipement dégradé :**
- Perte du mode de protection
- Risque d'inflammation
- Non-conformité réglementaire
- Responsabilité de l'utilisateur

**Que faire si vous constatez une dégradation :**
1. NE PAS utiliser l'équipement
2. Signaler immédiatement au responsable
3. Baliser si nécessaire
4. Ne pas tenter de réparer soi-même

⚠️ **Seul du personnel habilité peut intervenir sur du matériel ATEX**
        `,
        image: "degradation-materiel",
        keyPoints: [
          "Équipement abîmé = non certifié",
          "Signaler toute anomalie",
          "Ne jamais réparer soi-même",
        ],
      },
    ],
    quiz: [
      {
        id: "q5-1",
        question: "Peut-on utiliser son smartphone personnel en zone ATEX ?",
        options: [
          "Oui, en mode avion",
          "Oui, si la batterie est pleine",
          "Non, jamais sauf téléphone certifié ATEX",
          "Oui, pour les urgences uniquement",
        ],
        correct: 2,
        explanation:
          "Les smartphones personnels sont totalement interdits en zone ATEX. Seuls les téléphones certifiés ATEX sont autorisés.",
      },
      {
        id: "q5-2",
        question: "Que faire si vous voyez une nappe de gaz au sol ?",
        options: [
          "Traverser rapidement en courant",
          "Démarrer son véhicule pour s'éloigner",
          "S'éloigner à pied face au vent",
          "Attendre que la nappe se dissipe",
        ],
        correct: 2,
        explanation:
          "Il faut s'éloigner à pied (pas de véhicule), face au vent pour éviter d'inhaler les vapeurs. Ne jamais traverser une nappe.",
      },
      {
        id: "q5-3",
        question: "Que devient un équipement ATEX dont le boîtier est fissuré ?",
        options: [
          "Il reste certifié si la fissure est petite",
          "Il perd sa certification ATEX",
          "Il faut le nettoyer et le réutiliser",
          "Il peut être utilisé en zone 2 uniquement",
        ],
        correct: 1,
        explanation:
          "Tout équipement ATEX endommagé perd immédiatement sa certification. Il doit être mis hors service et signalé.",
      },
    ],
  },
  {
    id: 6,
    slug: "materiel",
    title: "Matériel autorisé et interdit",
    subtitle: "Équipements en zone ATEX",
    duration: "15 min",
    icon: "Wrench",
    color: "#8B5CF6",
    sections: [
      {
        id: "mat-1",
        title: "Outillage anti-étincelant",
        content: `
En zone ATEX, l'outillage standard en acier peut générer des étincelles dangereuses.

**Outillage anti-étincelant :**
- Alliages cuivre-béryllium (Cu-Be)
- Alliages cuivre-aluminium (Cu-Al)
- Bronze d'aluminium

**Caractéristiques :**
- Couleur dorée/bronze caractéristique
- Pas d'étincelle par friction ou impact
- Résistance mécanique adaptée
- Coût plus élevé que l'outillage standard

**Outils concernés :**
- Clés plates, à molette, à pipe
- Marteaux, masses
- Tournevis
- Pinces, tenailles
- Burins, grattoirs

**Précautions d'utilisation :**
- Vérifier l'état avant chaque utilisation
- Nettoyer après usage (éviter particules d'acier)
- Ne pas utiliser avec des pièces en acier rouillé
- Ranger séparément de l'outillage standard
        `,
        image: "outillage-antietincelant",
        keyPoints: [
          "Couleur dorée = anti-étincelant",
          "Obligatoire en zones 0, 1, 20, 21",
          "Ne pas mélanger avec outillage standard",
        ],
      },
      {
        id: "mat-2",
        title: "Outillage électrique en zone ATEX",
        content: `
**Principe :** Tout équipement électrique en zone ATEX doit être certifié.

**Équipements devant être certifiés ATEX :**
- Perceuses, visseuses
- Meuleuses (avec permis de feu)
- Lampes portatives
- Aspirateurs industriels
- Pompes électriques
- Ventilateurs

**Vérifications avant utilisation :**
1. Lire le marquage ATEX sur l'appareil
2. Vérifier la compatibilité avec la zone
3. Contrôler l'état général (câble, boîtier)
4. S'assurer que les joints sont intacts

**Exemple de vérification :**
Zone d'intervention : Zone 1 (gaz groupe IIB)
Équipement : Lampe portative \`II 2 G Ex d IIB T4\`
➡️ **Compatible** (catégorie 2 adaptée à zone 1, groupe IIB OK)

⚠️ **Un équipement catégorie 3 ne peut PAS être utilisé en zone 1**
        `,
        image: "outillage-electrique",
        keyPoints: [
          "Certification obligatoire",
          "Vérifier la compatibilité zone/équipement",
          "Catégorie ≥ exigence de la zone",
        ],
      },
      {
        id: "mat-3",
        title: "Liaisons équipotentielles",
        content: `
**Pourquoi les liaisons équipotentielles ?**

Les différences de potentiel électrique entre équipements peuvent créer 
des étincelles lors d'un contact.

**Principe :**
- Relier électriquement tous les éléments conducteurs
- Évacuer les charges statiques vers la terre
- Empêcher les arcs électriques

**Applications courantes :**
- **Tresses de masse** entre tuyauteries et cuves
- **Câbles de mise à la terre** pour les équipements mobiles
- **Pinces de connexion** pour les opérations de transvasement

**Bonnes pratiques :**
- Connecter la mise à la terre AVANT de commencer
- Vérifier la continuité du circuit
- Ne jamais retirer une liaison pendant une opération
- Contrôle régulier de l'état des tresses

**Transvasement de liquides inflammables :**
1. Mettre à la terre le contenant source
2. Mettre à la terre le contenant de réception
3. Relier les deux contenants entre eux
4. Commencer le transvasement
        `,
        image: "liaisons-equipotentielles",
        keyPoints: [
          "Évite les étincelles de décharge",
          "Connecter AVANT toute opération",
          "3 points : source, réception, liaison",
        ],
      },
    ],
    quiz: [
      {
        id: "q6-1",
        question: "De quelle couleur est généralement l'outillage anti-étincelant ?",
        options: ["Noir", "Rouge", "Doré/Bronze", "Bleu"],
        correct: 2,
        explanation:
          "L'outillage anti-étincelant est généralement de couleur dorée ou bronze car il est fabriqué en alliages de cuivre.",
      },
      {
        id: "q6-2",
        question: "Un équipement catégorie 3 peut-il être utilisé en zone 1 ?",
        options: [
          "Oui, sans restriction",
          "Oui, avec autorisation spéciale",
          "Non, jamais",
          "Oui, si la zone est ventilée",
        ],
        correct: 2,
        explanation:
          "Non, la catégorie 3 est prévue pour les zones 2/22 uniquement. En zone 1, il faut au minimum un équipement de catégorie 2.",
      },
      {
        id: "q6-3",
        question: "Lors d'un transvasement, quand faut-il connecter la mise à la terre ?",
        options: [
          "Pendant le transvasement",
          "Après le transvasement",
          "Avant de commencer",
          "Ce n'est pas nécessaire",
        ],
        correct: 2,
        explanation:
          "La mise à la terre doit être connectée AVANT de commencer le transvasement pour évacuer les charges dès le début de l'opération.",
      },
    ],
  },
  {
    id: 7,
    slug: "metier",
    title: "Impact sur votre métier",
    subtitle: "Bonnes pratiques quotidiennes",
    duration: "15 min",
    icon: "UserCheck",
    color: "#0EA5E9",
    sections: [
      {
        id: "met-1",
        title: "Votre rôle en zone ATEX",
        content: `
**En tant qu'intervenant en zone ATEX, vous êtes un acteur clé de la sécurité.**

**Vos responsabilités :**
- Respecter scrupuleusement les consignes
- Porter vos EPI en permanence
- Signaler toute anomalie ou situation dangereuse
- Ne pas improviser ou prendre de raccourcis

**Ce qu'on attend de vous :**
- Vigilance constante sur votre environnement
- Communication avec vos collègues
- Questionnement en cas de doute
- Refus de situations non sécurisées

**Vous avez le droit de :**
- Demander des explications sur les risques
- Refuser un travail si les conditions de sécurité ne sont pas réunies
- Alerter votre hiérarchie sur des situations dangereuses
- Proposer des améliorations

**Rappel légal :**
Chaque salarié a l'obligation de prendre soin de sa santé et de celle 
des autres personnes concernées par ses actes (Code du travail, art. L.4122-1)
        `,
        image: "role-intervenant",
        keyPoints: [
          "Vous êtes responsable de votre sécurité",
          "Droit de refus en cas de danger",
          "Obligation de signaler les anomalies",
        ],
      },
      {
        id: "met-2",
        title: "Check-list avant intervention",
        content: `
**Avant chaque intervention en zone ATEX, vérifiez :**

**□ Documentation**
- [ ] Autorisation de travail validée
- [ ] Permis de feu si travaux par points chauds
- [ ] Procédure d'intervention connue

**□ Équipements personnels**
- [ ] Vêtements antistatiques propres et intacts
- [ ] Chaussures de sécurité antistatiques
- [ ] Pas d'objets personnels non autorisés
- [ ] Badge d'accès si nécessaire

**□ Matériel de travail**
- [ ] Outillage certifié ATEX ou anti-étincelant
- [ ] État vérifié (pas de dégradation)
- [ ] Adapté à la zone d'intervention

**□ Environnement**
- [ ] Signalisation de la zone vérifiée
- [ ] Issues de secours repérées
- [ ] Moyens d'alerte identifiés
- [ ] Collègues informés de votre intervention

**En cas de doute sur un point, demandez AVANT d'intervenir.**
        `,
        image: "checklist",
        keyPoints: [
          "Vérifier documentation + EPI + matériel",
          "Repérer les issues de secours",
          "Informer les collègues",
        ],
      },
      {
        id: "met-3",
        title: "Fiches réflexes",
        content: `
**FICHE RÉFLEXE N°1 : Entrée en zone ATEX**
1. Vérifier mon autorisation d'accès
2. Déposer téléphone et objets personnels non certifiés
3. Vérifier mes EPI antistatiques
4. Lire les consignes affichées
5. Repérer les sorties et moyens d'alerte

**FICHE RÉFLEXE N°2 : Détection d'une anomalie**
1. Ne pas manipuler l'équipement suspect
2. S'éloigner de la zone immédiate
3. Alerter le responsable ou la sécurité
4. Baliser la zone si possible
5. Attendre les instructions

**FICHE RÉFLEXE N°3 : Alarme gaz ou évacuation**
1. Cesser immédiatement toute activité
2. Ne pas utiliser d'interrupteurs
3. Évacuer calmement vers la sortie la plus proche
4. Se rendre au point de rassemblement
5. Se faire pointer et attendre les consignes

**FICHE RÉFLEXE N°4 : Fin d'intervention**
1. Ranger et nettoyer la zone de travail
2. Vérifier qu'aucun équipement n'est resté en zone
3. Signaler tout incident ou anomalie constatée
4. Restituer le permis de travail si applicable
        `,
        image: "fiches-reflexes",
        keyPoints: [
          "Mémoriser les réflexes essentiels",
          "Évacuer calmement sans courir",
          "Toujours signaler les anomalies",
        ],
      },
    ],
    quiz: [
      {
        id: "q7-1",
        question:
          "Avez-vous le droit de refuser un travail en zone ATEX ?",
        options: [
          "Non, jamais",
          "Oui, si les conditions de sécurité ne sont pas réunies",
          "Uniquement avec l'accord du syndicat",
          "Seulement si le responsable est absent",
        ],
        correct: 1,
        explanation:
          "Oui, tout salarié a le droit de refuser un travail s'il estime que les conditions de sécurité ne sont pas réunies (droit de retrait).",
      },
      {
        id: "q7-2",
        question: "Que faire en cas d'alarme gaz ?",
        options: [
          "Éteindre les machines avant de partir",
          "Évacuer calmement sans utiliser d'interrupteurs",
          "Attendre les instructions à son poste",
          "Chercher l'origine de la fuite",
        ],
        correct: 1,
        explanation:
          "Il faut évacuer immédiatement, calmement, sans toucher aux interrupteurs électriques qui pourraient créer une étincelle.",
      },
      {
        id: "q7-3",
        question: "Que devez-vous faire avant chaque intervention ?",
        options: [
          "Vérifier documentation, EPI et matériel",
          "Seulement porter ses chaussures de sécurité",
          "Demander l'avis de ses collègues",
          "Faire une pause café",
        ],
        correct: 0,
        explanation:
          "Avant chaque intervention, il faut vérifier sa documentation (autorisation), ses EPI antistatiques et l'état de son matériel.",
      },
    ],
  },
];

// ============================================================================
// QCM FINAL (20 questions)
// ============================================================================

const FINAL_QCM = [
  {
    id: "final-1",
    question: "Que signifie ATEX ?",
    options: [
      "Atmosphère Explosive",
      "Attention Explosion",
      "Air Toxique Externe",
      "Alarme Technique d'Exploitation",
    ],
    correct: 0,
    module: 1,
  },
  {
    id: "final-2",
    question: "Combien d'éléments composent le triangle du feu ?",
    options: ["2", "3", "4", "6"],
    correct: 1,
    module: 2,
  },
  {
    id: "final-3",
    question: "Quelle zone ATEX présente le risque le plus élevé ?",
    options: ["Zone 2", "Zone 1", "Zone 0", "Zone 22"],
    correct: 2,
    module: 3,
  },
  {
    id: "final-4",
    question: "Que signifie LIE ?",
    options: [
      "Limite Inférieure d'Explosivité",
      "Ligne d'Intervention d'Urgence",
      "Limite Industrielle Européenne",
      "Liaison d'Isolation Électrique",
    ],
    correct: 0,
    module: 2,
  },
  {
    id: "final-5",
    question: "Quelle est la durée de validité de cette formation ?",
    options: ["1 an", "2 ans", "3 ans", "5 ans"],
    correct: 2,
    module: 1,
  },
  {
    id: "final-6",
    question: "Peut-on utiliser un smartphone personnel en zone ATEX ?",
    options: [
      "Oui, en mode avion",
      "Oui, si la batterie est chargée",
      "Non, sauf téléphone certifié ATEX",
      "Oui, pour les urgences",
    ],
    correct: 2,
    module: 5,
  },
  {
    id: "final-7",
    question: "Quel groupe de gaz est le plus dangereux ?",
    options: ["IIA", "IIB", "IIC", "Tous équivalents"],
    correct: 2,
    module: 3,
  },
  {
    id: "final-8",
    question:
      "Combien de temps minimum dure la surveillance après des travaux par points chauds ?",
    options: ["30 minutes", "1 heure", "2 heures", "4 heures"],
    correct: 2,
    module: 4,
  },
  {
    id: "final-9",
    question: "De quelle couleur est l'outillage anti-étincelant ?",
    options: ["Noir", "Rouge", "Doré/Bronze", "Bleu"],
    correct: 2,
    module: 6,
  },
  {
    id: "final-10",
    question:
      "Quelle source d'inflammation est souvent sous-estimée ?",
    options: [
      "Les flammes nues",
      "L'électricité statique",
      "Les surfaces chaudes",
      "Les étincelles mécaniques",
    ],
    correct: 1,
    module: 2,
  },
  {
    id: "final-11",
    question: "Que faire en premier en cas de détection de gaz ?",
    options: [
      "Éteindre les machines",
      "Alerter et évacuer",
      "Chercher la fuite",
      "Appeler son responsable",
    ],
    correct: 1,
    module: 4,
  },
  {
    id: "final-12",
    question: "Quel marquage doivent porter les chaussures en zone ATEX ?",
    options: ["CE", "ESD ou antistatique", "ATEX", "ISO"],
    correct: 1,
    module: 4,
  },
  {
    id: "final-13",
    question:
      "Un équipement ATEX avec un boîtier fissuré est-il utilisable ?",
    options: [
      "Oui, si la fissure est petite",
      "Non, il perd sa certification",
      "Oui, en zone 2 uniquement",
      "Oui, après nettoyage",
    ],
    correct: 1,
    module: 5,
  },
  {
    id: "final-14",
    question:
      "Quand connecter la mise à la terre lors d'un transvasement ?",
    options: [
      "Pendant l'opération",
      "Après l'opération",
      "Avant de commencer",
      "Ce n'est pas nécessaire",
    ],
    correct: 2,
    module: 6,
  },
  {
    id: "final-15",
    question: "Avez-vous le droit de refuser un travail en zone ATEX ?",
    options: [
      "Non, jamais",
      "Oui, si les conditions de sécurité ne sont pas réunies",
      "Uniquement avec l'accord du syndicat",
      "Seulement si le responsable est absent",
    ],
    correct: 1,
    module: 7,
  },
  {
    id: "final-16",
    question: "Que signifie la lettre 'G' dans le marquage ATEX ?",
    options: ["Groupe", "Gaz", "Garantie", "Grade"],
    correct: 1,
    module: 3,
  },
  {
    id: "final-17",
    question:
      "Les poussières peuvent-elles provoquer des explosions ?",
    options: [
      "Non, seulement les gaz",
      "Oui, et même des explosions en chaîne",
      "Oui, mais sans danger",
      "Seulement les poussières métalliques",
    ],
    correct: 1,
    module: 2,
  },
  {
    id: "final-18",
    question: "Que faire si vous voyez une nappe de gaz au sol ?",
    options: [
      "Traverser rapidement",
      "Démarrer son véhicule",
      "S'éloigner à pied face au vent",
      "Attendre qu'elle se dissipe",
    ],
    correct: 2,
    module: 5,
  },
  {
    id: "final-19",
    question:
      "Un équipement catégorie 3 peut-il être utilisé en zone 1 ?",
    options: [
      "Oui",
      "Oui avec autorisation",
      "Non, jamais",
      "Oui si la zone est ventilée",
    ],
    correct: 2,
    module: 6,
  },
  {
    id: "final-20",
    question: "Que faire en cas d'alarme gaz ?",
    options: [
      "Éteindre les machines",
      "Évacuer sans toucher aux interrupteurs",
      "Attendre à son poste",
      "Chercher l'origine",
    ],
    correct: 1,
    module: 7,
  },
];

// ============================================================================
// INITIALISATION DE LA BASE DE DONNÉES
// ============================================================================

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Table des sessions de formation
      CREATE TABLE IF NOT EXISTS learn_ex_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(255),
        site VARCHAR(100) DEFAULT 'Default',
        formation_id VARCHAR(50) NOT NULL DEFAULT 'atex-level-0',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'in_progress', -- in_progress, completed, failed
        current_module INT DEFAULT 1,
        progress_data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table de progression par module
      CREATE TABLE IF NOT EXISTS learn_ex_module_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES learn_ex_sessions(id) ON DELETE CASCADE,
        module_id INT NOT NULL,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        quiz_score INT,
        quiz_answers JSONB DEFAULT '[]',
        time_spent_seconds INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table des résultats QCM final
      CREATE TABLE IF NOT EXISTS learn_ex_final_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES learn_ex_sessions(id) ON DELETE CASCADE,
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(255),
        score INT NOT NULL,
        total_questions INT NOT NULL,
        percentage DECIMAL(5,2) NOT NULL,
        passed BOOLEAN NOT NULL,
        answers JSONB NOT NULL,
        time_spent_seconds INT,
        completed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Table des certificats générés
      CREATE TABLE IF NOT EXISTS learn_ex_certificates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES learn_ex_sessions(id) ON DELETE CASCADE,
        result_id UUID REFERENCES learn_ex_final_results(id) ON DELETE CASCADE,
        certificate_number VARCHAR(50) UNIQUE NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        formation_title VARCHAR(255) NOT NULL,
        score INT NOT NULL,
        issued_at TIMESTAMPTZ DEFAULT NOW(),
        valid_until TIMESTAMPTZ NOT NULL,
        pdf_generated BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index pour les recherches
      CREATE INDEX IF NOT EXISTS idx_learn_sessions_user ON learn_ex_sessions(user_email);
      CREATE INDEX IF NOT EXISTS idx_learn_sessions_status ON learn_ex_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_learn_certificates_user ON learn_ex_certificates(user_email);
      CREATE INDEX IF NOT EXISTS idx_learn_certificates_number ON learn_ex_certificates(certificate_number);
    `);
    console.log("[LearnEx] Database tables initialized");
  } finally {
    client.release();
  }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

function extractUser(req) {
  return {
    email: req.headers["x-user-email"] || "anonymous@example.com",
    name: req.headers["x-user-name"] || "Anonyme",
    site: req.headers["x-site"] || "Default",
  };
}

// ============================================================================
// ROUTES API
// ============================================================================

// Health check
app.get("/api/learn-ex/health", (req, res) => {
  res.json({
    status: "ok",
    service: "learn-ex",
    version: FORMATION_CONFIG.version,
    timestamp: new Date().toISOString(),
  });
});

// Configuration de la formation
app.get("/api/learn-ex/config", (req, res) => {
  res.json(FORMATION_CONFIG);
});

// Liste des modules (structure uniquement)
app.get("/api/learn-ex/modules", (req, res) => {
  const modulesSummary = FORMATION_MODULES.map((m) => ({
    id: m.id,
    slug: m.slug,
    title: m.title,
    subtitle: m.subtitle,
    duration: m.duration,
    icon: m.icon,
    color: m.color,
    sectionsCount: m.sections.length,
    quizQuestionsCount: m.quiz.length,
  }));
  res.json(modulesSummary);
});

// Contenu d'un module spécifique
app.get("/api/learn-ex/modules/:id", (req, res) => {
  const moduleId = parseInt(req.params.id, 10);
  const module = FORMATION_MODULES.find((m) => m.id === moduleId);

  if (!module) {
    return res.status(404).json({ error: "Module non trouvé" });
  }

  res.json(module);
});

// Quiz d'un module
app.get("/api/learn-ex/modules/:id/quiz", (req, res) => {
  const moduleId = parseInt(req.params.id, 10);
  const module = FORMATION_MODULES.find((m) => m.id === moduleId);

  if (!module) {
    return res.status(404).json({ error: "Module non trouvé" });
  }

  // Retourner les questions sans les réponses correctes
  const quizWithoutAnswers = module.quiz.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
  }));

  res.json(quizWithoutAnswers);
});

// Vérifier les réponses du quiz d'un module
app.post("/api/learn-ex/modules/:id/quiz/check", async (req, res) => {
  const moduleId = parseInt(req.params.id, 10);
  const { answers, sessionId } = req.body; // answers = { questionId: selectedIndex }
  const user = extractUser(req);

  const module = FORMATION_MODULES.find((m) => m.id === moduleId);
  if (!module) {
    return res.status(404).json({ error: "Module non trouvé" });
  }

  let correct = 0;
  const results = module.quiz.map((q) => {
    const userAnswer = answers[q.id];
    const isCorrect = userAnswer === q.correct;
    if (isCorrect) correct++;
    return {
      questionId: q.id,
      userAnswer,
      correctAnswer: q.correct,
      isCorrect,
      explanation: q.explanation,
    };
  });

  const score = Math.round((correct / module.quiz.length) * 100);

  // Sauvegarder la progression si sessionId fourni
  if (sessionId) {
    try {
      await pool.query(
        `
        INSERT INTO learn_ex_module_progress (session_id, module_id, completed_at, quiz_score, quiz_answers)
        VALUES ($1, $2, NOW(), $3, $4)
        ON CONFLICT DO NOTHING
      `,
        [sessionId, moduleId, score, JSON.stringify(results)]
      );

      // Mettre à jour le module courant
      await pool.query(
        `
        UPDATE learn_ex_sessions 
        SET current_module = GREATEST(current_module, $1 + 1),
            updated_at = NOW()
        WHERE id = $2
      `,
        [moduleId, sessionId]
      );
    } catch (err) {
      console.error("[LearnEx] Error saving quiz progress:", err);
    }
  }

  res.json({
    correct,
    total: module.quiz.length,
    score,
    passed: score >= 70,
    results,
  });
});

// QCM Final - Récupérer les questions
app.get("/api/learn-ex/final-exam", (req, res) => {
  // Mélanger les questions et retourner sans réponses
  const shuffled = [...FINAL_QCM].sort(() => Math.random() - 0.5);
  const examQuestions = shuffled.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    module: q.module,
  }));

  res.json({
    questions: examQuestions,
    totalQuestions: examQuestions.length,
    passingScore: FORMATION_CONFIG.passingScore,
    timeLimit: 30, // minutes
  });
});

// QCM Final - Soumettre les réponses
app.post("/api/learn-ex/final-exam/submit", async (req, res) => {
  const { sessionId, answers, timeSpent } = req.body;
  const user = extractUser(req);

  let correct = 0;
  const results = FINAL_QCM.map((q) => {
    const userAnswer = answers[q.id];
    const isCorrect = userAnswer === q.correct;
    if (isCorrect) correct++;
    return {
      questionId: q.id,
      question: q.question,
      userAnswer,
      correctAnswer: q.correct,
      isCorrect,
      module: q.module,
    };
  });

  const percentage = Math.round((correct / FINAL_QCM.length) * 100);
  const passed = percentage >= FORMATION_CONFIG.passingScore;

  // Sauvegarder le résultat
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insérer le résultat
    const resultRes = await client.query(
      `
      INSERT INTO learn_ex_final_results 
        (session_id, user_email, user_name, score, total_questions, percentage, passed, answers, time_spent_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
      [
        sessionId,
        user.email,
        user.name,
        correct,
        FINAL_QCM.length,
        percentage,
        passed,
        JSON.stringify(results),
        timeSpent || 0,
      ]
    );

    const resultId = resultRes.rows[0].id;

    // Mettre à jour la session
    await client.query(
      `
      UPDATE learn_ex_sessions 
      SET status = $1, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `,
      [passed ? "completed" : "failed", sessionId]
    );

    let certificate = null;

    // Générer le certificat si réussi
    if (passed) {
      const certNumber = `ATEX-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 6)
        .toUpperCase()}`;
      const validUntil = new Date();
      validUntil.setFullYear(validUntil.getFullYear() + 3);

      const certRes = await client.query(
        `
        INSERT INTO learn_ex_certificates 
          (session_id, result_id, certificate_number, user_email, user_name, formation_title, score, valid_until)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
        [
          sessionId,
          resultId,
          certNumber,
          user.email,
          user.name,
          FORMATION_CONFIG.title,
          percentage,
          validUntil,
        ]
      );

      certificate = certRes.rows[0];
    }

    await client.query("COMMIT");

    res.json({
      correct,
      total: FINAL_QCM.length,
      percentage,
      passed,
      results,
      certificate,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[LearnEx] Error submitting exam:", err);
    res.status(500).json({ error: "Erreur lors de la soumission" });
  } finally {
    client.release();
  }
});

// Sessions - Créer une nouvelle session
app.post("/api/learn-ex/sessions", async (req, res) => {
  const user = extractUser(req);

  try {
    const result = await pool.query(
      `
      INSERT INTO learn_ex_sessions (user_email, user_name, site, formation_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [user.email, user.name, user.site, FORMATION_CONFIG.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[LearnEx] Error creating session:", err);
    res.status(500).json({ error: "Erreur lors de la création de la session" });
  }
});

// Sessions - Récupérer ou créer une session active
app.get("/api/learn-ex/sessions/current", async (req, res) => {
  const user = extractUser(req);

  try {
    // Chercher une session en cours
    let result = await pool.query(
      `
      SELECT * FROM learn_ex_sessions 
      WHERE user_email = $1 AND status = 'in_progress'
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [user.email]
    );

    if (result.rows.length > 0) {
      // Récupérer la progression des modules
      const progressRes = await pool.query(
        `
        SELECT module_id, quiz_score, completed_at 
        FROM learn_ex_module_progress 
        WHERE session_id = $1
      `,
        [result.rows[0].id]
      );

      return res.json({
        ...result.rows[0],
        moduleProgress: progressRes.rows,
      });
    }

    // Créer une nouvelle session
    result = await pool.query(
      `
      INSERT INTO learn_ex_sessions (user_email, user_name, site, formation_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [user.email, user.name, user.site, FORMATION_CONFIG.id]
    );

    res.json({ ...result.rows[0], moduleProgress: [] });
  } catch (err) {
    console.error("[LearnEx] Error getting current session:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Sessions - Récupérer une session par ID
app.get("/api/learn-ex/sessions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM learn_ex_sessions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Session non trouvée" });
    }

    const progressRes = await pool.query(
      `
      SELECT module_id, quiz_score, completed_at 
      FROM learn_ex_module_progress 
      WHERE session_id = $1
    `,
      [id]
    );

    res.json({
      ...result.rows[0],
      moduleProgress: progressRes.rows,
    });
  } catch (err) {
    console.error("[LearnEx] Error getting session:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Historique des formations d'un utilisateur
app.get("/api/learn-ex/history", async (req, res) => {
  const user = extractUser(req);

  try {
    const result = await pool.query(
      `
      SELECT 
        s.*,
        c.certificate_number,
        c.valid_until,
        r.percentage as final_score
      FROM learn_ex_sessions s
      LEFT JOIN learn_ex_certificates c ON c.session_id = s.id
      LEFT JOIN learn_ex_final_results r ON r.session_id = s.id
      WHERE s.user_email = $1
      ORDER BY s.created_at DESC
    `,
      [user.email]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("[LearnEx] Error getting history:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Certificat - Génération automatique basée sur les quiz modules
// Appelé quand l'utilisateur a complété tous les modules avec succès
app.post("/api/learn-ex/auto-certificate", async (req, res) => {
  const user = extractUser(req);

  try {
    // 1. Vérifier qu'il n'y a pas déjà un certificat valide
    const existingCert = await pool.query(
      `SELECT * FROM learn_ex_certificates
       WHERE user_email = $1 AND valid_until > NOW()
       ORDER BY issued_at DESC LIMIT 1`,
      [user.email]
    );

    if (existingCert.rows.length > 0) {
      return res.json({
        success: true,
        certificate: existingCert.rows[0],
        message: "Certificat existant trouvé",
      });
    }

    // 2. Récupérer la session en cours
    const sessionRes = await pool.query(
      `SELECT * FROM learn_ex_sessions
       WHERE user_email = $1
       ORDER BY created_at DESC LIMIT 1`,
      [user.email]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(400).json({ error: "Aucune session trouvée" });
    }

    const session = sessionRes.rows[0];

    // 3. Vérifier que tous les modules sont complétés
    const progressRes = await pool.query(
      `SELECT module_id, quiz_score, completed_at
       FROM learn_ex_progress
       WHERE session_id = $1`,
      [session.id]
    );

    const totalModules = FORMATION_CONFIG.totalModules;
    const completedModules = progressRes.rows.filter(p => p.completed_at);

    if (completedModules.length < totalModules) {
      return res.status(400).json({
        error: "Formation incomplète",
        message: `${completedModules.length}/${totalModules} modules complétés`,
      });
    }

    // 4. Calculer le score moyen des quiz
    const quizScores = completedModules.map(p => p.quiz_score || 0);
    const averageScore = Math.round(
      quizScores.reduce((a, b) => a + b, 0) / quizScores.length
    );

    // 5. Vérifier que le score moyen est suffisant
    if (averageScore < FORMATION_CONFIG.passingScore) {
      return res.status(400).json({
        error: "Score insuffisant",
        message: `Score moyen: ${averageScore}%, minimum requis: ${FORMATION_CONFIG.passingScore}%`,
      });
    }

    // 6. Générer le certificat
    const certNumber = `ATEX-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 6)
      .toUpperCase()}`;
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 3);

    const certRes = await pool.query(
      `INSERT INTO learn_ex_certificates
        (session_id, certificate_number, user_email, user_name, site, formation_title, score, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        session.id,
        certNumber,
        user.email,
        user.name,
        user.site,
        FORMATION_CONFIG.title,
        averageScore,
        validUntil,
      ]
    );

    // 7. Mettre à jour le statut de la session
    await pool.query(
      `UPDATE learn_ex_sessions
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [session.id]
    );

    console.log(`[LearnEx] Auto-certificate generated for ${user.email}: ${certNumber} (score: ${averageScore}%)`);

    res.json({
      success: true,
      certificate: certRes.rows[0],
      message: "Certificat généré avec succès !",
      averageScore,
    });
  } catch (err) {
    console.error("[LearnEx] Error generating auto-certificate:", err);
    res.status(500).json({ error: "Erreur lors de la génération du certificat" });
  }
});

// Certificats - Liste des certificats d'un utilisateur
app.get("/api/learn-ex/certificates", async (req, res) => {
  const user = extractUser(req);

  try {
    const result = await pool.query(
      `
      SELECT * FROM learn_ex_certificates 
      WHERE user_email = $1
      ORDER BY issued_at DESC
    `,
      [user.email]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("[LearnEx] Error getting certificates:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Certificat - Vérifier la validité
app.get("/api/learn-ex/certificates/verify/:number", async (req, res) => {
  const { number } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT * FROM learn_ex_certificates 
      WHERE certificate_number = $1
    `,
      [number]
    );

    if (result.rows.length === 0) {
      return res.json({ valid: false, message: "Certificat non trouvé" });
    }

    const cert = result.rows[0];
    const isValid = new Date(cert.valid_until) > new Date();

    res.json({
      valid: isValid,
      certificate: cert,
      message: isValid ? "Certificat valide" : "Certificat expiré",
    });
  } catch (err) {
    console.error("[LearnEx] Error verifying certificate:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Certificat - Générer le PDF (Design professionnel)
app.get("/api/learn-ex/certificates/:id/pdf", async (req, res) => {
  const { id } = req.params;
  const site = req.headers["x-site"] || req.query?.site || "Default";

  try {
    const result = await pool.query(
      `SELECT * FROM learn_ex_certificates WHERE id = $1 OR certificate_number = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Certificat non trouvé" });
    }

    const cert = result.rows[0];

    // Récupérer les paramètres du site pour le logo
    let siteSettings = {};
    try {
      const settingsRes = await pool.query(
        `SELECT * FROM site_settings WHERE site = $1`,
        [site]
      );
      siteSettings = settingsRes.rows[0] || {};
    } catch (e) {
      console.log("[LearnEx] No site_settings found, using defaults");
    }

    // Créer le PDF - format paysage pour un certificat professionnel
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=certificat-ATEX-${cert.certificate_number}.pdf`
    );

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const centerX = pageWidth / 2;

    // ========================================================================
    // FOND ET BORDURES DÉCORATIVES
    // ========================================================================

    // Fond légèrement crème pour effet parchemin
    doc.rect(0, 0, pageWidth, pageHeight).fill("#FEFDFB");

    // Bordure externe dorée épaisse
    doc.rect(15, 15, pageWidth - 30, pageHeight - 30)
       .lineWidth(4)
       .stroke("#B8860B");

    // Bordure interne dorée fine
    doc.rect(25, 25, pageWidth - 50, pageHeight - 50)
       .lineWidth(1.5)
       .stroke("#DAA520");

    // Coins décoratifs (motifs d'angle)
    const cornerSize = 30;
    const corners = [
      { x: 35, y: 35 },
      { x: pageWidth - 35 - cornerSize, y: 35 },
      { x: 35, y: pageHeight - 35 - cornerSize },
      { x: pageWidth - 35 - cornerSize, y: pageHeight - 35 - cornerSize }
    ];

    corners.forEach(corner => {
      doc.rect(corner.x, corner.y, cornerSize, cornerSize)
         .lineWidth(1)
         .stroke("#DAA520");
      // Diagonale décorative
      doc.moveTo(corner.x, corner.y)
         .lineTo(corner.x + cornerSize, corner.y + cornerSize)
         .lineWidth(0.5)
         .stroke("#DAA520");
    });

    // ========================================================================
    // EN-TÊTE AVEC LOGO
    // ========================================================================

    let headerY = 55;

    // Logo entreprise à gauche (si disponible)
    if (siteSettings.logo) {
      try {
        doc.image(siteSettings.logo, 60, headerY, { width: 80 });
      } catch (e) {
        // Logo non disponible
      }
    }

    // Symbole ATEX à droite (hexagone explosion)
    const atexX = pageWidth - 130;
    const atexY = headerY + 15;
    doc.save();
    // Hexagone jaune/orange pour ATEX
    doc.polygon(
      [atexX, atexY - 25],
      [atexX + 22, atexY - 12],
      [atexX + 22, atexY + 12],
      [atexX, atexY + 25],
      [atexX - 22, atexY + 12],
      [atexX - 22, atexY - 12]
    ).fillAndStroke("#FEF3C7", "#F59E0B");

    // "Ex" au centre de l'hexagone
    doc.fontSize(16)
       .fillColor("#B45309")
       .font("Helvetica-Bold")
       .text("Ex", atexX - 12, atexY - 8, { width: 24, align: "center" });
    doc.restore();

    // ========================================================================
    // TITRE PRINCIPAL
    // ========================================================================

    // Ligne décorative supérieure
    doc.moveTo(150, headerY + 70)
       .lineTo(pageWidth - 150, headerY + 70)
       .lineWidth(1)
       .stroke("#DAA520");

    // "CERTIFICAT DE FORMATION"
    doc.fontSize(12)
       .fillColor("#6B7280")
       .font("Helvetica")
       .text("FORMATION PROFESSIONNELLE SÉCURITÉ", 0, headerY + 80, { align: "center", width: pageWidth });

    doc.fontSize(32)
       .fillColor("#1E3A5F")
       .font("Helvetica-Bold")
       .text("CERTIFICAT", 0, headerY + 100, { align: "center", width: pageWidth });

    doc.fontSize(16)
       .fillColor("#4B5563")
       .font("Helvetica")
       .text("ATEX NIVEAU 0 - SENSIBILISATION", 0, headerY + 140, { align: "center", width: pageWidth });

    // Ligne décorative avec étoiles
    const lineY = headerY + 170;
    doc.moveTo(200, lineY)
       .lineTo(centerX - 30, lineY)
       .lineWidth(1)
       .stroke("#DAA520");

    // Étoile centrale
    doc.fontSize(14).fillColor("#DAA520").text("★", centerX - 7, lineY - 7);

    doc.moveTo(centerX + 30, lineY)
       .lineTo(pageWidth - 200, lineY)
       .stroke("#DAA520");

    // ========================================================================
    // CORPS DU CERTIFICAT
    // ========================================================================

    const bodyY = headerY + 190;

    doc.fontSize(13)
       .fillColor("#374151")
       .font("Helvetica")
       .text("Ce certificat atteste que", 0, bodyY, { align: "center", width: pageWidth });

    // Nom du participant (en grand, souligné)
    const participantName = cert.user_name || "Participant";
    doc.fontSize(26)
       .fillColor("#1E3A5F")
       .font("Helvetica-Bold")
       .text(participantName, 0, bodyY + 25, { align: "center", width: pageWidth });

    // Soulignement élégant sous le nom
    const nameWidth = doc.widthOfString(participantName);
    doc.moveTo(centerX - nameWidth/2 - 20, bodyY + 55)
       .lineTo(centerX + nameWidth/2 + 20, bodyY + 55)
       .lineWidth(1)
       .stroke("#DAA520");

    doc.fontSize(13)
       .fillColor("#374151")
       .font("Helvetica")
       .text("a suivi avec succès la formation obligatoire", 0, bodyY + 70, { align: "center", width: pageWidth });

    // Titre de la formation
    doc.fontSize(16)
       .fillColor("#B45309")
       .font("Helvetica-Bold")
       .text("« Sensibilisation ATEX pour Intervenants »", 0, bodyY + 95, { align: "center", width: pageWidth });

    doc.fontSize(11)
       .fillColor("#6B7280")
       .font("Helvetica")
       .text("Conformément à la Directive européenne 1999/92/CE (ATEX 137)", 0, bodyY + 120, { align: "center", width: pageWidth });

    // Score dans un encadré
    const scoreBoxX = centerX - 60;
    const scoreBoxY = bodyY + 145;
    doc.roundedRect(scoreBoxX, scoreBoxY, 120, 35, 5)
       .fillAndStroke("#ECFDF5", "#10B981");
    doc.fontSize(11)
       .fillColor("#065F46")
       .font("Helvetica")
       .text("Score obtenu", scoreBoxX, scoreBoxY + 5, { width: 120, align: "center" });
    doc.fontSize(16)
       .font("Helvetica-Bold")
       .text(`${cert.score}%`, scoreBoxX, scoreBoxY + 18, { width: 120, align: "center" });

    // ========================================================================
    // INFORMATIONS DE VALIDITÉ
    // ========================================================================

    const infoY = bodyY + 195;

    // Boîte d'information à gauche
    doc.roundedRect(80, infoY, 200, 75, 5)
       .fillAndStroke("#F8FAFC", "#E2E8F0");

    doc.fontSize(9)
       .fillColor("#64748B")
       .font("Helvetica-Bold")
       .text("INFORMATIONS", 90, infoY + 8, { width: 180 });

    doc.fontSize(9)
       .fillColor("#475569")
       .font("Helvetica")
       .text(`N° Certificat: ${cert.certificate_number}`, 90, infoY + 25)
       .text(`Émis le: ${new Date(cert.issued_at).toLocaleDateString("fr-FR")}`, 90, infoY + 40)
       .text(`Site: ${cert.site || site}`, 90, infoY + 55);

    // Boîte de validité à droite (mise en avant)
    doc.roundedRect(pageWidth - 280, infoY, 200, 75, 5)
       .fillAndStroke("#FEF3C7", "#F59E0B");

    doc.fontSize(9)
       .fillColor("#92400E")
       .font("Helvetica-Bold")
       .text("VALIDITÉ (3 ANS)", pageWidth - 270, infoY + 8, { width: 180 });

    doc.fontSize(11)
       .fillColor("#78350F")
       .font("Helvetica-Bold")
       .text(`Valide jusqu'au`, pageWidth - 270, infoY + 28)
       .fontSize(14)
       .text(`${new Date(cert.valid_until).toLocaleDateString("fr-FR")}`, pageWidth - 270, infoY + 45);

    doc.fontSize(8)
       .fillColor("#92400E")
       .font("Helvetica")
       .text("Recyclage obligatoire avant expiration", pageWidth - 270, infoY + 63);

    // ========================================================================
    // SIGNATURES ET VALIDATION
    // ========================================================================

    const signY = infoY + 95;

    // Signature gauche - Formateur
    doc.fontSize(8)
       .fillColor("#6B7280")
       .font("Helvetica")
       .text("Le Responsable Formation", 100, signY, { width: 150, align: "center" });

    doc.moveTo(100, signY + 35)
       .lineTo(250, signY + 35)
       .lineWidth(0.5)
       .stroke("#9CA3AF");

    doc.text(siteSettings.company_name || "ElectroHub Formation", 100, signY + 40, { width: 150, align: "center" });

    // Cachet central (sceau officiel)
    const sealX = centerX;
    const sealY = signY + 25;
    doc.circle(sealX, sealY, 28)
       .lineWidth(2)
       .stroke("#1E3A5F");
    doc.circle(sealX, sealY, 22)
       .lineWidth(1)
       .stroke("#1E3A5F");
    doc.fontSize(7)
       .fillColor("#1E3A5F")
       .font("Helvetica-Bold")
       .text("CERTIFIÉ", sealX - 20, sealY - 12, { width: 40, align: "center" })
       .text("CONFORME", sealX - 20, sealY - 3, { width: 40, align: "center" })
       .text("✓", sealX - 5, sealY + 8, { width: 10 });

    // Signature droite - Entreprise
    doc.fontSize(8)
       .fillColor("#6B7280")
       .font("Helvetica")
       .text("Pour l'entreprise", pageWidth - 250, signY, { width: 150, align: "center" });

    doc.moveTo(pageWidth - 250, signY + 35)
       .lineTo(pageWidth - 100, signY + 35)
       .lineWidth(0.5)
       .stroke("#9CA3AF");

    doc.text("Direction HSE", pageWidth - 250, signY + 40, { width: 150, align: "center" });

    // ========================================================================
    // PIED DE PAGE
    // ========================================================================

    const footerY = pageHeight - 55;

    // QR Code simulé (encadré)
    const qrSize = 35;
    doc.rect(60, footerY - 10, qrSize, qrSize)
       .fillAndStroke("#FFFFFF", "#374151");
    doc.fontSize(6)
       .fillColor("#374151")
       .text("SCAN", 60, footerY + 2, { width: qrSize, align: "center" })
       .text("QR", 60, footerY + 10, { width: qrSize, align: "center" });

    // Texte de vérification
    doc.fontSize(8)
       .fillColor("#9CA3AF")
       .font("Helvetica")
       .text(
         `Ce certificat peut être vérifié en ligne: ${cert.certificate_number}`,
         110,
         footerY,
         { width: pageWidth - 220 }
       );

    doc.fontSize(7)
       .text(
         "Formation conforme aux exigences réglementaires ATEX (Directive 1999/92/CE) - Zones à atmosphères explosives",
         110,
         footerY + 12,
         { width: pageWidth - 220 }
       );

    // Version du document
    doc.fontSize(6)
       .fillColor("#CBD5E1")
       .text(`Document généré automatiquement - v${FORMATION_CONFIG.version}`, pageWidth - 180, footerY + 15, { width: 140, align: "right" });

    doc.end();
  } catch (err) {
    console.error("[LearnEx] Error generating PDF:", err);
    res.status(500).json({ error: "Erreur lors de la génération du PDF" });
  }
});

// Statistiques (admin)
app.get("/api/learn-ex/stats", async (req, res) => {
  const user = extractUser(req);

  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions,
        COUNT(*) FILTER (WHERE status = 'in_progress') as active_sessions,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_sessions,
        COUNT(DISTINCT user_email) as unique_users,
        AVG(CASE WHEN status IN ('completed', 'failed') THEN 
          (SELECT percentage FROM learn_ex_final_results r WHERE r.session_id = s.id LIMIT 1)
        END)::INT as avg_score
      FROM learn_ex_sessions s
    `);

    const certStats = await pool.query(`
      SELECT COUNT(*) as total_certificates,
             COUNT(*) FILTER (WHERE valid_until > NOW()) as valid_certificates
      FROM learn_ex_certificates
    `);

    res.json({
      sessions: stats.rows[0],
      certificates: certStats.rows[0],
    });
  } catch (err) {
    console.error("[LearnEx] Error getting stats:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

// Images des modules (servies statiquement ou générées)
app.get("/api/learn-ex/images/:name", (req, res) => {
  const { name } = req.params;
  
  // Pour l'instant, retourner une URL placeholder
  // En production, on servirait des vraies images
  const placeholders = {
    "intro-objectives": "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=800",
    "intro-atex-definition": "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=800",
    "triangle-feu": "https://images.unsplash.com/photo-1518181835702-6eef8b4b2113?w=800",
    "hexagone-explosion": "https://images.unsplash.com/photo-1535406490924-0a46ec7b1c6d?w=800",
    "effets-explosion": "https://images.unsplash.com/photo-1485452499676-62ab02571f16?w=800",
    "electricite-statique": "https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=800",
    "substances-dangereuses": "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=800",
    "panneau-atex": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800",
    "zones-atex": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800",
    "marquage-equipement": "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800",
    "avant-entree": "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=800",
    "permis-feu": "https://images.unsplash.com/photo-1574362848149-11496d93a7c7?w=800",
    "epi-antistatique": "https://images.unsplash.com/photo-1618090584126-129cd1f03395?w=800",
    "procedure-urgence": "https://images.unsplash.com/photo-1582139329536-e7284fece509?w=800",
    "appareils-interdits": "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800",
    "sources-inflammation": "https://images.unsplash.com/photo-1476611317561-60117649dd94?w=800",
    "vehicules-atex": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800",
    "degradation-materiel": "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=800",
    "outillage-antietincelant": "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=800",
    "outillage-electrique": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800",
    "liaisons-equipotentielles": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800",
    "role-intervenant": "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800",
    "checklist": "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800",
    "fiches-reflexes": "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800",
  };

  const imageUrl = placeholders[name] || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800";
  res.redirect(imageUrl);
});

// ============================================================================
// DÉMARRAGE
// ============================================================================

const PORT = process.env.LEARN_EX_PORT || 3040;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[LearnEx] Server running on port ${PORT}`);
      console.log(`[LearnEx] Formation: ${FORMATION_CONFIG.title}`);
      console.log(`[LearnEx] Modules: ${FORMATION_MODULES.length}`);
      console.log(`[LearnEx] Final QCM: ${FINAL_QCM.length} questions`);
    });
  })
  .catch((err) => {
    console.error("[LearnEx] Failed to initialize database:", err);
    process.exit(1);
  });

export default app;
