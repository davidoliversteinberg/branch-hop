import { BRANCH_NAME_RE, KEY_RE, isSafeRoute } from "./preview.ts";

/**
 * Storage layout
 * - sync:    settings, one "fav:<key>" item per favorite (follows your browser profile)
 * - local:   recent visits and known branch names (this device only)
 * - session: per-tab state for flipping back (cleared when the browser closes)
 * Content scripts can read sync and local, so everything read back is validated.
 */
export type Settings = {
  keepRoute: boolean;
  tabLabels: boolean;
  pagePill: boolean;
  notifyShares: boolean;
  notifyComments: boolean;
  desktopAlerts: boolean;
};
export type Favorite = { key: string; name?: string; note?: string; route?: string; addedAt: number };
export type Visit = { key: string; route: string; at: number };
export type TabState = { key: string; route: string; prevKey?: string };

export const DEFAULT_SETTINGS: Settings = {
  keepRoute: true,
  tabLabels: true,
  pagePill: true,
  notifyShares: true,
  notifyComments: true,
  desktopAlerts: true,
};
export const NOTE_MAX = 120;
const RECENT_MAX = 40;
const FAVORITES_MAX = 200;
const NAMES_MAX = 500;
const FAV_PREFIX = "fav:";

const cleanKey = (v: unknown): string | null => (typeof v === "string" && KEY_RE.test(v) ? v : null);
const cleanName = (v: unknown): string | undefined => (typeof v === "string" && BRANCH_NAME_RE.test(v) ? v : undefined);
const cleanNote = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, NOTE_MAX) : undefined);
const cleanRoute = (v: unknown): string | undefined => (isSafeRoute(v) ? v : undefined);
const cleanTime = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function cleanFavorite(v: unknown): Favorite | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const key = cleanKey(o.key);
  if (!key) return null;
  return { key, name: cleanName(o.name), note: cleanNote(o.note), route: cleanRoute(o.route), addedAt: cleanTime(o.addedAt) };
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
    .map(([, v]) => cleanFavorite(v))
    .filter((f): f is Favorite => f !== null);
}

export async function saveFavorite(fav: Favorite): Promise<void> {
  const clean = cleanFavorite(fav);
  if (!clean) throw new Error("Not a valid favorite");
  const existing = await getFavorites();
  if (!existing.some((f) => f.key === clean.key) && existing.length >= FAVORITES_MAX) {
    throw new Error(`You can keep up to ${FAVORITES_MAX} favorites`);
  }
  await chrome.storage.sync.set({ [FAV_PREFIX + clean.key]: clean });
}

export async function removeFavorite(key: string): Promise<void> {
  if (cleanKey(key)) await chrome.storage.sync.remove(FAV_PREFIX + key);
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
  await chrome.storage.local.set({ recent: [clean, ...recent.filter((v) => v.key !== clean.key)].slice(0, RECENT_MAX) });
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
