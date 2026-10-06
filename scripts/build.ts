// Build dist/extension.js with the pinned Bun version so the committed bundle is
// reproducible. Run via `bun scripts/build.ts`; the Bun that runs this file is
// the Bun that bundles, so Bun.version is the exact bundler version.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
	engines: { bun: string };
};
if (Bun.version !== pkg.engines.bun) {
	console.error(
		`bun ${pkg.engines.bun} is required to build dist/extension.js; found bun ${Bun.version} at ${process.execPath}`,
	);
	process.exit(1);
}

const result = await Bun.build({
	entrypoints: [resolve(root, "src/extension.ts")],
	outdir: resolve(root, "dist"),
	target: "bun",
	format: "esm",
	external: ["@gajae-code/natives"],
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}
const out = result.outputs[0];
if (!out) throw new Error("bun build produced no output");
const hash = new Bun.CryptoHasher("sha256")
	.update(await out.arrayBuffer())
	.digest("hex");
console.log(`built ${out.path} with bun ${Bun.version} sha256 ${hash}`);
