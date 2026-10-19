import mimetypes
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# wfile 是无缓冲写，每个分块一次 send 系统调用。
# 8KB 意味着一首歌上千次 Python 层循环；加大到 256KB 后
# 传输期间基本处于系统调用空闲状态（拖动进度条时尤其明显）
SEND_CHUNK_SIZE = 256 * 1024

_RANGE_PATTERN = re.compile(r"bytes=(\d+)-(\d*)")

# mimetypes 在 Windows 上依赖注册表，mkv 等格式可能查不到或查错，
# 显式映射常见媒体格式保证 Content-Type 正确（视频的编解码器协商依赖它）
_MEDIA_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}


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
        content_type = _MEDIA_MIME_TYPES.get(
            os.path.splitext(full_path)[1].lower()
        ) or mimetypes.guess_type(full_path)[0]
        range_header = self.headers.get("Range")

        start, end = 0, size - 1
        if range_header:
            match = _RANGE_PATTERN.search(range_header)
            if not match:
                self.send_error(416)
                return
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else end
            # 播放器对时长估算偏长（如缺 Xing 头的 VBR MP3）时，
            # seek 到末尾可能请求超出文件末尾的字节；此时返回 416 会让
            # 音频元素进入错误态（此后 seek 全部失效），按最后一个字节处理。
            # 此分支必须先于 start > end 判断：start 越界时 end 仍是 size-1，
            # 越界请求必然满足 start > end，先判会永远到不了这里的兜底
            if start >= size:
                if size == 0:
                    # 空文件没有任何可满足的字节，Range 一律 416
                    self.send_error(416)
                    return
                start = end = size - 1
            elif start > end:
                self.send_error(416)
                return
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
                    buffer = f.read(min(SEND_CHUNK_SIZE, remaining))
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
