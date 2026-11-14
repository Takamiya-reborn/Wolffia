// body 被 transform 等比缩放（倍率见 main.js 的 applyUiZoom）。
// getBoundingClientRect / clientX / clientY 返回的是视觉像素，
// 写入布局样式（style.left/width 等）前必须换算回布局像素，否则
// 在缩放非 1 的窗口上会出现位置偏移和宽度复利膨胀。
let zoom = 1;

export function setUiZoom(value) {
	zoom = value;
}

export function visualToLayout(px) {
	return px / zoom;
}
