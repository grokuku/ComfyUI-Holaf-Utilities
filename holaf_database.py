# === Holaf Utilities - Database Manager ===
import sqlite3
import os
import threading
import shutil # For renaming the database file
import time   # For timestamping the backup
import hashlib # Required for migration logic

# --- Constants ---
DB_NAME = "holaf_utilities.sqlite"
DB_DIR = os.path.dirname(__file__) # In the extension's root directory
DB_PATH = os.path.join(DB_DIR, DB_NAME)
# --- SINGLE SOURCE OF TRUTH FOR DB SCHEMA ---
# Increment this number whenever you make a change to the table structures below.
LATEST_SCHEMA_VERSION = 12

# --- Thread-local storage for database connections ---
# Ensures each thread gets its own connection, important for SQLite with multiple threads.
local_data = threading.local()

def get_db_connection():
    """Gets or creates a thread-local database connection."""
    if not hasattr(local_data, 'connection') or local_data.connection is None:
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
    return local_data.connection

def close_db_connection(exception=None):
    """Closes the thread-local database connection if it exists."""
    if hasattr(local_data, 'connection') and local_data.connection is not None:
        if exception: # If an exception occurred, rollback before closing
            local_data.connection.rollback()
        local_data.connection.close()
        local_data.connection = None


# --- Schema Creation and Migration ---

def _create_fresh_schema(cursor):
    """Creates all tables for a new, empty database with the latest schema."""
    print(f"  > Creating fresh database schema (Version {LATEST_SCHEMA_VERSION})...")

    # Version Table
    cursor.execute("CREATE TABLE holaf_db_version (version INTEGER PRIMARY KEY)")

    # Model Manager: Models Table
    cursor.execute("""
        CREATE TABLE models (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, path_canon TEXT NOT NULL UNIQUE,
            type TEXT, family TEXT, size_bytes INTEGER, sha256 TEXT, description TEXT, tags TEXT,
            metadata_json TEXT, last_scanned_at REAL, created_at REAL, notes TEXT,
            is_user_managed BOOLEAN DEFAULT 0, is_disabled BOOLEAN DEFAULT 0, download_url TEXT,
            cover_image_path TEXT, remote_source TEXT, local_mtime REAL
        )
    """)

    # Image Viewer: Images Table (with all columns up to the latest version)
    # Version 10: Added thumb_hash
    cursor.execute("""
        CREATE TABLE images (
            id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, subfolder TEXT,
            top_level_subfolder TEXT,
            path_canon TEXT NOT NULL UNIQUE, format TEXT, width INTEGER, height INTEGER,
            aspect_ratio_str TEXT, size_bytes INTEGER, mtime REAL, prompt_text TEXT,
            workflow_json TEXT, last_synced_at REAL, thumbnail_status INTEGER DEFAULT 0,
            thumbnail_priority_score INTEGER DEFAULT 1000, thumbnail_last_generated_at REAL,
            is_trashed BOOLEAN DEFAULT 0, original_path_canon TEXT, prompt_source TEXT,
            workflow_source TEXT, has_edit_file BOOLEAN DEFAULT 0,
            thumb_hash TEXT,
            -- NEW in v12: Boolean flags for performant sidecar filtering --
            has_workflow BOOLEAN NOT NULL DEFAULT 0,
            has_prompt BOOLEAN NOT NULL DEFAULT 0,
            has_edits BOOLEAN NOT NULL DEFAULT 0,
            has_tags BOOLEAN NOT NULL DEFAULT 0
        )
    """)
    
    # Image Viewer: Tags Table (NEW in v11)
    cursor.execute("""
        CREATE TABLE tags (
            tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    """)

    # Image Viewer: Image-Tag Link Table (NEW in v11)
    cursor.execute("""
        CREATE TABLE imagetags (
            image_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (image_id, tag_id),
            FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags (tag_id) ON DELETE CASCADE
        )
    """)

    # Image Viewer: Folder Metadata Cache Table
    cursor.execute("""
        CREATE TABLE folder_metadata (
            path_canon TEXT PRIMARY KEY NOT NULL, -- e.g., 'sub/folder' or 'root'
            image_count INTEGER NOT NULL DEFAULT 0,
            last_calculated_at REAL
        )
    """)

    # Indices for performance
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_is_trashed ON images(is_trashed)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_workflow_source ON images(workflow_source)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename)")
    # --- MODIFICATION: Replace individual indexes with a more powerful composite index ---
    # This index is critical for speeding up queries that filter by folder and order by date.
    # Composite index for gallery filtering/sorting
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_top_level_subfolder_mtime ON images(top_level_subfolder, mtime)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_mtime ON images(mtime)")
    
    # Index for thumb_hash to speed up orphan cleanup
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_thumb_hash ON images(thumb_hash)")

    # Indices for Tagging System (NEW in v11)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_imagetags_image_id ON imagetags(image_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_imagetags_tag_id ON imagetags(tag_id)")

    # Indices for Boolean Flags (NEW in v12)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_has_workflow ON images(has_workflow)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_has_prompt ON images(has_prompt)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_has_edits ON images(has_edits)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_has_tags ON images(has_tags)")

    # Set the version in the new table
    cursor.execute("INSERT INTO holaf_db_version (version) VALUES (?)", (LATEST_SCHEMA_VERSION,))
    print("  > Schema creation complete.")


def _migrate_database_by_copy(current_db_version):
    """
    Performs database migration by renaming the old DB, creating a new one,
    and safely transferring existing data.
    """
    print(f"  > Starting database migration from v{current_db_version} to v{LATEST_SCHEMA_VERSION}...")
    close_db_connection() # Ensure all connections to the old DB are closed

    # 1. Rename old database to create a backup
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = f"{DB_PATH}.backup_v{current_db_version}_{timestamp}"
    try:
        shutil.move(DB_PATH, backup_path)
        print(f"  > Backed up old database to: {os.path.basename(backup_path)}")
    except Exception as e:
        print(f"🔴 [Holaf-DB] CRITICAL: Could not backup database file. Migration aborted. Error: {e}")
        raise Exception("Database backup failed. Cannot proceed with migration.")

    # 2. Create a new database with the fresh schema
    conn = None
    try:
        # get_db_connection will now create and connect to the new empty DB file at DB_PATH
        conn = get_db_connection()
        cursor = conn.cursor()
        _create_fresh_schema(cursor)
        conn.commit()
        print("  > New database created with the latest schema.")

        # 3. Attach the old database and transfer data
        print("  > Attaching old database to transfer data...")
        cursor.execute(f"ATTACH DATABASE ? AS old_db", (backup_path,))

        def get_columns(c, table_name, db_name="main"):
            c.execute(f"PRAGMA {db_name}.table_info({table_name})")
            return {row['name'] for row in c.fetchall()}

        # Transfer data for 'models' table
        try:
            old_models_cols = get_columns(cursor, 'models', 'old_db')
            new_models_cols = get_columns(cursor, 'models', 'main')
            common_cols = list(old_models_cols.intersection(new_models_cols))
            if common_cols:
                cols_str = ", ".join(f'"{col}"' for col in common_cols)
                cursor.execute(f"INSERT INTO main.models ({cols_str}) SELECT {cols_str} FROM old_db.models")
                print(f"    > Transferred {cursor.rowcount} rows to 'models' table.")
        except sqlite3.OperationalError:
             print("    > 'models' table not found in old database. Skipping.")
        except Exception as e:
            print(f"🟡 [Holaf-DB] Warning: Could not transfer data from 'models' table. Error: {e}")

        # Transfer data for 'images' table
        try:
            old_images_cols = get_columns(cursor, 'images', 'old_db')
            new_images_cols = get_columns(cursor, 'images', 'main')
            common_cols = list(old_images_cols.intersection(new_images_cols))
            
            # Filter out columns that we want to re-populate or that might conflict if logic changed
            # top_level_subfolder is handled manually below
            if 'top_level_subfolder' in common_cols:
                 common_cols.remove('top_level_subfolder') 
            
            # thumb_hash is new, so it won't be in common_cols yet
            if 'thumb_hash' in common_cols:
                 common_cols.remove('thumb_hash')

            if common_cols:
                cols_str = ", ".join(f'"{col}"' for col in common_cols)
                # The new boolean columns in `main.images` will get their default value (0) for all transferred rows.
                cursor.execute(f"INSERT INTO main.images ({cols_str}) SELECT {cols_str} FROM old_db.images")
                print(f"    > Transferred {cursor.rowcount} rows to 'images' table.")
                
                # Populate the top_level_subfolder column for existing images
                print("    > Populating 'top_level_subfolder' column for existing images...")
                cursor.execute("""
                    UPDATE images
                    SET top_level_subfolder = CASE
                        WHEN subfolder = '' OR subfolder IS NULL THEN 'root'
                        WHEN INSTR(subfolder, '/') > 0 THEN SUBSTR(subfolder, 1, INSTR(subfolder, '/') - 1)
                        ELSE subfolder
                    END
                """)
                print(f"      ... Done. {cursor.rowcount} rows updated.")

                # Populate the thumb_hash column for existing images
                print("    > Backfilling 'thumb_hash' column based on path_canon...")
                cursor.execute("SELECT id, path_canon FROM images")
                rows = cursor.fetchall()
                updates = []
                for row in rows:
                    if row['path_canon']:
                        # Calculate SHA1 hash of the canonical path, same logic as worker.py
                        h = hashlib.sha1(row['path_canon'].encode('utf-8')).hexdigest()
                        updates.append((h, row['id']))
                
                if updates:
                    cursor.executemany("UPDATE images SET thumb_hash = ? WHERE id = ?", updates)
                    print(f"      ... Done. {len(updates)} thumb_hashes generated.")

        except sqlite3.OperationalError:
            print("    > 'images' table not found in old database. Skipping.")
        except Exception as e:
            print(f"🟡 [Holaf-DB] Warning: Could not transfer data from 'images' table. Error: {e}")

        # folder_metadata, tags, and imagetags are new, so no data to transfer.

        # 4. Finalize
        conn.commit()
        cursor.execute("DETACH DATABASE old_db")
        print("  > Data transfer complete. Migration successful.")

    except Exception as e:
        print(f"🔴 [Holaf-DB] CRITICAL: An error occurred during migration: {e}")
        close_db_connection()
        try:
            # Preserve the failed new DB and restore the backup for user inspection
            os.rename(DB_PATH, f"{DB_PATH}.failed_migration_{timestamp}")
            print(f"    ! Moved potentially corrupt new DB to: {os.path.basename(DB_PATH)}.failed_migration_{timestamp}")
            shutil.move(backup_path, DB_PATH)
            print(f"    ! Restored original database from backup. The application can restart with the old DB.")
        except Exception as restore_e:
            print(f"    ! FAILED TO RESTORE BACKUP. Manual intervention required. Backup is at: {backup_path}")
        raise # Re-raise the original exception to halt execution
    finally:
        if conn:
            close_db_connection()


def init_database():
    """
    Initializes the database. Creates it if it doesn't exist, or migrates it
    to the latest version if it's outdated.
    """
    print("🔵 [Holaf-DB] Checking database status...")

    if not os.path.exists(DB_PATH):
        print("  > Database file not found. Creating a new one.")
        conn = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            _create_fresh_schema(cursor)
            conn.commit()
            print("✅ [Holaf-DB] New database created successfully.")
        except Exception as e:
            print(f"🔴 [Holaf-DB] Failed to create new database: {e}")
        finally:
            if conn:
                close_db_connection()
        return

    # If DB exists, check its version.
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        current_db_version = 0
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='holaf_db_version'")
            if cursor.fetchone():
                cursor.execute("SELECT version FROM holaf_db_version")
                db_version_row = cursor.fetchone()
                current_db_version = db_version_row[0] if db_version_row else 0
            else:
                print("  > 'holaf_db_version' table not found. Assuming legacy version 0.")
                current_db_version = 0
        except sqlite3.Error as e:
            print(f"  > Could not read DB version, assuming version 0. Error: {e}")
            current_db_version = 0

        if current_db_version < LATEST_SCHEMA_VERSION:
            print(f"  > Database is outdated (v{current_db_version}). Required version is v{LATEST_SCHEMA_VERSION}.")
            close_db_connection() # Close connection before migrating
            _migrate_database_by_copy(current_db_version)
            print("✅ [Holaf-DB] Database migration process complete.")
        elif current_db_version > LATEST_SCHEMA_VERSION:
            print(f"🟡 [Holaf-DB] Warning: Database version (v{current_db_version}) is newer than the code's schema version (v{LATEST_SCHEMA_VERSION}).")
            print("    This can happen after downgrading the extension. Some features may not work correctly.")
        else:
            print(f"  > Database schema is up to date (version {current_db_version}).")

    except Exception as e:
        print(f"🔴 [Holaf-DB] An error occurred during database initialization: {e}")
        # traceback.print_exc()
    finally:
        if hasattr(local_data, 'connection') and local_data.connection is not None:
             close_db_connection()


if __name__ == '__main__':
    print(f"Attempting to initialize database at: {DB_PATH}")
    # To test creation/migration, manually remove or place an old DB file here.
    init_database()
    conn_test = None
    try:
        conn_test = get_db_connection()
        if conn_test:
            print("\n--- Verification ---")
            print("Database connection successful.")
            cursor_test = conn_test.cursor()

            cursor_test.execute("SELECT version FROM holaf_db_version")
            version = cursor_test.fetchone()[0]
            print(f"DB Version in table: {version}")
            assert version == LATEST_SCHEMA_VERSION, "Version in DB does not match latest schema version!"

            cursor_test.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [table[0] for table in cursor_test.fetchall()]
            print("Tables in database:", tables)
            expected_tables = ['holaf_db_version', 'models', 'images', 'folder_metadata', 'tags', 'imagetags']
            for table in expected_tables:
                 assert table in tables, f"FAILURE: '{table}' table was not created."
            print("✅ All required tables are present.")
            
            # Verify new columns/indexes
            cursor_test.execute("PRAGMA table_info(images)")
            cols = [col['name'] for col in cursor_test.fetchall()]
            print("Columns in images:", cols)
            assert 'thumb_hash' in cols, "CRITICAL: thumb_hash column missing!"

            cursor_test.execute("PRAGMA index_list(images)")
            indexes = [idx['name'] for idx in cursor_test.fetchall()]
            print("Indexes on 'images' table:", indexes)
            assert 'idx_images_top_level_subfolder_mtime' in indexes, "CRITICAL: Composite index was not created!"
            assert 'idx_images_thumb_hash' in indexes, "CRITICAL: thumb_hash index was not created!"
            assert 'idx_images_has_workflow' in indexes, "CRITICAL: 'has_workflow' index was not created!"
            print("✅ All required indexes are present.")


        else:
            print("Failed to get database connection.")
    except Exception as e:
        print(f"Error during __main__ test: {e}")
    finally:
        if conn_test:
            close_db_connection()
            print("Test connection closed.")