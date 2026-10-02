import { branchColor } from "../shared/palette";
import { KEY_RE, parsePreviewUrl, previewUrl, shortLabel } from "../shared/preview";
import { DEFAULT_SETTINGS, findFavorite, getFavorites, getNames, getSettings, type Settings } from "../shared/store";
import { ICON_CLOSE, ICON_SWAP } from "./icons";
import { PILL_CSS } from "./pill-css";

const MARK = "data-branch-hop";
const SEP = " · ";
const SVG_NS = "http://www.w3.org/2000/svg";
const OPEN_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥⇧B" : "Alt+Shift+B";

type Display = { name: string; note?: string };
type TabInfo = { prevKey: string | null; prevName: string | null };

const here = parsePreviewUrl(location.href);
// Runs only on an exact Axiom Play preview host, in the top frame.
if (here && window.top === window) void start(here.key);

async function start(key: string): Promise<void> {
  let settings: Settings = DEFAULT_SETTINGS;
  let display: Display = { name: key };
  let info: TabInfo = { prevKey: null, prevName: null };
  let appliedPrefix = "";
  let iconUrl: string | null = null;
  let dismissed = false;
  let pillHost: HTMLElement | null = null;
  let pillRoot: ShadowRoot | null = null;
  let hintTimer = 0;
  const notFound = isNotFound();

  /* Tab title: "<branch> · <page title>" */
  function applyTitle(): void {
    const current = document.title;
    const base = appliedPrefix && current.startsWith(appliedPrefix) ? current.slice(appliedPrefix.length) : current;
    appliedPrefix = settings.tabLabels ? `${shortLabel(display.name)}${SEP}` : "";
    const wanted = appliedPrefix + base;
    if (current !== wanted) document.title = wanted;
  }

  /* Tab icon: the page's favicon with the branch's colour dot */
  async function buildIcon(): Promise<string | null> {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const links = document.querySelectorAll<HTMLLinkElement>(`link[rel~="icon"]:not([${MARK}])`);
    const source = links[links.length - 1]?.href || new URL("/favicon.ico", location.origin).href;
    try {
      const img = new Image();
      img.src = source;
      await img.decode();
      ctx.drawImage(img, 0, 0, size, size);
    } catch {
      ctx.fillStyle = "#252825";
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, 7);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(24, 24, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(24, 24, 6, 0, Math.PI * 2);
    ctx.fillStyle = branchColor(key);
    ctx.fill();
    try {
      return canvas.toDataURL("image/png");
    } catch {
      return null; // a cross-origin favicon taints the canvas
    }
  }

  function placeIcon(): void {
    const head = document.head;
    if (!head) return;
    const ours = head.querySelector<HTMLLinkElement>(`link[${MARK}]`);
    if (!settings.tabLabels || !iconUrl) {
      ours?.remove();
      return;
    }
    const icons = head.querySelectorAll('link[rel~="icon"]');
    if (ours && icons[icons.length - 1] === ours) return;
    const link = ours ?? document.createElement("link");
    link.setAttribute(MARK, "");
    link.rel = "icon";
    link.type = "image/png";
    link.href = iconUrl;
    head.append(link); // the last icon in the head wins
  }

  async function applyIcon(): Promise<void> {
    if (settings.tabLabels && !iconUrl) iconUrl = await buildIcon();
    placeIcon();
  }

  /* Page pill, in a closed shadow root so the page and the pill can't restyle each other */
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconButton(path: string, label: string): HTMLButtonElement {
    const button = el("button", "icon-btn");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", path);
    p.setAttribute("fill", "currentColor");
    svg.append(p);
    button.append(svg);
    return button;
  }

  const prevLabel = (): string => info.prevName ?? info.prevKey ?? "";

  async function flip(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: "flip" });
    } catch {
      showHint("Branch Hop was updated. Reload this page to keep using the pill.");
    }
  }

  async function openSwitcher(): Promise<void> {
    let ok = false;
    try {
      const res = (await chrome.runtime.sendMessage({ type: "open-popup" })) as { ok?: unknown } | undefined;
      ok = res?.ok === true;
    } catch {
      ok = false;
    }
    if (!ok) showHint(`Press ${OPEN_SHORTCUT} to open Branch Hop`);
  }

  function showHint(text: string): void {
    const hint = pillRoot?.querySelector<HTMLElement>(".hint");
    if (!hint) return;
    hint.textContent = text;
    hint.hidden = false;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.hidden = true;
    }, 4000);
  }

  function pillView(): HTMLElement {
    const bar = el("div", "pill");
    const dot = el("span", "dot");
    dot.style.background = branchColor(key);
    const name = el("button", "name", display.name);
    name.type = "button";
    name.title = display.note ? `${display.name} · ${display.note}` : display.name;
    name.setAttribute("aria-label", `Branch Hop: ${display.name}. Open the branch switcher`);
    name.addEventListener("click", () => void openSwitcher());
    bar.append(dot, name);
    if (info.prevKey) {
      const back = iconButton(ICON_SWAP, `Back to ${prevLabel()}`);
      back.addEventListener("click", () => void flip());
      bar.append(back);
    }
    const hide = iconButton(ICON_CLOSE, "Hide on this page");
    hide.addEventListener("click", () => {
      dismissed = true;
      renderPill();
    });
    bar.append(hide);
    return bar;
  }

  function notFoundView(): HTMLElement {
    const card = el("div", "card");
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Branch Hop");
    const title = el("p", "title");
    title.append("This route isn't on ", el("strong", "", display.name));
    const text = el("p", "text", `${location.pathname} doesn't exist on this branch, so the preview shows a 404.`);
    const actions = el("div", "actions");
    const home = el("button", "btn", "Open start page");
    home.type = "button";
    home.addEventListener("click", () => location.assign(previewUrl(key, "/")));
    actions.append(home);
    if (info.prevKey) {
      const back = el("button", "btn subtle", `Back to ${prevLabel()}`);
      back.type = "button";
      back.addEventListener("click", () => void flip());
      actions.append(back);
    }
    const close = iconButton(ICON_CLOSE, "Dismiss");
    close.classList.add("close");
    close.addEventListener("click", () => {
      dismissed = true;
      renderPill();
    });
    card.append(title, text, actions, close);
    return card;
  }

  function renderPill(): void {
    if (dismissed || !settings.pagePill) {
      pillHost?.remove();
      pillHost = null;
      pillRoot = null;
      return;
    }
    if (!pillHost || !pillRoot) {
      pillHost = document.createElement("div");
      pillHost.setAttribute(MARK, "pill");
      pillRoot = pillHost.attachShadow({ mode: "closed" });
      document.documentElement.append(pillHost);
    }
    const style = el("style");
    style.textContent = PILL_CSS;
    const wrap = el("div", "wrap");
    const hint = el("p", "hint");
    hint.hidden = true;
    hint.setAttribute("role", "status");
    wrap.append(notFound ? notFoundView() : pillView(), hint);
    pillRoot.replaceChildren(style, wrap);
  }

  async function requestTabInfo(): Promise<TabInfo> {
    try {
      const res = (await chrome.runtime.sendMessage({ type: "tab-info" })) as { prevKey?: unknown; prevName?: unknown } | undefined;
      const prevKey = typeof res?.prevKey === "string" && KEY_RE.test(res.prevKey) ? res.prevKey : null;
      const prevName = typeof res?.prevName === "string" ? res.prevName.slice(0, 200) : null;
      return { prevKey, prevName };
    } catch {
      return { prevKey: null, prevName: null };
    }
  }

  async function refresh(): Promise<void> {
    const [nextSettings, favorites, names, nextInfo] = await Promise.all([getSettings(), getFavorites(), getNames(), requestTabInfo()]);
    settings = nextSettings;
    const page = findFavorite(favorites, key, location.pathname);
    const name = favorites.find((f) => f.key === key && f.name)?.name;
    display = { name: name ?? names[key] ?? key, note: page?.note };
    info = nextInfo;
    applyTitle();
    await applyIcon();
    renderPill();
  }

  await refresh();
  new MutationObserver(() => {
    applyTitle();
    placeIcon();
  }).observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" || (area === "local" && "names" in changes)) void refresh();
  });
}

function isNotFound(): boolean {
  const [nav] = performance.getEntriesByType("navigation") as (PerformanceNavigationTiming & { responseStatus?: number })[];
  return nav?.responseStatus === 404;
}
