import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

/**
 * `import HOOKS_SOURCE from "virtual:hooks"` -> src/hooks/hooks.ts bundled into a standalone ESM
 * string, which the plugin writes to disk and preloads into script runs with `node --import`.
 */
const hooksPlugin = {
	name: "hooks",
	setup(build) {
		build.onResolve({ filter: /^virtual:hooks$/ }, () => ({ path: "hooks", namespace: "hooks" }));
		build.onLoad({ filter: /.*/, namespace: "hooks" }, async () => {
			const result = await esbuild.build({
				entryPoints: ["src/hooks/hooks.ts"],
				bundle: true,
				platform: "node",
				format: "esm",
				target: "node22",
				write: false,
				metafile: true,
			});
			return {
				contents: result.outputFiles[0].text,
				loader: "text",
				watchFiles: Object.keys(result.metafile.inputs),
			};
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	plugins: [hooksPlugin],
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	target: "es2021",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
