#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Lance les tests Python du projet (pytest).
#
# Pourquoi lancer depuis un répertoire neutre :
#   Le __init__.py à la racine est le point d'entrée de l'extension ComfyUI
#   (il importe `server`). Si pytest est invoqué depuis le dossier du projet,
#   il importe ce __init__.py pour résoudre le package et échoue.
#   En lançant depuis un répertoire temporaire avec un chemin absolu,
#   pytest importe uniquement les fichiers de tests (--import-mode=importlib).
#
# Usage :
#   ./run_tests.sh                       # utilise python3 (env courant)
#   PYTHON=/chemin/vers/venv/bin/python ./run_tests.sh
#   ./run_tests.sh -k rate_limited       # options pytest passées au script
# ─────────────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
cd "$WORK_DIR"
exec "$PYTHON" -m pytest "$SCRIPT_DIR/tests" --import-mode=importlib "$@"
