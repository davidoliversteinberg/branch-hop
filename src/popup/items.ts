import { issueId, type SharedBranch } from "../shared/github.ts";
import type { Unread } from "../shared/messages.ts";
import type { PreviewStatus } from "../shared/nav";
import { pagePath } from "../shared/preview";
import type { BranchStatus } from "../shared/status.ts";
import { isBranchOnly, isSamePage, type Favorite } from "../shared/store";
import type { ExtState } from "./useExtensionState";

export type View = "branches" | "shared";
export type Lookup = PreviewStatus | "checking";
export type Typed = { kind: "link"; key: string; route: string } | { kind: "name"; name: string; key: string | null; status: Lookup };

/**
 * One row. Branch rows open where you left off on that branch; bookmark, shared and pasted rows
 * open their own page.
 */
export type Item = {
  id: string;
  kind: "branch" | "bookmark" | "shared" | "typed";
  key: string | null;
  name?: string;
  title: string;
  subtitle?: string;
  /** The page this row opens. */
  route: string;
  bookmark?: Favorite;
  pinned: boolean;
  /** The branch (or, for a bookmark, the page) this tab is showing. */
  current: boolean;
  /** The branch the flip-back shortcut goes to. */
  previous: boolean;
  /** A bookmark listed under its branch. */
  nested?: boolean;
  time?: string;
  lookup?: Lookup;
  shared?: SharedBranch;
  unread?: boolean;
  status?: BranchStatus;
};
export type ItemGroup = { id: string; label: string; items: Item[] };

export const routePath = pagePath;

export function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const LOOKUP_TEXT: Record<Lookup, string> = {
  checking: "Looking for its preview…",
  found: "Preview found",
  missing: "No preview yet. Vercel builds one after the first push.",
  error: "Couldn't reach Vercel to check",
};

const RECENT_BRANCHES = 20;

export type Sources = { ext: ExtState; shared: SharedBranch[]; me: string | null; seen: Unread };

export function buildGroups({ ext, shared, me, seen }: Sources, view: View, query: string, typed: Typed | null): ItemGroup[] {
  const here = ext.active?.loc ?? null;
  const sharedByKey = new Map(shared.map((s) => [s.key, s]));
  const nameOf = (key: string) =>
    ext.names[key] ?? ext.pins.find((p) => p.key === key && p.name)?.name ?? ext.favorites.find((f) => f.key === key && f.name)?.name ?? sharedByKey.get(key)?.name;
  const titleOf = (key: string) => nameOf(key) ?? key;
  // Recent is newest first, so the first visit on a branch is where you left off.
  const lastVisit = (key: string) => ext.recent.find((v) => v.key === key);
  const bookmarks = ext.favorites.filter((f) => !isBranchOnly(f));
  const pinnedKeys = new Set([...ext.pins.map((p) => p.key), ...ext.favorites.map((f) => f.key)]);

  const branchRow = (key: string): Item => {
    const visit = lastVisit(key);
    const route = visit?.route ?? "/";
    return {
      id: `branch-${key}`,
      kind: "branch",
      key,
      name: nameOf(key),
      title: titleOf(key),
      subtitle: visit ? routePath(route) : "Start page",
      route,
      pinned: pinnedKeys.has(key),
      current: key === here?.key,
      previous: key === ext.prevKey,
      time: visit ? ago(visit.at) : undefined,
      status: ext.statuses[key],
    };
  };
  const bookmarkRow = (f: Favorite, nested: boolean): Item => ({
    id: `bookmark-${f.id}`,
    kind: "bookmark",
    key: f.key,
    name: nameOf(f.key),
    title: f.note ?? routePath(f.route),
    subtitle: nested ? (f.note ? routePath(f.route) : undefined) : f.note ? `${titleOf(f.key)} · ${routePath(f.route)}` : titleOf(f.key),
    route: f.route,
    bookmark: f,
    pinned: true,
    current: !!here && isSamePage(f, here.key, here.route),
    previous: false,
    nested,
  });
  const sharedRow = (s: SharedBranch): Item => ({
    id: `shared-${s.space}-${s.number}`,
    kind: "shared",
    key: s.key,
    name: nameOf(s.key),
    title: titleOf(s.key),
    subtitle: s.note ?? `Shared by @${s.sharedBy}`,
    route: s.route,
    pinned: pinnedKeys.has(s.key),
    current: !!here && isSamePage(s, here.key, here.route),
    previous: false,
    time: ago(Date.parse(s.updatedAt)),
    shared: s,
    unread: !!seen[issueId(s.space, s.number)],
    status: ext.statuses[s.key],
  });

  // Pinned branches by latest activity, each followed by its bookmarks.
  const activity = (key: string) =>
    Math.max(lastVisit(key)?.at ?? 0, ext.pins.find((p) => p.key === key)?.addedAt ?? 0, ...ext.favorites.filter((f) => f.key === key).map((f) => f.addedAt));
  const pinnedOrder = [...pinnedKeys].sort((a, b) => activity(b) - activity(a));
  const bookmarksOf = (key: string) => bookmarks.filter((f) => f.key === key).sort((a, b) => a.addedAt - b.addedAt);
  // Every branch you've opened, newest first, starting with this tab's so you can always pin it.
  const recentKeys = [...new Set([...(here ? [here.key] : []), ...ext.recent.map((v) => v.key)])].filter((k) => !pinnedKeys.has(k)).slice(0, RECENT_BRANCHES);

  const q = query.trim().toLowerCase();
  if (!q) {
    if (view === "shared") return sharedGroups(shared, me, sharedRow);
    const pinned = pinnedOrder.flatMap((k) => [branchRow(k), ...bookmarksOf(k).map((f) => bookmarkRow(f, true))]);
    return [
      { id: "pinned", label: "Pinned", items: pinned },
      { id: "recent", label: "Recent", items: recentKeys.map(branchRow) },
    ].filter((g) => g.items.length);
  }

  const tokens = q.split(/\s+/);
  const matches = (...parts: (string | undefined)[]) => {
    const hay = parts.join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };
  const branchMatches = (key: string) => matches(titleOf(key), key, lastVisit(key)?.route);
  const pinned = pinnedOrder.flatMap((k) => {
    const all = branchMatches(k);
    const marks = bookmarksOf(k).filter((f) => all || matches(f.note, f.route, titleOf(k)));
    return all || marks.length ? [branchRow(k), ...marks.map((f) => bookmarkRow(f, true))] : [];
  });
  const shownPages = new Set(bookmarks.map((f) => `${f.key}|${routePath(f.route)}`));
  const sharedMatches = shared
    .filter((s) => !shownPages.has(`${s.key}|${routePath(s.route)}`) && matches(titleOf(s.key), s.key, s.note, s.sharedBy, ...s.lists))
    .map(sharedRow);
  const groups: ItemGroup[] = [
    { id: "pinned", label: "Pinned", items: pinned },
    { id: "shared", label: "Shared", items: sharedMatches },
    { id: "recent", label: "Recent", items: recentKeys.filter(branchMatches).map(branchRow) },
  ];
  const listedKeys = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));

  if (typed?.kind === "link" && !shownPages.has(`${typed.key}|${routePath(typed.route)}`)) {
    groups.push({
      id: "any",
      label: "Pasted link",
      items: [{ ...branchRow(typed.key), id: "typed-link", kind: "typed", subtitle: routePath(typed.route), route: typed.route, time: undefined }],
    });
  } else if (typed?.kind === "name" && !(typed.key && listedKeys.has(typed.key))) {
    groups.push({
      id: "any",
      label: "Any branch",
      items: [
        {
          id: "typed-name",
          kind: "typed",
          key: typed.key,
          name: typed.name,
          title: typed.name,
          subtitle: LOOKUP_TEXT[typed.status],
          route: "/",
          pinned: false,
          current: false,
          previous: false,
          lookup: typed.status,
        },
      ],
    });
  }
  return groups.filter((g) => g.items.length);
}

/** Shared with you first, then each list, then everything else. Each branch appears once. */
function sharedGroups(shared: SharedBranch[], me: string | null, toItem: (s: SharedBranch) => Item): ItemGroup[] {
  const used = new Set<string>();
  const id = (s: SharedBranch) => issueId(s.space, s.number);
  const take = (list: SharedBranch[]) => list.filter((s) => !used.has(id(s)) && used.add(id(s))).map(toItem);
  const multi = new Set(shared.map((s) => s.space)).size > 1;
  const groups: ItemGroup[] = [{ id: "with-you", label: "Shared with you", items: take(shared.filter((s) => !!me && s.sharedWith.includes(me) && s.sharedBy !== me)) }];
  // Lists belong to a space; with more than one space, the label says which.
  const lists = [...new Map(shared.flatMap((s) => s.lists.map((name) => [`${s.space}/${name}`, { space: s.space, name }] as const))).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const l of lists) {
    groups.push({ id: `list-${l.space}-${l.name}`, label: multi ? `${l.name} · ${l.space}` : l.name, items: take(shared.filter((s) => s.space === l.space && s.lists.includes(l.name))) });
  }
  const rest = take(shared);
  groups.push({ id: "everything", label: groups.some((g) => g.items.length) ? "Everything else" : "Shared", items: rest });
  return groups.filter((g) => g.items.length);
}
