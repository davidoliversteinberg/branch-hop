import { BRANCH_NAME_RE, KEY_RE, isSafeRoute, previewUrl } from "./preview.ts";

/** Branch Hop's GitHub App. The Client ID is public. */
export const GITHUB = {
  clientId: "Iv23liBiCKXLbNx8C3dL",
  api: "https://api.github.com",
  web: "https://github.com",
} as const;

/**
 * A shared space is a repo with exactly this name, under a person or an organization
 * (for example episerver/branch-hop-shared). Branch Hop never touches any other repo.
 */
export const SHARED_REPO_NAME = "branch-hop-shared";
/** Shown in help text when nobody has set up a space yet. */
export const PERSONAL_SPACE_EXAMPLE = "davidoliversteinberg";

export const GITHUB_ORIGINS = ["https://github.com/*", "https://api.github.com/*"];
export const spaceUrl = (owner: string) => `${GITHUB.web}/${owner}/${SHARED_REPO_NAME}`;

export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const LIST_PREFIX = "list:";
export const LIST_NAME_MAX = 40;
export const SHARED_NOTE_MAX = 500;
export const COMMENT_MAX = 4000;
const LIST_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.&'-]{0,39}$/u;
const issuePrefix = (owner: string) => `${spaceUrl(owner)}/issues/`;
/** Unread state and list IDs need both the space and the issue number. */
export const issueId = (space: string, issue: number) => `${space}#${issue}`;

export type Person = { login: string; name?: string; avatarUrl?: string };
export type SharedBranch = {
  space: string;
  number: number;
  key: string;
  name?: string;
  route: string;
  note?: string;
  lists: string[];
  sharedWith: string[];
  sharedBy: string;
  comments: number;
  createdAt: string;
  updatedAt: string;
  url: string;
};
export type IssueComment = { id: number; space: string; issue: number; author: string; avatarUrl?: string; body: string; createdAt: string; updatedAt: string; url: string };
export type SharedList = { name: string; color: string };

/* Small validators for data that comes back from GitHub or storage */
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const login = (v: unknown): string | null => (typeof v === "string" && LOGIN_RE.test(v) ? v : null);
const avatar = (v: unknown): string | undefined =>
  typeof v === "string" && v.startsWith("https://avatars.githubusercontent.com/") && v.length < 500 ? v : undefined;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function cleanListName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return LIST_NAME_RE.test(trimmed) ? trimmed : null;
}
export const listLabel = (name: string) => `${LIST_PREFIX}${name}`;
export function listFromLabel(label: unknown): string | null {
  return typeof label === "string" && label.startsWith(LIST_PREFIX) ? cleanListName(label.slice(LIST_PREFIX.length)) : null;
}

const MARKER_RE = /<!--\s*branch-hop\s+(\{[\s\S]*?\})\s*-->/;
const PREVIEW_LINE_RE = /^\*\*Preview:\*\*\s/;

/**
 * Issue body for a shared branch: a readable preview link and note for people on GitHub,
 * plus a small JSON marker the extension reads back. Edit the note on GitHub and it updates here too.
 */
export function issueBody(branch: { key: string; name?: string; route: string; note?: string }): string {
  const data: Record<string, unknown> = { v: 1, key: branch.key, route: branch.route };
  if (branch.name) data.name = branch.name;
  // Escaped so a route can never close the HTML comment early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const lines = [`<!-- branch-hop ${json} -->`, `**Preview:** ${previewUrl(branch.key, branch.route)}`];
  const note = branch.note?.trim().slice(0, SHARED_NOTE_MAX);
  if (note) lines.push("", note);
  return lines.join("\n");
}

export function parseIssueBody(body: unknown): { key: string; name?: string; route: string; note?: string } | null {
  if (typeof body !== "string" || body.length > 20000) return null;
  const match = MARKER_RE.exec(body);
  if (!match) return null;
  let data: Record<string, unknown> | null;
  try {
    data = obj(JSON.parse(match[1]));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || typeof data.key !== "string" || !KEY_RE.test(data.key) || !isSafeRoute(data.route)) return null;
  const name = typeof data.name === "string" && BRANCH_NAME_RE.test(data.name) ? data.name : undefined;
  const rest = body
    .slice(match.index + match[0].length)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !PREVIEW_LINE_RE.test(line.trim()))
    .join("\n")
    .trim();
  return { key: data.key, name, route: data.route, note: rest ? rest.slice(0, SHARED_NOTE_MAX) : undefined };
}

/** Turns a GitHub issue into a shared branch, or null if it isn't one of ours. */
export function parseIssue(raw: unknown, space: string): SharedBranch | null {
  const o = obj(raw);
  if (!o || o.pull_request || o.state !== "open" || !isInt(o.number)) return null;
  const url = typeof o.html_url === "string" && o.html_url === `${issuePrefix(space)}${o.number}` ? o.html_url : null;
  const parsed = parseIssueBody(o.body);
  const sharedBy = login(obj(o.user)?.login);
  if (!url || !parsed || !sharedBy || !isIso(o.created_at) || !isIso(o.updated_at)) return null;
  const sharedWith = (Array.isArray(o.assignees) ? o.assignees : []).map((a) => login(obj(a)?.login)).filter((l): l is string => l !== null);
  const lists = (Array.isArray(o.labels) ? o.labels : []).map((l) => listFromLabel(obj(l)?.name)).filter((l): l is string => l !== null);
  return {
    space,
    number: o.number,
    ...parsed,
    lists: [...new Set(lists)],
    sharedWith: [...new Set(sharedWith)].slice(0, 10),
    sharedBy,
    comments: typeof o.comments === "number" && o.comments >= 0 ? Math.floor(o.comments) : 0,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    url,
  };
}

/** One entry per branch in each space: if a branch was shared twice there, the most recently updated wins. */
export function dedupeShared(items: SharedBranch[]): SharedBranch[] {
  const byKey = new Map<string, SharedBranch>();
  for (const item of items) {
    const k = `${item.space}:${item.key}`;
    const prev = byKey.get(k);
    if (!prev || Date.parse(item.updatedAt) > Date.parse(prev.updatedAt)) byKey.set(k, item);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function parseComment(raw: unknown): IssueComment | null {
  const o = obj(raw);
  if (!o || !isInt(o.id) || typeof o.body !== "string" || !isIso(o.created_at) || !isIso(o.updated_at)) return null;
  const author = login(obj(o.user)?.login);
  const issueUrl = typeof o.issue_url === "string" ? o.issue_url : "";
  const issueMatch = /\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(issueUrl);
  if (!author || !issueMatch || !LOGIN_RE.test(issueMatch[1]) || issueMatch[2] !== SHARED_REPO_NAME) return null;
  const space = issueMatch[1];
  const issue = Number(issueMatch[3]);
  const prefix = issuePrefix(space);
  const url = typeof o.html_url === "string" && o.html_url.startsWith(`${prefix}${issue}#issuecomment-`) ? o.html_url : `${prefix}${issue}`;
  return { id: o.id, space, issue, author, avatarUrl: avatar(obj(o.user)?.avatar_url), body: o.body.slice(0, COMMENT_MAX), createdAt: o.created_at, updatedAt: o.updated_at, url };
}

export function parsePerson(raw: unknown): Person | null {
  const o = obj(raw);
  const l = login(o?.login);
  if (!o || !l) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : undefined;
  return { login: l, name, avatarUrl: avatar(o.avatar_url) };
}

/** Issue links we open must point at a branch-hop-shared repo on github.com. */
export function isSharedIssueUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/branch-hop-shared\/issues\/\d+(#issuecomment-\d+)?$/.exec(url);
  return !!m && LOGIN_RE.test(m[1]);
}

/** GitHub's single sign-on page for an organization, as sent in the X-GitHub-SSO header. */
export function isSsoUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/github\.com\/orgs\/[A-Za-z0-9-]{1,39}\/sso(\?[A-Za-z0-9_=&%.-]*)?$/.test(url);
}

/* Notification events, worked out by comparing what's shared now with what was seen last time */
export type Snapshot = { assigned: number[]; commentsCheckedAt: string };
export type HopEvent =
  | { kind: "shared"; issue: number; key: string; title: string; by: string | null }
  | { kind: "comment"; issue: number; key: string; title: string; by: string; commentId: number; excerpt: string };

export const branchTitle = (b: Pick<SharedBranch, "name" | "key">) => b.name ?? b.key;

/** Branches newly shared with me since the last snapshot. The first run only records a baseline. */
export function newShares(prev: Snapshot | null, items: SharedBranch[], me: string): HopEvent[] {
  if (!prev) return [];
  const before = new Set(prev.assigned);
  return items
    .filter((i) => i.sharedWith.includes(me) && !before.has(i.number) && i.sharedBy !== me)
    .map((i) => ({ kind: "shared" as const, issue: i.number, key: i.key, title: branchTitle(i), by: i.sharedBy }));
}

/** New comments from other people on branches I follow. */
export function newComments(comments: IssueComment[], items: SharedBranch[], me: string, follows: (item: SharedBranch) => boolean, since: string): HopEvent[] {
  const byIssue = new Map(items.map((i) => [i.number, i]));
  const sinceTime = Date.parse(since);
  return comments
    .filter((c) => c.author !== me && Date.parse(c.createdAt) > sinceTime)
    .flatMap((c) => {
      const item = byIssue.get(c.issue);
      if (!item || !follows(item)) return [];
      const excerpt = c.body.replace(/\s+/g, " ").trim().slice(0, 140);
      return [{ kind: "comment" as const, issue: item.number, key: item.key, title: branchTitle(item), by: c.author, commentId: c.id, excerpt }];
    });
}
