import "./style.css";
import { dom } from "./js/dom.js";
import { refreshIcons } from "./js/icons.js";
import { formatTime } from "./js/utils.js";
import { createLyricsController } from "./js/lyrics.js";

let songs = [];
let songsByDirectory = new Map();
let serverPort = 0;
let directoryVersion = 0;
let lastVolume = 1;
let currentIdx = -1;
let selectingFolder = false;
let contextMenuSongPath = null;
let loopMode = "once";
// 随机播放的洗牌队列：shuffleDir 记录队列对应的目录，
// shuffleQueue 保存该目录洗牌后的待播索引（Fisher-Yates），
// 一轮播完才重新洗牌，保证每首歌在一轮内恰好播放一次
let shuffleDir = null;
let shuffleQueue = [];

const { audio, volume, volumeValue, duration, progress, lyricsBg, lyricsWrapper: wrapper,
	lyricsContainer, playToggle, muteToggle, currentTime, playlist, playlistCount,
	loopModeToggle, songContextMenu, playbackRateMenu, playbackRateLabel,
	playbackRateToggle, playbackRateOptions, playerHeader, currentTitle, titleText } = dom;
const lyrics = createLyricsController({ wrapper, container: lyricsContainer });
const ALBUM_ART_EXTENSIONS = new Set(["mp3", "flac", "m4a"]);

// 与 style.css 中 --title-fade 保持一致，确保滚动终点刚好露出完整歌名
const TITLE_FADE_WIDTH = 28;

function setTitle(text) {
	titleText.innerText = text;
	updateTitleMarquee();
}

// 测量歌名是否溢出标题栏；溢出时标记为可滚动（悬停触发），
// 振幅 = 溢出量 + 渐隐遮罩宽度，让歌名结尾滚出渐隐区、完整露出后再折返
function updateTitleMarquee() {
	const overflow = titleText.scrollWidth - currentTitle.clientWidth;
	if (overflow > 2) {
		currentTitle.classList.add("is-overflowing");
		currentTitle.style.setProperty(
			"--marquee-amplitude",
			`${overflow + TITLE_FADE_WIDTH}px`,
		);
		// 滚动全程约 4 倍振幅，按此换算时长，下限 6s 避免短溢出时闪动
		currentTitle.style.setProperty(
			"--marquee-duration",
			`${Math.max(6, overflow / 20)}s`,
		);
	} else {
		currentTitle.classList.remove("is-overflowing");
	}
}

// 拖动进度条期间以滑块位置为准，防止 timeupdate 回写进度与拖动互相打架（抖动）
let progressDragging = false;

progress.addEventListener("pointerdown", () => {
	progressDragging = true;
});
window.addEventListener("pointerup", () => {
	progressDragging = false;
});
window.addEventListener("pointercancel", () => {
	progressDragging = false;
});

function updatePlayerState() {
	const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
	if (progressDragging) {
		// 拖动中：进度、时间跟随滑块，不回写 audio 的滞后状态
		const sliderValue = Number(progress.value);
		progress.style.setProperty("--progress", `${sliderValue}%`);
		currentTime.innerText = formatTime(
			hasDuration ? (sliderValue / 100) * audio.duration : 0,
		);
	} else {
		const percentage = hasDuration ? (audio.currentTime / audio.duration) * 100 : 0;
		progress.value = percentage;
		progress.style.setProperty("--progress", `${percentage}%`);
		currentTime.innerText = formatTime(audio.currentTime);
	}
	duration.innerText = formatTime(audio.duration);
	const isPlaying = !audio.paused;
	playerHeader.classList.toggle("is-playing", isPlaying);
	playToggle.classList.toggle("is-playing", isPlaying);
	playToggle.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
	playToggle.title = isPlaying ? "暂停 (空格)" : "播放 (空格)";
	const volumePercentage = audio.muted ? 0 : audio.volume * 100;
	volume.value = volumePercentage / 100;
	volume.style.setProperty("--volume", `${volumePercentage}%`);
	volumeValue.innerText = `${Math.round(volumePercentage)}%`;
	const isMuted = audio.muted || audio.volume === 0;
	muteToggle.classList.toggle("is-muted", isMuted);
	muteToggle.setAttribute("aria-label", isMuted ? "取消静音" : "静音");
	muteToggle.setAttribute("aria-pressed", isMuted);
	muteToggle.title = isMuted ? "取消静音 (M)" : "静音 (M)";
}

function initData(songsData, port) {
	songs = songsData;
	serverPort = port;
	songsByDirectory = new Map();
	songs.forEach((song, index) => {
		const directory = song.path.substring(0, song.path.lastIndexOf('/'));
		if (!songsByDirectory.has(directory)) songsByDirectory.set(directory, []);
		songsByDirectory.get(directory).push(index);
	});
	// 歌单已重建，旧的洗牌队列索引失效
	shuffleDir = null;
	shuffleQueue = [];
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
	renderTree(root, container);
	playlistCount.innerText = `${songs.length} 首`;
}

function renderTree(node, container) {
	node.directories.forEach((directoryNode, name) => {
		const chevron = document.createElement("i");
		const folderIcon = document.createElement("i");
		const children = document.createElement("div");
		const directory = document.createElement("div");
		const toggle = document.createElement("button");
		const folderName = document.createElement("span");
		const childrenInner = document.createElement("div");

		directory.className = "directory-node";
		toggle.className = "directory-toggle flex w-full cursor-pointer items-center gap-1.5 border-0 border-b border-[var(--line)] bg-transparent py-3 pr-3 pl-3 text-left text-[13px] leading-[1.4] text-[#8f958d] hover:bg-[var(--panel-raised)] hover:text-[#f0f2ec]";
		toggle.type = "button";

		chevron.className = "directory-chevron block h-[13px] w-[13px] shrink-0 transition-transform duration-150";
		chevron.dataset.lucide = "chevron-right";
		chevron.setAttribute("aria-hidden", "true");

		folderIcon.className = "block h-3.5 w-3.5 shrink-0";
		folderIcon.dataset.lucide = "folder";
		folderIcon.setAttribute("aria-hidden", "true");

		folderName.className = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
		folderName.innerText = name;

		toggle.append(chevron, folderIcon, folderName);

		children.className = "collapsible-wrapper";
		childrenInner.className = "collapsible-inner";

		let rendered = false;
		toggle.onclick = () => {
			if (!rendered) {
				renderTree(directoryNode, childrenInner);
				rendered = true;
			}
			const isExpanded = children.classList.toggle("expanded");
			toggle.classList.toggle("expanded", isExpanded);
		};

		children.appendChild(childrenInner);
		directory.append(toggle, children);
		container.appendChild(directory);
	});

	// pl-[31px] = pl-3(12px) + chevron(13px) + gap(6px)，让 music 图标与 folder 图标列对齐；
	// 若调整图标尺寸或间距，需同步修改此值
	node.songs.forEach(({ song, index }) => {
		const item = document.createElement("div");
		const songIcon = document.createElement("i");
		const songName = document.createElement("span");

		item.className = "song-item flex w-full cursor-pointer items-center gap-1.5 border-b border-[var(--line)] py-3 pr-3 pl-[31px] text-left text-[13px] leading-[1.4] text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[#f0f2ec]";
		item.id = "item-" + index;

		songIcon.className = "block h-3.5 w-3.5 shrink-0";
		songIcon.dataset.lucide = "music";
		songIcon.setAttribute("aria-hidden", "true");

		songName.className = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
		songName.innerText = song.name;

		item.append(songIcon, songName);
		item.title = song.path;
		item.onclick = () => playSong(index);
		item.oncontextmenu = (event) => {
			event.preventDefault();
			contextMenuSongPath = song.path;
			openSongContextMenu(event.clientX, event.clientY);
		};
		container.appendChild(item);
	});

	refreshIcons(container);
}

function closeSongContextMenu() {
	songContextMenu.hidden = true;
	contextMenuSongPath = null;
}

function openSongContextMenu(clientX, clientY) {
	songContextMenu.hidden = false;
	const menuRect = songContextMenu.getBoundingClientRect();
	const left = Math.min(clientX, window.innerWidth - menuRect.width - 8);
	const top = Math.min(clientY, window.innerHeight - menuRect.height - 8);
	songContextMenu.style.left = `${Math.max(8, left)}px`;
	songContextMenu.style.top = `${Math.max(8, top)}px`;
}

songContextMenu.onclick = async (event) => {
	const action = event.target.closest("[data-action]")?.dataset.action;
	if (!action || !contextMenuSongPath) return;

	const songPath = contextMenuSongPath;
	closeSongContextMenu();
	if (action === "open-in-explorer") {
		await window.pywebview.api.open_in_explorer(songPath);
	} else if (action === "show-properties") {
		await window.pywebview.api.show_properties(songPath);
	}
};

document.addEventListener("click", (event) => {
	if (!songContextMenu.hidden && !songContextMenu.contains(event.target)) {
		closeSongContextMenu();
	}
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closeSongContextMenu();
});

lyricsContainer.ondblclick = async () => {
	if (selectingFolder) return;
	selectingFolder = true;
	const previousTitle = titleText.innerText;
	setTitle("请选择音乐文件夹");
	try {
		const result = await window.pywebview.api.select_folder();
		if (result) {
			directoryVersion += 1;
			currentIdx = -1;
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			lyrics.render([]);
			lyricsBg.classList.remove("is-visible");
			lyricsBg.style.backgroundImage = "";
			initData(result.songs, result.port);
			setTitle("请选择歌曲");
			playerHeader.classList.remove("has-song");
		} else {
			setTitle(previousTitle);
		}
	} finally {
		selectingFolder = false;
	}
};

async function playSong(idx) {
	if (idx >= songs.length) return;
	currentIdx = idx;
	// 手动点播的歌从洗牌队列中移除，避免刚听过的歌很快又被随机到
	const queuePos = shuffleQueue.indexOf(idx);
	if (queuePos !== -1) shuffleQueue.splice(queuePos, 1);
	document
		.querySelectorAll(".song-item")
		.forEach((item) => item.classList.remove("active"));
	document.getElementById("item-" + idx).classList.add("active");
	setTitle(songs[idx].name);
	playerHeader.classList.add("has-song");

	audio.src = `http://127.0.0.1:${serverPort}/${encodeURIComponent(songs[idx].path)}`;
	audio.play().catch(() => {
		// 快速切歌时上一个 play() 可能被新的加载中断（AbortError），忽略即可
	});

	const version = directoryVersion;
	lyrics.render([]);
	loadLyrics(idx, version);
	loadAlbumArt(idx, version);
}

async function loadLyrics(idx, version) {
	try {
		const loadedLyrics = await window.pywebview.api.get_lyrics(songs[idx].path);
		if (version === directoryVersion && idx === currentIdx) lyrics.render(loadedLyrics || []);
	} catch {
		// Missing or unreadable lyric files do not affect playback.
	}
}

async function loadAlbumArt(idx, version) {
	lyricsBg.classList.remove("is-visible");
	lyricsBg.style.backgroundImage = "";
	const songPath = songs[idx].path;
	const ext = songPath.substring(songPath.lastIndexOf(".") + 1).toLowerCase();
	if (!ALBUM_ART_EXTENSIONS.has(ext)) return;
	let art = null;
	try {
		art = await window.pywebview.api.get_album_art(songPath);
	} catch {
		return;
	}
	// 请求期间用户可能已切歌，忽略过期结果
	if (version !== directoryVersion || idx !== currentIdx || !art) return;
	lyricsBg.style.backgroundImage = `url("${art}")`;
	lyricsBg.classList.add("is-visible");
}

// 获取当前目录的洗牌队列；目录变化或一轮播完时重新洗牌。
// 重新洗牌时若第一首恰好是当前正在播放的，与第二首交换，避免跨轮连播同一首
function ensureShuffleQueue(directorySongs, directory) {
	if (shuffleDir !== directory || shuffleQueue.length === 0) {
		const queue = [...directorySongs];
		for (let i = queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[queue[i], queue[j]] = [queue[j], queue[i]];
		}
		if (queue.length > 1 && queue[0] === currentIdx) {
			[queue[0], queue[1]] = [queue[1], queue[0]];
		}
		shuffleDir = directory;
		shuffleQueue = queue;
	}
	return shuffleQueue;
}

function playNext() {
	if (currentIdx < 0 || currentIdx >= songs.length) return;

	const currentSong = songs[currentIdx];
	const currentPath = currentSong.path;
	const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));

	const directorySongs = songsByDirectory.get(currentDir) || [];

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

		case 'random': {
			// 随机播放：按洗牌队列顺序播放，一轮播完后重新洗牌，
			// 避免纯随机抽取导致总在几首歌之间来回跳
			const queue = ensureShuffleQueue(directorySongs, currentDir);
			playSong(queue.shift());
			break;
		}
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

updateLoopModeUI();
refreshIcons();

audio.ontimeupdate = () => {
	updatePlayerState();
	lyrics.update(audio.currentTime);
};

function togglePlay() {
	if (!audio.src) return;
	if (audio.paused) {
		audio.play().catch(() => { });
	} else {
		audio.pause();
	}
}

function toggleMute() {
	if (audio.muted || audio.volume === 0) {
		audio.volume = lastVolume || 0.7;
		audio.muted = false;
	} else {
		lastVolume = audio.volume;
		audio.muted = true;
	}
	updatePlayerState();
	showVolumeValue();
}

playToggle.onclick = togglePlay;

progress.oninput = () => {
	if (!Number.isFinite(audio.duration)) return;
	// 拖动过程中只预览时间与歌词，不提交 seek，
	// 避免高频 seek 造成的抖动、连跳与卡死
	const seekTime = (Number(progress.value) / 100) * audio.duration;
	progress.style.setProperty("--progress", `${Number(progress.value)}%`);
	currentTime.innerText = formatTime(seekTime);
	lyrics.update(seekTime);
};

// 松手时才提交一次真正的 seek
progress.onchange = () => {
	if (!Number.isFinite(audio.duration)) return;
	audio.currentTime = (Number(progress.value) / 100) * audio.duration;
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
		event.stopPropagation();
		if (playbackRateMenu.hidden) {
			playbackRateMenu.hidden = false;
			playbackRateToggle.setAttribute("aria-expanded", "true");
		}
		if (event.key === "ArrowDown") playbackRateOptions[0].focus();
	}
	if (event.key === "Escape") closePlaybackRateMenu();
};

document.addEventListener("click", closePlaybackRateMenu);

muteToggle.onclick = toggleMute;

volume.oninput = () => {
	audio.volume = Number(volume.value);
	if (audio.volume > 0) lastVolume = audio.volume;
	audio.muted = audio.volume === 0;
	updatePlayerState();
	showVolumeValue();
};

volume.addEventListener(
	"wheel",
	(event) => {
		event.preventDefault();
		changeVolumeBy(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
	},
	{ passive: false },
);

let volumeBubbleTimer = 0;
let volumeHovering = false;

function showVolumeValue() {
	volumeValue.classList.add("is-visible");
	if (volumeHovering) return;
	clearTimeout(volumeBubbleTimer);
	volumeBubbleTimer = setTimeout(() => {
		volumeValue.classList.remove("is-visible");
	}, 1200);
}

volume.addEventListener("mouseenter", () => {
	volumeHovering = true;
	clearTimeout(volumeBubbleTimer);
	volumeValue.classList.add("is-visible");
});

volume.addEventListener("mouseleave", () => {
	volumeHovering = false;
	volumeValue.classList.remove("is-visible");
});

const SEEK_STEP = 5;
const VOLUME_STEP = 0.05;

function seekBy(seconds) {
	if (!Number.isFinite(audio.duration)) return;
	audio.currentTime = Math.min(
		Math.max(audio.currentTime + seconds, 0),
		audio.duration,
	);
	updatePlayerState();
	lyrics.update(audio.currentTime);
}

function changeVolumeBy(delta) {
	const next = Math.min(Math.max(audio.volume + delta, 0), 1);
	audio.volume = next;
	if (next > 0) lastVolume = next;
	audio.muted = next === 0;
	updatePlayerState();
	showVolumeValue();
}

document.addEventListener("keydown", (event) => {
	if (!playbackRateMenu.hidden) return;
	if (
		event.target instanceof Element &&
		event.target.closest("#playback-rate-menu")
	)
		return;
	switch (event.key) {
		case "Tab":
			event.preventDefault();
			break;
		case " ":
			if (event.repeat) return;
			event.preventDefault();
			togglePlay();
			break;
		case "ArrowLeft":
			event.preventDefault();
			seekBy(-SEEK_STEP);
			break;
		case "ArrowRight":
			event.preventDefault();
			seekBy(SEEK_STEP);
			break;
		case "ArrowUp":
			event.preventDefault();
			changeVolumeBy(VOLUME_STEP);
			break;
		case "ArrowDown":
			event.preventDefault();
			changeVolumeBy(-VOLUME_STEP);
			break;
		case "m":
		case "M":
			if (event.repeat) return;
			toggleMute();
			break;
	}
});

audio.onloadedmetadata = updatePlayerState;
audio.onplay = updatePlayerState;
audio.onpause = updatePlayerState;

window.addEventListener("resize", () => {
	updateTitleMarquee();
	if (currentIdx >= 0) {
		const activeLine = wrapper.querySelector(".lrc-active");
		if (activeLine) {
			lyrics.recenterActive();
		}
	}
});

audio.onended = () => {
	updatePlayerState();
	// 拖动期间 seek 到结尾触发的 ended 不是自然播完，不切歌，
	// 否则会一边拖一边连续跳歌
	if (progressDragging) return;
	playNext();
};

updatePlayerState();