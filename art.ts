import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { mixColors, parseColor, type Color } from "@earendil-works/pi-tui";
import { ORIGINAL } from "./themes.ts";

export type Frame = { at: number; box: number[]; ink: string; circle: string; menu: boolean };
export type Animation = { id: string; name: string; duration: number; frames: Frame[] };
export type Point = { x: number; y: number };
export type BorderCell = Point & { char: string };
type Atlas = { width: number; height: number; box: number[]; clips: Animation[]; move: number[][] };
export const ART: Atlas = JSON.parse(gunzipSync(readFileSync(new URL("./assets/animations.json.gz", import.meta.url))).toString());
export const COLOR_PERIOD_MS = 7000;
export const modulo = (value: number, length: number) => ((value % length) + length) % length;
export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const original = { gradient: ORIGINAL.gradient.map(parseColor), stops: ORIGINAL.stops! };

export function gradientColor(position: number, colors: { gradient: Color[]; stops: number[] } = original) {
	const index = Math.max(1, colors.stops.findIndex((stop) => position <= stop));
	const start = colors.stops[index - 1], end = colors.stops[index];
	return mixColors(colors.gradient[index - 1], colors.gradient[index], (position - start) / (end - start), "srgb");
}

export function flowingColor(position: number, elapsed: number, colors: { gradient: Color[]; stops: number[] } = original) {
	const phase = modulo(position - elapsed / COLOR_PERIOD_MS * 1.25, 1.25);
	return phase <= 1 ? gradientColor(phase, colors) : mixColors(colors.gradient.at(-1)!, colors.gradient[0], (phase - 1) / 0.25, "srgb");
}

export function animationById(id: string) {
	const clip = ART.clips.find((item) => item.id === id);
	if (!clip) throw new Error(`开机动画不存在：${id}`);
	return clip;
}

export function frameAt(clip: Animation, elapsed: number) {
	let low = 0, high = clip.frames.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (clip.frames[middle].at <= elapsed) low = middle;
		else high = middle - 1;
	}
	return clip.frames[low];
}

export const menuAt = (clip: Animation) => clip.frames.find((frame) => frame.menu)?.at ?? clip.frames.at(-1)!.at;

export function moveShape(milliseconds: number) {
	const samples = ART.move;
	const time = clamp(milliseconds / 480) * samples.at(-1)![0];
	const i = Math.max(1, samples.findIndex(([at]) => at >= time));
	const [a, p, h] = samples[i - 1], [b, q, k] = samples[i];
	const t = (time - a) / (b - a), center = p + (q - p) * t;
	// Move.gif: 34 px resting height, 43 px row pitch.
	const extra = (h + (k - h) * t - 1) * 17 / 43;
	return { lead: center + extra, trail: center - extra, center };
}

export function borderPath(left: number, top: number, right: number, bottom: number, gapLeft: number, gapRight: number): BorderCell[] {
	const cells: BorderCell[] = [];
	const put = (x: number, y: number, char: string) => cells.push({ x, y, char });
	for (let x = gapRight; x < right; x++) put(x, top, "─");
	put(right, top, "╮");
	for (let y = top + 1; y < bottom; y++) put(right, y, "│");
	put(right, bottom, "╯");
	for (let x = right - 1; x > left; x--) put(x, bottom, "─");
	put(left, bottom, "╰");
	for (let y = bottom - 1; y > top; y--) put(left, y, "│");
	put(left, top, "╭");
	for (let x = left + 1; x < gapLeft; x++) put(x, top, "─");
	return cells;
}
