import { GITHUB } from "../shared/github.ts";
import type { SharedStatus } from "../shared/messages.ts";
import { getAccessToken, invalidateAccess } from "./auth.ts";

export class GhError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: SharedStatus | "invalid" | "error" = "error",
  ) {
    super(message);
  }
}

/** Paths inside the shared repo. Branch Hop never calls any other repo. */
export const repoPath = (suffix = "") => `/repos/${GITHUB.owner}/${GITHUB.repo}${suffix}`;

export async function gh(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}): Promise<unknown> {
  if (!path.startsWith(`/repos/${GITHUB.owner}/${GITHUB.repo}`) && path !== "/user") throw new GhError(0, "Not a Branch Hop request.", "invalid");
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
    if (res.status === 404) throw new GhError(404, "You don't have access to the shared lists yet.", "no-access");
    if (res.status === 403 || res.status === 429) {
      const limited = res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0";
      throw limited
        ? new GhError(res.status, "GitHub's rate limit was reached. Try again in a few minutes.", "rate-limited")
        : new GhError(403, "Branch Hop's GitHub App doesn't have permission for that.", "no-permission");
    }
    if (res.status === 410) throw new GhError(410, "Issues are turned off in the shared repo.", "no-permission");
    if (res.status === 422) throw new GhError(422, "GitHub didn't accept that change.", "invalid");
    if (!res.ok) throw new GhError(res.status, `GitHub returned an error (${res.status}).`);
    return res.status === 204 ? null : res.json();
  }
  throw new GhError(401, "Sign in with GitHub again.", "signed-out");
}

/** All pages of a list endpoint, up to `maxPages` × 100 items. */
export async function ghAll(path: string, maxPages = 10): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
