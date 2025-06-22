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

**Statut : ✅ Complétée et Stabilisée.**

1.  **Frontend - Panneau Gauche (Filtres) :**
    *   [COMPLETED] Les listes de dossiers sont générées dynamiquement, en groupant les sous-dossiers sous leur parent de premier niveau.
    *   [COMPLETED] Les filtres par dossier sont récursifs : cocher un dossier affiche les images de tous ses sous-dossiers.
    *   [COMPLETED] Une checkbox "Select All" a été ajoutée pour gérer tous les filtres de dossiers d'un coup.
    *   [COMPLETED] La liste des formats est générée dynamiquement et les filtres sont fonctionnels.

2.  **Frontend - Panneau Central (Vue Agrandie & Navigation) :**
    *   [COMPLETED] Double-clic sur une vignette pour l'afficher en **vue agrandie** dans le panneau central.
    *   [COMPLETED] Les images (petites ou grandes) s'adaptent désormais pour remplir tout l'espace de la vue agrandie.
    *   [COMPLETED] Le zoom (molette) se centre désormais de manière fiable sur la position du curseur.
    *   [COMPLETED] Le curseur de la souris est une main (`grab`/`grabbing`) et le comportement de "drag" natif du navigateur est désactivé.
    *   [COMPLETED] Navigation au clavier (flèches haut/bas/gauche/droite) dans la galerie.

3.  **Frontend - Panneau Droit (Métadonnées Complètes) :**
    *   [COMPLETED] L'API et le frontend chargent et affichent les métadonnées (prompt/workflow) depuis des fichiers externes (.txt, .json) ou internes (PNG), en indiquant la source. Le bug critique de récupération des métadonnées (dû aux valeurs `NaN` dans les JSON) a été corrigé.
    *   [COMPLETED] Le style CSS des labels de métadonnées ("Prompt:", "Workflow:") et de leur source a été corrigé.

---

### Phase 3 : Actions sur les Images et Sélection Multiple

**Statut : 🔴 Non commencée.**

1.  **Frontend - Sélection Multiple :**
    *   Ajouter une `checkbox` sur chaque vignette.
    *   Activer/désactiver les boutons d'action en fonction de la sélection.

2.  **Backend & Frontend - Barre d'outils :**
    *   **Bouton "Delete" :** Créer l'API et la logique front-end pour la suppression.
    *   **Bouton "Convert" :** Créer l'API et la logique front-end pour la conversion.
    *   **Bouton "Remove Metadata" :** Créer l'API et la logique front-end.

---

### Phase 4 : Performance et Fonctionnalités "Deluxe"

**Statut : ✅ Complétée et Stabilisée.**

1.  **Performance - Cache des Vignettes (Thumbnails) :**
    *   [COMPLETED] Le backend génère et met en cache les miniatures via l'endpoint `/holaf/images/thumbnail`.
    *   [COMPLETED] Le backend nettoie les miniatures des images supprimées lors de la synchronisation de la base de données.
    *   [COMPLETED] Le frontend affiche maintenant une erreur détaillée et un bouton "Réessayer" si la génération d'une miniature échoue.

2.  **Performance - Intégration à la Base de Données :**
    *   [COMPLETED] Une table `images` a été ajoutée à la base de données partagée (SQLite) pour un chargement instantané.
    *   [COMPLETED] Un scan de synchronisation est effectué en arrière-plan au démarrage, puis périodiquement (toutes les 60 secondes) pour mettre à jour la base de données sans bloquer le serveur.

3.  **Fonctionnalité - Actualisation Automatique :**
    *   [COMPLETED] Le bouton "Refresh" a été remplacé par une synchronisation automatique performante. Le frontend interroge le backend toutes les 15 secondes, et le backend met à jour sa propre base de données toutes les 60 secondes, de manière non-bloquante.

4.  **Fonctionnalité - Mode Plein Écran & Interactivité :**
    *   [COMPLETED] Ajouter une icône "fullscreen" sur les vignettes au survol.
    *   [COMPLETED] Gérer l'affichage plein écran (overlay) via l'icône.
    *   [COMPLETED] Les images (petites ou grandes) s'adaptent désormais pour remplir l'espace de la vue plein écran.
    *   [COMPLETED] Navigation au clavier (flèches) entre les images dans les vues agrandie et plein écran.
    *   [COMPLETED] Le zoom/panoramique en plein écran est fonctionnel et se centre désormais de manière fiable sur le curseur.
    *   [COMPLETED] Ajout de raccourcis clavier avancés : Entrée/Shift+Entrée pour naviguer entre les vues, Échap contextuel pour revenir en arrière.
    *   [COMPLETED] La vue plein écran est désormais sans bordure et les boutons de contrôle sont toujours cliquables (correction du z-index).

---

### Phase 5 : Qualité de Vie et Actions sur les Métadonnées

**Statut : ✅ Complétée.**

1.  **Fonctionnalité - Actions sur le Panneau d'Info :**
    *   [COMPLETED] Ajout d'un bouton `📋 Copy Prompt` pour copier le prompt de l'image dans le presse-papiers.
    *   [COMPLETED] Ajout d'un bouton `⚡ Load Workflow` pour charger le workflow de l'image dans ComfyUI, avec une boîte de dialogue de confirmation.
    *   [COMPLETED] La logique de copie est robuste et fonctionne même dans les contextes non-sécurisés (HTTP sur IP locale).
    *   [COMPLETED] Le message de confirmation du chargement de workflow a été mis à jour pour refléter le système d'onglets de ComfyUI.

2.  **Fonctionnalités à Définir :**
    *   **"Edit" :** Laisser un bouton réservé.
    *   **"Diaporama" :** Laisser un bouton réservé.