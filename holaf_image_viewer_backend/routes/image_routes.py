# === Holaf Utilities - Image Viewer API Routes (Image Listing) ===
import json
import time
import datetime
import traceback

from aiohttp import web

# Imports from sibling/parent modules
from .. import logic
from ... import holaf_database

# --- API Route Handlers ---
async def get_filter_options_route(request: web.Request):
    conn = None
    response_data = {"subfolders": [], "formats": [], "has_root": False, "last_update_time": logic.LAST_DB_UPDATE_TIME}
    error_status = 500
    current_exception = None
    try:
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        # Get subfolders from non-trashed images
        cursor.execute("SELECT DISTINCT subfolder FROM images WHERE subfolder != '' AND is_trashed = 0")
        subfolders = {row['subfolder'] for row in cursor.fetchall()}

        # Check if there are any items in the trash
        cursor.execute("SELECT 1 FROM images WHERE is_trashed = 1 LIMIT 1")
        has_trashed_items = cursor.fetchone() is not None

        # If there are trashed items, add 'trashcan' to the list of folders to be displayed
        if has_trashed_items:
            subfolders.add(logic.TRASHCAN_DIR_NAME)

        # Get formats from non-trashed images
        cursor.execute("SELECT DISTINCT format FROM images WHERE is_trashed = 0")
        formats = sorted([row['format'] for row in cursor.fetchall()])

        # Check for non-trashed images in root
        cursor.execute("SELECT 1 FROM images WHERE subfolder = '' AND is_trashed = 0 LIMIT 1")
        has_root_images = cursor.fetchone() is not None
        
        conn.commit()
        response_data = {
            "subfolders": sorted(list(subfolders)), 
            "formats": formats, 
            "has_root": has_root_images,
            "last_update_time": logic.LAST_DB_UPDATE_TIME # --- MODIFICATION: Add timestamp to response
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
    conn = None
    filters = {}
    current_exception = None
    default_response_data = {
        "images": [], "filtered_count": 0, "total_db_count": 0, "generated_thumbnails_count": 0
    }
    try:
        filters = await request.json()
        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()

        query_fields = "id, filename, subfolder, format, mtime, size_bytes, path_canon, thumbnail_status, thumbnail_last_generated_at, is_trashed, original_path_canon, has_edit_file"
        query_base = f"SELECT {query_fields} FROM images"
        where_clauses, params = [], []

        folder_filters = filters.get('folder_filters', [])
        
        # If 'trashcan' is selected, we ONLY show the trashcan, regardless of other selections.
        if logic.TRASHCAN_DIR_NAME in folder_filters:
            where_clauses.append("is_trashed = 1")
            # Build a condition that only matches the trashcan and its subdirectories.
            where_clauses.append("(subfolder = ? OR subfolder LIKE ?)")
            params.extend([logic.TRASHCAN_DIR_NAME, f"{logic.TRASHCAN_DIR_NAME}/%"])

        else: # Normal view, non-trashed items
            where_clauses.append("is_trashed = 0")
            if folder_filters:
                conditions = []
                for folder in folder_filters:
                    if folder == 'root':
                        conditions.append("subfolder = ?")
                        params.append('')
                    else:
                        conditions.append("(subfolder = ? OR subfolder LIKE ?)")
                        params.extend([folder, f"{folder}/%"])
                if conditions:
                    where_clauses.append(f"({ ' OR '.join(conditions) })")

        format_filters = filters.get('format_filters', [])
        if format_filters: # Format filters apply to both trash and non-trash views
            placeholders = ','.join('?' * len(format_filters))
            where_clauses.append(f"format IN ({placeholders})"); params.extend(format_filters)

        if filters.get('startDate'):
            try:
                dt_start = datetime.datetime.strptime(filters['startDate'], '%Y-%m-%d')
                where_clauses.append("mtime >= ?"); params.append(time.mktime(dt_start.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid start date: {filters['startDate']}")
        if filters.get('endDate'):
            try:
                dt_end = datetime.datetime.strptime(filters['endDate'], '%Y-%m-%d') + datetime.timedelta(days=1)
                where_clauses.append("mtime < ?"); params.append(time.mktime(dt_end.timetuple()))
            except (ValueError, TypeError): print(f"🟡 Invalid end date: {filters['endDate']}")

        # Workflow availability filter
        workflow_filter = filters.get('workflow_filter')
        if workflow_filter and workflow_filter != 'all':
            if workflow_filter == 'present':
                where_clauses.append("workflow_source IN ('internal_png', 'external_json')")
            elif workflow_filter == 'internal':
                where_clauses.append("workflow_source = 'internal_png'")
            elif workflow_filter == 'external':
                where_clauses.append("workflow_source = 'external_json'")
            elif workflow_filter == 'none':
                # Consider 'none' and NULL as no workflow
                where_clauses.append("(workflow_source NOT IN ('internal_png', 'external_json') OR workflow_source IS NULL)")


        # --- MODIFICATION START: Dynamic Text Search ---
        search_text = filters.get('search_text')
        search_scopes = filters.get('search_scopes', [])
        if search_text and search_scopes:
            search_term = f"%{search_text}%"
            scope_conditions = []
            
            scope_to_column_map = {
                "name": "filename",
                "prompt": "prompt_text",
                "workflow": "workflow_json"
            }
            
            for scope in search_scopes:
                column = scope_to_column_map.get(scope)
                if column:
                    scope_conditions.append(f"{column} LIKE ?")
                    params.append(search_term)

            if scope_conditions:
                where_clauses.append(f"({ ' OR '.join(scope_conditions) })")
        # --- MODIFICATION END ---

        final_query = query_base
        if where_clauses:
            final_query += " WHERE " + " AND ".join(where_clauses)

        count_query_filtered = final_query.replace(query_fields, "COUNT(*)")
        cursor.execute(count_query_filtered, params)
        filtered_count = cursor.fetchone()[0]

        # Total non-trashed images in DB
        cursor.execute("SELECT COUNT(*) FROM images WHERE is_trashed = 0")
        total_db_count = cursor.fetchone()[0]
        # Generated thumbnails for non-trashed images
        cursor.execute("SELECT COUNT(*) FROM images WHERE thumbnail_status = 2 AND is_trashed = 0")
        generated_thumbnails_count = cursor.fetchone()[0]
        
        conn.commit()

        final_query += " ORDER BY mtime DESC"
        cursor.execute(final_query, params)
        images_data = [dict(row) for row in cursor.fetchall()]
        
        return web.json_response({
            "images": images_data,
            "filtered_count": filtered_count,
            "total_db_count": total_db_count,
            "generated_thumbnails_count": generated_thumbnails_count
        })
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