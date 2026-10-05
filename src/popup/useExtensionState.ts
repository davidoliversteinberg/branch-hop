import { useCallback, useEffect, useState } from "react";
import { parsePreviewUrl, type PreviewLocation } from "../shared/preview";
import { cleanStatusMap, cleanStatusMeta, type BranchStatus, type StatusMeta } from "../shared/status.ts";
import {
  DEFAULT_SETTINGS,
  getFavorites,
  getMuted,
  getNames,
  getPins,
  getRecent,
  getSettings,
  getTabState,
  type Favorite,
  type Pin,
  type Settings,
  type Visit,
} from "../shared/store";

export type ActiveTab = { tab: chrome.tabs.Tab; loc: PreviewLocation | null };

export type ExtState = {
  ready: boolean;
  active: ActiveTab | null;
  prevKey: string | null;
  settings: Settings;
  favorites: Favorite[];
  pins: Pin[];
  recent: Visit[];
  names: Record<string, string>;
  muted: string[];
  statuses: Record<string, BranchStatus>;
  statusMeta: StatusMeta;
};

const EMPTY: ExtState = {
  ready: false,
  active: null,
  prevKey: null,
  settings: DEFAULT_SETTINGS,
  favorites: [],
  pins: [],
  recent: [],
  names: {},
  muted: [],
  statuses: {},
  statusMeta: { health: "off", checkedAt: 0 },
};

/** Everything the popup shows, kept in step with storage. */
export function useExtensionState(): ExtState {
  const [state, setState] = useState<ExtState>(EMPTY);

  const load = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const loc = tab?.url ? parsePreviewUrl(tab.url) : null;
    const [settings, favorites, pins, recent, names, muted, status, tabState] = await Promise.all([
      getSettings(),
      getFavorites(),
      getPins(),
      getRecent(),
      getNames(),
      getMuted(),
      chrome.storage.local.get(["status:branches", "status:meta"]),
      tab?.id != null ? getTabState(tab.id) : Promise.resolve(null),
    ]);
    setState({
      ready: true,
      active: tab ? { tab, loc } : null,
      prevKey: tabState?.prevKey ?? null,
      settings,
      favorites,
      pins,
      recent,
      names,
      muted,
      // Statuses only show while the setting is on, even if an old check is still stored.
      statuses: settings.branchStatus ? cleanStatusMap(status["status:branches"]) : {},
      statusMeta: cleanStatusMeta(status["status:meta"]),
    });
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  return state;
}

/** The shortcuts as the browser has them, which may differ from the defaults. */
export function useShortcuts(): { open: string; flip: string } {
  const [shortcuts, setShortcuts] = useState({ open: "", flip: "" });
  useEffect(() => {
    chrome.commands
      ?.getAll?.()
      .then((commands) =>
        setShortcuts({
          open: commands.find((c) => c.name === "_execute_action")?.shortcut ?? "",
          flip: commands.find((c) => c.name === "flip-branch")?.shortcut ?? "",
        }),
      )
      .catch(() => undefined);
  }, []);
  return shortcuts;
}
