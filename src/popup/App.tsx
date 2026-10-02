import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Group,
  Input,
  Kbd,
  Listbox,
  ListboxGroup,
  ListboxItem,
  ListboxLabel,
  Menu,
  MenuContent,
  MenuTrigger,
  SearchInput,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  Tooltip,
  toaster,
} from "@optiaxiom/react";
import { IconArrowUpRightFromSquare, IconCopy, IconGear, IconPenField, IconStar } from "@optiaxiom/icons";
import { checkPreview, openPreview, type PreviewStatus } from "../shared/nav";
import { branchColor } from "../shared/palette";
import { BRANCH_NAME_RE, keyForBranch, parsePreviewUrl, previewUrl } from "../shared/preview";
import { NOTE_MAX, clearRecent, rememberName, removeFavorite, saveFavorite, setSetting, type Favorite, type Visit } from "../shared/store";
import { type ExtState, useExtensionState, useShortcuts } from "./useExtensionState";

type View = "favorites" | "recent";
type Lookup = PreviewStatus | "checking";
type Typed = { kind: "link"; key: string; route: string } | { kind: "name"; name: string; key: string | null; status: Lookup };

type Item = {
  id: string;
  key: string | null;
  name?: string;
  title: string;
  subtitle: string;
  route?: string;
  exactRoute?: string;
  favorite: boolean;
  current: boolean;
  previous: boolean;
  time?: string;
  status?: Lookup;
};
type ItemGroup = { id: string; label: string; items: Item[] };
type NoteDraft = { key: string; name?: string; route?: string; title: string; value: string };

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const optionId = (index: number) => `branch-option-${index}`;
const routePath = (route: string) => route.split(/[?#]/)[0] || "/";

function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const LOOKUP_TEXT: Record<Lookup, string> = {
  checking: "Looking for its preview…",
  found: "Preview found",
  missing: "No preview yet. Vercel builds one after the first push.",
  error: "Couldn't reach Vercel to check",
};

function buildGroups(ext: ExtState, view: View, query: string, typed: Typed | null): ItemGroup[] {
  const here = ext.active?.loc ?? null;
  const favs = new Map(ext.favorites.map((f) => [f.key, f]));
  const visits = new Map(ext.recent.map((v) => [v.key, v]));
  const nameOf = (key: string) => favs.get(key)?.name ?? ext.names[key];
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
  const fromVisit = (v: Visit): Item => ({
    ...base(v.key),
    id: `recent-${v.key}`,
    subtitle: favs.get(v.key)?.note ?? routePath(v.route),
    route: v.route,
    time: ago(v.at),
  });

  const lastSeen = (f: Favorite) => visits.get(f.key)?.at ?? f.addedAt;
  const favorites = [...ext.favorites].sort((a, b) => lastSeen(b) - lastSeen(a)).map(fromFavorite);
  const recent = ext.recent.filter((v) => v.key !== here?.key).map(fromVisit);

  const q = query.trim().toLowerCase();
  if (!q) {
    const group = view === "favorites" ? { id: "favorites", label: "Favorites", items: favorites } : { id: "recent", label: "Recently opened", items: recent };
    return group.items.length ? [group] : [];
  }

  const tokens = q.split(/\s+/);
  const matches = (item: Item) => {
    const hay = [item.title, item.key ?? "", item.subtitle].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };
  const groups: ItemGroup[] = [
    { id: "favorites", label: "Favorites", items: favorites.filter(matches) },
    { id: "recent", label: "Recent", items: recent.filter((i) => !i.favorite && matches(i)) },
  ];
  const listed = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
  if (typed?.kind === "link" && !listed.has(typed.key)) {
    groups.push({ id: "any", label: "Pasted link", items: [{ ...base(typed.key), id: "typed-link", subtitle: routePath(typed.route), exactRoute: typed.route }] });
  } else if (typed?.kind === "name" && !(typed.key && listed.has(typed.key))) {
    const known = typed.key ? base(typed.key) : { key: null, favorite: false, current: false, previous: false };
    groups.push({
      id: "any",
      label: "Any branch",
      items: [{ ...known, id: "typed-name", name: typed.name, title: typed.name, subtitle: LOOKUP_TEXT[typed.status], status: typed.status }],
    });
  }
  return groups.filter((g) => g.items.length);
}

/** Resolves a pasted preview link, or a typed branch name to its preview (hash included). */
function useTyped(query: string, enabled: boolean): Typed | null {
  const [typed, setTyped] = useState<Typed | null>(null);
  useEffect(() => {
    const q = query.trim();
    const link = parsePreviewUrl(q);
    if (link) {
      setTyped({ kind: "link", key: link.key, route: link.route });
      return;
    }
    if (!enabled || q.length < 2 || !BRANCH_NAME_RE.test(q)) {
      setTyped(null);
      return;
    }
    let cancelled = false;
    setTyped({ kind: "name", name: q, key: null, status: "checking" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const key = await keyForBranch(q);
          if (cancelled) return;
          setTyped({ kind: "name", name: q, key, status: "checking" });
          const status = await checkPreview(key);
          if (!cancelled) setTyped({ kind: "name", name: q, key, status });
        } catch {
          if (!cancelled) setTyped({ kind: "name", name: q, key: null, status: "error" });
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled]);
  return typed;
}

function BranchDot({ branchKey }: { branchKey: string | null }) {
  return (
    <Box aria-hidden="true" display="flex" alignItems="center" justifyContent="center" style={{ width: 20, height: 20 }}>
      <Box rounded="full" style={{ width: 8, height: 8, background: branchKey ? branchColor(branchKey) : "transparent" }} />
    </Box>
  );
}

function RowMeta({ item, view, flipKeys }: { item: Item; view: View; flipKeys: string }) {
  if (item.status === "checking") return <Badge intent="neutral" variant="subtle">Checking</Badge>;
  if (item.status === "found") return <Badge intent="success" variant="subtle">Preview</Badge>;
  if (item.status === "missing") return <Badge intent="warning" variant="subtle">No preview</Badge>;
  if (item.current) return <Text fontSize="sm" color="fg.tertiary">This tab</Text>;
  if (item.previous && flipKeys) {
    return (
      <Tooltip content="Flip back to this branch">
        <Kbd>{flipKeys}</Kbd>
      </Tooltip>
    );
  }
  return (
    <Group gap="4" alignItems="center">
      {item.favorite && view === "recent" && <IconStar filled size={14} aria-label="Favorite" />}
      {item.time && (
        <Text fontSize="sm" color="fg.tertiary" style={{ fontVariantNumeric: "tabular-nums" }}>
          {item.time}
        </Text>
      )}
    </Group>
  );
}

export function App() {
  const ext = useExtensionState();
  const shortcuts = useShortcuts();
  const [view, setView] = useState<View>("favorites");
  const [viewChosen, setViewChosen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ext.ready && !viewChosen) {
      // Favorites first; Recent when there are no favorites but other branches were opened.
      const otherVisits = ext.recent.some((v) => v.key !== ext.active?.loc?.key);
      setView(!ext.favorites.length && otherVisits ? "recent" : "favorites");
      setViewChosen(true);
    }
  }, [ext.ready, ext.favorites.length, ext.recent, ext.active, viewChosen]);

  const baseGroups = useMemo(() => buildGroups(ext, view, query, null), [ext, view, query]);
  const typed = useTyped(query, query.includes("/") || baseGroups.length === 0);
  const groups = useMemo(() => (typed ? buildGroups(ext, view, query, typed) : baseGroups), [ext, view, query, typed, baseGroups]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeIndex = flat.length ? Math.min(hi, flat.length - 1) : -1;
  const active = activeIndex >= 0 ? flat[activeIndex] : null;
  const here = ext.active?.loc ?? null;
  const onPreview = here !== null;

  useEffect(() => setHi(0), [query, view]);
  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const favOf = (key: string) => ext.favorites.find((f) => f.key === key);
  const currentTitle = here ? (favOf(here.key)?.name ?? ext.names[here.key] ?? here.key) : "";
  const currentFavorite = here ? favOf(here.key) : undefined;
  const routeFor = (item: Item) => item.exactRoute ?? (ext.settings.keepRoute && here ? here.route : (item.route ?? "/"));
  const canOpen = !!active?.key && active.status !== "missing" && active.status !== "checking";

  async function open(item: Item | null, newTab: boolean) {
    if (!item?.key || item.status === "checking") return;
    if (item.status === "missing") {
      toaster.create(`There's no preview for ${item.title} yet.`, { intent: "warning" });
      return;
    }
    try {
      if (item.name) await rememberName(item.key, item.name);
      const route = routeFor(item);
      const sameTab = !newTab && onPreview;
      if (sameTab && item.key === here?.key && route === here?.route) {
        window.close();
        return;
      }
      await openPreview({ key: item.key, route }, { tab: ext.active?.tab, newTab: !sameTab });
      window.close();
    } catch {
      toaster.create("Branch Hop couldn't open that branch.", { intent: "danger" });
    }
  }

  async function toggleFavorite(target: { key: string | null; name?: string; title: string; route?: string; favorite: boolean } | null) {
    if (!target?.key) return;
    try {
      if (target.favorite) {
        await removeFavorite(target.key);
        toaster.create(`Removed ${target.title} from favorites`);
      } else {
        await saveFavorite({ key: target.key, name: target.name, route: target.route, addedAt: Date.now() });
        if (target.name) await rememberName(target.key, target.name);
        toaster.create(`Added ${target.title} to favorites`, { intent: "success" });
      }
    } catch (err) {
      toaster.create(err instanceof Error ? err.message : "Couldn't update favorites", { intent: "danger" });
    }
  }

  async function copy(item: Item | null, format: "url" | "markdown") {
    if (!item?.key) return;
    const url = previewUrl(item.key, routeFor(item));
    const text = format === "markdown" ? `[${item.title.replace(/[[\]\\]/g, "\\$&")}](${url.replace(/\)/g, "%29")})` : url;
    try {
      await navigator.clipboard.writeText(text);
      toaster.create(format === "markdown" ? "Markdown link copied" : "Link copied", { intent: "success" });
    } catch {
      toaster.create("Your browser blocked copying. Try again.", { intent: "danger" });
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!note) return;
    const existing = favOf(note.key);
    try {
      await saveFavorite({ key: note.key, name: existing?.name ?? note.name, route: existing?.route ?? note.route, addedAt: existing?.addedAt ?? Date.now(), note: note.value });
      toaster.create(note.value.trim() ? "Note saved" : "Note removed", { intent: "success" });
      setNote(null);
      searchRef.current?.focus();
    } catch (err) {
      toaster.create(err instanceof Error ? err.message : "Couldn't save the note", { intent: "danger" });
    }
  }

  function startNote(item: Item | null) {
    if (!item?.key) return;
    setNote({ key: item.key, name: item.name, route: item.exactRoute ?? item.route, title: item.title, value: favOf(item.key)?.note ?? "" });
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHi((i) => (Math.min(i, flat.length - 1) + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void open(active, e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else window.close();
    }
  }

  if (!ext.ready) {
    return (
      <Box p="16">
        <Text color="fg.secondary">Loading your branches…</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" style={{ maxHeight: 600 }}>
      <Box px="16" py="12" borderB="1" borderColor="border.secondary" display="flex" flexDirection="column" gap="4">
        <Group justifyContent="space-between" alignItems="center">
          <Text fontSize="sm" color="fg.secondary">
            This tab
          </Text>
          <Group gap="4">
            {here && (
              <Tooltip content={currentFavorite ? "Remove from favorites" : "Add to favorites"}>
                <Button
                  appearance="subtle"
                  size="sm"
                  aria-label={currentFavorite ? "Remove this branch from favorites" : "Add this branch to favorites"}
                  aria-pressed={!!currentFavorite}
                  icon={<IconStar filled={!!currentFavorite} />}
                  onClick={() => void toggleFavorite({ key: here.key, name: ext.names[here.key], title: currentTitle, route: here.route, favorite: !!currentFavorite })}
                />
              </Tooltip>
            )}
            <Tooltip content={settingsOpen ? "Close settings" : "Settings"}>
              <Button appearance="subtle" size="sm" aria-label="Settings" aria-pressed={settingsOpen} icon={<IconGear />} onClick={() => setSettingsOpen((v) => !v)} />
            </Tooltip>
          </Group>
        </Group>
        {here ? (
          <>
            <Text fontSize="lg" fontWeight="500" truncate title={currentTitle}>
              {currentTitle}
            </Text>
            {currentFavorite?.note && (
              <Text fontSize="sm" color="fg.secondary" truncate title={currentFavorite.note}>
                {currentFavorite.note}
              </Text>
            )}
            <Text fontSize="sm" fontFamily="mono" color="fg.secondary" truncate title={here.route}>
              {here.route}
            </Text>
            {!settingsOpen && (
              <Box pt="8">
                <Switch checked={ext.settings.keepRoute} onCheckedChange={(v) => void setSetting("keepRoute", v)}>
                  Keep this route when switching
                </Switch>
              </Box>
            )}
          </>
        ) : (
          <>
            <Text fontSize="lg" fontWeight="500" color="fg.secondary">
              Not an Axiom Play preview
            </Text>
            <Text fontSize="sm" color="fg.secondary">
              Branches open in a new tab, where you last left them.
            </Text>
          </>
        )}
      </Box>

      {settingsOpen ? (
        <SettingsPanel ext={ext} shortcuts={shortcuts} onDone={() => setSettingsOpen(false)} />
      ) : (
        <>
          <Box px="16" pt="12" display="flex" flexDirection="column" gap="8">
            <SearchInput
              ref={searchRef}
              autoFocus
              value={query}
              placeholder="Search, or paste a branch name or link"
              aria-label="Search branches"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="branch-list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              onChange={(e) => setQuery(e.target.value)}
              onValueClear={() => setQuery("")}
              onKeyDown={onSearchKeyDown}
            />
            {!query && (
              <SegmentedControl
                type="single"
                value={view}
                aria-label="Show"
                onValueChange={(v: string) => {
                  if (v === "favorites" || v === "recent") setView(v);
                }}
              >
                <SegmentedControlItem value="favorites" style={{ flex: 1 }}>
                  Favorites
                </SegmentedControlItem>
                <SegmentedControlItem value="recent" style={{ flex: 1 }}>
                  Recent
                </SegmentedControlItem>
              </SegmentedControl>
            )}
          </Box>

          <Box px="8" py="8" overflow="auto" style={{ flex: "1 1 auto", minHeight: 160 }}>
            {flat.length > 0 ? (
              <Listbox id="branch-list" role="listbox" aria-label="Branches">
                {groups.map((g) => (
                  <ListboxGroup key={g.id} role="group" aria-labelledby={`group-${g.id}`}>
                    <ListboxLabel id={`group-${g.id}`}>{g.label}</ListboxLabel>
                    {g.items.map((item) => {
                      const index = flat.indexOf(item);
                      const highlighted = index === activeIndex;
                      return (
                        <ListboxItem
                          key={item.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={highlighted}
                          data-highlighted={highlighted ? "" : undefined}
                          addonBefore={item.key === null || item.id === "typed-name" ? undefined : <BranchDot branchKey={item.key} />}
                          icon={item.id === "typed-name" ? <IconArrowUpRightFromSquare /> : undefined}
                          addonAfter={<RowMeta item={item} view={view} flipKeys={shortcuts.flip} />}
                          description={item.subtitle}
                          onMouseMove={() => {
                            if (index !== activeIndex) setHi(index);
                          }}
                          onClick={(e) => void open(item, e.metaKey || e.ctrlKey)}
                        >
                          {item.title}
                        </ListboxItem>
                      );
                    })}
                  </ListboxGroup>
                ))}
              </Listbox>
            ) : (
              <EmptyState
                query={query}
                view={view}
                canAddCurrent={!!here && !currentFavorite}
                onAddCurrent={() => here && void toggleFavorite({ key: here.key, name: ext.names[here.key], title: currentTitle, route: here.route, favorite: false })}
              />
            )}
          </Box>

          {note ? (
            <Box asChild px="12" py="12" borderT="1" borderColor="border.secondary" display="flex" flexDirection="column" gap="8">
              <form onSubmit={(e) => void saveNote(e)}>
                <Field label={`Note for ${note.title}`}>
                  <Input
                    autoFocus
                    value={note.value}
                    maxLength={NOTE_MAX}
                    placeholder="What's this branch for?"
                    onChange={(e) => setNote({ ...note, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setNote(null);
                      }
                    }}
                  />
                </Field>
                <Group gap="8" justifyContent="end">
                  <Button appearance="subtle" onClick={() => setNote(null)}>
                    Cancel
                  </Button>
                  <Button appearance="primary" type="submit">
                    Save note
                  </Button>
                </Group>
              </form>
            </Box>
          ) : (
            flat.length > 0 && (
              <Group px="12" py="8" gap="8" alignItems="center" borderT="1" borderColor="border.secondary">
                <Tooltip content={onPreview ? "Open in this tab (Enter)" : "Open in a new tab (Enter)"}>
                  <Button appearance="primary" disabled={!canOpen} onClick={() => void open(active, !onPreview)}>
                    {onPreview ? "Open" : "Open in new tab"}
                  </Button>
                </Tooltip>
                {onPreview && (
                  <Tooltip content={`Open in a new tab (${MOD} Enter)`}>
                    <Button appearance="default" disabled={!canOpen} onClick={() => void open(active, true)}>
                      New tab
                    </Button>
                  </Tooltip>
                )}
                <Box style={{ flex: 1 }} />
                <Tooltip content={active?.favorite ? "Remove from favorites" : "Add to favorites"}>
                  <Button
                    appearance="subtle"
                    aria-label={active?.favorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={!!active?.favorite}
                    disabled={!active?.key}
                    icon={<IconStar filled={!!active?.favorite} />}
                    onClick={() => void toggleFavorite(active && { key: active.key, name: active.name, title: active.title, route: active.exactRoute ?? active.route, favorite: active.favorite })}
                  />
                </Tooltip>
                <Tooltip content="Add a note">
                  <Button appearance="subtle" aria-label="Add a note" disabled={!active?.key} icon={<IconPenField />} onClick={() => startNote(active)} />
                </Tooltip>
                <Menu
                  options={[
                    { label: "Copy link", execute: () => void copy(active, "url") },
                    { label: "Copy as Markdown link", execute: () => void copy(active, "markdown") },
                  ]}
                >
                  <Tooltip content="Copy link">
                    <MenuTrigger asChild>
                      <Button appearance="subtle" aria-label="Copy link" disabled={!active?.key} icon={<IconCopy />} />
                    </MenuTrigger>
                  </Tooltip>
                  <MenuContent />
                </Menu>
              </Group>
            )
          )}
        </>
      )}
    </Box>
  );
}

function EmptyState({ query, view, canAddCurrent, onAddCurrent }: { query: string; view: View; canAddCurrent: boolean; onAddCurrent: () => void }) {
  const q = query.trim();
  const [title, body] = q
    ? [`Nothing matches “${q}”`, "Paste a preview link, or type a full branch name like david/image-gen-editor."]
    : view === "favorites"
      ? ["No favorites yet", "Star a branch to keep it here. Add a note so you remember what it's for."]
      : ["Nothing opened yet", "Branches you open in this browser show up here."];
  return (
    <Box px="8" py="16" display="flex" flexDirection="column" gap="8" alignItems="start">
      <Text fontWeight="500">{title}</Text>
      <Text fontSize="sm" color="fg.secondary">
        {body}
      </Text>
      {!q && view === "favorites" && canAddCurrent && (
        <Button appearance="primary" icon={<IconStar filled />} onClick={onAddCurrent}>
          Add this branch
        </Button>
      )}
    </Box>
  );
}

function SettingsPanel({ ext, shortcuts, onDone }: { ext: ExtState; shortcuts: { open: string; flip: string }; onDone: () => void }) {
  const isChromium = navigator.userAgent.includes("Chrome/");
  const version = chrome.runtime.getManifest().version;
  return (
    <Box px="16" py="12" display="flex" flexDirection="column" gap="16" overflow="auto">
      <Group justifyContent="space-between" alignItems="center">
        <Text fontWeight="500">Settings</Text>
        <Button appearance="subtle" size="sm" onClick={onDone}>
          Done
        </Button>
      </Group>
      <Switch checked={ext.settings.keepRoute} onCheckedChange={(v) => void setSetting("keepRoute", v)} description="Open the same page on the branch you pick.">
        Keep the route when switching
      </Switch>
      <Switch checked={ext.settings.tabLabels} onCheckedChange={(v) => void setSetting("tabLabels", v)} description="Puts the branch in tab titles and a coloured dot on the tab icon.">
        Branch names on tabs
      </Switch>
      <Switch checked={ext.settings.pagePill} onCheckedChange={(v) => void setSetting("pagePill", v)} description="Shows the branch at the bottom of preview pages, with a way back.">
        Branch pill on preview pages
      </Switch>
      <Box display="flex" flexDirection="column" gap="8">
        <Text fontSize="sm" fontWeight="500">
          Keyboard shortcuts
        </Text>
        <Group justifyContent="space-between" alignItems="center">
          <Text fontSize="sm">Open Branch Hop</Text>
          {shortcuts.open ? <Kbd>{shortcuts.open}</Kbd> : <Text fontSize="sm" color="fg.tertiary">Not set</Text>}
        </Group>
        <Group justifyContent="space-between" alignItems="center">
          <Text fontSize="sm">Flip back to the last branch</Text>
          {shortcuts.flip ? <Kbd>{shortcuts.flip}</Kbd> : <Text fontSize="sm" color="fg.tertiary">Not set</Text>}
        </Group>
        {isChromium && (
          <Box>
            <Button appearance="default" size="sm" onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
              Change shortcuts
            </Button>
          </Box>
        )}
      </Box>
      <Text fontSize="sm" color="fg.secondary">
        Next, with GitHub sign-in: shared lists, comments, and notifications when a branch you follow is updated.
      </Text>
      <Group justifyContent="space-between" alignItems="center" gap="8">
        <Text fontSize="sm" color="fg.tertiary">
          Branch Hop {version}. Favorites and history stay in this browser.
        </Text>
        <Button
          appearance="default"
          size="sm"
          onClick={() =>
            void clearRecent().then(
              () => toaster.create("Recent history cleared"),
              () => toaster.create("Couldn't clear history", { intent: "danger" }),
            )
          }
        >
          Clear history
        </Button>
      </Group>
    </Box>
  );
}
