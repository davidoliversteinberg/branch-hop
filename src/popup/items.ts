import { issueId, type SharedBranch } from "../shared/github.ts";
import type { Unread } from "../shared/messages.ts";
import type { PreviewStatus } from "../shared/nav";
import { pagePath } from "../shared/preview";
import { findFavorite, isSamePage, type Favorite, type Visit } from "../shared/store";
import type { ExtState } from "./useExtensionState";

export type View = "favorites" | "shared" | "recent";
export type Lookup = PreviewStatus | "checking";
export type Typed = { kind: "link"; key: string; route: string } | { kind: "name"; name: string; key: string | null; status: Lookup };

export type Item = {
  id: string;
  key: string | null;
  name?: string;
  title: string;
  subtitle: string;
  route?: string;
  /** Always open this route (favorite pages, pasted links and shared branches), even with "keep route" on. */
  exactRoute?: string;
  /** The saved favorite for this row's page, if there is one. */
  favorite?: Favorite;
  current: boolean;
  previous: boolean;
  time?: string;
  status?: Lookup;
  shared?: SharedBranch;
  unread?: boolean;
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

export type Sources = { ext: ExtState; shared: SharedBranch[]; me: string | null; seen: Unread };

export function buildGroups({ ext, shared, me, seen }: Sources, view: View, query: string, typed: Typed | null): ItemGroup[] {
  const here = ext.active?.loc ?? null;
  const sharedByKey = new Map(shared.map((s) => [s.key, s]));
  const nameOf = (key: string) => ext.favorites.find((f) => f.key === key && f.name)?.name ?? ext.names[key] ?? sharedByKey.get(key)?.name;
  const favOf = (key: string, route: string) => findFavorite(ext.favorites, key, route);
  const base = (key: string, route: string) => ({
    key,
    name: nameOf(key),
    title: nameOf(key) ?? key,
    favorite: favOf(key, route),
    current: key === here?.key,
    previous: key === ext.prevKey,
  });

  // A favorite is a page: its note (or the branch) on top, the page underneath. It always opens that page.
  const visitedHere = (f: Favorite) => ext.recent.find((v) => isSamePage(f, v.key, v.route))?.at;
  const fromFavorite = (f: Favorite): Item => {
    const branch = nameOf(f.key) ?? f.key;
    const seen = visitedHere(f);
    return {
      ...base(f.key, f.route),
      id: `fav-${f.id}`,
      title: f.note ?? branch,
      subtitle: f.note ? `${branch} · ${routePath(f.route)}` : routePath(f.route),
      route: f.route,
      exactRoute: f.route,
      current: !!here && isSamePage(f, here.key, here.route),
      time: seen ? ago(seen) : undefined,
    };
  };
  const fromVisit = (v: Visit): Item => ({
    ...base(v.key, v.route),
    id: `recent-${v.key}-${routePath(v.route)}`,
    subtitle: favOf(v.key, v.route)?.note ?? routePath(v.route),
    route: v.route,
    current: !!here && isSamePage(v, here.key, here.route),
    time: ago(v.at),
  });
  const fromShared = (s: SharedBranch): Item => ({
    ...base(s.key, s.route),
    id: `shared-${s.space}-${s.number}`,
    subtitle: s.note ?? `Shared by @${s.sharedBy}`,
    exactRoute: s.route,
    time: ago(Date.parse(s.updatedAt)),
    shared: s,
    unread: !!seen[issueId(s.space, s.number)],
  });

  const lastSeen = (f: Favorite) => visitedHere(f) ?? f.addedAt;
  const favorites = [...ext.favorites].sort((a, b) => lastSeen(b) - lastSeen(a)).map(fromFavorite);
  // Every page you've opened except the one you're on. The flip-back hint goes on the newest row of the last branch.
  const recent = ext.recent.filter((v) => !(here && isSamePage(v, here.key, here.route))).map(fromVisit);
  const flipRow = recent.find((i) => i.previous);
  for (const i of recent) i.previous = i === flipRow;

  const q = query.trim().toLowerCase();
  if (!q) {
    if (view === "favorites") return favorites.length ? [{ id: "favorites", label: "Favorites", items: favorites }] : [];
    if (view === "recent") return recent.length ? [{ id: "recent", label: "Recently opened", items: recent }] : [];
    return sharedGroups(shared, me, fromShared);
  }

  const tokens = q.split(/\s+/);
  const matches = (item: Item) => {
    const hay = [item.title, item.key ?? "", item.subtitle, item.shared?.sharedBy ?? "", ...(item.shared?.lists ?? [])].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };
  // Each page shows once: a shared or recent row is hidden when that same page is already a favorite.
  const pageOf = (i: Item) => `${i.key}|${routePath(i.exactRoute ?? i.route ?? "/")}`;
  const groups: ItemGroup[] = [{ id: "favorites", label: "Favorites", items: favorites.filter(matches) }];
  const listed = new Set(groups[0].items.map(pageOf));
  const sharedMatches = shared.map(fromShared).filter((i) => !listed.has(pageOf(i)) && matches(i));
  groups.push({ id: "shared", label: "Shared", items: sharedMatches });
  for (const i of sharedMatches) listed.add(pageOf(i));
  groups.push({ id: "recent", label: "Recent", items: recent.filter((i) => !listed.has(pageOf(i)) && matches(i)) });
  for (const i of groups[2].items) listed.add(pageOf(i));
  const listedKeys = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));

  if (typed?.kind === "link" && !listed.has(`${typed.key}|${routePath(typed.route)}`)) {
    groups.push({ id: "any", label: "Pasted link", items: [{ ...base(typed.key, typed.route), id: "typed-link", subtitle: routePath(typed.route), exactRoute: typed.route }] });
  } else if (typed?.kind === "name" && !(typed.key && listedKeys.has(typed.key))) {
    const known = typed.key ? { ...base(typed.key, "/"), favorite: undefined } : { key: null, current: false, previous: false };
    groups.push({ id: "any", label: "Any branch", items: [{ ...known, id: "typed-name", name: typed.name, title: typed.name, subtitle: LOOKUP_TEXT[typed.status], status: typed.status }] });
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
  const lists = [...new Map(shared.flatMap((s) => s.lists.map((name) => [`${s.space}/${name}`, { space: s.space, name }] as const))).values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const l of lists) {
    groups.push({ id: `list-${l.space}-${l.name}`, label: multi ? `${l.name} · ${l.space}` : l.name, items: take(shared.filter((s) => s.space === l.space && s.lists.includes(l.name))) });
  }
  const rest = take(shared);
  groups.push({ id: "everything", label: groups.some((g) => g.items.length) ? "Everything else" : "Shared", items: rest });
  return groups.filter((g) => g.items.length);
}
