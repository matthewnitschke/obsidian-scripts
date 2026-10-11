import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { localCompletionSource } from "@codemirror/lang-javascript";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/** Globals zx and the plugin provide to every script */
const GLOBALS: Completion[] = [
	{ label: "$", type: "function", detail: "zx", info: "Run a shell command: await $`ls`" },
	{ label: "cd", type: "function", detail: "zx", info: "Change the working directory" },
	{ label: "cache", type: "function", detail: "scripts", info: "await cache(key, fn, deps?): reuse a result across runs" },
	{ label: "argv", type: "variable", detail: "zx", info: "Parsed command-line arguments (--name=value)" },
	{ label: "chalk", type: "variable", detail: "zx", info: "Terminal string styling" },
	{ label: "fs", type: "variable", detail: "zx", info: "fs-extra" },
	{ label: "path", type: "variable", detail: "zx", info: "node:path" },
	{ label: "os", type: "variable", detail: "zx", info: "node:os" },
	{ label: "echo", type: "function", detail: "zx", info: "Print to stdout" },
	{ label: "sleep", type: "function", detail: "zx", info: "await sleep(ms)" },
	{ label: "question", type: "function", detail: "zx", info: "Prompt for input" },
	{ label: "glob", type: "function", detail: "zx", info: "Find files matching patterns" },
	{ label: "which", type: "function", detail: "zx", info: "Locate an executable" },
	{ label: "within", type: "function", detail: "zx", info: "Run a function in an isolated async context" },
	{ label: "retry", type: "function", detail: "zx", info: "Retry a function" },
	{ label: "spinner", type: "function", detail: "zx", info: "Show a spinner while a function runs" },
	{ label: "quiet", type: "function", detail: "zx", info: "Run a command without echoing it" },
];

function globalsSource(context: CompletionContext): CompletionResult | null {
	const word = context.matchBefore(/[\w$]+/);
	if (!word || (word.from === word.to && !context.explicit)) return null;
	// Skip member access like `foo.ba`
	if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === ".") return null;
	return { from: word.from, options: GLOBALS, validFor: /^[\w$]*$/ };
}

/** Autocomplete for script files: identifiers in scope plus the zx/cache() globals */
export function scriptCompletions(): Extension {
	return [
		autocompletion({ override: [localCompletionSource, globalsSource] }),
		keymap.of(completionKeymap),
	];
}
