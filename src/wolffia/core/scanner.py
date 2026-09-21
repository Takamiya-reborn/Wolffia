import ctypes
import os
import re
from functools import cmp_to_key
from pathlib import Path

from wolffia.core.ParseLRC import parse_lrc
from wolffia.core.ParseVTT import parse_vtt

if os.name == "nt":
    _str_cmp_logical = ctypes.WinDLL("Shlwapi.dll").StrCmpLogicalW
    _str_cmp_logical.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p)
    _str_cmp_logical.restype = ctypes.c_int
else:
    _str_cmp_logical = None


def _natural_key(value):
    return [
        (0, int(part)) if part.isdigit() else (1, part.casefold())
        for part in re.split(r"(\d+)", value)
    ]


def _compare_names(left, right):
    if _str_cmp_logical:
        return _str_cmp_logical(left, right)
    left_key = _natural_key(left)
    right_key = _natural_key(right)
    return (left_key > right_key) - (left_key < right_key)


def _compare_paths(left, right):
    left_parts = (
        left.relative_to(left.anchor).parts if left.is_absolute() else left.parts
    )
    right_parts = (
        right.relative_to(right.anchor).parts if right.is_absolute() else right.parts
    )
    for left_part, right_part in zip(left_parts, right_parts):
        comparison = _compare_names(left_part, right_part)
        if comparison:
            return comparison
    return (len(left_parts) > len(right_parts)) - (len(left_parts) < len(right_parts))


MAX_LYRICS_BYTES = 1024 * 1024


def _read_lyrics(path):
    if path.stat().st_size > MAX_LYRICS_BYTES:
        raise ValueError("lyrics file exceeds 1 MiB")
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="gbk")


def _find_lyrics(audio_path):
    base = audio_path.with_suffix("")
    # 优先匹配 audio.ext.vtt，再匹配同名 LRC/WebVTT
    candidates = [
        Path(f"{audio_path}.vtt"),
        Path(f"{base}.lrc"),
        Path(f"{base}.vtt"),
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def scan_folder(folder_path):
    """Scan audio metadata without reading lyric contents."""
    songs = []
    errors = []
    extensions = (".mp3", ".flac", ".wav", ".m4a")
    root = Path(folder_path)
    try:
        audio_files = sorted(
            (
                path
                for path in root.rglob("*")
                if path.is_file() and path.suffix.lower() in extensions
            ),
            key=cmp_to_key(_compare_paths),
        )
    except OSError as error:
        return {"songs": [], "errors": [str(error)]}

    for audio_path in audio_files:
        try:
            lyric_path = _find_lyrics(audio_path)
            relative_path = audio_path.relative_to(root).as_posix()
            songs.append(
                {
                    "name": audio_path.name,
                    "path": relative_path,
                    "lrc": lyric_path.name if lyric_path else None,
                }
            )
        except (OSError, ValueError, RuntimeError) as error:
            errors.append(f"{audio_path}: {error}")
    return {"songs": songs, "errors": errors}


def load_lyrics(folder_path, relative_path):
    """Read and parse one lyric file on demand."""
    root = Path(folder_path).resolve()
    audio_path = (root / relative_path).resolve()
    try:
        audio_path.relative_to(root)
        lyric_path = _find_lyrics(audio_path)
        if not lyric_path:
            return []
        parser = parse_vtt if lyric_path.suffix.lower() == ".vtt" else parse_lrc
        return parser(_read_lyrics(lyric_path))
    except (OSError, UnicodeError, ValueError, RuntimeError, re.error):
        return []
