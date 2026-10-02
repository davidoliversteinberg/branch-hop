// Stand-in for the extension APIs so the built popup can be rendered in a normal page.
// Sample data only; the people in it are made up.
// Query options: ?tab=other  ?empty=1  ?gh=signedout|pending|signedin (default signedin)
(() => {
  const params = new URLSearchParams(location.search);
  const now = Date.now();
  const min = 60e3;
  const iso = (ms) => new Date(ms).toISOString();
  const repo = "https://github.com/davidoliversteinberg/branch-hop-shared/issues/";
  const me = { login: "davidoliversteinberg", name: "David Steinberg" };
  const ghMode = params.get("gh") ?? "signedin";

  const shared = {
    status: "ok",
    fetchedAt: now - 30e3,
    people: [me, { login: "alex-designer", name: "Alex Rivera" }, { login: "sam-pm" }],
    lists: [
      { name: "Opal review", color: "197A94" },
      { name: "STRIDE templates", color: "7C3AED" },
    ],
    items: [
      { number: 3, key: "meridian-brand-template", route: "/site/meridian", note: "Meridian review on Friday. Check the hero on mobile.", lists: ["STRIDE templates"], sharedWith: [me.login], sharedBy: "alex-designer", comments: 2, createdAt: iso(now - 26 * 60 * min), updatedAt: iso(now - 20 * min), url: repo + 3 },
      { number: 5, key: "experiment-template-ca-3893ad", name: "experiment/template-card-with-description2", route: "/analytics", note: "Cohort chart is ready for a look", lists: [], sharedWith: [me.login], sharedBy: "sam-pm", comments: 0, createdAt: iso(now - 4 * 60 * min), updatedAt: iso(now - 3 * 60 * min), url: repo + 5 },
      { number: 2, key: "david-vision-template", name: "david/vision-template", route: "/site/vision", note: "Photography-led Brand Portal for STRIDE", lists: ["STRIDE templates"], sharedWith: ["alex-designer"], sharedBy: me.login, comments: 4, createdAt: iso(now - 3 * 1440 * min), updatedAt: iso(now - 1440 * min), url: repo + 2 },
      { number: 1, key: "main", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", note: "Baseline for the image gen review", lists: ["Opal review"], sharedWith: [], sharedBy: me.login, comments: 0, createdAt: iso(now - 4 * 1440 * min), updatedAt: iso(now - 2 * 1440 * min), url: repo + 1 },
    ],
  };
  const comments = {
    3: [
      { id: 11, issue: 3, author: "alex-designer", body: "Pushed a new hero crop. Can you check it on mobile?", createdAt: iso(now - 50 * min), updatedAt: iso(now - 50 * min), url: repo + "3#issuecomment-11" },
      { id: 12, issue: 3, author: me.login, body: "Looks good. The CTA wraps at 375px, though.", createdAt: iso(now - 30 * min), updatedAt: iso(now - 30 * min), url: repo + "3#issuecomment-12" },
    ],
  };
  const auth =
    ghMode === "signedout"
      ? { state: "signed-out" }
      : ghMode === "pending"
        ? { state: "pending", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: now + 14 * min }
        : { state: "signed-in", me };

  const seed = params.has("empty")
    ? { sync: {}, local: {}, session: { "gh:auth": auth } }
    : {
        sync: {
          "fav:meridian-brand-template": { key: "meridian-brand-template", note: "Meridian review on Friday", route: "/site/meridian", addedAt: now - 9e6 },
          "fav:main": { key: "main", addedAt: now - 8e6 },
          "fav:david-vision-template": { key: "david-vision-template", name: "david/vision-template", note: "STRIDE Brand Portal, photography-led", addedAt: now - 7e6 },
        },
        local: {
          recent: [
            { key: "david-image-gen-editor", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", at: now - 2 * min },
            { key: "meridian-brand-template", route: "/site/meridian", at: now - 18 * min },
            { key: "main", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", at: now - 64 * min },
            { key: "research-brief-platform", route: "/research", at: now - 5 * 60 * min },
          ],
          names: { "david-image-gen-editor": "david/image-gen-editor", "david-vision-template": "david/vision-template" },
          ...(ghMode === "signedin" ? { "gh:shared": shared, "gh:unread": { 3: { shared: true, comments: 1 }, 5: { shared: true } } } : {}),
        },
        session: { "tab:1": { key: "david-image-gen-editor", route: "/opal/image-gen?artifact=optimizely-hype-to-hero", prevKey: "meridian-brand-template" }, "gh:auth": auth },
      };

  const listeners = new Set();
  const areas = {};
  function area(name) {
    let data = structuredClone(seed[name]);
    const fire = (changes) => listeners.forEach((fn) => fn(changes, name));
    return (areas[name] = {
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
    });
  }

  async function background(req) {
    console.log("[mock] background", req.type);
    switch (req.type) {
      case "auth-status":
        return (await areas.session.get("gh:auth"))["gh:auth"];
      case "auth-start": {
        const pending = { state: "pending", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 15 * min };
        await areas.session.set({ "gh:auth": pending });
        return pending;
      }
      case "auth-cancel":
        await areas.session.set({ "gh:auth": { state: "signed-out" } });
        return null;
      case "sync":
        return shared;
      case "mark-read":
        await areas.local.set({ "gh:unread": {} });
        return null;
      case "comments":
        return comments[req.issue] ?? [];
      case "comment":
        return { id: Date.now(), issue: req.issue, author: me.login, body: req.body, createdAt: iso(Date.now()), updatedAt: iso(Date.now()), url: repo + req.issue };
      default:
        return null;
    }
  }

  const tabUrl = params.get("tab") === "other" ? undefined : "https://axiom-play-git-david-image-gen-editor-optimizely-sandbox.vercel.app/opal/image-gen?artifact=optimizely-hype-to-hero";
  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
    tabs: {
      query: async () => [{ id: 1, index: 0, windowId: 1, url: tabUrl }],
      update: async (id, props) => console.log("[mock] tabs.update", id, props.url),
      create: async (props) => console.log("[mock] tabs.create", props.url),
      get: async (id) => ({ id, url: tabUrl }),
    },
    commands: { getAll: async () => [{ name: "_execute_action", shortcut: "⌥⇧B" }, { name: "flip-branch", shortcut: "⌥⇧F" }] },
    permissions: { contains: async () => true, request: async () => true },
    notifications: { create: () => undefined },
    runtime: {
      id: "harness",
      getManifest: () => ({ version: "0.2.0" }),
      getURL: (p) => `chrome-extension://harness/${p}`,
      sendMessage: async (req) => {
        try {
          return { ok: true, data: (await background(req)) ?? null };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    },
  };
  window.close = () => console.log("[mock] window.close()");
})();
