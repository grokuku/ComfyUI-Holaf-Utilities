import os
import random
import string
import torch
import numpy as np
from PIL import Image
import folder_paths
import subprocess

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
    OUTPUT_NODE = True # Guarantees execution

    def compare(self, comparison_name="Comparison 1", image_1=None, image_2=None):
        ui_images =[]
        
        def save_preview(image_tensor, prefix):
            temp_dir = folder_paths.get_temp_directory()
            saved_media =[]
            
            # Check the batch size to determine if it's a single image or a video sequence
            B, H, W, C = image_tensor.shape
            random_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            
            if B == 1:
                # Single Image Logic
                image = image_tensor[0]
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                filename = f"holaf_remote_cmp_{prefix}_{random_id}.png"
                filepath = os.path.join(temp_dir, filename)
                
                img.save(filepath, compress_level=1) # Fast save
                
                saved_media.append({
                    "filename": filename,
                    "subfolder": "",
                    "type": "temp",
                    "format": "image"
                })
            else:
                # Video/Animation Logic (Batch > 1)
                filename = f"holaf_remote_cmp_{prefix}_{random_id}.mp4"
                filepath = os.path.join(temp_dir, filename)
                
                # Ensure width and height are even for yuv420p via ffmpeg pad filter
                cmd =[
                    'ffmpeg', '-y',
                    '-f', 'rawvideo',
                    '-vcodec', 'rawvideo',
                    '-s', f"{W}x{H}",
                    '-pix_fmt', 'rgb24',
                    '-r', '24', # Standard 24 fps
                    '-i', '-',
                    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-preset', 'fast',
                    '-crf', '23',
                    filepath
                ]
                
                frames = np.clip(255. * image_tensor.cpu().numpy(), 0, 255).astype(np.uint8)
                
                try:
                    # Pipe frames directly to ffmpeg to avoid saving massive temp disk files
                    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    for frame in frames:
                        process.stdin.write(frame.tobytes())
                    process.stdin.close()
                    process.wait()
                    
                    saved_media.append({
                        "filename": filename,
                        "subfolder": "",
                        "type": "temp",
                        "format": "video"
                    })
                except Exception as e:
                    print(f"[HolafRemoteComparer] FFmpeg encoding failed: {e}. Fallback to image.")
                    # Fallback: save first frame only if ffmpeg fails
                    img = Image.fromarray(frames[0])
                    filename_fallback = f"holaf_remote_cmp_{prefix}_{random_id}_fallback.png"
                    filepath_fallback = os.path.join(temp_dir, filename_fallback)
                    img.save(filepath_fallback, compress_level=1)
                    saved_media.append({
                        "filename": filename_fallback,
                        "subfolder": "",
                        "type": "temp",
                        "format": "image"
                    })

            return saved_media

        if image_1 is not None:
            ui_images.extend(save_preview(image_1, "A"))
            
        if image_2 is not None:
            ui_images.extend(save_preview(image_2, "B"))

        return {"ui": {"holaf_images": ui_images, "comparison_name": [comparison_name]}, "result": (image_1, image_2)}

# Expose the node to ComfyUI
NODE_CLASS_MAPPINGS = {
    "HolafRemoteComparer": HolafRemoteComparerNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "HolafRemoteComparer": "Remote Comparer (Holaf)"
}