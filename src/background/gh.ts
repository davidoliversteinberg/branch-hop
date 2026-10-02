import { GITHUB, LOGIN_RE, SHARED_REPO_NAME, isSsoUrl } from "../shared/github.ts";
import type { SharedStatus } from "../shared/messages.ts";
import { getAccessToken, invalidateAccess } from "./auth.ts";

export class GhError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: SharedStatus | "invalid" | "error" = "error",
    readonly ssoUrl?: string,
  ) {
    super(message);
  }
}

/** Paths inside a shared space (a branch-hop-shared repo). */
export function repoPath(owner: string, suffix = ""): string {
  if (!LOGIN_RE.test(owner)) throw new GhError(0, "Not a valid GitHub account.", "invalid");
  return `/repos/${owner}/${SHARED_REPO_NAME}${suffix}`;
}

// Branch Hop only ever calls these: your profile, the app's installations, and branch-hop-shared repos.
const ALLOWED = [/^\/user$/, /^\/user\/installations(\/\d+\/repositories)?(\?|$)/, new RegExp(`^/repos/[A-Za-z0-9-]{1,39}/${SHARED_REPO_NAME}(/|\\?|$)`)];

export async function gh(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}): Promise<unknown> {
  if (!ALLOWED.some((re) => re.test(path))) throw new GhError(0, "Not a Branch Hop request.", "invalid");
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    if (!token) throw new GhError(401, "Sign in with GitHub to use shared lists.", "signed-out");
    let res: Response;
    try {
      res = await fetch(`${GITHUB.api}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new GhError(0, "Branch Hop can't reach GitHub right now.", "offline");
    }
    if (res.status === 401 && attempt === 0) {
      await invalidateAccess(); // try once more with a refreshed token
      continue;
    }
    if (res.status === 401) throw new GhError(401, "Your GitHub sign-in expired. Sign in again.", "signed-out");
    // Organizations with single sign-on ask for an SSO session first.
    const sso = res.headers.get("x-github-sso");
    if (sso && res.status === 403) {
      const url = /url=([^;\s]+)/.exec(sso)?.[1];
      throw new GhError(403, "This organization needs you to sign in with single sign-on first.", "sso", isSsoUrl(url) ? url : undefined);
    }
    if (res.status === 404) throw new GhError(404, "Branch Hop can't see this shared space.", "no-access");
    if (res.status === 403 || res.status === 429) {
      const limited = res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0";
      throw limited
        ? new GhError(res.status, "GitHub's rate limit was reached. Try again in a few minutes.", "rate-limited")
        : new GhError(403, "Branch Hop's GitHub App doesn't have permission for that.", "no-permission");
    }
    if (res.status === 410) throw new GhError(410, "Issues are turned off in this shared space.", "no-permission");
    if (res.status === 422) throw new GhError(422, "GitHub didn't accept that change.", "invalid");
    if (!res.ok) throw new GhError(res.status, `GitHub returned an error (${res.status}).`);
    return res.status === 204 ? null : res.json();
  }
  throw new GhError(401, "Sign in with GitHub again.", "signed-out");
}

/** All pages of a list endpoint, up to `maxPages` × 100 items. Handles endpoints that wrap the list in a key. */
export async function ghAll(path: string, maxPages = 10, key?: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const raw = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const batch = key && raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : raw;
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
