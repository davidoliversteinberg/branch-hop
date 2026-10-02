# GitHub sign-in setup (for v0.2)

Shared lists, comments and notifications use a GitHub App owned by the Branch Hop maintainer. It works without any company approval, because the app is only installed on one private repo, `branch-hop-shared`.

Each shared branch is stored as an issue in that repo. The title is the branch, labels are lists, assignees are the people it's shared with, and comments are the conversation. GitHub's own notifications work on top of that.

## 1. Register the app (the maintainer does this once)

Open <https://github.com/settings/apps/new> and fill in the form.

| Field | Value |
| --- | --- |
| GitHub App name | Branch Hop for Axiom Play |
| Homepage URL | `https://github.com/davidoliversteinberg/branch-hop` |
| Callback URL | Leave empty |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | Off |
| Enable Device Flow | On |
| Webhook › Active | Off |
| Repository permissions › Issues | Read and write |
| Repository permissions › Metadata | Read-only (selected automatically) |
| Every other permission | No access |
| Where can this GitHub App be installed? | Only on this account |

Click **Create GitHub App**. Don't generate a client secret or a private key. Device sign-in doesn't use them, so there's no secret to look after.

## 2. Install it on the shared repo

On the app's page, open **Install App**, click **Install**, choose **Only select repositories**, pick `branch-hop-shared`, and click **Install**.

## 3. Point Branch Hop at the app

The app's Client ID (it starts with `Iv`) is public, and it goes in the extension's GitHub settings in `src/shared/github.ts`. It can be looked up from the app's public page, so nobody needs to send it around.

## Adding teammates

Invite each person as a collaborator on two repos:

- `branch-hop`, so they can download releases
- `branch-hop-shared`, so they can see and share branches

They install the extension, click **Sign in with GitHub**, and approve the code GitHub shows them. Nobody has to approve anything else.

## What the app can and can't do

- It can read and write issues, labels and comments in `branch-hop-shared`, and only there.
- It can't read code, can't see `episerver` repos, and can't act anywhere it isn't installed.
- Sign-in tokens last 8 hours and renew themselves. A refresh token lasts up to 6 months and is replaced each time it's used. Signing out deletes both from the browser, and anyone can revoke the app under GitHub **Settings › Applications**.

## Later: Axiom Play data (v0.3)

Build status, PR titles, the full branch list, and "this branch was updated" notifications need read access to `episerver/axiom-play`. That will be a second app with read-only permissions, and an `episerver` org owner installs it once. Keeping it separate means the org never grants write access to anything.
