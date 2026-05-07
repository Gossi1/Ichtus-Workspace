#!/usr/bin/env python3
"""
Ichtus Workspace - Lokale ontwikkelserver

Server je Ichtus SPA zonder VS Code Live Server.
Start:  python server.py
        python server.py --port 3000
        python server.py --open
"""

import http.server
import os
import sys
import socket
import argparse
import webbrowser
from pathlib import Path

# --- Configuratie ---
ROOT_DIR = Path(__file__).resolve().parent  # Project-root = Ichtus_apps/


class IchtusHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler die vanuit de project-root serveert."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, format, *args):
        """Compacte logging: [METHOD] /pad  →  status"""
        method = self.command
        path = self.path.split("?")[0]
        status_str = str(args[0]) if args else "-"
        try:
            status_int = int(status_str)
            color = "\033[92m" if 200 <= status_int < 300 else "\033[93m" if 300 <= status_int < 400 else "\033[91m"
        except ValueError:
            color = "\033[0m"
        reset = "\033[0m"
        print(f"  {method:6s} {path:40s} {color}{status_str}{reset}")

    def end_headers(self):
        # Voorkom caching tijdens development
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


def get_local_ip() -> str:
    """Vind het lokale IP-adres op het netwerk."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    parser = argparse.ArgumentParser(
        description="Ichtus Workspace - Lokale ontwikkelserver",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Voorbeelden:
  python server.py                  # Start op localhost:8080
  python server.py --port 3000      # Start op localhost:3000
  python server.py --host 0.0.0.0   # Toegankelijk op het hele netwerk
  python server.py --open           # Start en open in browser
        """,
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8080,
        help="Poortnummer (default: 8080)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host om aan te binden (default: 127.0.0.1, gebruik 0.0.0.0 voor netwerktoegang)",
    )
    parser.add_argument(
        "--open", "-o",
        action="store_true",
        help="Open de browser automatisch bij starten",
    )
    args = parser.parse_args()

    # Server aanmaken
    server = http.server.HTTPServer(
        (args.host, args.port),
        IchtusHandler,
    )

    # Info weergeven
    local_ip = get_local_ip()
    print()
    print("  ==================================================")
    print("         ICHTUS WORKSPACE - DEV SERVER")
    print("  ==================================================")
    print(f"  Lokaal:    http://localhost:{args.port}/Ichtus_SPA/")
    if args.host == "0.0.0.0":
        print(f"  Netwerk:   http://{local_ip}:{args.port}/Ichtus_SPA/")
    print(f"  Root:      {ROOT_DIR}")
    print("  --------------------------------------------------")
    print("  Druk Ctrl+C om te stoppen")
    print("  ==================================================")
    print()

    # Browser openen
    if args.open:
        url = f"http://localhost:{args.port}/Ichtus_SPA/"
        print(f"  Browser openen: {url}")
        webbrowser.open(url)

    print("  Server draait. Wacht op verzoeken...\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server gestopt. Tot ziens!\n")
        server.server_close()


if __name__ == "__main__":
    main()
