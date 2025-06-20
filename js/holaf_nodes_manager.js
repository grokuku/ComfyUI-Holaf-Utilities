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
                        <button id="holaf-nodes-manager-update-btn" class="comfy-button" disabled title="Update selected nodes. For Git repos: overwrites local changes. For others with URL: (Simulated)">Update</button>
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
        readmeHeaderEl.textContent = 'Select a node to see details';
        readmeContentEl.innerHTML = '';
        this.currentlyDisplayedNode = null;
        this.selectedNodes.clear();

        try {
            const response = await fetch("/holaf/nodes/list");
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
            }
            const data = await response.json();
            this.nodesList = data.nodes || []; 
            console.log("[Holaf NodesManager] Nodes list from backend:", JSON.stringify(this.nodesList, null, 2));
            this.renderNodesList();
        } catch (e) {
            console.error("[Holaf NodesManager] Error fetching node list:", e);
            listEl.innerHTML = `<p class="holaf-manager-message error">Error loading nodes. Check console.</p>`;
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
            checkbox.onchange = (e) => {
                if (e.target.checked) {
                    this.selectedNodes.add(node.name);
                } else {
                    this.selectedNodes.delete(node.name);
                }
                this.updateActionButtonsState();
                this.updateSelectAllCheckboxState();
            };

            const nameSpan = document.createElement("span");
            nameSpan.textContent = node.name;
            nameSpan.style.cursor = "pointer"; 

            let iconsHTML = '';
            if (node.has_requirements_txt) {
                 iconsHTML += `<svg title="Has requirements.txt" class="holaf-nodes-manager-req-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color: var(--holaf-text-secondary);"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2v2H9v-2H7v-2h2V9h2v2h2v2zm4-10H5V2.5L13 2.5V3c0 .55.45 1 1 1h.5v.5z"/></svg>`;
            }
            
            if (node.is_git_repo && node.repo_url) { 
                iconsHTML += `<svg title="Local Git repository: ${node.repo_url}" class="holaf-nodes-manager-git-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0v1a6 6 0 0 0 6 6h1a5 5 0 0 0 5-5V8zm-6 6a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/><path d="M12 14v6"/><path d="M15 17H9"/></svg>`;
            } else if (node.repo_url) { 
                 iconsHTML += `<svg title="GitHub repo found (manual install): ${node.repo_url}" class="holaf-nodes-manager-manual-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--holaf-accent-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>`;
            } else { 
                iconsHTML += `<svg title="Manually installed (no remote repo identified)" class="holaf-nodes-manager-manual-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>`;
            }

            itemEl.appendChild(checkbox);
            itemEl.appendChild(nameSpan);
            
            const iconsContainer = document.createElement('span');
            iconsContainer.innerHTML = iconsHTML;
            iconsContainer.style.marginLeft = 'auto'; 
            iconsContainer.style.display = 'flex';
            iconsContainer.style.alignItems = 'center';
            iconsContainer.style.gap = '4px';

            itemEl.appendChild(iconsContainer);
            
            itemEl.onclick = (e) => {
                if (e.target.type === 'checkbox') return; 
                this.displayReadmeForNode(node);
            };
            listEl.appendChild(itemEl);
        });
        this.updateSelectAllCheckboxState();
    },
    
    displayReadmeForNode(node) {
        if (this.currentlyDisplayedNode && this.currentlyDisplayedNode.name === node.name) return;
        this.currentlyDisplayedNode = node;

        const listEl = document.getElementById("holaf-nodes-manager-list");
        listEl.querySelectorAll(".holaf-nodes-manager-list-item").forEach(item => {
            // Find the name span correctly, avoid matching icons if they were spans
            const nameSpan = Array.from(item.childNodes).find(cn => cn.nodeName === "SPAN" && !cn.innerHTML.includes("<svg"));
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
            this.nodesList.forEach(node => this.selectedNodes.add(node.name));
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

        let canUpdate = false;
        let canInstallReq = false;

        for (const nodeName of this.selectedNodes) {
            const node = this.nodesList.find(n => n.name === nodeName);
            if (node) {
                if (node.is_git_repo || node.repo_url) { // Can attempt update if local git or found remote URL
                    canUpdate = true;
                }
                if (node.has_requirements_txt) { 
                    canInstallReq = true;
                }
            }
        }
        updateBtn.disabled = !canUpdate;
        reqBtn.disabled = !canInstallReq; 
    },

    async fetchReadme(node) {
        const headerEl = document.getElementById("holaf-nodes-manager-readme-header");
        const contentEl = document.getElementById("holaf-nodes-manager-readme-content");

        headerEl.innerHTML = `<h3>${node.name}</h3>`;
        contentEl.innerHTML = `<p class="holaf-manager-message">Loading...</p>`;

        let effectiveRepoUrl = node.repo_url; // Initially, this is the URL from local .git/config if it exists
        let readmeText = null;
        let source = 'local';
        let repoUrlWasSearched = false;

        if (!node.is_git_repo && !effectiveRepoUrl) { // If not a local git repo AND no remote URL known from scan (e.g. from a previous search)
            contentEl.innerHTML = `<p class="holaf-manager-message">No local Git repo. Searching GitHub for "${node.name}"...</p>`;
            try {
                const searchResponse = await fetch(`/holaf/nodes/search/github/${encodeURIComponent(node.name)}`);
                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    if (searchData.url) {
                        effectiveRepoUrl = searchData.url; // Now we have a URL to try
                        repoUrlWasSearched = true; 
                        node.repo_url = effectiveRepoUrl; // Cache it on the node object for this session
                    }
                }
            } catch (e) {
                console.warn(`[Holaf NodesManager] GitHub search failed for ${node.name}:`, e);
            }
        }
        
        let githubLinkText = "GitHub Repo";
        if (node.is_git_repo && node.repo_url) githubLinkText = "Local Git Source";
        else if (repoUrlWasSearched && effectiveRepoUrl) githubLinkText = "Found on GitHub";
        else if (node.repo_url) githubLinkText = "Detected Remote"; // Fallback if somehow repo_url exists but not is_git_repo initially

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

        if (readmeText === null) { // If GitHub fetch failed or wasn't attempted
            if (effectiveRepoUrl) { // We tried GitHub and it failed
                contentEl.innerHTML = `<p class="holaf-manager-message">Could not retrieve README from GitHub. Checking for a local file...</p>`;
            } else { // We didn't even find/have a repo URL
                 headerEl.innerHTML = `<h3>${node.name}</h3>`; // Clean header if no repo link
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
                 headerEl.innerHTML = `<h3>${node.name}</h3>`; // Ensure header is clean
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

    async _executeNodeAction(actionPath, selectedNodeNames, actionName, confirmMessage) {
        if (this.isActionInProgress) {
            HolafPanelManager.createDialog({ title: "Action In Progress", message: "Another action is currently running. Please wait." });
            return;
        }
        if (selectedNodeNames.length === 0) {
            HolafPanelManager.createDialog({ title: actionName, message: "No nodes selected for this action." });
            return;
        }

        const confirm = await HolafPanelManager.createDialog({
            title: `Confirm ${actionName}`,
            message: `${confirmMessage}\n\nNodes: ${selectedNodeNames.join(', ')}`,
            buttons: [{ text: "Cancel", value: false, type: "cancel" }, { text: actionName, value: true, type: actionName === "Delete" ? "danger" : "confirm" }]
        });

        if (!confirm) return;

        this.isActionInProgress = true;
        this.updateActionButtonsState(); 
        
        const dialogHandle = HolafPanelManager.createDialog({ 
            title: `${actionName} In Progress`, 
            message: `Processing ${selectedNodeNames.length} node(s)...\n\nThis may take a while. Check server console for detailed progress.\n\nResults will be shown here upon completion.`,
            buttons: [] // No buttons initially, or a cancel that does nothing yet
        });
        // We don't await dialogHandle here, it's just to show the message

        try {
            const response = await fetch(actionPath, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_names: selectedNodeNames })
            });
            const result = await response.json();

            let summaryMessage = `${actionName} Results:\n\n`;
            let refreshNeeded = false;
            if (result.details && Array.isArray(result.details)) {
                result.details.forEach(item => {
                    summaryMessage += `Node: ${item.node_name}\nStatus: ${item.status}\nMessage: ${item.message || 'N/A'}\n`;
                    if (item.output) summaryMessage += `Output:\n${item.output.substring(0, 300)}${item.output.length > 300 ? '...' : ''}\n`;
                    summaryMessage += "----------------------------\n";
                    if (item.status === 'success' && (actionName === "Delete" || actionName === "Update")) {
                        refreshNeeded = true;
                    }
                });
            } else {
                summaryMessage += `Server Response: ${result.status || 'Unknown'} - ${result.message || 'No specific details.'}`;
            }
            
            // Close the "In Progress" dialog if it's still open by recreating it with results
            HolafPanelManager.createDialog({ title: `${actionName} Complete`, message: summaryMessage });
            
            if (refreshNeeded) {
                await this.refreshNodesList(); 
            } else {
                this.selectedNodes.clear(); 
                this.renderNodesList(); 
                 this.updateActionButtonsState(); // Re-enable buttons after non-refresh
                 this.updateSelectAllCheckboxState();
            }

        } catch (error) {
            console.error(`[Holaf NodesManager] Error during ${actionName}:`, error);
            HolafPanelManager.createDialog({ title: `${actionName} Error`, message: `An error occurred: ${error.message}. Check browser and server console.` });
        } finally {
            this.isActionInProgress = false;
            // If refreshNodesList was called, it handles button state. Otherwise, do it here.
            if (!refreshNeeded) { // refreshNeeded would have cleared selection and updated buttons
                 this.updateActionButtonsState();
            }
        }
    },

    async handleUpdateSelected() {
        const nodesToUpdateDetails = Array.from(this.selectedNodes)
            .map(name => this.nodesList.find(n => n.name === name))
            .filter(node => node && (node.is_git_repo || node.repo_url)); 

        if (nodesToUpdateDetails.length === 0) {
            HolafPanelManager.createDialog({ title: "Update Nodes", message: "No selected nodes are local Git repositories or have a detected GitHub URL for update attempt." });
            return;
        }
        
        const gitRepoNodes = nodesToUpdateDetails.filter(n => n.is_git_repo).map(n => n.name);
        const manualNodesWithUrl = nodesToUpdateDetails.filter(n => !n.is_git_repo && n.repo_url).map(n => n.name);

        let message = "This will attempt to update the selected nodes.\n";
        if (gitRepoNodes.length > 0) {
            message += `\nFor LOCAL GIT repositories (${gitRepoNodes.join(', ')}):\nLocal changes to tracked files will be OVERWRITTEN with the latest from the remote. Untracked files will be kept.\n`;
        }
        if (manualNodesWithUrl.length > 0) {
            message += `\nFor manually installed nodes with a found GitHub URL (${manualNodesWithUrl.join(', ')}):\nThis action is currently NOT SUPPORTED for these nodes by the backend and will likely result in an 'info' message.\n`;
        }
        message += "\nAre you sure you want to proceed?";
        
        const nodeNamesToProcess = nodesToUpdateDetails.map(n => n.name);

        await this._executeNodeAction(
            '/holaf/nodes/update', 
            nodeNamesToProcess, 
            "Update", 
            message
        );
    },

    async handleDeleteSelected() {
        const nodesToDelete = Array.from(this.selectedNodes);
        await this._executeNodeAction(
            '/holaf/nodes/delete',
            nodesToDelete,
            "Delete",
            "WARNING: This will PERMANENTLY DELETE the folder(s) for the selected node(s). This action cannot be undone. Are you absolutely sure?"
        );
    },

    async handleInstallRequirementsSelected() {
        const nodesForReq = Array.from(this.selectedNodes).filter(name => {
            const node = this.nodesList.find(n => n.name === name);
            return node && node.has_requirements_txt;
        });
        await this._executeNodeAction(
            '/holaf/nodes/install-requirements',
            nodesForReq,
            "Install Requirements",
            "This will attempt to run 'pip install -r requirements.txt' for the selected nodes. Ensure your ComfyUI Python environment is active. This might take some time."
        );
    },

    applyCurrentTheme() {
        if (this.panelElements && this.panelElements.panelEl) {
            const currentThemeName = holafModelManager.settings.theme;
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