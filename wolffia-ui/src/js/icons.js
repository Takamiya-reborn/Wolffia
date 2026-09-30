import {
	Play,
	List,
	Music,
	Pause,
	Folder,
	Repeat,
	Shuffle,
	Volume2,
	VolumeX,
	ListMusic,
	ChevronUp,
	ChevronRight,
	Image,
	ImageOff,
	Pin,
	PinOff,
	createIcons,
} from "lucide";

// 统一注册 Lucide 图标，动态渲染列表后可重复调用。
export const lucideIcons = {
	Play,
	List,
	Music,
	Pause,
	Folder,
	Repeat,
	Shuffle,
	Volume2,
	VolumeX,
	ListMusic,
	ChevronUp,
	ChevronRight,
	Image,
	ImageOff,
	Pin,
	PinOff,
};

export function refreshIcons(root = document) {
	createIcons({ icons: lucideIcons, root });
}
