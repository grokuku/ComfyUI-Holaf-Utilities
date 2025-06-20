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
#           Added placeholder for updating non-git repos (manual installs with found URL).
# === End Documentation ===

import os
import folder_paths
import re
import subprocess
import aiohttp
import shutil
import sys # For sys.executable

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
        result = subprocess.run(
            ['git', 'config', '--get', 'remote.origin.url'],
            capture_output=True, text=True, check=True, encoding='utf-8', cwd=repo_path
        )
        url = result.stdout.strip()
        if url.startswith('git@'):
            url = url.replace(':', '/').replace('git@', 'https://')
        if url.endswith('.git'):
            url = url[:-4]
        return url
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

def scan_custom_nodes():
    nodes_list = []
    custom_nodes_dir = os.path.join(folder_paths.base_path, 'custom_nodes')
    if not os.path.isdir(custom_nodes_dir):
        print(f"🔴 [Holaf-NodesManager] Custom nodes directory not found at: {custom_nodes_dir}")
        return []

    for item_name in sorted(os.listdir(custom_nodes_dir), key=str.lower):
        if item_name.startswith('.') or item_name.startswith('__'): 
            continue
        
        if _sanitize_node_name(item_name) != item_name:
            print(f"🟡 [Holaf-NodesManager] Skipped potentially unsafe directory name during scan: {item_name}")
            continue

        item_path = os.path.join(custom_nodes_dir, item_name)
        if os.path.isdir(item_path): 
            repo_url = _get_git_remote_url(item_path)
            has_req_txt = os.path.isfile(os.path.join(item_path, 'requirements.txt'))
            is_git_repo = os.path.isdir(os.path.join(item_path, '.git'))
            nodes_list.append({
                "name": item_name,
                "repo_url": repo_url, # This is the remote URL if .git exists and remote is configured
                "has_requirements_txt": has_req_txt,
                "is_git_repo": is_git_repo # True if .git folder exists
            })
    return nodes_list

def get_local_readme_content(node_name_from_client: str):
    sanitized_name = _sanitize_node_name(node_name_from_client)
    if not sanitized_name:
        # print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Invalid node name '{node_name_from_client}' received.")
        return "Error: Invalid node name provided."
    
    node_path = os.path.join(folder_paths.base_path, 'custom_nodes', sanitized_name)
    # print(f"🔵 [Holaf-NodesManager] get_local_readme_content: Searching for README in node path: {node_path}") 

    if not os.path.isdir(node_path): 
        # print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Node directory not found at: {node_path}")
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
    # print(f"🔵 [Holaf-NodesManager] Searching GitHub: {search_url}")
    async with aiohttp.ClientSession(headers=headers) as session:
        try:
            async with session.get(search_url) as response:
                # print(f"🔵 [Holaf-NodesManager] GitHub search response status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    if data.get('items'):
                        # print(f"🟢 [Holaf-NodesManager] GitHub search found: {data['items'][0].get('html_url')}")
                        return data['items'][0].get('html_url')
                # else:
                    # print(f"🟡 [Holaf-NodesManager] GitHub search non-200 response: {await response.text()}")
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

    # For update/delete, the directory should exist. For other actions, it might not.
    # This function is now generic; existence check should be in the calling action function if needed.
    return node_dir_path


def update_node_from_git(node_name: str) -> dict:
    node_path = _get_node_path_if_safe(node_name)
    if not node_path or not os.path.isdir(node_path):
        return {"status": "error", "message": f"Node directory '{node_name}' not found or path is invalid."}

    is_git_repo = os.path.isdir(os.path.join(node_path, '.git'))

    if is_git_repo:
        try:
            print(f"🔵 [Holaf-NodesManager] Updating existing Git repo '{node_name}' in {node_path}...")
            
            # 1. Fetch from remote
            fetch_cmd = ['git', 'fetch', 'origin']
            print(f"  Executing: {' '.join(fetch_cmd)}")
            result_fetch = subprocess.run(
                fetch_cmd, capture_output=True, text=True, check=True, 
                cwd=node_path, timeout=120, encoding='utf-8', errors='replace'
            )
            output = "Fetch output:\n" + result_fetch.stdout.strip() + \
                     ("\n" + result_fetch.stderr.strip() if result_fetch.stderr.strip() else "") + "\n\n"

            # 2. Determine the current branch
            #    We will reset to FETCH_HEAD which refers to the tip of the last fetched branch,
            #    this is often simpler than trying to determine the exact remote default branch name.
            #    However, if a specific branch like 'main' or 'master' is desired, that logic would go here.
            #    For now, FETCH_HEAD is a good general approach for "latest from remote".
            
            # 3. Reset hard to FETCH_HEAD (overwrite local changes on tracked files)
            #    If you wanted to reset to a specific default branch like origin/main:
            #    reset_cmd = ['git', 'reset', '--hard', 'origin/main'] # or origin/master
            reset_cmd = ['git', 'reset', '--hard', 'FETCH_HEAD']
            print(f"  Executing: {' '.join(reset_cmd)}")
            result_reset = subprocess.run(
                reset_cmd, capture_output=True, text=True, check=True, 
                cwd=node_path, timeout=60, encoding='utf-8', errors='replace'
            )
            output += "Reset output:\n" + result_reset.stdout.strip() + \
                      ("\n" + result_reset.stderr.strip() if result_reset.stderr.strip() else "")

            # Files not tracked by Git will remain.
            print(f"🟢 [Holaf-NodesManager] Forced update for '{node_name}' completed. Output: {output[:400]}")
            return {"status": "success", "message": f"Forced update successful for Git repo {node_name}.", "output": output}

        except subprocess.CalledProcessError as e:
            error_output = e.stdout.strip() + ("\n" + e.stderr.strip() if e.stderr.strip() else "")
            print(f"🔴 [Holaf-NodesManager] Force update failed for '{node_name}': {error_output}")
            return {"status": "error", "message": f"Force update failed for {node_name}.", "output": error_output}
        except subprocess.TimeoutExpired as e:
            timeout_msg = f"Git command '{' '.join(e.cmd)}' timed out for '{node_name}'."
            print(f"🔴 [Holaf-NodesManager] {timeout_msg}")
            return {"status": "error", "message": timeout_msg}
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] Unexpected error during force update for '{node_name}': {e}")
            return {"status": "error", "message": f"Unexpected error updating {node_name}: {e}"}
    else:
        # This is a manually installed node, URL might have been found via GitHub search
        # Implementing a safe "download ZIP and overwrite" is complex and requires more tools (zipfile, requests/aiohttp for download)
        # For now, we'll just indicate it's not a Git repo locally.
        print(f"🟡 [Holaf-NodesManager] Node '{node_name}' at {node_path} is not a Git repository. 'Update' action via ZIP download is not yet implemented.")
        return {"status": "info", "message": f"Node '{node_name}' is not a local Git repository. Update via ZIP download is not yet implemented. Please re-clone or update manually."}


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

    try:
        pip_command = [sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt']
        print(f"🔵 [Holaf-NodesManager] Attempting to install requirements for '{node_name}' from {req_file_path} using command: {' '.join(pip_command)}")
        result = subprocess.run(
            pip_command, 
            capture_output=True, text=True, check=True, cwd=node_path, timeout=600, encoding='utf-8', errors='replace'
        )
        output = result.stdout.strip() + ("\n" + result.stderr.strip() if result.stderr.strip() else "")
        print(f"🟢 [Holaf-NodesManager] Requirement installation for '{node_name}' completed. Output: {output[:400]}")
        return {"status": "success", "message": f"Requirement installation for {node_name} successful.", "output": output}
    except subprocess.CalledProcessError as e:
        error_output = e.stdout.strip() + ("\n" + e.stderr.strip() if e.stderr.strip() else "")
        print(f"🔴 [Holaf-NodesManager] Requirement installation failed for '{node_name}': {error_output}")
        return {"status": "error", "message": f"Installation failed for {node_name}.", "output": error_output}
    except subprocess.TimeoutExpired:
        print(f"🔴 [Holaf-NodesManager] Requirement installation timed out for '{node_name}'.")
        return {"status": "error", "message": f"Installation timed out for {node_name}."}
    except Exception as e:
        print(f"🔴 [Holaf-NodesManager] Unexpected error during requirement installation for '{node_name}': {e}")
        return {"status": "error", "message": f"Unexpected error installing requirements for {node_name}: {e}"}