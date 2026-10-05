import { BRANCH_NAME_RE, KEY_RE } from "./preview.ts";

/**
 * Branch status: is a branch merged, deleted or still in progress?
 * Axiom Play's repo is internal, so Branch Hop reads it the way you do: on github.com, with the
 * sign-in already in your browser. It only reads two pages, and only when you turn this on.
 */
export const SOURCE_REPO = { owner: "episerver", name: "axiom-play" } as const;
export const SOURCE_URL = `https://github.com/${SOURCE_REPO.owner}/${SOURCE_REPO.name}`;

/** merged: its pull request is merged and nothing was pushed after. deleted: gone without a merge. */
export type BranchState = "merged" | "deleted" | "active";
export type PullInfo = { number: number; title: string; state: "open" | "draft" | "merged" | "closed"; mergedAt?: string };
export type BranchStatus = { key: string; name: string; state: BranchState; pr?: PullInfo; checkedAt: number };
/** Whether Branch Hop could read GitHub at all on the last check. */
export type StatusHealth = "off" | "ok" | "signed-out" | "unavailable";
export type StatusMeta = { health: StatusHealth; checkedAt: number; message?: string };

export type BranchHit = { name: string; authoredAt: number };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** Branches from github.com/<repo>/branches/all?query=… (JSON). Returns null if the shape is unfamiliar. */
export function parseBranchSearch(raw: unknown): BranchHit[] | null {
  const list = obj(obj(raw)?.payload)?.branches;
  if (!Array.isArray(list)) return null;
  return list.flatMap((b) => {
    const o = obj(b);
    const name = o?.name;
    const authoredAt = time(o?.authoredDate);
    return typeof name === "string" && BRANCH_NAME_RE.test(name) && authoredAt !== null ? [{ name, authoredAt }] : [];
  });
}

const STATE: Record<string, PullInfo["state"]> = {
  REPO_PULL_REQUEST_DISPLAY_STATE_OPEN: "open",
  REPO_PULL_REQUEST_DISPLAY_STATE_DRAFT: "draft",
  REPO_PULL_REQUEST_DISPLAY_STATE_MERGED: "merged",
  REPO_PULL_REQUEST_DISPLAY_STATE_CLOSED: "closed",
};

/** Pull requests from github.com/<repo>/pulls?q=… (JSON). Returns null if the shape is unfamiliar. */
export function parsePullSearch(raw: unknown): PullInfo[] | null {
  const list = obj(obj(obj(raw)?.payload)?.repoPullsDashboardContentRoute)?.results;
  if (!Array.isArray(list)) return null;
  return list.flatMap((p) => {
    const o = obj(p);
    const number = o?.number;
    const state = typeof o?.displayState === "string" ? STATE[o.displayState] : undefined;
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || !state) return [];
    const mergedAt = state === "merged" && time(o?.mergedAt) !== null ? (o?.mergedAt as string) : undefined;
    return [{ number, title: typeof o?.title === "string" ? o.title.slice(0, 200) : `#${number}`, state, mergedAt }];
  });
}

/** Commits up to this long after the merge still count as part of it (clock skew, merge commit). */
const MERGE_GRACE_MS = 2 * 60_000;

/**
 * Decides a branch's state from its search hit (if GitHub still has it) and its pull requests.
 * Merging a branch doesn't delete it in axiom-play, and some branches get merged more than once,
 * so a branch only counts as merged when nothing was pushed after its newest merged pull request.
 */
export function decide(branch: BranchHit | null, pulls: PullInfo[]): { state: BranchState; pr?: PullInfo } {
  const live = pulls.find((p) => p.state === "open" || p.state === "draft");
  if (live) return { state: "active", pr: live };
  const merged = pulls
    .filter((p) => p.mergedAt)
    .sort((a, b) => Date.parse(b.mergedAt as string) - Date.parse(a.mergedAt as string))[0];
  if (merged && (!branch || branch.authoredAt <= Date.parse(merged.mergedAt as string) + MERGE_GRACE_MS)) return { state: "merged", pr: merged };
  if (!branch) return { state: "deleted", pr: pulls[0] };
  return { state: "active", pr: merged ?? pulls[0] };
}

/** The most distinctive word of a branch key, for GitHub's branch search. */
export function searchWord(key: string): string {
  const words = key.split("-").filter((w) => w.length > 1);
  // Shortened keys end in a 6-character hash that isn't part of the branch name.
  if (words.length > 1 && /^[0-9a-f]{6}$/.test(words[words.length - 1])) words.pop();
  return words.sort((a, b) => b.length - a.length)[0] ?? key;
}

export function cleanBranchStatus(v: unknown): BranchStatus | null {
  const o = obj(v);
  if (!o || typeof o.key !== "string" || !KEY_RE.test(o.key) || typeof o.name !== "string" || !BRANCH_NAME_RE.test(o.name)) return null;
  if (o.state !== "merged" && o.state !== "deleted" && o.state !== "active") return null;
  const p = obj(o.pr);
  const pr =
    p && typeof p.number === "number" && Number.isInteger(p.number) && p.number > 0 && ["open", "draft", "merged", "closed"].includes(p.state as string)
      ? { number: p.number, title: typeof p.title === "string" ? p.title.slice(0, 200) : `#${p.number}`, state: p.state as PullInfo["state"], mergedAt: time(p.mergedAt) !== null ? (p.mergedAt as string) : undefined }
      : undefined;
  return { key: o.key, name: o.name, state: o.state, pr, checkedAt: typeof o.checkedAt === "number" ? o.checkedAt : 0 };
}

export function cleanStatusMap(v: unknown): Record<string, BranchStatus> {
  const out: Record<string, BranchStatus> = {};
  for (const val of Object.values(obj(v) ?? {})) {
    const s = cleanBranchStatus(val);
    if (s) out[s.key] = s;
  }
  return out;
}

export function cleanStatusMeta(v: unknown): StatusMeta {
  const o = obj(v);
  const health = ["off", "ok", "signed-out", "unavailable"].includes(o?.health as string) ? (o?.health as StatusHealth) : "off";
  return { health, checkedAt: typeof o?.checkedAt === "number" ? o.checkedAt : 0, message: typeof o?.message === "string" ? o.message.slice(0, 200) : undefined };
}

export const pullUrl = (n: number): string => `${SOURCE_URL}/pull/${n}`;
