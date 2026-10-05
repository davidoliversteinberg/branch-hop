# Joining the shared space

Shared branches live in a private repo, `davidoliversteinberg/branch-hop-shared`. It's private because branch names, notes and comments describe unreleased work. Only collaborators can see it, and only collaborators can use lists and "shared with", because those are issue labels and assignees.

GitHub has no join link for a repo, so Branch Hop makes asking one click and approving one reply.

## How someone joins

1. In Branch Hop, **Shared** (or **Settings**) shows **Request access** when you're not in a space yet. It opens a short form on the public `branch-hop` repo. Submitting it asks for the GitHub account that submits it.
2. The maintainer gets GitHub's usual notification and replies `/approve`.
3. A workflow sends the invite and closes the request. GitHub emails the invite too.
4. Click **Accept invite** in Branch Hop (or open the email). Shared fills in within a couple of minutes.

Nobody is added without the maintainer's reply. Anyone on GitHub can open a request, so approval stays manual.

## One-time setup for the maintainer

The workflow needs a token that can add collaborators to `branch-hop-shared`, and nothing else.

1. Open **GitHub › Settings › Developer settings › Fine-grained tokens › Generate new token**.
2. Name it `Branch Hop invites`. Set an expiry; a year is fine, and GitHub emails you before it runs out.
3. **Repository access:** Only select repositories › `branch-hop-shared`.
4. **Repository permissions:** Administration › **Read and write**. Leave everything else at No access.
5. Generate it and copy it.
6. In `branch-hop` › **Settings › Secrets and variables › Actions**, add a repository secret named `SHARED_INVITE_TOKEN` with the token as its value.
7. Create the `access-request` label once (Issues › Labels › New label), or let the first request create it.

Test it by opening a request from a second account, or ask a teammate to.

## Managing people

- **See who's in:** `branch-hop-shared` › Settings › Collaborators.
- **Remove someone:** remove them there. Their Shared tab empties at the next sync.
- **Invite someone directly:** add them there, with the Write role. That's all `/approve` does.
- **Decline a request:** close it with a short comment. Nothing is sent.

## What the workflow can do

It runs only for comments from the repo owner that start with `/approve`, on issues labeled `access-request`. It invites the person who opened the issue, never a name typed into it. Its token works on `branch-hop-shared` only: it can't read code, see other repos, or touch `episerver`. Administration is GitHub's smallest permission that can invite people, and it also covers that repo's settings, so keep the token in the Actions secret and nowhere else.
