import sqlite3
import json
import time
import threading
from .holaf_user_data_manager import UserDataManager

class ProfilerDatabase:
    def __init__(self):
        self.db_path = UserDataManager.get_profiler_db_path()
        self._local = threading.local()
        self._init_db()

    def _get_connection(self):
        """Gets or creates a thread-local database connection."""
        if not hasattr(self._local, 'connection') or self._local.connection is None:
            conn = sqlite3.connect(self.db_path, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA busy_timeout = 30000;")
            self._local.connection = conn
        return self._local.connection

    def _close_connection(self):
        """Closes the thread-local connection if it exists."""
        if hasattr(self._local, 'connection') and self._local.connection is not None:
            self._local.connection.close()
            self._local.connection = None

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()

        # 1. Runs Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiler_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                name TEXT,
                workflow_hash TEXT,
                global_comment TEXT,
                total_time REAL
            )
        ''')

        # 2. Steps Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiler_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER,
                node_id TEXT,
                node_title TEXT,
                node_type TEXT,
                vram_start INTEGER,
                vram_max INTEGER,
                vram_end INTEGER,
                exec_time REAL,
                cpu_max REAL,
                gpu_load_max REAL,
                gpu_load_avg REAL,
                inputs_json TEXT,
                step_comment TEXT,
                FOREIGN KEY(run_id) REFERENCES profiler_runs(id) ON DELETE CASCADE
            )
        ''')

        # 3. Groups Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiler_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                color TEXT,
                description TEXT
            )
        ''')

        # 4. Group Members Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiler_group_members (
                group_id INTEGER,
                node_id TEXT,
                FOREIGN KEY(group_id) REFERENCES profiler_groups(id) ON DELETE CASCADE,
                UNIQUE(group_id, node_id)
            )
        ''')

        conn.commit()
        self._close_connection()

    def create_run(self, name, workflow_hash, comment=""):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO profiler_runs (name, workflow_hash, global_comment, timestamp) VALUES (?, ?, ?, ?)",
            (name, workflow_hash, comment, time.time())
        )
        run_id = cursor.lastrowid
        conn.commit()
        self._close_connection()
        return run_id

    def add_step(self, run_id, node_id, node_title, node_type, vram_start, vram_max, vram_end, exec_time, cpu_max, gpu_load_max, gpu_load_avg, inputs_json, step_comment=""):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO profiler_steps (
                run_id, node_id, node_title, node_type, 
                vram_start, vram_max, vram_end, 
                exec_time, cpu_max, gpu_load_max, gpu_load_avg, 
                inputs_json, step_comment
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            run_id, node_id, node_title, node_type,
            vram_start, vram_max, vram_end,
            exec_time, cpu_max, gpu_load_max, gpu_load_avg,
            inputs_json, step_comment
        ))
        conn.commit()
        self._close_connection()

    def get_run_steps(self, run_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM profiler_steps WHERE run_id = ? ORDER BY id ASC", (run_id,))
        rows = cursor.fetchall()
        self._close_connection()
        return [dict(row) for row in rows]