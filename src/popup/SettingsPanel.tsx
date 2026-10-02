import { Avatar, Box, Button, Group, Kbd, Separator, Switch, Text, toaster } from "@optiaxiom/react";
import type { AuthStatus } from "../shared/messages.ts";
import { clearRecent, setSetting } from "../shared/store";
import type { ExtState } from "./useExtensionState";
import { send } from "./useGitHub";

export function SettingsPanel({
  ext,
  auth,
  shortcuts,
  onSignIn,
  onDone,
}: {
  ext: ExtState;
  auth: AuthStatus;
  shortcuts: { open: string; flip: string };
  onSignIn: () => void;
  onDone: () => void;
}) {
  const isChromium = navigator.userAgent.includes("Chrome/");
  const canNotify = typeof chrome.notifications?.create === "function";
  const version = chrome.runtime.getManifest().version;
  const signedIn = auth.state === "signed-in";
  const s = ext.settings;

  return (
    <Box px="16" py="12" display="flex" flexDirection="column" gap="16" overflow="auto" style={{ flex: "1 1 auto", minHeight: 0 }}>
      <Group justifyContent="space-between" alignItems="center">
        <Text fontWeight="500">Settings</Text>
        <Button appearance="subtle" size="sm" onClick={onDone}>
          Done
        </Button>
      </Group>

      <Box display="flex" flexDirection="column" gap="8">
        <Text fontSize="sm" fontWeight="500">
          GitHub
        </Text>
        {signedIn ? (
          <Group justifyContent="space-between" alignItems="center" gap="8">
            <Group gap="8" alignItems="center">
              <Avatar size="sm" name={auth.me.name ?? auth.me.login} src={auth.me.avatarUrl} />
              <Text fontSize="sm">Signed in as @{auth.me.login}</Text>
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
          <Group justifyContent="space-between" alignItems="center" gap="8">
            <Text fontSize="sm" color="fg.secondary">
              Sign in to share branches and get comments.
            </Text>
            <Button appearance="default" size="sm" onClick={onSignIn}>
              Sign in
            </Button>
          </Group>
        )}
      </Box>

      <Box display="flex" flexDirection="column" gap="12">
        <Text fontSize="sm" fontWeight="500">
          Notifications
        </Text>
        <Switch checked={s.notifyShares} disabled={!signedIn} onCheckedChange={(v) => void setSetting("notifyShares", v)} description="When someone shares a branch with you.">
          New shares
        </Switch>
        <Switch
          checked={s.notifyComments}
          disabled={!signedIn}
          onCheckedChange={(v) => void setSetting("notifyComments", v)}
          description="On branches shared with you, ones you shared or commented on, and your favorites. Mute a branch from its comments."
        >
          New comments
        </Switch>
        {canNotify && (
          <Switch checked={s.desktopAlerts} disabled={!signedIn} onCheckedChange={(v) => void setSetting("desktopAlerts", v)} description="Otherwise only the count on the toolbar icon changes.">
            Desktop notifications
          </Switch>
        )}
        <Text fontSize="sm" color="fg.tertiary">
          Alerts when a branch gets new commits or a build finishes need Branch Hop to read axiom-play. That takes one approval from an episerver owner.
        </Text>
      </Box>

      <Separator />

      <Box display="flex" flexDirection="column" gap="12">
        <Text fontSize="sm" fontWeight="500">
          Tabs and pages
        </Text>
        <Switch checked={s.keepRoute} onCheckedChange={(v) => void setSetting("keepRoute", v)} description="Open the same page on the branch you pick.">
          Keep the route when switching
        </Switch>
        <Switch checked={s.tabLabels} onCheckedChange={(v) => void setSetting("tabLabels", v)} description="Puts the branch in tab titles and a coloured dot on the tab icon.">
          Branch names on tabs
        </Switch>
        <Switch checked={s.pagePill} onCheckedChange={(v) => void setSetting("pagePill", v)} description="Shows the branch at the bottom of preview pages, with a way back.">
          Branch pill on preview pages
        </Switch>
      </Box>

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
