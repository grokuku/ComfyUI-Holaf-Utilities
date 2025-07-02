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

        # --- MODIFICATION START ---
        # Ensure base tables exist *before* versioning logic. This is robust.
        # This will create tables if they are missing, even in an existing DB file.
        print("  > Verifying base table schema...")
        
        # Base Table Version
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS holaf_db_version (
                version INTEGER PRIMARY KEY
            )
        """)

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
                prompt_source TEXT,
                workflow_source TEXT,
                last_synced_at REAL,
                thumbnail_status INTEGER DEFAULT 0, -- 0: New/Retry, 1: Prioritized, 2: Done, 3: Error
                thumbnail_priority_score INTEGER DEFAULT 1000, -- Lower is higher priority
                has_edit_file BOOLEAN DEFAULT 0,
                thumbnail_last_generated_at REAL
            )
        """)
        conn.commit() # Commit schema creations immediately
        print("  > Base schema verified.")
        # --- MODIFICATION END ---


        cursor.execute("SELECT version FROM holaf_db_version")
        db_version_row = cursor.fetchone()
        current_db_version = db_version_row[0] if db_version_row else 0
        latest_schema_version = 5 # Increment this when schema changes

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
        pass


def _apply_schema_migrations(cursor, current_version, target_version):
    """
    Applies database schema migrations sequentially.
    The calling function is responsible for committing after this function returns.
    NOTE: Table CREATION is now handled in init_database for robustness. 
          This function should primarily handle ALTER TABLE or data migration.
    """
    conn = cursor.connection # Get the connection from the cursor

    # The schema for versions 1 and 2 (table creation) has been moved to init_database().
    # This function now only needs to apply changes to *existing* tables.
    if current_version < 1 <= target_version:
        print("  Applying schema version 1 (Base models table)...")
        # No actions needed here anymore as CREATE is handled above.
        current_version = 1

    if current_version < 2 <= target_version:
        print("  Applying schema version 2 (Base images table)...")
        # No actions needed here anymore as CREATE is handled above.
        current_version = 2

    if current_version < 3 <= target_version:
        print("  Applying schema version 3 (Image Viewer Trash)...")
        # Check if columns exist before trying to add them - robust against re-runs
        cursor.execute("PRAGMA table_info(images)")
        columns = [row['name'] for row in cursor.fetchall()]

        if 'is_trashed' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN is_trashed BOOLEAN DEFAULT 0")
            print("    > Added 'is_trashed' column to 'images' table.")
        if 'original_path_canon' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN original_path_canon TEXT")
            print("    > Added 'original_path_canon' column to 'images' table.")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_is_trashed ON images(is_trashed)")
        # conn.commit() # Commit is handled by the calling function.
        current_version = 3

    if current_version < 4 <= target_version:
        print("  Applying schema version 4 (Image Viewer Metadata Sources)...")
        cursor.execute("PRAGMA table_info(images)")
        columns = [row['name'] for row in cursor.fetchall()]
        if 'prompt_source' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN prompt_source TEXT")
            print("    > Added 'prompt_source' column to 'images' table.")
        if 'workflow_source' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN workflow_source TEXT")
            print("    > Added 'workflow_source' column to 'images' table.")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_workflow_source ON images(workflow_source)")
        current_version = 4

    if current_version < 5 <= target_version:
        print("  Applying schema version 5 (Image Viewer Edit Files)...")
        cursor.execute("PRAGMA table_info(images)")
        columns = [row['name'] for row in cursor.fetchall()]
        if 'has_edit_file' not in columns:
            cursor.execute("ALTER TABLE images ADD COLUMN has_edit_file BOOLEAN DEFAULT 0")
            print("    > Added 'has_edit_file' column to 'images' table.")
        current_version = 5

    if current_version != target_version:
        # This check is now less critical for table creation but good for migration integrity.
        print(f"🟡 [Holaf-DB] Warning: Migration ended at version {current_version}, target was {target_version}.")

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
            assert 'models' in [t[0] for t in tables], "FAILURE: 'models' table was not created."
            assert 'images' in [t[0] for t in tables], "FAILURE: 'images' table was not created."
            print("✅ All required tables are present.")

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