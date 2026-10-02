import { hostForKey, parsePreviewUrl, previewUrl } from "./preview.ts";
import { getTabState } from "./store.ts";

export type PreviewStatus = "found" | "missing" | "error";

/** Opens a branch preview. Only URLs built by previewUrl() are ever opened. */
export async function openPreview(
  target: { key: string; route: string },
  where: { tab?: chrome.tabs.Tab; newTab: boolean },
): Promise<void> {
  const url = previewUrl(target.key, target.route);
  if (!where.newTab && where.tab?.id != null) {
    await chrome.tabs.update(where.tab.id, { url });
    return;
  }
  await chrome.tabs.create({
    url,
    index: where.tab ? where.tab.index + 1 : undefined,
    openerTabId: where.tab?.id,
    windowId: where.tab?.windowId,
  });
}

/** Sends the tab back to the branch it showed before, on the route it shows now. */
export async function flipTab(tabId: number): Promise<boolean> {
  const state = await getTabState(tabId);
  if (!state?.prevKey) return false;
  const tab = await chrome.tabs.get(tabId);
  const here = tab.url ? parsePreviewUrl(tab.url) : null;
  await chrome.tabs.update(tabId, { url: previewUrl(state.prevKey, here?.route ?? state.route) });
  return true;
}

/**
 * Checks whether Vercel has a preview for a branch with one header-only request.
 * Protected previews answer 401, which still means the preview exists.
 */
export async function checkPreview(key: string): Promise<PreviewStatus> {
  try {
    const res = await fetch(`https://${hostForKey(key)}/`, {
      method: "HEAD",
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status === 404 && res.headers.get("x-vercel-error") === "DEPLOYMENT_NOT_FOUND") return "missing";
    return "found";
  } catch {
    return "error";
  }
}
