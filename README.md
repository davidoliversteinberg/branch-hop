# Branch Hop

A Chrome and Safari extension for Axiom Play previews. Switch to any branch without leaving the page you're on, keep favorites with notes, and tell your tabs apart.

Version 0.1 needs no sign-in. Everything stays in your browser.

## What it does

- Shows which branch the current tab is on, and the route you're looking at.
- Opens another branch on the same route, query and hash. Turn this off with **Keep this route when switching**.
- **Favorites**: star branches you work on or were sent, and add a short note to each.
- **Recent**: the branches you opened in this browser.
- Opens any branch you type or paste, including long names. Vercel shortens those and adds a hash; Branch Hop works out the same hash and checks that the preview exists before opening it.
- Puts the branch name in tab titles and a coloured dot on the tab icon.
- Adds a small branch pill to preview pages, with a button to flip back to the previous branch.
- When a route doesn't exist on the branch you picked (the page is a 404), offers that branch's start page.
- Copies a clean link, or a Markdown link for Slack and Jira.

| Shortcut | Does |
| --- | --- |
| ⌥⇧B (Alt+Shift+B) | Open Branch Hop |
| ⌥⇧F (Alt+Shift+F) | Flip back to the previous branch, same route |
| ↑ ↓, Enter | Move through the list, open the highlighted branch |
| ⌘ Enter (Ctrl+Enter) | Open in a new tab |

Change shortcuts at `chrome://extensions/shortcuts`.

## Install in Chrome or Brave

No store and no IT request needed.

1. Download `branch-hop-<version>.zip` from the latest release and unzip it somewhere permanent, such as `Documents/Branch Hop`. The browser loads the extension from that folder, so don't delete it.
2. Open `chrome://extensions` (in Brave, `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Pin Branch Hop from the puzzle-piece menu in the toolbar.

**Updating:** replace the folder's contents with the new release, then click the reload arrow on the Branch Hop card. Favorites and settings stay, because the extension ID is fixed (`cikpnfefgjppclpmndpcalonhgdanado`).

Chrome may remind you now and then that developer-mode extensions are on. That's expected for extensions installed this way.

## Install in Safari

Safari runs the same extension, wrapped in a small Mac app. This needs Xcode, and these steps haven't been run yet.

1. Install Xcode from the Mac App Store and open it once.
2. Build the extension: `npm install && npm run build`.
3. Create the Safari app: `xcrun safari-web-extension-converter dist --app-name "Branch Hop" --macos-only`. Xcode opens the new project.
4. In Xcode, press **Run**. Then in Safari open **Settings › Extensions**, turn on Branch Hop and allow it on Axiom Play sites.
5. Local builds are unsigned. Turn on **Settings › Advanced › Show features for web developers**, then **Developer › Allow unsigned extensions**. Safari resets this when it quits.

## Develop

```bash
npm install
npm run build      # builds into dist/
npm run watch      # rebuilds on change; reload the extension after each build
npm test           # URL rules and storage validation
npm run typecheck  # checks against the Axiom and Chrome types
npm run package    # writes release/branch-hop-<version>.zip
```

Load `dist/` with **Load unpacked**. The popup uses Axiom React 3.1.6, the version in Axiom Play's lockfile. `dev/harness.html` renders the built popup with sample data and stand-in browser APIs, for checking the UI in a normal browser tab.

## How preview URLs work

Vercel serves each branch at `axiom-play-git-<branch>-optimizely-sandbox.vercel.app`, with slashes and other symbols turned into hyphens. A DNS label can only be 63 characters, which leaves 29 for the branch. When a name is longer, Vercel keeps the first 22 characters and adds a 6-character hash: the start of `SHA-256("git-" + branch + "axiom-play")`. Vercel doesn't document this, so the tests check it against four real branches.

## Security and privacy

- The page script runs only on `axiom-play-git-*-optimizely-sandbox.vercel.app`. Browser match patterns can't be that narrow, so the manifest asks for `*.vercel.app` and the code checks the exact host before doing anything.
- Branch Hop only opens URLs it builds itself for that host. A route can't send you anywhere else.
- No sign-in, tokens, analytics or remote code. Favorites and settings sync through your browser profile; history stays on this computer.
- The only network request it makes is a header-only check of a branch's preview URL when you type a branch name.
- Everything read back from storage is validated, and page text is set as text, never as HTML.
- Permissions: `storage`, and access to `*.vercel.app` pages.

## What's next

- **GitHub sign-in (v0.2):** shared lists, comments on branches, sharing a branch with teammates, notifications for comments and shares, and settings for those notifications. Sign-in uses a GitHub App that you own and install on one private repo, so no company approval is needed.
- **Axiom Play data (v0.3):** every branch, PR titles, build status, and notifications when a branch you follow is updated or its build finishes. This needs a separate read-only GitHub App installed on `episerver/axiom-play`, which an org owner approves once.
