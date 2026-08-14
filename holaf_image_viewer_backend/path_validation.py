# === Holaf Utilities - Image Viewer Path Validation ===
import os


def validate_output_path(output_dir, rel_path):
    """
    Validate that *rel_path* resolves to a location strictly inside *output_dir*.

    Returns the resolved absolute path when valid. Raises ValueError with a
    clear message when the path is absolute, contains parent-directory
    traversal, or escapes *output_dir*.

    Security notes:
      * Rejects absolute paths and any '..' component (even embedded, e.g.
        'a/../../b'), so naive prefix checks cannot be bypassed.
      * Uses os.path.realpath + os.path.commonpath so symlinks and sibling
        directories such as 'output_evil' cannot escape the allowed root.
    """
    if rel_path is None:
        raise ValueError("Path is required.")

    rel_path = str(rel_path).replace('\\', '/')

    # Reject absolute paths (POSIX '/' as well as Windows drive/UNC paths).
    if os.path.isabs(rel_path) or rel_path.startswith('/'):
        raise ValueError("Absolute paths are not allowed.")

    # Reject any parent-directory component.
    parts = [p for p in rel_path.split('/') if p not in ('', '.')]
    if any(p == '..' for p in parts):
        raise ValueError("Parent directory traversal is not allowed.")

    real_output_dir = os.path.realpath(output_dir)
    full_path = os.path.realpath(os.path.join(real_output_dir, rel_path))

    try:
        common = os.path.commonpath([full_path, real_output_dir])
    except ValueError:
        # Windows: paths on different drives have no common path.
        raise ValueError("Path is outside the output directory.")

    if common != real_output_dir:
        raise ValueError("Path is outside the output directory.")

    return full_path
