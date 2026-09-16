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
	const root = { directories: new Map(), songs: [] };
	songs.forEach((song, index) => {
		const parts = song.path.split("/");
		let node = root;
		parts.slice(0, -1).forEach((directory) => {
			if (!node.directories.has(directory)) {
				node.directories.set(directory, {
					directories: new Map(),
					songs: [],
				});
			}
			node = node.directories.get(directory);
		});
		node.songs.push({ song, index });
	});
	renderTree(root, container, 0);
}

function renderTree(node, container, depth) {
	node.directories.forEach((directoryNode, name) => {
		const directory = document.createElement("div");
		const toggle = document.createElement("button");
		const children = document.createElement("div");
		directory.className = "directory-node";
		toggle.className = "directory-toggle";
		toggle.type = "button";
		toggle.innerText = name;
		toggle.style.paddingLeft = `${28 + depth * 16}px`;
		toggle.style.setProperty("--arrow-offset", `${12 + depth * 16}px`);
		children.className = "directory-children hidden";
		let rendered = false;
		toggle.onclick = () => {
			const expanded = children.classList.toggle("hidden");
			toggle.classList.toggle("expanded", !expanded);
			if (!expanded && !rendered) {
				renderTree(directoryNode, children, depth + 1);
				rendered = true;
			}
		};
		directory.append(toggle, children);
		container.appendChild(directory);
	});

	node.songs.forEach(({ song, index }) => {
		const item = document.createElement("div");
		item.className = "song-item";
		item.id = "item-" + index;
		item.style.paddingLeft = `${28 + depth * 16}px`;
		item.innerText = song.name;
		item.title = song.path;
		item.onclick = () => playSong(index);
		container.appendChild(item);
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

	audio.src = `http://127.0.0.1:${serverPort}/${encodeURIComponent(songs[idx].path)}`;
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
