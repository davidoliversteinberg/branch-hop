import {
  COMMENT_MAX,
  LOGIN_RE,
  SHARED_NOTE_MAX,
  cleanListName,
  isSharedIssueUrl,
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
  | { type: "share"; key: string; name?: string; route: string; note?: string; lists: string[]; people: string[] }
  | { type: "unshare"; issue: number }
  | { type: "comments"; issue: number }
  | { type: "comment"; issue: number; body: string }
  | { type: "mark-read"; issues?: number[] };

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export type AuthStatus =
  | { state: "signed-out"; message?: string }
  | { state: "pending"; userCode: string; verificationUri: string; expiresAt: number }
  | { state: "signed-in"; me: Person };

export type SharedStatus = "ok" | "no-access" | "no-permission" | "offline" | "signed-out" | "rate-limited";
export type SharedState = { status: SharedStatus; items: SharedBranch[]; lists: SharedList[]; people: Person[]; fetchedAt: number; message?: string };
export type Unread = Record<string, { shared?: boolean; comments?: number }>;

export const EMPTY_SHARED: SharedState = { status: "signed-out", items: [], lists: [], people: [], fetchedAt: 0 };

/* Validation for requests coming into the background worker */
const isIssue = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;

export function cleanRequest(raw: unknown): Request | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "auth-status":
    case "auth-start":
    case "auth-cancel":
    case "sign-out":
    case "sync":
      return { type: r.type };
    case "share": {
      if (typeof r.key !== "string" || !KEY_RE.test(r.key) || !isSafeRoute(r.route)) return null;
      const name = typeof r.name === "string" && BRANCH_NAME_RE.test(r.name) ? r.name : undefined;
      const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, SHARED_NOTE_MAX) : undefined;
      const lists = Array.isArray(r.lists) ? r.lists.map((l) => (typeof l === "string" ? cleanListName(l) : null)) : [];
      const people = Array.isArray(r.people) ? r.people : [];
      if (lists.length > 5 || lists.some((l) => l === null)) return null;
      if (people.length > 10 || people.some((p) => typeof p !== "string" || !LOGIN_RE.test(p))) return null;
      return { type: "share", key: r.key, name, route: r.route, note, lists: [...new Set(lists as string[])], people: [...new Set(people as string[])] };
    }
    case "unshare":
    case "comments":
      return isIssue(r.issue) ? { type: r.type, issue: r.issue } : null;
    case "comment": {
      const body = typeof r.body === "string" ? r.body.trim() : "";
      return isIssue(r.issue) && body.length > 0 && body.length <= COMMENT_MAX ? { type: "comment", issue: r.issue, body } : null;
    }
    case "mark-read": {
      if (r.issues === undefined) return { type: "mark-read" };
      return Array.isArray(r.issues) && r.issues.length <= 500 && r.issues.every(isIssue) ? { type: "mark-read", issues: r.issues } : null;
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
  if (!isIssue(o.number) || typeof o.key !== "string" || !KEY_RE.test(o.key) || !isSafeRoute(o.route) || !isSharedIssueUrl(o.url)) return null;
  if (typeof o.sharedBy !== "string" || !LOGIN_RE.test(o.sharedBy)) return null;
  const logins = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && LOGIN_RE.test(x)).slice(0, 10) : []);
  const lists = Array.isArray(o.lists) ? o.lists.map((l) => (typeof l === "string" ? cleanListName(l) : null)).filter((l): l is string => l !== null) : [];
  return {
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
  if (typeof o.login !== "string" || !LOGIN_RE.test(o.login)) return null;
  const avatarUrl = typeof o.avatarUrl === "string" && o.avatarUrl.startsWith("https://avatars.githubusercontent.com/") ? o.avatarUrl : undefined;
  return { login: o.login, name: str(o.name, 80), avatarUrl };
}

export function cleanSharedState(v: unknown): SharedState {
  if (!v || typeof v !== "object") return EMPTY_SHARED;
  const o = v as Record<string, unknown>;
  const statuses: SharedStatus[] = ["ok", "no-access", "no-permission", "offline", "signed-out", "rate-limited"];
  const status = statuses.includes(o.status as SharedStatus) ? (o.status as SharedStatus) : "offline";
  const items = Array.isArray(o.items) ? o.items.map(cleanSharedBranch).filter((i): i is SharedBranch => i !== null) : [];
  const people = Array.isArray(o.people) ? o.people.map(cleanPerson).filter((p): p is Person => p !== null) : [];
  const lists = Array.isArray(o.lists)
    ? o.lists.flatMap((l) => {
        const name = l && typeof l === "object" && typeof (l as SharedList).name === "string" ? cleanListName((l as SharedList).name) : null;
        const color = l && typeof l === "object" && /^[0-9a-fA-F]{6}$/.test(String((l as SharedList).color)) ? (l as SharedList).color : "717863";
        return name ? [{ name, color }] : [];
      })
    : [];
  return { status, items, people, lists, fetchedAt: typeof o.fetchedAt === "number" ? o.fetchedAt : 0, message: str(o.message, 200) };
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
    if (!/^\d{1,9}$/.test(k) || !val || typeof val !== "object") continue;
    const o = val as Record<string, unknown>;
    const comments = typeof o.comments === "number" && o.comments > 0 ? Math.min(99, Math.floor(o.comments)) : undefined;
    if (o.shared === true || comments) out[k] = { shared: o.shared === true || undefined, comments };
  }
  return out;
}

export function cleanComments(v: unknown): IssueComment[] {
  return Array.isArray(v) ? (v as IssueComment[]).filter((c) => c && typeof c.body === "string" && typeof c.author === "string" && LOGIN_RE.test(c.author)) : [];
}
