import { useCallback, useEffect, useRef, useState } from "react";
import { GITHUB_ORIGINS } from "../shared/github.ts";
import {
  EMPTY_SHARED,
  cleanAuthStatus,
  cleanSharedState,
  cleanUnread,
  type AuthStatus,
  type Request,
  type Result,
  type SharedState,
  type Unread,
} from "../shared/messages.ts";

/** Asks the background worker to do something. Tokens stay there; the popup only gets results. */
export async function send<T = unknown>(req: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Result<T> | undefined;
  if (!res) throw new Error("Branch Hop's background worker didn't answer. Try again.");
  if (!res.ok) throw Object.assign(new Error(res.error), { code: res.code });
  return res.data;
}

export type GitHubState = { ready: boolean; auth: AuthStatus; shared: SharedState; unread: Unread; syncing: boolean };

export function useGitHub() {
  const [state, setState] = useState<GitHubState>({ ready: false, auth: { state: "signed-out" }, shared: EMPTY_SHARED, unread: {}, syncing: false });
  const started = useRef(false);

  const load = useCallback(async () => {
    const sessionArea = chrome.storage.session ?? chrome.storage.local;
    const [s, l] = await Promise.all([sessionArea.get("gh:auth"), chrome.storage.local.get(["gh:shared", "gh:unread"])]);
    setState((prev) => ({ ...prev, ready: true, auth: cleanAuthStatus(s["gh:auth"]), shared: cleanSharedState(l["gh:shared"]), unread: cleanUnread(l["gh:unread"]) }));
  }, []);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, syncing: true }));
    try {
      await send({ type: "sync" });
    } finally {
      setState((prev) => ({ ...prev, syncing: false }));
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // Asking first lets the worker restore your sign-in after a browser restart.
      const auth = await send<AuthStatus>({ type: "auth-status" }).catch(() => null);
      await load();
      if (auth?.state === "signed-in") await refresh().catch(() => undefined);
    })();
  }, [load, refresh]);

  useEffect(() => {
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

    const signIn = useCallback(async () => {
    // Chrome grants these at install. Safari lets people turn site access off, so ask again there.
    if (chrome.permissions?.contains && !(await chrome.permissions.contains({ origins: GITHUB_ORIGINS }))) {
      const granted = await chrome.permissions.request({ origins: GITHUB_ORIGINS });
      if (!granted) throw new Error("Branch Hop needs to reach github.com to sign you in.");
    }
    await send({ type: "auth-start" });
  }, []);

  return { ...state, refresh, signIn };
}
