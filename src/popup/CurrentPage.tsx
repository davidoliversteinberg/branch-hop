import { type FormEvent, useState } from "react";
import { AngleMenuButton, Box, Button, Field, Group, Input, Menu, MenuContent, MenuTrigger, Text, Tooltip } from "@optiaxiom/react";
import { IconBookmarkSolid, IconGear, IconShareNodes } from "@optiaxiom/icons";
import { NOTE_MAX, findFavorite } from "../shared/store";
import { BranchDot, StatusBadge, statusText } from "./BranchBits";
import type { Actions, PageRef } from "./useActions";
import type { ExtState } from "./useExtensionState";

/**
 * Where you are, and everything you can do with this page. Actions for the page live here and
 * nowhere else, so they can't be mistaken for actions on a row in the list.
 */
export function CurrentPage({
  ext,
  actions,
  signedIn,
  onSettings,
  onSignIn,
  onShare,
}: {
  ext: ExtState;
  actions: Actions;
  signedIn: boolean;
  onSettings: () => void;
  onSignIn: () => void;
  onShare: (page: PageRef) => void;
}) {
  const here = actions.here;
  const [editing, setEditing] = useState<string | null>(null);
  const page: PageRef | null = here && { key: here.key, name: actions.nameOf(here.key), route: here.route };
  const bookmark = here ? findFavorite(ext.favorites, here.key, here.route) : undefined;
  const status = here ? ext.statuses[here.key] : undefined;

  async function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!page || editing === null) return;
    await actions.saveNote(page, editing);
    setEditing(null);
  }

  return (
    <Box px="16" pt="12" pb="16" borderB="1" borderColor="border.secondary" display="flex" flexDirection="column" gap="12">
      <Group justifyContent="space-between" alignItems="start" gap="8">
        <Box display="flex" flexDirection="column" gap="4" style={{ minWidth: 0, flex: 1 }}>
          <Text fontSize="sm" color="fg.secondary">
            {here ? "This page" : "This tab"}
          </Text>
          {here ? (
            <>
              <Group gap="4" alignItems="center" style={{ marginLeft: -6 }}>
                <BranchDot branchKey={here.key} />
                <Text fontSize="lg" fontWeight="500" truncate title={actions.titleOf(here.key)}>
                  {actions.titleOf(here.key)}
                </Text>
                <StatusBadge status={status} />
              </Group>
              <Text fontSize="sm" fontFamily="mono" color="fg.secondary" truncate title={here.route}>
                {here.route}
              </Text>
              {bookmark?.note && editing === null && <Text fontSize="sm">{bookmark.note}</Text>}
              {statusText(status) && (
                <Text fontSize="sm" color="fg.secondary">
                  {statusText(status)}
                </Text>
              )}
            </>
          ) : (
            <>
              <Text fontSize="lg" fontWeight="500">
                Not an Axiom Play preview
              </Text>
              <Text fontSize="sm" color="fg.secondary">
                Branches you pick open in a new tab.
              </Text>
            </>
          )}
        </Box>
        <Group gap="4" alignItems="center" flex="none">
          {!signedIn && (
            <Tooltip content="Sign in with GitHub to share branches and see what teammates share">
              <Button appearance="subtle" size="sm" onClick={onSignIn}>
                Sign in
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Settings">
            <Button appearance="subtle" size="sm" aria-label="Settings" icon={<IconGear />} onClick={onSettings} />
          </Tooltip>
        </Group>
      </Group>

      {page && editing === null && (
        <Group gap="8" alignItems="center" flexWrap="wrap">
          {bookmark ? (
            <Menu
              size="sm"
              options={[
                { label: bookmark.note ? "Edit note" : "Add a note", group: { label: "This page's bookmark" }, execute: () => setEditing(bookmark.note ?? "") },
                { label: "Remove bookmark", intent: "danger", group: { label: "This page's bookmark" }, execute: () => void actions.toggleBookmark(page) },
              ]}
            >
              <MenuTrigger asChild>
                <AngleMenuButton appearance="default" size="sm" addonBefore={<IconBookmarkSolid filled />}>
                  Bookmarked
                </AngleMenuButton>
              </MenuTrigger>
              <MenuContent />
            </Menu>
          ) : (
            <Tooltip content="Keep this exact page in Pinned, under its branch">
              <Button appearance="default" size="sm" icon={<IconBookmarkSolid filled />} onClick={() => void actions.toggleBookmark(page)}>
                Bookmark page
              </Button>
            </Tooltip>
          )}
          <Button appearance="default" size="sm" icon={<IconShareNodes filled />} onClick={() => onShare(page)}>
            Share
          </Button>
          <Menu
            size="sm"
            options={[
              { label: "Copy link", group: { label: "Copy a link to this page" }, execute: () => void actions.copy(page, "url") },
              { label: "Copy as Markdown link", description: "For Slack, Jira and GitHub", group: { label: "Copy a link to this page" }, execute: () => void actions.copy(page, "markdown") },
            ]}
          >
            <MenuTrigger asChild>
              <AngleMenuButton appearance="default" size="sm">
                Copy
              </AngleMenuButton>
            </MenuTrigger>
            <MenuContent />
          </Menu>
        </Group>
      )}

      {page && editing !== null && (
        <Box asChild display="flex" flexDirection="column" gap="8">
          <form onSubmit={(e) => void submitNote(e)}>
            <Field label="Note for this page">
              <Input
                autoFocus
                value={editing}
                maxLength={NOTE_MAX}
                placeholder="What's this page for?"
                onChange={(e) => setEditing(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(null);
                  }
                }}
              />
            </Field>
            <Group gap="8" justifyContent="end">
              <Button appearance="subtle" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button appearance="primary" size="sm" type="submit">
                Save note
              </Button>
            </Group>
          </form>
        </Box>
      )}
    </Box>
  );
}
