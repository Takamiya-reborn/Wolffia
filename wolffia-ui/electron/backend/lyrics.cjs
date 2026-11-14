const fs = require("fs");
const path = require("path");
const { resolveLyricPath, MAX_LYRICS_BYTES } = require("./scanner.cjs");

// 与 Python ParseLRC.py / ParseVTT.py 逐行对应，输出同构的 {time, text} 排序数组

// \[(\d+):(\d+(?:\.\d+)?)\](.*)
const LRC_LINE = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)/;

// (?:(\d{2}):)?(\d{2}):(\d{2}[.,]\d{3})\s+-->\s+(?:(?:\d{2}):)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$
const VTT_TIMING = /^(?:(\d{2}):)?(\d{2}):(\d{2}[.,]\d{3})\s+-->\s+(?:(?:\d{2}):)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$/;

function parseLrc(text) {
  const lyrics = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const match = LRC_LINE.exec(line);
    if (match) {
      lyrics.push({
        time: parseInt(match[1], 10) * 60 + parseFloat(match[2]),
        text: match[3].trim(),
      });
    }
  }
  lyrics.sort((a, b) => a.time - b.time);
  return lyrics;
}

function parseVtt(text) {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const lyrics = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    const match = VTT_TIMING.exec(line);
    if (!match) {
      index += 1;
      continue;
    }

    const startText = line.split("-->", 1)[0].trim();
    const parts = startText.split(":");
    let start;
    if (parts.length === 3) {
      start =
        parseInt(parts[0], 10) * 3600 +
        parseInt(parts[1], 10) * 60 +
        parseFloat(parts[2].replace(",", "."));
    } else {
      start = parseInt(parts[0], 10) * 60 + parseFloat(parts[1].replace(",", "."));
    }

    index += 1;
    const cueLines = [];
    while (index < lines.length && lines[index].trim()) {
      cueLines.push(lines[index].trim());
      index += 1;
    }

    // 去掉 WebVTT 内联标签（<c>、<00:00.000> 等）
    const lyricText = cueLines
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (lyricText) {
      lyrics.push({ time: start, text: lyricText });
    }
  }

  lyrics.sort((a, b) => a.time - b.time);
  return lyrics;
}

// utf-8-sig 解码失败回退 GBK（与 Python scanner._read_lyrics 一致）
function decodeBuffer(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf8", 3);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    const { decode } = require("iconv-lite");
    return decode(buffer, "gbk");
  }
}

// 返回 {time, text} 排序数组；越界/无歌词/解析失败一律返回 []
function loadLyrics(root, relativePath) {
  try {
    const lyricPath = resolveLyricPath(root, relativePath);
    if (!lyricPath) return [];
    const stat = fs.statSync(lyricPath);
    if (stat.size > MAX_LYRICS_BYTES) return [];
    const text = decodeBuffer(fs.readFileSync(lyricPath));
    const parser =
      path.extname(lyricPath).toLowerCase() === ".vtt" ? parseVtt : parseLrc;
    return parser(text);
  } catch {
    return [];
  }
}

module.exports = { loadLyrics, parseLrc, parseVtt };
