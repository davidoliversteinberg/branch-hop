# GitHub sign-in setup

Shared lists, comments and notifications use a GitHub App owned by the Branch Hop maintainer. A shared space is any repo named `branch-hop-shared` that the app is installed on: a personal one needs no approval, and an organization's needs one approval from an org owner.

Each shared branch is stored as an issue in that repo. The title is the branch, labels are lists, assignees are the people it's shared with, and comments are the conversation. GitHub's own notifications work on top of that.

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

## 2. Install it on the shared repo

On the app's page, open **Install App**, click **Install**, choose **Only select repositories**, pick `branch-hop-shared`, and click **Install**.

## 3. Point Branch Hop at the app

The app's Client ID (it starts with `Iv`) is public. It's set as `GITHUB.clientId` in `src/shared/github.ts`, along with the shared repo's owner and name. This is already done for the current app.

## Set up a team space in an organization

1. Create an **internal** repo named `branch-hop-shared` in the organization. Internal means every member can see it, so nobody needs inviting. (Done for `episerver`.)
2. Open the app's public install page, `https://github.com/apps/branch-hop/installations/new`, choose the organization, pick **Only select repositories** › `branch-hop-shared`, and submit. If you aren't an owner, GitHub sends the owners a request instead.
3. Once an owner approves, everyone in the organization sees the team space in Branch Hop after signing in.

## Adding teammates to a personal space

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
