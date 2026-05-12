#!/usr/bin/env python3
import sys
import io

# Fix Unicode encoding for Windows console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    # Force unbuffered output
    sys.stdout.flush()
    sys.stderr.flush()

import http.server
import os
import re
import sys
import socket
import argparse
import webbrowser
import json
import threading
import urllib.request
import urllib.error
import zipfile
import shutil
from pathlib import Path
from datetime import datetime

# --- Configuratie ---
ROOT_DIR = Path(__file__).resolve().parent  # Project-root = Ichtus_apps/

# Auto-update configuratie
UPDATE_CONFIG = {
    'github_repo': 'Gossi1/Ichtus-Workspace',  # Gebruiker/Repo
    'current_version': '1.0.0',
    'check_on_start': True,
}

# Try to import zeroconf for mDNS discovery
ZEROCONF_AVAILABLE = False
try:
    from zeroconf import ServiceListener, ServiceBrowser, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    print('  ⚠️  zeroconf not installed - NDI discovery will use fallback method', flush=True)
    print('     Install with: pip install zeroconf', flush=True)

# Only define NDIListener class if zeroconf is available
if ZEROCONF_AVAILABLE:
    class NDIListener(ServiceListener):
        def __init__(self):
            self.sources = []
            self.lock = threading.Lock()
        
        def add_service(self, zc, type_, name):
            info = zc.get_service_info(type_, name)
            if info:
                with self.lock:
                    addresses = [socket.inet_ntoa(addr) for addr in info.addresses]
                    port = info.port
                    source_name = name.replace('._ndi._tcp.local.', '').replace('._ndi._tcp.', '')
                    self.sources.append({
                        'name': source_name,
                        'address': addresses[0] if addresses else 'unknown',
                        'port': port,
                        'type': 'NDI Source',
                        'metadata': f'Port: {port}'
                    })
        
        def remove_service(self, zc, type_, name):
            pass
        
        def update_service(self, zc, type_, name):
            pass
        
        def get_sources(self):
            with self.lock:
                return list(self.sources)


def load_firebase_config():
    """Load Firebase config from firebase-api-key.txt if it exists and has real values."""
    config_file = ROOT_DIR / 'firebase-api-key.txt'
    if not config_file.exists():
        return None
    
    try:
        content = config_file.read_text(encoding='utf-8')
        # Parse all config values from the file
        config = {}
        for key in ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']:
            # Match both single and double quoted values (use raw string for regex)
            key_match = re.search(rf'{key}:\s*["\']([^"\']+)["\']', content)
            if key_match:
                config[key] = key_match.group(1)
        
        # Validate required fields
        if config.get('apiKey') and not config['apiKey'].startswith('YOUR_'):
            return config
    except Exception as e:
        print(f'  [WARN] Could not load firebase config: {e}', flush=True)
    return None


class IchtusHandler(http.server.SimpleHTTPRequestHandler):
    # Class-level cache shared across all handler instances
    _ndi_cache = None
    _cache_timestamp = None
    
    # Firebase config loaded at class level
    _firebase_config = None
    
    # Set the directory for serving files (class variable)
    directory = str(ROOT_DIR)

    def log_message(self, format, *args):
        method = self.command
        path = self.path.split('?')[0]
        print(f'  {method} {path}')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        # Load Firebase config if not already loaded
        if IchtusHandler._firebase_config is None:
            IchtusHandler._firebase_config = load_firebase_config()
        
        # Check if this is an HTML file that needs config injection
        if self.path.endswith('.html') or self.path == '/':
            self.serve_html_with_config()
            return
        
        print(f'  DEBUG: GET path={repr(self.path)}')
        
        # Test endpoint - always works
        if self.path.startswith('/api/test'):
            print(f'  DEBUG: Test endpoint matched!')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"test": "ok", "server": "IchtusHandler"}')
            return
        
        # Handle API routes
        if self.path.startswith('/api/ndi/sources'):
            print(f'  DEBUG: Matched NDI route!')
            self.handle_ndi_sources()
            return
        
        if self.path.startswith('/api/tockify/ics'):
            self.handle_tockify_ics()
            return
        
        # Default to serving static files
        super().do_GET()
    
    def serve_html_with_config(self):
        """Serve HTML with Firebase config injected."""
        # Determine the file path
        if self.path == '/':
            file_path = ROOT_DIR / 'Ichtus_SPA' / 'index.html'
        elif self.path.startswith('/Ichtus_SPA/'):
            file_path = ROOT_DIR / self.path.lstrip('/')
        else:
            file_path = ROOT_DIR / self.path.lstrip('/')
        
        if not file_path.exists():
            self.send_error(404, 'File not found')
            return
        
        # Read the HTML content
        try:
            content = file_path.read_text(encoding='utf-8')
        except Exception as e:
            self.send_error(500, f'Could not read file: {e}')
            return
        
        # Inject Firebase config if we have it
        if IchtusHandler._firebase_config:
            config_json = json.dumps(IchtusHandler._firebase_config)
            # Inject the config before </head>
            config_script = f'<script>window.FIREBASE_CONFIG = {config_json};</script>'
            content = content.replace('</head>', config_script + '</head>')
        
        # Send the response
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(content.encode('utf-8'))
    
    def handle_ndi_sources(self):
        # Send headers immediately to avoid empty reply
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        try:
            # Check if we're already discovering (don't start duplicate)
            if IchtusHandler._ndi_cache and IchtusHandler._ndi_cache.get('scanning'):
                # Another request is already scanning, wait a bit and return
                import time
                for _ in range(10):  # Wait up to 2 seconds
                    time.sleep(0.2)
                    if not IchtusHandler._ndi_cache.get('scanning'):
                        break
                response = IchtusHandler._ndi_cache
                self.wfile.write(json.dumps(response).encode())
                return
            
            # Use cached sources if available and recent (within 10 seconds)
            cache_age = self.get_timestamp_diff(IchtusHandler._cache_timestamp) if IchtusHandler._cache_timestamp else 999
            if IchtusHandler._ndi_cache and not IchtusHandler._ndi_cache.get('scanning') and cache_age < 10:
                response = IchtusHandler._ndi_cache
                self.wfile.write(json.dumps(response).encode())
                return
            
            # Mark as scanning
            IchtusHandler._ndi_cache = {'sources': [], 'count': 0, 'timestamp': self.get_timestamp(), 'scanning': True}
            
            # Discover in a separate thread
            def background_discovery():
                try:
                    sources = self.discover_ndi_sources()
                    IchtusHandler._ndi_cache = {
                        'sources': sources,
                        'count': len(sources),
                        'timestamp': self.get_timestamp(),
                        'scanning': False
                    }
                except Exception as e:
                    print(f'  ⚠️  NDI discovery error: {e}')
                    IchtusHandler._ndi_cache = {
                        'sources': [],
                        'count': 0,
                        'timestamp': self.get_timestamp(),
                        'scanning': False,
                        'error': str(e)
                    }
            
            thread = threading.Thread(target=background_discovery)
            thread.daemon = True
            thread.start()
            
            # Wait for discovery to complete (up to 5 seconds)
            import time
            for _ in range(25):  # 25 * 0.2 = 5 seconds
                time.sleep(0.2)
                if IchtusHandler._ndi_cache and not IchtusHandler._ndi_cache.get('scanning'):
                    break
            
            response = IchtusHandler._ndi_cache
            self.wfile.write(json.dumps(response).encode())
            
        except Exception as e:
            print(f'  ⚠️  NDI API error: {e}')
            # Headers already sent, send error as body
            try:
                self.wfile.write(json.dumps({'error': str(e), 'sources': [], 'count': 0}).encode())
            except:
                pass  # If even this fails, connection is broken
    
    def discover_ndi_sources(self):
        sources = []
        
        if ZEROCONF_AVAILABLE:
            try:
                listener = NDIListener()
                zeroconf = Zeroconf()
                
                # Search for NDI services
                browser = ServiceBrowser(zeroconf, '_ndi._tcp.local.', listener)
                
                # Wait for discoveries (max 3 seconds)
                import time
                time.sleep(3)
                
                zeroconf.close()
                sources = listener.get_sources()
                
            except Exception as e:
                print(f'  ⚠️  NDI discovery error: {e}')
        
        # Fallback: scan common NDI ports on local network
        if not sources:
            sources = self.fallback_ndi_scan()
        
        return sources
    
    def get_timestamp_diff(self, iso_timestamp):
        from datetime import datetime
        try:
            cached_time = datetime.fromisoformat(iso_timestamp)
            return (datetime.now() - cached_time).total_seconds()
        except:
            return 999
    
    def fallback_ndi_scan(self):
        sources = []
        discovered_ips = set()
        
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(1.5)
            
            discovery_packet = b'NDI_LIST'
            
            # Send broadcast to ports 5961 and 5960
            sock.sendto(discovery_packet, ('<broadcast>', 5961))
            try:
                sock.sendto(discovery_packet, ('<broadcast>', 5960))
            except:
                pass
            
            while True:
                try:
                    data, addr = sock.recvfrom(4096)
                    if addr[0] not in discovered_ips:
                        discovered_ips.add(addr[0])
                        sources.append({
                            'name': f'NDI Device@{addr[0]}',
                            'address': addr[0],
                            'port': 5961,  # NDI discovery port
                            'type': 'NDI Source (UDP)',
                            'metadata': 'Discovered via UDP broadcast'
                        })
                except socket.timeout:
                    break
            
            sock.close()
            
        except Exception as e:
            print(f'  ⚠️  Fallback scan error: {e}')
        
        return sources
    
    def handle_tockify_ics(self):
        """Server-side proxy: fetch Tockify ICS feed (no CORS issues)."""
        ics_url = 'https://tockify.com/api/feeds/ics/ichtus'
        
        try:
            req = urllib.request.Request(ics_url, headers={'User-Agent': 'Ichtus-Workspace'})
            with urllib.request.urlopen(req, timeout=15) as response:
                ics_data = response.read().decode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'text/calendar; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(ics_data.encode('utf-8'))
            
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Tockify unreachable: {str(e.reason)}'}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def get_timestamp(self):
        from datetime import datetime
        return datetime.now().isoformat()
    


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def check_for_updates():
    """Check GitHub for updates and return info dict."""
    repo = UPDATE_CONFIG['github_repo']
    try:
        url = f'https://api.github.com/repos/{repo}/releases/latest'
        req = urllib.request.Request(url, headers={'User-Agent': 'Ichtus-Workspace'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            latest_version = data.get('tag_name', 'v0.0.0').lstrip('v')
            current_version = UPDATE_CONFIG['current_version']
            
            # Compare versions (simple comparison for now)
            needs_update = parse_version(latest_version) > parse_version(current_version)
            
            return {
                'available': True,
                'needs_update': needs_update,
                'latest_version': latest_version,
                'current_version': current_version,
                'release_url': data.get('html_url', ''),
                'body': data.get('body', ''),
                'download_url': data.get('zipball_url', '')
            }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {'available': False, 'error': 'No releases found (repo may be private or no releases created yet)'}
        return {'available': False, 'error': f'HTTP Error: {e.code}'}
    except Exception as e:
        return {'available': False, 'error': str(e)}


def parse_version(v):
    """Parse version string to tuple for comparison."""
    try:
        return tuple(int(x) for x in v.split('.')[:3])
    except:
        return (0, 0, 0)


def download_and_apply_update(download_url):
    """Download update zip and apply it."""
    print('  [DOWNLOAD] Downloading update...')
    
    temp_dir = ROOT_DIR / 'temp_update'
    backup_dir = ROOT_DIR / 'backup_pre_update'
    
    def restore_backup():
        """Restore files from backup directory."""
        try:
            print('  [RESTORE] Restoring from backup...')
            for item in backup_dir.rglob('*'):
                rel_path = item.relative_to(backup_dir)
                dest_path = ROOT_DIR / rel_path
                if item.is_file():
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, dest_path)
            print('  [RESTORE] Done.')
        except Exception as restore_err:
            print(f'  [RESTORE] Warning: Restore also failed: {restore_err}')
    
    try:
        # Create temp directory
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Create backup of existing files (exclude .git and temp)
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        print('  [BACKUP] Creating backup...')
        for item in ROOT_DIR.iterdir():
            if item.name in ['.git', 'temp_update', 'backup_pre_update', '.venv']:
                continue
            dest = backup_dir / item.name
            if item.is_dir():
                shutil.copytree(item, dest, ignore=shutil.ignore_patterns('.git', '__pycache__'))
            else:
                shutil.copy2(item, dest)
        print('  [BACKUP] Backup saved in backup_pre_update/')
        
        # Download zip
        zip_path = temp_dir / 'update.zip'
        req = urllib.request.Request(download_url, headers={'User-Agent': 'Ichtus-Workspace'})
        with urllib.request.urlopen(req, timeout=60) as response:
            with open(zip_path, 'wb') as f:
                shutil.copyfileobj(response, f)
        
        print('  [EXTRACT] Extracting update...')
        
        # Extract zip
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # Find extracted folder
        extracted_folders = list(temp_dir.iterdir())
        if extracted_folders:
            source_dir = extracted_folders[0]
            if source_dir.is_dir():
                print('  [APPLY] Applying update...')
                
                # Copy files (skipping .git)
                files_updated = 0
                errors = []
                for item in source_dir.rglob('*'):
                    if '.git' in item.parts:
                        continue
                    rel_path = item.relative_to(source_dir)
                    dest_path = ROOT_DIR / rel_path
                    
                    if item.is_file():
                        try:
                            dest_path.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(item, dest_path)
                            files_updated += 1
                        except Exception as file_err:
                            errors.append(f'{rel_path}: {file_err}')
                
                if errors:
                    print(f'  [WARN] Some files had errors: {len(errors)}')
                
                print(f'  [OK] Update applied! ({files_updated} files updated)')
                print('     Restart the server to use the new version.')
                print('     Backup kept in backup_pre_update/ until next update.')
                return True
        
        return False
    except Exception as e:
        print(f'  [ERROR] Update failed: {e}')
        print('  [BACKUP] Your backup is in backup_pre_update/')
        print('     To restore: python server.py --restore-backup')
        return False
    finally:
        # Cleanup temp directory
        if temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
            except:
                pass


def restore_from_backup():
    """Restore project from backup_pre_update folder."""
    backup_dir = ROOT_DIR / 'backup_pre_update'
    if not backup_dir.exists():
        print('  [ERROR] No backup found to restore.')
        return False
    
    print('  [RESTORE] Restoring from backup_pre_update...')
    try:
        for item in backup_dir.rglob('*'):
            rel_path = item.relative_to(backup_dir)
            dest_path = ROOT_DIR / rel_path
            if item.is_file():
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest_path)
        print('  [OK] Restore complete.')
        return True
    except Exception as e:
        print(f'  [ERROR] Restore failed: {e}')
        return False


def prompt_update_confirmation(update_info):
    """Ask user if they want to apply the update. Returns True if user wants to update."""
    if not update_info.get('needs_update'):
        return False
    
    print()
    print('  +------------------------------------------------------+')
    print('  |  [NEW] UPDATE AVAILABLE                               |')
    print('  +------------------------------------------------------+')
    print(f'  |  Current:  {update_info["current_version"]:<30} |')
    print(f'  |  Latest:   {update_info["latest_version"]:<30} |')
    print('  +------------------------------------------------------+')
    
    if update_info.get('body'):
        # Show first few lines of release notes
        notes = update_info['body'][:200].replace('\n', ' ') + '...'
        print(f'  |  {notes:<50} |')
        print('  +------------------------------------------------------+')
    
    print()
    while True:
        try:
            response = input('  Update now? [Y/n]: ').strip().lower()
            if response in ['', 'y', 'yes']:
                return True
            elif response in ['n', 'no']:
                return False
            else:
                print('  Please enter Y or N')
        except EOFError:
            # Non-interactive mode (piped input), default to no
            print('  (non-interactive, skipping update)')
            return False


def main():
    # Force output flush before main() runs
    sys.stdout.flush()
    sys.stderr.flush()
    parser = argparse.ArgumentParser(
        description='Ichtus Workspace - Lokale ontwikkelserver',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Voorbeelden:
  python server.py                  # Start op localhost:8080
  python server.py --port 3000      # Start op localhost:3000
  python server.py --host 0.0.0.0   # Toegankelijk op het hele netwerk
  python server.py --open           # Start en open in browser
        ''',
    )
    parser.add_argument(
        '--port', '-p',
        type=int,
        default=8080,
        help='Poortnummer (default: 8080)',
    )
    parser.add_argument(
        '--host',
        type=str,
        default='127.0.0.1',
        help='Host om aan te binden (default: 127.0.0.1, gebruik 0.0.0.0 voor netwerktoegang)',
    )
    parser.add_argument(
        '--open', '-o',
        action='store_true',
        help='Open de browser automatisch bij starten',
    )
    parser.add_argument(
        '--check-updates', '-c',
        action='store_true',
        help='Controleer voor updates en sluit af',
    )
    parser.add_argument(
        '--update',
        action='store_true',
        help='Download en installeer de nieuwste update',
    )
    parser.add_argument(
        '--no-update-check',
        action='store_true',
        help='Sla de automatische update controle over',
    )
    parser.add_argument(
        '--restore-backup',
        action='store_true',
        help='Herstel vanuit backup_pre_update/',
    )
    args = parser.parse_args()

    # Handle --restore-backup mode
    if args.restore_backup:
        success = restore_from_backup()
        return

    # Handle --check-updates mode
    if args.check_updates:
        print('  [CHECK] Checking for updates...')
        update_info = check_for_updates()
        if update_info.get('available'):
            if update_info.get('needs_update'):
                print(f'  [NEW] Update available: {update_info["latest_version"]}', flush=True)
                print(f'        {update_info["release_url"]}', flush=True)
            else:
                print(f'  [OK] Version {update_info["current_version"]} is up-to-date')
        else:
            print(f'  [ERROR] Could not check updates: {update_info.get("error", "Unknown error")}', flush=True)
        return

    # Handle --update mode
    if args.update:
        print('  [UPDATE] Starting update process...')
        update_info = check_for_updates()
        if update_info.get('needs_update'):
            success = download_and_apply_update(update_info['download_url'])
            if success:
                print('\n  Server must be restarted to use the new version.')
            else:
                print('\n  Update failed. You can manually download from:')
                print(f'  URL: {update_info["release_url"]}')
        else:
            print(f'  [OK] Version {update_info["current_version"]} is already up-to-date')
        return

    # Check for updates on startup (unless disabled)
    update_info = None
    if args.no_update_check:
        print('  [SKIP] Update check disabled (--no-update-check)')
    else:
        print('  [CHECK] Checking for updates...')
        update_info = check_for_updates()
        
        if update_info.get('needs_update'):
            # Ask for confirmation before updating
            should_update = prompt_update_confirmation(update_info)
            if should_update:
                print()
                print('  [UPDATE] Downloading and applying update...')
                success = download_and_apply_update(update_info['download_url'])
                if success:
                    print()
                    print('  Update applied! Please restart the server.')
                    print('  Run: python server.py')
                    return
                else:
                    print()
                    print('  Update failed. Starting server with current version.')
                    print('  (You can restore from backup with --restore-backup)')
            else:
                print()
                print('  [SKIP] Update skipped. Starting server...')
        elif update_info.get('available'):
            print(f'  [OK] Version {update_info["current_version"]} is up-to-date')
        else:
            print(f'  [WARN] Could not check updates: {update_info.get("error", "Unknown")}', flush=True)

    # Flush before starting server
    sys.stdout.flush()
    sys.stderr.flush()

    server = http.server.HTTPServer(
        (args.host, args.port),
        IchtusHandler,
    )

    local_ip = get_local_ip()
    # Print entire header at once to avoid buffering issues on Windows
    header = f"""
  ==================================================
         ICHTUS WORKSPACE - DEV SERVER
  ==================================================
  Lokaal:    http://localhost:{args.port}/Ichtus_SPA/
  Netwerk:   http://{local_ip}:{args.port}/Ichtus_SPA/
  Root:      {ROOT_DIR}
  --------------------------------------------------
  API Endpoints:
    GET /api/ndi/sources  - Ontdek NDI bronnen
  --------------------------------------------------
  Druk Ctrl+C om te stoppen
  ==================================================

  Server draait. Wacht op verzoeken...
"""
    print(header, flush=True)

    if args.open:
        url = f'http://localhost:{args.port}/Ichtus_SPA/'
        print(f'  Browser openen: {url}')
        webbrowser.open(url)

    print('  Server draait. Wacht op verzoeken...\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server gestopt. Tot ziens!\n')
        server.server_close()


if __name__ == '__main__':
    main()