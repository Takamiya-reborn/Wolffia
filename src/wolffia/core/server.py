import mimetypes
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        raw_path = self.path.strip("/").split("?")[0]
        path = urllib.parse.unquote(raw_path)

        root = self.server.document_root
        full_path = os.path.realpath(os.path.join(root, path))
        # 限制访问范围
        if os.path.commonpath((root, full_path)) != root:
            self.send_error(404)
            return

        if not os.path.exists(full_path) or os.path.isdir(full_path):
            self.send_error(404)
            return

        size = os.path.getsize(full_path)
        content_type, _ = mimetypes.guess_type(full_path)
        range_header = self.headers.get("Range")

        start, end = 0, size - 1
        if range_header:
            match = re.search(r"bytes=(\d+)-(\d*)", range_header)
            if not match:
                self.send_error(416)
                return
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else end
            if start >= size or start > end:
                self.send_error(416)
                return
            end = min(end, size - 1)

        chunk_size = (end - start) + 1
        partial = range_header is not None
        # 音频拖动依赖标准 Range 响应
        self.send_response(206 if partial else 200)

        self.send_header("Access-Control-Allow-Origin", "*")

        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(chunk_size))
        self.end_headers()

        try:
            with open(full_path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    buffer = f.read(min(8192, remaining))
                    if not buffer:
                        break
                    self.wfile.write(buffer)
                    remaining -= len(buffer)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browsers close obsolete Range requests while seeking or buffering.
            return


def start_static_server(folder, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), RangeHandler)
    server.document_root = os.path.realpath(folder)
    server.daemon_threads = True
    server.serve_forever()
