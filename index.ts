import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, SelectList, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { ART, animationById, modulo, moveShape } from "./art.ts";
import { DEFAULT_PREFERENCES, ICON_NAMES, loadPalettes, loadPreferences, ORIGINAL, paletteColors, savePreferences, type Palette, type Preferences } from "./themes.ts";
import { Canvas, drawScene, paintMenu, singleLine, welcomeLayout, type Item } from "./view.ts";
export { welcomeLayout } from "./view.ts";

type Session = Awaited<ReturnType<typeof SessionManager.list>>[number];
const NEW_SESSION = "+new";
const fields = ["first", "last", "animation", "palette"] as const;
const headings = ["起始徽标", "结束符号", "开机动画", "主题配色"];
const selectedClip = (p: Preferences) => animationById(p.animation, p.first, p.last);
type Options = { palettes?: Palette[]; preferences?: Preferences; intent?: "themes"; save?: (preferences: Preferences) => Promise<void> };

class MenuMotion {
	cursor: number;
	private topFrom: number;
	private bottomFrom: number;
	private down = true;
	private scroll = 0;
	private at = -1000;
	constructor(index = 0) { this.cursor = this.topFrom = this.bottomFrom = index; }
	value(time: number) {
		const { lead, trail } = moveShape(time - this.at);
		return { cursor: this.cursor, top: this.topFrom + (this.cursor - this.topFrom) * (this.down ? trail : lead), bottom: this.bottomFrom + (this.cursor - this.bottomFrom) * (this.down ? lead : trail), scroll: this.scroll };
	}
	resize(rows: number, count: number) {
		this.scroll = Math.max(0, Math.min(count - rows, Math.max(this.cursor - rows + 1, Math.min(this.scroll, this.cursor))));
	}
	move(index: number, time: number, rows: number, count: number, wrap: boolean) {
		const current = this.value(time);
		this.topFrom = wrap ? index : current.top;
		this.bottomFrom = wrap ? index : current.bottom;
		this.down = index > this.cursor;
		this.cursor = index;
		this.resize(Math.max(1, rows), count);
		this.at = time;
	}
}

export class WelcomeScreen {
	private list: SelectList;
	private listRows = 5;
	private readonly items: Item[];
	private timer: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	private motion = new MenuMotion();
	private stage: "sessions" | "before-themes" | "themes" | "after-themes";
	private stageAt: number;
	private previewAt: number;
	private palettes: Palette[];
	private preferences: Preferences;
	private draft: Preferences;
	private column = 0;
	private themeLists: SelectList[];
	private themeMotions: MenuMotion[];
	private themeItems: Item[][];
	private themeRows = 0;
	private saving = false;
	private saveError = "";

	constructor(
		private cwd: string,
		sessions: Session[],
		private tui: Pick<TUI, "terminal" | "requestRender">,
		private theme: Theme,
		private keybindings: KeybindingsManager,
		private done: (value: string | undefined) => void,
		private now: () => number = () => performance.now(),
		private options: Options = {},
	) {
		this.items = sessions.length ? [...sessions.map((session) => ({ value: session.path, label: singleLine(session.name || session.firstMessage || "未命名会话") })), { value: NEW_SESSION, label: "+ 新建会话" }] : [];
		this.list = this.createList(this.items, 5);
		this.palettes = options.palettes ?? [ORIGINAL];
		this.preferences = { ...DEFAULT_PREFERENCES, ...options.preferences };
		this.draft = { ...this.preferences };
		this.stage = options.intent === "themes" ? "before-themes" : "sessions";
		this.stageAt = this.previewAt = this.now();
		this.themeItems = [ICON_NAMES.first, ICON_NAMES.last].map(names => names.map((label, i) => ({ value: String(i), label })));
		this.themeItems.push(ART.clips.map(clip => ({ value: clip.id, label: `${clip.id} ${clip.name}` })), this.palettes.map(p => ({ value: p.id, label: p.name })));
		const indices = fields.map((field, col) => this.themeItems[col].findIndex(item => item.value === this.draft[field]));
		this.themeLists = this.themeItems.map((items, column) => { const list = this.createList(items, 8); list.setSelectedIndex(indices[column]); return list; });
		this.themeMotions = indices.map((index) => new MenuMotion(index));
	}

	private createList(items: Item[], rows: number) {
		return new SelectList(items, rows, { selectedPrefix: (text) => text, selectedText: (text) => text, description: (text) => text, scrollInfo: (text) => text, noMatch: (text) => text });
	}

	private finish(value: string | undefined) {
		if (this.disposed) return;
		this.dispose();
		this.done(value);
	}

	private openThemes(time: number) {
		this.stage = "themes";
		this.previewAt = time;
		this.tui.requestRender();
	}

	private async confirmThemes() {
		this.saving = true;
		this.saveError = "";
		try {
			const selected = { ...this.draft };
			await this.options.save?.(selected);
			if (this.disposed) return;
			this.preferences = selected;
			this.stage = "after-themes";
			this.stageAt = this.now();
		} catch (error) {
			this.saveError = `保存失败：${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.saving = false;
			this.tui.requestRender();
		}
	}

	handleInput(data: string) {
		if (this.disposed || this.saving) return;
		if (this.keybindings.matches(data, "tui.select.cancel")) return this.finish(undefined);
		const time = this.now();
		if (this.stage === "before-themes") {
			if (this.keybindings.matches(data, "tui.select.confirm")) this.openThemes(time);
			return;
		}
		if (this.stage === "after-themes") {
			if (this.keybindings.matches(data, "tui.select.confirm")) { this.stage = "sessions"; this.stageAt = time - selectedClip(this.preferences).duration; this.tui.requestRender(); }
			return;
		}
		if (this.stage === "themes") {
			if (this.keybindings.matches(data, "tui.select.confirm")) return this.confirmThemes();
			if (matchesKey(data, "tab") || matchesKey(data, "shift+tab") || matchesKey(data, "left") || matchesKey(data, "right")) {
				this.column = modulo(this.column + (matchesKey(data, "left") || matchesKey(data, "shift+tab") ? -1 : 1), fields.length);
				this.tui.requestRender();
				return;
			}
		}
		if (this.stage === "sessions" && this.keybindings.matches(data, "tui.select.confirm")) return this.finish(this.items.length ? this.list.getSelectedItem()?.value : NEW_SESSION);
		const picker = this.stage === "themes";
		const list = picker ? this.themeLists[this.column] : this.list;
		const items = picker ? this.themeItems[this.column] : this.items;
		const motion = picker ? this.themeMotions[this.column] : this.motion;
		const before = items.findIndex((item) => item.value === list.getSelectedItem()?.value);
		list.handleInput(data);
		const after = items.findIndex((item) => item.value === list.getSelectedItem()?.value);
		if (before !== after) {
			const wrap = (after < before && this.keybindings.matches(data, "tui.select.down")) || (after > before && this.keybindings.matches(data, "tui.select.up"));
			motion.move(after, time, picker ? this.themeRows : this.listRows, items.length, wrap);
			if (picker) {
				this.draft[fields[this.column]] = items[after].value;
				this.previewAt = time;
			}
		}
		this.tui.requestRender();
	}

	private renderThemes(width: number, height: number, time: number) {
		const palette = this.palettes.find((item) => item.id === this.draft.palette)!;
		const colors = paletteColors(palette, this.theme);
		const canvas = new Canvas(width, height, this.theme, colors);
		const columns = width >= 76 ? [0, 1, 2, 3] : [this.column];
		const colWidth = columns.length === 1 ? Math.min(18, Math.max(6, Math.floor(width * .44))) : Math.min(19, Math.floor(width * .15));
		const previewX = Math.min(width - 1, 1 + columns.length * colWidth);
		const previewWidth = Math.max(1, width - previewX - 1);
		const rows = Math.max(1, height - 8);
		if (rows !== this.themeRows) {
			this.themeLists = this.themeItems.map((items, column) => {
				const selected = this.themeLists[column].getSelectedItem()?.value;
				const list = this.createList(items, rows);
				list.setSelectedIndex(items.findIndex((item) => item.value === selected));
				this.themeMotions[column].resize(rows, items.length);
				return list;
			});
			this.themeRows = rows;
		}
		canvas.text(1, 1, this.theme.style("欢迎页 · 动画与配色", { fg: colors.text }), width - 2);
		for (const [i, column] of columns.entries()) {
			const x = 1 + i * colWidth;
			canvas.text(x, 3, this.theme.style(headings[column], { fg: this.column === column ? colors.accent : colors.muted }), colWidth - 1);
			paintMenu(canvas, this.themeItems[column], x, 5, colWidth - 1, Math.min(rows, this.themeItems[column].length), 1, this.themeMotions[column].value(time));
			for (let y = 3; y < height - 3; y++) canvas.cell(x + colWidth - 1, y, "│", colors.border ?? colors.muted);
		}
		canvas.text(previewX, 3, this.theme.style("实时预览 · 循环播放", { fg: colors.accent }), previewWidth);
		const clip = selectedClip(this.draft);
		const demo = [1, 2, 3].map((index) => ({ value: `demo-${index}`, label: `会话 ${index}` }));
		const preview = drawScene(previewWidth, Math.max(1, height - 7), this.theme, colors, clip, modulo(time - this.previewAt, clip.duration), this.cwd, demo, { cursor: 0, top: 0, bottom: 0, scroll: 0 }, "循环预览");
		preview.forEach((line, row) => canvas.text(previewX, row + 4, line, previewWidth));
		const help = this.saveError || (this.saving ? "正在保存…" : "Tab/←→ 切换列  ↑↓ 选择  Enter 确定  Esc 取消");
		canvas.text(1, height - 2, this.theme.style(help, { fg: colors.accent }), width - 2);
		return canvas.finish();
	}

	render(width: number): string[] {
		if (!this.timer && !this.disposed) { this.timer = setInterval(() => this.tui.requestRender(), 33); this.timer.unref(); }
		const time = this.now(), height = Math.max(1, this.tui.terminal.rows);
		if (this.stage === "themes") return this.renderThemes(width, height, time);
		const clip = selectedClip(this.preferences);
		if (this.stage === "before-themes" && time - this.stageAt >= clip.duration) { this.openThemes(time); return this.renderThemes(width, height, time); }
		if (this.stage === "after-themes" && time - this.stageAt >= clip.duration) this.stage = "sessions";
		const palette = this.palettes.find((item) => item.id === this.preferences.palette)!;
		const rows = width >= 14 && height >= 12 ? Math.max(1, welcomeLayout(width, height, this.items.length).slots) : Math.max(1, height - 3);
		if (rows !== this.listRows) {
			const selected = this.list.getSelectedItem()?.value;
			this.list = this.createList(this.items, rows);
			this.list.setSelectedIndex(Math.max(0, this.items.findIndex((item) => item.value === selected)));
			this.listRows = rows;
			this.motion.resize(rows, this.items.length);
		}
		const hint = this.stage === "before-themes" ? "Enter 跳过预览 · Esc 取消" : this.stage === "after-themes" ? "Enter 进入会话选择 · Esc 返回" : "";
		return drawScene(width, height, this.theme, paletteColors(palette, this.theme), clip, Math.max(0, time - this.stageAt), this.cwd, this.items, this.motion.value(time), hint);
	}

	invalidate() { this.list.invalidate(); for (const list of this.themeLists) list.invalidate(); }
	dispose() { this.disposed = true; clearInterval(this.timer); this.timer = undefined; }
}

async function listSessions(ctx: ExtensionContext) {
	return (await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir())).filter((session) => session.messageCount > 0).sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

export default function (pi: ExtensionAPI) {
	let startupSessions: Session[] | undefined;
	let screen: WelcomeScreen | undefined;
	const open = async (intent: "themes" | undefined, ctx: ExtensionCommandContext) => {
		if (ctx.mode !== "tui") return;
		if (!ctx.isIdle()) { ctx.ui.notify("请在当前任务结束后打开欢迎页", "warning"); return; }
		try {
			const sessions = startupSessions ?? await listSessions(ctx);
			startupSessions = undefined;
			const palettes = await loadPalettes();
			const preferences = await loadPreferences(palettes);
			const choice = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
				screen = new WelcomeScreen(ctx.cwd, sessions, tui, theme, keybindings, done, () => performance.now(), { palettes, preferences, intent, save: savePreferences });
				const welcome = screen;
				// The dialog owns input; the passive overlay covers the entire terminal.
				const overlay = tui.showOverlay(welcome, { row: 0, col: 0, width: "100%", maxHeight: "100%", margin: 0, nonCapturing: true });
				return { capturesViewportInput: true, render: () => [], handleInput: (data: string) => welcome.handleInput(data), invalidate: () => welcome.invalidate(), dispose: () => { overlay.hide(); welcome.dispose(); } };
			}, { blocked: { kind: "question", message: intent === "themes" ? "选择动画与配色" : "选择会话" } });
			if (choice === NEW_SESSION) {
				if (ctx.sessionManager.getEntries().some((entry) => entry.type === "message")) await ctx.newSession();
			} else if (choice && choice !== ctx.sessionManager.getSessionFile()) await ctx.switchSession(choice);
		} catch (error) { ctx.ui.notify(`无法打开欢迎页：${error instanceof Error ? error.message : String(error)}`, "error"); }
		finally { screen?.dispose(); screen = undefined; }
	};
	pi.registerCommand("welcome", { description: "动画欢迎页：选择历史会话或新建会话", handler: (_args, ctx) => open(undefined, ctx) });
	pi.registerCommand("pi-welcome", {
		description: "欢迎页；themes 选择开机动画和主题配色",
		getArgumentCompletions: (prefix) => "themes".startsWith(prefix) ? [{ value: "themes", label: "themes", description: "选择动画和主题配色" }] : [],
		handler: (args, ctx) => {
			const command = args.trim();
			if (command && command !== "themes") { ctx.ui.notify("用法：/pi-welcome [themes]", "warning"); return; }
			return open(command === "themes" ? "themes" : undefined, ctx);
		},
	});
	pi.on("session_shutdown", () => screen?.dispose());
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup" || ctx.mode !== "tui") return;
		startupSessions = await listSessions(ctx);
		pi.sendUserMessage("/welcome", { expandPromptTemplates: true });
	});
}
