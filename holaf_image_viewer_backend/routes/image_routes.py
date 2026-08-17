# === Holaf Utilities - Image Viewer API Routes (Image Listing) ===
import json
import time
import datetime
import traceback
import os
from collections import defaultdict
import math

from aiohttp import web
import folder_paths  # ComfyUI global

# Imports from sibling/parent modules
from .. import logic
from .. import path_validation
from ... import holaf_database
from ... import holaf_utils

# Immutable cache header for the full-image route. Safe because the frontend
# includes a cache-buster (mtime / thumb_hash) in the query string.
_IMMUTABLE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}

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


async def get_full_image_route(request: web.Request):
    """
    GET /holaf/images/full

    Streams the ORIGINAL full-size file with immutable cache headers.
    Accepts: path_canon (preferred) OR filename + subfolder (+ optional type),
    plus an optional cache-buster (mtime or thumb_hash) which is validated but
    not used for path resolution (it only busts browser/proxy caches).

    Uses the same path whitelist/security checks as get_thumbnail_route:
    rejects '..' / absolute paths and verifies the resolved path stays inside
    the ComfyUI output directory.
    """
    try:
        output_dir = folder_paths.get_output_directory()

        path_canon_param = request.query.get("path_canon")
        filename = request.query.get("filename")
        subfolder = request.query.get("subfolder", "")
        # 'type' is accepted for parity with ComfyUI's /view route and future use.
        # It is not used for path resolution.
        file_type = request.query.get("type", "")

        # Cache-buster params: validated to exist for format sanity, but never
        # used to build the path.
        cache_buster = request.query.get("mtime") or request.query.get("thumb_hash")

        # --- Resolve path_canon (matches DB key exactly) ---
        if path_canon_param:
            original_rel_path = path_canon_param
        # --- Fallback to legacy reconstruction ---
        elif filename:
            safe_filename = holaf_utils.sanitize_filename(filename)
            original_rel_path = os.path.join(subfolder, safe_filename).replace(os.sep, '/')
        else:
            return web.Response(status=400, text="ERR: Filename or path_canon is required.")

        try:
            original_abs_path = path_validation.validate_output_path(output_dir, original_rel_path)
        except ValueError:
            return web.Response(status=403, text="ERR: Forbidden path.")

        if not os.path.isfile(original_abs_path):
            return web.Response(status=404, text="ERR: Original image not found.")

        headers = dict(_IMMUTABLE_CACHE_HEADERS)
        if cache_buster is not None:
            headers["ETag"] = f'"{str(cache_buster)[:64]}"'

        # Stream the file directly from disk (no full read into memory).
        return web.FileResponse(original_abs_path, headers=headers)

    except Exception as e:
        traceback.print_exc()
        return web.Response(status=500, text=f"ERR: Server error serving full image: {e}")


async def list_images_route(request: web.Request):
    # --- BENCHMARK START ---
    t_start = time.perf_counter()
    
    conn = None
    filters = {}
    current_exception = None
    default_response_data = {
        "images": [], "filtered_count": 0, "total_db_count": 0
    }
    
    t_db_connected = 0
    t_count_query = 0
    t_main_query = 0
    t_processing = 0
    t_serialization = 0
    
    try:
        filters = await request.json()
        
        t_json_received = time.perf_counter()

        # --- Pagination (limit/offset) ---
        limit_param = filters.get('limit')
        offset_param = filters.get('offset', 0)
        try:
            limit = int(limit_param) if limit_param is not None else None
            offset = max(0, int(offset_param))
        except (ValueError, TypeError):
            limit = None
            offset = 0
        if limit is not None and limit <= 0:
            limit = None

        conn = holaf_database.get_db_connection()
        cursor = conn.cursor()
        t_db_connected = time.perf_counter()

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

        # --- MODIFICATION: Incremental delta fetch ---
        # When min_mtime is provided, return ONLY images with mtime > min_mtime
        # (ordered by mtime DESC, same field set). The frontend can use this to
        # fetch just the delta (e.g. 1 new image) instead of all ~30k rows.
        if filters.get('min_mtime') is not None:
            try:
                min_mtime = float(filters['min_mtime'])
                where_clauses.append("i.mtime > ?"); params.append(min_mtime)
            except (ValueError, TypeError):
                pass

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
        # --- PERFORMANCE FIX: Skip the COUNT query in the incremental path ---
        # The frontend incremental delta fetch (min_mtime present, e.g. the
        # every-5s new-image check) only uses `total_db_count` (from the cached
        # GlobalStatsManager stats) plus `images` — NOT `filtered_count`. Running
        # a COUNT here on EVERY request caused a pathological ~900ms full-scan
        # on large DBs, even when only 1 delta row was returned. Keep the COUNT
        # strictly for the full-list path where the display counter is consumed.
        if filters.get('min_mtime') is not None:
            filtered_count = 0  # Not used by the incremental frontend path.
        else:
            count_query_base = "SELECT COUNT(DISTINCT i.id)" if tags_filter else "SELECT COUNT(i.id)"
            count_query = f"{count_query_base} {query_base} {joins} {final_where}"
            cursor.execute(count_query, params)
            filtered_count = cursor.fetchone()[0]
        
        t_count_query = time.perf_counter()

        # Build the main data fetching query
        group_by = f"GROUP BY i.id HAVING COUNT(DISTINCT t.name) = {len(tags_filter)}" if tags_filter else ""
        order_by = "ORDER BY i.mtime DESC"
        
        main_query = f"SELECT {query_fields} {query_base} {joins} {final_where} {group_by} {order_by}"
        main_params = params
        if limit is not None:
            main_query += " LIMIT ? OFFSET ?"
            main_params = params + [limit, offset]
        
        cursor.execute(main_query, main_params)
        images_data = [dict(row) for row in cursor.fetchall()]
        
        t_main_query = time.perf_counter()
        
        # --- END MAJOR REFACTOR ---

        # Use orjson for faster JSON serialization if available
        # FIX: Include total_db_count and generated_thumbnails_count in response
        stats = logic.stats_manager.get_stats()
        body_content = ""
        serialization_method = "json"
        
        try:
            import orjson
            body_content = orjson.dumps({
                "images": images_data,
                "filtered_count": filtered_count,
                "total_count": filtered_count,
                "total_db_count": stats["total_db_count"],
                "generated_thumbnails_count": stats["generated_thumbnails_count"],
                })
            serialization_method = "orjson"
        except ImportError:
            body_content = json.dumps({
                "images": images_data,
                "filtered_count": filtered_count,
                "total_count": filtered_count,
                "total_db_count": stats["total_db_count"],
                "generated_thumbnails_count": stats["generated_thumbnails_count"],
                }).encode('utf-8')
        
        response = web.Response(body=body_content, content_type='application/json')
        
        t_serialization = time.perf_counter()
        
        # --- BENCHMARK REPORTING ---
        total_time = (t_serialization - t_start) * 1000
        db_count_ms = (t_count_query - t_db_connected) * 1000
        db_fetch_ms = (t_main_query - t_count_query) * 1000
        serialize_ms = (t_serialization - t_main_query) * 1000
        payload_size_mb = len(body_content) / (1024 * 1024)
        
        # Report the actual number of returned rows (accurate for both the full
        # path, where filtered_count == len(images_data) since there is no LIMIT,
        # and the incremental path, where filtered_count is intentionally 0).
        print(f"\n⚡ [Holaf Perf Report] List Images ({len(images_data)} items)")
        print(f"  ├── Total Time:     {total_time:.2f} ms")
        print(f"  ├── DB Count Query: {db_count_ms:.2f} ms")
        print(f"  ├── DB Fetch Data:  {db_fetch_ms:.2f} ms")
        print(f"  ├── JSON Serialize: {serialize_ms:.2f} ms ({serialization_method})")
        print(f"  └── Payload Size:   {payload_size_mb:.2f} MB")
        
        if payload_size_mb > 5.0:
            print(f"  ⚠️  WARNING: Payload is large (>5MB). Network transfer will be the bottleneck.")

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