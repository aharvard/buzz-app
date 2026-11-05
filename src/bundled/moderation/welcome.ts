import {
  communityRequest,
  type CommunityInfo,
} from "../../features/communities/api";
import { communityFromScope } from "../../features/relay/gifs";
import type { RelayData } from "../../features/relay/service";

export type WelcomeSupport = Readonly<{
  status: "idle" | "loading" | "ready" | "error";
  /** The relay advertises the welcome-channel command. */
  supported?: boolean;
}>;

const idle: WelcomeSupport = Object.freeze({ status: "idle" });

/** Whether the connected community's relay supports a welcome channel, from
 * its NIP-11 document. Each new demand reads it again, so a relay upgrade
 * shows the card the next time Settings opens. */
export function createWelcomeSupport(relay: RelayData) {
  let value = idle;
  let key = "";
  let controller: AbortController | undefined;
  let demands = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: WelcomeSupport) => {
    value = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const current = () => {
    const connection = relay.snapshot();
    const nextKey = `${connection.generation}:${connection.status === "ready" ? (connection.scope ?? "") : ""}`;
    if (nextKey !== key) {
      key = nextKey;
      controller?.abort();
      value = idle;
    }
    return connection;
  };
  const load = (fresh: boolean) => {
    const connection = current();
    if (
      disposed ||
      !demands ||
      connection.status !== "ready" ||
      !connection.scope ||
      (!fresh && (value.status === "loading" || value.status === "ready"))
    )
      return;
    const community = communityFromScope(connection.scope);
    if (!community) return;
    controller?.abort();
    const owner = new AbortController();
    controller = owner;
    const capturedKey = key;
    const retained = value.status === "ready" ? value : undefined;
    if (!retained) publish({ status: "loading" });
    communityRequest<CommunityInfo>(
      community,
      "info",
      undefined,
      owner.signal,
    ).then(
      (info) => {
        if (owner.signal.aborted || capturedKey !== key || disposed) return;
        publish({ status: "ready", supported: !!info.landingChannels });
      },
      () => {
        if (owner.signal.aborted || capturedKey !== key || disposed) return;
        // A failed re-read keeps the support already shown.
        if (!retained) publish({ status: "error" });
      },
    );
  };
  const stop = relay.subscribe(() => {
    const before = key;
    current();
    for (const listener of listeners) listener();
    if (before !== key) load(false);
  });
  return {
    snapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure() {
      const reacquired = demands === 0;
      demands++;
      load(reacquired);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        demands--;
      };
    },
    dispose() {
      disposed = true;
      stop();
      controller?.abort();
      listeners.clear();
    },
  };
}

export type WelcomeSupportStore = ReturnType<typeof createWelcomeSupport>;
