import { useEffect, useState } from "react";
import { checkPreview } from "../shared/nav";
import { BRANCH_NAME_RE, keyForBranch, parsePreviewUrl } from "../shared/preview";
import type { Typed } from "./items";

/** Resolves a pasted preview link, or a typed branch name to its preview (hash included). */
export function useTyped(query: string, enabled: boolean): Typed | null {
  const [typed, setTyped] = useState<Typed | null>(null);
  useEffect(() => {
    const q = query.trim();
    const link = parsePreviewUrl(q);
    if (link) {
      setTyped({ kind: "link", key: link.key, route: link.route });
      return;
    }
    if (!enabled || q.length < 2 || !BRANCH_NAME_RE.test(q)) {
      setTyped(null);
      return;
    }
    let cancelled = false;
    setTyped({ kind: "name", name: q, key: null, status: "checking" });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const key = await keyForBranch(q);
          if (cancelled) return;
          setTyped({ kind: "name", name: q, key, status: "checking" });
          const status = await checkPreview(key);
          if (!cancelled) setTyped({ kind: "name", name: q, key, status });
        } catch {
          if (!cancelled) setTyped({ kind: "name", name: q, key: null, status: "error" });
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled]);
  return typed;
}
