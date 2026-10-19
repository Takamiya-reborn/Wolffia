import "./style.css";
import { dom } from "./js/dom.js";
import { refreshIcons } from "./js/icons.js";
import { formatTime } from "./js/utils.js";
import { createLyricsController } from "./js/lyrics.js";

const SEEK_STEP = 5;
const VOLUME_STEP = 0.05;
const TITLE_FADE_WIDTH = 28;
// 列表宽度拖拽范围使用视口比例，避免窗口缩放时与固定像素边界冲突
const LIST_MIN_RATIO = 0.2;
const LIST_MAX_RATIO = 0.5;
const LIST_RESIZE_STEP = 16;
const ALBUM_ART_EXTENSIONS = new Set(["mp3", "flac", "m4a"]);
// 视频由 WebView2 (Chromium) 解码：mp4/webm 原生支持，
// mkv/mov 取决于内置编解码器，不支持时走 onerror 自动跳歌
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mkv", "mov"]);

let songs = [];
let loopMode = "once";
let currentIdx = -1;
let lastVolume = 1;
let serverPort = 0;
let selectingFolder = false;
let directoryVersion = 0;
let songsByDirectory = new Map();
let contextMenuPath = null;
// 随机播放的洗牌队列：shuffleDir 记录队列对应的目录，
// shuffleQueue 保存该目录洗牌后的待播索引（Fisher-Yates），
// 一轮播完才重新洗牌，保证每首歌在一轮内恰好播放一次
let shuffleDir = null;
let shuffleQueue = [];
let artworkMode = false;
let videoMode = false;

const { media, list, listResizer, volume, volumeValue, volumeControl, volumePopup, duration, progress, lyricsBg, lyricsArea, lyricsArtToggle, pinToggle, fullscreenToggle,
	lyricsWrapper: wrapper, lyricsContainer, playToggle, muteToggle, currentTime, playlist, playlistCount,
	loopModeToggle, songContextMenu, titleContextMenu, playbackRateMenu,
	playbackRateToggle, playbackRateOptions, playerHeader, currentTitle, titleText } = dom;
const lyrics = createLyricsController({ wrapper, container: lyricsContainer });

function setArtworkMode(enabled) {
	artworkMode = enabled;
	lyricsArea.classList.toggle("is-artwork-mode", artworkMode);
	lyricsArtToggle.setAttribute("aria-pressed", artworkMode);
	lyricsArtToggle.setAttribute("aria-label", artworkMode ? "显示歌词" : "显示专辑图");
	lyricsArtToggle.title = artworkMode ? "显示歌词" : "显示专辑图";
}

lyricsArtToggle.onclick = () => {
	setArtworkMode(!artworkMode);
};

function isVideoPath(path) {
	const ext = path.substring(path.lastIndexOf(".") + 1).toLowerCase();
	return VIDEO_EXTENSIONS.has(ext);
}

function setVideoMode(enabled) {
	videoMode = enabled;
	lyricsArea.classList.toggle("is-video-mode", enabled);
	// 全屏入口只对视频开放，音乐与空状态时禁用；
	// 歌单自动切到音乐时顺带退出全屏，避免黑屏全屏残留
	fullscreenToggle.disabled = !enabled;
	if (!enabled && document.fullscreenElement) document.exitFullscreen();
}

// —— 视频全屏——
// 直接对 video 元素请求全屏：其余 UI 全部不渲染，画面原生铺满整块屏幕；
// 控制栏随之消失，点画面、按 Esc 或 F 退出
function toggleFullscreen() {
	if (document.fullscreenElement) {
		document.exitFullscreen();
	} else {
		media.requestFullscreen().catch(() => { });
	}
}

fullscreenToggle.onclick = toggleFullscreen;

// 全屏时整个 UI 都不在画面上了，点视频即退出
media.onclick = () => {
	if (document.fullscreenElement === media) document.exitFullscreen();
};

document.addEventListener("fullscreenchange", () => {
	const fullscreen = Boolean(document.fullscreenElement);
	fullscreenToggle.setAttribute("aria-pressed", String(fullscreen));
	fullscreenToggle.setAttribute("aria-label", fullscreen ? "退出全屏 (F)" : "全屏 (F)");
	fullscreenToggle.title = fullscreen ? "退出全屏 (F)" : "全屏 (F)";
	// 元素全屏只覆盖 WebView2 控件区域，无边框全屏由后端同步切换原生窗口；
	// Esc 退出时也走这里，保证两层全屏状态一致
	try {
		window.pywebview.api.set_native_fullscreen(fullscreen).catch(() => { });
	} catch {
		// 后端未就绪时退化为仅 WebView 内全屏
	}
});

// —— 窗口置顶——
let alwaysOnTop = false;

function setPinUI(pinned) {
	alwaysOnTop = pinned;
	pinToggle.classList.toggle("is-pinned", pinned);
	pinToggle.setAttribute("aria-pressed", pinned);
	pinToggle.setAttribute("aria-label", pinned ? "取消窗口置顶" : "窗口置顶");
	pinToggle.title = pinned ? "取消窗口置顶" : "窗口置顶";
}

pinToggle.onclick = async () => {
	const next = !alwaysOnTop;
	try {
		const applied = await window.pywebview.api.set_always_on_top(next);
		// 后端未就绪或置顶失败（返回 false）时保持原状态，UI 与实际行为一致
		if (!applied) return;
	} catch {
		return;
	}
	setPinUI(next);
};

let progressDragging = false;
// 歌曲在拖动进度条期间自然播完时置位，等松手提交 seek 后再恢复播放
let endedWhileDragging = false;
// 连续加载失败的歌曲数：超过阈值说明服务器已不可用，不再自动跳歌
let consecutiveErrors = 0;
let volumeBubbleTimer = 0;
let listResizing = false;

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

progress.addEventListener("pointerdown", () => {
	progressDragging = true;
});
window.addEventListener("pointerup", () => {
	progressDragging = false;
});
window.addEventListener("pointercancel", () => {
	progressDragging = false;
});

// —— 列表宽度拖拽——
function setListWidth(width) {
	const viewportWidth = window.innerWidth;
	const lower = viewportWidth * LIST_MIN_RATIO;
	const upper = viewportWidth * LIST_MAX_RATIO;
	const clamped = Math.min(Math.max(width, lower), upper);
	list.style.setProperty("--list-width", `${(clamped / viewportWidth) * 100}vw`);
}

listResizer.addEventListener("pointerdown", (event) => {
	listResizing = true;
	// 捕获指针，快速拖动时事件仍派发到手柄而非穿透到列表/歌词区
	listResizer.setPointerCapture(event.pointerId);
	document.body.classList.add("is-resizing-list");
});

listResizer.addEventListener("pointermove", (event) => {
	if (listResizing) setListWidth(event.clientX);
});

function endListResize() {
	listResizing = false;
	document.body.classList.remove("is-resizing-list");
}

listResizer.addEventListener("pointerup", endListResize);
listResizer.addEventListener("pointercancel", endListResize);

// 双击复位到默认宽度
listResizer.addEventListener("dblclick", () => {
	setListWidth(window.innerWidth * LIST_MIN_RATIO);
});

// 键盘微调宽度；阻止冒泡，避免触发全局的快进/后退
listResizer.addEventListener("keydown", (event) => {
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	event.stopPropagation();
	const delta =
		event.key === "ArrowRight" ? LIST_RESIZE_STEP : -LIST_RESIZE_STEP;
	setListWidth(list.getBoundingClientRect().width + delta);
});

function updatePlayerState() {
	const hasDuration = Number.isFinite(media.duration) && media.duration > 0;
	if (progressDragging) {
		// 拖动中：进度、时间跟随滑块，不回写 media 的滞后状态
		const sliderValue = Number(progress.value);
		progress.style.setProperty("--progress", `${sliderValue}%`);
		currentTime.innerText = formatTime(
			hasDuration ? (sliderValue / 100) * media.duration : 0,
		);
	} else {
		const percentage = hasDuration ? (media.currentTime / media.duration) * 100 : 0;
		progress.value = percentage;
		progress.style.setProperty("--progress", `${percentage}%`);
		currentTime.innerText = formatTime(media.currentTime);
	}
	duration.innerText = formatTime(media.duration);
	const isPlaying = !media.paused;
	playerHeader.classList.toggle("is-playing", isPlaying);
	playToggle.classList.toggle("is-playing", isPlaying);
	playToggle.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
	playToggle.title = isPlaying ? "暂停 (空格)" : "播放 (空格)";
	const volumePercentage = media.muted ? 0 : media.volume * 100;
	volume.value = volumePercentage / 100;
	volume.style.setProperty("--volume", `${volumePercentage}%`);
	volumeValue.innerText = `${Math.round(volumePercentage)}%`;
	const isMuted = media.muted || media.volume === 0;
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

function renderTree(node, container, parentPath = "") {
	node.directories.forEach((directoryNode, name) => {
		const directoryPath = parentPath ? `${parentPath}/${name}` : name;
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
				renderTree(directoryNode, childrenInner, directoryPath);
				rendered = true;
			}
			const isExpanded = children.classList.toggle("expanded");
			toggle.classList.toggle("expanded", isExpanded);
		};
		toggle.oncontextmenu = (event) => {
			event.preventDefault();
			event.stopPropagation();
			contextMenuPath = directoryPath;
			openSongContextMenu(event.clientX, event.clientY);
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
			contextMenuPath = song.path;
			openSongContextMenu(event.clientX, event.clientY);
		};
		container.appendChild(item);
	});

	refreshIcons(container);
}

function closeSongContextMenu() {
	songContextMenu.hidden = true;
	contextMenuPath = null;
}

// 通用右键菜单定位：弹出前先关闭其它菜单，并夹紧到视口内（四周留 8px 边距）
// 注意：不能无脑调用 closeSongContextMenu()——打开歌曲菜单本身时会把它刚记录的 contextMenuPath 清掉，
// 导致"在资源管理器打开/属性"因 path 为空而失效
function openContextMenu(menu, clientX, clientY) {
	if (menu !== songContextMenu) closeSongContextMenu();
	if (menu !== titleContextMenu) titleContextMenu.hidden = true;
	menu.hidden = false;
	const menuRect = menu.getBoundingClientRect();
	const left = Math.min(clientX, window.innerWidth - menuRect.width - 8);
	const top = Math.min(clientY, window.innerHeight - menuRect.height - 8);
	menu.style.left = `${Math.max(8, left)}px`;
	menu.style.top = `${Math.max(8, top)}px`;
}

function openSongContextMenu(clientX, clientY) {
	openContextMenu(songContextMenu, clientX, clientY);
}

songContextMenu.onclick = async (event) => {
	const action = event.target.closest("[data-action]")?.dataset.action;
	if (!action || !contextMenuPath) return;

	const selectedPath = contextMenuPath;
	closeSongContextMenu();
	if (action === "open-in-explorer") {
		await window.pywebview.api.open_in_explorer(selectedPath);
	} else if (action === "show-properties") {
		await window.pywebview.api.show_properties(selectedPath);
	}
};

document.addEventListener("click", (event) => {
	if (!songContextMenu.hidden && !songContextMenu.contains(event.target)) {
		closeSongContextMenu();
	}
	if (!titleContextMenu.hidden && !titleContextMenu.contains(event.target)) {
		titleContextMenu.hidden = true;
	}
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		closeSongContextMenu();
		titleContextMenu.hidden = true;
	}
});

// 标题栏右键菜单：歌名过长时划词选不全，改为直接整名复制
currentTitle.oncontextmenu = (event) => {
	event.preventDefault();
	titleContextMenu.hidden = true;
	openContextMenu(titleContextMenu, event.clientX, event.clientY);
};

titleContextMenu.onclick = async (event) => {
	const action = event.target.closest("[data-action]")?.dataset.action;
	if (action !== "copy-title") return;

	const selectedTitle = titleText.innerText;
	titleContextMenu.hidden = true;
	try {
		await navigator.clipboard.writeText(selectedTitle);
	} catch {
		// 回退方案：clipboard API 在部分 webview 环境不可用时走 execCommand
		const helper = document.createElement("textarea");
		helper.value = selectedTitle;
		document.body.appendChild(helper);
		helper.select();
		document.execCommand("copy");
		helper.remove();
	}
};

lyricsArea.ondblclick = async (event) => {
	if (event.target.closest("button")) return;
	if (selectingFolder) return;
	selectingFolder = true;
	const previousTitle = titleText.innerText;
	setTitle("请选择音乐文件夹");
	try {
		const result = await window.pywebview.api.select_folder();
		if (result) {
			directoryVersion += 1;
			currentIdx = -1;
			media.pause();
			media.removeAttribute("src");
			media.load();
			setVideoMode(false);
			lyrics.render([]);
			lyricsArea.classList.add("is-no-art");
			setArtworkMode(artworkMode);
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

	// 视频模式与歌词/专辑图互斥，画面层显隐由 CSS 按 is-video-mode 切换
	setVideoMode(isVideoPath(songs[idx].path));
	media.src = `http://127.0.0.1:${serverPort}/${encodeURIComponent(songs[idx].path)}`;
	media.play().catch(() => {
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
	lyricsArea.classList.add("is-no-art");
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
	lyricsArea.classList.remove("is-no-art");
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
				media.pause();
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

		case 'one':
			// 单曲循环：重新播放当前这首
			playSong(currentIdx);
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
	loopModeToggle.classList.remove('is-once', 'is-looping', 'is-one', 'is-random');
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
		case 'one':
			loopModeToggle.classList.add('is-one');
			loopModeToggle.setAttribute('aria-label', '单曲循环');
			loopModeToggle.title = '单曲循环';
			break;
		case 'random':
			loopModeToggle.classList.add('is-random');
			loopModeToggle.setAttribute('aria-label', '随机播放');
			loopModeToggle.title = '随机播放';
			break;
	}
}

loopModeToggle.onclick = () => {
	// 按照 once -> loop -> one -> random -> once 的顺序切换
	if (loopMode === 'once') {
		loopMode = 'loop';
	} else if (loopMode === 'loop') {
		loopMode = 'one';
	} else if (loopMode === 'one') {
		loopMode = 'random';
	} else {
		loopMode = 'once';
	}
	updateLoopModeUI();
};

updateLoopModeUI();
refreshIcons();

media.ontimeupdate = () => {
	updatePlayerState();
	// 拖动中歌词跟随滑块位置（oninput 已更新），timeupdate 不回写，
	// 否则高亮行在实际播放位置与拖动位置之间来回跳跃
	if (!progressDragging) lyrics.update(media.currentTime);
};

function togglePlay() {
	if (!media.src) return;
	if (media.paused) {
		media.play().catch(() => { });
	} else {
		media.pause();
	}
}

function toggleMute() {
	if (media.muted || media.volume === 0) {
		media.volume = lastVolume || 0.7;
		media.muted = false;
	} else {
		lastVolume = media.volume;
		media.muted = true;
	}
	updatePlayerState();
	showVolumeValue();
}

playToggle.onclick = togglePlay;

progress.oninput = () => {
	if (!Number.isFinite(media.duration)) return;
	// 拖动过程中只预览时间与歌词，不提交 seek，
	// 避免高频 seek 造成的抖动、连跳与卡死
	const seekTime = (Number(progress.value) / 100) * media.duration;
	progress.style.setProperty("--progress", `${Number(progress.value)}%`);
	currentTime.innerText = formatTime(seekTime);
	lyrics.update(seekTime);
};

// 松手时才提交一次真正的 seek
progress.onchange = () => {
	if (!Number.isFinite(media.duration)) return;
	media.currentTime = (Number(progress.value) / 100) * media.duration;
	// 歌曲在拖动期间自然播完：ended 被守卫拦下没有切歌，
	// 从松手位置恢复播放；若松手位置已在末尾会再次触发 ended 正常切歌
	if (endedWhileDragging) {
		endedWhileDragging = false;
		media.play().catch(() => { });
	}
};

function setPlaybackRate(rate) {
	media.playbackRate = rate;
	playbackRateToggle.classList.toggle("is-active", rate !== 1);
	playbackRateOptions.forEach((option) => {
		const isSelected = Number(option.dataset.rate) === rate;
		option.classList.toggle("is-selected", isSelected);
		option.setAttribute("aria-checked", isSelected);
	});
}

function setPlaybackRateMenuOpen(open) {
	playbackRateMenu.classList.toggle("is-visible", open);
	playbackRateToggle.setAttribute("aria-expanded", String(open));
}

// 菜单的 hover 显隐由 CSS(.speed-control:hover)处理，这里只同步 aria-expanded；
// 键盘操作（Enter/方向键）走 is-visible，与音量弹层同一套机制
const speedControl = playbackRateToggle.parentElement;
speedControl.addEventListener("mouseenter", () => setPlaybackRateMenuOpen(true));
speedControl.addEventListener("mouseleave", () => setPlaybackRateMenuOpen(false));

playbackRateOptions.forEach((option, index) => {
	option.onclick = () => {
		setPlaybackRate(Number(option.dataset.rate));
	};
	option.onkeydown = (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const offset = event.key === "ArrowDown" ? 1 : -1;
			playbackRateOptions[(index + offset + playbackRateOptions.length) % playbackRateOptions.length].focus();
		}
		if (event.key === "Escape") {
			setPlaybackRateMenuOpen(false);
			playbackRateToggle.focus();
		}
	};
});

playbackRateToggle.onkeydown = (event) => {
	if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		event.stopPropagation();
		setPlaybackRateMenuOpen(true);
		if (event.key === "ArrowDown") playbackRateOptions[0].focus();
	}
	if (event.key === "Escape") setPlaybackRateMenuOpen(false);
};

muteToggle.onclick = toggleMute;

volume.oninput = () => {
	media.volume = Number(volume.value);
	if (media.volume > 0) lastVolume = media.volume;
	media.muted = media.volume === 0;
	updatePlayerState();
	showVolumeValue();
};

volumeControl.addEventListener(
	"wheel",
	(event) => {
		event.preventDefault();
		changeVolumeBy(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
	},
	{ passive: false },
);

function showVolumeValue() {
	// 非悬停状态下（如键盘调音量）顺带把弹层点亮 1.2s
	volumePopup.classList.add("is-visible");
	volumeValue.classList.add("is-visible");
	clearTimeout(volumeBubbleTimer);
	volumeBubbleTimer = setTimeout(() => {
		volumePopup.classList.remove("is-visible");
		volumeValue.classList.remove("is-visible");
	}, 600);
}

// 弹层的 hover 显隐由 CSS(.volume-control:hover)处理，这里只负责非悬停时的短暂点亮

function seekBy(seconds) {
	if (!Number.isFinite(media.duration)) return;
	media.currentTime = Math.min(
		Math.max(media.currentTime + seconds, 0),
		media.duration,
	);
	updatePlayerState();
	lyrics.update(media.currentTime);
}

function changeVolumeBy(delta) {
	const next = Math.min(Math.max(media.volume + delta, 0), 1);
	media.volume = next;
	if (next > 0) lastVolume = next;
	media.muted = next === 0;
	updatePlayerState();
	showVolumeValue();
}

document.addEventListener("keydown", (event) => {
	if (playbackRateMenu.classList.contains("is-visible")) return;
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
		case "f":
		case "F":
			// 与全屏按钮保持一致，仅视频模式下可用
			if (event.repeat || fullscreenToggle.disabled) return;
			event.preventDefault();
			toggleFullscreen();
			break;
	}
});

media.onloadedmetadata = updatePlayerState;
media.onplay = updatePlayerState;
media.onpause = updatePlayerState;

window.addEventListener("resize", () => {
	// 拖宽列表后再缩小窗口时，把宽度收回可用范围内
	setListWidth(list.getBoundingClientRect().width);
	updateTitleMarquee();
	if (currentIdx >= 0) {
		const activeLine = wrapper.querySelector(".lrc-active");
		if (activeLine) {
			lyrics.recenterActive();
		}
	}
});

media.onended = () => {
	updatePlayerState();
	// 拖动期间不切歌，否则会一边拖一边连续跳歌。
	// 注意 seek 只在松手时提交，拖动中触发的 ended 一定是自然播完，
	// 记下来等松手后恢复播放，否则这次切歌会被永远丢弃
	if (progressDragging) {
		endedWhileDragging = true;
		return;
	}
	playNext();
};

// 加载/网络/解码错误不会触发 ended，循环与随机播放链就此中断；
// 出错后 currentTime 赋值也会失效（表现为拖进度条没反应），
// 只有换 src 才能恢复。这里自动跳下一首让播放继续，
// 连续多首失败（如服务器已停止）则由阈值兜底，避免无限切歌
media.onerror = () => {
	if (!media.error || !media.src) return;
	if (consecutiveErrors >= 3) return;
	consecutiveErrors += 1;
	playNext();
};

// 真正开始出声才算播放成功，清零连续出错计数
media.onplaying = () => {
	consecutiveErrors = 0;
};

updatePlayerState();