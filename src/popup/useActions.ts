import { toaster } from "@optiaxiom/react";
import { openPreview } from "../shared/nav";
import { previewUrl } from "../shared/preview";
import { findFavorite, forgetBranch, pinBranch, rememberName, removeFavorite, restoreBranch, saveFavorite, type BranchSnapshot } from "../shared/store";
import { routePath, type Item } from "./items";
import type { ExtState } from "./useExtensionState";

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** A page on a branch, wherever it's shown: the header, a row, a pasted link. */
export type PageRef = { key: string; name?: string; route: string };

/** Everything you can do to a branch or page. The header and the rows share these. */
export function useActions(ext: ExtState) {
  const here = ext.active?.loc ?? null;
  const onPreview = here !== null;
  const nameOf = (key: string) =>
    ext.names[key] ?? ext.pins.find((p) => p.key === key && p.name)?.name ?? ext.favorites.find((f) => f.key === key && f.name)?.name;
  const titleOf = (key: string) => nameOf(key) ?? key;
  const isPinned = (key: string) => ext.pins.some((p) => p.key === key) || ext.favorites.some((f) => f.key === key);

  function undoable(message: string, snapshot: BranchSnapshot) {
    toaster.create(message, {
      action: "Undo",
      onAction: () => void restoreBranch(snapshot).catch((err) => toaster.create(errorText(err), { intent: "danger" })),
    });
  }

  /** Opens a page. `other` is Cmd/Ctrl, which flips this tab / new tab for one open. */
  async function open(target: PageRef, other: boolean): Promise<void> {
    const newTab = !onPreview || ext.settings.newTab !== other;
    try {
      if (target.name) await rememberName(target.key, target.name);
      if (!newTab && target.key === here?.key && target.route === here?.route) {
        window.close();
        return;
      }
      await openPreview({ key: target.key, route: target.route }, { tab: ext.active?.tab, newTab });
      window.close();
    } catch {
      toaster.create("Branch Hop couldn't open that branch.", { intent: "danger" });
    }
  }

  async function openItem(item: Item, other: boolean): Promise<void> {
    if (!item.key || item.lookup === "checking") return;
    if (item.lookup === "missing") {
      toaster.create(`There's no preview for ${item.title} yet.`, { intent: "warning" });
      return;
    }
    await open({ key: item.key, name: item.name, route: item.route }, other);
  }

  async function toggleBookmark(page: PageRef): Promise<void> {
    const existing = findFavorite(ext.favorites, page.key, page.route);
    const where = `${routePath(page.route)} on ${titleOf(page.key)}`;
    try {
      if (existing) {
        await removeFavorite(existing.id);
        toaster.create(`Removed the bookmark for ${where}`, {
          action: "Undo",
          onAction: () => void saveFavorite(existing).catch(() => undefined),
        });
      } else {
        await saveFavorite({ key: page.key, name: page.name ?? nameOf(page.key), route: page.route, addedAt: Date.now() });
        if (page.name) await rememberName(page.key, page.name);
        toaster.create(`Bookmarked ${where}`, { intent: "success" });
      }
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  async function saveNote(page: PageRef, note: string): Promise<void> {
    const existing = findFavorite(ext.favorites, page.key, page.route);
    try {
      await saveFavorite({ key: page.key, name: existing?.name ?? page.name ?? nameOf(page.key), route: existing?.route ?? page.route, addedAt: existing?.addedAt ?? Date.now(), note });
      toaster.create(note.trim() ? "Note saved" : "Note removed", { intent: "success" });
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  async function togglePin(key: string, name?: string): Promise<void> {
    try {
      if (!isPinned(key)) {
        await pinBranch({ key, name: name ?? nameOf(key), addedAt: Date.now() });
        if (name) await rememberName(key, name);
        toaster.create(`Pinned ${titleOf(key)}`, { intent: "success" });
        return;
      }
      const snapshot = await forgetBranch(key, { visits: false });
      const n = snapshot.favorites.filter((f) => f.id.includes("@") || f.note).length;
      undoable(n ? `Unpinned ${titleOf(key)} and removed ${n === 1 ? "its bookmark" : `its ${n} bookmarks`}` : `Unpinned ${titleOf(key)}`, snapshot);
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  /** Takes a branch out of Branch Hop entirely: pin, bookmarks and history. */
  async function forget(key: string): Promise<void> {
    try {
      undoable(`Removed ${titleOf(key)} from Branch Hop`, await forgetBranch(key, { visits: true }));
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  async function forgetMany(keys: string[]): Promise<void> {
    try {
      const snapshots: BranchSnapshot[] = [];
      for (const key of keys) snapshots.push(await forgetBranch(key, { visits: true }));
      toaster.create(`Removed ${keys.length} merged ${keys.length === 1 ? "branch" : "branches"}`, {
        action: "Undo",
        onAction: () => void Promise.all(snapshots.map(restoreBranch)).catch(() => undefined),
      });
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    }
  }

  async function copy(page: PageRef, format: "url" | "markdown"): Promise<void> {
    const url = previewUrl(page.key, page.route);
    const label = `${titleOf(page.key)} ${routePath(page.route)}`;
    const text = format === "markdown" ? `[${label.replace(/[[\]\\]/g, "\\$&")}](${url.replace(/\)/g, "%29")})` : url;
    try {
      await navigator.clipboard.writeText(text);
      toaster.create(format === "markdown" ? "Markdown link copied" : "Link copied", { intent: "success" });
    } catch {
      toaster.create("Your browser blocked copying. Try again.", { intent: "danger" });
    }
  }

  return { here, onPreview, nameOf, titleOf, isPinned, open, openItem, toggleBookmark, saveNote, togglePin, forget, forgetMany, copy };
}

export type Actions = ReturnType<typeof useActions>;
