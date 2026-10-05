# Branch Hop

A Chrome and Safari extension for Axiom Play previews. Hop between branches, pin the ones you work on, bookmark the pages you come back to, clear out merged ones, and share branches with your team.

## What it does

Branch Hop is a personal open-source project, built for coworkers who review Axiom Play prototypes. It isn't an official Optimizely tool.

**The popup has two parts.**

- **This page**, at the top: the branch and page this tab is on, and everything you can do with it. **Bookmark page** keeps this exact page, with an optional note. **Share** sends it to teammates. **Copy** gives you a link, or a Markdown link for Slack and Jira.
- **The list** below: **Branches** (yours) and **Shared** (your team's). Search covers both. Paste a branch name or a preview link to open any branch, including long names that Vercel shortens and hashes.

**Branches** has two sections:

- **Pinned:** branches you're working on, each with its bookmarked pages listed underneath. Pin a branch with the pin on its row. Bookmarking a page pins its branch.
- **Recent:** every other branch you've opened in this browser, newest first.

Click a branch to go back to where you left off on it. Click a bookmark to open that exact page. Each row's **⋯** menu (or ⌘K on the highlighted row) has the rest: open in a new tab, **open the page you're on** on that branch, pin, share, copy, and remove.

**Merged branches** (optional, in Settings): Branch Hop marks branches whose pull request is merged with nothing pushed since, and branches that are gone from GitHub. One click removes them all. See [Branch status](#branch-status).

**On preview pages**, Branch Hop puts the branch in the tab title, a coloured dot on the tab icon, and a small pill at the bottom with a button to flip back to the previous branch. When a route doesn't exist on the branch you picked (a 404), the pill offers that branch's start page.

**With GitHub sign-in** you also get:

- **Shared**: branches shared with you, then your team's lists (such as "Opal review"), then everything else.
- **Share** any page or branch with teammates and lists, plus a note about what to look at.
- **Comments** on each shared branch. They're GitHub issue comments, so they also show up on github.com and in GitHub's own email notifications.
- **Notifications** when someone shares a branch with you or comments on one you follow: branches shared with you, ones you shared, commented on or pinned. Mute a branch from its comments.

| Shortcut | Does |
| --- | --- |
| ⌥⇧B (Alt+Shift+B) | Open Branch Hop |
| ⌥⇧F (Alt+Shift+F) | Flip back to the previous branch, same route |
| ↑ ↓, Enter | Move through the list, open the highlighted row |
| ⌘ Enter (Ctrl+Enter) | Open in a new tab (or in this tab, if you set new tabs as the default), or send a comment |
| ⌘K (Ctrl+K) or Shift+F10 | More actions for the highlighted row |

Change shortcuts at `chrome://extensions/shortcuts`.

## Install in Chrome or Brave

No store and no IT request needed.

1. Open **Terminal**, paste this, and press Return. It puts the newest Branch Hop in `Documents/Branch Hop`:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/davidoliversteinberg/branch-hop/main/scripts/install.sh | bash
   ```

   No Terminal? Download `branch-hop-<version>.zip` from the latest release and unzip it into a folder you'll keep.
2. Open `chrome://extensions` (in Brave, `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `Documents/Branch Hop` folder.
4. Pin Branch Hop from the puzzle-piece menu in the toolbar.

**Updating:** Branch Hop checks for new versions every few hours. When one is out you get a desktop notification, the icon shows ↑, and the popup offers **Update**: run the same command again, and Branch Hop reloads itself within a minute. Pins, bookmarks, settings and your GitHub sign-in stay, because the extension ID is fixed (`cikpnfefgjppclpmndpcalonhgdanado`). Versions before 0.4 show the ↑ and the popup notice, without the desktop notification.

Chrome may remind you now and then that developer-mode extensions are on. That's expected for extensions installed this way.

**Desktop notifications on a Mac:** macOS also has to allow them. In **System Settings › Notifications › Google Chrome** (or Brave), turn on **Allow notifications**.

## Sign in with GitHub

1. Open Branch Hop, choose **Shared**, and click **Sign in with GitHub**.
2. Click **Copy code and open GitHub**, paste the code on the page that opens, and approve Branch Hop.
3. Go back to Branch Hop. It finishes signing in by itself, usually within a few seconds.

You stay signed in. Branch Hop renews its access in the background, and you'd only sign in again if you sign out, revoke the app on GitHub, or don't use it for six months.

## Sharing is public

Shared branches are issues in this repo, [davidoliversteinberg/branch-hop](https://github.com/davidoliversteinberg/branch-hop/issues). There's nothing to join: anyone who signs in with GitHub can see what's shared and share their own.

Because the repo is public, **anyone on the internet can read every share: the branch name, the page, the note and the comments.** Leave customer names and anything confidential out of notes and comments. The previews themselves stay behind Vercel's login.

- **Shared with** names people by GitHub username. The issue @mentions them, which is how GitHub notifies them.
- **Lists** (such as "Opal review") are stored in the issue, so anyone can use them.
- You can change or stop only your own shares. Someone else can share the same branch with their own note.

## Branch status

Turn on **Settings › Branch status › Show merged branches** to mark branches you can clear out:

- **Merged:** its newest pull request is merged and nothing was pushed after. Axiom Play keeps branches after merging, and some get merged more than once, so a merge alone doesn't count.
- **Deleted:** the branch is gone from GitHub and was never merged.

`episerver/axiom-play` is internal, so Branch Hop reads it the way you would: on github.com, with the sign-in already in your browser. It asks for exactly two read-only pages, the repo's branch search and its pull request search, for your pinned and recent branches (up to 40), at most every 30 minutes. It never writes anything, never reads or stores your cookies, and never asks for any other page. If you're signed out of github.com, or your account can't see axiom-play, Settings says so and nothing is marked.

These are GitHub's own page data, not its documented API, so a GitHub change could stop them working. If that happens, Settings says so and Branch Hop marks nothing, rather than marking something wrongly. Safari may not send your github.com sign-in with these requests; Settings shows that too.

## Install in Safari

**Quickest, no Xcode (Safari 26):** run the install command above, then in Safari turn on **Settings › Advanced › Show features for web developers**, and in **Settings › Developer** click **Add Temporary Extension…** and choose the `Documents/Branch Hop` folder. Allow it on `vercel.app`, `github.com` and `api.github.com`. Safari removes temporary extensions when it quits, so you add it again after a restart. To update, run the install command, then click **Reload** under **Settings › Extensions › Branch Hop**.

**Permanent on your own Mac:** Safari keeps extensions that are signed, and a free Apple ID can sign one for your own Mac.

1. Install Xcode from the Mac App Store and open it once.
2. In Xcode, open **Settings › Accounts**, click **+**, choose **Apple ID** and sign in.
3. In Terminal, run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/davidoliversteinberg/branch-hop/main/scripts/safari-install.sh | bash
   ```

   It finds your Apple ID team, downloads the source, builds a signed Branch Hop app into `~/Applications` and opens it. Run the same command to update.
4. In **Safari › Settings › Extensions**, turn on Branch Hop, and uninstall any temporary copy.

**Permanent for everyone:** a Safari app other people can install for good needs signing with a paid Apple Developer account and Apple's notarization. Until then, coworkers on Safari use the temporary install or build their own signed copy.

Safari extensions can't show desktop notifications, so in Safari the count on the toolbar icon is the alert.

## Develop

```bash
npm install
npm run build      # builds into dist/
npm run watch      # rebuilds on change; reload the extension after each build
npm test           # URL rules, storage, and the GitHub issue format
npm run typecheck  # checks against the Axiom and Chrome types
npm run package    # writes release/branch-hop-<version>.zip
```

Load `dist/` with **Load unpacked**. The popup uses Axiom React 3.1.6, the version in Axiom Play's lockfile. `dev/harness.html` renders the built popup with made-up sample data and stand-in browser APIs (`?gh=signedout`, `?gh=pending`, `?tab=other`, `?empty=1`), for checking the UI in a normal browser tab.

## How it works

**Preview URLs.** Vercel serves each branch at `axiom-play-git-<branch>-optimizely-sandbox.vercel.app`, with slashes and other symbols turned into hyphens. A DNS label can only be 63 characters, which leaves 29 for the branch. When a name is longer, Vercel keeps the first 22 characters and adds a 6-character hash: the start of `SHA-256("git-" + branch + "axiom-play")`. Vercel doesn't document this, so the tests check it against real preview URLs.

**Shared branches.** Each shared branch is an open issue in this repo, titled "Shared branch: <name>". The body starts with a preview link, an @mention line for the people it's shared with, its lists and the note, so it reads well on GitHub, plus a small hidden marker Branch Hop reads back. Lists and people live in that marker rather than in labels and assignees, because only collaborators can set those on a public repo. Comments are the conversation. Edit the note on GitHub and Branch Hop picks it up. Closing the issue stops sharing. While you're signed in, the background worker checks for changes every two minutes and whenever you open the popup.

## Security and privacy

- **Shares are public.** See [Sharing is public](#sharing-is-public). Nothing private is ever written to GitHub without you pressing Share or Comment.
- **GitHub access is narrow.** The Branch Hop GitHub App can read and write issues in this repo, and nothing else, and the extension only ever calls your profile and this repo's issues. It can't read code, can't see `episerver` repos, and can't act anywhere it isn't installed.
- **No passwords or secrets.** Sign-in uses GitHub's device flow, and the app has no client secret or private key.
- **Tokens stay in the background worker.** The 8-hour access token lives in session storage. The refresh token lives in the extension's own IndexedDB, which page scripts can't reach. Neither is synced, logged or put in a URL. **Sign out** deletes both; you can also revoke the app under GitHub **Settings › Applications**.
- **Exact page matching.** The page script runs only on `axiom-play-git-*-optimizely-sandbox.vercel.app`. Browser match patterns can't be that narrow, so the manifest asks for `*.vercel.app` and the code checks the exact host before doing anything.
- **github.com access.** Sign-in and sharing call GitHub without your github.com cookies, and Branch Hop never runs scripts on github.com pages. The one exception is **Branch status**, which is off until you turn it on: it reads axiom-play's branch and pull request search pages with your browser's github.com sign-in, read-only, from a fixed allowlist of two pages.
- **Only safe links open.** Branch Hop only opens preview URLs it builds itself, and issue links in this repo. Anything a teammate puts in an issue is checked against the same rules.
- **Untrusted text stays text.** Branch names, notes and comments are shown as plain text, never as HTML. Everything read back from storage or GitHub is validated.
- **No analytics or remote code.** Pins, bookmarks and settings sync through your browser profile; history, branch status and shared-branch data stay on this computer.
- **Permissions:** `storage`, `alarms` (background checks), `notifications`, and access to `*.vercel.app`, `github.com` and `api.github.com`.

## What's next

- **Local builds:** treat `localhost:3000` as a branch, so you can hop the same page between your local build and any preview. It needs one more permission (`http://localhost/*`), so Chrome will ask everyone to approve it on update.
