#!/usr/bin/env python3
"""
A&A Global 1940 — Server-side save/load API
Simple HTTP server using only stdlib — no pip installs needed.

Endpoints:
  GET    /saves          → list all saves (JSON array)
  GET    /saves/<name>   → load a save (JSON)
  POST   /saves/<name>   → write a save (JSON body)
  DELETE /saves/<name>   → delete a save

Run:  python3 saves-api.py [port]   (default port: 8765)
"""

import http.server
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

SAVES_DIR = os.environ.get('AA_SAVES_DIR', os.path.join(os.path.expanduser('~'), 'aa-saves'))
MAX_SAVE_BYTES = 2 * 1024 * 1024  # 2 MB max per save
NAME_RE = re.compile(r'^[\w\- ]{1,64}$')   # safe filename characters only


def safe_path(name):
    """Return absolute path for a save name, or None if invalid."""
    if not NAME_RE.match(name):
        return None
    # Extra guard: no path traversal after joining
    path = os.path.realpath(os.path.join(SAVES_DIR, name + '.json'))
    if not path.startswith(os.path.realpath(SAVES_DIR) + os.sep):
        return None
    return path


class SavesHandler(http.server.BaseHTTPRequestHandler):

    def cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip('/')

        if path in ('', '/saves'):
            # List all saves
            saves = []
            try:
                for fname in sorted(os.listdir(SAVES_DIR)):
                    if not fname.endswith('.json'):
                        continue
                    fp = os.path.join(SAVES_DIR, fname)
                    stat = os.stat(fp)
                    saves.append({
                        'name': fname[:-5],
                        'modified': stat.st_mtime,
                        'size': stat.st_size,
                    })
            except OSError:
                pass
            self.send_json(200, saves)

        elif path.startswith('/saves/'):
            name = path[len('/saves/'):]
            fp = safe_path(name)
            if fp is None:
                return self.send_json(400, {'error': 'Ugyldig navn'})
            if not os.path.isfile(fp):
                return self.send_json(404, {'error': 'Ikke funnet'})
            with open(fp, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.send_json(200, data)

        else:
            self.send_json(404, {'error': 'Ikke funnet'})

    def do_POST(self):
        path = urlparse(self.path).path.rstrip('/')

        if path.startswith('/saves/'):
            name = path[len('/saves/'):]
            fp = safe_path(name)
            if fp is None:
                return self.send_json(400, {'error': 'Ugyldig navn (bruk bokstaver, tall, mellomrom og bindestrek)'})

            length = int(self.headers.get('Content-Length', 0))
            if length > MAX_SAVE_BYTES:
                return self.send_json(413, {'error': 'Filen er for stor'})

            body = self.rfile.read(length)
            try:
                data = json.loads(body.decode('utf-8'))
            except Exception:
                return self.send_json(400, {'error': 'Ugyldig JSON'})

            os.makedirs(SAVES_DIR, exist_ok=True)
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)

            self.send_json(200, {'ok': True})
        else:
            self.send_json(404, {'error': 'Ikke funnet'})

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip('/')

        if path.startswith('/saves/'):
            name = path[len('/saves/'):]
            fp = safe_path(name)
            if fp is None:
                return self.send_json(400, {'error': 'Ugyldig navn'})
            if os.path.isfile(fp):
                os.remove(fp)
            self.send_json(200, {'ok': True})
        else:
            self.send_json(404, {'error': 'Ikke funnet'})

    def log_message(self, fmt, *args):
        # Write minimal log to stdout
        ts = time.strftime('%Y-%m-%d %H:%M:%S')
        print(f'[{ts}] {self.address_string()} {fmt % args}', flush=True)


if __name__ == '__main__':
    os.makedirs(SAVES_DIR, exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.HTTPServer(('127.0.0.1', port), SavesHandler)
    print(f'A&A Saves API listening on 127.0.0.1:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('Server stopped.')
