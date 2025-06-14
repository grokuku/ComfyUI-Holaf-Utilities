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
# === End Documentation ===

import os
import folder_paths
import sqlite3
import json
import time
import traceback

# --- Globals & Configuration ---
# ... (inchangé) ...
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

EXTENSION_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOLAF_MODELS_DB_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'holaf_models.sqlite3')
MODEL_TYPES_CONFIG_PATH = os.path.join(EXTENSION_BASE_DIR, '..', 'model_types.json')

MODEL_TYPE_DEFINITIONS = []
KNOWN_MODEL_EXTENSIONS = {'.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.onnx'}

# --- Database Management ---
# ... (init_db, load_model_type_definitions inchangés) ...
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
            size_bytes INTEGER,
            is_directory BOOLEAN DEFAULT 0,
            discovered_at REAL DEFAULT (STRFTIME('%s', 'now')),
            last_scanned_at REAL,
            CONSTRAINT uq_path UNIQUE (path)
        )
        ''')
        conn.commit()
        # print(f"  [Holaf-ModelManager] Database initialized successfully at: {HOLAF_MODELS_DB_PATH}") # Moins verbeux
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
        # print(f"  [Holaf-ModelManager] Loaded {len(MODEL_TYPE_DEFINITIONS)} model type definitions.") # Moins verbeux
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
    # ... (inchangé)
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
    # print(f"DEBUG: Base model roots: {list(roots)}")    
    return list(roots)


def _process_model_item(conn, cursor, item_name, full_path, model_type_key, display_type, storage_hint, allowed_formats, current_time, found_on_disk_paths, db_models_dict):
    full_path = os.path.normpath(full_path) 

    if full_path in found_on_disk_paths: # <--- MODIFICATION CRUCIALE ICI
        # print(f"🔵 DEBUG _process_model_item: Path '{full_path}' already in found_on_disk_paths. Skipping duplicate processing.")
        return 
    
    # print(f"🔵 DEBUG _process_model_item: Processing item: Name='{item_name}', Path='{full_path}', TypeKey='{model_type_key}'")

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
        found_on_disk_paths.add(full_path) # Add to set *after* validation and *before* DB ops for this path
        
        # print(f"🔵 DEBUG _process_model_item: Item valid. Path to check in db_models_dict: '{full_path}'")
        # if full_path in db_models_dict:
        #     print(f"🔵 DEBUG _process_model_item: Path '{full_path}' FOUND in db_models_dict. DB ID: {db_models_dict[full_path]['id']}. Expecting UPDATE.")
        # else:
        #     print(f"🟡 DEBUG _process_model_item: Path '{full_path}' NOT FOUND in db_models_dict. Expecting INSERT.")
            
        existing_model_data = db_models_dict.get(full_path)

        if existing_model_data:
            if (existing_model_data['name'] != item_name or
                existing_model_data['size_bytes'] != actual_size or
                existing_model_data['is_directory'] != model_should_be_directory or
                existing_model_data['display_type'] != display_type or
                existing_model_data['model_type_key'] != model_type_key):
                # print(f"🔵 DEBUG _process_model_item: Updating model {full_path}")
                cursor.execute("""
                    UPDATE models 
                    SET name = ?, size_bytes = ?, is_directory = ?, model_type_key = ?, display_type = ?, last_scanned_at = ?
                    WHERE id = ?
                """, (item_name, actual_size, model_should_be_directory, model_type_key, display_type, current_time, existing_model_data['id']))
            else: 
                cursor.execute("UPDATE models SET last_scanned_at = ? WHERE id = ?", (current_time, existing_model_data['id']))
        else: 
            # print(f"🟡 DEBUG _process_model_item: Inserting new model {full_path}")
            try:
                cursor.execute("""
                    INSERT INTO models (name, path, model_type_key, display_type, size_bytes, is_directory, discovered_at, last_scanned_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (item_name, full_path, model_type_key, display_type, actual_size, model_should_be_directory, current_time, current_time))
            except sqlite3.IntegrityError as ie: 
                print(f"🔴 ERROR during INSERT for {full_path}: {ie}. This path was likely already added in this scan run by a different processing path or a subtle duplication. Skipped via found_on_disk_paths normally.")
    # else:
    #      print(f"🟡 DEBUG _process_model_item: Item {full_path} (key: {model_type_key}) invalid or skipped. IsDirFS:{is_dir_on_fs}, ShouldBeDir:{model_should_be_directory}, Formats:{allowed_formats}, Ext:{os.path.splitext(item_name)[1].lower() if not is_dir_on_fs else 'N/A'}")


def scan_and_update_db():
    print("🔵 [Holaf-ModelManager] Starting database scan and update...")
    conn = None
    current_time = time.time()
    found_on_disk_paths = set() 

    try:
        conn = _get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id, path, name, size_bytes, is_directory, model_type_key, display_type FROM models")
        db_models_dict = {os.path.normpath(row['path']): dict(row) for row in cursor.fetchall()}

        known_type_folder_names = {td['folder_name'] for td in MODEL_TYPE_DEFINITIONS}

        print("🔵 [Holaf-ModelManager] Phase 1: Scanning known model types...")
        for type_def in MODEL_TYPE_DEFINITIONS:
            model_type_key = type_def['folder_name']
            display_name = type_def['type']
            storage_hint = type_def.get('storage_hint', 'file')
            allowed_formats = set(type_def.get('formats', [])) if storage_hint == 'file' else set()

            if model_type_key not in folder_paths.folder_names_and_paths:
                continue 
            
            items_in_type_folder = folder_paths.get_filename_list(model_type_key)
            if not items_in_type_folder:
                continue

            for item_name in items_in_type_folder: 
                full_path = folder_paths.get_full_path(model_type_key, item_name)
                if not full_path or not os.path.exists(full_path): 
                    continue
                
                _process_model_item(conn, cursor, os.path.basename(item_name), full_path, model_type_key, display_name, storage_hint, allowed_formats, current_time, found_on_disk_paths, db_models_dict)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 1 completed.")

        print("🔵 [Holaf-ModelManager] Phase 2: Scanning for unknown directories...")
        base_model_root_dirs = _get_base_model_roots()
        
        for root_dir in base_model_root_dirs:
            if not os.path.isdir(root_dir):
                continue
            
            # print(f"DEBUG: Phase 2 scanning root_dir: {root_dir}")
            for top_level_item_name in os.listdir(root_dir):
                top_level_item_path = os.path.join(root_dir, top_level_item_name)
                
                if os.path.isdir(top_level_item_path) and top_level_item_name not in known_type_folder_names:
                    # print(f"DEBUG: Phase 2 found unknown directory: {top_level_item_path}")
                    display_type_for_unknown = f"Autres ({top_level_item_name})" 
                    model_type_key_for_unknown = f"unknown_{top_level_item_name}"

                    for dirpath, _, filenames in os.walk(top_level_item_path):
                        for fname in filenames:
                            file_ext = os.path.splitext(fname)[1].lower()
                            if file_ext in KNOWN_MODEL_EXTENSIONS: 
                                model_full_path = os.path.join(dirpath, fname)
                                _process_model_item(conn, cursor, fname, model_full_path, model_type_key_for_unknown, display_type_for_unknown, "file", {file_ext}, current_time, found_on_disk_paths, db_models_dict)
        
        conn.commit()
        print("✅ [Holaf-ModelManager] Phase 2 completed.")

        print("🔵 [Holaf-ModelManager] Phase 3: Cleaning up old entries...")
        db_paths_to_remove = set(db_models_dict.keys()) - found_on_disk_paths 
        if db_paths_to_remove:
            # print(f"🔵 [Holaf-ModelManager] Removing {len(db_paths_to_remove)} models from DB not found on disk.")
            for path_to_remove in db_paths_to_remove: 
                cursor.execute("DELETE FROM models WHERE path = ?", (path_to_remove,))
            conn.commit()
        print("✅ [Holaf-ModelManager] Phase 3 completed.")
        print("✅ [Holaf-ModelManager] Database scan and update fully completed.")

    except sqlite3.Error as e:
        print(f"🔴 [Holaf-ModelManager] SQLite error during scan_and_update_db: {e}")
        # traceback.print_exc() 
        if conn: conn.rollback()
    except Exception as e:
        print(f"🔴 [Holaf-ModelManager] General error during scan_and_update_db: {e}")
        traceback.print_exc()
        if conn: conn.rollback()
    finally:
        if conn:
            conn.close()

# ... (get_all_models_from_db, is_path_safe_for_deletion inchangés) ...
def get_all_models_from_db():
    conn = None
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, path, model_type_key, display_type, size_bytes, is_directory, discovered_at, last_scanned_at FROM models ORDER BY display_type COLLATE NOCASE, name COLLATE NOCASE")
        models = [dict(row) for row in cursor.fetchall()]
        return models
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
# print("  > [Holaf-ModelManager] Helper module loading...") # Moins verbeux
load_model_type_definitions()
init_db()
scan_and_update_db() 
print("  > [Holaf-ModelManager] Holaf Model Manager DB Initialized & Scanned.")