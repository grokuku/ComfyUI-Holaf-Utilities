/* === Documentation ===
 * Author: Holaf, with assistance from Cline (AI Assistant)
 * Date: 2025-05-15
 *
 * Purpose:
 * This JavaScript file provides the entire frontend logic for the Holaf Terminal node.
 * It uses xterm.js to create an interactive terminal within the ComfyUI node interface.
 *
 * How it works (v13 - Hybrid Setup):
 * 1. Status Check: On creation, the node checks if a password is set on the backend.
 * 2. Conditional UI:
 *    - If no password, shows "Setup View".
 *    - If password is set, shows "Login View".
 * 3. "Try, then Guide" Setup:
 *    - The setup view sends the new password to POST /holaf/terminal/set-password.
 *    - If the backend successfully saves the config, it returns {status: "ok"}.
 *      The UI then switches to the Login View.
 *    - If the backend fails to save due to permissions, it returns
 *      {status: "manual_required", hash: "..."}. The UI then shows a new
 *      "Manual Setup View" with the generated hash and instructions.
 * === End Documentation ===
 */
import { app } from "../../../scripts/app.js";

const HolafTerminalNodeType = "HolafTerminal";

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

app.registerExtension({
    name: "Holaf.Terminal",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === HolafTerminalNodeType) {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                this.terminal = null;
                this.fitAddon = null;
                this.socket = null;

                const mainContainer = document.createElement("div");
                mainContainer.style.cssText = "width: 100%; height: 100%; display: flex; flex-direction: column; background-color: #1e1e1e; color: #cccccc; font-family: monospace; font-size: 14px; padding: 5px; box-sizing: border-box;";

                // --- UI Views ---
                this.loadingView = this.createLoadingView();
                this.loginView = this.createLoginView();
                this.setupView = this.createSetupView();
                this.manualSetupView = this.createManualSetupView(); // MODIFICATION: New view
                this.terminalContainer = this.createTerminalView();

                mainContainer.append(this.loadingView, this.loginView, this.setupView, this.manualSetupView, this.terminalContainer);
                this.addDOMWidget("holaf_terminal_widget", "div", mainContainer);

                this.checkServerStatus();
                this.onResize(this.size);
            };

            // --- UI Creation Functions ---
            nodeType.prototype.createLoadingView = function () { /* ... unchanged ... */ return document.createElement("div"); };
            nodeType.prototype.createLoginView = function () { /* ... unchanged ... */ return document.createElement("div"); };
            nodeType.prototype.createSetupView = function () { /* ... unchanged ... */ return document.createElement("div"); };

            nodeType.prototype.createManualSetupView = function () {
                const view = document.createElement("div");
                view.style.padding = "10px";
                view.style.display = "none";
                view.style.fontSize = "12px";

                const title = document.createElement("h3");
                title.textContent = "Manual Setup Required";
                title.style.color = "#ffcc00";

                const p1 = document.createElement("p");
                p1.innerHTML = "The server couldn't save <code>config.ini</code> due to file permissions.";

                const p2 = document.createElement("p");
                p2.innerHTML = "Please manually add the following line to your <code>ComfyUI-Holaf-Terminal/config.ini</code> file under the <code>[Security]</code> section, then restart ComfyUI.";
                p2.style.margin = "10px 0";

                this.hashDisplay = document.createElement("input");
                this.hashDisplay.type = "text";
                this.hashDisplay.readOnly = true;
                this.hashDisplay.style.cssText = "width: 100%; font-family: monospace; background-color: #333; color: #eee; border: 1px solid #555; margin: 5px 0;";

                const copyButton = document.createElement("button");
                copyButton.textContent = "Copy Hash";
                copyButton.className = "comfy-button";
                copyButton.addEventListener("click", () => {
                    this.hashDisplay.select();
                    document.execCommand("copy");
                });

                view.append(title, p1, p2, this.hashDisplay, copyButton);
                return view;
            };

            nodeType.prototype.createTerminalView = function () { /* ... unchanged ... */ return document.createElement("div"); };
            // Populate the views (code omitted for brevity, it's the same as previous step)
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);

                this.terminal = null;
                this.fitAddon = null;
                this.socket = null;

                const mainContainer = document.createElement("div");
                mainContainer.style.cssText = "width: 100%; height: 100%; display: flex; flex-direction: column; background-color: #1e1e1e; color: #cccccc; font-family: monospace; font-size: 14px; padding: 5px; box-sizing: border-box;";

                // --- UI Views ---
                this.loadingView = this.createLoadingView();
                this.loginView = this.createLoginView();
                this.setupView = this.createSetupView();
                this.manualSetupView = this.createManualSetupView();
                this.terminalContainer = this.createTerminalView();

                mainContainer.append(this.loadingView, this.loginView, this.setupView, this.manualSetupView, this.terminalContainer);
                this.addDOMWidget("holaf_terminal_widget", "div", mainContainer);

                this.checkServerStatus();
                this.onResize(this.size);
            };

            // Re-populating view creation logic from previous step
            nodeType.prototype.createLoadingView = function () {
                const view = document.createElement("div"); view.style.padding = "10px"; view.textContent = "Checking server status..."; return view;
            };
            nodeType.prototype.createLoginView = function () {
                const view = document.createElement("div"); view.style.padding = "10px"; view.style.display = "none";
                const label = document.createElement("label"); label.textContent = "Password:"; label.style.cssText = "display: block; margin-bottom: 5px;";
                this.passwordInput = document.createElement("input"); this.passwordInput.type = "password"; this.passwordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555;";
                const connectButton = document.createElement("button"); connectButton.textContent = "Connect"; connectButton.className = "comfy-button"; connectButton.addEventListener("click", this.authenticateAndConnect.bind(this));
                this.loginStatusMessage = document.createElement("p"); this.loginStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
                view.append(label, this.passwordInput, connectButton, this.loginStatusMessage); return view;
            };
            nodeType.prototype.createSetupView = function () {
                const view = document.createElement("div"); view.style.padding = "10px"; view.style.display = "none";
                const title = document.createElement("h3"); title.textContent = "Holaf Terminal Setup";
                const p1 = document.createElement("p"); p1.textContent = "No password is set on the server. Please create one to enable the terminal."; p1.style.marginBottom = "15px";
                const passLabel = document.createElement("label"); passLabel.textContent = "New Password:";
                this.newPasswordInput = document.createElement("input"); this.newPasswordInput.type = "password"; this.newPasswordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 5px; background-color: #333; color: #eee; border: 1px solid #555;";
                const confirmLabel = document.createElement("label"); confirmLabel.textContent = "Confirm Password:";
                this.confirmPasswordInput = document.createElement("input"); this.confirmPasswordInput.type = "password"; this.confirmPasswordInput.style.cssText = "width: calc(100% - 10px); margin-bottom: 10px; background-color: #333; color: #eee; border: 1px solid #555;";
                const setButton = document.createElement("button"); setButton.textContent = "Set Password"; setButton.className = "comfy-button"; setButton.addEventListener("click", this.setPassword.bind(this));
                this.setupStatusMessage = document.createElement("p"); this.setupStatusMessage.style.cssText = "margin-top: 10px; color: #ffcc00;";
                view.append(title, p1, passLabel, this.newPasswordInput, confirmLabel, this.confirmPasswordInput, setButton, this.setupStatusMessage); return view;
            };
            nodeType.prototype.createTerminalView = function () {
                const view = document.createElement("div"); view.style.cssText = "width: 100%; height: 100%; flex-grow: 1; display: none;"; return view;
            };

            // --- Logic Functions ---
            nodeType.prototype.showView = function (viewName) {
                this.loadingView.style.display = viewName === 'loading' ? 'block' : 'none';
                this.loginView.style.display = viewName === 'login' ? 'block' : 'none';
                this.setupView.style.display = viewName === 'setup' ? 'block' : 'none';
                this.manualSetupView.style.display = viewName === 'manual_setup' ? 'block' : 'none';
                this.terminalContainer.style.display = viewName === 'terminal' ? 'block' : 'none';
            };

            nodeType.prototype.checkServerStatus = async function () { /* ... unchanged ... */ };

            // MODIFICATION: setPassword now handles the hybrid response
            nodeType.prototype.setPassword = async function () {
                const newPass = this.newPasswordInput.value;
                const confirmPass = this.confirmPasswordInput.value;

                if (!newPass || newPass.length < 4) {
                    this.setupStatusMessage.textContent = "Password must be at least 4 characters long."; return;
                }
                if (newPass !== confirmPass) {
                    this.setupStatusMessage.textContent = "Passwords do not match."; return;
                }

                this.setupStatusMessage.textContent = "Setting password...";
                try {
                    const response = await fetch('/holaf/terminal/set-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: newPass })
                    });
                    const data = await response.json();

                    if (response.ok && data.status === "ok" && data.action === "reload") {
                        this.setupStatusMessage.textContent = "";
                        this.showView('login');
                        this.loginStatusMessage.textContent = "Password set successfully! Please log in.";
                    } else if (response.ok && data.status === "manual_required") {
                        this.hashDisplay.value = `password_hash = ${data.hash}`;
                        this.showView('manual_setup');
                    } else {
                        this.setupStatusMessage.textContent = `Error: ${data.message || 'An unknown error occurred'}`;
                    }
                } catch (e) {
                    this.setupStatusMessage.textContent = `Error: Could not contact server.`;
                }
            };

            // Other functions (authenticateAndConnect, connectWebSocket, lifecycle) remain unchanged from the previous step.
            nodeType.prototype.checkServerStatus = async function () {
                this.showView('loading');
                try {
                    const response = await fetch("/holaf/terminal/status");
                    const data = await response.json();
                    if (data.password_is_set) { this.showView('login'); } else { this.showView('setup'); }
                } catch (e) { this.loadingView.textContent = "Error: Could not contact server."; }
            };
            nodeType.prototype.authenticateAndConnect = async function () {
                const password = this.passwordInput.value;
                if (!password) { this.loginStatusMessage.textContent = "Error: Password cannot be empty."; return; }
                this.loginStatusMessage.textContent = "Authenticating...";
                try {
                    const response = await fetch('/holaf/terminal/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) });
                    const responseData = await response.json();
                    if (response.ok) { this.connectWebSocket(responseData.session_token); } else { this.loginStatusMessage.textContent = `Error: ${responseData.message || 'Authentication Failed'}`; }
                } catch (error) { this.loginStatusMessage.textContent = "Error: Could not reach server."; } finally { this.passwordInput.value = ""; }
            };
            nodeType.prototype.connectWebSocket = async function (sessionToken) {
                if (!sessionToken) { this.loginStatusMessage.textContent = "Error: No session token received."; return; }
                this.showView('terminal');
                try {
                    const basePath = "/extensions/ComfyUI-Holaf-Terminal/";
                    await Promise.all([loadScript(`${basePath}xterm.js`), loadScript(`${basePath}xterm-addon-fit.js`)]);
                    this.terminal = new window.Terminal({ cursorBlink: true, theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#555555' }, rows: 15 });
                    this.fitAddon = new window.FitAddon.FitAddon(); this.terminal.loadAddon(this.fitAddon); this.terminal.open(this.terminalContainer); this.onResize(this.size);
                } catch (e) { console.error("Holaf Terminal:", e); this.terminalContainer.textContent = "Error: Could not load terminal component."; return; }
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                const url = `${protocol}//${window.location.host}/holaf/terminal?token=${encodeURIComponent(sessionToken)}`;
                this.socket = new WebSocket(url); this.socket.binaryType = 'arraybuffer';
                this.socket.onopen = () => { console.log("Holaf Terminal: WebSocket established."); this.fitAddon.fit(); };
                this.terminal.onData(data => { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data); });
                this.socket.onmessage = (event) => { if (event.data instanceof ArrayBuffer) this.terminal.write(new Uint8Array(event.data)); else this.terminal.write(event.data); };
                this.socket.onclose = () => { console.log("Holaf Terminal: WebSocket closed."); this.terminal.writeln("\r\n\r\n--- CONNECTION CLOSED ---"); };
                this.socket.onerror = (e) => { console.error("Holaf Terminal: WebSocket error.", e); this.terminal.writeln("\r\n\r\n--- CONNECTION ERROR ---"); };
            };
            const onResize = nodeType.prototype.onResize;
            nodeType.prototype.onResize = function (size) {
                onResize?.apply(this, arguments);
                if (this.fitAddon) { if (this.resizeTimeout) clearTimeout(this.resizeTimeout); this.resizeTimeout = setTimeout(() => { this.fitAddon.fit(); const dims = this.fitAddon.proposeDimensions(); if (dims && this.socket && this.socket.readyState === WebSocket.OPEN) { try { this.socket.send(JSON.stringify({ resize: [dims.rows, dims.cols] })); } catch (e) { console.error("Holaf Terminal: Resize failed.", e); } } }, 100); }
            };
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () { onRemoved?.apply(this, arguments); if (this.socket) this.socket.close(); if (this.terminal) this.terminal.dispose(); };
            nodeType.prototype.computeSize = function () { return [600, 400]; };
            nodeType.prototype.onDrawForeground = function (ctx) { };
        }
    },
});