# Plan de Développement - Éditeur d'Images et Maintenance Holaf

Ce document suit l'avancement de l'implémentation des fonctionnalités pour Holaf Image Viewer.

## Phase 1 : Architecture de Base et Ajustements Simples (Éditeur)

**Objectif :** Mettre en place la structure complète de l'éditeur, y compris la gestion des fichiers de configuration `.edt`, l'interface utilisateur de base, et l'application des premiers filtres (luminosité, contraste, saturation).

---

### **État d'Avancement :** Terminé

#### **Étape 1 : Modifications du Backend (Python)**

-   [x] **Mise à jour de la Base de Données (`holaf_database.py`)**
-   [x] **Logique de Synchronisation (`logic.py`)**
-   [x] **Nouvelles Routes d'API (`edit_routes.py`)**
-   [x] **Mise à jour des Routes Existantes (`image_routes.py`, `export_routes.py`)**
-   [x] **Activation des Nouvelles Routes (`__init__.py`)**
-   [x] **Ajout de la fonction utilitaire (`holaf_utils.py`)**

#### **Étape 2 : Modifications du Frontend (JavaScript)**

-   [x] **Création du Module d'Édition (`image_viewer_editor.js`)**
-   [x] **Intégration du Module (`holaf_image_viewer.js`)**
-   [x] **Interface Utilisateur (`image_viewer_ui.js`, `image_viewer_editor.js`)**
-   [x] **Ajout de l'Indicateur sur la Miniature (`image_viewer_gallery.js`)**
-   [x] **Améliorations et Corrections de l'Interface**

---

### **Problèmes Corrigés**

-   Les problèmes de mise en page de la colonne de droite et de l'icône de l'éditeur ont été résolus lors des refactorings CSS ultérieurs.

---

### **Phase 2 : Fonctionnalités d'Édition Avancées (À venir)**

-   [ ] **Fonctionnalités "Moyennes" :**
    -   [ ] Implémentation du recadrage (Crop/Expand) par ratio et manuel (via `<canvas>`).
    -   [ ] Implémentation de la balance des blancs et du réglage RGB (via `<canvas>`).
    -   [ ] Duplication de cette logique en Python (Pillow) pour l'export.
-   [ ] **Fonctionnalités "Difficiles" :**
    -   [ ] Implémentation du vignettage (CSS et Pillow).
    -   [ ] Implémentation de l'overlay/watermark (gestion d'upload, etc.).
-   [ ] **Onglet "Opérations" :**
    -   [ ] Compléter les fonctionnalités (Copier/Coller, Import/Export .edt, On/Off).

---

### **Phase 3 : Maintenance et Stabilité**

**Objectif :** Ajouter des outils de maintenance directement dans l'interface pour permettre aux utilisateurs de garantir la cohérence des données et la propreté du système sans intervention manuelle.

### **État d'Avancement :** Terminé

#### **Étape 1 : Modifications du Backend (Python)**

-   [x] **Logique de Maintenance (`logic.py`)**
    -   Réutilisation de `sync_image_database_blocking()` pour la synchronisation complète.
    -   Ajout de la nouvelle fonction `clean_thumbnails_blocking()` pour :
        -   Supprimer les miniatures dont l'image originale n'existe plus.
        -   Vérifier l'intégrité des miniatures existantes.
        -   Marquer pour régénération les miniatures manquantes ou corrompues.
-   [x] **Nouvelles Routes de Maintenance (`utility_routes.py`)**
    -   Ajout de la route `POST /holaf/images/maintenance/sync-database` pour lancer la synchronisation.
    -   Ajout de la route `POST /holaf/images/maintenance/clean-thumbnails` pour lancer le nettoyage des miniatures.
-   [x] **Mise à jour de l'Initialisation (`__init__.py`)**
    -   Les nouvelles routes de maintenance ont été exposées et enregistrées correctement.

#### **Étape 2 : Modifications du Frontend (JavaScript)**

-   [x] **Interface Utilisateur (`image_viewer_ui.js`)**
    -   Ajout d'une section "Maintenance" dans le panneau de gauche.
    -   Création des boutons "Sync Database" et "Clean Thumbs" avec des icônes et des infobulles.
-   [x] **Logique d'Interaction (`image_viewer_ui.js`)**
    -   Importation et utilisation de `HolafToastManager` pour les notifications.
    -   Implémentation de la fonction `_runMaintenanceTask` qui :
        -   Demande confirmation à l'utilisateur.
        -   Affiche une notification "En cours...".
        -   Appelle l'API backend correspondante.
        -   Met à jour la notification avec le résultat (succès ou échec).
-   [x] **Styles (`holaf_image_viewer.css`)**
    -   Ajout de styles mineurs pour la nouvelle section de maintenance si nécessaire.