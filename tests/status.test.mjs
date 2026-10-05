import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanBranchStatus, decide, parseBranchSearch, parsePullSearch, searchWord } from "../src/shared/status.ts";

const t = (iso) => Date.parse(iso);

test("reads GitHub's branch search payload and ignores anything malformed", () => {
  const raw = { payload: { has_more: false, branches: [{ name: "david/image-gen-editor", authoredDate: "2026-10-01T10:00:00.000+00:00" }, { name: "<script>", authoredDate: "x" }, { nope: 1 }] } };
  assert.deepEqual(parseBranchSearch(raw), [{ name: "david/image-gen-editor", authoredAt: t("2026-10-01T10:00:00Z") }]);
  assert.equal(parseBranchSearch({ payload: {} }), null);
  assert.equal(parseBranchSearch("<html>"), null);
});

test("reads GitHub's pull request search payload", () => {
  const raw = {
    payload: {
      repoPullsDashboardContentRoute: {
        results: [
          { number: 505, title: "Image Gen editor", displayState: "REPO_PULL_REQUEST_DISPLAY_STATE_MERGED", mergedAt: "2026-10-02T12:00:00Z" },
          { number: 520, title: "Draft", displayState: "REPO_PULL_REQUEST_DISPLAY_STATE_DRAFT" },
          { number: -1, displayState: "REPO_PULL_REQUEST_DISPLAY_STATE_OPEN" },
          { number: 9, displayState: "SOMETHING_NEW" },
        ],
      },
    },
  };
  assert.deepEqual(parsePullSearch(raw), [
    { number: 505, title: "Image Gen editor", state: "merged", mergedAt: "2026-10-02T12:00:00Z" },
    { number: 520, title: "Draft", state: "draft", mergedAt: undefined },
  ]);
  assert.equal(parsePullSearch({}), null);
});

const merged = (n, at) => ({ number: n, title: `#${n}`, state: "merged", mergedAt: at });

test("merged only when nothing was pushed after the newest merge", () => {
  const branch = { name: "ana-im-activity", authoredAt: t("2026-09-30T17:20:00Z") };
  // Merged three times in a day; the last merge includes the last commit.
  const pulls = [merged(1, "2026-09-30T14:12:25Z"), merged(2, "2026-09-30T17:20:46Z"), merged(3, "2026-09-30T14:31:57Z")];
  assert.equal(decide(branch, pulls).state, "merged");
  assert.equal(decide(branch, pulls).pr.number, 2);
  // A commit an hour after the last merge means work continues.
  assert.equal(decide({ ...branch, authoredAt: t("2026-09-30T18:30:00Z") }, pulls).state, "active");
});

test("an open or draft pull request keeps a branch active", () => {
  const branch = { name: "x", authoredAt: t("2026-09-01T00:00:00Z") };
  assert.equal(decide(branch, [merged(1, "2026-09-02T00:00:00Z"), { number: 2, title: "", state: "open" }]).state, "active");
});

test("a branch that's gone is merged if its pull request was, otherwise deleted", () => {
  assert.equal(decide(null, [merged(1, "2026-09-02T00:00:00Z")]).state, "merged");
  assert.equal(decide(null, [{ number: 4, title: "", state: "closed" }]).state, "deleted");
  assert.equal(decide(null, []).state, "deleted");
});

test("a live branch with no pull request is active", () => {
  assert.equal(decide({ name: "x", authoredAt: 1 }, []).state, "active");
});

test("the search word skips Vercel's hash and picks the longest word", () => {
  assert.equal(searchWord("experiment-template-ca-3893ad"), "experiment");
  assert.equal(searchWord("david-image-gen-editor"), "editor");
  assert.equal(searchWord("main"), "main");
});

test("stored statuses are validated", () => {
  assert.equal(cleanBranchStatus({ key: "Bad Key", name: "x", state: "merged" }), null);
  assert.equal(cleanBranchStatus({ key: "x", name: "x", state: "exploded" }), null);
  assert.equal(cleanBranchStatus({ key: "x", name: "x", state: "merged", pr: { number: 3, state: "merged", title: "T" }, checkedAt: 1 }).pr.number, 3);
});
