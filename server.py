#!/usr/bin/env python3
import http.server
import os
import sys
import socket
import argparse
import webbrowser
import json
import threading
from pathlib import Path

# --- Configuratie ---
ROOT_DIR = Path(__file__).resolve().parent  # Project-root = Ichtus_apps/

# Try to import zeroconf for mDNS discovery
ZEROCONF_AVAILABLE = False
try:
    from zeroconf import ServiceListener, ServiceBrowser, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    print('  ⚠️  zeroconf not installed - NDI discovery will use fallback method')
    print('     Install with: pip install zeroconf')

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


class IchtusHandler(http.server.SimpleHTTPRequestHandler):
    # Class-level cache shared across all handler instances
    _ndi_cache = None
    _cache_timestamp = None
    
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
        
        # Default to serving static files
        super().do_GET()
    
    def handle_ndi_sources(self):
        # Send headers immediately to avoid empty reply
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        try:
            # Use cached sources if available and recent (within 10 seconds)
            cache_age = self.get_timestamp_diff(self._cache_timestamp) if self._cache_timestamp else 999
            if self._ndi_cache and cache_age < 10:
                response = self._ndi_cache
                self.wfile.write(json.dumps(response).encode())
                return
            
            # Discover in a separate thread to not block the response
            def background_discovery():
                sources = self.discover_ndi_sources()
                IchtusHandler._ndi_cache = {
                    'sources': sources,
                    'count': len(sources),
                    'timestamp': self.get_timestamp()
                }
                IchtusHandler._cache_timestamp = IchtusHandler._ndi_cache['timestamp']
            
            thread = threading.Thread(target=background_discovery)
            thread.daemon = True
            thread.start()
            
            # Return cached or empty immediately
            if self._ndi_cache:
                response = self._ndi_cache
            else:
                response = {
                    'sources': [],
                    'count': 0,
                    'timestamp': self.get_timestamp(),
                    'scanning': True
                }
            
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


def main():
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
    args = parser.parse_args()

    server = http.server.HTTPServer(
        (args.host, args.port),
        IchtusHandler,
    )

    local_ip = get_local_ip()
    print()
    print('  ==================================================')
    print('         ICHTUS WORKSPACE - DEV SERVER')
    print('  ==================================================')
    print(f'  Lokaal:    http://localhost:{args.port}/Ichtus_SPA/')
    if args.host == '0.0.0.0':
        print(f'  Netwerk:   http://{local_ip}:{args.port}/Ichtus_SPA/')
    print(f'  Root:      {ROOT_DIR}')
    print('  --------------------------------------------------')
    print('  API Endpoints:')
    print(f'    GET /api/ndi/sources  - Ontdek NDI bronnen')
    print('  --------------------------------------------------')
    print('  Druk Ctrl+C om te stoppen')
    print('  ==================================================')
    print()

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