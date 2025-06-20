# === Documentation ===
# Developer: Gemini (AI Assistant), under the direction of Holaf
# Date: 2025-05-24
#
# Purpose:
# This file provides the server-side logic for the Holaf Custom Nodes Manager.
# It handles scanning the custom_nodes directory, detecting Git repositories,
# and reading both local and remote README files for display in the UI.
#
# MODIFIED: Added Git repository detection to find remote URLs.
# MODIFIED: Added function to fetch README content directly from GitHub.
# MODIFIED: Added function to search GitHub for repositories by folder name.
# CORRECTION: Fixed a missing 'except' block in the search_github_for_repo function.
# CORRECTION: Added filter to ignore system folders like '__pycache__' and '.git'.
# CORRECTION: Made local README search case-insensitive and more robust.
# CORRECTION: Switched from 'git -C' to 'subprocess(cwd=...)' for thread-safe execution.
# === End Documentation ===

import os
import folder_paths
import re
import subprocess
import aiohttp

def _sanitize_node_name(node_name):
    """
    Sanitizes the node name to prevent path traversal.
    Allows only alphanumeric characters, underscores, and hyphens.
    """
    if not node_name:
        return None
    if ".." in node_name or "/" in node_name or "\\" in node_name:
        return None
    return re.sub(r'[^a-zA-Z0-9_-]', '', node_name)

def _get_git_remote_url(repo_path):
    """
    Tries to get the remote 'origin' URL from a git repository path using the 'cwd' argument
    for better stability when called from different threads.
    """
    git_dir = os.path.join(repo_path, '.git')
    if not os.path.isdir(git_dir):
        return None
    
    try:
        # Using cwd is more robust than the '-C' flag when running in background threads.
        result = subprocess.run(
            ['git', 'config', '--get', 'remote.origin.url'],
            capture_output=True, text=True, check=True, encoding='utf-8', cwd=repo_path
        )
        url = result.stdout.strip()
        # Convert SSH URLs to HTTPS for easier parsing
        if url.startswith('git@'):
            url = url.replace(':', '/').replace('git@', 'https://')
        # Remove .git suffix if present
        if url.endswith('.git'):
            url = url[:-4]
        return url
    except (subprocess.CalledProcessError, FileNotFoundError):
        # This can happen if 'git' is not in PATH or it's not a valid repo
        return None

def scan_custom_nodes():
    """
    Scans the custom_nodes directory and returns a list of dictionaries,
    each containing the node name and its Git repository URL if found.
    """
    nodes_list = []
    custom_nodes_dir = os.path.join(folder_paths.base_path, 'custom_nodes')
    if not os.path.isdir(custom_nodes_dir):
        print(f"🔴 [Holaf-NodesManager] Custom nodes directory not found at: {custom_nodes_dir}")
        return []

    for item_name in sorted(os.listdir(custom_nodes_dir), key=str.lower):
        # Ignore system/hidden folders
        if item_name.startswith('.') or item_name.startswith('__'):
            continue

        item_path = os.path.join(custom_nodes_dir, item_name)
        if os.path.isdir(item_path):
            repo_url = _get_git_remote_url(item_path)
            nodes_list.append({
                "name": item_name,
                "repo_url": repo_url
            })
            
    return nodes_list

def get_local_readme_content(node_name):
    """
    Finds and reads the LOCAL README file for a given custom node directory,
    searching subdirectories as well.
    """
    sanitized_name = _sanitize_node_name(node_name)
    if not sanitized_name:
        print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Invalid node name '{node_name}' received.")
        return "Error: Invalid node name provided."

    node_path = os.path.join(folder_paths.base_path, 'custom_nodes', sanitized_name)
    print(f"🔵 [Holaf-NodesManager] get_local_readme_content: Searching for README in node path: {node_path}")

    if not os.path.isdir(node_path):
        print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Node directory not found at: {node_path}")
        return f"Error: Node directory '{sanitized_name}' not found."

    readme_path_found = None
    try:
        # os.walk will traverse the directory tree
        for dirpath, _, filenames in os.walk(node_path):
            # Search for readme in a case-insensitive way
            for filename in filenames:
                potential_readme_path = os.path.join(dirpath, filename)
                print(f"🔵 [Holaf-NodesManager] get_local_readme_content: Checking potential file: {potential_readme_path}")
                if filename.lower() in ('readme.md', 'readme.txt'):
                    # Found a readme, store its path and stop searching
                    readme_path_found = potential_readme_path
                    print(f"🟢 [Holaf-NodesManager] get_local_readme_content: Found potential README at: {readme_path_found}")
                    break # break from inner loop
            if readme_path_found:
                break # break from outer loop if we found it
    except OSError as e:
        print(f"🔴 [Holaf-NodesManager] get_local_readme_content: OSError while walking {node_path}: {e}")
        return f"Error: Cannot access node directory '{sanitized_name}'."
    
    if readme_path_found:
        try:
            with open(readme_path_found, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                print(f"🟢 [Holaf-NodesManager] get_local_readme_content: Successfully read README content from: {readme_path_found}")
                return content
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] get_local_readme_content: Error reading local README file {readme_path_found}: {str(e)}")
            return f"Error reading local README file: {str(e)}"
    
    print(f"🟡 [Holaf-NodesManager] get_local_readme_content: Local README file not found for node '{sanitized_name}' in path '{node_path}'.")
    return "Local README file not found for this node."

async def search_github_for_repo(repo_name):
    """
    Searches the GitHub API for a repository name and returns the top result's URL.
    This is a best-effort search for manually installed nodes.
    """
    search_url = f"https://api.github.com/search/repositories?q={repo_name}+in:name&sort=stars&order=desc"
    headers = {"Accept": "application/vnd.github.v3+json"}
    
    async with aiohttp.ClientSession(headers=headers) as session:
        try:
            async with session.get(search_url) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get('items'):
                        top_item = data['items'][0]
                        # Return a clean HTTPS URL
                        return top_item.get('html_url')
        except Exception as e:
            print(f"🔴 [Holaf-NodesManager] Error searching GitHub for '{repo_name}': {e}")
    
    return None

async def get_github_readme_content(owner, repo):
    """
    Fetches the README.md content from a GitHub repository.
    Tries 'main' and 'master' branches.
    """
    if not owner or not repo:
        return "Error: Owner and repository name are required."

    urls_to_try = [
        f"https://raw.githubusercontent.com/{owner}/{repo}/main/README.md",
        f"https://raw.githubusercontent.com/{owner}/{repo}/master/README.md"
    ]
    
    async with aiohttp.ClientSession() as session:
        for url in urls_to_try:
            try:
                async with session.get(url) as response:
                    if response.status == 200:
                        return await response.text()
            except Exception as e:
                print(f"🟡 [Holaf-NodesManager] Failed to fetch {url}: {e}")
                continue # Try the next URL
    
    return f"Could not fetch README.md from GitHub repository '{owner}/{repo}'."