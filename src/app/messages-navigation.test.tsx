// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createServices, type AppServices } from "./services";

vi.mock("../bundled", async () => ({
  bundledPlugins: [
    {
      manifest: (await import("../bundled/channels/manifest.json")).default,
      module: await import("../bundled/channels"),
      enabledByDefault: true,
    },
  ],
}));

let services: AppServices | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(async () => {
  cleanup();
  await services?.dispose();
  services = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("opens Drafts & sent inside Messages and retains the sidebar through Back/Forward", async () => {
  services = createServices();
  render(<App services={services} />);
  const drafts = await screen.findByRole("button", { name: "Drafts & sent" });
  await waitFor(() =>
    expect(services?.navigation.snapshot().status).toBe("opened"),
  );
  await userEvent.click(drafts);
  expect(
    await screen.findByRole("region", { name: "Drafts & sent" }),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: "Messages" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(document.getElementById("shell-navigation")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  expect(drafts).toHaveAttribute("aria-current", "page");
  await waitFor(() =>
    expect(services?.navigation.snapshot().status).toBe("opened"),
  );
  act(() => services?.navigation.back());
  expect(
    await screen.findByRole("heading", {
      name: "Your channels, one conversation.",
    }),
  ).toBeVisible();
  act(() => services?.navigation.forward());
  expect(
    await screen.findByRole("region", { name: "Drafts & sent" }),
  ).toBeVisible();
  expect(document.getElementById("shell-navigation")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
});

it.each(["page", "plugin"] as const)(
  "opens old %s links inside Messages without an extra history visit",
  async (kind) => {
    const old = {
      version: 1,
      kind,
      pluginId: "buzz.drafts-sent",
      pageId: "drafts-sent",
      scope: null,
    };
    window.history.replaceState(
      null,
      "",
      `/#buzz=${encodeURIComponent(JSON.stringify(old))}`,
    );
    services = createServices();
    const entryId = services.navigation.snapshot().entry.id;
    render(<App services={services} />);
    expect(
      await screen.findByRole("region", { name: "Drafts & sent" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(services?.navigation.snapshot().status).toBe("opened"),
    );
    expect(services.navigation.snapshot().entry.id).toBe(entryId);
    expect(services.navigation.snapshot().entry.target).toEqual({
      version: 1,
      kind: "page",
      pluginId: "buzz.channels",
      pageId: "channels",
      scope: null,
      route: { version: 1, params: "drafts-sent" },
    });
    expect(screen.getByRole("tab", { name: "Messages" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
);
