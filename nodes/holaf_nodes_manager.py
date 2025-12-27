# === Documentation ===
# Developer: Gemini (AI Assistant), under the direction of Holaf
# Date: 2025-05-24
#
# Purpose:
# This file provides the server-side logic for the Holaf Custom Nodes Manager.
# It handles scanning the custom_nodes directory, detecting Git repositories,
# reading both local and remote README files, and managing node actions.
#
# MODIFIED: Added Git repository detection to find remote URLs.
# MODIFIED: Added function to fetch README content directly from GitHub.
# MODIFIED: Added function to search GitHub for repositories by folder name.
# CORRECTION: Fixed a missing 'except' block in the search_github_for_repo function.
# CORRECTION: Added filter to ignore system folders like '__pycache__' and '.git'.
# CORRECTION: Made local README search case-insensitive and more robust.
# CORRECTION: Switched from 'git -C' to 'subprocess(cwd=...)' for thread-safe execution.
# MODIFIED: Added detection for requirements.txt.
# MODIFIED: Added stubs for action functions (update, delete, install_req).
# MODIFIED: Enabled real commands for node actions (git pull, rmtree, pip install).
# MODIFIED: Changed update logic to use 'git fetch' and 'git reset --hard FETCH_HEAD' for existing git repos.
# MODIFIED: Implemented update strategy for non-Git nodes: backup, clone, restore missing files.
# MODIFIED: update_node_from_git now returns new_status (is_git_repo, repo_url) on successful clone.
# MODIFIED: Added install_custom_node function to clone repositories from URLs.
# MODIFIED: Added search_custom_nodes function to query GitHub API for ComfyUI nodes.
# === End Documentation ===

import os
import folder_paths
import re
import subprocess
import aiohttp
import shutil
import sys # For sys.executable
import time # Added for unique backup folder names

def _sanitize_node_name(node_name_from_client: str) -> str | None:
    """
    Sanitizes the node name to prevent path traversal.
    Allows only alphanumeric characters, underscores, hyphens, and dots.
    Ensures the name is a single path component.
    """
    if not node_name_from_client:
        return None
    
    if "/" in node_name_from_client or "\\" in node_name_from_client:
        return None
        
    if ".." in node_name_from_client:
        return None

    sanitized = re.sub(r'[^a-zA-Z0-9_.-]', '', node_name_from_client)
    
    if not sanitized or all(c == '.' for c in sanitized):
        return None
        
    return sanitized

def _get_git_remote_url(repo_path):
    git_dir = os.path.join(repo_path, '.git')
    if not os.path.isdir(git_dir):
        return None
    try:
        # Try to get the URL of the 'origin' remote
        # This command is more robust if multiple remotes exist or if the default branch isn't 'master' or 'main'
        result = subprocess.run(
            ['git', 'config', '--get', 'remote.origin.url'],
            capture_output=True, text=True, check=True, encoding='utf-8', cwd=repo_path,
            # Add a timeout to prevent hanging if git command has issues
            timeout=10 
        )
        url = result.stdout.strip()
        if url.startswith('git@'): # Convert SSH URL to HTTPS
            url = url.replace(':', '/').replace('git@', 'https://')
        if url.endswith('.git'): # Remove .git suffix for cleaner URL
            url = url[:-4]
        return url
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired)  as e:
        # print(f"🟡 [Holaf-NodesManager] Could not get remote.origin.url for {repo_path}: {e}")
        # Fallback: try to get any remote URL (less specific but might work if 'origin' isn't set up as expected)
        try:
            result_fallback = subprocess.run(
                ['git', 'remote', '-v'],
                capture_output=True, text=True, check=True, encoding='utf-8', cwd=repo_path, timeout=10
            )
            remotes = result_fallback.stdout.strip().splitlines()
            if remotes:
                # Get the first fetch URL
                first_remote_line = next((line for line in remotes if "(fetch)" in line), None)
                if first_remote_line:
                    url = first_remote_line.split()[1] # Get the URL part
                    if url.startswith('git@'):
                        url = url.replace(':', '/').replace('git@', 'https://')
                    if url.endswith('.git'):
                        url = url[:-4]
                    return url
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e_fallback:
            # print(f"🟡 [Holaf-NodesManager] Fallback git remote -v also failed for {repo_path}: {e_fallback}")
            pass # Silently fail if fallback also doesn't work
    return None


def scan_custom_nodes():
    nodes_list = []
    custom_nodes_dir = os.path.join(folder_paths.base_path, 'custom_nodes')
    if not os.path.isdir(custom_nodes_dir):
        print(f"🔴 [Holaf-NodesManager] Custom nodes directory not found at: {custom_nodes_dir}")
        return []

    for item_name in sorted(os.listdir(custom_nodes_dir), key=str.lower):
        if item_name.startswith('.') or item_name.startswith('__') or item_name.endswith('_old_'): 
            continue
        
        if _sanitize_node_name(item_name) != item_name:
            print(f"🟡 [Holaf-NodesManager] Skipped potentially unsafe directory name during scan: {item_name}")
            continue

        item_path = os.path.join(custom_nodes_dir, item_name)
        if os.path.isdir(item_path): 
            is_git_repo = os.path.isdir(os.path.join(item_path, '.git'))
            repo_url = _get_git_remote_url(item_path) if is_git_repo else None # Only get URL if it's a git repo
            has_req_txt = os.path.isfile(os.path.join(item_path, 'requirements.txt'))
            
            nodes_list.append({
                "name": item_name,
                "repo_url": repo_url, 
                "has_requirements_txt": has_req_txt,
                "is_git_repo": is_git_repo 
            })
    return nodes_list

def get_local_readme_content(node_name_from_client: str):
    sanitized_name = _sanitize_node_name(node_name_from_client)
    if not sanitized_name:
        return "Error: Invalid node name provided."
    
    node_path = os.path.join(folder_paths.base_path, 'custom_nodes', sanitized_name)

    if not os.path.isdir(node_path): 
        return f"Error: Node directory '{sanitized_name}' not found."
        
    readme_path_found = None
    try:
        for dirpath, _, filenames in os.walk(node_path):
            for filename in filenames:
                if filename.lower() in ('readme.md', 'readme.txt'):
                    readme_path_found = os.path.join(dirpath, filename)
                    break 
            if readme_path_found:
                break
    except OSError as e:
        print(f"🔴 [Holaf-NodesManager] get_local_readme_content: OSError while walking {node_path}: {e}")
        return f"Error: Cannot access node directory '{sanitized_name}'."
    
    if readme_path_found:
        try:
            with open(readme_path_found, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                return content
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Error reading local README file {readme_path_found}: {str(e)}")
            return f"Error reading local README file: {str(e)}"
    
    return "Local README file not found for this node."

async def search_github_for_repo(repo_name_from_client: str):
    search_term = re.sub(r'[^a-zA-Z0-9_.-]', '', repo_name_from_client)
    if not search_term:
        return None

    search_url = f"https://api.github.com/search/repositories?q={search_term}+in:name&sort=stars&order=desc"
    headers = {"Accept": "application/vnd.github.v3+json"}
    async with aiohttp.ClientSession(headers=headers) as session:
        try:
            async with session.get(search_url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('items'):
                        return data['items'][0].get('html_url')
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] Error searching GitHub for '{search_term}': {e}")
    return None

async def get_github_readme_content(owner, repo):
    if not owner or not repo:
        return "Error: Owner and repository name are required."
    sane_owner = re.sub(r'[^a-zA-Z0-9_.-]', '', owner)
    sane_repo = re.sub(r'[^a-zA-Z0-9_.-]', '', repo)
    if not sane_owner or not sane_repo:
        return "Error: Invalid owner or repository name characters."

    urls_to_try = [
        f"https://raw.githubusercontent.com/{sane_owner}/{sane_repo}/main/README.md",
        f"https://raw.githubusercontent.com/{sane_owner}/{sane_repo}/master/README.md"
    ]
    async with aiohttp.ClientSession() as session:
        for url in urls_to_try:
            try:
                async with session.get(url) as response:
                    if response.status == 200:
                        return await response.text()
            except Exception as e:
                print(f"🟡 [Holaf-NodesManager] Failed to fetch {url}: {e}")
                continue
    return f"Could not fetch README.md from GitHub repository '{sane_owner}/{sane_repo}'."

# --- Action Functions ---

def _get_node_path_if_safe(node_name_from_client: str) -> str | None:
    sanitized_name = _sanitize_node_name(node_name_from_client)
    if not sanitized_name:
        print(f"🔴 [Holaf-NodesManager] Action rejected: Invalid node name format or characters in '{node_name_from_client}'")
        return None

    custom_nodes_base_dir = os.path.normpath(os.path.join(folder_paths.base_path, 'custom_nodes'))
    node_dir_path = os.path.normpath(os.path.join(custom_nodes_base_dir, sanitized_name))

    if os.path.commonprefix([node_dir_path, custom_nodes_base_dir]) != custom_nodes_base_dir:
        print(f"🔴 [Holaf-NodesManager] SECURITY ALERT: Action rejected for '{sanitized_name}'. Path construction resulted in escape: {node_dir_path}")
        return None
    
    if node_dir_path == custom_nodes_base_dir:
        print(f"🔴 [Holaf-NodesManager] SECURITY ALERT: Action rejected for '{sanitized_name}'. Attempt to target base custom_nodes directory.")
        return None
    return node_dir_path


def update_node_from_git(node_name: str, repo_url_override: str = None) -> dict:
    node_path = _get_node_path_if_safe(node_name)
    if not node_path or not os.path.isdir(node_path): 
        return {"status": "error", "message": f"Node directory '{node_name}' not found or path is invalid."}

    is_git_repo = os.path.isdir(os.path.join(node_path, '.git'))
    output_log = ""

    if is_git_repo:
        try:
            print(f"🔵 [Holaf-NodesManager] Updating existing Git repo '{node_name}' in {node_path}...")
            
            fetch_cmd = ['git', 'fetch', 'origin']
            output_log += f"Executing: {' '.join(fetch_cmd)}\n"
            result_fetch = subprocess.run(
                fetch_cmd, capture_output=True, text=True, check=True, 
                cwd=node_path, timeout=120, encoding='utf-8', errors='replace'
            )
            output_log += "Fetch output:\n" + result_fetch.stdout.strip() + \
                         ("\n" + result_fetch.stderr.strip() if result_fetch.stderr.strip() else "") + "\n\n"

            reset_cmd = ['git', 'reset', '--hard', 'FETCH_HEAD']
            output_log += f"Executing: {' '.join(reset_cmd)}\n"
            result_reset = subprocess.run(
                reset_cmd, capture_output=True, text=True, check=True, 
                cwd=node_path, timeout=60, encoding='utf-8', errors='replace'
            )
            output_log += "Reset output:\n" + result_reset.stdout.strip() + \
                          ("\n" + result_reset.stderr.strip() if result_reset.stderr.strip() else "")

            # Get current status after update
            current_repo_url = _get_git_remote_url(node_path)
            new_node_status = { "is_git_repo": True, "repo_url": current_repo_url }

            print(f"🟢 [Holaf-NodesManager] Forced update for '{node_name}' completed.")
            return {"status": "success", "message": f"Forced update successful for Git repo {node_name}.", "output": output_log, "new_status": new_node_status}

        except subprocess.CalledProcessError as e:
            error_details = e.stdout.strip() + ("\n" + e.stderr.strip() if e.stderr.strip() else "")
            output_log += f"Error: {error_details}\n"
            print(f"🔴 [Holaf-NodesManager] Force update failed for '{node_name}': {error_details}")
            return {"status": "error", "message": f"Force update failed for {node_name}.", "output": output_log}
        except subprocess.TimeoutExpired as e:
            timeout_msg = f"Git command '{' '.join(e.cmd)}' timed out for '{node_name}'."
            output_log += f"Error: {timeout_msg}\n"
            print(f"🔴 [Holaf-NodesManager] {timeout_msg}")
            return {"status": "error", "message": timeout_msg, "output": output_log}
        except Exception as e:
            output_log += f"Unexpected Error: {str(e)}\n"
            print(f"🔴 [Holaf-NodesManager] Unexpected error during force update for '{node_name}': {e}")
            return {"status": "error", "message": f"Unexpected error updating {node_name}: {e}", "output": output_log}
    else: 
        repo_url_to_clone = repo_url_override
        if not repo_url_to_clone:
            msg = f"Node '{node_name}' is not a local Git repository and no remote URL was provided for re-cloning. Cannot update."
            print(f"🟡 [Holaf-NodesManager] {msg}")
            return {"status": "info", "message": msg}

        parent_dir = os.path.dirname(node_path)
        backup_node_path = f"{node_path}_old_{str(int(time.time()))}"
        cloned_successfully = False

        try:
            print(f"🔵 [Holaf-NodesManager] Renaming '{node_path}' to '{backup_node_path}' for backup.")
            output_log += f"Renaming '{os.path.basename(node_path)}' to '{os.path.basename(backup_node_path)}'.\n"
            shutil.move(node_path, backup_node_path) 

            print(f"🔵 [Holaf-NodesManager] Cloning '{repo_url_to_clone}' into '{node_path}'.")
            output_log += f"Cloning '{repo_url_to_clone}' into '{os.path.basename(node_path)}'.\n"
            clone_cmd = ['git', 'clone', '--depth', '1', repo_url_to_clone, node_name] 
            
            result_clone = subprocess.run(
                clone_cmd, capture_output=True, text=True, check=True, 
                cwd=parent_dir, 
                timeout=300, encoding='utf-8', errors='replace'
            )
            output_log += "Clone output:\n" + result_clone.stdout.strip() + \
                         ("\n" + result_clone.stderr.strip() if result_clone.stderr.strip() else "") + "\n\n"
            cloned_successfully = True # node_path now exists and is a git repo

            print(f"🔵 [Holaf-NodesManager] Restoring specific files from '{backup_node_path}' to '{node_path}'.")
            output_log += f"Attempting to restore files from backup to new clone.\n"
            restored_files_count = 0
            skipped_files_count = 0
            
            for root_old, _, files_old in os.walk(backup_node_path):
                for file_name_old in files_old:
                    old_file_full_path = os.path.join(root_old, file_name_old)
                    relative_file_path = os.path.relpath(old_file_full_path, backup_node_path)
                    new_file_full_path = os.path.join(node_path, relative_file_path)
                    
                    os.makedirs(os.path.dirname(new_file_full_path), exist_ok=True)

                    if not os.path.exists(new_file_full_path):
                        shutil.copy2(old_file_full_path, new_file_full_path)
                        output_log += f"Restored: {relative_file_path}\n"
                        restored_files_count += 1
                    else:
                        skipped_files_count +=1
            
            output_log += f"Restored {restored_files_count} missing files. Skipped {skipped_files_count} files that already existed in the new clone.\n"

            print(f"🔵 [Holaf-NodesManager] Removing backup directory '{backup_node_path}'.")
            shutil.rmtree(backup_node_path)
            output_log += f"Removed backup directory '{os.path.basename(backup_node_path)}'.\n"
            
            # After successful clone, node_path is now a git repo
            # Its repo_url should be repo_url_to_clone (or what git configured, ideally the same)
            # We explicitly pass back the URL used for cloning as the new repo_url.
            # _get_git_remote_url(node_path) could also be used here for verification.
            new_node_status = {
                "is_git_repo": True,
                "repo_url": repo_url_to_clone # The URL we just cloned from
            }

            final_message = f"Update by re-cloning '{node_name}' successful."
            print(f"🟢 [Holaf-NodesManager] {final_message}")
            return {"status": "success", "message": final_message, "output": output_log, "new_status": new_node_status}

        except subprocess.CalledProcessError as e:
            error_details = e.stdout.strip() + ("\n" + e.stderr.strip() if e.stderr.strip() else "")
            output_log += f"Clone Error: {error_details}\n"
            print(f"🔴 [Holaf-NodesManager] Re-clone update failed for '{node_name}': {error_details}")
            if os.path.exists(backup_node_path) and not os.path.exists(node_path):
                try: shutil.move(backup_node_path, node_path); output_log += "Attempted to restore original folder from backup.\n"
                except Exception as restore_e: output_log += f"Failed to restore original folder from backup: {restore_e}\n"
            return {"status": "error", "message": f"Re-clone update failed for {node_name}.", "output": output_log}
        except subprocess.TimeoutExpired as e:
            timeout_msg = f"Git clone command '{' '.join(e.cmd)}' timed out for '{node_name}'."
            output_log += f"Error: {timeout_msg}\n"
            print(f"🔴 [Holaf-NodesManager] {timeout_msg}")
            if os.path.exists(backup_node_path) and not os.path.exists(node_path):
                 try: shutil.move(backup_node_path, node_path); output_log += "Attempted to restore original folder from backup.\n"
                 except Exception as restore_e: output_log += f"Failed to restore original folder from backup: {restore_e}\n"
            return {"status": "error", "message": timeout_msg, "output": output_log}
        except Exception as e:
            err_msg = f"Unexpected error updating {node_name} via re-clone: {str(e)}"
            output_log += f"Unexpected Error: {str(e)}\n"
            print(f"🔴 [Holaf-NodesManager] {err_msg}")
            if cloned_successfully and os.path.exists(node_path) and os.path.exists(backup_node_path):
                 output_log += "Clone was successful but a later step (file restoration or backup cleanup) failed. Backup folder may still exist.\n"
            elif os.path.exists(backup_node_path) and not os.path.exists(node_path): 
                 try: shutil.move(backup_node_path, node_path); output_log += "Attempted to restore original folder from backup.\n"
                 except Exception as restore_e: output_log += f"Failed to restore original folder from backup: {restore_e}\n"
            return {"status": "error", "message": err_msg, "output": output_log}

def delete_node_folder(node_name: str) -> dict:
    node_path = _get_node_path_if_safe(node_name)
    if not node_path or not os.path.isdir(node_path):
        return {"status": "error", "message": f"Node directory '{node_name}' not found for deletion or path is invalid."}
    
    custom_nodes_base_dir = os.path.normpath(os.path.join(folder_paths.base_path, 'custom_nodes'))
    if node_path == custom_nodes_base_dir or node_path == os.path.normpath(folder_paths.base_path):
        print(f"🔴 [Holaf-NodesManager] CRITICAL SECURITY ALERT: Attempt to delete critical directory '{node_path}' blocked.")
        return {"status": "error", "message": "Deletion of critical directory is not allowed."}

    try:
        print(f"🔵 [Holaf-NodesManager] Attempting to delete folder for node '{node_name}' at {node_path}...")
        shutil.rmtree(node_path)
        print(f"🟢 [Holaf-NodesManager] Folder for node '{node_name}' deleted from {node_path}.")
        return {"status": "success", "message": f"Folder for node '{node_name}' has been deleted."}
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Error deleting folder for node '{node_name}': {e}")
        return {"status": "error", "message": f"Error deleting node '{node_name}': {e}"}

def install_node_requirements(node_name: str) -> dict:
    node_path = _get_node_path_if_safe(node_name)
    if not node_path or not os.path.isdir(node_path):
        return {"status": "error", "message": f"Node directory '{node_name}' not found for installing requirements or path is invalid."}

    req_file_path = os.path.join(node_path, 'requirements.txt')
    if not os.path.isfile(req_file_path):
        return {"status": "info", "message": f"No requirements.txt found for node '{node_name}'. Nothing to install."}
    
    output_log = ""
    try:
        pip_command = [sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt']
        output_log += f"Executing: {' '.join(pip_command)}\n"
        print(f"🔵 [Holaf-NodesManager] Attempting to install requirements for '{node_name}' from {req_file_path} using command: {' '.join(pip_command)}")
        result = subprocess.run(
            pip_command, 
            capture_output=True, text=True, check=True, cwd=node_path, timeout=600, encoding='utf-8', errors='replace'
        )
        output_log += "Install output:\n" + result.stdout.strip() + ("\n" + result.stderr.strip() if result.stderr.strip() else "")
        print(f"🟢 [Holaf-NodesManager] Requirement installation for '{node_name}' completed.")
        return {"status": "success", "message": f"Requirement installation for {node_name} successful.", "output": output_log}
    except subprocess.CalledProcessError as e:
        error_details = e.stdout.strip() + ("\n" + e.stderr.strip() if e.stderr.strip() else "")
        output_log += f"Error: {error_details}\n"
        print(f"🔴 [Holaf-NodesManager] Requirement installation failed for '{node_name}': {error_details}")
        return {"status": "error", "message": f"Installation failed for {node_name}.", "output": output_log}
    except subprocess.TimeoutExpired:
        timeout_msg = f"Requirement installation timed out for '{node_name}'."
        output_log += f"Error: {timeout_msg}\n"
        print(f"🔴 [Holaf-NodesManager] {timeout_msg}")
        return {"status": "error", "message": timeout_msg, "output": output_log}
    except Exception as e:
        err_msg = f"Unexpected error installing requirements for {node_name}: {str(e)}"
        output_log += f"Unexpected Error: {str(e)}\n"
        print(f"🔴 [Holaf-NodesManager] {err_msg}")
        return {"status": "error", "message": err_msg, "output": output_log}

def install_custom_node(repo_url: str) -> dict:
    if not repo_url or not repo_url.startswith(('http://', 'https://')):
        return {"status": "error", "message": "Invalid URL protocol. Must be http:// or https://"}

    # Extract folder name from URL
    clean_url = repo_url.rstrip('/')
    if clean_url.endswith('.git'):
        clean_url = clean_url[:-4]
    
    base_name = clean_url.split('/')[-1]
    folder_name = _sanitize_node_name(base_name)
    
    if not folder_name:
         return {"status": "error", "message": "Could not determine a valid folder name from URL."}

    custom_nodes_dir = os.path.join(folder_paths.base_path, 'custom_nodes')
    target_path = os.path.join(custom_nodes_dir, folder_name)

    if os.path.exists(target_path):
        return {"status": "error", "message": f"Destination folder '{folder_name}' already exists in custom_nodes."}

    try:
        print(f"🔵 [Holaf-NodesManager] Cloning '{repo_url}' into '{target_path}'...")
        cmd = ['git', 'clone', '--depth', '1', repo_url, target_path]
        
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, 
            timeout=300, encoding='utf-8', errors='replace'
        )
        print(f"🟢 [Holaf-NodesManager] Successfully cloned '{folder_name}'.")
        return {"status": "success", "message": f"Successfully installed '{folder_name}'."}
        
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.strip() if e.stderr else e.stdout.strip()
        print(f"🔴 [Holaf-NodesManager] Clone failed: {error_msg}")
        return {"status": "error", "message": f"Git clone failed: {error_msg}"}
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Unexpected error during install: {e}")
        return {"status": "error", "message": f"Unexpected error: {str(e)}"}

async def search_custom_nodes(query: str):
    if not query:
        return {"results": []}
    
    # Add context to search to find relevant nodes
    search_query = f"{query} ComfyUI"
    search_url = f"https://api.github.com/search/repositories?q={search_query}&sort=stars&order=desc"
    headers = {"Accept": "application/vnd.github.v3+json"}
    
    results = []
    async with aiohttp.ClientSession(headers=headers) as session:
        try:
            async with session.get(search_url) as response:
                if response.status == 200:
                    data = await response.json()
                    items = data.get('items', [])
                    # Limit to top 20 results
                    for item in items[:20]:
                        results.append({
                            "name": item.get('name'),
                            "description": item.get('description'),
                            "url": item.get('html_url'),
                            "stars": item.get('stargazers_count')
                        })
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] Error searching GitHub nodes: {e}")
            return {"error": str(e)}
            
    return {"results": results}