import { useCallback, useEffect, useState } from "react";
import { parsePreviewUrl, type PreviewLocation } from "../shared/preview";
import {
  DEFAULT_SETTINGS,
  getFavorites,
  getNames,
  getRecent,
  getSettings,
  getTabState,
  type Favorite,
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
  recent: Visit[];
  names: Record<string, string>;
};

const EMPTY: ExtState = { ready: false, active: null, prevKey: null, settings: DEFAULT_SETTINGS, favorites: [], recent: [], names: {} };

/** Everything the popup shows, kept in step with storage. */
export function useExtensionState(): ExtState {
  const [state, setState] = useState<ExtState>(EMPTY);

  const load = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const loc = tab?.url ? parsePreviewUrl(tab.url) : null;
    const [settings, favorites, recent, names, tabState] = await Promise.all([
      getSettings(),
      getFavorites(),
      getRecent(),
      getNames(),
      tab?.id != null ? getTabState(tab.id) : Promise.resolve(null),
    ]);
    setState({ ready: true, active: tab ? { tab, loc } : null, prevKey: tabState?.prevKey ?? null, settings, favorites, recent, names });
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
