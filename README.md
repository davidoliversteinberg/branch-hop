# Branch Hop

A Chrome and Safari extension for Axiom Play previews. Switch to any branch without leaving the page you're on, keep favorite pages with notes, and share branches with your team.

## What it does

**Without signing in**

- Shows which branch and page the current tab is on, with a **Save this page** button.
- Every row opens its own page. Turn on **Keep route** to open the page you're on, on the branch you pick instead. Favorites always open the page you saved.
- **Favorites**: star the pages you work on, as many per branch as you like, and add a short note to each. A favorite always opens the page you saved.
- **Recent**: every preview page you open in this browser, picked up automatically, including several pages on the same branch.
- Opens any branch you type or paste, including long names. Vercel shortens those and adds a hash; Branch Hop works out the same hash and checks that the preview exists before opening it.
- Puts the branch name in tab titles and a coloured dot on the tab icon.
- Adds a small branch pill to preview pages, with a button to flip back to the previous branch.
- When a route doesn't exist on the branch you picked (the page is a 404), offers that branch's start page.
- Copies a clean link, or a Markdown link for Slack and Jira.

**With GitHub sign-in (0.2)**

- **Shared**: branches shared with you, then your team's lists (such as "Opal review"), then everything else.
- **Share** the page you're on, or any branch, with teammates and lists, plus a note about what to look at.
- **Comments** on each shared branch. They're GitHub issue comments, so they also show up on github.com and in GitHub's own email notifications.
- **Notifications** when someone shares a branch with you or comments on one you follow. "Following" covers branches shared with you, ones you shared or commented on, and your favorites. Mute a branch from its comments.
- **Settings** for each kind of notification, and for desktop alerts versus only the count on the toolbar icon.

| Shortcut | Does |
| --- | --- |
| ⌥⇧B (Alt+Shift+B) | Open Branch Hop |
| ⌥⇧F (Alt+Shift+F) | Flip back to the previous branch, same route |
| ↑ ↓, Enter | Move through the list, open the highlighted branch |
| ⌘ Enter (Ctrl+Enter) | Open in a new tab, or send a comment |

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

**Updating:** Branch Hop checks for new versions on its own. When one is out, its icon shows ↑ and the popup offers **Update**: run the same command again, and Branch Hop reloads itself within a minute. Favorites, settings and your GitHub sign-in stay, because the extension ID is fixed (`cikpnfefgjppclpmndpcalonhgdanado`).

Chrome may remind you now and then that developer-mode extensions are on. That's expected for extensions installed this way.

**Desktop notifications on a Mac:** macOS also has to allow them. In **System Settings › Notifications › Google Chrome** (or Brave), turn on **Allow notifications**.

## Sign in with GitHub

1. Open Branch Hop, choose **Shared**, and click **Sign in with GitHub**.
2. Click **Copy code and open GitHub**, paste the code on the page that opens, and approve Branch Hop.
3. Go back to Branch Hop. It finishes signing in by itself, usually within a few seconds.

You stay signed in. Branch Hop renews its access in the background, and you'd only sign in again if you sign out, revoke the app on GitHub, or don't use it for six months.

## Shared spaces

Shared branches live in a GitHub repo named `branch-hop-shared`. Branch Hop finds every one it can reach after you sign in, and shows them together:

- **A team space**, such as `episerver/branch-hop-shared`. It's an internal repo, so everyone in the organization can see it and nobody needs inviting.
- **A personal space**, such as `davidoliversteinberg/branch-hop-shared`, for people you invite as collaborators.

When you share, you pick the space. Settings lists each space and whether it's working. If an organization uses single sign-on, Branch Hop shows a **Sign in with SSO** button instead of failing quietly. App setup and the one-time organization approval are in [docs/github-app.md](docs/github-app.md).

## Install in Safari

Safari runs the same extension, wrapped in a small Mac app. Building it needs Xcode.

1. Install Xcode from the Mac App Store and open it once.
2. In this repo, run `npm install && npm run safari`. It builds the app, puts it in your Applications folder and opens it once.
3. In Safari, turn on **Settings › Advanced › Show features for web developers**, then **Developer › Allow unsigned extensions**. Safari resets this when it quits, until Branch Hop is signed through the App Store.
4. In **Settings › Extensions**, turn on Branch Hop and allow it on `vercel.app`, `github.com` and `api.github.com`.

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

**Shared branches.** Each shared branch is an open issue in `branch-hop-shared`. The title is the branch, labels starting with `list:` are lists, assignees are the people it's shared with, and comments are the conversation. The issue body starts with a preview link and the note, so it reads well on GitHub, plus a small hidden marker Branch Hop reads back. Edit the note on GitHub and Branch Hop picks it up. Closing the issue stops sharing. While you're signed in, the background worker checks for changes every two minutes and whenever you open the popup.

## Security and privacy

- **GitHub access is narrow.** The Branch Hop GitHub App can read and write issues in `branch-hop-shared`, and nothing else. It can't read code, can't see `episerver` repos, and can't act anywhere it isn't installed.
- **No passwords or secrets.** Sign-in uses GitHub's device flow, and the app has no client secret or private key.
- **Tokens stay in the background worker.** The 8-hour access token lives in session storage. The refresh token lives in the extension's own IndexedDB, which page scripts can't reach. Neither is synced, logged or put in a URL. **Sign out** deletes both; you can also revoke the app under GitHub **Settings › Applications**.
- **Exact page matching.** The page script runs only on `axiom-play-git-*-optimizely-sandbox.vercel.app`. Browser match patterns can't be that narrow, so the manifest asks for `*.vercel.app` and the code checks the exact host before doing anything.
- **github.com access is for sign-in only.** The extension calls GitHub's sign-in and API endpoints without your github.com cookies, and never runs scripts on github.com pages.
- **Only safe links open.** Branch Hop only opens preview URLs it builds itself, and issue links in `branch-hop-shared`. Anything a teammate puts in an issue is checked against the same rules.
- **Untrusted text stays text.** Branch names, notes and comments are shown as plain text, never as HTML. Everything read back from storage or GitHub is validated.
- **No analytics or remote code.** Favorites and settings sync through your browser profile; history and shared-branch data stay on this computer.
- **Permissions:** `storage`, `alarms` (background checks), `notifications`, and access to `*.vercel.app`, `github.com` and `api.github.com`.

## What's next

- **Axiom Play data (0.3):** the full branch list, PR titles, build status, and notifications when a branch you follow gets new commits or its build finishes. This needs a second GitHub App with read-only access to `episerver/axiom-play`, installed once by an `episerver` org owner. Keeping it separate means the org never grants write access to anything.
