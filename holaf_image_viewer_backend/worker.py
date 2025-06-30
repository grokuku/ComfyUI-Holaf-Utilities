# === Holaf Utilities - Image Viewer Thumbnail Worker ===
import os
import sqlite3
import hashlib

import folder_paths # ComfyUI global

# Imports from this package's modules
from . import logic

# Imports from the parent package
from .. import holaf_database
from .. import holaf_utils


# --- Thumbnail Worker Globals ---
viewer_is_active = False # Updated by /viewer-activity endpoint

WORKER_IDLE_SLEEP_SECONDS = 5.0  # Sleep when no work is found
WORKER_POST_JOB_SLEEP_SECONDS = 0.1 # Very short sleep after completing a job


# --- Thumbnail Generation Worker ---
def run_thumbnail_generation_worker(stop_event):
    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker started.")
    output_dir = folder_paths.get_output_directory()
    batch_size_for_query = 1

    while not stop_event.is_set():
        conn_worker_db = None
        image_to_process_path_canon = None # This is the key for DB updates, should be current path_canon
        worker_exception = None
        try:
            conn_worker_db = holaf_database.get_db_connection()
            cursor = conn_worker_db.cursor()
            image_row_to_process = None

            # Worker should only process non-trashed images
            priority_query = """
                SELECT path_canon FROM images
                WHERE thumbnail_status = 1 AND is_trashed = 0
                ORDER BY thumbnail_priority_score ASC, mtime DESC
                LIMIT ?
            """
            cursor.execute(priority_query, (batch_size_for_query,))
            image_row_to_process = cursor.fetchone()

            if not image_row_to_process:
                normal_query = """
                    SELECT path_canon FROM images
                    WHERE thumbnail_status = 0 AND is_trashed = 0
                    ORDER BY mtime DESC
                    LIMIT ?
                """
                cursor.execute(normal_query, (batch_size_for_query,))
                image_row_to_process = cursor.fetchone()
            
            conn_worker_db.commit() 

            if not image_row_to_process:
                holaf_database.close_db_connection()
                conn_worker_db = None
                stop_event.wait(WORKER_IDLE_SLEEP_SECONDS)
                continue
            
            holaf_database.close_db_connection()
            conn_worker_db = None

            image_to_process_path_canon = image_row_to_process['path_canon']
            # The actual file on disk is at output_dir + path_canon (which is not in trash for worker)
            original_abs_path = os.path.normpath(os.path.join(output_dir, image_to_process_path_canon))

            if not os.path.isfile(original_abs_path):
                temp_conn_err, no_file_exception = None, None
                try:
                    temp_conn_err = holaf_database.get_db_connection()
                    temp_cursor_err = temp_conn_err.cursor()
                    # Mark using its current path_canon
                    temp_cursor_err.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_to_process_path_canon,))
                    temp_conn_err.commit()
                except Exception as e_db_no_file: no_file_exception = e_db_worker_no_file
                finally:
                    if temp_conn_err: holaf_database.close_db_connection(exception=no_file_exception)
                stop_event.wait(WORKER_POST_JOB_SLEEP_SECONDS)
                continue

            path_hash = hashlib.sha1(image_to_process_path_canon.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"
            thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

            logic._create_thumbnail_blocking(original_abs_path, thumb_path_abs, image_path_canon_for_db_update=image_to_process_path_canon)
            stop_event.wait(WORKER_POST_JOB_SLEEP_SECONDS)

        except sqlite3.Error as e_sql:
            worker_exception = e_sql
            print(f"🔴 [Holaf-ImageViewer-Worker] SQLite error (processing '{image_to_process_path_canon}'): {e_sql}")
            stop_event.wait(30.0)
        except Exception as e_main:
            worker_exception = e_main
            print(f"🔴 [Holaf-ImageViewer-Worker] General error (processing '{image_to_process_path_canon}'): {e_main}")
            stop_event.wait(30.0)
        finally:
            if conn_worker_db:
                holaf_database.close_db_connection(exception=worker_exception)
            image_to_process_path_canon = None

    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker stopped.")