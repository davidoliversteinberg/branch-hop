// Stand-in for the extension APIs so the built popup can be rendered in a normal page.
// Sample data only. Pick a state with ?tab=other or ?empty=1.
(() => {
  const params = new URLSearchParams(location.search);
  const now = Date.now();
  const min = 60e3;
  const host = (key) => `https://axiom-play-git-${key}-optimizely-sandbox.vercel.app`;
  const seed = params.has("empty")
    ? { sync: {}, local: {}, session: {} }
    : {
        sync: {
          "fav:tra-meridian-brand-template": { key: "tra-meridian-brand-template", note: "Meridian review with Tra on Friday", route: "/site/meridian", addedAt: now - 9e6 },
          "fav:main": { key: "main", addedAt: now - 8e6 },
          "fav:david-vision-template": { key: "david-vision-template", name: "david/vision-template", note: "STRIDE Brand Portal, photography-led", addedAt: now - 7e6 },
          "fav:ola-analytics-product-c18b65": { key: "ola-analytics-product-c18b65", name: "ola/analytics-product-scaffold", addedAt: now - 6e6 },
        },
        local: {
          recent: [
            { key: "david-image-gen-editor", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", at: now - 2 * min },
            { key: "tra-meridian-brand-template", route: "/site/meridian", at: now - 18 * min },
            { key: "main", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", at: now - 64 * min },
            { key: "research-brief-platform", route: "/research", at: now - 5 * 60 * min },
            { key: "ola-analytics-product-c18b65", route: "/analytics", at: now - 26 * 60 * min },
            { key: "brand-portal-template", route: "/site/stride", at: now - 30 * 60 * min },
          ],
          names: { "david-image-gen-editor": "david/image-gen-editor", "ola-analytics-product-c18b65": "ola/analytics-product-scaffold", "david-vision-template": "david/vision-template" },
        },
        session: { "tab:1": { key: "david-image-gen-editor", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", prevKey: "tra-meridian-brand-template" } },
      };
  const listeners = new Set();
  function area(name) {
    let data = structuredClone(seed[name]);
    const fire = (changes) => listeners.forEach((fn) => fn(changes, name));
    return {
      async get(keys) {
        if (keys === null || keys === undefined) return structuredClone(data);
        const list = Array.isArray(keys) ? keys : [keys];
        return structuredClone(Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]])));
      },
      async set(items) {
        data = { ...data, ...structuredClone(items) };
        fire(Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }])));
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        fire({});
      },
    };
  }
  const tabUrl = params.get("tab") === "other" ? undefined : `${host("david-image-gen-editor")}/opal/image-gen?artifact=optimizely-hype-to-hero`;
  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    tabs: {
      query: async () => [{ id: 1, index: 0, windowId: 1, url: tabUrl }],
      update: async (id, props) => console.log("[mock] tabs.update", id, props.url),
      create: async (props) => console.log("[mock] tabs.create", props.url),
      get: async (id) => ({ id, url: tabUrl }),
    },
    commands: { getAll: async () => [{ name: "_execute_action", shortcut: "⌥⇧B" }, { name: "flip-branch", shortcut: "⌥⇧F" }] },
    runtime: { getManifest: () => ({ version: "0.1.0" }), id: "harness" },
  };
  window.close = () => console.log("[mock] window.close()");
})();
