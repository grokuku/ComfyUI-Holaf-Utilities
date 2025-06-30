# === Holaf Utilities - Image Viewer Backend Submodule ===

# Expose the core functionalities and route handlers from sibling modules.
# This allows the main __init__.py to import them from this package.

from .logic import (
    sync_image_database_blocking
)

from .routes import (
    get_filter_options_route,
    list_images_route,
    get_thumbnail_route,
    get_metadata_route,
    delete_images_route,
    delete_images_permanently_route,
    restore_images_route,
    empty_trashcan_route,
    extract_metadata_route,
    inject_metadata_route,
    prepare_export_route,
    download_export_chunk_route,
    set_viewer_activity_route,
    prioritize_thumbnails_route,
    get_thumbnail_stats_route as iv_get_thumbnail_stats_route # Alias to avoid name collision
)

from .worker import (
    run_thumbnail_generation_worker
)

# You can define an __all__ if you want to be explicit about what is exported
__all__ = [
    'sync_image_database_blocking',
    'get_filter_options_route',
    'list_images_route',
    'get_thumbnail_route',
    'get_metadata_route',
    'delete_images_route',
    'delete_images_permanently_route',
    'restore_images_route',
    'empty_trashcan_route',
    'extract_metadata_route',
    'inject_metadata_route',
    'prepare_export_route',
    'download_export_chunk_route',
    'set_viewer_activity_route',
    'prioritize_thumbnails_route',
    'iv_get_thumbnail_stats_route',
    'run_thumbnail_generation_worker'
]