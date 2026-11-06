import * as React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import type { Context } from "../../plugins/author";
import { createAttentionComponents } from "./Tab";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import type { Navigation } from "../../features/navigation/controller";
import { readView, writeView } from "../../shared/view-state";
import { startAttentionChat } from "./start-attention-chat";

const pubkey = "a".repeat(64);
const viewer = "f".repeat(64);
const scope = `https://example.com:${viewer}`;
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function fixture() {
  let visit = "profile";
  const refresh = vi.fn(async () => {});
  const open = vi.fn(async () => ({ status: "opened" }));
  const session = {
    scope,
    agentChoices: {
      ensure: () => {},
      refresh,
      snapshot: () => ({ selectable: [{ pubkey, name: "Ada" }] }),
    },
  } as unknown as RelaySession;
  const navigation = {
    open,
    snapshot: () => ({ attempt: { id: visit } }),
  } as unknown as Navigation;
  return {
    session,
    navigation,
    refresh,
    open,
    agent: { pubkey, name: "Ada" },
    scope,
    text: "Watch for deployment failures",
    leave: () => {
      visit = "elsewhere";
    },
  };
}
it("opens the real New chat route with an editable, explicitly addressed prompt", async () => {
  const f = fixture();
  const save = vi.fn();
  const { AgentPanel } = createAttentionComponents({
    agents: { save },
    navigation: f.navigation,
    relay: {},
  } as unknown as Pick<Context, "agents" | "relay" | "navigation">);
  const agent = {
    ...f.agent,
    key: "agent",
    owner: viewer,
    relay: "https://example.com",
    attention: {},
    attentionEnabled: true,
    timers: {},
  } as Parameters<typeof AgentPanel>[0]["agent"];
  render(
    React.createElement(AgentPanel, {
      agent,
      channels: [],
      scope,
      session: f.session,
      returnFocus: React.createRef<HTMLElement>(),
    }),
  );
  expect(screen.queryByRole("switch")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Watch this thread for new messages" }),
  );
  await waitFor(() => expect(f.open).toHaveBeenCalled());
  expect(save).not.toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledWith({
    version: 1,
    kind: "page",
    pluginId: "buzz.channels",
    pageId: "channels",
    scope: { viewer, communityOrigin: "https://example.com" },
    route: { version: 1, params: { kind: "solo-draft", agent: pubkey } },
  });
  expect(readView(scope, "solo:new-draft", null)).toMatchObject({
    text: "@Ada Watch this thread for new messages",
    recipients: [{ pubkey, name: "Ada", start: 0, end: 4 }],
  });
});
it("preserves existing text and attachments represented in the draft instead of overwriting them", async () => {
  const f = fixture();
  const existing = {
    text: "Finish this first",
    recipients: [],
    chatCards: ["buzz://channel/example"],
  };
  writeView(scope, "solo:new-draft", existing);
  await expect(startAttentionChat(f)).rejects.toThrow("unsent New chat draft");
  expect(readView(scope, "solo:new-draft", null)).toEqual(existing);
  expect(f.open).not.toHaveBeenCalled();
});
it("does not stage a prompt after navigation leaves while the agent roster loads", async () => {
  const f = fixture();
  let finish!: () => void;
  f.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = startAttentionChat(f);
  f.leave();
  finish();
  await pending;
  expect(readView(scope, "solo:new-draft", null)).toBeNull();
  expect(f.open).not.toHaveBeenCalled();
});
it("retains the prompt if the real chat destination fails to open", async () => {
  const f = fixture();
  f.open.mockResolvedValueOnce({ status: "failed" });
  await expect(startAttentionChat(f)).rejects.toThrow("prompt is saved");
  expect(readView(scope, "solo:new-draft", null)).toMatchObject({
    text: "@Ada Watch for deployment failures",
  });
});
