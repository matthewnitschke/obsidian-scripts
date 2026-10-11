# Scripts

Keep [zx](https://google.github.io/zx/) scripts (`.mjs`, `.js`, `.ts`, `.mts`) in your vault and run them from your notes.

Link a script anywhere in a note — `[[deploy]]`, `[[deploy.mjs]]` or `![[deploy.mjs]]` — and it renders as a block:

- **Header:** script name, language, last run status (exit code + duration), **Run/Stop** and **Open** buttons
- **Body:** streamed stdout/stderr from the last run

Put the cursor inside the link in Live Preview to edit it as plain text. Script files open in a built-in editor (syntax highlighting, autocomplete for zx globals and `cache()`, run block). For intellisense and type checking in an external editor (VS Code, Cursor), run the **Set up editor types for this script's folder** command, which writes a `tsconfig.json` next to the script; install zx there (`pnpm add -D zx`). Create scripts from the file explorer context menu (**New script**), by right-clicking an uncreated `[[name.mjs]]` link (**Create script**), or with the **Create new script** command.

## Running

Scripts run with `zx --install <script>` (the command is configurable), so `$`, `cd`, `fs`, `chalk`, etc. are globals and imported packages are installed automatically. A trailing `// @version` comment pins a version:

```js
import { kebabCase } from "lodash-es"
import chalk from "chalk" // @5.3.0
```

`zx --install` installs into a `node_modules` folder next to the script, so it ends up in your vault. Consider adding `node_modules` to **Settings → Files and links → Excluded files**.

### `cache()`

Wrap expensive work in `cache(key, fn, deps?)` to reuse its result on later runs:

```js
const repos = await cache("repos", () => $`gh repo list --json name`.json())
const out = await cache("log", () => $`git log --since=${since}`, [since])   // zx output: .stdout, .json(), .lines() still work
const data = await cache("repo", () => fetchRepo(argv.id), [argv.id])
```

Each key holds one result. On a hit `fn` is never called. It's recomputed (and the result replaced) when the `deps` array or the function's source changes, like a `useMemo` that persists across runs.

Results must be JSON-serializable and are stored per script in `~/.cache/obsidian-scripts/results/` (configurable). The `cache()` runtime is preloaded into zx via `NODE_OPTIONS=--import`.

Blocks for scripts that use `cache(` show a **Run without cache** button (also a command), which reruns every `cache()` call and saves the fresh results. Cache hits/saves appear as dimmed lines in the output.

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
