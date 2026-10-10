# Scripts

Keep [zx](https://google.github.io/zx/) scripts (`.mjs`, `.js`, `.ts`, `.mts`) in your vault and run them from your notes.

Link a script anywhere in a note — `[[deploy]]`, `[[deploy.mjs]]` or `![[deploy.mjs]]` — and it renders as a block:

- **Header:** script name, language, last run status (exit code + duration), **Run/Stop** and **Open** buttons
- **Body:** streamed stdout/stderr from the last run

Put the cursor inside the link in Live Preview to edit it as plain text. Script files open in a built-in editor (syntax highlighting + run block). Create scripts from the file explorer context menu (**New script**), by right-clicking an uncreated `[[name.mjs]]` link (**Create script**), or with the **Create new script** command.

https://github.com/user-attachments/assets/c1bd6a59-65e1-4134-bdea-ac8a99a76b9c

## Features

### Output formats

Supports 3 output formats: `text`, `table`, and `mermaid`

Text converts a csv output of the script into a markdown rendered table, mermaid does the same for [MermaidJs](https://mermaid.js.org/) text

<img width="1176" height="720" alt="table-output" src="https://github.com/user-attachments/assets/ae2a34e3-dc7e-48ad-b356-77b7d59a6079" />

<img width="1056" height="720" alt="mermaid-output" src="https://github.com/user-attachments/assets/08ac0541-1d55-4856-9f5c-9220d3f7c198" />

### Arguments

Declare `argv.varName` in scripts to opt into argument passing

<img width="1264" height="720" alt="args" src="https://github.com/user-attachments/assets/7232b2cb-bf56-4369-84d9-9f8c0c9aea56" />

### Builtin Cache

Cache long running jobs with builtin `cache` function

```js
let waitTime = argv.time;
let res = await cache('job', () => $`sleep ${waitTime}`, [waitTime])
```

### Dependencies

Uses [`zx`](https://github.com/google/zx) for executing scripts. Declare dependencies inline with optional `// @version` annotation.

```js
import chalk from "chalk" // @5.3.0
```

Read more about dependencies in zx [here](https://google.github.io/zx/cli#install)

### Arguments

Each flag the script reads from zx's `argv` (`argv.repo`, `argv["since-date"]`, `const { repo } = argv`) gets a text input in the block header. Non-empty values are passed as `--name=value`; press Enter in an input to run. Values are kept per script for the session; pass them as `cache()` deps to recompute when they change.

Scripts run with the environment of an interactive login shell (your `.zshrc` PATH etc.), and receive:

| Var | Value |
| --- | --- |
| `OBSIDIAN_VAULT` | Absolute vault path |
| `OBSIDIAN_SCRIPT` | Absolute script path |
| `OBSIDIAN_NOTE` | Absolute path of the note the block was run from (empty when run from the script view) |

The working directory is the vault root (configurable to the script's folder). Output is shared per script and kept across re-renders; it's capped at 1M characters.

Desktop only.

## Development

```sh
pnpm install
pnpm dev     # watch build -> main.js
pnpm build   # typecheck + production build
```

Symlink (or copy `main.js`, `manifest.json`, `styles.css`) into `<vault>/.obsidian/plugins/scripts/` and enable the plugin.
