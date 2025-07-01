# === Holaf Utilities - Configuration Manager ===
import configparser
import os
import platform
import asyncio
import re
import traceback

CONFIG_LOCK = asyncio.Lock()
IS_WINDOWS = platform.system() == "Windows" # Needed for default shell

def get_config_path():
    return os.path.join(os.path.dirname(__file__), 'config.ini')

def get_config_parser():
    config = configparser.ConfigParser()
    config.read(get_config_path())
    return config

def _parse_panel_settings(config_parser_obj, section_name, defaults):
    settings = {
        'theme': config_parser_obj.get(section_name, 'theme', fallback=defaults.get('theme', 'Dark')),
        'panel_x': config_parser_obj.get(section_name, 'panel_x', fallback=defaults.get('panel_x', None)),
        'panel_y': config_parser_obj.get(section_name, 'panel_y', fallback=defaults.get('panel_y', None)),
        'panel_width': config_parser_obj.getint(section_name, 'panel_width', fallback=defaults.get('panel_width', 600)),
        'panel_height': config_parser_obj.getint(section_name, 'panel_height', fallback=defaults.get('panel_height', 400)),
        'panel_is_fullscreen': config_parser_obj.getboolean(section_name, 'panel_is_fullscreen', fallback=defaults.get('panel_is_fullscreen', False)),
    }
    if settings['panel_x'] and settings['panel_x'].isdigit():
        settings['panel_x'] = int(settings['panel_x'])
    else:
        settings['panel_x'] = None
    if settings['panel_y'] and settings['panel_y'].isdigit():
        settings['panel_y'] = int(settings['panel_y'])
    else:
        settings['panel_y'] = None
    return settings

def load_all_configs():
    config_parser_obj = get_config_parser()
    
    default_shell = 'cmd.exe' if IS_WINDOWS else ('bash' if os.path.exists('/bin/bash') else 'sh')
    shell_cmd = config_parser_obj.get('Terminal', 'shell_command', fallback=default_shell)
    password_hash = config_parser_obj.get('Security', 'password_hash', fallback=None)
    if not password_hash:
        password_hash = None

    ui_terminal_defaults = {'panel_width': 600, 'panel_height': 400}
    ui_settings_terminal = _parse_panel_settings(config_parser_obj, 'TerminalUI', ui_terminal_defaults)
    ui_settings_terminal.update({
        'font_size': config_parser_obj.getint('TerminalUI', 'font_size', fallback=14),
    })

    ui_model_manager_defaults = {'panel_width': 800, 'panel_height': 550}
    ui_settings_model_manager = _parse_panel_settings(config_parser_obj, 'ModelManagerUI', ui_model_manager_defaults)
    ui_settings_model_manager.update({
        'filter_type': config_parser_obj.get('ModelManagerUI', 'filter_type', fallback='All'),
        'filter_search_text': config_parser_obj.get('ModelManagerUI', 'filter_search_text', fallback=''),
        'sort_column': config_parser_obj.get('ModelManagerUI', 'sort_column', fallback='name'),
        'sort_order': config_parser_obj.get('ModelManagerUI', 'sort_order', fallback='asc'),
        'zoom_level': config_parser_obj.getfloat('ModelManagerUI', 'zoom_level', fallback=1.0),
    })

    ui_image_viewer_defaults = {'panel_width': 1200, 'panel_height': 800}
    ui_settings_image_viewer = _parse_panel_settings(config_parser_obj, 'ImageViewerUI', ui_image_viewer_defaults)
    ui_settings_image_viewer.update({
        'folder_filters': [f.strip() for f in config_parser_obj.get('ImageViewerUI', 'folder_filters', fallback='').split('","') if f.strip()],
        'format_filters': [f.strip() for f in config_parser_obj.get('ImageViewerUI', 'format_filters', fallback='').split('","') if f.strip()],
        'thumbnail_fit': config_parser_obj.get('ImageViewerUI', 'thumbnail_fit', fallback='cover'),
        'thumbnail_size': config_parser_obj.getint('ImageViewerUI', 'thumbnail_size', fallback=150),
        'export_format': config_parser_obj.get('ImageViewerUI', 'export_format', fallback='png'),
        'export_include_meta': config_parser_obj.getboolean('ImageViewerUI', 'export_include_meta', fallback=True),
        'export_meta_method': config_parser_obj.get('ImageViewerUI', 'export_meta_method', fallback='embed'),
    })
    
    ui_nodes_manager_defaults = {'panel_width': 900, 'panel_height': 600}
    ui_settings_nodes_manager = _parse_panel_settings(config_parser_obj, 'NodesManagerUI', ui_nodes_manager_defaults)
    ui_settings_nodes_manager.update({
         'filter_text': config_parser_obj.get('NodesManagerUI', 'filter_text', fallback=''),
         'zoom_level': config_parser_obj.getfloat('NodesManagerUI', 'zoom_level', fallback=1.0),
    })

    monitor_settings = {
        'update_interval_ms': config_parser_obj.getint('SystemMonitor', 'update_interval_ms', fallback=1500),
        'max_history_points': config_parser_obj.getint('SystemMonitor', 'max_history_points', fallback=60),
    }

    return {
        'shell_command': shell_cmd,
        'password_hash': password_hash,
        'ui_terminal': ui_settings_terminal,
        'ui_model_manager': ui_settings_model_manager,
        'ui_image_viewer': ui_settings_image_viewer,
        'ui_nodes_manager': ui_settings_nodes_manager,
        'monitor': monitor_settings
    }

async def save_setting_to_config(section, key, value):
    async with CONFIG_LOCK:
        config_path = get_config_path()
        config_parser_obj = get_config_parser()
        
        if not config_parser_obj.has_section(section):
            config_parser_obj.add_section(section)
        
        if value is None:
            if config_parser_obj.has_option(section, key):
                config_parser_obj.remove_option(section, key)
        else:
            config_parser_obj.set(section, str(key), str(value))
            
        with open(config_path, 'w') as configfile:
            config_parser_obj.write(configfile)

async def save_bulk_settings_to_config(settings_data):
    """ Saves multiple settings, typically from save-all-settings """
    async with CONFIG_LOCK:
        config_path = get_config_path()
        config_parser_obj = get_config_parser()

        for section, settings in settings_data.items():
            if section == 'Security': continue # Never allow changing security from general save
            
            if not config_parser_obj.has_section(section):
                config_parser_obj.add_section(section)
            
            if isinstance(settings, dict):
                for key, value in settings.items():
                    safe_key = re.sub(r'[^a-zA-Z0-9_]', '', key)
                    if not safe_key: continue
                    
                    if value is None or str(value).strip() == '':
                        if config_parser_obj.has_option(section, safe_key):
                            config_parser_obj.remove_option(section, safe_key)
                    else:
                         config_parser_obj.set(section, str(safe_key), str(value))
        
        with open(config_path, 'w') as configfile:
            config_parser_obj.write(configfile)