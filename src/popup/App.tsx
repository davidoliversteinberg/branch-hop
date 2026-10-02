import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
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
import { IconArrowUpRightFromSquare, IconComment, IconCopy, IconGear, IconPenField, IconShareNodes, IconStar } from "@optiaxiom/icons";
import type { Unread } from "../shared/messages.ts";
import { openPreview } from "../shared/nav";
import { branchColor } from "../shared/palette";
import { previewUrl } from "../shared/preview";
import { NOTE_MAX, rememberName, removeFavorite, saveFavorite, setSetting } from "../shared/store";
import { AccessCard, CommentsPanel, SharePanel, SignInCard, type ShareTarget } from "./GitHubPanels";
import { ago, buildGroups, type Item, type View } from "./items";
import { SettingsPanel } from "./SettingsPanel";
import { useExtensionState, useShortcuts } from "./useExtensionState";
import { send, useGitHub } from "./useGitHub";
import { useTyped } from "./useTyped";

type Panel = null | { kind: "settings" } | { kind: "share"; target: ShareTarget } | { kind: "comments"; issue: number };
type NoteDraft = { key: string; name?: string; route?: string; title: string; value: string };

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";
const optionId = (index: number) => `branch-option-${index}`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

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
  return (
    <Group gap="8" alignItems="center">
      {item.unread && (
        <Badge intent="information" variant="subtle">
          New
        </Badge>
      )}
      {item.current ? (
        <Text fontSize="sm" color="fg.tertiary">
          This tab
        </Text>
      ) : item.previous && flipKeys && !item.shared ? (
        <Tooltip content="Flip back to this branch">
          <Kbd>{flipKeys}</Kbd>
        </Tooltip>
      ) : (
        <>
          {item.favorite && view === "recent" && <IconStar filled size={14} aria-label="Favorite" />}
          {!!item.shared?.comments && (
            <Group gap="2" alignItems="center" aria-label={`${item.shared.comments} comments`}>
              <IconComment size={14} />
              <Text fontSize="sm" color="fg.tertiary" style={{ fontVariantNumeric: "tabular-nums" }}>
                {item.shared.comments}
              </Text>
            </Group>
          )}
          {item.time && !item.unread && (
            <Text fontSize="sm" color="fg.tertiary" style={{ fontVariantNumeric: "tabular-nums" }}>
              {item.time}
            </Text>
          )}
        </>
      )}
    </Group>
  );
}

export function App() {
  const ext = useExtensionState();
  const github = useGitHub();
  const shortcuts = useShortcuts();
  const [view, setView] = useState<View>("favorites");
  const [viewChosen, setViewChosen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [seen, setSeen] = useState<Unread>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const signedIn = github.auth.state === "signed-in";
  const me = github.auth.state === "signed-in" ? github.auth.me : null;
  const unreadCount = Object.keys(github.unread).length;

  useEffect(() => {
    if (!ext.ready || !github.ready || viewChosen) return;
    const otherVisits = ext.recent.some((v) => v.key !== ext.active?.loc?.key);
    // Shared first when there's something new or a sign-in is waiting; then favorites; then recent.
    setView(unreadCount || github.auth.state === "pending" ? "shared" : !ext.favorites.length && otherVisits ? "recent" : "favorites");
    setViewChosen(true);
  }, [ext.ready, github.ready, viewChosen, unreadCount, github.auth.state, ext.recent, ext.favorites.length, ext.active]);

  // Opening the Shared view marks things read; "New" stays on them until the popup closes.
  useEffect(() => {
    if (view !== "shared" || !signedIn || !unreadCount) return;
    setSeen((prev) => ({ ...prev, ...github.unread }));
    void send({ type: "mark-read" }).catch(() => undefined);
  }, [view, signedIn, unreadCount, github.unread]);

  const sources = useMemo(() => ({ ext, shared: github.shared.items, me: me?.login ?? null, seen }), [ext, github.shared.items, me, seen]);
  const baseGroups = useMemo(() => buildGroups(sources, view, query, null), [sources, view, query]);
  const typed = useTyped(query, query.includes("/") || baseGroups.length === 0);
  const groups = useMemo(() => (typed ? buildGroups(sources, view, query, typed) : baseGroups), [sources, view, query, typed, baseGroups]);
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
  const sharedOf = (key: string) => github.shared.items.find((s) => s.key === key);
  const nameOf = (key: string) => favOf(key)?.name ?? ext.names[key] ?? sharedOf(key)?.name;
  const currentTitle = here ? (nameOf(here.key) ?? here.key) : "";
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
      toaster.create(errorText(err), { intent: "danger" });
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

  function startShare(target: ShareTarget) {
    if (!signedIn) {
      setPanel(null);
      setView("shared");
      setQuery("");
      toaster.create("Sign in with GitHub to share branches.", { intent: "information" });
      return;
    }
    setPanel({ kind: "share", target });
  }

  const shareTargetFor = (item: Item): ShareTarget | null =>
    item.key
      ? {
          key: item.key,
          name: item.name,
          title: item.title,
          route: item.exactRoute ?? item.route ?? (item.current && here ? here.route : "/"),
          note: favOf(item.key)?.note,
        }
      : null;

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
      toaster.create(errorText(err), { intent: "danger" });
    }
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

  async function signIn(): Promise<void> {
    try {
      await github.signIn();
      setView("shared");
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  if (!ext.ready) {
    return (
      <Box p="16">
        <Text color="fg.secondary">Loading your branches…</Text>
      </Box>
    );
  }

  const commentsItem = panel?.kind === "comments" ? github.shared.items.find((s) => s.number === panel.issue) : undefined;
  const showSharedGate = view === "shared" && !query.trim();
  const sharedBody =
    showSharedGate && !signedIn ? (
      <SignInCard auth={github.auth} onSignIn={signIn} />
    ) : showSharedGate && github.shared.status !== "ok" && github.shared.status !== "signed-out" && github.shared.items.length === 0 ? (
      <AccessCard shared={github.shared} onRetry={() => void github.refresh().catch(() => undefined)} />
    ) : null;

  return (
    <Box display="flex" flexDirection="column" style={{ maxHeight: 600 }}>
      <Box px="16" py="12" borderB="1" borderColor="border.secondary" display="flex" flexDirection="column" gap="4">
        <Group justifyContent="space-between" alignItems="center">
          <Text fontSize="sm" color="fg.secondary">
            This tab
          </Text>
          <Group gap="4" alignItems="center">
            {here && (
              <Tooltip content="Share this page">
                <Button
                  appearance="subtle"
                  size="sm"
                  aria-label="Share this page"
                  icon={<IconShareNodes />}
                  onClick={() => startShare({ key: here.key, name: nameOf(here.key), title: currentTitle, route: here.route, note: currentFavorite?.note })}
                />
              </Tooltip>
            )}
            {here && (
              <Tooltip content={currentFavorite ? "Remove from favorites" : "Add to favorites"}>
                <Button
                  appearance="subtle"
                  size="sm"
                  aria-label={currentFavorite ? "Remove this branch from favorites" : "Add this branch to favorites"}
                  aria-pressed={!!currentFavorite}
                  icon={<IconStar filled={!!currentFavorite} />}
                  onClick={() => void toggleFavorite({ key: here.key, name: nameOf(here.key), title: currentTitle, route: here.route, favorite: !!currentFavorite })}
                />
              </Tooltip>
            )}
            <Tooltip content={panel?.kind === "settings" ? "Close settings" : "Settings"}>
              <Button
                appearance="subtle"
                size="sm"
                aria-label="Settings"
                aria-pressed={panel?.kind === "settings"}
                icon={<IconGear />}
                onClick={() => setPanel((p) => (p?.kind === "settings" ? null : { kind: "settings" }))}
              />
            </Tooltip>
            {me && (
              <Tooltip content={`Signed in to GitHub as @${me.login}`}>
                <Button
                  appearance="subtle"
                  size="sm"
                  aria-label={`Signed in as @${me.login}. Open settings`}
                  icon={<Avatar size="xs" name={me.name ?? me.login} src={me.avatarUrl} />}
                  onClick={() => setPanel({ kind: "settings" })}
                />
              </Tooltip>
            )}
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
            {!panel && (
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

      {panel?.kind === "settings" ? (
        <SettingsPanel
          ext={ext}
          auth={github.auth}
          shortcuts={shortcuts}
          onSignIn={() => {
            setPanel(null);
            void signIn();
          }}
          onDone={() => setPanel(null)}
        />
      ) : panel?.kind === "share" && me ? (
        <SharePanel
          target={panel.target}
          existing={sharedOf(panel.target.key)}
          people={github.shared.people}
          lists={github.shared.lists}
          me={me.login}
          onClose={() => setPanel(null)}
        />
      ) : panel?.kind === "comments" && commentsItem && me ? (
        <CommentsPanel
          shared={commentsItem}
          title={nameOf(commentsItem.key) ?? commentsItem.key}
          me={me.login}
          muted={ext.muted.includes(commentsItem.key)}
          onClose={() => setPanel(null)}
        />
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
                  if (v === "favorites" || v === "shared" || v === "recent") setView(v);
                }}
              >
                <SegmentedControlItem value="favorites" style={{ flex: 1 }}>
                  Favorites
                </SegmentedControlItem>
                <SegmentedControlItem
                  value="shared"
                  style={{ flex: 1 }}
                  aria-label={unreadCount && view !== "shared" ? `Shared, ${unreadCount} new` : "Shared"}
                  addonAfter={
                    unreadCount > 0 && view !== "shared" ? (
                      <Badge intent="information" variant="strong">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </Badge>
                    ) : undefined
                  }
                >
                  Shared
                </SegmentedControlItem>
                <SegmentedControlItem value="recent" style={{ flex: 1 }}>
                  Recent
                </SegmentedControlItem>
              </SegmentedControl>
            )}
          </Box>

          {sharedBody ?? (
            <Box px="8" py="8" overflow="auto" style={{ flex: "1 1 auto", minHeight: 160 }}>
              {view === "shared" && signedIn && !query && (
                <Group justifyContent="space-between" alignItems="center" px="8" pb="4">
                  <Text fontSize="sm" color={github.shared.status === "ok" ? "fg.tertiary" : "fg.warning.strong"}>
                    {github.shared.status !== "ok"
                      ? (github.shared.message ?? "Couldn't sync with GitHub")
                      : github.shared.fetchedAt
                        ? Date.now() - github.shared.fetchedAt < 60000
                          ? "Updated just now"
                          : `Updated ${ago(github.shared.fetchedAt)} ago`
                        : "Not synced yet"}
                  </Text>
                  <Button appearance="subtle" size="sm" loading={github.syncing} onClick={() => void github.refresh().catch(() => undefined)}>
                    Refresh
                  </Button>
                </Group>
              )}
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
                            addonBefore={item.id === "typed-name" ? undefined : <BranchDot branchKey={item.key} />}
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
                  onAddCurrent={() => here && void toggleFavorite({ key: here.key, name: nameOf(here.key), title: currentTitle, route: here.route, favorite: false })}
                />
              )}
            </Box>
          )}

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
            !sharedBody &&
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
                {active?.shared ? (
                  <Tooltip content="Comments">
                    <Button
                      appearance="subtle"
                      aria-label={`Comments (${active.shared.comments})`}
                      icon={<IconComment />}
                      onClick={() => active.shared && setPanel({ kind: "comments", issue: active.shared.number })}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip content="Add a note">
                    <Button
                      appearance="subtle"
                      aria-label="Add a note"
                      disabled={!active?.key}
                      icon={<IconPenField />}
                      onClick={() =>
                        active?.key &&
                        setNote({ key: active.key, name: active.name, route: active.exactRoute ?? active.route, title: active.title, value: favOf(active.key)?.note ?? "" })
                      }
                    />
                  </Tooltip>
                )}
                <Tooltip content={active?.shared ? "Update sharing" : "Share"}>
                  <Button
                    appearance="subtle"
                    aria-label={active?.shared ? "Update sharing" : "Share"}
                    disabled={!active?.key}
                    icon={<IconShareNodes />}
                    onClick={() => {
                      const target = active && shareTargetFor(active);
                      if (target) startShare(target);
                    }}
                  />
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
      : view === "shared"
        ? ["Nothing shared yet", "Share the page you're on with the share button at the top, or share any branch from Favorites or Recent."]
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
