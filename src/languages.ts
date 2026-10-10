import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";

interface LanguageInfo {
	name: string;
	icon: string;
	editor?: () => Extension;
}

const JS: LanguageInfo = { name: "JavaScript", icon: "file-code", editor: () => javascript() };
const TS: LanguageInfo = { name: "TypeScript", icon: "file-code", editor: () => javascript({ typescript: true }) };

const LANGUAGES: Record<string, LanguageInfo> = {
	js: JS,
	mjs: JS,
	cjs: JS,
	ts: TS,
	mts: TS,
	cts: TS,
};

export function languageInfo(extension: string): LanguageInfo {
	return LANGUAGES[extension.toLowerCase()] ?? { name: extension.toUpperCase(), icon: "file-code" };
}

/** Maps highlight tags to `cm-*` classes, which styles.css colors using Obsidian's --code-* variables */
const highlightStyle = HighlightStyle.define([
	{ tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], class: "cm-keyword" },
	{ tag: [t.string, t.special(t.string), t.regexp], class: "cm-string" },
	{ tag: [t.comment, t.lineComment, t.blockComment], class: "cm-comment" },
	{ tag: [t.number, t.bool, t.null, t.atom], class: "cm-number" },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], class: "cm-function" },
	{ tag: [t.definition(t.variableName), t.typeName, t.className], class: "cm-def" },
	{ tag: [t.propertyName, t.attributeName], class: "cm-property" },
	{ tag: [t.operator], class: "cm-operator" },
	{ tag: [t.meta, t.processingInstruction], class: "cm-meta" },
	{ tag: [t.punctuation, t.bracket], class: "cm-punctuation" },
	{ tag: [t.special(t.variableName), t.self], class: "cm-builtin" },
]);

export function editorLanguage(extension: string): Extension {
	const lang = languageInfo(extension).editor;
	return lang ? [lang(), syntaxHighlighting(highlightStyle)] : [];
}
