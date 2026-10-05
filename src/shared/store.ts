import { BRANCH_NAME_RE, KEY_RE, isSafeRoute, pagePath } from "./preview.ts";

/**
 * Storage layout
 * - sync:    settings, one "fav:<id>" item per bookmarked page and one "pin:<key>" item per pinned branch
 *            (follows your browser profile)
 * - local:   recent visits and known branch names (this device only)
 * - session: per-tab state for flipping back (cleared when the browser closes)
 * Content scripts can read sync and local, so everything read back is validated.
 */
export type Settings = {
  /** Open branches in a new tab instead of this one. Cmd/Ctrl flips it for one open. */
  newTab: boolean;
  /** Check axiom-play on github.com for merged branches, with the browser's own GitHub sign-in. */
  branchStatus: boolean;
  tabLabels: boolean;
  pagePill: boolean;
  notifyShares: boolean;
  notifyComments: boolean;
  desktopAlerts: boolean;
};
/**
 * A bookmark is one page on one branch, so a branch can have several. It's stored as a "favorite",
 * the name it had before 0.4, so older versions keep reading it.
 * `id` is "<key>@<page hash>"; favorites saved before 0.3.1 were per branch and use just "<key>".
 */
export type Favorite = { id: string; key: string; route: string; name?: string; note?: string; addedAt: number };
export type NewFavorite = Omit<Favorite, "id">;
/** A pinned branch stays at the top of the list. A branch with bookmarks counts as pinned too. */
export type Pin = { key: string; name?: string; addedAt: number };
/** Everything Branch Hop keeps about one branch, so removing it can be undone. */
export type BranchSnapshot = { key: string; pin?: Pin; favorites: Favorite[]; visits: Visit[] };
export type Visit = { key: string; route: string; at: number };
export type TabState = { key: string; route: string; prevKey?: string };

export const DEFAULT_SETTINGS: Settings = {
  newTab: false,
  branchStatus: false,
  tabLabels: true,
  pagePill: true,
  notifyShares: true,
  notifyComments: true,
  desktopAlerts: true,
};
export const NOTE_MAX = 120;
const RECENT_MAX = 60;
const FAVORITES_MAX = 200;
const NAMES_MAX = 500;
const PINS_MAX = 100;
const FAV_PREFIX = "fav:";
const PIN_PREFIX = "pin:";

const ID_RE = new RegExp(`^${KEY_RE.source.slice(1, -1)}(?:@[0-9a-f]{8})?$`);
const cleanKey = (v: unknown): string | null => (typeof v === "string" && KEY_RE.test(v) ? v : null);
const cleanName = (v: unknown): string | undefined => (typeof v === "string" && BRANCH_NAME_RE.test(v) ? v : undefined);
const cleanNote = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, NOTE_MAX) : undefined);
const cleanRoute = (v: unknown): string | undefined => (isSafeRoute(v) ? v : undefined);
const cleanTime = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** FNV-1a, enough to tell a branch's pages apart in a storage key. */
function pageHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const favoriteId = (key: string, route: string): string => `${key}@${pageHash(pagePath(route))}`;

/** Same branch and same page; the query and fragment don't count. */
export const isSamePage = (f: { key: string; route: string }, key: string, route: string): boolean => f.key === key && pagePath(f.route) === pagePath(route);

export function findFavorite(favorites: Favorite[], key: string, route: string): Favorite | undefined {
  return favorites.find((f) => isSamePage(f, key, route));
}

function cleanFavorite(v: unknown, id: string): Favorite | null {
  if (!v || typeof v !== "object" || !ID_RE.test(id)) return null;
  const o = v as Record<string, unknown>;
  const key = cleanKey(o.key);
  if (!key || (id !== key && !id.startsWith(`${key}@`))) return null;
  // Older branch favorites without a page open the branch's home page.
  return { id, key, route: cleanRoute(o.route) ?? "/", name: cleanName(o.name), note: cleanNote(o.note), addedAt: cleanTime(o.addedAt) };
}

function cleanVisit(v: unknown): Visit | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const key = cleanKey(o.key);
  const route = cleanRoute(o.route);
  return key && route ? { key, route, at: cleanTime(o.at) } : null;
}

/* Settings */
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get("settings");
  const out = { ...DEFAULT_SETTINGS };
  if (settings && typeof settings === "object") {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (settings as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const settings = await getSettings();
  await chrome.storage.sync.set({ settings: { ...settings, [key]: value } });
}

/* Favorites */
export async function getFavorites(): Promise<Favorite[]> {
  const all = await chrome.storage.sync.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(FAV_PREFIX))
    .map(([k, v]) => cleanFavorite(v, k.slice(FAV_PREFIX.length)))
    .filter((f): f is Favorite => f !== null);
}

/** Saves a page as a favorite, or updates the one already saved for that page. */
export async function saveFavorite(fav: NewFavorite): Promise<Favorite> {
  if (!cleanKey(fav.key) || !isSafeRoute(fav.route)) throw new Error("Not a valid favorite");
  const id = favoriteId(fav.key, fav.route);
  const clean = cleanFavorite(fav, id);
  if (!clean) throw new Error("Not a valid favorite");
  const existing = await getFavorites();
  const samePage = existing.filter((f) => isSamePage(f, clean.key, clean.route));
  if (!samePage.length && existing.length >= FAVORITES_MAX) {
    throw new Error(`You can keep up to ${FAVORITES_MAX} favorites`);
  }
  const { id: _id, ...stored } = clean;
  await chrome.storage.sync.set({ [FAV_PREFIX + id]: stored });
  // An older per-branch entry for this page is replaced by the new one.
  const stale = samePage.filter((f) => f.id !== id).map((f) => FAV_PREFIX + f.id);
  if (stale.length) await chrome.storage.sync.remove(stale);
  return clean;
}

export async function removeFavorite(id: string): Promise<void> {
  if (ID_RE.test(id)) await chrome.storage.sync.remove(FAV_PREFIX + id);
}

/** A favorite from before 0.3.1 that only marks the branch: no page of its own and no note. */
export const isBranchOnly = (f: Favorite): boolean => !f.id.includes("@") && pagePath(f.route) === "/" && !f.note;

/* Pinned branches */
export async function getPins(): Promise<Pin[]> {
  const all = await chrome.storage.sync.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PIN_PREFIX))
    .flatMap(([k, v]) => {
      const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const key = cleanKey(o.key);
      return key && k === PIN_PREFIX + key ? [{ key, name: cleanName(o.name), addedAt: cleanTime(o.addedAt) }] : [];
    });
}

export async function pinBranch(pin: Pin): Promise<void> {
  const key = cleanKey(pin.key);
  if (!key) throw new Error("Not a valid branch");
  const pins = await getPins();
  if (!pins.some((p) => p.key === key) && pins.length >= PINS_MAX) throw new Error(`You can pin up to ${PINS_MAX} branches`);
  await chrome.storage.sync.set({ [PIN_PREFIX + key]: { key, name: cleanName(pin.name), addedAt: cleanTime(pin.addedAt) } });
}

/** Removes a branch from Branch Hop: its pin, bookmarks and history. Returns what was removed. */
export async function forgetBranch(key: string, opts: { visits: boolean }): Promise<BranchSnapshot> {
  if (!cleanKey(key)) throw new Error("Not a valid branch");
  const [pins, favorites, recent] = await Promise.all([getPins(), getFavorites(), getRecent()]);
  const snapshot: BranchSnapshot = {
    key,
    pin: pins.find((p) => p.key === key),
    favorites: favorites.filter((f) => f.key === key),
    visits: opts.visits ? recent.filter((v) => v.key === key) : [],
  };
  await chrome.storage.sync.remove([PIN_PREFIX + key, ...snapshot.favorites.map((f) => FAV_PREFIX + f.id)]);
  if (opts.visits && snapshot.visits.length) await chrome.storage.local.set({ recent: recent.filter((v) => v.key !== key) });
  return snapshot;
}

/** Puts back what forgetBranch removed. */
export async function restoreBranch(snapshot: BranchSnapshot): Promise<void> {
  if (snapshot.pin) await pinBranch(snapshot.pin);
  const items: Record<string, unknown> = {};
  for (const f of snapshot.favorites) {
    const clean = cleanFavorite(f, f.id);
    if (clean) {
      const { id, ...stored } = clean;
      items[FAV_PREFIX + id] = stored;
    }
  }
  if (Object.keys(items).length) await chrome.storage.sync.set(items);
  if (snapshot.visits.length) {
    const recent = await getRecent();
    const merged = [...snapshot.visits, ...recent].map(cleanVisit).filter((v): v is Visit => v !== null).sort((a, b) => b.at - a.at);
    await chrome.storage.local.set({ recent: merged.slice(0, RECENT_MAX) });
  }
}

/* Recent visits */
export async function getRecent(): Promise<Visit[]> {
  const { recent } = await chrome.storage.local.get("recent");
  return Array.isArray(recent) ? recent.map(cleanVisit).filter((v): v is Visit => v !== null) : [];
}

export async function recordVisit(visit: Visit): Promise<void> {
  const clean = cleanVisit(visit);
  if (!clean) return;
  const recent = await getRecent();
  // One entry per page, so every page you open shows up, even several on the same branch.
  await chrome.storage.local.set({ recent: [clean, ...recent.filter((v) => !isSamePage(v, clean.key, clean.route))].slice(0, RECENT_MAX) });
}

export async function clearRecent(): Promise<void> {
  await chrome.storage.local.remove("recent");
}

/* Branch names learned from typing or pasting, so long hashed keys can show their real name */
export async function getNames(): Promise<Record<string, string>> {
  const { names } = await chrome.storage.local.get("names");
  const out: Record<string, string> = {};
  if (names && typeof names === "object") {
    for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
      const name = cleanName(v);
      if (cleanKey(k) && name) out[k] = name;
    }
  }
  return out;
}

export async function rememberName(key: string, name: string): Promise<void> {
  if (!cleanKey(key) || !cleanName(name)) return;
  const names = await getNames();
  if (names[key] === name) return;
  const entries = Object.entries({ ...names, [key]: name }).slice(-NAMES_MAX);
  await chrome.storage.local.set({ names: Object.fromEntries(entries) });
}

/* Per-tab state, kept out of reach of content scripts */
const sessionArea = (): chrome.storage.StorageArea => chrome.storage.session ?? chrome.storage.local;

export async function getTabState(tabId: number): Promise<TabState | null> {
  const k = `tab:${tabId}`;
  const v = (await sessionArea().get(k))[k] as Record<string, unknown> | undefined;
  const key = cleanKey(v?.key);
  const route = cleanRoute(v?.route);
  if (!key || !route) return null;
  return { key, route, prevKey: cleanKey(v?.prevKey) ?? undefined };
}

export async function setTabState(tabId: number, state: TabState): Promise<void> {
  await sessionArea().set({ [`tab:${tabId}`]: state });
}

export async function clearTabState(tabId: number): Promise<void> {
  await sessionArea().remove(`tab:${tabId}`);
}

/* Branches you've muted: no comment notifications for these */
export async function getMuted(): Promise<string[]> {
  const { muted } = await chrome.storage.sync.get("muted");
  return Array.isArray(muted) ? muted.filter((k): k is string => cleanKey(k) !== null).slice(0, FAVORITES_MAX) : [];
}

export async function setMuted(key: string, isMuted: boolean): Promise<void> {
  if (!cleanKey(key)) return;
  const muted = new Set(await getMuted());
  if (isMuted) muted.add(key);
  else muted.delete(key);
  await chrome.storage.sync.set({ muted: [...muted].slice(0, FAVORITES_MAX) });
}
