// js/image_viewer/image_viewer_state.js

/**
 * Classe de gestion d'état centralisée pour l'Image Viewer.
 * Utilise un modèle simple de publication/abonnement (pub/sub).
 */
class ImageViewerState {
    constructor() {
        this.state = {
            // Données principales
            images: [],
            selectedImages: new Set(),
            activeImage: null,
            currentNavIndex: -1,

            // État des filtres aligné sur la nouvelle API backend
            filters: {
                folder_filters: [],
                format_filters: [],
                startDate: '',
                endDate: '',
                filename_search: '',
                prompt_search: '',
                workflow_search: '',
                tags_filter: [],
                bool_filters: {
                    has_workflow: null, // null: indifférent, true: oui, false: non
                    has_prompt: null,
                    has_edits: null,
                    has_tags: null,
                },
                locked_folders: [], // État de l'UI, non envoyé au backend
            },

            // État de l'interface et des préférences
            ui: {
                theme: "Graphite Orange",
                thumbnail_fit: 'cover',
                thumbnail_size: 150,
                export_format: 'png',
                export_include_meta: true,
                export_meta_method: 'embed',
                view_mode: 'gallery',
            },
            
            // Statut de l'application
            status: {
                isLoading: false,
                isExporting: false,
                lastDbUpdateTime: 0,
                error: null,
                totalImageCount: 0,
                filteredImageCount: 0,
                allThumbnailsGenerated: false,
                generatedThumbnailsCount: 0,
            },

            // État spécifique à l'exportation (processus en cours)
            exporting: {
                queue: [],
                stats: {
                    totalFiles: 0,
                    completedFiles: 0,
                    currentFileName: '',
                    currentFileProgress: 0,
                },
                activeToastId: null,
            },

            // Propriétés du panneau (gérées par HolafPanelManager, stockées ici pour la sauvegarde)
            panel_x: null,
            panel_y: null,
            panel_width: 1200,
            panel_height: 800,
            panel_is_fullscreen: false,
        };

        this.listeners = new Set();
    }

    /**
     * Permet aux composants de s'abonner aux changements d'état.
     * @param {function} listener - La fonction à appeler lors d'un changement.
     * @returns {function} Une fonction pour se désabonner.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Notifie tous les abonnés d'un changement d'état.
     * @private
     */
    _notify() {
        // La création de l'instantané est maintenant déléguée à getState() pour la robustesse.
        const stateSnapshot = this.getState(); 
        for (const listener of this.listeners) {
            listener(stateSnapshot);
        }
    }

    /**
     * Met à jour l'état de manière fusionnée et notifie les abonnés.
     * @param {object} partialState - Un objet contenant les clés/valeurs à mettre à jour.
     */
    setState(partialState) {
        for (const key in partialState) {
            if (Object.prototype.hasOwnProperty.call(partialState, key)) {
                // Fusionne les objets imbriqués au lieu de les remplacer
                if (typeof partialState[key] === 'object' && partialState[key] !== null && !Array.isArray(partialState[key]) && !(partialState[key] instanceof Set) && this.state[key]) {
                    this.state[key] = { ...this.state[key], ...partialState[key] };
                } else {
                    this.state[key] = partialState[key];
                }
            }
        }
        
        console.log("Image Viewer State Updated:", partialState);
        this._notify();
    }

    /**
     * Retourne une copie profonde et fiable de l'état actuel.
     * Remplace l'implémentation JSON.stringify qui n'est pas fiable pour les Sets vides.
     * @returns {object} L'état actuel.
     */
    getState() {
        const state = this.state;
        const stateCopy = {
            // Copie de toutes les propriétés de premier niveau
            ...state,
            
            // Création de nouvelles copies pour les objets et tableaux imbriqués
            images: [...state.images],
            filters: { 
                ...state.filters,
                bool_filters: { ...state.filters.bool_filters } // Copie profonde pour l'objet imbriqué
            },
            ui: { ...state.ui },
            status: { ...state.status },
            exporting: {
                ...state.exporting,
                queue: [...state.exporting.queue],
                stats: { ...state.exporting.stats }
            },

            // Conversion explicite et fiable du Set en Array
            selectedImages: Array.from(state.selectedImages)
        };
        return stateCopy;
    }
}

// Exporter une instance unique (Singleton) pour toute l'application
export const imageViewerState = new ImageViewerState();