# === Documentation ===
# Author: Holaf, with assistance from Cline (AI Assistant)
# Date: 2025-05-24
#
# Purpose:
# This file provides the server-side logic for the Holaf Model Manager.
# ...
# Design Choices & Rationale (v8 - Duplicate Path Prevention):
# - Added a check in _process_model_item to immediately skip paths already
#   present in found_on_disk_paths for the current scan run. This is the
#   primary defense against UNIQUE constraint errors from reprocessing.
# MODIFIED: Added model_family detection.
# === End Documentation ===

import os
import folder_paths
import sqlite3
import json
import time
import traceback
import re

# --- Globals & Configuration ---
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

EXTENSION_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOLAF_MODELS_DB_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'holaf_models.sqlite3')
MODEL_TYPES_CONFIG_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'model_types.json')

MODEL_TYPE_DEFINITIONS = []
KNOWN_MODEL_EXTENSIONS = {'.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.onnx'}

# --- Model Family Detection Configuration ---
# Order matters: more specific/longer keywords should come first.
# Each tuple: (Family Name, [list of lowercase keywords], optional_model_type_keys_filter)
# If optional_model_type_keys_filter is present, the family is only assigned if model_type_key matches.
MODEL_FAMILY_KEYWORDS = [
    ("Hunyuan-DiT", ["hunyuan-dit-"], ["checkpoints"]), # More specific than just "hunyuan"
    ("Hunyuan", ["hunyuan"], ["checkpoints"]),
    ("Flux", ["flux.1"], ["checkpoints"]), # flux.1 for FLUX.1 models
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
    ("Pony", ["pony"], ["checkpoints", "loras"]), # Often SDXL based
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
    ("SSD-1B", ["ssd-1b", "ssd_1b"], ["checkpoints"]), # SSD-1B is SDXL-distilled
    ("SegMoE", ["segmoe"], ["checkpoints"]),
    ("Yamer", ["yamer"], ["checkpoints"]), # Yamer's models
    ("LCM", ["lcm"], ["checkpoints", "loras"]), # Latent Consistency Models
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
            model_family TEXT, -- New column for specific model family
            size_bytes INTEGER,
            is_directory BOOLEAN DEFAULT 0,
            discovered_at REAL DEFAULT (STRFTIME('%s', 'now')),
            last_scanned_at REAL,
            CONSTRAINT uq_path UNIQUE (path)
        )
        ''')
        conn.commit()

        # Check and add model_family column if it doesn't exist (for upgrades)
        cursor.execute("PRAGMA table_info(models)")
        columns = [info[1] for info in cursor.fetchall()]
        if 'model_family' not in columns:
            cursor.execute("ALTER TABLE models ADD COLUMN model_family TEXT")
            conn.commit()
            print("  [Holaf-ModelManager] Added 'model_family' column to 'models' table.")
        # print(f"  [Holaf-ModelManager] Database initialized successfully at: {HOLAF_MODELS_DB_PATH}")
    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] CRITICAL: Database initialization error: {e}")
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
        # print(f"  [Holaf-ModelManager] Loaded {len(MODEL_TYPE_DEFINITIONS)} model type definitions.")
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


def _get_base_model_roots():
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
                    roots.add(os.path.normpath(path_str))
    
    if not roots: 
        roots.add(os.path.normpath(os.path.join(os.getcwd(), "models"))) 
        print("🟡 [Holaf-ModelManager] Warning: Could not determine ComfyUI model roots reliably, falling back to CWD/models.")
    return list(roots)

def _detect_model_family(filename: str, model_type_key: str) -> str:
    """
    Detects the specific model family based on filename and model type.
    """
    fn_lower = filename.lower()
    
    # Check for specific patterns first for diffusers-like structures (if item_name is the folder name)
    if model_type_key == "diffusers": # Example: for diffusers, filename might be the directory name
        # A 'diffusers' model_type_key typically means the filename IS the directory.
        # This could be more complex if we need to inspect model_index.json, etc.
        # For now, we'll rely on the directory name matching keywords if it's a diffuser type.
        pass # Allow normal keyword matching on the directory name for now

    # Iterate through configured keywords
    for family_name, keywords, *type_filters in MODEL_FAMILY_KEYWORDS:
        # Check model_type_key filter if present
        if type_filters:
            allowed_types = type_filters[0]
            if model_type_key not in allowed_types:
                continue # Skip this family if model_type_key doesn't match filter

        for keyword in keywords:
            # Using regex to match keyword as a whole word or part of a compound word
            # This helps avoid partial matches like 'sd' in 'sdxl' if 'sd' is checked after 'sdxl'
            # Or 'lora' in 'kolors'
            # We want to match "sdxl_turbo" or "sdxl-turbo"
            # We can use word boundaries for standalone keywords, or just `in` for substrings.
            # For simplicity and to catch variants like "sdxlvae", "sdxl-base", we use `in`
            # The order in MODEL_FAMILY_KEYWORDS is crucial.
            if keyword in fn_lower:
                return family_name
    
    # Default if no specific family is found
    if model_type_key == "checkpoints":
        return "Generic Checkpoint"
    if model_type_key == "loras":
        return "Generic LoRA"
        
    return "Autre"


def _process_model_item(conn, cursor, item_name, full_path, model_type_key, display_type, storage_hint, allowed_formats, current_time, found_on_disk_paths, db_models_dict):
    full_path = os.path.normpath(full_path) 

    if full_path in found_on_disk_paths:
        return 
    
    is_dir_on_fs = os.path.isdir(full_path)
    model_should_be_directory = (storage_hint == "directory")
    actual_size = 0
    is_valid_model_entry = False

    if model_should_be_directory:
        if is_dir_on_fs:
            actual_size = get_folder_size(full_path)
            is_valid_model_entry = True
    else: 
        if not is_dir_on_fs and os.path.exists(full_path):
            file_ext = os.path.splitext(item_name)[1].lower()
            if not allowed_formats or file_ext in allowed_formats:
                try: 
                    actual_size = os.path.getsize(full_path)
                    is_valid_model_entry = True
                except OSError: 
                    pass 
    
    if is_valid_model_entry:
        found_on_disk_paths.add(full_path)
        
        # Detect model family
        # For diffusers, item_name might be the directory name.
        # For files, item_name is the file name.
        model_family = _detect_model_family(item_name, model_type_key)
            
        existing_model_data = db_models_dict.get(full_path)

        if existing_model_data:
            if (existing_model_data['name'] != item_name or
                existing_model_data['size_bytes'] != actual_size or
                existing_model_data['is_directory'] != model_should_be_directory or
                existing_model_data['display_type'] != display_type or
                existing_model_data['model_type_key'] != model_type_key or
                existing_model_data.get('model_family') != model_family): # Check family change
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
                """, (item_name, full_path, model_type_key, display_type, model_family, 
                      actual_size, model_should_be_directory, current_time, current_time))
            except sqlite3.IntegrityError as ie: 
                print(f"🔴 ERROR during INSERT for {full_path}: {ie}. This path was likely already added in this scan run.")


def scan_and_update_db():
    print("🔵 [Holaf-ModelManager] Starting database scan and update...")
    conn = None
    current_time = time.time()
    found_on_disk_paths = set() 

    try:
        conn = _get_db_connection()
        cursor = conn.cursor()

        # Include model_family in the selection
        cursor.execute("SELECT id, path, name, size_bytes, is_directory, model_type_key, display_type, model_family FROM models")
        db_models_dict = {os.path.normpath(row['path']): dict(row) for row in cursor.fetchall()}

        known_type_folder_names = {td['folder_name'] for td in MODEL_TYPE_DEFINITIONS}

        print("🔵 [Holaf-ModelManager] Phase 1: Scanning known model types...")
        for type_def in MODEL_TYPE_DEFINITIONS:
            model_type_key = type_def['folder_name']
            display_name = type_def['type']
            storage_hint = type_def.get('storage_hint', 'file')
            allowed_formats = set(type_def.get('formats', [])) if storage_hint == 'file' else set()

            if model_type_key not in folder_paths.folder_names_and_paths:
                # Handle 'diffusers' specially if it's not in folder_names_and_paths but is a concept
                if model_type_key == 'diffusers' and 'diffusers' in folder_paths.folder_types:
                    # This logic assumes folder_paths.get_filename_list can handle 'diffusers' if it's a registered type
                    # Or we might need a custom way to list diffuser directories if they are not typical "files"
                    pass # Let it try, get_filename_list might work or return empty
                else:
                    continue # Skip if type not found in comfy's path manager
            
            items_in_type_folder = folder_paths.get_filename_list(model_type_key)
            if not items_in_type_folder:
                continue

            for item_name in items_in_type_folder: 
                full_path = folder_paths.get_full_path(model_type_key, item_name)
                if not full_path or not os.path.exists(full_path): 
                    continue
                
                # For 'diffusers', item_name is usually the directory name, and full_path points to it.
                # The _process_model_item will use item_name (dir name for diffusers) for family detection.
                _process_model_item(conn, cursor, os.path.basename(item_name), full_path, model_type_key, display_name, storage_hint, allowed_formats, current_time, found_on_disk_paths, db_models_dict)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 1 completed.")

        print("🔵 [Holaf-ModelManager] Phase 2: Scanning for unknown directories (files within them)...")
        base_model_root_dirs = _get_base_model_roots()
        
        for root_dir in base_model_root_dirs:
            if not os.path.isdir(root_dir):
                continue
            
            for top_level_item_name in os.listdir(root_dir):
                top_level_item_path = os.path.join(root_dir, top_level_item_name)
                
                if os.path.isdir(top_level_item_path) and top_level_item_name not in known_type_folder_names:
                    display_type_for_unknown_dir_files = f"Autres ({top_level_item_name})" 
                    # Use a generic key, or derive one. This key is for internal grouping.
                    model_type_key_for_unknown_dir_files = f"unknown_dir_{top_level_item_name}"

                    for dirpath, _, filenames in os.walk(top_level_item_path):
                        for fname in filenames:
                            file_ext = os.path.splitext(fname)[1].lower()
                            if file_ext in KNOWN_MODEL_EXTENSIONS: 
                                model_full_path = os.path.join(dirpath, fname)
                                # For these files, the model_type_key is a bit artificial.
                                # The family detection will mostly rely on filename.
                                _process_model_item(conn, cursor, fname, model_full_path, model_type_key_for_unknown_dir_files, display_type_for_unknown_dir_files, "file", {file_ext}, current_time, found_on_disk_paths, db_models_dict)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 2 completed.")

        print("🔵 [Holaf-ModelManager] Phase 3: Cleaning up old entries...")
        db_paths_to_remove = set(db_models_dict.keys()) - found_on_disk_paths 
        if db_paths_to_remove:
            for path_to_remove in db_paths_to_remove: 
                cursor.execute("DELETE FROM models WHERE path = ?", (path_to_remove,))
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
        if conn:
            conn.close()


def get_all_models_from_db():
    conn = None
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        # Select the new model_family column
        cursor.execute("""
            SELECT id, name, path, model_type_key, display_type, model_family, 
                   size_bytes, is_directory, discovered_at, last_scanned_at 
            FROM models 
            ORDER BY display_type COLLATE NOCASE, model_family COLLATE NOCASE, name COLLATE NOCASE
        """)
        
        models_data = []
        comfyui_base_path = os.path.normpath(folder_paths.base_path)

        for row in cursor.fetchall():
            model_dict = dict(row)
            original_path = os.path.normpath(model_dict["path"])
            
            try:
                if original_path.startswith(comfyui_base_path + os.sep):
                    model_dict["path"] = os.path.relpath(original_path, comfyui_base_path)
            except ValueError:
                pass 

            models_data.append(model_dict)
        
        return models_data
    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] Error fetching models from DB: {e}")
        return []
    finally:
        if conn:
            conn.close()

def is_path_safe_for_deletion(path_to_delete, is_directory_model=False):
    safe_path = os.path.normpath(path_to_delete)
    all_model_root_dirs = _get_base_model_roots() 

    if not all_model_root_dirs:
        print(f"🔴 [Holaf-ModelManager] SECURITY: Could not determine valid model directories. Deletion blocked for: {safe_path}")
        return False

    is_safe = False
    for valid_dir_root in all_model_root_dirs:
        abs_valid_dir_root = os.path.abspath(valid_dir_root)
        abs_safe_path = os.path.abspath(safe_path)

        if os.path.commonpath([abs_safe_path, abs_valid_dir_root]) == abs_valid_dir_root:
            target_exists_correctly = (is_directory_model and os.path.isdir(abs_safe_path)) or \
                                      (not is_directory_model and os.path.isfile(abs_safe_path))
            
            if target_exists_correctly and abs_safe_path != abs_valid_dir_root:
                is_safe = True
                break
    
    if not is_safe:
        print(f"🔴 [Holaf-ModelManager] SECURITY: Attempt to access/delete item '{safe_path}' outside of or as a root model directory was blocked.")
    return is_safe

# --- Initialization ---
load_model_type_definitions()
init_db() # This will now also handle the model_family column.
scan_and_update_db() 
print("  > [Holaf-ModelManager] Holaf Model Manager DB Initialized & Scanned (with family detection).")