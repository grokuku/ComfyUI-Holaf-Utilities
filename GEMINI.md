## Project Overview

This project, `ComfyUI-Holaf-Utilities`, is a comprehensive extension for ComfyUI, a powerful and modular GUI for Stable Diffusion. It provides a suite of utilities aimed at improving the user experience for developers and artists. The extension is written in Python and leverages a modular architecture, with a JavaScript-based frontend.

The key features include:

*   **Holaf Terminal:** A web-based terminal for executing shell commands within the ComfyUI environment. It is secured with a password hash.
*   **Holaf Model Manager:** An interface for managing machine learning models, including uploading, downloading, and searching.
*   **Holaf Image Viewer:** A database-driven image gallery with features like metadata viewing, non-destructive editing, and advanced filtering.
*   **System Monitor:** A real-time monitor for system resources like CPU and memory.

The backend is built using `aiohttp` and communicates with the frontend via a combination of RESTful APIs and WebSockets. The project uses a `config.ini` file for configuration and an SQLite database for the image viewer.

## Building and Running

This is a plugin for ComfyUI. To run this project, you need to have a working installation of ComfyUI.

1.  **Installation:**
    *   Clone the repository into the `ComfyUI/custom_nodes/` directory.
    *   Install the required Python dependencies:
        ```bash
        pip install -r requirements.txt
        ```

2.  **Running:**
    *   Start ComfyUI as you normally would. The extension will be loaded automatically.

3.  **Configuration:**
    *   On the first run, you will need to set a password for the terminal. This can be done through the web interface or by running the password utility:
        ```bash
        python -m custom_nodes.ComfyUI-Holaf-Utilities
        ```
    *   The configuration is stored in `config.ini`.

## Development Conventions

*   The project is organized into several Python modules, each with a specific responsibility (e.g., `holaf_config.py`, `holaf_database.py`).
*   The frontend is written in JavaScript and is located in the `js/` directory.
*   The backend uses `asyncio` for asynchronous operations.
*   The project uses `flake8` for linting and `black` for formatting.
*   The project has a clear and well-documented API, which is defined in `__init__.py`.
*   The project uses a background worker thread for tasks like thumbnail generation and filesystem monitoring.
*   The project has a `CHANGELOG.md` file that documents changes to the project.
*   The project has a `ROADMAP.md` file that documents the project's future plans.
*   The project has a `CONTRIBUTING.md` file that provides guidelines for contributing to the project.
