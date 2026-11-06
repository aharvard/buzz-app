// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  communityRequest,
  type CommunityInfo,
} from "../../features/communities/api";
import { DEFAULT_WELCOME_MESSAGE } from "../../features/communities/WelcomeCard";
import type { ComposerInputElement } from "../../features/messages/composer-dom";
import { composerDOMFixture } from "../../features/messages/composer-testing";
import { profileTarget } from "../../features/profiles/target";
import {
  ChannelLifecycleUnconfirmed,
  type ChannelLanding,
  type ChannelLifecycleCapability,
} from "../../features/relay/channel-lifecycle";
import type { ChannelSummary } from "../../features/relay/contracts";
import { PublishRejected } from "../../features/relay/outbox";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { WelcomeSettings } from "./WelcomeSettings";

vi.mock("../../features/communities/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/communities/api")>()),
  communityRequest: vi.fn(),
}));

composerDOMFixture();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const owner = "0".repeat(64);
const lobby = "11111111-1111-4111-8111-111111111111";
const square = "22222222-2222-4222-8222-222222222222";
const random = "55555555-5555-4555-8555-555555555555";
const rows = [
  { id: lobby, name: "Lobby", channelType: "stream" as const },
  {
    id: square,
    name: "Town square",
    channelType: "stream" as const,
    autoJoin: true as const,
  },
  {
    id: random,
    name: "Random",
    channelType: "stream" as const,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Old news",
    channelType: "stream" as const,
    archived: true as const,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Questions",
    channelType: "forum" as const,
  },
];

function setup({
  info = { policy: null, landingChannels: true, landingChannel: lobby },
  landing = { landing: true, welcome: "Hi there", name: "Lobby" },
  joined = [],
  directory = rows,
}: {
  info?: CommunityInfo;
  landing?: ChannelLanding | undefined;
  /** The viewer's own channels, beside the directory. */
  joined?: ChannelSummary[];
  directory?: typeof rows;
} = {}) {
  const readLanding = vi.fn(async () => landing);
  const setLanding = vi.fn<ChannelLifecycleCapability["setLanding"]>(
    async () => {},
  );
  const run = vi.fn<ChannelLifecycleCapability["run"]>(async () => {});
  let list = { status: "ready", channels: joined };
  const rosterListeners = new Set<() => void>();
  const session = {
    viewer: owner,
    media: () => undefined,
    channelLifecycle: { available: true, readLanding, setLanding, run },
    channels: {
      list: () => list,
      ensureList: () => () => {},
      subscribeList(listener: () => void) {
        rosterListeners.add(listener);
        return () => rosterListeners.delete(listener);
      },
      subscribeDirectory: () => () => {},
      openDirectory: () => directory,
      browseDirectory: () => directory,
      readDirectory: async () => ({ partial: false }),
      directoryComplete: () => true,
    },
  } as unknown as RelaySession;
  let snapshot = {
    status: "ready",
    generation: 1,
    scope: `https://primary.example:${owner}`,
    viewer: owner,
    session,
  };
  const listeners = new Set<() => void>();
  const relay = {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RelayData;
  /** The relay republished a joined channel's metadata. */
  const setJoined = (channels: ChannelSummary[]) => {
    list = { status: "ready", channels };
    act(() => {
      for (const listener of rosterListeners) listener();
    });
  };
  /** The same community reconnects: a new session generation. */
  const reconnect = () => {
    snapshot = { ...snapshot, generation: snapshot.generation + 1 };
    act(() => {
      for (const listener of listeners) listener();
    });
  };
  vi.mocked(communityRequest).mockResolvedValue(info);
  const view = render(
    <WelcomeSettings
      relay={relay}
      communityName="Primary"
      active={() => true}
    />,
    { wrapper: ToastProvider },
  );
  return {
    readLanding,
    setLanding,
    run,
    setJoined,
    reconnect,
    view,
    user: userEvent.setup(),
  };
}

const channel = () => screen.getByRole("combobox", { name: "Welcome channel" });
const titleField = () => screen.getByRole("textbox", { name: "Title" });
const messageField = () => screen.getByRole("textbox", { name: "Message" });
const starters = () =>
  screen.getByRole("region", { name: "Also add new members to" });
const removeLabel = (name: string) => `Remove #${name} from starter channels`;
const remove = (name: string) =>
  screen.getByRole("button", { name: removeLabel(name) });
const removable = (name: string) =>
  screen.queryByRole("button", { name: removeLabel(name) });
const addField = () => screen.getByRole("combobox", { name: "Add a channel" });
const welcome = (message: string, title = "") => ({ message, title });

it("opens on the designated channel, its title and its message, read fresh", async () => {
  const { readLanding } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  // The chosen channel shows its icon, as in the list.
  expect(
    channel()
      .closest(".buzz-input-group")
      ?.querySelector(".buzz-input-leading svg"),
  ).not.toBeNull();
  expect(titleField()).toHaveValue("Welcome to Primary");
  expect(messageField()).toHaveValue("Hi there");
  expect(communityRequest).toHaveBeenCalledWith(
    "https://primary.example",
    "info",
    undefined,
    expect.any(AbortSignal),
  );
  expect(readLanding).toHaveBeenCalledWith(lobby, expect.any(AbortSignal));
  expect(
    screen.getByRole("region", { name: "Welcome to Primary" }),
  ).toHaveTextContent("Hi there");
  // Nothing changed yet, so there is nothing to save.
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("opens on a custom title and renders the message as Markdown in the preview", async () => {
  setup({
    landing: {
      landing: true,
      welcome: "Say **hi**",
      welcomeTitle: "Hello, newcomer",
      name: "Lobby",
    },
  });
  await waitFor(() => expect(titleField()).toHaveValue("Hello, newcomer"));
  const preview = screen.getByRole("region", { name: "Hello, newcomer" });
  expect(preview.querySelector("strong")).toHaveTextContent("hi");
  expect(
    screen.getByText(
      /Format with the toolbar or Markdown\. To link a channel, use Copy link/,
    ),
  ).toBeVisible();
});

it("writes toolbar formatting and a pasted channel link into the message as Markdown", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  const input = messageField();
  fireEvent.change(input, { target: { value: "" } });
  // A channel's Copy link writes the bare link.
  const link = `buzz://channel/${square}`;
  act(() => {
    input.focus();
    document.dispatchEvent(new Event("selectionchange"));
    fireEvent.paste(input, {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? link : ""),
      },
    });
  });
  // A pointer click leaves focus and the caret in the editor.
  await user.click(screen.getByRole("button", { name: "Toggle formatting" }));
  await user.click(screen.getByRole("button", { name: "Bold" }));
  expect(input).toHaveFocus();
  await user.keyboard("Join");
  expect(input.querySelector("strong")).toHaveTextContent("Join");
  const preview = screen.getByRole("region", { name: "Welcome to Primary" });
  expect(preview.querySelector("strong")).toHaveTextContent("Join");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      lobby,
      welcome(`${link} **Join**`),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

const publishedMarkdown = [
  "**Welcome** to _Primary_",
  "",
  `- Say hi in [#Town square](buzz://channel/${square})`,
  `- Ask [@Ada](${profileTarget("a".repeat(64))}) anything`,
].join("\n");

it("opens published Markdown as its source and sends it back unchanged", async () => {
  const markdown = publishedMarkdown;
  const { setLanding, user } = setup({
    landing: { landing: true, welcome: markdown, name: "Lobby" },
  });
  await waitFor(() => expect(messageField()).toHaveValue(markdown));
  const preview = screen.getByRole("region", { name: "Welcome to Primary" });
  expect(preview.querySelector("strong")).toHaveTextContent("Welcome");
  expect(preview.querySelector("em")).toHaveTextContent("Primary");
  expect(preview.querySelectorAll("li")).toHaveLength(2);
  expect(preview.querySelector("[data-profile-target]")).toHaveTextContent(
    "Ada",
  );
  // Nothing changed yet, so there is nothing to save.
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  const input = messageField() as ComposerInputElement;
  act(() => {
    input.focus();
    input.setSelectionRange(markdown.length, markdown.length);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await user.keyboard("!");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      lobby,
      welcome(`${markdown}!`),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("bolds one word inside published Markdown and keeps the rest of the source", async () => {
  const markdown = publishedMarkdown;
  const { setLanding, user } = setup({
    landing: { landing: true, welcome: markdown, name: "Lobby" },
  });
  await waitFor(() => expect(messageField()).toHaveValue(markdown));
  const input = messageField() as ComposerInputElement;
  const word = "anything";
  const start = markdown.indexOf(word);
  act(() => {
    input.focus();
    input.setSelectionRange(start, start + word.length);
    document.dispatchEvent(new Event("selectionchange"));
  });
  // A pointer click keeps the selection in the editor.
  await user.click(screen.getByRole("button", { name: "Toggle formatting" }));
  await user.click(screen.getByRole("button", { name: "Bold" }));
  expect(input).toHaveFocus();
  expect(
    [...input.querySelectorAll("strong")].map((node) => node.textContent),
  ).toContain(word);
  // Only the selected word changes; the emphasis, list and links around it
  // are sent as they were published.
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      lobby,
      welcome(markdown.replace(word, `**${word}**`)),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("moves the welcome to another public channel with its full state", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  await user.click(screen.getByRole("button", { name: "Browse channels" }));
  // Only active public stream channels are offered, each with its icon.
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "Lobby",
    "Random",
    "Town square",
  ]);
  for (const option of options)
    expect(option.querySelector("svg")).not.toBeNull();
  await user.click(screen.getByRole("option", { name: "Town square" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      square,
      welcome("Hi there"),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
  expect(await screen.findByText("Welcome saved")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("requires a channel when none is designated and sends the defaults as empty", async () => {
  const { readLanding, setLanding, user } = setup({
    info: { policy: null, landingChannels: true },
  });
  await waitFor(() =>
    expect(messageField()).toHaveValue(DEFAULT_WELCOME_MESSAGE),
  );
  expect(channel()).toHaveValue("");
  expect(readLanding).not.toHaveBeenCalled();
  fireEvent.change(messageField(), {
    target: { value: `${DEFAULT_WELCOME_MESSAGE}\n` },
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.type(channel(), "town");
  await user.click(await screen.findByRole("option", { name: "Town square" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  // The normalized defaults are never stored as custom text.
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      square,
      welcome(""),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("normalizes line endings and trims the title and message before sending", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "  Hi\r\nall  " } });
  fireEvent.change(titleField(), { target: { value: "  Hello, newcomer " } });
  expect(
    screen.getByRole("region", { name: "Hello, newcomer" }),
  ).toHaveTextContent("Hi all");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      lobby,
      welcome("Hi\nall", "Hello, newcomer"),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("blocks messages the relay would refuse and restores the defaults in the draft", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "  \n " } });
  expect(
    screen.getByText("Enter a welcome message, or restore the defaults."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(messageField(), { target: { value: "a".repeat(4001) } });
  expect(
    screen.getByText("Shorten the message to 4,000 characters."),
  ).toBeVisible();
  fireEvent.change(messageField(), { target: { value: "a\u0007b" } });
  expect(
    screen.getByText(
      "Remove control characters. Line breaks and tabs are fine.",
    ),
  ).toBeVisible();
  // Unicode scalar values, not UTF-16 units, as the relay counts; tabs pass.
  fireEvent.change(messageField(), {
    target: { value: `${"😀".repeat(1999)}\t${"😀".repeat(2000)}` },
  });
  expect(screen.getByText("4,000 of 4,000 characters")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.change(titleField(), { target: { value: "Hello" } });
  await user.click(screen.getByRole("button", { name: "Restore defaults" }));
  expect(messageField()).toHaveValue(DEFAULT_WELCOME_MESSAGE);
  expect(titleField()).toHaveValue("Welcome to Primary");
  expect(screen.queryByRole("button", { name: "Restore defaults" })).toBeNull();
  expect(setLanding).not.toHaveBeenCalled();
});

it("blocks titles the relay would refuse", async () => {
  const { setLanding } = setup();
  await waitFor(() => expect(titleField()).toHaveValue("Welcome to Primary"));
  fireEvent.change(titleField(), { target: { value: "   " } });
  expect(
    screen.getByText("Enter a title, or restore the defaults."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(titleField(), { target: { value: "a".repeat(121) } });
  expect(
    screen.getByText("Shorten the title to 120 characters."),
  ).toBeVisible();
  fireEvent.change(titleField(), { target: { value: "a\tb" } });
  expect(screen.getByText("Use one line of text for the title.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(titleField(), { target: { value: "a\u2028b" } });
  expect(screen.getByText("Use one line of text for the title.")).toBeVisible();
  fireEvent.change(titleField(), { target: { value: "😀".repeat(120) } });
  expect(screen.getByText("120 of 120 characters")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(setLanding).not.toHaveBeenCalled();
});

it("resends a published title untouched, even one matching this viewer's default", async () => {
  // Another viewer may know the community by another name, so the default is
  // never inferred from the text: only Restore defaults sends it.
  const { setLanding, user } = setup({
    landing: {
      landing: true,
      welcome: "Hi there",
      welcomeTitle: "Welcome to Primary",
      name: "Lobby",
    },
  });
  await waitFor(() => expect(titleField()).toHaveValue("Welcome to Primary"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenLastCalledWith(
      lobby,
      welcome("Say hello", "Welcome to Primary"),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Restore defaults" }));
  expect(titleField()).toHaveValue("Welcome to Primary");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenLastCalledWith(
      lobby,
      welcome(""),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
  // Typed back in, the same words are a custom title.
  fireEvent.change(titleField(), { target: { value: "Welcome to Primary" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenLastCalledWith(
      lobby,
      welcome("", "Welcome to Primary"),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("shows the relay's reason and keeps the draft when it refuses", async () => {
  const { setLanding, user } = setup();
  setLanding.mockRejectedValueOnce(
    new PublishRejected(
      "rejected",
      "invalid: landing requires an open, unarchived channel without a ttl",
    ),
  );
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Landing requires an open, unarchived channel without a ttl",
  );
  expect(messageField()).toHaveValue("Say hello");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

/** Saves, but the relay never showed the result within the readback window. */
async function unconfirmedSave(fixture: ReturnType<typeof setup>) {
  fixture.setLanding.mockRejectedValueOnce(
    new ChannelLifecycleUnconfirmed(new Error("timeout")),
  );
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  await fixture.user.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Not confirmed yet");
  expect(alert).not.toHaveTextContent("Saved");
  // The draft stays, but another save would republish blind.
  expect(messageField()).toHaveValue("Say hello");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}

it("settles an unconfirmed save by reading again, clearing a draft the relay shows", async () => {
  const fixture = setup();
  const { readLanding, setLanding, user } = fixture;
  await unconfirmedSave(fixture);
  readLanding.mockResolvedValue({
    landing: true,
    welcome: "Say hello",
    name: "Lobby",
  });
  await user.click(screen.getByRole("button", { name: "Check again" }));
  // The confirmed outcome is announced like a direct save.
  expect(await screen.findByText("Welcome saved")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(readLanding).toHaveBeenCalledTimes(2);
  expect(setLanding).toHaveBeenCalledTimes(1);
  expect(messageField()).toHaveValue("Say hello");
  expect(screen.queryByText(/Not confirmed yet/)).toBeNull();
});

it("keeps the draft in view during the check and reopens Save when the change is missing", async () => {
  const fixture = setup();
  const { readLanding, setLanding, user } = fixture;
  await unconfirmedSave(fixture);
  let release!: (state: ChannelLanding) => void;
  readLanding.mockImplementationOnce(
    () =>
      new Promise<ChannelLanding>((resolve) => {
        release = resolve;
      }),
  );
  await user.click(screen.getByRole("button", { name: "Check again" }));
  try {
    // The published form stays in view while the relay is read again.
    expect(readLanding).toHaveBeenCalledTimes(2);
    expect(messageField()).toBeVisible();
    expect(messageField()).toHaveValue("Say hello");
    const check = screen.getByRole("button", { name: "Check again" });
    expect(check).toHaveAttribute("aria-busy", "true");
    expect(check).toHaveFocus();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  } finally {
    release({ landing: true, welcome: "Hi there", name: "Lobby" });
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
  );
  expect(setLanding).toHaveBeenCalledTimes(1);
  expect(messageField()).toHaveValue("Say hello");
  expect(messageField()).toHaveFocus();
  expect(screen.queryByText(/Not confirmed yet/)).toBeNull();
  expect(screen.queryByText("Welcome saved")).toBeNull();
});

it("shows Save only for a change, and Cancel returns to the published state", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Hi there!" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  // Typing back to the published text leaves nothing to save.
  fireEvent.change(messageField(), { target: { value: "Hi there" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(messageField(), { target: { value: "Draft" } });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(messageField()).toHaveValue("Hi there");
  expect(channel()).toHaveValue("Lobby");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(setLanding).not.toHaveBeenCalled();
});

it("starts over from the relay when the community's session changes", async () => {
  const { readLanding, reconnect } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Draft" } });
  reconnect();
  await waitFor(() => expect(readLanding).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("abandons a save that is still in flight when the form closes", async () => {
  const { setLanding, user, view } = setup();
  let settle!: () => void;
  setLanding.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(setLanding).toHaveBeenCalledTimes(1));
  const [, , signal, active] = setLanding.mock.calls[0] ?? [];
  expect(active?.()).toBe(true);
  view.unmount();
  // The lifecycle owner checks this guard right before publishing.
  expect(signal?.aborted).toBe(true);
  expect(active?.()).toBe(false);
  settle();
  await act(async () => {});
});

it("offers a retry when the current welcome cannot be read", async () => {
  const { readLanding, user } = setup();
  readLanding.mockRejectedValueOnce(new Error("Relay unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Welcome settings couldn’t be loaded. Relay unavailable",
  );
  await user.click(
    screen.getByRole("button", { name: "Retry loading welcome settings" }),
  );
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
});

it("lists only the starter channels, the welcome channel fixed first", async () => {
  const { user } = setup({
    joined: [
      // Joined channels the directory leaves out are eligible; others are not.
      {
        id: "66666666-6666-4666-8666-666666666666",
        name: "Unlisted",
        channelType: "stream",
        visibility: "public",
        autoJoin: true,
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Staff",
        channelType: "stream",
        visibility: "private",
        private: true,
      },
    ],
  });
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  const group = starters();
  // Each flagged channel is listed and removable; the welcome is fixed.
  expect(
    within(group)
      .getAllByRole("button", { name: /^Remove / })
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([removeLabel("Town square"), removeLabel("Unlisted")]);
  const fixed = within(group).getByText("Lobby");
  expect(
    within(group).getByText("Welcome channel · always joined"),
  ).toBeVisible();
  expect(
    fixed.compareDocumentPosition(remove("Town square")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(removable("Lobby")).toBeNull();
  // Channels that are not starters have no row, however many there are.
  expect(within(group).queryByText("Random")).toBeNull();
  expect(within(group).queryByText("Staff")).toBeNull();
  expect(group).toHaveTextContent(
    "A channel you add applies to people who join from now on",
  );
  // The search offers the rest: neither the welcome channel nor a starter.
  await user.click(
    screen.getByRole("button", { name: "Browse channels to add" }),
  );
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Random"]);
  expect(options[0]?.querySelector("svg")).not.toBeNull();
});

it("browses the first 50 channels by name in both pickers and finds the rest by searching", async () => {
  // Sixty more public channels, each sorting before the fixture's own.
  const many = Array.from({ length: 60 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return {
      id: `aaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      name: `Channel ${n}`,
      channelType: "stream" as const,
    };
  });
  const { user } = setup({ directory: [...rows, ...many] });
  const hint = "Showing the first 50 channels. Type a name to find more.";
  const names = () =>
    screen.getAllByRole("option").map((option) => option.textContent);
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  // The welcome channel picker: 63 eligible channels, the first 50 shown.
  await user.click(screen.getByRole("button", { name: "Browse channels" }));
  await waitFor(() => expect(names()).toHaveLength(50));
  expect(names()[0]).toBe("Channel 01");
  expect(names()[49]).toBe("Channel 50");
  expect(screen.getByText(hint)).toBeVisible();
  // A search covers every channel, including those past the first 50.
  await user.clear(channel());
  await user.type(channel(), "town");
  await waitFor(() => expect(names()).toEqual(["Town square"]));
  expect(screen.queryByText(hint)).toBeNull();
  await user.keyboard("{Escape}");
  // The starter search: 61 addable channels, without the welcome or a starter.
  await user.click(
    screen.getByRole("button", { name: "Browse channels to add" }),
  );
  await waitFor(() => expect(names()).toHaveLength(50));
  expect(names()[0]).toBe("Channel 01");
  expect(screen.getByText(hint)).toBeVisible();
  await user.type(addField(), "random");
  await waitFor(() => expect(names()).toEqual(["Random"]));
  expect(screen.queryByText(hint)).toBeNull();
});

it("adds a starter from the search through the channel lifecycle, listed while the relay confirms", async () => {
  const { run, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  let settle!: () => void;
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  await user.type(addField(), "ran");
  await user.click(await screen.findByRole("option", { name: "Random" }));
  try {
    expect(run).toHaveBeenCalledWith(
      "auto-join-on",
      random,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(addField()).toHaveValue("");
    // The new row shows at once; one channel command at a time, and the
    // welcome waits for it.
    expect(within(starters()).getByText("Adding…")).toBeVisible();
    expect(remove("Random")).toBeDisabled();
    expect(remove("Town square")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  } finally {
    await act(async () => settle());
  }
  // The confirmed flag keeps the row; the directory is not yet republished.
  expect(await screen.findByText("Added #Random")).toBeInTheDocument();
  expect(within(starters()).queryByText("Adding…")).toBeNull();
  expect(remove("Random")).toBeEnabled();
  expect(remove("Town square")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(
    screen.getByRole("button", { name: "Browse channels to add" }),
  );
  expect(await screen.findByText("No matching public channels.")).toBeVisible();
});

it("removes a starter through the channel lifecycle, keeping its row until the relay confirms", async () => {
  const { run, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  let settle!: () => void;
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  await user.click(remove("Town square"));
  try {
    expect(run).toHaveBeenCalledWith(
      "auto-join-off",
      square,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(remove("Town square")).toHaveAttribute("aria-busy", "true");
    expect(remove("Town square")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  } finally {
    await act(async () => settle());
  }
  // The row leaves with its button, so focus moves to the search.
  expect(removable("Town square")).toBeNull();
  expect(addField()).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(await screen.findByText("Removed #Town square")).toBeInTheDocument();
  expect(within(starters()).getByRole("status")).toHaveTextContent(
    "No other channels added yet",
  );
  // Removed, it can be added again.
  await user.click(
    screen.getByRole("button", { name: "Browse channels to add" }),
  );
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "Random",
    "Town square",
  ]);
});

it("follows the roster for a joined channel instead of its own confirmed state", async () => {
  const unlisted: ChannelSummary = {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Unlisted",
    channelType: "stream",
    visibility: "public",
  };
  const { run, setJoined, user } = setup({ joined: [unlisted] });
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  await user.type(addField(), "unl");
  await user.click(await screen.findByRole("option", { name: "Unlisted" }));
  expect(run).toHaveBeenCalledOnce();
  // Every other control is held until the command settles.
  await waitFor(() => expect(remove("Town square")).toBeEnabled());
  // The readback republishes the joined channel; that is what the list shows.
  expect(removable("Unlisted")).toBeNull();
  setJoined([{ ...unlisted, autoJoin: true }]);
  expect(remove("Unlisted")).toBeVisible();
  // Another admin's later change shows too; nothing kept here overrides it.
  setJoined([unlisted]);
  expect(removable("Unlisted")).toBeNull();
});

it("explains a failed removal beside its row and a failed addition on the search", async () => {
  const { run, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  run.mockRejectedValueOnce(new PublishRejected("rejected"));
  await user.click(remove("Town square"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Only community owners and admins can change this.",
  );
  // The message follows its row, before the search.
  expect(
    remove("Town square").compareDocumentPosition(alert) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    alert.compareDocumentPosition(addField()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // Repeating the same change is how an unconfirmed one is checked.
  run.mockRejectedValueOnce(
    new ChannelLifecycleUnconfirmed(new Error("timeout")),
  );
  await user.click(remove("Town square"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Saved, but not confirmed yet. Try again to check.",
  );
  await user.click(remove("Town square"));
  await waitFor(() => expect(removable("Town square")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  // A failed addition has no row, so the search explains it.
  run.mockRejectedValueOnce(new PublishRejected("rejected"));
  await user.type(addField(), "ran");
  await user.click(await screen.findByRole("option", { name: "Random" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "#Random: Only community owners and admins can change this.",
  );
  expect(removable("Random")).toBeNull();
  // Adding it again clears the reason.
  await user.type(addField(), "ran");
  await user.click(await screen.findByRole("option", { name: "Random" }));
  await waitFor(() => expect(remove("Random")).toBeEnabled());
  expect(screen.queryByRole("alert")).toBeNull();
});

it("holds starter changes while the welcome saves", async () => {
  const { setLanding, user } = setup();
  let settle!: () => void;
  setLanding.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "Say hello" } });
  await user.click(screen.getByRole("button", { name: "Save" }));
  try {
    expect(remove("Town square")).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Browse channels to add" }),
    );
    expect(
      await screen.findByRole("option", { name: "Random" }),
    ).toHaveAttribute("aria-disabled", "true");
  } finally {
    await act(async () => settle());
  }
  expect(remove("Town square")).toBeEnabled();
});

it("still lists starter channels when the relay has no welcome channel", async () => {
  const { readLanding } = setup({
    info: { policy: null, landingChannels: false },
  });
  expect(
    await screen.findByText(
      "This community’s relay doesn’t support a welcome channel.",
    ),
  ).toBeVisible();
  await waitFor(() => expect(remove("Town square")).toBeVisible());
  expect(addField()).toBeEnabled();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByText("Welcome channel · always joined")).toBeNull();
  expect(readLanding).not.toHaveBeenCalled();
});
