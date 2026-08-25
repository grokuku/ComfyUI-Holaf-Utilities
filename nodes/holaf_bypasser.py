import torch

# --- Shared-module bootstrap ------------------------------------------------
# Nodes in this pack are loaded one-file-at-a-time by the extension's dynamic
# loader (importlib.util.spec_from_file_location), which registers each file
# under a synthetic "<package>.nodes.<stem>" name WITHOUT importing any parent
# package: package-relative imports therefore cannot work here. Instead we put
# this directory on sys.path and import the shared module absolutely, so every
# node resolves the SAME module instance (one ANY_TYPE singleton pack-wide).
import os as _os
import sys as _sys

_NODE_DIR = _os.path.dirname(_os.path.abspath(__file__))
if _NODE_DIR not in _sys.path:
    _sys.path.insert(0, _NODE_DIR)

from holaf_node_helpers import ANY_TYPE  # noqa: E402  (requires _NODE_DIR above)

class HolafBypasser:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "group_name": ("STRING", {"default": "Group A"}),
                "active": ("BOOLEAN", {"default": True, "label_on": "ON", "label_off": "OFF"}),
            },
            "optional": {
                "original": (ANY_TYPE,),
                "alternative": (ANY_TYPE,),
            }
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("output",)
    FUNCTION = "process"
    CATEGORY = "AIH/Flow Control"

    def process(self, group_name, active, original=None, alternative=None, **kwargs):
        # We accept **kwargs to handle dynamic inputs created by JS (bypass_2, bypass_3, etc.)
        # These extra inputs are just for triggering the bypass logic in JS, 
        # they are not used for data flow processing here.
        
        if active:
            return (original,)
        else:
            return (alternative,)

# === ComfyUI node registration =============================================
# Per-file registry read by the extension's dynamic loader. Canonical keys
# follow the AIH naming convention (AIH<PascalCase>, no Node suffix);
# legacy pre-fusion keys stay as aliases pointing to the SAME class so
# existing workflows keep loading. Legacy aliases are never purged.
NODE_CLASS_MAPPINGS = {
    "AIHBypasser": HolafBypasser,
    # Legacy alias - never purge.
    "HolafBypasser": HolafBypasser,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIHBypasser": "AIH Bypasser",
    "HolafBypasser": "AIH Bypasser",
}
