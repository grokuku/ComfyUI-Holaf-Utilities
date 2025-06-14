# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-24
#
# Purpose:
# This file provides the server-side logic for the Holaf Model Manager.
# ...
# MODIFIED: Added model_family detection.
# MODIFIED: Added initial deep scan functionality (SHA256, safetensors metadata).
# MODIFIED: Initial scan logic at module load time removed, now handled by __init__.py.
# MODIFIED: Path normalization for DB storage and retrieval to fix deep scan "model not found" issues.
# === End Documentation ===

import os
import folder_paths
import sqlite3
import json
import time
import traceback
import re
import hashlib

# Attempt to import safetensors, crucial for deep scan
try:
    from safetensors import safe_open
    SAFETENSORS_AVAILABLE = True
except ImportError:
    SAFETENSORS_AVAILABLE = False
    print("🟡 [Holaf-ModelManager] 'safetensors' library not found. Deep scan for .safetensors metadata will be disabled.")
    print("   Please install it: pip install safetensors")


# --- Globals & Configuration ---
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

EXTENSION_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOLAF_MODELS_DB_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'holaf_models.sqlite3')
MODEL_TYPES_CONFIG_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'model_types.json')

MODEL_TYPE_DEFINITIONS = []
KNOWN_MODEL_EXTENSIONS = {'.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.onnx'}

MODEL_FAMILY_KEYWORDS = [
    ("Hunyuan-DiT", ["hunyuan-dit-"], ["checkpoints"]),
    ("Hunyuan", ["hunyuan"], ["checkpoints"]),
    ("Flux", ["flux.1"], ["checkpoints"]),
    ("Flux", ["flux"], ["checkpoints"]),
    ("Kolors", ["kolors"], ["checkpoints"]),
    ("Playground v2.5", ["playgroundv2.5"], ["checkpoints"]),
    ("Playground v2", ["playgroundv2"], ["checkpoints"]),
    ("Playground", ["playground"], ["checkpoints"]),
    ("PixArt-Σ", ["pixart-sigma", "pixartsigma"], ["checkpoints"]),
    ("PixArt-α", ["pixart-alpha", "pixartalpha", "pixart_alpha"], ["checkpoints"]),
    ("PixArt", ["pixart"], ["checkpoints"]),
    ("Stable Cascade", ["stable_cascade", "stablecascade"], ["checkpoints"]),
    ("Würstchen", ["würstchen", "wuerstchen"], ["checkpoints", "unet"]),
    ("AuraFlow", ["auraflow"], ["checkpoints"]),
    ("DeepFloyd IF", ["deepfloyd_if", "deepfloydif"], ["checkpoints"]),
    ("Kandinsky 3.x", ["kandinsky3", "kandinsky_3"], ["checkpoints"]),
    ("Kandinsky 2.x", ["kandinsky2", "kandinsky_2"], ["checkpoints"]),
    ("Kandinsky", ["kandinsky"], ["checkpoints"]),
    ("SDXL Turbo", ["sdxl_turbo", "sdxlturbo"], ["checkpoints", "loras"]),
    ("SDXL Lightning", ["sdxl_lightning", "sdxllightning"], ["checkpoints", "loras"]),
    ("SDXL", ["sdxl", "sd_xl"], ["checkpoints", "loras", "unet"]),
    ("Pony", ["pony"], ["checkpoints", "loras"]),
    ("SD 2.1", ["sd2.1", "sd21"], ["checkpoints", "loras"]),
    ("SD 2.0", ["sd2.0", "sd20"], ["checkpoints", "loras"]),
    ("SD 2.x", ["sd2"], ["checkpoints", "loras"]),
    ("SD 1.5", ["sd1.5", "sd15"], ["checkpoints", "loras"]),
    ("SD 1.x", ["sd1"], ["checkpoints", "loras"]),
    ("SVD XT", ["svd_xt", "svdxt"], ["checkpoints", "svd"]),
    ("SVD", ["svd", "stable_video_diffusion"], ["checkpoints", "svd"]),
    ("AnimateDiff", ["animatediff", "motion_module"], ["animatediff_models", "animatediff_motion_lora"]),
    ("HotshotXL", ["hotshotxl", "hotshot_xl"], ["animatediff_models"]),
    ("VideoCrafter", ["videocrafter"], ["checkpoints"]),
    ("Latte", ["latte"], ["checkpoints"]),
    ("OpenSora", ["opensora"], ["checkpoints"]),
    ("SSD-1B", ["ssd-1b", "ssd_1b"], ["checkpoints"]),
    ("SegMoE", ["segmoe"], ["checkpoints"]),
    ("Yamer", ["yamer"], ["checkpoints"]),
    ("LCM", ["lcm"], ["checkpoints", "loras"]),
    ("Hyper-SD", ["hyper-sd", "hypersd"], ["checkpoints", "loras"]),
]


# --- Database Management ---
def _get_db_connection():
    conn = sqlite3.connect(HOLAF_MODELS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = None
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            model_type_key TEXT NOT NULL,
            display_type TEXT,
            model_family TEXT,
            size_bytes INTEGER,
            is_directory BOOLEAN DEFAULT 0,
            discovered_at REAL DEFAULT (STRFTIME('%s', 'now')),
            last_scanned_at REAL,
            -- Columns for deep scan
            sha256_hash TEXT,
            extracted_metadata_json TEXT,
            parsed_tags TEXT,
            parsed_trigger_words TEXT,
            parsed_base_model TEXT,
            parsed_resolution TEXT,
            last_deep_scanned_at REAL, -- Timestamp for last deep scan
            CONSTRAINT uq_path UNIQUE (path)
        )
        ''')
        conn.commit()

        cursor.execute("PRAGMA table_info(models)")
        columns = [info[1] for info in cursor.fetchall()]
        
        def add_column_if_not_exists(col_name, col_type):
            if col_name not in columns:
                try:
                    cursor.execute(f"ALTER TABLE models ADD COLUMN {col_name} {col_type}")
                    conn.commit()
                    print(f"  [Holaf-ModelManager] Added '{col_name}' column to 'models' table.")
                except sqlite3.OperationalError as e: 
                    if "duplicate column name" in str(e).lower():
                        print(f"  [Holaf-ModelManager] Column '{col_name}' already exists.")
                    else:
                        raise e

        add_column_if_not_exists('model_family', 'TEXT')
        add_column_if_not_exists('sha256_hash', 'TEXT')
        add_column_if_not_exists('extracted_metadata_json', 'TEXT')
        add_column_if_not_exists('parsed_tags', 'TEXT')
        add_column_if_not_exists('parsed_trigger_words', 'TEXT')
        add_column_if_not_exists('parsed_base_model', 'TEXT')
        add_column_if_not_exists('parsed_resolution', 'TEXT')
        add_column_if_not_exists('last_deep_scanned_at', 'REAL')

    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] CRITICAL: Database initialization/upgrade error: {e}")
    finally:
        if conn:
            conn.close()


def load_model_type_definitions():
    global MODEL_TYPE_DEFINITIONS
    try:
        if not os.path.exists(MODEL_TYPES_CONFIG_PATH):
            print(f"🔴 [Holaf-ModelManager] CRITICAL: model_types.json not found at {MODEL_TYPES_CONFIG_PATH}")
            return
        with open(MODEL_TYPES_CONFIG_PATH, 'r', encoding='utf-8') as f:
            MODEL_TYPE_DEFINITIONS = json.load(f)
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] CRITICAL: Error loading/parsing model_types.json: {e}")
        MODEL_TYPE_DEFINITIONS = []

# --- Model Scanning and Management ---
def get_folder_size(folder_path):
    total_size = 0
    try:
        for dirpath, dirnames, filenames in os.walk(folder_path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try: 
                        total_size += os.path.getsize(fp)
                    except OSError:
                        pass 
    except OSError as e: 
        print(f"🟡 [Holaf-ModelManager] Warning: Could not fully calculate size for folder {folder_path} due to OS error: {e}")
    return total_size


def _get_base_model_roots(): # Version avant mes "optimisations" non demandées
    roots = set()
    if hasattr(folder_paths, 'models_dir') and folder_paths.models_dir:
        roots.add(os.path.normpath(folder_paths.models_dir))
    elif hasattr(folder_paths, 'base_path'): 
        roots.add(os.path.normpath(os.path.join(folder_paths.base_path, "models")))

    if hasattr(folder_paths, 'folder_names_and_paths'):
        for type_key in folder_paths.folder_names_and_paths.keys():
            type_base_paths = folder_paths.get_folder_paths(type_key) 
            if type_base_paths:
                for path_str in type_base_paths: 
                    if isinstance(path_str, str): 
                         roots.add(os.path.normpath(path_str))
                    elif isinstance(path_str, (list,tuple)): 
                        for sub_path_str in path_str:
                            if isinstance(sub_path_str, str):
                                roots.add(os.path.normpath(sub_path_str))

    if not roots: 
        roots.add(os.path.normpath(os.path.join(os.getcwd(), "models"))) 
        print("🟡 [Holaf-ModelManager] Warning: Could not determine ComfyUI model roots reliably, falling back to CWD/models.")
    return list(roots)


def _detect_model_family(filename: str, model_type_key: str) -> str:
    fn_lower = filename.lower()
    for family_name, keywords, *type_filters in MODEL_FAMILY_KEYWORDS:
        if type_filters:
            allowed_types = type_filters[0]
            if model_type_key not in allowed_types:
                continue
        for keyword in keywords:
            if keyword in fn_lower:
                return family_name
    
    if model_type_key == "checkpoints": return "Generic Checkpoint"
    if model_type_key == "loras": return "Generic LoRA"
    return "Autre"


def _process_model_item(conn, cursor, item_name, abs_fs_path, model_type_key, display_type, storage_hint, allowed_formats, current_time, found_on_disk_paths_canon, db_models_dict_canon_key):
    original_abs_path_norm = os.path.normpath(abs_fs_path) # Path for FS operations

    # Determine path for DB (canonical form: relative with '/' or absolute with '/')
    comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
    path_for_db = original_abs_path_norm
    if original_abs_path_norm.startswith(comfyui_base_path_norm + os.sep):
        path_for_db = os.path.relpath(original_abs_path_norm, comfyui_base_path_norm)
    path_for_db = path_for_db.replace(os.sep, '/') # Ensure slashes

    if path_for_db in found_on_disk_paths_canon: return 
    
    is_dir_on_fs = os.path.isdir(original_abs_path_norm)
    model_should_be_directory = (storage_hint == "directory")
    actual_size = 0
    is_valid_model_entry = False

    if model_should_be_directory:
        if is_dir_on_fs:
            actual_size = get_folder_size(original_abs_path_norm)
            is_valid_model_entry = True
    else: 
        if not is_dir_on_fs and os.path.exists(original_abs_path_norm):
            file_ext = os.path.splitext(item_name)[1].lower()
            if not allowed_formats or file_ext in allowed_formats:
                try: actual_size = os.path.getsize(original_abs_path_norm); is_valid_model_entry = True
                except OSError: pass 
    
    if is_valid_model_entry:
        found_on_disk_paths_canon.add(path_for_db)
        model_family = _detect_model_family(item_name, model_type_key)
        existing_model_data = db_models_dict_canon_key.get(path_for_db)

        if existing_model_data:
            needs_update = (
                existing_model_data['name'] != item_name or
                existing_model_data['size_bytes'] != actual_size or
                existing_model_data['is_directory'] != model_should_be_directory or
                existing_model_data['display_type'] != display_type or
                existing_model_data['model_type_key'] != model_type_key or
                existing_model_data.get('model_family') != model_family
            )
            if needs_update:
                cursor.execute("""
                    UPDATE models 
                    SET name = ?, size_bytes = ?, is_directory = ?, model_type_key = ?, 
                        display_type = ?, model_family = ?, last_scanned_at = ?
                    WHERE id = ?
                """, (item_name, actual_size, model_should_be_directory, model_type_key, 
                      display_type, model_family, current_time, existing_model_data['id']))
            else: 
                cursor.execute("UPDATE models SET last_scanned_at = ? WHERE id = ?", (current_time, existing_model_data['id']))
        else: 
            try:
                cursor.execute("""
                    INSERT INTO models (name, path, model_type_key, display_type, model_family, 
                                        size_bytes, is_directory, discovered_at, last_scanned_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (item_name, path_for_db, model_type_key, display_type, model_family, 
                      actual_size, model_should_be_directory, current_time, current_time))
            except sqlite3.IntegrityError as ie: 
                print(f"🔴 ERROR during INSERT for {path_for_db}: {ie}. This path was likely already added in this scan run.")


def scan_and_update_db():
    print("🔵 [Holaf-ModelManager] Starting database scan and update (via scan_and_update_db)...")
    conn = None
    current_time = time.time()
    found_on_disk_paths_canon = set() # Stores paths in canonical form (slashes, relative if possible)

    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        # Paths in DB are already canonical (slashes, relative if possible) due to previous _process_model_item runs
        cursor.execute("SELECT id, path, name, size_bytes, is_directory, model_type_key, display_type, model_family FROM models")
        db_models_dict_canon_key = {row['path']: dict(row) for row in cursor.fetchall()}
        
        known_type_folder_names = {td['folder_name'] for td in MODEL_TYPE_DEFINITIONS}

        print("🔵 [Holaf-ModelManager] Phase 1: Scanning known model types...")
        for type_def in MODEL_TYPE_DEFINITIONS:
            model_type_key = type_def['folder_name']
            display_name = type_def['type']
            storage_hint = type_def.get('storage_hint', 'file')
            allowed_formats = set(type_def.get('formats', [])) if storage_hint == 'file' else set()

            if model_type_key not in folder_paths.folder_names_and_paths and model_type_key not in folder_paths.folder_names_and_paths.keys():
                 continue
            
            items_in_type_folder = folder_paths.get_filename_list(model_type_key)
            if not items_in_type_folder:
                continue

            for item_name in items_in_type_folder: 
                abs_fs_path = folder_paths.get_full_path(model_type_key, item_name) # This is an OS-specific absolute path
                if not abs_fs_path or not os.path.exists(abs_fs_path): 
                    continue
                _process_model_item(conn, cursor, os.path.basename(item_name), abs_fs_path, model_type_key, display_name, storage_hint, allowed_formats, current_time, found_on_disk_paths_canon, db_models_dict_canon_key)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 1 completed.")

        print("🔵 [Holaf-ModelManager] Phase 2: Scanning for files in 'Other' directories...")
        base_model_root_dirs = _get_base_model_roots()
        
        for root_dir in base_model_root_dirs:
            if not os.path.isdir(root_dir): continue
            
            for top_level_item_name in os.listdir(root_dir):
                top_level_item_abs_fs_path = os.path.join(root_dir, top_level_item_name)
                
                if os.path.isdir(top_level_item_abs_fs_path) and top_level_item_name not in known_type_folder_names:
                    display_type_for_unknown_dir_files = f"Autres ({top_level_item_name})" 
                    model_type_key_for_unknown_dir_files = f"unknown_dir_{top_level_item_name}"

                    for dirpath, _, filenames in os.walk(top_level_item_abs_fs_path):
                        for fname in filenames:
                            file_ext = os.path.splitext(fname)[1].lower()
                            if file_ext in KNOWN_MODEL_EXTENSIONS: 
                                model_abs_fs_path = os.path.join(dirpath, fname) # OS-specific absolute path
                                _process_model_item(conn, cursor, fname, model_abs_fs_path, model_type_key_for_unknown_dir_files, display_type_for_unknown_dir_files, "file", {file_ext}, current_time, found_on_disk_paths_canon, db_models_dict_canon_key)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 2 completed.")

        print("🔵 [Holaf-ModelManager] Phase 3: Cleaning up old entries...")
        db_paths_to_remove = set(db_models_dict_canon_key.keys()) - found_on_disk_paths_canon
        if db_paths_to_remove:
            for path_to_remove_canon in db_paths_to_remove: 
                cursor.execute("DELETE FROM models WHERE path = ?", (path_to_remove_canon,))
            conn.commit()
        print("✅ [Holaf-ModelManager] Phase 3 completed.")
        print("✅ [Holaf-ModelManager] Database scan and update fully completed.")

    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] SQLite error during scan_and_update_db: {e}")
        if conn: conn.rollback()
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] General error during scan_and_update_db: {e}")
        traceback.print_exc()
        if conn: conn.rollback()
    finally:
        if conn: conn.close()


def get_all_models_from_db():
    conn = None
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, path, model_type_key, display_type, model_family, 
                   size_bytes, is_directory, discovered_at, last_scanned_at,
                   sha256_hash, extracted_metadata_json, parsed_tags, 
                   parsed_trigger_words, parsed_base_model, parsed_resolution,
                   last_deep_scanned_at
            FROM models 
            ORDER BY display_type COLLATE NOCASE, model_family COLLATE NOCASE, name COLLATE NOCASE
        """)
        
        models_data = []
        for row in cursor.fetchall():
            model_dict = dict(row)
            # Path from DB is already canonical (slashes, relative if possible)
            # Ensure it's sent with slashes (should be already, but as a safeguard)
            model_dict["path"] = model_dict["path"].replace(os.sep, '/') 
            
            if model_dict["extracted_metadata_json"] == "": 
                model_dict["extracted_metadata_json"] = None

            models_data.append(model_dict)
        
        return models_data
    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] Error fetching models from DB: {e}")
        return []
    finally:
        if conn: conn.close()

def is_path_safe_for_deletion(path_from_client_canon, is_directory_model=False):
    # path_from_client_canon is expected to be in canonical form (slashes, relative or absolute)
    comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
    
    # Reconstruct OS-specific absolute path from canonical client path
    # A canonical relative path won't start with '/' or 'X:/'
    is_client_path_intended_as_absolute = path_from_client_canon.startswith('/') or \
                                          (os.name == 'nt' and len(path_from_client_canon) > 1 and path_from_client_canon[1] == ':' and path_from_client_canon[0].isalpha())

    if not is_client_path_intended_as_absolute:
        # Convert canonical relative path (with '/') to OS-specific absolute path
        abs_path_to_delete_norm = os.path.normpath(os.path.join(comfyui_base_path_norm, path_from_client_canon))
    else:
        # Convert canonical absolute path (with '/') to OS-specific absolute path
        abs_path_to_delete_norm = os.path.normpath(path_from_client_canon)

    all_comfy_model_roots = folder_paths.get_folder_paths(None) 
    if not all_comfy_model_roots: 
        all_comfy_model_roots = [os.path.normpath(folder_paths.models_dir)]

    is_safe = False
    for root_model_dir in all_comfy_model_roots:
        abs_root_model_dir_norm = os.path.abspath(os.path.normpath(root_model_dir))
        # Check if the path to delete is within or is one of the root model directories
        if os.path.commonpath([abs_path_to_delete_norm, abs_root_model_dir_norm]) == abs_root_model_dir_norm:
            target_exists_correctly = (is_directory_model and os.path.isdir(abs_path_to_delete_norm)) or \
                                      (not is_directory_model and os.path.isfile(abs_path_to_delete_norm))
            # Prevent deleting the root model directory itself
            if target_exists_correctly and abs_path_to_delete_norm != abs_root_model_dir_norm:
                is_safe = True
                break
    
    if not is_safe:
        print(f"🔴 [Holaf-ModelManager] SECURITY: Attempt to access/delete item '{abs_path_to_delete_norm}' (from client path '{path_from_client_canon}') outside of recognized ComfyUI model directories was blocked.")
    return is_safe


# --- Deep Scan Functionality ---
def _perform_local_deep_scan_for_model(model_abs_fs_path: str) -> dict: # Takes OS-specific absolute path
    scan_results = {
        "sha256_hash": None, "extracted_metadata_json": None, "parsed_tags": None,
        "parsed_trigger_words": None, "parsed_base_model": None, "parsed_resolution": None,
        "error": None
    }
    if not os.path.isfile(model_abs_fs_path):
        scan_results["error"] = "File not found"
        return scan_results
    try:
        hasher = hashlib.sha256()
        with open(model_abs_fs_path, 'rb') as f:
            while chunk := f.read(8192): 
                hasher.update(chunk)
        scan_results["sha256_hash"] = hasher.hexdigest()
    except Exception as e:
        scan_results["error"] = f"SHA256 calculation failed: {str(e)}"
        print(f"🟡 [Holaf-ModelManager] Deep Scan: SHA256 failed for {model_abs_fs_path}: {e}")

    if model_abs_fs_path.lower().endswith('.safetensors'):
        if not SAFETENSORS_AVAILABLE:
            scan_results["error"] = (scan_results["error"] + "; " if scan_results["error"] else "") + "Safetensors library not available for metadata."
            return scan_results
        try:
            with safe_open(model_abs_fs_path, framework="pt", device="cpu") as sf_file:
                metadata_raw = sf_file.metadata()
                if metadata_raw:
                    scan_results["extracted_metadata_json"] = json.dumps(metadata_raw)
                    scan_results["parsed_tags"] = metadata_raw.get("ss_tag", metadata_raw.get("ss_tags"))
                    scan_results["parsed_trigger_words"] = metadata_raw.get("ss_trigger_words")
                    scan_results["parsed_base_model"] = metadata_raw.get("ss_sd_model_name", metadata_raw.get("ss_base_model_version"))
                    res = metadata_raw.get("ss_resolution")
                    if isinstance(res, (list, tuple)) and len(res) == 2: scan_results["parsed_resolution"] = f"{res[0]}x{res[1]}"
                    elif isinstance(res, str): scan_results["parsed_resolution"] = res
        except Exception as e:
            error_msg = f"Safetensors metadata extraction failed: {str(e)}"
            scan_results["error"] = (scan_results["error"] + "; " if scan_results["error"] else "") + error_msg
            print(f"🟡 [Holaf-ModelManager] Deep Scan: Metadata failed for {model_abs_fs_path}: {e}")
    return scan_results

def process_deep_scan_request(model_paths_from_client_canon: list): # Expects list of canonical paths
    conn = None
    comfyui_base_path_norm = os.path.normpath(folder_paths.base_path)
    results = {"updated_count": 0, "errors": []}
    if not model_paths_from_client_canon:
        results["errors"].append({"path": "N/A", "message": "No model paths provided."})
        return results
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        for client_path_canon in model_paths_from_client_canon: # This is the canonical path from JS
            
            # Reconstruct OS-specific absolute path from canonical client path
            is_client_path_intended_as_absolute = client_path_canon.startswith('/') or \
                                                  (os.name == 'nt' and len(client_path_canon) > 1 and client_path_canon[1] == ':' and client_path_canon[0].isalpha())

            if not is_client_path_intended_as_absolute:
                abs_model_fs_path = os.path.normpath(os.path.join(comfyui_base_path_norm, client_path_canon))
            else:
                abs_model_fs_path = os.path.normpath(client_path_canon)

            if not os.path.isfile(abs_model_fs_path):
                results["errors"].append({"path": client_path_canon, "message": "File not found on server."})
                continue
            
            # Use client_path_canon (which is already canonical) for DB lookup
            cursor.execute("SELECT id, name FROM models WHERE path = ?", (client_path_canon,))
            model_record = cursor.fetchone()
            if not model_record:
                results["errors"].append({"path": client_path_canon, "message": "Model not found in DB. Please rescan general models first."})
                continue

            print(f"🔵 [Holaf-ModelManager] Deep scanning: {model_record['name']} ({client_path_canon})")
            scan_data = _perform_local_deep_scan_for_model(abs_model_fs_path) # Pass OS-specific path here
            if scan_data.get("error"):
                results["errors"].append({"path": client_path_canon, "name": model_record['name'], "message": scan_data["error"]})
            
            update_fields = {
                "sha256_hash": scan_data["sha256_hash"], "extracted_metadata_json": scan_data["extracted_metadata_json"],
                "parsed_tags": scan_data["parsed_tags"], "parsed_trigger_words": scan_data["parsed_trigger_words"],
                "parsed_base_model": scan_data["parsed_base_model"], "parsed_resolution": scan_data["parsed_resolution"],
                "last_deep_scanned_at": time.time()
            }
            update_values = {k: v for k, v in update_fields.items() if v is not None} # Only update fields that have a new value
            if update_values: # Only update if there's something to update
                set_clause = ", ".join([f"{key} = ?" for key in update_values.keys()])
                params = list(update_values.values()) + [client_path_canon] # Use canonical path for WHERE clause
                try:
                    cursor.execute(f"UPDATE models SET {set_clause} WHERE path = ?", params)
                    conn.commit()
                    if cursor.rowcount > 0: results["updated_count"] += 1
                except sqlite3.Error as e_update:
                    results["errors"].append({"path": client_path_canon, "name": model_record['name'], "message": f"DB update failed: {e_update}"})
                    print(f"🔴 [Holaf-ModelManager] Deep Scan DB Update Error for {client_path_canon}: {e_update}")
                    if conn: conn.rollback()
    except sqlite3.Error as e:
        results["errors"].append({"path": "N/A", "message": f"Database error during deep scan: {str(e)}"})
        if conn: conn.rollback()
    except Exception as e_main:
        results["errors"].append({"path": "N/A", "message": f"General error during deep scan: {str(e_main)}"})
        traceback.print_exc()
        if conn: conn.rollback()
    finally:
        if conn: conn.close()
    return results

# --- Initialization ---
load_model_type_definitions()
init_db() 

print("  > [Holaf-ModelManager] Helper module loaded. DB Initialized (with deep scan columns). Scan is scheduled from __init__.py.")