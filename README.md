# Holaf Utilities for ComfyUI

## 🚨 ***EXTREMELY IMPORTANT SECURITY WARNING*** 🚨

**This custom extension provides powerful tools, including a remote web-based shell (terminal) interface, to the machine running the ComfyUI server. By installing and using this extension, you are opening a direct and potentially dangerous access point to your system.**

**USE THIS EXTENSION AT YOUR OWN ABSOLUTE RISK. THE AUTHOR(S) ARE NOT RESPONSIBLE FOR ANY DAMAGE, DATA LOSS, OR SECURITY BREACHES THAT MAY RESULT FROM ITS USE.**

---

### Before You Proceed, You MUST Understand:

1.  **Remote Code Execution:** The Terminal utility is designed to execute shell commands on your server from a web browser. If your ComfyUI is accessible on a network (even a local one), anyone who can access the ComfyUI web page could potentially gain control of your server.
2.  **Network Security:** **DO NOT** expose your ComfyUI instance to the public internet (e.g., using `--listen 0.0.0.0`) with this extension installed unless you have secured it behind a robust authentication layer (like a reverse proxy with user/password login) and are using **HTTPS**.
3.  **Password Authentication:** The Terminal is secured by a password that you set. The password is stored in a hashed format in the `config.ini` file.
4.  **Intended Use:** This tool is intended for advanced users who need to perform system maintenance (e.g., manage files, update repositories, monitor processes with `nvidia-smi`) on a remote or headless ComfyUI server without needing a separate SSH session.

**If you do not understand these risks, DO NOT INSTALL THIS EXTENSION.**

---

## Included Utilities

### Holaf Terminal
*   A fully functional, floating terminal panel accessible from the **Utilities** menu.
*   Runs within ComfyUI's environment, giving you access to the correct Python virtual environment and `PATH`.
*   Secure authentication via a hashed password stored in `config.ini`. Easy, one-time password setup directly from the UI.
*   Supports Windows (Cmd, PowerShell), Linux (bash, zsh), and macOS.

### Holaf Model Manager
*   A simple UI to view and search through all models recognized by ComfyUI.
*   (More features planned)

The extension is designed to be modular, allowing for more utilities to be added in the future.

---

## Installation

1.  Navigate to your ComfyUI custom nodes directory:
    ```bash
    cd ComfyUI/custom_nodes/
    ```

2.  Clone this repository:
    ```bash
    git clone <repository_url> ComfyUI-Holaf-Utilities
    ```
    *(Replace `<repository_url>` with the actual URL of the repository)*

3.  Install the required Python dependencies. Navigate into the new directory and use `pip`:
    ```bash
    cd ComfyUI-Holaf-Utilities
    pip install -r requirements.txt
    ```
    *Note: This will install packages like `pywinpty` on Windows to provide a full-featured terminal experience.*

4.  Restart ComfyUI.

---

## Configuration & Usage

### First-Time Setup (Terminal)

1.  After installing and restarting ComfyUI, click the **"Utilities"** button in the top menu bar, then select **"Terminal"**.
2.  A floating panel will appear, displaying a "Setup" screen.
3.  Enter and confirm a strong password directly in the panel and click "Set Password".
4.  The backend will attempt to save a hashed version of your password to a `config.ini` file.
    *   **If successful,** the panel will switch to a login screen.
    *   **If it fails (due to file permissions),** the panel will display the generated password hash and instructions. You must then manually copy this hash into your `config.ini` file and restart ComfyUI.
    *   The `config.ini` file is located in `ComfyUI/custom_nodes/ComfyUI-Holaf-Utilities/`.

### Normal Usage

1.  Click the **"Utilities"** menu in the top menu bar to open a utility panel (e.g., "Terminal").
2.  For the Terminal, enter the password you configured.
3.  Click "Connect".
4.  If the password is correct, the terminal will be activated. You can show/hide the panel by clicking the menu item again.

### Changing or Resetting Your Password

If you forget your password, you must manually edit or delete the `password_hash` line from the `config.ini` file in the `ComfyUI-Holaf-Utilities` directory and then restart ComfyUI. This will trigger the first-time setup process again.

---

*This extension was developed by Gemini (AI Assistant), under the direction of Holaf.*