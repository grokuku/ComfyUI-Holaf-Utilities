# === Holaf Utilities - Image Viewer API Routes (Image Listing) ===
import json
import time
import datetime
import traceback
from collections import defaultdict

from aiohttp import web

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database

# --- API Route Handlers ---
async def get_filter_options_route(request: web.Request):
    conn = None
    # --- MODIFICATION: Added 'tags' to the response ---
    response_data = {"subfolders": [], "formats": [], "tags": [], "last_update_time": logic.LAST_DB_UPDATE_TIME}
    error_status = 500
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT top_level_subfolder, COUNT(*) as image_count 
            FROM images 
            WHERE is_trashed = 0 
            GROUP BY top_level_subfolder
        """)
        
        subfolder_data = [{'path': row['top_level_subfolder'], 'count': row['image_count']} for row in cursor.fetchall()]
        subfolder_data.sort(key=lambda x: x['path'])

        cursor.execute("SELECT 1 FROM images WHERE is_trashed = 1 LIMIT 1")
        has_trashed_items = cursor.fetchone() is not None

        if has_trashed_items:
            subfolder_data.append({'path': logic.TRASHCAN_DIR_NAME, 'count': -1})

        cursor.execute("SELECT DISTINCT format FROM images WHERE is_trashed = 0")
        formats = sorted([row['format'] for row in cursor.fetchall()])
        
        # --- MODIFICATION: Fetch all existing tags ---
        cursor.execute("SELECT name FROM tags ORDER BY name ASC")
        tags = [row['name'] for row in cursor.fetchall()]
        # --- END MODIFICATION ---

        conn.commit()
        
        response_data = {
            "subfolders": subfolder_data, 
            "formats": formats,
            "tags": tags,
            "last_update_time": logic.LAST_DB_UPDATE_TIME
        }
        return web.json_response(response_data)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Failed to get filter options from DB: {e}")
        return web.json_response(response_data, status=error_status)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)

async def list_images_route(request: web.Request):
    request_start_time = time.time()
    
    conn = None
    filters = {}
    current_exception = None
    default_response_data = {
        "images": [], "filtered_count": 0, "total_db_count": 0
    }
    try:
        filters = await request.json()
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # --- MAJOR REFACTOR: Advanced Filtering Logic ---
        
        # Base selection
        # --- FIX: Included boolean flags and thumb_hash in query_fields ---
        query_fields = "i.id, i.filename, i.subfolder, i.format, i.mtime, i.size_bytes, i.path_canon, i.thumbnail_status, i.thumbnail_last_generated_at, i.is_trashed, i.original_path_canon, i.has_edit_file, i.has_workflow, i.has_prompt, i.has_tags, i.thumb_hash"
        query_base = f"FROM images i"
        where_clauses, params = [], []

        # JOINs will be added conditionally
        joins = ""
        
        # Folder & Trash Filters (largely unchanged, but aliased to 'i')
        folder_filters = filters.get('folder_filters', [])
        if logic.TRASHCAN_DIR_NAME in folder_filters:
            where_clauses.append("i.is_trashed = 1")
        else:
            where_clauses.append("i.is_trashed = 0")
            if folder_filters:
                placeholders = ','.join('?' * len(folder_filters))
                where_clauses.append(f"i.top_level_subfolder IN ({placeholders})")
                params.extend(folder_filters)

        # Basic Filters
        format_filters = filters.get('format_filters', [])
        if format_filters:
            placeholders = ','.join('?' * len(format_filters))
            where_clauses.append(f"i.format IN ({placeholders})"); params.extend(format_filters)

        if filters.get('startDate'):
            try:
                dt_start = datetime.datetime.strptime(filters['startDate'], '%Y-%m-%d')
                where_clauses.append("i.mtime >= ?"); params.append(time.mktime(dt_start.timetuple()))
            except (ValueError, TypeError): pass
        if filters.get('endDate'):
            try:
                dt_end = datetime.datetime.strptime(filters['endDate'], '%Y-%m-%d') + datetime.timedelta(days=1)
                where_clauses.append("i.mtime < ?"); params.append(time.mktime(dt_end.timetuple()))
            except (ValueError, TypeError): pass

        # Text Field Searches
        if filters.get('filename_search'):
            where_clauses.append("i.filename LIKE ?"); params.append(f"%{filters['filename_search']}%")
        if filters.get('prompt_search'):
            where_clauses.append("i.prompt_text LIKE ?"); params.append(f"%{filters['prompt_search']}%")
        if filters.get('workflow_search'):
            where_clauses.append("i.workflow_json LIKE ?"); params.append(f"%{filters['workflow_search']}%")

        # Boolean Flag Filters (REMOVED 'has_workflow' as it is now handled by workflow_sources)
        bool_filters = filters.get('bool_filters', {})
        if bool_filters.get('has_prompt') is not None:
             where_clauses.append("i.has_prompt = ?"); params.append(bool_filters['has_prompt'])
        if bool_filters.get('has_edits') is not None:
             where_clauses.append("i.has_edits = ?"); params.append(bool_filters['has_edits'])
        if bool_filters.get('has_tags') is not None:
             where_clauses.append("i.has_tags = ?"); params.append(bool_filters['has_tags'])
        
        # --- MODIFICATION: Workflow Source Filters (Availability) ---
        workflow_sources = filters.get('workflow_sources', [])
        if workflow_sources:
            placeholders = ','.join('?' * len(workflow_sources))
            where_clauses.append(f"i.workflow_source IN ({placeholders})")
            params.extend(workflow_sources)

        # Tag Filtering Logic
        tags_filter = filters.get('tags_filter', [])
        if tags_filter:
            joins += """
                INNER JOIN imagetags it ON i.id = it.image_id
                INNER JOIN tags t ON it.tag_id = t.tag_id
            """
            tags_placeholders = ','.join('?' * len(tags_filter))
            where_clauses.append(f"t.name IN ({tags_placeholders})")
            params.extend([tag.lower() for tag in tags_filter])

        # Construct the final query parts
        final_where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        # Build the counting query
        count_query_base = "SELECT COUNT(DISTINCT i.id)" if tags_filter else "SELECT COUNT(i.id)"
        count_query = f"{count_query_base} {query_base} {joins} {final_where}"
        
        db_count_start_time = time.time()
        cursor.execute(count_query, params)
        filtered_count = cursor.fetchone()[0]
        db_count_end_time = time.time()

        # Build the main data fetching query
        group_by = f"GROUP BY i.id HAVING COUNT(DISTINCT t.name) = {len(tags_filter)}" if tags_filter else ""
        order_by = "ORDER BY i.mtime DESC"
        
        main_query = f"SELECT {query_fields} {query_base} {joins} {final_where} {group_by} {order_by}"
        
        db_main_start_time = time.time()
        cursor.execute(main_query, params)
        images_data = [dict(row) for row in cursor.fetchall()]
        db_main_end_time = time.time()
        
        # --- END MAJOR REFACTOR ---

        # Use orjson for faster JSON serialization if available
        try:
            import orjson
            response = web.Response(
                body=orjson.dumps({ "images": images_data, "filtered_count": filtered_count }),
                content_type='application/json'
            )
        except ImportError:
            response = web.json_response({ "images": images_data, "filtered_count": filtered_count })
        
        request_end_time = time.time()
        print(f"\n[Holaf Perf] Request finished. Found {filtered_count} images.")
        print(f"  > DB Count Query Time:      {(db_count_end_time - db_count_start_time):.4f} seconds")
        print(f"  > DB Main Query & Fetch:    {(db_main_end_time - db_main_start_time):.4f} seconds")
        print(f"  > Total Backend Request Time: {(request_end_time - request_start_time):.4f} seconds for {len(images_data)} images.")
        
        return response
    except json.JSONDecodeError as e_json:
        current_exception = e_json
        print(f"🔴 [Holaf-ImageViewer] Invalid JSON in list_images_route: {e_json}")
        return web.json_response({"error": "Invalid JSON", **default_response_data}, status=400)
    except Exception as e:
        current_exception = e
        print(f"🔴 [Holaf-ImageViewer] Error listing filtered images: {e}"); traceback.print_exc()
        return web.json_response({"error": str(e), **default_response_data}, status=500)
    finally:
        if conn:
            holaf_database.close_db_connection(exception=current_exception)