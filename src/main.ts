import { Editor, FileSystemAdapter, getLinkpath, MarkdownView, Menu, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, type MarkdownPostProcessorContext } from "obsidian";
import { DEFAULT_SETTINGS, ScriptsSettingTab, type OutputType, type ScriptsSettings } from "./settings";
import { defaultDataDir, moveResults, pruneResults, removeResults } from "./support";
import * as path from "path";
import * as os from "os";
import { ScriptRunner } from "./runner";
import { ScriptBlock } from "./ScriptBlock";
import { ScriptView, VIEW_TYPE_SCRIPT } from "./ScriptView";
import { scriptLinkExtension } from "./livePreview";
import { CreateScriptModal } from "./CreateScriptModal";

/** Undocumented API Obsidian uses to render `![[file.ext]]` embeds */
interface EmbedRegistry {
	registerExtensions(
		extensions: string[],
		creator: (ctx: { containerEl: HTMLElement; sourcePath?: string }, file: TFile, subpath: string) => unknown,
	): void;
	unregisterExtensions(extensions: string[]): void;
}

export default class ScriptsPlugin extends Plugin {
	settings!: ScriptsSettings;
	runner!: ScriptRunner;

	async onload() {
		await this.loadSettings();

		this.runner = new ScriptRunner(this);
		this.register(() => this.runner.stopAll());
		// Warm the shell environment so the first run isn't delayed
		this.app.workspace.onLayoutReady(() => {
			void this.runner.shellEnv();
			void pruneResults(this.dataDir());
		});

		this.registerView(VIEW_TYPE_SCRIPT, (leaf) => new ScriptView(leaf, this));
		const extensions = this.registerScriptExtensions();
		this.registerEmbeds(extensions);

		this.registerMarkdownPostProcessor((el, ctx) => this.processLinks(el, ctx));
		this.registerEditorExtension(scriptLinkExtension(this));

		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addFileMenuItems(menu, file)));
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) =>
				this.addEditorMenuItems(menu, editor, info.file?.path ?? ""),
			),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) this.runner.rename(oldPath, file.path);
				this.moveOutputTypes(file, oldPath);
				if (file instanceof TFile && this.isScript(file)) this.refreshNotes();
				void this.syncCacheOnRename(file, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				void this.syncCacheOnDelete(file);
				for (const { file: script } of this.scriptsIn(file)) void this.setOutputType(script.path, "text");
			}),
		);
		// `create` also fires for every file while the vault loads, so wait for the layout
		this.app.workspace.onLayoutReady(() => {
			for (const evt of ["create", "delete"] as const) {
				this.registerEvent(
					this.app.vault.on(evt as "create", (file) => {
						if (file instanceof TFile && this.isScript(file)) this.refreshNotes();
					}),
				);
			}
		});

		this.addCommand({
			id: "run-current-script",
			name: "Run current script",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isScript(file)) return false;
				if (!checking) this.runner.run(file);
				return true;
			},
		});

		this.addCommand({
			id: "run-current-script-without-cache",
			name: "Run current script without cache",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isScript(file)) return false;
				if (!checking) this.runner.run(file, undefined, { cache: false });
				return true;
			},
		});

		this.addCommand({
			id: "create-script",
			name: "Create new script",
			callback: () => {
				const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
				this.promptNewScript(this.app.fileManager.getNewFileParent(sourcePath));
			},
		});

		this.addSettingTab(new ScriptsSettingTab(this.app, this));
	}

	async loadSettings() {
		const data = (await this.loadData()) ?? {};
		// Settings from earlier versions
		for (const key of ["runners", "depsDir", "packageManager"]) delete data[key];
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.settings.outputTypes = { ...this.settings.outputTypes };
	}

	getOutputType(scriptPath: string): OutputType {
		return this.settings.outputTypes[scriptPath] ?? "text";
	}

	async setOutputType(scriptPath: string, type: OutputType) {
		if (this.getOutputType(scriptPath) === type) return;
		if (type === "text") delete this.settings.outputTypes[scriptPath];
		else this.settings.outputTypes[scriptPath] = type;
		this.runner.notify(scriptPath);
		await this.saveSettings();
	}

	private moveOutputTypes(file: TAbstractFile, oldPath: string) {
		let changed = false;
		for (const script of this.scriptsIn(file, oldPath)) {
			const type = this.settings.outputTypes[script.oldPath];
			if (!type) continue;
			delete this.settings.outputTypes[script.oldPath];
			this.settings.outputTypes[script.file.path] = type;
			changed = true;
		}
		if (changed) void this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isScriptExtension(extension: string): boolean {
		const ext = extension.toLowerCase();
		return this.settings.extensions.some((e) => e.toLowerCase() === ext);
	}

	isScript(file: TFile): boolean {
		return this.isScriptExtension(file.extension);
	}

	/** Folder for the preloaded hooks file and cache() results */
	dataDir(): string {
		return this.settings.cacheDir.replace(/^~(?=$|\/)/, os.homedir()) || defaultDataDir();
	}

	/**
	 * Resolves a wiki link to a script file. Supports both `[[deploy.sh]]` and
	 * extensionless `[[deploy]]`, which Obsidian itself only resolves to markdown files.
	 */
	resolveScript(linktext: string, sourcePath: string): TFile | null {
		const linkpath = getLinkpath(linktext).trim();
		if (!linkpath) return null;

		const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (dest) return this.isScript(dest) ? dest : null;

		const name = linkpath.split("/").pop()!;
		const sourceFolder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
		const matches = this.app.vault.getFiles().filter((f) => {
			if (f.basename !== name || !this.isScript(f)) return false;
			const pathWithoutExt = f.path.slice(0, -(f.extension.length + 1));
			return pathWithoutExt === linkpath || pathWithoutExt.endsWith(`/${linkpath}`);
		});
		// Prefer a script next to the note, then the shortest path (same as Obsidian's link resolution)
		matches.sort(
			(a, b) =>
				Number(b.parent?.path === sourceFolder) - Number(a.parent?.path === sourceFolder) ||
				a.path.length - b.path.length,
		);
		return matches[0] ?? null;
	}

	/** File explorer: "New script" on folders */
	private addFileMenuItems(menu: Menu, file: TAbstractFile) {
		const folder = file instanceof TFolder ? file : file.parent;
		if (!folder) return;
		menu.addItem((item) =>
			item
				.setTitle("New script")
				.setIcon("file-code")
				.setSection("action-primary")
				.onClick(() => this.promptNewScript(folder)),
		);
	}

	/** Editor: "Create script" when right-clicking an unresolved `[[name.ext]]` link with a script extension */
	private addEditorMenuItems(menu: Menu, editor: Editor, sourcePath: string) {
		const linktext = linkAtCursor(editor);
		if (!linktext) return;
		const linkpath = getLinkpath(linktext).trim();
		const ext = linkpath.includes(".") ? linkpath.split(".").pop()! : "";
		if (!this.isScriptExtension(ext)) return;
		if (this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)) return;

		menu.addItem((item) =>
			item
				.setTitle("Create script")
				.setIcon("file-plus")
				.setSection("action")
				.onClick(async () => {
					try {
						await this.createScript(linkpath, sourcePath);
					} catch (err) {
						new Notice(`Could not create ${linkpath}: ${err}`);
					}
				}),
		);
	}

	private promptNewScript(folder: TFolder) {
		new CreateScriptModal(this.app, this, folder, async (name) => {
			const path = normalizePath(folder.isRoot() ? name : `${folder.path}/${name}`);
			if (this.app.vault.getAbstractFileByPath(path)) {
				new Notice(`${path} already exists`);
				return;
			}
			const file = await this.app.vault.create(path, "");
			await this.app.workspace.getLeaf("tab").openFile(file);
		}).open();
	}

	private async createScript(linkpath: string, sourcePath: string): Promise<TFile> {
		const { vault } = this.app;
		let path: string;
		if (linkpath.includes("/")) {
			// Explicit folder in the link: relative to the vault root, like Obsidian does for notes
			path = normalizePath(linkpath);
			const folder = path.slice(0, path.lastIndexOf("/"));
			if (!(vault.getAbstractFileByPath(folder) instanceof TFolder)) await vault.createFolder(folder);
		} else {
			const parent = this.app.fileManager.getNewFileParent(sourcePath, linkpath);
			path = normalizePath(parent.isRoot() ? linkpath : `${parent.path}/${linkpath}`);
		}
		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return vault.create(path, "");
	}

	/** Script files at or under `file`, with their path before a rename */
	private scriptsIn(file: TAbstractFile, oldPath = file.path): { file: TFile; oldPath: string }[] {
		if (file instanceof TFile) return [{ file, oldPath }];
		if (!(file instanceof TFolder)) return [];
		return file.children.flatMap((child) => this.scriptsIn(child, oldPath + child.path.slice(file.path.length)));
	}

	private absolutePath(vaultPath: string): string | null {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? path.join(adapter.getBasePath(), vaultPath) : null;
	}

	/** Move a script's cache() results with it, or drop them if it's no longer a script */
	private async syncCacheOnRename(file: TAbstractFile, oldPath: string) {
		for (const script of this.scriptsIn(file, oldPath)) {
			const oldExt = script.oldPath.split(".").pop() ?? "";
			if (!this.isScriptExtension(oldExt)) continue;
			const from = this.absolutePath(script.oldPath);
			const to = this.absolutePath(script.file.path);
			if (!from || !to) continue;
			try {
				if (this.isScript(script.file)) await moveResults(this.dataDir(), from, to);
				else await removeResults(this.dataDir(), from);
			} catch (err) {
				console.warn(`[scripts] could not update cache for ${script.file.path}`, err);
			}
		}
	}

	/** Delete a script's cache() results along with it */
	private async syncCacheOnDelete(file: TAbstractFile) {
		for (const { file: script } of this.scriptsIn(file)) {
			const abs = this.isScript(script) ? this.absolutePath(script.path) : null;
			if (!abs) continue;
			try {
				await removeResults(this.dataDir(), abs);
			} catch (err) {
				console.warn(`[scripts] could not delete cache for ${script.path}`, err);
			}
		}
	}

	/** Re-render open notes so links to a created/deleted script switch between link and block */
	private refreshNotes() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
		});
		this.app.workspace.updateOptions();
	}

	/** Reading view: swap script links and unresolved embeds for blocks */
	private processLinks(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const targets = el.querySelectorAll<HTMLElement>("a.internal-link, .internal-embed");
		targets.forEach((target) => {
			const linktext = target.getAttr("data-href") ?? target.getAttr("src") ?? target.getAttr("href");
			if (!linktext) return;
			const file = this.resolveScript(linktext, ctx.sourcePath);
			if (!file) return;

			const container = createDiv({ cls: "scripts-block-container" });
			target.replaceWith(container);
			ctx.addChild(new ScriptBlock(container, this, file, ctx.sourcePath));
		});
	}

	/** Lets script files show in the file explorer and open in the script editor */
	private registerScriptExtensions(): string[] {
		const registered: string[] = [];
		for (const extension of this.settings.extensions) {
			if (!extension) continue;
			try {
				this.registerExtensions([extension], VIEW_TYPE_SCRIPT);
				registered.push(extension);
			} catch (err) {
				console.warn(`[scripts] .${extension} is already handled by another plugin`, err);
			}
		}
		return registered;
	}

	/** Live preview: render `![[script.ext]]` embeds as blocks */
	private registerEmbeds(extensions: string[]) {
		const registry = (this.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
		if (!registry) return;
		const added: string[] = [];
		for (const ext of extensions) {
			try {
				registry.registerExtensions([ext], (ctx, file) => {
					const block = new ScriptBlock(ctx.containerEl, this, file, ctx.sourcePath);
					ctx.containerEl.addClass("scripts-embed");
					return block;
				});
				added.push(ext);
			} catch (err) {
				console.warn(`[scripts] could not register embed for .${ext}`, err);
			}
		}
		this.register(() => registry.unregisterExtensions(added));
	}
}

/** Returns the link text of the `[[...]]` link under the cursor, if any */
function linkAtCursor(editor: Editor): string | null {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	for (const match of line.matchAll(/\[\[([^\]]+?)\]\]/g)) {
		const start = match.index!;
		if (cursor.ch >= start && cursor.ch <= start + match[0].length) return match[1].split("|")[0];
	}
	return null;
}
