// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  { id: square, name: "Town square", channelType: "stream" as const },
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
}: {
  info?: CommunityInfo;
  landing?: ChannelLanding | undefined;
} = {}) {
  const readLanding = vi.fn(async () => landing);
  const setLanding = vi.fn<ChannelLifecycleCapability["setLanding"]>(
    async () => {},
  );
  const session = {
    channelLifecycle: { available: true, readLanding, setLanding },
    channels: {
      subscribeList: () => () => {},
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
  return { readLanding, setLanding, reconnect, view, user: userEvent.setup() };
}

const channel = () => screen.getByRole("combobox", { name: "Welcome channel" });
const messageField = () => screen.getByRole("textbox", { name: "Message" });

it("opens on the designated channel and its message, read fresh", async () => {
  const { readLanding } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
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

it("moves the welcome to another public channel with its full state", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(channel()).toHaveValue("Lobby"));
  await user.click(screen.getByRole("button", { name: "Browse channels" }));
  // Only active public stream channels are offered.
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual(["Lobby", "Town square"]);
  await user.click(screen.getByRole("option", { name: "Town square" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      square,
      "Hi there",
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
  expect(await screen.findByText("Welcome saved")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("requires a channel when none is designated and sends the default as empty", async () => {
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
  // The normalized default is never stored as custom text.
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      square,
      "",
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("normalizes line endings and trims the message before sending", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "  Hi\r\nall  " } });
  expect(
    screen.getByRole("region", { name: "Welcome to Primary" }),
  ).toHaveTextContent("Hi all");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(setLanding).toHaveBeenCalledWith(
      lobby,
      "Hi\nall",
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it("blocks messages the relay would refuse and restores the default in the draft", async () => {
  const { setLanding, user } = setup();
  await waitFor(() => expect(messageField()).toHaveValue("Hi there"));
  fireEvent.change(messageField(), { target: { value: "  \n " } });
  expect(
    screen.getByText("Enter a welcome message, or restore the default."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(messageField(), { target: { value: "a".repeat(1001) } });
  expect(screen.getByText("Shorten the message to 1,000 characters.")).toBeVisible();
  // Unicode scalar values, not UTF-16 units, as the relay counts.
  fireEvent.change(messageField(), { target: { value: "😀".repeat(1000) } });
  expect(screen.getByText("1,000 of 1,000 characters")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(
    screen.getByRole("button", { name: "Restore default message" }),
  );
  expect(messageField()).toHaveValue(DEFAULT_WELCOME_MESSAGE);
  expect(setLanding).not.toHaveBeenCalled();
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
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(),
  );
  expect(readLanding).toHaveBeenCalledTimes(2);
  expect(setLanding).toHaveBeenCalledTimes(1);
  expect(messageField()).toHaveValue("Say hello");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the draft and reopens Save when the check finds the change missing", async () => {
  const fixture = setup();
  const { readLanding, setLanding, user } = fixture;
  await unconfirmedSave(fixture);
  await user.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
  );
  expect(readLanding).toHaveBeenCalledTimes(2);
  expect(setLanding).toHaveBeenCalledTimes(1);
  expect(messageField()).toHaveValue("Say hello");
  expect(screen.queryByRole("alert")).toBeNull();
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
