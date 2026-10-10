/**
 * Preloaded into zx's node process (`NODE_OPTIONS=--import`), bundled to a standalone
 * file and written to the plugin's data folder. Provides the `cache()` global.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const env = process.env;

// ---------- cache runtime ----------

/** Lines starting with this on stderr are shown as plugin messages instead of errors */
const MESSAGE_PREFIX = "\u0000obsidian-scripts:";
const cacheDir = env.OBSIDIAN_SCRIPTS_CACHE_DIR;
const refresh = env.OBSIDIAN_SCRIPTS_CACHE_MODE === "refresh";

function message(text: string) {
	process.stderr.write(`${MESSAGE_PREFIX}${text}\n`);
}

function age(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86400) return `${Math.round(s / 3600)}h`;
	return `${Math.round(s / 86400)}d`;
}

interface Entry {
	createdAt: number;
	/** Hash of the function's source and the dependencies it was computed with */
	deps: string;
	/** zx ProcessOutput, stored as its text */
	process?: { stdout: string; stderr: string; exitCode: number | null };
	value?: unknown;
}

/** A plain stand-in for a cached zx ProcessOutput */
function processOutput(p: NonNullable<Entry["process"]>) {
	return {
		...p,
		toString: () => p.stdout,
		valueOf: () => p.stdout.trim(),
		text: () => p.stdout,
		json: () => JSON.parse(p.stdout),
		lines: () => p.stdout.split(/\r?\n/).filter(Boolean),
	};
}

function isProcessOutput(v: unknown): v is { stdout: string; stderr: string; exitCode: number | null } {
	// zx's class name isn't stable across builds, so duck-type it
	const o = v as Record<string, unknown> | null;
	return !!o && typeof o === "object" && typeof o.stdout === "string" && typeof o.stderr === "string" && "exitCode" in o;
}

function sha1(...parts: string[]): string {
	return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);
}

/**
 * `await cache("repos", () => $\`gh repo list --json name --limit ${n}\`, [n])` — returns the
 * result cached under `key` without calling `fn`, unless there is none or `deps` (or `fn`'s
 * source) changed since it was cached; then calls `fn` and replaces the cached result.
 * Each key holds one result, like a `useMemo` that persists across runs.
 */
async function cache<T>(key: string, fn: () => T | PromiseLike<T>, deps: unknown[] = []): Promise<unknown> {
	if (typeof key !== "string" || typeof fn !== "function") {
		throw new TypeError('cache() takes a key and a function, e.g. await cache("repos", () => $`cmd`, [deps])');
	}
	if (!Array.isArray(deps)) throw new TypeError("cache() dependencies must be an array");

	const depsHash = sha1(fn.toString(), JSON.stringify(deps));
	const file = cacheDir ? join(cacheDir, `${sha1(key)}.json`) : null;

	if (file && existsSync(file)) {
		try {
			const entry: Entry = JSON.parse(readFileSync(file, "utf8"));
			if (refresh) message(`cache: refreshing "${key}"`);
			else if (entry.deps !== depsHash) message(`cache: dependencies of "${key}" changed, recomputing`);
			else {
				message(`cache: using "${key}" from ${age(Date.now() - entry.createdAt)} ago`);
				return entry.process ? processOutput(entry.process) : entry.value;
			}
		} catch {
			// Unreadable entry: recompute
		}
	}

	const value = await fn();

	if (file) {
		const entry: Entry = { createdAt: Date.now(), deps: depsHash };
		if (isProcessOutput(value)) entry.process = { stdout: value.stdout, stderr: value.stderr, exitCode: value.exitCode };
		else entry.value = value;
		try {
			mkdirSync(cacheDir!, { recursive: true });
			writeFileSync(file, JSON.stringify(entry));
			message(`cache: saved "${key}"`);
		} catch (err) {
			message(`cache: could not save "${key}": ${(err as Error).message}`);
		}
	}
	return value;
}

(globalThis as Record<string, unknown>).cache = cache;
