/* === Documentation ===
 * Developer: Gemini (AI Assistant), under the direction of Holaf
 * Date: 2025-05-23 (Final)
 *
 * MODIFIED: Added delayed fitTerminal on initial socket open for better initial sizing.
 * MODIFIED: Unified theme management using HOLAF_THEMES from holaf_panel_manager.
 * MODIFIED: Added fullscreen state management (double-click on header).
 * CORRECTION: Removed dynamic menu registration. Added object to `app` for static menu access.
 * === End Documentation ===
 */
import { app } from "../../../scripts/app.js";
import { HolafPanelManager, HOLAF_THEMES } from "./holaf_panel_manager.js";

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript && existingScript.dataset.loaded) {
            resolve();
            return;
        }
        if (existingScript && !existingScript.dataset.loaded) {
            let resolved = false;
            const handleLoad = () => {
                if (!resolved) {
                    existingScript.dataset.loaded = true;
                    resolved = true;
                    resolve();
                }
            };
            const handleError = () => {
                if (!resolved) {
                    console.error(`[Holaf Terminal] Failed to load script (event): ${src}`);
                    resolved = true;
                    reject(new Error(`Failed to load script: ${src}`));
                }
            };
            existingScript.addEventListener('load', handleLoad);
            existingScript.addEventListener('error', handleError);

            if (existingScript.readyState === 'loaded' || existingScript.readyState === 'complete') {
                setTimeout(() => {
                    if (!existingScript.dataset.loaded && !resolved) {
                        existingScript.dataset.loaded = true;
                        resolved = true;
                        resolve();
                    }
                }, 0);
            }
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
            script.dataset.loaded = true;
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
    scriptsLoaded: false,
    settings: {
        fontSize: 14,
        theme: HOLAF_THEMES[0].name, // Default to the first theme in the shared list
        panel_x: null,
        panel_y: null,
        panel_width: 600,
        panel_height: 400,
        panel_is_fullscreen: false,
    },
    saveTimeout: null,

    async ensureScriptsLoaded() {
        if (this.scriptsLoaded) return true;
        try {
            const basePath = "extensions/ComfyUI-Holaf-Utilities/js/";
            if (!window.Terminal) {
                await loadScript(`${basePath}xterm.js`);
            }
            if (!window.FitAddon) {
                await loadScript(`${basePath}xterm-addon-fit.js`);
            }
            this.scriptsLoaded = true;
            return true;
        } catch (error) {
            console.error("Holaf Utilities: Critical error loading xterm scripts", error);
            if (this.panelElements && this.panelElements.contentEl) {
                const loadingView = this.panelElements.contentEl.querySelector('.holaf-terminal-non-terminal-view');
                if (loadingView) loadingView.textContent = "Error: Could not load terminal components. Check console.";
            }
            this.scriptsLoaded = false;
            return false;
        }
    },

    init() {
        // Initialization is minimal as the menu is handled centrally.
    },

    createPanel() {
        if (this.panelElements && this.panelElements.panelEl) {
            return;
        }

        const terminalHeaderControlsGroup = document.createElement("div");
        terminalHeaderControlsGroup.className = "holaf-header-button-group";

        const themeButtonContainer = document.createElement("div");
        themeButtonContainer.style.position = 'relative';
        const themeButton = document.createElement("button");
        themeButton.className = "holaf-header-button";
        themeButton.title = "Change Theme";
        themeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 12.55a9.42 9.42 0 0 1-9.45 9.45 9.42 9.42 0 0 1-9.45-9.45 9.42 9.42 0 0 1 9.45-9.45 2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 1-2.5 2.5Z"/></svg>`;
        const themeMenu = this.createThemeMenu(); // Uses HOLAF_THEMES
        themeButton.onclick = (e) => {
            e.stopPropagation();
            themeMenu.style.display = themeMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', () => { if (themeMenu) themeMenu.style.display = 'none' });
        themeButtonContainer.append(themeButton, themeMenu);

        const fontDecButton = document.createElement("button");
        fontDecButton.className = "holaf-header-button";
        fontDecButton.title = "Decrease Font Size";
        fontDecButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`;
        fontDecButton.onclick = () => this.decreaseFontSize();

        const fontIncButton = document.createElement("button");
        fontIncButton.className = "holaf-header-button";
        fontIncButton.title = "Increase Font Size";
        fontIncButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
        fontIncButton.onclick = () => this.increaseFontSize();

        terminalHeaderControlsGroup.append(themeButtonContainer, fontDecButton, fontIncButton);

        try {
            this.panelElements = HolafPanelManager.createPanel({
                id: "holaf-terminal-panel",
                title: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: -3px; margin-right: 6px;"><path d="M5 7L10 12L5 17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17H19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>Holaf Terminal`,
                headerContent: terminalHeaderControlsGroup,
                defaultSize: { width: this.settings.panel_width, height: this.settings.panel_height },
                defaultPosition: { x: this.settings.panel_x, y: this.settings.panel_y },
                onClose: () => { },
                onStateChange: (newState) => {
                    if (!this.settings.panel_is_fullscreen) {
                        this.saveSettings({
                            panel_x: newState.x, panel_y: newState.y,
                            panel_width: newState.width, panel_height: newState.height,
                        });
                    }
                },
                onResize: () => {
                    this.fitTerminal();
                },
                onFullscreenToggle: (isFullscreen) => {
                    this.settings.panel_is_fullscreen = isFullscreen;
                    this.saveSettings({ panel_is_fullscreen: isFullscreen });
                    setTimeout(() => this.fitTerminal(), 210);
                }
            });
        } catch (e) {
            console.error("[Holaf Terminal] Error during HolafPanelManager.createPanel:", e);
            alert("[Holaf Terminal] Error creating panel. Check console.");
            return;
        }

        const styleId = "holaf-terminal-specific-styles";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.innerHTML = `
                #holaf-terminal-panel .holaf-utility-header .holaf-header-button-group {
                     order: -1; margin-left: 0; margin-right: 8px;
                }
                #holaf-terminal-panel .holaf-terminal-non-terminal-view { 
                    padding: 15px; width: 100%; box-sizing: border-box; flex-grow: 1; display: flex; 
                    flex-direction: column; justify-content: center; align-items: center; text-align:center;
                }
                #holaf-terminal-panel .holaf-terminal-view-wrapper { 
                    flex-grow: 1; padding: 0 5px 5px 10px; overflow: hidden; width: 100%; 
                    display: flex; flex-direction: column; 
                }
                #holaf-terminal-panel .holaf-terminal-view-wrapper > div {
                    flex-grow: 1; width: 100% !important; display: flex; flex-direction: column; 
                    overflow: hidden; 
                }
            `;
            document.head.appendChild(style);
        }

        this.contentContainer = this.panelElements.contentEl;
        this.terminalContainer = this.createTerminalView();
        this.loadingView = this.createLoadingView();
        this.loginView = this.createLoginView();
        this.setupView = this.createSetupView();
        this.manualSetupView = this.createManualSetupView();

        this.contentContainer.append(
            this.loadingView, this.loginView, this.setupView,
            this.manualSetupView, this.terminalContainer
        );
    },
    createThemeMenu() {
        const menu = document.createElement("ul");
        menu.className = "holaf-theme-menu";
        HOLAF_THEMES.forEach(theme => {
            const item = document.createElement("li");
            item.textContent = theme.name;
            item.onclick = (e) => {
                e.stopPropagation();
                this.setTheme(theme.name);
                if (menu) menu.style.display = 'none';
            };
            menu.appendChild(item);
        });
        return menu;
    },
    async show() {
        if (!this.panelElements || !this.panelElements.panelEl) {
            this.createPanel();
            if (!this.panelElements || !this.panelElements.panelEl) {
                console.error("[Holaf Terminal] Panel creation FAILED in show(). Aborting.");
                return;
            }
        }

        const panelIsVisible = this.panelElements.panelEl.style.display === "flex";
        if (panelIsVisible) {
            this.panelElements.panelEl.style.display = "none";
            return;
        }

        this.panelElements.panelEl.style.display = "flex";
        HolafPanelManager.bringToFront(this.panelElements.panelEl);

        const scriptsReady = await this.ensureScriptsLoaded();
        if (!scriptsReady) {
            this.showView('loading');
            if (this.loadingView) this.loadingView.textContent = "Error: Failed to load terminal scripts.";
            return;
        }

        if (!this.isInitialized || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.checkServerStatus();
            this.isInitialized = true;
        } else if (this.terminal) {
            this.showView('terminal');
            requestAnimationFrame(() => {
                if (this.terminal) { this.terminal.focus(); this.fitTerminal(); }
            });
        }
    },
    applySettings(themeJustSet = false) {
        if (this.panelElements && this.panelElements.panelEl) {
            if (this.settings.panel_is_fullscreen) {
                if (!this.panelElements.panelEl.classList.contains("holaf-panel-fullscreen")) {
                    this.panelElements.panelEl.classList.add("holaf-panel-fullscreen");
                }
            } else {
                if (this.panelElements.panelEl.classList.contains("holaf-panel-fullscreen")) {
                    this.panelElements.panelEl.classList.remove("holaf-panel-fullscreen");
                }
            }

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
        }
        if (!themeJustSet) {
            this.setTheme(this.settings.theme, false);
        }
        if (this.terminal) {
            this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
        }
    },
    saveSettings(newSettings) {
        if (newSettings && typeof newSettings === 'object') {
            Object.assign(this.settings, newSettings);
        }
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            try {
                const settingsToSave = {
                    theme: this.settings.theme,
                    font_size: this.settings.fontSize,
                    panel_x: this.settings.panel_x, panel_y: this.settings.panel_y,
                    panel_width: this.settings.panel_width, panel_height: this.settings.panel_height,
                    panel_is_fullscreen: this.settings.panel_is_fullscreen
                };
                const response = await fetch('/holaf/terminal/save-settings', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settingsToSave)
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
                    console.error("[Holaf Terminal] Failed to save settings. Status:", response.status, "Msg:", errorData.message);
                }
            } catch (e) {
                console.error("[Holaf Terminal] Exception during saveSettings fetch:", e);
            }
        }, 750);
    },
    createTerminalView() {
        const wrapper = document.createElement("div");
        wrapper.className = "holaf-terminal-view-wrapper";
        this._xterm_container = document.createElement("div");
        wrapper.appendChild(this._xterm_container);
        return wrapper;
    },
    createLoadingView() {
        const v = document.createElement("div");
        v.className = "holaf-terminal-non-terminal-view";
        v.textContent = "Checking server status...";
        return v;
    },
    createLoginView() {
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view";
        const ptitle = document.createElement("h4"); ptitle.textContent = "Terminal Access"; ptitle.style.marginTop = "0";
        const label = document.createElement("label"); label.textContent = "Password:"; label.style.cssText = "display: block; margin-bottom: 5px;";
        this.passwordInput = document.createElement("input"); this.passwordInput.type = "password"; this.passwordInput.style.cssText = "width: 200px; max-width: 80%; margin-bottom: 10px; background-color: var(--comfy-input-bg,#333); color: var(--fg-color,#eee); border: 1px solid var(--border-color,#555); padding: 8px; border-radius:3px;";
        this.passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.authenticateAndConnect(); });
        const connectButton = document.createElement("button"); connectButton.textContent = "Connect"; connectButton.className = "comfy-button";
        connectButton.addEventListener("click", this.authenticateAndConnect.bind(this));
        this.loginStatusMessage = document.createElement("p"); this.loginStatusMessage.style.cssText = "margin-top: 10px; color: #f9a825; font-size:0.9em;";
        view.append(ptitle, label, this.passwordInput, connectButton, this.loginStatusMessage);
        return view;
    },
    createSetupView() {
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view";
        const title = document.createElement("h3"); title.textContent = "Holaf Terminal Setup"; title.style.color = "#4CAF50";
        const p1 = document.createElement("p"); p1.textContent = "No password is set. Please create one to enable the terminal."; p1.style.marginBottom = "15px";
        const passLabel = document.createElement("label"); passLabel.textContent = "New Password (min 4 chars):"; passLabel.style.display = "block"; passLabel.style.marginBottom = "2px";
        this.newPasswordInput = document.createElement("input"); this.newPasswordInput.type = "password"; this.newPasswordInput.style.cssText = "width: 200px; max-width: 80%; margin-bottom: 5px; background-color: var(--comfy-input-bg,#333); color: var(--fg-color,#eee); border: 1px solid var(--border-color,#555); padding: 8px; border-radius:3px;";
        const confirmLabel = document.createElement("label"); confirmLabel.textContent = "Confirm Password:"; confirmLabel.style.display = "block"; confirmLabel.style.marginBottom = "2px";
        this.confirmPasswordInput = document.createElement("input"); this.confirmPasswordInput.type = "password"; this.confirmPasswordInput.style.cssText = "width: 200px; max-width: 80%; margin-bottom: 10px; background-color: var(--comfy-input-bg,#333); color: var(--fg-color,#eee); border: 1px solid var(--border-color,#555); padding: 8px; border-radius:3px;";
        this.confirmPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.setPassword(); });
        const setButton = document.createElement("button"); setButton.textContent = "Set Password"; setButton.className = "comfy-button";
        setButton.addEventListener("click", this.setPassword.bind(this));
        this.setupStatusMessage = document.createElement("p"); this.setupStatusMessage.style.cssText = "margin-top: 10px; color: #f9a825; font-size:0.9em;";
        view.append(title, p1, passLabel, this.newPasswordInput, confirmLabel, this.confirmPasswordInput, setButton, this.setupStatusMessage);
        return view;
    },
    createManualSetupView() {
        const view = document.createElement("div");
        view.className = "holaf-terminal-non-terminal-view"; view.style.fontSize = "12px";
        const title = document.createElement("h3"); title.textContent = "Manual Setup Required"; title.style.color = "#f9a825";
        const p1 = document.createElement("p"); p1.innerHTML = "The server couldn't save <code>config.ini</code> due to file permissions.";
        const p2 = document.createElement("p"); p2.innerHTML = "1. Manually create/edit <code>ComfyUI/custom_nodes/ComfyUI-Holaf-Utilities/config.ini</code><br>2. Add the following under a <code>[Security]</code> section:<br>"; p2.style.margin = "10px 0"; p2.style.textAlign = "left";
        this.hashDisplay = document.createElement("input"); this.hashDisplay.type = "text"; this.hashDisplay.readOnly = true; this.hashDisplay.style.cssText = "width: 100%; font-family: monospace; background-color: #222; color: #eee; border: 1px solid #555; margin: 5px 0; padding: 5px;";
        const copyButton = document.createElement("button"); copyButton.textContent = "Copy Hash String"; copyButton.className = "comfy-button"; copyButton.style.marginTop = "5px";
        copyButton.addEventListener("click", () => { if (this.hashDisplay) { this.hashDisplay.select(); document.execCommand("copy"); } });
        const p3 = document.createElement("p"); p3.innerHTML = "3. Restart ComfyUI."; p3.style.textAlign = "left";
        view.append(title, p1, p2, this.hashDisplay, copyButton, p3);
        return view;
    },
    showView(viewName) {
        if (!this.contentContainer) { console.error("[Holaf Terminal] showView: contentContainer is null!"); return; }
        const views = {
            loading: this.loadingView, login: this.loginView, setup: this.setupView,
            manual_setup: this.manualSetupView, terminal: this.terminalContainer
        };
        for (const vName in views) {
            if (views[vName]) {
                views[vName].style.display = (vName === viewName) ? (viewName === 'terminal' ? 'flex' : 'block') : 'none';
            }
        }
        if (viewName === 'terminal') {
            requestAnimationFrame(() => this.fitTerminal());
        } else if (viewName === 'login' && this.passwordInput) {
            this.passwordInput.focus();
        } else if (viewName === 'setup' && this.newPasswordInput) {
            this.newPasswordInput.focus();
        }
    },
    checkServerStatus: async function () {
        this.showView('loading');
        try {
            const r = await fetch("/holaf/utilities/settings");
            const d = await r.json();
            if (d.TerminalUI) {
                const validTheme = HOLAF_THEMES.find(t => t.name === d.TerminalUI.theme);
                this.settings.theme = validTheme ? d.TerminalUI.theme : HOLAF_THEMES[0].name;

                this.settings.fontSize = d.TerminalUI.font_size || this.settings.fontSize;
                this.settings.panel_x = d.TerminalUI.panel_x;
                this.settings.panel_y = d.TerminalUI.panel_y;
                this.settings.panel_width = d.TerminalUI.panel_width || this.settings.panel_width;
                this.settings.panel_height = d.TerminalUI.panel_height || this.settings.panel_height;
                this.settings.panel_is_fullscreen = !!d.TerminalUI.panel_is_fullscreen;

                this.applySettings();
            }
            d.password_is_set ? this.showView('login') : this.showView('setup');
        } catch (e) {
            console.error("[Holaf Terminal] Error checking server status:", e);
            if (this.loadingView) this.loadingView.textContent = "Error: Could not contact server.";
        }
    },
    setPassword: async function () {
        if (!this.newPasswordInput || !this.confirmPasswordInput || !this.setupStatusMessage) return;
        const newPass = this.newPasswordInput.value; const confirmPass = this.confirmPasswordInput.value;
        if (!newPass || newPass.length < 4) { this.setupStatusMessage.textContent = "Password must be at least 4 characters long."; return; }
        if (newPass !== confirmPass) { this.setupStatusMessage.textContent = "Passwords do not match."; return; }
        this.setupStatusMessage.textContent = "Setting password...";
        try {
            const r = await fetch('/holaf/terminal/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPass }) });
            const d = await r.json();
            if (r.ok && d.status === "ok" && d.action === "reload") {
                this.setupStatusMessage.textContent = ""; this.showView('login');
                if (this.loginStatusMessage) this.loginStatusMessage.textContent = "Password set! Please log in.";
            } else if (r.ok && d.status === "manual_required") {
                if (this.hashDisplay) this.hashDisplay.value = `password_hash = ${d.hash}`; this.showView('manual_setup');
            } else {
                this.setupStatusMessage.textContent = `Error: ${d.message || 'Unknown error'}`;
            }
        } catch (e) {
            this.setupStatusMessage.textContent = `Error: Could not contact server.`; console.error("[Holaf Terminal] Error setting password:", e);
        }
    },
    authenticateAndConnect: async function () {
        if (!this.passwordInput || !this.loginStatusMessage) return;
        const password = this.passwordInput.value;
        if (!password) { this.loginStatusMessage.textContent = "Error: Password cannot be empty."; return; }
        this.loginStatusMessage.textContent = "Authenticating...";
        try {
            const r = await fetch('/holaf/terminal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) });
            const d = await r.json();
            if (r.ok && d.session_token) {
                this.connectWebSocket(d.session_token);
            } else {
                this.loginStatusMessage.textContent = `Error: ${d.message || 'Authentication Failed'}`;
            }
        } catch (e) {
            this.loginStatusMessage.textContent = "Error: Could not reach server."; console.error("[Holaf Terminal] Error authenticating:", e);
        } finally {
            if (this.passwordInput) this.passwordInput.value = "";
        }
    },

    connectWebSocket: async function (sessionToken) {
        if (!sessionToken) { if (this.loginStatusMessage) this.loginStatusMessage.textContent = "Error: No session token."; this.showView('login'); return; }

        const scriptsReady = await this.ensureScriptsLoaded();
        if (!scriptsReady) {
            this.showView('loading');
            if (this.loadingView) this.loadingView.textContent = "Error: Failed to load scripts for WebSocket.";
            return;
        }

        try {
            if (!this.terminal) {
                const currentThemeConfig = HOLAF_THEMES.find(t => t.name === this.settings.theme) || HOLAF_THEMES[0];

                if (!window.Terminal || !window.FitAddon) {
                    console.error("[Holaf Terminal] xterm.js or FitAddon not loaded!");
                    if (this.loadingView) this.loadingView.textContent = "Error: Terminal library not loaded.";
                    this.showView('loading'); return;
                }
                this.terminal = new window.Terminal({
                    cursorBlink: true, fontSize: this.settings.fontSize,
                    theme: {
                        background: currentThemeConfig.colors.backgroundPrimary,
                        foreground: currentThemeConfig.colors.textPrimary,
                        cursor: currentThemeConfig.colors.cursor,
                        selectionBackground: currentThemeConfig.colors.selectionBackground
                    },
                    fontFamily: "monospace", rows: 24,
                });
                this.fitAddon = new window.FitAddon.FitAddon();
                this.terminal.loadAddon(this.fitAddon);

                if (!this._xterm_container || !this._xterm_container.isConnected) {
                    console.error("[Holaf Terminal] _xterm_container is not ready for terminal.open().");
                    if (this.loadingView) this.loadingView.textContent = "Error: Terminal container not ready.";
                    this.showView('loading'); return;
                }
                this.terminal.open(this._xterm_container);
                this.terminal.onData(data => { if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(data); });
                this.terminal.attachCustomKeyEventHandler(e => { if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') { if (this.terminal.hasSelection()) { try { navigator.clipboard.writeText(this.terminal.getSelection()); } catch (err) { } return false; } } if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') { try { navigator.clipboard.readText().then(text => { if (text && this.terminal) this.terminal.paste(text); }); } catch (err) { } return false; } return true; });
            } else {
                this.setTheme(this.settings.theme, false);
                this.terminal.options.fontSize = this.settings.fontSize;
            }
        } catch (e) {
            console.error("Holaf Utilities: Terminal component instantiation error", e);
            if (this.loadingView) this.loadingView.textContent = "Error: Terminal creation failed.";
            this.showView('loading'); return;
        }

        await new Promise(resolve => requestAnimationFrame(resolve));
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/holaf/terminal?token=${encodeURIComponent(sessionToken)}`;

        if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
            this.socket.onclose = null; this.socket.close();
        }
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
            this.showView('terminal');
            requestAnimationFrame(() => {
                if (this.terminal) {
                    console.log("[Holaf Terminal] Initial fit on socket open (RAF).");
                    this.fitTerminal();
                    this.terminal.focus();
                    setTimeout(() => {
                        if (this.terminal && this.panelElements.panelEl.style.display === 'flex') {
                            console.log("[Holaf Terminal] Delayed fit after socket open.");
                            this.fitTerminal();
                        }
                    }, 100);
                }
            });
        };
        this.socket.onmessage = (event) => { if (this.terminal) { try { if (event.data instanceof ArrayBuffer) this.terminal.write(new Uint8Array(event.data)); else this.terminal.write(event.data); } catch (e) { console.warn("[Holaf Terminal] Error writing to terminal:", e) } } };
        this.socket.onclose = (event) => {
            if (this.terminal) { try { this.terminal.writeln("\r\n\r\n--- CONNECTION CLOSED ---"); } catch (e) { } }
            this.socket = null;
            if (this.panelElements && this.panelElements.panelEl.style.display === 'flex') { this.checkServerStatus(); }
        };
        this.socket.onerror = (e) => {
            console.error("Holaf Utilities: Terminal WebSocket error.", e);
            if (this.terminal) { try { this.terminal.writeln("\r\n\r\n--- CONNECTION ERROR ---"); } catch (e) { } }
            this.socket = null;
            if (this.panelElements && this.panelElements.panelEl.style.display === 'flex') { this.checkServerStatus(); }
        };
    },

    fitTerminal() {
        if (this.terminal && this.fitAddon &&
            this.panelElements && this.panelElements.panelEl.style.display === 'flex' &&
            this._xterm_container && this._xterm_container.offsetWidth > 10 && this._xterm_container.offsetHeight > 10 &&
            this._xterm_container.isConnected) {
            try {
                this.fitAddon.fit();
                const dims = this.fitAddon.proposeDimensions();
                if (dims && this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({ resize: [dims.rows, dims.cols] }));
                }
            } catch (e) {
                console.error("[Holaf Terminal FIT] Error during fitAddon.fit():", e);
            }
        }
    },
    setTheme(themeName, doSave = true) {
        const themeConfig = HOLAF_THEMES.find(t => t.name === themeName);
        if (!themeConfig) {
            console.warn(`[Holaf Terminal] Theme '${themeName}' not found. Defaulting to ${HOLAF_THEMES[0].name}`);
            this.setTheme(HOLAF_THEMES[0].name, doSave);
            return;
        }

        this.settings.theme = themeName;

        if (this.terminal) {
            this.terminal.options.theme = {
                background: themeConfig.colors.backgroundPrimary,
                foreground: themeConfig.colors.textPrimary,
                cursor: themeConfig.colors.cursor,
                selectionBackground: themeConfig.colors.selectionBackground,
            };
        }

        if (this.panelElements && this.panelElements.panelEl) {
            HOLAF_THEMES.forEach(t => {
                if (this.panelElements.panelEl.classList.contains(t.className)) {
                    this.panelElements.panelEl.classList.remove(t.className);
                }
            });
            this.panelElements.panelEl.classList.add(themeConfig.className);
            console.log(`[Holaf Terminal] Theme set to: ${themeName} (Class: ${themeConfig.className})`);
        }

        if (doSave) this.saveSettings({ theme: themeName });
    },
    increaseFontSize() {
        if (this.settings.fontSize < 30) {
            this.settings.fontSize++;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },
    decreaseFontSize() {
        if (this.settings.fontSize > 6) {
            this.settings.fontSize--;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },
};

// Expose the object on the app for the static menu to find
app.holafTerminal = holafTerminal;

app.registerExtension({
    name: "Holaf.Terminal.Panel",
    async setup() {
        holafTerminal.init();
    }
});