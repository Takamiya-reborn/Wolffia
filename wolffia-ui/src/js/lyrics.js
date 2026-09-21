// 管理歌词渲染、当前行高亮和滚动定位。
export function createLyricsController({ wrapper, container }) {
	let lyrics = [];
	let elements = [];
	let activeIndex = -1;
	let centerFrame = 0;
	let pendingCenter = 0;

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
		let low = 0;
		let high = lyrics.length - 1;
		let nextIndex = -1;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			if (currentTime >= lyrics[middle].time) {
				nextIndex = middle;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}
		while (nextIndex >= 0 && !lyrics[nextIndex].text.trim()) nextIndex -= 1;
		if (nextIndex !== activeIndex) {
			const previousIndex = activeIndex;
			activeIndex = nextIndex;
			if (elements[previousIndex]) elements[previousIndex].classList.remove("lrc-active");
			if (elements[activeIndex]) {
				elements[activeIndex].classList.add("lrc-active");
				pendingCenter = activeIndex;
				if (!centerFrame) {
					centerFrame = requestAnimationFrame(() => {
						centerFrame = 0;
						center(pendingCenter);
					});
				}
			}
		}
	}

	function recenterActive() {
		const activeLine = wrapper.querySelector(".lrc-active");
		if (activeLine) requestAnimationFrame(() => center(elements.indexOf(activeLine)));
	}

	return { render, update, recenterActive };
}
