"""Serves the ramp plan app on http://127.0.0.1:8785 with caching off, so every edit shows up on reload.

Run: python3 ~/ramp_plan/serve.py [port]
"""
import functools
import http.server
import pathlib
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8785
ROOT = pathlib.Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"Ramp plan on http://127.0.0.1:{PORT}", flush=True)
        server.serve_forever()
