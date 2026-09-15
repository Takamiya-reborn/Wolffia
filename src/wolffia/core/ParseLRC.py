import re


LRC_LINE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)")


def parse_lrc(text):
	"""Parse LRC timestamps into the common lyric cue format."""
	lyrics = []
	for line in text.splitlines():
		match = LRC_LINE.match(line)
		if match:
			lyrics.append(
				{
					"time": int(match.group(1)) * 60 + float(match.group(2)),
					"text": match.group(3).strip(),
				}
			)
	return sorted(lyrics, key=lambda lyric: lyric["time"])
