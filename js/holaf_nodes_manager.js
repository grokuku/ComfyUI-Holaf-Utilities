/*
 * Developer: Gemini (AI Assistant), under the direction of Holaf
 * Date: 2025-05-24
 *
 * This script provides the client-side logic for the Holaf Custom Nodes Manager.
 *
 * MODIFIED: Added GitHub repository detection and fetching of remote READMEs.
 * MODIFIED: Added 'marked.js' via CDN for Markdown-to-HTML rendering.
 * MODIFIED: Updated UI to show Git status and link, and render HTML.
 * MODIFIED: Added GitHub search for manually installed nodes as a fallback.
 * CORRECTION: Improved README fetching logic to be more robust and provide clearer status messages.
 * MODIFIED: Added checkboxes for node selection and action buttons (Update, Delete, Install R.).
 * MODIFIED: Inverted order of icons (Requirements then Git/Manual).
 * MODIFIED: Connected action buttons to backend API endpoints. Added result display.
 * MODIFIED: Updated 'Update' logic to differentiate between local Git repos and found URLs in UI.
 * MODIFIED: Updated `_executeNodeAction` and `handleUpdateSelected` to send `node_payloads` with `repo_url_override`.
 * CORRECTION: Trigger GitHub URL search for manual nodes upon selection to correctly update button states.
 * CORRECTION: Ensure "In Progress" dialog is removed before showing results/error dialog.
 * MODIFIED: Use `new_status` from backend to update node state locally before full refresh.
 * CORRECTION: Fixed issue where node names disappeared after icon update.
 */

import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";
import holafModelManager from "./holaf_model_manager.js"; // To share theme settings

// Helper to load external scripts
function loadScript(src, id) {
    return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.id = id;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

const holafNodesManager = {
    panelElements: null,
    isInitialized: false,
    scriptsLoaded: false,
    nodesList: [],
    currentlyDisplayedNode: null, // Node whose README is shown
    selectedNodes: new Set(), // For actions like update/delete
    isActionInProgress: false, // To disable buttons during an action

    async ensureScriptsLoaded() {
        if (this.scriptsLoaded) return true;
        try {
            await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js", "holaf-marked-script");
            this.scriptsLoaded = true;
            return true;
        } catch (error) {
            console.error("[Holaf NodesManager] Critical error loading marked.js script", error);
            HolafPanelManager.createDialog({ title: "Component Error", message: "Could not load the Markdown rendering component. READMEs will be shown as plain text." });
            return false;
        }
    },

    ensureMenuItemAdded() {
        const menuId = "holaf-utilities-dropdown-menu";
        let dropdownMenu = document.getElementById(menuId);

        if (!dropdownMenu) {
            setTimeout(() => this.ensureMenuItemAdded(), 250);
            return;
        }

        const existingItem = Array.from(dropdownMenu.children).find(
            li => li.textContent === "Custom Nodes Manager (WIP)"
        );
        if (existingItem) return;

        const menuItem = document.createElement("li");
        menuItem.textContent = "Custom Nodes Manager (WIP)";
        menuItem.onclick = async () => {
            await this.ensureScriptsLoaded();
            this.show();
            if (dropdownMenu) dropdownMenu.style.display = "none";
        };
        dropdownMenu.appendChild(menuItem);
        console.log("[Holaf NodesManager] Menu item added to dropdown.");
    },

    createPanel() {
        if (this.panelElements && this.panelElements.panelEl) return;

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-nodes-manager-panel",
                title: "Holaf Custom Nodes Manager (WIP)",
                defaultSize: { width: 900, height: 600 },
                onClose: () => this.hide(),
            });

            this.populatePanelContent();
            this.applyCurrentTheme();
        } catch (e) {
            console.error("[Holaf NodesManager] Error creating panel:", e);
            HolafPanelManager.createDialog({ title: "Panel Error", message: "Error creating Nodes Manager panel. Check console for details." });
        }
    },

    populatePanelContent() {
        const contentEl = this.panelElements.contentEl;
        contentEl.innerHTML = `
            <div class="holaf-nodes-manager-container">
                <div id="holaf-nodes-manager-left-pane" class="holaf-nodes-manager-left-pane">
                    <div class="holaf-nodes-manager-toolbar">
                        <button id="holaf-nodes-manager-refresh-btn" class="comfy-button" title="Refresh node list">Refresh</button>
                        <input type="checkbox" id="holaf-nodes-manager-select-all-cb" title="Select/Deselect All Visible" style="margin-left: 10px; vertical-align: middle;">
                        <span id="holaf-nodes-manager-selected-count" style="margin-left: 5px; font-size: 0.9em; color: var(--holaf-text-secondary);">0 selected</span>
                    </div>
                    <div id="holaf-nodes-manager-list" class="holaf-nodes-manager-list">
                        <p class="holaf-manager-message">Click Refresh to scan...</p>
                    </div>
                    <div class="holaf-nodes-manager-actions-toolbar" style="padding: 8px; border-top: 1px solid var(--holaf-border-color); display: flex; gap: 5px; flex-wrap: wrap;">
                        <button id="holaf-nodes-manager-update-btn" class="comfy-button" disabled title="Update selected nodes. For Git repos: overwrites local changes. For others with URL: attempts re-clone & restore.">Update</button>
                        <button id="holaf-nodes-manager-req-btn" class="comfy-button" disabled title="Install requirements.txt for selected nodes">Install Req.</button>
                        <button id="holaf-nodes-manager-delete-btn" class="comfy-button" disabled title="Delete selected nodes (Warning: This is permanent!)" style="background-color: #c0392b;">Delete</button>
                    </div>
                </div>
                <div id="holaf-nodes-manager-right-pane" class="holaf-nodes-manager-right-pane">
                    <div id="holaf-nodes-manager-readme-header" class="holaf-nodes-manager-readme-header">
                        Select a node to see details
                    </div>
                    <div id="holaf-nodes-manager-readme-content" class="holaf-nodes-manager-readme-content">
                        <!-- README content will be rendered here -->
                    </div>
                </div>
            </div>
        `;

        document.getElementById("holaf-nodes-manager-refresh-btn").onclick = () => this.refreshNodesList();
        document.getElementById("holaf-nodes-manager-select-all-cb").onchange = (e) => this.toggleSelectAll(e.target.checked);
        
        document.getElementById("holaf-nodes-manager-update-btn").onclick = () => this.handleUpdateSelected();
        document.getElementById("holaf-nodes-manager-req-btn").onclick = () => this.handleInstallRequirementsSelected();
        document.getElementById("holaf-nodes-manager-delete-btn").onclick = () => this.handleDeleteSelected();
        
        this.updateActionButtonsState();
    },

    async refreshNodesList() {
        if (this.isActionInProgress) return;
        const listEl = document.getElementById("holaf-nodes-manager-list");
        const readmeHeaderEl = document.getElementById("holaf-nodes-manager-readme-header");
        const readmeContentEl = document.getElementById("holaf-nodes-manager-readme-content");
        if (!listEl || !readmeHeaderEl || !readmeContentEl) return;

        listEl.innerHTML = `<p class="holaf-manager-message">Scanning...</p>`;
        
        const oldSelectedNodeName = this.currentlyDisplayedNode ? this.currentlyDisplayedNode.name : null;

        this.selectedNodes.clear(); 

        try {
            const response = await fetch("/holaf/nodes/list");
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
            }
            const data = await response.json();
            this.nodesList = data.nodes || []; 
            this.renderNodesList();

            if (oldSelectedNodeName) {
                const stillExistsNode = this.nodesList.find(n => n.name === oldSelectedNodeName);
                if (stillExistsNode) {
                    // Re-apply selected-readme class and ensure readme is fetched if necessary
                    this.displayReadmeForNode(stillExistsNode); 
                } else {
                    readmeHeaderEl.textContent = 'Select a node to see details';
                    readmeContentEl.innerHTML = '';
                    this.currentlyDisplayedNode = null;
                }
            }


        } catch (e) {
            console.error("[Holaf NodesManager] Error fetching node list:", e);
            listEl.innerHTML = `<p class="holaf-manager-message error">Error loading nodes. Check console.</p>`;
            readmeHeaderEl.textContent = 'Error loading nodes';
            readmeContentEl.innerHTML = '';
            this.currentlyDisplayedNode = null;
        }
        this.updateActionButtonsState();
        this.updateSelectAllCheckboxState();
    },

    renderNodesList() {
        const listEl = document.getElementById("holaf-nodes-manager-list");
        if (!listEl) return;

        if (this.nodesList.length === 0) {
            listEl.innerHTML = `<p class="holaf-manager-message">No custom nodes found.</p>`;
            return;
        }

        listEl.innerHTML = ''; 
        this.nodesList.forEach(node => {
            const itemEl = document.createElement("div");
            itemEl.className = "holaf-nodes-manager-list-item";
            if (this.currentlyDisplayedNode && this.currentlyDisplayedNode.name === node.name) {
                itemEl.classList.add("selected-readme");
            }
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "holaf-nodes-manager-item-cb";
            checkbox.checked = this.selectedNodes.has(node.name);
            checkbox.dataset.nodeName = node.name; 
            checkbox.style.marginRight = "8px";
            checkbox.style.verticalAlign = "middle";
            checkbox.onclick = (e) => { 
                e.stopPropagation(); 
            };
            checkbox.onchange = async (e) => {
                const nodeName = e.target.dataset.nodeName; 
                const nodeObj = this.nodesList.find(n => n.name === nodeName);

                if (e.target.checked) {
                    this.selectedNodes.add(nodeName);
                    if (nodeObj && !nodeObj.is_git_repo && !nodeObj.repo_url) {
                        try {
                            const searchResponse = await fetch(`/holaf/nodes/search/github/${encodeURIComponent(nodeName)}`);
                            if (searchResponse.ok) {
                                const searchData = await searchResponse.json();
                                if (searchData.url) {
                                    nodeObj.repo_url = searchData.url; 
                                    this.rerenderNodeItemIcons(nodeName, nodeObj); 
                                    this.updateActionButtonsState(); 
                                }
                            }
                        } catch (searchError) {
                            console.warn(`[Holaf NodesManager] Background GitHub search for ${nodeName} failed:`, searchError);
                        }
                    }
                } else {
                    this.selectedNodes.delete(nodeName);
                }
                this.updateActionButtonsState(); 
                this.updateSelectAllCheckboxState();
            };
            itemEl.appendChild(checkbox);

            const nameSpan = document.createElement("span");
            nameSpan.textContent = node.name;
            nameSpan.style.cursor = "pointer"; 
            itemEl.appendChild(nameSpan);

            this._appendIconsToItem(itemEl, node); 
            
            itemEl.onclick = (e) => {
                if (e.target.type === 'checkbox') return; 
                this.displayReadmeForNode(node); 
            };
            listEl.appendChild(itemEl);
        });
        this.updateSelectAllCheckboxState();
    },

    _appendIconsToItem(itemEl, nodeData) {
        const existingIconsContainer = itemEl.querySelector('span[data-holaf-icons="true"]');
        if (existingIconsContainer) {
            itemEl.removeChild(existingIconsContainer);
        }

        let iconsHTML = '';
        if (nodeData.has_requirements_txt) {
            iconsHTML += `<svg title="Has requirements.txt" class="holaf-nodes-manager-req-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color: var(--holaf-text-secondary);"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2v2H9v-2H7v-2h2V9h2v2h2v2zm4-10H5V2.5L13 2.5V3c0 .55.45 1 1 1h.5v.5z"/></svg>`;
        }
        
        if (nodeData.is_git_repo && nodeData.repo_url) { 
            iconsHTML += `<svg title="Local Git repository: ${nodeData.repo_url}" class="holaf-nodes-manager-git-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0v1a6 6 0 0 0 6 6h1a5 5 0 0 0 5-5V8zm-6 6a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/><path d="M12 14v6"/><path d="M15 17H9"/></svg>`;
        } else if (nodeData.repo_url) { 
             iconsHTML += `<svg title="GitHub repo found (manual install): ${nodeData.repo_url}" class="holaf-nodes-manager-manual-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--holaf-accent-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>`;
        } else { 
            iconsHTML += `<svg title="Manually installed (no remote repo identified)" class="holaf-nodes-manager-manual-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>`;
        }

        const iconsContainer = document.createElement('span');
        iconsContainer.dataset.holafIcons = "true"; 
        iconsContainer.innerHTML = iconsHTML;
        iconsContainer.style.marginLeft = 'auto'; 
        iconsContainer.style.display = 'flex';
        iconsContainer.style.alignItems = 'center';
        iconsContainer.style.gap = '4px';
        itemEl.appendChild(iconsContainer); // Append to the end
    },
    
    displayReadmeForNode(node) { 
        // Logic to prevent re-fetch if already displaying and not loading
        if (this.currentlyDisplayedNode && this.currentlyDisplayedNode.name === node.name) {
            const readmeContentEl = document.getElementById("holaf-nodes-manager-readme-content");
            if (readmeContentEl && !readmeContentEl.innerHTML.includes('<p class="holaf-manager-message">Loading...</p>')) {
                 // Ensure selection highlight is correct even if just re-clicking
                const listEl = document.getElementById("holaf-nodes-manager-list");
                listEl.querySelectorAll(".holaf-nodes-manager-list-item").forEach(item => {
                    const nameSpan = Array.from(item.childNodes).find(cn => cn.nodeName === "SPAN" && cn.parentElement === item && !cn.dataset.holafIcons);
                    item.classList.toggle("selected-readme", nameSpan && nameSpan.textContent === node.name);
                });
                return;
            }
        }

        this.currentlyDisplayedNode = node;

        const listEl = document.getElementById("holaf-nodes-manager-list");
        listEl.querySelectorAll(".holaf-nodes-manager-list-item").forEach(item => {
            const nameSpan = Array.from(item.childNodes).find(cn => cn.nodeName === "SPAN" && cn.parentElement === item && !cn.dataset.holafIcons);
            if (nameSpan) {
                 item.classList.toggle("selected-readme", nameSpan.textContent === node.name);
            }
        });
        this.fetchReadme(node); 
    },

    toggleSelectAll(checked) {
        if (this.isActionInProgress) return;
        this.selectedNodes.clear();
        if (checked) {
            this.nodesList.forEach(node => {
                this.selectedNodes.add(node.name);
                if (!node.is_git_repo && !node.repo_url) {
                    (async () => {
                        try {
                            const searchResponse = await fetch(`/holaf/nodes/search/github/${encodeURIComponent(node.name)}`);
                            if (searchResponse.ok) {
                                const searchData = await searchResponse.json();
                                if (searchData.url) {
                                    node.repo_url = searchData.url;
                                    this.rerenderNodeItemIcons(node.name, node);
                                    this.updateActionButtonsState(); 
                                }
                            }
                        } catch (e) { /* ignore error for background search */ }
                    })();
                }
            });
        }
        const listEl = document.getElementById("holaf-nodes-manager-list");
        if (listEl) {
            listEl.querySelectorAll(".holaf-nodes-manager-item-cb").forEach(cb => {
                cb.checked = checked;
            });
        }
        this.updateActionButtonsState();
    },

    updateSelectAllCheckboxState() {
        const selectAllCb = document.getElementById("holaf-nodes-manager-select-all-cb");
        if (!selectAllCb) return;

        if (this.nodesList.length === 0) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
            return;
        }
        
        const allVisibleSelected = this.nodesList.length > 0 && this.nodesList.every(node => this.selectedNodes.has(node.name));
        if (allVisibleSelected) {
            selectAllCb.checked = true;
            selectAllCb.indeterminate = false;
        } else if (this.selectedNodes.size === 0) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        } else {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = true;
        }
    },

    updateActionButtonsState() {
        const selectedCount = this.selectedNodes.size;
        const selectedCountEl = document.getElementById("holaf-nodes-manager-selected-count");
        if (selectedCountEl) {
            selectedCountEl.textContent = `${selectedCount} selected`;
        }

        const updateBtn = document.getElementById("holaf-nodes-manager-update-btn");
        const reqBtn = document.getElementById("holaf-nodes-manager-req-btn");
        const deleteBtn = document.getElementById("holaf-nodes-manager-delete-btn");
        const refreshBtn = document.getElementById("holaf-nodes-manager-refresh-btn");
        const selectAllCb = document.getElementById("holaf-nodes-manager-select-all-cb");


        if (!updateBtn || !reqBtn || !deleteBtn || !refreshBtn || !selectAllCb) return;

        const baseDisabled = this.isActionInProgress;
        refreshBtn.disabled = baseDisabled;
        selectAllCb.disabled = baseDisabled;

        if (baseDisabled) { 
            updateBtn.disabled = true;
            reqBtn.disabled = true;
            deleteBtn.disabled = true;
            return;
        }

        if (selectedCount === 0) {
            updateBtn.disabled = true;
            reqBtn.disabled = true;
            deleteBtn.disabled = true;
            return;
        }

        deleteBtn.disabled = false;

        let canUpdateAny = false;
        let canInstallReqAny = false;

        for (const nodeName of this.selectedNodes) {
            const node = this.nodesList.find(n => n.name === nodeName); 
            if (node) {
                if (node.is_git_repo || node.repo_url) { 
                    canUpdateAny = true;
                }
                if (node.has_requirements_txt) { 
                    canInstallReqAny = true;
                }
            }
        }
        updateBtn.disabled = !canUpdateAny;
        reqBtn.disabled = !canInstallReqAny; 
    },

    async fetchReadme(node) { 
        const headerEl = document.getElementById("holaf-nodes-manager-readme-header");
        const contentEl = document.getElementById("holaf-nodes-manager-readme-content");

        headerEl.innerHTML = `<h3>${node.name}</h3>`;
        contentEl.innerHTML = `<p class="holaf-manager-message">Loading...</p>`;

        let effectiveRepoUrl = node.repo_url; 
        let readmeText = null;
        let source = 'local';
        let repoUrlWasFoundThisCall = false;

        if (!node.is_git_repo && !effectiveRepoUrl) { 
            contentEl.innerHTML = `<p class="holaf-manager-message">No local Git repo. Searching GitHub for "${node.name}"...</p>`;
            try {
                const searchResponse = await fetch(`/holaf/nodes/search/github/${encodeURIComponent(node.name)}`);
                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    if (searchData.url) {
                        effectiveRepoUrl = searchData.url; 
                        repoUrlWasFoundThisCall = true; 
                        node.repo_url = effectiveRepoUrl; 
                        this.rerenderNodeItemIcons(node.name, node); 
                        this.updateActionButtonsState(); 
                    }
                }
            } catch (e) {
                console.warn(`[Holaf NodesManager] GitHub search failed for ${node.name}:`, e);
            }
        }
        
        let githubLinkText = "GitHub Repo";
        if (node.is_git_repo && node.repo_url) githubLinkText = "Local Git Source";
        else if (repoUrlWasFoundThisCall) githubLinkText = "Found on GitHub"; 
        else if (node.repo_url) githubLinkText = "Detected Remote"; 

        if (effectiveRepoUrl) {
             const repoLink = `<a href="${effectiveRepoUrl}" target="_blank" title="Open on GitHub">${githubLinkText}</a>`;
            headerEl.innerHTML = `<h3>${node.name}</h3> ${repoLink}`;
            contentEl.innerHTML = `<p class="holaf-manager-message">Fetching README from GitHub (${effectiveRepoUrl})...</p>`;
            const match = effectiveRepoUrl.match(/github\.com[/:]([^/]+\/[^/]+)/);
            if (match && match[1]) {
                const [owner, repoWithGit] = match[1].split('/');
                const repo = repoWithGit.replace(/\.git$/, ''); 
                try {
                    const response = await fetch('/holaf/nodes/readme/github', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ owner, repo })
                    });
                    if (response.ok) {
                        readmeText = await response.text();
                        source = node.is_git_repo ? 'GitHub (via Local Git)' : 'GitHub (Found/Remote)';
                    } else {
                         console.warn(`[Holaf NodesManager] GitHub README fetch non-OK for ${owner}/${repo}: ${response.status}`);
                    }
                } catch (e) {
                    console.error(`[Holaf NodesManager] Network error fetching GitHub README for ${owner}/${repo}:`, e);
                }
            }
        }

        if (readmeText === null) { 
            if (effectiveRepoUrl) { 
                contentEl.innerHTML = `<p class="holaf-manager-message">Could not retrieve README from GitHub. Checking for a local file...</p>`;
            } else { 
                 headerEl.innerHTML = `<h3>${node.name}</h3>`; 
                contentEl.innerHTML = `<p class="holaf-manager-message">No GitHub repository identified. Checking for a local file...</p>`;
            }
            try {
                const response = await fetch(`/holaf/nodes/readme/local/${encodeURIComponent(node.name)}`);
                if (response.ok) {
                    readmeText = await response.text();
                    source = 'Local File';
                }
            } catch (e) {
                console.error(`[Holaf NodesManager] Error fetching local README for ${node.name}:`, e);
            }
        }

        if (readmeText === null) {
            readmeText = `## No README Found\n\nCould not find a README file on GitHub or locally for **${node.name}**.`;
             if (!effectiveRepoUrl) { 
                 headerEl.innerHTML = `<h3>${node.name}</h3>`; 
            }
        }

        if (this.scriptsLoaded && window.marked) {
            contentEl.innerHTML = window.marked.parse(readmeText);
        } else {
            contentEl.textContent = readmeText;
        }
        
        const sourceTag = document.createElement('span');
        sourceTag.className = 'readme-source-tag'; 
        sourceTag.textContent = `Source: ${source}`;
        sourceTag.style.fontSize = '0.8em';
        sourceTag.style.marginLeft = '10px';
        sourceTag.style.color = 'var(--holaf-text-secondary)';
        headerEl.appendChild(sourceTag);
    },

    rerenderNodeItemIcons(nodeName, nodeData) {
        const listEl = document.getElementById("holaf-nodes-manager-list");
        if (!listEl) return;

        const items = listEl.querySelectorAll(".holaf-nodes-manager-list-item");
        for (const itemEl of items) {
            const checkbox = itemEl.querySelector('.holaf-nodes-manager-item-cb');
            if (checkbox && checkbox.dataset.nodeName === nodeName) {
                this._appendIconsToItem(itemEl, nodeData); // Use helper
                break; 
            }
        }
    },

    async _executeNodeAction(actionPath, nodePayloads, actionName, confirmMessage) {
        if (this.isActionInProgress) {
            HolafPanelManager.createDialog({ title: "Action In Progress", message: "Another action is currently running. Please wait." });
            return;
        }
        if (!nodePayloads || nodePayloads.length === 0) {
            HolafPanelManager.createDialog({ title: actionName, message: "No nodes selected for this action." });
            return;
        }
        
        const nodeNamesForDisplay = nodePayloads.map(p => p.name).join(', ');

        const confirm = await HolafPanelManager.createDialog({
            title: `Confirm ${actionName}`,
            message: `${confirmMessage}\n\nNodes: ${nodeNamesForDisplay}`,
            buttons: [{ text: "Cancel", value: false, type: "cancel" }, { text: actionName, value: true, type: actionName === "Delete" ? "danger" : "confirm" }]
        });

        if (!confirm) return;

        this.isActionInProgress = true;
        this.updateActionButtonsState(); 
        
        let inProgressOverlayElement = null;

        const showInProgressDialog = () => {
            if (inProgressOverlayElement) return; 

            inProgressOverlayElement = document.createElement("div");
            inProgressOverlayElement.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.6); z-index: 200000; 
                display: flex; align-items: center; justify-content: center;
            `;
            
            const dialog = document.createElement("div");
            dialog.className = "holaf-utility-panel"; 
            
            const currentThemeName = (holafModelManager && holafModelManager.settings && holafModelManager.settings.theme) 
                ? holafModelManager.settings.theme 
                : HOLAF_THEMES[0].name;
            const themeConfig = HOLAF_THEMES.find(t => t.name === currentThemeName) || HOLAF_THEMES[0];
            dialog.classList.add(themeConfig.className);

            dialog.style.position = "relative";
            dialog.style.transform = "none";
            dialog.style.width = "auto";
            dialog.style.minWidth = "300px";
            dialog.style.maxWidth = "500px";
            dialog.style.height = "auto";
            dialog.style.top = "auto";
            dialog.style.left = "auto";
            dialog.style.boxShadow = "0 5px 20px rgba(0,0,0,0.7)";


            const header = document.createElement("div");
            header.className = "holaf-utility-header";
            header.innerHTML = `<span>${actionName} In Progress</span>`;
            
            const contentDiv = document.createElement("div"); 
            contentDiv.innerHTML = `<p style="padding: 15px 20px; color: var(--holaf-text-primary); white-space: pre-wrap;">Processing ${nodePayloads.length} node(s)...\n\nThis may take a while. Check server console for detailed progress.\n\nResults will be shown here upon completion.</p>`;

            dialog.append(header, contentDiv);
            inProgressOverlayElement.appendChild(dialog);
            document.body.appendChild(inProgressOverlayElement);
        };

        const removeInProgressDialog = () => {
            if (inProgressOverlayElement && inProgressOverlayElement.parentNode) {
                inProgressOverlayElement.parentNode.removeChild(inProgressOverlayElement);
                inProgressOverlayElement = null;
            }
        };

        showInProgressDialog();
        
        try {
            const response = await fetch(actionPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_payloads: nodePayloads }) 
            });
            const result = await response.json();
            
            removeInProgressDialog(); 

            let summaryMessage = `${actionName} Results:\n\n`;
            let refreshNeeded = false;
            
            if (result.details && Array.isArray(result.details)) {
                result.details.forEach(item => {
                    summaryMessage += `Node: ${item.node_name}\nStatus: ${item.status}\nMessage: ${item.message || 'N/A'}\n`;
                    if (item.output) summaryMessage += `Output:\n${item.output.substring(0, 300)}${item.output.length > 300 ? '...' : ''}\n`;
                    summaryMessage += "----------------------------\n";
                    
                    if (item.status === 'success') {
                        if (actionName === "Delete" || actionName === "Update") {
                            refreshNeeded = true;
                        }
                        if (actionName === "Update" && item.new_status) {
                            const updatedNodeInList = this.nodesList.find(n => n.name === item.node_name);
                            if (updatedNodeInList) {
                                updatedNodeInList.is_git_repo = item.new_status.is_git_repo;
                                updatedNodeInList.repo_url = item.new_status.repo_url;
                            }
                        }
                    }
                });
            } else {
                summaryMessage += `Server Response: ${result.status || 'Unknown'} - ${result.message || 'No specific details.'}`;
            }
            
            HolafPanelManager.createDialog({ title: `${actionName} Complete`, message: summaryMessage }); 
            
            if (refreshNeeded) {
                await this.refreshNodesList(); 
            } else {
                 this.updateActionButtonsState(); 
                 this.updateSelectAllCheckboxState();
            }

        } catch (error) {
            removeInProgressDialog(); 
            console.error(`[Holaf NodesManager] Error during ${actionName}:`, error);
            HolafPanelManager.createDialog({ title: `${actionName} Error`, message: `An error occurred: ${error.message}. Check browser and server console.` });
        } finally {
            removeInProgressDialog(); 
            this.isActionInProgress = false;
            if (!refreshNeeded) { 
                 this.updateActionButtonsState();
            }
        }
    },

    async handleUpdateSelected() {
        const nodesToUpdatePayloads = Array.from(this.selectedNodes)
            .map(name => {
                const node = this.nodesList.find(n => n.name === name);
                if (node && (node.is_git_repo || node.repo_url)) {
                    return { 
                        name: node.name, 
                        repo_url_override: (!node.is_git_repo && node.repo_url) ? node.repo_url : null 
                    };
                }
                return null;
            })
            .filter(payload => payload !== null);

        if (nodesToUpdatePayloads.length === 0) {
            HolafPanelManager.createDialog({ title: "Update Nodes", message: "No selected nodes are local Git repositories or have a detected GitHub URL for update attempt." });
            return;
        }
        
        const gitRepoNodes = nodesToUpdatePayloads.filter(p => {
            const node = this.nodesList.find(n => n.name === p.name); 
            return node && node.is_git_repo; 
        }).map(p => p.name);

        const manualNodesWithUrl = nodesToUpdatePayloads.filter(p => p.repo_url_override !== null).map(p => p.name);

        let message = "This will attempt to update the selected nodes.\n";
        if (gitRepoNodes.length > 0) {
            message += `\nFor LOCAL GIT repositories (${gitRepoNodes.join(', ')}):\nLocal changes to tracked files will be OVERWRITTEN with the latest from the remote. Untracked files will be kept.\n`;
        }
        if (manualNodesWithUrl.length > 0) {
            message += `\nFor manually installed nodes with a found GitHub URL (${manualNodesWithUrl.join(', ')}):\nThis will RENAME the current folder, CLONE the repository, and attempt to RESTORE any files from the original folder that are not in the new clone. BACKUP YOUR NODE MANUALLY IF YOU HAVE CRITICAL UNTRACKED CHANGES.\n`;
        }
        message += "\nAre you sure you want to proceed?";
        
        await this._executeNodeAction(
            '/holaf/nodes/update', 
            nodesToUpdatePayloads, 
            "Update", 
            message
        );
    },

    async handleDeleteSelected() {
        const nodesToDeletePayloads = Array.from(this.selectedNodes).map(name => ({ name: name, repo_url_override: null }));
        await this._executeNodeAction(
            '/holaf/nodes/delete',
            nodesToDeletePayloads,
            "Delete",
            "WARNING: This will PERMANENTLY DELETE the folder(s) for the selected node(s). This action cannot be undone. Are you absolutely sure?"
        );
    },

    async handleInstallRequirementsSelected() {
        const nodesForReqPayloads = Array.from(this.selectedNodes)
            .filter(name => {
                const node = this.nodesList.find(n => n.name === name);
                return node && node.has_requirements_txt;
            })
            .map(name => ({ name: name, repo_url_override: null }));

        await this._executeNodeAction(
            '/holaf/nodes/install-requirements',
            nodesForReqPayloads,
            "Install Requirements",
            "This will attempt to run 'pip install -r requirements.txt' for the selected nodes. Ensure your ComfyUI Python environment is active. This might take some time."
        );
    },

    applyCurrentTheme() {
        if (this.panelElements && this.panelElements.panelEl) {
            const currentThemeName = (holafModelManager && holafModelManager.settings && holafModelManager.settings.theme) 
                ? holafModelManager.settings.theme 
                : HOLAF_THEMES[0].name; 
            const themeConfig = HOLAF_THEMES.find(t => t.name === currentThemeName) || HOLAF_THEMES[0];
            
            HOLAF_THEMES.forEach(theme => {
                if (this.panelElements.panelEl.classList.contains(theme.className)) {
                    this.panelElements.panelEl.classList.remove(theme.className);
                }
            });
            this.panelElements.panelEl.classList.add(themeConfig.className);
        }
    },

    show() {
        if (!this.panelElements) {
            this.createPanel();
        }

        if (this.panelElements && this.panelElements.panelEl) {
            const isVisible = this.panelElements.panelEl.style.display === "flex";
            if (isVisible) {
                this.panelElements.panelEl.style.display = "none";
                return;
            }

            this.applyCurrentTheme();
            this.panelElements.panelEl.style.display = "flex";
            HolafPanelManager.bringToFront(this.panelElements.panelEl);
            if (!this.isInitialized || this.nodesList.length === 0) { 
                this.refreshNodesList(); 
                this.isInitialized = true;
            } else {
                this.renderNodesList(); 
                this.updateActionButtonsState();
                this.updateSelectAllCheckboxState();
            }
        }
    },

    hide() {
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.display = "none";
        }
    }
};

app.registerExtension({
    name: "Holaf.NodesManager.Panel",
    async setup() {
        setTimeout(() => holafNodesManager.ensureMenuItemAdded(), 150);
    },
});

export default holafNodesManager;