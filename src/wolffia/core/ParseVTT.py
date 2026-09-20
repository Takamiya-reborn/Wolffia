import re

VTT_TIMING = re.compile(
    r"(?:(\d{2}):)?(\d{2}):(\d{2}[.,]\d{3})\s+-->\s+"
    r"(?:(?:\d{2}):)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$"
)


def _timestamp(hours, minutes, seconds):
    return int(hours or 0) * 3600 + int(minutes) * 60 + float(seconds.replace(",", "."))


def parse_vtt(text):
    """Parse WebVTT cues into the common lyric cue format."""
    lines = text.lstrip("\ufeff").splitlines()
    lyrics = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        match = VTT_TIMING.match(line)
        if not match:
            index += 1
            continue

        start_text = line.split("-->", 1)[0].strip()
        parts = start_text.split(":")
        if len(parts) == 3:
            start = _timestamp(parts[0], parts[1], parts[2])
        else:
            start = _timestamp(None, parts[0], parts[1])

        index += 1
        cue_lines = []
        while index < len(lines) and lines[index].strip():
            cue_lines.append(lines[index].strip())
            index += 1

        lyric_text = re.sub(r"<[^>]+>", "", " ".join(cue_lines)).strip()
        if lyric_text:
            lyrics.append({"time": start, "text": lyric_text})

    return sorted(lyrics, key=lambda lyric: lyric["time"])
