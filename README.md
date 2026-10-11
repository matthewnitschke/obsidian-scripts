# obsidian-scripts

Run [zx](https://google.github.io/zx/) scripts in your vault and run them from your notes.

<img width="1280" height="680" alt="demo" src="https://github.com/user-attachments/assets/1c428fc6-5004-404d-a103-5ea63755cb5c" />

## Features

### Script Editing

Edit scripts directly in obsidian with minimal autocomplete supported

<img width="660" height="334" alt="Screenshot 2026-10-11 at 10 01 40 AM" src="https://github.com/user-attachments/assets/d1a99345-2aff-4ba6-bd9f-4451c34446f4" />

### Output formats

Supports 3 output formats: `text`, `table`, and `mermaid`

#### Text

<img width="659" height="231" alt="Screenshot 2026-10-11 at 10 06 31 AM" src="https://github.com/user-attachments/assets/747757c6-652a-4a40-bf68-be73fbb47fe7" />

#### Table

Output content as `csv`, it will be translated into a markdown table

<img width="659" height="417" alt="Screenshot 2026-10-11 at 10 04 34 AM" src="https://github.com/user-attachments/assets/0eb66bfa-bf7f-4533-ab04-2af8732e27a2" />

#### [MermaidJs](https://mermaid.js.org/)

Supports all mermaidjs rendering functionality that is default supported in obsidian. Colors will match current obsidian theme values.

<img width="659" height="733" alt="Screenshot 2026-10-11 at 10 05 13 AM" src="https://github.com/user-attachments/assets/bef4125d-b91d-406d-ac62-f5fa31e9eede" />

### Arguments

Declare `argv.varName` in scripts to support into argument passing

<img width="1280" height="538" alt="argv" src="https://github.com/user-attachments/assets/66a4bd6f-8efc-4878-a120-5289f968c1a1" />

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

## Development

```sh
pnpm install
pnpm dev     # watch build -> main.js
pnpm build   # typecheck + production build
```

Symlink (or copy `main.js`, `manifest.json`, `styles.css`) into `<vault>/.obsidian/plugins/scripts/` and enable the plugin.
