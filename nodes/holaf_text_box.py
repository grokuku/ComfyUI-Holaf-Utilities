class HolafTextBox:
    """
    Standard Text Box with an optional input for concatenation.
    Useful for prompts, notes, or combining string data.
    """
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": True}),
            },
            "optional": {
                "text_prepend": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("string",)
    FUNCTION = "run"
    CATEGORY = "AIH/Text"

    def run(self, text, text_prepend=None):
        result = text
        
        if text_prepend:
            result = text_prepend + result
            
        return (result,)

# === ComfyUI node registration =============================================
# Per-file registry read by the extension's dynamic loader. Canonical keys
# follow the AIH naming convention (AIH<PascalCase>, no Node suffix);
# legacy pre-fusion keys stay as aliases pointing to the SAME class so
# existing workflows keep loading. Legacy aliases are never purged.
NODE_CLASS_MAPPINGS = {
    "AIHTextBox": HolafTextBox,
    # Legacy alias - never purge.
    "HolafTextBox": HolafTextBox,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIHTextBox": "AIH Text Box",
    "HolafTextBox": "AIH Text Box",
}
