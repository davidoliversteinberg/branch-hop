import type { SyntheticEvent } from "react";
import {
  Badge,
  Box,
  Button,
  EllipsisMenuButton,
  Group,
  Kbd,
  Listbox,
  ListboxGroup,
  ListboxItem,
  ListboxLabel,
  Menu,
  MenuContent,
  MenuTrigger,
  Text,
  Tooltip,
  type MenuOption,
} from "@optiaxiom/react";
import { IconArrowUpRightFromSquare, IconBookmarkSolid, IconComment, IconThumbtack } from "@optiaxiom/icons";
import { isSharedIssueUrl } from "../shared/github.ts";
import { pullUrl } from "../shared/status.ts";
import { BranchDot, StatusBadge } from "./BranchBits";
import { routePath, type Item, type ItemGroup } from "./items";
import type { Actions, PageRef } from "./useActions";

export const optionId = (index: number) => `branch-option-${index}`;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = IS_MAC ? "⌘" : "Ctrl";

export type RowHandlers = {
  onShare: (page: PageRef) => void;
  onComments: (item: Item) => void;
  onNote: (page: PageRef, note: string) => void;
};

/**
 * The branch list. Rows are options of the search combobox, so arrow keys and Enter work from the
 * search field. Each row's pin and menu are for the pointer; keyboard and screen reader users open
 * the same menu on the highlighted row with Cmd/Ctrl+K or Shift+F10.
 */
export function BranchList({
  groups,
  flat,
  activeIndex,
  onHighlight,
  menuFor,
  onMenuFor,
  actions,
  newTab,
  flipKeys,
  handlers,
}: {
  groups: ItemGroup[];
  flat: Item[];
  activeIndex: number;
  onHighlight: (index: number) => void;
  menuFor: string | null;
  onMenuFor: (id: string | null) => void;
  actions: Actions;
  newTab: boolean;
  flipKeys: string;
  handlers: RowHandlers;
}) {
  return (
    <Listbox id="branch-list" role="listbox" aria-label="Branches" aria-describedby="branch-list-help">
      <Text id="branch-list-help" hidden>
        {`Press Enter to open, ${MOD} Enter to open in ${newTab ? "this tab" : "a new tab"}, ${MOD} K for more actions.`}
      </Text>
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
                className="bh-row"
                aria-selected={highlighted}
                data-highlighted={highlighted ? "" : undefined}
                addonBefore={<RowStart item={item} />}
                addonAfter={
                  <Group gap="4" alignItems="center" flex="none">
                    <RowMeta item={item} flipKeys={flipKeys} />
                    {item.kind !== "typed" && (
                      <RowActions
                        item={item}
                        open={menuFor === item.id}
                        onOpenChange={(v) => onMenuFor(v ? item.id : null)}
                        actions={actions}
                        newTab={newTab}
                        handlers={handlers}
                      />
                    )}
                  </Group>
                }
                description={item.subtitle}
                onMouseMove={() => {
                  if (index !== activeIndex) onHighlight(index);
                }}
                onClick={(e) => void actions.openItem(item, e.metaKey || e.ctrlKey)}
              >
                {item.title}
              </ListboxItem>
            );
          })}
        </ListboxGroup>
      ))}
    </Listbox>
  );
}

function RowStart({ item }: { item: Item }) {
  if (item.id === "typed-name") return <IconArrowUpRightFromSquare aria-hidden="true" />;
  if (item.kind === "bookmark") {
    return (
      <Group gap="4" alignItems="center" flex="none" aria-hidden="true">
        {item.nested && <Box style={{ width: 20 }} />}
        <Box display="flex" alignItems="center" justifyContent="center" color="fg.tertiary" style={{ width: 20, height: 20 }}>
          <IconBookmarkSolid filled size={16} />
        </Box>
      </Group>
    );
  }
  return <BranchDot branchKey={item.key} />;
}

function RowMeta({ item, flipKeys }: { item: Item; flipKeys: string }) {
  if (item.lookup === "checking") return <Badge intent="neutral" variant="subtle">Checking</Badge>;
  if (item.lookup === "found") return <Badge intent="success" variant="subtle">Preview</Badge>;
  if (item.lookup === "missing") return <Badge intent="warning" variant="subtle">No preview</Badge>;
  const quiet = (text: string) => (
    <Text fontSize="sm" color="fg.tertiary" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {text}
    </Text>
  );
  // One signal per row, most important first, so the branch name keeps its width.
  const status = item.kind !== "bookmark" && (item.status?.state === "merged" || item.status?.state === "deleted");
  return (
    <Group gap="8" alignItems="center">
      {status ? (
        <StatusBadge status={item.status} />
      ) : item.unread ? (
        <Badge intent="information" variant="subtle">
          New
        </Badge>
      ) : null}
      {!!item.shared?.comments && (
        <Group gap="2" alignItems="center" color="fg.tertiary" aria-label={`${item.shared.comments} comments`}>
          <IconComment size={14} />
          {quiet(String(item.shared.comments))}
        </Group>
      )}
      {!status &&
        (item.current
          ? quiet(item.kind === "bookmark" ? "This page" : "This tab")
          : item.previous && flipKeys
            ? (
                <Tooltip content="Flip back to this branch, on the page you're on">
                  <Kbd>{flipKeys}</Kbd>
                </Tooltip>
              )
            : item.time && !item.unread && quiet(item.time))}
    </Group>
  );
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

function RowActions({
  item,
  open,
  onOpenChange,
  actions,
  newTab,
  handlers,
}: {
  item: Item;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: Actions;
  newTab: boolean;
  handlers: RowHandlers;
}) {
  const key = item.key;
  if (!key) return null;
  const page: PageRef = { key, name: item.name, route: item.route };
  const here = actions.here;
  // On a popup this narrow the menu opens over the list, so its first heading names what it acts on.
  const subject = { label: item.kind === "bookmark" ? `${item.title} · ${actions.titleOf(key)}` : item.title };
  const options: MenuOption[] = [
    { label: newTab ? "Open in this tab" : "Open in new tab", detail: `${MOD}↵`, execute: () => void actions.openItem(item, true) },
  ];
  if (item.kind === "branch" && here && here.key !== key) {
    options.push({ label: "Open the page you're on", description: routePath(here.route), execute: () => void actions.open({ ...page, route: here.route }, false) });
  }
  if (item.kind === "shared" && item.shared) {
    const s = item.shared;
    options.push({ label: s.comments ? `Comments (${s.comments})` : "Comments", execute: () => handlers.onComments(item) });
  }
  if (item.kind === "bookmark" && item.bookmark) {
    const note = item.bookmark.note;
    options.push({ label: note ? "Edit note" : "Add a note", execute: () => handlers.onNote(page, note ?? "") });
  }
  if (item.kind !== "bookmark") {
    options.push({ label: item.pinned ? "Unpin branch" : "Pin branch", execute: () => void actions.togglePin(key, item.name) });
  }
  for (const o of options) o.group = subject;
  const share: MenuOption[] = [
    { label: "Share…", group: { label: "Share", hidden: true, separator: true }, execute: () => handlers.onShare(page) },
    { label: "Copy link", group: { label: "Share", hidden: true, separator: true }, execute: () => void actions.copy(page, "url") },
    { label: "Copy as Markdown link", group: { label: "Share", hidden: true, separator: true }, execute: () => void actions.copy(page, "markdown") },
  ];
  const links: MenuOption[] = [];
  if (item.status?.pr) {
    links.push({ label: `Pull request #${item.status.pr.number}`, description: item.status.pr.title, href: pullUrl(item.status.pr.number), external: true, group: { label: "Links", hidden: true, separator: true } });
  }
  if (item.shared && isSharedIssueUrl(item.shared.url)) {
    links.push({ label: "Open on GitHub", href: item.shared.url, external: true, group: { label: "Links", hidden: true, separator: true } });
  }
  const removeGroup = { label: "Remove", hidden: true, separator: true };
  const remove: MenuOption[] =
    item.kind === "bookmark"
      ? [{ label: "Remove bookmark", intent: "danger", group: removeGroup, execute: () => void actions.toggleBookmark(page) }]
      : item.kind === "branch"
        ? [{ label: "Remove from Branch Hop", description: "Unpins it and clears its history", intent: "danger", group: removeGroup, execute: () => void actions.forget(key) }]
        : [];

  return (
    // The pin and the menu sit inside the row, so clicks (and clicks in the menu's portal) stop here.
    <Box className="bh-row-actions" data-open={open ? "" : undefined} aria-hidden="true" display="flex" alignItems="center" gap="2" onClick={stop} onPointerDown={stop}>
      {item.kind === "branch" && (
        <Tooltip content={item.pinned ? "Unpin branch" : "Pin branch"}>
          <Button
            className="bh-pin"
            data-pinned={item.pinned ? "" : undefined}
            appearance="subtle"
            size="sm"
            tabIndex={-1}
            aria-label={item.pinned ? "Unpin branch" : "Pin branch"}
            icon={<IconThumbtack filled={item.pinned} />}
            onClick={() => void actions.togglePin(key, item.name)}
          />
        </Tooltip>
      )}
      <Menu size="sm" open={open} onOpenChange={onOpenChange} options={[...options, ...share, ...links, ...remove]}>
        <Tooltip content={`More actions (${MOD}K)`}>
          <MenuTrigger asChild>
            <EllipsisMenuButton appearance="subtle" size="sm" tabIndex={-1} aria-label="More actions" />
          </MenuTrigger>
        </Tooltip>
        <MenuContent align="end" />
      </Menu>
    </Box>
  );
}
