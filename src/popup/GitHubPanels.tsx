import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Box, Button, Checkbox, Field, Group, Input, SegmentedControl, SegmentedControlItem, Switch, Text, Textarea, toaster } from "@optiaxiom/react";
import { IconArrowUpRightFromSquare } from "@optiaxiom/icons";
import { COMMENT_MAX, LOGIN_RE, SHARED_NOTE_MAX, SHARE_PEOPLE_MAX, SPACE_OWNER, SPACE_URL, SHARED_REPO_NAME, cleanListName, isSharedIssueUrl, isSsoUrl, type IssueComment, type SharedBranch } from "../shared/github.ts";
import type { AuthStatus, SharedState, Space } from "../shared/messages.ts";
import { setMuted } from "../shared/store";
import { ViewHeader } from "./BranchBits";
import { ago } from "./items";
import { send } from "./useGitHub";

const VERIFY_URL = "https://github.com/login/device";
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/* Signed out, or waiting for the code to be approved */
export function SignInCard({ auth, onSignIn }: { auth: AuthStatus; onSignIn: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);

  useEffect(() => {
    if (auth.state !== "pending") return;
    const tick = () => setMinutesLeft(Math.max(0, Math.ceil((auth.expiresAt - Date.now()) / 60000)));
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, [auth]);

  if (auth.state === "pending") {
    const copyAndOpen = async () => {
      try {
        await navigator.clipboard.writeText(auth.userCode);
      } catch {
        // Still open GitHub; the code stays visible here.
      }
      await chrome.tabs.create({ url: VERIFY_URL });
    };
    return (
      <Box px="16" py="16" display="flex" flexDirection="column" gap="12">
        <Text fontWeight="500">Approve Branch Hop on GitHub</Text>
        <Text fontSize="sm" color="fg.secondary">
          Copy this code and paste it on GitHub's Device activation page. If GitHub asks you to sign in first, do that, then paste the code. Branch Hop finishes signing in on its own.
        </Text>
        <Text fontFamily="mono" fontSize="2xl" fontWeight="500" aria-label={`Sign-in code ${auth.userCode.split("").join(" ")}`}>
          {auth.userCode}
        </Text>
        <Group gap="8">
          <Button appearance="primary" onClick={() => void copyAndOpen()}>
            Copy code and open GitHub
          </Button>
          <Button appearance="subtle" onClick={() => void send({ type: "auth-cancel" })}>
            Cancel
          </Button>
        </Group>
        <Text fontSize="sm" color="fg.tertiary">
          Waiting for approval. The code works for {minutesLeft} more {minutesLeft === 1 ? "minute" : "minutes"}.
        </Text>
      </Box>
    );
  }

  return (
    <Box px="16" py="16" display="flex" flexDirection="column" gap="8" alignItems="start">
      <Text fontWeight="500">Share branches with your team</Text>
      <Text fontSize="sm" color="fg.secondary">
        Sign in with GitHub to see branches teammates share with you, share your own, and comment on them. Branch Hop only reads and writes issues in {SPACE_OWNER}/{SHARED_REPO_NAME}.
      </Text>
      {auth.state === "signed-out" && auth.message && (
        <Text fontSize="sm" color="fg.warning.strong">
          {auth.message}
        </Text>
      )}
      <Box pt="4">
        <Button
          appearance="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            onSignIn()
              .catch((err) => toaster.create(errorText(err), { intent: "danger" }))
              .finally(() => setBusy(false));
          }}
        >
          Sign in with GitHub
        </Button>
      </Box>
    </Box>
  );
}

/* When the shared repo can't be read */
export function AccessCard({ shared, onRetry }: { shared: SharedState; onRetry: () => void }) {
  const sso = shared.spaces.find((sp) => sp.status === "sso");
  const copy: Record<string, [string, string]> = {
    "no-permission": ["Sharing isn't set up yet", `Branch Hop's GitHub App needs to be installed on ${SPACE_OWNER}/${SHARED_REPO_NAME}. The maintainer does this once.`],
    sso: ["Single sign-on needed", "Your organization asks you to sign in with its single sign-on before Branch Hop can read shared branches."],
    "rate-limited": ["GitHub needs a short break", "GitHub's rate limit was reached. Branch Hop will try again in a few minutes."],
    offline: ["Branch Hop can't reach GitHub", shared.message ?? "Check your connection and try again."],
  };
  const [title, body] = copy[sso ? "sso" : shared.status] ?? copy.offline;
  return (
    <Box px="16" py="16" display="flex" flexDirection="column" gap="8" alignItems="start">
      <Text fontWeight="500">{title}</Text>
      <Text fontSize="sm" color="fg.secondary">
        {body}
      </Text>
      <Group gap="8" pt="4">
        {sso?.ssoUrl && isSsoUrl(sso.ssoUrl) && (
          <Button appearance="primary" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => void chrome.tabs.create({ url: sso.ssoUrl })}>
            Sign in with SSO
          </Button>
        )}
        <Button appearance="default" onClick={onRetry}>
          Try again
        </Button>
      </Group>
    </Box>
  );
}

/** A slim notice above the list when one space needs single sign-on but others work. */
export function SsoNotice({ space }: { space: Space }) {
  if (!space.ssoUrl || !isSsoUrl(space.ssoUrl)) return null;
  return (
    <Group justifyContent="space-between" alignItems="center" gap="8" px="8" pb="4">
      <Text fontSize="sm" color="fg.warning.strong">
        {space.owner} needs single sign-on
      </Text>
      <Button appearance="subtle" size="sm" icon={<IconArrowUpRightFromSquare />} iconPosition="end" onClick={() => void chrome.tabs.create({ url: space.ssoUrl })}>
        Sign in
      </Button>
    </Group>
  );
}

/* Share a branch with people and lists */
export type ShareTarget = { key: string; name?: string; title: string; route: string; note?: string };

export function SharePanel({ target, spaces, items, me, onClose }: { target: ShareTarget; spaces: Space[]; items: SharedBranch[]; me: string; onClose: () => void }) {
  const usable = spaces.filter((sp) => sp.status === "ok");
  const mine = (sp: Space) => items.find((i) => i.space === sp.owner && i.key === target.key && i.sharedBy === me);
  const [owner, setOwner] = useState((usable.find((sp) => mine(sp)) ?? usable[0])?.owner ?? "");
  const space = usable.find((sp) => sp.owner === owner);
  if (!space) {
    return (
      <>
        <ViewHeader title={`Share ${target.title}`} onBack={onClose} />
        <Box px="16" py="16" display="flex" flexDirection="column" gap="8" alignItems="start">
          <Text fontWeight="500">Sharing isn't available right now</Text>
          <Text fontSize="sm" color="fg.secondary">
            Branch Hop couldn't read {SPACE_OWNER}/{SHARED_REPO_NAME} on its last sync. Open the Shared tab and click Try again.
          </Text>
          <Button appearance="default" onClick={onClose}>
            Back
          </Button>
        </Box>
      </>
    );
  }
  return (
    <ShareForm
      key={space.owner}
      target={target}
      space={space}
      existing={mine(space)}
      me={me}
      onClose={onClose}
      picker={
        usable.length > 1 ? (
          <SegmentedControl type="single" value={owner} aria-label="Share in" onValueChange={(v: string) => v && setOwner(v)}>
            {usable.map((sp) => (
              <SegmentedControlItem key={sp.owner} value={sp.owner} style={{ flex: 1 }}>
                {sp.org ? sp.owner : sp.owner === me ? "Your space" : `${sp.owner}'s space`}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        ) : null
      }
    />
  );
}

function ShareForm({
  target,
  space,
  existing,
  me,
  onClose,
  picker,
}: {
  target: ShareTarget;
  space: Space;
  existing?: SharedBranch;
  me: string;
  onClose: () => void;
  picker: ReactNode;
}) {
  const people = space.people;
  const lists = space.lists;
  const already = useMemo(() => new Set(existing?.sharedWith ?? []), [existing]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [chosenLists, setChosenLists] = useState<Set<string>>(new Set(existing?.lists ?? []));
  const [extraPeople, setExtraPeople] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const others = useMemo(() => {
    const known = people.filter((p) => p.login !== me);
    return [...known, ...extraPeople.filter((l) => !known.some((p) => p.login === l)).map((login) => ({ login }) as { login: string; name?: string })];
  }, [people, me, extraPeople]);
  const addPerson = () => {
    const login = username.trim().replace(/^@/, "");
    if (!LOGIN_RE.test(login)) {
      toaster.create("That isn't a GitHub username.", { intent: "warning" });
      return;
    }
    if (login.toLowerCase() === me.toLowerCase()) return setUsername("");
    if (chosen.size + already.size >= SHARE_PEOPLE_MAX) {
      toaster.create(`You can share with up to ${SHARE_PEOPLE_MAX} people.`, { intent: "warning" });
      return;
    }
    setExtraPeople((l) => (l.includes(login) ? l : [...l, login]));
    setChosen((s) => new Set(s).add(login));
    setUsername("");
  };
  const [newList, setNewList] = useState("");
  const [note, setNote] = useState(existing?.note ?? target.note ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const extra = newList.trim() ? cleanListName(newList) : null;
    if (newList.trim() && !extra) {
      toaster.create("List names can use letters, numbers, spaces and - _ . & ' (up to 40 characters).", { intent: "warning" });
      return;
    }
    setBusy(true);
    try {
      await send({
        type: "share",
        space: space.owner,
        key: target.key,
        name: target.name,
        route: target.route,
        note,
        lists: [...new Set([...chosenLists, ...(extra ? [extra] : [])])],
        people: [...chosen],
      });
      const who = [...chosen];
      toaster.create(who.length ? `Shared ${target.title} with ${who.map((l) => `@${l}`).join(", ")}` : `Shared ${target.title}`, { intent: "success" });
      onClose();
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    if (!existing) return;
    setBusy(true);
    try {
      await send({ type: "unshare", space: space.owner, issue: existing.number });
      toaster.create(`Stopped sharing ${target.title}`);
      onClose();
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <ViewHeader title={`${existing ? "Update sharing" : "Share"} ${target.title}`} onBack={onClose} />
    <Box asChild display="flex" flexDirection="column" gap="16" px="16" py="12" overflow="auto" style={{ flex: "1 1 auto", minHeight: 0 }}>
      <form onSubmit={(e) => void submit(e)}>
        <Box display="flex" flexDirection="column" gap="4">
          <Text fontSize="sm" fontFamily="mono" color="fg.secondary" truncate title={target.route}>
            {target.route}
          </Text>
          <Text fontSize="sm" color="fg.warning.strong">
            Shares are public issues on GitHub. Anyone on the internet can read them and their comments. The preview itself still needs a Vercel login.
          </Text>
        </Box>

        {picker}

        <Box display="flex" flexDirection="column" gap="8">
          <Text fontSize="sm" fontWeight="500">
            People
          </Text>
          {others.map((p) => (
            <Checkbox
              key={p.login}
              checked={already.has(p.login) || chosen.has(p.login)}
              disabled={already.has(p.login)}
              description={already.has(p.login) ? "Already shared" : undefined}
              onCheckedChange={(on) => setChosen((s) => toggle(s, p.login, on))}
            >
              {p.name ? `${p.name} (@${p.login})` : `@${p.login}`}
            </Checkbox>
          ))}
          <Field label="Add someone" description="Their GitHub username. GitHub notifies them.">
            <Group gap="8">
              <Input
                value={username}
                maxLength={40}
                placeholder="e.g. bigmonkiki"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPerson();
                  }
                }}
                style={{ flex: 1 }}
              />
              <Button appearance="default" onClick={addPerson} disabled={!username.trim()}>
                Add
              </Button>
            </Group>
          </Field>
        </Box>

        <Box display="flex" flexDirection="column" gap="8">
          <Text fontSize="sm" fontWeight="500">
            Lists
          </Text>
          {lists.map((l) => (
            <Checkbox key={l.name} checked={chosenLists.has(l.name)} onCheckedChange={(on) => setChosenLists((s) => toggle(s, l.name, on))}>
              {l.name}
            </Checkbox>
          ))}
          <Field label="New list">
            <Input value={newList} maxLength={40} placeholder="e.g. Opal review" onChange={(e) => setNewList(e.target.value)} />
          </Field>
        </Box>

        <Field label="Note" description="Public, like everything shared. Leave out customer names and anything confidential.">
          <Textarea value={note} maxLength={SHARED_NOTE_MAX} maxRows={4} placeholder="What should people look at?" onChange={(e) => setNote(e.target.value)} />
        </Field>

        <Group gap="8" alignItems="center">
          {existing &&
            (confirmStop ? (
              <Group gap="8" alignItems="center">
                <Button appearance="danger" size="sm" loading={busy} onClick={() => void stopSharing()}>
                  Stop sharing for everyone
                </Button>
                <Button appearance="subtle" size="sm" onClick={() => setConfirmStop(false)}>
                  Keep
                </Button>
              </Group>
            ) : (
              <Button appearance="danger-outline" size="sm" onClick={() => setConfirmStop(true)}>
                Stop sharing
              </Button>
            ))}
          <Box style={{ flex: 1 }} />
          <Button appearance="primary" type="submit" loading={busy && !confirmStop}>
            {existing ? "Update" : "Share"}
          </Button>
        </Group>
      </form>
    </Box>
    </>
  );
}

/* The conversation about one shared branch */
export function CommentsPanel({ shared, title, me, muted, onClose }: { shared: SharedBranch; title: string; me: string; muted: boolean; onClose: () => void }) {
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    send<IssueComment[]>({ type: "comments", space: shared.space, issue: shared.number }).then(setComments, (err) => setError(errorText(err)));
  }, [shared.space, shared.number]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [comments]);

  async function post(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const comment = await send<IssueComment>({ type: "comment", space: shared.space, issue: shared.number, body });
      setComments((list) => [...(list ?? []), comment]);
      setDraft("");
    } catch (err) {
      toaster.create(errorText(err), { intent: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const sharedWith = shared.sharedWith.filter((l) => l !== shared.sharedBy);
  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: 0, flex: "1 1 auto" }}>
      <ViewHeader
        title={title}
        onBack={onClose}
        end={
          <Button
            appearance="subtle"
            size="sm"
            icon={<IconArrowUpRightFromSquare />}
            iconPosition="end"
            onClick={() => {
              if (isSharedIssueUrl(shared.url)) void chrome.tabs.create({ url: shared.url });
            }}
          >
            GitHub
          </Button>
        }
      />
      <Box px="16" pt="8" pb="12" display="flex" flexDirection="column" gap="4" borderB="1" borderColor="border.secondary">
        <Text fontSize="sm" color="fg.secondary">
          Shared by @{shared.sharedBy}
          {sharedWith.length ? ` with ${sharedWith.map((l) => `@${l}`).join(", ")}` : ""}
        </Text>
        {shared.note && (
          <Text fontSize="sm" style={{ whiteSpace: "pre-wrap" }}>
            {shared.note}
          </Text>
        )}
      </Box>

      <Box px="16" py="12" display="flex" flexDirection="column" gap="16" overflow="auto" style={{ flex: "1 1 auto", minHeight: 120, maxHeight: 300 }}>
        {error && (
          <Text fontSize="sm" color="fg.error">
            {error}
          </Text>
        )}
        {!error && comments === null && (
          <Text fontSize="sm" color="fg.secondary">
            Loading comments…
          </Text>
        )}
        {comments?.length === 0 && (
          <Text fontSize="sm" color="fg.secondary">
            No comments yet. Start the conversation.
          </Text>
        )}
        {comments?.map((c) => (
          <Group key={c.id} gap="8" alignItems="start">
            <Avatar size="sm" name={c.author} src={c.avatarUrl} />
            <Box display="flex" flexDirection="column" gap="2" style={{ minWidth: 0, flex: 1 }}>
              <Group gap="8" alignItems="center">
                <Text fontSize="sm" fontWeight="500">
                  {c.author === me ? "You" : `@${c.author}`}
                </Text>
                <Text fontSize="sm" color="fg.tertiary">
                  {ago(Date.parse(c.createdAt))}
                </Text>
              </Group>
              <Text fontSize="md" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {c.body}
              </Text>
            </Box>
          </Group>
        ))}
        <div ref={endRef} />
      </Box>

      <Box asChild px="12" py="8" display="flex" flexDirection="column" gap="8" borderT="1" borderColor="border.secondary">
        <form onSubmit={(e) => void post(e)}>
          <Field label="Add a comment" description="Comments are public on GitHub.">
            <Textarea
              value={draft}
              maxLength={COMMENT_MAX}
              maxRows={4}
              placeholder="Write a comment"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
              }}
            />
          </Field>
          <Group justifyContent="space-between" alignItems="center" gap="8">
            <Switch checked={!muted} onCheckedChange={(on) => void setMuted(shared.key, !on)}>
              Notify me about new comments
            </Switch>
            <Button appearance="primary" type="submit" disabled={!draft.trim()} loading={busy}>
              Comment
            </Button>
          </Group>
        </form>
      </Box>
    </Box>
  );
}
