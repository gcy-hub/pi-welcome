import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const installRoot = process.env.PI_MANAGED_INSTALL_ROOT || `${process.env.HOME}/.pi/agent/install`;
const version = (await readFile(join(installRoot, "current-version"), "utf8")).trim();
const require = createRequire(join(installRoot, "releases", version, "package.json"));
const { createJiti } = require("jiti");
const modules = join(installRoot, "releases", version, "node_modules", "@earendil-works");
const agentPath = join(modules, "pi-coding-agent", "dist", "index.js");
const tuiPath = join(modules, "pi-tui", "dist", "index.js");
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": agentPath, "@earendil-works/pi-tui": tuiPath } });
const { default: extension, WelcomeScreen, welcomeLayout } = await jiti.import("./index.ts");
const { drawScene } = await jiti.import("./view.ts");
const { ART, animationById, frameAt, menuAt, gradientColor, flowingColor, moveShape, COLOR_PERIOD_MS } = await jiti.import("./art.ts");
const { loadPalettes, loadPreferences, savePreferences, validatePreferences, DEFAULT_PREFERENCES } = await jiti.import("./themes.ts");
const { SessionManager } = await import(agentPath);
const { getKeybindings, visibleWidth, styleText, parseColor, colorToHex, stripTerminalSequences, compositeTuiLine } = await import(tuiPath);
const keybindings = getKeybindings();
const theme = { appearance: "dark", colors: { text: parseColor("#e8e8ee"), muted: parseColor("#a0a0aa"), customMessageBg: parseColor("#15151d") }, fg: (_color, text) => text, bold: (text) => text, style: (text, options) => styleText(text, options, "truecolor") };
const root = await mkdtemp(join(tmpdir(), "pi-welcome-test-"));
const sessionDir = join(root, "sessions");
const tui = { terminal: { rows: 32 }, requestRender() {} };
const screens = [];
const plain = (lines) => lines.map(stripTerminalSequences);
const borderCount = (lines) => plain(lines).join("").match(/[─│╭╮╰╯]/g)?.length ?? 0;
function harness() {
	const commands = new Map(), events = new Map(), sent = [];
	extension({ registerCommand: (name, command) => commands.set(name, command), on: (name, callback) => events.set(name, callback), sendUserMessage: (...args) => sent.push(args) });
	return { commands, events, sent };
}
function screenFor(sessions, options = {}, terminal = tui) {
	let time = 0, selected = "pending";
	const screen = new WelcomeScreen(root, sessions, terminal, theme, keybindings, (value) => { selected = value; }, () => time, options);
	screens.push(screen);
	return { screen, at: (ms, width = 80) => { time = ms; return screen.render(width); }, selected: () => selected };
}
try {
	const palettes = await loadPalettes();
	assert.equal(palettes.length, 14);
	assert.deepEqual(palettes.find(p => p.name === "NVIDIA 黑绿").gradient, ["#D8FF78", "#76B900", "#579C0B"]);
	assert.deepEqual(palettes.find((item) => item.name === "极光青紫").gradient, ["#78F6E5", "#7EB8FF", "#AD83FF"]);
	assert.equal(palettes.find((item) => item.name === "纸白荧紫").background, "#F4F2F9");
	const path = join(root, "preferences.json");
	assert.deepEqual(await loadPreferences(palettes, path), DEFAULT_PREFERENCES);
	assert.deepEqual(validatePreferences({ animation: "03", palette: "冰蓝橙" }, palettes), { first: "0", last: "0", animation: "03", palette: "冰蓝橙" });
	const choice = { first: "6", last: "4", animation: "08", palette: "纸白荧紫" };
	await savePreferences(choice, path);
	assert.deepEqual(await loadPreferences(palettes, path), choice);
	assert.throws(() => validatePreferences({ animation: "09", palette: "original" }, palettes));
	assert.throws(() => validatePreferences({ animation: "02", palette: "missing" }, palettes));
	await writeFile(path, "broken json");
	await assert.rejects(loadPreferences(palettes, path));
	for (const [at, hex] of [[0, "#97a9ff"], [0.2, "#aeabff"], [0.35, "#9e88ff"], [0.5, "#8857f9"], [0.6, "#8344ea"], [0.8, "#7b48ec"], [1, "#7655f4"]]) assert.equal(colorToHex(gradientColor(at)), hex);
	for (const x of [0, 0.2, 0.8, 1]) assert.equal(colorToHex(flowingColor(x, 400)), colorToHex(flowingColor(x, 400 + COLOR_PERIOD_MS)));
	assert.equal(colorToHex(flowingColor(1.25 - 1e-8, 0)), colorToHex(flowingColor(0, 0)));
	assert.equal(ART.clips.length, 8);
	for (const base of ART.clips) {
		assert.equal(animationById(base.id, "0", "0"), base);
		const starts = new Set(), ends = new Set();
		for (let n = 1; n <= 6; n++) {
			const first = animationById(base.id, String(n), "0"), last = animationById(base.id, "0", String(n));
			starts.add(first.frames[0].ink); ends.add(last.frames.at(-1).ink);
			assert.equal(first.frames.at(-1).ink, base.frames.at(-1).ink);
			if (["02", "03", "04"].includes(base.id)) assert.equal(last.frames[0].ink, base.frames[0].ink);
			const both = animationById(base.id, String(n), String(n));
			assert.equal(both.frames[0].ink, first.frames[0].ink);
			assert.equal(both.frames.at(-1).ink, last.frames.at(-1).ink);
			assert(menuAt(both) < both.duration && both.frames.at(-1).menu);
		}
		assert.equal(starts.size, 6); assert.equal(ends.size, 6);
	}
	for (const id of ["05", "06", "07"]) for (const frame of animationById(id).frames) {
		const [x, y, right, bottom] = frame.box, stride = right - x;
		for (let row = Math.max(91, y); row < bottom && right > 254; row++) {
			const offset = (row - y) * stride;
			assert(!/[1-9a-f]/.test(frame.ink.slice(offset + Math.max(0, 254 - x), offset + stride)), "reference paths and text must not leak into the live welcome page");
		}
	}
	for (const clip of ART.clips) {
		assert(clip.duration > 2000 && clip.duration < 5000);
		assert(clip.frames.length > 30);
		assert(clip.frames.at(-1).ink.match(/[1-9a-f]/));
		assert(menuAt(clip) > 0 && menuAt(clip) < clip.duration);
		for (const frame of clip.frames) {
			const [x, y, right, bottom] = frame.box;
			assert.equal(frame.ink.length, (right - x) * (bottom - y));
			assert.equal(frame.circle.length, frame.ink.length);
		}
		assert.equal(frameAt(clip, clip.duration + 100), clip.frames.at(-1));
	}
	assert.equal(new Set(ART.clips.map((clip) => [500, 1100, 1700, 2300].map((time) => frameAt(clip, time).ink).join(""))).size, 8, "all reference animations must retain distinct timelines");
	for (const [at, position, height] of ART.move) {
		const { center, lead, trail } = moveShape(at * 480 / 400);
		assert(Math.abs(center - position) < 1e-6 && Math.abs(1 + (lead - trail) * 43 / 34 - height) < 1e-6);
	}

	const sm = SessionManager.create(root, sessionDir);
	const ctx = { mode: "tui", cwd: root, sessionManager: sm, isIdle: () => true };
	const h = harness();
	await h.events.get("session_start")({ reason: "startup" }, ctx);
	assert.equal(h.sent.length, 1);
	for (const title of ["PiD Sliding QDM", "4K sampling"]) {
		const history = SessionManager.create(root, sessionDir);
		history.appendMessage({ role: "user", content: title, timestamp: Date.now() });
		history.appendSessionInfo(title);
		await h.events.get("session_start")({ reason: "startup" }, ctx);
	}
	assert.deepEqual(h.sent, Array.from({ length: 3 }, () => ["/welcome", { expandPromptTemplates: true }]));
	for (const reason of ["reload", "new", "resume", "fork"]) await h.events.get("session_start")({ reason }, ctx);
	await h.events.get("session_start")({ reason: "startup" }, { ...ctx, mode: "rpc" });
	assert.equal(h.sent.length, 3);
	const sessions = await SessionManager.list(root, sessionDir);
	const clip = animationById("02");
	for (const key of ["\r", "\x1b"]) {
		const empty = screenFor([]);
		const text = plain(empty.at(clip.duration)).join("\n");
		assert(text.includes("Enter/Esc") && !text.includes("No matching") && !text.includes("+ 新建会话"));
		empty.screen.handleInput(key);
		assert.equal(empty.selected(), key === "\r" ? "+new" : undefined);
	}
	for (const palette of ["original", "纸白荧紫"]) for (const animation of ART.clips) {
		const view = screenFor(sessions, { palettes, preferences: { animation: animation.id, palette } });
		for (const width of [12, 18, 40, 80, 120]) for (const height of [10, 16, 24, 40]) {
			tui.terminal.rows = height;
			for (const time of [0, menuAt(animation) - 300, animation.duration + 100]) {
				const lines = view.at(time, width);
				assert.equal(lines.length, height);
				assert(lines.every((line) => visibleWidth(line) === width), `${animation.id}/${palette} overflow at ${width}x${height}`);
				for (const line of lines) assert.equal(stripTerminalSequences(compositeTuiLine("MAIN_UI ".repeat(width), line, 0, width, width)), stripTerminalSequences(line));
			}
		}
		view.screen.dispose();
	}
	tui.terminal.rows = 32;
	const view = screenFor(sessions);
	for (const time of [0, clip.duration]) {
		assert(/[▏▎▍▋▊▉▁▂▃▅▆▇]/.test(plain(view.at(time)).join("")), "both the circle and pi need contours finer than half a cell");
	}
	const aurora = screenFor(sessions, { palettes, preferences: { animation: "02", palette: "极光青紫" } });
	assert(aurora.at(clip.duration).some(line => line.includes("38;2;84;107;139")), "paint the supplied border RGB");
	assert(borderCount(view.at(clip.duration)) > borderCount(view.at(0)));
	assert.notDeepEqual(view.at(clip.duration), view.at(clip.duration + 700));
	view.screen.handleInput("\r");
	assert.equal(view.selected(), sessions[0].path);
	const wrap = screenFor(sessions);
	const longTitle = screenFor([{ ...sessions[0], name: "https://example.org/开源项目/".repeat(10) }], { palettes, preferences: { animation: "03", palette: "冰蓝橙" } });
	const fixed = longTitle.at(5000, 118);
	assert(!/[◢◣◤◥]/.test(plain(fixed).join("")));
	const layout = welcomeLayout(118, 32, 2);
	// With only black and white inputs, gray at an edge must come from fractional coverage.
	const black = parseColor("#000000"), white = parseColor("#ffffff");
	const bw = { base: black, selection: white, selectedText: white, accent: white, text: white, muted: white, border: white, gradient: [white, white], stops: [0, 1] };
	const sample = drawScene(118, 32, theme, bw, clip, clip.duration, "/cwd", [{ label: "", value: "1" }, { label: "", value: "2" }], { cursor: 0, scroll: 0, top: 0, bottom: 0 }, "");
	const gray = (line) => [...line.matchAll(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/g)].some(([,r,g,b]) => r === g && g === b && +r > 0 && +r < 255);
	assert(sample.slice(layout.top, layout.menuTop).some(gray), "pi edges must have antialiasing");
	const stepped = animationById("02", "5", "2");
	const settled = drawScene(118, 32, theme, bw, stepped, stepped.duration, "/cwd", [], { cursor: 0, scroll: 0, top: 0, bottom: 0 }, "");
	const iconTop = welcomeLayout(118, 32, 0).top;
	const glyphRows = settled.slice(iconTop, iconTop + layout.logoRows);
	assert(glyphRows.some(line => /[▏▎▍▋▊▉▁▂▃▅▆▇▘▝▀▖▌▞▛]/.test(plain([line])[0])), "stepped pi must retain sub-cell edges");
	assert(!glyphRows.some(gray), "solid glyph edges must not add a tinted fringe");
	for (const [width, height] of [[36, 16], [50, 24], [118, 32]]) {
		const particleFrames = [680, 760, 800, 950, 1100].map(t => {
			const lines = drawScene(width, height, theme, bw, stepped, t, "/cwd", [], { cursor: 0, scroll: 0, top: 0, bottom: 0 }, "");
			assert((lines.join("").match(/\x1b\[(?:38|48);2;/g) ?? []).length >= 12, `particle cloud vanished at ${t}ms, ${width}x${height}`);
			return lines.join("");
		});
		assert.equal(new Set(particleFrames).size, particleFrames.length, "particle cloud must move through the handoff");
	}
	for (let first = 0; first <= 6; first++) {
		const start = animationById("02", String(first), "2");
		const opening = drawScene(118, 32, theme, { ...bw, muted: black }, start, 0, "/cwd", [], { cursor: 0, scroll: 0, top: 0, bottom: 0 }, "");
		const tones = [...opening.join("").matchAll(/\x1b\[(?:38|48);2;(\d+);\d+;\d+m/g)].map(m => +m[1]);
		assert(tones.includes(255) && tones.every(n => n === 0 || n >= 127), `badge ${first}: outer edge must not paint dim gray cells`);
		if (first === 5) assert(tones.some(n => n > 127 && n < 250), "opening badge must retain internal shading");
	}
	assert.equal((sample[layout.menuTop].match(/\x1b\[48;2;255;255;255m/g) ?? []).length, layout.cardWidth - 4, "full-width highlight, including both top corners");
	const bottomEdge = plain([sample[layout.menuTop + 1]])[0].slice(layout.left + 2, layout.left + layout.cardWidth - 2);
	for (const top of [0.2, 0.3]) {
		const moving = drawScene(118, 32, theme, bw, clip, clip.duration, "/cwd", [{ label: "pi-welcome插件", value: "1" }, { label: "新建会话", value: "2" }], { cursor: 1, scroll: 0, top, bottom: 0.8 }, "");
		const row = moving[layout.menuTop];
		assert(!/[▏-▟]/u.test(plain([row])[0]), "moving highlight must not draw a separate strip after the title");
		assert.equal(row.includes("\x1b[48;2;255;255;255m"), top === 0.2, "the whole title row switches background at its midpoint");
	}
	assert.equal(new Set(bottomEdge).size, 1, "bottom corners must have the same height as the center");
	for (const time of [5000, 5072, 5480]) {
		if (time === 5000) longTitle.screen.handleInput("\x1b[B");
		const rows = longTitle.at(time, 118);
		for (const row of rows.slice(layout.menuTop, layout.menuTop + 4)) {
			let bg = "default", inverse = false;
			for (const [token] of row.matchAll(/\x1b\[[\d;]*m|[^\x1b]+/g)) {
				if (token === "\x1b[0m" || token === "\x1b[49m") bg = "default";
				else if (token.startsWith("\x1b[48;")) bg = token;
				if (token === "\x1b[7m") inverse = true;
				if (token === "\x1b[0m" || token === "\x1b[27m") inverse = false;
				if (/^ {10,}$/.test(token)) assert(bg === "default" && !inverse, "blank margin must keep the terminal background after clipped text");
			}
		}
		if (time === 5480) assert(!rows[layout.menuTop].includes(";64;41;29m"), "no highlight remains on the previous row");
	}
	wrap.screen.handleInput("\x1b[A"); wrap.screen.handleInput("\r");
	assert.equal(wrap.selected(), "+new");
	const many = Array.from({ length: 30 }, (_, i) => ({ ...sessions[0], path: `/${i}`, name: `History ${String(i).padStart(2, "0")}` }));
	const scrolling = screenFor(many);
	const viewport = welcomeLayout(80, 32, many.length + 1);
	const initial = plain(scrolling.at(5000));
	scrolling.screen.handleInput("\x1b[B");
	const moving = scrolling.at(5060);
	const down = scrolling.screen.motion.value(5060);
	assert(down.bottom > down.top && down.bottom > 0);
	scrolling.screen.handleInput("\x1b[A");
	const reverse = scrolling.screen.motion.value(5060);
	assert.equal(reverse.bottom, down.bottom);
	assert.equal(reverse.top, down.top);
	scrolling.at(5540); scrolling.screen.handleInput("\x1b[B"); scrolling.at(6020);
	scrolling.screen.handleInput("\x1b[A");
	const up = scrolling.screen.motion.value(6080);
	assert(up.top < up.bottom && up.top < 1);
	scrolling.at(6500); scrolling.screen.handleInput("\x1b[B");
	for (const time of [6560, 6620, 6760, 6980]) {
		const lines = plain(scrolling.at(time));
		for (let i = 0; i < viewport.slots; i++) {
			const row = viewport.menuTop + i * viewport.pitch;
			assert.equal(lines[row].indexOf(`History ${String(i).padStart(2, "0")}`), initial[row].indexOf(`History ${String(i).padStart(2, "0")}`), "labels must stay fixed while the highlight moves");
		}
	}
	assert.notDeepEqual(moving, scrolling.at(7000));
	const labels = (time) => plain(scrolling.at(time)).flatMap(line => line.match(/History \d\d|\+ 新建会话/g) ?? []);
	for (let i = 0; i < 29; i++) scrolling.screen.handleInput("\x1b[B");
	const tail = ["History 26", "History 27", "History 28", "History 29", "+ 新建会话"];
	const head = ["History 00", "History 01", "History 02", "History 03", "History 04"];
	assert.deepEqual(labels(7500), tail);
	scrolling.screen.handleInput("\x1b[B");
	assert.deepEqual(labels(7500), head);
	assert.deepEqual(scrolling.screen.motion.value(7500), { cursor: 0, top: 0, bottom: 0, scroll: 0 });
	scrolling.screen.handleInput("\x1b[A");
	assert.deepEqual(labels(7500), tail);
	scrolling.screen.handleInput("\x1b[B");
	scrolling.screen.handleInput("\r"); assert.equal(scrolling.selected(), "/0");

	const saved = [];
	const editor = screenFor(sessions, { palettes, intent: "themes", save: async (value) => { saved.push(value); } });
	assert(!plain(editor.at(0)).join("").includes("开机动画"));
	let chooser = editor.at(clip.duration);
	assert(plain(chooser).join("").includes("开机动画") && plain(chooser).join("").includes("主题配色"));
	for (const heading of ["起始徽标", "结束符号"]) assert(plain(chooser).join("").includes(heading));
	for (let i = 0; i < 2; i++) { editor.screen.handleInput("\x1b[B"); editor.screen.handleInput("\t"); }
	editor.screen.handleInput("\x1b[B");
	editor.screen.handleInput("\t");
	editor.screen.handleInput("\x1b[B");
	chooser = editor.at(clip.duration + 10);
	assert.equal(chooser[0], " ".repeat(80), "theme picker must leave the terminal background untouched");
	assert(chooser.some(line => line.includes("38;2;84;107;139")), "preview must still apply the selected border color");
	assert.notDeepEqual(chooser, editor.at(clip.duration + 500), "preview must keep playing");
	await editor.screen.handleInput("\r");
	assert.deepEqual(saved, [{ first: "1", last: "1", animation: "03", palette: "极光青紫" }]);
	assert.equal(editor.selected(), "pending");
	assert(!plain(editor.at(clip.duration + 501)).join("").includes("开机动画"), "confirmation must replay the chosen startup animation");
	editor.at(clip.duration + 500 + animationById("03").duration);
	editor.screen.handleInput("\r");
	assert.equal(editor.selected(), sessions[0].path, "after replay, Enter must select a session");
	const cancelled = screenFor(sessions, { palettes, intent: "themes", save: async () => { throw new Error("cancel must not save"); } });
	cancelled.screen.handleInput("\r"); cancelled.screen.handleInput("\x1b"); assert.equal(cancelled.selected(), undefined);
	const failed = screenFor(sessions, { palettes, intent: "themes", save: async () => { throw new Error("disk full"); } });
	failed.screen.handleInput("\r"); await failed.screen.handleInput("\r");
	assert(plain(failed.at(5000)).join("").includes("disk full"));
	assert.equal(failed.selected(), "pending");
	for (const width of [12, 40, 80, 120]) for (const height of [10, 24, 40]) {
		tui.terminal.rows = height;
		const lines = failed.at(6000, width);
		assert.equal(lines.length, height);
		assert(lines.every((line) => visibleWidth(line) === width), "theme editor must fit narrow terminals");
	}
	tui.terminal.rows = 32;
	let renders = 0;
	const timed = screenFor(sessions, {}, { terminal: { rows: 32 }, requestRender() { renders++; } });
	timed.at(0); await new Promise((resolve) => setTimeout(resolve, 100)); assert(renders > 0);
	timed.screen.handleInput("\x1b"); const stopped = renders;
	await new Promise((resolve) => setTimeout(resolve, 80)); assert.equal(renders, stopped);

	let switched, newCount = 0, input = "\r";
	ctx.ui = { custom: async (factory, options) => {
		assert.notEqual(options?.overlay, true);
		let result, hidden = false;
		const component = factory({ ...tui, showOverlay: (welcome, overlayOptions) => {
			assert.deepEqual(overlayOptions, { row: 0, col: 0, width: "100%", maxHeight: "100%", margin: 0, nonCapturing: true });
			screens.push(welcome); assert.equal(welcome.render(80).length, 32);
			return { hide() { hidden = true; } };
		} }, theme, keybindings, (value) => { result = value; });
		screens.push(component); assert.deepEqual(component.render(80), []);
		for (const key of input === "new" ? ["\x1b[A", "\r"] : [input]) await component.handleInput(key);
		component.dispose(); assert(hidden); return result;
	}, notify: (message) => { throw new Error(message); } };
	ctx.switchSession = async (path) => { switched = path; };
	ctx.newSession = async () => { newCount++; };
	await h.commands.get("welcome").handler("", ctx); assert(switched);
	switched = undefined; input = "\x1b"; await h.commands.get("welcome").handler("", ctx); assert.equal(switched, undefined);
	input = "new"; await h.commands.get("welcome").handler("", ctx); assert.equal(newCount, 0);
	sm.appendMessage({ role: "user", content: "existing", timestamp: Date.now() });
	await h.commands.get("welcome").handler("", ctx); assert.equal(newCount, 1);
	await h.events.get("session_start")({ reason: "startup" }, ctx); assert.equal(h.sent.length, 4);
	assert.equal(h.commands.get("pi-welcome").getArgumentCompletions("th")[0].value, "themes");
	input = "\x1b"; await h.commands.get("pi-welcome").handler("themes", ctx);
	console.log("PASS: animation, palette loading, settings, preview, input, resize, startup and resume");
} finally {
	for (const screen of screens) screen.dispose();
	await rm(root, { recursive: true, force: true });
}
