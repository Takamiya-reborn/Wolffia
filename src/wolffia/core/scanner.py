import os
from pathlib import Path

from wolffia.core.ParseLRC import parse_lrc
from wolffia.core.ParseVTT import parse_vtt


def _read_lyrics(path):
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="gbk")


def _find_lyrics(folder, filename):
    audio_path = Path(folder) / filename
    base = audio_path.with_suffix("")
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
    """Scan audio files and parse their matching LRC or WebVTT lyrics."""
    songs = []
    extensions = (".mp3", ".flac", ".wav", ".m4a")
    for f in sorted(os.listdir(folder_path)):
        if f.lower().endswith(extensions):
            lyric_path = _find_lyrics(folder_path, f)
            lyrics = []
            if lyric_path:
                parser = parse_vtt if lyric_path.suffix.lower() == ".vtt" else parse_lrc
                lyrics = parser(_read_lyrics(lyric_path))
            songs.append(
                {
                    "name": f,
                    "lrc": lyric_path.name if lyric_path else None,
                    "lyrics": lyrics,
                }
            )
    return songs
