import { useId, useSyncExternalStore } from "react";
import { splitPartition } from "../relay/partition";
import { communityPresentation } from "./community-icon";
import type { CommunityReader } from "./service";
import styles from "./WelcomeCard.module.css";

/** Shown when the community has not set its own welcome message. */
export const DEFAULT_WELCOME_MESSAGE =
  "This is a place to connect with the community and keep up with what’s happening. Explore the channels to find conversations that interest you.";

/** The welcome channel's introduction; a timeline start, never a message. */
export function WelcomeCard({
  communityName,
  message,
  level = 2,
}: {
  communityName?: string | undefined;
  /** Plain text; `undefined` shows the default. */
  message?: string | undefined;
  level?: 2 | 3 | 4;
}) {
  const title = useId();
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <section aria-labelledby={title} className={styles.card}>
      <Heading id={title} className={`${styles.title} text-label`}>
        {communityName ? `Welcome to ${communityName}` : "Welcome"}
      </Heading>
      <p className={`${styles.body} text-message`}>
        {message ?? DEFAULT_WELCOME_MESSAGE}
      </p>
    </section>
  );
}

const noCommunities = () => () => {};
const noSnapshot = () => undefined;

/** The welcome card titled with the name this viewer knows the community by. */
export function CommunityWelcomeCard({
  communities,
  scope,
  message,
}: {
  communities?: CommunityReader | undefined;
  /** The relay session's partition. */
  scope: string;
  message?: string | undefined;
}) {
  const snapshot = useSyncExternalStore(
    communities?.subscribe ?? noCommunities,
    communities?.snapshot ?? noSnapshot,
  );
  const origin = splitPartition(scope)?.communityOrigin;
  let name: string | undefined;
  if (origin && origin !== "offline")
    try {
      name = communityPresentation(origin, snapshot?.memberships).name;
    } catch {
      // An unscoped reader has no community presentation to show.
    }
  return <WelcomeCard communityName={name} message={message} />;
}
