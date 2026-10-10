/** Parses CSV (RFC 4180: quoted fields, `""` escapes, newlines inside quotes) into rows */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"' && field === "") quoted = true;
		else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** CSV -> markdown table, first row as the header. Empty string if there are no rows. */
export function csvToMarkdown(text: string): string {
	const rows = parseCsv(text);
	if (!rows.length) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const line = (cells: string[]) =>
		`| ${Array.from({ length: width }, (_, i) => escapeCell(cells[i] ?? "")).join(" | ")} |`;
	const [header, ...body] = rows;
	return [line(header), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
}

/** Wraps `code` in a fenced code block, with a fence longer than any backtick run inside it */
export function fenced(lang: string, code: string): string {
	const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${lang}\n${code}\n${fence}`;
}

/**
 * Characters Obsidian would read as table syntax become entities:
 * - `|`: an entity can't be read as a column separator
 * - `^`: a cell ending in ` ^19` looks like a block ID (`^id`), which Obsidian strips from the row
 */
function escapeCell(value: string): string {
	return value.trim().replace(/\|/g, "&#124;").replace(/\^/g, "&#94;").replace(/\r?\n/g, "<br>");
}
