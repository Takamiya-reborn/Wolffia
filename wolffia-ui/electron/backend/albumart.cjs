const path = require("path");
const fs = require("fs");
const { nativeImage } = require("electron");

// 与 Python api.py 的 extract_album_art 对应：
// 仅处理常见内嵌封面格式；边长 1024 足够覆盖窗口尺寸（歌词背景是两层
// 大半径 blur、专辑图模式全屏展示），一些 FLAC 内嵌 3000px+ 的封面，
// 全尺寸塞给渲染进程是内存波动的主要来源
const ALBUM_ART_SUFFIXES = new Set([".mp3", ".flac", ".m4a"]);
const ALBUM_ART_MAX_EDGE = 1024;
const ALBUM_ART_JPEG_QUALITY = 85;
const CACHE_LIMIT = 16;

// 简单 LRU：超过上限时淘汰最早写入的一项
const cache = new Map();

function sniffImageMime(data) {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngMagic.every((byte, i) => data[i] === byte)) {
    return "image/png";
  }
  return null;
}

// 用 Electron 内置的 nativeImage（Skia）缩放，替代 21MB 的 sharp 原生依赖；
// 解码失败返回 null（调用方回退到原始数据）
function downscaleAlbumArt(data) {
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) {
    return null;
  }
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  if (longest <= ALBUM_ART_MAX_EDGE) {
    return null;
  }
  const scale = ALBUM_ART_MAX_EDGE / longest;
  return image
    .resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      quality: "good",
    })
    .toJPEG(ALBUM_ART_JPEG_QUALITY);
}

// 提取内嵌专辑图并返回 data URI，无图或解析失败返回 null
async function extractAlbumArt(songPath) {
  if (!ALBUM_ART_SUFFIXES.has(path.extname(songPath).toLowerCase())) {
    return null;
  }
  if (cache.has(songPath)) {
    return cache.get(songPath);
  }

  let dataUri = null;
  try {
    const mm = await import("music-metadata");
    const metadata = await mm.parseFile(songPath, { duration: false });
    const image = metadata.common.picture?.[0];
    if (image && image.data && image.data.length) {
      const data = downscaleAlbumArt(image.data) || image.data;
      const mime = sniffImageMime(data) || image.format;
      if (mime) {
        dataUri = `data:${mime};base64,${data.toString("base64")}`;
      }
    }
  } catch {
    // 与 Python 版一致：失败结果也缓存，避免反复解析坏文件
    dataUri = null;
  }

  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(songPath, dataUri);
  return dataUri;
}

module.exports = { extractAlbumArt };
