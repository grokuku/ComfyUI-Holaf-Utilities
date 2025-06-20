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
    selectedNode: null,

    async ensureScriptsLoaded() {
        if (this.scriptsLoaded) return true;
        try {
            // Using a popular, reliable CDN for marked.js
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
                        <button id="holaf-nodes-manager-refresh-btn" class="comfy-button">Refresh</button>
                    </div>
                    <div id="holaf-nodes-manager-list" class="holaf-nodes-manager-list">
                        <p class="holaf-manager-message">Click Refresh to scan...</p>
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
    },

    async refreshNodesList() {
        const listEl = document.getElementById("holaf-nodes-manager-list");
        const readmeHeaderEl = document.getElementById("holaf-nodes-manager-readme-header");
        const readmeContentEl = document.getElementById("holaf-nodes-manager-readme-content");
        if (!listEl || !readmeHeaderEl || !readmeContentEl) return;

        listEl.innerHTML = `<p class="holaf-manager-message">Scanning...</p>`;
        readmeHeaderEl.textContent = 'Select a node to see details';
        readmeContentEl.innerHTML = '';
        this.selectedNode = null;

        try {
            const response = await fetch("/holaf/nodes/list");
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error ${response.status}`);
            }
            const data = await response.json();
            this.nodesList = data.nodes || [];
            this.renderNodesList();
        } catch (e) {
            console.error("[Holaf NodesManager] Error fetching node list:", e);
            listEl.innerHTML = `<p class="holaf-manager-message error">Error loading nodes. Check console.</p>`;
        }
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

            let content = `<span>${node.name}</span>`;
            if (node.repo_url) {
                content += `<svg title="Git repository detected" class="holaf-nodes-manager-git-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0v1a6 6 0 0 0 6 6h1a5 5 0 0 0 5-5V8zm-6 6a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/><path d="M12 14v6"/><path d="M15 17H9"/></svg>`;
            } else {
                content += `<svg title="Manually installed (will search GitHub)" class="holaf-nodes-manager-manual-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/></svg>`;
            }
            itemEl.innerHTML = content;

            itemEl.onclick = () => this.selectNode(node);
            listEl.appendChild(itemEl);
        });
    },

    async selectNode(node) {
        if (this.selectedNode && this.selectedNode.name === node.name) return;
        this.selectedNode = node;

        const listEl = document.getElementById("holaf-nodes-manager-list");
        listEl.querySelectorAll(".holaf-nodes-manager-list-item").forEach(item => {
            item.classList.toggle("selected", item.querySelector('span').textContent === node.name);
        });

        this.fetchReadme(node);
    },

    async fetchReadme(node) {
        const headerEl = document.getElementById("holaf-nodes-manager-readme-header");
        const contentEl = document.getElementById("holaf-nodes-manager-readme-content");

        headerEl.innerHTML = `<h3>${node.name}</h3>`;
        contentEl.innerHTML = `<p class="holaf-manager-message">Loading...</p>`;

        let effectiveRepoUrl = node.repo_url;
        let readmeText = null;
        let source = 'local';

        // --- Phase 1: Try to find a repo URL ---
        if (!effectiveRepoUrl) {
            contentEl.innerHTML = `<p class="holaf-manager-message">No local Git repo. Searching GitHub for "${node.name}"...</p>`;
            try {
                const searchResponse = await fetch(`/holaf/nodes/search/github/${encodeURIComponent(node.name)}`);
                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    if (searchData.url) {
                        effectiveRepoUrl = searchData.url;
                        node.repo_url = effectiveRepoUrl; // Cache for this session
                    }
                }
            } catch (e) {
                console.warn(`[Holaf NodesManager] GitHub search failed for ${node.name}:`, e);
            }
        }

        // --- Phase 2: Try to fetch from GitHub if we have a URL ---
        if (effectiveRepoUrl) {
            headerEl.innerHTML = `<h3>${node.name}</h3> <a href="${effectiveRepoUrl}" target="_blank" title="Open on GitHub">GitHub Repo</a>`;
            contentEl.innerHTML = `<p class="holaf-manager-message">Fetching README from GitHub...</p>`;
            const match = effectiveRepoUrl.match(/github\.com[/:]([^/]+\/[^/]+)/);
            if (match && match[1]) {
                const [owner, repo] = match[1].split('/');
                try {
                    const response = await fetch('/holaf/nodes/readme/github', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ owner, repo })
                    });
                    if (response.ok) {
                        readmeText = await response.text();
                        source = node.repo_url === effectiveRepoUrl && !node.repo_url_was_searched ? 'GitHub (Local Git)' : 'GitHub (Found)';
                    }
                } catch (e) {
                    console.error(`[Holaf NodesManager] Network error fetching GitHub README for ${owner}/${repo}:`, e);
                }
            }
        }

        // --- Phase 3: Fallback to local README if GitHub failed or was not attempted ---
        if (readmeText === null) {
            if (effectiveRepoUrl) { // We tried GitHub and it failed
                contentEl.innerHTML = `<p class="holaf-manager-message">Could not retrieve README from GitHub. Checking for a local file...</p>`;
            } else { // We didn't even find a repo
                contentEl.innerHTML = `<p class="holaf-manager-message">Could not find a GitHub repo. Checking for a local file...</p>`;
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

        // --- Phase 4: Render the final result ---
        if (readmeText === null) {
            readmeText = `## No README Found\n\nCould not find a README file on GitHub or locally for **${node.name}**.`;
        }

        if (this.scriptsLoaded && window.marked) {
            contentEl.innerHTML = window.marked.parse(readmeText);
        } else {
            contentEl.textContent = readmeText; // Fallback to plain text
        }
        headerEl.innerHTML += `<span class="readme-source-tag">Source: ${source}</span>`;
    },

    applyCurrentTheme() {
        if (this.panelElements && this.panelElements.panelEl) {
            const currentThemeName = holafModelManager.settings.theme;
            const themeConfig = HOLAF_THEMES.find(t => t.name === currentThemeName) || HOLAF_THEMES[0];
            this.panelElements.panelEl.className = "holaf-utility-panel " + themeConfig.className;
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
            if (!this.isInitialized) {
                this.refreshNodesList();
                this.isInitialized = true;
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