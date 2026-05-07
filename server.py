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
try:
    from zeroconf import ServiceListener, ServiceBrowser, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    ZEROCONF_AVAILABLE = False
    print('  ⚠️  zeroconf not installed - NDI discovery will use fallback method')
    print('     Install with: pip install zeroconf')


class NDIListener(ServiceListener):
    def __init__(self):
        self.sources = []
        self.lock = threading.Lock()
    
    def add_service(self, zc, type_, name):
        info = zc.get_service_info(type_, name)
        if info:
            with self.lock:
                # Extract IP and port
                addresses = [socket.inet_ntoa(addr) for addr in info.addresses]
                port = info.port
                
                # Parse source name (remove ._ndi._tcp.local)
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
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, format, *args):
        method = self.command
        path = self.path.split('?')[0]
        status_str = str(args[0]) if args else '-'
        try:
            status_int = int(status_str)
            color = '\u03392m' if 200 <= status_int < 300 else '\u03393m' if 300 <= status_int < 400 else '\u03391m'
        except ValueError:
            color = '\u03390m'
        reset = '\u03390m'
        print(f'  {method:6s} {path:40s} {color}{status_str}{reset}')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        # Handle API routes
        if self.path.startswith('/api/ndi/sources'):
            self.handle_ndi_sources()
            return
        
        # Default to serving static files
        super().do_GET()
    
    def handle_ndi_sources(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        sources = self.discover_ndi_sources()
        
        response = {
            'sources': sources,
            'count': len(sources),
            'timestamp': self.get_timestamp()
        }
        
        self.wfile.write(json.dumps(response).encode())
    
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
    
    def fallback_ndi_scan(self):
        # Scan local subnet for potential NDI sources
        # NDI Discovery uses UDP port 5961 (NDI 3.x) or 5960 (NDI 4.x)
        sources = []
        discovered_ips = set()
        
        try:
            # UDP socket for NDI discovery broadcast
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(1.5)  # Wait for responses
            
            # NDI discovery message (simple ping)
            discovery_packet = b'NDI_LIST'
            
            # Send broadcast to port 5961
            sock.sendto(discovery_packet, ('<broadcast>', 5961))
            
            # Also try port 5960 (NDI 4.x)
            try:
                sock.sendto(discovery_packet, ('<broadcast>', 5960))
            except:
                pass
            
            # Collect responses for up to 1.5 seconds
            while True:
                try:
                    data, addr = sock.recvfrom(4096)
                    if addr[0] not in discovered_ips:
                        discovered_ips.add(addr[0])
                        sources.append({
                            'name': f'NDI Device@{addr[0]}',
                            'address': addr[0],
                            'port': addr[1],
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