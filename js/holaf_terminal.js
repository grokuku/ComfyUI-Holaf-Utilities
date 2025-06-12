/* === Documentation ===
 * Author: Holaf, with assistance from Cline (AI Assistant)
 * Date: 2025-05-23 (Final)
 *
 * How it works (v13.2 - Enhanced Debugging for show()):
 * Added more detailed logging in the show() function to trace panelElements state.
 * === End Documentation ===
 */
import { app } from "../../../scripts/app.js";
import { HolafPanelManager } from "./holaf_panel_manager.js";

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript && existingScript.dataset.loaded) {
            console.log(`[Holaf Terminal] Script ${src} already processed (marked as loaded).`);
            resolve();
            return;
        }
        if (existingScript && !existingScript.dataset.loaded) {
            console.log(`[Holaf Terminal] Script ${src} loading or already loaded but not marked, waiting...`);
            existingScript.addEventListener('load', () => {
                console.log(`[Holaf Terminal] Script ${src} confirmed loaded (event).`);
                existingScript.dataset.loaded = true;
                resolve();
            });
            existingScript.addEventListener('error', () => {
                console.error(`[Holaf Terminal] Failed to load script (event): ${src}`);
                reject(new Error(`Failed to load script: ${src}`));
            });
            // If already loaded by the browser but onload didn't fire or was missed
            if (existingScript.readyState === 'loaded' || existingScript.readyState === 'complete') {
                setTimeout(() => { // Give a tick for any pending onload to fire
                    if (!existingScript.dataset.loaded) {
                        console.log(`[Holaf Terminal] Script ${src} was already in readyState complete/loaded.`);
                        existingScript.dataset.loaded = true;
                        resolve();
                    }
                }, 0);
            }
            return;
        }

        console.log(`[Holaf Terminal] Loading script: ${src}`);
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
            console.log(`[Holaf Terminal] Script ${src} loaded successfully.`);
            script.dataset.loaded = true; // Mark as loaded
            resolve();
        };
        script.onerror = () => {
            console.error(`[Holaf Terminal] Failed to load script: ${src}`);
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

const holafTerminal = {
    panelElements: null,
    terminal: null,
    fitAddon: null,
    socket: null,
    isInitialized: false,
    scriptsLoaded: false, // Track if xterm scripts are loaded
    settings: {
        fontSize: 14,
        theme: 'Dark',
        panel_x: null,
        panel_y: null,
        panel_width: 600,
        panel_height: 400,
    },
    themes: [
        { name: 'Dark', background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#555555' },
        { name: 'Light', background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', selectionBackground: '#eee8d5' },
        { name: 'Solarized Dark', background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642' },
        { name: 'Monokai', background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#49483e' },
        { name: 'Comfy', background: '#222222', foreground: '#e0e0e0', cursor: '#ffffff', selectionBackground: '#4a4a4a' }
    ],
    saveTimeout: null,

    async ensureScriptsLoaded() {
        if (this.scriptsLoaded) return true;
        try {
            const basePath = "extensions/ComfyUI-Holaf-Utilities/js/";
            // Ensure xterm.js is loaded first, then fitAddon
            if (!window.Terminal) { // Check if Terminal global exists
                console.log("[Holaf Terminal] xterm.js not found, loading it.");
                await loadScript(`${basePath}xterm.js`);
            } else {
                console.log("[Holaf Terminal] xterm.js already available.");
            }

            if (!window.FitAddon) { // Check if FitAddon global exists
                console.log("[Holaf Terminal] FitAddon not found, loading it.");
                await loadScript(`${basePath}xterm-addon-fit.js`);
            } else {
                console.log("[Holaf Terminal] FitAddon already available.");
            }

            this.scriptsLoaded = true;
            console.log("[Holaf Terminal] xterm.js and fitAddon are ready.");
            return true;
        } catch (error) {
            console.error("Holaf Utilities: Critical error loading xterm scripts", error);
            if (this.terminalContainer) {
                this.terminalContainer.textContent = "Error: Could not load terminal components. Check console.";
            }
            this.scriptsLoaded = false; // Explicitly set to false on error
            return false;
        }
    },

    addMenuItem() {
        console.log("[Holaf Terminal] addMenuItem called.");
        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf Terminal] Could not find the main utilities dropdown menu. Retrying...");
            setTimeout(() => this.addMenuItem(), 500);
            return;
        }

        const terminalMenuItem = document.createElement("li");
        terminalMenuItem.textContent = "Terminal";
        terminalMenuItem.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            color: var(--fg-color, #ccc);
        `;
        terminalMenuItem.onmouseover = () => { terminalMenuItem.style.backgroundColor = 'var(--comfy-menu-item-bg-hover, #333)'; };
        terminalMenuItem.onmouseout = () => { terminalMenuItem.style.backgroundColor = 'transparent'; };

        terminalMenuItem.onclick = () => {
            console.log("[Holaf Terminal] Terminal menu item clicked.");
            this.show();
            dropdownMenu.style.display = "none";
        };

        dropdownMenu.prepend(terminalMenuItem);
        console.log("[Holaf Terminal] Menu item added.");
    },

    createPanel() {
        console.log("[Holaf Terminal] createPanel called.");
        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf Terminal] Panel already exists, skipping creation.");
            return;
        }
        console.log("[Holaf Terminal] Panel does not exist, proceeding with creation.");

        const terminalHeaderControls = document.createElement("div");
        terminalHeaderControls.className = "holaf-terminal-header-button-group";

        const themeButtonContainer = document.createElement("div");
        themeButtonContainer.style.position = 'relative';

        const themeButton = document.createElement("button");
        themeButton.className = "holaf-terminal-header-button";
        themeButton.title = "Change Theme";
        themeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12.55a9.42 9.42 0 0 1-9.45 9.45 9.42 9.42 0 0 1-9.45-9.45 9.42 9.42 0 0 1 9.45-9.45 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 1-2.5 2.5Z"/></svg>`;

        const themeMenu = this.createThemeMenu();
        themeButton.onclick = (e) => {
            e.stopPropagation();
            themeMenu.style.display = themeMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', () => themeMenu.style.display = 'none');
        themeButtonContainer.append(themeButton, themeMenu);

        const fontDecButton = document.createElement("button");
        fontDecButton.className = "holaf-terminal-header-button";
        fontDecButton.title = "Decrease Font Size";
        fontDecButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`;
        fontDecButton.onclick = () => this.decreaseFontSize();

        const fontIncButton = document.createElement("button");
        fontIncButton.className = "holaf-terminal-header-button";
        fontIncButton.title = "Increase Font Size";
        fontIncButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
        fontIncButton.onclick = () => this.increaseFontSize();

        terminalHeaderControls.append(themeButtonContainer, fontDecButton, fontIncButton);
        console.log("[Holaf Terminal] Terminal header controls created.");

        console.log("[Holaf Terminal] Calling HolafPanelManager.createPanel with settings:", JSON.parse(JSON.stringify(this.settings))); // Deep copy for logging
        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-terminal-panel",
                title: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 5px;"><path d="M5 7L10 12L5 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Holaf Terminal`,
                headerContent: terminalHeaderControls,
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => { console.log("[Holaf Terminal] Panel close button clicked (handled by PanelManager)."); },
                onStateChange: (newState) => {
                    console.log("[Holaf Terminal] onStateChange triggered by PanelManager:", newState);
                    this.saveSettings({
                        panel_x: newState.x,
                        panel_y: newState.y,
                        panel_width: newState.width,
                        panel_height: newState.height,
                    });
                },
                onResize: () => { console.log("[Holaf Terminal] onResize triggered by PanelManager."); this.fitTerminal(); }
            });
            console.log("[Holaf Terminal] PanelManager.createPanel call completed. Panel elements:", this.panelElements);
        } catch (e) {
            console.error("[Holaf Terminal] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf Terminal] Error creating panel. Check console.");
            return;
        }

        const style = document.createElement("style");
        style.innerHTML = `
            #holaf-terminal-panel { 
                font-family: monospace; 
            }
            #holaf-terminal-panel .holaf-utility-header { 
                 gap: 10px; 
            }
            .holaf-terminal-header-button-group { 
                display: flex;
                gap: 4px;
                margin-left: 10px; 
                order: -1; 
            }
            .holaf-terminal-header-button { 
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #ccc;
                border-radius: 4px;
                cursor: pointer;
                padding: 2px;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .holaf-terminal-header-button:hover {
                background: rgba(255, 255, 255, 0.2);
                color: white;
            }
            #holaf-theme-menu { 
                position: absolute;
                top: 100%;
                left: 0; 
                background-color: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                z-index: 1002; 
                display: none;
                list-style: none;
                padding: 5px;
                margin: 2px 0 0;
                min-width: 120px;
            }
            #holaf-theme-menu li {
                color: #ccc;
                padding: 5px 10px;
                cursor: pointer;
            }
            #holaf-theme-menu li:hover {
                background-color: #333;
                color: white;
            }
            #holaf-terminal-panel .holaf-terminal-non-terminal-view { 
                padding: 15px;
                width: 100%; 
                box-sizing: border-box;
            }
            #holaf-terminal-panel .holaf-terminal-view-wrapper { 
                flex-grow: 1;
                padding: 0 5px 5px 10px; 
                overflow: hidden; 
                width: 100%; 
                height: 100%; 
                display: flex; 
                flex-direction: column; 
            }
            /* COMMENTED OUT FOR TESTING DRAG/RESIZE - Re-enable later if needed */
            /*
            #holaf-terminal-panel .holaf-terminal-view-wrapper > div { 
                width: 100% !important; 
                height: 100% !important; 
            }
            */
        `;
        document.head.appendChild(style);
        console.log("[Holaf Terminal] Terminal-specific CSS injected.");

        this.contentContainer = this.panelElements.contentEl;
        console.log("[Holaf Terminal] Content container:", this.contentContainer);

        this.terminalContainer = this.createTerminalView();
        this.loadingView = this.createLoadingView();
        this.loginView = this.createLoginView();
        this.setupView = this.createSetupView();
        this.manualSetupView = this.createManualSetupView();

        this.contentContainer.append(
            this.loadingView,
            this.loginView,
            this.setupView,
            this.manualSetupView,
            this.terminalContainer
        );
        console.log("[Holaf Terminal] Views appended to content container.");
        console.log("[Holaf Terminal] createPanel finished.");
    },

    createThemeMenu() {
        console.log("[Holaf Terminal] createThemeMenu called.");
        const menu = document.createElement("ul");
        menu.id = "holaf-theme-menu";
        this.themes.forEach(theme => {
            const item = document.createElement("li");
            item.textContent = theme.name;
            item.onclick = (e) => {
                e.stopPropagation();
                this.setTheme(theme.name);
                menu.style.display = 'none';
            };
            menu.appendChild(item);
        });
        return menu;
    },

    async show() {
        console.log("[Holaf Terminal] show called.");
        console.log("[Holaf Terminal] Initial state of this.panelElements:", this.panelElements);
        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf Terminal] Condition IF is FALSE. PanelElements already exists. panelEl:", this.panelElements.panelEl);
        } else {
            console.log("[Holaf Terminal] Condition IF is TRUE. Panel not created or panelEl missing. Calling createPanel().");
            this.createPanel();
            if (!this.panelElements || !this.panelElements.panelEl) {
                console.error("[Holaf Terminal] Panel creation FAILED in show(). Aborting show.");
                return;
            }
            console.log("[Holaf Terminal] createPanel finished. New panelElements:", this.panelElements);
        }

        console.log("[Holaf Terminal] Applying settings in show().");
        this.applySettings();

        if (this.panelElements && this.panelElements.panelEl) {
            console.log("[Holaf Terminal] Setting panel display to flex.");
            this.panelElements.panelEl.style.display = "flex";
        } else {
            console.error("[Holaf Terminal] Panel element is null in show() before checkServerStatus.");
            return;
        }

        const scriptsReady = await this.ensureScriptsLoaded();
        if (!scriptsReady) {
            this.showView('loading');
            this.loadingView.textContent = "Error: Failed to load terminal scripts.";
            console.error("[Holaf Terminal] Aborting show() due to script load failure.");
            return;
        }

        if (!this.isInitialized) {
            console.log("[Holaf Terminal] First initialization, calling checkServerStatus().");
            this.checkServerStatus();
            this.isInitialized = true;
        } else if (!this.socket) {
            console.log("[Holaf Terminal] Panel was hidden or socket disconnected, calling checkServerStatus().");
            this.checkServerStatus();
        } else if (this.terminal) {
            console.log("[Holaf Terminal] Terminal exists, focusing and fitting.");
            requestAnimationFrame(() => {
                this.terminal.focus();
                this.fitTerminal();
            });
        }
        console.log("[Holaf Terminal] show finished.");
    },

    applySettings() {
        console.log("[Holaf Terminal] applySettings called with current settings:", JSON.parse(JSON.stringify(this.settings)));
        if (this.panelElements && this.panelElements.panelEl) {
            this.panelElements.panelEl.style.width = `${this.settings.panel_width}px`;
            this.panelElements.panelEl.style.height = `${this.settings.panel_height}px`;

            if (this.settings.panel_x !== null && this.settings.panel_y !== null) {
                this.panelElements.panelEl.style.left = `${this.settings.panel_x}px`;
                this.panelElements.panelEl.style.top = `${this.settings.panel_y}px`;
                this.panelElements.panelEl.style.transform = 'none';
            } else {
                this.panelElements.panelEl.style.left = `50%`;
                this.panelElements.panelEl.style.top = `50%`;
                this.panelElements.panelEl.style.transform = 'translate(-50%, -50%)';
            }
            console.log("[Holaf Terminal] Panel dimensions and position applied from settings.");
        } else {
            console.log("[Holaf Terminal] applySettings: panelElements not ready.");
        }
        this.setTheme(this.settings.theme, false);
        if (this.terminal) {
            this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            console.log("[Holaf Terminal] Terminal theme and font size applied.");
        }
    },

    saveSettings(newSettings) {
        console.log("[Holaf Terminal] saveSettings called with:", newSettings);
        Object.assign(this.settings, newSettings);

        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            try {
                const settingsToSave = {
                    theme: this.settings.theme,
                    font_size: this.settings.font_size,
                    panel_x: this.settings.panel_x,
                    panel_y: this.settings.panel_y,
                    panel_width: this.settings.panel_width,
                    panel_height: this.settings.panel_height,
                };
                await fetch('/holaf/terminal/save-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settingsToSave)
                });
                console.log("[Holaf Terminal] Settings saved to server.");
            } catch (e) { console.error("[Holaf Terminal] Failed to save Terminal settings.", e); }
        }, 500);
    },

    createTerminalView: function () {
        console.log("[Holaf Terminal] createTerminalView");
        const wrapper = document.createElement("div");
        wrapper.className = "holaf-terminal-view-wrapper";
        this._xterm_container = document.createElement("div");
        wrapper.appendChild(this._xterm_container);
        return wrapper;
    },
    createLoadingView: function () {
        console.log("[Holaf Terminal] createLoadingView");
        const v = document.createElement("div");
        v.className = "holaf-terminal-non-terminal-view";
        v.textContent = "Checking server status...";
        return v;
    },
    createLoginView: function () {
        console.log("[Holaf Terminal] createLoginView");
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view";
        const label = document.createElement("label"); label.textContent = "Password:"; label.style.cssText = "display: block; margin-bottom: 5px;";
        this.passwordInput = document.createElement("input"); this.passwordInput.type = "password"; this.passwordInput.style.cssText = "width: calc(100% - 22px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555; padding: 5px;";
        this.passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.authenticateAndConnect(); });
        const connectButton = document.createElement("button"); connectButton.textContent = "Connect"; connectButton.className = "comfy-button";
        connectButton.addEventListener("click", this.authenticateAndConnect.bind(this));
        this.loginStatusMessage = document.createElement("p"); this.loginStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
        view.append(label, this.passwordInput, connectButton, this.loginStatusMessage);
        return view;
    },
    createSetupView: function () {
        console.log("[Holaf Terminal] createSetupView");
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view";
        const title = document.createElement("h3"); title.textContent = "Holaf Terminal Setup";
        const p1 = document.createElement("p"); p1.textContent = "No password is set on the server. Please create one to enable the terminal."; p1.style.marginBottom = "15px";
        const passLabel = document.createElement("label"); passLabel.textContent = "New Password:"; passLabel.style.display = "block"; passLabel.style.marginBottom = "2px";
        this.newPasswordInput = document.createElement("input"); this.newPasswordInput.type = "password"; this.newPasswordInput.style.cssText = "width: calc(100% - 22px); margin-bottom: 5px; background-color: #333; color: #eee; border: 1px solid #555; padding: 5px;";
        const confirmLabel = document.createElement("label"); confirmLabel.textContent = "Confirm Password:"; confirmLabel.style.display = "block"; confirmLabel.style.marginBottom = "2px";
        this.confirmPasswordInput = document.createElement("input"); this.confirmPasswordInput.type = "password"; this.confirmPasswordInput.style.cssText = "width: calc(100% - 22px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555; padding: 5px;";
        this.confirmPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.setPassword(); });
        const setButton = document.createElement("button"); setButton.textContent = "Set Password"; setButton.className = "comfy-button";
        setButton.addEventListener("click", this.setPassword.bind(this));
        this.setupStatusMessage = document.createElement("p"); this.setupStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
        view.append(title, p1, passLabel, this.newPasswordInput, confirmLabel, this.confirmPasswordInput, setButton, this.setupStatusMessage);
        return view;
    },
    createManualSetupView: function () {
        console.log("[Holaf Terminal] createManualSetupView");
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view";
        view.style.fontSize = "12px";
        const title = document.createElement("h3"); title.textContent = "Manual Setup Required"; title.style.color = "#ffcc00";
        const p1 = document.createElement("p"); p1.innerHTML = "The server couldn't save <code>config.ini</code> due to file permissions.";
        const p2 = document.createElement("p"); p2.innerHTML = "Please manually add the following line to your <code>ComfyUI-Holaf-Utilities/config.ini</code> file under the <code>[Security]</code> section, then restart ComfyUI."; p2.style.margin = "10px 0";
        this.hashDisplay = document.createElement("input"); this.hashDisplay.type = "text"; this.hashDisplay.readOnly = true; this.hashDisplay.style.cssText = "width: calc(100% - 22px); font-family: monospace; background-color: #333; color: #eee; border: 1px solid #555; margin: 5px 0; padding: 5px;";
        const copyButton = document.createElement("button"); copyButton.textContent = "Copy Hash"; copyButton.className = "comfy-button";
        copyButton.addEventListener("click", () => { this.hashDisplay.select(); document.execCommand("copy"); });
        view.append(title, p1, p2, this.hashDisplay, copyButton);
        return view;
    },

    showView: function (viewName) {
        console.log(`[Holaf Terminal] showView called for: ${viewName}`);
        if (!this.contentContainer) {
            console.error("[Holaf Terminal] showView: contentContainer is null!");
            return;
        }
        const isTerminal = viewName === 'terminal';
        this.loadingView.style.display = viewName === 'loading' ? 'block' : 'none';
        this.loginView.style.display = viewName === 'login' ? 'block' : 'none';
        this.setupView.style.display = viewName === 'setup' ? 'block' : 'none';
        this.manualSetupView.style.display = viewName === 'manual_setup' ? 'block' : 'none';
        this.terminalContainer.style.display = isTerminal ? 'flex' : 'none';

        if (isTerminal) {
            requestAnimationFrame(() => this.fitTerminal());
        }
        else if (viewName === 'login' && this.passwordInput) this.passwordInput.focus();
        else if (viewName === 'setup' && this.newPasswordInput) this.newPasswordInput.focus();
    },

    checkServerStatus: async function () {
        console.log("[Holaf Terminal] checkServerStatus called.");
        this.showView('loading');
        try {
            const r = await fetch("/holaf/terminal/status");
            const d = await r.json();
            console.log("[Holaf Terminal] Server status response:", d);
            if (d.ui_settings) {
                Object.assign(this.settings, d.ui_settings);
                this.applySettings();
            }
            d.password_is_set ? this.showView('login') : this.showView('setup');
        } catch (e) {
            console.error("[Holaf Terminal] Error checking server status:", e);
            this.loadingView.textContent = "Error: Could not contact server.";
        }
    },
    setPassword: async function () { console.log("[Holaf Terminal] setPassword"); const newPass = this.newPasswordInput.value, confirmPass = this.confirmPasswordInput.value; if (!newPass || newPass.length < 4) { this.setupStatusMessage.textContent = "Password must be at least 4 characters long."; return; } if (newPass !== confirmPass) { this.setupStatusMessage.textContent = "Passwords do not match."; return; } this.setupStatusMessage.textContent = "Setting password..."; try { const r = await fetch('/holaf/terminal/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPass }) }), d = await r.json(); if (r.ok && d.status === "ok" && d.action === "reload") { this.setupStatusMessage.textContent = ""; this.showView('login'); this.loginStatusMessage.textContent = "Password set successfully! Please log in."; } else if (r.ok && d.status === "manual_required") { this.hashDisplay.value = `password_hash = ${d.hash}`; this.showView('manual_setup'); } else { this.setupStatusMessage.textContent = `Error: ${d.message || 'An unknown error occurred'}`; } } catch (e) { this.setupStatusMessage.textContent = `Error: Could not contact server.`; console.error("[Holaf Terminal] Error setting password:", e); } },
    authenticateAndConnect: async function () { console.log("[Holaf Terminal] authenticateAndConnect"); const password = this.passwordInput.value; if (!password) { this.loginStatusMessage.textContent = "Error: Password cannot be empty."; return; } this.loginStatusMessage.textContent = "Authenticating..."; try { const r = await fetch('/holaf/terminal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) }), d = await r.json(); if (r.ok) { this.connectWebSocket(d.session_token); } else { this.loginStatusMessage.textContent = `Error: ${d.message || 'Authentication Failed'}`; } } catch (e) { this.loginStatusMessage.textContent = "Error: Could not reach server."; console.error("[Holaf Terminal] Error authenticating:", e); } finally { this.passwordInput.value = ""; } },

    connectWebSocket: async function (sessionToken) {
        console.log("[Holaf Terminal] connectWebSocket with token:", sessionToken ? "VALID_TOKEN_PRESENT" : "NO_TOKEN");
        if (!sessionToken) { this.loginStatusMessage.textContent = "Error: No session token received."; this.showView('login'); return; }

        const scriptsReady = await this.ensureScriptsLoaded();
        if (!scriptsReady) {
            this.showView('loading');
            this.loadingView.textContent = "Error: Failed to load terminal scripts for WebSocket connection.";
            console.error("[Holaf Terminal] Aborting WebSocket connection due to script load failure.");
            return;
        }

        this.showView('terminal');

        try {
            if (!this.terminal) {
                console.log("[Holaf Terminal] Creating new Terminal instance.");
                const currentThemeSettings = this.themes.find(t => t.name === this.settings.theme) || this.themes[0];
                this.terminal = new window.Terminal({
                    cursorBlink: true,
                    fontSize: this.settings.fontSize,
                    theme: currentThemeSettings,
                    fontFamily: "monospace"
                });
                this.fitAddon = new window.FitAddon.FitAddon();
                this.terminal.loadAddon(this.fitAddon);
                console.log("[Holaf Terminal] Opening terminal in container:", this._xterm_container);
                if (!this._xterm_container.isConnected) {
                    console.warn("[Holaf Terminal] _xterm_container is not connected to DOM. Appending again (fallback).");
                    this.terminalContainer.appendChild(this._xterm_container);
                }
                this.terminal.open(this._xterm_container);
                this.terminal.onData(data => { if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(data); });
                this.terminal.attachCustomKeyEventHandler(e => { if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') { if (this.terminal.hasSelection()) { navigator.clipboard.writeText(this.terminal.getSelection()); return false; } } if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') { navigator.clipboard.readText().then(text => { if (text) this.terminal.paste(text); }); return false; } return true; });
                console.log("[Holaf Terminal] New Terminal instance created and configured.");
            } else {
                console.log("[Holaf Terminal] Re-applying settings to existing terminal instance.");
                this.terminal.options.fontSize = this.settings.fontSize;
                this.setTheme(this.settings.theme, false);
            }
        } catch (e) {
            console.error("Holaf Utilities: Terminal component instantiation error", e);
            if (this.terminalContainer) this.terminalContainer.textContent = "Error: Could not create terminal component. Check console.";
            this.showView('loading');
            this.loadingView.textContent = "Error: Terminal creation failed.";
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 0));

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/holaf/terminal?token=${encodeURIComponent(sessionToken)}`;
        console.log("[Holaf Terminal] Connecting WebSocket to:", url);
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';
        this.socket.onopen = () => {
            console.log("Holaf Utilities: Terminal WebSocket established.");
            requestAnimationFrame(() => {
                this.fitTerminal();
                if (this.terminal) this.terminal.focus();
            });
        };
        this.socket.onmessage = (event) => { if (this.terminal) { if (event.data instanceof ArrayBuffer) this.terminal.write(new Uint8Array(event.data)); else this.terminal.write(event.data); } };
        this.socket.onclose = () => { console.log("Holaf Utilities: Terminal WebSocket closed."); if (this.terminal) this.terminal.writeln("\r\n\r\n--- CONNECTION CLOSED ---"); this.socket = null; this.checkServerStatus(); };
        this.socket.onerror = (e) => { console.error("Holaf Utilities: Terminal WebSocket error.", e); if (this.terminal) this.terminal.writeln("\r\n\r\n--- CONNECTION ERROR ---"); this.socket = null; this.checkServerStatus(); };
    },

    fitTerminal() {
        console.log("[Holaf Terminal] fitTerminal attempt.");
        if (this.terminal && this.fitAddon && this.panelElements && this.panelElements.panelEl.style.display !== 'none' && this._xterm_container && this._xterm_container.offsetWidth > 0 && this._xterm_container.offsetHeight > 0) {
            console.log("[Holaf Terminal] Fitting terminal. Container size:", this._xterm_container.offsetWidth, "x", this._xterm_container.offsetHeight);
            try {
                this.fitAddon.fit();
                const dims = this.fitAddon.proposeDimensions();
                if (dims && this.socket && this.socket.readyState === WebSocket.OPEN) {
                    console.log("[Holaf Terminal] Resizing PTY to:", dims);
                    this.socket.send(JSON.stringify({ resize: [dims.rows, dims.cols] }));
                }
            } catch (e) {
                console.error("[Holaf Terminal] Error during fitAddon.fit():", e);
            }
        } else {
            console.log("[Holaf Terminal] fitTerminal: Conditions not met.",
                {
                    hasTerminal: !!this.terminal,
                    hasFitAddon: !!this.fitAddon,
                    panelVisible: this.panelElements ? (this.panelElements.panelEl ? this.panelElements.panelEl.style.display : 'no panelEl') : 'no panelElements',
                    xtermContainerWidth: this._xterm_container ? this._xterm_container.offsetWidth : 'no xterm_container',
                    xtermContainerHeight: this._xterm_container ? this._xterm_container.offsetHeight : 'no xterm_container',
                    xtermContainerConnected: this._xterm_container ? this._xterm_container.isConnected : 'no xterm_container'
                });
        }
    },

    setTheme(themeName, doSave = true) {
        console.log(`[Holaf Terminal] setTheme to ${themeName}, save: ${doSave}`);
        const themeConfig = this.themes.find(t => t.name === themeName);
        if (!themeConfig) {
            console.warn(`[Holaf Terminal] Theme ${themeName} not found.`);
            return;
        }
        this.settings.theme = themeName;
        if (this.terminal) {
            this.terminal.options.theme = {
                background: themeConfig.background,
                foreground: themeConfig.foreground,
                cursor: themeConfig.cursor,
                selectionBackground: themeConfig.selectionBackground,
            };
        }
        if (doSave) this.saveSettings({ theme: themeName });
    },
    increaseFontSize() {
        console.log("[Holaf Terminal] increaseFontSize");
        if (this.settings.fontSize < 24) {
            this.settings.fontSize++;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },
    decreaseFontSize() {
        console.log("[Holaf Terminal] decreaseFontSize");
        if (this.settings.fontSize > 8) {
            this.settings.fontSize--;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },
};

app.registerExtension({
    name: "Holaf.Terminal.Panel",
    async setup() {
        console.log("[Holaf Terminal] Extension setup() called.");
        holafTerminal.ensureScriptsLoaded().catch(err => {
            console.error("[Holaf Terminal] Pre-loading scripts failed during setup:", err);
        });
        holafTerminal.addMenuItem();
    },
});