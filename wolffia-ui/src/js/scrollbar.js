// 列表悬浮滚动条：hover 列表且可滚动时浮现，离开即隐藏，支持拖拽拇指。
import { visualToLayout } from "./zoom.js";

export function setupOverlayScrollbar({ scroller, track, thumb }) {
	const HIDE_DELAY = 140;
	const MIN_THUMB = 28;
	let hoverCount = 0;
	let dragging = false;
	let hideTimer = 0;
	let thumbY = 0;
	let dragStartY = 0;
	let dragStartThumbY = 0;

	const scrollable = () => scroller.scrollHeight - scroller.clientHeight > 1;

	function setVisible(show) {
		track.classList.toggle("is-visible", show);
	}

	function placeThumb() {
		const trackH = track.clientHeight;
		const contentH = scroller.scrollHeight;
		const viewH = scroller.clientHeight;
		const maxScroll = contentH - viewH;
		if (maxScroll <= 1 || trackH < MIN_THUMB * 2) return;
		const thumbH = Math.max(MIN_THUMB, Math.round((viewH / contentH) * trackH));
		thumbY = (scroller.scrollTop / maxScroll) * (trackH - thumbH);
		thumb.style.height = `${thumbH}px`;
		thumb.style.transform = `translateY(${thumbY}px)`;
	}

	// 位置与可见性统一走这里：可见 = (鼠标在列表/拇指上 或 拖拽中) 且 可滚动
	function refresh() {
		placeThumb();
		setVisible((hoverCount > 0 || dragging) && scrollable());
	}

	function showNow() {
		clearTimeout(hideTimer);
		refresh();
	}

	function scheduleHide() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(refresh, HIDE_DELAY);
	}

	function enter() {
		hoverCount += 1;
		showNow();
	}

	function leave() {
		// 拖拽期间 setPointerCapture 可能让 leave 先于 enter 到达，钳住避免负数
		hoverCount = Math.max(0, hoverCount - 1);
		scheduleHide();
	}

	scroller.addEventListener("scroll", placeThumb, { passive: true });
	scroller.addEventListener("mouseenter", enter);
	scroller.addEventListener("mouseleave", leave);
	// 拇指非列表子元素，命中测试会顶掉列表 hover，需单独计数保持可见
	thumb.addEventListener("mouseenter", enter);
	thumb.addEventListener("mouseleave", leave);

	thumb.addEventListener("pointerdown", (event) => {
		if (!scrollable()) return;
		event.preventDefault();
		dragging = true;
		dragStartY = event.clientY;
		dragStartThumbY = thumbY;
		thumb.classList.add("is-dragging");
		thumb.setPointerCapture(event.pointerId);
		showNow();
	});

	thumb.addEventListener("pointermove", (event) => {
		if (!dragging) return;
		const maxThumb = track.clientHeight - thumb.offsetHeight;
		const maxScroll = scroller.scrollHeight - scroller.clientHeight;
		if (maxThumb <= 0 || maxScroll <= 0) return;
		// clientY 是视觉像素，thumbY 是布局像素，换算后再求比例
		const delta = visualToLayout(event.clientY - dragStartY);
		const ratio = Math.min(Math.max((dragStartThumbY + delta) / maxThumb, 0), 1);
		scroller.scrollTop = ratio * maxScroll;
	});

	const endDrag = (event) => {
		if (!dragging) return;
		dragging = false;
		thumb.classList.remove("is-dragging");
		if (thumb.hasPointerCapture(event.pointerId)) {
			thumb.releasePointerCapture(event.pointerId);
		}
		scheduleHide();
	};

	thumb.addEventListener("pointerup", endDrag);
	thumb.addEventListener("pointercancel", endDrag);

	// 尺寸变化与内容增删都会改变可滚动状态
	new ResizeObserver(refresh).observe(scroller);
	new MutationObserver(refresh).observe(scroller, { childList: true });

	refresh();
}
