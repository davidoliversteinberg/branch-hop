import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Minimal stand-in for chrome.storage, enough to test what the store accepts and rejects.
function area() {
  let data = {};
  return {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      data = { ...data, ...structuredClone(items) };
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    _raw: () => data,
  };
}
globalThis.chrome = { storage: { sync: area(), local: area(), session: area() } };
const store = await import("../src/shared/store.ts");

beforeEach(async () => {
  globalThis.chrome.storage.sync = area();
  globalThis.chrome.storage.local = area();
  globalThis.chrome.storage.session = area();
});

test("favorites round-trip with name, note and page", async () => {
  const saved = await store.saveFavorite({ key: "david-image-gen-editor", name: "david/image-gen-editor", note: "Hype to hero demo", route: "/opal/image-gen", addedAt: 1 });
  assert.match(saved.id, /^david-image-gen-editor@[0-9a-f]{8}$/);
  assert.deepEqual(await store.getFavorites(), [
    { id: saved.id, key: "david-image-gen-editor", name: "david/image-gen-editor", note: "Hype to hero demo", route: "/opal/image-gen", addedAt: 1 },
  ]);
});

test("one branch can have several favorite pages", async () => {
  await store.saveFavorite({ key: "david-stride-refresh", route: "/site/brand/brand-story", addedAt: 1 });
  await store.saveFavorite({ key: "david-stride-refresh", route: "/opal/image-gen", addedAt: 2 });
  const favorites = await store.getFavorites();
  assert.deepEqual(favorites.map((f) => f.route).sort(), ["/opal/image-gen", "/site/brand/brand-story"]);
  assert.equal(store.findFavorite(favorites, "david-stride-refresh", "/opal/image-gen?tab=2#top")?.route, "/opal/image-gen");
  assert.equal(store.findFavorite(favorites, "david-stride-refresh", "/site"), undefined);
});

test("saving the same page again updates it instead of adding another", async () => {
  await store.saveFavorite({ key: "main", route: "/opal?a=1", addedAt: 1 });
  await store.saveFavorite({ key: "main", route: "/opal?a=2", note: "Opal", addedAt: 1 });
  const favorites = await store.getFavorites();
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].note, "Opal");
});

test("older per-branch favorites still load, and are replaced when that page is saved", async () => {
  await chrome.storage.sync.set({ "fav:main": { key: "main", route: "/opal/image-gen", addedAt: 1 }, "fav:old": { key: "old", addedAt: 1 } });
  const before = await store.getFavorites();
  assert.deepEqual(before.map((f) => [f.id, f.route]).sort(), [["main", "/opal/image-gen"], ["old", "/"]]);
  await store.saveFavorite({ key: "main", route: "/opal/image-gen", note: "Image gen", addedAt: 1 });
  const after = await store.getFavorites();
  assert.equal(after.filter((f) => f.key === "main").length, 1);
  assert.equal(after.find((f) => f.key === "main").note, "Image gen");
  assert.ok(!("fav:main" in chrome.storage.sync._raw()));
});

test("removeFavorite removes only that page", async () => {
  const a = await store.saveFavorite({ key: "main", route: "/a", addedAt: 1 });
  await store.saveFavorite({ key: "main", route: "/b", addedAt: 1 });
  await store.removeFavorite(a.id);
  assert.deepEqual((await store.getFavorites()).map((f) => f.route), ["/b"]);
});

test("tampered favorites are dropped or cleaned when read back", async () => {
  await chrome.storage.sync.set({
    "fav:ok": { key: "ok", note: "x".repeat(500), route: "//evil.example", name: "bad name<script>" },
    "fav:bad": { key: "evil.example/x" },
    "fav:mismatch": { key: "other" },
    "fav:junk": "not an object",
  });
  const favorites = await store.getFavorites();
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].key, "ok");
  assert.equal(favorites[0].note.length, store.NOTE_MAX);
  assert.equal(favorites[0].route, "/");
  assert.equal(favorites[0].name, undefined);
});

test("saveFavorite refuses a key that isn't a preview branch, or an unsafe page", async () => {
  await assert.rejects(store.saveFavorite({ key: "../../x", route: "/", addedAt: 0 }));
  await assert.rejects(store.saveFavorite({ key: "main", route: "//evil.example", addedAt: 0 }));
});

test("recent keeps every page, newest first, one entry per page", async () => {
  await store.recordVisit({ key: "main", route: "/", at: 1 });
  await store.recordVisit({ key: "meridian-brand-template", route: "/site/meridian", at: 2 });
  await store.recordVisit({ key: "main", route: "/opal/image-gen", at: 3 });
  await store.recordVisit({ key: "main", route: "/?tab=2", at: 4 });
  assert.deepEqual((await store.getRecent()).map((v) => [v.key, v.route]), [
    ["main", "/?tab=2"],
    ["main", "/opal/image-gen"],
    ["meridian-brand-template", "/site/meridian"],
  ]);
});

test("branches open in this tab, and branch status stays off, until you turn them on", async () => {
  const s = await store.getSettings();
  assert.equal(s.newTab, false);
  assert.equal(s.branchStatus, false);
});

test("settings fall back to defaults and ignore non-boolean values", async () => {
  await chrome.storage.sync.set({ settings: { tabLabels: false, pagePill: "yes" } });
  assert.deepEqual(await store.getSettings(), { ...store.DEFAULT_SETTINGS, tabLabels: false });
});

test("muted branches are validated and de-duplicated", async () => {
  await store.setMuted("main", true);
  await store.setMuted("main", true);
  await store.setMuted("../evil", true);
  assert.deepEqual(await store.getMuted(), ["main"]);
  await store.setMuted("main", false);
  assert.deepEqual(await store.getMuted(), []);
});

test("pins round-trip and reject bad keys", async () => {
  await store.pinBranch({ key: "opticon-mx", addedAt: 5 });
  await assert.rejects(store.pinBranch({ key: "Not A Key", addedAt: 1 }));
  assert.deepEqual(await store.getPins(), [{ key: "opticon-mx", name: undefined, addedAt: 5 }]);
});

test("forgetting a branch removes its pin, bookmarks and history, and restoring puts them back", async () => {
  await store.pinBranch({ key: "opticon-mx", addedAt: 1 });
  await store.saveFavorite({ key: "opticon-mx", route: "/opal/messages", note: "Messages", addedAt: 2 });
  await store.saveFavorite({ key: "main", route: "/", addedAt: 3 });
  await store.recordVisit({ key: "opticon-mx", route: "/opal/messages?conversation=cb", at: 10 });
  await store.recordVisit({ key: "main", route: "/", at: 11 });

  const snapshot = await store.forgetBranch("opticon-mx", { visits: true });
  assert.equal(snapshot.favorites.length, 1);
  assert.deepEqual((await store.getPins()).map((p) => p.key), []);
  assert.deepEqual((await store.getFavorites()).map((f) => f.key), ["main"]);
  assert.deepEqual((await store.getRecent()).map((v) => v.key), ["main"]);

  await store.restoreBranch(snapshot);
  assert.deepEqual((await store.getPins()).map((p) => p.key), ["opticon-mx"]);
  assert.equal((await store.getFavorites()).find((f) => f.key === "opticon-mx")?.note, "Messages");
  assert.deepEqual((await store.getRecent()).map((v) => v.key), ["main", "opticon-mx"]);
});

test("unpinning keeps history", async () => {
  await store.pinBranch({ key: "opticon-mx", addedAt: 1 });
  await store.recordVisit({ key: "opticon-mx", route: "/", at: 10 });
  await store.forgetBranch("opticon-mx", { visits: false });
  assert.deepEqual((await store.getRecent()).map((v) => v.key), ["opticon-mx"]);
});

test("a pre-0.3.1 favorite without a page or note only marks the branch", async () => {
  await globalThis.chrome.storage.sync.set({ "fav:main": { key: "main", addedAt: 1 }, "fav:meridian": { key: "meridian", route: "/site", note: "Review", addedAt: 1 } });
  const favs = await store.getFavorites();
  assert.equal(store.isBranchOnly(favs.find((f) => f.key === "main")), true);
  assert.equal(store.isBranchOnly(favs.find((f) => f.key === "meridian")), false);
});

test("settings drop the removed keep-route option and default the new ones", async () => {
  await globalThis.chrome.storage.sync.set({ settings: { keepRoute: true, newTab: true } });
  const s = await store.getSettings();
  assert.equal("keepRoute" in s, false);
  assert.equal(s.newTab, true);
  assert.equal(s.branchStatus, false);
});
