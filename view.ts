import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth, visibleWidth, type Color } from "@earendil-works/pi-tui";
import { ART, borderPath, clamp, flowingColor, frameAt, menuAt, type Animation } from "./art.ts";
import type { PaletteColors } from "./themes.ts";

export type Item = { value: string; label: string };
export type Motion = { cursor: number; top: number; bottom: number; scroll: number };
export const singleLine = (text: string) => text.replace(/[\r\n\t]+/g, " ").trim();

export class Canvas {
	private cells: string[][];
	private overlays: { x: number; y: number; text: string; width: number }[] = [];
	constructor(readonly width: number, readonly height: number, readonly theme: Theme, readonly colors: PaletteColors) {
		this.cells = Array.from({ length: height }, () => Array<string>(width).fill(" "));
	}
	cell(x: number, y: number, char: string, fg: Color, bg?: Color, inverse = false) {
		if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.cells[y][x] = char === "█" && !inverse ? this.theme.style(" ", { bg: fg }) : this.theme.style(char, { fg, inverse, ...(bg ? { bg } : {}) });
	}
	text(x: number, y: number, text: string, width = this.width - x) {
		if (x >= 0 && x < this.width && y >= 0 && y < this.height && width > 0) this.overlays.push({ x, y, text, width: Math.min(width, this.width - x) });
	}
	finish() {
		for (const { x, y, text, width } of this.overlays) {
			const clipped = truncateToWidth(text, width, "");
			const used = visibleWidth(clipped);
			if (!used) continue;
			this.cells[y].fill("", x + 1, x + used);
			this.cells[y][x] = clipped;
		}
		const lines = this.cells.map((row) => row.join(""));
		if (!this.colors.background) return lines;
		const opening = this.theme.style(" ", { bg: this.colors.background }).split(" ")[0];
		return lines.map((line) => this.theme.style(line.replaceAll("\x1b[49m", opening).replaceAll("\x1b[0m", "\x1b[0m" + opening), { bg: this.colors.background }));
	}
}

export function welcomeLayout(width: number, height: number, itemCount: number) {
	const cardWidth = Math.min(84, width - (width >= 44 ? 6 : 2));
	const left = Math.floor((width - cardWidth) / 2);
	const logoWidth = height >= 26 && cardWidth >= 60 ? 28 : height >= 19 && cardWidth >= 38 ? 20 : Math.min(10, cardWidth - 4);
	const logoRows = Math.max(2, Math.round(logoWidth * 5 / 12));
	const stacked = cardWidth - logoWidth - 7 < 12;
	const headerRows = logoRows + (stacked ? 2 : 0);
	const pitch = height >= 18 ? 2 : 1;
	const slots = Math.min(5, itemCount, Math.max(1, Math.floor((height - headerRows - 4) / pitch)));
	const top = Math.max(0, Math.floor((height - headerRows - slots * pitch - 4) / 2));
	const logoX = left + Math.max(2, Math.floor(cardWidth * 0.1));
	const frameTop = top + Math.max(1, Math.floor(logoRows * 0.4));
	const menuTop = top + headerRows + 1;
	const footer = menuTop + slots * pitch + 1;
	return { left, cardWidth, logoWidth, logoRows, logoX, top, frameTop, menuTop, slots, pitch, footer, bottom: footer + 1, stacked };
}

export function paintMenu(canvas: Canvas, items: Item[], x: number, y: number, width: number, slots: number, pitch: number, motion: Motion) {
	if (!items.length || !slots) return;
	const { theme, colors } = canvas;
	const baseHeight = pitch === 2 ? 1.6 : 1;
	const start = y + (motion.top - motion.scroll) * pitch;
	const end = y + (motion.bottom - motion.scroll) * pitch + baseHeight;
	const center = (start + end) / 2;
	const mask = new Float32Array(64);
	for (let row = Math.max(y, Math.floor(start)); row < Math.min(y + slots * pitch, end); row++) {
		for (let v = 0; v < 8; v++) {
			const lo = row + v / 8;
			const coverage = clamp((Math.min(lo + 1 / 8, end) - Math.max(lo, start)) * 8);
			mask.fill(4 * coverage, v * 8, (v + 1) * 8);
		}
		const strip = fitContour(mask);
		for (let i = 0; i < width; i++) paintContour(canvas, x + i, row, strip, colors.selection, colors.background);
	}
	for (let row = 0; row < slots; row++) {
		const item = items[motion.scroll + row];
		const rowY = y + row * pitch;
		const overlap = clamp(Math.min(rowY + 1, end) - Math.max(rowY, start));
		const bg = rowY + 0.5 >= start && rowY + 0.5 < end ? colors.selection : colors.background;
		const label = truncateToWidth(item.label, width - 4, "");
		canvas.text(x + 3, rowY, theme.style(label, { fg: mixColors(colors.muted, colors.text, overlap, "srgb"), bg }), width - 4);
		if (Math.abs(rowY + 0.5 - center) > 0.7) canvas.text(x + 1, rowY, theme.style("•", { fg: colors.muted, bg }), 1);
	}
	const arrowY = Math.round(center - 0.5);
	if (arrowY >= y && arrowY < y + slots * pitch) canvas.text(x + 1, arrowY, theme.style("›", { fg: colors.accent, bg: colors.selection }), 1);
}

function glyph(char: string, filled: (x: number, y: number) => boolean) {
	const pixels = [];
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (filled(x, y)) pixels.push(y * 8 + x);
	return { char, pixels };
}
// Swapping foreground/background also represents the complement of each shape.
const contours = Array.from("▘▝▀▖▌▞▛", (char, i) => glyph(char, (x, y) => !!((i + 1) & (1 << ((x >> 2) + 2 * (y >> 2))))));
for (let n = 1; n <= 7; n++) {
	contours.push(glyph(" ▏▎▍▌▋▊▉"[n], x => x < n), glyph(" ▁▂▃▄▅▆▇"[n], (_, y) => y >= 8 - n));
}

function fitContour(mask: Float32Array) {
	let total = 0;
	for (const value of mask) total += value;
	let best = { char: "█", inside: total / 256, outside: 0 };
	if (total === 0 || total === 256) return best;
	// Two coverage means minimize squared error for a glyph; maximize the variance they explain.
	let max = 0;
	for (const shape of contours) {
		let sum = 0;
		for (const i of shape.pixels) sum += mask[i];
		const n = shape.pixels.length, inside = sum / (4 * n), outside = (total - sum) / (4 * (64 - n));
		const score = n * (64 - n) * (inside - outside) ** 2;
		if (score > max) { best = { char: shape.char, inside, outside }; max = score; }
	}
	return best;
}

function paintContour(canvas: Canvas, x: number, y: number, shape: ReturnType<typeof fitContour>, color: Color, bg?: Color) {
	const { char, inside, outside } = shape;
	if (!inside && !outside) return;
	const shade = (a: number) => a >= 1 ? color : mixColors(bg ?? canvas.colors.base, color, a, "srgb");
	if (inside >= outside) canvas.cell(x, y, char, shade(inside), outside ? shade(outside) : bg);
	else canvas.cell(x, y, char, shade(outside), inside ? shade(inside) : bg, true);
}

const inkCoverage = new Float32Array(128), ringCoverage = new Float32Array(128);
for (let n = 0; n < 16; n++) {
	const code = n.toString(16).charCodeAt(0);
	inkCoverage[code] = Math.min(1, n / 13);
	ringCoverage[code] = Math.min(1, n / 6);
}

export function drawScene(width: number, height: number, theme: Theme, colors: PaletteColors, clip: Animation, elapsed: number, cwd: string, items: Item[], motion: Motion, hint: string) {
	const canvas = new Canvas(width, height, theme, colors);
	const home = homedir();
	const directory = singleLine(cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd);
	if (width < 14 || height < 12) {
		canvas.text(0, 0, theme.style("π", { fg: flowingColor(0, elapsed, colors) }));
		canvas.text(0, 1, theme.style(directory, { fg: colors.text }));
		const count = Math.max(0, Math.min(items.length, height - 3));
		paintMenu(canvas, items, 0, 2, width, count, 1, motion);
		canvas.text(0, height - 1, theme.style(items.length ? "↑↓ Enter Esc" : "Enter/Esc", { fg: colors.accent }));
		return canvas.finish();
	}
	const layout = welcomeLayout(width, height, items.length);
	const { left, cardWidth, logoWidth, logoRows, logoX, top, frameTop, menuTop, slots, pitch, footer, bottom, stacked } = layout;
	const frame = frameAt(clip, elapsed);
	const revealAt = menuAt(clip);
	const path = borderPath(left, frameTop, left + cardWidth - 1, bottom, logoX - 1, logoX + logoWidth + 1);
	const reveal = clamp((elapsed - (revealAt - 600)) / 600);
	for (const { x, y, char } of path.slice(0, Math.floor(path.length * reveal))) {
		const flowing = flowingColor((x - left) / Math.max(1, cardWidth - 1), elapsed, colors);
		canvas.cell(x, y, char, colors.border ?? flowing);
	}
	const [boxX, boxY, boxW, boxH] = ART.box;
	const [x0, y0, x1, y1] = frame.box;
	const ringColor = mixColors(colors.base, colors.muted, 0.23, "srgb");
	const scaleX = boxW / logoWidth * ART.width / 1000, scaleY = boxH / logoRows * ART.height / 626;
	const originX = logoX - boxX * ART.width / 1000 / scaleX, originY = top - boxY * ART.height / 626 / scaleY;
	const xs = Int32Array.from({length: width * 16}, (_, i) => Math.floor(((i + 0.5) / 16 - originX) * scaleX) - x0);
	const ink = new Float32Array(64), ring = new Float32Array(64);
	for (let y = Math.max(0, Math.floor(originY + y0 / scaleY)); y < Math.min(height, originY + y1 / scaleY); y++) {
		for (let x = Math.max(0, Math.floor(originX + x0 / scaleX)); x < Math.min(width, originX + x1 / scaleX); x++) {
			ink.fill(0); ring.fill(0);
			let inkCount = 0, ringCount = 0;
			for (let v = 0; v < 16; v++) {
				const sy = Math.floor((y + (v + 0.5) / 16 - originY) * scaleY);
				if (sy < y0 || sy >= y1) continue;
				const row = (sy - y0) * (x1 - x0);
				for (let u = 0; u < 16; u++) {
					const col = xs[x * 16 + u];
					if (col < 0 || col >= x1 - x0) continue;
					const bin = (v >> 1) * 8 + (u >> 1);
					const a = inkCoverage[frame.ink.charCodeAt(row + col)], b = ringCoverage[frame.circle.charCodeAt(row + col)] * (1 - a);
					ink[bin] += a; ring[bin] += b; inkCount += a; ringCount += b;
				}
			}
			if (!inkCount && !ringCount) continue;
			const fg = inkCount ? flowingColor((x - logoX) / Math.max(1, logoWidth - 1), elapsed, colors) : ringColor;
			const bg = inkCount && ringCount ? mixColors(colors.base, ringColor, clamp(ringCount / (256 - inkCount)), "srgb") : colors.background;
			paintContour(canvas, x, y, fitContour(inkCount ? ink : ring), fg, bg);
		}
	}
	const pathX = stacked ? left + 2 : logoX + logoWidth + 2;
	const pathY = stacked ? top + logoRows : frameTop + 1;
	if (clip.id === "05" && elapsed < revealAt) {
		if (elapsed < 180) canvas.cell(Math.floor(width / 2), Math.floor(height / 2), "▏", colors.accent);
		else {
			const length = Math.floor(clamp((elapsed - 180) / Math.max(1, revealAt - 180)) * directory.length);
			canvas.text(pathX, pathY, theme.style(`${directory.slice(0, length)}▏`, { fg: colors.accent }), left + cardWidth - pathX - 2);
		}
	}
	if (elapsed >= revealAt) {
		canvas.text(pathX, pathY, theme.style(directory, { fg: colors.text }), left + cardWidth - pathX - 2);
		paintMenu(canvas, items, left + 2, menuTop, cardWidth - 4, slots, pitch, motion);
		const help = hint || (items.length ? cardWidth < 44 ? "↑↓ Enter Esc" : "↑/↓ 选择   Enter 继续   Esc 返回" : cardWidth < 30 ? "Enter/Esc" : "Enter/Esc 进入新会话");
		canvas.text(left + 2, footer, theme.style(help, { fg: colors.accent }), cardWidth - 4);
	}
	return canvas.finish();
}
