import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { TextFileView, type TFile, type WorkspaceLeaf } from "obsidian";
import type ScriptsPlugin from "./main";
import { editorLanguage, languageInfo } from "./languages";
import { ScriptBlock } from "./ScriptBlock";

export const VIEW_TYPE_SCRIPT = "scripts-view";

/** Editor for script files, with the run block pinned above the code */
export class ScriptView extends TextFileView {
	private editor: EditorView | null = null;
	private block: ScriptBlock | null = null;
	private blockEl!: HTMLElement;
	private editorEl!: HTMLElement;
	private settingData = false;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ScriptsPlugin,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_SCRIPT;
	}

	getIcon() {
		return this.file ? languageInfo(this.file.extension).icon : "file-code";
	}

	async onOpen() {
		this.contentEl.addClass("scripts-view");
		this.blockEl = this.contentEl.createDiv({ cls: "scripts-view-block" });
		this.editorEl = this.contentEl.createDiv({ cls: "scripts-view-editor" });
	}

	async onLoadFile(file: TFile) {
		this.block = this.addChild(new ScriptBlock(this.blockEl, this.plugin, file, undefined, { showOpen: false, showOutputType: true }));
		await super.onLoadFile(file);
	}

	async onUnloadFile(file: TFile) {
		if (this.block) this.removeChild(this.block);
		this.block = null;
		await super.onUnloadFile(file);
	}

	async onClose() {
		this.editor?.destroy();
		this.editor = null;
	}

	getViewData(): string {
		return this.editor?.state.doc.toString() ?? this.data;
	}

	setViewData(data: string, clear: boolean) {
		if (!this.editor || clear) {
			this.editor?.destroy();
			this.editor = new EditorView({ parent: this.editorEl, state: this.createState(data) });
			return;
		}
		this.settingData = true;
		this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: data } });
		this.settingData = false;
	}

	clear() {}

	private createState(doc: string): EditorState {
		return EditorState.create({
			doc,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				drawSelection(),
				history(),
				indentOnInput(),
				bracketMatching(),
				EditorState.tabSize.of(4),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				editorLanguage(this.file?.extension ?? ""),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !this.settingData) this.requestSave();
				}),
			],
		});
	}
}
