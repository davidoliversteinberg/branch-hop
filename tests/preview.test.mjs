import assert from "node:assert/strict";
import { test } from "node:test";
import { BRANCH_BUDGET, keyForBranch, parsePreviewUrl, previewUrl } from "../src/shared/preview.ts";

const HOST = (key) => `axiom-play-git-${key}-optimizely-sandbox.vercel.app`;

test("a branch gets 29 characters before Vercel shortens it", () => {
  assert.equal(BRANCH_BUDGET, 29);
});

test("short branch names map straight into the URL", async () => {
  assert.equal(await keyForBranch("david/image-gen-editor"), "david-image-gen-editor");
  assert.equal(await keyForBranch("meridian-brand-template"), "meridian-brand-template");
  assert.equal(await keyForBranch("main"), "main");
});

// Hashes Vercel produced for real branches (one from a PR comment, one confirmed with a 401 response).
for (const [branch, key] of [
  ["david/frontend-designer-auto-update", "david-frontend-designe-6cbd7e"],
  ["experiment/template-card-with-description2", "experiment-template-ca-3893ad"],
]) {
  test(`long name ${branch} matches Vercel's shortened URL`, async () => {
    assert.equal(await keyForBranch(branch), key);
  });
}

test("parses a preview link into branch key and route", () => {
  assert.deepEqual(parsePreviewUrl(`https://${HOST("david-image-gen-editor")}/opal/image-gen?artifact=optimizely-hype-to-hero`), {
    host: HOST("david-image-gen-editor"),
    key: "david-image-gen-editor",
    route: "/opal/image-gen?artifact=optimizely-hype-to-hero",
  });
});

test("rejects anything that isn't exactly an Axiom Play preview", () => {
  for (const url of [
    `http://${HOST("main")}/`,
    `https://${HOST("main")}.evil.example/`,
    `https://evil-${HOST("main")}/`,
    `https://${HOST("main")}:8443/`,
    `https://user:pass@${HOST("main")}/`,
    "https://axiom-play-git--optimizely-sandbox.vercel.app/",
    "https://other-project-git-main-optimizely-sandbox.vercel.app/",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(parsePreviewUrl(url), null, url);
  }
});

test("previewUrl never leaves the preview host", () => {
  assert.equal(previewUrl("main", "/site/meridian?x=1#top"), `https://${HOST("main")}/site/meridian?x=1#top`);
  assert.equal(previewUrl("main", "//evil.example/x"), `https://${HOST("main")}/`);
  assert.equal(previewUrl("main", "/\\evil.example"), `https://${HOST("main")}/`);
  assert.equal(previewUrl("main", "https://evil.example/"), `https://${HOST("main")}/`);
  assert.throws(() => previewUrl("evil.example/x"));
  assert.throws(() => previewUrl("-bad"));
});

test("invalid branch names are refused", async () => {
  await assert.rejects(keyForBranch("../etc"));
  await assert.rejects(keyForBranch("name with spaces"));
  await assert.rejects(keyForBranch(""));
});
