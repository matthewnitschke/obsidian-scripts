import { App, PluginSettingTab, Setting } from "obsidian";
import type ScriptsPlugin from "./main";
import { defaultDataDir } from "./support";

export interface ScriptsSettings {
	/** File extensions treated as zx scripts, without the leading dot */
	extensions: string[];
	/** Shell whose interactive login environment (PATH, etc.) scripts run with */
	shell: string;
	/** Working directory for scripts */
	cwd: "vault" | "script";
	/** Command used to run scripts (`--install <script>` is appended) */
	zxCommand: string;
	/** Where `cache()` results are stored (outside the vault). Empty = default. */
	cacheDir: string;
	/** Command for "Open in terminal"; `{dir}` is the script's folder, `{file}` the script */
	terminalCommand: string;
	/** Command for "Open in editor"; `{dir}` is the script's folder, `{file}` the script */
	editorCommand: string;
	/** How each script's output is shown, keyed by script path. Missing = "text". */
	outputTypes: Record<string, OutputType>;
}

export type OutputType = "text" | "table" | "mermaid";

export const DEFAULT_SETTINGS: ScriptsSettings = {
	extensions: ["mjs", "js", "ts", "mts"],
	shell: process.env.SHELL || "/bin/zsh",
	cwd: "vault",
	zxCommand: "zx",
	cacheDir: "",
	terminalCommand: process.platform === "darwin" ? "open -a Terminal {dir}" : "",
	editorCommand: process.platform === "darwin" ? "open {file}" : process.platform === "win32" ? "notepad {file}" : "xdg-open {file}",
	outputTypes: {},
};

export class ScriptsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ScriptsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Script extensions")
			.setDesc("Comma separated. Files with these extensions are run with zx. Requires reloading the plugin.")
			.addText((text) =>
				text.setValue(settings.extensions.join(", ")).onChange(async (value) => {
					settings.extensions = value
						.split(",")
						.map((e) => e.trim().replace(/^\./, ""))
						.filter(Boolean);
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Working directory")
			.setDesc("Directory scripts are run from.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ vault: "Vault root", script: "Script's folder" })
					.setValue(settings.cwd)
					.onChange(async (value) => {
						settings.cwd = value as ScriptsSettings["cwd"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("zx command")
			.setDesc("Scripts run as `<command> --install <script>`, which installs the packages they import next to the script.")
			.addText((text) =>
				text
					.setPlaceholder("zx")
					.setValue(settings.zxCommand)
					.onChange(async (value) => {
						settings.zxCommand = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Cache folder")
			.setDesc("Where cache() results are stored.")
			.addText((text) =>
				text
					.setPlaceholder(defaultDataDir())
					.setValue(settings.cacheDir)
					.onChange(async (value) => {
						settings.cacheDir = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open in terminal command")
			.setDesc("Run by the script block's menu. {dir} is the script's folder, {file} the script. E.g. `open -a iTerm {dir}`.")
			.addText((text) =>
				text.setValue(settings.terminalCommand).onChange(async (value) => {
					settings.terminalCommand = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Open in editor command")
			.setDesc("Run by the script block's menu. {dir} is the script's folder, {file} the script. E.g. `code {file}`.")
			.addText((text) =>
				text.setValue(settings.editorCommand).onChange(async (value) => {
					settings.editorCommand = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Environment").setHeading();

		new Setting(containerEl)
			.setName("Shell")
			.setDesc("Scripts run with the environment (PATH, etc.) of an interactive login session of this shell.")
			.addText((text) =>
				text.setValue(settings.shell).onChange(async (value) => {
					settings.shell = value.trim();
					this.plugin.runner.resetEnv();
					await this.plugin.saveSettings();
				}),
			);
	}
}
