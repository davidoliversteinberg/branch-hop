import {
  COMMENT_MAX,
  LOGIN_RE,
  SHARED_NOTE_MAX,
  cleanListName,
  isSharedIssueUrl,
  isSsoUrl,
  type IssueComment,
  type Person,
  type SharedBranch,
  type SharedList,
} from "./github.ts";
import { BRANCH_NAME_RE, KEY_RE, isSafeRoute } from "./preview.ts";

/** What the popup can ask the background worker to do. Nothing else is accepted. */
export type Request =
  | { type: "auth-status" }
  | { type: "auth-start" }
  | { type: "auth-cancel" }
  | { type: "sign-out" }
  | { type: "sync" }
  | { type: "check-update" }
  | { type: "status-refresh"; force: boolean }
  | { type: "share"; space: string; key: string; name?: string; route: string; note?: string; lists: string[]; people: string[] }
  | { type: "unshare"; space: string; issue: number }
  | { type: "comments"; space: string; issue: number }
  | { type: "comment"; space: string; issue: number; body: string }
  | { type: "mark-read"; ids?: string[] };

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export type AuthStatus =
  | { state: "signed-out"; message?: string }
  | { state: "pending"; userCode: string; verificationUri: string; expiresAt: number }
  | { state: "signed-in"; me: Person };

export type SharedStatus = "ok" | "no-space" | "no-access" | "no-permission" | "offline" | "signed-out" | "rate-limited" | "sso";
/** One branch-hop-shared repo Branch Hop can reach, under a person or an organization. */
export type Space = { owner: string; org: boolean; status: SharedStatus; message?: string; ssoUrl?: string; people: Person[]; lists: SharedList[] };
export type SharedState = {
  status: SharedStatus;
  items: SharedBranch[];
  spaces: Space[];
  /** Accounts the GitHub App is installed on, including ones without a branch-hop-shared repo. */
  installedOn: string[];
  fetchedAt: number;
  message?: string;
};
export type Unread = Record<string, { shared?: boolean; comments?: number }>;
export type UpdateInfo = { latest: string; current: string; url: string; checkedAt: number };

export const EMPTY_SHARED: SharedState = { status: "signed-out", items: [], spaces: [], installedOn: [], fetchedAt: 0 };
const STATUSES: SharedStatus[] = ["ok", "no-space", "no-access", "no-permission", "offline", "signed-out", "rate-limited", "sso"];

/* Validation for requests coming into the background worker */
const isIssue = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;
const isLogin = (v: unknown): v is string => typeof v === "string" && LOGIN_RE.test(v);
const ID_RE = /^[A-Za-z0-9-]{1,39}#\d{1,9}$/;

export function cleanRequest(raw: unknown): Request | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "auth-status":
    case "auth-start":
    case "auth-cancel":
    case "sign-out":
    case "sync":
    case "check-update":
      return { type: r.type };
    case "status-refresh":
      return { type: "status-refresh", force: r.force === true };
    case "share": {
      if (!isLogin(r.space) || typeof r.key !== "string" || !KEY_RE.test(r.key) || !isSafeRoute(r.route)) return null;
      const name = typeof r.name === "string" && BRANCH_NAME_RE.test(r.name) ? r.name : undefined;
      const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, SHARED_NOTE_MAX) : undefined;
      const lists = Array.isArray(r.lists) ? r.lists.map((l) => (typeof l === "string" ? cleanListName(l) : null)) : [];
      const people = Array.isArray(r.people) ? r.people : [];
      if (lists.length > 5 || lists.some((l) => l === null)) return null;
      if (people.length > 10 || !people.every(isLogin)) return null;
      return { type: "share", space: r.space, key: r.key, name, route: r.route, note, lists: [...new Set(lists as string[])], people: [...new Set(people as string[])] };
    }
    case "unshare":
    case "comments":
      return isLogin(r.space) && isIssue(r.issue) ? { type: r.type, space: r.space, issue: r.issue } : null;
    case "comment": {
      const body = typeof r.body === "string" ? r.body.trim() : "";
      return isLogin(r.space) && isIssue(r.issue) && body.length > 0 && body.length <= COMMENT_MAX ? { type: "comment", space: r.space, issue: r.issue, body } : null;
    }
    case "mark-read": {
      if (r.ids === undefined) return { type: "mark-read" };
      return Array.isArray(r.ids) && r.ids.length <= 500 && r.ids.every((id) => typeof id === "string" && ID_RE.test(id)) ? { type: "mark-read", ids: r.ids as string[] } : null;
    }
    default:
      return null;
  }
}

/* Validation for what the popup reads back from storage (content scripts can write there) */
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

export function cleanSharedBranch(v: unknown): SharedBranch | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isLogin(o.space) || !isIssue(o.number) || typeof o.key !== "string" || !KEY_RE.test(o.key) || !isSafeRoute(o.route) || !isSharedIssueUrl(o.url)) return null;
  if (!o.url.startsWith(`https://github.com/${o.space}/`) || !isLogin(o.sharedBy)) return null;
  const logins = (a: unknown) => (Array.isArray(a) ? a.filter(isLogin).slice(0, 10) : []);
  const lists = Array.isArray(o.lists) ? o.lists.map((l) => (typeof l === "string" ? cleanListName(l) : null)).filter((l): l is string => l !== null) : [];
  return {
    space: o.space,
    number: o.number,
    key: o.key,
    name: typeof o.name === "string" && BRANCH_NAME_RE.test(o.name) ? o.name : undefined,
    route: o.route,
    note: str(o.note, SHARED_NOTE_MAX),
    lists,
    sharedWith: logins(o.sharedWith),
    sharedBy: o.sharedBy,
    comments: typeof o.comments === "number" && o.comments >= 0 ? Math.floor(o.comments) : 0,
    createdAt: str(o.createdAt, 40) ?? "",
    updatedAt: str(o.updatedAt, 40) ?? "",
    url: o.url,
  };
}

export function cleanPerson(v: unknown): Person | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isLogin(o.login)) return null;
  const avatarUrl = typeof o.avatarUrl === "string" && o.avatarUrl.startsWith("https://avatars.githubusercontent.com/") ? o.avatarUrl : undefined;
  return { login: o.login, name: str(o.name, 80), avatarUrl };
}

function cleanLists(v: unknown): SharedList[] {
  return Array.isArray(v)
    ? v.flatMap((l) => {
        const o = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
        const name = typeof o.name === "string" ? cleanListName(o.name) : null;
        const color = typeof o.color === "string" && /^[0-9a-fA-F]{6}$/.test(o.color) ? o.color : "717863";
        return name ? [{ name, color }] : [];
      })
    : [];
}

function cleanSpace(v: unknown): Space | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isLogin(o.owner)) return null;
  return {
    owner: o.owner,
    org: o.org === true,
    status: STATUSES.includes(o.status as SharedStatus) ? (o.status as SharedStatus) : "offline",
    message: str(o.message, 200),
    ssoUrl: isSsoUrl(o.ssoUrl) ? o.ssoUrl : undefined,
    people: Array.isArray(o.people) ? o.people.map(cleanPerson).filter((p): p is Person => p !== null) : [],
    lists: cleanLists(o.lists),
  };
}

export function cleanSharedState(v: unknown): SharedState {
  if (!v || typeof v !== "object") return EMPTY_SHARED;
  const o = v as Record<string, unknown>;
  return {
    status: STATUSES.includes(o.status as SharedStatus) ? (o.status as SharedStatus) : "offline",
    items: Array.isArray(o.items) ? o.items.map(cleanSharedBranch).filter((i): i is SharedBranch => i !== null) : [],
    spaces: Array.isArray(o.spaces) ? o.spaces.map(cleanSpace).filter((s): s is Space => s !== null).slice(0, 20) : [],
    installedOn: Array.isArray(o.installedOn) ? o.installedOn.filter(isLogin).slice(0, 50) : [],
    fetchedAt: typeof o.fetchedAt === "number" ? o.fetchedAt : 0,
    message: str(o.message, 200),
  };
}

export function cleanAuthStatus(v: unknown): AuthStatus {
  if (!v || typeof v !== "object") return { state: "signed-out" };
  const o = v as Record<string, unknown>;
  if (o.state === "pending" && typeof o.userCode === "string" && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(o.userCode) && typeof o.expiresAt === "number") {
    return { state: "pending", userCode: o.userCode, verificationUri: "https://github.com/login/device", expiresAt: o.expiresAt };
  }
  if (o.state === "signed-in") {
    const me = cleanPerson(o.me);
    if (me) return { state: "signed-in", me };
  }
  return { state: "signed-out", message: str(o.message, 200) };
}

export function cleanUnread(v: unknown): Unread {
  const out: Unread = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!ID_RE.test(k) || !val || typeof val !== "object") continue;
    const o = val as Record<string, unknown>;
    const comments = typeof o.comments === "number" && o.comments > 0 ? Math.min(99, Math.floor(o.comments)) : undefined;
    if (o.shared === true || comments) out[k] = { shared: o.shared === true || undefined, comments };
  }
  return out;
}

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export function cleanUpdate(v: unknown): UpdateInfo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.latest !== "string" || !VERSION_RE.test(o.latest) || typeof o.current !== "string" || !VERSION_RE.test(o.current)) return null;
  if (typeof o.url !== "string" || !o.url.startsWith("https://github.com/davidoliversteinberg/branch-hop/releases/")) return null;
  return { latest: o.latest, current: o.current, url: o.url, checkedAt: typeof o.checkedAt === "number" ? o.checkedAt : 0 };
}

/** True when version a is newer than b (both "x.y.z"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export function cleanComments(v: unknown): IssueComment[] {
  return Array.isArray(v) ? (v as IssueComment[]).filter((c) => c && typeof c.body === "string" && isLogin(c.author) && isLogin(c.space)) : [];
}
