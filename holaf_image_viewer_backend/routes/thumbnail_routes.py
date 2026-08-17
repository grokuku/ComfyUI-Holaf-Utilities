# === Holaf Utilities - Image Viewer API Routes (Thumbnails) ===
import asyncio
import os
import hashlib
import json
import traceback
import logging
import time # Ensure time is imported
import threading

import aiofiles
from aiohttp import web
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from .. import path_validation
from ... import holaf_database
from ... import holaf_utils

logger = logging.getLogger('holaf.images.routes')

EDIT_DIR_NAME = "edit"

# Bounds the number of concurrent PIL thumbnail generations started INLINE from
# the thumbnail route (the asyncio default executor would otherwise allow up to
# 20 concurrent CPU-heavy PIL jobs and saturate the CPU). If the semaphore is
# unavailable we respond immediately with 202 + a retry hint instead of queueing
# unbounded work. The background thumbnail worker is NOT gated by this semaphore.
_THUMBNAIL_GENERATION_SEMAPHORE = threading.Semaphore(2)

# Immutable cache header for generated thumbnails. Safe because the URL includes
# thumb_hash (or path hash) as a cache-buster.
_IMMUTABLE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}


# --- API Route Handlers ---
async def get_thumbnail_route(request: web.Request):
    path_canon_param = request.query.get("path_canon")
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # This subfolder can now include 'trashcan'
    force_regen_param = request.query.get("force_regen") == "true"

    conn_info_read = None
    original_rel_path = None
    error_message_for_client = "ERR: Thumbnail processing failed."
    current_exception = None
    # Debug/timing state (populated as the pipeline advances; used in `finally`)
    _start_time = time.monotonic()
    thumb_status_db = None
    needs_generation = None

    try:
        output_dir = folder_paths.get_output_directory() # Base output

        # --- Prioritize path_canon if available (it matches DB key exactly) ---
        if path_canon_param:
             original_rel_path = path_canon_param
        
        # Fallback to legacy reconstruction
        elif filename:
            safe_filename = holaf_utils.sanitize_filename(filename)
            # original_rel_path is the path_canon from the DB
            original_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        else:
            error_message_for_client = "ERR: Filename or path_canon is required."
            return web.Response(status=400, text=error_message_for_client)

        try:
            original_abs_path = path_validation.validate_output_path(output_dir, original_rel_path)
        except ValueError:
            error_message_for_client = "ERR: Forbidden path_canon."
            return web.Response(status=403, text=error_message_for_client)


        # --- Retrieve thumb_hash from DB first ---
        conn_info_read = holaf_database.get_db_connection()
        cursor = conn_info_read.cursor()
        cursor.execute(
            "SELECT mtime, thumbnail_status, thumbnail_last_generated_at, thumb_hash FROM images WHERE path_canon = ?",
            (original_rel_path,)
        )
        image_db_info = cursor.fetchone()
        conn_info_read.commit()

        # Handle case where image is not in DB (possibly just created or deleted)
        if not image_db_info:
             holaf_database.close_db_connection()
             conn_info_read = None
             
             # Fallback: check file existence manually to give a specific error
             if not os.path.isfile(original_abs_path):
                 return web.Response(status=404, text="ERR: Original image not found (disk or DB).")
             return web.Response(status=404, text="ERR: Image record not found in DB.")

        # Extract data from DB
        original_mtime_db = image_db_info['mtime']
        thumb_status_db = image_db_info['thumbnail_status']
        thumb_last_gen_db = image_db_info['thumbnail_last_generated_at']
        db_thumb_hash = image_db_info['thumb_hash']

        # Determine the thumbnail filename based on DB hash (Source of Truth)
        if db_thumb_hash:
            thumb_filename = f"{db_thumb_hash}.jpg"
        else:
            # Fallback for legacy records or sync lag: calculate it
            path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"

        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)
        
        # Determine generation needs
        needs_generation = force_regen_param

        # A thumbnail file newer than the source image is always valid, even if
        # the DB status is stale (e.g. a transient DB lock prevented the status=2
        # write). Serving it avoids pointless regeneration loops and "Err" states.
        thumb_fresh = False
        if os.path.exists(thumb_path_abs):
            try:
                thumb_fresh = os.path.getmtime(thumb_path_abs) >= (original_mtime_db or 0)
            except Exception:
                thumb_fresh = False

        if thumb_fresh and not force_regen_param:
            needs_generation = False
        elif thumb_status_db == 0:
            needs_generation = True
        elif thumb_status_db == 1:
            needs_generation = True
        elif thumb_status_db == 3:
            error_message_for_client = "ERR: Thumbnail previously failed (permanent)."
        elif thumb_last_gen_db is not None and original_mtime_db > thumb_last_gen_db:
            needs_generation = True
        if thumb_status_db == 2 and not os.path.exists(thumb_path_abs) and not needs_generation:
            needs_generation = True
        
        holaf_database.close_db_connection()
        conn_info_read = None

        if error_message_for_client == "ERR: Thumbnail previously failed (permanent)." and not force_regen_param:
             return web.Response(status=500, text=error_message_for_client)

        # --- Per-thumbnail-file lock: serialize remove->generate->serve ---
        # Multiple generators (background worker, inline route, regenerate route)
        # can target the SAME thumb file. Without this lock one generator can
        # os.remove() the file while another is between os.path.exists() and
        # web.FileResponse() construction (which stats the file), raising
        # FileNotFoundError -> 500 "Failed to read generated thumb at final
        # stage.". We acquire the lock NON-blocking here: if the same file is
        # already being generated, return 202 + retry hint (frontend already
        # handles 202 with retry) instead of piling up inline requests. The
        # worker uses a blocking acquire (it is background).
        # Lock ordering: hash-lock FIRST, then semaphore. Deadlock-free because
        # each request holds at most one hash-lock and the semaphore is always
        # released; a thread holding the semaphore never waits on a hash-lock
        # since hash-locks are always acquired before the semaphore.
        thumb_lock = logic.get_thumb_generation_lock(thumb_filename)
        if not thumb_lock.acquire(blocking=False):
            return web.Response(
                status=202,
                text="ERR: Thumbnail generation in progress, please retry shortly.",
                headers={"Retry-After": "2", "Cache-Control": "no-store"},
            )
        try:
            if needs_generation and os.path.exists(thumb_path_abs):
                try: os.remove(thumb_path_abs)
                except Exception: pass 

            # Serve existing if no regen needed
            if not needs_generation and os.path.exists(thumb_path_abs):
                try:
                    return web.FileResponse(
                        thumb_path_abs,
                        headers=_IMMUTABLE_CACHE_HEADERS,
                    )
                except Exception as e:
                    current_exception = e
                    needs_generation = True
                    error_message_for_client = "ERR: Failed to read existing thumb."
                    logger.error(f"🔴 [Holaf-Thumb] Failed to serve existing thumb for {original_rel_path}: {e}")
                    traceback.print_exc()

            # Generate if needed
            if needs_generation:
                if not os.path.isfile(original_abs_path):
                     return web.Response(status=404, text="ERR: Source file missing for generation.")

                # Bound inline generation: at most 2 PIL generations run at once. If the
                # semaphore is unavailable, respond immediately (202 + retry hint) instead
                # of waiting/queueing unbounded work.
                if not _THUMBNAIL_GENERATION_SEMAPHORE.acquire(blocking=False):
                    return web.Response(
                        status=202,
                        text="ERR: Thumbnail generation busy, please retry shortly.",
                        headers={"Retry-After": "2", "Cache-Control": "no-store"},
                    )
                try:
                    # --- NEW: Check for edits to apply to thumbnail ---
                    edit_data = None
                    try:
                        original_dir = os.path.dirname(original_abs_path)
                        base_filename = os.path.splitext(os.path.basename(original_abs_path))[0]
                        
                        edit_file_new = os.path.join(original_dir, EDIT_DIR_NAME, base_filename + ".edt")
                        edit_file_legacy = os.path.join(original_dir, base_filename + ".edt")
                        
                        target_edit_file = None
                        if os.path.isfile(edit_file_new): target_edit_file = edit_file_new
                        elif os.path.isfile(edit_file_legacy): target_edit_file = edit_file_legacy
                        
                        if target_edit_file:
                            async with aiofiles.open(target_edit_file, 'r', encoding='utf-8') as f:
                                content = await f.read()
                                edit_data = json.loads(content)
                    except Exception as e:
                        logger.warning(f"Failed to load edit data for thumbnail generation {original_rel_path}: {e}")
                    # --------------------------------------------------

                    loop = asyncio.get_running_loop()
                    # Pass explicit args to blocking logic, including edit_data
                    gen_success = await loop.run_in_executor(
                        None, 
                        logic._create_thumbnail_blocking, 
                        original_abs_path, 
                        thumb_path_abs, 
                        original_rel_path, # path_canon for DB update
                        edit_data
                    )
                    if not gen_success:
                        error_message_for_client = "ERR: Thumbnail generation function failed."
                        logger.error(f"🔴 [Holaf-Thumb] Generation returned failure for {original_rel_path} (details printed by _create_thumbnail_blocking above).")
                finally:
                    _THUMBNAIL_GENERATION_SEMAPHORE.release()
        
            # Serve generated file (still under the lock so the file cannot be
            # removed concurrently by another generator before FileResponse stats it)
            if os.path.exists(thumb_path_abs):
                try:
                    return web.FileResponse(
                        thumb_path_abs,
                        headers=_IMMUTABLE_CACHE_HEADERS,
                    )
                except Exception as e:
                    current_exception = e
                    error_message_for_client = "ERR: Failed to read generated thumb at final stage."
                    logger.error(f"🔴 [Holaf-Thumb] Final serve failed for {original_rel_path}: {e}")
                    traceback.print_exc()
        finally:
            thumb_lock.release()
        
        logger.warning(f"Final fallback for {original_rel_path}: Thumbnail not served. Reason: {error_message_for_client}")
        return web.Response(status=500, text=error_message_for_client)

    except Exception as e_outer:
        current_exception = e_outer
        logger.error(f"🔴 [Holaf-Thumb] Unhandled exception for {original_rel_path}: {e_outer}")
        traceback.print_exc()
        # ... (Exception handling) ...
        final_error_text = error_message_for_client if error_message_for_client != "ERR: Thumbnail processing failed." else f"ERR: Server error processing thumbnail for {filename}."
        if original_rel_path: 
            error_conn_outer, db_outer_exception = None, None
            try:
                error_conn_outer = holaf_database.get_db_connection()
                cursor_outer = error_conn_outer.cursor()
                cursor_outer.execute("UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = CASE WHEN thumbnail_priority_score > 1000 THEN 1000 ELSE thumbnail_priority_score END WHERE path_canon = ?", (original_rel_path,))
                error_conn_outer.commit()
            except Exception as db_e: db_outer_exception = db_e
            finally:
                if error_conn_outer: holaf_database.close_db_connection(exception=db_outer_exception)
        return web.Response(status=500, text=final_error_text)
    finally:
        if conn_info_read: holaf_database.close_db_connection(exception=current_exception)
        # Debug line to correlate requests in the console (fires on every exit path).
        _elapsed_ms = (time.monotonic() - _start_time) * 1000.0
        _result_tag = error_message_for_client if ('ERR' in error_message_for_client) else 'OK'
        print(f"🔵 [Holaf-Thumb] {original_rel_path}: status={thumb_status_db} needs_gen={needs_generation} result={_result_tag} total={_elapsed_ms:.0f}ms")


async def regenerate_thumbnail_route(request: web.Request):
    """
    Regenerates a thumbnail for a given image, applying .edt file adjustments if present.
    """
    try:
        data = await request.json()
        path_canon = data.get("path_canon")
        if not path_canon:
            return web.json_response({"status": "error", "message": "'path_canon' is required"}, status=400)

        output_dir = folder_paths.get_output_directory()

        # Reject traversal/absolute input before sanitization (sanitize would
        # otherwise silently strip '..' instead of rejecting it).
        try:
            path_validation.validate_output_path(output_dir, path_canon)
        except ValueError:
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)

        safe_path_canon = holaf_utils.sanitize_path_canon(path_canon)

        try:
            original_abs_path = path_validation.validate_output_path(output_dir, safe_path_canon)
        except ValueError:
            return web.json_response({"status": "error", "message": "Forbidden path"}, status=403)
        if not os.path.isfile(original_abs_path):
            return web.json_response({"status": "error", "message": "Original image not found"}, status=404)

        # --- Lookup Hash in DB ---
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT thumb_hash FROM images WHERE path_canon = ?", (safe_path_canon,))
        row = cursor.fetchone()
        holaf_database.close_db_connection()
        
        if row and row['thumb_hash']:
            path_hash = row['thumb_hash']
        else:
            path_hash = hashlib.sha1(safe_path_canon.encode('utf-8')).hexdigest()

        thumb_filename = f"{path_hash}.jpg"
        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

        # --- LOAD EDIT DATA (New Structure Support) ---
        edit_data = None
        
        # 1. Check New Location: /edit/filename.edt
        original_dir = os.path.dirname(original_abs_path)
        base_filename = os.path.splitext(os.path.basename(original_abs_path))[0]
        
        edit_file_new = os.path.join(original_dir, EDIT_DIR_NAME, base_filename + ".edt")
        edit_file_legacy = os.path.join(original_dir, base_filename + ".edt")
        
        target_edit_file = None
        if os.path.isfile(edit_file_new):
            target_edit_file = edit_file_new
        elif os.path.isfile(edit_file_legacy):
            target_edit_file = edit_file_legacy

        if target_edit_file:
            try:
                async with aiofiles.open(target_edit_file, 'r', encoding='utf-8') as f:
                    content = await f.read()
                    edit_data = json.loads(content)
            except Exception as e:
                logger.warning(f"Could not read or parse edit file {target_edit_file}: {e}")
        # -----------------------------------------------

        # --- Per-thumbnail-file lock: serialize with worker/inline generation ---
        # Blocking acquire is fine here: this is a manual user action, and waiting
        # briefly for an in-flight generation of the same file is preferable to
        # conflicting with it (which would otherwise cause remove/serve races).
        thumb_lock = logic.get_thumb_generation_lock(thumb_filename)
        with thumb_lock:
            # Run blocking thumbnail creation in an executor thread
            loop = asyncio.get_running_loop()
            gen_success = await loop.run_in_executor(
                None, 
                logic._create_thumbnail_blocking, 
                original_abs_path, 
                thumb_path_abs, 
                safe_path_canon, # path_canon for DB update
                edit_data        # The edit data
            )

        if gen_success:
            return web.json_response({"status": "ok", "message": "Thumbnail regenerated successfully."})
        else:
            return web.json_response({"status": "error", "message": "Thumbnail generation failed in backend logic."}, status=500)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON in request"}, status=400)
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def regenerate_failed_thumbnails_route(request: web.Request):
    """
    Resets failed thumbnails so the background worker regenerates them:
      - thumbnail_status = 3 (permanent failure) -> 0 (pending)
      - thumbnail_status = 2 ("success") rows whose thumbnail FILE is missing
        or corrupt on disk -> 0 (pending)
    Also resets thumbnail_priority_score to 1000 for the reset rows so the
    worker picks them up promptly.
    """
    conn = None
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # Step 1: Reset permanent failures back to pending.
        cursor.execute(
            "UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = 1000 "
            "WHERE thumbnail_status = 3"
        )
        count1 = cursor.rowcount

        # Step 2: Find "success" rows whose thumbnail file is missing on disk.
        cursor.execute(
            "SELECT path_canon, thumb_hash FROM images "
            "WHERE thumbnail_status = 2 AND thumb_hash IS NOT NULL"
        )
        missing_paths = []
        for row in cursor.fetchall():
            thumb_path_abs = os.path.join(
                holaf_utils.THUMBNAIL_CACHE_DIR, f"{row['thumb_hash']}.jpg"
            )
            if not os.path.exists(thumb_path_abs):
                missing_paths.append(row['path_canon'])

        count2 = 0
        if missing_paths:
            placeholders = ','.join(['?'] * len(missing_paths))
            cursor.execute(
                f"UPDATE images SET thumbnail_status = 0, thumbnail_priority_score = 1000 "
                f"WHERE path_canon IN ({placeholders})",
                missing_paths
            )
            count2 = cursor.rowcount

        total = count1 + count2
        conn.commit()

        logger.info(
            f"regenerate-failed: reset {count1} permanent-fail + {count2} "
            f"missing-file thumbnails ({total} total)."
        )
        return web.json_response({
            "status": "ok",
            "reset_count": total,
            "message": f"{total} miniature(s) en file de régénération.",
        })

    except Exception as e:
        current_exception = e
        logger.error(f"Error in regenerate_failed_thumbnails_route: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def _background_prioritize_task(paths_canon):
    """
    Processes a list of paths to update their priority in the database.
    """
    conn = None
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        priority_score_for_visible = 10
        
        placeholders = ','.join(['?'] * len(paths_canon))
        sql = f"""
            UPDATE images
            SET thumbnail_status = CASE thumbnail_status WHEN 0 THEN 1 ELSE thumbnail_status END,
                thumbnail_priority_score = MIN(thumbnail_priority_score, ?)
            WHERE path_canon IN ({placeholders}) AND thumbnail_status IN (0, 1)
        """
        
        params = [priority_score_for_visible] + paths_canon
        cursor.execute(sql, params)
        conn.commit()
        logger.info(f"Background prioritization updated {cursor.rowcount} of {len(paths_canon)} thumbnails.")
        
    except Exception as e:
        current_exception = e
        logger.error(f"Error in _background_prioritize_task: {e}", exc_info=True)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def prioritize_thumbnails_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon")

        if not paths_canon or not isinstance(paths_canon, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        loop = asyncio.get_running_loop()
        loop.create_task(_background_prioritize_task(paths_canon))

        return web.json_response({"status": "accepted", "message": "Prioritization task scheduled."}, status=202)

    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"Error scheduling prioritize_thumbnails_route: {e}", exc_info=True)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


async def get_thumbnail_stats_route(request: web.Request):
    # --- ARCHITECTURAL FIX: READ FROM RAM ONLY ---
    try:
        # No DB Connection here! Pure memory access.
        # This will respond in 0.0001s regardless of DB load.
        stats = logic.stats_manager.get_stats()
        return web.json_response(stats)
    except Exception as e:
        logger.error(f"Error getting thumbnail stats from manager: {e}", exc_info=True)
        return web.json_response({"error": str(e)}, status=500)


async def thumbnail_diagnose_route(request: web.Request):
    """
    Manual diagnostic: runs the thumbnail pipeline SYNCHRONOUSLY, step by step,
    capturing each step's outcome and FULL tracebacks. Returns a JSON report
    with HTTP 200 always (the report itself carries the failure info), so a
    single curl reveals exactly where the pipeline fails.

    GET /holaf/images/thumbnail-diagnose?path_canon=<canon>[&force_regen=true]

    Intentionally does NOT use the per-file lock or the generation semaphore:
    this is a manual, direct diagnostic. It reuses the same helpers as
    get_thumbnail_route (path resolution, DB lookup, thumb_hash filename,
    logic._create_thumbnail_blocking, web.FileResponse construction).
    """
    path_canon_param = request.query.get("path_canon")
    force_regen_param = request.query.get("force_regen") == "true"

    if not path_canon_param:
        return web.json_response(
            {"error": "Missing required query parameter 'path_canon'.", "summary": "REJECTED: path_canon is required."},
            status=400,
        )

    diagnostic = {
        "path_canon": path_canon_param,
        "source_abs_path": None,
        "source_exists": False,
        "source_size": None,
        "db_row": None,
        "thumb_path": None,
        "thumb_exists": False,
        "thumb_size": None,
        "needs_generation": None,
        "generation": {
            "attempted": False,
            "success": False,
            "error": None,
            "traceback": None,
            "thumb_exists_after": None,
            "thumb_size_after": None,
        },
        "serve_test": {
            "constructed": False,
            "error": None,
            "traceback": None,
        },
        "summary": None,
    }

    conn = None
    current_exception = None
    try:
        output_dir = folder_paths.get_output_directory()

        # --- Same security checks as get_thumbnail_route ---
        original_rel_path = path_canon_param
        try:
            original_abs_path = path_validation.validate_output_path(output_dir, original_rel_path)
        except ValueError as path_err:
            diagnostic["summary"] = f"REJECTED: {path_err}"
            return web.json_response(diagnostic, status=200)

        diagnostic["source_abs_path"] = original_abs_path
        diagnostic["source_exists"] = os.path.isfile(original_abs_path)
        if diagnostic["source_exists"]:
            diagnostic["source_size"] = os.path.getsize(original_abs_path)

        # --- SELECT the DB row (same query as the route) ---
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT mtime, thumbnail_status, thumbnail_last_generated_at, thumb_hash FROM images WHERE path_canon = ?",
            (original_rel_path,)
        )
        image_db_info = cursor.fetchone()
        conn.commit()
        holaf_database.close_db_connection()
        conn = None

        if image_db_info:
            diagnostic["db_row"] = {
                "thumbnail_status": image_db_info['thumbnail_status'],
                "mtime": image_db_info['mtime'],
                "thumb_hash": image_db_info['thumb_hash'],
                "thumbnail_last_generated_at": image_db_info['thumbnail_last_generated_at'],
            }
        else:
            diagnostic["db_row"] = None

        # --- Thumb filename (same logic as the route: DB hash, sha1 fallback) ---
        if image_db_info and image_db_info['thumb_hash']:
            thumb_filename = f"{image_db_info['thumb_hash']}.jpg"
        else:
            path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
            thumb_filename = f"{path_hash}.jpg"

        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)
        diagnostic["thumb_path"] = thumb_path_abs
        diagnostic["thumb_exists"] = os.path.exists(thumb_path_abs)
        if diagnostic["thumb_exists"]:
            diagnostic["thumb_size"] = os.path.getsize(thumb_path_abs)

        # --- needs_generation (same decision logic as the route) ---
        needs_generation = force_regen_param
        if image_db_info:
            thumb_status_db = image_db_info['thumbnail_status']
            original_mtime_db = image_db_info['mtime']
            thumb_last_gen_db = image_db_info['thumbnail_last_generated_at']
            if thumb_status_db == 0: needs_generation = True
            elif thumb_status_db == 1: needs_generation = True
            elif thumb_status_db == 3: needs_generation = False  # permanent failure gate
            elif thumb_last_gen_db is not None and original_mtime_db > thumb_last_gen_db: needs_generation = True
            if thumb_status_db == 2 and not os.path.exists(thumb_path_abs) and not needs_generation:
                needs_generation = True
        else:
            # No DB row: fall back to a file-existence based decision.
            needs_generation = not os.path.exists(thumb_path_abs)
        diagnostic["needs_generation"] = needs_generation

        # --- Step: generation (direct, no lock/semaphore) ---
        if needs_generation:
            diagnostic["generation"]["attempted"] = True
            try:
                gen_success = logic._create_thumbnail_blocking(
                    original_abs_path, thumb_path_abs, original_rel_path
                )
                diagnostic["generation"]["success"] = bool(gen_success)
                if not gen_success:
                    diagnostic["generation"]["error"] = (
                        "_create_thumbnail_blocking returned failure (it printed the real "
                        "error to the server console and marked the DB row as permanent-fail)."
                    )
            except Exception as e:
                diagnostic["generation"]["success"] = False
                diagnostic["generation"]["error"] = str(e)
                diagnostic["generation"]["traceback"] = traceback.format_exc()
            finally:
                diagnostic["generation"]["thumb_exists_after"] = os.path.exists(thumb_path_abs)
                diagnostic["generation"]["thumb_size_after"] = (
                    os.path.getsize(thumb_path_abs)
                    if diagnostic["generation"]["thumb_exists_after"] else None
                )
        else:
            diagnostic["generation"]["attempted"] = False
            diagnostic["generation"]["thumb_exists_after"] = diagnostic["thumb_exists"]
            diagnostic["generation"]["thumb_size_after"] = diagnostic["thumb_size"]

        # --- Step: serve test (FileResponse construction + first-bytes read) ---
        # FileResponse construction stats the file; reading the first byte is the
        # closest synchronous proxy for the failure that produces the real 500
        # "Failed to read generated thumb at final stage."
        try:
            if os.path.exists(thumb_path_abs):
                web.FileResponse(
                    thumb_path_abs,
                    headers=_IMMUTABLE_CACHE_HEADERS,
                )
                with open(thumb_path_abs, 'rb') as fh:
                    _ = fh.read(1)
                diagnostic["serve_test"]["constructed"] = True
            else:
                diagnostic["serve_test"]["error"] = "Thumbnail file does not exist on disk; nothing to serve."
        except Exception as e:
            diagnostic["serve_test"]["constructed"] = False
            diagnostic["serve_test"]["error"] = str(e)
            diagnostic["serve_test"]["traceback"] = traceback.format_exc()

        # --- Summary ---
        if not diagnostic["source_exists"]:
            diagnostic["summary"] = "FAILED before generation: source file missing on disk."
        elif diagnostic["db_row"] is None:
            diagnostic["summary"] = "WARNING: no DB row for path_canon (worker may never generate)."
        elif image_db_info and image_db_info['thumbnail_status'] == 3 and not force_regen_param and diagnostic["thumb_exists"]:
            diagnostic["summary"] = "FAILED at gate: permanent failure (status=3) but a thumb file exists; pass force_regen=true to regenerate and see the real error."
        elif image_db_info and image_db_info['thumbnail_status'] == 3 and not force_regen_param:
            diagnostic["summary"] = "FAILED at gate: permanent failure (status=3); pass force_regen=true to retry and capture the real generation error."
        elif diagnostic["needs_generation"] and not diagnostic["generation"]["success"]:
            diagnostic["summary"] = f"FAILED at generation: {diagnostic['generation']['error']}"
        elif diagnostic["needs_generation"] and not diagnostic["serve_test"]["constructed"]:
            diagnostic["summary"] = f"FAILED at serve (after generation): {diagnostic['serve_test']['error']}"
        elif not diagnostic["needs_generation"] and not diagnostic["thumb_exists"]:
            diagnostic["summary"] = "FAILED: thumb marked OK in DB but file missing on disk."
        elif not diagnostic["serve_test"]["constructed"]:
            diagnostic["summary"] = f"FAILED at serve (existing thumb): {diagnostic['serve_test']['error']}"
        else:
            diagnostic["summary"] = "OK: pipeline complete."

        return web.json_response(diagnostic, status=200)

    except Exception as e:
        current_exception = e
        diagnostic["summary"] = f"DIAGNOSTIC ROUTE ERROR: {e}"
        if diagnostic["serve_test"]["traceback"] is None:
            diagnostic["serve_test"]["traceback"] = traceback.format_exc()
        return web.json_response(diagnostic, status=200)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)