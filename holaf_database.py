# === Holaf Utilities - Database Manager ===
import sqlite3
import os
import traceback

SHARED_DB_PATH = os.path.join(os.path.dirname(__file__), 'holaf_utilities.sqlite3')

def get_db_connection():
    conn = sqlite3.connect(SHARED_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('''
        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            model_type_key TEXT NOT NULL,
            display_type TEXT,
            model_family TEXT,
            size_bytes INTEGER,
            is_directory BOOLEAN DEFAULT 0,
            discovered_at REAL DEFAULT (STRFTIME('%s', 'now')),
            last_scanned_at REAL,
            sha256_hash TEXT,
            extracted_metadata_json TEXT,
            parsed_tags TEXT,
            parsed_trigger_words TEXT,
            parsed_base_model TEXT,
            parsed_resolution TEXT,
            last_deep_scanned_at REAL,
            CONSTRAINT uq_path UNIQUE (path)
        )
        ''')
        
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            subfolder TEXT,
            path_canon TEXT NOT NULL UNIQUE,
            format TEXT NOT NULL,
            mtime REAL NOT NULL,
            size_bytes INTEGER NOT NULL,
            last_synced_at REAL
        )
        ''')
        
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_subfolder ON images(subfolder)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_format ON images(format)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_mtime ON images(mtime)")
        
        conn.commit()

        def add_column_if_not_exists(table, col_name, col_type):
            cursor.execute(f"PRAGMA table_info({table})")
            columns = {info[1] for info in cursor.fetchall()}
            if col_name not in columns:
                try:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
                    conn.commit()
                    print(f"  [Holaf-DB] Added '{col_name}' column to '{table}' table.")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e).lower():
                        print(f"  [Holaf-DB] Column '{col_name}' already exists in '{table}'.")
                    else:
                        raise e
        
        add_column_if_not_exists('models', 'model_family', 'TEXT')
        add_column_if_not_exists('models', 'sha256_hash', 'TEXT')
        add_column_if_not_exists('models', 'extracted_metadata_json', 'TEXT')
        add_column_if_not_exists('models', 'parsed_tags', 'TEXT')
        add_column_if_not_exists('models', 'parsed_trigger_words', 'TEXT')
        add_column_if_not_exists('models', 'parsed_base_model', 'TEXT')
        add_column_if_not_exists('models', 'parsed_resolution', 'TEXT')
        add_column_if_not_exists('models', 'last_deep_scanned_at', 'REAL')
        
        print("✅ [Holaf-DB] Shared database initialized/verified successfully.")

    except sqlite3.Error as e:
        print(f"🔴 [Holaf-Utilities] CRITICAL: Shared database initialization error: {e}")
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("🛠️  Initializing Holaf Utilities database directly...")
    init_database()
    print("✅ Database initialization process complete.")