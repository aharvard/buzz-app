import type { Agent } from "./model";
import type { RelaySession } from "../../features/relay/session";
import type { Navigation } from "../../features/navigation/controller";
import { soloDraftTarget } from "../../features/channel-navigation/routes";
import {
  mentionDraft,
  hasDraftContent,
  followupDraft,
} from "../../features/messages/mention-draft";
import { attachmentDraftCount } from "../../features/messages/attachment-draft";
import { readView, replaceView, viewRevision } from "../../shared/view-state";

/** Stage an addressed, editable New chat draft; only the composer can send it. */
export async function startAttentionChat({
  agent,
  session,
  scope,
  navigation,
  text,
}: {
  agent: Pick<Agent, "pubkey" | "name">;
  session: RelaySession;
  scope: string;
  navigation: Navigation;
  text: string;
}) {
  if (session.scope !== scope)
    throw new Error("This community changed. Reopen the agent and try again.");
  const visit = navigation.snapshot().attempt.id;
  session.agentChoices.ensure(true, true);
  await session.agentChoices.refresh(true);
  if (navigation.snapshot().attempt.id !== visit) return;
  const choice = session.agentChoices
    .snapshot()
    .selectable.find((item) => item.pubkey === agent.pubkey);
  if (!choice) throw new Error("This agent is not available for a new chat.");
  const key = "solo:new-draft";
  const revision = viewRevision(scope, key);
  const current = mentionDraft(readView(scope, key, null));
  if (
    hasDraftContent(current, attachmentDraftCount(session, `${scope}:${key}`))
  )
    throw new Error(
      "You already have an unsent New chat draft. Send or clear it before choosing a prompt.",
    );
  const addressed = followupDraft([
    { pubkey: choice.pubkey, name: choice.name || agent.name },
  ]);
  const draft = { ...addressed, text: addressed.text + text };
  if (replaceView(scope, key, revision, draft) !== "saved")
    throw new Error(
      "Your prompt could not be saved. Your existing draft has not been replaced.",
    );
  const result = await navigation.open(
    soloDraftTarget(scope, { agent: choice.pubkey }),
  );
  if (result.status === "failed")
    throw new Error(
      "The chat could not open. Your prompt is saved in New chat.",
    );
}
