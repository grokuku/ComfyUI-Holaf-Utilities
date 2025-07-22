# === Holaf Utilities - Image Viewer Background Workers ===
import os
import sqlite3
import hashlib
import time
import queue
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import traceback

import folder_paths # ComfyUI global

# Imports from this package's modules
from . import logic
from .logic import SUPPORTED_IMAGE_FORMATS, TRASHCAN_DIR_NAME

# Imports from the parent package
from .. import holaf_database
from .. import holaf_utils


# --- Filesystem Watcher Globals ---
FILESYSTEM_EVENT_QUEUE = queue.Queue()
WATCHER_PROCESS_INTERVAL_SECONDS = 3.0 # How often to process the queue
WATCHER_TEMP_FILE_PATTERNS = ['_temp_', '.tmp']

# --- Thumbnail Worker Globals ---
viewer_is_active = False # Updated by /viewer-activity endpoint
WORKER_IDLE_SLEEP_SECONDS = 5.0  # Sleep when no work is found
WORKER_POST_JOB_SLEEP_SECONDS = 0.1 # Very short sleep after completing a job


# --- Filesystem Watcher Implementation ---

class HolafFileSystemEventHandler(FileSystemEventHandler):
    """Handles file system events and puts them into a queue for processing."""
    def __init__(self, output_dir):
        super().__init__()
        self.output_dir_norm = os.path.normpath(output_dir)
        self.trashcan_path_norm = os.path.normpath(os.path.join(output_dir, TRASHCAN_DIR_NAME))

    def _is_valid_file(self, src_path):
        """Helper to validate if a file event should be processed."""
        try:
            # Basic checks that don't require filesystem access first
            filename = os.path.basename(src_path)
            if any(p in filename for p in WATCHER_TEMP_FILE_PATTERNS): return False
            
            _, file_ext = os.path.splitext(filename)
            if file_ext.lower() not in SUPPORTED_IMAGE_FORMATS: return False
            
            # Filesystem checks
            if not os.path.isfile(src_path): return False
            
            if os.path.normpath(src_path).startswith(self.trashcan_path_norm): return False
        except FileNotFoundError:
             return False # File disappeared before we could check it
        except Exception:
             return False
             
        return True

    def on_created(self, event):
        if not event.is_directory and self._is_valid_file(event.src_path):
            print(f"🔵 [Holaf-Watcher-Event] Detected creation: {event.src_path}")
            FILESYSTEM_EVENT_QUEUE.put(('created', event.src_path))

    def on_deleted(self, event):
        if not event.is_directory:
            filename = os.path.basename(event.src_path)
            _, file_ext = os.path.splitext(filename)
            if any(p in filename for p in WATCHER_TEMP_FILE_PATTERNS) or file_ext.lower() not in SUPPORTED_IMAGE_FORMATS:
                 return
            if os.path.normpath(event.src_path).startswith(self.trashcan_path_norm):
                 return
            print(f"🔵 [Holaf-Watcher-Event] Detected deletion: {event.src_path}")
            FILESYSTEM_EVENT_QUEUE.put(('deleted', event.src_path))

    def on_moved(self, event):
        if not event.is_directory:
            print(f"🔵 [Holaf-Watcher-Event] Detected move: {event.src_path} -> {event.dest_path}")
            # The source of a move is a deletion event
            self.on_deleted(type('CustomEvent', (object,), {'is_directory': event.is_directory, 'src_path': event.src_path}))
            # The destination of a move is a creation event
            self.on_created(type('CustomEvent', (object,), {'is_directory': event.is_directory, 'src_path': event.dest_path}))

def run_event_queue_processor(stop_event):
    """Worker that processes file events from the queue in batches."""
    print("🔵 [Holaf-ImageViewer-Worker] Event queue processor started.")

    while not stop_event.is_set():
        try:
            if stop_event.wait(WATCHER_PROCESS_INTERVAL_SECONDS): break
            if FILESYSTEM_EVENT_QUEUE.empty(): continue

            print(f"🔵 [Holaf-Watcher-Processor] Queue has items, starting processing...")
            files_to_add = set()
            files_to_delete = set()
            
            while not FILESYSTEM_EVENT_QUEUE.empty():
                try:
                    event_type, path = FILESYSTEM_EVENT_QUEUE.get_nowait()
                    if event_type == 'created': files_to_add.add(path)
                    elif event_type == 'deleted': files_to_delete.add(path)
                except queue.Empty: break
            
            # Handle cases where a file is deleted and re-created in the same batch (e.g., "Save Over").
            # The final state should be "added/updated", so we remove the path from the deletion set
            # but KEEP it in the addition set.
            conflicts = files_to_add.intersection(files_to_delete)
            if conflicts:
                print(f"🟡 [Holaf-Watcher-Processor] Re-created files detected, prioritizing add/update for {len(conflicts)} path(s).")
                files_to_delete -= conflicts

            if files_to_add:
                print(f"🔵 [Holaf-Watcher-Processor] Processing {len(files_to_add)} additions...")
                for path in files_to_add:
                    if stop_event.is_set(): break
                    logic.add_or_update_single_image(path)
            
            if files_to_delete:
                print(f"🔵 [Holaf-Watcher-Processor] Processing {len(files_to_delete)} deletions...")
                for path in files_to_delete:
                    if stop_event.is_set(): break
                    logic.delete_single_image_by_path(path)
            
            print("✅ [Holaf-Watcher-Processor] Processing batch complete.")

        except Exception as e:
            print(f"🔴 [Holaf-ImageViewer-Worker] Error in event queue processor: {e}")
            traceback.print_exc()
            stop_event.wait(20)

    print("🔵 [Holaf-ImageViewer-Worker] Event queue processor stopped.")


def run_filesystem_monitor(stop_event):
    """Worker that watches the filesystem for changes."""
    print("🔵 [Holaf-ImageViewer-Worker] Filesystem monitor started.")
    
    observer = None
    try:
        output_dir = folder_paths.get_output_directory()
        print(f"  -> Monitoring directory: {output_dir}")
        event_handler = HolafFileSystemEventHandler(output_dir)
        observer = Observer()
        observer.schedule(event_handler, output_dir, recursive=True)
        observer.start()
        
        while not stop_event.is_set():
            stop_event.wait(1)
    except Exception as e:
         print(f"🔴 [Holaf-ImageViewer-Worker] Filesystem monitor encountered a fatal error: {e}")
         traceback.print_exc()
    finally:
        if observer and observer.is_alive():
            observer.stop()
            observer.join()

    print("🔵 [Holaf-ImageViewer-Worker] Filesystem monitor stopped.")


# --- Thumbnail Generation Worker (Unchanged) ---
def run_thumbnail_generation_worker(stop_event):
    # ... (code inchangé ici)
    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker started.")
    output_dir = folder_paths.get_output_directory()
    batch_size_for_query = 1

    while not stop_event.is_set():
        conn_worker_db = None
        image_to_process_path_canon = None
        worker_exception = None
        try:
            conn_worker_db = holaf_database.get_db_connection()
            cursor = conn_worker_db.cursor()
            image_row_to_process = None

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
            original_abs_path = os.path.normpath(os.path.join(output_dir, image_to_process_path_canon))

            if not os.path.isfile(original_abs_path):
                temp_conn_err, no_file_exception = None, None
                try:
                    temp_conn_err = holaf_database.get_db_connection()
                    temp_cursor_err = temp_conn_err.cursor()
                    temp_cursor_err.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (image_to_process_path_canon,))
                    temp_conn_err.commit()
                except Exception as e_db_no_file: no_file_exception = e_db_no_file
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
            traceback.print_exc()
            stop_event.wait(30.0)
        finally:
            if conn_worker_db:
                holaf_database.close_db_connection(exception=worker_exception)
            image_to_process_path_canon = None

    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker stopped.")