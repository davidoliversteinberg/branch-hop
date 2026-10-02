import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHARED_REPO_URL,
  cleanListName,
  dedupeShared,
  isSharedIssueUrl,
  issueBody,
  listFromLabel,
  newComments,
  newShares,
  parseComment,
  parseIssue,
  parseIssueBody,
} from "../src/shared/github.ts";

const issue = (over = {}) => ({
  number: 7,
  state: "open",
  html_url: `${SHARED_REPO_URL}/issues/7`,
  title: "meridian-brand-template",
  body: issueBody({ key: "meridian-brand-template", route: "/site/meridian", note: "Meridian review on Friday" }),
  user: { login: "alex-designer" },
  assignees: [{ login: "davidoliversteinberg" }],
  labels: [{ name: "list:Opal review" }, { name: "bug" }],
  comments: 2,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T09:00:00Z",
  ...over,
});

test("issue body round-trips key, name, route and note", () => {
  const body = issueBody({ key: "experiment-template-ca-3893ad", name: "experiment/template-card-with-description2", route: "/analytics?tab=1", note: "Check the cohort chart" });
  assert.match(body, /\*\*Preview:\*\* https:\/\/axiom-play-git-experiment-template-ca-3893ad-optimizely-sandbox\.vercel\.app\/analytics\?tab=1/);
  assert.deepEqual(parseIssueBody(body), { key: "experiment-template-ca-3893ad", name: "experiment/template-card-with-description2", route: "/analytics?tab=1", note: "Check the cohort chart" });
});

test("a note edited on GitHub (with Windows line endings) is read back", () => {
  const body = issueBody({ key: "main", route: "/" }) + "\r\n\r\nUpdated on github.com\r\nSecond line";
  assert.equal(parseIssueBody(body).note, "Updated on github.com\nSecond line");
});

test("a route can't close the marker comment early", () => {
  const body = issueBody({ key: "main", route: "/x-->y<!--z" });
  assert.equal(parseIssueBody(body).route, "/x-->y<!--z");
});

test("tampered markers are ignored", () => {
  const bad = (data) => `<!-- branch-hop ${JSON.stringify(data)} -->`;
  assert.equal(parseIssueBody(bad({ v: 1, key: "evil.example/x", route: "/" })), null);
  assert.equal(parseIssueBody(bad({ v: 1, key: "main", route: "//evil.example" })), null);
  assert.equal(parseIssueBody(bad({ v: 2, key: "main", route: "/" })), null);
  assert.equal(parseIssueBody("<!-- branch-hop {not json} -->"), null);
  assert.equal(parseIssueBody("no marker at all"), null);
  assert.equal(parseIssueBody(bad({ v: 1, key: "main", route: "/", name: "has spaces" })).name, undefined);
});

test("parses a shared-branch issue", () => {
  assert.deepEqual(parseIssue(issue()), {
    number: 7,
    key: "meridian-brand-template",
    name: undefined,
    route: "/site/meridian",
    note: "Meridian review on Friday",
    lists: ["Opal review"],
    sharedWith: ["davidoliversteinberg"],
    sharedBy: "alex-designer",
    comments: 2,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T09:00:00Z",
    url: `${SHARED_REPO_URL}/issues/7`,
  });
});

test("ignores closed issues, pull requests, foreign links and bad logins", () => {
  assert.equal(parseIssue(issue({ state: "closed" })), null);
  assert.equal(parseIssue(issue({ pull_request: {} })), null);
  assert.equal(parseIssue(issue({ html_url: "https://evil.example/issues/7" })), null);
  assert.equal(parseIssue(issue({ html_url: `${SHARED_REPO_URL}/issues/8` })), null);
  assert.equal(parseIssue(issue({ user: { login: "<script>" } })), null);
  assert.equal(parseIssue(issue({ body: "plain issue, not shared from Branch Hop" })), null);
});

test("duplicate shares of one branch collapse to the newest", () => {
  const a = parseIssue(issue({ number: 7, html_url: `${SHARED_REPO_URL}/issues/7`, updated_at: "2026-10-01T00:00:00Z" }));
  const b = parseIssue(issue({ number: 9, html_url: `${SHARED_REPO_URL}/issues/9`, updated_at: "2026-10-02T00:00:00Z" }));
  assert.deepEqual(dedupeShared([a, b]).map((x) => x.number), [9]);
});

test("list labels", () => {
  assert.equal(listFromLabel("list:Opal review"), "Opal review");
  assert.equal(listFromLabel("bug"), null);
  assert.equal(cleanListName("  STRIDE   templates "), "STRIDE templates");
  assert.equal(cleanListName("<img src=x>"), null);
  assert.equal(cleanListName("x".repeat(41)), null);
});

test("comments are parsed only for the shared repo", () => {
  const raw = {
    id: 99,
    body: "Looks great on mobile",
    user: { login: "alex-designer", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
    issue_url: "https://api.github.com/repos/davidoliversteinberg/branch-hop-shared/issues/7",
    html_url: `${SHARED_REPO_URL}/issues/7#issuecomment-99`,
    created_at: "2026-10-02T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
  };
  assert.equal(parseComment(raw).issue, 7);
  assert.equal(parseComment({ ...raw, issue_url: "https://api.github.com/repos/someone/else/issues/7" }), null);
  assert.equal(parseComment({ ...raw, user: { login: "alex-designer", avatar_url: "https://evil.example/a.png" } }).avatarUrl, undefined);
});

test("only shared-repo issue links can be opened", () => {
  assert.ok(isSharedIssueUrl(`${SHARED_REPO_URL}/issues/7`));
  assert.ok(isSharedIssueUrl(`${SHARED_REPO_URL}/issues/7#issuecomment-99`));
  assert.ok(!isSharedIssueUrl(`${SHARED_REPO_URL}/issues/7/../../settings`));
  assert.ok(!isSharedIssueUrl("https://evil.example/"));
});

test("new shares notify once, never on the first run, never for my own shares", () => {
  const items = [parseIssue(issue())];
  assert.deepEqual(newShares(null, items, "davidoliversteinberg"), []);
  assert.deepEqual(newShares({ assigned: [], commentsCheckedAt: "2026-10-01T00:00:00Z" }, items, "davidoliversteinberg").map((e) => [e.kind, e.issue, e.by]), [["shared", 7, "alex-designer"]]);
  assert.deepEqual(newShares({ assigned: [7], commentsCheckedAt: "2026-10-01T00:00:00Z" }, items, "davidoliversteinberg"), []);
  const mine = [parseIssue(issue({ user: { login: "davidoliversteinberg" } }))];
  assert.deepEqual(newShares({ assigned: [], commentsCheckedAt: "2026-10-01T00:00:00Z" }, mine, "davidoliversteinberg"), []);
});

test("new comments notify for followed branches only, and never for my own comments", () => {
  const items = [parseIssue(issue())];
  const comment = (over) => ({ id: 1, issue: 7, author: "alex-designer", body: "New colour pass is up", createdAt: "2026-10-02T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", url: "", ...over });
  const since = "2026-10-02T09:30:00Z";
  assert.equal(newComments([comment()], items, "davidoliversteinberg", () => true, since).length, 1);
  assert.equal(newComments([comment({ author: "davidoliversteinberg" })], items, "davidoliversteinberg", () => true, since).length, 0);
  assert.equal(newComments([comment()], items, "davidoliversteinberg", () => false, since).length, 0);
  assert.equal(newComments([comment({ createdAt: "2026-10-02T09:00:00Z" })], items, "davidoliversteinberg", () => true, since).length, 0);
});
