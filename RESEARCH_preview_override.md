# Recherche : Model Preview Override (Kijai) & Node d'affichage séparée

> **Date :** 2025-01  
> **Projet cible :** CUI-Holaf-Utils (pack ComfyUI séparé de CUI-Holaf)  
> **Objet :** Référence technique pour une future implémentation d'une node d'affichage de preview découplée.

---

## Sommaire

1. [Vue d'ensemble de la node Kijai](#1-vue-densemble-de-la-node-kijai)
2. [Architecture — comment ça fonctionne côté backend](#2-architecture--comment-ça-fonctionne-côté-backend)
3. [Partie JS — affichage de la preview](#3-partie-js--affichage-de-la-preview)
4. [Partie JS — les graphs dessous](#4-partie-js--les-graphs-dessous)
5. [Communication frontend / backend](#5-communication-frontend--backend)
6. [Pourquoi ça ne marche pas dans un subgraph](#6-pourquoi-ça-ne-marche-pas-dans-un-subgraph)
7. [Notre discussion : node séparée d'affichage](#7-notre-discussion--node-séparée-daffichage)
8. [Conclusion](#8-conclusion)

---

## 1. Vue d'ensemble de la node Kijai

| Champ | Valeur |
|---|---|
| **Nom de la classe** | `ModelPreviewOverrideKJ` |
| **Pack** | ComfyUI-KJNodes (Kijai) |
| **Type de node** | Passthrough `MODEL` (MODEL in → MODEL out) |
| **Fichier Python** | Dans le pack KJNodes (node `ModelPreviewOverrideKJ`) |
| **Fichiers JS** | `web/js/preview_override/preview_override.js` (~948 lignes) + `preview_override.css` |

### But principal

Ajouter une **live-preview frame directement sur la node**, en **bypassant la limite 512px** de ComfyUI. Surtout utile pour les **pixel-space models** (Chroma Radiance, ZImage, HiDream-O1) qui n'ont pas de VAE latent traditionnel.

### Inputs

| Input | Type | Description |
|---|---|---|
| `model` | `MODEL` | Model à wrapper (passthrough) |
| `max_resolution` | `INT` | Résolution max de la preview |
| `jpeg_quality` | `INT` | Qualité JPEG d'encodage |
| `suppress_default_preview` | `BOOL` | Supprime la preview native ComfyUI |
| `preview_frames` | `INT` | Nombre de frames à garder en mémoire (scrubbing) |
| `preview_fps` | `FLOAT` | FPS cible pour les previews animées (WebP/MP4) |
| `vae` | `VAE` (optional) | VAE optionnel pour décoder le latent |

### Output

| Output | Type | Description |
|---|---|---|
| `model` | `MODEL` | Le model modifié (avec wrapper attaché) |

---

## 2. Architecture — comment ça fonctionne côté backend

### Principe clé

> La node ne « récupère pas le résultat après coup » — **elle s'accroche au model qui sera utilisé plus tard par le sampler.**

### Étapes

1. **La node attache un wrapper** sur le hook `OUTER_SAMPLE` du `model.patcher` (mécanisme officiel ComfyUI).
2. Le model modifié **circule dans le graphe** jusqu'au `KSampler`.
3. Quand le `KSampler` utilise ce model pour sampler, **le wrapper se déclenche à chaque step**.
4. **À chaque step :**
   - Décode le latent (tiny VAE / Latent2RGB / LTX previewer).
   - Encode l'image (priorité : **MP4 NVENC** > **WebP animé** > **JPEG**).
   - Envoie via **WebSocket** au frontend.
5. L'encodage est fait dans un **thread dédié** (queue bornée, drop-on-full) pour **ne pas bloquer le sampler**.

### Schéma du flux backend

```
[ModelPreviewOverrideKJ]
  │
  ├── Attache wrapper sur model.patcher (hook OUTER_SAMPLE)
  │
  └── model (modifié) → ... → [KSampler]
                                    │
                                    ├── Step 1: wrapper déclenché → decode latent → encode → WS send
                                    ├── Step 2: wrapper déclenché → decode latent → encode → WS send
                                    └── ... Step N
```

---

## 3. Partie JS — affichage de la preview

### Fichiers

- `web/js/preview_override/preview_override.js` (~948 lignes)
- `preview_override.css` (chargé dynamiquement via `<link>`)

### Enregistrement

- `app.registerExtension(...)`
- Hook `beforeRegisterNodeDef` filtré sur `"ModelPreviewOverrideKJ"`

### DOM Widget

```js
node.addDOMWidget("preview", "kj_preview", root, { serialize: false });
// Taille min : 360×480
```

### 3 chemins de rendu (tous en double-buffering, pas de flash)

| Format | Technique | Détail |
|---|---|---|
| **JPEG / WebP mono** | `<img>` A/B | `img.decode()` puis swap d'opacité |
| **WebP animé** | `<canvas>` + `ImageDecoder` | `VideoFrame[]` → `requestAnimationFrame` loop à `preview_fps` |
| **MP4 (NVENC)** | `<video>` A/B | `requestVideoFrameCallback` + double `requestAnimationFrame` |

### Style

- `object-fit: contain`
- `image-rendering: pixelated`

### Réception WebSocket

- Écoute l'événement `kj_preview_override` sur l'API ComfyUI.
- Trouve la node par `node_id` (supporte les subgraphs via IDs qualifiés `"12:7:5"`).

### Scrubbing temporel

- Toutes les previews reçues sont **gardées en blob URLs indexés par step**.
- Le survol du graph rejoue n'importe quel step.

---

## 4. Partie JS — les graphs dessous

### Technologies

- **2 graphs** sur `<canvas>` avec l'API **Canvas 2D brute** — **AUCUNE librairie externe**.
- Helper `syncCanvasDPR` pour rendu net sur retina (device pixel ratio).

### Graph 1 — σ / Δ (composite 3 séries)

| Série | Représentation | Description |
|---|---|---|
| **Sigmas (σ)** | Ligne pointillée grise | Niveau de bruit décroissant |
| **Deltas (Δ)** | Aire remplie orange + ligne `#e67e22` | Magnitude du changement de x0 par step (`‖Δx0‖/√N`) |
| **SamplerDetailBoost** | Ligne cyan auto-scalée | Courbe de boost du sampler |

- Chaque série est **normalisée sur son propre max**.
- Marqueurs : `lockedStep` (jaune pointillé persistant) et `hoverStep` (gris).

### Graph 2 — step time (ms)

- Aire orange simple.
- Click sur le label → **toggle ms ↔ s**.

### Performance

- **Pas de polling** : redraw uniquement à l'arrivée d'un message WebSocket (1× par step).
- Axe X **fixé par `totalSteps`** → la ligne grandit de gauche à droite au lieu de s'étirer.

### Header ETA temps réel

```
1024×1024 · 5/20 · 320ms/step · ETA 48.0s
```

---

## 5. Communication frontend / backend

### Côté Python (émission)

```python
PromptServer.instance.send_sync("kj_preview_override", payload, client_id)
```

### Payload

| Champ | Type | Description |
|---|---|---|
| `node_id` | `str` | ID qualifié de la node (ex. `"12:7:5"`) |
| `image` | `str` (base64) | Image encodée en base64 |
| `mime` | `str` | Type MIME (`image/jpeg`, `image/webp`, `video/mp4`) |
| `w` | `int` | Largeur |
| `h` | `int` | Hauteur |
| `step` | `int` | Step courant |
| `total` | `int` | Nombre total de steps |
| `sigma` | `float` | Sigma courant |
| `sigmas` | `list\|null` | Liste des sigmas (`null` après step 0) |
| `delta` | `float` | Delta (magnitude du changement) |
| `step_ms` | `float` | Temps du step courant en ms |
| `avg_step_ms` | `float` | Temps moyen par step en ms |
| `fps` | `float` | FPS cible |
| `db_curve` | `list\|null` | Courbe SamplerDetailBoost |

### Côté JS (réception)

```js
api.addEventListener("kj_preview_override", (event) => {
    const data = event.detail;
    const node = findNodeByQualifiedId(data.node_id);
    if (node && node._kjPreviewHandler) {
        node._kjPreviewHandler(data);
    }
});
```

---

## 6. Pourquoi ça ne marche pas dans un subgraph

> La preview est bien **envoyée** mais **invisible** depuis le graph parent.

| Aspect | Statut |
|---|---|
| **Transport WebSocket** | ✅ Traversse les subgraphs sans souci |
| **Affichage** | ❌ Rendu dans un DOM widget sur la **node intérieure** |

### Explication

- Depuis le graph parent, on voit la `SubgraphNode` (un rectangle), **pas les nodes intérieures**.
- La preview est rendue sur la node `ModelPreviewOverrideKJ` qui est **à l'intérieur** du subgraph.
- Donc la preview est bien envoyée via WebSocket, mais affichée sur une node **invisible depuis l'extérieur**.

---

## 7. Notre discussion : node séparée d'affichage

### Est-ce possible ? **OUI.**

L'architecture se prête à **découpler source et display** via un **canal nommé** (similaire au `group_name` des bypassers Holaf).

### Node Source (dans le subgraph, passthrough MODEL)

| Champ | Valeur |
|---|---|
| **Rôle** | Attacher le wrapper sur le model + envoyer les previews |
| **Flow** | `MODEL` in → `MODEL` out (passthrough) |
| **Position** | À l'intérieur du subgraph |
| **Envoi** | `send_sync("holaf_preview_channel", { channel: "foo", image, sigmas, delta, ... })` |

- Attache le wrapper sur `model.patcher` (hook `OUTER_SAMPLE`) — **identique à Kijai**.
- Envoie les previews **taggées avec un channel name** au lieu d'un `node_id`.

### Node Display (hors du subgraph, n'importe où)

| Champ | Valeur |
|---|---|
| **Rôle** | Recevoir et afficher les previews + graphs |
| **Flow** | Aucun model flow — `OUTPUT_NODE = True` |
| **Position** | N'importe où dans le graphe (hors subgraph) |
| **Widget** | `STRING` pour le channel name |

- Écoute l'événement WebSocket, **filtre par channel name**.
- Rend la preview + les graphs (**même code canvas que Kijai**).

### Schéma de la solution

```
┌─────────────────────────────────────────────────┐
│  Subgraph                                        │
│                                                  │
│  [Load Model] → [Source] channel="foo"           │
│                     │                            │
│                     ├── wrapper sur OUTER_SAMPLE │
│                     └── MODEL out ───────────┐   │
│                                                │   │
│  [KSampler] ←─────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
                        │
                        │ WebSocket
                        │ "holaf_preview_channel"
                        │ { channel: "foo", image, sigmas, delta, ... }
                        ▼
┌───────────────────────────────────────────────────┐
│  Graph parent                                     │
│                                                   │
│  [Display] channel="foo"                          │
│     ├── <img>/<canvas>/<video> (preview)          │
│     ├── <canvas> Graph 1 (σ / Δ / DetailBoost)    │
│     └── <canvas> Graph 2 (step time)              │
└───────────────────────────────────────────────────┘
```

### Pourquoi c'est faisable

| Argument | Détail |
|---|---|
| **Code de rendu réutilisable** | Le code de rendu (preview + graphs canvas) de Kijai est réutilisable **tel quel** (Canvas 2D pur) |
| **Transport déjà cross-subgraph** | Le WebSocket traverse les subgraphs sans problème |
| **Découplage total** | Le channel name sépare complètement source et display → la display peut être **n'importe où** |
| **Données des graphs disponibles** | `sigmas`, `delta`, `step_ms` sont déjà dans le payload |

### Subtilités à gérer

| Subtilité | Description |
|---|---|
| **Cycle de vie** | La display doit savoir quand une run **commence** (reset historique) et **finit** |
| **Plusieurs displays sur le même channel** | Possible (broadcast) — toutes les displays reçoivent les mêmes données |
| **Plusieurs sources sur le même channel** | À définir — stratégie **last-wins** ? |
| **Pas de model flow côté display** | `OUTPUT_NODE = True` (la display ne participe pas au flux de model) |

---

## 8. Conclusion

| Point | Synthèse |
|---|---|
| **Faisabilité** | ✅ C'est faisable et c'est l'**évolution naturelle** de l'architecture de Kijai |
| **Problème de base** | Leur node combine **source + display en une seule node** (d'où la limitation subgraph) |
| **Solution** | En **séparant les deux** avec un channel name, on récupère la preview **où on veut** |
| **Décision** | Implémenter dans un **pack séparé** (`CUI-Holaf-Utils`), **pas** dans `CUI-Holaf` |

### Roadmap d'implémentation (suggérée)

1. **Node Source** (`HolafPreviewSource`) — portage du wrapper Python de Kijai, envoi sur `holaf_preview_channel` avec channel name.
2. **Node Display** (`HolafPreviewDisplay`) — `OUTPUT_NODE=True`, widget channel name, portage du code de rendu JS (preview + 2 graphs canvas).
3. Gestion du **cycle de vie** (reset au début de run, marquage de fin).
4. Support **multi-displays** (broadcast) et définition de la stratégie **multi-sources** (last-wins).

---

*Document de référence — à consulter lors de l'implémentation.*