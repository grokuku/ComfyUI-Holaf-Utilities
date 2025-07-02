# Plan de Développement - Éditeur d'Images Holaf

Ce document suit l'avancement de l'implémentation de la fonctionnalité d'édition d'images non-destructive pour Holaf Image Viewer.

## Phase 1 : Architecture de Base et Ajustements Simples

**Objectif :** Mettre en place la structure complète de l'éditeur, y compris la gestion des fichiers de configuration `.edt`, l'interface utilisateur de base, et l'application des premiers filtres (luminosité, contraste, saturation).

---

### **État d'Avancement :** Terminé

#### **Étape 1 : Modifications du Backend (Python)**

-   [x] **Mise à jour de la Base de Données (`holaf_database.py`)**
    -   Ajout de la colonne `has_edit_file` à la table `images`.
    -   Création de la migration (schema version 5) pour l'appliquer.
-   [x] **Logique de Synchronisation (`logic.py`)**
    -   La fonction `sync_image_database_blocking` détecte maintenant les fichiers `.edt` et met à jour la colonne `has_edit_file`.
-   [x] **Nouvelles Routes d'API (`edit_routes.py`)**
    -   Fichier `edit_routes.py` créé avec les routes :
        -   `GET /holaf/images/load-edits`
        -   `POST /holaf/images/save-edits`
        -   `POST /holaf/images/delete-edits`
-   [x] **Mise à jour des Routes Existantes (`image_routes.py`, `export_routes.py`)**
    -   La route `list_images_route` inclut le flag `has_edit_file` dans sa réponse.
    -   La route `prepare_export_route` lit les fichiers `.edt` et applique les ajustements (luminosité, contraste, saturation) via Pillow avant l'export.
-   [x] **Activation des Nouvelles Routes (`__init__.py`)**
    -   Le `__init__.py` du backend expose les nouvelles fonctions de `edit_routes.py`.
    -   Le `__init__.py` racine déclare les nouvelles routes au serveur aiohttp de ComfyUI.
-   [x] **Ajout de la fonction utilitaire (`holaf_utils.py`)**
    -   Ajout de la fonction `sanitize_path_canon` pour sécuriser les chemins de fichiers.

#### **Étape 2 : Modifications du Frontend (JavaScript)**

-   [x] **Création du Module d'Édition (`image_viewer_editor.js`)**
    -   Fichier créé avec la classe `ImageEditor` gérant l'état, l'aperçu en direct via les filtres CSS, et la communication avec les nouvelles routes d'API.
-   [x] **Intégration du Module (`holaf_image_viewer.js`)**
    -   Le module `ImageEditor` est importé et instancié.
    -   Le panneau d'édition est affiché/caché lors de l'entrée/sortie de la vue agrandie.
-   [x] **Interface Utilisateur (`image_viewer_ui.js`, `image_viewer_editor.js`)**
    -   Le HTML de base pour le panneau d'édition (onglets, curseurs, boutons) est généré.
    -   La structure HTML de la colonne de droite a été modifiée pour accueillir les deux panneaux.
-   [x] **Ajout de l'Indicateur sur la Miniature (`image_viewer_gallery.js`)**
    -   L'icône de crayon `✎` est ajoutée au DOM de chaque miniature.
    -   Un événement `onclick` sur l'icône ouvre directement l'image en mode édition.
-   [x] **Améliorations et Corrections de l'Interface**
    -   **Double-clic pour réinitialiser les curseurs :** Implémenté dans `image_viewer_editor.js`.
    -   **Correction de la mise en page CSS :** Les styles dans `holaf_image_viewer.css` ont été ajoutés pour positionner correctement les panneaux de la colonne de droite.

---

### **Problèmes à Corriger (Bugs Actuels)**

1.  **Mise en page de la colonne de droite :** Le panneau de l'éditeur (`Image Editor`) se superpose encore à celui des informations (`Image Information`) au lieu de se positionner en dessous. Le panneau d'information doit occuper l'espace restant en haut, et l'éditeur doit avoir une taille fixe en bas.
    -   **Fichiers probables :** `js/css/holaf_image_viewer.css`, `js/image_viewer/image_viewer_ui.js`.

2.  **Position de l'icône de crayon :** L'icône `✎` apparaît en haut à gauche de la miniature au lieu d'en haut à droite.
    -   **Fichier probable :** `js/css/holaf_image_viewer.css`.

3.  **Apparence de l'icône de crayon :** L'icône est toujours de la même couleur (blanc), qu'un fichier `.edt` existe ou non. La classe `.active` ne semble pas appliquer la `var(--holaf-accent-color)`.
    -   **Fichier probable :** `js/css/holaf_image_viewer.css`.

---

### **Phase 2 : Planification (À venir)**

-   [ ] **Corrections des bugs de la Phase 1.**
-   [ ] **Fonctionnalités "Moyennes" :**
    -   [ ] Implémentation du recadrage (Crop/Expand) par ratio et manuel (via `<canvas>`).
    -   [ ] Implémentation de la balance des blancs et du réglage RGB (via `<canvas>`).
    -   [ ] Duplication de cette logique en Python (Pillow) pour l'export.
-   [ ] **Fonctionnalités "Difficiles" :**
    -   [ ] Implémentation du vignettage (CSS et Pillow).
    -   [ ] Implémentation de l'overlay/watermark (gestion d'upload, etc.).
-   [ ] **Onglet "Opérations" :**
    -   [ ] Compléter les fonctionnalités (Copier/Coller, Import/Export .edt, On/Off).