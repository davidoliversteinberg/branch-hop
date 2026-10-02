import { flipTab } from "../shared/nav";
import { parsePreviewUrl } from "../shared/preview";
import { clearTabState, getNames, getTabState, recordVisit, setTabState } from "../shared/store";

/* Remember each tab's branch so "flip back" knows where it came from. */
async function onTabUrl(tabId: number, url: string): Promise<void> {
  const loc = parsePreviewUrl(url);
  if (!loc) return;
  const prev = await getTabState(tabId);
  const prevKey = prev && prev.key !== loc.key ? prev.key : prev?.prevKey;
  await setTabState(tabId, { key: loc.key, route: loc.route, prevKey });
  await recordVisit({ key: loc.key, route: loc.route, at: Date.now() });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void onTabUrl(tabId, changeInfo.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "flip-branch") return;
  void (async () => {
    const target = tab?.id != null ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (target?.id != null) await flipTab(target.id);
  })();
});

/* Requests from the page pill. Only this extension's script on an Axiom Play preview may ask. */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const tabId = sender.tab?.id;
  const fromPreview = typeof sender.url === "string" && parsePreviewUrl(sender.url) !== null;
  if (tabId == null || !fromPreview || !message || typeof message !== "object") return false;

  const type = (message as { type?: unknown }).type;
  if (type === "tab-info") {
    void Promise.all([getTabState(tabId), getNames()]).then(
      ([state, names]) => sendResponse({ prevKey: state?.prevKey ?? null, prevName: state?.prevKey ? (names[state.prevKey] ?? null) : null }),
      () => sendResponse({ prevKey: null, prevName: null }),
    );
    return true;
  }
  if (type === "flip") {
    void flipTab(tabId).then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (type === "open-popup") {
    const action = chrome.action as typeof chrome.action & { openPopup?: () => Promise<void> };
    if (typeof action.openPopup !== "function") {
      sendResponse({ ok: false });
      return false;
    }
    action.openPopup().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return false;
});
