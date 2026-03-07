import os
import random
import string
import torch
import numpy as np
from PIL import Image
import folder_paths
import subprocess

def get_ffmpeg_encoder():
    """Vérifie si le GPU Nvidia (nvenc) est disponible pour un encodage instantané"""
    try:
        res = subprocess.run(['ffmpeg', '-encoders'], capture_output=True, text=True, timeout=2)
        if 'h264_nvenc' in res.stdout:
            return 'h264_nvenc'
    except Exception:
        pass
    return 'libx264'

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
        encoder = get_ffmpeg_encoder()
        
        def save_preview(image_tensor, prefix):
            temp_dir = folder_paths.get_temp_directory()
            saved_media =[]
            
            B, H, W, C = image_tensor.shape
            random_id = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            
            if B == 1:
                # Single Image
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
                # High-Speed Video Encoding (GPU NVENC or CPU Ultrafast)
                filename = f"holaf_remote_cmp_{prefix}_{random_id}.mp4"
                filepath = os.path.join(temp_dir, filename)
                
                cmd =[
                    'ffmpeg', '-y',
                    '-f', 'rawvideo',
                    '-vcodec', 'rawvideo',
                    '-s', f"{W}x{H}",
                    '-pix_fmt', 'rgb24',
                    '-r', '24', # Standard timeline baserate
                    '-i', '-',
                    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
                ]
                
                if encoder == 'h264_nvenc':
                    # High quality, extremely fast GPU encoding
                    cmd.extend(['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '15', '-b:v', '0'])
                else:
                    # High quality, extremely fast CPU encoding
                    cmd.extend(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '15'])
                    
                cmd.extend(['-pix_fmt', 'yuv420p', filepath])
                
                # Convert to byte array
                frames = np.clip(255. * image_tensor.cpu().numpy(), 0, 255).astype(np.uint8)
                
                try:
                    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    # communicate() pushes everything at once and closes the pipe cleanly (avoids deadlocks)
                    process.communicate(input=frames.tobytes())
                    
                    saved_media.append({
                        "filename": filename,
                        "subfolder": "",
                        "type": "temp",
                        "format": "video"
                    })
                except Exception as e:
                    print(f"[HolafRemoteComparer] FFmpeg encoding failed: {e}. Fallback to image.")
                    img = Image.fromarray(frames[0])
                    filename_fb = f"holaf_remote_cmp_{prefix}_{random_id}_fb.png"
                    filepath_fb = os.path.join(temp_dir, filename_fb)
                    img.save(filepath_fb, compress_level=1)
                    saved_media.append({
                        "filename": filename_fb, "subfolder": "", "type": "temp", "format": "image"
                    })

            return saved_media

        if image_1 is not None:
            ui_images.extend(save_preview(image_1, "A"))
        if image_2 is not None:
            ui_images.extend(save_preview(image_2, "B"))

        return {"ui": {"holaf_images": ui_images, "comparison_name":[comparison_name]}, "result": (image_1, image_2)}

NODE_CLASS_MAPPINGS = {"HolafRemoteComparer": HolafRemoteComparerNode}
NODE_DISPLAY_NAME_MAPPINGS = {"HolafRemoteComparer": "Remote Comparer (Holaf)"}