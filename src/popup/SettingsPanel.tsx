import { Avatar, Box, Button, Group, Kbd, Separator, Switch, Text, toaster } from "@optiaxiom/react";
import { IconArrowUpRightFromSquare } from "@optiaxiom/icons";
import type { ReactNode } from "react";
import { JOIN, SHARED_REPO_NAME } from "../shared/github.ts";
import type { AuthStatus, SharedState, SharedStatus, UpdateInfo } from "../shared/messages.ts";
import { SOURCE_REPO, SOURCE_URL } from "../shared/status.ts";
import { clearRecent, setSetting } from "../shared/store";
import { ViewHeader } from "./BranchBits";
import { ago } from "./items";
import type { ExtState } from "./useExtensionState";
import { send } from "./useGitHub";

const SPACE_STATUS: Record<SharedStatus, string> = {
  ok: "Working",
  sso: "Needs single sign-on",
  "no-access": "Can't see it",
  "no-permission": "App needs Issues permission",
  "rate-limited": "Waiting for GitHub",
  offline: "Can't reach GitHub",
  "signed-out": "Signed out",
  "no-space": "Not set up",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="12">
      <Text fontWeight="500">{title}</Text>
      {children}
    </Box>
  );
}

const openTab = (url: string) => void chrome.tabs.create({ url });

export function SettingsPanel({
  ext,
  auth,
  shared,
  shortcuts,
  onSignIn,
  onDone,
}: {
  ext: ExtState;
  auth: AuthStatus;
  shared: SharedState;
  shortcuts: { open: string; flip: string };
  onSignIn: () => void;
  onDone: () => void;
}) {
  const isChromium = navigator.userAgent.includes("Chrome/");
  const canNotify = typeof chrome.notifications?.create === "function";
  const version = chrome.runtime.getManifest().version;
  const signedIn = auth.state === "signed-in";
  const s = ext.settings;
  const meta = ext.statusMeta;
  const checked = Object.keys(ext.statuses).length;

  const setStatus = async (on: boolean) => {
    await setSetting("branchStatus", on);
    void send({ type: "status-refresh", force: true }).catch(() => undefined);
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      style={{ flex: "1 1 auto", minHeight: 0 }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <ViewHeader title="Settings" onBack={onDone} />
      <Box px="16" py="16" display="flex" flexDirection="column" gap="24" overflow="auto" style={{ flex: "1 1 auto", minHeight: 0 }}>
        <Section title="GitHub">
          {signedIn ? (
            <Group justifyContent="space-between" alignItems="center" gap="8">
              <Group gap="8" alignItems="center" style={{ minWidth: 0 }}>
                <Avatar size="sm" name={auth.me.name ?? auth.me.login} src={auth.me.avatarUrl} />
                <Text truncate>@{auth.me.login}</Text>
              </Group>
              <Button
                appearance="default"
                size="sm"
                onClick={() =>
                  void send({ type: "sign-out" }).then(
                    () => toaster.create("Signed out of GitHub"),
                    () => toaster.create("Couldn't sign out. Try again.", { intent: "danger" }),
                  )
                }
              >
                Sign out
              </Button>
            </Group>
          ) : (
            <>
              <Text fontSize="sm" color="fg.secondary">
                Sign in to see branches teammates share with you, share your own, and comment on them. Everything else works without it.
              </Text>
              <Box>
                <Button appearance="primary" size="sm" onClick={onSignIn}>
                  Sign in with GitHub
                </Button>
              </Box>
            </>
          )}
          {signedIn &&
            (shared.spaces.length ? (
              shared.spaces.map((sp) => (
                <Group key={sp.owner} justifyContent="space-between" alignItems="center" gap="8">
                  <Text fontSize="sm" truncate>
                    {sp.owner}/{SHARED_REPO_NAME}
                  </Text>
                  <Text fontSize="sm" color={sp.status === "ok" ? "fg.tertiary" : "fg.warning.strong"} style={{ whiteSpace: "nowrap" }}>
                    {SPACE_STATUS[sp.status]}
                  </Text>
                </Group>
              ))
            ) : (
              <>
                <Text fontSize="sm" color="fg.secondary">
                  You're not in a shared space yet. Ask to join {JOIN.owner}'s, then accept the invite GitHub emails you.
                </Text>
                <Group gap="8">
                  <Button appearance="default" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => openTab(JOIN.requestUrl)}>
                    Request access
                  </Button>
                  <Button appearance="subtle" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => openTab(JOIN.invitesUrl)}>
                    Accept invite
                  </Button>
                </Group>
              </>
            ))}
        </Section>

        <Section title="Branch status">
          <Switch
            checked={s.branchStatus}
            onCheckedChange={(v) => void setStatus(v)}
            description={`Marks branches that are merged or deleted in ${SOURCE_REPO.owner}/${SOURCE_REPO.name}, so you can clear them out. Uses the github.com sign-in in this browser to read two pages. Read-only.`}
          >
            Show merged branches
          </Switch>
          {s.branchStatus && meta.health === "signed-out" && (
            <Group justifyContent="space-between" alignItems="center" gap="8">
              <Text fontSize="sm" color="fg.warning.strong">
                {meta.message}
              </Text>
              <Button appearance="subtle" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => openTab(SOURCE_URL)}>
                GitHub
              </Button>
            </Group>
          )}
          {s.branchStatus && meta.health === "unavailable" && (
            <Text fontSize="sm" color="fg.warning.strong">
              {meta.message}
            </Text>
          )}
          {s.branchStatus && meta.health === "ok" && (
            <Text fontSize="sm" color="fg.tertiary">
              Checked {checked} {checked === 1 ? "branch" : "branches"} {Date.now() - meta.checkedAt < 60_000 ? "just now" : `${ago(meta.checkedAt)} ago`}. Checks again every 30 minutes.
            </Text>
          )}
        </Section>

        <Section title="Opening branches">
          <Switch checked={s.newTab} onCheckedChange={(v) => void setSetting("newTab", v)} description="Otherwise branches open in this tab. Hold ⌘ (Ctrl) when you click to do the other.">
            Always open in a new tab
          </Switch>
          <Switch checked={s.tabLabels} onCheckedChange={(v) => void setSetting("tabLabels", v)} description="Puts the branch in tab titles and a coloured dot on the tab icon.">
            Branch names on tabs
          </Switch>
          <Switch checked={s.pagePill} onCheckedChange={(v) => void setSetting("pagePill", v)} description="Shows the branch at the bottom of preview pages, with a way back.">
            Branch pill on preview pages
          </Switch>
        </Section>

        <Section title="Notifications">
          {!signedIn && (
            <Text fontSize="sm" color="fg.secondary">
              Share and comment notifications need GitHub sign-in.
            </Text>
          )}
          <Switch checked={s.notifyShares} disabled={!signedIn} onCheckedChange={(v) => void setSetting("notifyShares", v)} description="When someone shares a branch with you.">
            New shares
          </Switch>
          <Switch
            checked={s.notifyComments}
            disabled={!signedIn}
            onCheckedChange={(v) => void setSetting("notifyComments", v)}
            description="On branches you shared, were shared or commented on, or pinned."
          >
            New comments
          </Switch>
          {canNotify && (
            <Switch checked={s.desktopAlerts} disabled={!signedIn} onCheckedChange={(v) => void setSetting("desktopAlerts", v)} description="Otherwise only the count on the toolbar icon changes.">
              Desktop notifications
            </Switch>
          )}
        </Section>

        <Section title="Keyboard shortcuts">
          {[
            ["Open Branch Hop", shortcuts.open],
            ["Flip back to the last branch", shortcuts.flip],
          ].map(([label, keys]) => (
            <Group key={label} justifyContent="space-between" alignItems="center">
              <Text fontSize="sm">{label}</Text>
              {keys ? (
                <Kbd>{keys}</Kbd>
              ) : (
                <Text fontSize="sm" color="fg.tertiary">
                  Not set
                </Text>
              )}
            </Group>
          ))}
          {isChromium && (
            <Box>
              <Button appearance="default" size="sm" onClick={() => openTab("chrome://extensions/shortcuts")}>
                Change shortcuts
              </Button>
            </Box>
          )}
        </Section>

        <Separator />

        <Box display="flex" flexDirection="column" gap="12">
          <Text fontSize="sm" color="fg.tertiary">
            Branch Hop {version}. Pins and bookmarks follow your browser profile; history stays on this computer.
          </Text>
          <Group gap="8">
            <Button
              appearance="default"
              size="sm"
              onClick={() =>
                void send<UpdateInfo | null>({ type: "check-update" }).then(
                  (info) => toaster.create(info ? `Branch Hop ${info.latest} is ready. The notice is on the main screen.` : "You have the newest version."),
                  () => toaster.create("Couldn't check for updates", { intent: "danger" }),
                )
              }
            >
              Check for updates
            </Button>
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
      </Box>
    </Box>
  );
}
