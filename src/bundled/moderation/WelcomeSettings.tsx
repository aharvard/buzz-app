import { useEffect, useMemo, useRef, useState } from "react";
import {
  communityRequest,
  type CommunityInfo,
} from "../../features/communities/api";
import {
  DEFAULT_WELCOME_MESSAGE,
  WelcomeCard,
} from "../../features/communities/WelcomeCard";
import { useChannelDirectory } from "../../features/channels/useChannelDirectory";
import { ChannelLifecycleUnconfirmed } from "../../features/relay/channel-lifecycle";
import { communityFromScope } from "../../features/relay/gifs";
import {
  normalizeWelcome,
  WELCOME_MAX_LENGTH,
  welcomeTextProblem,
} from "../../features/relay/landing";
import { PublishNotSent, PublishRejected } from "../../features/relay/outbox";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { matchName } from "../../features/search/match";
import { Button } from "../../shared/design-system/ui/Button";
import { Combobox } from "../../shared/design-system/ui/Combobox";
import { Field } from "../../shared/design-system/ui/Field";
import { Header, InlineHeader } from "../../shared/design-system/ui/Header";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import styles from "./WelcomeSettings.module.css";

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
const MAX = WELCOME_MAX_LENGTH.toLocaleString("en-US");

/** The default is never stored: a draft matching it restores the default. */
const commandFor = (text: string) => {
  const normalized = normalizeWelcome(text);
  return normalized === DEFAULT_WELCOME_MESSAGE ? "" : normalized;
};

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
  empty: "Enter a welcome message, or restore the default.",
  long: `Shorten the message to ${MAX} characters.`,
  control: "Use plain text. Line breaks are the only formatting.",
};

/** Community settings: where new members start and what they read there. */
export function WelcomeSettings({
  relay,
  communityName,
  active,
}: {
  relay: RelayData;
  communityName?: string | undefined;
  active(): boolean;
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
        subtitle="Choose the channel new members join and open first, and the message they see there."
      />
      {community ? (
        <WelcomeForm
          key={`${connection.scope}:${connection.generation}`}
          session={connection.session}
          community={community}
          communityName={communityName}
          active={active}
        />
      ) : (
        <p role="status">Choose a connected community to set its welcome.</p>
      )}
    </section>
  );
}

/** The relay's current designation; `welcome` is `""` for the default. */
type Published = Readonly<{ channelId?: string; name?: string; welcome: string }>;
type Load =
  | { status: "loading" }
  | { status: "ready"; published: Published }
  | { status: "unsupported" }
  | { status: "error"; error: string };
type Option = Readonly<{ id: string; name: string }>;

function WelcomeForm({
  session,
  community,
  communityName,
  active,
}: {
  session: RelaySession;
  community: string;
  communityName?: string | undefined;
  active(): boolean;
}) {
  const lifecycle = session.channelLifecycle;
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<{ channelId?: string; text: string }>();
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // An unconfirmed publication: only a fresh read, never a repeat, settles it.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  const saveController = useRef<AbortController>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveController.current?.abort();
    };
  }, []);
  // Each open reads the live designation, then its signed message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry reruns this finite read.
  useEffect(() => {
    const reading = new AbortController();
    setLoad({ status: "loading" });
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
        };
        setLoad({ status: "ready", published });
        // A draft the relay now shows has landed; there is nothing to save.
        setDraft((current) =>
          current &&
          current.channelId === published.channelId &&
          commandFor(current.text) === published.welcome
            ? undefined
            : current,
        );
        setUnconfirmed(false);
      } catch (reason) {
        if (!reading.signal.aborted)
          setLoad({ status: "error", error: message(reason) });
      }
    })();
    return () => reading.abort();
  }, [community, lifecycle, attempt]);
  const published = load.status === "ready" ? load.published : undefined;
  const directory = useChannelDirectory(session.channels, !!published);
  const options = useMemo(() => {
    const rows: Option[] = directory.directory
      .filter((channel) => channel.channelType === "stream" && !channel.archived)
      .map(({ id, name }) => ({ id, name }));
    // The current welcome channel may be unlisted from the directory.
    const current = published?.channelId;
    if (current && !rows.some((row) => row.id === current))
      rows.unshift({
        id: current,
        name: published.name ?? current.slice(0, 8),
      });
    return rows;
  }, [directory.directory, published]);
  const channelId = draft ? draft.channelId : published?.channelId;
  const text = draft?.text ?? (published?.welcome || DEFAULT_WELCOME_MESSAGE);
  const normalized = normalizeWelcome(text);
  const command = commandFor(text);
  const problem = welcomeTextProblem(normalized);
  const dirty =
    !!published &&
    (channelId !== published.channelId || command !== published.welcome);
  const selected = options.find((option) => option.id === channelId) ?? null;
  // The input shows the chosen name; browsing from there lists every channel.
  const needle = typed === selected?.name ? "" : typed.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? options
            .flatMap((option) => {
              const rank = matchName(option.name, needle)?.rank;
              return rank === undefined ? [] : [{ option, rank }];
            })
            .sort((a, b) => a.rank - b.rank)
            .map(({ option }) => option)
        : options,
    [options, needle],
  );
  const edit = (patch: { channelId?: string; text?: string }) => {
    setDraft({
      ...(channelId ? { channelId } : {}),
      text,
      ...patch,
    });
    setSaved(false);
    setError("");
  };
  const disabled = saving || !published || !lifecycle.available;
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
              if (disabled || !dirty || !channelId || problem) return;
              const target = channelId;
              const sent = command;
              const name = options.find((option) => option.id === target)?.name;
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
                      welcome: sent,
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
                      {option.name}
                    </Combobox.Item>
                  )}
                </Combobox.List>
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
              label="Message"
              description={`${[...normalized].length.toLocaleString("en-US")} of ${MAX} characters`}
              error={problem && problems[problem]}
            >
              <Textarea
                rows={4}
                disabled={disabled}
                value={text}
                onChange={(event) => edit({ text: event.target.value })}
              />
            </Field>
            {normalized !== DEFAULT_WELCOME_MESSAGE && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => edit({ text: DEFAULT_WELCOME_MESSAGE })}
                >
                  Restore default message
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
                    type="button"
                    disabled={saving}
                    onClick={() => setAttempt((n) => n + 1)}
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
                    !lifecycle.available ||
                    unconfirmed
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
          <WelcomeCard
            level={4}
            communityName={communityName}
            message={command || undefined}
          />
        </div>
      </div>
    </LoadingRegion>
  );
}
