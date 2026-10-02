/**
 * Preview URL rules for the Axiom Play Vercel project.
 * Vercel serves every branch at axiom-play-git-<branch>-optimizely-sandbox.vercel.app.
 */
export const PROJECT = "axiom-play";
export const TEAM = "optimizely-sandbox";

const PREFIX = `${PROJECT}-git-`;
const TEAM_SUFFIX = `-${TEAM}`;
const LABEL_MAX = 63; // DNS label limit (RFC 1035)

/** Characters a branch can use in the URL before Vercel shortens it. */
export const BRANCH_BUDGET = LABEL_MAX - PREFIX.length - TEAM_SUFFIX.length; // 29
/** When shortened, Vercel keeps this many characters, then "-" and a 6-character hash. */
const SHORT_KEEP = BRANCH_BUDGET - 7; // 22

const KEY_PATTERN = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${PREFIX}(${KEY_PATTERN})${TEAM_SUFFIX}\\.vercel\\.app$`);

export const KEY_RE = new RegExp(`^${KEY_PATTERN}$`);
export const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
export const ROUTE_MAX = 2048;

/** A tab or link on an Axiom Play preview. `key` is the branch part of the host. */
export type PreviewLocation = { host: string; key: string; route: string };

export function slugOf(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The host key Vercel uses for a git branch name. */
export async function keyForBranch(branch: string): Promise<string> {
  if (!BRANCH_NAME_RE.test(branch)) throw new Error("Not a valid branch name");
  const slug = slugOf(branch);
  if (slug.length <= BRANCH_BUDGET) return slug;
  // Vercel doesn't document this hash; it matches the URLs Vercel generated for this project.
  const hash = (await sha256Hex(`git-${branch}${PROJECT}`)).slice(0, 6);
  return `${slug.slice(0, SHORT_KEEP).replace(/-+$/, "")}-${hash}`;
}

export function hostForKey(key: string): string {
  return `${PREFIX}${key}${TEAM_SUFFIX}.vercel.app`;
}

export function keyFromHost(host: string): string | null {
  const match = HOST_RE.exec(host);
  return match ? match[1] : null;
}

export function isSafeRoute(route: unknown): route is string {
  return typeof route === "string" && route.startsWith("/") && !route.startsWith("//") && !route.includes("\\") && route.length <= ROUTE_MAX;
}

export function parsePreviewUrl(input: string): PreviewLocation | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const key = keyFromHost(url.hostname);
  if (!key) return null;
  const route = `${url.pathname}${url.search}${url.hash}`;
  return isSafeRoute(route) ? { host: url.hostname, key, route } : null;
}

/** Builds a preview URL. Anything that would leave the Axiom Play host is refused. */
export function previewUrl(key: string, route: string = "/"): string {
  if (!KEY_RE.test(key)) throw new Error("Not an Axiom Play branch");
  const host = hostForKey(key);
  const url = new URL(isSafeRoute(route) ? route : "/", `https://${host}`);
  if (url.protocol !== "https:" || url.hostname !== host) throw new Error("Route leaves the preview host");
  return url.toString();
}

/** The last segment of a branch name, used in tab titles. */
export function shortLabel(name: string): string {
  return name.split("/").filter(Boolean).pop() ?? name;
}
