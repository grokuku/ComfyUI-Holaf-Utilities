import os
import random
import string
import torch
import numpy as np
from PIL import Image
import folder_paths

class HolafRemoteComparerNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "comparison_name": ("STRING", {"default": "Comparison 1", "multiline": False}),
            },
            "optional": {
                "image_1": ("IMAGE",),
                "image_2": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image_1", "image_2")
    FUNCTION = "compare"
    CATEGORY = "Holaf"
    OUTPUT_NODE = True # Garante l'exécution même sans fil en sortie

    def compare(self, comparison_name="Comparison 1", image_1=None, image_2=None):
        ui_images =[]
        
        def save_preview(image_tensor, prefix):
            temp_dir = folder_paths.get_temp_directory()
            saved_images =[]
            # Handle batches of images if necessary
            for batch_number, image in enumerate(image_tensor):
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                # Generate a random identifier to avoid caching issues on the frontend
                random_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
                filename = f"holaf_remote_cmp_{prefix}_{random_id}_{batch_number}.png"
                filepath = os.path.join(temp_dir, filename)
                
                img.save(filepath, compress_level=1) # Fast save for preview
                
                saved_images.append({
                    "filename": filename,
                    "subfolder": "",
                    "type": "temp"
                })
            return saved_images

        # Process image 1
        if image_1 is not None:
            ui_images.extend(save_preview(image_1, "A"))
            
        # Process image 2
        if image_2 is not None:
            ui_images.extend(save_preview(image_2, "B"))

        # Transmission du nom au frontend via l'objet "ui"
        return {"ui": {"holaf_images": ui_images, "comparison_name": [comparison_name]}, "result": (image_1, image_2)}

# Expose the node to ComfyUI
NODE_CLASS_MAPPINGS = {
    "HolafRemoteComparer": HolafRemoteComparerNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "HolafRemoteComparer": "Remote Comparer (Holaf)"
}
