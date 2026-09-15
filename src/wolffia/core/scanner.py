import os


def scan_folder(folder_path):
    """扫描目录下音频及同名歌词文件"""
    songs = []
    extensions = (".mp3", ".flac", ".wav", ".m4a")
    for f in sorted(os.listdir(folder_path)):
        if f.lower().endswith(extensions):
            base = os.path.splitext(f)[0]
            lrc = next(
                (
                    l
                    for l in [base + ".lrc", base + ".vtt"]
                    if os.path.exists(os.path.join(folder_path, l))
                ),
                None,
            )
            songs.append({"name": f, "lrc": lrc})
    return songs
