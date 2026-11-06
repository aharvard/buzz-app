import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComposerInputElement } from "../../features/messages/composer-dom";
import {
  communityRequest,
  type CommunityInfo,
} from "../../features/communities/api";
import {
  DEFAULT_WELCOME_MESSAGE,
  defaultWelcomeTitle,
  WelcomeCard,
  WelcomeMessage,
} from "../../features/communities/WelcomeCard";
import { channelIcon } from "../../features/channels/channel-icon";
import { useChannelDirectory } from "../../features/channels/useChannelDirectory";
import {
  ChannelLifecycleUnconfirmed,
  type ChannelLifecycleCapability,
} from "../../features/relay/channel-lifecycle";
import type { WelcomeCommand } from "../../features/relay/channel-lifecycle-protocol";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import type { ChannelSummary } from "../../features/relay/contracts";
import { communityFromScope } from "../../features/relay/gifs";
import {
  normalizeWelcome,
  WELCOME_MAX_LENGTH,
  WELCOME_TITLE_MAX_LENGTH,
  welcomeTextProblem,
  welcomeTitleProblem,
} from "../../features/relay/landing";
import { PublishNotSent, PublishRejected } from "../../features/relay/outbox";
import {
  useChannelRoster,
  useRelayConnection,
} from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { matchName } from "../../features/search/match";
import { Button } from "../../shared/design-system/ui/Button";
import { ChoiceRow } from "../../shared/design-system/ui/ChoiceRow";
import { Combobox } from "../../shared/design-system/ui/Combobox";
import { Field } from "../../shared/design-system/ui/Field";
import { Header, InlineHeader } from "../../shared/design-system/ui/Header";
import { Input } from "../../shared/design-system/ui/Input";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import { WelcomeMessageEditor } from "./WelcomeMessageEditor";
import styles from "./WelcomeSettings.module.css";

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
const MAX = WELCOME_MAX_LENGTH.toLocaleString("en-US");
const TITLE_MAX = WELCOME_TITLE_MAX_LENGTH.toLocaleString("en-US");
// Every listed channel is an open stream, so each shows the public icon.
const ChannelIcon = channelIcon({ channelType: "stream" });

/**
 * The default message is never stored: a draft matching it restores it. The
 * default title is this viewer's name for the community, so it is never
 * inferred: an untouched title resends what is published, Restore defaults
 * (`null`) sends the default, and an edited title is sent as written.
 */
function commandFor(
  draft: Readonly<{ text: string; title?: string | null }>,
  publishedTitle: string,
): WelcomeCommand {
  const text = normalizeWelcome(draft.text);
  return {
    message: text === DEFAULT_WELCOME_MESSAGE ? "" : text,
    title:
      draft.title === undefined
        ? publishedTitle
        : draft.title === null
          ? ""
          : draft.title.trim(),
  };
}

/** What a definite failure means for the draft, which is always kept. */
function saveError(error: unknown) {
  if (error instanceof PublishNotSent) return "Not sent. Try again.";
  if (error instanceof PublishRejected) {
    const reason = error.reason?.replace(/^invalid:\s*/, "").trim();
    return reason
      ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`
      : "Only community owners and admins can change this.";
  }
  return message(error);
}

const problems = {
  empty: "Enter a welcome message, or restore the defaults.",
  long: `Shorten the message to ${MAX} characters.`,
  control: "Remove control characters. Line breaks and tabs are fine.",
};
const titleProblems = {
  empty: "Enter a title, or restore the defaults.",
  long: `Shorten the title to ${TITLE_MAX} characters.`,
  control: "Use one line of text for the title.",
};

/** Community settings: where new members start, what they read there, and
 * which other channels they join. */
export function WelcomeSettings({
  relay,
  communityName,
  active,
  extensions,
}: {
  relay: RelayData;
  communityName?: string | undefined;
  active(): boolean;
  /** The conversation renderers, so the preview draws links as the card does. */
  extensions?: ConversationExtensions | undefined;
}) {
  const connection = useRelayConnection(relay);
  const community =
    connection.status === "ready" && connection.scope
      ? communityFromScope(connection.scope)
      : null;
  return (
    <section aria-labelledby="welcome-settings-title">
      <Header
        id="welcome-settings-title"
        title="Welcome"
        subtitle="Choose the channel new members join and open first, the message they see there, and the other channels they join."
      />
      {community && connection.scope ? (
        <WelcomeEditor
          key={`${connection.scope}:${connection.generation}`}
          session={connection.session}
          scope={connection.scope}
          community={community}
          communityName={communityName}
          active={active}
          extensions={extensions}
        />
      ) : (
        <p role="status">Choose a connected community to set its welcome.</p>
      )}
    </section>
  );
}

/** The relay's current designation; `welcome` and `title` are `""` for the
 * defaults. */
type Published = Readonly<{
  channelId?: string;
  name?: string;
  welcome: string;
  title: string;
}>;
type Load =
  | { status: "loading" }
  | { status: "ready"; published: Published }
  | { status: "unsupported" }
  | { status: "error"; error: string };
type Option = Readonly<{
  id: string;
  name: string;
  autoJoin: boolean;
  /** In the viewer's roster, which follows the relay's metadata. */
  joined: boolean;
}>;
/** `title` is absent until edited; `null` once Restore defaults is pressed. */
type Draft = Readonly<{
  channelId?: string;
  text: string;
  title?: string | null;
}>;

/** Browsing with no search lists this many channels by name; a search covers
 * every channel, so a community with thousands still opens a short list. */
const BROWSE_LIMIT = 50;

/** The options whose names match `needle`, best first; for no needle, the
 * first {@link BROWSE_LIMIT} by name. */
function ranked(options: readonly Option[], needle: string) {
  if (!needle) return options.slice(0, BROWSE_LIMIT);
  return options
    .flatMap((option) => {
      const rank = matchName(option.name, needle)?.rank;
      return rank === undefined ? [] : [{ option, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ option }) => option);
}

/** Follows the results of a browse that {@link ranked} cut short. Like the
 * popup's empty line it stays mounted while the popup is open, so clearing a
 * search announces it. */
function BrowseLimit({ capped }: { capped: boolean }) {
  return (
    <div role="status" className="buzz-combobox-empty">
      {capped
        ? `Showing the first ${BROWSE_LIMIT} channels. Type a name to find more.`
        : null}
    </div>
  );
}

/** Open, active stream channels: the directory's, joined ones it may leave
 * out (such as unlisted ones), and the current welcome channel. The joined
 * list is live, so its flags win. */
function eligibleChannels(
  directory: ReturnType<typeof useChannelDirectory>["directory"],
  joined: readonly ChannelSummary[],
  current: Published | undefined,
) {
  const rows = new Map<string, Option>();
  for (const channel of directory)
    if (channel.channelType === "stream" && !channel.archived)
      rows.set(channel.id, {
        id: channel.id,
        name: channel.name,
        autoJoin: !!channel.autoJoin,
        joined: false,
      });
  for (const channel of joined)
    if (
      channel.channelType === "stream" &&
      channel.visibility === "public" &&
      !channel.archived &&
      !channel.huddle
    )
      rows.set(channel.id, {
        id: channel.id,
        name: channel.name,
        autoJoin: !!channel.autoJoin,
        joined: true,
      });
  const id = current?.channelId;
  if (id && !rows.has(id))
    rows.set(id, {
      id,
      name: current.name ?? id.slice(0, 8),
      autoJoin: false,
      joined: false,
    });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function WelcomeEditor({
  session,
  scope,
  community,
  communityName,
  active,
  extensions,
}: {
  session: RelaySession;
  scope: string;
  community: string;
  communityName?: string | undefined;
  active(): boolean;
  extensions: ConversationExtensions | undefined;
}) {
  const lifecycle = session.channelLifecycle;
  const defaultTitle = defaultWelcomeTitle(communityName);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>();
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  // The starter channel whose flag is being changed. The session runs one
  // channel command at a time, so Save waits for it and it waits for Save.
  const [toggling, setToggling] = useState<string>();
  const [error, setError] = useState("");
  // An unconfirmed publication: only a fresh read, never a repeat, settles it.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  // The check compares the relay's answer with the draft as it stands then.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const checkButton = useRef<HTMLButtonElement>(null);
  const messageInput = useRef<ComposerInputElement>(null);
  const mounted = useRef(true);
  const saveController = useRef<AbortController>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveController.current?.abort();
    };
  }, []);
  // Each open reads the live designation, then its signed welcome.
  useEffect(() => {
    const reading = new AbortController();
    // A check keeps the published form in view; only the first read waits.
    const check = attempt > 0;
    setLoad((current) =>
      check && current.status === "ready" ? current : { status: "loading" },
    );
    void (async () => {
      try {
        const info = await communityRequest<CommunityInfo>(
          community,
          "info",
          undefined,
          reading.signal,
        );
        reading.signal.throwIfAborted();
        if (!info.landingChannels) {
          setLoad({ status: "unsupported" });
          return;
        }
        const id = info.landingChannel;
        const state = id
          ? await lifecycle.readLanding(id, reading.signal)
          : undefined;
        reading.signal.throwIfAborted();
        const published: Published = {
          ...(id && state ? { channelId: id } : {}),
          ...(state?.name ? { name: state.name } : {}),
          welcome: (state?.landing && state.welcome) || "",
          title: (state?.landing && state.welcomeTitle) || "",
        };
        // A draft the relay now shows has landed; there is nothing to save.
        const current = draftRef.current;
        const wanted = current && commandFor(current, published.title);
        const landed =
          !!wanted &&
          current?.channelId === published.channelId &&
          wanted.message === published.welcome &&
          wanted.title === published.title;
        setLoad({ status: "ready", published });
        if (landed) {
          setDraft(undefined);
          setSaved(true);
        }
        setUnconfirmed(false);
        setChecking(false);
        // The Check again button leaves with its notice; stay in the form.
        if (check && document.activeElement === checkButton.current)
          messageInput.current?.focus({ preventScroll: true });
      } catch (reason) {
        if (reading.signal.aborted) return;
        setChecking(false);
        setLoad({ status: "error", error: message(reason) });
      }
    })();
    return () => reading.abort();
  }, [community, lifecycle, attempt]);
  const published = load.status === "ready" ? load.published : undefined;
  const listing = load.status === "ready" || load.status === "unsupported";
  const directory = useChannelDirectory(session.channels, listing);
  const roster = useChannelRoster(session.channels);
  const options = useMemo(
    () => eligibleChannels(directory.directory, roster.channels, published),
    [directory.directory, roster.channels, published],
  );
  const channelId = draft ? draft.channelId : published?.channelId;
  const text = draft?.text ?? (published?.welcome || DEFAULT_WELCOME_MESSAGE);
  const titleDraft = draft?.title;
  const title =
    typeof titleDraft === "string"
      ? titleDraft
      : titleDraft === null || !published?.title
        ? defaultTitle
        : published.title;
  const normalized = normalizeWelcome(text);
  const trimmedTitle = title.trim();
  const command = commandFor(
    { text, ...(titleDraft !== undefined ? { title: titleDraft } : {}) },
    published?.title ?? "",
  );
  const problem = welcomeTextProblem(normalized);
  // Only an edited title needs checking: a published one passed the relay, and
  // the default is never sent.
  const titleProblem =
    typeof titleDraft === "string"
      ? welcomeTitleProblem(trimmedTitle)
      : undefined;
  const dirty =
    !!published &&
    (channelId !== published.channelId ||
      command.message !== published.welcome ||
      command.title !== published.title);
  const selected = options.find((option) => option.id === channelId) ?? null;
  // The input shows the chosen name; browsing from there lists every channel.
  const needle = typed === selected?.name ? "" : typed.trim().toLowerCase();
  const matches = useMemo(() => ranked(options, needle), [options, needle]);
  const edit = (patch: Partial<Draft>) => {
    setDraft({
      ...(channelId ? { channelId } : {}),
      text,
      ...(titleDraft !== undefined ? { title: titleDraft } : {}),
      ...patch,
    });
    setSaved(false);
    setError("");
  };
  const disabled = saving || !published || !lifecycle.available;
  const starters = (
    <StarterChannels
      channels={options}
      welcomeChannel={
        published?.channelId
          ? options.find((option) => option.id === published.channelId)
          : undefined
      }
      lifecycle={lifecycle}
      active={() => mounted.current && active()}
      saving={saving}
      onPendingChange={setToggling}
      loading={directory.loading}
      failed={!!directory.error}
      // The welcome form offers this retry when it is shown.
      retry={load.status === "unsupported" ? directory.retry : undefined}
    />
  );
  return (
    <LoadingRegion
      pending={load.status === "loading"}
      label="Loading welcome settings…"
      feedback={
        load.status === "error" ? (
          <div>
            <p role="alert" className="error">
              Welcome settings couldn’t be loaded. {load.error}
            </p>
            <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Retry loading welcome settings
            </Button>
          </div>
        ) : load.status === "unsupported" ? (
          <p role="status">
            This community’s relay doesn’t support a welcome channel.
          </p>
        ) : undefined
      }
    >
      {load.status === "unsupported" ? (
        starters
      ) : (
        <div
          className={styles.editor}
          data-placeholder={!published || undefined}
          inert={!published}
          aria-hidden={!published || undefined}
        >
          <SettingsGroup layout="form">
            <form
              className={styles.fields}
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  disabled ||
                  !dirty ||
                  !channelId ||
                  problem ||
                  titleProblem ||
                  toggling
                )
                  return;
                const target = channelId;
                const sent = command;
                const name = options.find(
                  (option) => option.id === target,
                )?.name;
                const owner = new AbortController();
                saveController.current = owner;
                setSaving(true);
                setSaved(false);
                setError("");
                void (async () => {
                  try {
                    await lifecycle.setLanding(
                      target,
                      sent,
                      owner.signal,
                      () => mounted.current && active(),
                    );
                    if (!mounted.current) return;
                    setLoad({
                      status: "ready",
                      published: {
                        channelId: target,
                        ...(name ? { name } : {}),
                        welcome: sent.message,
                        title: sent.title,
                      },
                    });
                    setDraft(undefined);
                    setSaved(true);
                  } catch (reason) {
                    if (!mounted.current || owner.signal.aborted) return;
                    if (reason instanceof ChannelLifecycleUnconfirmed)
                      setUnconfirmed(true);
                    else setError(saveError(reason));
                  } finally {
                    if (mounted.current) setSaving(false);
                  }
                })();
              }}
            >
              <Combobox.Root<Option>
                items={options}
                filteredItems={matches}
                // Until something is typed, a field showing the chosen name
                // lists `items` instead of `filteredItems`; cap that browse too.
                limit={BROWSE_LIMIT}
                value={selected}
                onValueChange={(option) => {
                  if (option) edit({ channelId: option.id });
                }}
                onInputValueChange={setTyped}
                itemToStringLabel={(option) => option.name}
                itemToStringValue={(option) => option.id}
                isItemEqualToValue={(a, b) => a.id === b.id}
                disabled={disabled}
                autoHighlight
              >
                <Combobox.Control
                  label="Welcome channel"
                  triggerLabel="Browse channels"
                  placeholder="Choose a public channel"
                  leading={
                    selected ? (
                      <ChannelIcon size={18} aria-hidden="true" />
                    ) : undefined
                  }
                  loading={directory.loading}
                  description="New members join this channel and open it first. People already in the community keep their channels."
                  error={
                    directory.error
                      ? "Public channels couldn’t be loaded."
                      : undefined
                  }
                />
                <Combobox.Popup
                  empty={
                    directory.loading
                      ? "Loading channels…"
                      : "No matching public channels."
                  }
                >
                  <Combobox.List>
                    {(option: Option) => (
                      <Combobox.Item key={option.id} value={option}>
                        <ChoiceRow
                          leading={<ChannelIcon size={18} />}
                          label={option.name}
                        />
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                  <BrowseLimit
                    capped={!needle && options.length > BROWSE_LIMIT}
                  />
                </Combobox.Popup>
              </Combobox.Root>
              {directory.error && (
                <div>
                  <Button type="button" onClick={directory.retry}>
                    Retry loading channels
                  </Button>
                </div>
              )}
              <Field
                label="Title"
                description={`${[...trimmedTitle].length.toLocaleString("en-US")} of ${TITLE_MAX} characters`}
                error={titleProblem && titleProblems[titleProblem]}
              >
                <Input
                  disabled={disabled}
                  value={title}
                  onChange={(event) => edit({ title: event.target.value })}
                />
              </Field>
              <WelcomeMessageEditor
                ref={messageInput}
                label="Message"
                description={
                  <>
                    Format with the toolbar or Markdown. To link a channel or
                    person, paste a copied channel link or npub.{" "}
                    <span>
                      {[...normalized].length.toLocaleString("en-US")} of {MAX}{" "}
                      characters
                    </span>
                  </>
                }
                error={problem && problems[problem]}
                value={text}
                onChange={(body) => edit({ text: body })}
                disabled={disabled}
                session={session}
                scope={scope}
                channelId={channelId ?? ""}
              />
              {(normalized !== DEFAULT_WELCOME_MESSAGE || command.title) && (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      edit({ text: DEFAULT_WELCOME_MESSAGE, title: null })
                    }
                  >
                    Restore defaults
                  </Button>
                </div>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {unconfirmed && (
                <div role="alert" className={styles.unconfirmed}>
                  <p className="error">
                    Not confirmed yet. The relay hasn’t shown this change; check
                    before saving again.
                  </p>
                  <div>
                    <Button
                      ref={checkButton}
                      type="button"
                      loading={checking}
                      onClick={() => {
                        setChecking(true);
                        setAttempt((n) => n + 1);
                      }}
                    >
                      Check again
                    </Button>
                  </div>
                </div>
              )}
              {draft && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDraft(undefined);
                      setError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={saving}
                    disabled={
                      !dirty ||
                      !channelId ||
                      !!problem ||
                      !!titleProblem ||
                      !lifecycle.available ||
                      unconfirmed ||
                      !!toggling
                    }
                  >
                    Save
                  </Button>
                </div>
              )}
              {saved && (
                <ToastNotice
                  title="Welcome saved"
                  tone="success"
                  timeout={5000}
                  onDismiss={() => setSaved(false)}
                />
              )}
            </form>
          </SettingsGroup>
          <div className={styles.preview}>
            <InlineHeader
              title="Preview"
              subtitle="Everyone sees this at the start of the welcome channel."
            />
            <WelcomeCard level={4} title={command.title || defaultTitle}>
              <WelcomeMessage
                message={command.message || undefined}
                session={session}
                scope={scope}
                channelId={channelId ?? ""}
                extensions={extensions}
                onOpenLink={() => false}
                interactive={false}
              />
            </WelcomeCard>
          </div>
          {starters}
        </div>
      )}
    </LoadingRegion>
  );
}

/** A starter's flag as this card knows it: a joined channel's follows the
 * roster; another's, the change confirmed here until the directory shows it. */
const starter = (channel: Option, confirmed: ReadonlyMap<string, boolean>) =>
  channel.joined
    ? channel.autoJoin
    : (confirmed.get(channel.id) ?? channel.autoJoin);

/**
 * Connected objects: the channels whose relay `auto_join` flag is on, each
 * removable at once, and a search that adds another. Only flagged channels are
 * listed, so the list stays short however many channels the community has.
 * Each change shows once a signed readback confirms it. Community owners and
 * admins may also flag channels they have not joined. The welcome channel is
 * always joined first, so its row is fixed and its own flag is left as it is.
 */
function StarterChannels({
  channels,
  welcomeChannel,
  lifecycle,
  active,
  saving,
  onPendingChange,
  loading,
  failed,
  retry,
}: {
  channels: readonly Option[];
  welcomeChannel?: Option | undefined;
  lifecycle: ChannelLifecycleCapability;
  active(): boolean;
  saving: boolean;
  onPendingChange(id: string | undefined): void;
  loading: boolean;
  failed: boolean;
  /** Offered here only when nothing else on the card offers it. */
  retry?: (() => void) | undefined;
}) {
  const heading = useId();
  const addInput = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  // The change the relay is confirming. The session runs one channel command
  // at a time, so Save waits for it and it waits for Save.
  const [change, setChange] =
    useState<Readonly<{ id: string; enabled: boolean }>>();
  const [confirmed, setConfirmed] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  // Failed removals, beside their rows; a failed addition has no row, so its
  // reason shows on the add control.
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [addError, setAddError] =
    useState<Readonly<{ id: string; message: string }>>();
  // The last confirmed change, announced until the next one starts.
  const [notice, setNotice] = useState<string>();
  const operation = useRef<AbortController>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  // A kept state is dropped once the row agrees, or turns out to be joined.
  useEffect(() => {
    setConfirmed((current) => {
      let next: Map<string, boolean> | undefined;
      for (const [id, enabled] of current) {
        const row = channels.find((channel) => channel.id === id);
        if (row && (row.joined || row.autoJoin === enabled)) {
          next ??= new Map(current);
          next.delete(id);
        }
      }
      return next ?? current;
    });
  }, [channels]);
  // A channel being added shows while the relay confirms it, as one being
  // removed stays until it has.
  const { starters, addable } = useMemo(() => {
    const starters: Option[] = [];
    const addable: Option[] = [];
    for (const channel of channels)
      if (channel.id !== welcomeChannel?.id)
        (starter(channel, confirmed) || channel.id === change?.id
          ? starters
          : addable
        ).push(channel);
    return { starters, addable };
  }, [channels, welcomeChannel?.id, confirmed, change?.id]);
  const needle = typed.trim().toLowerCase();
  const matches = useMemo(() => ranked(addable, needle), [addable, needle]);
  const capped = !needle && addable.length > BROWSE_LIMIT;
  const failedAdd =
    addError && !starters.some((channel) => channel.id === addError.id)
      ? `#${channels.find((channel) => channel.id === addError.id)?.name ?? addError.id.slice(0, 8)}: ${addError.message}`
      : undefined;
  const busy = saving || change !== undefined || !lifecycle.available;
  const toggle = async (
    { id, name }: Option,
    enabled: boolean,
    trigger?: HTMLElement,
  ) => {
    if (operation.current || saving) return;
    const controller = new AbortController();
    operation.current = controller;
    setChange({ id, enabled });
    onPendingChange(id);
    setNotice(undefined);
    if (enabled) setAddError(undefined);
    setErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    try {
      await lifecycle.run(
        enabled ? "auto-join-on" : "auto-join-off",
        id,
        controller.signal,
        active,
      );
      // The removed row leaves with its button; focus stays in the list.
      if (trigger && document.activeElement === trigger)
        addInput.current?.focus({ preventScroll: true });
      setConfirmed((current) => new Map(current).set(id, enabled));
      setNotice(`${enabled ? "Added" : "Removed"} #${name}`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      // Setting the same value again is idempotent, so retrying is the check.
      const message =
        reason instanceof ChannelLifecycleUnconfirmed
          ? "Saved, but not confirmed yet. Try again to check."
          : saveError(reason);
      if (enabled) setAddError({ id, message });
      else setErrors((current) => new Map(current).set(id, message));
    } finally {
      operation.current = undefined;
      setChange(undefined);
      // The form may outlive this list, as when a check finds no support.
      onPendingChange(undefined);
    }
  };
  const empty = starters.length
    ? undefined
    : loading
      ? "Loading channels…"
      : failed
        ? undefined
        : welcomeChannel
          ? "No other channels added yet"
          : "No channels added yet";
  return (
    <section aria-labelledby={heading} className={styles.preview}>
      <InlineHeader
        id={heading}
        title="Also add new members to"
        subtitle="A channel you add applies to people who join from now on, not people already in the community. In an open community, it also adds people who come back and have never been in that channel."
      />
      {(welcomeChannel || starters.length > 0 || empty) && (
        <SettingsGroup>
          {welcomeChannel && (
            <PreferenceRow
              icon={<ChannelIcon />}
              title={welcomeChannel.name}
              subtitle="Welcome channel · always joined"
            />
          )}
          {starters.map((channel) => {
            const adding = change?.id === channel.id && change.enabled;
            const removing = change?.id === channel.id && !change.enabled;
            const error = errors.get(channel.id);
            return (
              <Fragment key={channel.id}>
                <PreferenceRow
                  icon={<ChannelIcon />}
                  title={channel.name}
                  subtitle={adding ? "Adding…" : undefined}
                  trailing={
                    <Button
                      variant="outline"
                      loading={removing}
                      disabled={busy && !removing}
                      aria-label={`Remove #${channel.name} from starter channels`}
                      onClick={(event) =>
                        void toggle(channel, false, event.currentTarget)
                      }
                    >
                      Remove
                    </Button>
                  }
                />
                {error && (
                  <p role="alert" className="buzz-field-error">
                    {error}
                  </p>
                )}
              </Fragment>
            );
          })}
          {empty && (
            <PreferenceRow title={<span role="status">{empty}</span>} />
          )}
        </SettingsGroup>
      )}
      <Combobox.Root<Option>
        items={addable}
        filteredItems={matches}
        value={null}
        inputValue={typed}
        onInputValueChange={(next, details) => {
          if (
            details.reason === "input-change" ||
            details.reason === "input-clear"
          )
            setTyped(next);
        }}
        onValueChange={(option) => {
          if (!option) return;
          setTyped("");
          void toggle(option, true);
        }}
        itemToStringLabel={(option) => option.name}
        itemToStringValue={(option) => option.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        disabled={!lifecycle.available}
        autoHighlight
      >
        <Combobox.Control
          ref={addInput}
          label="Add a channel"
          triggerLabel="Browse channels to add"
          placeholder="Search public channels"
          loading={loading}
          error={
            failedAdd ??
            (failed ? "Public channels couldn’t be loaded." : undefined)
          }
        />
        <Combobox.Popup
          empty={loading ? "Loading channels…" : "No matching public channels."}
        >
          <Combobox.List>
            {(option: Option) => (
              <Combobox.Item key={option.id} value={option} disabled={busy}>
                <ChoiceRow
                  leading={<ChannelIcon size={18} />}
                  label={option.name}
                />
              </Combobox.Item>
            )}
          </Combobox.List>
          <BrowseLimit capped={capped} />
        </Combobox.Popup>
      </Combobox.Root>
      {failed && retry && (
        <div>
          <Button type="button" onClick={retry}>
            Retry loading channels
          </Button>
        </div>
      )}
      {notice && (
        <ToastNotice
          title={notice}
          tone="success"
          timeout={5000}
          onDismiss={() => setNotice(undefined)}
        />
      )}
    </section>
  );
}
