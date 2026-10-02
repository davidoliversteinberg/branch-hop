import type { SharedBranch } from "../shared/github.ts";
import type { Unread } from "../shared/messages.ts";
import type { PreviewStatus } from "../shared/nav";
import type { Favorite, Visit } from "../shared/store";
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
  /** Always open this route (pasted links and shared branches), even with "keep route" on. */
  exactRoute?: string;
  favorite: boolean;
  current: boolean;
  previous: boolean;
  time?: string;
  status?: Lookup;
  shared?: SharedBranch;
  unread?: boolean;
};
export type ItemGroup = { id: string; label: string; items: Item[] };

export const routePath = (route: string) => route.split(/[?#]/)[0] || "/";

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
  const favs = new Map(ext.favorites.map((f) => [f.key, f]));
  const visits = new Map(ext.recent.map((v) => [v.key, v]));
  const sharedByKey = new Map(shared.map((s) => [s.key, s]));
  const nameOf = (key: string) => favs.get(key)?.name ?? ext.names[key] ?? sharedByKey.get(key)?.name;
  const base = (key: string) => ({
    key,
    name: nameOf(key),
    title: nameOf(key) ?? key,
    favorite: favs.has(key),
    current: key === here?.key,
    previous: key === ext.prevKey,
  });

  const fromFavorite = (f: Favorite): Item => {
    const v = visits.get(f.key);
    return { ...base(f.key), id: `fav-${f.key}`, subtitle: f.note ?? (v ? routePath(v.route) : "Not opened yet"), route: v?.route ?? f.route, time: v ? ago(v.at) : undefined };
  };
  const fromVisit = (v: Visit): Item => ({ ...base(v.key), id: `recent-${v.key}`, subtitle: favs.get(v.key)?.note ?? routePath(v.route), route: v.route, time: ago(v.at) });
  const fromShared = (s: SharedBranch): Item => ({
    ...base(s.key),
    id: `shared-${s.number}`,
    subtitle: s.note ?? `Shared by @${s.sharedBy}`,
    exactRoute: s.route,
    time: ago(Date.parse(s.updatedAt)),
    shared: s,
    unread: !!seen[String(s.number)],
  });

  const lastSeen = (f: Favorite) => visits.get(f.key)?.at ?? f.addedAt;
  const favorites = [...ext.favorites].sort((a, b) => lastSeen(b) - lastSeen(a)).map(fromFavorite);
  const recent = ext.recent.filter((v) => v.key !== here?.key).map(fromVisit);

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
  const groups: ItemGroup[] = [{ id: "favorites", label: "Favorites", items: favorites.filter(matches) }];
  const listed = new Set(groups[0].items.map((i) => i.key));
  const sharedMatches = shared.map(fromShared).filter((i) => !listed.has(i.key) && matches(i));
  groups.push({ id: "shared", label: "Shared", items: sharedMatches });
  for (const i of sharedMatches) listed.add(i.key);
  groups.push({ id: "recent", label: "Recent", items: recent.filter((i) => !listed.has(i.key) && matches(i)) });
  for (const i of groups[2].items) listed.add(i.key);

  if (typed?.kind === "link" && !listed.has(typed.key)) {
    groups.push({ id: "any", label: "Pasted link", items: [{ ...base(typed.key), id: "typed-link", subtitle: routePath(typed.route), exactRoute: typed.route }] });
  } else if (typed?.kind === "name" && !(typed.key && listed.has(typed.key))) {
    const known = typed.key ? base(typed.key) : { key: null, favorite: false, current: false, previous: false };
    groups.push({ id: "any", label: "Any branch", items: [{ ...known, id: "typed-name", name: typed.name, title: typed.name, subtitle: LOOKUP_TEXT[typed.status], status: typed.status }] });
  }
  return groups.filter((g) => g.items.length);
}

/** Shared with you first, then each list, then everything else. Each branch appears once. */
function sharedGroups(shared: SharedBranch[], me: string | null, toItem: (s: SharedBranch) => Item): ItemGroup[] {
  const used = new Set<number>();
  const take = (list: SharedBranch[]) => list.filter((s) => !used.has(s.number) && used.add(s.number)).map(toItem);
  const groups: ItemGroup[] = [{ id: "with-you", label: "Shared with you", items: take(shared.filter((s) => !!me && s.sharedWith.includes(me) && s.sharedBy !== me)) }];
  const listNames = [...new Set(shared.flatMap((s) => s.lists))].sort((a, b) => a.localeCompare(b));
  for (const name of listNames) groups.push({ id: `list-${name}`, label: name, items: take(shared.filter((s) => s.lists.includes(name))) });
  const rest = take(shared);
  groups.push({ id: "everything", label: groups.some((g) => g.items.length) ? "Everything else" : "Shared", items: rest });
  return groups.filter((g) => g.items.length);
}
