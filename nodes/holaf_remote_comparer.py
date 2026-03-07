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
    OUTPUT_NODE = True # Garante l'exécution

    def compare(self, comparison_name="Comparison 1", image_1=None, image_2=None):
        ui_images =[]
        
        def save_preview(image_tensor, prefix):
            temp_dir = folder_paths.get_temp_directory()
            saved_media =[]
            
            B, H, W, C = image_tensor.shape
            random_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            
            if B == 1:
                # Single Image Logic
                image = image_tensor[0]
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                filename = f"holaf_remote_cmp_{prefix}_{random_id}.png"
                filepath = os.path.join(temp_dir, filename)
                
                img.save(filepath, compress_level=1)
                
                saved_media.append({
                    "filename": filename,
                    "subfolder": "",
                    "type": "temp",
                    "format": "image"
                })
            else:
                # Video/Animation Logic: Save as Sequence of Frames
                frames_meta =[]
                # Optimization: convert the whole batch to numpy uint8 at once
                frames_np = np.clip(255. * image_tensor.cpu().numpy(), 0, 255).astype(np.uint8)
                
                for idx, frame in enumerate(frames_np):
                    img = Image.fromarray(frame)
                    filename = f"holaf_remote_cmp_{prefix}_{random_id}_{idx:04d}.png"
                    filepath = os.path.join(temp_dir, filename)
                    
                    # compress_level=1 guarantees the fastest lossless saving time
                    img.save(filepath, compress_level=1)
                    
                    frames_meta.append({
                        "filename": filename,
                        "subfolder": "",
                        "type": "temp"
                    })
                
                saved_media.append({
                    "format": "video_frames",
                    "frames": frames_meta
                })

            return saved_media

        if image_1 is not None:
            ui_images.extend(save_preview(image_1, "A"))
            
        if image_2 is not None:
            ui_images.extend(save_preview(image_2, "B"))

        return {"ui": {"holaf_images": ui_images, "comparison_name":[comparison_name]}, "result": (image_1, image_2)}

# Expose the node to ComfyUI
NODE_CLASS_MAPPINGS = {
    "HolafRemoteComparer": HolafRemoteComparerNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "HolafRemoteComparer": "Remote Comparer (Holaf)"
}