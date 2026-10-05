import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Field, Group, Input, SearchInput, Tabs, TabsContent, TabsList, TabsTrigger, Text, toaster } from "@optiaxiom/react";
import type { Unread } from "../shared/messages.ts";
import { NOTE_MAX, recordVisit } from "../shared/store";
import { ViewHeader } from "./BranchBits";
import { BranchList, optionId } from "./BranchList";
import { CurrentPage } from "./CurrentPage";
import { AccessCard, CommentsPanel, SharePanel, SignInCard, SsoNotice, type ShareTarget } from "./GitHubPanels";
import { ago, buildGroups, routePath, type Item, type View } from "./items";
import { SettingsPanel } from "./SettingsPanel";
import { UpdateNotice } from "./UpdateNotice";
import { useActions, type PageRef } from "./useActions";
import { useExtensionState, useShortcuts } from "./useExtensionState";
import { send, useGitHub } from "./useGitHub";
import { useTyped } from "./useTyped";

type Panel = null | { kind: "settings" } | { kind: "share"; target: ShareTarget } | { kind: "comments"; space: string; issue: number };
type NoteDraft = { page: PageRef; value: string };

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export function App() {
  const ext = useExtensionState();
  const github = useGitHub();
  const shortcuts = useShortcuts();
  const actions = useActions(ext);
  const [view, setView] = useState<View>("branches");
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [seen, setSeen] = useState<Unread>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const signedIn = github.auth.state === "signed-in";
  const me = github.auth.state === "signed-in" ? github.auth.me : null;
  const unreadCount = Object.keys(github.unread).length;

  // A sign-in in progress lives on the Shared tab, so come back to it there.
  useEffect(() => {
    if (github.auth.state === "pending") setView("shared");
  }, [github.auth.state]);

  // Opening the Shared tab marks things read; "New" stays on them until the popup closes.
  useEffect(() => {
    if (view !== "shared" || !signedIn || !unreadCount) return;
    setSeen((prev) => ({ ...prev, ...github.unread }));
    void send({ type: "mark-read" }).catch(() => undefined);
  }, [view, signedIn, unreadCount, github.unread]);

  // Branch status refreshes when it's stale; the background worker skips anything checked recently.
  useEffect(() => {
    if (ext.ready && ext.settings.branchStatus) void send({ type: "status-refresh", force: false }).catch(() => undefined);
  }, [ext.ready, ext.settings.branchStatus]);

  const sources = useMemo(() => ({ ext, shared: github.shared.items, me: me?.login ?? null, seen }), [ext, github.shared.items, me, seen]);
  const baseGroups = useMemo(() => buildGroups(sources, view, query, null), [sources, view, query]);
  const typed = useTyped(query, query.includes("/") || baseGroups.length === 0);
  const groups = useMemo(() => (typed ? buildGroups(sources, view, query, typed) : baseGroups), [sources, view, query, typed, baseGroups]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeIndex = flat.length ? Math.min(hi, flat.length - 1) : -1;
  const active = activeIndex >= 0 ? flat[activeIndex] : null;
  const here = actions.here;

  useEffect(() => setHi(0), [query, view]);
  // The page you're on always lands in Recent, even if the browser didn't report the visit.
  const herePage = here ? `${here.key}${here.route}` : "";
  useEffect(() => {
    if (here) void recordVisit({ key: here.key, route: here.route, at: Date.now() }).catch(() => undefined);
  }, [herePage]);
  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const backToList = () => {
    setPanel(null);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  function startShare(page: PageRef) {
    const title = actions.titleOf(page.key);
    const bookmarkNote = ext.favorites.find((f) => f.key === page.key && routePath(f.route) === routePath(page.route))?.note;
    setPanel({ kind: "share", target: { key: page.key, name: page.name, title, route: page.route, note: bookmarkNote } });
  }

  async function signIn(): Promise<void> {
    try {
      await github.signIn();
      setPanel(null);
      setView("shared");
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
      if (active) void actions.openItem(active, e.metaKey || e.ctrlKey);
    } else if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      if (active && active.kind !== "typed") setMenuFor(active.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else window.close();
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!note) return;
    await actions.saveNote(note.page, note.value);
    setNote(null);
    searchRef.current?.focus();
  }

  if (!ext.ready) {
    return (
      <Box p="16">
        <Text color="fg.secondary">Loading your branches…</Text>
      </Box>
    );
  }

  if (panel?.kind === "settings") {
    return (
      <Shell>
        <SettingsPanel ext={ext} auth={github.auth} shared={github.shared} shortcuts={shortcuts} onSignIn={() => void signIn()} onDone={backToList} />
      </Shell>
    );
  }
  if (panel?.kind === "share") {
    return (
      <Shell>
        {me ? (
          <SharePanel target={panel.target} spaces={github.shared.spaces} items={github.shared.items} me={me.login} onClose={backToList} />
        ) : (
          <>
            <ViewHeader title={`Share ${panel.target.title}`} onBack={backToList} />
            <SignInCard auth={github.auth} onSignIn={signIn} />
          </>
        )}
      </Shell>
    );
  }
  const commentsItem = panel?.kind === "comments" ? github.shared.items.find((s) => s.space === panel.space && s.number === panel.issue) : undefined;
  if (commentsItem && me) {
    return (
      <Shell>
        <CommentsPanel shared={commentsItem} title={actions.titleOf(commentsItem.key)} me={me.login} muted={ext.muted.includes(commentsItem.key)} onClose={backToList} />
      </Shell>
    );
  }

  const gate =
    view === "shared" && !query.trim() ? (
      !signedIn ? (
        <SignInCard auth={github.auth} onSignIn={signIn} />
      ) : github.shared.status !== "ok" && github.shared.status !== "signed-out" && github.shared.items.length === 0 && github.ready ? (
        <AccessCard shared={github.shared} onRetry={() => void github.refresh().catch(() => undefined)} />
      ) : null
    ) : null;

  // Merged and deleted branches you still keep, offered for a one-click cleanup.
  const doneRows = view === "branches" && !query ? flat.filter((i) => i.kind === "branch" && (i.status?.state === "merged" || i.status?.state === "deleted")) : [];
  const doneKeys = [...new Set(doneRows.map((i) => i.key as string))];
  const doneWord = doneRows.every((i) => i.status?.state === "merged") ? "merged" : doneRows.every((i) => i.status?.state === "deleted") ? "deleted" : "merged or deleted";

  const list = (
    <Box px="8" pt="4" pb="8" overflow="auto" style={{ flex: "1 1 auto", minHeight: 160 }}>
      {view === "shared" && signedIn && !query && github.shared.spaces.filter((sp) => sp.status === "sso").map((sp) => <SsoNotice key={sp.owner} space={sp} />)}
      {view === "shared" && signedIn && !query && !gate && (
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
      {doneKeys.length > 0 && (
        <Group justifyContent="space-between" alignItems="center" gap="8" px="8" pt="4" pb="4">
          <Text fontSize="sm" color="fg.secondary">
            {doneKeys.length === 1 ? `1 branch is ${doneWord}` : `${doneKeys.length} branches are ${doneWord}`}
          </Text>
          <Button appearance="subtle" size="sm" onClick={() => void actions.forgetMany(doneKeys)}>
            {doneKeys.length === 1 ? "Remove it" : "Remove all"}
          </Button>
        </Group>
      )}
      {gate ??
        (flat.length > 0 ? (
          <BranchList
            groups={groups}
            flat={flat}
            activeIndex={activeIndex}
            onHighlight={setHi}
            menuFor={menuFor}
            onMenuFor={(id) => {
              setMenuFor(id);
              if (!id) window.requestAnimationFrame(() => searchRef.current?.focus());
            }}
            actions={actions}
            newTab={ext.settings.newTab}
            flipKeys={shortcuts.flip}
            handlers={{
              onShare: startShare,
              onComments: (item: Item) => item.shared && setPanel({ kind: "comments", space: item.shared.space, issue: item.shared.number }),
              onNote: (page, value) => setNote({ page, value }),
            }}
          />
        ) : (
          <EmptyState query={query} view={view} />
        ))}
    </Box>
  );

  return (
    <Shell>
      <CurrentPage ext={ext} actions={actions} signedIn={signedIn} onSettings={() => setPanel({ kind: "settings" })} onSignIn={() => void signIn()} onShare={startShare} />
      <UpdateNotice />
      <Box px="16" pt="12" pb="4">
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
      </Box>
      {query ? (
        list
      ) : (
        <Tabs value={view} onValueChange={(v: string) => (v === "branches" || v === "shared") && setView(v)} display="flex" flexDirection="column" style={{ flex: "1 1 auto", minHeight: 0 }}>
          <Box px="16">
            <TabsList>
              <TabsTrigger value="branches">Branches</TabsTrigger>
              <TabsTrigger
                value="shared"
                aria-label={unreadCount && view !== "shared" ? `Shared, ${unreadCount} new` : undefined}
                addonAfter={
                  unreadCount > 0 && view !== "shared" ? (
                    <Badge intent="information" variant="strong">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </Badge>
                  ) : undefined
                }
              >
                Shared
              </TabsTrigger>
            </TabsList>
          </Box>
          <TabsContent value="branches" display="flex" flexDirection="column" style={{ flex: "1 1 auto", minHeight: 0 }}>
            {view === "branches" && list}
          </TabsContent>
          <TabsContent value="shared" display="flex" flexDirection="column" style={{ flex: "1 1 auto", minHeight: 0 }}>
            {view === "shared" && list}
          </TabsContent>
        </Tabs>
      )}

      {note && (
        <Box asChild px="16" py="12" borderT="1" borderColor="border.secondary" display="flex" flexDirection="column" gap="8">
          <form onSubmit={(e) => void saveNote(e)}>
            <Field label={`Note for ${routePath(note.page.route)} on ${actions.titleOf(note.page.key)}`}>
              <Input
                autoFocus
                value={note.value}
                maxLength={NOTE_MAX}
                placeholder="What's this page for?"
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
              <Button appearance="subtle" size="sm" onClick={() => setNote(null)}>
                Cancel
              </Button>
              <Button appearance="primary" size="sm" type="submit">
                Save note
              </Button>
            </Group>
          </form>
        </Box>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" style={{ maxHeight: 600, minHeight: 0 }}>
      {children}
    </Box>
  );
}

function EmptyState({ query, view }: { query: string; view: View }) {
  const q = query.trim();
  const [title, body] = q
    ? [`Nothing matches “${q}”`, "Paste a preview link, or type a full branch name like david/image-gen-editor."]
    : view === "branches"
      ? ["Your branches show up here", "Every preview you open lands in Recent. Pin the branches you're working on to keep them at the top, and bookmark pages you come back to."]
      : ["Nothing shared yet", "Use Share at the top to send the page you're on to a teammate, or share any branch from its ⋯ menu."];
  return (
    <Box px="8" py="16" display="flex" flexDirection="column" gap="8" alignItems="start">
      <Text fontWeight="500">{title}</Text>
      <Text fontSize="sm" color="fg.secondary">
        {body}
      </Text>
    </Box>
  );
}
