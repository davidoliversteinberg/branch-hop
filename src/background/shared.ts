import {
  SHARED_REPO_NAME,
  branchTitle,
  dedupeShared,
  isSharedIssueUrl,
  issueBody,
  issueId,
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
import { EMPTY_SHARED, cleanPerson, cleanSharedState, cleanUnread, type SharedState, type SharedStatus, type Space, type Unread } from "../shared/messages.ts";
import { previewUrl } from "../shared/preview.ts";
import { getFavorites, getMuted, getPins, getSettings } from "../shared/store.ts";
import { gh, ghAll, GhError, repoPath } from "./gh.ts";

const local = chrome.storage.local;
const session: chrome.storage.StorageArea = chrome.storage.session ?? chrome.storage.local;
const K = { me: "gh:me", shared: "gh:shared", unread: "gh:unread", snapshot: "gh:snapshots", participated: "gh:participated", notified: "gh:notified" };
const LIST_COLORS = ["197A94", "7C3AED", "C026D3", "DC6903", "388367", "A95A77", "0891B2", "3AB533"];
export const SYNC_ALARM = "sync";

const nonNull = <T>(v: T | null): v is T => v !== null;
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

async function me(): Promise<string | null> {
  return cleanPerson((await local.get(K.me))[K.me])?.login ?? null;
}

export async function readShared(): Promise<SharedState> {
  return cleanSharedState((await local.get(K.shared))[K.shared]);
}

function statusOf(err: unknown): { status: SharedStatus; message: string; ssoUrl?: string } {
  const e = err instanceof GhError ? err : new GhError(0, "Something went wrong while syncing with GitHub.", "offline");
  const status: SharedStatus = e.code === "invalid" || e.code === "error" ? "offline" : e.code;
  return { status, message: e.message, ssoUrl: e.ssoUrl };
}

/* Finding spaces: every branch-hop-shared repo the app is installed on */
async function discover(): Promise<{ spaces: Pick<Space, "owner" | "org">[]; installedOn: string[] }> {
  const installs = await ghAll("/user/installations", 3, "installations");
  const spaces: Pick<Space, "owner" | "org">[] = [];
  const installedOn: string[] = [];
  for (const raw of installs) {
    const inst = asObj(raw);
    const account = asObj(inst.account);
    const owner = parsePerson(account)?.login;
    if (!owner || typeof inst.id !== "number") continue;
    installedOn.push(owner);
    const repos = await ghAll(`/user/installations/${inst.id}/repositories`, 10, "repositories").catch(() => []);
    const hasSpace = repos.some((r) => asObj(r).name === SHARED_REPO_NAME && asObj(asObj(r).owner).login === owner);
    if (hasSpace) spaces.push({ owner, org: account.type === "Organization" });
  }
  // Organizations first, so the team space comes before a personal one.
  spaces.sort((a, b) => Number(b.org) - Number(a.org) || a.owner.localeCompare(b.owner));
  return { spaces, installedOn };
}

/* Syncing */
let syncing: Promise<SharedState> | null = null;

/** Fetches every space's shared branches, people and lists. One sync at a time. */
export function sync(): Promise<SharedState> {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncSpace(owner: string, org: boolean): Promise<{ space: Space; items: SharedBranch[] }> {
  try {
    const [issues, people, labels] = await Promise.all([ghAll(repoPath(owner, "/issues?state=open")), ghAll(repoPath(owner, "/assignees"), 3), ghAll(repoPath(owner, "/labels"), 3)]);
    const lists: SharedList[] = labels.flatMap((l) => {
      const label = asObj(l);
      const name = listFromLabel(label.name);
      return name ? [{ name, color: typeof label.color === "string" && /^[0-9a-fA-F]{6}$/.test(label.color) ? label.color : "717863" }] : [];
    });
    return {
      space: { owner, org, status: "ok", people: people.map(parsePerson).filter(nonNull), lists },
      items: issues.map((i) => parseIssue(i, owner)).filter(nonNull),
    };
  } catch (err) {
    return { space: { owner, org, ...statusOf(err), people: [], lists: [] }, items: [] };
  }
}

async function runSync(): Promise<SharedState> {
  const prev = await readShared();
  try {
    const { spaces: found, installedOn } = await discover();
    const results = await Promise.all(found.map((s) => syncSpace(s.owner, s.org)));
    const spaces = results.map((r) => r.space);
    // Keep what we last saw for a space that failed this time, so nothing vanishes while offline.
    const items = dedupeShared(results.flatMap((r) => (r.space.status === "ok" ? r.items : prev.items.filter((i) => i.space === r.space.owner))));
    const status: SharedStatus = !spaces.length ? "no-space" : spaces.some((s) => s.status === "ok") ? "ok" : spaces[0].status;
    const state: SharedState = { status, items, spaces, installedOn, fetchedAt: Date.now() };
    await local.set({ [K.shared]: state });
    const login = await me();
    if (login) for (const r of results) if (r.space.status === "ok") await detectEvents(r.space.owner, r.items, login).catch(() => undefined);
    return state;
  } catch (err) {
    const state: SharedState = { ...(prev.fetchedAt ? prev : EMPTY_SHARED), ...statusOf(err) };
    await local.set({ [K.shared]: state });
    return state;
  }
}

async function requireSpace(owner: string): Promise<SharedState> {
  const state = await readShared();
  if (!state.spaces.some((s) => s.owner === owner)) throw new GhError(0, `Branch Hop isn't set up in ${owner}'s shared space.`, "no-access");
  return state;
}

/* Sharing */
async function ensureList(owner: string, name: string, known: SharedList[]): Promise<void> {
  if (known.some((l) => l.name.toLowerCase() === name.toLowerCase())) return;
  const color = LIST_COLORS[[...name].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 0) % LIST_COLORS.length];
  try {
    await gh(repoPath(owner, "/labels"), { method: "POST", body: { name: listLabel(name), color, description: "A Branch Hop list" } });
  } catch (err) {
    if (!(err instanceof GhError && err.code === "invalid")) throw err; // 422: the label already exists
  }
}

export async function share(req: { space: string; key: string; name?: string; route: string; note?: string; lists: string[]; people: string[] }): Promise<SharedBranch> {
  const state = await requireSpace(req.space);
  const space = state.spaces.find((s) => s.owner === req.space);
  for (const list of req.lists) await ensureList(req.space, list, space?.lists ?? []);
  const title = req.name ?? req.key;
  const body = issueBody({ key: req.key, name: req.name, route: req.route, note: req.note });
  const existing = state.items.find((i) => i.space === req.space && i.key === req.key);
  let raw: unknown;
  if (existing) {
    raw = await gh(repoPath(req.space, `/issues/${existing.number}`), { method: "PATCH", body: { title, body } });
    // Adding labels and assignees this way keeps any that are already there.
    if (req.lists.length) await gh(repoPath(req.space, `/issues/${existing.number}/labels`), { method: "POST", body: { labels: req.lists.map(listLabel) } });
    if (req.people.length) raw = await gh(repoPath(req.space, `/issues/${existing.number}/assignees`), { method: "POST", body: { assignees: req.people } });
  } else {
    raw = await gh(repoPath(req.space, "/issues"), { method: "POST", body: { title, body, labels: req.lists.map(listLabel), assignees: req.people } });
  }
  const shared = parseIssue(raw, req.space);
  if (!shared) throw new GhError(0, "GitHub saved the share, but Branch Hop couldn't read it back. Refresh to see it.");
  await markParticipated(req.space, shared.number);
  await sync();
  return shared;
}

export async function unshare(space: string, issue: number): Promise<void> {
  await requireSpace(space);
  await gh(repoPath(space, `/issues/${issue}`), { method: "PATCH", body: { state: "closed", state_reason: "completed" } });
  await markRead([issueId(space, issue)]);
  await sync();
}

/* Comments */
export async function listComments(space: string, issue: number): Promise<IssueComment[]> {
  await requireSpace(space);
  const raw = await ghAll(repoPath(space, `/issues/${issue}/comments`), 5);
  await markRead([issueId(space, issue)]);
  return raw.map(parseComment).filter(nonNull).filter((c) => c.space === space);
}

export async function addComment(space: string, issue: number, body: string): Promise<IssueComment> {
  await requireSpace(space);
  const comment = parseComment(await gh(repoPath(space, `/issues/${issue}/comments`), { method: "POST", body: { body } }));
  if (!comment) throw new GhError(0, "GitHub saved the comment, but Branch Hop couldn't read it back.");
  await markParticipated(space, issue);
  return comment;
}

/* Read state and the toolbar badge */
async function getUnread(): Promise<Unread> {
  return cleanUnread((await local.get(K.unread))[K.unread]);
}

export async function markRead(ids?: string[]): Promise<void> {
  const unread = await getUnread();
  if (ids) for (const id of ids) delete unread[id];
  await local.set({ [K.unread]: ids ? unread : {} });
  await updateBadge();
}

/** The toolbar count: unread shared branches, or a dot when an update is waiting. */
export async function updateBadge(): Promise<void> {
  const count = Object.keys(await getUnread()).length;
  const { update } = await local.get("update");
  const updateWaiting = !!(update && typeof update === "object" && (update as { latest?: unknown }).latest);
  const text = count ? (count > 9 ? "9+" : String(count)) : updateWaiting ? "↑" : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#ABFF44" });
  const action = chrome.action as typeof chrome.action & { setBadgeTextColor?: (d: { color: string }) => Promise<void> };
  await action.setBadgeTextColor?.({ color: "#202320" });
}

async function participatedSet(): Promise<Set<string>> {
  const list = ((await local.get(K.participated))[K.participated] as unknown[] | undefined) ?? [];
  return new Set(list.filter((n): n is string => typeof n === "string"));
}

async function markParticipated(space: string, issue: number): Promise<void> {
  const set = await participatedSet();
  set.add(issueId(space, issue));
  await local.set({ [K.participated]: [...set].slice(-500) });
}

/* Notifications */
async function getSnapshots(): Promise<Record<string, Snapshot>> {
  const raw = asObj((await local.get(K.snapshot))[K.snapshot]);
  const out: Record<string, Snapshot> = {};
  for (const [owner, v] of Object.entries(raw)) {
    const s = asObj(v);
    if (Array.isArray(s.assigned) && typeof s.commentsCheckedAt === "string" && !Number.isNaN(Date.parse(s.commentsCheckedAt))) {
      out[owner] = { assigned: s.assigned.filter((n): n is number => typeof n === "number"), commentsCheckedAt: s.commentsCheckedAt };
    }
  }
  return out;
}

/** Who assigned this branch to me, from the issue's history. */
async function assignedBy(space: string, issue: number, login: string): Promise<string | null> {
  const events = await ghAll(repoPath(space, `/issues/${issue}/events`), 2);
  const assigned = events
    .map((e) => asObj(e))
    .filter((e) => e.event === "assigned" && asObj(e.assignee).login === login)
    .pop();
  return parsePerson(assigned?.actor)?.login ?? null;
}

async function detectEvents(space: string, items: SharedBranch[], login: string): Promise<void> {
  const [settings, snapshots, favorites, pins, muted, participated, notifiedRaw] = await Promise.all([
    getSettings(),
    getSnapshots(),
    getFavorites(),
    getPins(),
    getMuted(),
    participatedSet(),
    local.get(K.notified),
  ]);
  const snapshot = snapshots[space] ?? null;
  const notified = new Set((notifiedRaw[K.notified] as unknown[] | undefined)?.filter((n): n is number => typeof n === "number"));
  // A minute of overlap covers clock differences; comment IDs stop anything showing twice.
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const events: HopEvent[] = [];

  if (snapshot) {
    if (settings.notifyShares) {
      for (const e of newShares(snapshot, items, login)) {
        if (e.kind === "shared") e.by = (await assignedBy(space, e.issue, login).catch(() => null)) ?? e.by;
        if (e.kind === "shared" && e.by !== login) events.push(e);
      }
    }
    const comments = (await ghAll(repoPath(space, `/issues/comments?since=${encodeURIComponent(snapshot.commentsCheckedAt)}&sort=updated&direction=asc`), 3))
      .map(parseComment)
      .filter(nonNull)
      .filter((c) => c.space === space);
    for (const c of comments) if (c.author === login) participated.add(issueId(space, c.issue));
    if (settings.notifyComments) {
      // Following: bookmarked and pinned branches count, as favorites did before 0.4.
      const favoriteKeys = new Set([...favorites.map((f) => f.key), ...pins.map((p) => p.key)]);
      const mutedKeys = new Set(muted);
      const follows = (i: SharedBranch) =>
        !mutedKeys.has(i.key) && (i.sharedWith.includes(login) || i.sharedBy === login || participated.has(issueId(space, i.number)) || favoriteKeys.has(i.key));
      events.push(...newComments(comments, items, login, follows, snapshot.commentsCheckedAt).filter((e) => e.kind === "comment" && !notified.has(e.commentId)));
    }
  }

  snapshots[space] = { assigned: items.filter((i) => i.sharedWith.includes(login)).map((i) => i.number), commentsCheckedAt: checkedAt };
  await local.set({
    [K.snapshot]: snapshots,
    [K.participated]: [...participated].slice(-500),
    [K.notified]: [...notified, ...events.flatMap((e) => (e.kind === "comment" ? [e.commentId] : []))].slice(-500),
  });
  if (!events.length) return;

  const unread = await getUnread();
  for (const e of events) {
    const id = issueId(space, e.issue);
    const entry = unread[id] ?? {};
    if (e.kind === "shared") entry.shared = true;
    else entry.comments = (entry.comments ?? 0) + 1;
    unread[id] = entry;
  }
  await local.set({ [K.unread]: unread });
  await updateBadge();
  if (settings.desktopAlerts) await showNotifications(space, events, items);
}

type NoticeTarget = { space: string; issue: number; key: string; route: string; url: string };

async function showNotifications(space: string, events: HopEvent[], items: SharedBranch[]): Promise<void> {
  if (!chrome.notifications?.create) return; // Safari: the toolbar count is the alert
  const byIssue = new Map(items.map((i) => [i.number, i]));
  for (const e of events.slice(0, 4)) {
    const item = byIssue.get(e.issue);
    if (!item) continue;
    const id = `hop-${space}-${e.kind}-${e.issue}-${e.kind === "comment" ? e.commentId : Date.now()}`;
    const target: NoticeTarget = { space, issue: e.issue, key: item.key, route: item.route, url: e.kind === "comment" ? `${item.url}#issuecomment-${e.commentId}` : item.url };
    await session.set({ [`notice:${id}`]: target });
    const title = e.kind === "shared" ? `${e.by ? `@${e.by}` : "Someone"} shared a branch with you` : `@${e.by} commented on ${e.title}`;
    const message = e.kind === "shared" ? branchTitle(item) + (item.note ? ` · ${item.note.slice(0, 100)}` : "") : e.excerpt;
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title,
      message,
      contextMessage: `Branch Hop · ${space}`,
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
  await markRead([issueId(target.space, target.issue)]);
}
