import { Component, DropdownComponent, MarkdownRenderChild, MarkdownRenderer, setIcon, setTooltip, type TFile } from "obsidian";
import type ScriptsPlugin from "./main";
import { languageInfo } from "./languages";
import { parseArgNames } from "./args";
import { csvToMarkdown, fenced } from "./render";
import type { OutputType } from "./settings";
import type { RunState } from "./runner";

export interface ScriptBlockOptions {
	/** Show the "open" button in the header (hidden inside the script's own view) */
	showOpen?: boolean;
	/** Show the output type dropdown in the header (only in the script's own view) */
	showOutputType?: boolean;
}

/**
 * The rendered block for a linked script: a header with name, language,
 * status and actions, and a body that streams the script's output.
 */
export class ScriptBlock extends MarkdownRenderChild {
	private rendered = false;
	private statusEl!: HTMLElement;
	private runButton!: HTMLElement;
	private freshButton!: HTMLElement;
	private usesCache = false;
	private argsEl!: HTMLElement;
	private argNames: string[] = [];
	private bodyEl!: HTMLElement;
	private scrollEl!: HTMLElement;
	private outputEl!: HTMLElement;
	private renderedEl!: HTMLElement;
	private outputTypeDropdown: DropdownComponent | null = null;
	private renderedRunId = 0;
	private renderedChunks = 0;
	private renderedType: OutputType = "text";
	/** Markdown rendered from stdout so far (table/mermaid), to skip re-rendering when it hasn't changed */
	private renderedMarkdown: string | null = null;
	private markdownComponent: Component | null = null;
	private frame: number | null = null;
	private timer: number | null = null;

	constructor(
		containerEl: HTMLElement,
		private plugin: ScriptsPlugin,
		public file: TFile,
		private sourcePath?: string,
		private options: ScriptBlockOptions = {},
	) {
		super(containerEl);
	}

	onload() {
		this.render();
	}

	/** Called by Obsidian's embed registry */
	loadFile() {
		this.render();
	}

	onunload() {
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		if (this.timer !== null) window.clearInterval(this.timer);
		this.containerEl.empty();
		this.rendered = false;
	}

	private render() {
		if (this.rendered) return;
		this.rendered = true;

		const { file } = this;
		const lang = languageInfo(file.extension);
		const root = this.containerEl.createDiv({ cls: "scripts-block" });

		// Keep clicks inside the block from reaching the editor / link handlers. Preventing the
		// mousedown default also stops the browser moving the editor cursor next to the block
		// (which would reveal the link source in Live Preview); the output stays selectable.
		this.registerDomEvent(root, "mousedown", (e) => {
			e.stopPropagation();
			if (!(e.target instanceof Element && e.target.closest(".scripts-block-output, .scripts-block-rendered, .scripts-block-arg, select"))) e.preventDefault();
		});
		this.registerDomEvent(root, "click", (e) => e.stopPropagation());

		const header = root.createDiv({ cls: "scripts-block-header" });
		setIcon(header.createSpan({ cls: "scripts-block-icon" }), lang.icon);

		const title = header.createSpan({ cls: "scripts-block-title", text: file.name });
		setTooltip(title, file.path);
		this.statusEl = header.createSpan({ cls: "scripts-block-status" });
		this.argsEl = header.createDiv({ cls: "scripts-block-args" });

		const actions = header.createDiv({ cls: "scripts-block-actions" });

		if (this.options.showOutputType) {
			this.outputTypeDropdown = new DropdownComponent(actions)
				.addOptions({ text: "Text", table: "Table", mermaid: "Mermaid" })
				.setValue(this.plugin.getOutputType(file.path))
				.onChange((value) => void this.plugin.setOutputType(this.file.path, value as OutputType));
			this.outputTypeDropdown.selectEl.addClass("scripts-block-output-type");
			setTooltip(this.outputTypeDropdown.selectEl, "Output type: Table parses stdout as CSV, Mermaid as a diagram");
		}

		this.freshButton = actions.createDiv({ cls: "clickable-icon scripts-block-fresh" });
		setIcon(this.freshButton, "refresh-ccw");
		setTooltip(this.freshButton, "Run without cache");
		this.registerDomEvent(this.freshButton, "click", () => {
			this.plugin.runner.run(file, this.sourcePath, { cache: false });
		});
		this.analyzeSource();
		this.registerEvent(
			this.plugin.app.vault.on("modify", (f) => {
				if (f === this.file) this.analyzeSource();
			}),
		);

		this.runButton = actions.createDiv({ cls: "clickable-icon scripts-block-run" });
		this.registerDomEvent(this.runButton, "click", () => {
			if (this.plugin.runner.isRunning(file.path)) this.plugin.runner.stop(file.path);
			else this.plugin.runner.run(file, this.sourcePath);
		});

		if (this.options.showOpen !== false) {
			const open = actions.createDiv({ cls: "clickable-icon" });
			setIcon(open, "external-link");
			setTooltip(open, "Open script");
			this.registerDomEvent(open, "click", () => {
				this.plugin.app.workspace.getLeaf("tab").openFile(file);
			});
		}

		this.bodyEl = root.createDiv({ cls: "scripts-block-body" });
		this.scrollEl = this.bodyEl.createDiv({ cls: "scripts-block-scroll" });
		this.outputEl = this.scrollEl.createEl("pre", { cls: "scripts-block-output" });
		this.renderedEl = this.scrollEl.createDiv({ cls: "scripts-block-rendered markdown-rendered" });
		this.createResizeHandle();

		this.register(this.plugin.runner.subscribe(file.path, () => this.scheduleUpdate()));
		this.update();
	}

	/** Drag the bottom edge to resize the output; double-click it to go back to the default height */
	private createResizeHandle() {
		const handle = this.bodyEl.createDiv({ cls: "scripts-block-resize" });
		setTooltip(handle, "Drag to resize, double-click to reset");
		this.applyHeight(this.plugin.runner.getHeight(this.file.path));

		let startY = 0;
		let startHeight = 0;
		this.registerDomEvent(handle, "pointerdown", (e) => {
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			startY = e.clientY;
			startHeight = this.scrollEl.getBoundingClientRect().height;
			handle.addClass("is-dragging");
		});
		this.registerDomEvent(handle, "pointermove", (e) => {
			if (!handle.hasPointerCapture(e.pointerId)) return;
			const height = Math.max(MIN_HEIGHT, Math.round(startHeight + e.clientY - startY));
			this.plugin.runner.setHeight(this.file.path, height);
			this.applyHeight(height);
		});
		this.registerDomEvent(handle, "pointerup", (e) => {
			handle.releasePointerCapture(e.pointerId);
			handle.removeClass("is-dragging");
		});
		this.registerDomEvent(handle, "dblclick", () => {
			this.plugin.runner.setHeight(this.file.path, undefined);
			this.applyHeight(undefined);
		});
	}

	/** A dragged height replaces the default max height; undefined restores the default */
	private applyHeight(height: number | undefined) {
		this.scrollEl.style.height = height === undefined ? "" : `${height}px`;
		this.scrollEl.style.maxHeight = height === undefined ? "" : "none";
	}

	/**
	 * The "run without cache" button only shows for scripts that use `cache(...)`, and
	 * each `argv.name` the script reads gets an input in the header.
	 */
	private async analyzeSource() {
		const source = await this.plugin.app.vault.cachedRead(this.file);
		this.usesCache = /\bcache\s*\(/.test(source);
		this.renderArgs(parseArgNames(source));
		this.scheduleUpdate();
	}

	private renderArgs(names: string[]) {
		// Rebuilding on every edit would steal focus from an input being typed in
		if (names.join("\0") === this.argNames.join("\0")) return;
		this.argNames = names;
		this.argsEl.empty();

		const { runner } = this.plugin;
		for (const name of names) {
			const input = this.argsEl.createEl("input", {
				cls: "scripts-block-arg",
				type: "text",
				placeholder: name,
				value: runner.getArg(this.file.path, name),
			});
			setTooltip(input, `--${name}`);
			input.addEventListener("input", () => runner.setArg(this.file.path, name, input.value));
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !runner.isRunning(this.file.path)) {
					e.preventDefault();
					runner.run(this.file, this.sourcePath);
				}
			});
		}
	}

	private scheduleUpdate() {
		if (this.frame !== null) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.update();
		});
	}

	private update() {
		const state = this.plugin.runner.get(this.file.path);
		const running = state?.status === "running";

		setIcon(this.runButton, running ? "square" : "play");
		setTooltip(this.runButton, running ? "Stop" : this.usesCache ? "Run (using cache)" : "Run");
		this.freshButton.toggle(this.usesCache && !running);
		this.runButton.toggleClass("is-running", running);

		this.updateStatus(state);
		this.updateOutput(state);
	}

	private updateStatus(state: RunState | undefined) {
		const el = this.statusEl;
		el.empty();
		el.className = "scripts-block-status";
		if (this.timer !== null && state?.status !== "running") {
			window.clearInterval(this.timer);
			this.timer = null;
		}
		if (!state || state.status === "idle") return;

		el.addClass(`is-${state.status}`);
		if (state.status === "running") {
			setIcon(el.createSpan({ cls: "scripts-block-spinner" }), "loader");
			el.createSpan({ text: formatDuration(Date.now() - state.startedAt) });
			// Tick the elapsed time while running
			this.timer ??= window.setInterval(() => this.updateStatus(this.plugin.runner.get(this.file.path)), 1000);
		} else {
			const exit = state.exitCode === null ? "failed" : `exit ${state.exitCode}`;
			el.setText(`${exit} · ${formatDuration((state.endedAt ?? Date.now()) - state.startedAt)}`);
		}
	}

	private updateOutput(state: RunState | undefined) {
		const type = this.plugin.getOutputType(this.file.path);
		this.outputTypeDropdown?.setValue(type);

		if (!state) {
			this.bodyEl.hide();
			return;
		}
		this.bodyEl.show();

		if (state.runId !== this.renderedRunId || type !== this.renderedType) {
			this.outputEl.empty();
			this.renderedRunId = state.runId;
			this.renderedType = type;
			this.renderedChunks = 0;
			this.renderedMarkdown = null;
		}

		const scroll = this.scrollEl;
		const stickToBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4;

		// In table/mermaid mode stdout is rendered as markdown; stderr and plugin messages stay as text above it
		const rendered = type !== "text";
		for (const chunk of state.output.slice(this.renderedChunks)) {
			if (rendered && chunk.stream === "stdout") continue;
			this.outputEl.createSpan({ cls: `scripts-output-${chunk.stream}`, text: chunk.text });
		}
		this.renderedChunks = state.output.length;

		const markdown = this.toMarkdown(type, state);
		this.renderMarkdown(markdown);

		const textEmpty = !this.outputEl.hasChildNodes();
		this.outputEl.toggle(!textEmpty || !markdown);
		this.outputEl.toggleClass("is-empty", textEmpty);
		if (textEmpty) this.outputEl.setAttr("data-placeholder", state.status === "running" ? "Running…" : "No output");

		if (stickToBottom) scroll.scrollTop = scroll.scrollHeight;
	}

	private toMarkdown(type: OutputType, state: RunState): string {
		if (type === "text") return "";
		const stdout = state.output.filter((c) => c.stream === "stdout").map((c) => c.text).join("");
		if (type === "table") return csvToMarkdown(stdout);
		// A partial diagram is a syntax error, so wait for the run to finish
		if (state.status === "running" || !stdout.trim()) return "";
		return fenced("mermaid", stdout.trim());
	}

	private renderMarkdown(markdown: string) {
		if (markdown === this.renderedMarkdown) return;
		this.renderedMarkdown = markdown;
		if (this.markdownComponent) this.removeChild(this.markdownComponent);
		this.markdownComponent = null;
		this.renderedEl.empty();
		this.renderedEl.toggle(markdown !== "");
		if (!markdown) return;

		this.markdownComponent = this.addChild(new Component());
		void MarkdownRenderer.render(this.plugin.app, markdown, this.renderedEl, this.sourcePath ?? this.file.path, this.markdownComponent);
	}
}

const MIN_HEIGHT = 40;

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}
