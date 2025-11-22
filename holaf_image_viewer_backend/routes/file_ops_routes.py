# === Holaf Utilities - Image Viewer API Routes (File Operations) ===
import os
import shutil
import json
import traceback

from aiohttp import web
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database

# --- API Route Handlers ---
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
                
                # Move associated .txt, .json, .edt, and .xmp files
                base_original_path, _ = os.path.splitext(original_full_path)
                base_dest_path_in_trash, _ = os.path.splitext(destination_full_path_in_trash)

                for meta_ext in ['.txt', '.json', '.edt', '.xmp']:
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

                # Move associated .txt, .json, .edt, and .xmp files
                base_path_in_trash, _ = os.path.splitext(current_full_path_in_trash)
                base_restored_path, _ = os.path.splitext(original_full_path_restored)
                
                for meta_ext in ['.txt', '.json', '.edt', '.xmp']:
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
                
                # Delete associated .txt, .json, .edt, and .xmp files
                base_path, _ = os.path.splitext(full_path)
                for meta_ext in ['.txt', '.json', '.edt', '.xmp']:
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