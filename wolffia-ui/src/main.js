import "./style.css";

let songs = [];
let currentIdx = -1;
let currentLrc = [];
let serverPort = 0;
let selectingFolder = false;

const audio = document.getElementById("audio");
const wrapper = document.getElementById("lyrics-wrapper");
const playerZone = document.getElementById("player-zone");

function initData(songsData, port) {
	songs = songsData;
	serverPort = port;
	const container = document.getElementById("songs");
	container.innerHTML = "";
	songs.forEach((s, i) => {
		const div = document.createElement("div");
		div.className =
			"song-item cursor-pointer overflow-hidden truncate whitespace-nowrap border-b border-[#222] p-3 text-[13px] text-[#777] hover:bg-[#1a1a1a] hover:text-[#eee]";
		div.id = "item-" + i;
		div.innerText = s.name;
		div.onclick = () => playSong(i);
		container.appendChild(div);
	});
}

playerZone.ondblclick = async () => {
	if (selectingFolder) return;
	selectingFolder = true;
	document.getElementById("current-title").innerText = "请选择音乐文件夹";
	try {
		const result = await window.pywebview.api.select_folder();
		if (result) {
			initData(result.songs, result.port);
			document.getElementById("current-title").innerText = "请选择歌曲";
		}
	} finally {
		selectingFolder = false;
	}
};

async function playSong(idx) {
	if (idx >= songs.length) return;
	currentIdx = idx;
	document
		.querySelectorAll(".song-item")
		.forEach((d) =>
			d.classList.remove(
				"active",
				"bg-[#1a1a1a]",
				"font-bold",
				"text-[#1db954]",
			),
		);
	document
		.getElementById("item-" + idx)
		.classList.add("active", "bg-[#1a1a1a]", "font-bold", "text-[#1db954]");
	document.getElementById("current-title").innerText = songs[idx].name;

	audio.src = `http://127.0.0.1:${serverPort}/${encodeURIComponent(songs[idx].name)}`;
	audio.play();

	currentLrc = [];
	wrapper.innerHTML = "";
	parseLyrics(songs[idx].lyrics || []);
}

function parseLyrics(lyrics) {
	currentLrc = lyrics;
	lyrics.forEach(({ text: lyricText }) => {
		const p = document.createElement("div");
		p.className =
			"lrc-line py-2 text-[18px] text-[#444] transition-all duration-300";
		p.innerText = lyricText;
		wrapper.appendChild(p);
	});
}

audio.ontimeupdate = () => {
	const now = audio.currentTime;
	for (let i = 0; i < currentLrc.length; i++) {
		if (
			now >= currentLrc[i].time &&
			(!currentLrc[i + 1] || now < currentLrc[i + 1].time)
		) {
			document.querySelectorAll(".lrc-line").forEach((l, idx) => {
				l.className =
					idx === i
						? "lrc-line lrc-active py-2 text-[26px] font-bold text-white transition-all duration-300"
						: "lrc-line py-2 text-[18px] text-[#444] transition-all duration-300";
			});
			wrapper.style.top = `calc(50% - ${i * 42}px)`;
			break;
		}
	}
};

audio.onended = () => {
	if (currentIdx < songs.length - 1) playSong(currentIdx + 1);
};
