import {
  branchTitle,
  dedupeShared,
  isSharedIssueUrl,
  issueBody,
  listFromLabel,
  listLabel,
  newComments,
  newShares,
  parseComment,
  parseIssue,
  parsePerson,
  type HopEvent,
  type IssueComment,
  type SharedBranch,
  type SharedList,
  type Snapshot,
} from "../shared/github.ts";
import { EMPTY_SHARED, cleanSharedState, cleanUnread, cleanPerson, type SharedState, type Unread } from "../shared/messages.ts";
import { previewUrl } from "../shared/preview.ts";
import { getFavorites, getMuted, getSettings } from "../shared/store.ts";
import { gh, ghAll, GhError, repoPath } from "./gh.ts";

const local = chrome.storage.local;
const session: chrome.storage.StorageArea = chrome.storage.session ?? chrome.storage.local;
const K = { me: "gh:me", shared: "gh:shared", unread: "gh:unread", snapshot: "gh:snapshot", participated: "gh:participated", notified: "gh:notified" };
const LIST_COLORS = ["197A94", "7C3AED", "C026D3", "DC6903", "388367", "A95A77", "0891B2", "3AB533"];
export const SYNC_ALARM = "sync";

const nonNull = <T>(v: T | null): v is T => v !== null;

async function me(): Promise<string | null> {
  return cleanPerson((await local.get(K.me))[K.me])?.login ?? null;
}

export async function readShared(): Promise<SharedState> {
  return cleanSharedState((await local.get(K.shared))[K.shared]);
}

/* Syncing */
let syncing: Promise<SharedState> | null = null;

/** Fetches every shared branch, the people you can share with, and the lists. One sync at a time. */
export function sync(): Promise<SharedState> {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync(): Promise<SharedState> {
  const prev = await readShared();
  try {
    const [issues, people, labels] = await Promise.all([ghAll(repoPath("/issues?state=open")), ghAll(repoPath("/assignees"), 3), ghAll(repoPath("/labels"), 3)]);
    const items = dedupeShared(issues.map(parseIssue).filter(nonNull));
    const lists: SharedList[] = labels.flatMap((l) => {
      const label = l && typeof l === "object" ? (l as { name?: unknown; color?: unknown }) : {};
      const name = listFromLabel(label.name);
      return name ? [{ name, color: typeof label.color === "string" && /^[0-9a-fA-F]{6}$/.test(label.color) ? label.color : "717863" }] : [];
    });
    const state: SharedState = { status: "ok", items, people: people.map(parsePerson).filter(nonNull), lists, fetchedAt: Date.now() };
    await local.set({ [K.shared]: state });
    const login = await me();
    if (login) await detectEvents(items, login).catch(() => undefined);
    return state;
  } catch (err) {
    const e = err instanceof GhError ? err : new GhError(0, "Something went wrong while syncing with GitHub.", "offline");
    const status = e.code === "invalid" || e.code === "error" ? "offline" : e.code;
    const state: SharedState = { ...(prev.fetchedAt ? prev : EMPTY_SHARED), status, message: e.message };
    await local.set({ [K.shared]: state });
    return state;
  }
}

/* Sharing */
async function ensureList(name: string, known: SharedList[]): Promise<void> {
  if (known.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
  const color = LIST_COLORS[[...name].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 0) % LIST_COLORS.length];
  try {
    await gh(repoPath("/labels"), { method: "POST", body: { name: listLabel(name), color, description: "A Branch Hop list" } });
  } catch (err) {
    if (!(err instanceof GhError && err.code === "invalid")) throw err; // 422: the label already exists
  }
}

export async function share(req: { key: string; name?: string; route: string; note?: string; lists: string[]; people: string[] }): Promise<SharedBranch> {
  const state = await readShared();
  for (const list of req.lists) await ensureList(list, state.lists);
  const title = req.name ?? req.key;
  const body = issueBody({ key: req.key, name: req.name, route: req.route, note: req.note });
  const existing = state.items.find((i) => i.key === req.key);
  let raw: unknown;
  if (existing) {
    raw = await gh(repoPath(`/issues/${existing.number}`), { method: "PATCH", body: { title, body } });
    // Adding labels and assignees this way keeps any that are already there.
    if (req.lists.length) await gh(repoPath(`/issues/${existing.number}/labels`), { method: "POST", body: { labels: req.lists.map(listLabel) } });
    if (req.people.length) raw = await gh(repoPath(`/issues/${existing.number}/assignees`), { method: "POST", body: { assignees: req.people } });
  } else {
    raw = await gh(repoPath("/issues"), { method: "POST", body: { title, body, labels: req.lists.map(listLabel), assignees: req.people } });
  }
  const shared = parseIssue(raw);
  if (!shared) throw new GhError(0, "GitHub saved the share, but Branch Hop couldn't read it back. Refresh to see it.");
  await markParticipated(shared.number);
  await sync();
  return shared;
}

export async function unshare(issue: number): Promise<void> {
  await gh(repoPath(`/issues/${issue}`), { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
  await markRead([issue]);
  await sync();
}

/* Comments */
export async function listComments(issue: number): Promise<IssueComment[]> {
  const raw = await ghAll(repoPath(`/issues/${issue}/comments`), 5);
  await markRead([issue]);
  return raw.map(parseComment).filter(nonNull);
}

export async function addComment(issue: number, body: string): Promise<IssueComment> {
  const comment = parseComment(await gh(repoPath(`/issues/${issue}/comments`), { method: "POST", body: { body } }));
  if (!comment) throw new GhError(0, "GitHub saved the comment, but Branch Hop couldn't read it back.");
  await markParticipated(issue);
  return comment;
}

/* Read state and the toolbar badge */
async function getUnread(): Promise<Unread> {
  return cleanUnread((await local.get(K.unread))[K.unread]);
}

export async function markRead(issues?: number[]): Promise<void> {
  const unread = await getUnread();
  if (issues) for (const n of issues) delete unread[String(n)];
  await local.set({ [K.unread]: issues ? unread : {} });
  await updateBadge();
}

export async function updateBadge(): Promise<void> {
  const count = Object.keys(await getUnread()).length;
  await chrome.action.setBadgeText({ text: count ? (count > 9 ? "9+" : String(count)) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ABFF44" });
  const action = chrome.action as typeof chrome.action & { setBadgeTextColor?: (d: { color: string }) => Promise<void> };
  await action.setBadgeTextColor?.({ color: "#202320" });
}

async function markParticipated(issue: number): Promise<void> {
  const list = ((await local.get(K.participated))[K.participated] as unknown[] | undefined) ?? [];
  const set = new Set(list.filter((n): n is number => typeof n === "number"));
  set.add(issue);
  await local.set({ [K.participated]: [...set].slice(-500) });
}

/* Notifications */
async function getSnapshot(): Promise<Snapshot | null> {
  const v = (await local.get(K.snapshot))[K.snapshot] as Snapshot | undefined;
  return v && Array.isArray(v.assigned) && typeof v.commentsCheckedAt === "string" && !Number.isNaN(Date.parse(v.commentsCheckedAt)) ? v : null;
}

/** Who assigned this branch to me, from the issue's history. */
async function assignedBy(issue: number, login: string): Promise<string | null> {
  const events = await ghAll(repoPath(`/issues/${issue}/events`), 2);
  const assigned = events
    .map((e) => (e && typeof e === "object" ? (e as { event?: unknown; assignee?: { login?: unknown }; actor?: { login?: unknown } }) : {}))
    .filter((e) => e.event === "assigned" && e.assignee?.login === login)
    .pop();
  return parsePerson(assigned?.actor)?.login ?? null;
}

async function detectEvents(items: SharedBranch[], login: string): Promise<void> {
  const [settings, snapshot, favorites, muted, participatedRaw, notifiedRaw] = await Promise.all([
    getSettings(),
    getSnapshot(),
    getFavorites(),
    getMuted(),
    local.get(K.participated),
    local.get(K.notified),
  ]);
  const participated = new Set((participatedRaw[K.participated] as unknown[] | undefined)?.filter((n): n is number => typeof n === "number"));
  const notified = new Set((notifiedRaw[K.notified] as unknown[] | undefined)?.filter((n): n is number => typeof n === "number"));
  // A minute of overlap covers clock differences; comment IDs stop anything showing twice.
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const events: HopEvent[] = [];

  if (snapshot) {
    if (settings.notifyShares) {
      for (const e of newShares(snapshot, items, login)) {
        if (e.kind === "shared") e.by = (await assignedBy(e.issue, login).catch(() => null)) ?? e.by;
        if (e.kind === "shared" && e.by !== login) events.push(e);
      }
    }
    const comments = (await ghAll(repoPath(`/issues/comments?since=${encodeURIComponent(snapshot.commentsCheckedAt)}&sort=updated&direction=asc`), 3))
      .map(parseComment)
      .filter(nonNull);
    for (const c of comments) if (c.author === login) participated.add(c.issue);
    if (settings.notifyComments) {
      const favoriteKeys = new Set(favorites.map((f) => f.key));
      const mutedKeys = new Set(muted);
      const follows = (i: SharedBranch) =>
        !mutedKeys.has(i.key) && (i.sharedWith.includes(login) || i.sharedBy === login || participated.has(i.number) || favoriteKeys.has(i.key));
      events.push(...newComments(comments, items, login, follows, snapshot.commentsCheckedAt).filter((e) => e.kind === "comment" && !notified.has(e.commentId)));
    }
  }

  await local.set({
    [K.snapshot]: { assigned: items.filter((i) => i.sharedWith.includes(login)).map((i) => i.number), commentsCheckedAt: checkedAt } satisfies Snapshot,
    [K.participated]: [...participated].slice(-500),
    [K.notified]: [...notified, ...events.flatMap((e) => (e.kind === "comment" ? [e.commentId] : []))].slice(-500),
  });
  if (!events.length) return;

  const unread = await getUnread();
  for (const e of events) {
    const entry = unread[String(e.issue)] ?? {};
    if (e.kind === "shared") entry.shared = true;
    else entry.comments = (entry.comments ?? 0) + 1;
    unread[String(e.issue)] = entry;
  }
  await local.set({ [K.unread]: unread });
  await updateBadge();
  if (settings.desktopAlerts) await showNotifications(events, items);
}

type NoticeTarget = { issue: number; key: string; route: string; url: string };

async function showNotifications(events: HopEvent[], items: SharedBranch[]): Promise<void> {
  if (!chrome.notifications?.create) return; // Safari: the toolbar badge is the alert
  const byIssue = new Map(items.map((i) => [i.number, i]));
  for (const e of events.slice(0, 4)) {
    const item = byIssue.get(e.issue);
    if (!item) continue;
    const id = `hop-${e.kind}-${e.issue}-${e.kind === "comment" ? e.commentId : Date.now()}`;
    const target: NoticeTarget = { issue: e.issue, key: item.key, route: item.route, url: e.kind === "comment" ? `${item.url}#issuecomment-${e.commentId}` : item.url };
    await session.set({ [`notice:${id}`]: target });
    const title = e.kind === "shared" ? `${e.by ? `@${e.by}` : "Someone"} shared a branch with you` : `@${e.by} commented on ${e.title}`;
    const message = e.kind === "shared" ? branchTitle(item) + (item.note ? ` · ${item.note.slice(0, 100)}` : "") : e.excerpt;
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title,
      message,
      contextMessage: "Branch Hop",
      buttons: [{ title: "Open branch" }, { title: "View on GitHub" }],
      priority: 0,
    });
  }
  if (events.length > 4) {
    chrome.notifications.create(`hop-summary-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: `${events.length - 4} more updates in Branch Hop`,
      message: "Open Branch Hop to see everything shared with you.",
      priority: 0,
    });
  }
}

/** Notification clicks open the branch, or the issue on GitHub. Both URLs are rebuilt and checked first. */
export async function onNoticeClick(id: string, button?: number): Promise<void> {
  const key = `notice:${id}`;
  const target = (await session.get(key))[key] as NoticeTarget | undefined;
  chrome.notifications?.clear(id);
  if (!target) return;
  await session.remove(key);
  if (button === 1) {
    if (isSharedIssueUrl(target.url)) await chrome.tabs.create({ url: target.url });
  } else {
    await chrome.tabs.create({ url: previewUrl(target.key, target.route) });
  }
  await markRead([target.issue]);
}
