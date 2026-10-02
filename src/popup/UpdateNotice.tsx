import { useEffect, useState } from "react";
import { Box, Button, Group, Text, toaster } from "@optiaxiom/react";
import { IconArrowUpRightFromSquare, IconCopy } from "@optiaxiom/icons";
import { cleanUpdate, isNewer, type UpdateInfo } from "../shared/messages.ts";
import { send } from "./useGitHub";

/** One command that downloads the newest release into the same folder. Branch Hop then reloads itself. */
export const UPDATE_COMMAND = "curl -fsSL https://raw.githubusercontent.com/davidoliversteinberg/branch-hop/main/scripts/install.sh | bash";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const isSafari = !navigator.userAgent.includes("Chrome/");
  const fromStore = "update_url" in chrome.runtime.getManifest();

  useEffect(() => {
    const load = async () => {
      const info = cleanUpdate((await chrome.storage.local.get("update")).update);
      setUpdate(info && isNewer(info.latest, chrome.runtime.getManifest().version) ? info : null);
    };
    void load();
    // Also notices a folder that was already updated, and reloads into it.
    void send({ type: "check-update" }).catch(() => undefined);
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && "update" in changes) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  if (!update || fromStore) return null;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      toaster.create("Copied. Paste it into Terminal and press Return.", { intent: "success" });
    } catch {
      toaster.create("Your browser blocked copying. Select the command and copy it.", { intent: "danger" });
    }
  };

  return (
    <Box mx="16" mt="12" px="12" py="8" rounded="md" bg="bg.information.subtle" display="flex" flexDirection="column" gap="8">
      <Group justifyContent="space-between" alignItems="center" gap="8">
        <Text fontSize="sm" fontWeight="500">
          Branch Hop {update.latest} is ready
        </Text>
        <Button appearance="subtle" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Update"}
        </Button>
      </Group>
      {open &&
        (isSafari ? (
          <>
            <Text fontSize="sm" color="fg.secondary">
              Safari updates come with a new build of the Branch Hop app. Get it from the release page.
            </Text>
            <Box>
              <Button appearance="default" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => void chrome.tabs.create({ url: update.url })}>
                Release page
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Text fontSize="sm" color="fg.secondary">
              Copy this command, paste it into Terminal and press Return. Branch Hop reloads itself within a minute. Your favorites and sign-in stay.
            </Text>
            <Text fontSize="sm" fontFamily="mono" style={{ overflowWrap: "anywhere", userSelect: "all" }}>
              {UPDATE_COMMAND}
            </Text>
            <Group gap="8">
              <Button appearance="primary" size="sm" icon={<IconCopy />} onClick={() => void copyCommand()}>
                Copy command
              </Button>
              <Button appearance="subtle" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => void chrome.tabs.create({ url: update.url })}>
                What's new
              </Button>
            </Group>
          </>
        ))}
    </Box>
  );
}
