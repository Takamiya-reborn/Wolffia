const fs = require("fs");
const path = require("path");

const MAX_LYRICS_BYTES = 1024 * 1024;

// 与 Python 版 scanner.py 一致的白名单；视频由 Chromium 解码，
// mkv/mov 取决于内置编解码器，不支持时前端 onerror 自动跳歌
const EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".m4a",
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".mov",
]);

// 等价 Windows StrCmpLogicalW 的数字感知比较：
// 按连续数字段切分，数字段按数值比、其余按大小写不敏感的字符序比
function naturalCompare(left, right) {
  const leftParts = left.split(/(\d+)/);
  const rightParts = right.split(/(\d+)/);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const a = leftParts[i];
    const b = rightParts[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a !== b) {
      if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        const diff = Number(a) - Number(b);
        // 数值相等视为相同（StrCmpLogicalW 行为），由排序稳定性兜底
        return diff ? (diff < 0 ? -1 : 1) : 0;
      }
      const cmp =
        a.toLowerCase() < b.toLowerCase()
          ? -1
          : a.toLowerCase() > b.toLowerCase()
            ? 1
            : 0;
      if (cmp) return cmp;
    }
  }
  return 0;
}

function splitPathSegments(fullPath) {
  const root = path.win32.parse(fullPath).root;
  const body = root ? fullPath.slice(root.length) : fullPath;
  return body.split(/[\\/]+/).filter(Boolean);
}

function comparePaths(left, right) {
  const leftParts = splitPathSegments(left);
  const rightParts = splitPathSegments(right);
  const len = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < len; i += 1) {
    const a = leftParts[i];
    const b = rightParts[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const cmp = naturalCompare(a, b);
    if (cmp) return cmp;
  }
  return 0;
}

// 优先匹配 audio.ext.vtt，再匹配同名 LRC/WebVTT
function findLyrics(audioPath) {
  const base = audioPath.slice(
    0,
    audioPath.length - path.extname(audioPath).length,
  );
  const candidates = [`${audioPath}.vtt`, `${base}.lrc`, `${base}.vtt`];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 不存在则尝试下一个
    }
  }
  return null;
}

function walk(root, dir, out, errors) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    errors.push(`${dir}: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过符号链接目录，避免循环
      if (entry.isSymbolicLink()) continue;
      walk(root, full, out, errors);
    } else if (
      entry.isFile() &&
      EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push(full);
    }
  }
}

// 返回 {songs: [{name, path, lrc}], errors: []}，与 Python scan_folder 同构
function scanFolder(folderPath) {
  const root = path.resolve(folderPath);
  const files = [];
  const errors = [];
  walk(root, root, files, errors);
  files.sort((a, b) => comparePaths(a, b));

  const songs = [];
  for (const audioPath of files) {
    try {
      const lyricPath = findLyrics(audioPath);
      songs.push({
        name: path.basename(audioPath),
        path: path.relative(root, audioPath).split(path.sep).join("/"),
        lrc: lyricPath ? path.basename(lyricPath) : null,
      });
    } catch (error) {
      errors.push(`${audioPath}: ${error.message}`);
    }
  }
  return { songs, errors };
}

// 返回歌词文件绝对路径（用于 loadLyrics），越界或不存在返回 null
function resolveLyricPath(root, audioRelativePath) {
  const rootResolved = path.resolve(root);
  const audioPath = path.resolve(rootResolved, audioRelativePath);
  const rel = path.relative(rootResolved, audioPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    if (!fs.statSync(audioPath).isFile()) return null;
  } catch {
    return null;
  }
  return findLyrics(audioPath);
}

module.exports = {
  scanFolder,
  resolveLyricPath,
  MAX_LYRICS_BYTES,
  naturalCompare,
};
