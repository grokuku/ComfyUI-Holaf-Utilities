# === Holaf Utilities - Image Viewer API Routes (Metadata) ===
import asyncio
import os
import json
import time
import traceback

import aiofiles
from aiohttp import web
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database
from ... import holaf_utils

# --- API Route Handlers ---
async def get_metadata_route(request: web.Request):
    filename = request.query.get("filename")
    subfolder = request.query.get("subfolder", "") # Can now include TRASHCAN_DIR_NAME
    if not filename: return web.json_response({"error": "Filename required"}, status=400)
    
    conn, current_exception = None, None
    try:
        output_dir = folder_paths.get_output_directory()
        safe_filename = holaf_utils.sanitize_filename(filename)
        # Path is now constructed directly from subfolder and filename query params
        image_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        image_abs_path = os.path.normpath(os.path.join(output_dir, image_rel_path))

        if not image_abs_path.startswith(os.path.normpath(output_dir)) or \
           not os.path.isfile(image_abs_path):
            return web.json_response({"error": "Image not found or path forbidden"}, status=404)
        
        # --- MODIFICATION: Fetch from DB first, then fallback to blocking extract ---
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT prompt_text, workflow_json, prompt_source, workflow_source, width, height, aspect_ratio_str FROM images WHERE path_canon = ?",
            (image_rel_path,)
        )
        db_data = cursor.fetchone()
        holaf_database.close_db_connection()
        conn = None # Connection is closed, prevent finally block re-closing it.

        if db_data and db_data['workflow_source']: # Use 'workflow_source' as a sign that data is populated
            workflow_data = None
            if db_data['workflow_json']:
                try: workflow_data = json.loads(db_data['workflow_json'])
                except: workflow_data = {"error": "Corrupt workflow JSON in DB"}
            
            return web.json_response({
                "prompt": db_data['prompt_text'],
                "prompt_source": db_data['prompt_source'],
                "workflow": workflow_data,
                "workflow_source": db_data['workflow_source'],
                "width": db_data['width'],
                "height": db_data['height'],
                "ratio": db_data['aspect_ratio_str']
            })

        # Fallback to live extraction if not in DB (e.g., during a race condition with sync)
        loop = asyncio.get_event_loop()
        metadata = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, image_abs_path)

        if "error" in metadata and metadata["error"]: return web.json_response(metadata, status=422)
        return web.json_response(metadata)
        
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error in metadata endpoint for {filename}: {e}"); traceback.print_exc()
        return web.json_response({"error": f"Server error: {e}"}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

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
                db_updates.append({
                    "path": path, "mtime": new_mtime, 
                    "prompt": "" if has_prompt else None, # Clear prompt if it was extracted
                    "workflow": "" if has_workflow else None, # Clear workflow if it was extracted
                    "prompt_source": "external_txt" if has_prompt else "none",
                    "workflow_source": "external_json" if has_workflow else "none"
                })

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("""
                        UPDATE images SET mtime = ?, last_synced_at = ?,
                        prompt_text = ?, workflow_json = ?,
                        prompt_source = ?, workflow_source = ?
                        WHERE path_canon = ?
                    """, (update["mtime"], current_time, 
                          update["prompt"], update["workflow"],
                          update["prompt_source"], update["workflow_source"],
                          update["path"]))
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
                    try: os.remove(txt_path)
                    except OSError as e: print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {txt_path}: {e}")
                if has_json:
                    try: os.remove(json_path)
                    except OSError as e: print(f"🟡 [Holaf-ImageViewer] Warning: Could not remove sidecar file {json_path}: {e}")

                successes.append(path)
                db_updates.append({
                    "path": path, "mtime": new_mtime,
                    "prompt": prompt_to_inject,
                    "workflow": json.dumps(workflow_to_inject) if workflow_to_inject else None,
                    "prompt_source": "internal_png" if prompt_to_inject else "none",
                    "workflow_source": "internal_png" if workflow_to_inject else "none"
                })

            except Exception as e:
                failures.append({"path": path, "error": f"Unexpected server error during processing: {e}"})

        # 6. Perform DB updates in batch
        if db_updates:
            conn, db_exception = None, None
            try:
                conn = holaf_database.get_db_connection()
                cursor, current_time = conn.cursor(), time.time()
                for update in db_updates:
                    cursor.execute("""
                        UPDATE images SET mtime = ?, last_synced_at = ?,
                        prompt_text = ?, workflow_json = ?,
                        prompt_source = ?, workflow_source = ?
                        WHERE path_canon = ?
                    """, (update["mtime"], current_time, 
                          update["prompt"], update["workflow"],
                          update["prompt_source"], update["workflow_source"],
                          update["path"]))
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