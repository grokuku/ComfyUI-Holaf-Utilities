# === Holaf Utilities - Dependency Manager ===
import os
import sys
import shutil
import json
import urllib.request
import zipfile
import tarfile
import stat
import tempfile
import traceback

# --- Configuration ---
REPO_OWNER = "nihui"
REPO_NAME = "rife-ncnn-vulkan"
FALLBACK_VERSION = "20221029" # Stable release widely used

# Define where binaries live: holaf_image_viewer_backend/bin/rife
BASE_DIR = os.path.dirname(__file__)
BIN_DIR = os.path.join(BASE_DIR, "bin")
RIFE_DIR = os.path.join(BIN_DIR, "rife-ncnn-vulkan")

def get_platform_info():
    """
    Returns (os_name, executable_name)
    os_name: 'windows', 'ubuntu', 'macos' matching the release naming convention.
    """
    if sys.platform.startswith("win"):
        return "windows", "rife-ncnn-vulkan.exe"
    elif sys.platform.startswith("linux"):
        return "ubuntu", "rife-ncnn-vulkan"
    elif sys.platform == "darwin":
        return "macos", "rife-ncnn-vulkan"
    else:
        raise OSError(f"Unsupported platform: {sys.platform}")

def get_rife_executable_path():
    """Returns the absolute path to the RIFE executable if it exists."""
    _, exe_name = get_platform_info()
    exe_path = os.path.join(RIFE_DIR, exe_name)
    if os.path.isfile(exe_path):
        return exe_path
    return None

def _download_file(url, target_path):
    print(f"⬇️ [Holaf-Deps] Downloading: {url}")
    try:
        with urllib.request.urlopen(url) as response, open(target_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
    except Exception as e:
        print(f"🔴 [Holaf-Deps] Download failed: {e}")
        raise

def _get_latest_release_url(os_key):
    """
    Tries to get the latest release URL via GitHub API.
    Falls back to hardcoded version if API fails (rate limits).
    """
    api_url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest"
    fallback_url = f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{FALLBACK_VERSION}/{REPO_NAME}-{FALLBACK_VERSION}-{os_key}.zip"
    
    try:
        print(f"🔍 [Holaf-Deps] Checking GitHub API for latest release...")
        req = urllib.request.Request(api_url)
        # GitHub requires a User-Agent
        req.add_header('User-Agent', 'Holaf-ImageViewer')
        
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            
            # Find asset ending with -{os_key}.zip
            for asset in data.get('assets', []):
                name = asset.get('name', '').lower()
                if f"-{os_key}.zip" in name:
                    print(f"✅ [Holaf-Deps] Found latest release: {name}")
                    return asset.get('browser_download_url')
                    
    except Exception as e:
        print(f"🟡 [Holaf-Deps] GitHub API check failed ({e}), using fallback version {FALLBACK_VERSION}.")
        
    return fallback_url

def install_rife():
    """
    Downloads and installs RIFE into bin/rife-ncnn-vulkan/.
    """
    try:
        os_key, exe_name = get_platform_info()
        
        # 1. Create Bin Dir
        if not os.path.exists(BIN_DIR):
            os.makedirs(BIN_DIR, exist_ok=True)
            
        # 2. Get URL
        download_url = _get_latest_release_url(os_key)
        
        # 3. Download to Temp
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = os.path.join(temp_dir, "rife.zip")
            _download_file(download_url, zip_path)
            
            print("📦 [Holaf-Deps] Extracting...")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
                
            # 4. Locate the inner folder (archives usually contain a root folder)
            extracted_root = None
            for item in os.listdir(temp_dir):
                full_path = os.path.join(temp_dir, item)
                if os.path.isdir(full_path) and "rife" in item.lower():
                    extracted_root = full_path
                    break
            
            # Fallback if zip is flat (unlikely but possible)
            if not extracted_root:
                extracted_root = temp_dir

            # 5. Move content to final destination
            # FIX: Backup the existing installation BEFORE deleting it.
            # If shutil.move fails (disk full, permissions), the old installation
            # is restored instead of leaving the user with nothing.
            backup_dir = None
            if os.path.exists(RIFE_DIR):
                backup_dir = RIFE_DIR + "_old"
                # Remove any stale backup first
                if os.path.exists(backup_dir):
                    shutil.rmtree(backup_dir)
                shutil.move(RIFE_DIR, backup_dir)
                print(f"📦 [Holaf-Deps] Backed up existing installation to {os.path.basename(backup_dir)}")

            # Move the FOLDER, not just content, to ensure structure
            # shutil.move needs the destination to NOT exist if we want to rename the source to it
            try:
                shutil.move(extracted_root, RIFE_DIR)
            except Exception as move_err:
                # Restore backup if the move failed
                if backup_dir and os.path.exists(backup_dir):
                    shutil.move(backup_dir, RIFE_DIR)
                    print(f"🟡 [Holaf-Deps] Install failed, restored previous RIFE installation.")
                raise move_err
            
            # 6. Set Permissions (Linux/Mac)
            final_exe_path = os.path.join(RIFE_DIR, exe_name)
            if not os.path.isfile(final_exe_path):
                # Try finding it if structure was weird
                for root, dirs, files in os.walk(RIFE_DIR):
                    if exe_name in files:
                        final_exe_path = os.path.join(root, exe_name)
                        break
            
            if os.path.isfile(final_exe_path):
                st = os.stat(final_exe_path)
                os.chmod(final_exe_path, st.st_mode | stat.S_IEXEC)
                print(f"✅ [Holaf-Deps] RIFE installed successfully at: {final_exe_path}")
                return True
            else:
                print("🔴 [Holaf-Deps] Error: Executable not found after extraction.")
                return False

    except Exception as e:
        print(f"🔴 [Holaf-Deps] Failed to install RIFE: {e}")
        traceback.print_exc()
        return False

def ensure_rife_ready():
    """
    Public entry point. Checks existence, attempts install if missing.
    Returns path to executable or None.
    """
    path = get_rife_executable_path()
    if path:
        return path
    
    print("running install...")
    print("🔵 [Holaf-Deps] RIFE not found. Initiating automatic download...")
    if install_rife():
        return get_rife_executable_path()
    
    return None

if __name__ == "__main__":
    # Test run
    ensure_rife_ready()