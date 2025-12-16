# === Holaf Utilities - Image Viewer Backend Submodule ===

# Expose the core functionalities and route handlers from sibling modules.
# This allows the main __init__.py to import them from this package.

from .logic import (
    sync_image_database_blocking
)

# Import route handlers from the new refactored structure
from .routes.image_routes import (
    get_filter_options_route,
    list_images_route
)
from .routes.file_ops_routes import (
    delete_images_route,
    restore_images_route,
    delete_images_permanently_route,
    empty_trashcan_route
)
from .routes.metadata_routes import (
    get_metadata_route,
    extract_metadata_route,
    inject_metadata_route
)
from .routes.thumbnail_routes import (
    get_thumbnail_route,
    prioritize_thumbnails_route,
    regenerate_thumbnail_route, # <-- MODIFICATION: Ajout de la nouvelle route
    get_thumbnail_stats_route as iv_get_thumbnail_stats_route # Alias to avoid name collision
)
from .routes.export_routes import (
    prepare_export_route,
    download_export_chunk_route
)
from .routes.edit_routes import (
    load_edits_route,
    save_edits_route,
    delete_edits_route,
    process_video_route,  # <-- NEW: Added
    rollback_video_route  # <-- NEW: Added
)
from .routes.utility_routes import (
    set_viewer_activity_route,
    sync_database_route,
    clean_thumbnails_route
)


from .worker import (
    run_thumbnail_generation_worker
)

# You can define an __all__ if you want to be explicit about what is exported
__all__ = [
    'sync_image_database_blocking',
    
    # Image Listing
    'get_filter_options_route',
    'list_images_route',
    
    # File Operations
    'delete_images_route',
    'delete_images_permanently_route',
    'restore_images_route',
    'empty_trashcan_route',

    # Metadata
    'get_metadata_route',
    'extract_metadata_route',
    'inject_metadata_route',
    
    # Thumbnails
    'get_thumbnail_route',
    'prioritize_thumbnails_route',
    'regenerate_thumbnail_route', 
    'iv_get_thumbnail_stats_route',

    # Export
    'prepare_export_route',
    'download_export_chunk_route',

    # Image Editing
    'load_edits_route',
    'save_edits_route',
    'delete_edits_route',
    'process_video_route', # <-- NEW: Added
    'rollback_video_route', # <-- NEW: Added

    # Utility
    'set_viewer_activity_route',
    'sync_database_route',
    'clean_thumbnails_route',

    # Worker
    'run_thumbnail_generation_worker'
]