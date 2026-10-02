import { GITHUB, parsePerson, type Person } from "../shared/github.ts";
import { cleanPerson, type AuthStatus } from "../shared/messages.ts";

/**
 * GitHub sign-in with the device flow: GitHub shows a code, you approve it on github.com,
 * and the extension never sees your password.
 *
 * Where things live
 * - session storage (trusted extension pages only, cleared when the browser closes):
 *   the 8-hour access token, the pending device code, and the public sign-in status
 * - the extension's own IndexedDB (unreachable from page scripts): the refresh token,
 *   so you stay signed in across restarts
 */
const session: chrome.storage.StorageArea = chrome.storage.session ?? chrome.storage.local;
const ACCESS = "auth:access";
const DEVICE = "auth:device";
const STATUS = "gh:auth";
const ME = "gh:me";
const DEVICE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const VERIFY_URL = "https://github.com/login/device";
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
const USER_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const POLL_ALARM = "auth-poll";

type Device = { deviceCode: string; userCode: string; expiresAt: number; interval: number };
type Token = { token: string; expiresAt: number };

/* Refresh token storage */
function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("branch-hop", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("secrets");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("secrets", mode);
      const req = run(tx.objectStore("secrets"));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result as T);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
const getRefresh = () => idb<Token | undefined>("readonly", (s) => s.get("refresh"));
const setRefresh = (t: Token) => idb<void>("readwrite", (s) => s.put(t, "refresh"));
const clearRefresh = () => idb<void>("readwrite", (s) => s.delete("refresh"));

async function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    credentials: "omit",
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

async function setStatus(status: AuthStatus): Promise<void> {
  await session.set({ [STATUS]: status });
}

async function saveTokens(data: Record<string, unknown>): Promise<string> {
  const token = data.access_token;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) throw new Error("GitHub sent back an unexpected token.");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 8 * 3600;
  await session.set({ [ACCESS]: { token, expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000 } satisfies Token });
  const refresh = data.refresh_token;
  if (typeof refresh === "string" && TOKEN_RE.test(refresh)) {
    const refreshIn = typeof data.refresh_token_expires_in === "number" ? data.refresh_token_expires_in : 180 * 86400;
    await setRefresh({ token: refresh, expiresAt: Date.now() + Math.max(60, refreshIn - 300) * 1000 });
  }
  return token;
}

export async function loadMe(token?: string): Promise<Person | null> {
  const access = token ?? (await getAccessToken());
  if (!access) return null;
  const res = await fetch(`${GITHUB.api}/user`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    credentials: "omit",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const me = parsePerson(await res.json());
  if (me) await chrome.storage.local.set({ [ME]: me });
  return me;
}

export async function getStatus(): Promise<AuthStatus> {
  const stored = (await session.get(STATUS))[STATUS] as AuthStatus | undefined;
  if (stored) return stored;
  // After a browser restart session storage is empty; a saved refresh token means you're still signed in.
  const [refresh, local] = await Promise.all([getRefresh().catch(() => undefined), chrome.storage.local.get(ME)]);
  const me = cleanPerson(local[ME]);
  const status: AuthStatus = refresh && refresh.expiresAt > Date.now() && me ? { state: "signed-in", me } : { state: "signed-out" };
  await setStatus(status);
  return status;
}

export async function isSignedIn(): Promise<boolean> {
  return (await getStatus()).state === "signed-in";
}

/* Device flow */
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let polling: Promise<void> | null = null;
let onSignedIn: (() => void) | undefined;

export function whenSignedIn(callback: () => void): void {
  onSignedIn = callback;
}

export async function startSignIn(): Promise<AuthStatus> {
  const data = await postForm(DEVICE_URL, { client_id: GITHUB.clientId });
  const deviceCode = typeof data.device_code === "string" && TOKEN_RE.test(data.device_code) ? data.device_code : null;
  const userCode = typeof data.user_code === "string" && USER_CODE_RE.test(data.user_code) ? data.user_code : null;
  if (!deviceCode || !userCode || data.verification_uri !== VERIFY_URL) {
    throw new Error(data.error === "device_flow_disabled" ? "Device Flow is turned off for the Branch Hop GitHub App." : "GitHub didn't start sign-in. Try again.");
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 900;
  const interval = typeof data.interval === "number" ? Math.max(5, data.interval) : 5;
  const device: Device = { deviceCode, userCode, expiresAt: Date.now() + expiresIn * 1000, interval };
  await session.set({ [DEVICE]: device });
  const status: AuthStatus = { state: "pending", userCode, verificationUri: VERIFY_URL, expiresAt: device.expiresAt };
  await setStatus(status);
  schedulePoll(interval);
  // Wakes the worker to keep checking if the browser stops it while you're on github.com.
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  return status;
}

function schedulePoll(seconds: number): void {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void pollOnce(), seconds * 1000);
}

async function endSignIn(message: string): Promise<void> {
  clearTimeout(pollTimer);
  await chrome.alarms.clear(POLL_ALARM);
  await session.remove(DEVICE);
  await setStatus({ state: "signed-out", message });
}

export function pollOnce(): Promise<void> {
  polling ??= pollStep().finally(() => {
    polling = null;
  });
  return polling;
}

async function pollStep(): Promise<void> {
  const device = (await session.get(DEVICE))[DEVICE] as Device | undefined;
  if (!device) {
    await chrome.alarms.clear(POLL_ALARM);
    return;
  }
  if (Date.now() > device.expiresAt) return endSignIn("The sign-in code expired. Start again.");

  let data: Record<string, unknown>;
  try {
    data = await postForm(TOKEN_URL, { client_id: GITHUB.clientId, device_code: device.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  } catch {
    schedulePoll(device.interval);
    return;
  }

  if (typeof data.access_token === "string") {
    const token = await saveTokens(data);
    clearTimeout(pollTimer);
    await chrome.alarms.clear(POLL_ALARM);
    await session.remove(DEVICE);
    const me = await loadMe(token);
    if (!me) return endSignIn("Signed in, but GitHub didn't return your profile. Try again.");
    await setStatus({ state: "signed-in", me });
    onSignedIn?.();
    return;
  }
  switch (data.error) {
    case "authorization_pending":
      schedulePoll(device.interval);
      return;
    case "slow_down":
      device.interval += 5;
      await session.set({ [DEVICE]: device });
      schedulePoll(device.interval);
      return;
    case "expired_token":
      return endSignIn("The sign-in code expired. Start again.");
    case "access_denied":
      return endSignIn("Sign-in was cancelled on GitHub.");
    default:
      return endSignIn("GitHub couldn't finish sign-in. Try again.");
  }
}

export async function cancelSignIn(): Promise<void> {
  await endSignIn("");
}

/* Access tokens, refreshed when they run out */
let refreshing: Promise<string | null> | null = null;

export async function getAccessToken(): Promise<string | null> {
  const access = (await session.get(ACCESS))[ACCESS] as Token | undefined;
  if (access && typeof access.token === "string" && access.expiresAt > Date.now()) return access.token;
  // One refresh at a time: GitHub retires a refresh token the moment it's used.
  refreshing ??= refreshAccess().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function invalidateAccess(): Promise<void> {
  await session.remove(ACCESS);
}

async function refreshAccess(): Promise<string | null> {
  const refresh = await getRefresh().catch(() => undefined);
  if (!refresh) return null;
  if (refresh.expiresAt < Date.now()) {
    await signOut("Your GitHub sign-in expired. Sign in again.");
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = await postForm(TOKEN_URL, { client_id: GITHUB.clientId, grant_type: "refresh_token", refresh_token: refresh.token });
  } catch {
    return null; // offline: keep the refresh token and try again later
  }
  if (typeof data.access_token !== "string") {
    await signOut("Your GitHub sign-in expired. Sign in again.");
    return null;
  }
  return saveTokens(data);
}

/** Deletes every token from this browser. The app stays authorized on GitHub until it's revoked there. */
export async function signOut(message?: string): Promise<void> {
  clearTimeout(pollTimer);
  await chrome.alarms.clear(POLL_ALARM);
  await session.remove([ACCESS, DEVICE]);
  await clearRefresh().catch(() => undefined);
  await chrome.storage.local.remove([ME, "gh:shared", "gh:unread", "gh:snapshot", "gh:participated", "gh:notified"]);
  await setStatus({ state: "signed-out", message });
}
