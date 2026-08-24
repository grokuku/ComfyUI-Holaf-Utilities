# PLAN DE FUSION — CUI-Holaf-Utils

> Fusion des trois extensions ComfyUI de l'auteur grokuku en un pack unique : **CUI-Holaf-Utils**, renommé ensuite **ComfyUI-AI-Helper** (marque AIH unifiée).
>
> | Repo | Rôle dans la fusion |
> |---|---|
> | `CUI-Holaf-Utils` (cible) | Pack fusionné final ; renommé `ComfyUI-AI-Helper` en fin de Phase 0 (cf. §3.11) |
> | `CUI-Holaf` | Source : pack GPL v3 de 27 nodes |
> | `AI-Helper` → `AIH_ComfyUI/` | Source : sous-dossier uniquement (backend Flask, site frontend et app Android **restent** dans le monorepo AI-Helper et ne sont **pas** fusionnés) |

---

## 1. Objectif et périmètre

### Objectif
Fusionner dans **CUI-Holaf-Utils** :
- les **24 nodes** conservées de CUI-Holaf ;
- les **8 nodes** conservées d'AIH ;
- leurs **widgets JS** associés ;
- l'**infrastructure AIH** listée plus bas.

Puis **renommer le repo `ComfyUI-AI-Helper`** : unification de la marque AIH, alignement avec l'écosystème AI Helper produit sans conflit de nom direct. Ce renommage est soumis au prérequis de dé-hardcodage décrit en §3.11 et intervient idéalement dès la fin de la Phase 0 ; les données existantes (zone « dossier d'extension » et zone « répertoires utilisateur ») sont quant à elles **migrées automatiquement** vers les nouveaux emplacements au premier démarrage suivant le renommage (cf. §3.11, « Migration automatique des données »).

### Hors périmètre (restent dans le monorepo AI-Helper)
- Backend Flask `kw.holaf.fr` ;
- Site frontend ;
- Application Android.

### Historique git
- **Aucune migration d'historique git** : fusion fraîche, sans préservation des commits des repos sources.

---

## 2. Inventaire des décisions

### 2.1 Nodes

| Origine | Node | Décision | Note |
|---|---|---|---|
| CUI-Holaf | Save Media | ✅ Gardée | |
| CUI-Holaf | Tiled KSampler | ✅ Gardée | |
| CUI-Holaf | Image Comparer | ✅ Gardée | |
| CUI-Holaf | Upscale | ✅ Gardée | |
| CUI-Holaf | Overlay | ✅ Gardée | |
| CUI-Holaf | Resolution Preset | ✅ Gardée | |
| CUI-Holaf | Resolution Preset v2 | ✅ Gardée | |
| CUI-Holaf | Instagram Resize | ✅ Gardée | |
| CUI-Holaf | LUT Generator | ✅ Gardée | |
| CUI-Holaf | LUT Saver | ✅ Gardée | |
| CUI-Holaf | Mask to Boolean | ✅ Gardée | |
| CUI-Holaf | Bypasser | ✅ Gardée | |
| CUI-Holaf | Group Bypasser | ✅ Gardée | |
| CUI-Holaf | Simple Bypasser | ✅ Gardée | |
| CUI-Holaf | Remote | ✅ Gardée | |
| CUI-Holaf | Remote Selector | ✅ Gardée | |
| CUI-Holaf | Load Image/Video | ✅ Gardée | |
| CUI-Holaf | Image Batch Slice | ✅ Gardée | |
| CUI-Holaf | Text Box | ✅ Gardée | |
| CUI-Holaf | To Text | ✅ Gardée | |
| CUI-Holaf | Image Adjustment | ✅ Gardée | |
| CUI-Holaf | Bundle Creator | ✅ Gardée | |
| CUI-Holaf | Bundle Extractor | ✅ Gardée | |
| CUI-Holaf | Auto Select x2 | ✅ Gardée | |
| CUI-Holaf | KSampler standard | ❌ Abandonnée | Cohérent avec l'exclusion de la stack diffusers |
| CUI-Holaf | Video Preview | ❌ Abandonnée | Cohérent avec l'exclusion de la stack diffusers |
| CUI-Holaf | Nucleus-Image | ❌ Abandonnée | Cohérent avec l'exclusion de la stack diffusers |
| AIH | Elements Picker | ✅ Gardée | |
| AIH | Prompt Enhancer | ✅ Gardée | |
| AIH | Ideogram 4 Builder | ✅ Gardée | |
| AIH | Keywords | ✅ Gardée | |
| AIH | Ref Image Prep | ✅ Gardée | Clé renommée : `"AIH Ref Image Prep"` (avec espaces) → `AIHRefImagePrep` (normalisation §3.7) ; l'ancienne clé reste servie par l'alias legacy |
| AIH | LMStudio Settings | ✅ Gardée | |
| AIH | OpenAI Settings | ✅ Gardée | |
| AIH | Music | ✅ Gardée | + `templates/` de prompts rapatriés |
| AIH | Diagnostic | ❌ Abandonnée | |
| AIH | Preview | ❌ Abandonnée | |

**Totaux : 24 nodes CUI-Holaf gardées / 3 abandonnées ; 8 nodes AIH gardées / 2 abandonnées.**
Zéro collision de noms constatée lors de l'analyse préalable (préfixes `Holaf*` vs `AIH*`).

### 2.2 Infrastructure

| Élément | Décision | Détail |
|---|---|---|
| Système `credentials.json` | ✅ Gardé | |
| `_llm_helper` (Ollama / OpenAI / vision) | ✅ Gardé | |
| Routes `/api/aih/models/*` | ✅ Gardées | SFTP chunked + fingerprint |
| Mode miroir local complet | ✅ Gardé | `store.py` + `sync_engine` + `embedding_engine` + `local_source` + routes `/aih/local/*` — fallback voulu si le site tombe |
| Blobby Companion | ✅ Gardé | |
| Widgets JS transverses | ✅ Gardés | Model Browser, Workflow Share, Modal v2 |
| Frontend local | ✅ Gardé | Servi via `/aih/local/*` |
| Bouton **Update** | ✅ Conservé (modifié) | `git pull` ; si une mise à jour est appliquée → propose le redémarrage ; s'appuie sur le mécanisme de restart sécurisé d'Utils |
| Bouton **Restart** | ✅ Conservé (modifié) | Autonome, indépendant du bouton Update |
| Anciennes routes `/aih/update` et `/aih/restart` | 🔁 Remplacées | Par la mécanique unifiée Update / Restart ci-dessus |
| Terminal | ✅ **Tranché : terminal unique Utils** | Ancien point ouvert « terminal hybride » clos : conservation du **seul terminal de CUI-Holaf-Utils** (authentifié par mot de passe hashé) ; le terminal AIH non authentifié est **supprimé lors de la fusion**, sans hybridation ; les dépendances xterm.js vendored sont déjà côté Utils (déduplication naturelle) |
| Reconnexion de session du terminal | ✅ **Implémentée et validée** | Correctif Ctrl+D → login → nouvelle session fraîche livré dans `holaf_terminal.py` + `js/holaf_terminal.js`, **validé en conditions réelles** ; à **préserver tel quel** pendant toutes les phases de fusion — aucune régression autorisée sur ces deux fichiers |

---

## 3. Dédoublements et adaptations techniques

| # | Sujet | Décision / action |
|---|---|---|
| 3.1 | **AnyType en doublon** (`nodes/holaf_utils.py` de CUI-Holaf vs copie locale dans `holaf_remote_comparer.py`) | **Unifier** : une seule implémentation partagée dans le pack fusionné. |
| 3.2 | **Homonymie `holaf_utils.py`** (racine d'Utils ≠ `nodes/holaf_utils.py` de CUI-Holaf) | **Renommer** celui venant de CUI-Holaf en `holaf_node_helpers.py`. |
| 3.3 | **Auto pip install au boot d'AIH** | **Supprimé.** Remplacé par un `requirements.txt` unique pour le pack fusionné : `numpy`, `Pillow`, `spandrel`, `av`, `paramiko`, `requests` + dépendances existantes d'Utils : `psutil`, `pywinpty`, `aiofiles`, `orjson`, `watchdog`, `python-xmp-toolkit`, `aiohttp`, `pynvml`. |
| 3.4 | **Enregistrement des nodes CUI-Holaf** | Utils charge dynamiquement chaque fichier de `nodes/` en lisant `module.NODE_CLASS_MAPPINGS` par fichier, alors que CUI-Holaf utilise un registre central dans son `__init__.py`. Deux options au choix de l'implémenteur : (a) adapter les 24 fichiers pour exposer chacun leur propre `NODE_CLASS_MAPPINGS`, ou (b) conserver/intégrer leur registre central. **Le choix retenu devra être documenté dans le code ou dans ce document.** |
| 3.5 | **`__init__.py` racine AIH (~1812 lignes)** | **Refactoring obligatoire** : suppression du chargement exotique via `sys.modules` pré-enregistrés (~35 routes HTTP inline), standardisation des imports, conservation du préfixe `/aih/*` des routes. |
| 3.6 | **Routes HTTP** | Disjointes après vérification : `/holaf/*` (Utils/CUI-Holaf) vs `/aih/*` (AIH). Aucun changement de namespace requis. |
| 3.7 | **Normalisation des noms de nodes** | Marque unique **AIH** : clés de mapping `AIH<PascalCase>`, labels préfixés « AIH », arbre de catégories racine `AIH/`, alias legacy obligatoires — détail complet ci-dessous. |
| 3.8 | **Dossiers web JS** | Différents entre les deux sources (aucun conflit). Utils hardcode `/extensions/ComfyUI-Holaf-Utilities/` dans son JS : valide uniquement tant que le dé-hardcodage (§3.11) n'est pas réalisé ; après dé-hardcodage, ces chemins deviennent dynamiques (dérivés de l'URL du script chargé) et survivent au renommage du dossier. |
| 3.9 | **Chemins de persistance** | Sans collision : `user/default/aih/` (AIH) vs `.cache/` (Utils). Aucune migration nécessaire. |
| 3.10 | **Double installation** | Vérifier qu'après migration, aucun ancien repo (CUI-Holaf ou AIH_ComfyUI copié séparément) ne reste installé en parallèle dans `custom_nodes/` → risque de double enregistrement des nodes/routes. |
| 3.11 | **Renommage du repo → `ComfyUI-AI-Helper`** | Marque AIH unifiée. **Prérequis bloquant** : dé-hardcodage des chemins `/extensions/ComfyUI-Holaf-Utilities/` + audit complet des occurrences du nom en Python/JS (classement : stockage utilisateur migré automatiquement vs assets à dynamiser). Timing : dé-hardcodage en Phase 0, rename possible dès la fin de la Phase 0 — détail ci-dessous. |

### 3.7 Normalisation des noms de nodes

Marque unique **AIH** : abandon du double branding `Holaf*` / `AIH*` au niveau du nommage visible dans ComfyUI (clés de mapping, labels affichés, catégories de menu).

#### Convention actée

| Aspect | Règle | Exemple |
|---|---|---|
| Clé de mapping | `AIH<PascalCase>`, sans suffixe `Node` | `AIHSaveMedia` (pas `AIHSaveMediaNode`) |
| Nom affiché (label ComfyUI) | Toujours préfixé `AIH ` | `AIH Save Media` |
| Catégories de menu | Arbre unique, racine `AIH/` | `AIH/Flow Control` |

Style menu : **couleur orange historique conservée**, mise en œuvre avec le **style de menu AI Helper** (décision D6).

Arbre de catégories unique, racine `AIH/` :

| Catégorie | Nodes |
|---|---|
| `AIH/Image` | Overlay, Upscale, Instagram Resize, Adjustment, Batch Slice, Resolution Presets |
| `AIH/IO` | Save Media, Load Image/Video |
| `AIH/Sampling` | Tiled KSampler |
| `AIH/Masking` | Mask to Boolean |
| `AIH/LUT` | Generator, Saver |
| `AIH/Flow Control` | Bypasser, Group Bypasser, Simple Bypasser, Auto Select x2, Remote, Remote Selector |
| `AIH/Text` | Text Box, To Text |
| `AIH/Bundles` | Creator, Extractor |
| `AIH/View` | Image Comparer, Remote Comparer |
| `AIH/Prompting` | Elements Picker, Prompt Enhancer, Ideogram 4 Builder, Keywords, LMStudio Settings, OpenAI Settings |
| `AIH/Media` | Ref Image Prep, Music |

#### Table de renommage complète (ancienne clé → nouvelle clé)

Nodes ex-CUI-Holaf :

| Ancienne clé | Nouvelle clé |
|---|---|
| `HolafSaveMedia` | `AIHSaveMedia` |
| `HolafTiledKSampler` | `AIHTiledKSampler` |
| `HolafImageComparer` | `AIHImageComparer` |
| `UpscaleImageHolaf` | `AIHUpscale` |
| `HolafOverlayNode` | `AIHOverlay` |
| `HolafResolutionPreset` | `AIHResolutionPreset` |
| `HolafResolutionPresetV2` | `AIHResolutionPresetV2` |
| `HolafInstagramResize` | `AIHInstagramResize` |
| `HolafLutGenerator` | `AIHLutGenerator` |
| `HolafLutSaver` | `AIHLutSaver` |
| `HolafMaskToBoolean` | `AIHMaskToBoolean` |
| `HolafBypasser` | `AIHBypasser` |
| `HolafGroupBypasser` | `AIHGroupBypasser` |
| `HolafSimpleBypasser` | `AIHSimpleBypasser` |
| `HolafRemote` | `AIHRemote` |
| `HolafRemoteSelector` | `AIHRemoteSelector` |
| `HolafLoadImageVideo` | `AIHLoadImageVideo` |
| `HolafImageBatchSlice` | `AIHImageBatchSlice` |
| `HolafTextBox` | `AIHTextBox` |
| `HolafToText` | `AIHToText` |
| `HolafImageAdjustment` | `AIHImageAdjustment` |
| `HolafBundleCreator` | `AIHBundleCreator` |
| `HolafBundleExtractor` | `AIHBundleExtractor` |
| `HolafAutoSelectX2` | `AIHAutoSelectX2` |
| `HolafRemoteComparer` | `AIHRemoteComparer` |

Nodes ex-AIH :

| Ancienne clé | Nouvelle clé |
|---|---|
| `AIHElementsNode` | `AIHElementsPicker` |
| `AIHEnhanceNode` | `AIHPromptEnhancer` |
| `AIHIdeogram4Node` | `AIHIdeogram4Builder` |
| `AIHKeywordsNode` | `AIHKeywords` |
| `"AIH Ref Image Prep"` (avec espaces) | `AIHRefImagePrep` |
| `AIHLMStudioSettingsNode` | `AIHLMStudioSettings` |
| `AIHOpenAISettingsNode` | `AIHOpenAISettings` |
| `AIHMusicNode` | `AIHMusic` |

#### Mécanisme d'alias legacy (obligatoire)

- Chaque ancienne clé doit **continuer d'exister dans `NODE_CLASS_MAPPINGS`** et pointer vers la **même classe** que sa nouvelle clé : les vieux workflows restent compatibles indéfiniment.
- La table d'alias **n'est jamais purgée**.
- Les nouveaux workflows sauvegardent les nouvelles clés.

#### Protections anti-casse

- Les fichiers internes Python/JS et les identifiants d'enregistrement des extensions JS **ne changent pas** : seul le nommage visible dans ComfyUI est rebrandé.
- Le nom du dossier d'extension reste inchangé **par défaut** ; il **POURRA changer** (via le renommage du repo en `ComfyUI-AI-Helper`, §3.11) **UNIQUEMENT après** l'accomplissement de l'item « Dé-hardcodage des chemins d'extension ». Tant que ce prérequis n'est pas satisfait, aucun changement de nom.
- Ne pas casser les chemins codés en dur `/extensions/ComfyUI-Holaf-Utilities/` tant que le dé-hardcodage n'est pas réalisé (cf. §3.8 / §3.11).

---

### 3.11 Renommage du repo → ComfyUI-AI-Helper

Décision : le repo cible `ComfyUI-Holaf-Utils` sera **renommé `ComfyUI-AI-Helper`** — marque AIH unifiée, alignement avec l'écosystème AI Helper produit sans conflit de nom direct.

#### Prérequis bloquant : dé-hardcodage des chemins d'extension

Le dossier d'extension changera de nom chez les utilisateurs (`custom_nodes/ComfyUI-Holaf-Utilities/` → `custom_nodes/ComfyUI-AI-Helper/`) → tous les chemins actuellement codés en dur `"/extensions/ComfyUI-Holaf-Utilities/"` présents dans le JS casseraient. À réaliser **AVANT tout renommage** :

1. **Rendre DYNAMIQUES tous les chemins JS codés en dur** `"/extensions/ComfyUI-Holaf-Utilities/"` : dérivation depuis l'URL du script chargé (ex. `import.meta.url`, ou lecture du `src` du tag `<script>`).
2. **Auditer TOUTES les occurrences** du nom `ComfyUI-Holaf-Utilities` dans le **Python et le JS** (grep complet du code), puis classer **chaque occurrence** :
   - **chemin de stockage utilisateur** (ex. `user/default/ComfyUI-Holaf-Utilities/profiler/`, base SQLite, config…) → couvert par la **migration automatique des données** (ci-dessous) ;
   - **chemin d'assets servi** (fichiers web exposés par le serveur, ex. `/extensions/…`) → **dynamiser** (dérivation depuis l'URL réelle).

#### Migration automatique des données

Au premier démarrage suivant le changement de nom du dossier d'extension, les données existantes sont **migrées automatiquement** vers les nouveaux emplacements aux noms AIH (dossier d'extension : `custom_nodes/ComfyUI-AI-Helper/` ; répertoires de données utilisateur : **`user/default/AI-Helper/`**, cf. Zone B ci-dessous). La migration est **idempotente** : elle ne s'exécute qu'une seule fois (déclenchée uniquement si l'ancien emplacement existe et que le nouveau est absent), puis reste un no-op lors des démarrages suivants.

Les données vivent dans **deux zones distinctes**, toutes deux à migrer :

**Zone A — dans le dossier de l'extension lui-même** (chemins relatifs à `__file__`) :

| Artefact | Contenu |
|---|---|
| `holaf_utilities.sqlite` | Index images (~32k entrées) + statuts miniatures |
| `.cache/thumbnails/` | Miniatures générées |
| `config.ini` | Configuration |
| `temp_uploads/` | Uploads temporaires |
| `temp_exports/` | Exports temporaires |

- **Détection** : si un dossier voisin `custom_nodes/ComfyUI-Holaf-Utilities/` existe encore avec ces artefacts, et que les équivalents sont absents du nouveau dossier `custom_nodes/ComfyUI-AI-Helper/`, alors les **déplacer** vers le nouveau dossier.
- **CRITIQUE** : sans cette migration, perte de l'index complet (~32k images) et régénération totale des miniatures.

**Zone B — répertoires utilisateur** :

- `ComfyUI/user/default/ComfyUI-Holaf-Utilities/` (profiler, etc.) → renommer en `user/default/AI-Helper/` au premier démarrage, si l'ancien répertoire existe et que le nouveau est absent.
- **Nom figé du nouveau répertoire de données utilisateur : `AI-Helper`** (`user/default/AI-Helper/`) — nom court cohérent avec le monorepo produit AI-Helper ; sans ambiguïté car namespacé sous `user/default/`.

**Règles de sécurité** :

- privilégier le **déplacement (rename)** plutôt que copie + suppression (atomique, pas de duplication d'espace disque) ;
- ne **JAMAIS écraser** des données nouvelles plus récentes déjà présentes aux nouveaux emplacements ;
- **journaliser clairement** chaque migration effectuée (artefact, source, destination) ;
- en cas de doute ou d'échec : **ne rien détruire**, laisser l'ancien dossier intact — un fallback manuel documenté permet à l'utilisateur de finaliser la migration à la main.

#### Opérations post-rename (manuelles, côté grokuku / utilisateurs)

| # | Action | Détail |
|---|---|---|
| 1 | Rename du repo sur GitHub | `ComfyUI-Holaf-Utils` → `ComfyUI-AI-Helper` ; GitHub redirige automatiquement les anciennes URLs |
| 2 | Mise à jour des remotes locaux | `git remote set-url …` sur chaque clone |
| 3 | Communication aux utilisateurs | Réinstaller l'extension sous le nouveau nom |

#### Timing recommandé

- **Dé-hardcodage : pendant la Phase 0.**
- **Rename : possible dès la fin de la Phase 0, AVANT les phases de fusion**, afin que tout le travail ultérieur (Phases 1 → 4) se fasse déjà dans le repo au nom final.

---

## 4. Licence

**Actée : GPLv3-or-later** pour le pack fusionné.
Justification : code CUI-Holaf déjà GPL, auteur unique des trois projets (= droit de choisir), cohérence avec ComfyUI (GPLv3).

### Checklist avant publication

| Statut | Action |
|---|---|
| 🔴 | Ajouter un fichier `LICENSE` (texte GPLv3 intégral) à la racine de `CUI-Holaf-Utils`. |
| 🔴 | Créer `THIRD-PARTY-NOTICES.md` avec notice MIT + crédit xterm.js authors pour les builds vendored `xterm.js` / `xterm-addon-fit`. |
| 🟠 | Conserver intacts le `LICENSE` et les en-têtes GPLv3 de CUI-Holaf ainsi que toutes notices Copyright. |
| 🟠 | Apposer des en-têtes GPLv3 sur les fichiers AIH fusionnés. |
| 🟡 | Confirmer la licence de spandrel avant release (`pip show spandrel`). |
| ⚪ | Harmoniser copyright 2026 vs 2025 dans `js/holaf_main.js`. |

*(🔴 bloquant · 🟠 important · 🟡 recommandé · ⚪ mineur)*

---

## 5. Phasage proposé

| Phase | Contenu | Niveau de risque |
|---|---|---|
| **Phase 0 — Préparation, dé-hardcodage & migration des données** | Branche dédiée, ajout `LICENSE`, création `THIRD-PARTY-NOTICES.md`, `requirements.txt` fusionné, dé-hardcodage des chemins JS + audit des occurrences `ComfyUI-Holaf-Utilities` (§3.11), **implémentation de la logique de migration automatique des données — Zones A et B (livrable de code, §3.11)**. Rename GitHub en `ComfyUI-AI-Helper` possible en fin de phase. | Faible |
| **Phase 1 — Intégration CUI-Holaf** | 24 nodes + widgets JS + adaptation du registre au loader d'Utils. Mécanique, faible risque. | Faible |
| **Phase 2 — Intégration AIH** | Refactoring du `__init__.py`, 8 nodes, infra locale (store/sync/embedding/local_source + routes `/aih/local/*`), widgets transverses, `templates/`. Chantier principal. | Élevé |
| **Phase 3 — Dédoublements** | Unification AnyType, renommage `holaf_node_helpers.py`, unification boutons Update/Restart, normalisation des noms de nodes (clés `AIH<PascalCase>`, labels « AIH », catégories `AIH/*`, alias legacy — §3.7). Terminal : suppression du terminal AIH et conservation du terminal Utils avec sa logique de session actuelle (point ouvert « terminal hybride » tranché — cf. §2.2 ; reconnexion de session validée à ne pas régresser). | Moyen |
| **Phase 4 — Validation** | Chargement ComfyUI sans erreur, workflows existants non cassés, routes `/holaf/*` et `/aih/*` fonctionnelles, checklist licence complète passée. | — |

> Le renommage du repo (§3.11) peut intervenir dès la fin de la Phase 0 : les Phases 1 à 4 se déroulent alors déjà dans `ComfyUI-AI-Helper`.

---

## 6. Risques et points de vigilance

- **Casse de workflows existants** si des clés de mapping changent.
  **Règle : les clés sont normalisées en `AIH<PascalCase>` (§3.7) mais chaque ancienne clé doit subsister dans `NODE_CLASS_MAPPINGS` comme alias pointant vers la même classe ; la table d'alias n'est jamais purgée.**
- **`sync_engine` dépendant du réseau vers kw.holaf.fr** : prévoir un comportement dégradé propre si le serveur est injoignable (le mode miroir local existe précisément comme fallback).
- **Taille du refactoring du `__init__.py` AIH** (~1812 lignes, ~35 routes inline) : tester **incrémentalement route par route** plutôt qu'en big-bang.
- **Double installation temporaire** des anciens packs pendant la transition : risque de double enregistrement des nodes et des routes ; désactiver/supprimer les anciens dossiers dès que la version fusionnée est opérationnelle.

---

## Tableau de suivi

| Phase | Élément | Statut |
|---|---|---|
| 0 | Créer une branche dédiée à la fusion | À faire |
| 0 | Ajouter `LICENSE` (texte GPLv3 intégral) à la racine | À faire |
| 0 | Créer `THIRD-PARTY-NOTICES.md` (notice MIT + crédit xterm.js authors) | À faire |
| 0 | Fusionner les `requirements.txt` (numpy, Pillow, spandrel, av, paramiko, requests + psutil, pywinpty, aiofiles, orjson, watchdog, python-xmp-toolkit, aiohttp, pynvml) | À faire |
| 0 | Supprimer l'auto pip install au boot d'AIH | À faire |
| 0 | Dé-hardcoder les chemins JS `/extensions/ComfyUI-Holaf-Utilities/` (dérivation dynamique depuis l'URL du script chargé : import.meta.url ou src du tag script) — prérequis bloquant du renommage (§3.11) | À faire |
| 0 | Auditer toutes les occurrences de `ComfyUI-Holaf-Utilities` en Python/JS (grep complet) et classer chaque occurrence : stockage utilisateur (couvert par la migration automatique) vs assets servi (à dynamiser) | À faire |
| 0 | Dynamiser les chemins d'assets servis identifiés par l'audit (§3.11) | À faire |
| 0 | Implémenter la logique de migration automatique des données (Zones A et B — §3.11) | À faire |
| 0+ (post-Phase 0) | Renommer le repo sur GitHub : `ComfyUI-Holaf-Utils` → `ComfyUI-AI-Helper` (redirections automatiques des anciennes URLs) | À faire |
| 0+ (post-Phase 0) | Mettre à jour les remotes git locaux vers le nouveau nom | À faire |
| 0+ (post-Phase 0) | Communiquer aux utilisateurs : réinstaller l'extension sous le nouveau nom (données migrées automatiquement au premier démarrage, §3.11) | À faire |
| 1 | Intégrer les 24 nodes CUI-Holaf dans `nodes/` | À faire |
| 1 | Adapter l'enregistrement des nodes CUI-Holaf au loader par-fichier d'Utils (ou intégrer leur registre central — choix à documenter) | À faire |
| 1 | Intégrer les widgets JS associés aux 24 nodes | À faire |
| 1 | Rapatrier `nodes/holaf_utils.py` de CUI-Holaf (futur `holaf_node_helpers.py`) | À faire |
| 1 | Vérifier le chargement des 24 nodes dans ComfyUI sans erreur | À faire |
| 2 | Refactorer le `__init__.py` AIH (~1812 lignes) : suppression du chargement via `sys.modules`, imports standardisés, préfixe `/aih/*` conservé | À faire |
| 2 | Intégrer les 8 nodes AIH (Elements Picker, Prompt Enhancer, Ideogram 4 Builder, Keywords, Ref Image Prep, LMStudio Settings, OpenAI Settings, Music) | À faire |
| 2 | Renommer la clé `"AIH Ref Image Prep"` (avec espaces) en `AIHRefImagePrep` et créer son alias legacy | À faire |
| 2 | Rapatrier `templates/` de prompts (node Music) | À faire |
| 2 | Intégrer le système `credentials.json` | À faire |
| 2 | Intégrer `_llm_helper` (Ollama/OpenAI/vision) | À faire |
| 2 | Intégrer les routes `/api/aih/models/*` (SFTP chunked + fingerprint) | À faire |
| 2 | Intégrer le mode miroir local complet (`store.py`, `sync_engine`, `embedding_engine`, `local_source`, routes `/aih/local/*`) | À faire |
| 2 | Prévoir le comportement dégradé de `sync_engine` si kw.holaf.fr est injoignable | À faire |
| 2 | Intégrer Blobby Companion | À faire |
| 2 | Intégrer les widgets JS transverses (Model Browser, Workflow Share, Modal v2) | À faire |
| 2 | Servir le frontend local via `/aih/local/*` | À faire |
| 2 | Tester incrémentalement chaque route refactorée | À faire |
| 3 | Unifier AnyType (une seule implémentation partagée) | À faire |
| 3 | Renommer `holaf_utils.py` (venant de CUI-Holaf) en `holaf_node_helpers.py` et mettre à jour les imports | À faire |
| 3 | Unifier les boutons Update et Restart (Update = git pull → proposition de redémarrage via restart sécurisé d'Utils ; Restart autonome) | À faire |
| 3 | Remplacer les anciennes routes `/aih/update` et `/aih/restart` par la mécanique unifiée | À faire |
| 3 | Supprimer le terminal AIH et conserver le terminal Utils avec sa logique de session actuelle (auth par mot de passe hashé ; reconnexion Ctrl+D → login → session fraîche déjà implémentée et validée — ne pas régresser sur `holaf_terminal.py` / `js/holaf_terminal.js`) | À faire |
| 3 | Normaliser les clés de mapping en `AIH<PascalCase>` sans suffixe `Node` (table de renommage §3.7) | À faire |
| 3 | Préfixer tous les labels affichés par « AIH » | À faire |
| 3 | Réorganiser l'arbre de catégories sous la racine `AIH/` (couleur orange historique + style de menu AI Helper) | À faire |
| 3 | Mettre en place la table d'alias legacy dans `NODE_CLASS_MAPPINGS` (chaque ancienne clé → même classe, jamais purgée) | À faire |
| 3 | Harmoniser copyright 2026 vs 2025 dans `js/holaf_main.js` | À faire |
| 4 | Valider le chargement complet de ComfyUI sans erreur | À faire |
| 4 | Valider que les workflows existants ne sont pas cassés (anciennes clés toutes résolues via les alias legacy) | À faire |
| 4 | Valider les routes `/holaf/*` | À faire |
| 4 | Valider les routes `/aih/*` | À faire |
| 4 | Vérifier l'absence de double installation des anciens packs | À faire |
| 4 | Apposer les en-têtes GPLv3 sur les fichiers AIH fusionnés | À faire |
| 4 | Vérifier que LICENSE/en-têtes/notices Copyright de CUI-Holaf sont intacts | À faire |
| 4 | Confirmer la licence spandrel avant release (`pip show spandrel`) | À faire |
| 4 | Checklist licence complète passée avant publication | À faire |
