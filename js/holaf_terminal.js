/* === Documentation ===
 * Author: Holaf, with assistance from Cline (AI Assistant)
 * Date: 2025-05-23 (Path fix and rename)
 *
 * How it works (v9.4):
 * 1. Corrected hardcoded paths to point to 'ComfyUI-Holaf-Utilities'
 *    instead of 'ComfyUI-Holaf-Terminal', fixing the "Could not load terminal component" error.
 * 2. Renamed log messages and user-facing instructions to reflect the
 *    'Holaf Utilities' package name.
 * 3. Restored the original, robust structure with self-contained styling.
 * === End Documentation ===
 */
import { app } from "../../../scripts/app.js";

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

const holafTerminal = {
    panel: null,
    terminal: null,
    fitAddon: null,
    socket: null,
    isInitialized: false,
    settings: { // Default settings
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

    createPanel() {
        if (this.panel) return;
        this.panel = document.createElement("div");
        this.panel.id = "holaf-terminal-panel";
        this.panel.style.display = "none";

        const header = document.createElement("div");
        header.id = "holaf-terminal-header";

        const title = document.createElement("span");
        title.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 5px;"><path d="M5 7L10 12L5 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Holaf Terminal`;

        const buttonGroup = document.createElement("div");
        buttonGroup.className = "holaf-terminal-header-button-group";

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

        buttonGroup.append(themeButtonContainer, fontDecButton, fontIncButton);

        const closeButton = document.createElement("button");
        closeButton.id = "holaf-terminal-close-button";
        closeButton.textContent = "✖";

        header.append(title, buttonGroup, closeButton);

        const content = document.createElement("div");
        content.id = "holaf-terminal-content";

        const resizeHandle = document.createElement("div");
        resizeHandle.id = "holaf-terminal-resize-handle";

        this.panel.append(header, content, resizeHandle);
        document.body.append(this.panel);

        const style = document.createElement("style");
        style.innerHTML = `
            #holaf-terminal-panel { position: fixed; width: 600px; height: 400px; min-width: 300px; min-height: 200px; background-color: #1e1e1e; border: 1px solid #444; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-radius: 8px; z-index: 1001; display: flex; flex-direction: column; color: #ccc; font-family: monospace; }
            #holaf-terminal-header { background-color: #2a2a2a; color: white; padding: 8px 12px; cursor: move; border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-family: sans-serif; }
            .holaf-terminal-header-button-group { display: flex; gap: 4px; }
            .holaf-terminal-header-button { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #ccc; border-radius: 4px; cursor: pointer; padding: 2px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
            .holaf-terminal-header-button:hover { background: rgba(255, 255, 255, 0.2); color: white; }
            #holaf-theme-menu { position: absolute; top: 100%; right: 0; background-color: #2a2a2a; border: 1px solid #444; border-radius: 4px; z-index: 1002; display: none; list-style: none; padding: 5px; margin: 2px 0 0; }
            #holaf-theme-menu li { color: #ccc; padding: 5px 10px; cursor: pointer; }
            #holaf-theme-menu li:hover { background-color: #333; color: white; }
            #holaf-terminal-close-button { background: none; border: none; color: #ccc; font-size: 16px; cursor: pointer; padding-left: 10px; }
            #holaf-terminal-header:hover #holaf-terminal-close-button { color: white; }
            #holaf-terminal-content { flex-grow: 1; overflow: hidden; display: flex; flex-direction: column; }
            #holaf-terminal-content .holaf-terminal-non-terminal-view { padding: 15px; }
            #holaf-terminal-content .holaf-terminal-view-wrapper { flex-grow: 1; padding: 0 5px 5px 10px; overflow: hidden; }
            #holaf-terminal-content .comfy-button { background-color: var(--comfy-button-bg); color: var(--fg-color); border: 1px solid var(--border-color); }
            #holaf-terminal-resize-handle { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: se-resize; background-image: linear-gradient(135deg, transparent 0%, transparent 50%, #555 50%, #555 75%, transparent 75%, transparent 100%); }
        `;
        document.head.appendChild(style);

        closeButton.addEventListener("click", () => this.panel.style.display = "none");
        this.makeDraggable(header, this.panel);
        this.makeResizable(resizeHandle, this.panel);

        this.content = content;
        this.terminalContainer = this.createTerminalView();
        this.loadingView = this.createLoadingView();
        this.loginView = this.createLoginView();
        this.setupView = this.createSetupView();
        this.manualSetupView = this.createManualSetupView();
        this.content.append(this.loadingView, this.loginView, this.setupView, this.manualSetupView, this.terminalContainer);
    },

    createThemeMenu() {
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

    show() {
        if (!this.panel) this.createPanel();
        this.applySettings();
        this.panel.style.display = "flex";

        if (!this.isInitialized) {
            this.checkServerStatus();
            this.isInitialized = true;
        } else if (!this.socket) {
            this.checkServerStatus();
        } else if (this.terminal) {
            this.terminal.focus();
        }
    },

    applySettings() {
        this.panel.style.width = `${this.settings.panel_width}px`;
        this.panel.style.height = `${this.settings.panel_height}px`;

        if (this.settings.panel_x !== null && this.settings.panel_y !== null) {
            this.panel.style.left = `${this.settings.panel_x}px`;
            this.panel.style.top = `${this.settings.panel_y}px`;
            this.panel.style.transform = 'none';
        } else {
            this.panel.style.left = `50%`;
            this.panel.style.top = `50%`;
            this.panel.style.transform = 'translate(-50%, -50%)';
        }
        this.setTheme(this.settings.theme, false);
    },

    saveSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            try {
                await fetch('/holaf/terminal/save-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.settings)
                });
            } catch (e) { console.error("Holaf Utilities: Failed to save Terminal settings.", e); }
        }, 500); // Debounce saves
    },

    createTerminalView: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "holaf-terminal-view-wrapper";
        this._xterm_container = document.createElement("div");
        this._xterm_container.style.cssText = "width: 100%; height: 100%;";
        wrapper.appendChild(this._xterm_container);
        return wrapper;
    },
    createLoadingView: function () {
        const v = document.createElement("div");
        v.className = "holaf-terminal-non-terminal-view";
        v.textContent = "Checking server status...";
        return v;
    },
    createLoginView: function () {
        const view = document.createElement("div");
        view.id = "holaf-login-view";
        view.className = "holaf-terminal-non-terminal-view";
        const label = document.createElement("label"); label.textContent = "Password:"; label.style.cssText = "display: block; margin-bottom: 5px;";
        this.passwordInput = document.createElement("input"); this.passwordInput.type = "password"; this.passwordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555;";
        this.passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.authenticateAndConnect(); });
        const connectButton = document.createElement("button"); connectButton.textContent = "Connect"; connectButton.className = "comfy-button"; connectButton.addEventListener("click", this.authenticateAndConnect.bind(this));
        this.loginStatusMessage = document.createElement("p"); this.loginStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
        view.append(label, this.passwordInput, connectButton, this.loginStatusMessage);
        return view;
    },
    createSetupView: function () {
        const view = document.createElement("div");
        view.id = "holaf-setup-view";
        view.className = "holaf-terminal-non-terminal-view";
        const title = document.createElement("h3"); title.textContent = "Holaf Terminal Setup";
        const p1 = document.createElement("p"); p1.textContent = "No password is set on the server. Please create one to enable the terminal."; p1.style.marginBottom = "15px";
        const passLabel = document.createElement("label"); passLabel.textContent = "New Password:";
        this.newPasswordInput = document.createElement("input"); this.newPasswordInput.type = "password"; this.newPasswordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 5px; background-color: #333; color: #eee; border: 1px solid #555;";
        const confirmLabel = document.createElement("label"); confirmLabel.textContent = "Confirm Password:";
        this.confirmPasswordInput = document.createElement("input"); this.confirmPasswordInput.type = "password"; this.confirmPasswordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555;";
        this.confirmPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.setPassword(); });
        const setButton = document.createElement("button"); setButton.textContent = "Set Password"; setButton.className = "comfy-button"; setButton.addEventListener("click", this.setPassword.bind(this));
        this.setupStatusMessage = document.createElement("p"); this.setupStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
        view.append(title, p1, passLabel, this.newPasswordInput, confirmLabel, this.confirmPasswordInput, setButton, this.setupStatusMessage);
        return view;
    },
    createManualSetupView: function () {
        const view = document.createElement("div");
        view.id = "holaf-manual-view";
        view.className = "holaf-terminal-non-terminal-view";
        view.style.fontSize = "12px";
        const title = document.createElement("h3"); title.textContent = "Manual Setup Required"; title.style.color = "#ffcc00";
        const p1 = document.createElement("p"); p1.innerHTML = "The server couldn't save <code>config.ini</code> due to file permissions.";
        const p2 = document.createElement("p"); p2.innerHTML = "Please manually add the following line to your <code>ComfyUI-Holaf-Utilities/config.ini</code> file under the <code>[Security]</code> section, then restart ComfyUI."; p2.style.margin = "10px 0";
        this.hashDisplay = document.createElement("input"); this.hashDisplay.type = "text"; this.hashDisplay.readOnly = true; this.hashDisplay.style.cssText = "width: 100%; font-family: monospace; background-color: #333; color: #eee; border: 1px solid #555; margin: 5px 0;";
        const copyButton = document.createElement("button"); copyButton.textContent = "Copy Hash"; copyButton.className = "comfy-button"; copyButton.addEventListener("click", () => { this.hashDisplay.select(); document.execCommand("copy"); });
        view.append(title, p1, p2, this.hashDisplay, copyButton);
        return view;
    },

    showView: function (viewName) {
        const isTerminal = viewName === 'terminal';
        this.loadingView.style.display = viewName === 'loading' ? 'block' : 'none';
        this.loginView.style.display = viewName === 'login' ? 'block' : 'none';
        this.setupView.style.display = viewName === 'setup' ? 'block' : 'none';
        this.manualSetupView.style.display = viewName === 'manual_setup' ? 'block' : 'none';
        this.terminalContainer.style.display = isTerminal ? 'flex' : 'none';
        if (isTerminal && this.fitAddon) this.fitTerminal();
        else if (viewName === 'login' && this.passwordInput) this.passwordInput.focus();
        else if (viewName === 'setup' && this.newPasswordInput) this.newPasswordInput.focus();
    },

    checkServerStatus: async function () {
        this.showView('loading');
        try {
            const r = await fetch("/holaf/terminal/status");
            const d = await r.json();
            if (d.ui_settings) {
                Object.assign(this.settings, d.ui_settings);
                this.applySettings();
            }
            d.password_is_set ? this.showView('login') : this.showView('setup');
        } catch (e) {
            this.loadingView.textContent = "Error: Could not contact server.";
        }
    },
    setPassword: async function () { const newPass = this.newPasswordInput.value, confirmPass = this.confirmPasswordInput.value; if (!newPass || newPass.length < 4) { this.setupStatusMessage.textContent = "Password must be at least 4 characters long."; return; } if (newPass !== confirmPass) { this.setupStatusMessage.textContent = "Passwords do not match."; return; } this.setupStatusMessage.textContent = "Setting password..."; try { const r = await fetch('/holaf/terminal/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPass }) }), d = await r.json(); if (r.ok && d.status === "ok" && d.action === "reload") { this.setupStatusMessage.textContent = ""; this.showView('login'); this.loginStatusMessage.textContent = "Password set successfully! Please log in."; } else if (r.ok && d.status === "manual_required") { this.hashDisplay.value = `password_hash = ${d.hash}`; this.showView('manual_setup'); } else { this.setupStatusMessage.textContent = `Error: ${d.message || 'An unknown error occurred'}`; } } catch (e) { this.setupStatusMessage.textContent = `Error: Could not contact server.`; } },
    authenticateAndConnect: async function () { const password = this.passwordInput.value; if (!password) { this.loginStatusMessage.textContent = "Error: Password cannot be empty."; return; } this.loginStatusMessage.textContent = "Authenticating..."; try { const r = await fetch('/holaf/terminal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) }), d = await r.json(); r.ok ? this.connectWebSocket(d.session_token) : this.loginStatusMessage.textContent = `Error: ${d.message || 'Authentication Failed'}`; } catch (e) { this.loginStatusMessage.textContent = "Error: Could not reach server."; } finally { this.passwordInput.value = ""; } },

    connectWebSocket: async function (sessionToken) {
        if (!sessionToken) { this.loginStatusMessage.textContent = "Error: No session token received."; return; }
        this.showView('terminal');
        try {
            const basePath = "/extensions/ComfyUI-Holaf-Utilities/";
            if (!window.Terminal) { await Promise.all([loadScript(`${basePath}xterm.js`), loadScript(`${basePath}xterm-addon-fit.js`)]); }

            if (!this.terminal) {
                const currentTheme = this.themes.find(t => t.name === this.settings.theme) || this.themes[0];
                this.terminal = new window.Terminal({
                    cursorBlink: true,
                    fontSize: this.settings.fontSize,
                    theme: currentTheme
                });
                this.fitAddon = new window.FitAddon.FitAddon();
                this.terminal.loadAddon(this.fitAddon);
                this.terminal.open(this._xterm_container);
                this.terminal.onData(data => { if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(data); });
                this.terminal.attachCustomKeyEventHandler(e => { if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') { if (this.terminal.hasSelection()) { navigator.clipboard.writeText(this.terminal.getSelection()); return false; } } if (e.ctrlKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') { navigator.clipboard.readText().then(text => { if (text) this.terminal.paste(text); }); return false; } return true; });
            } else {
                this.terminal.options.fontSize = this.settings.fontSize;
                this.setTheme(this.settings.theme, false);
            }
        } catch (e) {
            console.error("Holaf Utilities: Terminal load error", e);
            this.terminalContainer.textContent = "Error: Could not load terminal component.";
            return;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/holaf/terminal?token=${encodeURIComponent(sessionToken)}`;
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';
        this.socket.onopen = () => { console.log("Holaf Utilities: Terminal WebSocket established."); this.fitTerminal(); this.terminal.focus(); };
        this.socket.onmessage = (event) => { if (event.data instanceof ArrayBuffer) this.terminal.write(new Uint8Array(event.data)); else this.terminal.write(event.data); };
        this.socket.onclose = () => { console.log("Holaf Utilities: Terminal WebSocket closed."); this.terminal.writeln("\r\n\r\n--- CONNECTION CLOSED ---"); this.socket = null; this.checkServerStatus(); };
        this.socket.onerror = (e) => { console.error("Holaf Utilities: Terminal WebSocket error.", e); this.terminal.writeln("\r\n\r\n--- CONNECTION ERROR ---"); };
    },

    fitTerminal() { if (this.fitAddon && this.panel && this.panel.style.display !== 'none') { this.fitAddon.fit(); const dims = this.fitAddon.proposeDimensions(); if (dims && this.socket && this.socket.readyState === WebSocket.OPEN) { this.socket.send(JSON.stringify({ resize: [dims.rows, dims.cols] })); } } },

    setTheme(themeName, doSave = true) {
        const theme = this.themes.find(t => t.name === themeName);
        if (!theme) return;
        this.settings.theme = themeName;
        if (this.terminal) this.terminal.options.theme = theme;
        if (this.panel) this.panel.style.backgroundColor = theme.background;
        if (doSave) this.saveSettings({ theme: themeName });
    },
    increaseFontSize() {
        if (this.settings.fontSize < 24) {
            this.settings.fontSize++;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },
    decreaseFontSize() {
        if (this.settings.fontSize > 8) {
            this.settings.fontSize--;
            if (this.terminal) this.terminal.options.fontSize = this.settings.fontSize;
            this.fitTerminal();
            this.saveSettings({ font_size: this.settings.fontSize });
        }
    },

    _bakePosition(panel) { if (panel.style.transform && panel.style.transform !== 'none') { const rect = panel.getBoundingClientRect(); panel.style.top = `${rect.top}px`; panel.style.left = `${rect.left}px`; panel.style.transform = 'none'; } },

    makeDraggable(header, panel) { let isDragging = false, offsetX, offsetY; header.addEventListener("mousedown", (e) => { if (e.target.closest("button")) return; this._bakePosition(panel); isDragging = true; offsetX = e.clientX - panel.offsetLeft; offsetY = e.clientY - panel.offsetTop; document.addEventListener("mousemove", onMouseMove); document.addEventListener("mouseup", onMouseUp); }); const onMouseMove = (e) => { if (isDragging) { panel.style.left = `${e.clientX - offsetX}px`; panel.style.top = `${e.clientY - offsetY}px`; } }; const onMouseUp = () => { isDragging = false; document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); this.saveSettings({ panel_x: panel.offsetLeft, panel_y: panel.offsetTop }); }; },

    makeResizable(handle, panel) { let isResizing = false; handle.addEventListener("mousedown", (e) => { e.preventDefault(); this._bakePosition(panel); isResizing = true; document.addEventListener("mousemove", onResizeMove); document.addEventListener("mouseup", onResizeUp); }); const onResizeMove = (e) => { if (isResizing) { const newWidth = e.clientX - panel.offsetLeft + 8; const newHeight = e.clientY - panel.offsetTop + 8; panel.style.width = `${newWidth}px`; panel.style.height = `${newHeight}px`; this.fitTerminal(); } }; const onResizeUp = () => { isResizing = false; document.removeEventListener("mousemove", onResizeMove); document.removeEventListener("mouseup", onResizeUp); this.saveSettings({ panel_width: panel.offsetWidth, panel_height: panel.offsetHeight }); }; },
};

app.registerExtension({
    name: "Holaf.Terminal.Panel",
    async setup() {
        console.log("[Holaf Utilities] Setting up Terminal panel.");

        await new Promise(resolve => setTimeout(resolve, 0));

        const dropdownMenu = document.getElementById("holaf-utilities-dropdown-menu");
        if (!dropdownMenu) {
            console.error("[Holaf Utilities] Could not find the Utilities dropdown menu to add the Terminal item.");
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
            holafTerminal.show();
            dropdownMenu.style.display = "none";
        };

        dropdownMenu.prepend(terminalMenuItem);
    },
});