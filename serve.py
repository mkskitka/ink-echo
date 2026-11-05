"""Serve web/ on your local network so an iPhone/iPad on the same Wi-Fi can open it.

    python serve.py            # http://<your-LAN-IP>:8000
    python serve.py --port 9000
"""
import argparse
import functools
import http.server
import socket
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packets sent; just picks the outbound interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript",
                      ".webmanifest": "application/manifest+json", ".bin": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    handler = functools.partial(Handler, directory=str(WEB))
    with http.server.ThreadingHTTPServer(("0.0.0.0", args.port), handler) as httpd:
        print(f"Ink Echo running:\n  this computer:  http://localhost:{args.port}\n"
              f"  iPhone / iPad:  http://{lan_ip()}:{args.port}  (same Wi-Fi)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
