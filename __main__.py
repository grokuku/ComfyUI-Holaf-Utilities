# === Holaf Terminal Password Utility ===
#
# This script is used to generate a secure password hash for use in config.ini.
# It uses PBKDF2 with a random salt, which is a strong, standard practice for
# password storage.
#
# HOW TO USE:
# 1. Navigate to your ComfyUI root directory in a terminal.
# 2. Make sure your Python virtual environment is activated.
# 3. Run the script using the following command:
#    python -m custom_nodes.ComfyUI-Holaf-Terminal
# 4. The script will securely prompt you to enter and confirm a password.
# 5. It will then print a hash string. Copy this entire string.
# 6. Paste it into your `config.ini` file under the [Security] section,
#    for the `password_hash` option.
#
# Example `config.ini` entry:
# [Security]
# password_hash = 6e36...a1c3$b5a7...d9f4
#
import hashlib
import os
import getpass

def generate_password_hash():
    """Securely prompts for a password and generates a salted hash."""
    print("--- Holaf Terminal Password Setup ---")
    print("This will generate a secure hash for your config.ini file.")
    
    try:
        password = getpass.getpass("Enter new password: ")
        if not password:
            print("\n🔴 Password cannot be empty. Aborting.")
            return

        password_confirm = getpass.getpass("Confirm new password: ")
        if password != password_confirm:
            print("\n🔴 Passwords do not match. Aborting.")
            return

    except (EOFError, KeyboardInterrupt):
        print("\nOperation cancelled.")
        return

    # Generate a random salt
    salt = os.urandom(16)
    
    # Hash the password using PBKDF2
    # PBKDF2 is recommended for password hashing as it is slow by design
    iterations = 260000
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    
    # Store the salt and hash together, separated by a '$'
    # This format makes it easy to verify later.
    stored_hash = f"{salt.hex()}${dk.hex()}"
    
    print("\n✅ Password hash generated successfully.")
    print("="*40)
    print("Copy the following line into your config.ini file under [Security]:")
    print(f"password_hash = {stored_hash}")
    print("="*40)
    print("\nIf the file doesn't exist, create 'config.ini' in the 'ComfyUI-Holaf-Terminal' directory.")

if __name__ == "__main__":
    generate_password_hash()