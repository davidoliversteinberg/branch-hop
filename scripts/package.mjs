import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("release", { recursive: true });
const out = `release/branch-hop-${version}.zip`;
rmSync(out, { force: true });
execFileSync("zip", ["-r", "-X", "-q", `../${out}`, "."], { cwd: "dist", stdio: "inherit" });
console.log(`Packaged ${out}`);
