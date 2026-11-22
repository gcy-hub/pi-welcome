import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type Theme } from "@earendil-works/pi-coding-agent";
import { colorToRgb, mixColors, parseColor } from "@earendil-works/pi-tui";

export type Palette = { id: string; name: string; background?: string; border?: string; selection?: string; accent: string; gradient: string[]; stops?: number[] };
export const ICON_NAMES = {
	first: ["原始徽标", "终端指令", "分支节点", "Agent 芯片", "像素史莱姆", "像素幽灵", "机甲猫"],
	last: ["原始 π", "方块 π", "阶梯 π", "终端指令", "代码括号", "Agent 面罩", "像素闪电"],
};
export type Preferences = { first: string; last: string; animation: string; palette: string };
export const DEFAULT_PREFERENCES: Preferences = { first: "0", last: "0", animation: "02", palette: "original" };
export const ORIGINAL: Palette = {
	id: "original", name: "原始蓝紫 · 自适应", accent: "#AEABFF",
	gradient: ["#97A9FF", "#AEABFF", "#9E88FF", "#8857F9", "#8344EA", "#7B48EC", "#7655F4"],
	stops: [0, 0.2, 0.35, 0.5, 0.6, 0.8, 1],
};
export const preferencesPath = () => join(getAgentDir(), "pi-welcome.json");

export function parsePalettes(markdown: string): Palette[] {
	return markdown.split("\n").filter((line) => line.includes("**")).map((line) => {
		const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
		const name = cells[0].replaceAll("**", "");
		const colors = cells.slice(1).map((cell) => cell.match(/#[\da-f]{6}/gi) ?? []);
		if (cells.length !== 6 || colors.slice(0, 4).some((column) => column.length !== 1) || colors[4].length !== 3) throw new Error(`配色格式错误：${name}`);
		return { id: name, name, background: colors[0][0], border: colors[1][0], selection: colors[2][0], accent: colors[3][0], gradient: colors[4] };
	});
}

export async function loadPalettes(): Promise<Palette[]> {
	const directory = new URL("./assets/Color/", import.meta.url);
	const files = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
	const palettes = (await Promise.all(files.map(async (name) => parsePalettes(await readFile(new URL(name, directory), "utf8"))))).flat();
	return [ORIGINAL, ...palettes];
}

export function validatePreferences(value: unknown, palettes: Palette[]): Preferences {
	if (!value || typeof value !== "object") throw new Error("欢迎页设置必须是对象");
	const { first = "0", last = "0", animation = "02", palette = "original" } = value as Partial<Preferences>;
	if (![first,last].every(id => typeof id === "string" && /^[0-6]$/.test(id))) throw new Error("欢迎页设置中的图标不存在");
	if (typeof animation !== "string" || !/^0[1-8]$/.test(animation) || !palettes.some((item) => item.id === palette)) throw new Error("欢迎页设置中的动画或配色不存在");
	return { first, last, animation, palette };
}

export async function loadPreferences(palettes: Palette[], path = preferencesPath()): Promise<Preferences> {
	try { return validatePreferences(JSON.parse(await readFile(path, "utf8")), palettes); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_PREFERENCES };
		throw error;
	}
}

export async function savePreferences(preferences: Preferences, path = preferencesPath()) {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`);
	await rename(temporary, path);
}

function isLight(color: ReturnType<typeof parseColor>) {
	const { r, g, b } = colorToRgb(color);
	return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}

export function paletteColors(palette: Palette, theme: Theme) {
	const base = theme.colors.customMessageBg;
	const accent = parseColor(palette.accent);
	const selection = palette.selection ? parseColor(palette.selection) : isLight(base) ? mixColors(base, accent, 0.35, "srgb") : parseColor("#352858");
	return {
		base, accent,
		border: palette.border ? parseColor(palette.border) : undefined,
		selection,
		text: theme.colors.text, muted: theme.colors.muted,
		selectedText: palette.selection ? parseColor(isLight(selection) ? "#20202A" : "#E8E8EE") : theme.colors.text,
		gradient: palette.gradient.map(parseColor),
		stops: palette.stops ?? palette.gradient.map((_, index) => index / (palette.gradient.length - 1)),
	};
}
export type PaletteColors = ReturnType<typeof paletteColors>;
