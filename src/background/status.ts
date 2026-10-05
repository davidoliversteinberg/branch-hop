import { keyForBranch } from "../shared/preview.ts";
import {
  SOURCE_REPO,
  cleanStatusMap,
  cleanStatusMeta,
  decide,
  parseBranchSearch,
  parsePullSearch,
  searchWord,
  type BranchHit,
  type BranchStatus,
  type StatusHealth,
  type StatusMeta,
} from "../shared/status.ts";
import { getFavorites, getNames, getPins, getRecent, getSettings, rememberName } from "../shared/store.ts";

/**
 * Branch status, when you turn it on in Settings. github.com answers these two read-only pages with
 * the sign-in already in your browser, the same as when you open them yourself. Branch Hop never
 * reads or stores the cookies, never writes anything, and never asks for any other page.
 */
export const STATUS_ALARM = "branch-status";
const K = { map: "status:branches", meta: "status:meta" } as const;
const FRESH_MS = 25 * 60_000;
const MAX_BRANCHES = 40;
const MAX_PAGES = 5;
const MAX_BYTES = 2_000_000;
/** Politeness toward github.com: at most this many page requests per check, spaced out. */
const MAX_REQUESTS = 60;
const SPACING_MS = 300;
const BASE = `/${SOURCE_REPO.owner}/${SOURCE_REPO.name}`;
const ALLOWED = new RegExp(`^${BASE}/(branches/all\\?query=[^&#]{1,200}(&page=[1-9])?|pulls\\?q=[^&#]{1,300})$`);

class StatusError extends Error {
  constructor(
    readonly health: StatusHealth,
    message: string,
  ) {
    super(message);
  }
}

const SIGNED_OUT = "Sign in to github.com in this browser, with an account that can see axiom-play.";

/** Requests left in the current check. A check that runs out stops, and the next one carries on. */
let budget = 0;
class OutOfBudget extends Error {}

async function readPage(path: string): Promise<unknown> {
  if (!ALLOWED.test(path)) throw new StatusError("unavailable", "Branch Hop only reads axiom-play's branch and pull request lists.");
  if (budget <= 0) throw new OutOfBudget();
  if (budget < MAX_REQUESTS) await new Promise((r) => setTimeout(r, SPACING_MS));
  budget--;
  let res: Response;
  try {
    res = await fetch(`https://github.com${path}`, { credentials: "include", redirect: "manual", cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new StatusError("unavailable", "Branch Hop can't reach github.com right now.");
  }
  // A redirect is GitHub sending you to sign in or to single sign-on; 404 is how it hides internal repos.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 404 || res.status === 401) throw new StatusError("signed-out", SIGNED_OUT);
  if (res.status === 429) throw new StatusError("unavailable", "GitHub asked Branch Hop to slow down. It'll try again later.");
  if (!res.ok) throw new StatusError("unavailable", `GitHub answered ${res.status}. Branch Hop will try again later.`);
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new StatusError("signed-out", SIGNED_OUT);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new StatusError("unavailable", "GitHub's answer was larger than expected.");
  try {
    return JSON.parse(text);
  } catch {
    throw new StatusError("unavailable", "GitHub's answer wasn't readable.");
  }
}

const UNFAMILIAR = "GitHub changed how it lists branches, so Branch Hop can't read it. An update will fix this.";

/** Finds the branch behind a preview key. With a known name, a missing branch means it was deleted. */
async function findBranch(key: string, knownName: string | undefined): Promise<{ name: string; hit: BranchHit | null } | null> {
  const query = encodeURIComponent(knownName ?? searchWord(key));
  for (let page = 1; page <= (knownName ? 1 : MAX_PAGES); page++) {
    const raw = await readPage(`${BASE}/branches/all?query=${query}${page > 1 ? `&page=${page}` : ""}`);
    const hits = parseBranchSearch(raw);
    if (!hits) throw new StatusError("unavailable", UNFAMILIAR);
    for (const hit of hits) {
      if (knownName ? hit.name === knownName : (await keyForBranch(hit.name).catch(() => null)) === key) return { name: hit.name, hit };
    }
    const more = (raw as { payload?: { has_more?: unknown } }).payload?.has_more === true;
    if (!more) break;
  }
  return knownName ? { name: knownName, hit: null } : null;
}

async function checkBranch(key: string, knownName: string | undefined): Promise<BranchStatus | null> {
  const found = await findBranch(key, knownName);
  if (!found) return null; // Never seen under this key, so Branch Hop can't say anything about it.
  const pulls = parsePullSearch(await readPage(`${BASE}/pulls?q=${encodeURIComponent(`is:pr head:${found.name}`)}`));
  if (!pulls) throw new StatusError("unavailable", UNFAMILIAR);
  if (found.hit) await rememberName(key, found.name);
  return { key, name: found.name, ...decide(found.hit, pulls), checkedAt: Date.now() };
}

/** The branches worth checking: pinned and bookmarked first, then the most recent. */
async function branchesToCheck(): Promise<string[]> {
  const [pins, favorites, recent] = await Promise.all([getPins(), getFavorites(), getRecent()]);
  const keys = [...pins.map((p) => p.key), ...favorites.map((f) => f.key), ...recent.map((v) => v.key)];
  return [...new Set(keys)].filter((k) => k !== "main").slice(0, MAX_BRANCHES);
}

export async function getStatusMeta(): Promise<StatusMeta> {
  return cleanStatusMeta((await chrome.storage.local.get(K.meta))[K.meta]);
}

let running: Promise<StatusMeta> | null = null;

/** Refreshes branch status. Recently checked branches are skipped unless `force` is set. */
export function refreshStatuses(force = false): Promise<StatusMeta> {
  running ??= run(force).finally(() => {
    running = null;
  });
  return running;
}

async function run(force: boolean): Promise<StatusMeta> {
  const settings = await getSettings();
  if (!settings.branchStatus) {
    const off: StatusMeta = { health: "off", checkedAt: 0 };
    await chrome.storage.local.set({ [K.meta]: off });
    await chrome.storage.local.remove(K.map);
    return off;
  }
  const [keys, names, stored] = await Promise.all([branchesToCheck(), getNames(), chrome.storage.local.get(K.map)]);
  const map = cleanStatusMap(stored[K.map]);
  const due = keys
    .filter((k) => force || !map[k] || Date.now() - map[k].checkedAt > FRESH_MS)
    .sort((a, b) => (map[a]?.checkedAt ?? 0) - (map[b]?.checkedAt ?? 0));
  let meta: StatusMeta = { health: "ok", checkedAt: Date.now() };
  budget = MAX_REQUESTS;
  for (const key of due) {
    try {
      const status = await checkBranch(key, names[key] ?? map[key]?.name);
      if (status) map[key] = status;
    } catch (err) {
      if (err instanceof OutOfBudget) break; // The rest are checked next time, oldest first.
      meta = err instanceof StatusError ? { health: err.health, checkedAt: Date.now(), message: err.message } : { health: "unavailable", checkedAt: Date.now(), message: "Couldn't check GitHub." };
      break;
    }
  }
  const kept = Object.fromEntries(Object.entries(map).filter(([k]) => keys.includes(k)));
  await chrome.storage.local.set({ [K.map]: kept, [K.meta]: meta });
  return meta;
}
