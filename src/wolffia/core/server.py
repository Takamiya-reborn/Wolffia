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
            if start > end:
                self.send_error(416)
                return
            # 播放器对时长估算偏长（如缺 Xing 头的 VBR MP3）时，
            # seek 到末尾可能请求超出文件末尾的字节；此时返回 416 会让
            # 音频元素进入错误态（此后 seek 全部失效），按最后一个字节处理
            if start >= size:
                start = end = max(size - 1, 0)
            else:
                end = min(end, size - 1)

        chunk_size = (end - start) + 1
        partial = range_header is not None

        # 先打开文件再发响应头：文件被占用或不可读时返回 500，
        # 而不是发完 Content-Length 后中途断流——不完整的响应体
        # 会让音频元素进入错误态、播放链中断
        try:
            f = open(full_path, "rb")
        except OSError:
            self.send_error(500)
            return

        with f:
            # 音频拖动依赖标准 Range 响应
            self.send_response(206 if partial else 200)

            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(chunk_size))
            self.end_headers()

            try:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    buffer = f.read(min(8192, remaining))
                    if not buffer:
                        break
                    self.wfile.write(buffer)
                    remaining -= len(buffer)
            except OSError:
                # Browsers close obsolete Range requests while seeking or
                # buffering; on Windows this surfaces as various OSError
                # subclasses, not just the three explicit ones.
                return


def create_static_server(folder):
    server = ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
    server.document_root = os.path.realpath(folder)
    server.daemon_threads = True
    return server


def start_static_server(folder, port=None):
    server = (
        create_static_server(folder)
        if port is None
        else ThreadingHTTPServer(("127.0.0.1", port), RangeHandler)
    )
    server.document_root = os.path.realpath(folder)
    server.daemon_threads = True
    server.serve_forever()
