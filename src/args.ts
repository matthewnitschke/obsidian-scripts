/** `argv.name`, `argv?.name`, `argv["name"]`, `argv['name']` */
const ACCESS_RE = /\bargv\s*(?:\?\.\s*([A-Za-z_$][\w$]*)|\.\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\[\s*(["'])([^"'\n]+)\3\s*\])/g;

/** `const { a, b: c, d = 1 } = argv` */
const DESTRUCTURE_RE = /\{([^{}]*)\}\s*=\s*argv\b/g;

/**
 * Names of the zx `argv` flags a script reads, in order of first use.
 * `argv._` (positional args) is ignored.
 */
export function parseArgNames(source: string): string[] {
	const names = new Set<string>();
	const found: { index: number; name: string }[] = [];

	for (const m of source.matchAll(ACCESS_RE)) {
		found.push({ index: m.index, name: m[1] ?? m[2] ?? m[4] });
	}
	for (const m of source.matchAll(DESTRUCTURE_RE)) {
		for (const part of m[1].split(",")) {
			const key = /^\s*(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))/.exec(part);
			if (key) found.push({ index: m.index, name: key[2] ?? key[3] });
		}
	}

	found.sort((a, b) => a.index - b.index);
	for (const { name } of found) {
		if (name !== "_") names.add(name);
	}
	return [...names];
}
