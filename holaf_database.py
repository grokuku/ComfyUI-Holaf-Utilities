# === Holaf Utilities - Database Manager ===
import sqlite3
import os
import threading

# --- Constants ---
DB_NAME = "holaf_utilities.sqlite"
DB_DIR = os.path.dirname(__file__) # In the extension's root directory
DB_PATH = os.path.join(DB_DIR, DB_NAME)

# --- Thread-local storage for database connections ---
# Ensures each thread gets its own connection, important for SQLite with multiple threads.
local_data = threading.local()

def get_db_connection():
    """Gets or creates a thread-local database connection."""
    if not hasattr(local_data, 'connection') or local_data.connection is None:
        # print(f"🔵 [Holaf-DB-Debug] Thread {threading.get_ident()}: Creating new DB connection.") # DEBUG
        try:
            # Ensure the directory exists before trying to connect, crucial for first run
            if not os.path.exists(DB_DIR):
                os.makedirs(DB_DIR, exist_ok=True)

            local_data.connection = sqlite3.connect(DB_PATH, timeout=10)
            local_data.connection.row_factory = sqlite3.Row
            local_data.connection.execute("PRAGMA journal_mode=WAL;")
            local_data.connection.execute("PRAGMA foreign_keys = ON;") # Good practice
            local_data.connection.execute("PRAGMA busy_timeout = 7500;") # Increased timeout
        except sqlite3.Error as e:
            print(f"🔴 [Holaf-DB] Thread {threading.get_ident()}: Error connecting to database at {DB_PATH}: {e}")
            local_data.connection = None # Ensure it's None if connection failed
            raise # Re-raise the exception so the caller knows connection failed
    # else: # DEBUG
        # print(f"🔵 [Holaf-DB-Debug] Thread {threading.get_ident()}: Reusing existing DB connection.") # DEBUG
    return local_data.connection

def close_db_connection(exception=None):
    """Closes the thread-local database connection if it exists."""
    # print(f"🔵 [Holaf-DB-Debug] Thread {threading.get_ident()}: close_db_connection called. Exception: {exception}") # DEBUG
    if hasattr(local_data, 'connection') and local_data.connection is not None:
        if exception: # If an exception occurred, rollback before closing
            # print(f"🟡 [Holaf-DB-Debug] Thread {threading.get_ident()}: Rolling back due to exception: {exception}") # DEBUG
            local_data.connection.rollback()
        # else: # DEBUG
            # print(f"🔵 [Holaf-DB-Debug] Thread {threading.get_ident()}: Committing before close (if any uncommitted changes).") # DEBUG
            # local_data.connection.commit() # Usually commit is explicit, but good for safety
        local_data.connection.close()
        local_data.connection = None
        # print(f"🔵 [Holaf-DB-Debug] Thread {threading.get_ident()}: DB Connection closed.") # DEBUG


# --- Database Initialization and Schema Management ---
def init_database():
    """Initializes the database and creates tables if they don't exist."""
    print("🔵 [Holaf-DB] Initializing database...")
    conn = None # Will be managed by get_db_connection and an explicit close
    try:
        conn = get_db_connection() # Gets or creates thread-local connection
        cursor = conn.cursor()

        # --- Base Table Version ---
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS holaf_db_version (
                version INTEGER PRIMARY KEY
            )
        """)
        # Important: Commit DDL changes like CREATE TABLE immediately
        conn.commit()

        cursor.execute("SELECT version FROM holaf_db_version")
        db_version_row = cursor.fetchone()
        current_db_version = db_version_row[0] if db_version_row else 0
        latest_schema_version = 3 # Increment this when schema changes

        if current_db_version < latest_schema_version:
            print(f"  > DB version: {current_db_version}, Latest schema: {latest_schema_version}. Upgrading...")
            _apply_schema_migrations(cursor, current_db_version, latest_schema_version)
            # Migrations should handle their own commits if they involve multiple DDL/DML statements
            # or the main commit after _apply_schema_migrations will cover it.
            cursor.execute("DELETE FROM holaf_db_version") # Clear old version
            cursor.execute("INSERT INTO holaf_db_version (version) VALUES (?)", (latest_schema_version,))
            conn.commit() # Commit version update
            print(f"  > DB upgraded to version {latest_schema_version}.")
        else:
            print(f"  > Database schema is up to date (version {current_db_version}).")

    except sqlite3.Error as e:
        print(f"🔴 [Holaf-DB] SQLite error during init: {e}")
        # conn.rollback() is handled by close_db_connection if an exception is passed
    except Exception as e:
        print(f"🔴 [Holaf-DB] General error during init: {e}")
    finally:
        # The connection used by init_database (which is thread-local for the main thread at startup)
        # should remain open if other startup tasks in the same thread need it.
        # It will be closed eventually when the ComfyUI server stops or by individual request handlers.
        # However, for this specific init function, if it's truly standalone, we could close.
        # But given it's called at startup, let's assume the main thread might do more DB work.
        # If no other startup tasks use DB, then: close_db_connection()
        pass


def _apply_schema_migrations(cursor, current_version, target_version):
    """Applies database schema migrations sequentially.
       The calling function is responsible for committing after this function returns.
    """
    conn = cursor.connection # Get the connection from the cursor

    if current_version < 1 <= target_version:
        print("  Applying schema version 1...")
        # Model Manager: Models Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path_canon TEXT NOT NULL UNIQUE,
                type TEXT,
                family TEXT,
                size_bytes INTEGER,
                sha256 TEXT,
                description TEXT,
                tags TEXT,
                metadata_json TEXT,
                last_scanned_at REAL,
                created_at REAL,
                notes TEXT,
                is_user_managed BOOLEAN DEFAULT 0,
                is_disabled BOOLEAN DEFAULT 0,
                download_url TEXT,
                cover_image_path TEXT,
                remote_source TEXT,
                local_mtime REAL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_models_type ON models(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_models_family ON models(family)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_models_path_canon ON models(path_canon)")
        # conn.commit() # Commit after each version's DDL if necessary, or once at the end.
        current_version = 1

    if current_version < 2 <= target_version:
        print("  Applying schema version 2...")
        # Image Viewer: Images Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                subfolder TEXT,
                path_canon TEXT NOT NULL UNIQUE, -- relative to output_dir, e.g., "foo/bar.png" or "my_image.png"
                format TEXT, -- e.g., PNG, JPEG
                width INTEGER,
                height INTEGER,
                aspect_ratio_str TEXT,
                size_bytes INTEGER,
                mtime REAL, -- last modification time
                prompt_text TEXT,
                workflow_json TEXT,
                last_synced_at REAL,
                thumbnail_status INTEGER DEFAULT 0, -- 0: New/Retry, 1: Prioritized, 2: Done, 3: Error
                thumbnail_priority_score INTEGER DEFAULT 1000, -- Lower is higher priority
                thumbnail_last_generated_at REAL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_path_canon ON images(path_canon)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_subfolder ON images(subfolder)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_mtime ON images(mtime)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_thumb_status_priority ON images(thumbnail_status, thumbnail_priority_score)")
        # conn.commit()
        current_version = 2

    if current_version < 3 <= target_version:
        print("  Applying schema version 3 (Image Viewer Trash)...")
        # Check if columns exist before trying to add them - robust against re-runs
        cursor.execute("PRAGMA table_info(images)")
        columns = [row['name'] for row in cursor.fetchall()]

        if 'is_trashed' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN is_trashed BOOLEAN DEFAULT 0")
        if 'original_path_canon' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN original_path_canon TEXT")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_is_trashed ON images(is_trashed)")
        # conn.commit()
        current_version = 3

    if current_version != target_version:
        raise Exception(f"DB Migration Error: Reached version {current_version} but expected {target_version}.")

    # The main commit will happen in init_database after this function returns and version is updated.


if __name__ == '__main__':
    # For testing the database initialization directly
    print(f"Attempting to initialize database at: {DB_PATH}")
    # get_db_connection() now handles directory creation if it doesn't exist.
    init_database() # This will use get_db_connection
    conn_test = None
    try:
        conn_test = get_db_connection()
        if conn_test:
            print("Database connection successful (thread-local).")
            cursor_test = conn_test.cursor()
            cursor_test.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor_test.fetchall()
            print("Tables in database:", [table[0] for table in tables])

            # Test schema version 3 columns
            cursor_test.execute("PRAGMA table_info(images)")
            columns_info = cursor_test.fetchall()
            column_names = [col_info['name'] for col_info in columns_info]
            print("Columns in 'images' table:", column_names)
            assert 'is_trashed' in column_names, "Column 'is_trashed' missing!"
            assert 'original_path_canon' in column_names, "Column 'original_path_canon' missing!"
            print("Schema version 3 columns confirmed.")

        else:
            print("Failed to get database connection.")
    except Exception as e:
        print(f"Error during __main__ test: {e}")
    finally:
        if conn_test: # conn_test would be the thread-local connection
            close_db_connection() # Close the connection for this thread
            print("Test connection closed.")