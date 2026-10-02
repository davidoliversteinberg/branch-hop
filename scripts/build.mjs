import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(await readFile("package.json", "utf8"));

await rm("dist", { recursive: true, force: true });
await mkdir("dist/popup", { recursive: true });

const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
manifest.version = pkg.version;
await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
await cp("public/icons", "dist/icons", { recursive: true });
await cp("src/popup/index.html", "dist/popup/index.html");

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: ["chrome123", "safari17"],
  legalComments: "eof",
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
};

const configs = [
  {
    ...common,
    entryPoints: { popup: "src/popup/main.tsx" },
    outdir: "dist/popup",
    format: "esm",
    jsx: "automatic",
    loader: { ".woff2": "file", ".woff": "file" },
    assetNames: "assets/[name]-[hash]",
  },
  // The worker and the page script are plain scripts so they also run in Safari.
  { ...common, entryPoints: { background: "src/background/index.ts" }, outdir: "dist", format: "iife" },
  { ...common, entryPoints: { content: "src/content/index.ts" }, outdir: "dist", format: "iife" },
];

if (watch) {
  for (const config of configs) await (await context(config)).watch();
  console.log("Watching for changes. Reload the extension in your browser after each build.");
} else {
  await Promise.all(configs.map((config) => build(config)));
}
