# Holaf Terminal for ComfyUI

## 🚨 ***EXTREMELY IMPORTANT SECURITY WARNING*** 🚨

**This custom extension provides a remote web-based shell (terminal) interface to the machine running the ComfyUI server. By installing and using this extension, you are opening a direct, powerful, and potentially dangerous access point to your system.**

**USE THIS EXTENSION AT YOUR OWN ABSOLUTE RISK. THE AUTHOR(S) ARE NOT RESPONSIBLE FOR ANY DAMAGE, DATA LOSS, OR SECURITY BREACHES THAT MAY RESULT FROM ITS USE.**

---

### Before You Proceed, You MUST Understand:

1.  **Remote Code Execution:** This extension is designed to execute shell commands on your server from a web browser. If your ComfyUI is accessible on a network (even a local one), anyone who can access the ComfyUI web page could potentially gain control of your server.
2.  **Network Security:** **DO NOT** expose your ComfyUI instance to the public internet (e.g., using `--listen 0.0.0.0`) with this extension installed unless you have secured it behind a robust authentication layer (like a reverse proxy with user/password login) and are using **HTTPS**.
3.  **Password Authentication:** This extension is secured by a password that you set. The password is stored in a hashed format in the `config.ini` file.
4.  **Intended Use:** This tool is intended for advanced users who need to perform system maintenance (e.g., manage files, update repositories, monitor processes with `nvidia-smi`) on a remote or headless ComfyUI server without needing a separate SSH session.

**If you do not understand these risks, DO NOT INSTALL THIS EXTENSION.**

---

## Features

*   Provides a fully functional, floating terminal panel accessible from the main menu.
*   **Full support for both Windows (PowerShell, Cmd) and Linux/macOS (bash, zsh).**
*   Uses `xterm.js`, the same terminal component found in applications like VS Code.
*   The shell runs within ComfyUI's environment, giving you access to the correct Python virtual environment and `PATH`.
*   Secure authentication via a hashed password stored in `config.ini`.
*   Easy, one-time password setup directly from the terminal panel.
*   The panel is draggable and resizable for convenience.

---

## Installation

1.  Navigate to your ComfyUI custom nodes directory:
    ```bash
    cd ComfyUI/custom_nodes/
    ```

2.  Clone this repository:
    ```bash
    git clone <repository_url> ComfyUI-Holaf-Terminal
    ```
    *(Replace `<repository_url>` with the actual URL of the repository)*

3.  Install the required Python dependencies. Navigate into the new directory and use `pip`:
    ```bash
    cd ComfyUI-Holaf-Terminal
    pip install -r requirements.txt
    ```
    *Note: This will install packages like `pywinpty` on Windows to provide a full-featured terminal experience.*

4.  Restart ComfyUI.

---

## Configuration & Usage

### First-Time Setup

1.  After installing and restarting ComfyUI, click the **"Terminal"** button in the top menu bar.
2.  A floating panel will appear, displaying a "Setup" screen.
3.  Enter and confirm a strong password directly in the panel and click "Set Password".
4.  The backend will attempt to save a hashed version of your password to `ComfyUI-Holaf-Terminal/config.ini`.
    *   **If successful,** the panel will switch to a login screen.
    *   **If it fails (due to file permissions),** the panel will display the generated password hash and instructions. You must then manually copy this hash into your `config.ini` file and restart ComfyUI.

### Normal Usage

1.  Click the **"Terminal"** button in the top menu bar to open the panel.
2.  Enter the password you configured.
3.  Click "Connect".
4.  If the password is correct, the terminal will be activated. You can show/hide the panel by clicking the menu button again.

### Changing or Resetting Your Password

If you forget your password, you must manually edit or delete the `password_hash` line from the `config.ini` file in the `ComfyUI-Holaf-Terminal` directory and then restart ComfyUI. This will trigger the first-time setup process again.

---

*This extension was developed with AI assistance.*