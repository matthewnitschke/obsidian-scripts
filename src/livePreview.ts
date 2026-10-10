import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, type TFile } from "obsidian";
import type ScriptsPlugin from "./main";
import { ScriptBlock } from "./ScriptBlock";

/** `[[link]]` that is not an embed (`![[...]]` is handled by the embed registry) */
const LINK_RE = /(?<!!)\[\[([^\]\n]+?)\]\]/g;

const blocks = new WeakMap<HTMLElement, ScriptBlock>();

class ScriptWidget extends WidgetType {
	constructor(
		private plugin: ScriptsPlugin,
		private file: TFile,
		private sourcePath: string,
	) {
		super();
	}

	eq(other: ScriptWidget) {
		return other.file === this.file && other.sourcePath === this.sourcePath;
	}

	toDOM() {
		const el = createDiv({ cls: "scripts-block-widget" });
		const block = new ScriptBlock(el, this.plugin, this.file, this.sourcePath);
		block.load();
		blocks.set(el, block);
		return el;
	}

	destroy(dom: HTMLElement) {
		blocks.get(dom)?.unload();
		blocks.delete(dom);
	}

	ignoreEvent() {
		return true;
	}
}

interface NodeLike {
	name: string;
	parent: NodeLike | null;
}

function isInCode(state: EditorState, pos: number): boolean {
	for (let node: NodeLike | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
		if (/code/i.test(node.name)) return true;
	}
	return false;
}

/** Replaces `[[script]]` links with a ScriptBlock in live preview, unless the cursor is inside the link */
export function scriptLinkExtension(plugin: ScriptsPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			/** Mouse selections only reveal a link when strictly inside it, so clicking a block never collapses it */
			strict = false;

			update(update: ViewUpdate) {
				if (update.selectionSet) {
					this.strict = update.transactions.some((tr) => tr.isUserEvent("select.pointer"));
				}
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.selectionSet ||
					// workspace.updateOptions() reconfigures editors; used to refresh after scripts are created/deleted
					update.transactions.some((tr) => tr.reconfigured) ||
					update.state.field(editorLivePreviewField) !== update.startState.field(editorLivePreviewField)
				) {
					this.decorations = this.build(update.view);
				}
			}

			build(view: EditorView): DecorationSet {
				const { state } = view;
				if (!state.field(editorLivePreviewField)) return Decoration.none;

				const sourcePath = state.field(editorInfoField)?.file?.path ?? "";
				const builder = new RangeSetBuilder<Decoration>();

				for (const { from, to } of view.visibleRanges) {
					const text = state.sliceDoc(from, to);
					for (const match of text.matchAll(LINK_RE)) {
						const start = from + match.index!;
						const end = start + match[0].length;

						const cursorInside = state.selection.ranges.some((r) =>
							this.strict ? r.from < end && r.to > start : r.from <= end && r.to >= start,
						);
						if (cursorInside || isInCode(state, start)) continue;

						const file = plugin.resolveScript(match[1].split("|")[0], sourcePath);
						if (!file) continue;

						builder.add(start, end, Decoration.replace({ widget: new ScriptWidget(plugin, file, sourcePath) }));
					}
				}
				return builder.finish();
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
