# Holaf Utilities for ComfyUI.

## 🚨 ***EXTREMELY IMPORTANT SECURITY WARNING*** 🚨

**This custom extension provides powerful tools, including a web terminal (shell) interface, to the machine running the ComfyUI server. By installing and using this extension, you are opening a direct and potentially dangerous access point to your system.**

**USE THIS EXTENSION AT YOUR OWN RISK. THE AUTHOR(S) ARE NOT RESPONSIBLE FOR ANY DAMAGE, DATA LOSS, OR SECURITY BREACHES THAT MAY RESULT FROM ITS USE.**

---

### Before you proceed, you MUST understand:

1.  **Remote Code Execution:** The Terminal utility is designed to execute shell commands on your server from a web browser. If your ComfyUI is accessible on a network (even a local one), anyone who can access the ComfyUI web page could potentially take control of your server.
2.  **Network Security:** **DO NOT EXPOSE** your ComfyUI instance to the public internet (e.g., using `--listen 0.0.0.0`) with this extension installed, unless you have secured it behind a robust authentication layer (like a reverse proxy with a login/password) and are using **HTTPS**.
3.  **Password Authentication:** The Terminal is secured by a password that you set. The password is saved as a hash in the `config.ini` file.
4.  **Intended Use:** This tool is intended for advanced users who need to perform system maintenance (manage files, update repositories, monitor processes with `nvidia-smi`) on a remote or headless ComfyUI server without needing a separate SSH session.

**If you do not understand these risks, DO NOT INSTALL THIS EXTENSION.**

---

### 🔐 Sensitive routes require a password

Beyond the Terminal, the following sensitive endpoints are **always** protected
by the same password-based session authentication (`holaf_session` cookie):

* `POST /holaf/utilities/restart`
* `POST /holaf/models/upload-chunk`, `POST /holaf/models/finalize-upload`, `POST /holaf/models/delete`
* `GET/POST /aih/credentials`, `GET /aih/openai/keys`
* `POST /aih/update`
* `POST /api/aih/custom-nodes/install`
* `POST/GET /aih/blobby/save`, `/aih/blobby/load`, `POST /aih/blobby/exec`

There is **no local-only exemption**: these routes require a valid session even
when ComfyUI is bound to `127.0.0.1`. This is intentional — a reverse proxy on
the same host (e.g. Caddy) can still forward requests to a loopback-bound
ComfyUI, so a bind-address check cannot reliably distinguish local access from
proxied access. **You MUST set a password** (via the Terminal setup panel or by
writing a `password_hash` into `config.ini`) for these features to work. Without
a configured password, the login endpoint refuses all sessions and these routes
return `401`.

---

## Included Utilities

*   **Holaf Terminal:** A functional, floating terminal panel, accessible from the "Utilities" menu. It runs within the ComfyUI environment, giving you access to the correct Python virtual environment.
*   **Holaf Model Manager:** An interface to view, search, and manage models recognized by ComfyUI.
*   **Holaf Image Viewer:** A powerful, fast, database-driven image and metadata manager, including a non-destructive image editor.
*   **(Planned) Holaf Session Log:** A UI activity log to track all actions performed during the session.

---

## Installation

1.  Navigate to the ComfyUI custom nodes directory:
    ```bash
    cd ComfyUI/custom_nodes/
    ```

2.  Clone this repository:
    ```bash
    git clone https://github.com/grokuku/ComfyUI-Holaf-Utilities
    ```

3.  Install the required Python dependencies. Navigate into the new directory and use `pip`:
    ```bash
    cd ComfyUI-Holaf-Utilities
    pip install -r requirements.txt
    ```
    *Note: This will install packages like `pywinpty` on Windows to provide a full terminal experience.*

4.  Restart ComfyUI.

---

## Configuration & Usage

### First-Time Use (Terminal)

1.  After installation and restarting ComfyUI, click the **"Utilities"** button in the top menu bar, then select **"Terminal"**.
2.  A floating panel will appear, displaying a "Setup" screen.
3.  Enter and confirm a strong password directly in the panel and click "Set Password".
4.  The backend will attempt to save a hashed version of your password to a `config.ini` file.
    *   **On success,** the panel will switch to a login screen.
    *   **On failure (due to file permissions),** the panel will display the generated password hash and instructions. You will then need to manually copy this hash into your `config.ini` file and restart ComfyUI.
    *   The `config.ini` file is located in `ComfyUI/custom_nodes/ComfyUI-Holaf-Utilities/`.

### Normal Usage

1.  Click the **"Utilities"** menu to open a utility panel.
2.  For the Terminal, enter the password you configured and click "Connect".
3.  You can show/hide the panel by clicking the menu item again.

---

## Project Roadmap & Status

This document tracks the project's evolution, planned features, and identified bugs.

**Legend:**
*   `🐞 Active Bug`
*   `⏳ In Progress`
*   `💡 Planned / Roadmap`
*   `🔧 Technical Improvement / Refactor`
*   `✅ Completed`

---

### 🐞 Active Bugs

*   *(None currently identified)*

### ⏳ In Progress

*   *(None currently identified)*

### 💡 Roadmap

#### General System & New Tools

*   `💡` **New Tool: Session Log:** Add a new panel that will display a textual history of all user actions and system responses within the interface (e.g., "5 images deleted," "API Error," etc.), providing clear session traceability.
*   `💡` **Periodic Maintenance Worker:** Implement a background worker running hourly to clean up stale data (orphaned thumbnails, invalid database entries) and optimize the database, ensuring long-term performance.

#### Image Viewer

*   `🔧` **Real-time File Monitoring:** Replace the periodic database scan with active file system monitoring (via `watchdog`) for instant detection and display of new or deleted images.
*   `💡` **Automated Corrupted File Management:**
    *   Create a special `output/corrupted` folder.
    *   During scans, automatically move unreadable images (and their `.txt`/`.json` files) to this folder.
    *   Display `Corrupted` as a special filter in the UI, with an "Empty" button to purge the folder.
*   `💡` **Define Feature Actions:**
    *   **"Slideshow" Button:** Implement a slideshow mode.

#### Image Editor

*   `💡` **"Operations" Tab:** Implement an "Operations" tab with "Toggle Preview" and "Copy/Paste Settings" functionality.
*   `💡` **New Features:** Crop/Expand, White Balance, Vignette, Watermark Overlay.

---

### ✅ Completed Features (Selection)

*   `✅` **Massive Gallery Performance Overhaul:** Reworked the thumbnail loading mechanism to be non-blocking and debounced. The gallery now remains fluid and responsive even when scrolling through tens of thousands of images, preventing server overload.
*   `✅` **Dialog & Accessibility Overhaul:** All dialogs are now fully keyboard navigable. Simple dialogs use arrow keys for button selection, while the complex export dialog features advanced 2D-aware navigation for all controls.
*   `✅` **UI & Focus Management:** Fixed a critical z-index bug causing dialogs to appear behind the fullscreen view. Corrected a major usability issue where clicking on UI controls (sliders, checkboxes) would improperly block main keyboard shortcuts.
*   `✅` **Unsaved Changes Warning on Export:** The editor now prompts the user to save or discard changes before exporting an edited image, preventing accidental data loss.
*   `✅` **UI Bug Squashing Spree:** Corrected bugs related to editor visibility, unresponsive filter buttons, and filter label positioning for a cleaner, more reliable interface.
*   `✅` **State-Driven Architecture:** Major frontend refactor to use a central state manager, resulting in a highly responsive UI where filter changes are instant.
*   `✅` **Non-Blocking Toast Notifications:** Replaced blocking `alert()` and `confirm()` dialogs with a non-blocking, auto-hiding toast notification system.
*   `✅` **Folder Filter Enhancements:** Added "Invert" selection, per-folder "lock" icons, and an advanced reset dialog that respects locked folders.
*   `✅` **Full Filter Persistence:** All filter settings (search, folders, dates, lock state, etc.) are now correctly saved and restored between sessions.
*   `✅` **Export Workflow Fix:** Corrected a frontend/backend data mismatch that prevented workflows from being saved in exported images.
*   `✅` **Thumbnail & Gallery Fixes:** Corrected last-row justification, implemented instant thumbnail size/fit updates, and enabled spacebar to toggle selection.
*   `✅` **Editor & Fullscreen Previews:** Live editor previews now correctly apply to the active image in zoom and fullscreen modes.
*   `✅` **Differential Gallery Rendering:** Replaced full gallery redraws with a differential rendering engine for fluid, non-blocking filter changes and eliminated race conditions.
*   `✅` **Trashcan Feature:** Implemented "Delete" (move to `trashcan`), "Restore," and "Empty Trashcan" functionality.
*   `✅` **Metadata Tools:** Implemented "Extract/Inject Metadata" APIs and UI buttons.
*   `✅` **Major Backend/Frontend Refactor:** Split the codebase into logical modules for improved maintainability.

---
*This extension was developed by Gemini (AI Assistant), under the guidance of Holaf.*