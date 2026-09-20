// 管理歌词渲染、当前行高亮和滚动定位。
export function createLyricsController({ wrapper, container }) {
	let lyrics = [];
	let elements = [];
	let activeIndex = -1;

	function center(index) {
		const line = elements[index];
		if (!line) return;
		const wrapperRect = wrapper.getBoundingClientRect();
		const lineRect = line.getBoundingClientRect();
		const lineOffset = lineRect.top - wrapperRect.top;
		const top = container.clientHeight / 2 - lineOffset - lineRect.height / 2;
		wrapper.style.top = `${top}px`;
	}

	function render(nextLyrics) {
		lyrics = nextLyrics;
		elements = [];
		activeIndex = -1;
		wrapper.innerHTML = "";
		lyrics.forEach(({ text }) => {
			const line = document.createElement("div");
			line.className = "lrc-line px-0 py-[9px] text-[clamp(17px,2vw,21px)] leading-[1.45] text-[#68726c] transition-[color,font-size,opacity] duration-300 ease-in-out";
			line.innerText = text;
			wrapper.appendChild(line);
			elements.push(line);
		});
		requestAnimationFrame(() => center(0));
	}

	function update(currentTime) {
		let nextIndex = activeIndex;
		for (let index = lyrics.length - 1; index >= 0; index -= 1) {
			if (currentTime >= lyrics[index].time && lyrics[index].text.trim()) {
				nextIndex = index;
				break;
			}
		}
		if (nextIndex >= 0 && nextIndex !== activeIndex) {
			activeIndex = nextIndex;
			elements.forEach((line, index) => line.classList.toggle("lrc-active", index === activeIndex));
			requestAnimationFrame(() => center(activeIndex));
		}
	}

	function recenterActive() {
		const activeLine = wrapper.querySelector(".lrc-active");
		if (activeLine) requestAnimationFrame(() => center(elements.indexOf(activeLine)));
	}

	return { render, update, recenterActive };
}
