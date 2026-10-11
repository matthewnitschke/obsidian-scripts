import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import HOOKS_SOURCE from "virtual:hooks";

export const HOOKS_FILE = "hooks.mjs";

/** Default folder (outside the vault) for the preloaded hooks file and `cache()` results */
export function defaultDataDir(): string {
	return path.join(os.homedir(), ".cache", "obsidian-scripts");
}

/** Writes the `cache()` runtime that's preloaded into zx with `--import`; returns its path */
export async function writeHooks(dataDir: string): Promise<string> {
	await fs.mkdir(dataDir, { recursive: true });
	const file = path.join(dataDir, HOOKS_FILE);
	await fs.writeFile(file, HOOKS_SOURCE);
	return file;
}

export const TYPES_FILE = "globals.d.ts";

const TYPES_SOURCE = `/// <reference types="zx/globals" />

declare global {
	/**
	 * Returns the result cached under \`key\` without calling \`fn\`, unless there is none or
	 * \`deps\` (or \`fn\`'s source) changed since it was cached.
	 */
	function cache<T>(key: string, fn: () => T | PromiseLike<T>, deps?: unknown[]): Promise<Awaited<T>>;
}

export {};
`;

/** Writes the type declarations for the globals scripts get (zx + `cache()`); returns their path */
export async function writeTypes(dataDir: string): Promise<string> {
	await fs.mkdir(dataDir, { recursive: true });
	const file = path.join(dataDir, TYPES_FILE);
	await fs.writeFile(file, TYPES_SOURCE);
	return file;
}

/** Writes a tsconfig.json into `dir` so external editors know the script globals; false if one exists */
export async function writeEditorConfig(dir: string, typesFile: string): Promise<boolean> {
	const file = path.join(dir, "tsconfig.json");
	try {
		await fs.access(file);
		return false;
	} catch {
		// Doesn't exist yet
	}
	const config = {
		compilerOptions: {
			target: "ES2022",
			module: "esnext",
			moduleResolution: "bundler",
			allowJs: true,
			checkJs: true,
			noEmit: true,
			skipLibCheck: true,
			types: ["node"],
		},
		include: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.mts", "**/*.cts", typesFile],
		exclude: ["node_modules"],
	};
	await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n");
	return true;
}

/** Where `cache()` results for a script are stored */
export function resultsDir(dataDir: string, scriptPath: string): string {
	return path.join(dataDir, "results", createHash("sha1").update(scriptPath).digest("hex").slice(0, 16));
}

export async function removeResults(dataDir: string, scriptPath: string) {
	await fs.rm(resultsDir(dataDir, scriptPath), { recursive: true, force: true });
}

/** Carries a script's results over to its new path (replacing any stale results there) */
export async function moveResults(dataDir: string, fromScriptPath: string, toScriptPath: string) {
	const from = resultsDir(dataDir, fromScriptPath);
	const to = resultsDir(dataDir, toScriptPath);
	if (from === to) return;
	try {
		await fs.access(from);
	} catch {
		return; // nothing cached
	}
	await fs.rm(to, { recursive: true, force: true });
	await fs.rename(from, to);
	await claimResults(dataDir, toScriptPath);
}

const OWNER_FILE = "script.json";

/** Records which script a results folder belongs to, so orphans can be found later */
export async function claimResults(dataDir: string, scriptPath: string) {
	const dir = resultsDir(dataDir, scriptPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, OWNER_FILE), JSON.stringify({ scriptPath }));
}

/** Removes results whose script no longer exists (e.g. deleted outside Obsidian) */
export async function pruneResults(dataDir: string) {
	const root = path.join(dataDir, "results");
	let dirs: string[];
	try {
		dirs = await fs.readdir(root);
	} catch {
		return;
	}
	for (const dir of dirs) {
		try {
			const { scriptPath } = JSON.parse(await fs.readFile(path.join(root, dir, OWNER_FILE), "utf8"));
			try {
				await fs.access(scriptPath);
			} catch {
				await fs.rm(path.join(root, dir), { recursive: true, force: true });
			}
		} catch {
			// No owner file: leave it alone
		}
	}
}
