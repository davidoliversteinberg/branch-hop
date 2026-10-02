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

test("recent visits keep the newest first, without duplicates", async () => {
  await store.recordVisit({ key: "main", route: "/", at: 1 });
  await store.recordVisit({ key: "meridian-brand-template", route: "/site/meridian", at: 2 });
  await store.recordVisit({ key: "main", route: "/opal/image-gen", at: 3 });
  assert.deepEqual((await store.getRecent()).map((v) => [v.key, v.route]), [
    ["main", "/opal/image-gen"],
    ["meridian-brand-template", "/site/meridian"],
  ]);
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
