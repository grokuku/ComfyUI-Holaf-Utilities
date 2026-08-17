# === Holaf Utilities - Image Viewer Background Workers ===
import os
import sqlite3
import hashlib
import time
import queue
import json
import traceback
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import errno

import folder_paths # ComfyUI global

# thumbnail_status values:
#   0 = pending (not yet generated)
#   1 = priority (visible in viewport, queued for generation)
#   2 = complete (generated successfully)
#   3 = permanent failure (unidentified image, file not found, decompression bomb, etc.)
#
# thumbnail_priority_score lower = higher priority. Used for ordering within status 0/1.
# Score 9999 is reserved for permanent failures (status 3) to deprioritize them.

# Imports from this package's modules
from . import logic
from .logic import SUPPORTED_IMAGE_FORMATS, TRASHCAN_DIR_NAME, EDIT_DIR_NAME

# Imports from the parent package
from .. import holaf_database
from .. import holaf_utils


# --- Filesystem Watcher Globals ---
FILESYSTEM_EVENT_QUEUE = queue.Queue()
WATCHER_PROCESS_INTERVAL_SECONDS = 3.0 # How often to process the queue
WATCHER_TEMP_FILE_PATTERNS = ['_temp_', '.tmp']

# Custom scandir-based poller (fallback when inotify is unavailable).
# 2.0-3.0s per spec: fast enough for near-real-time adds/deletes, cheap enough
# that the name-only idle walk of a ~32k file tree stays light.
CUSTOM_SCAN_INTERVAL_SECONDS = 2.5
CUSTOM_SCAN_ERROR_RETRY_SECONDS = 5.0 # Backoff after a failed scan pass

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

    def on_modified(self, event):
        # In-place content updates: ComfyUI may write directly to the final
        # filename instead of temp+rename, so the first 'created' event can fire
        # while the file is still being written (partial content, metadata
        # extraction aborts). Re-processing on modify self-heals: the batch
        # processor dedupes repeated events for the same path.
        if not event.is_directory and self._is_valid_file(event.src_path):
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


def _iter_supported_image_files(root_dir, stop_event):
    """Yield (normalized_abs_path, DirEntry) for every supported image file under root_dir.

    Uses os.scandir (cheap readdir names + d_type) instead of os.stat-based listings.
    Applies the same rules as HolafFileSystemEventHandler._is_valid_file:
    - skips the trashcan dir and any 'edit' folder
    - skips files matching WATCHER_TEMP_FILE_PATTERNS
    - skips non-supported extensions (SUPPORTED_IMAGE_FORMATS)
    A single unreadable entry or directory never kills the whole scan.
    """
    try:
        with os.scandir(root_dir) as it:
            for entry in it:
                if stop_event.is_set():
                    return
                try:
                    name = entry.name
                    if entry.is_dir(follow_symlinks=False):
                        # Prune reserved folders entirely (trashcan + edit dirs)
                        if name == TRASHCAN_DIR_NAME or name == EDIT_DIR_NAME:
                            continue
                        yield from _iter_supported_image_files(entry.path, stop_event)
                    elif entry.is_file(follow_symlinks=False):
                        if any(p in name for p in WATCHER_TEMP_FILE_PATTERNS):
                            continue
                        _, ext = os.path.splitext(name)
                        if ext.lower() not in SUPPORTED_IMAGE_FORMATS:
                            continue
                        yield os.path.normpath(entry.path), entry
                except OSError:
                    continue
                except Exception:
                    continue
    except (OSError, PermissionError):
        return


def run_custom_fs_poller(stop_event):
    """Custom lightweight scandir-based filesystem poller (inotify fallback).

    Replaces watchdog's PollingObserver, which is unusable on trees with ~32k
    images on slow Docker filesystems: its full-tree DirectorySnapshot (walk +
    stat every file) never completes fast enough to produce diffs, so it never
    emits events.

    This poller keeps an in-memory name cache of supported image files and each
    tick walks the tree with os.scandir (cheap readdir names + d_type):
      - not in cache            -> 'created' event + record (mtime, size)
      - in cache, name present  -> skipped WITHOUT re-stat (name-only compare)
      - cached but gone on disk -> 'deleted' event + removed from cache
    The common idle tick is therefore pure name listing with NO per-file stat;
    only NEW files incur a single os.stat to seed the cache. In-place content
    updates (same filename, new content) are intentionally NOT re-stat'ed here
    (that would defeat the whole point on a 32k-file tree); they are covered by
    the periodic 30s sync safety net (sync_image_database_blocking), which does
    the expensive full-tree stat comparison.

    The cache is warmed lazily on the FIRST scan: everything found is treated as
    baseline (populated WITHOUT emitting events), so the poller never re-adds all
    existing images on startup.
    """
    output_dir = folder_paths.get_output_directory()
    output_dir_norm = os.path.normpath(output_dir)
    cache = {}  # normalized abs path -> (mtime, size)
    pending_verify = {}  # new files seen once, awaiting size-stability confirmation
    baseline_done = False

    print("🔵 [Holaf-Watcher-Event] Custom scanner starting...")

    while not stop_event.is_set():
        try:
            seen = set()
            for full_path, entry in _iter_supported_image_files(output_dir_norm, stop_event):
                seen.add(full_path)
                if full_path in cache:
                    # Already tracked and the name is unchanged -> skip (no stat).
                    # Content updates are handled by the periodic sync safety net.
                    continue

                # New file: stat once and keep it in pending_verify until its
                # (mtime, size) is stable across two ticks. A file is often seen
                # MID-WRITE (ComfyUI may write directly to the final name); if we
                # emitted 'created' immediately, the add would fail on partial
                # content and the name would stay stuck in cache until the sync.
                stat_tuple = None
                try:
                    st = entry.stat(follow_symlinks=False)
                    stat_tuple = (st.st_mtime, st.st_size)
                except OSError:
                    try:
                        st = os.stat(full_path)
                        stat_tuple = (st.st_mtime, st.st_size)
                    except OSError:
                        continue  # raced with a delete; resolved on the next tick

                if not baseline_done:
                    # First scan: warm the baseline cache with every existing file
                    # WITHOUT emitting events. This must happen here (not via
                    # pending_verify), otherwise the next tick would treat all
                    # existing files as newly created and replay them as 'created'.
                    cache[full_path] = stat_tuple
                    continue

                if full_path in pending_verify and pending_verify[full_path] == stat_tuple:
                    # Stable across two ticks -> fully written, safe to index.
                    cache[full_path] = stat_tuple
                    del pending_verify[full_path]
                    print(f"🔵 [Holaf-Watcher-Event] Detected creation: {full_path}")
                    FILESYSTEM_EVENT_QUEUE.put(('created', full_path))
                else:
                    pending_verify[full_path] = stat_tuple

            # Detect deletions: cached files no longer present on disk
            for cached_path in list(cache.keys()):
                if cached_path not in seen:
                    cache.pop(cached_path, None)
                    if baseline_done:
                        print(f"🔵 [Holaf-Watcher-Event] Detected deletion: {cached_path}")
                        FILESYSTEM_EVENT_QUEUE.put(('deleted', cached_path))

            # Clean up pending verification for files that vanished mid-write
            for pending_path in list(pending_verify.keys()):
                if pending_path not in seen:
                    pending_verify.pop(pending_path, None)

            if not baseline_done:
                baseline_done = True
                print(f"🔵 [Holaf-Watcher-Event] Custom scanner active ({len(cache)} files tracked).")

        except Exception as e:
            print(f"🔴 [Holaf-Watcher-Event] Custom scanner error: {e}")
            traceback.print_exc()
            if stop_event.wait(CUSTOM_SCAN_ERROR_RETRY_SECONDS):
                break
            continue

        if stop_event.wait(CUSTOM_SCAN_INTERVAL_SECONDS):
            break

    print("🔵 [Holaf-Watcher-Event] Custom scanner stopped.")


def run_filesystem_monitor(stop_event):
    """Worker that watches the filesystem for changes.
    Tries inotify first (fast, low CPU); falls back to the custom scandir-based
    poller (run_custom_fs_poller) if the inotify watch/instance limit is reached
    (ENOSPC/EMFILE on Docker containers with tens of thousands of images).
    Auto-restarts on fatal errors to avoid silent death of the watcher."""
    print("🔵 [Holaf-ImageViewer-Worker] Filesystem monitor started.")
    inotify_failed = False  # Remember inotify failure across restarts
    custom_poller_thread = None  # Ref to the active custom poller thread (no duplicates)

    def _start_custom_poller():
        nonlocal custom_poller_thread
        if custom_poller_thread is not None and custom_poller_thread.is_alive():
            return  # Already running; never spawn a duplicate poller thread
        custom_poller_thread = threading.Thread(
            target=run_custom_fs_poller, args=(stop_event,),
            daemon=True, name="HolafFsCustomPoller"
        )
        custom_poller_thread.start()
        print("  -> Using custom scandir poller backend (no watch limit, name-diff based).")

    while not stop_event.is_set():
        observer = None
        try:
            output_dir = folder_paths.get_output_directory()
            event_handler = HolafFileSystemEventHandler(output_dir)
            
            # Try inotify first (fast, low CPU), unless it previously failed
            if not inotify_failed:
                try:
                    observer = Observer()
                    observer.schedule(event_handler, output_dir, recursive=True)
                    observer.start()
                    print("  -> Using inotify backend.")
                except OSError as e:
                    if e.errno in (errno.ENOSPC, errno.EMFILE):
                        inotify_failed = True
                        print(f"  -> inotify limit reached ({e}). Falling back to custom scandir poller.")
                        _start_custom_poller()
                    else:
                        raise
            else:
                # Skip inotify entirely on restarts after a known failure
                _start_custom_poller()
            
            # Main loop: just wait until stop_event is set
            while not stop_event.is_set():
                stop_event.wait(1)
                
        except Exception as e:
            if stop_event.is_set():
                break
            print(f"🔴 [Holaf-ImageViewer-Worker] Filesystem monitor error: {e}")
            traceback.print_exc()
            print("🟡 [Holaf-ImageViewer-Worker] Restarting filesystem monitor in 10 seconds...")
            if stop_event.wait(10):
                break
        finally:
            if observer and observer.is_alive():
                observer.stop()
                observer.join()
            # The custom poller thread is independent of the inotify Observer: it
            # keeps running across monitor restarts, and _start_custom_poller()
            # guards against duplicates via is_alive(). It exits on the shared
            # stop_event during real shutdown (joined below).

    # Wait briefly for the custom poller to observe stop_event and exit
    if custom_poller_thread is not None and custom_poller_thread.is_alive():
        custom_poller_thread.join(timeout=5.0)

    print("🔵 [Holaf-ImageViewer-Worker] Filesystem monitor stopped.")


# --- Thumbnail Generation Worker ---
def run_thumbnail_generation_worker(stop_event):
    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker started.")
    output_dir = folder_paths.get_output_directory()
    batch_size_for_query = 1
    conn_worker_db = None  # Persistent connection across idle cycles

    while not stop_event.is_set():
        image_to_process_path_canon = None
        worker_exception = None
        try:
            # Reuse connection if still open, otherwise create one
            if not conn_worker_db:
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
                # No work: keep connection open, just sleep
                stop_event.wait(WORKER_IDLE_SLEEP_SECONDS)
                continue

            # Work found: close connection before processing (thumbnail generation is CPU-bound)
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

            # --- FEATURE: Load .edt file if exists (checks both NEW and LEGACY locations) ---
            edit_data = None
            try:
                directory, filename = os.path.split(original_abs_path)
                base_filename, _ = os.path.splitext(filename)
                
                # FIX: Check NEW location first (edit/ subfolder), then fall back to legacy sibling
                edit_file_new = os.path.join(directory, EDIT_DIR_NAME, f"{base_filename}.edt")
                edit_file_legacy = os.path.join(directory, f"{base_filename}.edt")
                
                edit_file_path = None
                if os.path.isfile(edit_file_new):
                    edit_file_path = edit_file_new
                elif os.path.isfile(edit_file_legacy):
                    edit_file_path = edit_file_legacy
                
                if edit_file_path:
                    with open(edit_file_path, 'r', encoding='utf-8') as f:
                        edit_data = json.load(f)
            except Exception as e_edit:
                print(f"🟡 [Holaf-ImageViewer-Worker] Failed to load edits for {filename}: {e_edit}")

            path_hash = hashlib.sha1(image_to_process_path_canon.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"
            thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

            # --- Per-thumbnail-file lock: serialize with inline/regenerate routes ---
            # Blocking acquire: the worker is background and must WAIT for any
            # in-flight inline generation of the same file to finish before it
            # removes+regenerates it (removing a file mid-serve causes 500s).
            thumb_lock = logic.get_thumb_generation_lock(thumb_filename)
            with thumb_lock:
                # OPTIMIZATION: re-check the DB status after acquiring the lock —
                # the inline route may have generated this thumbnail while we
                # waited. If it is now 2 (complete), skip the regeneration.
                status_now = None
                recheck_conn = None
                recheck_exception = None
                try:
                    recheck_conn = holaf_database.get_db_connection()
                    recheck_cursor = recheck_conn.cursor()
                    recheck_cursor.execute(
                        "SELECT thumbnail_status FROM images WHERE path_canon = ?",
                        (image_to_process_path_canon,)
                    )
                    recheck_row = recheck_cursor.fetchone()
                    recheck_conn.commit()
                    if recheck_row:
                        status_now = recheck_row['thumbnail_status']
                except Exception as e_recheck:
                    recheck_exception = e_recheck
                    print(f"🟡 [Holaf-ImageViewer-Worker] Status re-check failed for {image_to_process_path_canon}: {e_recheck}")
                finally:
                    if recheck_conn:
                        holaf_database.close_db_connection(exception=recheck_exception)

                if status_now == 2:
                    # Already generated by the inline route while we waited — skip.
                    print(f"🔵 [Holaf-ImageViewer-Worker] Skipping {image_to_process_path_canon}: thumbnail already generated (status=2).")
                else:
                    # Pass the loaded edit_data to the generation logic
                    logic._create_thumbnail_blocking(original_abs_path, thumb_path_abs, image_path_canon_for_db_update=image_to_process_path_canon, edit_data=edit_data)
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
                conn_worker_db = None  # Must nullify so next iteration reconnects
            image_to_process_path_canon = None

    # Clean up persistent connection on exit
    if conn_worker_db:
        holaf_database.close_db_connection()
    print("🔵 [Holaf-ImageViewer-Worker] Thumbnail generation worker stopped.")