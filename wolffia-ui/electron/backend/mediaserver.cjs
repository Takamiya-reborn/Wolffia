const http = require("http");
const fs = require("fs");
const path = require("path");

// 复刻 Python 版 server.py 的 RangeHandler 语义（含注释里的兜底规则）：
// - Range 起始越界时按最后一个字节返回 206 而非 416——播放器对时长估算
//   偏长（如缺 Xing 头的 VBR MP3）时 seek 到末尾，返回 416 会让音频元素
//   进入错误态、此后 seek 全部失效
// - 空文件没有任何可满足的字节，Range 一律 416
// - 先打开文件再发响应头：文件被占用或不可读时回 500，避免发完
//   Content-Length 后中途断流
// - 256KB 分块：传输期间基本处于系统调用空闲状态，拖动进度条时尤其明显
const SEND_CHUNK_SIZE = 256 * 1024;

// mimetypes 在 Windows 上依赖注册表不可靠，显式映射保证 Content-Type 正确
// （视频的编解码器协商依赖它）
const MEDIA_MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

function sendError(res, code) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/plain");
  res.end(http.STATUS_CODES[code] || String(code));
}

function createMediaServer(folder) {
  const root = fs.realpathSync(folder);
  const server = http.createServer((req, res) => {
    // Web Audio 的 createMediaElementSource 对无 CORS 头的跨源媒体强制静音：
    // 页面源(file:// 或 dev 的 localhost:5173)与 127.0.0.1 端口跨源，
    // 必须带 ACAO，且媒体元素需设 crossOrigin="anonymous"，否则调增益即静音
    res.setHeader("Access-Control-Allow-Origin", "*");
    let rawPath;
    try {
      rawPath = decodeURIComponent(req.url.replace(/^\//, "").split("?")[0]);
    } catch {
      sendError(res, 404);
      return;
    }
    const fullPath = path.resolve(root, rawPath);
    // 限制访问范围
    const rel = path.relative(root, fullPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      sendError(res, 404);
      return;
    }

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      sendError(res, 404);
      return;
    }
    if (!stat.isFile()) {
      sendError(res, 404);
      return;
    }

    const size = stat.size;
    const contentType =
      MEDIA_MIME_TYPES[path.extname(fullPath).toLowerCase()] ||
      "application/octet-stream";
    const rangeHeader = req.headers.range;

    let start = 0;
    let end = size - 1;
    let hasRange = false;
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (!match) {
        sendError(res, 416);
        return;
      }
      hasRange = true;
      start = parseInt(match[1], 10);
      end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size) {
        if (size === 0) {
          sendError(res, 416);
          return;
        }
        start = end = size - 1;
      } else if (start > end) {
        sendError(res, 416);
        return;
      } else {
        end = Math.min(end, size - 1);
      }
    }

    const chunkSize = end - start + 1;

    // 先打开文件再发响应头：文件被占用或不可读时回 500
    let fd;
    try {
      fd = fs.openSync(fullPath, "r");
    } catch {
      sendError(res, 500);
      return;
    }

    // createReadStream 要求 end >= start，空文件直接回空响应体
    if (size === 0) {
      fs.closeSync(fd);
      res.statusCode = 200;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.end();
      return;
    }

    res.statusCode = hasRange ? 206 : 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    if (hasRange) {
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    res.setHeader("Content-Length", String(chunkSize));

    const stream = fs.createReadStream("", {
      fd,
      autoClose: true,
      start,
      end,
      highWaterMark: SEND_CHUNK_SIZE,
    });
    res.on("close", () => stream.destroy());
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { createMediaServer };
