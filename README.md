# EasyOBD

**Comprendre votre véhicule, pas seulement le lire.**

EasyOBD est une application de diagnostic OBD-II et J1939, multi-plateformes et pédagogique, pour voitures, motos,
utilitaires, poids lourds et tracteurs. Elle traduit les codes défaut en explications claires et montre la pièce concernée en 3D. Elle propose des solutions avec le coût des pièces,
des liens vers AutoDoc, Mister Auto et Oscaro, le temps nécessaire et le niveau de compétence requis. Elle apprend aussi
à reconnaître la panne la prochaine fois, sans ordinateur.

<p align="center">
  <img src="docs/screenshots/diagnostic-3d.jpg" alt="Diagnostic d'un raté d'allumage avec mise en évidence 3D" width="100%" />
</p>

> ⚠️ EasyOBD est un outil d'aide et de formation. Les prix, temps et probabilités sont **indicatifs**. En cas de doute,
> en particulier sur les freins, la direction, les airbags ou une alerte rouge, faites contrôler le véhicule par un
> professionnel.

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| **Base de codes** | 265 fiches (codes et familles de codes P, C, B et U, dont calage d'arbre à cames, circuits d'injecteurs, AdBlue / NOx, haute tension) avec explication, vérifications par les sens, causes et solutions chiffrées. |
| **Diagnostic OBD-II** | Codes confirmés, en attente et permanents (services 03/07/0A), effacement (04), VIN, protocole, voyant moteur, tension batterie, données en direct (régime, températures, débit d'air, corrections de richesse…). |
| **Vue 3D** | Voiture, utilitaire, moto, poids lourd et **tracteur** générés en 3D, sans aucun modèle à télécharger. Silhouette selon la carrosserie (citadine, berline, break, SUV, monospace, coupé, **supercar à moteur central**, pick-up, quadricycle) et le style de moto (roadster, trail, sportive, custom, scooter). Carrosserie sculptée (galbe des portières, lignes de caractère, pavillon bombé, joints de portes, bas de caisse, passages de roue), peinture vernie, pneus au vrai profil, ombre de contact. Moteur **avant, central ou arrière**, en ligne, **en V** (V6 à V12, W12) ou **à plat** (911, Subaru), transmission avant, arrière ou intégrale, transmission finale des motos (chaîne, cardan, courroie, variateur, moteur-roue). **Vue éclatée** animée, pièces tournantes quand elles sont en cause. |
| **Moteur détaillé** | Chaque pièce sur laquelle on intervient est modélisée et sélectionnable : pistons et bielles qui bougent dans l'ordre d'allumage, vilebrequin, volant moteur, arbres à cames avec leurs cames, **capteur d'arbre à cames face à sa cible**, chaîne de distribution, bougies et bobines crayon, injecteurs directs sur rampe commune et pompe haute pression, collecteurs, **turbo** (roue de compresseur qui tourne, wastegate), **alternateur**, compresseur de clim, **courroie d'accessoires** sur ses poulies et son tendeur. Bouton **« Moteur »** : gros plan, carrosserie transparente. |
| **Clic sur une pièce** | La pièce touchée affiche ce qu'on peut faire dessus : **tutoriels** de votre véhicule qui la concernent (ouverts directement, pièce en évidence), **pannes liées** (une bobine du cylindre 2 renvoie à P0352 et P0302), recherche de la pièce chez AutoDoc, Mister Auto et Oscaro, vos photos. |
| **Fiche de code** | « Comprendre » (fonctionnement), **vérifications par les sens** (vue, ouïe, odorat, toucher, ressenti) pour écarter les fausses pistes, causes classées par probabilité, solutions avec difficulté 1 à 5, temps, outils, étapes, pièces avec fourchette de prix et liens boutiques, coût « soi-même » ou « garage ». |
| **Diagnostic à l'œil** | Questionnaire sans outil (carburant, voyants, fumée, bruits, odeurs, comportement, circonstances, fluides) qui classe les hypothèses et renvoie vers les codes, la 3D et les tutoriels. |
| **Diagnostic audio** | Enregistrement en direct ou fichier audio. Analyse locale en Rust : régime estimé, indice de ratés, couinement de courroie ou de freins, sifflement de turbo, claquements, souffle. Les résultats alimentent le questionnaire. |
| **Entretien guidé** | 24 tutoriels pas à pas illustrés en 3D : vidange, filtres, bougies, plaquettes, niveaux, batterie, chaîne, cardan, courroie et variateur de moto, récepteur d'embrayage, contrôles poids lourd, entretien tracteur (tour quotidien, graissage, 500 h, huile UTTO). **Liste de courses** adaptée au profil du véhicule (quantités, norme d'huile, recherches incluant la marque et le modèle). |
| **Formation** | 11 scénarios de pannes réalistes joués sur le simulateur : plainte du client, lecture des codes et des données en direct, indices à découvrir, quiz, débriefing et score. |
| **Encyclopédie** | Recherche dans tous les codes documentés et explication générique de n'importe quel code (y compris constructeur). |
| **Mode expert** | Scan UDS (ISO 14229) de tous les calculateurs : identification, références, versions logicielles, défauts UDS. Console UDS. Écriture de paramètres (DID) avec garde-fous. |
| **Adaptateurs** | Détection **USB** (FTDI, CH340, CP210x, PL2303, OBDLink), **Bluetooth classique** (SPP), **Bluetooth LE** (Vgate, OBDLink CX, Veepeak, Konnwei…) et **Wi-Fi** (adresses usuelles). Débit série détecté automatiquement. Identification de la puce (ELM327, STN) et signalement des clones. |
| **Hors ligne** | Base de codes, tutoriels, profils, scénarios, 3D procédurale et analyse audio sont embarqués. Aucun serveur n'est nécessaire, seuls les liens boutiques demandent Internet. |

| Module | Ce qu'il fait |
|---|---|
| **Véhicules électriques** | Modèle 3D dédié (batterie de traction, moteur, onduleur, réducteur, chargeur, câbles orange), codes P0Axx, pistes propres aux électriques (batterie 12 V, isolement, recharge, réducteur, disques corrodés), tutoriels et scénarios dédiés, mode audio adapté. |
| **Fiche technique** | Capacités (huile, refroidissement, liquide de frein, boîte, AdBlue), fluides et **couples de serrage**, chaque valeur étant marquée *Modèle*, *Marque* ou *Typique*. |
| **Alternatives moins chères** | Huile de même norme en marque distributeur, 5W40 à la place de 5W30 seulement quand le moteur l'autorise (interdit sur les courroies baignées dans l'huile), équipementier d'origine plutôt que pièce siglée, DOT 4 ou 5.1 mais jamais DOT 5… |
| **Poids lourds J1939** | Lecture des défauts SPN / FMI des camions, bus et engins (prise 9 broches), témoins rouge STOP / ambre / dépollution, calculateur d'origine (moteur, post-traitement, boîte…). Une cinquantaine de SPN courants expliqués (FAP, AdBlue, NOx, EGR, suralimentation, injecteurs, pressions, températures) avec causes et solutions, adaptées au type de défaillance (FMI). Recherche « SPN 3251 FMI 0 » dans l'encyclopédie. |
| **Contrôle technique** | Liste de préparation filtrée selon le véhicule, emplacements du **VIN** par marque, pré-contrôle OBD (voyant, codes, autodiagnostics terminés). |
| **Procédures spécifiques** | Étapes issues du manuel du propriétaire, insérées dans les tutoriels (ex. Tesla : mise hors tension, mode Cric, batterie basse tension) avec leur source. |
| **Vidéos de réparation** | Recherche YouTube préremplie (intervention + véhicule), lecteur intégré (youtube-nocookie) pour une vidéo collée ou mise en favori, recherche dans l'app avec votre propre clé API. |
| **Catalogue** | **718 profils, 103 marques** : 517 voitures, 110 motos et scooters, 40 utilitaires, 24 poids lourds et 27 tracteurs, dont 124 électriques. Des citadines aux supercars (Ferrari, Lamborghini, McLaren, Porsche, Lotus), des berlines de prestige (Rolls-Royce, Bentley) aux voitures sans permis (Aixam, Ligier), des youngtimers (205 GTI, Golf III, 2CV, W124) aux marques chinoises (BYD, Zeekr, NIO), et les tracteurs John Deere, Fendt, Claas, New Holland, Case IH, Massey Ferguson, Kubota… Recherche sans accents, mot par mot (« Scania R », « megane etech »). |
| **Tracteurs agricoles** | Modèle 3D dédié (pneus agraires à crampons, moteur longitudinal, cabine, FAP et cheminée, attelage 3 points, prise de force, prise ISOBUS), tutoriels au compteur d'heures, contenances typiques (50 à 200 L d'huile de transmission UTTO), diagnostic J1939 coché d'office, pas de rappel de contrôle technique. |
| **Compatibilité OBD** | Avertissement quand un véhicule est antérieur à l'EOBD (2001 en essence, 2004 en diesel) ou est un quadricycle : la lecture électronique demande alors l'outil du constructeur, le diagnostic à l'œil et l'écoute moteur restent disponibles. |
| **Mon garage** | Plusieurs véhicules, chacun avec son propre travail (photos, listes, contrôle technique), un **carnet** (diagnostics, entretiens, réparations, coûts), des **rappels** d'entretien et de contrôle technique, l'impression ou l'export PDF, et la sauvegarde ou restauration en JSON. Le véhicule est reconnu par son VIN au branchement. |
| **Photos** | Photos de référence libres de droits (Wikimedia Commons, auteur crédité) et vos propres photos par étape ou par pièce, compressées et stockées sur l'appareil. |
| **Adaptateurs dans le navigateur** | Version web : vrais adaptateurs via **Web Serial** (USB, Bluetooth classique appairé) et **Web Bluetooth** (BLE), dans Chrome et Edge, y compris Chrome sur Android, sans installation. Le décodage reste fait par le cœur Rust (WASM). |
| **Simulateur** | Véhicule virtuel (OBD-II, UDS et J1939) qui prend l'identité du véhicule choisi : marque, année et VIN de démonstration valide. |
| **Sortir d'un mode** | Pastilles de l'en-tête « Simulation × », « Expert × », « Scénario × », boutons « Quitter le simulateur » et « Quitter le mode expert », « Vue globale » qui annule transparence et vue éclatée. |
| **Rapport** | Rapport de diagnostic imprimable ou enregistrable en PDF. |

## Captures d'écran

| | |
|---|---|
| ![Accueil](docs/screenshots/accueil.jpg) **Accueil** : carrosserie peinte, reflets et ombres | ![Diagnostic](docs/screenshots/diagnostic-3d.jpg) **Diagnostic** : la pièce en cause en 3D |
| ![À l'œil](docs/screenshots/diagnostic-a-l-oeil.jpg) **Diagnostic à l'œil** : hypothèses classées | ![Fiche technique](docs/screenshots/fiche-technique.jpg) **Fiche technique** : sources des valeurs |
| ![Poids lourd J1939](docs/screenshots/poids-lourd-j1939.jpg) **Poids lourd (J1939)** : SPN / FMI, témoins, calculateur source | ![Vue éclatée](docs/screenshots/vue-eclatee-moto.jpg) **Vue éclatée** : chaque organe écarté pour être identifié |
| ![Tutoriel cardan](docs/screenshots/tutoriel-cardan.jpg) **Tutoriel moto à cardan** : étapes, sécurité, pièce en 3D | ![Contrôle technique](docs/screenshots/controle-technique.jpg) **Contrôle technique** : pré-contrôle OBD et VIN |
| ![Moteur et pièce](docs/screenshots/moteur-piece.jpg) **Gros plan moteur** : clic sur une bobine, interventions et pannes liées | ![Tracteur](docs/screenshots/tracteur.jpg) **Tracteur** : modèle dédié et entretien au compteur d'heures |
| ![Supercar](docs/screenshots/supercar.jpg) **Supercar** : moteur central, prises d'air, nez plongeant | ![Mode expert](docs/screenshots/mode-expert.jpg) **Mode expert** : garde-fous |

### Garde-fous du mode expert

La modification de paramètres peut immobiliser un véhicule. EasyOBD impose donc plusieurs protections :

- un avertissement explicite et trois engagements à cocher avant l'accès, puis la phrase **« J'ACCEPTE LES RISQUES »** à taper pour chaque écriture ;
- l'écriture est refusée si le moteur tourne ou si la batterie est sous 12,2 V ;
- la valeur d'origine est lue avant l'écriture, la nouvelle valeur est relue après, et chaque opération est **journalisée et restaurable** ;
- les services dangereux sont **bloqués** : reprogrammation (0x34–0x37), écriture mémoire (0x3D), automatisation de l'accès sécurisé (0x27) ;
- EasyOBD **ne fournit aucune recette d'écriture constructeur non vérifiée**. Les paramètres viennent de « packs » JSON importés par l'utilisateur, sous sa responsabilité ([exemple](docs/expert-pack.example.json), utilisable uniquement avec le simulateur).

Les auteurs d'EasyOBD déclinent toute responsabilité pour l'usage du mode expert.

## Architecture

```
EasyOBD/
├── crates/obd-core/   Cœur Rust (toute la logique, testée)
│   ├── elm327.rs      Session ELM327 : init, requêtes, ISO-TP multi-trames
│   ├── dtc.rs, pids.rs, vin.rs
│   ├── transport.rs   Wi-Fi/TCP, série (feature "serial")
│   ├── ble.rs         Bluetooth LE (feature "ble", btleplug)
│   ├── detect.rs      Découverte et identification des adaptateurs
│   ├── knowledge.rs   Base de connaissances, coûts, liens boutiques
│   ├── maintenance.rs Profils véhicules, tutoriels, listes de courses
│   ├── symptoms.rs    Questionnaire « à l'œil »
│   ├── audio.rs       Analyse audio (FFT, autocorrélation)
│   ├── training.rs    Scénarios de formation
│   ├── uds.rs         Mode expert ISO 14229
│   ├── j1939.rs       Poids lourds / tracteurs : trames, BAM, DM1, SPN / FMI
│   ├── specs.rs       Fiche technique, alternatives moins chères
│   ├── inspection.rs  Contrôle technique
│   ├── simulator.rs   Véhicule + ELM327 virtuels (OBD, UDS, J1939)
│   └── api.rs         API JSON unique pour tous les frontaux
├── crates/obd-wasm/   Même cœur compilé en WebAssembly (version web)
├── src-tauri/         Application native Tauri 2 (desktop + mobile)
├── ui/                Interface Svelte 5 + Three.js
└── data/              Contenu en JSON (FR) : codes, SPN J1939, véhicules et tutoriels, fiches, symptômes, scénarios
```

**Pourquoi ce choix ?**

- Le **cœur en Rust** est fiable, rapide et portable. Il est compilé en natif pour l'application et en **WASM** pour le
  navigateur : la même logique tourne partout, et `api.rs` est le seul point d'entrée.
- **Tauri 2** produit des applications légères pour Windows, macOS, Linux, Android et iOS à partir d'une même base.
- **Svelte + Three.js** donnent une interface moderne et une 3D procédurale, sans aucun modèle à télécharger.

Le contenu (codes, tutoriels, scénarios) est en JSON dans `data/` : on peut l'enrichir sans toucher au code, et des
tests vérifient sa cohérence (composants 3D existants, prix, références croisées).

## Démarrer

Prérequis : Rust stable avec la cible `wasm32-unknown-unknown`, `wasm-bindgen-cli` 0.2.130, Node 20+. Sous Linux,
il faut aussi les [dépendances système de Tauri](https://tauri.app/start/prerequisites/), `libudev-dev` et `libdbus-1-dev`.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130
npm install && npm install --prefix ui

npm run dev:web      # version web (simulateur) sur http://localhost:5173
npm run dev          # application native (adaptateurs réels)
npm run build        # paquets d'installation desktop
sh scripts/check.sh  # vérification complète (tests Rust, WASM, types, build)
```

### Mobile (Android / iOS)

```sh
npx tauri android init && npx tauri android dev   # Android Studio + SDK/NDK requis
npx tauri ios init && npx tauri ios dev           # macOS + Xcode requis
```

Sur mobile, les adaptateurs **Wi-Fi** fonctionnent dès maintenant. Le Bluetooth LE est actif sur desktop. Son
activation sur Android et iOS figure dans la feuille de route : `btleplug` demande une initialisation JNI spécifique sur
Android.

## Adaptateurs testés et conseillés

- **Bluetooth LE** (iPhone, Android, ordinateurs) : Vgate iCar Pro BLE, OBDLink CX, Veepeak OBDCheck BLE.
- **Wi-Fi** : la plupart des dongles ELM327 Wi-Fi (`192.168.0.10:35000`).
- **USB** : OBDLink SX/EX, câbles ELM327 à puce FTDI.
- Les clones « ELM327 v2.1 » lisent généralement les codes, mais certains véhicules anciens ou multi-calculateurs posent problème.

## Données et limites

- Les **prix** sont des fourchettes indicatives de pièces adaptables (France, 2026). La main-d'œuvre garage est estimée à 75 €/h (réglable dans `data/knowledge_base.fr.json`).
- **Liens boutiques** : la recherche AutoDoc pointe directement sur le site. Pour Mister Auto et Oscaro, les liens passent par une recherche Google limitée au site. Ces modèles d'URL sont configurables dans `providers`. Aucun partenariat ni API de prix temps réel n'est intégré pour l'instant.
- Les **profils véhicules** (motorisations, années, contenances, normes d'huile) sont des valeurs de départ à vérifier dans le carnet d'entretien : la norme d'huile n'est indiquée que lorsqu'elle est sûre. La saisie manuelle couvre tous les autres véhicules.
- La **3D** est procédurale : les silhouettes sont des familles (citadine, SUV, supercar…), pas la forme exacte de chaque modèle. Les moteurs des propulsions sont encore représentés en position transversale.
- **Poids lourds (J1939)** : lecture des défauts actifs (DM1, messages multi-trames inclus) avec un adaptateur compatible J1939 (OBDLink, STN, ELM327 v1.4b+ authentique). Testé sur le simulateur et sur des trames de référence, pas encore sur un camion réel. L'effacement des défauts et les données en direct J1939 ne sont pas encore proposés.
- **Analyse audio** : elle est heuristique et oriente, sans jamais remplacer un contrôle.
- **Vidéos** : YouTube n'autorise plus l'intégration d'une page de résultats de recherche. La recherche s'ouvre donc sur YouTube, sauf si une clé API est fournie. Dans l'application de bureau, certaines vidéos peuvent refuser la lecture intégrée : le bouton « ouvrir dans YouTube » sert alors de repli.

## Modèle économique

Pistes détaillées dans [docs/MODELE_ECONOMIQUE.md](docs/MODELE_ECONOMIQUE.md) :

- freemium (« EasyOBD+ ») ;
- affiliation transparente ;
- adaptateur à la marque EasyOBD ;
- mise en relation avec des garages ;
- certificat batterie pour les véhicules électriques ;
- offres de formation et pour les flottes.

## Feuille de route

- Bluetooth LE dans l'application Android et iOS (déjà possible dans Chrome Android via la version web).
- J1939 : défauts historiques (DM2), données en direct (PGN moteur), effacement (DM11) ; adressage CAN 29 bits pour le mode expert.
- Packs de données téléchargeables par véhicule (base de codes constructeur, profils), mis en cache pour un usage hors ligne.
- Partenariats ou API marchands pour des prix en temps réel.
- Silhouettes dédiées pour les modèles très typés (Multipla, 2CV, Classe G, Defender), moteur longitudinal pour les propulsions.
- Tutoriels pour les scooters et les voitures sans permis.
- Traduction anglaise : le format des données le permet déjà, avec un fichier par langue.

## Crédits photos

Les photos de référence (`ui/public/photos`) proviennent de Wikimedia Commons, sous licences libres (domaine public, CC BY, CC BY-SA). Leur auteur, leur licence et un lien vers la source sont affichés dans l'application et listés dans `ui/public/photos/manifest.json`. Elles sont réutilisées sans modification autre qu'un redimensionnement.

## Licence

MIT. Voir [LICENSE](LICENSE).
