# Holaf Utilities - Feuille de Route Générale

## Objectif Principal

Développer une suite d'utilitaires robustes et intégrés pour ComfyUI, centralisés sous un menu unique, offrant des fonctionnalités avancées de gestion de l'environnement, des modèles, des nœuds et des images.

---

### Tâches Générales et Bugs

**Statut : 🟡 En cours (avec bugs identifiés pour le System Monitor).**

1.  **Refactorisation Majeure du Code :**
    *   [COMPLETED] **Backend (Python) :** Le fichier monolithique `__init__.py` a été scindé en plusieurs modules plus petits et gérables (`holaf_database.py`, `holaf_config.py`, `holaf_terminal.py`, `holaf_image_viewer_utils.py`, `holaf_system_monitor.py`, `holaf_utils.py`, `holaf_server_management.py`) pour une meilleure maintenabilité et organisation.
    *   [COMPLETED] **Frontend (CSS) :** Le fichier CSS principal `holaf_utilities.css` a été divisé en fichiers CSS thématiques et par composant (`holaf_themes.css`, `holaf_shared_panel.css`, `holaf_main_button.css`, `holaf_model_manager_styles.css`, etc.) pour une meilleure gestion des styles. Le chargement de ces fichiers a été mis à jour dans `holaf_main.js`.
    *   [COMPLETED] **Frontend (JS - Image Viewer) :** Le fichier `holaf_image_viewer.js` a été décomposé en modules logiques (`ui`, `gallery`, `actions`, `navigation`, `infopane`, `settings`), réduisant drastiquement la taille du fichier principal et améliorant la maintenabilité.

2.  **Améliorations de l'Interface :**
    *   [COMPLETED] Les barres de titre des panneaux (Image Viewer, Nodes Manager) ont été uniformisées pour inclure les contrôles de thème et de zoom, comme le Model Manager et le Terminal.
    *   [COMPLETED] La gestion des thèmes est désormais indépendante pour chaque outil, avec une sauvegarde individuelle de l'état.

3.  **Correction de Bugs :**
    *   [COMPLETED] La logique de chargement et de sauvegarde des paramètres des panneaux (taille, position, thème, état plein écran) a été entièrement corrigée et unifiée pour le Terminal, le Model Manager et l'Image Viewer, résolvant les problèmes de persistance.
    *   [COMPLETED] La sauvegarde de la position/taille du panneau "Custom Nodes Manager" est maintenant fonctionnelle.
    *   [COMPLETED] L'option d'affichage "Contained (no crop)" de l'Image Viewer est sauvegardée et fonctionnelle.
    *   [COMPLETED] Le problème de bordure noire inattendue autour du contenu du Terminal a été corrigé via une révision des styles CSS du wrapper du terminal.
    *   [COMPLETED] Les erreurs "Cannot operate on a closed database" dans l'Image Viewer ont été corrigées par une meilleure gestion des connexions SQLite.
    *   [COMPLETED] Le fond noir derrière l'icône d'édition sur les vignettes de l'Image Viewer a été supprimé.
    *   [COMPLETED] Le panneau "Image Editor" se positionne désormais correctement sous le panneau d'informations dans la colonne de droite.
    *   [À FAIRE] Le texte du filtre dans le "Custom Nodes Manager" est sauvegardé dans config.ini mais n'est pas correctement rechargé et appliqué à la réouverture du panneau après un redémarrage de ComfyUI.
    *   [À FAIRE] **[BUG - Image Viewer]** La barre de défilement du panneau d'informations (colonne de droite) n'apparaît pas lorsque l'éditeur d'image est ouvert, ce qui empêche de voir tout le contenu si celui-ci est trop grand.
    *   **[BUG - System Monitor]** **Aucun log backend :** Les logs de débogage ajoutés dans le module `holaf_system_monitor.py` (anciennement `__init__.py`) pour la fonction `_get_system_stats_blocking` et le handler WebSocket `holaf_monitor_websocket_handler` n'apparaissent pas dans la console serveur, indiquant un problème en amont (connexion WebSocket non établie correctement, route non atteinte, ou erreur précoce non capturée dans le handler).
    *   **[BUG - System Monitor]** **Données incorrectes/manquantes sur le frontend :**
        *   Les valeurs CPU et RAM affichées sur le frontend sont à 0% et ne se mettent pas à jour.
        *   Les informations GPU n'apparaissent pas du tout sur le frontend (ni en texte, ni en graphique).
        *   Les graphiques eux-mêmes (lignes de données) ne s'affichent pas dans le canvas, seules les légendes et les axes/grilles sont visibles.
    *   **[BUG - System Monitor]** **Problème de configuration `psutil` initial ?** La première initialisation de `psutil.cpu_percent(interval=None)` pourrait poser problème sur certains systèmes ou configurations, nécessitant une gestion d'erreur plus robuste ou une approche alternative si `psutil` n'est pas disponible/fonctionnel.

4.  **Panneau de Configuration Centralisé :**
    *   [À FAIRE] Ajouter une entrée "Options" dans le menu principal (sous un séparateur).
    *   [À FAIRE] Créer un nouveau panneau "Options" qui permet de modifier graphiquement les paramètres de `config.ini` pour tous les outils (Terminal, Model Manager, etc.).

5.  **Fonctionnalité de Redémarrage :**
    *   [COMPLETED] Ajout d'une entrée "Restart ComfyUI" en bas du menu principal.
    *   [COMPLETED] Implémentation de la logique pour déclencher un redémarrage du serveur (via `holaf_server_management.py`).

---

# Holaf Image Viewer - Feuille de Route de Développement

## Objectif Principal

Créer un visualiseur d'images complet et performant, intégré à ComfyUI, permettant de parcourir, gérer, et inspecter les images générées dans le répertoire `output`. L'outil doit être rapide, riche en fonctionnalités et utiliser une base de données pour la persistance des métadonnées.

---

### Phase 1 : Fondations et Affichage de Base (MVP)

**Statut : ✅ Complétée et Stabilisée.**

1.  **Backend - API Performante :**
    *   [COMPLETED] L'endpoint `/holaf/images/list` lit désormais la liste depuis une base de données pour un chargement quasi-instantané.
    *   [COMPLETED] L'API `/holaf/images/metadata` a été créée pour extraire les métadonnées à la demande.

2.  **Frontend - Structure de l'Interface :**
    *   [COMPLETED] La structure à trois panneaux (Filtres, Galerie, Infos) est en place.
    *   [REMPLACÉ] Le bouton "Refresh" a été supprimé au profit d'une actualisation entièrement automatique.

3.  **Frontend - Affichage des Vignettes :**
    *   [COMPLETED] La galerie s'affiche correctement, en utilisant un endpoint dédié pour les miniatures.
    *   [COMPLETED] Un bug de rendu majeur (superposition des vignettes) a été corrigé en changeant le moteur de layout de la galerie (passage de Grid à Flexbox).
    *   [COMPLETED] La galerie est virtualisée (`IntersectionObserver`) pour gérer des milliers d'images sans "freeze".
    *   [COMPLETED] L'espacement entre les vignettes a été réduit à 4px pour un affichage plus compact.

4.  **Frontend - Interaction de Base :**
    *   [COMPLETED] Un clic simple sur une vignette la désigne comme "active" et affiche ses informations de base dans le panneau de droite.

---

### Phase 2 : Interactivité Avancée et Filtres

**Statut : ✅ Complétée et Stabilisée (sauf indication contraire).**

1.  **Frontend - Panneau Gauche (Filtres) :**
    *   [COMPLETED] Les listes de dossiers sont générées dynamiquement, en groupant les sous-dossiers sous leur parent de premier niveau.
    *   [COMPLETED] Les filtres par dossier sont récursifs : cocher un dossier affiche les images de tous ses sous-dossiers.
    *   [COMPLETED] Le filtre "Trashcan" (corbeille) est maintenant affiché en permanence dans la liste des filtres, même si la corbeille est vide.
    *   [À FAIRE] Une checkbox "Select All" pour gérer tous les filtres de dossiers d'un coup.
    *   [COMPLETED] La liste des formats est générée dynamiquement et les filtres sont fonctionnels.
    *   [COMPLETED] La sauvegarde des sélections de filtres (dossiers, formats) est désormais fiable, y compris pour les sélections vides.

2.  **Frontend - Panneau Central (Vue Agrandie & Navigation) :**
    *   [COMPLETED] Double-clic sur une vignette pour l'afficher en **vue agrandie** dans le panneau central.
    *   [COMPLETED] Les images (petites ou grandes) s'adaptent désormais pour remplir tout l'espace de la vue agrandie.
    *   [COMPLETED] Le zoom (molette) se centre désormais de manière fiable sur la position du curseur.
    *   [COMPLETED] Le curseur de la souris est une main (`grab`/`grabbing`) et le comportement de "drag" natif du navigateur est désactivé.
    *   [COMPLETED] Navigation au clavier (flèches haut/bas/gauche/droite) dans la galerie.
    *   [COMPLETED] Navigation clavier étendue (PageUp/Down, Home/End) pour un défilement rapide.

3.  **Frontend - Panneau Droit (Métadonnées Complètes) :**
    *   [COMPLETED] L'API et le frontend chargent et affichent les métadonnées (prompt/workflow) depuis des fichiers externes (.txt, .json) ou internes (PNG), en indiquant la source. Le bug critique de récupération des métadonnées (dû aux valeurs `NaN` dans les JSON) a été corrigé.
    *   [COMPLETED] Le style CSS des labels de métadonnées ("Prompt:", "Workflow:") et de leur source a été corrigé.
    *   [COMPLETED] Affichage de la résolution (ex: 1024x1024) et du ratio d'aspect le plus proche (ex: 16:9) dans le panneau d'informations.

---

### Phase 3 : Actions sur les Images et Sélection Multiple

**Statut : 🟡 En cours.**

1.  **Frontend - Sélection Multiple :**
    *   [COMPLETED] Ajout d'une `checkbox` sur chaque vignette.
    *   [COMPLETED] Logique de base pour la sélection simple et Ctrl+clic.
    *   [COMPLETED] Mise à jour de la barre de statut pour afficher le nombre d'éléments sélectionnés.
    *   [COMPLETED] La sélection multiple est maintenant préservée lors d'un rafraîchissement manuel de la galerie (changement de filtre).

2.  **Backend & Frontend - Actions sur les Images :**
    *   **Boutons d'Action :**
        *   [COMPLETED] Ajout des boutons "Delete", "Restore", "Extract Metadata", "Inject Metadata" à l'interface.
        *   [COMPLETED] Logique d'activation/désactivation basique des boutons en fonction de la sélection.
    *   **Fonctionnalité "Delete" :**
        *   [COMPLETED] **Backend :**
            *   Création du dossier `output/trashcan`.
            *   Endpoint API `/holaf/images/delete` pour déplacer les fichiers (image, .txt, .json) vers `trashcan` et mettre à jour la DB (`is_trashed=1`, `original_path_canon`, `path_canon`, `subfolder`, gestion des conflits de noms dans la corbeille).
            *   `sync_image_database_blocking` ignore le dossier `trashcan`.
            *   `/holaf/images/list` filtre par défaut `is_trashed=0`.
            *   `get_filter_options_route` ignore `trashcan`.
        *   [COMPLETED] **Frontend :**
            *   Le bouton "Delete" appelle l'API.
            *   Rafraîchissement de la liste après suppression.
            *   Affichage des messages de confirmation/erreur.
    *   **Fonctionnalité "Restore" :**
        *   [COMPLETED] **Backend :** Endpoint API `/holaf/images/restore` pour déplacer les fichiers de `trashcan` vers `original_path_canon` et mettre à jour la DB. Gère les conflits. La route est enregistrée dans `__init__.py`.
        *   [COMPLETED] **Frontend :**
            *   Le bouton "Restore" appelle l'API avec confirmation.
            *   La logique d'activation du bouton est fonctionnelle.
            *   [COMPLETED] L'interaction avec le filtre "Trashcan" a été améliorée : il est maintenant visuellement séparé, sa sélection est exclusive (désactive les autres filtres de dossier), et le système mémorise l'état des filtres précédents pour les restaurer.
    *   **Amélioration des Actions sur les Images :**
        *   [COMPLETED] **Backend & Frontend :** Ajout d'un bouton "Empty" à côté du filtre "Trashcan" avec dialogue de confirmation pour supprimer définitivement tout le contenu de la corbeille. Création de la route API `/holaf/images/empty-trashcan` correspondante.
    *   **Fonctionnalité "Extract Metadata" :**
        *   [À FAIRE] **Backend :** Endpoint API `/holaf/images/extract-metadata`. Lit les métadonnées internes de l'image, les sauvegarde dans des fichiers `.txt` (prompt) et `.json` (workflow) à côté de l'image.
        *   [À FAIRE (Complexe/Optionnel)] **Backend :** Option pour effacer les métadonnées de l'image source *sans recompression* après extraction. Nécessite une bibliothèque de manipulation d'images bas niveau (ex: `exiftool` en sous-processus, ou des bibliothèques Python spécialisées comme `piexif` pour JPEG, mais plus complexe pour PNG).
        *   [À FAIRE] **Frontend :** Le bouton "Extract Metadata" appelle l'API.
    *   **Fonctionnalité "Inject Metadata" :**
        *   [À FAIRE] **Backend :** Endpoint API `/holaf/images/inject-metadata`. Lit les données des fichiers `.txt` et `.json` associés, les injecte dans les métadonnées de l'image. S'assurer que le format du workflow injecté est compatible avec ce que ComfyUI attend (généralement un champ "workflow" dans les `info` du PNG).
        *   [À FAIRE] **Frontend :** Le bouton "Inject Metadata" appelle l'API.

---

### Phase 4 : Performance et Fonctionnalités "Deluxe"

**Statut : 🟡 En cours (Implémentation de la génération optimisée des miniatures, avec bug identifié).**

1.  **Performance - Cache des Vignettes (Thumbnails) :**
    *   [COMPLETED] Le backend génère et met en cache les miniatures via l'endpoint `/holaf/images/thumbnail` (génération à la demande si absente).
    *   [COMPLETED] La génération des miniatures côté serveur (`_create_thumbnail_blocking`) a été modifiée pour que la miniature conserve son ratio d'aspect original et que sa plus petite dimension corresponde à `THUMBNAIL_SIZE`.
    *   [COMPLETED] Le backend nettoie les miniatures des images supprimées lors de la synchronisation de la base de données.
    *   [COMPLETED] Le frontend affiche maintenant une erreur détaillée et un bouton "Réessayer" si la génération d'une miniature échoue.
    *   **[EN COURS - Optimisation Avancée] Génération des miniatures en tâche de fond :**
        *   **Objectif :** Pré-générer les miniatures pour améliorer la fluidité de la navigation et réduire la charge lors de l'affichage initial.
        *   **Backend (Python - `holaf_image_viewer_utils.py`, `holaf_database.py`, `__init__.py`) :**
            *   [COMPLETED] **Base de Données (`holaf_database.py`) :** Ajout des colonnes `thumbnail_status`, `thumbnail_priority_score`, `thumbnail_last_generated_at` et des index correspondants.
            *   [COMPLETED] **Thread Worker (`__init__.py`, `holaf_image_viewer_utils.py`) :** Création et gestion (démarrage/arrêt basique) du thread `thumbnail_worker_thread`.
            *   [COMPLETED] **Logique de Sélection des Tâches par le Worker :** Implémentation d'une logique de base pour sélectionner les images à traiter en fonction de `viewer_is_active` et `thumbnail_status`/`thumbnail_priority_score`. Le worker ignore les images `is_trashed=1`.
            *   [COMPLETED] **API Endpoints (`holaf_image_viewer_utils.py`) :** Ajout de `/holaf/images/viewer-activity` et `/holaf/images/prioritize-thumbnails`.
            *   [COMPLETED] **Mise à jour `sync_image_database_blocking` :** Marque les miniatures comme obsolètes (`thumbnail_status = 0`) lors des modifications d'images.
            *   [COMPLETED] **Endpoint `/holaf/images/thumbnail` (GET existant) :** Logique modifiée pour vérifier/utiliser `thumbnail_status` et `thumbnail_last_generated_at` pour décider de la regénération. Met à jour la DB après génération.
            *   **[BUG - Possiblement résolu, à surveiller]** Erreur 500 lors du service des miniatures : Les modifications récentes sur la gestion des connexions DB pourraient avoir résolu ce problème. À confirmer par des tests.
        *   **Frontend (JavaScript - `holaf_image_viewer.js`) :**
            *   [COMPLETED] Appels à `/holaf/images/viewer-activity` dans `show()` et `hide()`.
            *   [COMPLETED] Utilisation de `IntersectionObserver` pour détecter les placeholders visibles et appel (par lots, avec debounce) à `/holaf/images/prioritize-thumbnails`.
            *   [COMPLETED] La logique de chargement d'une miniature individuelle (`loadSpecificThumbnail`) demande l'URL.

2.  **Performance - Intégration à la Base de Données :**
    *   [COMPLETED] Une table `images` a été ajoutée à la base de données partagée (SQLite) pour un chargement instantané (avec colonnes `is_trashed`, `original_path_canon`).
    *   [COMPLETED] Le filtrage (dossiers, formats, dates, corbeille) est maintenant effectué côté serveur via des requêtes SQL optimisées, éliminant les blocages du navigateur avec de grandes galeries.
    *   [COMPLETED] Un scan de synchronisation est effectué en arrière-plan au démarrage, puis périodiquement (toutes les 5 minutes via `__init__.py`) pour mettre à jour la base de données sans bloquer le serveur, en ignorant le contenu de la corbeille.
    *   [À FAIRE - Amélioration Majeure] **Surveillance des Fichiers en Temps Réel :** Remplacer le scan périodique par une surveillance du système de fichiers (ex: avec la bibliothèque `watchdog`). Cela permettra une détection instantanée des ajouts, modifications ou suppressions de fichiers faits manuellement, rendant la visionneuse d'images entièrement réactive aux changements sur le disque.

3.  **Performance - Rendu Virtualisé et Stabilité :**
    *   [COMPLETED] La galerie utilise un "infinite scroll" avec rendu par lots et chargement progressif en arrière-plan. Cela permet un affichage initial instantané et une barre de défilement fonctionnelle même avec des dizaines de milliers d'images.
    *   [COMPLETED] La position de défilement est mieux préservée lors des changements de filtres, en s'ancrant sur l'image active.

4.  **Fonctionnalité - Actualisation Automatique :**
    *   [COMPLETED] Le rafraîchissement périodique automatique a été désactivé pour éliminer tout clignotement de l'interface et donner un contrôle total à l'utilisateur sur le rechargement de la galerie.

5.  **Fonctionnalité - Mode Plein Écran & Interactivité :**
    *   [COMPLETED] Ajouter une icône "fullscreen" sur les vignettes au survol.
    *   [COMPLETED] Gérer l'affichage plein écran (overlay) via l'icône.
    *   [COMPLETED] Navigation au clavier (flèches) entre les images dans les vues agrandie et plein écran.
    *   [COMPLETED] Le zoom/panoramique en plein écran est fonctionnel et se centre désormais de manière fiable sur le curseur.
    *   [COMPLETED] Ajout de raccourcis clavier avancés : Entrée/Shift+Entrée pour naviguer entre les vues, Échap contextuel pour revenir en arrière.
    *   [COMPLETED] Double-cliquer sur une image en vue agrandie permet de passer en plein écran.
    *   [COMPLETED] **Navigation Fluide (Préchargement) :** L'image suivante est préchargée en arrière-plan lors de la navigation en vue agrandie/plein écran, et l'affichage n'est mis à jour qu'une fois l'image prête, éliminant tout scintillement.

---

### Phase 5 : Qualité de Vie et Actions sur les Métadonnées

**Statut : ✅ Complétée (pour les fonctionnalités de base du panneau d'info).**

1.  **Fonctionnalité - Actions sur le Panneau d'Info :**
    *   [COMPLETED] Ajout d'un bouton `📋 Copy Prompt` pour copier le prompt de l'image dans le presse-papiers.
    *   [COMPLETED] Ajout d'un bouton `⚡ Load Workflow` pour charger le workflow de l'image dans ComfyUI, avec une boîte de dialogue de confirmation.
    *   [COMPLETED] La logique de copie est robuste et fonctionne même dans les contextes non-sécurisés (HTTP sur IP locale).
    *   [COMPLETED] Le message de confirmation du chargement de workflow a été mis à jour pour refléter le système d'onglets de ComfyUI.
    *   [COMPLETED] Affichage de "Original Path" si l'image est dans la corbeille.

2.  **Fonctionnalité - Retour Visuel :**
    *   [COMPLETED] Ajout d'une barre de statut affichant le nombre d'images filtrées par rapport au total, et le nombre d'images sélectionnées.
    *   [COMPLETED] **Option d'affichage des vignettes :** Ajout d'un panneau "Options d'Affichage" avec une case à cocher pour basculer entre les modes "Cover" (rognées) et "Contain" (entières). Ce paramètre est sauvegardé dans la configuration.
    *   [COMPLETED] **Taille des vignettes réglable :** Ajout d'un slider pour contrôler la taille des vignettes, avec sauvegarde du paramètre.
    *   [COMPLETED] **Filtre par Date :** Ajout de champs pour filtrer les images dans une plage de dates spécifique.
    *   [COMPLETED] Les cases à cocher sur les vignettes n'apparaissent désormais qu'au survol ou si l'image est sélectionnée, pour une interface plus épurée.

3.  **Fonctionnalités à Définir :**
    *   **"Edit" :** Laisser un bouton réservé. (Probablement pour renommer ou ajouter des tags DB uniquement)
    *   **"Diaporama" :** Laisser un bouton réservé.

---

**Résumé de l'état actuel de l'Image Viewer (Phase 3 - Actions) :**

*   **Interface de Sélection Multiple :** En place (checkboxes, logique de base de sélection).
*   **Boutons d'Action :** Visibles et leur état (activé/désactivé) est géré.
*   **Action "Delete" :** Complétée.
*   **Action "Restore" :** Complétée.
*   **Action "Empty Trashcan" :** Complétée.
*   **Actions "Extract Metadata", "Inject Metadata" :** Squelettes en place côté frontend (boutons et handlers vides), backend non commencé.
*   **Filtre pour la corbeille :** Complété (intégré dynamiquement à la liste des filtres de dossier).