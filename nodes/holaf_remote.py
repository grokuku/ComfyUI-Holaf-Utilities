# Copyright (C) 2025 Holaf
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

class HolafRemote:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "group_name": ("STRING", {"default": "Group A"}),
                "active": ("BOOLEAN", {"default": True, "label_on": "ON", "label_off": "OFF"}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "process"
    CATEGORY = "AIH/Flow Control"
    OUTPUT_NODE = True

    def process(self, group_name, active):
        return {}

# === ComfyUI node registration =============================================
# Per-file registry read by the extension's dynamic loader. Canonical keys
# follow the AIH naming convention (AIH<PascalCase>, no Node suffix);
# legacy pre-fusion keys stay as aliases pointing to the SAME class so
# existing workflows keep loading. Legacy aliases are never purged.
NODE_CLASS_MAPPINGS = {
    "AIHRemote": HolafRemote,
    # Legacy alias - never purge.
    "HolafRemote": HolafRemote,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIHRemote": "AIH Remote",
    "HolafRemote": "AIH Remote",
}
