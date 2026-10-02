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

test("favorites round-trip with name, note and route", async () => {
  await store.saveFavorite({ key: "david-image-gen-editor", name: "david/image-gen-editor", note: "Hype to hero demo", route: "/opal/image-gen", addedAt: 1 });
  assert.deepEqual(await store.getFavorites(), [{ key: "david-image-gen-editor", name: "david/image-gen-editor", note: "Hype to hero demo", route: "/opal/image-gen", addedAt: 1 }]);
});

test("tampered favorites are dropped or cleaned when read back", async () => {
  await chrome.storage.sync.set({
    "fav:ok": { key: "ok", note: "x".repeat(500), route: "//evil.example", name: "bad name<script>" },
    "fav:bad": { key: "evil.example/x" },
    "fav:junk": "not an object",
  });
  const favorites = await store.getFavorites();
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].key, "ok");
  assert.equal(favorites[0].note.length, store.NOTE_MAX);
  assert.equal(favorites[0].route, undefined);
  assert.equal(favorites[0].name, undefined);
});

test("saveFavorite refuses a key that isn't a preview branch", async () => {
  await assert.rejects(store.saveFavorite({ key: "../../x", addedAt: 0 }));
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
