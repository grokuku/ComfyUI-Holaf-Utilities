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
    *   [COMPLETED] Une barre d'outils avec un bouton "Refresh" a été ajoutée. *(Note : Ce bouton sera supprimé au profit d'une actualisation automatique dans une phase ultérieure).*

3.  **Frontend - Affichage des Vignettes :**
    *   [COMPLETED] La galerie s'affiche correctement, en utilisant un endpoint dédié pour les miniatures.
    *   [COMPLETED] Un bug de rendu majeur (superposition des vignettes) a été corrigé en changeant le moteur de layout de la galerie (passage de Grid à Flexbox).
    *   [COMPLETED] La galerie est virtualisée (`IntersectionObserver`) pour gérer des milliers d'images sans "freeze".

4.  **Frontend - Interaction de Base :**
    *   [COMPLETED] Un clic simple sur une vignette la désigne comme "active" et affiche ses informations de base dans le panneau de droite.

---

### Phase 2 : Interactivité Avancée et Filtres

**Statut : 🟢 En cours.**

1.  **Frontend - Panneau Gauche (Filtres) :**
    *   [COMPLETED] Les listes de dossiers (y compris `root`) et de formats sont générées dynamiquement.
    *   [COMPLETED] Les filtres sont fonctionnels et mettent à jour la galerie en temps réel.

2.  **Frontend - Panneau Central (Vue Agrandie & Navigation) :**
    *   [COMPLETED] Double-clic sur une vignette pour l'afficher en **vue agrandie** dans le panneau central.
    *   [PENDING] Ajouter une icône 'plein écran' dans cette vue agrandie.
    *   [PENDING] Implémenter le zoom (molette de la souris) et le panoramique (clic-gauche maintenu) dans la vue agrandie.
    *   [PENDING] Navigation au clavier (flèches) dans la galerie.

3.  **Frontend - Panneau Droit (Métadonnées Complètes) :**
    *   [COMPLETED] L'API et le frontend chargent et affichent les métadonnées (prompt/workflow) depuis des fichiers externes (.txt, .json) ou internes (PNG), en indiquant la source.
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

**Statut : 🟢 En cours / Largement complétée.**

1.  **Performance - Cache des Vignettes (Thumbnails) :**
    *   [COMPLETED] Le backend génère et met en cache les miniatures via l'endpoint `/holaf/images/thumbnail`.
    *   [COMPLETED] Le backend nettoie les miniatures des images supprimées lors de la synchronisation de la base de données.

2.  **Performance - Intégration à la Base de Données :**
    *   [COMPLETED] Une table `images` a été ajoutée à la base de données partagée (SQLite) pour un chargement instantané.
    *   [COMPLETED] Un scan de synchronisation est effectué en arrière-plan au démarrage pour mettre à jour la base de données.

3.  **Fonctionnalité - Actualisation Automatique :**
    *   [PENDING] Remplacer le bouton "Refresh" par une synchronisation automatique (par ex. via WebSocket ou polling intelligent) pour mettre à jour la galerie dynamiquement lorsque des fichiers sont ajoutés ou supprimés dans le dossier `output`.

4.  **Fonctionnalité - Mode Plein Écran & Interactivité :**
    *   [COMPLETED] Ajouter une icône "fullscreen" sur les vignettes au survol.
    *   [COMPLETED] Gérer l'affichage plein écran (overlay) via l'icône.
    *   [PENDING] Implémenter le zoom (molette de la souris) et le panoramique (clic-gauche maintenu) également dans la vue plein écran.
    *   [PENDING] Navigation au clavier (flèches) entre les images dans les vues agrandie et plein écran.

5.  **Fonctionnalités à Définir :**
    *   **"Edit" :** Laisser un bouton réservé.
    *   **"Diaporama" :** Laisser un bouton réservé.