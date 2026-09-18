import "./style.css";
import {
	ChevronUp,
	ListMusic,
	Pause,
	Play,
	Repeat,
	Shuffle,
	Volume2,
	VolumeX,
	createIcons,
} from "lucide";

createIcons({
	icons: {
		ChevronUp,
		ListMusic,
		Pause,
		Play,
		Repeat,
		Shuffle,
		Volume2,
		VolumeX,
	},
});

let songs = [];
let currentIdx = -1;
let currentLrc = [];
let lyricElements = [];
let activeLyricIndex = -1;
let serverPort = 0;
let selectingFolder = false;
let lastVolume = 1;
let loopMode = 'once'; // 'once' | 'loop' | 'random'

const audio = document.getElementById("audio");
const wrapper = document.getElementById("lyrics-wrapper");
const lyricsContainer = document.getElementById("lyrics-container");
const playToggle = document.getElementById("play-toggle");
const progress = document.getElementById("progress");
const currentTime = document.getElementById("current-time");
const duration = document.getElementById("duration");
const playbackRateToggle = document.getElementById("playback-rate-toggle");
const playbackRateLabel = document.getElementById("playback-rate-label");
const playbackRateMenu = document.getElementById("playback-rate-menu");
const playbackRateOptions = [...document.querySelectorAll(".speed-option")];
const muteToggle = document.getElementById("mute-toggle");
const volume = document.getElementById("volume");
const loopModeToggle = document.getElementById('loop-mode-toggle');

function formatTime(seconds) {
	if (!Number.isFinite(seconds)) return "00:00";
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.floor(seconds % 60);
	return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updatePlayerState() {
	const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
	const percentage = hasDuration ? (audio.currentTime / audio.duration) * 100 : 0;
	progress.value = percentage;
	progress.style.setProperty("--progress", `${percentage}%`);
	currentTime.innerText = formatTime(audio.currentTime);
	duration.innerText = formatTime(audio.duration);
	const isPlaying = !audio.paused;
	playToggle.classList.toggle("is-playing", isPlaying);
	playToggle.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
	playToggle.title = isPlaying ? "暂停" : "播放";
	const volumePercentage = audio.muted ? 0 : audio.volume * 100;
	volume.value = volumePercentage / 100;
	volume.style.setProperty("--volume", `${volumePercentage}%`);
	const isMuted = audio.muted || audio.volume === 0;
	muteToggle.classList.toggle("is-muted", isMuted);
	muteToggle.setAttribute("aria-label", isMuted ? "取消静音" : "静音");
	muteToggle.setAttribute("aria-pressed", isMuted);
	muteToggle.title = isMuted ? "取消静音" : "静音";
}

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
		const childrenInner = document.createElement("div");

		directory.className = "directory-node";
		toggle.className = "directory-toggle relative w-full cursor-pointer overflow-hidden border-0 border-b border-[var(--line)] bg-transparent py-3 pr-3 text-left text-[13px] leading-[1.4] whitespace-nowrap text-[#8f958d] text-ellipsis hover:bg-[var(--panel-raised)] hover:text-[#f0f2ec]";
		toggle.type = "button";
		toggle.innerText = name;
		toggle.style.paddingLeft = `${28 + depth * 16}px`;
		toggle.style.setProperty("--arrow-offset", `${12 + depth * 16}px`);

		children.className = "collapsible-wrapper";
		childrenInner.className = "collapsible-inner";

		let rendered = false;
		toggle.onclick = () => {
			if (!rendered) {
				renderTree(directoryNode, childrenInner, depth + 1);
				rendered = true;
			}
			const isExpanded = children.classList.toggle("expanded");
			toggle.classList.toggle("expanded", isExpanded);
		};

		children.appendChild(childrenInner);
		directory.append(toggle, children);
		container.appendChild(directory);
	});

	node.songs.forEach(({ song, index }) => {
		const item = document.createElement("div");
		item.className = "song-item w-full cursor-pointer overflow-hidden border-b border-[var(--line)] py-3 pr-3 text-left text-[13px] leading-[1.4] whitespace-nowrap text-[var(--muted)] text-ellipsis hover:bg-[var(--panel-raised)] hover:text-[#f0f2ec]";
		item.id = "item-" + index;
		item.style.paddingLeft = `${28 + depth * 16}px`;
		item.innerText = song.name;
		item.title = song.path;
		item.onclick = () => playSong(index);
		container.appendChild(item);
	});
}

lyricsContainer.ondblclick = async () => {
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
		.forEach((item) => item.classList.remove("active"));
	document.getElementById("item-" + idx).classList.add("active");
	document.getElementById("current-title").innerText = songs[idx].name;

	audio.src = `http://127.0.0.1:${serverPort}/${encodeURIComponent(songs[idx].path)}`;
	audio.play();

	currentLrc = [];
	lyricElements = [];
	activeLyricIndex = -1;
	wrapper.innerHTML = "";
	parseLyrics(songs[idx].lyrics || []);
}

function parseLyrics(lyrics) {
	currentLrc = lyrics;
	lyricElements = [];
	lyrics.forEach(({ text: lyricText }) => {
		const p = document.createElement("div");
		p.className = "lrc-line px-0 py-[9px] text-[clamp(17px,2vw,21px)] leading-[1.45] text-[#68726c] transition-[color,font-size,opacity] duration-300 ease-in-out";
		p.innerText = lyricText;
		wrapper.appendChild(p);
		lyricElements.push(p)
	});
	requestAnimationFrame(() => centerLyric(0));
}

function centerLyric(index) {
	const line = lyricElements[index];
	if (!line) return;
	const wrapperRect = wrapper.getBoundingClientRect();
	const lineRect = line.getBoundingClientRect();
	const lineOffset = lineRect.top - wrapperRect.top;
	const top =
		lyricsContainer.clientHeight / 2 - lineOffset - lineRect.height / 2;
	wrapper.style.top = `${top}px`;
}

function updateLyrics() {
	const now = audio.currentTime;
	let nextLyricIndex = activeLyricIndex;
	for (let i = currentLrc.length - 1; i >= 0; i--) {
		if (now >= currentLrc[i].time && currentLrc[i].text.trim()) {
			nextLyricIndex = i;
			break;
		}
	}
	if (nextLyricIndex >= 0 && nextLyricIndex !== activeLyricIndex) {
		activeLyricIndex = nextLyricIndex;
		lyricElements.forEach((line, idx) => {
			line.classList.toggle("lrc-active", idx === activeLyricIndex);
		});
		requestAnimationFrame(() => centerLyric(activeLyricIndex));
	}
}

function playNext() {
	if (currentIdx < 0 || currentIdx >= songs.length) return;

	const currentSong = songs[currentIdx];
	const currentPath = currentSong.path;
	const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));

	// 收集同一目录的所有歌曲
	const directorySongs = [];
	songs.forEach((song, index) => {
		const songDir = song.path.substring(0, song.path.lastIndexOf('/'));
		if (songDir === currentDir) {
			directorySongs.push(index);
		}
	});

	if (directorySongs.length === 0) return;

	switch (loopMode) {
		case 'once':
			// 单次播放：播放下一首，如果已经是最后一首则回到第一首但暂停
			const currentPos = directorySongs.indexOf(currentIdx);
			if (currentPos < directorySongs.length - 1) {
				playSong(directorySongs[currentPos + 1]);
			} else {
				// 如果是最后一首，回到第一首但立即暂停
				playSong(directorySongs[0]);
				audio.pause();
			}
			break;

		case 'loop':
			// 循环播放：播放下一首，如果是最后一首则回到第一首
			const loopCurrentPos = directorySongs.indexOf(currentIdx);
			if (loopCurrentPos < directorySongs.length - 1) {
				playSong(directorySongs[loopCurrentPos + 1]);
			} else {
				playSong(directorySongs[0]);
			}
			break;

		case 'random':
			// 随机播放：随机选择一首（除了当前播放的）
			const availableSongs = directorySongs.filter(index => index !== currentIdx);
			if (availableSongs.length > 0) {
				playSong(availableSongs[Math.floor(Math.random() * availableSongs.length)]);
			} else if (directorySongs.length > 0) {
				// 如果只有一首歌，播放它自己
				playSong(directorySongs[0]);
			}
			break;
	}
}

function updateLoopModeUI() {
	loopModeToggle.classList.remove('is-once', 'is-looping', 'is-random');
	switch (loopMode) {
		case 'once':
			loopModeToggle.classList.add('is-once');
			loopModeToggle.setAttribute('aria-label', '单次播放');
			loopModeToggle.title = '单次播放';
			break;
		case 'loop':
			loopModeToggle.classList.add('is-looping');
			loopModeToggle.setAttribute('aria-label', '循环播放');
			loopModeToggle.title = '循环播放';
			break;
		case 'random':
			loopModeToggle.classList.add('is-random');
			loopModeToggle.setAttribute('aria-label', '随机播放');
			loopModeToggle.title = '随机播放';
			break;
	}
}

loopModeToggle.onclick = () => {
	// 按照 once -> loop -> random -> once 的顺序切换
	if (loopMode === 'once') {
		loopMode = 'loop';
	} else if (loopMode === 'loop') {
		loopMode = 'random';
	} else {
		loopMode = 'once';
	}
	updateLoopModeUI();
};

// 初始化循环模式UI
updateLoopModeUI();

audio.ontimeupdate = () => {
	updatePlayerState();
	updateLyrics();
};

playToggle.onclick = () => {
	if (!audio.src) return;
	if (audio.paused) {
		audio.play();
	} else {
		audio.pause();
	}
};

progress.oninput = () => {
	if (!Number.isFinite(audio.duration)) return;
	audio.currentTime = (Number(progress.value) / 100) * audio.duration;
	updatePlayerState();
	updateLyrics();
};

function setPlaybackRate(rate) {
	audio.playbackRate = rate;
	playbackRateLabel.innerText = `${rate}x`;
	playbackRateOptions.forEach((option) => {
		const isSelected = Number(option.dataset.rate) === rate;
		option.classList.toggle("is-selected", isSelected);
		option.setAttribute("aria-checked", isSelected);
	});
}

function closePlaybackRateMenu() {
	playbackRateMenu.hidden = true;
	playbackRateToggle.setAttribute("aria-expanded", "false");
}

playbackRateToggle.onclick = (event) => {
	event.stopPropagation();
	playbackRateMenu.hidden = !playbackRateMenu.hidden;
	playbackRateToggle.setAttribute("aria-expanded", String(!playbackRateMenu.hidden));
};

playbackRateOptions.forEach((option, index) => {
	option.onclick = () => {
		setPlaybackRate(Number(option.dataset.rate));
		closePlaybackRateMenu();
		playbackRateToggle.focus();
	};
	option.onkeydown = (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const offset = event.key === "ArrowDown" ? 1 : -1;
			playbackRateOptions[(index + offset + playbackRateOptions.length) % playbackRateOptions.length].focus();
		}
		if (event.key === "Escape") {
			closePlaybackRateMenu();
			playbackRateToggle.focus();
		}
	};
});

playbackRateToggle.onkeydown = (event) => {
	if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		if (playbackRateMenu.hidden) {
			playbackRateMenu.hidden = false;
			playbackRateToggle.setAttribute("aria-expanded", "true");
		}
		if (event.key === "ArrowDown") playbackRateOptions[0].focus();
	}
	if (event.key === "Escape") closePlaybackRateMenu();
};

document.addEventListener("click", closePlaybackRateMenu);

muteToggle.onclick = () => {
	if (audio.muted || audio.volume === 0) {
		audio.volume = lastVolume || 0.7;
		audio.muted = false;
	} else {
		lastVolume = audio.volume;
		audio.muted = true;
	}
	updatePlayerState();
};

volume.oninput = () => {
	audio.volume = Number(volume.value);
	if (audio.volume > 0) lastVolume = audio.volume;
	audio.muted = audio.volume === 0;
	updatePlayerState();
};

audio.onloadedmetadata = updatePlayerState;
audio.onplay = updatePlayerState;
audio.onpause = updatePlayerState;

window.addEventListener("resize", () => {
	if (currentIdx >= 0) {
		const activeLine = wrapper.querySelector(".lrc-active");
		if (activeLine) {
			requestAnimationFrame(() =>
				centerLyric([...wrapper.children].indexOf(activeLine)),
			);
		}
	}
});

audio.onended = () => {
	updatePlayerState();
	playNext();
};

updatePlayerState();