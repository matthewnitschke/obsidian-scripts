import { execFile, spawn, type ChildProcess } from "child_process";
import { pathToFileURL } from "url";
import * as path from "path";
import { FileSystemAdapter, Notice, TextFileView, type TFile } from "obsidian";
import type ScriptsPlugin from "./main";
import { claimResults, HOOKS_FILE, resultsDir, writeHooks } from "./support";
import { VIEW_TYPE_SCRIPT } from "./ScriptView";

export type OutputStream = "stdout" | "stderr" | "system";

export interface OutputChunk {
	stream: OutputStream;
	text: string;
}

export interface RunState {
	/** Increments on every run so views know to reset their rendered output */
	runId: number;
	status: "idle" | "running" | "success" | "error";
	output: OutputChunk[];
	exitCode: number | null;
	startedAt: number;
	endedAt: number | null;
	truncated: boolean;
	outputSize: number;
	/** Last spinner title shown, so animation frames are only shown once */
	spinner?: string;
	process?: ChildProcess;
}

type Listener = (state: RunState) => void;

export interface RunOptions {
	/** false: ignore cached `cache(...)` results and refresh them */
	cache?: boolean;
}

/** Node reports this for `.js` files that failed to parse as ESM and were retried as CommonJS */
const MISLEADING_TLA_ERROR = "await is only valid in async functions and the top level bodies of modules";

/** zx's `--install` spinner: `  ⠋ npm i chalk@latest\r` */
const SPINNER_RE = /^\s*[\u2800-\u28ff] (.*)$/;

/** Must match MESSAGE_PREFIX in hooks/hooks.ts */
const MESSAGE_PREFIX = "\u0000obsidian-scripts:";

const MAX_OUTPUT_CHARS = 1_000_000;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

/**
 * Owns all script processes and their output, keyed by script path.
 * Blocks subscribe to a path, so output survives re-renders and is shared
 * between every block that links the same script.
 */
export class ScriptRunner {
	private states = new Map<string, RunState>();
	private listeners = new Map<string, Set<Listener>>();
	/** Argument values entered in the block header, passed to the script as `--name=value` */
	private args = new Map<string, Record<string, string>>();
	/** Output heights the user dragged blocks to, shared by every block for the script */
	private heights = new Map<string, number>();
	/** Widths the user dragged argument inputs to, by script path then argument name */
	private argWidths = new Map<string, Record<string, number>>();
	private nextRunId = 1;

	constructor(private plugin: ScriptsPlugin) {}

	get(filePath: string): RunState | undefined {
		return this.states.get(filePath);
	}

	isRunning(filePath: string): boolean {
		return this.states.get(filePath)?.status === "running";
	}

	subscribe(filePath: string, listener: Listener): () => void {
		let set = this.listeners.get(filePath);
		if (!set) this.listeners.set(filePath, (set = new Set()));
		set.add(listener);
		return () => set!.delete(listener);
	}

	getArg(filePath: string, name: string): string {
		return this.args.get(filePath)?.[name] ?? "";
	}

	setArg(filePath: string, name: string, value: string) {
		let values = this.args.get(filePath);
		if (!values) this.args.set(filePath, (values = {}));
		values[name] = value;
	}

	getHeight(filePath: string): number | undefined {
		return this.heights.get(filePath);
	}

	setHeight(filePath: string, height: number | undefined) {
		if (height === undefined) this.heights.delete(filePath);
		else this.heights.set(filePath, height);
	}

	getArgWidth(filePath: string, name: string): number | undefined {
		return this.argWidths.get(filePath)?.[name];
	}

	setArgWidth(filePath: string, name: string, width: number | undefined) {
		const widths = this.argWidths.get(filePath) ?? {};
		if (width === undefined) delete widths[name];
		else widths[name] = width;
		this.argWidths.set(filePath, widths);
	}

	/** Moves state and listeners when a script is renamed */
	rename(oldPath: string, newPath: string) {
		const state = this.states.get(oldPath);
		if (state) {
			this.states.delete(oldPath);
			this.states.set(newPath, state);
		}
		const height = this.heights.get(oldPath);
		if (height !== undefined) {
			this.heights.delete(oldPath);
			this.heights.set(newPath, height);
		}
		const widths = this.argWidths.get(oldPath);
		if (widths) {
			this.argWidths.delete(oldPath);
			this.argWidths.set(newPath, widths);
		}
		const args = this.args.get(oldPath);
		if (args) {
			this.args.delete(oldPath);
			this.args.set(newPath, args);
		}
	}

	async run(file: TFile, sourcePath?: string, options: RunOptions = {}) {
		if (this.isRunning(file.path)) return;

		const adapter = this.plugin.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			new Notice("Scripts can only be run on desktop.");
			return;
		}

		const vaultPath = adapter.getBasePath();
		const scriptPath = path.join(vaultPath, file.path);

		const state: RunState = {
			runId: this.nextRunId++,
			status: "running",
			output: [],
			exitCode: null,
			startedAt: Date.now(),
			endedAt: null,
			truncated: false,
			outputSize: 0,
		};
		this.states.set(file.path, state);
		this.emit(file.path);

		const cancelled = () => state.status !== "running";

		try {
			await this.saveOpenEditors(file);
		} catch (err) {
			this.append(file.path, state, "system", `Could not save ${file.name}: ${err}\n`);
		}
		if (cancelled()) return;

		const shellEnv = await this.shellEnv();
		if (cancelled()) return;
		if (this.envError) this.append(file.path, state, "system", `${this.envError}\n`);

		let hooksPath: string;
		try {
			hooksPath = await writeHooks(this.plugin.dataDir());
			await claimResults(this.plugin.dataDir(), scriptPath);
		} catch (err) {
			this.finish(file.path, state, null, `Could not write ${HOOKS_FILE}: ${err}`);
			return;
		}
		if (cancelled()) return;

		const env: NodeJS.ProcessEnv = {
			...shellEnv,
			FORCE_COLOR: "0",
			// Preload the cache() runtime into zx's node process
			NODE_OPTIONS: [shellEnv.NODE_OPTIONS, `--import=${pathToFileURL(hooksPath).href}`].filter(Boolean).join(" "),
			OBSIDIAN_VAULT: vaultPath,
			OBSIDIAN_SCRIPT: scriptPath,
			OBSIDIAN_NOTE: sourcePath ? path.join(vaultPath, sourcePath) : "",
			OBSIDIAN_SCRIPTS_CACHE_DIR: resultsDir(this.plugin.dataDir(), scriptPath),
			OBSIDIAN_SCRIPTS_CACHE_MODE: options.cache === false ? "refresh" : "use",
		};

		const scriptArgs = Object.entries(this.args.get(file.path) ?? {})
			.filter(([, value]) => value !== "")
			.map(([name, value]) => `--${name}=${value}`);

		const [zx, ...zxArgs] = (this.plugin.settings.zxCommand.trim() || "zx").split(/\s+/);
		const code = await this.exec(file.path, state, zx, [...zxArgs, "--install", scriptPath, ...scriptArgs], {
			cwd: this.plugin.settings.cwd === "script" ? path.dirname(scriptPath) : vaultPath,
			env,
		});
		if (code !== 0 && state.output.some((c) => c.text.includes(MISLEADING_TLA_ERROR))) {
			this.append(
				file.path,
				state,
				"system",
				"Hint: Node parsed this .js file as CommonJS because it isn't valid as an ES module. That usually means " +
					"there's another syntax error in the file (e.g. a missing bracket). Renaming it to .mjs shows the real error.\n",
			);
		}
		this.finish(file.path, state, code);
	}

	/** Flushes unsaved edits in open script editors so the run picks up the latest changes */
	private async saveOpenEditors(file: TFile) {
		const views = this.plugin.app.workspace
			.getLeavesOfType(VIEW_TYPE_SCRIPT)
			.map((leaf) => leaf.view)
			.filter((view): view is TextFileView => view instanceof TextFileView && view.file === file);
		await Promise.all(views.map((view) => view.save()));
	}

	/** Spawns a process for a run, streaming its output into the run's state. Resolves with the exit code. */
	private exec(
		filePath: string,
		state: RunState,
		command: string,
		args: string[],
		options: { cwd: string; env: NodeJS.ProcessEnv },
		stream?: OutputStream,
	): Promise<number | null> {
		return new Promise((resolve) => {
			const isWindows = process.platform === "win32";
			let proc: ChildProcess;
			try {
				proc = spawn(command, args, {
					...options,
					stdio: ["ignore", "pipe", "pipe"],
					// Own process group so stop() can kill the whole tree
					detached: !isWindows,
					shell: isWindows,
					windowsHide: true,
				});
			} catch (err) {
				this.append(filePath, state, "system", `${err}\n`);
				resolve(null);
				return;
			}
			state.process = proc;

			proc.stdout?.setEncoding("utf8");
			proc.stderr?.setEncoding("utf8");
			proc.stdout?.on("data", (data: string) => this.append(filePath, state, stream ?? "stdout", data));
			proc.stderr?.on("data", (data: string) => this.appendStderr(filePath, state, stream ?? "stderr", data));
			proc.on("error", (err) => {
				const hint = (err as NodeJS.ErrnoException).code === "ENOENT" ? ` (is ${command} installed and on your PATH?)` : "";
				this.append(filePath, state, "system", `${err.message}${hint}\n`);
				resolve(null);
			});
			proc.on("close", (code, signal) => {
				if (state.process === proc) state.process = undefined;
				if (signal) this.append(filePath, state, "system", `Terminated (${signal})\n`);
				resolve(code);
			});
		});
	}

	stop(filePath: string) {
		const state = this.states.get(filePath);
		if (state?.status === "running" && !state.process) {
			this.finish(filePath, state, null, "Cancelled");
			return;
		}
		const proc = state?.process;
		if (!proc?.pid || proc.exitCode !== null) return;
		try {
			if (process.platform === "win32") proc.kill();
			else process.kill(-proc.pid, "SIGTERM");
		} catch {
			proc.kill();
		}
	}

	stopAll() {
		for (const filePath of this.states.keys()) this.stop(filePath);
	}

	/**
	 * Apps launched from the Dock/Finder get a minimal PATH, and a login shell doesn't read
	 * ~/.zshrc / ~/.bashrc where node, pnpm, asdf, etc. are usually set up. So resolve the
	 * environment of an interactive login shell once (like VS Code does) and reuse it.
	 */
	private envPromise: Promise<NodeJS.ProcessEnv> | null = null;
	private envError: string | null = null;

	shellEnv(): Promise<NodeJS.ProcessEnv> {
		if (process.platform === "win32") return Promise.resolve(process.env);
		this.envPromise ??= new Promise((resolve) => {
			const mark = `__OBSIDIAN_SCRIPTS_${Date.now()}__`;
			// NUL-separated so values containing newlines survive
			const command = `printf '%s' '${mark}'; /usr/bin/env -0; printf '%s' '${mark}'`;
			const shell = this.plugin.settings.shell || "/bin/zsh";

			execFile(
				shell,
				["-i", "-l", "-c", command],
				{ timeout: 10_000, maxBuffer: 10 * 1024 * 1024 },
				(err, stdout) => {
					const dump = stdout.split(mark)[1];
					if (!dump) {
						this.envError = `Could not load your shell environment (${err?.message ?? "no output"}); using Obsidian's PATH`;
						console.warn(`[scripts] ${this.envError}`);
						resolve(process.env);
						return;
					}
					const env: NodeJS.ProcessEnv = {};
					for (const entry of dump.split("\0")) {
						const eq = entry.indexOf("=");
						if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
					}
					resolve(env);
				},
			);
		});
		return this.envPromise;
	}

	/** Re-resolve the shell environment on the next run (e.g. after changing the shell setting) */
	resetEnv() {
		this.envPromise = null;
		this.envError = null;
	}

	/** Lines the hooks prefix with MESSAGE_PREFIX (e.g. cache hits) are shown as plugin messages, not errors */
	private appendStderr(filePath: string, state: RunState, stream: OutputStream, data: string) {
		if (!data.includes(MESSAGE_PREFIX) && !data.includes("\r")) {
			this.append(filePath, state, stream, data);
			return;
		}
		for (const line of data.split(/(?<=[\n\r])/)) {
			if (!line) continue;
			if (line.startsWith(MESSAGE_PREFIX)) {
				this.append(filePath, state, "system", line.slice(MESSAGE_PREFIX.length));
				continue;
			}
			// Show each spinner (e.g. zx installing dependencies) once instead of every animation frame
			const spinner = line.endsWith("\r") ? SPINNER_RE.exec(line.slice(0, -1)) : null;
			if (spinner) {
				if (state.spinner !== spinner[1]) this.append(filePath, state, "system", `${spinner[1]}…\n`);
				state.spinner = spinner[1];
				continue;
			}
			const text = line.replace(/^\r+|\r+$/g, "");
			if (text) this.append(filePath, state, stream, text);
		}
	}

	private append(filePath: string, state: RunState, stream: OutputStream, data: string) {
		if (state.truncated) return;
		const text = data.replace(ANSI_RE, "");
		if (state.outputSize + text.length > MAX_OUTPUT_CHARS) {
			state.truncated = true;
			state.output.push({ stream: "system", text: "\n… output truncated\n" });
		} else {
			state.output.push({ stream, text });
			state.outputSize += text.length;
		}
		this.emit(filePath);
	}

	private finish(filePath: string, state: RunState, code: number | null, message?: string) {
		if (state.status !== "running") return;
		if (message) state.output.push({ stream: "system", text: `${message}\n` });
		state.exitCode = code;
		state.status = code === 0 ? "success" : "error";
		state.endedAt = Date.now();
		state.process = undefined;
		this.emit(filePath);
	}

	/** Tells blocks showing a script to re-render (e.g. after its output type changed) */
	notify(filePath: string) {
		this.emit(filePath);
	}

	private emit(filePath: string) {
		const state = this.states.get(filePath);
		if (!state) return;
		this.listeners.get(filePath)?.forEach((l) => l(state));
	}
}
