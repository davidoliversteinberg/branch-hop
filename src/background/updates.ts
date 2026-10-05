import { cleanUpdate, isNewer, type UpdateInfo } from "../shared/messages.ts";
import { updateBadge } from "./shared.ts";

/**
 * Updates for folder-loaded installs. Browsers only auto-update store installs, so Branch Hop:
 * 1. checks the public GitHub releases for a newer version (no sign-in needed), and
 * 2. reloads itself when the files in its folder have been replaced with a newer version,
 *    so updating never needs a trip to chrome://extensions.
 */
export const UPDATE_ALARM = "update-check";
export const UPDATE_NOTICE = "branch-hop-update";
const LATEST = "https://api.github.com/repos/davidoliversteinberg/branch-hop/releases/latest";
const RELEASES = "https://github.com/davidoliversteinberg/branch-hop/releases/";
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

const running = () => chrome.runtime.getManifest().version;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = running();
  let info: UpdateInfo | null = null;
  try {
    const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
      const latest = typeof data.tag_name === "string" ? data.tag_name.replace(/^v/, "") : "";
      const url = typeof data.html_url === "string" && data.html_url.startsWith(RELEASES) ? data.html_url : `${RELEASES}latest`;
      if (VERSION_RE.test(latest) && !data.draft && !data.prerelease && isNewer(latest, current)) {
        info = cleanUpdate({ latest, current, url, checkedAt: Date.now() });
      }
    }
  } catch {
    // Offline: try again at the next check.
  }
  if (info) {
    await chrome.storage.local.set({ update: info });
    await announce(info);
  } else await chrome.storage.local.remove("update");
  await updateBadge();
  return info;
}

/** One desktop notification per new version, so nobody has to notice the arrow on the icon. */
async function announce(info: UpdateInfo): Promise<void> {
  if (!chrome.notifications?.create) return; // Safari: the arrow on the toolbar icon is the alert
  const { updateAnnounced } = await chrome.storage.local.get("updateAnnounced");
  if (updateAnnounced === info.latest) return;
  await chrome.storage.local.set({ updateAnnounced: info.latest });
  chrome.notifications.create(UPDATE_NOTICE, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: `Branch Hop ${info.latest} is ready`,
    message: "Click to see what's new and how to update. It takes one Terminal command.",
  });
}

/** Opens the popup, where the update notice has the command; falls back to the release page. */
export async function onUpdateNoticeClick(): Promise<void> {
  chrome.notifications?.clear(UPDATE_NOTICE);
  const action = chrome.action as typeof chrome.action & { openPopup?: () => Promise<void> };
  try {
    if (typeof action.openPopup === "function") {
      await action.openPopup();
      return;
    }
  } catch {
    // No focused browser window; the release page explains the update too.
  }
  const info = cleanUpdate((await chrome.storage.local.get("update")).update);
  await chrome.tabs.create({ url: info?.url ?? `${RELEASES}latest` });
}

/** Folder installs: if the manifest on disk is newer than the one running, the folder was updated. */
export async function reloadIfFolderUpdated(): Promise<boolean> {
  try {
    const res = await fetch(`${chrome.runtime.getURL("manifest.json")}?t=${Date.now()}`, { cache: "no-store" });
    const onDisk = (await res.json()) as { version?: unknown };
    if (typeof onDisk.version === "string" && VERSION_RE.test(onDisk.version) && isNewer(onDisk.version, running())) {
      chrome.runtime.reload();
      return true;
    }
  } catch {
    // Store installs and Safari read their own packaged files; nothing to do.
  }
  return false;
}

export function readUpdate(raw: unknown): UpdateInfo | null {
  const info = cleanUpdate(raw);
  return info && isNewer(info.latest, running()) ? info : null;
}
