import os
import json
import threading
import time
import importlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import sync_meta

PORT = int(os.environ.get("PORT", 5500))
DATA_JSON_PATH = os.path.join("data", "mlbb_meta.json")
SYNC_LOCK = threading.Lock()


class ElyaDraftHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/meta":
            self.handle_get_meta()
            return
        if parsed.path == "/api/status":
            self.handle_get_status()
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sync":
            self.handle_post_sync()
            return
        self.send_error(404, "Endpoint not found")

    def handle_get_meta(self):
        try:
            if not os.path.exists(DATA_JSON_PATH):
                with SYNC_LOCK:
                    payload = sync_meta.build_full_meta_dataset()
            else:
                with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            err = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err)

    def handle_get_status(self):
        exists = os.path.exists(DATA_JSON_PATH)
        mtime = os.path.getmtime(DATA_JSON_PATH) if exists else 0
        resp = {
            "status": "online",
            "app": "ElyaDraftSimulator",
            "has_cache": exists,
            "last_modified": mtime,
        }
        body = json.dumps(resp).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def handle_post_sync(self):
        try:
            with SYNC_LOCK:
                importlib.reload(sync_meta)
                payload = sync_meta.build_full_meta_dataset()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            err = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err)


def auto_patch_watcher(interval_sec=1800):
    """Background daemon that periodically re-syncs Moonton GMS Live Patch & MPL Meta."""
    while True:
        time.sleep(interval_sec)
        try:
            with SYNC_LOCK:
                print("[ElyaAutoWatcher] Checking Moonton GMS API for live MLBB patch changes...")
                sync_meta.build_full_meta_dataset()
        except Exception as e:
            print(f"[ElyaAutoWatcher] Warning during periodic sync: {e}")


def run_server(port=PORT):
    if not os.path.exists(DATA_JSON_PATH):
        print("[ElyaServer] Initial dataset missing, running initial Moonton GMS sync...")
        sync_meta.build_full_meta_dataset()

    watcher = threading.Thread(target=auto_patch_watcher, daemon=True)
    watcher.start()

    server = None
    for candidate_port in [port, 5500, 5173, 8765, 3000, 8000]:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate_port), ElyaDraftHandler)
            port = candidate_port
            break
        except OSError:
            continue
    if server is None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), ElyaDraftHandler)
        port = server.server_address[1]

    print(f"============================================================", flush=True)
    print(f"  ElyaDraftSimulator Server Running!", flush=True)
    print(f"  URL: http://localhost:{port}", flush=True)
    print(f"  Live Patch Auto-Sync Endpoint: POST http://localhost:{port}/api/sync", flush=True)
    print(f"============================================================", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    run_server()
