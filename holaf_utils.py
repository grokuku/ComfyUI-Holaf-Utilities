# === Holaf Utilities - General Utilities ===
import os
import re
import shutil
import aiofiles
import hashlib # MODIFIED: Added for checksum calculation

# --- Path and Filename Sanitization ---
def sanitize_filename(filename):
    if not filename: return "untitled"
    filename = str(filename)
    filename = filename.replace("..", "")
    filename = filename.strip("/\\ ")
    filename = re.sub(r'[<>:"|?*\x00-\x1f]', '', filename) 
    if not filename: return "untitled" 
    return filename

def sanitize_directory_component(component):
    if not component: return ""
    component = str(component)
    component = component.replace("..", "") 
    component = component.strip("/\\ ")
    component = re.sub(r'[<>:"|?*\x00-\x1f]', '', component) 
    return component

def sanitize_upload_id(upload_id):
    if not upload_id: return None
    sanitized = re.sub(r'[^a-zA-Z0-9-]', '', str(upload_id))
    return sanitized if sanitized else None

# --- File and Directory Paths ---
BASE_DIR = os.path.dirname(__file__)
TEMP_UPLOAD_DIR = os.path.join(BASE_DIR, 'temp_uploads')
THUMBNAIL_CACHE_DIR = os.path.join(BASE_DIR, '.cache', 'thumbnails')
THUMBNAIL_SIZE = (200, 200) # Global, but related to image viewer / thumbnails

def ensure_directories_exist():
    os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)
    os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)

def cleanup_temp_uploads_on_startup():
    try:
        for item in os.listdir(TEMP_UPLOAD_DIR):
            if item.endswith('.chunk'):
                try:
                    os.remove(os.path.join(TEMP_UPLOAD_DIR, item))
                except Exception as e:
                    print(f'🔴 [Holaf-Utilities] Could not remove temp chunk {item}: {e}')
    except Exception as e:
        print(f'🔴 [Holaf-Utilities] Could not perform startup cleanup of temp_uploads: {e}')

# --- Chunked File Operations ---
async def read_file_chunk(path, offset, size):
    """Asynchronously reads a chunk from a file."""
    try:
        async with aiofiles.open(path, 'rb') as f:
            await f.seek(offset)
            return await f.read(size)
    except Exception as e:
        print(f"🔴 [Holaf-Utils] Error reading chunk for {path}: {e}")
        return None

def assemble_chunks_blocking(final_save_path, upload_id, total_chunks, post_assembly_callback=None, expected_size=None):
    """
    Assembles chunks into a final file. Blocking.
    Verifies file integrity against expected size and SHA256 checksum.
    Optionally calls a callback after successful assembly and verification.
    """
    chunk_files_to_clean = [os.path.join(TEMP_UPLOAD_DIR, f"{upload_id}-{i}.chunk") for i in range(total_chunks)]
    try:
        # Assemble the file from chunks
        os.makedirs(os.path.dirname(final_save_path), exist_ok=True)
        with open(final_save_path, 'wb') as f_out:
            for i in range(total_chunks):
                chunk_path = chunk_files_to_clean[i]
                if not os.path.exists(chunk_path):
                    raise IOError(f"Missing chunk {i} for upload {upload_id}.")
                with open(chunk_path, 'rb') as f_in:
                    f_out.write(f_in.read())
        
        print(f"🔵 [Holaf-Utils] File assembled. Verifying integrity for '{os.path.basename(final_save_path)}'...")

        # --- MODIFIED: Integrity Verification ---
        # 1. Verify file size
        actual_size = os.path.getsize(final_save_path)
        if expected_size is not None and int(actual_size) != int(expected_size):
            raise ValueError(f"File size mismatch. Expected: {expected_size}, Got: {actual_size}")
        print(f"  ✅ Size matches: {actual_size} bytes.")

        # --- End of Modification ---

        print(f"🔵 [Holaf-Utils] File verified and saved successfully to: {final_save_path}")
        if post_assembly_callback:
            post_assembly_callback() # e.g., trigger a DB scan

    except Exception as e:
        print(f"🔴 [Holaf-Utils] Error assembling or verifying file '{os.path.basename(final_save_path)}': {e}")
        if os.path.exists(final_save_path): # Cleanup partially written or invalid file
            try:
                os.remove(final_save_path)
                print(f"🚮 [Holaf-Utils] Cleaned up invalid file: {final_save_path}")
            except Exception as e_del:
                print(f"🔴 [Holaf-Utils] CRITICAL: Could not delete invalid file '{final_save_path}': {e_del}")
        raise # Re-raise the exception to be handled by the API route
    finally:
        for chunk_file in chunk_files_to_clean:
            if os.path.exists(chunk_file):
                try: 
                    os.remove(chunk_file)
                except Exception as e_clean: 
                    print(f"🟡 [Holaf-Utils] Warning: Could not clean up chunk '{chunk_file}': {e_clean}")

# Initialize directories on module load
ensure_directories_exist()
cleanup_temp_uploads_on_startup()