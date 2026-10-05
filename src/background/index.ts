import { flipTab } from "../shared/nav";
import { cleanRequest, type Request, type Result } from "../shared/messages.ts";
import { parsePreviewUrl } from "../shared/preview";
import { clearTabState, getNames, getTabState, recordVisit, setTabState } from "../shared/store";
import { POLL_ALARM, cancelSignIn, getStatus, isSignedIn, pollOnce, signOut, startSignIn, whenSignedIn } from "./auth.ts";
import { GhError } from "./gh.ts";
import { SYNC_ALARM, addComment, listComments, markRead, onNoticeClick, share, sync, unshare, updateBadge } from "./shared.ts";
import { STATUS_ALARM, refreshStatuses } from "./status.ts";
import { UPDATE_ALARM, UPDATE_NOTICE, checkForUpdate, onUpdateNoticeClick, reloadIfFolderUpdated } from "./updates.ts";

const FOLDER_ALARM = "folder-check";

const SYNC_MINUTES = 2;

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

/* Shared lists stay fresh in the background while you're signed in. */
async function startSyncing(): Promise<void> {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
  await sync();
}

whenSignedIn(() => void startSyncing());

async function resume(): Promise<void> {
  if (await reloadIfFolderUpdated()) return;
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 360 });
  await chrome.alarms.create(FOLDER_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(STATUS_ALARM, { periodInMinutes: 30 });
  if (await isSignedIn()) await startSyncing();
  await checkForUpdate();
  await updateBadge();
}
chrome.runtime.onStartup.addListener(() => void resume());
chrome.runtime.onInstalled.addListener(() => void resume());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollOnce();
  if (alarm.name === SYNC_ALARM) void sync();
  if (alarm.name === UPDATE_ALARM) void checkForUpdate();
  if (alarm.name === FOLDER_ALARM) void reloadIfFolderUpdated();
  if (alarm.name === STATUS_ALARM) void refreshStatuses();
});

chrome.notifications?.onClicked.addListener((id) => void (id === UPDATE_NOTICE ? onUpdateNoticeClick() : onNoticeClick(id)));
chrome.notifications?.onButtonClicked.addListener((id, button) => void onNoticeClick(id, button));

async function endSession(message?: string): Promise<void> {
  await signOut(message);
  await chrome.alarms.clear(SYNC_ALARM);
  await updateBadge();
}

/* Requests from the popup */
async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case "auth-status":
      return getStatus();
    case "auth-start":
      return startSignIn();
    case "auth-cancel":
      return cancelSignIn();
    case "sign-out":
      return endSession();
    case "sync":
      return sync();
    case "check-update":
      return (await reloadIfFolderUpdated()) ? null : checkForUpdate();
    case "status-refresh":
      return refreshStatuses(req.force);
    case "share":
      return share(req);
    case "unshare":
      return unshare(req.space, req.issue);
    case "comments":
      return listComments(req.space, req.issue);
    case "comment":
      return addComment(req.space, req.issue, req.body);
    case "mark-read":
      return markRead(req.ids);
  }
}

const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  // The popup: GitHub requests, validated against a fixed list.
  if (fromExtensionPage(sender)) {
    const req = cleanRequest(message);
    if (!req) {
      sendResponse({ ok: false, error: "Branch Hop didn't understand that request." } satisfies Result<never>);
      return false;
    }
    handle(req).then(
      (data) => sendResponse({ ok: true, data: data ?? null } satisfies Result<unknown>),
      (err: unknown) => {
        const e = err instanceof GhError ? err : null;
        if (e?.code === "signed-out") void endSession(e.message);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : "Something went wrong.", code: e?.code } satisfies Result<never>);
      },
    );
    return true;
  }

  // The page pill: only this extension's own script on an Axiom Play preview may ask.
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
