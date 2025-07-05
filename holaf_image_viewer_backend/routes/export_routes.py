# === Holaf Utilities - Image Viewer API Routes (Export) ===
import asyncio
import os
import json
import traceback
import uuid

import aiofiles
from aiohttp import web
from PIL import Image, ImageEnhance
import folder_paths # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_utils

# --- Helper Function to Apply Edits ---
def _apply_pil_edits(image, edit_data):
    """
    Applies edits from a dictionary to a PIL Image object.
    Returns the modified image.
    """
    if not isinstance(edit_data, dict):
        return image

    # Phase 1: Basic adjustments
    if 'brightness' in edit_data:
        enhancer = ImageEnhance.Brightness(image)
        image = enhancer.enhance(float(edit_data['brightness']))
    
    if 'contrast' in edit_data:
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(float(edit_data['contrast']))
        
    if 'saturation' in edit_data:
        # Note: Pillow calls this "Color"
        enhancer = ImageEnhance.Color(image)
        image = enhancer.enhance(float(edit_data['saturation']))
        
    # Placeholder for future edits like crop, etc.
    
    return image


# --- API Route Handlers ---
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
                
                effective_meta_method = meta_method
                if include_meta and effective_meta_method == 'embed' and export_format != 'png':
                    effective_meta_method = 'sidecar'
                    errors.append({"path": path_canon, "error": f"Embed not supported for .{export_format}, fell back to sidecar."})
                
                if include_meta:
                    metadata = await loop.run_in_executor(None, logic._extract_image_metadata_blocking, source_abs_path)
                    if metadata and not metadata.get("error"):
                        prompt_data = metadata.get("prompt")
                        workflow_data = metadata.get("workflow")
                
                edit_file_path = os.path.join(os.path.dirname(source_abs_path), f"{base_name}.edt")
                edit_data = None
                if os.path.isfile(edit_file_path) and os.path.getsize(edit_file_path) > 0:
                    try:
                        with open(edit_file_path, 'r', encoding='utf-8') as f: edit_data = json.load(f)
                    except Exception as e:
                        print(f"🟡 [Holaf-Export] Warning: Could not read or parse edit file {edit_file_path}: {e}")
                        errors.append({"path": path_canon, "error": f"Failed to apply edits: {e}"})

                with Image.open(source_abs_path) as img:
                    img_to_save = img.copy()
                    if edit_data: img_to_save = _apply_pil_edits(img_to_save, edit_data)
                    save_params = {}

                    if export_format == 'png' and include_meta and effective_meta_method == 'embed':
                        png_info = logic.PngImagePlugin.PngInfo()
                        if prompt_data: png_info.add_text("prompt", json.dumps(prompt_data))
                        if workflow_data: png_info.add_text("workflow", json.dumps(workflow_data))
                        if png_info.chunks: save_params['pnginfo'] = png_info
                    
                    if export_format == 'jpg':
                        if img_to_save.mode in ['RGBA', 'P', 'LA']: img_to_save = img_to_save.convert('RGB')
                        save_params['quality'] = 95
                    elif export_format == 'tiff':
                        save_params['compression'] = 'tiff_lzw'

                    img_to_save.save(dest_abs_path, format='JPEG' if export_format == 'jpg' else export_format.upper(), **save_params)
                
                rel_path = os.path.join(subfolder, dest_filename).replace(os.sep, '/')
                manifest.append({'path': rel_path, 'size': os.path.getsize(dest_abs_path)})
                
                if include_meta and effective_meta_method == 'sidecar':
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
        file_path_rel = request.query.get("file_path")
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