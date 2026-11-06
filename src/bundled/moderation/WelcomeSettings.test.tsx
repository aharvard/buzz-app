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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const owner = "0".repeat(64);
const lobby = "11111111-1111-4111-8111-111111111111";
const square = "22222222-2222-4222-8222-222222222222";
const rows = [
  { id: lobby, name: "Lobby", channelType: "stream" as const },
  {
    id: square,
    name: "Town square",
    channelType: "stream" as const,
    autoJoin: true as const,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
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
}: {
  info?: CommunityInfo;
  landing?: ChannelLanding | undefined;
  /** The viewer's own channels, beside the directory. */
  joined?: ChannelSummary[];
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
      openDirectory: () => rows,
      browseDirectory: () => rows,
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
const starter = (name: string) => screen.getByRole("switch", { name });
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
    screen.getByText(/Markdown works\. To link a channel, use Copy link/),
  ).toBeVisible();
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
  await waitFor(() => expect(messageField()).toHaveValue(DEFAULT_WELCOME_MESSAGE));
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
  expect(screen.getByText("Shorten the message to 4,000 characters.")).toBeVisible();
  fireEvent.change(messageField(), { target: { value: "a\u0007b" } });
  expect(
    screen.getByText("Remove control characters. Line breaks and tabs are fine."),
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
  expect(
    screen.queryByRole("button", { name: "Restore defaults" }),
  ).toBeNull();
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
  expect(screen.getByText("Shorten the title to 120 characters.")).toBeVisible();
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

it("lists the other open channels as starters, the welcome channel fixed first", async () => {
  setup({
    joined: [
      // Joined channels the directory leaves out are listed; others are not.
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
  const group = screen.getByRole("region", { name: "Also add new members to" });
  expect(
    within(group)
      .getAllByRole("switch")
      .map((control) => control.getAttribute("aria-label")),
  ).toEqual(["Lobby", "Random", "Town square", "Unlisted"]);
  const fixed = starter("Lobby");
  expect(fixed).toBeChecked();
  expect(fixed).toHaveAttribute("aria-disabled", "true");
  expect(fixed).toHaveAccessibleDescription("Welcome channel · always joined");
  expect(starter("Random")).not.toBeChecked();
  expect(starter("Town square")).toBeChecked();
  expect(starter("Unlisted")).toBeChecked();
  expect(starter("Random")).not.toHaveAttribute("aria-disabled");
  expect(within(group).queryByRole("switch", { name: "Staff" })).toBeNull();
  expect(group).toHaveTextContent(
    "Turning a channel on adds people who join from now on",
  );
});

it("sets a starter's flag through the channel lifecycle and holds other changes until it settles", async () => {
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
  await user.click(starter("Random"));
  try {
    expect(run).toHaveBeenCalledWith(
      "auto-join-on",
      "55555555-5555-4555-8555-555555555555",
      expect.any(AbortSignal),
      expect.any(Function),
    );
    // One channel command at a time, and the welcome waits for it.
    expect(starter("Random")).not.toBeChecked();
    expect(starter("Random")).toHaveAttribute("aria-busy", "true");
    expect(starter("Town square")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  } finally {
    await act(async () => settle());
  }
  // The confirmed flag shows; the directory row is not yet republished.
  expect(starter("Random")).toBeChecked();
  expect(starter("Town square")).not.toHaveAttribute("aria-disabled");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(starter("Town square"));
  expect(run).toHaveBeenLastCalledWith(
    "auto-join-off",
    square,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  await waitFor(() => expect(starter("Town square")).not.toBeChecked());
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
  await user.click(starter("Unlisted"));
  await waitFor(() => expect(run).toHaveBeenCalledOnce());
  // The readback republishes the joined channel; that is what the row shows.
  await waitFor(() =>
    expect(starter("Unlisted")).not.toHaveAttribute("aria-busy"),
  );
  expect(starter("Unlisted")).not.toBeChecked();
  setJoined([{ ...unlisted, autoJoin: true }]);
  expect(starter("Unlisted")).toBeChecked();
  // Another admin's later change shows too; nothing kept here overrides it.
  setJoined([unlisted]);
  expect(starter("Unlisted")).not.toBeChecked();
});

it("explains a starter change that failed beside its row", async () => {
  const { run, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  run.mockRejectedValueOnce(new PublishRejected("rejected"));
  await user.click(starter("Random"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "Only community owners and admins can change this.",
  );
  // The message follows its row, before the next one.
  expect(
    starter("Random").compareDocumentPosition(alert) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    alert.compareDocumentPosition(starter("Town square")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(starter("Random")).not.toBeChecked();
  // Repeating the same value is how an unconfirmed change is checked.
  run.mockRejectedValueOnce(
    new ChannelLifecycleUnconfirmed(new Error("timeout")),
  );
  await user.click(starter("Random"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Saved, but not confirmed yet. Try again to check.",
  );
  await user.click(starter("Random"));
  await waitFor(() => expect(starter("Random")).toBeChecked());
  expect(screen.queryByRole("alert")).toBeNull();
});

it("holds the starter switches while the welcome saves", async () => {
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
    expect(starter("Random")).toHaveAttribute("aria-disabled", "true");
  } finally {
    await act(async () => settle());
  }
  expect(starter("Random")).not.toHaveAttribute("aria-disabled");
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
  await waitFor(() => expect(starter("Random")).toBeVisible());
  expect(starter("Town square")).toBeChecked();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(screen.queryByText("Welcome channel · always joined")).toBeNull();
  expect(readLanding).not.toHaveBeenCalled();
});
