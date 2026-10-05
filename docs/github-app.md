# GitHub sign-in setup

Sharing, comments and notifications use a GitHub App owned by the Branch Hop maintainer. Shares are issues in the public `davidoliversteinberg/branch-hop` repo, so the app only needs to be installed there.

Each shared branch is an issue in that repo. Lists and people are stored in the issue body, and people are @mentioned so GitHub notifies them. Comments are the conversation.

## 1. Register the app (the maintainer does this once)

Open <https://github.com/settings/apps/new> and fill in the form.

| Field | Value |
| --- | --- |
| GitHub App name | Branch Hop (any free name works; ours is at github.com/settings/apps/branch-hop) |
| Homepage URL | `https://github.com/davidoliversteinberg/branch-hop` |
| Callback URL | Leave empty |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | Off |
| Enable Device Flow | On |
| Webhook › Active | Off |
| Repository permissions › Issues | Read and write |
| Repository permissions › Metadata | Read-only (selected automatically) |
| Every other permission | No access |
| Where can this GitHub App be installed? | Any account (so organizations can install it; it still isn't listed anywhere) |

Click **Create GitHub App**. Don't generate a client secret or a private key. Device sign-in doesn't use them, so there's no secret to look after.

## 2. Install it on the repo

Open **GitHub › Settings › Applications › Installed GitHub Apps › Branch Hop › Configure**. Under **Repository access**, choose **Only select repositories**, add `branch-hop`, and save. (On a first install: the app's page › **Install App** › **Install**.)

Installing is what lets people's sign-ins write issues there. Reading works without it, because the repo is public.

## 3. Point Branch Hop at the app

The app's Client ID (it starts with `Iv`) is public. It's set as `GITHUB.clientId` in `src/shared/github.ts`, along with the repo shares go to (`SPACE_OWNER`, `SHARED_REPO_NAME`). A fork that wants its own sharing changes those three values and installs its own app.

## What the app can and can't do

- It can read and write issues and comments in `branch-hop`, and only there.
- It can't read code, can't see `episerver` repos, and can't act anywhere it isn't installed.
- Sign-in tokens last 8 hours and renew themselves. A refresh token lasts up to 6 months and is replaced each time it's used. Signing out deletes both from the browser, and anyone can revoke the app under GitHub **Settings › Applications**.

## Merged branches

Branch status (merged and deleted branches) doesn't use this app. `episerver/axiom-play` is internal and the app isn't installed there, so Branch Hop reads it with your browser's own github.com sign-in instead. See "Branch status" in the README.
