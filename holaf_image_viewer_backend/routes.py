# === Holaf Utilities - Image Viewer API Routes ===
import asyncio
import os
import hashlib
import json
import time
import datetime
import traceback
import shutil
import uuid

import aiofiles
from aiohttp import web
from PIL import Image
import folder_paths # ComfyUI global

# Imports from this package's modules
from . import logic
from . import worker # For viewer_is_active

# Imports from the parent package
from .. import holaf_database
from .. import holaf_utils

# --- API Route Handlers ---
async def get_filter_options_route(request: web.Request):
    conn = None
    response_data = {"subfolders": [], "formats": [], "has_root": False}
    error_status = 500
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # Get subfolders from non-trashed images
        cursor.execute("SELECT DISTINCT subfolder FROM images WHERE subfolder != '' AND is_trashed = 0")
        subfolders = {row['subfolder'] for row in cursor.fetchall()}

        # Check if there are any items in the trash
        cursor.execute("SELECT 1 FROM images WHERE is_trashed = 1 LIMIT 1")
        has_trashed_items = cursor.fetchone() is not None

        # If there are trashed items, add 'trashcan' to the list of folders to be displayed
        if has_trashed_items:
            subfolders.add(logic.TRASHCAN_DIR_NAME)

        # Get formats from non-trashed images
        cursor.execute("SELECT DISTINCT format FROM images WHERE is_trashed = 0")
        formats = sorted([row['format'] for row in cursor.fetchall()])

        # Check for non-trashed images in root
        cursor.execute("SELECT 1 FROM images WHERE subfolder = '' AND is_trashed = 0 LIMIT 1")
        has_root_images = cursor.fetchone() is not None
        
        conn.commit()
        response_data = {"subfolders": sorted(list(subfolders)), "formats": formats, "has_root": has_root_images}
        return web.json_response(response_data)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Failed to get filter options from DB: {e}")
        return web.json_response(response_data, status=error_status)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def list_images_route(request: web.Request):
    conn = None
    filters = {}
    current_exception = None
    default_response_data = {
        "images": [], "filtered_count": 0, "total_db_count": 0, "generated_thumbnails_count": 0
    }
    try:
        filters = await request.json()
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        query_fields = "id, filename, subfolder, format, mtime, size_bytes, path_canon, thumbnail_status, thumbnail_last_generated_at, is_trashed, original_path_canon"
        query_base = f"SELECT {query_fields} FROM images"
        where_clauses, params = [], []

        folder_filters = filters.get('folder_filters', [])
        
        # If 'trashcan' is selected, we ONLY show the trashcan, regardless of other selections.
        if logic.TRASHCAN_DIR_NAME in folder_filters:
            where_clauses.append("is_trashed = 1")
            # Build a condition that only matches the trashcan and its subdirectories.
            where_clauses.append("(subfolder = ? OR subfolder LIKE ?)")
            params.extend([logic.TRASHCAN_DIR_NAME, f"{logic.TRASHCAN_DIR_NAME}/%"])

        else: # Normal view, non-trashed items
            where_clauses.append("is_trashed = 0")
            if folder_filters:
                conditions = []
                for folder in folder_filters:
                    if folder == 'root':
                        conditions.append("subfolder = ?")
                        params.append('')
                    else:
                        conditions.append("(subfolder = ? OR subfolder LIKE ?)")
                        params.extend([folder, f"{folder}/%"])
                if conditions:
                    where_clauses.append(f"({ ' OR '.join(conditions) })")

        format_filters = filters.get('format_filters', [])
        if format_filters: # Format filters apply to both trash and non-trash views
            placeholders = ','.join('?' * len(format_filters))
            where_clauses.append(f"format IN ({placeholders})"); params.extend(format_filters)

        if filters.get('startDate'):
            try:
                dt_start = datetime.datetime.strptime(filters['startDate'], '%Y-%m-%d')
                where_clauses.append("mtime >= ?"); params.append(time.mktime(dt_start.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid start date: {filters['startDate']}")
        if filters.get('endDate'):
            try:
                dt_end = datetime.datetime.strptime(filters['endDate'], '%Y-%m-%d') + datetime.timedelta(days=1)
                where_clauses.append("mtime < ?"); params.append(time.mktime(dt_end.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid end date: {filters['endDate']}")

        final_query = query_base
        if where_clauses:
            final_query += " WHERE " + " AND ".join(where_clauses)

        count_query_filtered = final_query.replace(query_fields, "COUNT(*)")
        cursor.execute(count_query_filtered, params)
        filtered_count = cursor.fetchone()[0]

        # Total non-trashed images in DB
        cursor.execute("SELECT COUNT(*) FROM images WHERE is_trashed = 0")
        total_db_count = cursor.fetchone()[0]
        # Generated thumbnails for non-trashed images
        cursor.execute("SELECT COUNT(*) FROM images WHERE thumbnail_status = 2 AND is_trashed = 0")
        generated_thumbnails_count = cursor.fetchone()[0]
        
        conn.commit()

        final_query += " ORDER BY mtime DESC"
        cursor.execute(final_query, params)
        images_data = [dict(row) for row in cursor.fetchall()]
        
        return web.json_response({
            "images": images_data,
            "filtered_count": filtered_count,
            "total_db_count": total_db_count,
            "generated_thumbnails_count": generated_thumbnails_count
        })
    except json.JSONDecodeError as e_json:
        current_exception = e_json
        print(f"🔴 [Holaf-ImageViewer] Invalid JSON in list_images_route: {e_json}")
        return web.json_response({"error": "Invalid JSON", **default_response_data}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error listing filtered images: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e), **default_response_data}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def delete_images_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()
    trashcan_base_path = logic.ensure_trashcan_exists()
    if not trashcan_base_path:
        return web.json_response({"status": "error", "message": "Trashcan directory could not be created/accessed."}, status=500)

    try:
        data = await request.json()
        paths_canon_to_delete = data.get("paths_canon", [])
        if not paths_canon_to_delete or not isinstance(paths_canon_to_delete, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        
        deleted_files_count = 0
        errors = []

        for original_path_canon in paths_canon_to_delete:
            original_full_path = os.path.normpath(os.path.join(output_dir, original_path_canon))
            
            if not os.path.isfile(original_full_path):
                errors.append({"path": original_path_canon, "error": "File not found on disk."})
                # Mark as trashed in DB anyway if it exists, to clean up entry
                cursor.execute("UPDATE images SET is_trashed = 1, original_path_canon = ? WHERE path_canon = ? AND is_trashed = 0", 
                               (original_path_canon, original_path_canon))
                continue

            original_subfolder, original_filename = os.path.split(original_path_canon)
            
            # Create corresponding subfolder structure in trashcan
            trash_subfolder_path = os.path.join(trashcan_base_path, original_subfolder)
            os.makedirs(trash_subfolder_path, exist_ok=True)
            
            # Determine unique filename in trash (simple append of timestamp for now if conflict)
            destination_filename_in_trash = original_filename
            destination_full_path_in_trash = os.path.join(trash_subfolder_path, destination_filename_in_trash)
            
            counter = 0
            base_name, ext = os.path.splitext(destination_filename_in_trash)
            while os.path.exists(destination_full_path_in_trash):
                counter += 1
                destination_filename_in_trash = f"{base_name}_{counter}{ext}"
                destination_full_path_in_trash = os.path.join(trash_subfolder_path, destination_filename_in_trash)

            new_path_canon_in_trash = os.path.join(logic.TRASHCAN_DIR_NAME, original_subfolder, destination_filename_in_trash).replace(os.sep, '/')
            new_subfolder_in_trash = os.path.join(logic.TRASHCAN_DIR_NAME, original_subfolder).replace(os.sep, '/')


            try:
                shutil.move(original_full_path, destination_full_path_in_trash)
                
                # Move associated .txt and .json files
                base_original_path, _ = os.path.splitext(original_full_path)
                base_dest_path_in_trash, _ = os.path.splitext(destination_full_path_in_trash)

                for meta_ext in ['.txt', '.json']:
                    original_meta_file = base_original_path + meta_ext
                    dest_meta_file_in_trash = base_dest_path_in_trash + meta_ext
                    if os.path.exists(original_meta_file):
                        shutil.move(original_meta_file, dest_meta_file_in_trash)
                
                cursor.execute("""
                    UPDATE images 
                    SET is_trashed = 1, original_path_canon = ?, path_canon = ?, subfolder = ?, filename = ?
                    WHERE path_canon = ? AND is_trashed = 0 
                """, (original_path_canon, new_path_canon_in_trash, new_subfolder_in_trash, destination_filename_in_trash, original_path_canon))
                
                if cursor.rowcount > 0:
                    deleted_files_count += 1
                else: # DB record might have been already marked or missing
                    errors.append({"path": original_path_canon, "error": "DB record not updated (already trashed or missing). File moved."})


            except Exception as move_exc:
                errors.append({"path": original_path_canon, "error": f"Failed to move file: {str(move_exc)}"})
        
        conn.commit()
        status_message = f"Processed {len(paths_canon_to_delete)} items. Successfully deleted {deleted_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)
        
        return web.json_response({"status": "ok", "message": status_message, "deleted_count": deleted_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error deleting images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def restore_images_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()

    try:
        data = await request.json()
        paths_canon_to_restore = data.get("paths_canon", [])
        if not paths_canon_to_restore or not isinstance(paths_canon_to_restore, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        restored_files_count = 0
        errors = []

        for path_in_trash_canon in paths_canon_to_restore:
            # Get the original path from the database
            cursor.execute("SELECT original_path_canon FROM images WHERE path_canon = ? AND is_trashed = 1", (path_in_trash_canon,))
            row = cursor.fetchone()
            
            if not row or not row['original_path_canon']:
                errors.append({"path": path_in_trash_canon, "error": "DB record not found or original path is missing."})
                continue
            
            original_path_canon = row['original_path_canon']
            current_full_path_in_trash = os.path.normpath(os.path.join(output_dir, path_in_trash_canon))
            original_full_path_restored = os.path.normpath(os.path.join(output_dir, original_path_canon))

            if not os.path.isfile(current_full_path_in_trash):
                errors.append({"path": path_in_trash_canon, "error": "File not found in trashcan."})
                # Clean up the DB entry if the file is gone
                cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_in_trash_canon,))
                continue

            if os.path.exists(original_full_path_restored):
                errors.append({"path": path_in_trash_canon, "error": f"Conflict: A file already exists at the original location '{original_path_canon}'."})
                continue
            
            # Ensure destination directory exists
            os.makedirs(os.path.dirname(original_full_path_restored), exist_ok=True)
            
            try:
                # Move the main image file
                shutil.move(current_full_path_in_trash, original_full_path_restored)

                # Move associated .txt and .json files
                base_path_in_trash, _ = os.path.splitext(current_full_path_in_trash)
                base_restored_path, _ = os.path.splitext(original_full_path_restored)
                
                for meta_ext in ['.txt', '.json']:
                    meta_file_in_trash = base_path_in_trash + meta_ext
                    restored_meta_file = base_restored_path + meta_ext
                    if os.path.exists(meta_file_in_trash):
                        shutil.move(meta_file_in_trash, restored_meta_file)

                # Update the database record
                new_subfolder, new_filename = os.path.split(original_path_canon)
                cursor.execute("""
                    UPDATE images
                    SET is_trashed = 0, original_path_canon = NULL, path_canon = ?, subfolder = ?, filename = ?
                    WHERE path_canon = ?
                """, (original_path_canon, new_subfolder.replace(os.sep, '/'), new_filename, path_in_trash_canon))

                if cursor.rowcount > 0:
                    restored_files_count += 1
                else:
                    # This case is unlikely if we passed the initial select, but good for safety
                    errors.append({"path": path_in_trash_canon, "error": "DB record could not be updated after file move."})

            except Exception as move_exc:
                errors.append({"path": path_in_trash_canon, "error": f"Failed to move file: {str(move_exc)}"})

        conn.commit()
        status_message = f"Processed {len(paths_canon_to_restore)} items. Successfully restored {restored_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)

        return web.json_response({"status": "ok", "message": status_message, "restored_count": restored_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error restoring images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def delete_images_permanently_route(request: web.Request):
    conn = None
    current_exception = None
    output_dir = folder_paths.get_output_directory()

    try:
        data = await request.json()
        paths_canon_to_delete = data.get("paths_canon", [])
        if not paths_canon_to_delete or not isinstance(paths_canon_to_delete, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        deleted_files_count = 0
        errors = []

        for path_canon in paths_canon_to_delete:
            # Safety check: do not allow this action on items already in trashcan.
            cursor.execute("SELECT 1 FROM images WHERE path_canon = ? AND is_trashed = 1", (path_canon,))
            if cursor.fetchone():
                errors.append({"path": path_canon, "error": "Cannot permanently delete an item that is in the trashcan."})
                continue

            full_path = os.path.normpath(os.path.join(output_dir, path_canon))
            
            try:
                # Delete main image file
                if os.path.isfile(full_path):
                    os.unlink(full_path)
                
                # Delete associated .txt and .json files
                base_path, _ = os.path.splitext(full_path)
                for meta_ext in ['.txt', '.json']:
                    meta_file = base_path + meta_ext
                    if os.path.exists(meta_file):
                        os.unlink(meta_file)
                
                # Delete the record from the database
                cursor.execute("DELETE FROM images WHERE path_canon = ?", (path_canon,))
                
                if cursor.rowcount > 0:
                    deleted_files_count += 1
                else:
                    errors.append({"path": path_canon, "error": "File deleted from disk, but no corresponding DB entry was found to remove."})

            except Exception as delete_exc:
                errors.append({"path": path_canon, "error": f"Failed to delete file or its metadata: {str(delete_exc)}"})
        
        conn.commit()
        status_message = f"Processed {len(paths_canon_to_delete)} items. Successfully permanently deleted {deleted_files_count} files."
        if errors:
            status_message += f" Encountered {len(errors)} errors."
            return web.json_response({"status": "partial_success", "message": status_message, "details": errors}, status=207)
        
        return web.json_response({"status": "ok", "message": status_message, "deleted_count": deleted_files_count})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error permanently deleting images: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def empty_trashcan_route(request: web.Request):
    conn = None
    current_exception = None
    
    try:
        output_dir = folder_paths.get_output_directory()
        trashcan_path = os.path.join(output_dir, logic.TRASHCAN_DIR_NAME)

        deleted_count = 0
        errors = []

        if os.path.isdir(trashcan_path):
            for item_name in os.listdir(trashcan_path):
                item_path = os.path.join(trashcan_path, item_name)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                    deleted_count += 1
                except Exception as e:
                    errors.append(f"Could not delete {item_name}: {e}")
        
        # Now, clear the database
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM images WHERE is_trashed = 1")
        db_deleted_count = cursor.rowcount
        conn.commit()

        if errors:
            error_message = f"Completed with {len(errors)} errors. DB entries for trashed items removed. Errors: {'; '.join(errors)}"
            return web.json_response({"status": "partial_success", "message": error_message}, status=207)

        return web.json_response({
            "status": "ok",
            "message": f"Trashcan emptied. {deleted_count} filesystem items and {db_deleted_count} database records removed."
        })

    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error emptying trashcan: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)


async def get_thumbnail_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # This subfolder can now include 'trashcan'
    force_regen_param = request.query.get("force_regen") == "true"

    conn_info_read = None
    original_rel_path = None
    error_message_for_client = "ERR: Thumbnail processing failed."
    current_exception = None

    try:
        if not filename:
            error_message_for_client = "ERR: Filename is required."
            return web.Response(status=400, text=error_message_for_client)

        output_dir = folder_paths.get_output_directory() # Base output
        safe_filename = holaf_utils.sanitize_filename(filename)
        
        # original_rel_path is the path_canon from the DB, which might be inside trashcan
        original_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        # original_abs_path is its location on disk, relative to output_dir
        original_abs_path = os.path.normpath(os.path.join(output_dir, original_rel_path))


        if not original_abs_path.startswith(os.path.normpath(output_dir)):
            error_message_for_client = "ERR: Forbidden path for thumbnail."
            return web.Response(status=403, text=error_message_for_client)

        if not os.path.isfile(original_abs_path):
            error_message_for_client = "ERR: Original image not found for thumbnail."
            temp_conn_no_orig, no_orig_exception = None, None
            try:
                temp_conn_no_orig = holaf_database.get_db_connection()
                cursor_no_orig = temp_conn_no_orig.cursor()
                # Check if record exists using its current path_canon (which might be in trash)
                cursor_no_orig.execute("SELECT id FROM images WHERE path_canon = ?", (original_rel_path,))
                if cursor_no_orig.fetchone():
                    cursor_no_orig.execute("UPDATE images SET thumbnail_status = 3, thumbnail_priority_score = 9999 WHERE path_canon = ?", (original_rel_path,))
                    temp_conn_no_orig.commit()
            except Exception as e_db_no_orig: no_orig_exception = e_db_no_orig
            finally:
                if temp_conn_no_orig: holaf_database.close_db_connection(exception=no_orig_exception)
            return web.Response(status=404, text=error_message_for_client)

        # Hash is based on path_canon, so trashed images get different hashes if path_canon changes
        path_hash = hashlib.sha1(original_rel_path.encode('utf-8')).hexdigest()
        thumb_filename = f"{path_hash}.jpg"
        thumb_path_abs = os.path.join(holaf_utils.THUMBNAIL_CACHE_DIR, thumb_filename)

        conn_info_read = holaf_database.get_db_connection()
        cursor = conn_info_read.cursor()
        cursor.execute(
            "SELECT mtime, thumbnail_status, thumbnail_last_generated_at FROM images WHERE path_canon = ?",
            (original_rel_path,) # Use the current path_canon from DB
        )
        image_db_info = cursor.fetchone()
        conn_info_read.commit()

        needs_generation = force_regen_param
        if image_db_info:
            original_mtime_db = image_db_info['mtime']
            thumb_status_db = image_db_info['thumbnail_status']
            thumb_last_gen_db = image_db_info['thumbnail_last_generated_at']

            if thumb_status_db == 0: needs_generation = True
            elif thumb_status_db == 1: needs_generation = True
            elif thumb_status_db == 3: error_message_for_client = "ERR: Thumbnail previously failed (permanent)."
            elif thumb_last_gen_db is not None and original_mtime_db > thumb_last_gen_db: needs_generation = True
            if thumb_status_db == 2 and not os.path.exists(thumb_path_abs) and not needs_generation:
                needs_generation = True
        else: error_message_for_client = "ERR: Image record not found in DB."
        
        holaf_database.close_db_connection()
        conn_info_read = None

        if error_message_for_client in ("ERR: Thumbnail previously failed (permanent).", "ERR: Image record not found in DB."):
             return web.Response(status=404 if "not found" in error_message_for_client else 500, text=error_message_for_client)

        if needs_generation and os.path.exists(thumb_path_abs):
            try: os.remove(thumb_path_abs)
            except Exception: pass # Ignore error if removal fails, generation will overwrite

        if not needs_generation and os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: needs_generation = True; error_message_for_client = "ERR: Failed to read existing thumb."

        if needs_generation:
            loop = asyncio.get_event_loop()
            try:
                # Pass original_rel_path (which is current path_canon) for DB update key
                gen_success = await loop.run_in_executor(None, logic._create_thumbnail_blocking, original_abs_path, thumb_path_abs, original_rel_path)
                if not gen_success: error_message_for_client = "ERR: Thumbnail generation function failed."
            except Exception as e: current_exception = e; error_message_for_client = "ERR: Exception during thumbnail creation."
        
        if os.path.exists(thumb_path_abs):
            try:
                async with aiofiles.open(thumb_path_abs, 'rb') as f: content = await f.read()
                return web.Response(body=content, content_type='image/jpeg')
            except Exception as e: current_exception = e; error_message_for_client = "ERR: Failed to read generated thumb at final stage."
        
        print(f"🟡 [IV-Route] Final fallback for {original_rel_path}: Thumbnail not served. Reason: {error_message_for_client}")
        return web.Response(status=500, text=error_message_for_client)

    except Exception as e_outer:
        current_exception = e_outer
        # ... (rest of outer exception handling unchanged, but ensure DB updates use correct path_canon) ...
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


async def get_metadata_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # Can now include TRASHCAN_DIR_NAME
    if not filename: return web.json_response({"error": "Filename required"}, status=400)
    try:
        output_dir = folder_paths.get_output_directory()
        safe_filename = holaf_utils.sanitize_filename(filename)
        # Path is now constructed directly from subfolder and filename query params
        image_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        image_abs_path = os.path.normpath(os.path.join(output_dir, image_rel_path))

        if not image_abs_path.startswith(os.path.normpath(output_dir)) or \
           not os.path.isfile(image_abs_path):
            return web.json_response({"error": "Image not found or path forbidden"}, status=404)

        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, image_abs_path)

        if "error" in metadata and metadata["error"]: return web.json_response(metadata, status=422)
        return web.json_response(metadata)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in metadata endpoint for {filename}: {e}"); traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)

async def extract_metadata_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        force_overwrite = data.get("force", False)

        if not paths_canon:
            return web.json_response({"error": "No image paths provided"}, status=400)
        
        successes, failures, conflicts = [], [], []
        db_updates = []
        
        output_dir = folder_paths.get_output_directory()
        loop = asyncio.get_event_loop()

        for path in paths_canon:
            image_abs_path = os.path.normpath(os.path.join(output_dir, path))
            base_path, _ = os.path.splitext(image_abs_path)

            try:
                # 1. Pre-flight checks (non-blocking)
                if not path.lower().endswith('.png'):
                    failures.append({"path": path, "error": "Not a PNG file."})
                    continue
                if not os.path.isfile(image_abs_path):
                    failures.append({"path": path, "error": "File not found on disk."})
                    continue
                
                # 2. Extract metadata (blocking, in executor)
                internal_meta = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, image_abs_path)
                
                has_workflow = internal_meta.get("workflow") and internal_meta.get("workflow_source") == "internal_png"
                has_prompt = internal_meta.get("prompt") and internal_meta.get("prompt_source") == "internal_png"

                if not has_workflow and not has_prompt:
                    failures.append({"path": path, "error": "No internal metadata found to extract."})
                    continue

                # 3. Check for conflicts (non-blocking)
                json_path = base_path + ".json"
                txt_path = base_path + ".txt"
                if not force_overwrite:
                    conflict_details = []
                    if has_workflow and os.path.exists(json_path):
                        conflict_details.append(f"'{os.path.basename(json_path)}' already exists.")
                    if has_prompt and os.path.exists(txt_path):
                        conflict_details.append(f"'{os.path.basename(txt_path)}' already exists.")
                    if conflict_details:
                        conflicts.append({"path": path, "error": "Sidecar file(s) already exist.", "details": conflict_details})
                        continue
                
                # 4. Write sidecars (asynchronous)
                if has_workflow:
                    async with aiofiles.open(json_path, 'w', encoding='utf-8') as f:
                        await f.write(json.dumps(internal_meta["workflow"], indent=2))
                if has_prompt:
                    async with aiofiles.open(txt_path, 'w', encoding='utf-8') as f:
                        await f.write(internal_meta["prompt"])

                # 5. Strip metadata from PNG (blocking, in executor)
                new_mtime = await loop.run_in_executor(None, logic._strip_png_metadata_and_get_mtime, image_abs_path)
                
                successes.append(path)
                db_updates.append({"path": path, "mtime": new_mtime})

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("UPDATE images SET mtime = ?, last_synced_at = ? WHERE path_canon = ?", 
                                   (update["mtime"], current_time, update["path"]))
                conn.commit()
            except Exception as e:
                db_exception = e
                print(f"🔴 [Holaf-ImageViewer] DB update failed during metadata extraction: {e}")
                for update in db_updates:
                    failures.append({"path": update["path"], "error": "File processed but DB update failed."})
                successes = [s for s in successes if s not in [u["path"] for u in db_updates]]
            finally:
                if conn: holaf_database.close_db_connection(exception=db_exception)

        response_status = "processed"
        if conflicts: response_status = "processed_with_conflicts"
        if not successes and not conflicts and failures: response_status = "failed"
        
        return web.json_response({
            "status": response_status,
            "results": {"successes": successes, "failures": failures, "conflicts": conflicts}
        })

    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON in request"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in extract_metadata_route: {e}")
        traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)


async def inject_metadata_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        force_overwrite = data.get("force", False)

        if not paths_canon:
            return web.json_response({"error": "No image paths provided"}, status=400)
        
        successes, failures, conflicts = [], [], []
        db_updates = []
        
        output_dir = folder_paths.get_output_directory()
        loop = asyncio.get_event_loop()

        for path in paths_canon:
            image_abs_path = os.path.normpath(os.path.join(output_dir, path))
            base_path, _ = os.path.splitext(image_abs_path)

            try:
                # 1. Pre-flight checks
                if not path.lower().endswith('.png'):
                    failures.append({"path": path, "error": "Not a PNG file."})
                    continue
                if not os.path.isfile(image_abs_path):
                    failures.append({"path": path, "error": "File not found on disk."})
                    continue

                json_path = base_path + ".json"
                txt_path = base_path + ".txt"
                has_json = os.path.exists(json_path)
                has_txt = os.path.exists(txt_path)
                if not has_json and not has_txt:
                    failures.append({"path": path, "error": "No .txt or .json sidecar files found to inject."})
                    continue

                # 2. Check for conflicts (image already has internal metadata)
                if not force_overwrite:
                    internal_meta = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, image_abs_path)
                    conflict_details = []
                    if internal_meta.get("workflow_source") == "internal_png":
                        conflict_details.append("Image already contains embedded workflow data.")
                    if internal_meta.get("prompt_source") == "internal_png":
                        conflict_details.append("Image already contains an embedded prompt.")
                    if conflict_details:
                        conflicts.append({"path": path, "error": "Internal metadata conflict.", "details": conflict_details})
                        continue

                # 3. Read sidecar data
                prompt_to_inject, workflow_to_inject = None, None
                if has_txt:
                    async with aiofiles.open(txt_path, 'r', encoding='utf-8') as f:
                        prompt_to_inject = await f.read()
                if has_json:
                    async with aiofiles.open(json_path, 'r', encoding='utf-8') as f:
                        workflow_to_inject = json.loads(await f.read())

                # 4. Inject metadata (blocking, in executor)
                new_mtime = await loop.run_in_executor(None, logic._inject_png_metadata_and_get_mtime, image_abs_path, prompt_to_inject, workflow_to_inject)
                
                # 5. Delete sidecar files upon successful injection
                if has_txt:
                    try:
                        os.remove(txt_path)
                    except OSError as e:
                        print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {txt_path}: {e}")
                if has_json:
                    try:
                        os.remove(json_path)
                    except OSError as e:
                        print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {json_path}: {e}")

                successes.append(path)
                db_updates.append({"path": path, "mtime": new_mtime})

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("UPDATE images SET mtime = ?, last_synced_at = ? WHERE path_canon = ?", 
                                   (update["mtime"], current_time, update["path"]))
                conn.commit()
            except Exception as e:
                db_exception = e
                print(f"🔴 [Holaf-ImageViewer] DB update failed during metadata injection: {e}")
                for update in db_updates:
                    failures.append({"path": update["path"], "error": "File processed but DB update failed."})
                successes = [s for s in successes if s not in [u["path"] for u in db_updates]]
            finally:
                if conn: holaf_database.close_db_connection(exception=db_exception)
        
        response_status = "processed"
        if conflicts: response_status = "processed_with_conflicts"
        if not successes and not conflicts and failures: response_status = "failed"
        
        return web.json_response({
            "status": response_status,
            "results": {"successes": successes, "failures": failures, "conflicts": conflicts}
        })

    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON in request"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in inject_metadata_route: {e}")
        traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)


async def prepare_export_route(request: web.Request):
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon", [])
        export_format = data.get("export_format", "png").lower()
        include_meta = data.get("include_meta", False)
        meta_method = data.get("meta_method", "embed")

        if not paths_canon:
            return web.json_response({"status": "error", "message": "No images selected for export."}, status=400)
        if export_format not in ['png', 'jpg', 'tiff']:
            return web.json_response({"status": "error", "message": f"Invalid export format: {export_format}"}, status=400)

        export_id = str(uuid.uuid4())
        export_dir = os.path.join(holaf_utils.TEMP_EXPORT_DIR, export_id)
        os.makedirs(export_dir, exist_ok=True)
        
        output_dir = folder_paths.get_output_directory()
        manifest = []
        errors = []
        
        loop = asyncio.get_event_loop()

        for path_canon in paths_canon:
            source_abs_path = os.path.normpath(os.path.join(output_dir, path_canon))
            if not os.path.isfile(source_abs_path):
                errors.append({"path": path_canon, "error": "File not found on disk."})
                continue
            
            subfolder, original_filename = os.path.split(path_canon)
            dest_subfolder_abs_path = os.path.join(export_dir, subfolder)
            os.makedirs(dest_subfolder_abs_path, exist_ok=True)
            
            base_name, original_ext = os.path.splitext(original_filename)
            dest_filename = f"{base_name}.{export_format}"
            dest_abs_path = os.path.join(dest_subfolder_abs_path, dest_filename)

            try:
                prompt_data, workflow_data = None, None
                if include_meta:
                    metadata = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, source_abs_path)
                    if metadata and not metadata.get("error"):
                        prompt_data = metadata.get("prompt")
                        workflow_data = metadata.get("workflow")

                with Image.open(source_abs_path) as img:
                    img_to_save = img.copy() # CORRECTED: Ensure we work on a copy
                    save_params = {}

                    if export_format == 'png' and include_meta and meta_method == 'embed':
                        png_info = logic.PngImagePlugin.PngInfo()
                        if prompt_data: png_info.add_text("prompt", prompt_data)
                        if workflow_data: png_info.add_text("workflow", json.dumps(workflow_data))
                        if png_info.chunks: save_params['pnginfo'] = png_info
                    
                    # Ensure conversion for formats that don't support alpha
                    if export_format == 'jpg':
                        if img_to_save.mode in ['RGBA', 'P', 'LA']: img_to_save = img_to_save.convert('RGB')
                        save_params['quality'] = 95
                    elif export_format == 'tiff':
                        save_params['compression'] = 'tiff_lzw'

                    img_to_save.save(dest_abs_path, format=export_format.upper(), **save_params)

                rel_path = os.path.join(subfolder, dest_filename).replace(os.sep, '/')
                manifest.append({'path': rel_path, 'size': os.path.getsize(dest_abs_path)})
                
                if include_meta and meta_method == 'sidecar':
                    if prompt_data:
                        txt_path = os.path.join(dest_subfolder_abs_path, f"{base_name}.txt")
                        async with aiofiles.open(txt_path, 'w', encoding='utf-8') as f: await f.write(prompt_data)
                        txt_rel_path = os.path.join(subfolder, f"{base_name}.txt").replace(os.sep, '/')
                        manifest.append({'path': txt_rel_path, 'size': os.path.getsize(txt_path)})
                    if workflow_data:
                        json_path = os.path.join(dest_subfolder_abs_path, f"{base_name}.json")
                        async with aiofiles.open(json_path, 'w', encoding='utf-8') as f: await f.write(json.dumps(workflow_data, indent=2))
                        json_rel_path = os.path.join(subfolder, f"{base_name}.json").replace(os.sep, '/')
                        manifest.append({'path': json_rel_path, 'size': os.path.getsize(json_path)})

            except Exception as e:
                errors.append({"path": path_canon, "error": f"Failed to process: {str(e)}"})
                traceback.print_exc()

        manifest_path = os.path.join(export_dir, 'manifest.json')
        with open(manifest_path, 'w', encoding='utf-8') as f: json.dump(manifest, f)
        
        return web.json_response({ "status": "ok", "export_id": export_id, "errors": errors })
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def download_export_chunk_route(request: web.Request):
    try:
        export_id = holaf_utils.sanitize_upload_id(request.query.get("export_id"))
        file_path_rel = request.query.get("file_path") # Not sanitized here, path is relative to export_id dir
        chunk_index = int(request.query.get("chunk_index"))
        chunk_size = int(request.query.get("chunk_size"))

        if not all([export_id, file_path_rel, chunk_index is not None, chunk_size]):
            return web.Response(status=400, text="Missing parameters.")

        base_export_dir = os.path.normpath(holaf_utils.TEMP_EXPORT_DIR)
        target_file_abs = os.path.normpath(os.path.join(base_export_dir, export_id, file_path_rel))

        if not target_file_abs.startswith(base_export_dir):
            return web.Response(status=403, text="Access forbidden.")
        if not os.path.isfile(target_file_abs):
            return web.Response(status=404, text="Export file not found.")

        offset = chunk_index * chunk_size
        chunk_data = await holaf_utils.read_file_chunk(target_file_abs, offset, chunk_size)
        if chunk_data is None: raise IOError("File could not be read.")
        return web.Response(body=chunk_data, content_type='application/octet-stream')

    except Exception as e:
        print(f"🔴 [IV-Export] Error downloading chunk: {e}"); traceback.print_exc()
        return web.Response(status=500, text=str(e))


async def set_viewer_activity_route(request: web.Request):
    try:
        data = await request.json()
        is_active = data.get("active", False)
        if not isinstance(is_active, bool):
            return web.json_response({"status": "error", "message": "'active' must be boolean"}, status=400)
        # Modify the state in the imported worker module
        worker.viewer_is_active = is_active
        return web.json_response({"status": "ok", "viewer_active": worker.viewer_is_active})
    except json.JSONDecodeError:
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        print(f"🔴 [Holaf-ImageViewer] Error in set_viewer_activity_route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def prioritize_thumbnails_route(request: web.Request):
    conn = None
    current_exception = None
    try:
        data = await request.json()
        paths_canon = data.get("paths_canon")

        if not paths_canon or not isinstance(paths_canon, list):
            return web.json_response({"status": "error", "message": "'paths_canon' list required."}, status=400)

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        updated_count = 0
        priority_score_for_visible = 10

        for path_canon_str in paths_canon:
            res = cursor.execute("""
                UPDATE images
                SET thumbnail_status = CASE thumbnail_status WHEN 0 THEN 1 ELSE thumbnail_status END,
                    thumbnail_priority_score = MIN(thumbnail_priority_score, ?)
                WHERE path_canon = ? AND thumbnail_status IN (0, 1)
            """, (priority_score_for_visible, path_canon_str))
            if res.rowcount > 0:
                updated_count += 1
        conn.commit()
        return web.json_response({"status": "ok", "message": f"{updated_count} thumbnails prioritized."})

    except json.JSONDecodeError as e_json:
        current_exception = e_json
        return web.json_response({"status": "error", "message": "Invalid JSON"}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error in prioritize_thumbnails_route: {e}"); traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def get_thumbnail_stats_route(request: web.Request):
    conn = None
    current_exception = None
    default_response = {"total_db_count": 0, "generated_thumbnails_count": 0}
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM images WHERE is_trashed = 0") # Only non-trashed
        total_db_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM images WHERE thumbnail_status = 2 AND is_trashed = 0") # Only non-trashed
        generated_thumbnails_count = cursor.fetchone()[0]
        conn.commit() 

        return web.json_response({
            "total_db_count": total_db_count,
            "generated_thumbnails_count": generated_thumbnails_count,
        })
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error getting thumbnail stats: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e), **default_response}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)