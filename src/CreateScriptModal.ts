import { App, Modal, Setting, type TFolder } from "obsidian";
import type ScriptsPlugin from "./main";

/** Asks for a script file name (with extension) to create in a folder */
export class CreateScriptModal extends Modal {
	private name = "";

	constructor(
		app: App,
		private plugin: ScriptsPlugin,
		private folder: TFolder,
		private onSubmit: (name: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const extensions = this.plugin.settings.extensions.map((e) => `.${e}`);
		this.setTitle("New script");

		let error!: HTMLElement;
		const submit = () => {
			let name = this.name.trim();
			// No extension: default to the first configured one (.mjs)
			if (name && !name.includes(".")) name += extensions[0] ?? ".mjs";
			const ext = name.split(".").pop()!;
			if (!name || !this.plugin.isScriptExtension(ext)) {
				error.setText(`Name must end in one of: ${extensions.join(", ")}`);
				return;
			}
			this.close();
			this.onSubmit(name);
		};

		new Setting(this.contentEl)
			.setName("File name")
			.setDesc(`In ${this.folder.isRoot() ? "vault root" : this.folder.path}`)
			.addText((text) => {
				text.setPlaceholder("my-script.mjs").onChange((value) => (this.name = value));
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus());
			});

		error = this.contentEl.createDiv({ cls: "scripts-modal-error" });

		new Setting(this.contentEl).addButton((button) => button.setButtonText("Create").setCta().onClick(submit));
	}

	onClose() {
		this.contentEl.empty();
	}
}
